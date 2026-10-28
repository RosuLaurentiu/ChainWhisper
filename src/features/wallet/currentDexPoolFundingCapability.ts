import { CurrentPoolProofMismatch } from '../../lib/currentDexPoolProofError';
import { AbiCoder, Interface, getAddress, keccak256 } from '@coti-io/coti-ethers';
import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../lib/dexV2Deployment';
import { createDexV2ReadCapability, readCurrentSharedPoolDexGraph, readPreparedDexMarketRegistry } from '../../lib/dexV2Chain';
import { CURRENT_POOL_FUNDING_ABI, PREPARED_POOL_FUNDING_ABI, checkCurrentPoolFundingValues, decodeCurrentPoolFundingEvent, decodeCurrentPoolClaimMint,
  encodeCurrentPoolCreation, encodeCurrentPoolFundingPreview, encodePreparedPoolCreation, encodePreparedPoolFundingPreview, encodePreparedPoolTopUp, type PoolFundingInput } from '../../lib/currentDexPoolFunding';
import { decryptPrivateUint256Output, encryptPrivateUint128Input, encryptPrivateUint256Input, resignPrivateInput } from '../../lib/privateUint256';
import { issueOwnerCotiMetaMaskCapability, type IssueOwnerCotiMetaMaskCapabilityArgs } from './ownerCotiMetaMaskCapability';
import { STAGED_NATIVE_DEX_CANDIDATE } from '../../lib/dexV2Deployment';
import { resolvePreparedDexScope } from '../../lib/currentDexPreparedScope';
import { createCurrentOwnerPoolSnapshotReader } from '../../lib/currentDexNativePoolSnapshotReader';
import { currentNativePoolSession } from '../../lib/currentDexNativePoolPolicy';
import { requireCurrentPoolProof, checkCurrentPoolFinancialTransition, checkCurrentPoolUnfundedCleanupState } from '../../lib/currentDexNativePoolSnapshot';
import { createPreparedOwnerPoolSnapshotReader, checkPreparedPoolFinancialTransition } from '../../lib/currentDexPreparedPoolSnapshot';
import { checkPreparedPoolManagementTransition, checkPreparedPoolManagementSnapshot } from '../../lib/currentDexPreparedPoolManagement';
import { currentPoolPositionAbi } from '../../lib/currentDexPoolPosition';

type IssueArgs = Omit<IssueOwnerCotiMetaMaskCapabilityArgs<unknown>, 'bindCapability' | 'capabilityLabel' | 'requirePrivacy'> & Readonly<{ candidate?: CurrentCheapDexCandidateKey }>;
// Budgets and terms use canonical Pool A/B order, not swap input/output order.
type Intent = Readonly<{ classId: bigint; budgets: readonly [bigint, bigint];
  terms: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] }>;
const abi = new Interface(CURRENT_POOL_FUNDING_ABI);
const preparedAbi = new Interface(PREPARED_POOL_FUNDING_ABI);
const transfer = new Interface(['event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
const preparedSessions = new WeakMap<object, object>();
export const assertCurrentPoolFundingPrepared = (value: unknown, signer: object) => {
  if (!value || typeof value !== 'object' || preparedSessions.get(value) !== signer) throw new Error('Pool request was not prepared in this owner wallet session.');
};
const uint = (value: bigint, bits: number, positive = false) => {
  if (typeof value !== 'bigint' || value < (positive ? 1n : 0n) || value >= 1n << BigInt(bits)) throw new Error('Invalid Pool funding value.');
};
const same = (a: string | null, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();

// Preparation and authenticated private reads only. The existing submission
// capability must still admit, nonce-bind and reconcile each transaction.
export const issueCurrentDexPoolFundingCapability = ({candidate: candidateKey = 'cheap-current', ...args}: IssueArgs) => issueOwnerCotiMetaMaskCapability({
  ...args, capabilityLabel: 'current Pool funding preparation', requirePrivacy: true,
  bindCapability: async ({ assertCurrent, assertSnapshotCurrent, readProvider, signer, chainId, ownerAddress }) => {
    const candidate = resolveCurrentCheapDexCandidate(candidateKey);
    const preparedScope = candidateKey === 'cheap-prepared' || candidateKey === 'cheap-exit' || candidateKey === 'cheap-history' ? resolvePreparedDexScope(candidateKey) : null;
    const preparedCandidate = preparedScope !== null;
    const fundingAbi = preparedCandidate ? preparedAbi : abi;
    const previewSelector = fundingAbi.getFunction('previewPoolFunding')!.selector;
    const fundingSelector = fundingAbi.getFunction('createPoolPosition')!.selector;
    const capability = createDexV2ReadCapability({ chainId, assertCurrent,
      provider: { request: ({ method, params }) => readProvider.send(method, params ?? []) } });
    const guard = async () => { await assertCurrent(); assertSnapshotCurrent(); };
    const checkedGraph = async (blockNumber: bigint, blockHash: string) => {
      await guard();
      const graph = await readCurrentSharedPoolDexGraph({ capability, candidate: candidateKey, blockNumber, blockHash });
      await guard();
      if (graph.graph !== candidate.graph || graph.packageSha256 !== candidate.packageSha256 || graph.chainId !== chainId ||
          graph.genesisHash !== candidate.genesisHash || !same(graph.core, candidate.core) ||
          graph.operationReadIdentity.runtimeHash !== candidate.runtimes.find(([role]) => role === 'ChainWhisperDexCore')?.[2] ||
          graph.operationReadIdentity.releaseId !== candidate.releaseId || graph.block.number !== blockNumber || !same(graph.block.hash, blockHash)) {
        throw new CurrentPoolProofMismatch('Pool funding graph identity changed.');
      }
      return graph;
    };
    const nativeReader = candidate.graph === STAGED_NATIVE_DEX_CANDIDATE.graph ? createCurrentOwnerPoolSnapshotReader({
      signer, owner: ownerAddress, candidate, provider: readProvider, guard,
      attest: block => checkedGraph(block.number, block.hash).then(() => undefined) }) : null;
    const preparePoolTopUp = async (request: {
      graph: Readonly<{ expectedGraph: string; expectedPackageSha256: string; blockNumber: bigint; blockHash: string }>;
      positionId: bigint; ownerContext: string; producerHash: string; pair: readonly [string, string];
      intent: Readonly<{ budgets: readonly [bigint, bigint]; tolerance: readonly [bigint, bigint] }>;
      confirmPrivateInputs: (review: Readonly<{ positionId: bigint; ownerContext: string; classId: bigint;
        budgets: readonly [bigint, bigint]; tolerance: readonly [bigint, bigint]; core: string; principal: string;
        chainId: bigint; marketId: string; poolTokens: readonly [string, string] }>) => Promise<boolean>;
    }) => {
      if (!preparedCandidate || request.graph.expectedGraph !== candidate.graph || request.graph.expectedPackageSha256 !== candidate.packageSha256) {
        throw new Error('Pool top-up requires the exact prepared candidate.');
      }
      const positionId = request.positionId, ownerContext = request.ownerContext, producerHash = request.producerHash;
      uint(positionId, 256, true);
      if (![ownerContext, producerHash].every(value => /^0x[0-9a-fA-F]{64}$/.test(value) && BigInt(value) !== 0n)) throw new Error('Pool top-up needs owner context and producer hash.');
      const intent = Object.freeze({ budgets: Object.freeze([...request.intent.budgets]) as readonly [bigint, bigint],
        tolerance: Object.freeze([...request.intent.tolerance]) as readonly [bigint, bigint] });
      if (intent.budgets.length !== 2 || intent.tolerance.length !== 2 || typeof request.confirmPrivateInputs !== 'function') throw new Error('Invalid Pool top-up intent.');
      intent.budgets.forEach(value => uint(value, 128, true)); intent.tolerance.forEach(value => uint(value, 128));
      if (intent.tolerance[1] === 0n || intent.tolerance[0] > intent.tolerance[1]) throw new Error('Invalid Pool top-up tolerance.');
      const initialBlock = Object.freeze({ number: request.graph.blockNumber, hash: request.graph.blockHash });
      await checkedGraph(initialBlock.number, initialBlock.hash);
      const slot = keccak256(AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256'], [positionId, 18n]));
      const marketId = await readProvider.send('eth_getStorageAt', [candidate.core, slot, { blockHash: initialBlock.hash, requireCanonical: true }]);
      await guard();
      const selected = preparedScope!.candidate.pairs.find(pair => same(marketId, pair.marketId));
      const addresses = request.pair.map(value => getAddress(value).toLowerCase()).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
      requireCurrentPoolProof(!!selected && addresses.length === 2 && addresses.every((token, i) => same(token, selected!.tokens[i])),
        'Pool top-up position and selected pair differ.');
      const poolTokens = selected!.tokens;
      const reader = createPreparedOwnerPoolSnapshotReader({ signer, owner: ownerAddress, candidate, marketId: selected!.marketId,
        readCapability: capability, provider: readProvider, guard, attest: block => checkedGraph(block.number, block.hash).then(() => undefined) });
      const exact = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
      const head = async () => {
        await guard(); const raw = await readProvider.send('eth_getBlockByNumber', ['latest', false]); await guard();
        requireCurrentPoolProof(!!raw && /^0x[0-9a-fA-F]+$/.test(raw.number) && /^0x[0-9a-fA-F]{64}$/.test(raw.hash), 'Pool top-up current block is unavailable.');
        const block = Object.freeze({ number: BigInt(raw.number), hash: raw.hash as string });
        await checkedGraph(block.number, block.hash); return block;
      };
      const proof = await reader.canonical(producerHash);
      requireCurrentPoolProof(!!proof, 'Pool top-up authenticated producer is unavailable.');
      const snapshotData = currentPoolPositionAbi.encodeFunctionData('poolSnapshot', [positionId]);
      const producer = await reader.issue(positionId, same(proof!.data, snapshotData) ? 'snapshot' : 'fund', producerHash, proof!.data);
      const initial = await reader.current(producer, initialBlock);
      requireCurrentPoolProof(initial.status === 1n && same(initial.context, ownerContext) && initial.amounts.shares > 0n,
        'Pool top-up owner context, active status or private shares changed.');
      const baseline = await reader.state(positionId, initialBlock), baselineWallets = await reader.wallets(initialBlock);
      requireCurrentPoolProof(baselineWallets.length === candidate.tokens.length && baselineWallets.every((wallet, i) => same(wallet.token, candidate.tokens[i][0])),
        'Pool top-up needs all four exact token wallets.');
      const latest = async () => {
        const block = await head(); await reader.current(producer, block);
        const wallets = await reader.wallets(block);
        requireCurrentPoolProof(wallets.length === baselineWallets.length &&
          wallets.every((wallet, i) => same(wallet.token, baselineWallets[i].token)), 'Pool top-up financial dependencies changed.');
        return { block, wallets };
      };
      const review = Object.freeze({ ...intent, positionId, ownerContext, classId: initial.amounts.classId, core: candidate.core,
        principal: ownerAddress, chainId, marketId: selected!.marketId, poolTokens });
      await latest();
      if (await request.confirmPrivateInputs(review) !== true) { await guard(); return null; }
      await latest();
      const inputs: PoolFundingInput[] = [];
      for (const [i, value] of [...intent.budgets, ...intent.tolerance].entries()) {
        await guard();
        const input = i < 2 ? await encryptPrivateUint256Input(signer, value, candidate.core, previewSelector) :
          await encryptPrivateUint128Input(signer, value, candidate.core, previewSelector);
        await guard(); inputs.push(Object.freeze({ ciphertext: typeof input.ciphertext === 'bigint' ? input.ciphertext : Object.freeze({ ...input.ciphertext }), signature: input.signature }));
      }
      const data = encodePreparedPoolFundingPreview(selected!.marketId, positionId, inputs);
      const canonical = async (transactionHash: string, expectedData: string, minimumBlock = initialBlock.number) => {
        await guard(); const observed = await reader.canonical(transactionHash); await guard();
        if (!observed) return null;
        requireCurrentPoolProof(same(observed.data, expectedData) && observed.block.number >= minimumBlock, 'Pool top-up canonical call differs from its captured request.');
        return observed;
      };
      const previewAt = async (transactionHash: string) => {
        const observed = await canonical(transactionHash, data);
        if (!observed) return null;
        const event = decodeCurrentPoolFundingEvent(observed.logs, candidate.core, positionId);
        const values = event.encrypted.map((value: { ciphertextHigh: bigint; ciphertextLow: bigint }) => decryptPrivateUint256Output(signer, value)); await guard();
        const amounts = checkCurrentPoolFundingValues(values, { ...intent, classId: initial.amounts.classId });
        requireCurrentPoolProof(amounts.operation === 'add' && amounts.ownedShares === initial.amounts.shares + amounts.mintedShares,
          'Pool top-up preview changed existing owner shares or operation.');
        requireCurrentPoolProof(exact(await canonical(transactionHash, data)) === exact(observed), 'Pool top-up preview changed after decryption.');
        return { observed, event, amounts };
      };
      const readPreview = async (transactionHash: string) => {
        await latest();
        const preview = await previewAt(transactionHash); if (!preview) return null;
        const { observed, event, amounts } = preview;
        const prepareFunding = async (confirm: (values: typeof review & typeof amounts) => Promise<boolean>) => {
          if (typeof confirm !== 'function') throw new Error('Pool top-up requires explicit preview confirmation.');
          if (await confirm(Object.freeze({ ...review, ...amounts })) !== true) { await guard(); return null; }
          const assertPreview = async () => {
            const fresh = await previewAt(transactionHash);
            requireCurrentPoolProof(!!fresh && exact(fresh) === exact(preview), 'Pool top-up preview changed.');
          };
          await assertPreview(); await latest();
          const resigned: PoolFundingInput[] = [];
          for (const input of inputs) {
            await guard(); resigned.push(await resignPrivateInput(signer, input.ciphertext, candidate.core, preparedAbi.getFunction('managePoolPosition')!.selector)); await guard();
          }
          const fundingData = encodePreparedPoolTopUp(selected!.marketId, positionId, data, event.context, ownerContext, resigned);
          let abandoned = false;
          let admittedWallets: Awaited<ReturnType<typeof reader.wallets>> | null = null;
          const selectedIndex = (token: string) => poolTokens.findIndex(value => same(value, token));
          const debit = (index: number) => index === 0 ? amounts.used0 : amounts.used1;
          const checkWallets = (wallets: Awaited<ReturnType<typeof reader.wallets>>, mode: 'fund' | 'cleanup') => {
            requireCurrentPoolProof(wallets.length === baselineWallets.length && wallets.every((wallet, i) => same(wallet.token, baselineWallets[i].token)),
              'Pool top-up wallet scope changed.');
            requireCurrentPoolProof(wallets.every((wallet, i) => {
              const index = selectedIndex(wallet.token), allowance = index < 0 ? baselineWallets[i].allowance : debit(index);
              return wallet.balance === baselineWallets[i].balance && (wallet.allowance === allowance || mode === 'cleanup' && index >= 0 && wallet.allowance === 0n);
            }), 'Pool top-up wallet funds or exact selected allowances changed.');
          };
          const assertApprovalCurrent = async () => {
            if (abandoned) throw new CurrentPoolProofMismatch('This unfunded Pool top-up was stopped.');
            await assertPreview(); await latest();
          };
          const assertBeforeFunding = async () => {
            await assertApprovalCurrent(); const fresh = await latest(); checkWallets(fresh.wallets, 'fund'); admittedWallets = fresh.wallets;
          };
          const assertUnfundedCleanupCurrent = async () => { const fresh = await latest(); checkWallets(fresh.wallets, 'cleanup'); };
          const abandonUnfunded = async (confirm: (values: { allowances: readonly [bigint, bigint] }) => Promise<boolean>) => {
            if (typeof confirm !== 'function') throw new Error('Pool top-up stop requires explicit confirmation.');
            await assertUnfundedCleanupCurrent(); const fresh = await latest();
            const allowances = Object.freeze(poolTokens.map(token => fresh.wallets.find(wallet => same(wallet.token, token))!.allowance)) as readonly [bigint, bigint];
            if (!await confirm({ allowances })) { await guard(); return null; }
            await assertUnfundedCleanupCurrent(); const final = await latest();
            requireCurrentPoolProof(poolTokens.every((token, i) => final.wallets.find(wallet => same(wallet.token, token))!.allowance === allowances[i]), 'Pool top-up allowances changed during stop confirmation.');
            abandoned = true; admittedWallets = null;
            const cleanupRequired = Object.freeze(allowances.map(value => value !== 0n)) as readonly [boolean, boolean];
            return Object.freeze({ status: cleanupRequired.some(Boolean) ? 'unfunded-cleanup-required' as const : 'unfunded-allowances-cleared' as const, cleanupRequired });
          };
          const readFunding = async (fundingHash: string) => {
            const managedProof = await canonical(fundingHash, fundingData, observed.block.number); if (!managedProof) return null;
            requireCurrentPoolProof(!abandoned && !!admittedWallets, 'Pool top-up needs its exact pre-funding wallet check.');
            const tokenFlows = poolTokens.map(token => {
              const logs = managedProof.logs.filter(log => same(log.address, token) && same(log.topics[0], transfer.getEvent('Transfer')!.topicHash));
              const debits = logs.map(log => {
                const parsed = transfer.parseLog({ topics: [...log.topics], data: log.data })!, encoded = transfer.encodeEventLog(parsed.fragment, parsed.args);
                requireCurrentPoolProof(same(encoded.data, log.data) && encoded.topics.length === log.topics.length && encoded.topics.every((value, i) => same(value, log.topics[i])), 'Non-canonical Pool top-up token event.');
                return parsed.args;
              }).filter(args => same(args.from, ownerAddress) && same(args.to, candidate.core));
              requireCurrentPoolProof(debits.length === 1, 'Pool top-up needs one exact owner debit per selected token.');
              return decryptPrivateUint256Output(signer, debits[0].senderValue);
            });
            await guard();
            const managed = await reader.state(positionId, managedProof.block), managedWallets = await reader.wallets(managedProof.block);
            const expectation = checkPreparedPoolManagementTransition({ candidate, owner: ownerAddress, request: { action: 'top-up', budgets: intent.budgets, preview: amounts },
              receiptStatus: 1, before: baseline, managed, beforeAmounts: initial.amounts, beforeWallets: admittedWallets!, managedWallets, tokenFlows });
            requireCurrentPoolProof(expectation.status === 'manage-verified-snapshot-required', 'Pool top-up management did not produce its required expectation.');
            if (expectation.status !== 'manage-verified-snapshot-required') throw new CurrentPoolProofMismatch('Pool top-up snapshot expectation is unavailable.');
            requireCurrentPoolProof(exact(await canonical(fundingHash, fundingData, observed.block.number)) === exact(managedProof), 'Pool top-up receipt changed after accounting.');
            const verifySnapshot = async (snapshotHash: string) => {
              const snapshotProof = await canonical(snapshotHash, snapshotData, managedProof.block.number);
              requireCurrentPoolProof(!!snapshotProof, 'Pool top-up snapshot receipt is unavailable.');
              if (snapshotProof!.block.number === managedProof.block.number) {
                const [manageReceipt, snapshotReceipt] = await Promise.all([
                  readProvider.getTransactionReceipt(fundingHash), readProvider.getTransactionReceipt(snapshotHash) ]);
                await guard();
                requireCurrentPoolProof(!!manageReceipt && !!snapshotReceipt && same(manageReceipt.hash, fundingHash) && same(snapshotReceipt.hash, snapshotHash) &&
                  same(manageReceipt.blockHash, managedProof.block.hash) && same(snapshotReceipt.blockHash, snapshotProof!.block.hash) &&
                  Number.isSafeInteger(manageReceipt.index) && Number.isSafeInteger(snapshotReceipt.index) && manageReceipt.index >= 0 &&
                  snapshotReceipt.index > manageReceipt.index, 'Pool top-up snapshot must follow management within its block.');
              }
              const issued = await reader.issue(positionId, 'snapshot', snapshotHash);
              requireCurrentPoolProof(issued.block.number >= managedProof.block.number, 'Pool top-up snapshot precedes management.');
              const snapshot = await reader.state(positionId, issued.block), snapshotWallets = await reader.wallets(issued.block);
              await reader.current(issued, await head());
              const result = checkPreparedPoolManagementSnapshot({ candidate, expected: expectation, managed, snapshot, observedAmounts: issued.amounts, managedWallets, snapshotWallets });
              requireCurrentPoolProof(exact(await canonical(fundingHash, fundingData, observed.block.number)) === exact(managedProof), 'Pool top-up management receipt changed before snapshot acceptance.');
              requireCurrentPoolProof(exact(await canonical(snapshotHash, snapshotData, managedProof.block.number)) === exact(snapshotProof),
                'Pool top-up snapshot receipt changed after accounting.');
              return Object.freeze({ ...result, producer: issued, producerHash: issued.transactionHash, positionId, block: issued.block, readyToSign: false as const });
            };
            return Object.freeze({ transactionHash: fundingHash, positionId, amounts, expectation, status: expectation.status,
              privateAccountingVerified: false as const, block: managedProof.block, readyToSign: false as const, verifySnapshot });
          };
          const funding = Object.freeze({ chainId, from: ownerAddress, to: candidate.core, value: 0n, data: fundingData, graph: candidate.graph,
            packageSha256: candidate.packageSha256, readyToSign: false as const, positionId, ownerContext, intent: review, amounts,
            previewData: data, previewTransactionHash: transactionHash, previewContext: event.context, assertCurrent: assertPreview,
            assertBeforeFunding, assertApprovalCurrent, assertUnfundedCleanupCurrent, abandonUnfunded, readFunding });
          preparedSessions.set(funding, signer); return funding;
        };
        return Object.freeze({ transactionHash, positionId, ownerContext, context: event.context, block: observed.block, amounts, prepareFunding });
      };
      const prepared = Object.freeze({ chainId, from: ownerAddress, to: candidate.core, value: 0n, data, graph: candidate.graph,
        packageSha256: candidate.packageSha256, readyToSign: false as const, positionId, ownerContext, intent: review,
        assertCurrent: async () => { await latest(); }, readPreview });
      preparedSessions.set(prepared, signer); return prepared;
    };
    return Object.freeze({ preparePoolTopUp, preparePoolCreation: async (request: {
      graph: Readonly<{ expectedGraph: string; expectedPackageSha256: string; blockNumber: bigint; blockHash: string }>;
      // Required for a multi-market candidate. Budgets follow this canonical order.
      pair?: readonly [string, string];
      intent: Intent;
      confirmPrivateInputs: (review: Intent & Readonly<{ core: string; principal: string; chainId: bigint }>) => Promise<boolean>;
    }) => {
      const graphRequest = Object.freeze({ ...request.graph });
      if (graphRequest.expectedGraph !== candidate.graph || graphRequest.expectedPackageSha256 !== candidate.packageSha256) throw new Error('Wrong Pool funding candidate.');
      const addresses = request.pair ? [...request.pair].map(value => getAddress(value).toLowerCase()) :
        preparedCandidate ? [] : candidate.tokens.map(([address]) => address);
      if (addresses.length !== 2 || addresses[0] === addresses[1] ||
          addresses.some(address => !candidate.tokens.some(([token]) => same(address, token)))) throw new Error('Pool funding requires the selected two-token pair.');
      const poolTokens = Object.freeze(addresses.sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1)) as readonly [string, string];
      const selected = preparedCandidate ? preparedScope.candidate.pairs.find(pair =>
        pair.tokens.every((token, index) => same(token, poolTokens[index]))) : null;
      if (preparedCandidate && !selected) throw new Error('Pool pair is outside the prepared market registry.');
      const selectedMarket = selected?.marketId ?? candidate.marketId;
      const checkedMarket = async (blockNumber: bigint, blockHash: string) => {
        const graph = await checkedGraph(blockNumber, blockHash);
        if (preparedCandidate) {
          const registry = await readPreparedDexMarketRegistry({ capability, blockNumber, blockHash, candidate: candidateKey });
          await guard();
          const market = registry.markets.find(value => same(value.marketId, selectedMarket));
          if (registry.graph !== candidate.graph || registry.packageSha256 !== candidate.packageSha256 ||
              registry.chainId !== chainId || !same(registry.core, candidate.core) || registry.releaseId !== candidate.releaseId ||
              registry.block.number !== blockNumber || !same(registry.block.hash, blockHash) || !market ||
              market.enabled !== true || !same(market.token0, poolTokens[0]) || !same(market.token1, poolTokens[1]) ||
              market.canonicalId !== BigInt(selected!.canonicalId) || !same(market.engine, selected!.engine) ||
              !same(market.poolTerms, selected!.poolTerms)) throw new CurrentPoolProofMismatch('Pool selected market identity changed.');
        }
        return graph;
      };
      const preparedReader = preparedCandidate ? createPreparedOwnerPoolSnapshotReader({ signer, owner: ownerAddress, candidate,
        marketId: selectedMarket, readCapability: capability, provider: readProvider, guard,
        attest: block => checkedMarket(block.number, block.hash).then(() => undefined) }) : null;
      const intent: Intent = Object.freeze({ ...request.intent, budgets: Object.freeze([...request.intent.budgets]) as Intent['budgets'],
        terms: Object.freeze([...request.intent.terms]) as Intent['terms'] });
      uint(intent.classId, 8);
      if (intent.classId >= 7n || intent.budgets.length !== 2 || intent.terms.length !== 10) throw new Error('Invalid Pool funding intent.');
      intent.budgets.forEach(value => uint(value, 256, true)); intent.terms.forEach(value => uint(value, 128));
      if (intent.terms[9] === 0n || intent.terms[8] > intent.terms[9] || typeof request.confirmPrivateInputs !== 'function') throw new Error('Invalid Pool funding tolerance or confirmation.');
      const spread = [[1001n, 1000n], [1003n, 1000n], [201n, 200n], [101n, 100n], [51n, 50n], [21n, 20n], [11n, 10n]][Number(intent.classId)];
      for (const offset of [0, 4]) {
        const [n, d, u, v] = intent.terms.slice(offset, offset + 4);
        if (n === 0n || d === 0n || n * u - d * v !== 1n) throw new Error('Invalid Pool funding fraction witness.');
      }
      if (intent.terms[4] !== spread[0] || intent.terms[5] !== spread[1]) throw new Error('Pool spread differs from its selected class.');
      const graph = await checkedMarket(graphRequest.blockNumber, graphRequest.blockHash);
      const review = Object.freeze({ ...intent, core: graph.core, principal: ownerAddress, chainId,
        marketId: selectedMarket, poolTokens });
      if (await request.confirmPrivateInputs(review) !== true) { await guard(); return null; }
      await guard();
      const inputs: PoolFundingInput[] = [];
      for (const [index, value] of [intent.classId, ...intent.budgets, ...intent.terms].entries()) {
        await guard();
        const input = index === 1 || index === 2 ? await encryptPrivateUint256Input(signer, value, graph.core, previewSelector) :
          await encryptPrivateUint128Input(signer, value, graph.core, previewSelector);
        await guard();
        inputs.push(Object.freeze({ ciphertext: typeof input.ciphertext === 'bigint' ? input.ciphertext : Object.freeze({ ...input.ciphertext }), signature: input.signature }));
      }
      const data = preparedCandidate ? encodePreparedPoolFundingPreview(selectedMarket, 0n, inputs) : encodeCurrentPoolFundingPreview(0n, inputs);
      const attestedReceiptBlocks = new Set<string>();
      const readCanonicalCall = async (transactionHash: string, expectedData: string, minimumBlock = graph.block.number) => {
        if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash) || BigInt(transactionHash) === 0n) throw new Error('Invalid Pool preview transaction hash.');
        await guard();
        const [transaction, receipt] = await Promise.all([readProvider.getTransaction(transactionHash), readProvider.getTransactionReceipt(transactionHash)]);
        await guard();
        if (!transaction || !receipt) return null;
        if (!same(transaction.hash, transactionHash) || !same(receipt.hash, transactionHash) || transaction.chainId !== chainId ||
            !same(transaction.from, ownerAddress) || !same(receipt.from, ownerAddress) || !same(transaction.to, graph.core) || !same(receipt.to, graph.core) ||
            transaction.value !== 0n || !same(transaction.data, expectedData) || receipt.status !== 1 ||
            !Number.isSafeInteger(transaction.nonce) || transaction.nonce < 0 || !Number.isSafeInteger(receipt.blockNumber) ||
            BigInt(receipt.blockNumber) < minimumBlock || transaction.blockNumber !== receipt.blockNumber || !same(transaction.blockHash, receipt.blockHash)) {
          throw new CurrentPoolProofMismatch('Pool preview transaction or receipt differs from the captured request.');
        }
        const blockNumber = BigInt(receipt.blockNumber), blockKey = `${blockNumber}:${receipt.blockHash.toLowerCase()}`;
        // Immutable attestation belongs to this preparation; old state can be pruned during wallet review.
        if (!attestedReceiptBlocks.has(blockKey)) await checkedMarket(blockNumber, receipt.blockHash);
        const header = await readProvider.send('eth_getBlockByNumber', [`0x${blockNumber.toString(16)}`, false]);
        await guard();
        requireCurrentPoolProof(!!header && /^0x[0-9a-fA-F]+$/.test(header.number) && BigInt(header.number) === blockNumber &&
          same(header.hash, receipt.blockHash), 'Pool receipt block is no longer canonical.');
        attestedReceiptBlocks.add(blockKey);
        return Object.freeze({ ...receipt, logs: Object.freeze(receipt.logs.map(log => Object.freeze({ ...log,
          topics: Object.freeze([...log.topics]) }))) });
      };
      const readCanonicalPreview = async (transactionHash: string) => {
        const receipt = await readCanonicalCall(transactionHash, data);
        if (!receipt) return null;
        const event = decodeCurrentPoolFundingEvent(receipt.logs, graph.core, 0n);
        const values = event.encrypted.map((value: { ciphertextHigh: bigint; ciphertextLow: bigint }) => decryptPrivateUint256Output(signer, value));
        await guard();
        const amounts = checkCurrentPoolFundingValues(values, { budgets: intent.budgets, classId: intent.classId,
          tolerance: [intent.terms[8], intent.terms[9]] });
        return { event, amounts, block: Object.freeze({ number: BigInt(receipt.blockNumber), hash: receipt.blockHash }) };
      };
      const readPreview = async (transactionHash: string) => {
        const observed = await readCanonicalPreview(transactionHash);
        if (!observed) return null;
        const { event, amounts, block } = observed;
        return Object.freeze({ transactionHash, context: event.context, block,
          amounts, prepareFunding: async (confirm: (values: typeof amounts & typeof review) => Promise<boolean>) => {
            if (typeof confirm !== 'function') throw new Error('Pool funding requires explicit preview confirmation.');
            await guard();
            if (await confirm(Object.freeze({ ...review, ...amounts })) !== true) { await guard(); return null; }
            await guard();
            // Reconcile the exact preview again after the user review. Core also
            // checks the encrypted reserve/share revisions at funding time.
            const refreshed = await readCanonicalPreview(transactionHash);
            if (!refreshed) throw new Error('Pool preview is not available.');
            if (refreshed.event.context !== event.context ||
                Object.keys(amounts).some(key => amounts[key as keyof typeof amounts] !== refreshed.amounts[key as keyof typeof amounts])) {
              throw new CurrentPoolProofMismatch('Pool preview changed.');
            }
            const resigned: PoolFundingInput[] = [];
            for (const input of inputs) {
              await guard();
              resigned.push(await resignPrivateInput(signer, input.ciphertext, graph.core, fundingSelector));
              await guard();
            }
            const fundingData = preparedCandidate ? encodePreparedPoolCreation(selectedMarket, data, event.context, resigned) :
              encodeCurrentPoolCreation(data, event.context, resigned);
            const baselineBlock = nativeReader || preparedReader ? await (async () => {
              const raw = await readProvider.send('eth_getBlockByNumber', ['latest', false]); await guard();
              if (!raw || !/^0x[0-9a-fA-F]+$/.test(raw.number) || !/^0x[0-9a-fA-F]{64}$/.test(raw.hash)) throw new CurrentPoolProofMismatch('Pool funding baseline block is unavailable.');
              return Object.freeze({ number: BigInt(raw.number), hash: raw.hash as string });
            })() : null;
            const baselineWallets = baselineBlock && nativeReader && await nativeReader.wallets(baselineBlock);
            const baselineCounter=baselineBlock&&BigInt(await readProvider.send('eth_getStorageAt',[candidate.core,'0xb',{blockHash:baselineBlock.hash,requireCanonical:true}]));
            const baselineState = baselineBlock && nativeReader && await nativeReader.state(baselineCounter!+1n, baselineBlock);
            const preparedBaseline = baselineBlock && preparedReader && await preparedReader.state(baselineCounter! + 1n, baselineBlock);
            const preparedWallets = baselineBlock && preparedReader && await preparedReader.wallets(baselineBlock);
            if (preparedReader) requireCurrentPoolProof(!!preparedWallets && preparedWallets.length === candidate.tokens.length &&
              preparedWallets.every((wallet, i) => same(wallet.token, candidate.tokens[i][0])), 'Prepared Pool baseline needs all four exact token wallets.');
            let abandoned = false;
            const financialState = (value: unknown) => JSON.stringify(value, (key, v) => key === 'block' ? null : typeof v === 'bigint' ? v.toString() : v);
            const latestPrepared = async () => {
              if (!preparedReader || !preparedBaseline || !preparedWallets) throw new CurrentPoolProofMismatch('Prepared Pool financial baseline is unavailable.');
              const raw = await readProvider.send('eth_getBlockByNumber', ['latest', false]); await guard();
              if (!raw || !/^0x[0-9a-fA-F]+$/.test(raw.number) || !/^0x[0-9a-fA-F]{64}$/.test(raw.hash)) throw new CurrentPoolProofMismatch('Prepared Pool current block is unavailable.');
              const currentBlock = { number: BigInt(raw.number), hash: raw.hash as string };
              const state = await preparedReader.state(preparedBaseline.counter + 1n, currentBlock);
              requireCurrentPoolProof(financialState(state) === financialState(preparedBaseline), 'Prepared Pool financial preview dependencies changed.');
              const wallets = await preparedReader.wallets(currentBlock);
              requireCurrentPoolProof(wallets.length === preparedWallets.length && wallets.every((wallet, i) => same(wallet.token, preparedWallets[i].token)),
                'Prepared Pool current wallet scope changed.');
              return wallets;
            };
            const readFunding = async (fundingHash: string) => {
              const receipt = await readCanonicalCall(fundingHash, fundingData, block.number);
              if (!receipt) return null;
              const nft = candidate.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1];
              const positionId = decodeCurrentPoolClaimMint(receipt.logs, graph.core, nft, ownerAddress);
              for (const [index, tokenAddress] of poolTokens.entries()) {
                const logs = receipt.logs.filter(log => same(log.address, tokenAddress) &&
                  log.topics[0]?.toLowerCase() === transfer.getEvent('Transfer')!.topicHash.toLowerCase());
                const debits = logs.map(log => {
                  const parsed = transfer.parseLog({ topics: [...log.topics], data: log.data })!;
                  const encoded = transfer.encodeEventLog(parsed.fragment, parsed.args);
                  if (encoded.data.toLowerCase() !== log.data.toLowerCase() || encoded.topics.length !== log.topics.length ||
                      encoded.topics.some((topic, i) => topic.toLowerCase() !== log.topics[i].toLowerCase())) throw new CurrentPoolProofMismatch('Non-canonical Pool funding debit.');
                  return parsed.args;
                }).filter(args => getAddress(args.from) === getAddress(ownerAddress) && getAddress(args.to) === getAddress(graph.core));
                if (debits.length !== 1 || decryptPrivateUint256Output(signer, debits[0].senderValue) !== (index === 0 ? amounts.used0 : amounts.used1)) {
                  throw new CurrentPoolProofMismatch('Pool funding debit differs from its confirmed preview.');
                }
                await guard();
              }
              let producer;
              if (nativeReader) {
                const session = currentNativePoolSession(signer);
                requireCurrentPoolProof(!!session && session.funded?.data === fundingData && !session.unfundedFailed,
                  'Funding has no admitted native Pool session.');
                const receiptBlock = Object.freeze({ number: BigInt(receipt.blockNumber), hash: receipt.blockHash });
                const after = await nativeReader.state(positionId, receiptBlock), wallets = await nativeReader.wallets(receiptBlock);
                checkCurrentPoolFinancialTransition(baselineState!,after,'fund');
                requireCurrentPoolProof(positionId === baselineState!.counter + 1n && after.counter === positionId &&
                  after.operation === baselineState!.operation && after.market[40] === baselineState!.market[40] &&
                  after.protectedClaim.every((value, index) => value === baselineState!.protectedClaim[index]),
                  'Native Pool funding changed its counter or protected existing claim.');
                requireCurrentPoolProof(wallets.every((value, index) => value.allowance === 0n &&
                  value.balance === baselineWallets![index].balance - (index === 0 ? amounts.used0 : amounts.used1)),
                  'Native Pool funding wallet debit/refund or consumed allowance differs.');
                producer = await nativeReader.issue(positionId, 'fund', fundingHash);
                requireCurrentPoolProof(producer.amounts.shares === amounts.mintedShares && producer.amounts.classId === amounts.classId,
                  'Native Pool funded owner shares differ from preview.');
                session!.positionId = positionId; session!.producer = producer;
              }
              if (preparedReader && preparedBaseline && preparedWallets) {
                const receiptBlock = { number: BigInt(receipt.blockNumber), hash: receipt.blockHash };
                const after = await preparedReader.state(positionId, receiptBlock), wallets = await preparedReader.wallets(receiptBlock);
                checkPreparedPoolFinancialTransition(preparedBaseline, after, 'fund');
                requireCurrentPoolProof(wallets.length === preparedWallets.length && wallets.every((wallet, i) => {
                  const selectedIndex = poolTokens.findIndex(token => same(token, wallet.token));
                  const debit = selectedIndex === 0 ? amounts.used0 : selectedIndex === 1 ? amounts.used1 : 0n;
                  return same(wallet.token, preparedWallets[i].token) && wallet.balance === preparedWallets[i].balance - debit &&
                    wallet.allowance === (selectedIndex < 0 ? preparedWallets[i].allowance : 0n);
                }), 'Prepared Pool exact wallet debits, consumed allowances or other token funds differ.');
                producer = await preparedReader.issue(positionId, 'fund', fundingHash, fundingData);
                requireCurrentPoolProof(producer.amounts.shares === amounts.mintedShares && producer.amounts.classId === amounts.classId,
                  'Prepared Pool funded owner shares differ from preview.');
              }
              // Recheck the receipt after private state and owner-envelope reads.
              const finalReceipt = await readCanonicalCall(fundingHash, fundingData, block.number);
              requireCurrentPoolProof(!!finalReceipt && financialState(finalReceipt) === financialState(receipt), 'Pool funding receipt changed after accounting.');
              return Object.freeze({ transactionHash: fundingHash, positionId, amounts, producerHash: producer?.transactionHash,
                producer,
                block: Object.freeze({ number: BigInt(receipt.blockNumber), hash: receipt.blockHash }), readyToSign: false as const });
            };
            const assertFundingCurrent = async () => {
              await guard();
              const current = await readCanonicalPreview(transactionHash);
              if (!current) throw new Error('Pool preview is not available.');
              if (current.event.context !== event.context ||
                  Object.keys(amounts).some(key => amounts[key as keyof typeof amounts] !== current.amounts[key as keyof typeof amounts])) {
                throw new CurrentPoolProofMismatch('Pool preview changed.');
              }
              await guard();
            };
            const assertBeforeFunding = async () => {
              if (abandoned) throw new CurrentPoolProofMismatch('This unfunded Pool deposit was stopped. Funding cannot restart.');
              await assertFundingCurrent();
              if (preparedReader && preparedWallets) {
                const wallets = await latestPrepared();
                requireCurrentPoolProof(wallets.every((wallet, i) => {
                  const index = poolTokens.findIndex(token => same(token, wallet.token));
                  return same(wallet.token, preparedWallets[i].token) && wallet.balance === preparedWallets[i].balance &&
                    wallet.allowance === (index === 0 ? amounts.used0 : index === 1 ? amounts.used1 : preparedWallets[i].allowance);
                }), 'Prepared Pool funding needs unchanged private balances and exact selected-token allowances.');
              }
              if(nativeReader&&baselineState){const raw=await readProvider.send('eth_getBlockByNumber',['latest',false]);await guard();
                const live=await nativeReader.state(baselineState.counter+1n,{number:BigInt(raw.number),hash:raw.hash as string});
                requireCurrentPoolProof(JSON.stringify(live,(_,v)=>typeof v==='bigint'?v.toString():v)===
                  JSON.stringify(baselineState,(_,v)=>typeof v==='bigint'?v.toString():v),'Native Pool financial preview dependencies changed before funding.');}
              if(nativeReader&&baselineWallets){const raw=await readProvider.send('eth_getBlockByNumber',['latest',false]);await guard();
                const wallets=await nativeReader.wallets({number:BigInt(raw.number),hash:raw.hash as string});
                requireCurrentPoolProof(wallets.every((v,i)=>v.balance===baselineWallets[i].balance&&v.allowance===(i===0?amounts.used0:amounts.used1)),
                  'Native Pool funding needs unchanged private balances and exact canonical used allowances.');}
            };
            const checkPreparedCleanupWallets = (wallets: Awaited<ReturnType<typeof latestPrepared>>) => {
                requireCurrentPoolProof(!!preparedWallets && wallets.every((wallet, i) => {
                  const index = poolTokens.findIndex(token => same(token, wallet.token));
                  const used = index === 0 ? amounts.used0 : amounts.used1;
                  return same(wallet.token, preparedWallets![i].token) && wallet.balance === preparedWallets![i].balance &&
                    (index < 0 ? wallet.allowance === preparedWallets![i].allowance : wallet.allowance === 0n || wallet.allowance === used);
                }), 'Prepared unfunded cleanup has changed funds or unknown allowances.');
            };
            const assertUnfundedCleanupCurrent = async () => {
              if (preparedReader && preparedWallets) {
                checkPreparedCleanupWallets(await latestPrepared());
                return;
              }
              if (!nativeReader || !baselineState || !baselineWallets) throw new Error('Native Pool cleanup baseline is unavailable.');
              await guard(); const raw=await readProvider.send('eth_getBlockByNumber',['latest',false]);await guard();
              const currentBlock={number:BigInt(raw.number),hash:raw.hash as string};
              const current=await nativeReader.state(baselineState.counter+1n,currentBlock),wallets=await nativeReader.wallets(currentBlock);
              checkCurrentPoolUnfundedCleanupState(baselineState,current);
              requireCurrentPoolProof(wallets.every((v,i)=>
                  v.balance===baselineWallets[i].balance&&(v.allowance===0n||v.allowance===(i===0?amounts.used0:amounts.used1))),
                'Native unfunded cleanup has changed financial state or unknown allowances.');
            };
            const assertApprovalCurrent = async () => {
              await assertFundingCurrent();
              if (abandoned) throw new CurrentPoolProofMismatch('This unfunded Pool deposit was stopped. Normal approval cannot restart.');
            };
            const abandonUnfunded = async (confirm: (review: { allowances: readonly [bigint, bigint] }) => Promise<boolean>) => {
              if (!preparedReader || typeof confirm !== 'function') throw new Error('Prepared Pool stop capability is unavailable.');
              const wallets = await latestPrepared();
              checkPreparedCleanupWallets(wallets);
              const allowances = poolTokens.map(token => wallets.find(wallet => same(token, wallet.token))!.allowance) as [bigint, bigint];
              if (!await confirm({ allowances: Object.freeze(allowances) })) { await guard(); return null; }
              const refreshed = await latestPrepared();
              checkPreparedCleanupWallets(refreshed);
              requireCurrentPoolProof(poolTokens.every((token, i) => refreshed.find(wallet => same(token, wallet.token))!.allowance === allowances[i]),
                'Prepared Pool approvals changed during stop confirmation.');
              abandoned = true;
              const cleanupRequired = Object.freeze(allowances.map(value => value !== 0n)) as readonly [boolean, boolean];
              return Object.freeze({ status: cleanupRequired.some(Boolean) ? 'unfunded-cleanup-required' as const : 'unfunded-allowances-cleared' as const, cleanupRequired });
            };
            const funded = Object.freeze({ chainId, from: ownerAddress, to: graph.core, value: 0n,
              data: fundingData, graph: graph.graph, packageSha256: graph.packageSha256,
              readyToSign: false as const, intent: review, amounts, previewData: data, previewTransactionHash: transactionHash,
              previewContext: event.context, assertCurrent: assertFundingCurrent, assertBeforeFunding, assertUnfundedCleanupCurrent,
              assertApprovalCurrent, abandonUnfunded, readFunding });
            preparedSessions.set(funded, signer);
            return funded;
          } });
      };
      const prepared = Object.freeze({ chainId, from: ownerAddress, to: graph.core, value: 0n, data,
        graph: graph.graph, packageSha256: graph.packageSha256, readyToSign: false as const, intent: review, assertCurrent: guard, readPreview });
      preparedSessions.set(prepared, signer);
      return prepared;
    } });
  }
});

export type CurrentPoolPreparedPreview = NonNullable<Awaited<ReturnType<Awaited<ReturnType<typeof issueCurrentDexPoolFundingCapability>>['preparePoolCreation']>>>;
export type CurrentPoolPreparedFunding = NonNullable<Awaited<ReturnType<NonNullable<Awaited<ReturnType<CurrentPoolPreparedPreview['readPreview']>>>['prepareFunding']>>>;
export type CurrentPoolPreparedTopUpPreview = NonNullable<Awaited<ReturnType<Awaited<ReturnType<typeof issueCurrentDexPoolFundingCapability>>['preparePoolTopUp']>>>;
export type CurrentPoolPreparedTopUpFunding = NonNullable<Awaited<ReturnType<NonNullable<Awaited<ReturnType<CurrentPoolPreparedTopUpPreview['readPreview']>>>['prepareFunding']>>>;

