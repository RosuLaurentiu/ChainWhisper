import { Interface, toBeHex, getBytes, hexlify, type TransactionRequest } from '@coti-io/coti-ethers';
import {
  createCurrentDexSubmissionAdapter,
  createCurrentSharedPoolSubmissionAdapter,
  createCurrentCheapDexSubmissionAdapter,
  createArchivedCheapDexRecovery,
  type CurrentDexSubmissionAdmission,
  type CurrentTransport
} from '../../lib/currentDexSubmission';
import { createDexV2ReadCapability, readCurrentDexOperation, readCurrentSharedPoolDexGraph } from '../../lib/dexV2Chain';
import { CURRENT_SHARED_POOL_CANDIDATE,
  resolveCurrentCheapDexCandidate, currentCheapDexCandidateKey, type CurrentCheapDexCandidateKey } from '../../lib/dexV2Deployment';
import { currentDexDisplayPair } from '../../lib/currentDexDisplay';
import { resolvePreparedDexScope } from '../../lib/currentDexPreparedScope';
import { readCurrentDexPendingAttempt, currentDexPendingStorage } from '../../lib/currentDexPendingAttempt';
import { PRIVATE_ERC20_TOKEN_VNEXT_ABI } from '../../lib/appShared/contracts';
import { decryptPrivateBoolOutput, decryptPrivateUint256Output, encryptPrivateUint256Input } from '../../lib/privateUint256';
import { createCurrentTokenFundingAdapter, currentTokenFundingAbi, CURRENT_TOKEN_FUNDING_CAP } from '../../lib/currentDexTokenFunding';
import { createCurrentTokenRefillSubmissionAdapter } from '../../lib/currentDexTokenRefillSubmission';
import { CURRENT_NATIVE_TOKEN_REFILL_BINDING, assertCurrentNativeTokenRefillBinding } from '../../lib/currentDexNativeTokenRefillDeployment';
import { prepareCurrentDexAcceptance } from '../../lib/currentDexQuoteReview';
import { createCurrentPoolSubmissionAdapter } from '../../lib/currentDexPoolSubmission';
import { CURRENT_NATIVE_POOL_PROFILE } from '../../lib/currentDexNativePoolPolicy';
import { createCurrentPoolPositionSubmissionAdapter } from '../../lib/currentDexPoolPositionSubmission';
import { createCurrentLimitSubmissionAdapter } from '../../lib/currentDexLimitSubmission';
import { resolveCurrentLimitScope } from '../../lib/currentDexLimit';
import { verifyCurrentDexCanonicalInclusion } from '../../lib/currentDexCanonicalInclusion';
import { issueCurrentDexReceiptCapability } from './currentDexReceiptCapability';
import { issueOwnerCotiMetaMaskCapability, type IssueOwnerCotiMetaMaskCapabilityArgs } from './ownerCotiMetaMaskCapability';
import { createCurrentSharedDexTokenFundingAdapter, assertCurrentSharedTokenFundingAppAuthority } from '../../lib/currentSharedDexTokenFunding';
import { readCurrentSharedDexTokenFunds } from '../../lib/currentSharedDexTokenFunds';
import { verifyCurrentDexOwnerTokenMovements, type CurrentDexOwnerTokenReceipt } from '../../lib/currentDexOwnerTokenProof';
import { CURRENT_CHEAP_DEX_QUOTE_ABI, encodeCurrentCheapDexOperationRead, decodeCurrentCheapDexOperation } from '../../lib/currentDexOperation';
import { currentCheapDexStages } from '../../lib/dexV2Deployment';
import { CURRENT_EXIT_SWAP_GAS_CAPS } from '../../lib/currentDexExitSwapPolicy';
import { readCurrentDexActivityDiscoveryPage, readCurrentDexAsyncTerminalPage, currentDexAsyncTerminalResumeHashes,
  type CurrentDexActivityCursor } from '../../lib/currentDexActivityDiscovery';
import { readCurrentDexActivityReceipt, type CurrentDexActivityRow } from '../../lib/currentDexActivityReceipt';
import { CURRENT_LIMIT_FILL_HISTORY_GRAPHS, readCurrentLimitFillHistoryPage, type CurrentDexLimitFill } from '../../lib/currentDexLimitFillHistory';

import { assertCurrentCheapDexPreparedQuote } from './currentDexQuoteCapability';
import { assertCurrentNativeSwapIntent } from '../../lib/currentDexNativeSwapPolicy';

type IssueArgs = Omit<IssueOwnerCotiMetaMaskCapabilityArgs<unknown>, 'bindCapability' | 'capabilityLabel' | 'requirePrivacy'> &
  Readonly<{ admission: CurrentDexSubmissionAdmission<'quote'> | null; candidate?: CurrentCheapDexCandidateKey;
    nativePoolProfile?: typeof CURRENT_NATIVE_POOL_PROFILE }>;

export const issueCurrentDexSubmissionCapability = ({ admission, candidate = 'cheap-current', nativePoolProfile, ...args }: IssueArgs) => issueOwnerCotiMetaMaskCapability({
  ...args,
  capabilityLabel: 'current DEX submission',
  requirePrivacy: false,
  bindCapability: async ({ assertCurrent, assertSnapshotCurrent, readProvider, signer, chainId, ownerAddress }) => {
    const transport: CurrentTransport & { readHead: () => Promise<{
      number: bigint; hash: string; timestamp: bigint; gasLimit: bigint }>;
      readNonce: () => Promise<number>;
      readBlockHash: (blockNumber: number) => Promise<string | null>;
      readTransaction: (transactionHash: string) => Promise<{
        hash: string; chainId: bigint; from: string; to: string | null; value: bigint; data: string;
        nonce: number; gasLimit: bigint; blockNumber: number | null; blockHash: string | null } | null> } = {
      assertCurrent: async () => { await assertCurrent(); assertSnapshotCurrent(); },
      verifyCanonicalInclusion: (transaction, receipt) => verifyCurrentDexCanonicalInclusion({
        rpc: (method, params) => readProvider.send(method, params),
        assertCurrent: async () => { await assertCurrent(); assertSnapshotCurrent(); }
      }, transaction, receipt),
      readNativeResources: async head => {
        const rpc = async (method: string, params: unknown[]) => {
          await assertCurrent(); assertSnapshotCurrent();
          const value = await readProvider.send(method, params);
          await assertCurrent(); assertSnapshotCurrent();
          return value;
        };
        const quantity = (value: unknown) => {
          if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) throw new Error('Native resource RPC quantity is invalid.');
          return BigInt(value);
        };
        const nonce = (value: unknown) => {
          const n = quantity(value); if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Native resource nonce is invalid.');
          return Number(n);
        };
        const assertHead = async () => {
          // Block progress is allowed; a reorg of the captured resource block is not.
          const block = await rpc('eth_getBlockByNumber', [`0x${head.number.toString(16)}`, false]) as Record<string, unknown> | null;
          if (!block || quantity(block.number) !== head.number || typeof block.hash !== 'string' ||
              block.hash.toLowerCase() !== head.hash.toLowerCase() || quantity(block.timestamp) !== head.timestamp ||
              quantity(block.gasLimit) !== head.gasLimit) throw new Error('Native resource canonical head changed.');
          return quantity(block.baseFeePerGas);
        };
        const baseFeePerGas = await assertHead();
        const observedChain = quantity(await rpc('eth_chainId', []));
        if (observedChain !== chainId) throw new Error('Native resource RPC chain changed.');
        const latestNonce = nonce(await rpc('eth_getTransactionCount', [ownerAddress, 'latest']));
        const pendingNonce = nonce(await rpc('eth_getTransactionCount', [ownerAddress, 'pending']));
        const gasPrice = quantity(await rpc('eth_gasPrice', []));
        const pinned = { blockHash: head.hash, requireCanonical: true };
        const balance = quantity(await rpc('eth_getBalance', [ownerAddress, pinned]));
        const code = await rpc('eth_getCode', [ownerAddress, pinned]);
        if (code !== '0x') throw new Error('Native payer must be an EOA.');
        if (await assertHead() !== baseFeePerGas) throw new Error('Native resource canonical base fee changed.');
        return Object.freeze({ owner: ownerAddress, chainId: observedChain, head: Object.freeze({ ...head }),
          latestNonce, pendingNonce, gasPrice, baseFeePerGas, balance, code });
      },
      estimateGas: request => signer.estimateGas(request as TransactionRequest),
      send: async (request, onTransactionHash) => {
        await assertCurrent(); assertSnapshotCurrent();
        // The SDK sendTransaction polls wallet RPC without a bound after receiving the hash.
        const transactionHash = await signer.sendUncheckedTransaction(request as TransactionRequest);
        if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash) || BigInt(transactionHash) === 0n) {
          throw new Error('Wallet returned an invalid transaction hash. Do not resend.');
        }
        await onTransactionHash?.(transactionHash);
        await assertCurrent(); assertSnapshotCurrent();
        let observed = await readProvider.getTransaction(transactionHash);
        await assertCurrent(); assertSnapshotCurrent();
        if (!observed) {
          try { await readProvider.waitForTransaction(transactionHash, 1, 60000); }
          catch (error) { if ((error as { code?: string })?.code !== 'TIMEOUT') throw error; }
          await assertCurrent(); assertSnapshotCurrent();
          observed = await readProvider.getTransaction(transactionHash);
          await assertCurrent(); assertSnapshotCurrent();
        }
        if (!observed) {
          throw new Error('Submitted transaction is not yet verified by the Testnet RPC. Check current state; do not resend.');
        }
        const mismatch = [
          observed.chainId !== chainId ? `chainId (expected ${chainId}, received ${observed.chainId})` : '',
          observed.hash.toLowerCase() !== transactionHash.toLowerCase() ? 'hash' : '',
          observed.from.toLowerCase() !== ownerAddress.toLowerCase() || observed.from.toLowerCase() !== request.from.toLowerCase() ? 'from' : '',
          observed.to?.toLowerCase() !== request.to.toLowerCase() ? 'to' : '',
          observed.value !== request.value ? 'value' : '',
          observed.data.toLowerCase() !== request.data.toLowerCase() ? 'data' : '',
          observed.nonce !== request.nonce ? 'nonce' : '',
          observed.gasLimit !== request.gasLimit ? 'gasLimit' : '',
          request.gasPrice !== undefined && observed.gasPrice !== request.gasPrice ? 'gasPrice' : ''
        ].filter(Boolean);
        if (mismatch.length) {
          throw new Error(`Submitted transaction and Testnet RPC differ. Mismatch: ${mismatch.join(', ')}. Do not resend.`);
        }
        return Object.freeze({ hash: observed.hash, chainId: observed.chainId, from: observed.from,
          to: observed.to, value: observed.value, data: observed.data, nonce: observed.nonce, gasLimit: observed.gasLimit, gasPrice: observed.gasPrice });
      },
      waitForReceipt: async transactionHash => {
        await assertCurrent(); assertSnapshotCurrent();
        const receipt = await readProvider.getTransactionReceipt(transactionHash);
        await assertCurrent(); assertSnapshotCurrent();
        return receipt && Object.freeze({ hash: receipt.hash, status: receipt.status, from: receipt.from, to: receipt.to,
          blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
          logs: Object.freeze(receipt.logs.map(log => Object.freeze({ address: log.address, topics: Object.freeze([...log.topics]), data: log.data,
            ...([log.index, log.transactionHash, log.blockNumber, log.blockHash, log.removed].some(value => value !== undefined) ? {
              // SDK mined logs omit removed; canonical inclusion still requires raw RPC removed=false.
              index: log.index, transactionHash: log.transactionHash, blockNumber: log.blockNumber, blockHash: log.blockHash, removed: log.removed ?? false } : {}) }))) });
      },
      readTransaction: async transactionHash => {
        const transaction = await readProvider.getTransaction(transactionHash);
        return transaction && Object.freeze({ hash: transaction.hash, chainId: transaction.chainId,
          from: transaction.from, to: transaction.to, value: transaction.value, data: transaction.data,
          nonce: transaction.nonce, gasLimit: transaction.gasLimit, gasPrice: transaction.gasPrice, blockNumber: transaction.blockNumber, blockHash: transaction.blockHash });
      },
      readNonce: () => signer.getNonce('pending'),
      readBlockHash: async blockNumber => {
        const block = await readProvider.send('eth_getBlockByNumber', [`0x${blockNumber.toString(16)}`, false]) as
          Record<string, string> | null;
        if (!block || BigInt(block.number) !== BigInt(blockNumber) || !/^0x[0-9a-fA-F]{64}$/.test(block.hash)) return null;
        return block.hash;
      },
      readHead: async () => {
        const head = await readProvider.send('eth_getBlockByNumber', ['latest', false]) as Record<string, string> | null;
        if (!head || !/^0x[0-9a-fA-F]{64}$/.test(head.hash)) throw new Error('Current DEX head is unavailable.');
        return Object.freeze({ number: BigInt(head.number), hash: head.hash, timestamp: BigInt(head.timestamp),
          gasLimit: BigInt(head.gasLimit) });
      }
    };
    const legacy = createCurrentDexSubmissionAdapter({ quoteAdmission: admission, transport });
    const readCapability = createDexV2ReadCapability({ chainId, assertCurrent,
      provider: { request: ({ method, params }) => readProvider.send(method, params ?? []) } });
    const attest = async (head: { number: bigint; hash: string }) => {
      const graph = await readCurrentSharedPoolDexGraph({ capability: readCapability,
        blockNumber: head.number, blockHash: head.hash });
      if (graph.graph !== CURRENT_SHARED_POOL_CANDIDATE.graph ||
          graph.packageSha256 !== CURRENT_SHARED_POOL_CANDIDATE.packageSha256 ||
          graph.core.toLowerCase() !== CURRENT_SHARED_POOL_CANDIDATE.core) {
        throw new Error('Current shared-Pool graph changed.');
      }
      await assertCurrent(); assertSnapshotCurrent();
    };
    let receiptCapability: Awaited<ReturnType<typeof issueCurrentDexReceiptCapability>> | null = null;
    const current = createCurrentSharedPoolSubmissionAdapter({ signer, ownerAddress, chainId, transport, attest,
      readOperation: async (operationId, origin) => readCurrentDexOperation({ capability: readCapability,
        profile: 'shared-pool', operationId,
        expected: { chainId, core: CURRENT_SHARED_POOL_CANDIDATE.core,
          runtimeHash: CURRENT_SHARED_POOL_CANDIDATE.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2],
          releaseId: CURRENT_SHARED_POOL_CANDIDATE.releaseId,
          originBlockNumber: origin?.number, originBlockHash: origin?.hash } }),
      reviewAcceptance: async (issued, confirm) => {
        if (!receiptCapability) receiptCapability = await issueCurrentDexReceiptCapability(args);
        const reader = receiptCapability;
        const readReceipt = async () => {
          const receipt = await reader.read({ operationId: issued.operationId, profile: 'shared-pool',
            expected: { chainId, core: issued.core, runtimeHash: issued.runtimeHash, releaseId: issued.releaseId,
              originBlockNumber: issued.originBlock.number, originBlockHash: issued.originBlock.hash } });
          if (receipt.operation.contextHash !== issued.operation.contextHash ||
              receipt.operation.epochId !== issued.operation.epochId ||
              receipt.operation.canonicalMarketId !== issued.operation.canonicalMarketId ||
              receipt.operation.marketRevision !== issued.operation.marketRevision ||
              receipt.operation.registryRevision !== issued.operation.registryRevision) {
            throw new Error('Current shared-Pool private receipt changed operation.');
          }
          await attest(receipt.block);
          return receipt;
        };
        const inputIsToken0 = issued.intent.inputToken.toLowerCase() === CURRENT_SHARED_POOL_CANDIDATE.tokens[0][0];
        return prepareCurrentDexAcceptance({ intent: issued.intent, now: () => BigInt(Math.floor(Date.now() / 1000)),
          input: { symbol: inputIsToken0 ? 'token0 atoms' : 'token1 atoms', decimals: 0 },
          output: { symbol: inputIsToken0 ? 'token1 atoms' : 'token0 atoms', decimals: 0 },
          readReceipt, confirm });
      } });
    const cheapCandidate = resolveCurrentCheapDexCandidate(candidate);
    const sharedCandidate = candidate === 'cheap-prepared' || candidate === 'cheap-exit' || candidate === 'cheap-history' ? candidate : undefined;
    const attestCandidate = async (head: { number: bigint; hash: string }, key: CurrentCheapDexCandidateKey) => {
      const selected = resolveCurrentCheapDexCandidate(key);
      const graph = await readCurrentSharedPoolDexGraph({ capability: readCapability, candidate: key,
        blockNumber: head.number, blockHash: head.hash });
      if (graph.graph !== selected.graph || graph.packageSha256 !== selected.packageSha256 ||
          graph.core.toLowerCase() !== selected.core) throw new Error('Current-mode graph changed.');
      await assertCurrent(); assertSnapshotCurrent();
    };
    const attestCheap = (head: { number: bigint; hash: string }) => attestCandidate(head, candidate);
    const readCheapReceipt = async (issued: Parameters<Parameters<typeof createCurrentCheapDexSubmissionAdapter>[0]['readReceipt']>[0],
      origin?: {number:bigint;hash:string}, observation?:{number:bigint;hash:string}) => {
      if (!receiptCapability) receiptCapability = await issueCurrentDexReceiptCapability(args);
      const receipt = await receiptCapability.readCurrent({ candidate: cheapCandidate, profile: issued.intent.profile, operationId: issued.operationId,
        expected: { chainId, core: issued.core, runtimeHash: issued.runtimeHash, releaseId: issued.releaseId,
          ...(observation?{blockNumber:observation.number,blockHash:observation.hash}:{}),
          originBlockNumber: origin?.number ?? issued.originBlock.number,
          originBlockHash: origin?.hash ?? issued.originBlock.hash } });
      await attestCheap(receipt.block);
      await assertCurrent(); assertSnapshotCurrent();
      return receipt;
    };
    const token = new Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI);
    const requirePrivateFunding = async (inputToken: string, amount: bigint, head: { number: bigint; hash: string }, key = candidate, exactAllowance = false, allowanceAmount = amount) => {
      await assertCurrent(); assertSnapshotCurrent();
      if (!signer.getUserOnboardInfo()?.aesKey?.trim()) throw new Error('Unlock privacy before checking current-mode funding.');
      const readToken = async (method: 'balanceOf(address)' | 'allowance(address,address)', values: string[]) => {
        const raw = await readProvider.send('eth_call', [{ from: ownerAddress, to: inputToken,
          data: token.encodeFunctionData(method, values) }, { blockHash: head.hash, requireCanonical: true }]);
        await assertCurrent(); assertSnapshotCurrent();
        const decoded = token.decodeFunctionResult(method, raw);
        if (token.encodeFunctionResult(method, decoded).toLowerCase() !== String(raw).toLowerCase()) throw new Error('Private funding encoding changed.');
        const ciphertext = method === 'balanceOf(address)' ? decoded[0] : decoded[0].ownerCiphertext;
        // All-zero is the unset sentinel. Never decrypt the spender ciphertext.
        if (BigInt(ciphertext.ciphertextHigh) === 0n && BigInt(ciphertext.ciphertextLow) === 0n) return 0n;
        return decryptPrivateUint256Output(signer, ciphertext);
      };
      const balance = await readToken('balanceOf(address)', [ownerAddress]);
      const allowance = await readToken('allowance(address,address)', [ownerAddress, resolveCurrentCheapDexCandidate(key).core]);
      await attestCandidate(head, key);
      if (typeof amount !== 'bigint' || amount <= 0n) throw new Error('Current-mode funding amount is invalid.');
      if (balance < amount) throw new Error('Current-mode input balance is insufficient. Check current state, then check current input funds.');
      if (allowance < allowanceAmount) throw new Error('Current-mode Core allowance is insufficient. Check current state, then approve the exact input allowance.');
      if (exactAllowance && allowance !== allowanceAmount) throw new Error('Current-mode allowance must equal the confirmed amount.');
    };
    const cheap = createCurrentCheapDexSubmissionAdapter({ candidate, signer, ownerAddress, chainId, transport, attest: attestCheap,
      authenticateReload: async record => {
        await assertCurrent(); assertSnapshotCurrent();
        const aesKey=signer.getUserOnboardInfo()?.aesKey?.trim();
        if(!aesKey||!crypto.subtle)throw new Error('Unlock owner privacy before saving or restoring the native budget.');
        const key=await crypto.subtle.importKey('raw',Uint8Array.from(getBytes(aesKey.startsWith('0x')?aesKey:`0x${aesKey}`)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
        const bytes=new TextEncoder().encode(`ChainWhisper:b2aa:reload:v1:${chainId}:${ownerAddress.toLowerCase()}:`+JSON.stringify(record));
        const authentication=hexlify(new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes)));
        await assertCurrent();assertSnapshotCurrent();
        if(signer.getUserOnboardInfo()?.aesKey?.trim()!==aesKey)throw new Error('Owner privacy changed while authenticating the native budget.');
        return authentication;
      },
      readOriginalQuoteReceipt: async issued => {
        const current=await issued.readCurrent();await transport.assertCurrent();
        const stages=currentCheapDexStages(cheapCandidate);
        if(current.operation.stage===stages.ready)return readCheapReceipt(current,current.originBlock,current.block);
        const lower=current.originBlock.number,upper=current.block.number;
        if(upper<lower||upper-lower>=4096n)throw new Error('Original Quote receipt is outside the bounded history.');
        const events=new Interface(CURRENT_CHEAP_DEX_QUOTE_ABI),candidates:{hash:string;stage:bigint;number:number}[]=[];
        for(let from=lower;from<=upper;from+=256n){
          const end=from+255n<upper?from+255n:upper;
          const logs=await readProvider.getLogs({address:cheapCandidate.core,fromBlock:from,toBlock:end,topics:[events.getEvent('CheapAsyncAdvanced')!.topicHash,toBeHex(current.operationId,32)]});
          await transport.assertCurrent();if(logs.length>64)throw new Error('Original Quote event bound exceeded.');
          for(const log of logs){const e=events.parseLog({topics:[...log.topics],data:log.data});
            if(!e||log.removed||log.address.toLowerCase()!==cheapCandidate.core||e.args.quoteId!==current.operationId||BigInt(log.blockNumber)<from||BigInt(log.blockNumber)>end)throw new Error('Original Quote event identity changed.');
            if(e.args.stage===BigInt(stages.ready)||e.args.stage===BigInt(stages.funded))candidates.push({hash:log.transactionHash,stage:e.args.stage,number:log.blockNumber});
          }
        }
        if(candidates.length>2)throw new Error('Original Quote history is ambiguous.');
        for(const item of candidates.sort((a,b)=>b.number-a.number)){
          const tx=await transport.readTransaction(item.hash),receipt=await transport.waitForReceipt(item.hash);await transport.assertCurrent();
          if(!tx||!receipt||receipt.status!==1||receipt.blockNumber!==item.number||tx.to?.toLowerCase()!==cheapCandidate.core||tx.chainId!==chainId||tx.value!==0n)throw new Error('Original Quote history is unavailable.');
          await transport.verifyCanonicalInclusion!(tx,receipt);
          const calls=new Interface(['function advanceFixedWork(uint256 operationId)','function acceptPrivateSwapV1(uint256 operationId,bytes32 expectedContext)']);
          const call=calls.parseTransaction({data:tx.data});
          if(!call||call.args[0]!==current.operationId||calls.encodeFunctionData(call.fragment,call.args).toLowerCase()!==tx.data.toLowerCase()||
             (item.stage===BigInt(stages.funded)?call.name!=='acceptPrivateSwapV1'||tx.from.toLowerCase()!==ownerAddress.toLowerCase()||call.args[1]!==current.operation.contextHash:call.name!=='advanceFixedWork'))throw new Error('Original Quote history call changed.');
          const matching=receipt.logs?.filter(log=>{try{const e=events.parseLog({topics:[...log.topics],data:log.data});return log.address.toLowerCase()===cheapCandidate.core&&e?.args.quoteId===current.operationId&&e.args.stage===item.stage&&e.args.context===current.operation.contextHash;}catch{return false;}});
          if(matching?.length!==1)throw new Error('Original Quote history event changed.');
          const observation={number:BigInt(receipt.blockNumber!),hash:receipt.blockHash!};
          const state=await readCurrentDexOperation({capability:readCapability,candidate:cheapCandidate,profile:'cheap-async',operationId:current.operationId,
            expected:{chainId,core:current.core,runtimeHash:current.runtimeHash,releaseId:current.releaseId,blockNumber:observation.number,blockHash:observation.hash,originBlockNumber:lower,originBlockHash:current.originBlock.hash}});
          if(state.operation.stage!==stages.ready&&state.operation.stage!==stages.funded)continue; // A later transaction in the same block can replace the receipt.
          const result=await readCheapReceipt(current,current.originBlock,observation);
          await transport.verifyCanonicalInclusion!(tx,receipt);return result;
        }
        throw new Error('Canonical READY or funded Quote receipt is unavailable.');
      },
      readOperation: (profile, operationId, origin) => readCurrentDexOperation({ capability: readCapability, candidate: cheapCandidate, profile, operationId,
        expected: { chainId, core: cheapCandidate.core, runtimeHash: cheapCandidate.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2],
          releaseId: cheapCandidate.releaseId, originBlockNumber: origin?.number, originBlockHash: origin?.hash } }),
      readReceipt: readCheapReceipt,
      ...(candidate === 'cheap-exit' || candidate === 'cheap-history' ? {
        verifyOwnerTokens: async ({ issued, amounts, phase, receipt, contextHash }) => {
          await transport.assertCurrent();
          if (!signer.getUserOnboardInfo()?.aesKey?.trim()) throw new Error('Unlock privacy before checking owner token delivery.');
          const i = issued.intent;
          const calls = new Interface(['function acceptFastPool(uint256 quoteId,bytes32 expectedContext)',
            'function acceptPrivateSwapV1(uint256 operationId,bytes32 expectedContext)',
            'function advanceFixedWork(uint256 operationId)', 'function cancelSwap(uint256 operationId)', 'function recoverSwap(uint256 operationId)']);
          const expectedMethod = phase === 'accept' ? 'acceptPrivateSwapV1' : phase === 'fast-settle' ? 'acceptFastPool' :
            phase === 'terminal' ? 'advanceFixedWork' : phase === 'cancel' ? 'cancelSwap' : 'recoverSwap';
          // Capture the issued owner/operation before any RPC or decryption await.
          const binding = Object.freeze({ graph: cheapCandidate.graph, packageSha256: cheapCandidate.packageSha256,
            chainId, core: cheapCandidate.core, owner: ownerAddress, destination: i.destination,
            inputToken: i.inputToken, outputToken: i.outputToken, operationId: issued.operationId,
            contextHash, transactionHash: receipt.hash, blockNumber: receipt.blockNumber!, blockHash: receipt.blockHash! });
          const events = new Interface(CURRENT_CHEAP_DEX_QUOTE_ABI), stages = currentCheapDexStages(cheapCandidate);
          const expectedStage = phase === 'accept' ? stages.funded : phase === 'terminal' ? stages.settled : stages.released;
          await verifyCurrentDexOwnerTokenMovements({ binding, amounts, phase,
            receipt: receipt as CurrentDexOwnerTokenReceipt,
            assertCurrent: transport.assertCurrent,
            decrypt: cipher => decryptPrivateUint256Output(signer, cipher),
            verifyCanonical: async (bound, copiedReceipt) => {
              const tx = await transport.readTransaction(bound.transactionHash);
              await transport.assertCurrent();
              if (!tx || tx.chainId !== bound.chainId || tx.to?.toLowerCase() !== bound.core.toLowerCase() || tx.value !== 0n ||
                  tx.blockNumber !== bound.blockNumber || tx.blockHash?.toLowerCase() !== bound.blockHash.toLowerCase()) {
                throw new Error('Owner token transaction identity changed.');
              }
              const decoded = calls.decodeFunctionData(expectedMethod, tx.data);
              if (calls.encodeFunctionData(expectedMethod, decoded).toLowerCase() !== tx.data.toLowerCase() ||
                  decoded[0] !== bound.operationId || ((phase === 'accept' || phase === 'fast-settle') &&
                    (decoded[1].toLowerCase() !== bound.contextHash.toLowerCase() || tx.from.toLowerCase() !== bound.owner.toLowerCase() ||
                     tx.gasLimit !== CURRENT_EXIT_SWAP_GAS_CAPS[phase === 'accept' ? 'cheap-async' : 'fast-pool'].accept))) {
                throw new Error('Owner token transaction call changed.');
              }
              if (phase !== 'fast-settle') {
                const topic = events.getEvent('CheapAsyncAdvanced')!.topicHash;
                const matches = copiedReceipt.logs.filter(log => log.address.toLowerCase() === bound.core.toLowerCase() &&
                  log.topics[0]?.toLowerCase() === topic.toLowerCase());
                if (matches.length !== 1) throw new Error('Owner token operation event changed.');
                const event = events.parseLog({ topics: [...matches[0].topics], data: matches[0].data });
                if (!event) throw new Error('Owner token operation event is missing.');
                const encoded = events.encodeEventLog(event.fragment, event.args);
                if (event.args.quoteId !== bound.operationId || event.args.stage !== BigInt(expectedStage) ||
                    event.args.context.toLowerCase() !== bound.contextHash.toLowerCase() ||
                    encoded.data.toLowerCase() !== matches[0].data.toLowerCase() ||
                    encoded.topics.length !== matches[0].topics.length || encoded.topics.some((t, n) => t.toLowerCase() !== matches[0].topics[n].toLowerCase())) {
                  throw new Error('Owner token operation event changed.');
                }
              }
              // Check the raw RPC receipt body and every supplied log origin.
              await transport.verifyCanonicalInclusion!(tx, { ...copiedReceipt, from: tx.from, to: tx.to });
              await attestCheap(await transport.readHead());
              await transport.assertCurrent();
            } });
        },
        readTerminalReceipt: async (issued, upperBlock) => {
          const lowerBlock = issued.originBlock.number;
          // Finite read domain; a longer gap requires explicit reconciliation.
          if (lowerBlock < 0n || upperBlock < lowerBlock || upperBlock - lowerBlock >= 4096n) {
            throw new Error('Terminal receipt is outside the bounded 4096-block lookup.');
          }
          const events = new Interface(CURRENT_CHEAP_DEX_QUOTE_ABI), stages = currentCheapDexStages(cheapCandidate);
          const topic = events.getEvent('CheapAsyncAdvanced')!.topicHash, matches: string[] = [];
          for (let fromBlock = lowerBlock; fromBlock <= upperBlock; fromBlock += 256n) {
            await transport.assertCurrent();
            const logs = await readProvider.getLogs({ address: cheapCandidate.core, fromBlock,
              toBlock: fromBlock + 255n < upperBlock ? fromBlock + 255n : upperBlock,
              topics: [topic, toBeHex(issued.operationId, 32)] });
            await transport.assertCurrent();
            if (logs.length > 64) throw new Error('Terminal operation log bound exceeded.');
            for (const log of logs) {
              const event = events.parseLog({ topics: [...log.topics], data: log.data });
              if (!event || log.removed || log.address.toLowerCase() !== cheapCandidate.core.toLowerCase() ||
                  event.args.quoteId !== issued.operationId || BigInt(log.blockNumber) < fromBlock || BigInt(log.blockNumber) > upperBlock) {
                throw new Error('Terminal operation lookup changed.');
              }
              if (event.args.stage === BigInt(stages.settled) || event.args.stage === BigInt(stages.released)) matches.push(log.transactionHash);
            }
          }
          if (matches.length !== 1) throw new Error('Exact terminal transaction is unavailable.');
          const receipt = await transport.waitForReceipt(matches[0]), tx = await transport.readTransaction(matches[0]);
          await transport.assertCurrent();
          if (!receipt || !tx) throw new Error('Terminal transaction is unavailable.');
          const calls = new Interface(['function advanceFixedWork(uint256 operationId)', 'function recoverSwap(uint256 operationId)', 'function cancelSwap(uint256 operationId)']);
          const call = calls.parseTransaction({ data: tx.data });
          if (!call || call.args[0] !== issued.operationId) throw new Error('Terminal transaction call changed.');
          const phase = call.name === 'advanceFixedWork' ? 'terminal' as const : call.name === 'recoverSwap' ? 'recover' as const : 'cancel' as const;
          return { receipt, phase };
        }
      } : {}),
      requireFunding: (prepared, head, beforeApproval) => requirePrivateFunding(prepared.intent.inputToken, prepared.intent.maximumInput, head, candidate, candidate === 'cheap-exit' || candidate === 'cheap-history', beforeApproval ? 0n : prepared.intent.maximumInput),
      reviewAcceptance: async (issued, confirm) => {
        const selectedKey = currentCheapDexCandidateKey(cheapCandidate), identity = issued.intent.candidate;
        const shared = sharedCandidate !== undefined;
        if ((shared && !identity) || (identity && currentCheapDexCandidateKey(identity) !== selectedKey)) {
          throw new Error('Acceptance review differs from the selected DEX candidate.');
        }
        const inputAddress = issued.intent.inputToken.toLowerCase(), outputAddress = issued.intent.outputToken.toLowerCase();
        const selectedPair = shared ? currentDexDisplayPair(cheapCandidate, inputAddress, outputAddress) : undefined;
        const historicalToken = (address: string) => {
          const index = cheapCandidate.tokens.findIndex(([token]) => token === address);
          if (index < 0 || index > 1 || inputAddress === outputAddress) throw new Error('Acceptance review pair is outside the selected DEX candidate.');
          return { symbol: `Test token ${index}`, decimals: 18 };
        };
        const input = selectedPair ? { symbol: selectedPair.tokenIn.label, decimals: selectedPair.tokenIn.decimals } : historicalToken(inputAddress);
        const output = selectedPair ? { symbol: selectedPair.tokenOut.label, decimals: selectedPair.tokenOut.decimals } : historicalToken(outputAddress);
        for (const token of [input, output]) {
          if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255 || !token.symbol.trim()) {
            throw new Error('Invalid acceptance review token metadata.');
          }
        }
        return prepareCurrentDexAcceptance({ intent: issued.intent, now: () => BigInt(Math.floor(Date.now() / 1000)),
          input, output,
          readReceipt: () => readCheapReceipt(issued), confirm });
      } });
    const poolTokens = [...cheapCandidate.tokens].sort((a, b) => BigInt(a[0]) < BigInt(b[0]) ? -1 : 1);
    const pool = createCurrentPoolSubmissionAdapter({ candidate, nativePoolProfile, signer, ownerAddress, chainId, transport, attest: attestCheap,
      requireFunding: async (prepared, head) => {
        const selected = sharedCandidate ? resolvePreparedDexScope(sharedCandidate).candidate.pairs.find(pair => pair.marketId === prepared.intent.marketId &&
          prepared.intent.poolTokens.length === 2 && pair.tokens.every((token, index) => token === prepared.intent.poolTokens[index])) : null;
        if (sharedCandidate && !selected) throw new Error('Pool funding pair differs from its prepared market.');
        const tokens = selected?.tokens ?? [poolTokens[0][0], poolTokens[1][0]];
        await requirePrivateFunding(tokens[0], prepared.amounts.used0, head, candidate, nativePoolProfile !== undefined || !!selected);
        await requirePrivateFunding(tokens[1], prepared.amounts.used1, head, candidate, nativePoolProfile !== undefined || !!selected);
      } });
    const positions = createCurrentPoolPositionSubmissionAdapter({ candidate, nativePoolProfile, signer, ownerAddress, chainId, transport, attest: attestCheap });
    const limit = createCurrentLimitSubmissionAdapter({ candidate, signer, ownerAddress, chainId, transport, attest: attestCheap,
      requireFunding: (prepared,head) => {
        const scope=resolveCurrentLimitScope(candidate,prepared.poolTokens);
        if(scope.prepared&&prepared.marketId!==scope.marketId)throw new Error('Limit funding market changed.');
        return requirePrivateFunding(scope.poolTokens[prepared.intent.sellToken0 ? 0 : 1],prepared.intent.amount,head,candidate,scope.prepared);
      } });
    const assertFundingResources = async () => {
        await assertCurrent(); assertSnapshotCurrent();
        if (!signer.getUserOnboardInfo()?.aesKey?.trim()) throw new Error('Unlock privacy before current-token funding.');
        const [latest, pending, gasRaw, balanceRaw] = await Promise.all([signer.getNonce('latest'), signer.getNonce('pending'),
          readProvider.send('eth_gasPrice', []), readProvider.send('eth_getBalance', [ownerAddress, 'latest'])]);
        await assertCurrent(); assertSnapshotCurrent();
        const gasPrice = BigInt(gasRaw), balance = BigInt(balanceRaw);
        if (latest !== pending || !Number.isSafeInteger(latest) || latest < 0) throw new Error('Current-token wallet nonce is pending or changed.');
        if (gasPrice <= 0n || gasPrice > 50_000_000n || balance < CURRENT_TOKEN_FUNDING_CAP * gasPrice + 10n ** 16n) throw new Error('Current-token gas price or recovery reserve is insufficient.');
      };
    const createHistoricalFunding = () => createCurrentTokenFundingAdapter({ signer, ownerAddress, chainId, transport, candidate, attest: attestCheap,
      encrypt: (amount, tokenAddress, selector) => encryptPrivateUint256Input(signer, amount, tokenAddress, selector),
      decrypt: cipher => decryptPrivateUint256Output(signer, cipher), assertResources: assertFundingResources,
      readState: async (index, head) => {
        await assertCurrent(); assertSnapshotCurrent();
        if (!signer.getUserOnboardInfo()?.aesKey?.trim()) throw new Error('Unlock privacy before checking private current-token funds.');
        const tokenAddress = cheapCandidate.tokens[index][0];
        const read = async (method: string, values: unknown[] = []) => {
          const raw = await readProvider.send('eth_call', [{ from: ownerAddress, to: tokenAddress,
            data: currentTokenFundingAbi.encodeFunctionData(method, values) }, { blockHash: head.hash, requireCanonical: true }]);
          await assertCurrent(); assertSnapshotCurrent();
          const valuesOut = currentTokenFundingAbi.decodeFunctionResult(method, raw);
          if (currentTokenFundingAbi.encodeFunctionResult(method, valuesOut).toLowerCase() !== String(raw).toLowerCase()) throw new Error('Current-token output encoding changed.');
          return valuesOut[0];
        };
        const [balanceCt, allowanceCt, claimed, faucetAmount, decimals, publicAmounts, encryptionAddress] = await Promise.all([
          read('balanceOf', [ownerAddress]), read('allowance', [ownerAddress, cheapCandidate.core]), read('faucetClaimed', [ownerAddress]),
          read('faucetAmount'), read('decimals'), read('publicAmountsEnabled'), read('accountEncryptionAddress', [ownerAddress])]);
        const amount = (cipher: Parameters<typeof decryptPrivateUint256Output>[1]) => BigInt(cipher.ciphertextHigh) === 0n && BigInt(cipher.ciphertextLow) === 0n ? 0n : decryptPrivateUint256Output(signer, cipher);
        const observed = Object.freeze({ tokenIndex: index, token: tokenAddress, owner: ownerAddress, block: head,
          balance: amount(balanceCt), allowance: amount(allowanceCt.ownerCiphertext), claimed: Boolean(claimed),
          faucetAmount: BigInt(faucetAmount), decimals: BigInt(decimals), publicAmounts: Boolean(publicAmounts), encryptionAddress: String(encryptionAddress) });
        await attestCheap(head); await assertCurrent(); assertSnapshotCurrent(); return observed;
      } });
    // Historical token runtime checks belong to the historical funding path.
    // A selected six-market sender must not construct that unrelated adapter.
    type HistoricalFunding=ReturnType<typeof createHistoricalFunding>;
    let historicalFunding:HistoricalFunding|undefined;
    const getHistoricalFunding=()=>historicalFunding??=createHistoricalFunding();
    const funding:HistoricalFunding=Object.freeze({
      readCurrentNativePoolResume:async(...args:Parameters<HistoricalFunding['readCurrentNativePoolResume']>)=>getHistoricalFunding().readCurrentNativePoolResume(...args),
      abandonCurrentNativePoolFunding:async(...args:Parameters<HistoricalFunding['abandonCurrentNativePoolFunding']>)=>getHistoricalFunding().abandonCurrentNativePoolFunding(...args),
      preparePoolApproval:async(...args:Parameters<HistoricalFunding['preparePoolApproval']>)=>getHistoricalFunding().preparePoolApproval(...args),
      preparePoolUnfundedCleanup:async(...args:Parameters<HistoricalFunding['preparePoolUnfundedCleanup']>)=>getHistoricalFunding().preparePoolUnfundedCleanup(...args),
      readCurrentTokenFunding:async(...args:Parameters<HistoricalFunding['readCurrentTokenFunding']>)=>getHistoricalFunding().readCurrentTokenFunding(...args),
      prepareCurrentTokenFunding:async(...args:Parameters<HistoricalFunding['prepareCurrentTokenFunding']>)=>getHistoricalFunding().prepareCurrentTokenFunding(...args),
      submitCurrentTokenFunding:async(...args:Parameters<HistoricalFunding['submitCurrentTokenFunding']>)=>getHistoricalFunding().submitCurrentTokenFunding(...args),
      recoverCurrentNativePoolTokenResult:async(...args:Parameters<HistoricalFunding['recoverCurrentNativePoolTokenResult']>)=>getHistoricalFunding().recoverCurrentNativePoolTokenResult(...args),
      recoverPendingCurrentTokenFunding:async(...args:Parameters<HistoricalFunding['recoverPendingCurrentTokenFunding']>)=>getHistoricalFunding().recoverPendingCurrentTokenFunding(...args),
    });
    const refill = createCurrentTokenRefillSubmissionAdapter({ signer, ownerAddress, chainId, transport, candidate,
      binding: CURRENT_NATIVE_TOKEN_REFILL_BINDING, assertRefillAdmission: binding => assertCurrentNativeTokenRefillBinding(candidate, binding),
      attest: attestCheap, assertResources: assertFundingResources,
      readState: (index, head) => funding.readCurrentTokenFunding(index, head),
      decrypt: cipher => decryptPrivateUint256Output(signer, cipher),
      rpc: async (method, params) => {
        await assertCurrent(); assertSnapshotCurrent();
        const value = await readProvider.send(method, params);
        await assertCurrent(); assertSnapshotCurrent(); return value;
      },
      readReceiptBlock: async number => {
        await assertCurrent(); assertSnapshotCurrent();
        const block = await readProvider.send('eth_getBlockByNumber', [`0x${number.toString(16)}`, false]) as Record<string, string> | null;
        await assertCurrent(); assertSnapshotCurrent();
        if (!block || BigInt(block.number) !== BigInt(number) || !/^0x[0-9a-fA-F]{64}$/.test(block.hash)) throw new Error('Refill receipt block is unavailable.');
        return Object.freeze({ number: BigInt(block.number), hash: block.hash, timestamp: BigInt(block.timestamp), gasLimit: BigInt(block.gasLimit) });
      } });
    const sharedFunding = createCurrentSharedDexTokenFundingAdapter({ candidate: sharedCandidate, signer, ownerAddress, chainId, transport,
      assertAdmission: (action,token) => assertCurrentSharedTokenFundingAppAuthority({candidate,owner:ownerAddress,token,action}),
      authorizeInitialClaimSigning: candidate === 'cheap-exit' ? cheap.authorizeCurrentCheapInitialClaim : undefined,
      assertSwapApprovalAdmission: (review, preparedQuote) => {
        if (!preparedQuote) throw new Error('Original branded swap approval scope is absent.');
        assertCurrentCheapDexPreparedQuote(preparedQuote,signer);assertCurrentNativeSwapIntent(preparedQuote,BigInt(Math.floor(Date.now()/1000)));
        if(review.owner.toLowerCase()!==ownerAddress.toLowerCase()||review.graph!==cheapCandidate.graph||review.packageSha256!==cheapCandidate.packageSha256||review.core.toLowerCase()!==cheapCandidate.core||review.spender.toLowerCase()!==cheapCandidate.core||review.token.toLowerCase()!==preparedQuote.intent.inputToken.toLowerCase()||review.amount!==preparedQuote.intent.maximumInput)throw new Error('Exact swap approval differs from the branded Quote.');
      },
      authorizeSwapApprovalSigning: cheap.authorizeCurrentCheapSwapApproval,
      rememberSwapApprovalHash: cheap.rememberCurrentCheapSwapApproval,
      encrypt: (amount, token, selector) => encryptPrivateUint256Input(signer, amount, token, selector),
      decrypt: cipher => decryptPrivateUint256Output(signer, cipher),
      readFunds: async head => {
        await assertCurrent(); assertSnapshotCurrent();
        const capturedKey = args.sessionOnboardInfo?.[ownerAddress.toLowerCase()]?.aesKey?.trim();
        const guard = async () => {
          await assertCurrent(); assertSnapshotCurrent();
          if (!capturedKey || signer.getUserOnboardInfo()?.aesKey?.trim() !== capturedKey) throw new Error('Unlock the selected owner privacy before checking beta funds.');
        };
        await guard();
        return readCurrentSharedDexTokenFunds({ candidate: sharedCandidate, owner: ownerAddress, head, assertCurrent: guard,
          rpc: async (method, params) => { await guard(); const value = await readProvider.send(method, params); await guard(); return value; },
          decrypt: cipher => decryptPrivateUint256Output(signer, cipher) });
      },
      readReceiptBlock: async number => {
        await assertCurrent(); assertSnapshotCurrent();
        const block = await readProvider.send('eth_getBlockByNumber', [`0x${number.toString(16)}`, false]) as Record<string, string> | null;
        await assertCurrent(); assertSnapshotCurrent();
        if (!block || BigInt(block.number) !== BigInt(number) || !/^0x[0-9a-fA-F]{64}$/.test(block.hash)) throw new Error('Beta funding receipt block is unavailable.');
        return Object.freeze({ number: BigInt(block.number), hash: block.hash, timestamp: BigInt(block.timestamp), gasLimit: BigInt(block.gasLimit) });
      } });
    return Object.freeze({ ...legacy, ...current, ...cheap, ...pool, ...positions, ...limit, ...funding, ...refill, ...sharedFunding,
      readCurrentDexActivityPage: async ({ cursor, head: savedHead, onProgress }: { cursor: CurrentDexActivityCursor;
        head?: { number: bigint; hash: string }; onProgress?: (checked: number, total: number) => void }) => {
        if (candidate !== 'cheap-exit' && candidate !== 'cheap-history') throw new Error('History requires a supported DEX deployment.');
        const key = signer.getUserOnboardInfo()?.aesKey?.trim();
        const guard = async () => { await transport.assertCurrent();
          if (!key || signer.getUserOnboardInfo()?.aesKey?.trim() !== key) throw new Error('History owner privacy changed.'); };
        await guard(); const latest = await transport.readHead(); await attestCheap(latest);
        const head = savedHead ?? { number: latest.number, hash: latest.hash };
        if (head.number > latest.number || await transport.readBlockHash(Number(head.number)) !== head.hash) throw new Error('History chain head changed. Refresh history.');
        const page = await readCurrentDexActivityDiscoveryPage({ owner: ownerAddress, candidate, headNumber: head.number, cursor, assertCurrent: guard });
        const rows: CurrentDexActivityRow[] = [], unavailable: string[] = [], seen = new Set<string>();
        const read = async (hash: string, ownerOperation?: CurrentDexActivityRow) => {
          if (seen.has(hash.toLowerCase())) return; seen.add(hash.toLowerCase());
          try {
            await guard();
            const [transaction,receipt] = await Promise.all([transport.readTransaction(hash),transport.waitForReceipt(hash)]);
            await guard();
            if(!transaction||!receipt||receipt.blockNumber===undefined||BigInt(receipt.blockNumber)>head.number)throw new Error('History receipt is unavailable.');
            const block = await readProvider.send('eth_getBlockByNumber',[toBeHex(receipt.blockNumber),false]);
            if (!block || BigInt(block.number) !== BigInt(receipt.blockNumber) || block.hash?.toLowerCase() !== receipt.blockHash?.toLowerCase() || !/^0x[0-9a-f]+$/i.test(block.timestamp)) throw new Error('History receipt time changed.');
            const row = await readCurrentDexActivityReceipt({ candidate,owner:ownerAddress,transaction,receipt,timestamp:BigInt(block.timestamp),ownerOperation,
              assertCurrent:guard,verifyCanonical:()=>transport.verifyCanonicalInclusion!(transaction,receipt),decrypt:value=>decryptPrivateUint256Output(signer,value) });
            if(row)rows.push(row);
          } catch { await guard(); unavailable.push(hash); }
        };
        const hashes = [...new Set([...currentDexAsyncTerminalResumeHashes(cursor.asyncTerminals, head.number), ...page.hashes])];
        for(let i=0;i<hashes.length;i+=2){await Promise.all(hashes.slice(i,i+2).map(hash=>read(hash)));await guard();onProgress?.(Math.min(i+2,hashes.length),hashes.length);}
        // Public terminal events add keeper delivery to the owner's Quote history.
        const terminals = await readCurrentDexAsyncTerminalPage({ candidate, headNumber: head.number,
          quotes: rows.filter(row => row.kind === 'async-quote' && row.operationId !== undefined),
          cursor: cursor.asyncTerminals, readLogs: filter => readProvider.getLogs(filter), assertCurrent: guard });
        for (const terminal of terminals.terminals) await read(terminal.hash, terminal.quote);
        const fills: CurrentDexLimitFill[] = [], fillCursors: Record<string, bigint | null> = {};
        const limitFillsState = CURRENT_LIMIT_FILL_HISTORY_GRAPHS.includes(cheapCandidate.graph) ? 'available' as const : 'not-recorded' as const;
        const unresolvedQuotes=rows.filter(row=>['async-quote','fast-quote'].includes(row.kind)&&row.status!=='Failed'&&row.operationId!==undefined&&
          !rows.some(other=>other.core===row.core&&other.operationId===row.operationId&&other.status!=='Failed'&&['fast-delivery','async-delivery','cancel','recover'].includes(other.kind)));
        let headTimestamp: bigint | undefined;
        if (unresolvedQuotes.length || limitFillsState === 'available') {
          await guard();
          const block = await readProvider.send('eth_getBlockByNumber', [toBeHex(head.number), false]);
          await guard();
          if (!block || BigInt(block.number) !== head.number || block.hash?.toLowerCase() !== head.hash.toLowerCase() ||
              !/^0x[0-9a-f]+$/i.test(block.timestamp)) throw new Error('History chain head changed. Refresh history.');
          headTimestamp=BigInt(block.timestamp);
        }
        for(const row of unresolvedQuotes){
          let currentStatus='Quote status unavailable';
          try{
            await guard();const profile=row.kind==='fast-quote'?'fast-pool':'cheap-async';
            const raw=await readProvider.send('eth_call',[{to:cheapCandidate.core,data:encodeCurrentCheapDexOperationRead(row.operationId!,profile)},toBeHex(head.number)]);
            await guard();const operation=decodeCurrentCheapDexOperation(raw,headTimestamp!,profile,cheapCandidate);
            currentStatus=({'not-found':'Quote status unavailable','preparing-quote':'Preparing Quote','quote-prepared':'Quote ready',
              settling:'Funded; awaiting delivery',settled:'Confirmed; private result pending',released:'Release confirmed; amounts unavailable',
              'expired-unrecovered':'Expired','consumed-unverified':'Quote unavailable; settlement unverified'} as const)[operation.phase];
            if(operation.phase==='expired-unrecovered'&&operation.stage===currentCheapDexStages(cheapCandidate).funded)currentStatus='Expired; recovery required';
          }catch{await guard();}
          rows[rows.indexOf(row)]=Object.freeze({...row,currentStatus});
        }
        if (limitFillsState === 'available') {
          const fillHead = { ...head, timestamp: headTimestamp! };
          for (const pair of resolvePreparedDexScope(candidate).candidate.pairs) {
            const engine = pair.engine.toLowerCase(), before = cursor.limitFills?.[engine];
            if (before === null) { fillCursors[engine] = null; continue; }
            const fillPage = await readCurrentLimitFillHistoryPage({ graph: cheapCandidate.graph, owner: ownerAddress,
              engine, poolTokens: pair.tokens, head: fillHead, before, assertCurrent: guard, attest: attestCheap,
              rpc: async (method, params) => { await guard(); const value = await readProvider.send(method, params); await guard(); return value; },
              decrypt: cipher => decryptPrivateUint256Output(signer, cipher),
              decryptBool: cipher => decryptPrivateBoolOutput(signer, cipher) });
            fills.push(...fillPage.fills); fillCursors[engine] = fillPage.complete ? null : fillPage.nextBefore;
          }
        }
        await guard();if(await transport.readBlockHash(Number(head.number))!==head.hash)throw new Error('History chain head changed. Refresh history.');
        return Object.freeze({head:Object.freeze(head),rows:Object.freeze(rows.sort((a,b)=>b.blockNumber-a.blockNumber||a.hash.localeCompare(b.hash))),
          fills:Object.freeze(fills),limitFillsState,unavailable:Object.freeze(unavailable),
          nextCursor: Object.freeze({ ...page.nextCursor, asyncTerminals: terminals.nextCursor,
            ...(limitFillsState === 'available' ? { limitFills: Object.freeze(fillCursors) } : {}) }),
          complete:page.complete && terminals.complete && Object.values(fillCursors).every(value=>value===null),readyToSign:false as const,nativeAdmission:false as const});
      },
      recoverPendingCurrentCheapAttempt: async (transactionHash?: string) => {
        const pending = readCurrentDexPendingAttempt(currentDexPendingStorage());
        if (!pending || pending.graph === `0x${cheapCandidate.graph}` && pending.core === cheapCandidate.core) return cheap.recoverPendingCurrentCheapAttempt(transactionHash);
        const savedKey = (['cheap-archived', 'cheap-current', 'cheap-slippage', 'cheap-two-pool', 'cheap-reference', 'cheap-native', 'cheap-d06', 'cheap-prepared', 'cheap-exit'] as const).find(key => {
          const c = resolveCurrentCheapDexCandidate(key); return pending.graph === `0x${c.graph}` && pending.core === c.core;
        });
        if (!savedKey) throw new Error('Pending DEX attempt belongs to an unknown candidate.');
        const old = resolveCurrentCheapDexCandidate(savedKey);
        const recover = createArchivedCheapDexRecovery({ candidate: savedKey, signer, ownerAddress, chainId, transport,
          attest: async head => {
            const graph = await readCurrentSharedPoolDexGraph({ capability: readCapability, candidate: savedKey, blockNumber: head.number, blockHash: head.hash });
            if (graph.graph !== old.graph || graph.packageSha256 !== old.packageSha256 || graph.core.toLowerCase() !== old.core) throw new Error('Archived DEX graph changed.');
            await assertCurrent(); assertSnapshotCurrent();
          },
          readOperation: (profile, operationId, origin) => readCurrentDexOperation({ capability: readCapability, candidate: old, profile, operationId,
            expected: { chainId, core: old.core, runtimeHash: old.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2],
              releaseId: old.releaseId, originBlockNumber: origin?.number, originBlockHash: origin?.hash } }) });
        return recover(transactionHash);
      },
      waitForCurrentCheapReceipt: async (transactionHash: string) => {
        await assertCurrent(); assertSnapshotCurrent();
        if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash) || BigInt(transactionHash) === 0n) throw new Error('Invalid DEX transaction hash.');
        let receipt;
        try { receipt = await readProvider.waitForTransaction(transactionHash, 1, 60_000); }
        catch (cause) {
          if (!cause || typeof cause !== 'object' || !('code' in cause) || cause.code !== 'TIMEOUT') throw cause;
          receipt = null;
        }
        await assertCurrent(); assertSnapshotCurrent();
        return receipt !== null;
      }
    });
  }
});
