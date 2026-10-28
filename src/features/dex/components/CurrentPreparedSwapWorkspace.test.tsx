import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CurrentSwapWorkspace, reconcileCurrentTrialPending, verifyCurrentTrialCandidate } from './DexV2Page';
import { CURRENT_CHEAP_DEX_CANDIDATE, resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import { readCurrentDexDisplay, parseDexCandidateTokenAmount, formatDexCandidateTokenAmount } from '../../../lib/currentDexDisplay';
import { assertCurrentSwapCandidate } from '../../../lib/currentDexNativeSwapPolicy';
import CurrentSharedTestTokenControls from './CurrentSharedTestTokenControls';
import CurrentSwapProgress from './CurrentSwapProgress';
import type { SharedWalletSession } from '../../../lib/walletSession';
import type { TradingPair } from '../../../app/components/TradingProductSwitch';
import { CURRENT_SHARED_DEX_TOKENS } from '../../../lib/currentSharedDexTokenDistribution';
import { currentDexMarketReference, type CurrentDexMarketReference } from '../../../lib/currentDexMarketReference';
import { readCurrentDexDailyPrice } from '../../../lib/currentDexDailyPrice';
import { makeHistoryFixture, HISTORY_FIXTURE_DAY } from '../../../../tests/fixtures/history.fixture';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY, reserveCurrentDexPendingAttempt } from '../../../lib/currentDexPendingAttempt';
import { CURRENT_OWNER_BETA } from '../../../lib/currentDexOwnerBetaPolicy';

const hooks = vi.hoisted(() => ({ index: 0, refIndex: 0, states: [] as unknown[], refs: [] as { current: unknown }[], balances: vi.fn(), confirm: vi.fn(), allowSwap: false }));
vi.mock('../../../lib/currentDexNativeSwapPolicy', async original => {
  const actual = await original<typeof import('../../../lib/currentDexNativeSwapPolicy')>();
  return { ...actual, assertCurrentSwapCandidate: (...args: Parameters<typeof actual.assertCurrentSwapCandidate>) => {
    if (!hooks.allowSwap) return actual.assertCurrentSwapCandidate(...args);
  } };
});
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.states)) hooks.states[i] = initial; return [hooks.states[i], (value: unknown) => { hooks.states[i] = typeof value === 'function' ? value(hooks.states[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); },
  useEffect: () => undefined
}));
vi.mock('../hooks/useCurrentTrialBalances', () => ({ default: hooks.balances }));
vi.mock('../../trading/hooks/useTradeActionConfirmationState', () => ({ default: () => ({ confirmation: null, requestConfirmation: hooks.confirm, resolveConfirmation: vi.fn() }) }));

type Props = { children?: ReactNode; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void; disabled?: boolean; role?: string; href?: string; 'aria-label'?: string; 'aria-pressed'?: boolean };
// The shallow fixture must render the stateless progress view to observe its status and result.
const presentation = (node: ReactNode): ReactNode =>
  isValidElement<Parameters<typeof CurrentSwapProgress>[0]>(node) && node.type === CurrentSwapProgress
    ? CurrentSwapProgress(node.props) : node;
const elements = (input: ReactNode): ReactElement<Props>[] => {
  const node = presentation(input);
  return Array.isArray(node) ? node.flatMap(elements) : isValidElement<Props>(node) ? [node, ...elements(node.props.children)] : [];
};
const text = (input: ReactNode): string => {
  const node = presentation(input);
  return Array.isArray(node) ? node.map(text).join('') : isValidElement<Props>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
};
const owner = `0x${'22'.repeat(20)}`;
describe.each(['cheap-prepared', 'cheap-exit', 'cheap-history'] as const)('%s swap consumer', key => {
const prepared = resolveCurrentCheapDexCandidate(key);
const display = readCurrentDexDisplay(prepared);
const pair = ['EMBR', 'ORBT'] as TradingPair;
const addresses = pair.map(label => display.tokens.find(token => token.label === label)!.address);

function fixture(candidateKey: CurrentCheapDexCandidateKey | undefined = key, selectedOwner = owner, selectedPair = pair) {
  vi.stubGlobal('window', { sessionStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
  hooks.balances.mockReturnValue({ labels: ['1.234567', '2.345678'], eligible: true, loading: false, refresh: vi.fn() });
  const sharedTokens = CURRENT_SHARED_DEX_TOKENS.map(token => ({ ...token, balance: 2_000_000n, allowance: 0n, claimed: true }));
  const sharedFunds = { owner: selectedOwner, core: prepared.core, graph: prepared.graph, packageSha256: prepared.packageSha256, privateFundsVerified: true, readyToSign: false,
    head: { number: 99n, hash: `0x${'66'.repeat(32)}`, timestamp: 990n }, tokens: sharedTokens };
  const sender = { checkCurrentCheapCandidate: vi.fn(async (): Promise<{ chainId: bigint; owner: string; core: string; graph: string; readyToSign: boolean }> => ({ chainId: BigInt(prepared.chainId), owner: selectedOwner, core: prepared.core, graph: prepared.graph, readyToSign: false })),
    recoverPendingCurrentCheapAttempt: vi.fn(async () => null), readCurrentTokenFunding: vi.fn(), prepareCurrentTokenFunding: vi.fn(), submitCurrentTokenFunding: vi.fn(),
    readSharedTokenFunding: vi.fn(async () => sharedFunds),
    prepareSharedSwapApproval: vi.fn(async (request: { token: string; amount: bigint; assertReviewCurrent: () => void; confirm: (review: { token: string; amount: bigint; spender: string }) => Promise<boolean> }) => {
      request.assertReviewCurrent(); if (!await request.confirm({ token: request.token, amount: request.amount, spender: prepared.core })) return null;
      request.assertReviewCurrent(); return { token: request.token, amount: request.amount };
    }),
    submitSharedSwapApproval: vi.fn(async (review: { token: string; amount: bigint }) => ({ transactionHash: `0x${'77'.repeat(32)}`, recover: async () => {
      sharedTokens.find(token => token.address.toLowerCase() === review.token.toLowerCase())!.allowance = review.amount;
      return { fundingOutcome: 'verified', privateAccountingVerified: true, funds: sharedFunds };
    } })), waitForCurrentCheapReceipt: vi.fn(async () => ({})) };
  const getCapability = vi.fn(async () => sender);
  const getQuote = vi.fn(), getReceipt = vi.fn(), providerRequest = vi.fn();
  const session = { walletAddress: selectedOwner, chainId: Number(prepared.chainId), browserProvider: { request: providerRequest }, browserWalletId: 'metamask', activeSignerSource: 'browser',
    sessionOnboardInfo: { [selectedOwner]: { aesKey: 'local-fixture-only' } }, walletAesHealthByAddress: {}, actions: {
      getCurrentDexSubmissionCapability: getCapability, getCurrentDexQuoteCapability: getQuote, getCurrentDexReceiptCapability: getReceipt
    } } as unknown as SharedWalletSession;
  const props: { selectedPair: TradingPair; candidateKey?: CurrentCheapDexCandidateKey;
    priceDisplayInverted: boolean; sharedWalletSession: SharedWalletSession; marketReference?:CurrentDexMarketReference } = {
    selectedPair, candidateKey, priceDisplayInverted: false, sharedWalletSession: session };
  const render = () => { hooks.index = 0; hooks.refIndex = 0; return CurrentSwapWorkspace(props); };
  const button = (label: string) => elements(render()).find(e => e.type === 'button' && (e.props['aria-label'] === label || text(e.props.children) === label));
  const click = (label: string) => { const control = button(label)!; expect(control.props.disabled).toBe(false); control.props.onClick!(); };
  const status = () => text(elements(render()).find(e => e.props.role === 'status')?.props.children);
  render();
  return { props, render, button, click, status, sender, getCapability, getQuote, getReceipt, providerRequest, sharedTokens, sharedFunds };
}
afterEach(() => { hooks.states = []; hooks.refs = []; hooks.allowSwap = false; vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('prepared candidate swap view', () => {
  it('uses the existing privacy action before offering Quote and does not submit a trade', () => {
    const f = fixture();
    const unlockPrivacy = vi.fn(async () => undefined);
    f.props.sharedWalletSession = { ...f.props.sharedWalletSession, sessionOnboardInfo: {},
      actions: { ...f.props.sharedWalletSession.actions!, unlockPrivacy } };
    expect(f.button('Unlock privacy')).toBeDefined();
    expect(f.button('Get Quote')).toBeUndefined();
    f.click('Unlock privacy');
    expect(unlockPrivacy).toHaveBeenCalledOnce();
    expect(f.getQuote).not.toHaveBeenCalled();
    expect(f.getCapability).not.toHaveBeenCalled();
  });

  it('disables the privacy action and amount input while the wallet unlock is pending', () => {
    const f = fixture();
    const unlockPrivacy = vi.fn(() => new Promise(() => {}));
    f.props.sharedWalletSession = { ...f.props.sharedWalletSession, sessionOnboardInfo: {},
      actions: { ...f.props.sharedWalletSession.actions!, unlockPrivacy } };
    expect(f.button('Unlock privacy')).toBeDefined();
    f.click('Unlock privacy');
    expect(f.button('Unlocking…')?.props.disabled).toBe(true);
    expect(elements(f.render()).find(e => e.props['aria-label'] === 'Maximum input')?.props.disabled).toBe(true);
    expect(unlockPrivacy).toHaveBeenCalledOnce();
    expect(f.getQuote).not.toHaveBeenCalled();
  });

  it.each(['Fast','Multi-source'] as const)('shows a public estimate before %s Quote and replaces it with the verified Quote output',async mode=>{
    const price=makeHistoryFixture('empty'),now=HISTORY_FIXTURE_DAY*86400n+100n;
    const snapshot=await readCurrentDexDailyPrice({provider:price.provider,manifest:{...price.manifest,symbols:pair},finalityLagBlocks:0,count:1});
    const reference=currentDexMarketReference({status:'empty',snapshot},pair,now);
    vi.spyOn(Date,'now').mockReturnValue(Number(now*1000n));
    const f=fixture();f.props.marketReference=reference;
    if(mode==='Multi-source')f.click(mode);
    const input=elements(f.render()).find(e=>e.props['aria-label']==='Maximum input')!;
    input.props.onChange!({target:{value:'10'}});
    expect(text(f.render())).toContain('Estimated receiveEMBR≈ 5.0');
    expect(text(f.render())).toContain('Estimate only. Initial marginal price; excludes fees and price impact.');
    f.click('Sell');
    elements(f.render()).find(e=>e.props['aria-label']==='Maximum input')!.props.onChange!({target:{value:'10'}});
    expect(text(f.render())).toContain('Estimated receiveORBT≈ 20.0');
    f.props.priceDisplayInverted=true;expect(text(f.render())).toContain('Estimated receiveORBT≈ 20.0');
    f.props.sharedWalletSession={...f.props.sharedWalletSession,sessionOnboardInfo:{}};
    expect(text(f.render())).toContain('Estimated receiveORBT≈ 20.0');
    f.props.marketReference={status:'stale'};
    expect(text(f.render())).toContain('Estimate unavailable: market price is stale.');
    expect(text(f.render())).not.toContain('≈ 20.0');
    f.props.marketReference=reference;f.render();
    const scope=hooks.refs.find(ref=>typeof ref.current==='object'&&ref.current!==null&&'privacyReady' in ref.current)?.current;
    hooks.states[25]={scope,model:{summaryRows:[{label:'You receive',value:'19.9 ORBT'}]}};
    expect(text(f.render())).toContain('Quoted receiveORBT19.9 ORBT');
    expect(text(f.render())).not.toContain('Estimate only.');
    expect(f.getQuote).not.toHaveBeenCalled();expect(f.getCapability).not.toHaveBeenCalled();expect(f.providerRequest).not.toHaveBeenCalled();
  });
  it.skipIf(key !== 'cheap-history').each(['Fast', 'Multi-source'] as const)('joins engineering %s to the real policy and selected-wallet Quote capability', async mode => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const engineeringOwner = '0x8b749251cf1f712d4e39fd048c53394af03e10be';
    const f = fixture(key, engineeringOwner, ['BCN', 'HBR']);
    const prepareCurrentQuote = vi.fn(async () => { throw new Error('Selected-wallet Quote preparation reached'); });
    f.getQuote.mockResolvedValue({ prepareCurrentQuote });
    f.click('Sell'); if (mode === 'Multi-source') f.click(mode);
    elements(f.render()).find(e => e.props['aria-label'] === 'Maximum input')!.props.onChange!({ target: { value: '1' } });
    f.click('Get Quote');
    await vi.waitFor(() => expect(f.status()).toBe('Selected-wallet Quote preparation reached'));
    expect(hooks.allowSwap).toBe(false);
    expect(prepareCurrentQuote).toHaveBeenCalledWith(expect.objectContaining({
      profile: mode === 'Fast' ? 'fast-pool' : 'cheap-async',
      graph: expect.objectContaining({ candidate: key, expectedGraph: prepared.graph }),
      terms: expect.objectContaining({ destination: engineeringOwner, maximumInput: 1_000_000n, toleranceBps: 50,
        deadline: 1890n,
        inputToken: display.tokens.find(token => token.label === 'BCN')!.address,
        outputToken: display.tokens.find(token => token.label === 'HBR')!.address })
    }));
    expect(f.sender.submitSharedSwapApproval).not.toHaveBeenCalled();
    expect(f.providerRequest).not.toHaveBeenCalled();
  });
  it.skipIf(key !== 'cheap-exit').each(['cancel', 'recover'] as const)('shows verified %s budget correctly after restoration', async releaseAction => {
    const f = fixture(), quoteHash = `0x${'55'.repeat(32)}`;
    const issued = { transactionHash: quoteHash, operationId: 50n,
      intent: { profile: 'cheap-async', candidate: prepared, destination: owner, inputToken: addresses[1], outputToken: addresses[0],
        maximumInput: 1_234_567n, minimumInput: 1n, minimumOutput: 1n, toleranceBps: 50, rateNumerator: 0n, rateDenominator: 1n },
      operation: { ready: false, phase: 'released', stage: 8 }, readCurrent: vi.fn() };
    issued.readCurrent.mockResolvedValue(issued);
    const readCurrentCheapDelivery = vi.fn(async () => ({ releaseAction,
      amounts: { actualInput: 0n, netOutput: 0n, refund: 1_234_567n, filled: false } }));
    Object.assign(f.sender, { readCurrentCheapRestoreHint: vi.fn(() => ({ quoteHash })),
      restoreCurrentCheapOperation: vi.fn(async () => issued), readCurrentCheapDelivery });
    f.getQuote.mockResolvedValue({ restoreCurrentQuote: vi.fn(async () => issued) });
    f.click('Check current state');
    await vi.waitFor(() => expect(readCurrentCheapDelivery).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(f.status()).toBe(releaseAction === 'cancel'
      ? 'Quote cancelled before funding.' : 'Released with a private refund receipt.'));
    expect(text(f.render())).toContain(`${releaseAction === 'cancel' ? 'unused' : 'refunded'} 1.234567 ORBT`);
    expect(f.providerRequest).not.toHaveBeenCalled();
    expect(f.sender.submitSharedSwapApproval).not.toHaveBeenCalled();
  });
  it('releases a timed-out status check without any send and gives a safe next action', async () => {
    const f = fixture();
    f.sender.recoverPendingCurrentCheapAttempt.mockRejectedValueOnce(Object.assign(new Error('request timeout (code=TIMEOUT, version=6.17.0)'), { code: 'TIMEOUT' }));
    f.click('Check current state');
    await vi.waitFor(() => expect(f.status()).toBe('The network request timed out. Check current state before another action; do not resend.'));
    expect(f.button('Check current state')!.props.disabled).toBe(false);
    expect(f.sender.submitSharedSwapApproval).not.toHaveBeenCalled();
    expect(f.sender.submitCurrentTokenFunding).not.toHaveBeenCalled();
    expect(f.getQuote).not.toHaveBeenCalled();
  });
  it.each(['wrapped', 'nested'] as const)('keeps a %s missing-state RPC failure concise without retrying or sending', async shape => {
    const f = fixture(), detail = 'missing trie node 0x123; requested state is not available, not found';
    const message = `could not coalesce error (error={"message":"${detail}"}, payload={"method":"eth_getCode","params":["private-rpc-detail"]})`;
    f.sender.recoverPendingCurrentCheapAttempt.mockRejectedValueOnce(shape === 'wrapped'
      ? new Error(message) : { code: 'UNKNOWN_ERROR', message, error: { message: detail } });
    f.click('Check current state');
    await vi.waitFor(() => expect(f.status()).toBe('The RPC node cannot read this swap state. Check current state later; do not resend.'));
    expect(text(f.render())).not.toContain('private-rpc-detail');
    expect(text(f.render())).not.toContain('eth_getCode');
    expect(f.sender.recoverPendingCurrentCheapAttempt).toHaveBeenCalledOnce();
    expect(f.button('Check current state')!.props.disabled).toBe(false);
    expect(f.sender.submitSharedSwapApproval).not.toHaveBeenCalled();
    expect(f.sender.submitCurrentTokenFunding).not.toHaveBeenCalled();
    expect(f.getQuote).not.toHaveBeenCalled();
  });
  const admittedFundingFixture = (selectedOwner = owner) => {
    hooks.allowSwap = true; hooks.confirm.mockResolvedValue(true); const f = fixture(undefined, selectedOwner);
    const input = elements(f.render()).find(e => e.props['aria-label'] === 'Maximum input')!;
    input.props.onChange!({ target: { value: '1.234567' } });
    const quote={intent:{maximumInput:1_234_567n}};
    const prepareQuote = vi.fn(async (_request: { confirmPrivateInputs: (review: { maximumInput: bigint; minimumInput: bigint; minimumOutput: bigint }) => Promise<boolean> }) => quote);
    Object.assign(f.sender,{submitCurrentCheapQuote:vi.fn(async()=>{throw new Error('Funding reached Quote submission');}),
      prepareSharedTokenFunding:vi.fn(async()=>{throw new Error('Claim test tokens separately');})});
    f.getQuote.mockResolvedValue({ prepareCurrentQuote: prepareQuote }); return { ...f, prepareQuote };
  };
  it.skipIf(key !== 'cheap-history')('continues Quote preparation after the former owner beta expiry',async()=>{
    vi.spyOn(Date,'now').mockReturnValue(Number((CURRENT_OWNER_BETA.activation!.activatedAt+604800n)*1000n));
    const f=admittedFundingFixture(CURRENT_OWNER_BETA.owner);f.click('Get Quote');
    await vi.waitFor(()=>expect(f.prepareQuote).toHaveBeenCalledOnce());
    expect(f.getCapability).toHaveBeenCalled();expect(f.status()).not.toContain('Testnet beta window expired');
  });
  it.skipIf(key === 'cheap-prepared')('does not invent pending funding when approval is rejected before signing',async()=>{
    const f=admittedFundingFixture();f.sender.submitSharedSwapApproval.mockRejectedValueOnce(new Error('Testnet beta window expired. Renew beta access before trading.'));
    f.click('Get Quote');await vi.waitFor(()=>expect(f.status()).toContain('Testnet beta window expired'));
    expect(f.button('Get Quote')).toBeDefined();expect(f.button('Check funding and continue')).toBeUndefined();
    expect(text(f.render())).not.toContain('Check the pending funding transaction');
    expect(elements(f.render()).find(e=>e.props['aria-label']==='Maximum input')!.props.disabled).toBe(false);
    expect(f.sender.submitSharedSwapApproval).toHaveBeenCalledOnce();
  });
  it.skipIf(key === 'cheap-prepared')('retains recovery and the original record after an uncertain approval send',async()=>{
    const f=admittedFundingFixture(),records=new Map<string,string>(),storage={getItem:(k:string)=>records.get(k)??null,setItem:(k:string,v:string)=>records.set(k,v),removeItem:vi.fn()};
    vi.stubGlobal('window',{sessionStorage:storage});
    f.sender.submitSharedSwapApproval.mockImplementationOnce(async()=>{
      reserveCurrentDexPendingAttempt(storage,{version:1,chainId:String(prepared.chainId),owner,core:prepared.core.toLowerCase(),graph:`0x${prepared.graph}`,
        phase:'token-approve',callHash:`0x${'ab'.repeat(32)}`,nonce:220,txHash:null});
      throw new Error('Wallet result is unknown. Do not resend.');
    });
    f.click('Get Quote');await vi.waitFor(()=>expect(f.status()).toContain('Wallet result is unknown'));
    expect(f.button('Check funding and continue')).toBeDefined();expect(records.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);
    expect(storage.removeItem).not.toHaveBeenCalled();expect(f.sender.submitSharedSwapApproval).toHaveBeenCalledOnce();
  });
  it.skipIf(key !== 'cheap-exit')('shows wallet request and returned Quote hash before RPC visibility finishes', async () => {
    const f = admittedFundingFixture(), hash = `0x${'77'.repeat(32)}`;
    let progress!: { walletRequested?(): void; transactionHashReturned?(hash: string): void };
    let reject!: (error: Error) => void;
    const submit = vi.fn(async (_quote: unknown, observed: typeof progress) => {
      progress = observed; progress?.walletRequested?.();
      return await new Promise((_, fail) => { reject = fail; });
    });
    Object.assign(f.sender, { submitCurrentCheapQuote: submit });
    f.click('Get Quote');
    await vi.waitFor(() => expect(f.status()).toBe('Complete Quote in your wallet.'));
    progress.transactionHashReturned?.(hash);
    expect(f.status()).toBe('Quote submitted. Checking its transaction.');
    expect(elements(f.render()).find(e => e.type === 'a' && e.props.href?.includes(hash))).toBeDefined();
    reject(new Error('Submitted transaction is not yet verified. Check current state; do not resend.'));
    await vi.waitFor(() => expect(f.status()).toContain('do not resend'));
    expect(submit).toHaveBeenCalledOnce();
  });
  it.skipIf(key === 'cheap-prepared')('shows exact Fast fee limits and the wallet signature step after private input review', async () => {
    const f = admittedFundingFixture();
    let continuePreparation!: () => void;
    const waiting = new Promise<void>(resolve => { continuePreparation = resolve; });
    f.prepareQuote.mockImplementation(async request => {
      await request.confirmPrivateInputs({ maximumInput: 1_234_567n, minimumInput: 617_284n, minimumOutput: 900_000n });
      await waiting;
      return { intent: { maximumInput: 1_234_567n } };
    });
    f.click('Get Quote');
    await vi.waitFor(() => expect(hooks.confirm).toHaveBeenCalled());
    expect(hooks.confirm.mock.calls[0][0].title).toBe('Confirm private Quote inputs');
    expect(hooks.confirm.mock.calls[0][0].stats).toEqual([
      { label: 'Quote fee limit', value: `${key === 'cheap-history' ? '0.0055' : '0.00572'} COTI` },
      { label: 'Accept fee limit', value: `${key === 'cheap-history' ? '0.0055' : '0.00572'} COTI` }
    ]);
    await vi.waitFor(() => expect(f.status()).toBe('Private input review accepted. Complete the required wallet signatures.'));
    continuePreparation();
    await vi.waitFor(() => expect(f.status()).toBe('Funding reached Quote submission'));
  });
  it.skipIf(key !== 'cheap-history').each([false, true])('checks restored consumed Fast private delivery (failure=%s) without a send', async failure => {
    const f = fixture(), quoteHash = `0x${'55'.repeat(32)}`;
    const issued = { transactionHash: quoteHash, operationId: 7n,
      intent: { profile: 'fast-pool', candidate: prepared, destination: owner, inputToken: addresses[1], outputToken: addresses[0],
        maximumInput: 1_234_567n, minimumInput: 1n, minimumOutput: 1n, toleranceBps: 50, rateNumerator: 0n, rateDenominator: 1n },
      operation: { ready: false, phase: 'consumed-unverified', stage: 0 }, readCurrent: vi.fn() };
    issued.readCurrent.mockResolvedValue(issued);
    const readCurrentCheapDelivery = vi.fn(async () => {
      if (failure) throw new Error('Private payout verification failed.');
      return { amounts: { actualInput: 1_234_567n, netOutput: 900_000n, refund: 0n, filled: true } };
    });
    Object.assign(f.sender, { readCurrentCheapRestoreHint: vi.fn(() => ({ quoteHash })),
      restoreCurrentCheapOperation: vi.fn(async () => issued), readCurrentCheapDelivery });
    f.getQuote.mockResolvedValue({ restoreCurrentQuote: vi.fn(async () => issued) });
    f.click('Check current state');
    await vi.waitFor(() => expect(f.status()).toBe(failure ? 'Private payout verification failed.' : 'Settlement confirmed by the private receipt.'));
    expect(readCurrentCheapDelivery).toHaveBeenCalledOnce();
    if (failure) expect(text(f.render())).not.toContain('Paid 1.234567');
    else expect(text(f.render())).toContain('Paid 1.234567 ORBT; received 0.9 EMBR; refunded 0.0 ORBT.');
    expect(hooks.confirm).not.toHaveBeenCalled(); expect(f.providerRequest).not.toHaveBeenCalled();
    expect(f.sender.submitSharedSwapApproval).not.toHaveBeenCalled();
  });
  it.skipIf(key !== 'cheap-exit').each(['confirmed', 'timeout', 'private-failure'] as const)(
    'checks cancellation automatically and retains unresolved %s recovery', async outcome => {
    const f = fixture(), quoteHash = `0x${'55'.repeat(32)}`, cancelHash = `0x${'99'.repeat(32)}`;
    const issued = { transactionHash: quoteHash, operationId: 52n,
      intent: { profile: 'cheap-async', candidate: prepared, destination: owner, inputToken: addresses[1], outputToken: addresses[0],
        maximumInput: 1_234_567n, minimumInput: 1n, minimumOutput: 1n, toleranceBps: 50,
        rateNumerator: 0n, rateDenominator: 1n, deadline: BigInt(Math.floor(Date.now() / 1000)) + 600n },
      operation: { ready: true, phase: 'quote-prepared', stage: 5 }, readCurrent: vi.fn() };
    issued.readCurrent.mockResolvedValue(issued);
    const recover = vi.fn(async () => { issued.operation = { ready: false, phase: 'released', stage: 8 }; return { status: 'released' }; });
    const readCurrentCheapDelivery = vi.fn(async () => ({ releaseAction: 'cancel',
      amounts: { actualInput: 0n, netOutput: 0n, refund: 1_234_567n, filled: false } }));
    Object.assign(f.sender, { readCurrentCheapRestoreHint: vi.fn(() => ({ quoteHash })),
      restoreCurrentCheapOperation: vi.fn(async () => issued), readCurrentCheapDelivery,
      submitCurrentCheapOwnerAction: vi.fn(async () => ({ transactionHash: cancelHash, recover })) });
    f.getQuote.mockResolvedValue({ restoreCurrentQuote: vi.fn(async () => issued) });
    f.click('Check current state');
    await vi.waitFor(() => expect(f.status()).toBe('Private Quote is READY for review.'));
    if (outcome === 'timeout') f.sender.waitForCurrentCheapReceipt.mockResolvedValueOnce(null as never);
    if (outcome === 'private-failure') recover.mockRejectedValueOnce(new Error('Private verification failed'));
    f.click('Cancel swap');
    if (outcome !== 'confirmed') {
      await vi.waitFor(() => expect(f.status()).toBe(outcome === 'timeout'
        ? 'Recovery submitted. Use Check current state; do not resend.' : 'Private verification failed'));
      expect(readCurrentCheapDelivery).not.toHaveBeenCalled();
      expect(text(f.render())).not.toContain('unused 1.234567 ORBT');
      expect(f.button('Cancel swap')).toBeUndefined();
      expect(f.button('Check current state')!.props.disabled).toBe(false);
      return;
    }
    await vi.waitFor(() => expect(f.status()).toBe('Quote cancelled before funding.'));
    expect(recover).toHaveBeenCalledOnce();
    expect(f.sender.waitForCurrentCheapReceipt).toHaveBeenCalledWith(cancelHash);
    expect(text(f.render())).toContain('unused 1.234567 ORBT');
  });
  it.skipIf(key === 'cheap-prepared')('uses shared selected-token funding and exact approval before Quote in the injected local flow', async () => {
    const f = admittedFundingFixture(); f.click('Get Quote');
    await vi.waitFor(() => expect(f.status()).toBe('Funding reached Quote submission'));
    expect(f.sender.prepareSharedSwapApproval).toHaveBeenCalledWith(expect.objectContaining({ token: addresses[1], amount: 1_234_567n, assertReviewCurrent: expect.any(Function), preparedQuote:expect.any(Object) }));
    expect(f.prepareQuote.mock.invocationCallOrder[0]).toBeLessThan(f.sender.prepareSharedSwapApproval.mock.invocationCallOrder[0]);
    expect(f.sender.submitSharedSwapApproval).toHaveBeenCalledOnce();
    expect(f.prepareQuote).toHaveBeenCalledWith(expect.objectContaining({ graph: expect.objectContaining({ blockNumber: 99n, blockHash: f.sharedFunds.head.hash }) }));
    expect(f.sender.readCurrentTokenFunding).not.toHaveBeenCalled(); expect(f.sender.prepareCurrentTokenFunding).not.toHaveBeenCalled(); expect(f.sender.submitCurrentTokenFunding).not.toHaveBeenCalled();
    expect(hooks.confirm.mock.calls[0][0].summaryRows).toContainEqual({ label: 'Amount (tokens)', value: '1.234567' });
  });
  it.skipIf(key === 'cheap-prepared').each(['insufficient', 'unmatched', 'exact'] as const)('handles %s private funding without automatic claims or allowance replacement', async state => {
    const f = admittedFundingFixture(), input = f.sharedTokens.find(token => token.address.toLowerCase() === addresses[1].toLowerCase())!;
    if (state === 'insufficient') input.balance = 1n;
    else input.allowance = state === 'exact' ? 1_234_567n : 1n;
    f.click('Get Quote');
    await vi.waitFor(() => expect(f.status()).toContain(state === 'insufficient' ? 'Claim test tokens separately' : state === 'unmatched' ? 'differs from this exact swap amount' : 'Funding reached Quote submission'));
    expect(f.sender.prepareSharedSwapApproval).not.toHaveBeenCalled(); expect(f.sender.submitSharedSwapApproval).not.toHaveBeenCalled();
    expect(f.sender.prepareCurrentTokenFunding).not.toHaveBeenCalled();
    expect(f.prepareQuote).toHaveBeenCalledOnce();
  });
  it.skipIf(key === 'cheap-prepared')('does not submit approval or Quote after review cancel', async () => {
    const f = admittedFundingFixture(); hooks.confirm.mockResolvedValue(false); f.click('Get Quote');
    await vi.waitFor(() => expect(f.status()).toContain('Exact approval cancelled'));
    expect(f.sender.submitSharedSwapApproval).not.toHaveBeenCalled(); expect(f.prepareQuote).toHaveBeenCalledOnce();
  });
  it.skipIf(key === 'cheap-prepared')('rejects changed selected pair during approval review', async () => {
    const f = admittedFundingFixture(); let resolve!: (value: boolean) => void;
    hooks.confirm.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; })); f.click('Get Quote');
    await vi.waitFor(() => expect(hooks.confirm).toHaveBeenCalled()); f.props.selectedPair = ['ORBT', 'EMBR'] as TradingPair; f.render(); resolve(true);
    await vi.waitFor(() => expect(f.status()).toContain('changed during input funding'));
    expect(f.sender.submitSharedSwapApproval).not.toHaveBeenCalled(); expect(f.prepareQuote).toHaveBeenCalledOnce();
  });
  it.skipIf(key !== 'cheap-prepared')('rejects unsupported prepared approval before either funding adapter in the injected local flow', async () => {
    const f = admittedFundingFixture(); f.click('Get Quote');
    await vi.waitFor(() => expect(f.status()).toContain('Prepared-candidate swap approval is not supported'));
    expect(f.sender.readSharedTokenFunding).not.toHaveBeenCalled(); expect(f.sender.readCurrentTokenFunding).not.toHaveBeenCalled();
    expect(f.sender.prepareSharedSwapApproval).not.toHaveBeenCalled(); expect(f.prepareQuote).not.toHaveBeenCalled();
  });
  it('uses maintained selected labels, six-decimal amounts and ordered balance tokens', () => {
    const f = fixture();
    const funds = elements(f.render()).find(element => element.type === CurrentSharedTestTokenControls)!;
    expect((funds.props as unknown as { candidateKey: string }).candidateKey).toBe(key);
    expect(text(f.render())).toContain('Buy EMBR');
    expect(text(f.render())).toContain('You sendORBT');
    expect(text(f.render())).toContain('Estimated receiveEMBR');
    expect(text(elements(f.render()).find(e => e.props['aria-label'] === 'Input token balance')?.props.children)).toBe('Balance: 2.345678');
    expect(text(elements(f.render()).find(e => e.props['aria-label'] === 'Output token balance')?.props.children)).toBe('Balance: 1.234567');
    expect(hooks.balances).toHaveBeenLastCalledWith(f.props.sharedWalletSession, '', { candidate: prepared, tokens: addresses });
    expect(parseDexCandidateTokenAmount(prepared, addresses[1], '1.234567', 'You send')).toBe(1234567n);
    expect(formatDexCandidateTokenAmount(prepared, addresses[0], 1234567n)).toBe('1.234567');
    expect(() => parseDexCandidateTokenAmount(prepared, addresses[1], '1.2345678', 'You send')).toThrow('at most 6 decimal');
    f.click('Sell');
    expect(text(f.render())).toContain('You sendEMBR');
    expect(text(f.render())).toContain('Estimated receiveORBT');
    f.props.selectedPair = ['ORBT', 'EMBR'] as TradingPair;
    f.render();
    expect(hooks.balances).toHaveBeenLastCalledWith(f.props.sharedWalletSession, '', { candidate: prepared, tokens: [...addresses].reverse() });
  });
  it('holds Get Quote before sender, funding, quote, receipt or wallet actions', () => {
    const f = fixture();
    const input = elements(f.render()).find(e => e.props['aria-label'] === 'Maximum input')!;
    input.props.onChange!({ target: { value: '1.234567' } });
    let hold = '';
    try { assertCurrentSwapCandidate(prepared); } catch (error) { hold = (error as Error).message; }
    expect(hold).toContain(key === 'cheap-history' ? 'Shared-history DEX App signing hold remains active' : 'native App submission admission is absent');
    f.click('Get Quote');
    expect(f.status()).toBe(hold);
    expect(f.getCapability).not.toHaveBeenCalled(); expect(f.getQuote).not.toHaveBeenCalled(); expect(f.getReceipt).not.toHaveBeenCalled();
    expect(f.sender.readCurrentTokenFunding).not.toHaveBeenCalled(); expect(f.sender.prepareCurrentTokenFunding).not.toHaveBeenCalled();
    expect(f.sender.submitCurrentTokenFunding).not.toHaveBeenCalled(); expect(f.providerRequest).not.toHaveBeenCalled(); expect(hooks.confirm).not.toHaveBeenCalled();
  });
  it.each(['candidate', 'pair'] as const)('checks only the exact prepared candidate and invalidates readiness when %s changes', async change => {
    const f = fixture(); f.click('Check current contracts');
    await vi.waitFor(() => expect(f.status()).toContain('Current test contracts verified'));
    expect(f.getCapability).toHaveBeenCalledWith(BigInt(prepared.chainId), { candidate: key });
    expect(f.sender.checkCurrentCheapCandidate).toHaveBeenCalledOnce();
    expect(f.button('Check current contracts')).toBeUndefined();
    expect(f.providerRequest).not.toHaveBeenCalled(); expect(f.getQuote).not.toHaveBeenCalled(); expect(hooks.confirm).not.toHaveBeenCalled();
    if (change === 'candidate') f.props.candidateKey = 'cheap-current';
    else f.props.selectedPair = ['ORBT', 'EMBR'] as TradingPair;
    expect(f.button('Check current contracts')).toBeDefined();
  });
  it.each(['candidate', 'pair'] as const)('rejects an in-flight contract check after %s changes', async change => {
    const f = fixture();
    let complete!: (value: Awaited<ReturnType<typeof f.sender.checkCurrentCheapCandidate>>) => void;
    f.sender.checkCurrentCheapCandidate.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    f.click('Check current contracts');
    await vi.waitFor(() => expect(f.sender.checkCurrentCheapCandidate).toHaveBeenCalledOnce());
    if (change === 'candidate') f.props.candidateKey = 'cheap-current';
    else f.props.selectedPair = ['ORBT', 'EMBR'] as TradingPair;
    f.render();
    complete({ chainId: BigInt(prepared.chainId), owner, core: prepared.core, graph: prepared.graph, readyToSign: false });
    await vi.waitFor(() => expect(f.status()).toContain('changed during the contract check'));
    expect(f.button('Check current contracts')).toBeDefined();
    expect(f.getCapability).toHaveBeenCalledOnce(); expect(f.providerRequest).not.toHaveBeenCalled();
  });
  it.each([['EMBR', 'EMBR'], ['unknown', 'ORBT']])('rejects unsupported selected pair %s/%s', (a, b) => {
    const f = fixture(); f.props.selectedPair = [a, b] as TradingPair;
    expect(() => f.render()).toThrow(a === b ? 'must be distinct' : 'outside the prepared DEX candidate');
    expect(f.getCapability).not.toHaveBeenCalled();
  });
  it.each(['pair', 'candidate'] as const)('hides old quote and private-result bindings after %s change', change => {
    const f = fixture();
    const scope = hooks.refs.find(ref => typeof ref.current === 'object' && ref.current !== null && 'privacyReady' in ref.current)?.current;
    expect(scope).toBeDefined();
    hooks.states[10] = { scope, text: 'Old private result fixture' };
    // quoteReview follows the session timing and visibility state in CurrentSwapWorkspace.
    hooks.states[25] = { scope, model: { summaryRows: [{ label: 'You receive', value: '1.234567 EMBR' }] } };
    expect(text(f.render())).toContain('Old private result fixture');
    expect(text(f.render())).toContain('1.234567 EMBR');
    if (change === 'pair') f.props.selectedPair = ['ORBT', 'EMBR'] as TradingPair;
    else f.props.candidateKey = 'cheap-current';
    const tree = f.render();
    expect(text(tree)).not.toContain('Old private result fixture');
    expect(text(elements(tree).find(e => e.props['aria-label'] === 'Estimated output')?.props.children)).toBe('—');
    expect(f.getCapability).not.toHaveBeenCalled();
  });
  it('keeps historical defaults and single-argument capability lookup', async () => {
    const f = fixture(undefined);
    // Explicitly omit the candidate prop to exercise the component default.
    f.props.candidateKey = undefined;
    expect(text(f.render())).toContain('You sendTest token 1');
    expect(text(f.render())).toContain('Estimated receiveTest token 0');
    expect(hooks.balances).toHaveBeenLastCalledWith(f.props.sharedWalletSession, '', { candidate: CURRENT_CHEAP_DEX_CANDIDATE, tokens: CURRENT_CHEAP_DEX_CANDIDATE.tokens.slice(0, 2).map(([address]) => address) });
    f.sender.checkCurrentCheapCandidate.mockResolvedValueOnce({ chainId: BigInt(CURRENT_CHEAP_DEX_CANDIDATE.chainId), owner, core: CURRENT_CHEAP_DEX_CANDIDATE.core, graph: CURRENT_CHEAP_DEX_CANDIDATE.graph, readyToSign: false });
    f.click('Check current contracts'); await vi.waitFor(() => expect(f.status()).toContain('verified'));
    expect(f.getCapability).toHaveBeenCalledWith(BigInt(CURRENT_CHEAP_DEX_CANDIDATE.chainId));
  });
  it('rejects read-only candidate identity mismatch without a fallback', async () => {
    const f = fixture(); f.sender.checkCurrentCheapCandidate.mockResolvedValueOnce({ chainId: BigInt(prepared.chainId), owner, core: CURRENT_CHEAP_DEX_CANDIDATE.core, graph: prepared.graph, readyToSign: false });
    await expect(verifyCurrentTrialCandidate(f.getCapability as never, owner, key)).rejects.toThrow('identity changed');
    expect(f.getCapability).toHaveBeenCalledOnce(); expect(f.providerRequest).not.toHaveBeenCalled();
  });
  it('requests the selected reconciliation capability and does not fall back on failure', async () => {
    const f = fixture(); const hash = `0x${'55'.repeat(32)}`;
    await reconcileCurrentTrialPending(f.getCapability as never, null, hash, key);
    expect(f.getCapability).toHaveBeenCalledWith(BigInt(prepared.chainId), { candidate: key });
    expect(f.sender.recoverPendingCurrentCheapAttempt).toHaveBeenCalledWith(hash);
    f.getCapability.mockRejectedValueOnce(new Error('Selected capability unavailable'));
    await expect(reconcileCurrentTrialPending(f.getCapability as never, null, hash, key)).rejects.toThrow('Selected capability unavailable');
    expect(f.getCapability).toHaveBeenCalledTimes(2);
    expect(f.sender.recoverPendingCurrentCheapAttempt).toHaveBeenCalledOnce();
  });
  it.skipIf(key === 'cheap-prepared').each(['cheap-async','fast-pool'] as const)('restores the authenticated %s origin through Check current state without a send', async profile => {
    const f = fixture(), quoteHash = `0x${'55'.repeat(32)}`;
    const issued = { transactionHash: quoteHash, operationId: 30n,
      intent: { profile, candidate: prepared, destination: owner, inputToken: addresses[1], outputToken: addresses[0],
        maximumInput: 1_234_567n, minimumInput: 617_284n, minimumOutput: 900_000n, toleranceBps: 25,
        rateNumerator: 0n, rateDenominator: 1n },
      operation: { ready: true, phase: 'ready', stage: 5 }, readCurrent: vi.fn() };
    issued.readCurrent.mockResolvedValue(issued);
    const restoreCurrentCheapOperation = vi.fn(async () => issued);
    Object.assign(f.sender, { readCurrentCheapRestoreHint: vi.fn(() => ({ quoteHash })), restoreCurrentCheapOperation });
    const restoreCurrentQuote = vi.fn(async () => issued);
    f.getQuote.mockResolvedValue({ restoreCurrentQuote });
    f.click('Check current state');
    await vi.waitFor(() => expect(f.status()).toBe('Private Quote is READY for review.'));
    expect(f.getQuote).toHaveBeenCalledWith(BigInt(prepared.chainId));
    expect(restoreCurrentQuote).toHaveBeenCalledWith({ quoteHash });
    expect(restoreCurrentCheapOperation).toHaveBeenCalledWith(issued);
    expect(issued.readCurrent).toHaveBeenCalledOnce();
    const tree = elements(f.render());
    expect(tree.find(e => e.props['aria-label'] === 'Maximum input')?.props).toMatchObject({ value: '1.234567', disabled: true });
    expect(tree.find(e => e.props['aria-label'] === 'Minimum input fill')?.props).toMatchObject({ value: '0.617284', disabled: true });
    expect(tree.find(e => e.props['aria-label'] === 'Minimum net output')?.props).toMatchObject({ value: '0.9', disabled: true });
    expect(tree.find(e => e.type === 'button' && text(e.props.children) === (profile==='cheap-async'?'Multi-source':'Fast'))?.props['aria-pressed']).toBe(true);
    expect(text(f.render())).toContain('0.25%');
    expect(f.providerRequest).not.toHaveBeenCalled(); expect(hooks.confirm).not.toHaveBeenCalled();
    expect(f.sender.submitSharedSwapApproval).not.toHaveBeenCalled();
  });
  it.skipIf(key === 'cheap-prepared').each(['pair', 'privacy'] as const)('rejects reload restoration when %s changes during the read', async change => {
    const f = fixture(), quoteHash = `0x${'55'.repeat(32)}`;
    let complete!: (issued: unknown) => void;
    const restoreCurrentQuote = vi.fn(() => new Promise(resolve => { complete = resolve; }));
    const restoreCurrentCheapOperation = vi.fn();
    Object.assign(f.sender, { readCurrentCheapRestoreHint: vi.fn(() => ({ quoteHash })), restoreCurrentCheapOperation });
    f.getQuote.mockResolvedValue({ restoreCurrentQuote });
    f.click('Check current state');
    await vi.waitFor(() => expect(restoreCurrentQuote).toHaveBeenCalledOnce());
    if (change === 'pair') f.props.selectedPair = ['ORBT', 'EMBR'] as TradingPair;
    else f.props.sharedWalletSession = { ...f.props.sharedWalletSession, sessionOnboardInfo: {} };
    f.render(); complete({});
    await vi.waitFor(() => expect(f.status()).toContain('changed during Quote restoration'));
    expect(restoreCurrentCheapOperation).not.toHaveBeenCalled(); expect(f.providerRequest).not.toHaveBeenCalled();
  });
  it.skipIf(key === 'cheap-prepared').each(['hashless', 'private-failure', 'wrong-pair'] as const)('keeps %s restoration held', async fault => {
    const f = fixture(), quoteHash = fault === 'hashless' ? null : `0x${'55'.repeat(32)}`;
    const restoreCurrentCheapOperation = vi.fn(async () => { throw new Error('Original private verification remains blocked.'); });
    Object.assign(f.sender, { readCurrentCheapRestoreHint: vi.fn(() => ({ quoteHash })), restoreCurrentCheapOperation });
    const issued = { intent: { profile: 'cheap-async', candidate: prepared, destination: owner,
      inputToken: fault === 'wrong-pair' ? addresses[0] : addresses[1], outputToken: addresses[0] } };
    const restoreCurrentQuote = vi.fn(async () => issued);
    f.getQuote.mockResolvedValue({ restoreCurrentQuote });
    f.click('Check current state');
    await vi.waitFor(() => expect(f.status()).toContain(fault === 'hashless' ? 'no known Quote hash' :
      fault === 'wrong-pair' ? 'original swap pair and side' : 'private verification remains blocked'));
    if (fault !== 'private-failure') expect(restoreCurrentCheapOperation).not.toHaveBeenCalled();
    expect(f.providerRequest).not.toHaveBeenCalled(); expect(hooks.confirm).not.toHaveBeenCalled();
    expect(f.button('Review and Accept')).toBeUndefined();
  });
});

});
