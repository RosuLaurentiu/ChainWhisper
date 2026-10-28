import { keccak256 } from '@coti-io/coti-ethers';
import { assertCurrentPoolFundingPrepared, type CurrentPoolPreparedFunding, type CurrentPoolPreparedPreview } from '../features/wallet/currentDexPoolFundingCapability';
import { STAGED_NATIVE_DEX_CANDIDATE as native, type CurrentCheapDexIdentity } from './dexV2Deployment';
import type { CurrentPoolSnapshotProducer } from './currentDexNativePoolSnapshot';

export const CURRENT_NATIVE_POOL_PROFILE = 'fa71-class0-new-claim-100-100-add-v1' as const;
export const CURRENT_NATIVE_POOL_LIMITS = Object.freeze({ gasCap: 100_000_000n, approvalCap: 5_000_000n,
  normalCommitmentWei: 10_500_000_000_000_000n, recoveryCommitmentWei: 8_000_000_000_000_000n,
  payerReserveWei: 10_000_000_000_000_000n, normalSeconds: 900n, exitSeconds: 1800n,
  snapshotCap: 30_000_000n, closeCap: 70_000_000n });
export const CURRENT_NATIVE_POOL_JOIN_CLOSE_EVIDENCE = Object.freeze({
  acceptanceSha256: '425a4eda035002242aef8194b5fdbeec73ccf0837a712cb2921ee05610668953',
  finalPacketSha256: '2957093c4f6fe084e8a93be1df4641d7bc21eff1ee0cd28bb3c72424efe5ba59',
  compiledGraphSha256: '0f49df36d325e946dfbbec002408e6b5ee1edc726f728623b86c9aa7678bfd0a',
  scope: 'class0-new-claim-100-100-join-direct-close-signed-snapshots',
  globalLedgerIndependentlyDecrypted: false, connectedWalletProof: false });
export type CurrentNativePoolPreviewResult=NonNullable<Awaited<ReturnType<CurrentPoolPreparedPreview['readPreview']>>>;
type PoolSession = { candidate: CurrentCheapDexIdentity; owner: string; prepared: CurrentPoolPreparedPreview;
  previewResult?:CurrentNativePoolPreviewResult;
  scope: string; funded?: CurrentPoolPreparedFunding; positionId?: bigint; producer?: CurrentPoolSnapshotProducer;
  closedPayouts?: readonly [bigint, bigint]; unfundedAbandoned?:boolean; unfundedFailed: boolean; completed: boolean };
const sessions = new WeakMap<object, PoolSession>();
// Source evidence is fixed. The live authority is issued only for authentic
// prepared objects in the selected signer session; no ready flag is consumed.
export const admitCurrentNativePoolPreview = (candidate: CurrentCheapDexIdentity, prepared: CurrentPoolPreparedPreview,
  signer: object, profile: string) => {
  assertCurrentNativePoolProfile(candidate, prepared, signer, profile);
  let session = sessions.get(signer);
  if (!session) { session = { candidate, owner: prepared.from.toLowerCase(), prepared,
    scope: `pool-preview:${keccak256(prepared.data).toLowerCase()}`, unfundedFailed: false, completed: false }; sessions.set(signer, session); }
  if (session.prepared !== prepared || session.completed || session.unfundedFailed) throw new Error('Native Pool session was already started or stopped.');
  return session.scope;
};
export const currentNativePoolSession = (signer: object) => sessions.get(signer);
export const requireCurrentNativePoolSession = (signer: object, owner: string, candidate: CurrentCheapDexIdentity) => {
  const session = sessions.get(signer);
  if (!session || session.owner !== owner.toLowerCase() || JSON.stringify(session.candidate) !== JSON.stringify(candidate) || session.completed) {
    throw new Error('An issued current native Pool session is required.');
  }
  return session;
};
export const admitCurrentNativePoolFunding = (candidate: CurrentCheapDexIdentity, prepared: CurrentPoolPreparedFunding,
  signer: object, profile: string) => {
  assertCurrentNativePoolProfile(candidate, prepared, signer, profile);
  const session = requireCurrentNativePoolSession(signer, prepared.from, candidate);
  if (prepared.previewData !== session.prepared.data || session.unfundedFailed || session.positionId !== undefined ||
      (session.funded && session.funded !== prepared)) throw new Error('Funding differs from the admitted native Pool preview.');
  session.funded = prepared; return session.scope;
};
export const CURRENT_NATIVE_POOL_SOURCE = Object.freeze({
  compiledGraphSha256: '0f49df36d325e946dfbbec002408e6b5ee1edc726f728623b86c9aa7678bfd0a',
  sourceSha256: '2e6f58028244ec24827611a331550033cabd17791a9fd2d4efd4308b84a594c0',
  fixtureSha256: '06b36aed41c1b1e7121dddf2690fbb4973b2e2a8f240c521371613456f41d06c',
  resultSha256: '2ba16a75c6763672488a4fb0f5585639ca1e8c84b0ff357291c0638e87e41e90',
  measuredFundingGas: 64_378_987n, fundingWithMargin: 81_473_733n });
const terms = [1n, 2n, 1n, 0n, 1001n, 1000n, 1n, 1n, 1n, 200n], budget = 100n * 10n ** 18n;
type Prepared = CurrentPoolPreparedPreview | CurrentPoolPreparedFunding;
export const assertCurrentNativePoolProfile = (candidate: CurrentCheapDexIdentity, prepared: Prepared, signer: object, profile: string) => {
  assertCurrentPoolFundingPrepared(prepared, signer);
  const i = prepared.intent;
  if (profile !== CURRENT_NATIVE_POOL_PROFILE || JSON.stringify(candidate) !== JSON.stringify(native) ||
      prepared.graph !== native.graph || prepared.packageSha256 !== native.packageSha256 || prepared.chainId !== BigInt(native.chainId) ||
      prepared.to.toLowerCase() !== native.core || i.core.toLowerCase() !== native.core || i.principal.toLowerCase() !== prepared.from.toLowerCase() ||
      i.chainId !== prepared.chainId || prepared.value !== 0n || prepared.readyToSign !== false ||
      i.classId !== 0n || i.budgets.length !== 2 || i.budgets.some(value => value !== budget) ||
      i.terms.length !== terms.length || i.terms.some((value, index) => value !== terms[index])) {
    throw new Error('Native Pool profile differs from its exact candidate, session or intent.');
  }
  if ('amounts' in prepared) {
    const a = prepared.amounts;
    if (a.operation !== 'add' || a.classId !== 0n || a.used0 <= 0n || a.used1 <= 0n || a.unused0 < 0n || a.unused1 < 0n ||
        a.used0 + a.unused0 !== budget || a.used1 + a.unused1 !== budget || a.mintedShares <= 0n || a.ownedShares !== a.mintedShares ||
        a.toleranceN !== 1n || a.toleranceD !== 200n ||
        !/^0x[0-9a-fA-F]{64}$/.test(prepared.previewTransactionHash) || BigInt(prepared.previewTransactionHash) === 0n ||
        !/^0x[0-9a-fA-F]{64}$/.test(prepared.previewContext) || BigInt(prepared.previewContext) === 0n) {
      throw new Error('Native Pool profile needs an exact positive new-claim add preview.');
    }
  }
};

// This is fit evidence only. It does not open the separate native admission gate.
// The issuer brand binds ciphertext preservation and selector re-signing to its preview.
const fits = new WeakMap<object, { prepared: CurrentPoolPreparedFunding; signer: object; candidate: CurrentCheapDexIdentity;
  data: string; context: string; preview: string; expires: bigint; now: () => bigint; profile: string }>();
export type CurrentNativePoolSourceFit = Readonly<{ profile: typeof CURRENT_NATIVE_POOL_PROFILE; phase: 'pool-fund';
  calldataHash: string; gasCap: bigint; evidence: typeof CURRENT_NATIVE_POOL_SOURCE }>;
export const issueCurrentNativePoolSourceFit = (candidate: CurrentCheapDexIdentity, prepared: CurrentPoolPreparedFunding,
  signer: object, profile: string, now: () => bigint, expires: bigint): CurrentNativePoolSourceFit => {
  assertCurrentNativePoolProfile(candidate, prepared, signer, profile);
  if (expires <= now() || expires - now() > CURRENT_NATIVE_POOL_LIMITS.normalSeconds) throw new Error('Native Pool fit lifetime is invalid.');
  const fit = Object.freeze({ profile: CURRENT_NATIVE_POOL_PROFILE, phase: 'pool-fund' as const,
    calldataHash: keccak256(prepared.data), gasCap: CURRENT_NATIVE_POOL_LIMITS.gasCap, evidence: CURRENT_NATIVE_POOL_SOURCE });
  fits.set(fit, { prepared, signer, candidate, data: prepared.data, context: prepared.previewContext,
    preview: prepared.previewTransactionHash, expires, now, profile });
  return fit;
};
export const assertCurrentNativePoolSourceFitBinding = (fit: CurrentNativePoolSourceFit, phase: string, data: string, gasCap: bigint,
  candidate: { graph: string }, owner: string, core: string, chainId: bigint) => {
  const b = fits.get(fit);
  if (!b || phase !== 'pool-fund' || gasCap !== fit.gasCap || gasCap !== 100_000_000n || data !== b.data ||
      JSON.stringify(candidate) !== JSON.stringify(b.candidate) || b.prepared.from.toLowerCase() !== owner.toLowerCase() ||
      b.prepared.to.toLowerCase() !== core.toLowerCase() || b.prepared.chainId !== chainId || b.now() >= b.expires ||
      b.prepared.data !== b.data || b.prepared.previewContext !== b.context || b.prepared.previewTransactionHash !== b.preview) {
    throw new Error('Native Pool source fit is absent, changed, expired or belongs to another call.');
  }
  assertCurrentNativePoolProfile(b.candidate, b.prepared, b.signer, b.profile);
  return b;
};
export const assertCurrentNativePoolSourceFit = async (...args: Parameters<typeof assertCurrentNativePoolSourceFitBinding>) => {
  const b = assertCurrentNativePoolSourceFitBinding(...args);
  await b.prepared.assertCurrent();
  assertCurrentNativePoolSourceFitBinding(...args);
};
