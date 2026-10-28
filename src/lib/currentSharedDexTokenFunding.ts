import { Interface, getAddress, keccak256 } from '@coti-io/coti-ethers';
import { resolveCurrentSharedTokenDistribution, CURRENT_SHARED_DEX_TOKENS } from './currentSharedDexTokenDistribution';
import type { CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { assertCurrentAppInitialClaimAuthority, assertCurrentAppSharedFundingAuthority, assertCurrentAppLimitAuthority, assertCurrentAppPoolAuthority, assertCurrentAppPoolAllowanceCleanupAuthority, isCurrentAppCanonicalClaimRepair } from './currentDexC1SwapPolicy';
import type { readCurrentSharedDexTokenFunds } from './currentSharedDexTokenFunds';
import { createCurrentAttemptBoundary, CURRENT_NATIVE_RECOVERY_RESERVE, type CurrentTransport, type CurrentCheapDexPreparedQuote } from './currentDexSubmission';
import { currentDexPendingStorage, clearCurrentDexPendingAttempt, blockCurrentTokenFundingVerification, recordCurrentDexPendingHash } from './currentDexPendingAttempt';
import type { PrivateUint256Input, PrivateUint256Output } from './privateUint256';
import { currentTokenFundingAbi } from './currentDexTokenFunding';
import { assertCurrentPoolFundingPrepared, type CurrentPoolPreparedFunding, type CurrentPoolPreparedTopUpFunding } from '../features/wallet/currentDexPoolFundingCapability';
import { currentSwapFixedGasPrice } from './currentDexExitSwapPolicy';
import { assertCurrentLimitPrepared, type CurrentLimitFundingReview } from '../features/wallet/currentDexLimitCapability';

type PoolFunding = CurrentPoolPreparedFunding | CurrentPoolPreparedTopUpFunding;

const ct = '(uint256 ciphertextHigh,uint256 ciphertextLow)';
export const currentSharedTokenFundingAbi = new Interface([
  'function claimFaucet()', 'function claim(address token)',
  'event FaucetClaimed(address indexed account)', 'event Claimed(address indexed token,address indexed account)',
  `event Transfer(address indexed from,address indexed to,${ct} senderValue,${ct} receiverValue)`
]);
export const CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP = 5_000_000n;
export const CURRENT_SHARED_SWAP_APPROVAL_MAXIMUM = (1n << 256n) - 1n;
export const assertCurrentSharedTokenFundingAppAuthority = (value?: unknown): void => {
  const scope=value&&typeof value==='object'?value as {candidate?:string;owner?:string;token?:string;action?:string}:undefined;
  if(!scope || scope.candidate!=='cheap-exit'&&scope.candidate!=='cheap-history'||typeof scope.owner!=='string'||typeof scope.token!=='string'||typeof scope.action!=='string')
    throw new Error('Beta token signing is held: connected App-wallet trial remains inactive.');
  if(scope.candidate==='cheap-history')return assertCurrentAppSharedFundingAuthority(resolvePreparedDexScope(scope.candidate).candidate.graph,scope.owner,scope.token,scope.action);
  assertCurrentAppInitialClaimAuthority(resolvePreparedDexScope(scope.candidate).candidate.graph,scope.owner,scope.token,scope.action);
};
type Head = Awaited<ReturnType<CurrentTransport['readHead']>>;
type Funds = Awaited<ReturnType<typeof readCurrentSharedDexTokenFunds>>;
export type CurrentSharedTokenFundingAction = 'initial' | 'refill';
export type CurrentSharedTokenFundingPrepared = Readonly<{ action: CurrentSharedTokenFundingAction; token: string;
  amount: bigint; to: string; data: string; core: string; graph: string; packageSha256: string; readyToSign: false }>;
export type CurrentSharedTokenFundingReview = CurrentSharedTokenFundingPrepared & Readonly<{
  decimals: 6; cooldown: bigint; expiresAt: bigint; gasEstimate: bigint; gasPrice: bigint; gasLimit: bigint
}>;
export type CurrentSharedPoolApprovalPrepared = Readonly<{ token: string; amount: bigint; data: string;
  cleanup: boolean; recovery?: true; marketId: string; canonicalIndex: 0 | 1; core: string; graph: string; packageSha256: string; readyToSign: false }>;
export type CurrentSharedPoolAllowanceCleanupBinding = Readonly<{ kind: 'allowance-cleanup'; graph: string; packageSha256: string;
  chainId: bigint; from: string; to: string; core: string; marketId: string; poolTokens: readonly [string, string];
  assertCurrent: () => Promise<void>; readyToSign: false }>;
type PoolApprovalBinding = PoolFunding | CurrentSharedPoolAllowanceCleanupBinding;
const isAllowanceCleanup = (binding: PoolApprovalBinding): binding is CurrentSharedPoolAllowanceCleanupBinding => 'kind' in binding && binding.kind === 'allowance-cleanup';
const poolApprovalSessions = new WeakMap<object, { signer: object; funding: PoolApprovalBinding }>();
export const assertCurrentSharedPoolApprovalPrepared = (prepared: CurrentSharedPoolApprovalPrepared, signer: object) => {
  const issued = poolApprovalSessions.get(prepared);
  if (!issued || issued.signer !== signer) throw new Error('Pool approval was not prepared in this wallet session.');
  if (!isAllowanceCleanup(issued.funding)) assertCurrentPoolFundingPrepared(issued.funding, signer);
  return issued.funding;
};
export type CurrentSharedSwapApprovalReview = Readonly<{ candidate: CurrentCheapDexCandidateKey; owner: string; token: string;
  spender: string; amount: bigint; core: string; graph: string; packageSha256: string }>;
export type CurrentSharedSwapApprovalPrepared = CurrentSharedSwapApprovalReview & Readonly<{ data: string; readyToSign: false }>;
export type CurrentSharedLimitApprovalPrepared = Readonly<{ kind: 'create' | 'topup'; marketId: string;
  token: string; amount: bigint; data: string; core: string; graph: string; packageSha256: string; readyToSign: false }>;
type Request = Parameters<CurrentTransport['send']>[0];
type Receipt = NonNullable<Awaited<ReturnType<CurrentTransport['waitForReceipt']>>>;
const same = (a: string | null | undefined, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
const zero = `0x${'00'.repeat(20)}`;
const snapshotReceipt = (r: Receipt): Receipt => Object.freeze({ ...r,
  logs: r.logs && Object.freeze(r.logs.map(log => Object.freeze({ ...log, topics: Object.freeze([...log.topics]) }))) });
const tokenKeys = ['address', 'symbol', 'decimals', 'balance', 'allowance', 'encryptionAddress', 'claimed', 'quota', 'nextClaimAt', 'initialAmount', 'refillAmount'] as const;
const equalToken = (a: Funds['tokens'][number], b: Funds['tokens'][number]) => tokenKeys.every(k => a[k] === b[k]);
class FundingProofError extends Error {}
const knownProofFailure = (error: unknown) => error instanceof FundingProofError || error instanceof Error && (
  error.message.startsWith('Wallet returned a transaction outside the reviewed DEX call.') || [
    'Current DEX mined transaction changed.', 'Current DEX mined block changed.',
    'Current DEX canonical transaction inclusion changed. Do not resend.',
    'Private beta funds have no owner envelope.', 'Beta token balance uses another encryption recipient.',
    'Invalid private beta funds.'
  ].includes(error.message));
const prunedState = (error: unknown) => {
  const rpcMessage = (error as { info?: { error?: { message?: unknown } } } | null)?.info?.error?.message;
  return error instanceof Error && error.message.includes('missing trie node') || typeof rpcMessage === 'string' && rpcMessage.includes('missing trie node');
};

// Reuse the owner transport and one shared pending record. Admission is supplied
// by the exact consumer; the App consumer keeps its explicit owner hold.
export const createCurrentSharedDexTokenFundingAdapter = ({ candidate = 'cheap-prepared', signer, ownerAddress, chainId, transport,
  readFunds, readReceiptBlock, decrypt, encrypt, assertAdmission, assertApprovalAdmission = assertCurrentSharedTokenFundingAppAuthority,
  assertSwapApprovalAdmission = assertCurrentSharedTokenFundingAppAuthority,
  authorizeSwapApprovalSigning, authorizeInitialClaimSigning, rememberSwapApprovalHash,
  now = () => BigInt(Math.floor(Date.now() / 1000)) }: {
  candidate?: CurrentCheapDexCandidateKey; signer: object; ownerAddress: string; chainId: bigint; transport: CurrentTransport;
  readFunds: (head: Head) => Promise<Funds>; readReceiptBlock: (number: number) => Promise<Head>;
  decrypt: (cipher: PrivateUint256Output) => bigint;
  encrypt?: (amount: bigint, token: string, selector: string) => Promise<PrivateUint256Input>;
  assertApprovalAdmission?: () => void | Promise<void>;
  assertSwapApprovalAdmission?: (review: CurrentSharedSwapApprovalReview, preparedQuote?: CurrentCheapDexPreparedQuote) => void | Promise<void>;
  authorizeSwapApprovalSigning?: (preparedQuote: CurrentCheapDexPreparedQuote, request: Request) => Promise<void>;
  authorizeInitialClaimSigning?: (request: Request) => Promise<void>;
  rememberSwapApprovalHash?: (sent: {request: Request;transactionHash:string}) => Promise<void>;
  assertAdmission: (action: CurrentSharedTokenFundingAction, token: string, preparedQuote?: CurrentCheapDexPreparedQuote) => void | Promise<void>; now?: () => bigint;
}) => {
  const policy = resolveCurrentSharedTokenDistribution(candidate), fixedGasPrice = currentSwapFixedGasPrice(policy);
  const identity = Object.freeze({ core: policy.core, graph: policy.graph, packageSha256: policy.packageSha256 });
  const owner = getAddress(ownerAddress), storage = currentDexPendingStorage();
  if (!signer || chainId !== policy.chainId || same(owner, zero)) throw new Error('Wrong beta funding owner or Testnet chain.');
  const preparations = new WeakMap<object, { before: Funds; deadline: bigint; preparedQuote?: CurrentCheapDexPreparedQuote }>(), used = new WeakSet<object>();
  const inspect = async (head: Head): Promise<Funds> => {
    await transport.assertCurrent(); const funds = await readFunds(head); await transport.assertCurrent();
    if (!same(funds.owner, owner) || !same(funds.core, policy.core) || funds.graph !== policy.graph || funds.packageSha256 !== policy.packageSha256 ||
      funds.head.number !== head.number || !same(funds.head.hash, head.hash) || funds.head.timestamp !== head.timestamp ||
      funds.privateFundsVerified !== true || funds.readyToSign !== false || funds.tokens.length !== 4 ||
      funds.tokens.some((t, i) => !same(t.address, CURRENT_SHARED_DEX_TOKENS[i].address) || t.decimals !== 6 ||
        typeof t.balance !== 'bigint' || t.balance < 0n || typeof t.allowance !== 'bigint' || t.allowance < 0n)) {
      throw new FundingProofError('Beta private funding identity or state changed.');
    }
    return funds;
  };
  const b = createCurrentAttemptBoundary({ storage, c: policy, core: policy.core, owner, chainId, transport,
    attest: async head => { await inspect(head); }, now, bindTarget: true });
  const indexOf = (token: string) => {
    const i = CURRENT_SHARED_DEX_TOKENS.findIndex(t => same(t.address, token));
    if (i < 0) throw new FundingProofError('Not a beta test token.'); return i;
  };
  const shape = (action: CurrentSharedTokenFundingAction, token: string) => {
    indexOf(token); if (action !== 'initial' && action !== 'refill') throw new FundingProofError('Invalid beta token action.');
    return { to: action === 'initial' ? getAddress(token) : policy.vault.address,
      data: currentSharedTokenFundingAbi.encodeFunctionData(action === 'initial' ? 'claimFaucet' : 'claim', action === 'initial' ? [] : [token]),
      amount: action === 'initial' ? policy.initialAmount : policy.refillAmount };
  };
  const resources = async (head: Head, nonce: number) => {
    if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error('Beta funding nonce is invalid.');
    if (!transport.readNativeResources) throw new Error('Beta funding native resources are unavailable.');
    await transport.assertCurrent(); const r = await transport.readNativeResources(head); await transport.assertCurrent();
    if (!same(r.owner, owner) || r.chainId !== chainId || r.head.number !== head.number || !same(r.head.hash, head.hash) ||
      r.head.timestamp !== head.timestamp || r.head.gasLimit !== head.gasLimit || head.timestamp > now() || now() - head.timestamp >= 90n ||
      r.latestNonce !== nonce || r.pendingNonce !== nonce || r.code !== '0x' || typeof r.gasPrice !== 'bigint' || r.gasPrice <= 0n ||
      typeof r.baseFeePerGas !== 'bigint' || r.baseFeePerGas < 0n || r.baseFeePerGas > fixedGasPrice ||
      r.balance < CURRENT_NATIVE_RECOVERY_RESERVE + CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP * fixedGasPrice) {
      throw new Error('Beta funding nonce, fee, payer resources or head changed.');
    }
  };
  const validate = async (p: CurrentSharedTokenFundingPrepared, fresh: boolean) => {
    const saved = preparations.get(p);
    if (!saved || p.readyToSign !== false || !same(p.core, policy.core) || p.graph !== policy.graph || p.packageSha256 !== policy.packageSha256) throw new FundingProofError('Beta funding preparation or session changed.');
    const call = shape(p.action, p.token);
    if (!same(p.to, call.to) || !same(p.data, call.data) || p.amount !== call.amount) throw new FundingProofError('Beta funding call changed.');
    await transport.assertCurrent();
    if (!same(await transport.readBlockHash(Number(saved.before.head.number)), saved.before.head.hash)) throw new FundingProofError('Beta funding review block changed.');
    let gasEstimate: bigint | undefined;
    if (fresh) {
      await assertAdmission(p.action, p.token, preparations.get(p)?.preparedQuote);
      const head = await b.currentHead(saved.deadline, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP), state = await inspect(head), i = indexOf(p.token);
      if (!saved.before.tokens.every((t, n) => equalToken(t, state.tokens[n])) ||
        (p.action === 'initial' ? state.tokens[i].initialClaimAvailability !== 'ready' : state.tokens[i].refillAvailability !== 'ready')) {
        throw new FundingProofError('Beta funding reviewed funds or eligibility changed.');
      }
      const nonce = await transport.readNonce(); await resources(head, nonce);
      const estimate = await transport.estimateGas({ chainId, from: owner, to: p.to, value: 0n, data: p.data, nonce, gasPrice: fixedGasPrice });
      await transport.assertCurrent();
      if (typeof estimate !== 'bigint' || estimate <= 0n || estimate > 50_000_000n ||
        (estimate * 5n + 3n) / 4n + 1_000_000n > CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP) throw new Error('Beta funding strict estimate and headroom exceed gas cap.');
      await assertAdmission(p.action, p.token, preparations.get(p)?.preparedQuote); await transport.assertCurrent();
      gasEstimate = estimate;
    }
    return { ...saved, gasEstimate };
  };
  const eventProof = (receipt: Receipt, action: CurrentSharedTokenFundingAction, token: string) => {
    if (!receipt.logs || receipt.logs.length !== 2) throw new FundingProofError('Unexpected beta funding events.');
    let transfer = 0, claim = 0;
    for (const log of receipt.logs) {
      const event = currentSharedTokenFundingAbi.parseLog({ ...log, topics: [...log.topics] });
      const encoded = event && currentSharedTokenFundingAbi.encodeEventLog(event.fragment, event.args);
      if (!event || !encoded || !same(encoded.data, log.data) || encoded.topics.length !== log.topics.length || encoded.topics.some((t, i) => !same(t, log.topics[i]))) throw new FundingProofError('Non-canonical beta funding event.');
      if (event.name === 'Transfer' && same(log.address, token) && same(event.args.from, action === 'initial' ? zero : policy.vault.address) && same(event.args.to, owner)) {
        let amount: bigint; try { amount = decrypt(event.args.receiverValue); } catch { throw new FundingProofError('Beta funding private event is unavailable.'); }
        if (amount !== shape(action, token).amount) throw new FundingProofError('Wrong private beta funding credit.'); transfer++;
      } else if (action === 'initial' && event.name === 'FaucetClaimed' && same(log.address, token) && same(event.args.account, owner)) claim++;
      else if (action === 'refill' && event.name === 'Claimed' && same(log.address, policy.vault.address) && same(event.args.token, token) && same(event.args.account, owner)) claim++;
      else throw new FundingProofError('Wrong beta funding event or recipient.');
    }
    if (claim !== 1 || transfer !== 1) throw new FundingProofError('Duplicate or missing beta funding event.');
  };
  const canonical = async (request: Request, hash: string) => {
    const tx = await transport.readTransaction(hash);
    if (!tx || !transport.verifyCanonicalInclusion) throw new Error('Beta funding canonical inclusion is unavailable.');
    if (tx.gasLimit !== request.gasLimit) throw new FundingProofError('Beta funding mined gas cap changed.');
    const receipt = snapshotReceipt(await b.verifyMinedCall(request, hash, true));
    await transport.verifyCanonicalInclusion(tx, receipt); await transport.assertCurrent();
    return receipt;
  };
  const prove = async (request: Request, hash: string, action: CurrentSharedTokenFundingAction, token: string, before?: Funds) => {
    const receipt = await canonical(request, hash), head = await readReceiptBlock(receipt.blockNumber!);
    if (head.number !== BigInt(receipt.blockNumber!) || !same(head.hash, receipt.blockHash!) || head.timestamp > now() ||
      before && head.timestamp < before.head.timestamp) throw new FundingProofError('Beta funding receipt block changed.');
    // Reload proves the private receipt credit and reads current funds, not a historical balance delta.
    const after = await inspect(before ? head : await b.currentHead(undefined, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP));
    if (receipt.status === 0) {
      if (!receipt.logs || receipt.logs.length || before && !before.tokens.every((t, i) => equalToken(t, after.tokens[i]))) throw new FundingProofError('Reverted beta funding did not roll back exactly.');
    } else {
      if (action === 'refill' && head.timestamp >= policy.vault.expiresAt) throw new FundingProofError('Beta refill mined after expiry.');
      try { eventProof(receipt, action, token); } catch { throw new FundingProofError('Beta funding event or private credit proof failed.'); }
      if (before) {
        const i = indexOf(token), expected = { ...before.tokens[i], balance: before.tokens[i].balance + shape(action, token).amount,
          ...(action === 'initial' ? { claimed: true } : { quota: before.tokens[i].quota - policy.refillAmount, nextClaimAt: head.timestamp + policy.cooldown }) };
        if (!after.tokens.every((t, n) => equalToken(t, n === i ? expected : before.tokens[n]))) throw new FundingProofError('Beta funding private accounting, allowance or policy differs.');
      }
    }
    if (JSON.stringify(await canonical(request, hash)) !== JSON.stringify(receipt)) throw new FundingProofError('Beta funding receipt changed after accounting.');
    const last = await readReceiptBlock(receipt.blockNumber!);
    if (last.number !== head.number || !same(last.hash, head.hash) || last.timestamp !== head.timestamp) throw new FundingProofError('Beta funding receipt timestamp changed.');
    await transport.assertCurrent(); return { receipt, after };
  };
  const approvals = new WeakMap<object, { before: Funds; deadline: bigint; funding: PoolApprovalBinding }>();
  const assertPoolApprovalAdmission = (funding: PoolApprovalBinding) => {
    if (isAllowanceCleanup(funding)) return assertCurrentAppPoolAllowanceCleanupAuthority(policy.graph, owner);
    if (candidate !== 'cheap-history') return assertApprovalAdmission();
    assertCurrentPoolFundingPrepared(funding, signer);
    const topUp = 'positionId' in funding;
    assertCurrentAppPoolAuthority(policy.graph, { owner, action: topUp ? 'approve-top-up' : 'approve-create',
      positionId: topUp ? funding.positionId : undefined, budgets: funding.intent.budgets,
      classId: funding.intent.classId, tolerance: 'tolerance' in funding.intent ? funding.intent.tolerance : [funding.intent.terms[8], funding.intent.terms[9]] });
  };
  const limitApprovals = new WeakMap<object, { before: Funds; deadline: bigint; funding: CurrentLimitFundingReview }>();
  const assertLimitApprovalAdmission = (funding: CurrentLimitFundingReview) => candidate==='cheap-history'
    ?assertCurrentAppLimitAuthority(policy.graph,{owner,action:`approve-${funding.kind}`,amount:funding.amount}):assertApprovalAdmission();
  const swapApprovals = new WeakMap<object, { before: Funds; deadline: bigint; assertReviewCurrent: () => void | Promise<void>; preparedQuote?: CurrentCheapDexPreparedQuote }>();
  const swapReview = (token: string, amount: bigint): CurrentSharedSwapApprovalReview => {
    if (candidate !== 'cheap-exit' && candidate !== 'cheap-history') throw new FundingProofError('Swap approval requires a supported current DEX candidate.');
    indexOf(token);
    if (typeof amount !== 'bigint' || amount <= 0n || amount >= 1n << 256n || amount > CURRENT_SHARED_SWAP_APPROVAL_MAXIMUM) throw new FundingProofError('Invalid exact swap allowance.');
    return Object.freeze({ candidate, owner, token: getAddress(token), spender: policy.core, amount, ...identity });
  };
  const requireFundingIdentity = (funding: PoolFunding) => {
    const pair = resolvePreparedDexScope(candidate).candidate.pairs.find(pair => pair.marketId === funding.intent.marketId &&
      funding.intent.poolTokens.length === 2 && pair.tokens.every((token, i) => same(funding.intent.poolTokens[i], token)));
    if (!pair || funding.graph !== policy.graph || funding.packageSha256 !== policy.packageSha256 ||
      !same(funding.intent.principal, owner) || !same(funding.intent.core, policy.core) || funding.chainId !== chainId) {
      throw new FundingProofError('Pool approval differs from its exact funding intent.');
    }
  };
  const approvalCall = (data: string) => {
    const args = currentTokenFundingAbi.decodeFunctionData('approve', data);
    if (!same(args[0], policy.core) || !same(currentTokenFundingAbi.encodeFunctionData('approve', args), data) ||
        !/^0x[0-9a-fA-F]{130}$/.test(args[1].signature)) throw new FundingProofError('Pool approval calldata changed.');
  };
  const validateApproval = async (p: CurrentSharedPoolApprovalPrepared, fresh: boolean) => {
    const saved = approvals.get(p);
    if (!saved || !same(p.core, policy.core) || p.graph !== policy.graph || p.packageSha256 !== policy.packageSha256 || p.readyToSign !== false) throw new FundingProofError('Pool approval was not prepared in this session.');
    const funding = saved.funding; await funding.assertCurrent();
    if (isAllowanceCleanup(funding)) {
      const pair = resolvePreparedDexScope(candidate).candidate.pairs.find(pair => pair.marketId === funding.marketId);
      if (candidate !== 'cheap-history' || !pair || funding.graph !== policy.graph || funding.packageSha256 !== policy.packageSha256 ||
          funding.chainId !== chainId || !same(funding.from, owner) || !same(funding.to, policy.core) || !same(funding.core, policy.core) ||
          !pair.tokens.every((token, i) => same(funding.poolTokens[i], token)) || funding.readyToSign !== false ||
          p.recovery !== true || p.cleanup !== true || p.amount !== 0n || p.marketId !== funding.marketId ||
          (p.canonicalIndex !== 0 && p.canonicalIndex !== 1) || !same(p.token, funding.poolTokens[p.canonicalIndex])) {
        throw new FundingProofError('Pool cleanup differs from its exact allowance-only binding.');
      }
    } else {
      assertCurrentPoolFundingPrepared(funding, signer); requireFundingIdentity(funding);
      if (p.recovery !== undefined || funding.graph !== policy.graph || funding.packageSha256 !== policy.packageSha256 || funding.intent.marketId !== p.marketId ||
        !same(funding.intent.principal, owner) || !same(funding.intent.core, policy.core) || funding.chainId !== chainId ||
        !same(funding.intent.poolTokens[p.canonicalIndex], p.token) ||
        p.amount !== (p.cleanup ? 0n : p.canonicalIndex === 0 ? funding.amounts.used0 : funding.amounts.used1)) throw new FundingProofError('Pool approval differs from its exact funding intent.');
    }
    approvalCall(p.data);
    if (!same(await transport.readBlockHash(Number(saved.before.head.number)), saved.before.head.hash)) throw new FundingProofError('Pool approval review block changed.');
    if (fresh) {
      await assertPoolApprovalAdmission(funding); b.requireEmptyPending();
      if (!isAllowanceCleanup(funding)) {
        if (!p.cleanup) await funding.assertApprovalCurrent();
        if (p.cleanup) await funding.assertUnfundedCleanupCurrent();
      }
      const head = await b.currentHead(saved.deadline, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP), state = await inspect(head);
      if (!state.tokens.every((t, i) => equalToken(t, saved.before.tokens[i]))) throw new FundingProofError('Pool approval private funds changed during review.');
      const nonce = await transport.readNonce(); await resources(head, nonce);
      const estimate = await transport.estimateGas({ chainId, from: owner, to: p.token, value: 0n, data: p.data, nonce, gasPrice: fixedGasPrice });
      if (typeof estimate !== 'bigint' || estimate <= 0n || (estimate * 5n + 3n) / 4n + 1_000_000n > CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP) throw new Error('Pool approval strict estimate exceeds its gas cap.');
      await assertPoolApprovalAdmission(funding); await transport.assertCurrent();
    }
    return saved;
  };
  const validateSwapApproval = async (p: CurrentSharedSwapApprovalPrepared, fresh: boolean) => {
    const saved = swapApprovals.get(p);
    if (!saved || p.readyToSign !== false || p.candidate !== candidate || !same(p.owner, owner) || !same(p.spender, policy.core) ||
        !same(p.core, policy.core) || p.graph !== policy.graph || p.packageSha256 !== policy.packageSha256) {
      throw new FundingProofError('Swap approval was not prepared in this session.');
    }
    const review = swapReview(p.token, p.amount);
    approvalCall(p.data); await transport.assertCurrent();
    if (!same(await transport.readBlockHash(Number(saved.before.head.number)), saved.before.head.hash)) throw new FundingProofError('Swap approval review block changed.');
    if (fresh) {
      await assertSwapApprovalAdmission(review, saved.preparedQuote); b.requireEmptyPending(); await saved.assertReviewCurrent();
      const head = await b.currentHead(saved.deadline, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP), state = await inspect(head), index = indexOf(p.token);
      if (!state.tokens.every((t, i) => equalToken(t, saved.before.tokens[i])) || state.tokens[index].balance < p.amount || state.tokens[index].allowance !== 0n) {
        throw new FundingProofError('Swap approval private funds changed during review.');
      }
      const nonce = await transport.readNonce(); await resources(head, nonce);
      const estimate = await transport.estimateGas({ chainId, from: owner, to: p.token, value: 0n, data: p.data, nonce, gasPrice: fixedGasPrice });
      if (typeof estimate !== 'bigint' || estimate <= 0n || (estimate * 5n + 3n) / 4n + 1_000_000n > CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP) {
        throw new Error('Swap approval strict estimate exceeds its gas cap.');
      }
      await saved.assertReviewCurrent(); await assertSwapApprovalAdmission(review, saved.preparedQuote); await transport.assertCurrent();
    }
    return saved;
  };
  const requireLimitFundingIdentity = (funding: CurrentLimitFundingReview) => {
    assertCurrentLimitPrepared(funding, signer);
    if ((candidate !== 'cheap-exit' && candidate !== 'cheap-history') || funding.phase !== 'limit-funding-review' || !['create', 'topup'].includes(funding.kind) ||
        funding.readyToSign !== false || funding.chainId !== chainId || !same(funding.from, owner) || !same(funding.to, policy.core) ||
        funding.graph !== policy.graph || funding.packageSha256 !== policy.packageSha256 ||
        typeof funding.amount !== 'bigint' || funding.amount <= 0n || funding.amount >= 1n << 256n) {
      throw new FundingProofError('Limit approval differs from its exact funding review.');
    }
    const pair = resolvePreparedDexScope(candidate).candidate.pairs.find(pair => pair.marketId === funding.marketId &&
      funding.poolTokens?.length === 2 && pair.tokens.every((token, i) => same(funding.poolTokens![i], token)));
    if (!pair || !pair.tokens.some(token => same(funding.fundingToken, token))) throw new FundingProofError('Limit approval market or offered token changed.');
    indexOf(funding.fundingToken);
  };
  const validateLimitApproval = async (p: CurrentSharedLimitApprovalPrepared, fresh: boolean) => {
    const saved = limitApprovals.get(p);
    if (!saved || p.readyToSign !== false || !same(p.core, policy.core) || p.graph !== policy.graph || p.packageSha256 !== policy.packageSha256) {
      throw new FundingProofError('Limit approval was not prepared in this session.');
    }
    const funding = saved.funding; requireLimitFundingIdentity(funding); await funding.assertCurrent();
    if (p.kind !== funding.kind || p.marketId !== funding.marketId || !same(p.token, funding.fundingToken) || p.amount !== funding.amount) {
      throw new FundingProofError('Limit approval differs from its exact funding review.');
    }
    approvalCall(p.data);
    if (!same(await transport.readBlockHash(Number(saved.before.head.number)), saved.before.head.hash)) throw new FundingProofError('Limit approval review block changed.');
    if (fresh) {
      await assertLimitApprovalAdmission(funding); b.requireEmptyPending();
      const head = await b.currentHead(saved.deadline, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP);
      await funding.assertAuthority(head);
      const state = await inspect(head);
      if (!state.tokens.every((t, i) => equalToken(t, saved.before.tokens[i]))) throw new FundingProofError('Limit approval private funds changed during review.');
      const nonce = await transport.readNonce(); await resources(head, nonce);
      const estimate = await transport.estimateGas({ chainId, from: owner, to: p.token, value: 0n, data: p.data, nonce, gasPrice: fixedGasPrice });
      if (typeof estimate !== 'bigint' || estimate <= 0n || (estimate * 5n + 3n) / 4n + 1_000_000n > CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP) throw new Error('Limit approval strict estimate exceeds its gas cap.');
      await assertLimitApprovalAdmission(funding); await funding.assertCurrent(); await transport.assertCurrent();
    }
    return saved;
  };
  // Token approval proves the ERC20 event and private state change. Consumer
  // authorization stays in the separate Pool or swap validation above.
  const proveApproval = async (request: Request, transactionHash: string, token: string, before?: Funds, amount?: bigint) => {
    const receipt = await canonical(request, transactionHash), head = await readReceiptBlock(receipt.blockNumber!);
    if (head.number !== BigInt(receipt.blockNumber!) || !same(head.hash, receipt.blockHash!) || head.timestamp > now() ||
        before && head.timestamp < before.head.timestamp) throw new FundingProofError('Pool approval receipt block changed.');
    const after = await inspect(head), index = indexOf(token);
    if (receipt.status === 0) {
      if (!receipt.logs || receipt.logs.length || before && !after.tokens.every((t, i) => equalToken(t, before.tokens[i]))) throw new FundingProofError('Reverted Pool approval did not roll back exactly.');
    } else {
      if (!receipt.logs || receipt.logs.length !== 1 || !same(receipt.logs[0].address, token)) throw new FundingProofError('Pool approval needs one exact token event.');
      const log = receipt.logs[0], event = currentTokenFundingAbi.parseLog({ topics: [...log.topics], data: log.data });
      const encoded = event && currentTokenFundingAbi.encodeEventLog(event.fragment, event.args);
      if (!event || event.name !== 'Approval' || !encoded || !same(event.args.owner, owner) || !same(event.args.spender, policy.core) ||
          !same(encoded.data, log.data) || encoded.topics.length !== log.topics.length || encoded.topics.some((topic, i) => !same(topic, log.topics[i]))) throw new FundingProofError('Pool approval event changed.');
      let confirmed: bigint;
      try { confirmed = decrypt(event.args.ownerValue); } catch { throw new FundingProofError('Pool approval owner envelope is unavailable.'); }
      if (confirmed !== after.tokens[index].allowance || amount !== undefined && confirmed !== amount) throw new FundingProofError('Pool approval allowance differs from its reviewed amount.');
      if (before && !after.tokens.every((t, i) => equalToken(t, i === index ? { ...before.tokens[i], allowance: confirmed } : before.tokens[i]))) throw new FundingProofError('Pool approval changed private balances, another allowance or claim policy.');
    }
    if (JSON.stringify(await canonical(request, transactionHash)) !== JSON.stringify(receipt)) throw new FundingProofError('Pool approval canonical receipt changed after accounting.');
    const last = await readReceiptBlock(receipt.blockNumber!);
    if (last.number !== head.number || !same(last.hash, head.hash) || last.timestamp !== head.timestamp) throw new FundingProofError('Pool approval receipt timestamp changed.');
    await transport.assertCurrent(); return { receipt, after };
  };
  const recoverPendingApproval = async (knownHash?: string) => {
    await transport.assertCurrent(); const pending = b.pending(); if (!pending) return null;
    if (pending.phase !== 'token-approve' || pending.chainId !== String(chainId) || !same(pending.owner, owner) ||
        !same(pending.core, policy.core) || pending.graph !== `0x${policy.graph}` || !pending.target) throw new Error('Pending token approval belongs to another adapter.');
    indexOf(pending.target);
    if (pending.verificationBlocked) throw new Error('Known token approval verification failure. Reconcile manually.');
    const supplied = knownHash?.trim().toLowerCase();
    if (supplied && (!/^0x[0-9a-f]{64}$/.test(supplied) || BigInt(supplied) === 0n || pending.txHash && supplied !== pending.txHash)) throw new Error('Invalid or changed token approval transaction hash.');
    const hash = pending.txHash ?? supplied;
    if (!hash) return Object.freeze({ ...identity, status: 'manual-reconciliation-required' as const, privateAccountingVerified: false as const });
    const tx = await transport.readTransaction(hash);
    if (!tx || !await transport.waitForReceipt(hash)) return Object.freeze({ ...identity, status: 'awaiting-chain-confirmation' as const, privateAccountingVerified: false as const });
    try {
      approvalCall(tx.data);
      if (!same(tx.to, pending.target) || keccak256(tx.data).toLowerCase() !== pending.callHash) throw new FundingProofError('Token approval pending target or calldata changed.');
      const request = { chainId, from: owner, to: pending.target, data: tx.data, value: 0n as const, nonce: pending.nonce,
        gasLimit: CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP, gasPrice: fixedGasPrice };
      const result = await proveApproval(request, hash, pending.target);
      if (!pending.txHash) recordCurrentDexPendingHash(storage, pending, hash);
      clearCurrentDexPendingAttempt(storage, b.requireOwnPending(pending, hash));
      return Object.freeze({ ...identity, status: result.receipt.status === 0 ? 'observed-reverted' as const : 'observed-mined' as const, privateAccountingVerified: false as const });
    } catch (error) { if (knownProofFailure(error)) blockCurrentTokenFundingVerification(storage, pending); throw error; }
  };
  return Object.freeze({
    prepareSharedLimitApproval: async ({ funding, confirm }: { funding: CurrentLimitFundingReview;
      confirm: (review: { token: string; amount: bigint; previousAllowance: bigint; spender: string }) => Promise<boolean> }) => {
      await assertLimitApprovalAdmission(funding); b.requireEmptyPending(); requireLimitFundingIdentity(funding); await funding.assertCurrent();
      if (!encrypt || typeof confirm !== 'function') throw new FundingProofError('Limit approval review or encryption is unavailable.');
      const head = await b.currentHead(undefined, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP); await funding.assertAuthority(head);
      const before = await inspect(head), token = getAddress(funding.fundingToken), amount = funding.amount, state = before.tokens[indexOf(token)];
      if (state.balance < amount || state.allowance === amount) throw new FundingProofError('Limit approval is unnecessary or has insufficient private funds.');
      if (!await confirm(Object.freeze({ token, amount, previousAllowance: state.allowance, spender: policy.core }))) return null;
      await assertLimitApprovalAdmission(funding); await funding.assertCurrent();
      const currentHead = await b.currentHead(undefined, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP); await funding.assertAuthority(currentHead);
      if (!(await inspect(currentHead)).tokens.every((t, i) => equalToken(t, before.tokens[i]))) throw new FundingProofError('Limit approval funds changed during confirmation.');
      const input = await encrypt(amount, token, currentTokenFundingAbi.getFunction('approve')!.selector); await funding.assertCurrent(); await transport.assertCurrent();
      const p = Object.freeze({ kind: funding.kind, marketId: funding.marketId!, token, amount,
        data: currentTokenFundingAbi.encodeFunctionData('approve', [policy.core, input]), ...identity, readyToSign: false as const });
      limitApprovals.set(p, { before, deadline: now() + 300n, funding }); await validateLimitApproval(p, true); return p;
    },
    submitSharedLimitApproval: async (p: CurrentSharedLimitApprovalPrepared) => {
      const existing=limitApprovals.get(p);
      if(!existing){await assertApprovalAdmission();throw new FundingProofError('Limit approval was not prepared in this session.');}
      await assertLimitApprovalAdmission(existing.funding); b.requireEmptyPending(); const saved = await validateLimitApproval(p, true);
      if (used.has(p)) throw new Error('Limit approval was already attempted. Reconcile it.'); used.add(p); let signing = false;
      try {
        const sent = await b.sendCurrent('token-approve', { chainId, from: owner, to: p.token, data: p.data, value: 0n, gasPrice: fixedGasPrice },
          saved.deadline, async () => { await validateLimitApproval(p, true); }, () => { signing = true; }, undefined, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP,
          undefined, async request => {
            await assertLimitApprovalAdmission(saved.funding); const head = await b.currentHead(saved.deadline, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP);
            await saved.funding.assertAuthority(head); await resources(head, request.nonce!); await saved.funding.assertCurrent(); await transport.assertCurrent();
          },undefined,undefined,undefined,undefined,candidate==='cheap-history'?{prepared:saved.funding,signer}:undefined);
        return Object.freeze({ ...identity, transactionHash: sent.transactionHash, readyToSign: false as const, recover: async () => {
          await validateLimitApproval(p, false); const pending = b.pending();
          if (!pending || pending.verificationBlocked || pending.phase !== 'token-approve' || !same(pending.target, p.token) || pending.callHash !== keccak256(p.data).toLowerCase()) throw new FundingProofError('Limit approval pending action changed.');
          b.requireOwnPending(pending, sent.transactionHash);
          try {
            const result = await proveApproval(sent.request, sent.transactionHash, p.token, saved.before, p.amount);
            clearCurrentDexPendingAttempt(storage, b.requireOwnPending(pending, sent.transactionHash));
            return Object.freeze({ ...identity, token: p.token, fundingOutcome: result.receipt.status === 0 ? 'reverted' as const : 'verified' as const,
              privateAccountingVerified: true as const, funds: result.after });
          } catch (error) { if (knownProofFailure(error)) blockCurrentTokenFundingVerification(storage, b.requireOwnPending(pending, sent.transactionHash)); throw error; }
        } });
      } catch (error) { if (!signing) used.delete(p); throw error; }
    },
    recoverPendingSharedLimitApproval: () => recoverPendingApproval(),
    recoverPendingSharedSwapApproval: async (knownHash?: string) => {
      if (candidate !== 'cheap-exit' && candidate !== 'cheap-history') throw new Error('Swap approval requires a supported current DEX candidate.');
      return recoverPendingApproval(knownHash);
    },
    prepareSharedSwapApproval: async ({ token, amount, assertReviewCurrent, preparedQuote, confirm }: {
      token: string; amount: bigint; assertReviewCurrent: () => void | Promise<void>; preparedQuote?: CurrentCheapDexPreparedQuote;
      confirm: (review: CurrentSharedSwapApprovalReview & { previousAllowance: bigint }) => Promise<boolean>
    }) => {
      const review = swapReview(token, amount); await assertSwapApprovalAdmission(review, preparedQuote); b.requireEmptyPending();
      if (!encrypt || typeof confirm !== 'function' || typeof assertReviewCurrent !== 'function') throw new FundingProofError('Swap approval review or encryption is unavailable.');
      await assertReviewCurrent();
      const before = await inspect(await b.currentHead(undefined, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP)), index = indexOf(token), state = before.tokens[index];
      if (state.balance < amount || state.allowance !== 0n) throw new FundingProofError('Swap approval needs sufficient funds and zero prior allowance.');
      if (!await confirm({ ...review, previousAllowance: state.allowance })) return null;
      await assertReviewCurrent(); await assertSwapApprovalAdmission(review, preparedQuote); await transport.assertCurrent();
      const current = await inspect(await b.currentHead(undefined, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP));
      if (!current.tokens.every((t, i) => equalToken(t, before.tokens[i]))) throw new FundingProofError('Swap approval funds changed during confirmation.');
      const input = await encrypt(amount, review.token, currentTokenFundingAbi.getFunction('approve')!.selector);
      await assertReviewCurrent(); await transport.assertCurrent();
      const p = Object.freeze({ ...review, data: currentTokenFundingAbi.encodeFunctionData('approve', [policy.core, input]), readyToSign: false as const });
      swapApprovals.set(p, { before, deadline: now() + 300n, assertReviewCurrent, preparedQuote }); await validateSwapApproval(p, true); return p;
    },
    submitSharedSwapApproval: async (p: CurrentSharedSwapApprovalPrepared) => {
      const review = swapReview(p.token, p.amount), original=swapApprovals.get(p);
      await assertSwapApprovalAdmission(review, original?.preparedQuote); b.requireEmptyPending(); const saved = await validateSwapApproval(p, true);
      if (used.has(p)) throw new Error('Swap approval was already attempted. Reconcile it.'); used.add(p); let signing = false;
      try {
        const sent = await b.sendCurrent('token-approve', { chainId, from: owner, to: p.token, data: p.data, value: 0n, gasPrice: fixedGasPrice },
          saved.deadline, async () => { await validateSwapApproval(p, true); }, () => { signing = true; }, undefined, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP,
          undefined, async request => { await saved.assertReviewCurrent(); await assertSwapApprovalAdmission(review, saved.preparedQuote);
            await resources(await b.currentHead(saved.deadline, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP), request.nonce!);
            await saved.assertReviewCurrent(); await assertSwapApprovalAdmission(review, saved.preparedQuote); await transport.assertCurrent();
            if (authorizeSwapApprovalSigning) {
              if (!saved.preparedQuote) throw new Error('Original branded swap approval scope is absent.');
              await authorizeSwapApprovalSigning(saved.preparedQuote,request);
            }
          }, undefined, saved.preparedQuote ? {prepared:saved.preparedQuote,signer} : undefined);
        if (rememberSwapApprovalHash) await rememberSwapApprovalHash(sent);
        return Object.freeze({ ...identity, transactionHash: sent.transactionHash, readyToSign: false as const, recover: async () => {
          // Reconciliation remains available after the UI review changes. It
          // requires the original preparation and transport session, not a new send.
          await validateSwapApproval(p, false); const pending = b.pending();
          if (!pending || pending.verificationBlocked || pending.phase !== 'token-approve' || !same(pending.target, p.token) || pending.callHash !== keccak256(p.data).toLowerCase()) {
            throw new FundingProofError('Swap approval pending action changed.');
          }
          b.requireOwnPending(pending, sent.transactionHash);
          try {
            const result = await proveApproval(sent.request, sent.transactionHash, p.token, saved.before, p.amount);
            clearCurrentDexPendingAttempt(storage, b.requireOwnPending(pending, sent.transactionHash));
            return Object.freeze({ ...identity, token: p.token, fundingOutcome: result.receipt.status === 0 ? 'reverted' as const : 'verified' as const,
              privateAccountingVerified: true as const, funds: result.after });
          } catch (error) { if (knownProofFailure(error)) blockCurrentTokenFundingVerification(storage, b.requireOwnPending(pending, sent.transactionHash)); throw error; }
        } });
      } catch (error) { if (!signing) used.delete(p); throw error; }
    },
    prepareSharedPoolAllowanceCleanup: async ({ marketId, canonicalIndex, confirm }: {
      marketId: string; canonicalIndex: 0 | 1;
      confirm: (review: { token: string; amount: bigint; previousAllowance: bigint; spender: string; cleanup: boolean }) => Promise<boolean>
    }) => {
      assertCurrentAppPoolAllowanceCleanupAuthority(policy.graph, owner); b.requireEmptyPending();
      const pair = resolvePreparedDexScope(candidate).candidate.pairs.find(pair => pair.marketId === marketId);
      if (candidate !== 'cheap-history' || !pair || (canonicalIndex !== 0 && canonicalIndex !== 1) || !encrypt || typeof confirm !== 'function') {
        throw new FundingProofError('Invalid registered Pool allowance cleanup.');
      }
      const token = getAddress(pair.tokens[canonicalIndex]), before = await inspect(await b.currentHead(undefined, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP));
      const previousAllowance = before.tokens[indexOf(token)].allowance;
      if (previousAllowance === 0n) return null;
      if (!await confirm(Object.freeze({ token, amount: 0n, previousAllowance, spender: policy.core, cleanup: true }))) return null;
      assertCurrentAppPoolAllowanceCleanupAuthority(policy.graph, owner); await transport.assertCurrent(); b.requireEmptyPending();
      const current = await inspect(await b.currentHead(undefined, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP));
      if (!current.tokens.every((t, i) => equalToken(t, before.tokens[i]))) throw new FundingProofError('Pool approval funds changed during confirmation.');
      const input = await encrypt(0n, token, currentTokenFundingAbi.getFunction('approve')!.selector); await transport.assertCurrent();
      const funding: CurrentSharedPoolAllowanceCleanupBinding = Object.freeze({ kind: 'allowance-cleanup', ...identity, chainId,
        from: owner, to: policy.core, marketId, poolTokens: Object.freeze([...pair.tokens]) as readonly [string, string], readyToSign: false,
        assertCurrent: async () => { assertCurrentAppPoolAllowanceCleanupAuthority(policy.graph, owner); await transport.assertCurrent(); } });
      const p: CurrentSharedPoolApprovalPrepared = Object.freeze({ ...identity, token, amount: 0n, cleanup: true, recovery: true,
        canonicalIndex, marketId, data: currentTokenFundingAbi.encodeFunctionData('approve', [policy.core, input]), readyToSign: false });
      approvals.set(p, { before, deadline: now() + 300n, funding }); poolApprovalSessions.set(p, { signer, funding }); await validateApproval(p, true); return p;
    },
    prepareSharedPoolApproval: async ({ funding, canonicalIndex, cleanup = false, confirm }: {
      funding: PoolFunding; canonicalIndex: 0 | 1; cleanup?: boolean;
      confirm: (review: { token: string; amount: bigint; previousAllowance: bigint; spender: string; cleanup: boolean }) => Promise<boolean>
    }) => {
      await assertPoolApprovalAdmission(funding); b.requireEmptyPending(); assertCurrentPoolFundingPrepared(funding, signer); await funding.assertCurrent();
      requireFundingIdentity(funding);
      if ((canonicalIndex !== 0 && canonicalIndex !== 1) || funding.graph !== policy.graph || funding.packageSha256 !== policy.packageSha256 ||
          funding.intent.poolTokens.length !== 2 || !encrypt || typeof confirm !== 'function') throw new FundingProofError('Invalid prepared Pool approval.');
      const token = getAddress(funding.intent.poolTokens[canonicalIndex]), amount = cleanup ? 0n : canonicalIndex === 0 ? funding.amounts.used0 : funding.amounts.used1;
      if (typeof amount !== 'bigint' || amount < 0n || amount >= 1n << 256n || !cleanup && amount === 0n) throw new FundingProofError('Invalid exact Pool allowance.');
      if (!cleanup) await funding.assertApprovalCurrent();
      if (cleanup) await funding.assertUnfundedCleanupCurrent();
      const before = await inspect(await b.currentHead(undefined, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP)), index = indexOf(token), state = before.tokens[index];
      if (state.balance < amount || state.allowance === amount || state.allowance !== 0n && state.allowance !== (canonicalIndex === 0 ? funding.amounts.used0 : funding.amounts.used1)) throw new FundingProofError('Pool approval is unnecessary or its existing allowance is not exact.');
      if (!await confirm({ token, amount, previousAllowance: state.allowance, spender: policy.core, cleanup })) return null;
      await assertPoolApprovalAdmission(funding); await transport.assertCurrent(); await funding.assertCurrent();
      const current = await inspect(await b.currentHead(undefined, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP));
      if (!current.tokens.every((t, i) => equalToken(t, before.tokens[i]))) throw new FundingProofError('Pool approval funds changed during confirmation.');
      const input = await encrypt(amount, token, currentTokenFundingAbi.getFunction('approve')!.selector); await transport.assertCurrent();
      const p = Object.freeze({ token, amount, cleanup, canonicalIndex, marketId: funding.intent.marketId,
        data: currentTokenFundingAbi.encodeFunctionData('approve', [policy.core, input]), ...identity, readyToSign: false as const });
      approvals.set(p, { before, deadline: now() + 300n, funding }); poolApprovalSessions.set(p, { signer, funding }); await validateApproval(p, true); return p;
    },
    submitSharedPoolApproval: async (p: CurrentSharedPoolApprovalPrepared) => {
      if (!approvals.has(p)) { await assertApprovalAdmission(); throw new FundingProofError('Pool approval was not prepared in this session.'); }
      b.requireEmptyPending(); const saved = await validateApproval(p, true);
      if (used.has(p)) throw new Error('Pool approval was already attempted. Reconcile it.'); used.add(p); let signing = false;
      try {
        const sent = await b.sendCurrent('token-approve', { chainId, from: owner, to: p.token, data: p.data, value: 0n, gasPrice: fixedGasPrice },
          saved.deadline, async () => { await validateApproval(p, true); }, () => { signing = true; }, undefined, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP,
          undefined, async request => { await assertPoolApprovalAdmission(saved.funding); await resources(await b.currentHead(saved.deadline, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP), request.nonce!); },
          undefined, undefined, undefined, undefined, undefined, candidate === 'cheap-history' ? { kind: 'approval', prepared: p, signer } : undefined);
        return Object.freeze({ ...identity, transactionHash: sent.transactionHash, readyToSign: false as const, recover: async () => {
          await validateApproval(p, false); const pending = b.pending();
          if (!pending || pending.verificationBlocked || pending.phase !== 'token-approve' || !same(pending.target, p.token) || pending.callHash !== keccak256(p.data).toLowerCase()) throw new FundingProofError('Pool approval pending action changed.');
          b.requireOwnPending(pending, sent.transactionHash);
          try {
            const result = await proveApproval(sent.request, sent.transactionHash, p.token, saved.before, p.amount);
            clearCurrentDexPendingAttempt(storage, b.requireOwnPending(pending, sent.transactionHash));
            return Object.freeze({ ...identity, token: p.token, fundingOutcome: result.receipt.status === 0 ? 'reverted' as const : 'verified' as const,
              privateAccountingVerified: true as const, funds: result.after, cleanup: p.cleanup, recoveredCleanup: p.recovery === true });
          } catch (error) { if (knownProofFailure(error)) blockCurrentTokenFundingVerification(storage, b.requireOwnPending(pending, sent.transactionHash)); throw error; }
        } });
      } catch (error) { if (!signing) used.delete(p); throw error; }
    },
    recoverPendingSharedPoolApproval: () => recoverPendingApproval(),
    readSharedTokenFunding: async () => inspect(await b.currentHead(undefined, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP)),
    prepareSharedTokenFunding: async ({ action, token, confirm, preparedQuote }: { preparedQuote?: CurrentCheapDexPreparedQuote; action: CurrentSharedTokenFundingAction; token: string;
      confirm: (review: CurrentSharedTokenFundingReview) => Promise<boolean> }) => {
      const call = shape(action, token); await assertAdmission(action, token, preparedQuote); b.requireEmptyPending();
      const before = await inspect(await b.currentHead(undefined, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP)), i = indexOf(token);
      if (action === 'initial' ? before.tokens[i].initialClaimAvailability !== 'ready' : before.tokens[i].refillAvailability !== 'ready') throw new Error('Beta token claim is not available.');
      const p = Object.freeze({ action, token: getAddress(token), ...call, ...identity, readyToSign: false as const });
      const deadline = action === 'refill' && policy.vault.expiresAt < now() + 300n ? policy.vault.expiresAt : now() + 300n;
      preparations.set(p, { before, deadline, preparedQuote });
      try {
        const reviewed = await validate(p, true);
        if (reviewed.gasEstimate === undefined) throw new Error('Beta funding estimate is unavailable.');
        if (!await confirm(Object.freeze({ ...p, decimals: 6, cooldown: action === 'refill' ? policy.cooldown : 0n,
          expiresAt: action === 'refill' ? policy.vault.expiresAt : deadline, gasEstimate: reviewed.gasEstimate,
          gasPrice: fixedGasPrice, gasLimit: CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP }))) {
          preparations.delete(p); return null;
        }
        await validate(p, true); return p;
      } catch (error) { preparations.delete(p); throw error; }
    },
    submitSharedTokenFunding: async (p: CurrentSharedTokenFundingPrepared, onSigningRequest?: () => void) => {
      await assertAdmission(p.action, p.token, preparations.get(p)?.preparedQuote); b.requireEmptyPending(); const saved = await validate(p, true);
      if (used.has(p)) throw new Error('Beta funding was already attempted. Reconcile it.'); used.add(p); let signing = false;
      try {
        const phase = p.action === 'initial' ? 'token-faucet' : 'token-refill';
        const sent = await b.sendCurrent(phase, { chainId, from: owner, to: p.to, data: p.data, value: 0n, gasPrice: fixedGasPrice },
          saved.deadline, async () => { await validate(p, true); }, () => { signing = true; onSigningRequest?.(); }, undefined, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP,
          undefined, async request => { await assertAdmission(p.action, p.token, saved.preparedQuote); await resources(await b.currentHead(saved.deadline, CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP), request.nonce!);
            if(authorizeInitialClaimSigning)await authorizeInitialClaimSigning(request);
          }, undefined, undefined, authorizeInitialClaimSigning?signer:undefined,
          candidate==='cheap-history'?{action:p.action,token:p.token}:undefined);
        if(rememberSwapApprovalHash && authorizeInitialClaimSigning)await rememberSwapApprovalHash(sent);
        return Object.freeze({ ...identity, transactionHash: sent.transactionHash, readyToSign: false as const, recover: async () => {
          await validate(p, false); const pending = b.pending();
          // A retry retains the original private snapshot and repeats every proof before clearing the lock.
          if (!pending || pending.phase !== phase || !same(pending.target, p.to) || pending.callHash !== keccak256(p.data).toLowerCase()) throw new Error('Beta funding pending action changed.');
          b.requireOwnPending(pending, sent.transactionHash);
          try {
            const result = await prove(sent.request, sent.transactionHash, p.action, p.token, saved.before);
            clearCurrentDexPendingAttempt(storage, b.requireOwnPending(pending, sent.transactionHash));
            return Object.freeze({ ...identity, fundingOutcome: result.receipt.status === 0 ? 'reverted' as const : 'verified' as const, privateAccountingVerified: true as const, funds: result.after });
          } catch (error) {
            if (knownProofFailure(error)) blockCurrentTokenFundingVerification(storage, b.requireOwnPending(pending, sent.transactionHash));
            throw error;
          }
        } });
      } catch (error) { if (!signing) used.delete(p); throw error; }
    },
    recoverPendingSharedTokenFunding: async (knownHash?: string) => {
      await transport.assertCurrent(); const p = b.pending(); if (!p) return null;
      if (!['token-faucet', 'token-refill'].includes(p.phase) || p.chainId !== String(chainId) || !same(p.owner, owner) ||
        !same(p.core, policy.core) || p.graph !== `0x${policy.graph}` || !p.target) throw new Error('Pending funding belongs to another adapter.');
      const supplied = knownHash?.trim().toLowerCase();
      if (p.verificationBlocked && !supplied) throw new Error('Known beta funding verification failure. Enter its existing hash to recheck exact historical accounting. Do not resend.');
      if (supplied && (!/^0x[0-9a-f]{64}$/.test(supplied) || BigInt(supplied) === 0n || p.txHash && supplied !== p.txHash)) throw new Error('Invalid or changed beta funding transaction hash.');
      const hash = p.txHash ?? supplied;
      if (!hash) return Object.freeze({ ...identity, status: 'manual-reconciliation-required' as const, privateAccountingVerified: false as const });
      const tx = await transport.readTransaction(hash);
      if (!tx || !await transport.waitForReceipt(hash)) return Object.freeze({ ...identity, status: 'awaiting-chain-confirmation' as const, privateAccountingVerified: false as const });
      try {
        const action = p.phase === 'token-faucet' ? 'initial' : 'refill';
        const token = action === 'initial' ? p.target : String(currentSharedTokenFundingAbi.decodeFunctionData('claim', tx.data)[0]);
        const call = shape(action, token);
        if (!same(p.target, call.to) || !same(tx.to, call.to) || !same(tx.data, call.data) || keccak256(tx.data).toLowerCase() !== p.callHash) throw new FundingProofError('Pending beta funding target or calldata changed.');
        const request = { chainId, from: owner, to: call.to, data: call.data, value: 0n as const, nonce: p.nonce,
          gasLimit: CURRENT_SHARED_TOKEN_FUNDING_GAS_CAP, gasPrice: fixedGasPrice };
        const legacySdkFlag = p.verificationBlocked && p.phase === 'token-faucet' && isCurrentAppCanonicalClaimRepair({
          graph: policy.graph, owner, token, hash, nonce: tx.nonce, blockNumber: tx.blockNumber, blockHash: tx.blockHash });
        let before: Funds | undefined, historyPruned = false;
        if (p.verificationBlocked && !legacySdkFlag) {
          const receipt = await canonical(request, hash);
          if (!receipt.blockNumber || receipt.blockNumber < 1) throw new FundingProofError('Beta funding parent block is unavailable.');
          try {
            const parent = await readReceiptBlock(receipt.blockNumber - 1);
            if (parent.number !== BigInt(receipt.blockNumber - 1)) throw new FundingProofError('Beta funding parent block changed.');
            before = await inspect(parent);
          } catch (error) { if (!prunedState(error)) throw error; historyPruned = true; }
        }
        const result = await prove(request, hash, action, token, before);
        if (legacySdkFlag && result.receipt.status !== 1) throw new FundingProofError('Diagnosed canonical claim outcome changed.');
        if (!historyPruned) {
          if (!p.txHash) recordCurrentDexPendingHash(storage, p, hash);
          clearCurrentDexPendingAttempt(storage, b.requireOwnPending(p, hash));
        }
        return Object.freeze({ ...identity, status: result.receipt.status === 0 ? 'observed-reverted' as const : 'observed-mined' as const,
          privateAccountingVerified: Boolean(before), privateCreditVerified: result.receipt.status === 1,
          ...(historyPruned ? { verificationBlocked: true as const } : {}) });
      } catch (error) { if (knownProofFailure(error)) blockCurrentTokenFundingVerification(storage, p); throw error; }
    }
  });
};
