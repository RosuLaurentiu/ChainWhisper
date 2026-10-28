import { AbiCoder, Interface, getAddress, keccak256 } from '@coti-io/coti-ethers';
import { assertCurrentPoolFundingPrepared, type CurrentPoolPreparedPreview, type CurrentPoolPreparedFunding,
  type CurrentPoolPreparedTopUpPreview, type CurrentPoolPreparedTopUpFunding } from '../features/wallet/currentDexPoolFundingCapability';
import { createCurrentAttemptBoundary, type CurrentTransport } from './currentDexSubmission';
import { blockCurrentPoolVerification, clearCurrentDexPendingAttempt, currentDexPendingStorage } from './currentDexPendingAttempt';
import { CURRENT_POOL_FUNDING_ABI, PREPARED_POOL_FUNDING_ABI, decodeCurrentPoolFundingEvent, decodeCurrentPoolClaimMint, encodePreparedPoolTopUp } from './currentDexPoolFunding';
import { resolveCurrentCheapDexCandidate, assertCurrentCheapDexNativeAdmission, currentCheapDexCandidateKey, STAGED_SHARED_HISTORY_DEX_CANDIDATE, type CurrentCheapDexCandidateKey, type CurrentCheapDexCandidate } from './dexV2Deployment';
import { assertCurrentNativePoolProfile, issueCurrentNativePoolSourceFit, CURRENT_NATIVE_POOL_PROFILE, CURRENT_NATIVE_POOL_LIMITS,
  admitCurrentNativePoolPreview, admitCurrentNativePoolFunding, currentNativePoolSession } from './currentDexNativePoolPolicy';
import { isCurrentNativeSwapCandidate, currentNativeSigningBudget, recordCurrentNativePoolOutcome } from './currentDexNativeSwapPolicy';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { CurrentPoolProofMismatch, isKnownCurrentPoolProofMismatch } from './currentDexPoolProofError';

// Keep the canonical baseline independent of mutable provider receipt objects.
const snapshotReceipt = (receipt: NonNullable<Awaited<ReturnType<CurrentTransport['waitForReceipt']>>>) => {
  const logs = receipt.logs?.map(log => {
    const topics = [...log.topics]; Object.freeze(topics);
    return Object.freeze({ ...log, topics });
  });
  if (logs) Object.freeze(logs);
  return Object.freeze({ ...receipt, logs });
};
const abi = new Interface(CURRENT_POOL_FUNDING_ABI), gasCap = 100_000_000n;
const preparedAbi = new Interface(PREPARED_POOL_FUNDING_ABI);
const reservations = new WeakMap<object, Set<string>>();
const fundingRecoveries = new WeakMap<object,Map<string,()=>Promise<unknown>>>();
type Phase = 'pool-preview' | 'pool-fund';
type Funding = CurrentPoolPreparedFunding | CurrentPoolPreparedTopUpFunding;
type Prepared = CurrentPoolPreparedPreview | Funding | CurrentPoolPreparedTopUpPreview;
type Mode = 'creation' | 'top-up';
// Native creation/funding: limit-fill-history-shared-receipt-2026-10-13/native-market-seed/RESULT.json.
// Native same-position top-up: reports/shared-history-pool-topup-2026-10-14/RESULT.json.
export const assertCurrentPoolFundingNativeAdmission = (candidate: CurrentCheapDexCandidate, mode: Mode = 'creation') => {
  if ((mode === 'creation' || mode === 'top-up') && candidate.graph === STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph &&
      resolvePreparedDexScope(candidate).key === 'cheap-history') return;
  assertCurrentCheapDexNativeAdmission(candidate);
};
type Head = Awaited<ReturnType<CurrentTransport['readHead']>>;
const same = (a: string | null, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
const checkCall = (phase: Phase, data: string, candidate: CurrentCheapDexCandidate, context?: string, marketId?: string,
  expected?: { mode: Mode; positionId?: bigint; ownerContext?: string; previewData?: string }) => {
  try {
  const candidateKey = currentCheapDexCandidateKey(candidate);
  const preparedScope = candidateKey === 'cheap-prepared' || candidateKey === 'cheap-exit' || candidateKey === 'cheap-history' ? resolvePreparedDexScope(candidate) : null;
  const isPrepared = preparedScope !== null;
  const isManage = phase === 'pool-fund' && data.slice(0, 10).toLowerCase() === preparedAbi.getFunction('managePoolPosition')!.selector.toLowerCase();
  const nonzeroHash = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value) && BigInt(value) !== 0n;
  if (isManage) {
    if (!isPrepared || expected?.mode === 'creation') throw new CurrentPoolProofMismatch('Pool top-up requires its prepared management action.');
    const decoded = preparedAbi.decodeFunctionData('managePoolPosition', data);
    const [positionId, ownerContext, action, raw] = decoded;
    const coder = AbiCoder.defaultAbiCoder(), inner = coder.decode(['bytes32', 'bytes'], raw);
    const types = ['tuple(tuple(uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature)[2]', 'tuple(uint256 ciphertext,bytes signature)[2]'];
    const funding = coder.decode(types, inner[1]), resigned = [...funding[0], ...funding[1]];
    if (!same(preparedAbi.encodeFunctionData('managePoolPosition', decoded), data) || positionId <= 0n || action !== 0n ||
        !nonzeroHash(ownerContext) || !nonzeroHash(inner[0]) || !same(coder.encode(['bytes32', 'bytes'], inner), raw) ||
        !same(coder.encode(types, funding), inner[1]) || resigned.some(input => !/^0x[0-9a-fA-F]{130}$/.test(input.signature)) ||
        expected?.positionId !== undefined && expected.positionId !== positionId ||
        expected?.ownerContext !== undefined && !same(expected.ownerContext, ownerContext) || context !== undefined && !same(context, inner[0])) {
      throw new CurrentPoolProofMismatch('Pool top-up calldata differs from its prepared action.');
    }
    if (expected?.previewData !== undefined && (!marketId || !same(encodePreparedPoolTopUp(marketId, positionId,
      expected.previewData, inner[0], ownerContext, resigned), data))) throw new CurrentPoolProofMismatch('Pool top-up differs from its exact preview inputs.');
    return Object.freeze({ mode: 'top-up' as const, positionId, ownerContext: ownerContext as string, previewContext: inner[0] as string });
  }
  if (phase === 'pool-fund' && expected?.mode === 'top-up') throw new CurrentPoolProofMismatch('Pool top-up requires management calldata.');
  const name = phase === 'pool-preview' ? 'previewPoolFunding' : 'createPoolPosition';
  const prepared = isPrepared;
  const profile = prepared ? preparedAbi : abi;
  const decoded = profile.decodeFunctionData(name, data), offset = prepared ? 1 : 0;
  if (!same(profile.encodeFunctionData(name, decoded), data) ||
      (prepared && (!preparedScope!.candidate.pairs.some(pair => same(pair.marketId, decoded[0])) ||
        (marketId !== undefined && !same(decoded[0], marketId)))) ||
      (phase === 'pool-preview' ? decoded[offset] < 0n || (!prepared && decoded[offset] !== 0n) ||
        expected?.mode === 'creation' && decoded[offset] !== 0n || expected?.mode === 'top-up' && (decoded[offset] <= 0n || decoded[offset] !== expected.positionId) : !/^0x[0-9a-fA-F]{64}$/.test(decoded[offset]) || BigInt(decoded[offset]) === 0n ||
        (context !== undefined && !same(decoded[offset], context)))) throw new CurrentPoolProofMismatch('Pool call differs from its prepared action.');
  if (phase === 'pool-preview' && decoded[offset] > 0n) {
    const coder = AbiCoder.defaultAbiCoder();
    const types = ['tuple(tuple(uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature)[2]', 'tuple(uint256 ciphertext,bytes signature)[2]'];
    const funding = coder.decode(types, decoded[offset + 1]);
    if (!prepared || !same(coder.encode(types, funding), decoded[offset + 1]) ||
        [...funding[0], ...funding[1]].some(input => !/^0x[0-9a-fA-F]{130}$/.test(input.signature))) {
      throw new CurrentPoolProofMismatch('Pool top-up preview has invalid canonical inputs.');
    }
  }
  return Object.freeze({ mode: phase === 'pool-preview' && decoded[offset] > 0n ? 'top-up' as const : 'creation' as const,
    positionId: phase === 'pool-preview' ? decoded[offset] as bigint : 0n });
  } catch (error) {
    if (isKnownCurrentPoolProofMismatch(error)) throw error;
    throw new CurrentPoolProofMismatch('Pool call has invalid canonical calldata.');
  }
};

// Reuse the swap nonce/canonical boundary and its single public pending record.
// This adapter does not enable a UI action or prove the bounded gas profile fits natively.
export const createCurrentPoolSubmissionAdapter = ({ signer, ownerAddress, chainId, transport, attest, requireFunding, candidate: candidateKey = 'cheap-current',
  nativePoolProfile, now = () => BigInt(Math.floor(Date.now() / 1000)) }: {
  signer: object; ownerAddress: string; chainId: bigint; transport: CurrentTransport;
  attest: (head: Pick<Head, 'number' | 'hash'>) => Promise<void>;
  requireFunding: (prepared: Funding, head: Head) => Promise<void>;
  now?: () => bigint; candidate?: CurrentCheapDexCandidateKey; nativePoolProfile?: typeof CURRENT_NATIVE_POOL_PROFILE;
}) => {
  const candidate = resolveCurrentCheapDexCandidate(candidateKey);
  const preparedScope = candidateKey === 'cheap-prepared' || candidateKey === 'cheap-exit' || candidateKey === 'cheap-history' ? resolvePreparedDexScope(candidateKey) : null;
  const owner = getAddress(ownerAddress), core = getAddress(candidate.core), storage = currentDexPendingStorage();
  if (chainId !== BigInt(candidate.chainId) || BigInt(owner) === 0n) throw new Error('Wrong Pool owner or chain.');
  let keys = reservations.get(signer);
  if (!keys) { keys = new Set(); reservations.set(signer, keys); }
  const boundary = createCurrentAttemptBoundary({ storage, c: candidate, core, owner, chainId, transport, attest, now, historical: false,
    canonicalIndexProof: preparedScope !== null });
  const submit = async <T extends Prepared, R>(phase: Phase, prepared: T, read: (hash: string) => Promise<R | null>, mode: Mode = 'creation') => {
    const validate = async () => {
      assertCurrentPoolFundingPrepared(prepared, signer);
      await prepared.assertCurrent();
      if (prepared.chainId !== chainId || !same(prepared.from, owner) || !same(prepared.to, core) || prepared.value !== 0n ||
          prepared.graph !== candidate.graph || prepared.packageSha256 !== candidate.packageSha256 || prepared.readyToSign !== false ||
          (phase === 'pool-preview' ? !('readPreview' in prepared) : !('readFunding' in prepared))) {
        throw new Error('Pool preparation differs from its owner candidate.');
      }
      if (preparedScope !== null) {
        const pair = preparedScope!.candidate.pairs.find(pair => same(pair.marketId, prepared.intent.marketId));
        if (!pair || prepared.intent.poolTokens.length !== 2 ||
            !pair.tokens.every((token, index) => same(token, prepared.intent.poolTokens[index]))) throw new CurrentPoolProofMismatch('Pool prepared pair differs from its selected market.');
      }
      if (mode === 'top-up' && (preparedScope === null || !('positionId' in prepared) || !('ownerContext' in prepared))) {
        throw new CurrentPoolProofMismatch('Pool top-up needs its exact prepared position identity.');
      }
      checkCall(phase, prepared.data, candidate, 'previewContext' in prepared ? prepared.previewContext : undefined, prepared.intent.marketId,
        { mode, positionId: 'positionId' in prepared ? prepared.positionId : undefined,
          ownerContext: 'ownerContext' in prepared ? prepared.ownerContext : undefined,
          previewData: 'previewData' in prepared ? prepared.previewData : undefined });
    };
    const admission = () => {
      if (!isCurrentNativeSwapCandidate(candidate)) return assertCurrentPoolFundingNativeAdmission(candidate, mode);
      if (phase === 'pool-preview') admitCurrentNativePoolPreview(candidate, prepared as CurrentPoolPreparedPreview, signer, nativePoolProfile ?? '');
      else admitCurrentNativePoolFunding(candidate, prepared as CurrentPoolPreparedFunding, signer, nativePoolProfile ?? '');
    };
    await validate(); admission();
    const call = Object.freeze({ chainId, from: owner, to: core, value: 0n, data: prepared.data });
    const key = `${phase}:${keccak256(call.data).toLowerCase()}`;
    const budget = isCurrentNativeSwapCandidate(candidate) ? currentNativeSigningBudget(signer, owner, now) : null;
    const financialProof = !!budget || preparedScope !== null;
    const scope = !budget || phase === 'pool-preview' ? key : `pool-preview:${keccak256((prepared as CurrentPoolPreparedFunding).previewData).toLowerCase()}`;
    const validateProfile = async () => {
      if (!budget) return;
      assertCurrentNativePoolProfile(candidate, prepared as CurrentPoolPreparedPreview | CurrentPoolPreparedFunding, signer, nativePoolProfile ?? '');
      budget.check(phase, key, gasCap, scope);
      await validate();
      if (!transport.readNativeResources) throw new Error('Native Pool resources are unavailable.');
      const head = await boundary.currentHead(undefined, gasCap), resources = await transport.readNativeResources(head);
      await prepared.assertCurrent();
      if (resources.balance < budget.snapshot().poolRemainingNormalWei + budget.snapshot().poolRemainingTailWei +
          CURRENT_NATIVE_POOL_LIMITS.payerReserveWei) throw new Error('Native Pool remaining commitments and recovery reserve exceed payer resources.');
      budget.check(phase, key, gasCap, scope);
    };
    await validateProfile();
    const sourceFit = budget && phase === 'pool-fund' ? issueCurrentNativePoolSourceFit(candidate,
      prepared as CurrentPoolPreparedFunding, signer, nativePoolProfile ?? '', now, budget.snapshot().normalExpiresAt!) : undefined;
    boundary.requireEmptyPending();
    if (keys!.has(key)) throw new Error('Pool action was already submitted. Recover it instead.');
    keys!.add(key);
    let signing = false;
    try {
      const sent = await boundary.sendCurrent(phase, call, undefined, async () => {
        await validate(); admission();
        await validateProfile();
        if (prepared.data !== call.data) throw new Error('Pool preparation changed before signing.');
        if (phase === 'pool-fund') {if(financialProof)await (prepared as Funding).assertBeforeFunding();
          await requireFunding(prepared as Funding, await boundary.currentHead(undefined, gasCap));}
        await validate(); admission();
      }, () => { signing = true; }, undefined, gasCap, undefined,
      async request => { await validateProfile();
        if (mode === 'top-up') {
          admission(); await validate();
          const estimate = await transport.estimateGas(request); await transport.assertCurrent();
          if (typeof estimate !== 'bigint' || estimate <= 0n || (estimate * 5n + 3n) / 4n + 1_000_000n > gasCap) {
            throw new Error('Pool top-up strict estimate and headroom exceed gas cap.');
          }
          admission(); await validate();
        }
        if(financialProof&&phase==='pool-fund'){
        await (prepared as Funding).assertBeforeFunding();
        await requireFunding(prepared as Funding,await boundary.currentHead(undefined,gasCap));}
        budget?.commit(phase, key, gasCap, scope); }, sourceFit, undefined, undefined, undefined, undefined,
        candidateKey === 'cheap-history' ? { kind: 'funding', prepared, signer } : undefined);
      // The journal is public metadata only; private read authority stays in this closure.
      const result = Object.freeze({ ...sent, status: phase === 'pool-preview' ? 'preview-pending' as const : 'funding-pending' as const,
        recover: async () => {
          const pending = boundary.pending();
          if (!pending || pending.chainId !== chainId.toString() || !same(pending.owner, owner) || !same(pending.core, core) || pending.graph !== `0x${candidate.graph}` || pending.phase !== phase || pending.callHash !== keccak256(call.data).toLowerCase() || pending.nonce !== sent.request.nonce) {
            throw new Error('Pool pending attempt changed; reconcile manually.');
          }
          if (pending.verificationBlocked) throw new Error('Known Pool verification failure. Manual reconciliation is required.');
          boundary.requireOwnPending(pending, sent.transactionHash);
          const observed = financialProof ? await transport.waitForReceipt(sent.transactionHash) : null;
          const baseline = observed && snapshotReceipt(observed);
          let canonical: ReturnType<typeof snapshotReceipt>;
          try {
            canonical = snapshotReceipt(await boundary.verifyMinedCall(sent.request, sent.transactionHash));
            if (baseline && JSON.stringify(baseline) !== JSON.stringify(canonical)) throw new CurrentPoolProofMismatch('Pool receipt changed during canonical verification.');
          } catch (error) { if (financialProof && baseline && isKnownCurrentPoolProofMismatch(error)) blockCurrentPoolVerification(storage, boundary.requireOwnPending(pending, sent.transactionHash)); throw error; }
          await validate();
          let result: R | null;
          try { result = await read(sent.transactionHash); }
          catch (error) { if (financialProof && isKnownCurrentPoolProofMismatch(error)) blockCurrentPoolVerification(storage, boundary.requireOwnPending(pending, sent.transactionHash)); throw error; }
          await prepared.assertCurrent();
          if (!result) throw new Error('Pool private result is not available.');
          try { await boundary.recheckMinedCall(sent.request, sent.transactionHash, canonical); }
          catch (error) { if (financialProof && isKnownCurrentPoolProofMismatch(error)) blockCurrentPoolVerification(storage, boundary.requireOwnPending(pending, sent.transactionHash)); throw error; }
          clearCurrentDexPendingAttempt(storage, boundary.requireOwnPending(pending, sent.transactionHash));
          if(budget&&phase==='pool-preview')currentNativePoolSession(signer)!.previewResult=result as unknown as import('./currentDexNativePoolPolicy').CurrentNativePoolPreviewResult;
          if (budget && phase === 'pool-fund') recordCurrentNativePoolOutcome(signer, scope, 'funded');
          return result;
        } });
      if(financialProof){let recoveries=fundingRecoveries.get(signer);if(!recoveries){recoveries=new Map();fundingRecoveries.set(signer,recoveries);}recoveries.set(key,result.recover);}
      return result;
    } catch (error) {
      if (!signing) keys!.delete(key);
      throw error;
    }
  };
  return Object.freeze({
    submitPoolPreview: (prepared: CurrentPoolPreparedPreview) => submit('pool-preview', prepared, prepared.readPreview),
    submitPoolFunding: (prepared: CurrentPoolPreparedFunding) => submit('pool-fund', prepared, prepared.readFunding),
    submitPoolTopUpPreview: (prepared: CurrentPoolPreparedTopUpPreview) => submit('pool-preview', prepared, prepared.readPreview, 'top-up'),
    submitPoolTopUpFunding: (prepared: CurrentPoolPreparedTopUpFunding) => submit('pool-fund', prepared, prepared.readFunding, 'top-up'),
    recoverCurrentPreparedPoolFundingResult: async () => {
      await transport.assertCurrent(); const pending = boundary.pending();
      if (!pending || preparedScope === null || pending.chainId !== String(chainId) ||
          !same(pending.owner, owner) || !same(pending.core, core) || pending.graph !== `0x${candidate.graph}` ||
          !['pool-preview', 'pool-fund'].includes(pending.phase)) return null;
      const recover = fundingRecoveries.get(signer)?.get(`${pending.phase}:${pending.callHash}`); return recover ? recover() : null;
    },
    recoverCurrentNativePoolFundingResult:async()=>{
      await transport.assertCurrent();const pending=boundary.pending();if(!pending||!isCurrentNativeSwapCandidate(candidate)||
        pending.chainId!==String(chainId)||!same(pending.owner,owner)||!same(pending.core,core)||pending.graph!==`0x${candidate.graph}`||
        !['pool-preview','pool-fund'].includes(pending.phase))return null;
      const recover=fundingRecoveries.get(signer)?.get(`${pending.phase}:${pending.callHash}`);return recover?recover():null;
    },
    recoverPendingPoolAttempt: async () => {
      await transport.assertCurrent();
      const pending = boundary.pending();
      if (!pending) return null;
      if (pending.chainId !== chainId.toString() || !same(pending.owner, owner) || !same(pending.core, core) ||
          pending.graph !== `0x${candidate.graph}` || (pending.phase !== 'pool-preview' && pending.phase !== 'pool-fund')) {
        throw new Error('Pending action belongs to another owner, candidate or adapter.');
      }
      if (!pending.txHash) return Object.freeze({ status: 'manual-reconciliation-required' as const, readyToSign: false as const, privateAccountingVerified: false as const });
      if (pending.verificationBlocked) return Object.freeze({ status: 'manual-reconciliation-required' as const,
        verificationBlocked: true as const, readyToSign: false as const, privateAccountingVerified: false as const });
      const transaction = await transport.readTransaction(pending.txHash);
      const receipt = await transport.waitForReceipt(pending.txHash);
      await transport.assertCurrent();
      if (!transaction || !receipt) return Object.freeze({ status: 'awaiting-chain-confirmation' as const, readyToSign: false as const, privateAccountingVerified: false as const });
      const request = Object.freeze({ chainId, from: owner, to: core, value: 0n, data: transaction.data, nonce: pending.nonce, gasLimit: gasCap });
      let canonical: ReturnType<typeof snapshotReceipt>;
      let callIdentity: ReturnType<typeof checkCall>;
      const baseline = snapshotReceipt(receipt);
      try {
        if (keccak256(transaction.data).toLowerCase() !== pending.callHash) throw new CurrentPoolProofMismatch('Pool pending calldata changed.');
        callIdentity = checkCall(pending.phase, transaction.data, candidate);
        canonical = snapshotReceipt(await boundary.verifyMinedCall(request, pending.txHash, true));
        if ((isCurrentNativeSwapCandidate(candidate) || preparedScope !== null) && JSON.stringify(baseline) !== JSON.stringify(canonical)) throw new CurrentPoolProofMismatch('Pool receipt changed during canonical verification.');
        await attest({ number: BigInt(canonical.blockNumber!), hash: canonical.blockHash! });
        await transport.assertCurrent();
        if (canonical.status === 1) {
          if (pending.phase === 'pool-preview') decodeCurrentPoolFundingEvent(canonical.logs ?? [], core, callIdentity.positionId);
          else if (callIdentity.mode === 'creation') decodeCurrentPoolClaimMint(canonical.logs ?? [], core,
            candidate.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1], owner);
        }
        await boundary.recheckMinedCall(request, pending.txHash, canonical, true);
      } catch (error) {
        if ((isCurrentNativeSwapCandidate(candidate) || preparedScope !== null) && isKnownCurrentPoolProofMismatch(error)) blockCurrentPoolVerification(storage, boundary.requireOwnPending(pending, pending.txHash));
        throw error;
      }
      clearCurrentDexPendingAttempt(storage, boundary.requireOwnPending(pending, pending.txHash));
      if (isCurrentNativeSwapCandidate(candidate) && canonical.status === 0) {
        const session = currentNativePoolSession(signer);
        if (session && session.positionId === undefined) { session.unfundedFailed = true;
          recordCurrentNativePoolOutcome(signer, session.scope, 'unfunded-failed'); }
      }
      if (canonical.status === 0) keys!.delete(`${pending.phase}:${pending.callHash}`);
      else keys!.add(`${pending.phase}:${pending.callHash}`);
      return Object.freeze({ status: canonical.status === 0 ? 'observed-reverted' as const : 'observed-mined' as const,
        phase: pending.phase, transactionHash: pending.txHash, readyToSign: false as const, privateAccountingVerified: false as const,
        ...(callIdentity.mode === 'top-up' ? { action: 'top-up' as const, positionId: callIdentity.positionId } : {}) });
    }
  });
};



