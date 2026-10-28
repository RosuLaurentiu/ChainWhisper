import { Interface, getAddress, hexlify, keccak256, toUtf8Bytes, toBeHex } from '@coti-io/coti-ethers';
import { decryptUint } from '@coti-io/coti-sdk-typescript';
import { readCurrentDexGraph, readCurrentDexIssuedQuote, readCurrentDexOperation } from '../../lib/appChain';
import { createDexV2ReadCapability, readCurrentSharedPoolDexGraph } from '../../lib/dexV2Chain';
import { CURRENT_SHARED_POOL_CANDIDATE, currentCheapDexQuoteProtocol, resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../lib/dexV2Deployment';
import { CURRENT_CHEAP_DEX_QUOTE_ABI, CURRENT_SLIPPAGE_DEX_QUOTE_ABI, CURRENT_DEX_OPEN_ABI, encodeCurrentDexQuoteRequest, type CurrentCheapDexProfile } from '../../lib/currentDexOperation';
import { decryptPrivateUint256Output, encryptPrivateUint256Input } from '../../lib/privateUint256';
import { verifyCurrentDexCanonicalInclusion } from '../../lib/currentDexCanonicalInclusion';
import { isCurrentOwnerBeta } from '../../lib/currentDexOwnerBetaPolicy';
import type { CurrentCheapDexPreparedQuote } from '../../lib/currentDexSubmission';
import { issueOwnerCotiMetaMaskCapability, type IssueOwnerCotiMetaMaskCapabilityArgs } from './ownerCotiMetaMaskCapability';

type IssueArgs = Omit<IssueOwnerCotiMetaMaskCapabilityArgs<unknown>, 'bindCapability' | 'capabilityLabel' | 'requirePrivacy'>;
type Terms = Readonly<{ inputToken: string; outputToken: string; destination: string; deadline: bigint; maximumInput: bigint; minimumInput: bigint; minimumOutput: bigint;
  rateNumerator: bigint; rateDenominator: bigint; toleranceBps?: number }>;
// Public discovery hint only. The keeper must independently verify canonical chain data.
export type CurrentDexKeeperNomination = Readonly<{
  schema: 'CURRENT_DEX_APP_QUOTE_NOMINATION_V1';
  identity: Readonly<{ graph: string; packageSha256: string; core: string; chainId: string; genesisHash: string; releaseId: string }>;
  principal: string; inputToken: string; outputToken: string; destination: string;
  operationId: string; quoteHash: string; origin: Readonly<{ number: string; hash: string }>;
  deadline: string; toleranceBps: number;
}>;
const opening = new Interface(CURRENT_DEX_OPEN_ABI);
const selector = opening.getFunction('openSinglePassSwapV2')!.selector;
const sharedPoolManifestHash = keccak256(toUtf8Bytes(JSON.stringify(CURRENT_SHARED_POOL_CANDIDATE)));
type SharedPoolGraphRequest = Readonly<{ candidate: 'shared-pool'; expectedGraph: string;
  expectedPackageSha256: string; blockNumber: bigint; blockHash: string }>;
const issuedQuotes = new WeakSet<object>();
const sharedPoolPreparedSessions = new WeakMap<object, object>();
const sharedPoolIssuedSessions = new WeakMap<object, object>();
const cheapPreparedSessions = new WeakMap<object, object>();
const cheapIssuedSessions = new WeakMap<object, object>();
const restoredPlans = new WeakMap<object, CurrentCheapDexPreparedQuote>();
const restoredPrepared = new WeakSet<object>();
export const currentDexRestoredPlan = (issued: object, signer: object) => {
  assertCurrentCheapDexIssuedQuote(issued, signer);
  const plan = restoredPlans.get(issued);
  if (!plan) throw new Error('Current Quote has no authenticated reload plan.');
  return plan;
};
export const assertCurrentDexQuoteNotRestored = (prepared: object) => {
  if (restoredPrepared.has(prepared)) throw new Error('A restored Quote cannot be submitted again.');
};
export const assertCurrentCheapDexPreparedQuote = (value: unknown, signer: object): void => {
  if (!value || typeof value !== 'object' || cheapPreparedSessions.get(value) !== signer) {
    throw new Error('Current-mode Quote was not prepared in this owner wallet session.');
  }
};
export const assertCurrentCheapDexIssuedQuote = (value: unknown, signer: object): void => {
  if (!value || typeof value !== 'object' || cheapIssuedSessions.get(value) !== signer) {
    throw new Error('Current-mode Quote was not issued in this owner wallet session.');
  }
};
export const assertCurrentSharedPoolPreparedQuote = (value: unknown, signer: object): void => {
  if (!value || typeof value !== 'object' || sharedPoolPreparedSessions.get(value) !== signer) {
    throw new Error('Shared-Pool Quote was not prepared in this owner wallet session.');
  }
};
export const assertCurrentSharedPoolIssuedQuote = (value: unknown, signer: object): void => {
  if (!value || typeof value !== 'object' || sharedPoolIssuedSessions.get(value) !== signer) {
    throw new Error('Shared-Pool operation was not issued in this owner wallet session.');
  }
};
export const assertCurrentDexIssuedQuote = (value: unknown): void => {
  if (!value || typeof value !== 'object' || !issuedQuotes.has(value)) {
    throw new Error('Current DEX quote was not issued by the owner wallet capability.');
  }
};
const uint = (value: bigint, bits: number, positive = false) => {
  if (typeof value !== 'bigint' || value < (positive ? 1n : 0n) || value >= 1n << BigInt(bits)) throw new Error('Invalid private quote terms.');
};
const inputSignature = (value: unknown) => {
  if (typeof value !== 'string' && !(value instanceof Uint8Array)) throw new Error('Invalid private input signature shape.');
  const signature = hexlify(value);
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('Invalid private input signature shape.');
  return signature;
};

// Private-input preparation only. No sendTransaction, allowance, funding or generic signer is exposed.
export const issueCurrentDexQuoteCapability = (args: IssueArgs) => issueOwnerCotiMetaMaskCapability({
  ...args, capabilityLabel: 'current DEX quote preparation', requirePrivacy: true,
  bindCapability: async ({ assertCurrent, assertSnapshotCurrent, readProvider, signer, chainId, ownerAddress }) => {
    const capability = createDexV2ReadCapability({ chainId, assertCurrent,
      provider: { request: ({ method, params }) => readProvider.send(method, params ?? []) } });
    const legacy = Object.freeze({ prepareQuote: async (request: {
      graph: Omit<Parameters<typeof readCurrentDexGraph>[0], 'capability'> | SharedPoolGraphRequest;
      terms: Terms;
      confirmPrivateInputs: (review: Terms & Readonly<{ core: string; principal: string; chainId: bigint }>) => Promise<boolean>;
    }) => {
      const terms = Object.freeze({ ...request.terms, inputToken: getAddress(request.terms.inputToken),
        outputToken: getAddress(request.terms.outputToken), destination: getAddress(request.terms.destination) });
      const graphRequest = Object.freeze({ ...request.graph });
      const confirm = request.confirmPrivateInputs;
      if (terms.toleranceBps !== undefined) throw new Error('Historical Quote does not support tolerance.');
      uint(terms.maximumInput, 256, true); uint(terms.minimumInput, 256); uint(terms.minimumOutput, 256);
      if (terms.minimumInput > terms.maximumInput) throw new Error('Minimum input exceeds maximum input.');
      uint(terms.rateNumerator, 128, true); uint(terms.rateDenominator, 128, true); uint(terms.deadline, 256, true);
      if (BigInt(terms.inputToken) === 0n || BigInt(terms.outputToken) === 0n ||
          terms.inputToken === terms.outputToken || BigInt(terms.destination) === 0n || typeof confirm !== 'function') {
        throw new Error('Invalid quote preparation request.');
      }
      const sharedPool = 'candidate' in graphRequest;
      if (sharedPool && (graphRequest.candidate !== 'shared-pool' ||
          graphRequest.expectedGraph !== CURRENT_SHARED_POOL_CANDIDATE.graph ||
          graphRequest.expectedPackageSha256 !== CURRENT_SHARED_POOL_CANDIDATE.packageSha256)) {
        throw new Error('Shared-Pool quote candidate differs from the reviewed deployment.');
      }
      const checkedSharedPool = async (blockNumber: bigint, blockHash: string) => {
        const identity = await readCurrentSharedPoolDexGraph({ capability, blockNumber, blockHash });
        if (identity.graph !== CURRENT_SHARED_POOL_CANDIDATE.graph ||
            identity.packageSha256 !== CURRENT_SHARED_POOL_CANDIDATE.packageSha256 ||
            identity.chainId !== chainId || identity.genesisHash !== CURRENT_SHARED_POOL_CANDIDATE.genesisHash ||
            identity.core.toLowerCase() !== CURRENT_SHARED_POOL_CANDIDATE.core ||
            identity.inputToken.toLowerCase() !== CURRENT_SHARED_POOL_CANDIDATE.tokens[0][0] ||
            identity.outputToken.toLowerCase() !== CURRENT_SHARED_POOL_CANDIDATE.tokens[1][0] ||
            identity.block.number !== blockNumber || identity.block.hash.toLowerCase() !== blockHash.toLowerCase() ||
            identity.operationReadIdentity.releaseId !== CURRENT_SHARED_POOL_CANDIDATE.releaseId ||
            identity.operationReadIdentity.runtimeHash !== CURRENT_SHARED_POOL_CANDIDATE.runtimes.find(([role]) => role === 'ChainWhisperDexCore')?.[2]) {
          throw new Error('Shared-Pool quote identity differs from the reviewed deployment.');
        }
        return identity;
      };
      const graph = sharedPool
        ? Object.freeze({ ...await checkedSharedPool(graphRequest.blockNumber, graphRequest.blockHash), manifestHash: sharedPoolManifestHash })
        : await readCurrentDexGraph({ ...graphRequest, capability });
      const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
      if (!((same(terms.inputToken, graph.inputToken) && same(terms.outputToken, graph.outputToken)) ||
          (same(terms.inputToken, graph.outputToken) && same(terms.outputToken, graph.inputToken))) ||
          same(terms.destination, graph.core) || graph.chainId !== chainId ||
          terms.deadline <= graph.block.timestamp || terms.deadline - graph.block.timestamp > graph.maxWorkLifetime) {
        throw new Error('Quote destination or deadline is invalid.');
      }
      const guard = async () => {
        await assertCurrent(); assertSnapshotCurrent();
        const now = BigInt(Math.floor(Date.now() / 1000));
        if (now < graph.block.timestamp || now >= terms.deadline) throw new Error('Quote preparation expired or clock is behind the checked block.');
      };
      await guard();
      if (await confirm(Object.freeze({ ...terms, core: graph.core, principal: ownerAddress, chainId })) !== true) return null;
      const wide = async (value: bigint) => {
        await guard();
        const input = await encryptPrivateUint256Input(signer, value, graph.core, selector);
        await guard();
        uint(input.ciphertext.ciphertextHigh, 256); uint(input.ciphertext.ciphertextLow, 256);
        return Object.freeze({ ciphertext: Object.freeze({ ...input.ciphertext }), signature: inputSignature(input.signature) });
      };
      const rate = async (value: bigint) => {
        await guard();
        const input = await signer.encryptValue(value, graph.core, selector);
        await guard();
        if (!input || !('ciphertext' in input) || typeof input.ciphertext !== 'bigint') throw new Error('Invalid private rate input.');
        uint(input.ciphertext, 256);
        return Object.freeze({ ciphertext: input.ciphertext, signature: inputSignature(input.signature) });
      };
      // Sequential prompts keep each message tied to one captured owner intent.
      const maximum = await wide(terms.maximumInput), minimumInput = await wide(terms.minimumInput);
      const minimumOutput = await wide(terms.minimumOutput);
      const numerator = await rate(terms.rateNumerator), denominator = await rate(terms.rateDenominator);
      const data = opening.encodeFunctionData('openSinglePassSwapV2', [terms.inputToken, terms.outputToken,
        terms.destination, terms.deadline, maximum, minimumInput, minimumOutput, numerator, denominator]);
      await guard();
      const intent = Object.freeze({ ...terms, principal: ownerAddress, chainId, core: graph.core,
        runtimeHash: graph.operationReadIdentity.runtimeHash, releaseId: graph.operationReadIdentity.releaseId });
      const prepared = Object.freeze({ chainId, from: ownerAddress, to: graph.core, value: 0n, data, readyToSign: false as const,
        graph: graph.graph, manifestHash: graph.manifestHash, block: graph.block,
        intent,
        // Read after expiry too: an expired operation still needs inspection and recovery.
        readIssue: async (transactionHash: string) => {
          if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash) || BigInt(transactionHash) === 0n) throw new Error('Invalid quote transaction hash.');
          await assertCurrent(); assertSnapshotCurrent();
          const [transaction, receipt] = await Promise.all([
            readProvider.getTransaction(transactionHash), readProvider.getTransactionReceipt(transactionHash)
          ]);
          await assertCurrent(); assertSnapshotCurrent();
          if (!transaction || !receipt) return null;
          const observed = await readCurrentDexIssuedQuote({ capability, runtimeHash: intent.runtimeHash,
            profile: sharedPool ? 'shared-pool' : 'legacy',
            issue: { transaction, receipt, expected: { transactionHash, chainId, core: intent.core,
              principal: ownerAddress, calldata: data, inputToken: terms.inputToken, outputToken: terms.outputToken,
              destination: terms.destination, deadline: terms.deadline,
              releaseId: intent.releaseId } } });
          if (observed.originBlock.number < graph.block.number) throw new Error('Quote issue predates preparation.');
          if (sharedPool) await checkedSharedPool(observed.block.number, observed.block.hash);
          await assertCurrent(); assertSnapshotCurrent();
          const readCurrent = async () => {
            await assertCurrent(); assertSnapshotCurrent();
            const expected = { chainId, core: intent.core, runtimeHash: intent.runtimeHash, releaseId: intent.releaseId };
            const current = await readCurrentDexOperation({ capability, operationId: observed.operationId,
              profile: sharedPool ? 'shared-pool' : 'legacy',
              expected: { ...expected, originBlockNumber: observed.originBlock.number, originBlockHash: observed.originBlock.hash } });
            if (current.operation.status === 0 || current.operation.contextHash !== observed.operation.contextHash ||
                current.operation.epochId !== observed.operation.epochId || current.operation.deadline !== terms.deadline ||
                (sharedPool && (current.operation.canonicalMarketId !== observed.operation.canonicalMarketId ||
                  current.operation.marketRevision !== observed.operation.marketRevision ||
                  current.operation.registryRevision !== observed.operation.registryRevision))) {
              throw new Error('Current quote no longer matches its mined Open operation.');
            }
            if (sharedPool) await checkedSharedPool(current.block.number, current.block.hash);
            await assertCurrent(); assertSnapshotCurrent();
            const refreshed = Object.freeze({ ...observed, ...current, readyToSign: false as const,
              intent: Object.freeze({ ...intent, operationId: observed.operationId, contextHash: observed.operation.contextHash }),
              readCurrent });
            issuedQuotes.add(refreshed);
            if (sharedPool) sharedPoolIssuedSessions.set(refreshed, signer);
            return refreshed;
          };
          const issued = Object.freeze({ ...observed, readyToSign: false as const,
            intent: Object.freeze({ ...intent, operationId: observed.operationId, contextHash: observed.operation.contextHash }),
            readCurrent });
          issuedQuotes.add(issued);
          if (sharedPool) sharedPoolIssuedSessions.set(issued, signer);
          return issued;
        } });
      if (sharedPool) sharedPoolPreparedSessions.set(prepared, signer);
      return prepared;
    } });
    const prepareCurrentQuote = async (request: {
      profile: CurrentCheapDexProfile;
      graph: Omit<SharedPoolGraphRequest, 'candidate'> & { candidate: CurrentCheapDexCandidateKey };
      terms: Terms;
      confirmPrivateInputs: (review: Terms & Readonly<{ core: string; principal: string; chainId: bigint; profile: CurrentCheapDexProfile }>) => Promise<boolean>;
    }, restoredData?: string, restoredOriginTimestamp?: bigint) => {
      const candidate = resolveCurrentCheapDexCandidate(request.graph.candidate), profile = request.profile;
      const quoteProtocol = currentCheapDexQuoteProtocol(candidate);
      if (profile !== 'fast-pool' && profile !== 'cheap-async') throw new Error('Unknown current quote profile.');
      const graphRequest = Object.freeze({ ...request.graph });
      if (graphRequest.expectedGraph !== candidate.graph ||
          graphRequest.expectedPackageSha256 !== candidate.packageSha256) throw new Error('Current quote candidate differs from the reviewed deployment.');
      const terms = Object.freeze({ ...request.terms, inputToken: getAddress(request.terms.inputToken),
        outputToken: getAddress(request.terms.outputToken), destination: getAddress(request.terms.destination) });
      const confirm = request.confirmPrivateInputs;
      uint(terms.maximumInput, 256, true); uint(terms.minimumInput, 256); uint(terms.minimumOutput, 256);
      uint(terms.rateNumerator, 128, !quoteProtocol); uint(terms.rateDenominator, 128, true); uint(terms.deadline, 256, true);
      if (quoteProtocol ? !Number.isInteger(terms.toleranceBps) || terms.toleranceBps! < 0 || terms.toleranceBps! > 10000
        : terms.toleranceBps !== undefined) throw new Error('Quote tolerance is not bound to the active candidate.');
      if (terms.minimumInput > terms.maximumInput || typeof confirm !== 'function') throw new Error('Invalid private quote terms.');
      const checkedGraph = async (blockNumber: bigint, blockHash: string) => {
        await assertCurrent(); assertSnapshotCurrent();
        const graph = await readCurrentSharedPoolDexGraph({ capability, candidate: graphRequest.candidate, blockNumber, blockHash });
        await assertCurrent(); assertSnapshotCurrent();
        if (graph.graph !== candidate.graph || graph.packageSha256 !== candidate.packageSha256 || graph.chainId !== chainId ||
            graph.genesisHash !== candidate.genesisHash || graph.core.toLowerCase() !== candidate.core ||
            graph.operationReadIdentity.runtimeHash !== candidate.runtimes.find(([role]) => role === 'ChainWhisperDexCore')?.[2] ||
            graph.operationReadIdentity.releaseId !== candidate.releaseId || graph.block.number !== blockNumber ||
            graph.block.hash.toLowerCase() !== blockHash.toLowerCase()) throw new Error('Current quote graph identity changed.');
        return graph;
      };
      const graph = await checkedGraph(graphRequest.blockNumber, graphRequest.blockHash);
      const termsTimestamp = restoredData ? restoredOriginTimestamp! : graph.block.timestamp;
      uint(termsTimestamp,64);
      const pair = candidate.tokens.map(([token]) => token);
      if (!pair.some(token => token === terms.inputToken.toLowerCase()) || !pair.some(token => token === terms.outputToken.toLowerCase()) ||
          terms.inputToken === terms.outputToken || BigInt(terms.destination) === 0n || terms.destination.toLowerCase() === candidate.core ||
          terms.deadline <= termsTimestamp || terms.deadline - termsTimestamp > graph.maxWorkLifetime) throw new Error('Invalid current quote pair, destination or deadline.');
      const guard = async () => {
        await assertCurrent(); assertSnapshotCurrent();
        const now = BigInt(Math.floor(Date.now() / 1000));
        if (!restoredData && (now < graph.block.timestamp || now >= terms.deadline)) throw new Error('Current quote preparation expired.');
      };
      await guard();
      if (!restoredData && await confirm(Object.freeze({ ...terms, core: graph.core, principal: ownerAddress, chainId, profile })) !== true) return null;
      const opening = new Interface(quoteProtocol ? CURRENT_SLIPPAGE_DEX_QUOTE_ABI : CURRENT_CHEAP_DEX_QUOTE_ABI);
      const method = profile === 'fast-pool' ? quoteProtocol ? 'quoteFastPool' : 'quoteFastPoolV1'
        : quoteProtocol ? 'quoteCheapAsync' : 'quoteCheapAsyncV1';
      const selector = opening.getFunction(method)!.selector;
      const wide = async (value: bigint) => {
        await guard();
        const input = await encryptPrivateUint256Input(signer, value, graph.core, selector);
        await guard();
        uint(input.ciphertext.ciphertextHigh, 256); uint(input.ciphertext.ciphertextLow, 256);
        return Object.freeze({ ciphertext: Object.freeze({ ...input.ciphertext }), signature: inputSignature(input.signature) });
      };
      const rate = async (value: bigint) => {
        await guard();
        const input = await signer.encryptValue(value, graph.core, selector);
        await guard();
        if (!input || typeof input.ciphertext !== 'bigint') throw new Error('Invalid private rate input.');
        uint(input.ciphertext, 256);
        return Object.freeze({ ciphertext: input.ciphertext, signature: inputSignature(input.signature) });
      };
      const data = restoredData ?? await (async () => {
        const maximum = await wide(terms.maximumInput), minimum = await wide(terms.minimumInput), output = await wide(terms.minimumOutput);
        const numerator = await rate(terms.rateNumerator), denominator = await rate(terms.rateDenominator);
        return encodeCurrentDexQuoteRequest({ profile, quoteProtocol, toleranceBps: terms.toleranceBps, inputToken: terms.inputToken, outputToken: terms.outputToken,
          destination: terms.destination, deadline: terms.deadline, maximumInput: maximum, minimumInput: minimum,
          minimumOutput: output, minimumRateNumerator: numerator, minimumRateDenominator: denominator });
      })();
      await guard();
      const intent = Object.freeze({ ...terms, candidate, profile, quoteProtocol, principal: ownerAddress, chainId, core: graph.core,
        runtimeHash: graph.operationReadIdentity.runtimeHash, releaseId: graph.operationReadIdentity.releaseId });
      const prepared = Object.freeze({ profile, chainId, from: ownerAddress, to: graph.core, value: 0n, data,
        readyToSign: false as const, graph: graph.graph, manifestHash: keccak256(toUtf8Bytes(JSON.stringify(candidate))), block: graph.block, intent,
        readIssue: async (transactionHash: string) => {
          if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash) || BigInt(transactionHash) === 0n) throw new Error('Invalid quote transaction hash.');
          await assertCurrent(); assertSnapshotCurrent();
          const [transaction, receipt] = await Promise.all([readProvider.getTransaction(transactionHash), readProvider.getTransactionReceipt(transactionHash)]);
          await assertCurrent(); assertSnapshotCurrent();
          if (!transaction || !receipt) return null;
          const observed = await readCurrentDexIssuedQuote({ capability, candidate, profile, runtimeHash: intent.runtimeHash,
            issue: { transaction, receipt, quoteProtocol, expected: { transactionHash, chainId, core: intent.core, principal: ownerAddress,
              calldata: data, inputToken: terms.inputToken, outputToken: terms.outputToken, destination: terms.destination,
              deadline: terms.deadline, releaseId: intent.releaseId, toleranceBps: terms.toleranceBps } } });
          if ((restoredData ? observed.block.number : observed.originBlock.number) < graph.block.number || observed.operation.deadline !== terms.deadline || observed.operation.phase === 'not-found') throw new Error('Current quote issue identity changed.');
          await checkedGraph(observed.block.number, observed.block.hash);
          let boundContext = observed.operation.contextHash;
          const readCurrent = async () => {
            const current = await readCurrentDexOperation({ capability, candidate, profile, operationId: observed.operationId,
              expected: { chainId, core: intent.core, runtimeHash: intent.runtimeHash, releaseId: intent.releaseId,
                originBlockNumber: observed.originBlock.number, originBlockHash: observed.originBlock.hash } });
            await assertCurrent(); assertSnapshotCurrent();
            if (current.operation.phase === 'not-found' || current.operation.deadline !== terms.deadline ||
                (BigInt(boundContext) !== 0n && current.operation.contextHash !== boundContext)) throw new Error('Current quote context changed.');
            await checkedGraph(current.block.number, current.block.hash);
            // Bind the private allocation only once async work produces its READY context.
            if (BigInt(current.operation.contextHash) !== 0n) boundContext = current.operation.contextHash;
            const refreshed = Object.freeze({ ...observed, ...current, readyToSign: false as const,
              intent: Object.freeze({ ...intent, operationId: observed.operationId, contextHash: boundContext }), readCurrent, readKeeperNomination });
            cheapIssuedSessions.set(refreshed, signer);
            if (restoredData) restoredPlans.set(refreshed, prepared);
            return refreshed;
          };
          const readKeeperNomination = async (): Promise<CurrentDexKeeperNomination> => {
            if (profile !== 'cheap-async' || !quoteProtocol || terms.toleranceBps === undefined) {
              throw new Error('This Quote does not use the asynchronous keeper protocol.');
            }
            const current = await readCurrent();
            if (![1, 2, 3, 4, 5, 6].includes(current.operation.stage!) || terms.deadline <= current.block.timestamp) {
              throw new Error('This Quote is no longer active keeper work.');
            }
            // Explicit fields: never serialize intent, encrypted calldata, amounts or the wallet capability.
            return Object.freeze({ schema: 'CURRENT_DEX_APP_QUOTE_NOMINATION_V1',
              identity: Object.freeze({ graph: candidate.graph, packageSha256: candidate.packageSha256,
                core: candidate.core, chainId: String(chainId), genesisHash: candidate.genesisHash, releaseId: candidate.releaseId }),
              principal: ownerAddress, inputToken: terms.inputToken, outputToken: terms.outputToken, destination: terms.destination,
              operationId: String(observed.operationId), quoteHash: transactionHash.toLowerCase(),
              origin: Object.freeze({ number: String(observed.originBlock.number), hash: observed.originBlock.hash }),
              deadline: String(terms.deadline), toleranceBps: terms.toleranceBps });
          };
          const issued = Object.freeze({ ...observed, readyToSign: false as const,
            intent: Object.freeze({ ...intent, operationId: observed.operationId, contextHash: boundContext }), readCurrent, readKeeperNomination });
          cheapIssuedSessions.set(issued, signer);
          if (restoredData) restoredPlans.set(issued, prepared);
          return issued;
        } });
      cheapPreparedSessions.set(prepared, signer);
      if (restoredData) restoredPrepared.add(prepared);
      return prepared;
    };
    return Object.freeze({ ...legacy, prepareCurrentQuote: (request: Parameters<typeof prepareCurrentQuote>[0]) => prepareCurrentQuote(request),
      restoreCurrentQuote: async ({ quoteHash, operationId }: { quoteHash: string; operationId?: bigint }) => {
        if (!/^0x[0-9a-fA-F]{64}$/.test(quoteHash) || BigInt(quoteHash) === 0n) throw new Error('Invalid original Quote hash.');
        await assertCurrent(); assertSnapshotCurrent();
        const [transaction, receipt] = await Promise.all([readProvider.getTransaction(quoteHash), readProvider.getTransactionReceipt(quoteHash)]);
        await assertCurrent(); assertSnapshotCurrent();
        const candidateKey = (['cheap-exit', 'cheap-history'] as const).find(key =>
          resolveCurrentCheapDexCandidate(key).core === transaction?.to?.toLowerCase());
        if (!candidateKey) throw new Error('Original Quote transaction belongs to an unsupported DEX deployment.');
        const candidate = resolveCurrentCheapDexCandidate(candidateKey);
        if (!transaction || !receipt || transaction.hash.toLowerCase() !== quoteHash.toLowerCase() || receipt.hash.toLowerCase() !== quoteHash.toLowerCase() || receipt.status !== 1 || transaction.chainId !== chainId || chainId !== BigInt(candidate.chainId) ||
            transaction.from.toLowerCase() !== ownerAddress.toLowerCase() || transaction.to?.toLowerCase() !== candidate.core || transaction.value !== 0n) {
          throw new Error('Original owner Quote is not available on the selected candidate.');
        }
        const canonicalReceipt = { ...receipt, logs: receipt.logs.map(log => ({ address: log.address, topics: [...log.topics], data: log.data,
          ...([log.index, log.transactionHash, log.blockNumber, log.blockHash, log.removed].some(value => value !== undefined) ? {
            // SDK mined logs omit removed; the verifier still requires raw RPC removed=false.
            index: log.index, transactionHash: log.transactionHash, blockNumber: log.blockNumber, blockHash: log.blockHash, removed: log.removed ?? false } : {}) })) };
        const verify = () => verifyCurrentDexCanonicalInclusion({ rpc: (method, params) => readProvider.send(method, params),
          assertCurrent: async () => { await assertCurrent(); assertSnapshotCurrent(); } }, transaction, canonicalReceipt);
        await verify();
        const abi = new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI), call = abi.parseTransaction({ data: transaction.data, value: transaction.value });
        if (!call || !['quoteCheapAsync','quoteFastPool'].includes(call.name) || abi.encodeFunctionData(call.fragment, call.args).toLowerCase() !== transaction.data.toLowerCase()) throw new Error('Original Quote call changed.');
        const profile = call.name==='quoteFastPool'?'fast-pool':'cheap-async';
        const q = profile==='cheap-async'?call.args[0]:{maximumInput:call.args.encryptedMaximumInput,
          minimumInput:call.args.encryptedMinimumInput,minimumOutput:call.args.encryptedMinimumOutput,
          minimumRateNumerator:call.args.encryptedMinimumRateNumerator,minimumRateDenominator:call.args.encryptedMinimumRateDenominator,
          inputToken:call.args.inputToken,outputToken:call.args.outputToken,destination:call.args.destination,deadline:call.args.deadline,toleranceBps:call.args.toleranceBps},
          aesKey = signer.getUserOnboardInfo()?.aesKey?.trim();
        if (!aesKey) throw new Error('Unlock owner privacy before restoring the Quote.');
        const terms: Terms = Object.freeze({ inputToken: q.inputToken, outputToken: q.outputToken, destination: q.destination, deadline: q.deadline,
          maximumInput: decryptPrivateUint256Output(signer, q.maximumInput.ciphertext), minimumInput: decryptPrivateUint256Output(signer, q.minimumInput.ciphertext),
          minimumOutput: decryptPrivateUint256Output(signer, q.minimumOutput.ciphertext), rateNumerator: decryptUint(q.minimumRateNumerator.ciphertext, aesKey),
          rateDenominator: decryptUint(q.minimumRateDenominator.ciphertext, aesKey), toleranceBps: Number(q.toleranceBps) });
        if ((!isCurrentOwnerBeta(candidate.graph,ownerAddress) && terms.maximumInput > 20_000_000n) || terms.toleranceBps! > 50) throw new Error('Restored Quote exceeds the current protected domain.');
        const [origin,head] = await Promise.all([
          readProvider.send('eth_getBlockByNumber',[toBeHex(receipt.blockNumber),false]),
          readProvider.send('eth_getBlockByNumber',['latest',false])
        ]);
        await assertCurrent();assertSnapshotCurrent();
        if(!origin||!head||!/^0x[0-9a-f]+$/i.test(origin.number)||!/^0x[0-9a-f]+$/i.test(origin.timestamp)||
            !/^0x[0-9a-f]+$/i.test(head.number)||!/^0x[0-9a-f]{64}$/i.test(head.hash)||
            BigInt(origin.number)!==BigInt(receipt.blockNumber)||origin.hash?.toLowerCase()!==receipt.blockHash.toLowerCase()||
            BigInt(head.number)<BigInt(origin.number))throw new Error('Restored Quote canonical origin or head changed.');
        const prepared = await prepareCurrentQuote({ profile, graph: { candidate: candidateKey, expectedGraph: candidate.graph,
          expectedPackageSha256: candidate.packageSha256, blockNumber: BigInt(head.number), blockHash: head.hash }, terms,
          confirmPrivateInputs: async () => { throw new Error('Restoration cannot request new private inputs.'); } }, transaction.data,BigInt(origin.timestamp));
        if (!prepared) throw new Error('Original Quote restoration is unavailable.');
        const issued = await prepared.readIssue(quoteHash);
        await verify(); await assertCurrent(); assertSnapshotCurrent();
        if (!issued || operationId !== undefined && issued.operationId !== operationId || signer.getUserOnboardInfo()?.aesKey?.trim() !== aesKey) throw new Error('Restored Quote identity or owner privacy changed.');
        return issued;
      } });
  }
});
