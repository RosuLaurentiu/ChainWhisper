import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as poolInputs from '../../../lib/currentDexPoolFunding';
import CurrentPoolWorkspace, { currentPoolIntent } from './CurrentPoolWorkspace';
import PrivacyLockedNotice from '../../../shared/components/PrivacyLockedNotice';
import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import { readCurrentDexDisplay } from '../../../lib/currentDexDisplay';
import { CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY } from '../../../lib/currentDexC1SwapPolicy';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY } from '../../../lib/currentDexPendingAttempt';
import { currentDexMarketReference, type CurrentDexMarketReference } from '../../../lib/currentDexMarketReference';
import { readCurrentDexDailyPrice } from '../../../lib/currentDexDailyPrice';
import { makeHistoryFixture, HISTORY_FIXTURE_DAY } from '../../../../tests/fixtures/history.fixture';

const hooks = vi.hoisted(() => ({ index: 0, refIndex: 0, states: [] as unknown[], refs: [] as { current: unknown }[], confirm: vi.fn(), allowNative: false }));
// Only local capability wiring tests may pass the hold. The default uses the real gate.
vi.mock('../../../lib/dexV2Deployment', async original => {
  const actual = await original<typeof import('../../../lib/dexV2Deployment')>();
  return { ...actual, assertCurrentCheapDexNativeAdmission: (value: Parameters<typeof actual.assertCurrentCheapDexNativeAdmission>[0]) => {
    if (!hooks.allowNative) actual.assertCurrentCheapDexNativeAdmission(value);
  } };
});
vi.mock('../../../lib/currentDexC1SwapPolicy', async original => {
  const actual = await original<typeof import('../../../lib/currentDexC1SwapPolicy')>();
  return { ...actual, assertCurrentAppPoolAuthority: (graph: string, scope: Parameters<typeof actual.assertCurrentAppPoolAuthority>[1]) => {
    if (!hooks.allowNative) actual.assertCurrentAppPoolAuthority(graph, scope);
  }, assertCurrentAppPoolAllowanceCleanupAuthority: (graph: string, account: string) => {
    if (!hooks.allowNative) actual.assertCurrentAppPoolAllowanceCleanupAuthority(graph, account);
  } };
});
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.states)) hooks.states[i] = initial;
    return [hooks.states[i], (value: unknown) => { hooks.states[i] = typeof value === 'function' ? value(hooks.states[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); }
}));
vi.mock('../../trading/hooks/useTradeActionConfirmationState', () => ({ default: () => ({ confirmation: null, requestConfirmation: hooks.confirm, resolveConfirmation: vi.fn() }) }));
type Props = { children?: ReactNode; onClick?: () => void; disabled?: boolean; role?: string; 'aria-label'?: string; 'aria-current'?: string };
const elements = (node: ReactNode): ReactElement<Props>[] => Array.isArray(node) ? node.flatMap(elements) : isValidElement<Props>(node) ? [node, ...elements(node.props.children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : isValidElement<Props>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const owner = `0x${'22'.repeat(20)}`;
describe.each(['cheap-prepared', 'cheap-exit', 'cheap-history'] as const)('%s prepared consumers', key => {
const candidate = resolveCurrentCheapDexCandidate(key);
function fixture() {
  vi.stubGlobal('window', { sessionStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
  const getPool = vi.fn(), getSender = vi.fn(), request = vi.fn();
  const session = { walletAddress: owner, sessionOnboardInfo: { [owner]: { aesKey: 'local-fixture-only' } }, walletAesHealthByAddress: {}, chainId: Number(candidate.chainId), browserProvider: { request },
    actions: { getCurrentDexPoolFundingCapability: getPool, getCurrentDexSubmissionCapability: getSender } } as unknown as SharedWalletSession;
  const props = { sharedWalletSession: session, candidateKey: key as CurrentCheapDexCandidateKey,
    selectedPair: ['EMBR', 'ORBT'] as readonly [string, string], priceDisplayInverted: false };
  const render = () => { hooks.index = 0; hooks.refIndex = 0; return CurrentPoolWorkspace(props); };
  const button = (label: string) => elements(render()).find(element => element.type === 'button' && text(element.props.children) === label)!;
  render(); return { props, render, button, getPool, getSender, request };
}
afterEach(() => { hooks.states = []; hooks.refs = []; hooks.allowNative = false; vi.clearAllMocks(); vi.unstubAllGlobals(); });

function fundingFixture() {
  const f = fixture(), scope = hooks.refs[2].current;
  const pair = readCurrentDexDisplay(candidate).pairs.find(value => value.tokens.every(token => ['EMBR', 'ORBT'].includes(token.label)))!;
  const funding = { intent: currentPoolIntent('1', '1', '2', 1, '0.5'), amounts: { used0: 1234567n, used1: 2345678n },
    abandonUnfunded: vi.fn(async () => ({ status: 'unfunded-cleanup-required', cleanupRequired: [true, false] })) };
  hooks.states[10] = { value: funding, scope };
  const tokens = readCurrentDexDisplay(candidate).tokens.map(token => ({ address: token.address, decimals: 6, allowance: 0n, balance: 9_000_000n }));
  const outcome = { token: pair.tokens[0].address, fundingOutcome: 'verified', privateAccountingVerified: true,
    funds: { owner, core: candidate.core, graph: candidate.graph, packageSha256: candidate.packageSha256, tokens,
      privateFundsVerified: true, readyToSign: false } };
  const recover = vi.fn(async () => outcome), prepared = { data: 'test-only' };
  const sender = { checkCurrentCheapCandidate: vi.fn(async () => ({ owner, chainId: BigInt(candidate.chainId), core: candidate.core,
    graph: candidate.graph, packageSha256: candidate.packageSha256, readyToSign: false })),
    readSharedPoolAllowances: vi.fn(async (): Promise<readonly [boolean, boolean]> => [false, false]),
    prepareSharedPoolApproval: vi.fn(async () => prepared), prepareSharedPoolAllowanceCleanup: vi.fn(async () => prepared),
    submitSharedPoolApproval: vi.fn(async () => ({ transactionHash: 'test-only-hash', recover })),
    waitForCurrentCheapReceipt: vi.fn(async () => false),
    submitPoolFunding: vi.fn(), recoverCurrentPreparedPoolFundingResult: vi.fn(async () => null),
    recoverPendingSharedPoolApproval: vi.fn(async () => ({ status: 'observed-mined', privateAccountingVerified: false })),
    recoverPendingPoolAttempt: vi.fn(async () => null) };
  f.getSender.mockResolvedValue(sender);
  return { ...f, scope, pair, funding, sender, prepared, recover, outcome, tokens };
}
describe('prepared Pool creation view', () => {
  if(key==='cheap-history')it('opens position recovery for a saved owner action and enables deposit preview after reconciliation',()=>{
    const f=fixture(), open=vi.fn();
    Object.assign(f.props,{onOpenPositions:open});
    hooks.states[0]='1';hooks.states[1]='1';hooks.states[2]='2';
    let saved:string|null=JSON.stringify({version:1,chainId:String(candidate.chainId),owner,core:candidate.core.toLowerCase(),
      graph:'0x'+candidate.graph,phase:'pool-owner',nonce:12,txHash:'0x'+'33'.repeat(32),callHash:'0x'+'44'.repeat(32)});
    vi.stubGlobal('window',{sessionStorage:{getItem:(k:string)=>k===CURRENT_DEX_PENDING_ATTEMPT_KEY?saved:null}});
    expect(f.button('Preview deposit').props.disabled).toBe(true);
    f.button('Open position recovery').props.onClick!();
    expect(open).toHaveBeenCalledOnce();expect(f.getSender).not.toHaveBeenCalled();
    saved=null;
    expect(f.button('Preview deposit').props.disabled).toBe(false);
  });
  it('keeps blank and locked deposit reviews disabled without wallet calls', () => {
    const f = fixture();
    expect(f.button('Preview deposit').props.disabled).toBe(true);
    hooks.states[0] = '1'; hooks.states[1] = '1'; hooks.states[2] = '2';
    expect(f.button('Preview deposit').props.disabled).toBe(false);
    f.props.sharedWalletSession = { ...f.props.sharedWalletSession, sessionOnboardInfo: {} };
    expect(f.button('Preview deposit').props.disabled).toBe(true);
    const notice = () => elements(f.render()).find(element => element.type === PrivacyLockedNotice) as ReactElement<{ message: string; onUnlock?: () => unknown }> | undefined;
    expect(notice()?.props.message).toBe('Your deposit preview is locked.');
    expect(notice()?.props.onUnlock).toBeUndefined();
    expect(text(f.render())).not.toContain('Unlock privacy with MetaMask');
    const unlockPrivacy = vi.fn(async () => undefined);
    f.props.sharedWalletSession = { ...f.props.sharedWalletSession, actions: { ...f.props.sharedWalletSession.actions, unlockPrivacy } } as SharedWalletSession;
    notice()!.props.onUnlock!();
    expect(unlockPrivacy).toHaveBeenCalledTimes(1);
    expect(f.getPool).not.toHaveBeenCalled(); expect(f.getSender).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it('shows scoped creation steps without treating recovery as a ready position', () => {
    const f = fundingFixture(); hooks.states[10] = null;
    const current = () => text(elements(f.render()).find(element => element.props['aria-current'] === 'step')!);
    expect(current()).toBe('1Preview');
    const preview = { amounts: { operation: 'add', used0: 1n, used1: 1n, unused0: 0n, unused1: 0n, mintedShares: 1n, ownedShares: 1n, toleranceN: 1n, toleranceD: 200n } };
    hooks.states[9] = { value: preview, scope: f.scope };
    expect(current()).toBe('2Approve (0/2)');
    hooks.states[10] = { value: f.funding, scope: f.scope };
    expect(current()).toBe('2Approve (0/2)');
    hooks.states[11] = [true, false]; expect(current()).toBe('2Approve (1/2)');
    hooks.states[11] = [true, true]; expect(current()).toBe('3Deposit');
    hooks.states[13] = { phase: 'fund', scope: f.scope, recover: vi.fn() };
    expect(current()).toBe('3Deposit');
    hooks.states[13] = null; hooks.states[10] = null; hooks.states[15] = 42n; hooks.refs[4].current = f.scope;
    expect(current()).toBe('Done · Complete');
    expect(text(f.render())).toContain('Approve · Complete');
    hooks.states[6] = true; expect(current()).not.toContain('Done');
    hooks.states[6] = false; hooks.states[16] = true; expect(current()).not.toContain('Done');
    hooks.states[10] = { value: f.funding, scope: f.scope }; hooks.states[17] = true;
    expect(elements(f.render()).some(element => element.props['aria-current'] === 'step')).toBe(false);
    expect(text(f.render())).toContain('Deposit stopped. Unused approvals cleared.');
    f.props.sharedWalletSession = { ...f.props.sharedWalletSession, walletAddress: `0x${'33'.repeat(20)}` };
    expect(current()).toBe('1Preview');
  });
  it.each(['unchanged', 'owner', 'pair'] as const)('handles a submitted preview when scope is %s during confirmation', async change => {
    hooks.allowNative = true; const f = fundingFixture(); hooks.states[10] = null;
    hooks.states[0] = '1'; hooks.states[1] = '1'; hooks.states[2] = '2';
    const hash = `0x${'44'.repeat(32)}`;
    const preview = { prepareFunding: vi.fn(), amounts: { operation: 'add', used0: 1234567n, used1: 2345678n,
      unused0: 0n, unused1: 0n, mintedShares: 17n, ownedShares: 17n, toleranceN: 1n, toleranceD: 200n } };
    const recover = vi.fn(async () => preview);
    let confirmReceipt!: (value: boolean) => void;
    const receipt = new Promise<boolean>(resolve => { confirmReceipt = resolve; });
    const sender = { ...f.sender, submitPoolPreview: vi.fn(async () => ({ transactionHash: hash, recover })),
      waitForCurrentCheapReceipt: vi.fn(() => receipt) };
    f.getSender.mockResolvedValue(sender); f.request.mockResolvedValue({ number: '0x1', hash });
    f.getPool.mockResolvedValue({ preparePoolCreation: vi.fn(async () => ({ data: 'preview' })) });
    f.button('Preview deposit').props.onClick!();
    await vi.waitFor(() => expect(sender.waitForCurrentCheapReceipt).toHaveBeenCalledWith(hash));
    expect(f.button('Preview deposit').props.disabled).toBe(true);
    if (change === 'owner') f.props.sharedWalletSession = { ...f.props.sharedWalletSession, walletAddress: `0x${'33'.repeat(20)}` };
    if (change === 'pair') f.props.selectedPair = ['BCN', 'HBR'];
    if (change !== 'unchanged') f.render();
    confirmReceipt(true);
    if (change === 'unchanged') {
      await vi.waitFor(() => expect(text(f.render())).toContain('Private Pool preview verified'));
      expect(text(f.render())).toContain('1.234567');
      expect(f.button('Review funding').props.disabled).toBe(false);
      expect(f.button('Preview deposit')).toBeUndefined();
      await vi.waitFor(() => expect(hooks.states[5]).toBe(false));
      expect(text(f.render())).toContain('1.234567');
      expect(sender.submitPoolPreview).toHaveBeenCalledOnce();
      expect(f.getSender).toHaveBeenCalledOnce();
      expect(f.request).toHaveBeenCalledOnce();
      hooks.states[0] = '2';
      expect(f.button('Preview deposit').props.disabled).toBe(false);
      expect(recover).toHaveBeenCalledOnce();
      f.button('Preview deposit').props.onClick!();
      await vi.waitFor(() => expect(sender.submitPoolPreview).toHaveBeenCalledTimes(2));
    } else {
      await vi.waitFor(() => expect(hooks.states[5]).toBe(false));
      expect(recover).not.toHaveBeenCalled();
      expect(text(f.render())).not.toContain('1.234567');
      expect(hooks.states[13]).not.toBeNull();
    }
    expect(sender.submitPoolFunding).not.toHaveBeenCalled();
    expect(sender.submitSharedPoolApproval).not.toHaveBeenCalled();
  });
  it('verifies a confirmed approval without a manual status check', async () => {
    hooks.allowNative = true; const f = fundingFixture();
    f.tokens.find(token => token.address === f.pair.tokens[0].address)!.allowance = f.funding.amounts.used0;
    f.sender.waitForCurrentCheapReceipt.mockResolvedValueOnce(true);
    f.button(`Approve exact ${f.pair.tokens[0].label}`).props.onClick!();
    await vi.waitFor(() => expect(text(f.render())).toContain(`Exact ${f.pair.tokens[0].label} approval verified`));
    expect(f.sender.waitForCurrentCheapReceipt).toHaveBeenCalledOnce();
    expect(f.recover).toHaveBeenCalledOnce();
    expect(f.sender.submitPoolFunding).not.toHaveBeenCalled();
  });
  it.each(['timeout', 'proof failure'] as const)('keeps the approval held on %s', async fault => {
    hooks.allowNative = true; const f = fundingFixture();
    if (fault === 'proof failure') {
      f.sender.waitForCurrentCheapReceipt.mockResolvedValueOnce(true);
      f.outcome.privateAccountingVerified = false;
    }
    f.button(`Approve exact ${f.pair.tokens[0].label}`).props.onClick!();
    await vi.waitFor(() => expect(text(f.render())).toContain(fault === 'timeout' ? 'Pool transaction is pending' : 'no authenticated private accounting'));
    expect(hooks.states[6]).toBe(true);
    expect(hooks.states[13]).not.toBeNull();
    expect(f.sender.submitPoolFunding).not.toHaveBeenCalled();
    expect(f.recover).toHaveBeenCalledTimes(fault === 'timeout' ? 0 : 1);
  });
  it('shows the position only after funding confirmation and private recovery', async () => {
    hooks.allowNative = true; const f = fundingFixture(); hooks.states[11] = [true, true];
    const recover = vi.fn(async () => ({ positionId: 42n }));
    f.sender.submitPoolFunding.mockResolvedValueOnce({ transactionHash: 'test-funding-hash', recover } as never);
    f.sender.waitForCurrentCheapReceipt.mockResolvedValueOnce(true);
    f.button('Review and fund Pool').props.onClick!();
    await vi.waitFor(() => expect(text(f.render())).toContain('Position NFT 42 minted'));
    expect(recover).toHaveBeenCalledOnce();
    expect(f.sender.submitPoolFunding).toHaveBeenCalledOnce();
    expect(f.sender.submitSharedPoolApproval).not.toHaveBeenCalled();
  });
  if (key === 'cheap-history') it('shows deposit preparation while the wallet call is pending and blocks a second submit', async () => {
    hooks.allowNative = true; const f = fundingFixture(); hooks.states[11] = [true, true];
    let finish!: (value: unknown) => void;
    f.sender.submitPoolFunding.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.button('Review and fund Pool').props.onClick!();
    await vi.waitFor(() => expect(f.sender.submitPoolFunding).toHaveBeenCalledOnce());
    expect(text(f.render())).toContain('Checking the deposit before requesting a wallet transaction.');
    const progress = f.sender.submitPoolFunding.mock.calls[0][1];
    progress.walletRequested();
    expect(text(f.render())).toContain('Open your wallet to review or reject the deposit request.');
    progress.transactionHashReturned('test-funding-hash');
    expect(text(f.render())).toContain('Wallet returned a deposit transaction hash.');
    f.button('Review and fund Pool').props.onClick!();
    expect(f.sender.submitPoolFunding).toHaveBeenCalledOnce();
    const recover = vi.fn(); finish({ transactionHash: 'test-funding-hash', recover });
    await vi.waitFor(() => expect(text(f.render())).toContain('Pool transaction is pending'));
    expect(recover).not.toHaveBeenCalled();
    expect(hooks.states[6]).toBe(true);
    expect(hooks.states[13]).not.toBeNull();
    expect(f.button('Check Pool status').props.disabled).toBe(false);
  });
  it.each([0, 1, 2, 3, 4, 5])('shows only canonical token budgets for selected market %i', index => {
    const f = fixture(), pair = readCurrentDexDisplay(candidate).pairs[index];
    f.props.selectedPair = [pair.tokens[1].label, pair.tokens[0].label];
    const tree = f.render();
    expect(elements(tree).filter(element => element.type === 'input' && element.props['aria-label']?.endsWith('Pool budget')).map(element => element.props['aria-label']))
      .toEqual(pair.tokens.map(token => `${token.label} Pool budget`));
    expect(text(tree)).toContain(`Starting price *${pair.tokens[0].label}/${pair.tokens[1].label}`);
    f.props.priceDisplayInverted = true;
    expect(text(f.render())).toContain(`Starting price *${pair.tokens[1].label}/${pair.tokens[0].label}`);
    expect(f.getPool).not.toHaveBeenCalled(); expect(f.getSender).not.toHaveBeenCalled();
  });
  // Owner decision 2026-11-18: the price and one amount fill the other amount; two amounts with no price fill the price.
  it('links the starting price and the two budgets in the displayed units', () => {
    const f = fixture(), pair = readCurrentDexDisplay(candidate).pairs[0];
    f.props.selectedPair = [pair.tokens[1].label, pair.tokens[0].label];
    const field = (label: string) => elements(f.render()).find(element => element.type === 'input' && element.props['aria-label'] === label)!.props as
      Props & { value: string; onChange: (event: { target: { value: string } }) => void };
    const [quote, base] = [`${pair.tokens[0].label} Pool budget`, `${pair.tokens[1].label} Pool budget`];
    const order = elements(f.render()).filter(element => element.type === 'input').map(element => element.props['aria-label']);
    expect(order.indexOf('Pool starting price')).toBeLessThan(order.indexOf(quote));
    field('Pool starting price').onChange({ target: { value: '2' } });
    field(base).onChange({ target: { value: '10' } });
    expect(field(quote).value).toBe('20');
    field('Pool starting price').onChange({ target: { value: '2.5' } });
    expect(field(quote).value).toBe('25');
    field(quote).onChange({ target: { value: '5' } });
    expect(field(base).value).toBe('2');
    field('Pool starting price').onChange({ target: { value: '' } }); field(base).onChange({ target: { value: '' } });
    field(quote).onChange({ target: { value: '30' } }); field(base).onChange({ target: { value: '10' } });
    expect(field('Pool starting price').value).toBe('3');
    f.props.priceDisplayInverted = true;
    // Inverted units: 0.5 of the second token per first token. The last edited budget (10 of the second token) fills 20.
    field('Pool starting price').onChange({ target: { value: '0.5' } });
    expect(field(quote).value).toBe('20');
    expect(f.getPool).not.toHaveBeenCalled(); expect(f.getSender).not.toHaveBeenCalled();
  });
  // Owner decision 2026-11-18: an untouched price shows the live Pool price for this pair; the first entry fixes it.
  it('prefills the starting price from the verified live Pool price until the first entry', async () => {
    const f = fixture(), pair = readCurrentDexDisplay(candidate).pairs[0];
    const selected = [pair.tokens[1].label, pair.tokens[0].label] as const;
    f.props.selectedPair = selected;
    const history = makeHistoryFixture('empty'), now = HISTORY_FIXTURE_DAY * 86400n + 100n;
    const snapshot = await readCurrentDexDailyPrice({ provider: history.provider, manifest: { ...history.manifest, symbols: selected }, finalityLagBlocks: 0, count: 1 });
    const reference = currentDexMarketReference({ status: 'empty', snapshot }, selected, now);
    expect(reference.status).toBe('available');
    const live = (reference as { price: number }).price;
    const field = (label: string) => elements(f.render()).find(element => element.type === 'input' && element.props['aria-label'] === label)!.props as
      Props & { value: string; onChange: (event: { target: { value: string } }) => void };
    expect(field('Pool starting price').value).toBe('');
    (f.props as { marketReference?: CurrentDexMarketReference }).marketReference = reference;
    expect(field('Pool starting price').value).toBe(String(Number(live.toPrecision(6))));
    f.props.priceDisplayInverted = true;
    expect(field('Pool starting price').value).toBe(String(Number((1 / live).toPrecision(6))));
    f.props.priceDisplayInverted = false;
    expect(text(f.render())).toContain('Live Pool price, rounded.');
    // A reference for another pair is not used.
    (f.props as { marketReference?: CurrentDexMarketReference }).marketReference =
      currentDexMarketReference({ status: 'empty', snapshot: await readCurrentDexDailyPrice({ provider: history.provider,
        manifest: { ...history.manifest, symbols: [selected[1], selected[0]] }, finalityLagBlocks: 0, count: 1 }) }, [selected[1], selected[0]], now);
    expect(field('Pool starting price').value).toBe('');
    (f.props as { marketReference?: CurrentDexMarketReference }).marketReference = reference;
    field(`${selected[0]} Pool budget`).onChange({ target: { value: '10' } });
    const fixed = field('Pool starting price').value;
    expect(fixed).toBe(String(Number(live.toPrecision(6))));
    (f.props as { marketReference?: CurrentDexMarketReference }).marketReference = { status: 'unavailable' };
    expect(field('Pool starting price').value).toBe(fixed);
    expect(f.getPool).not.toHaveBeenCalled(); expect(f.getSender).not.toHaveBeenCalled();
  });
  it('requires live submission capability before provider or private input prompts', async () => {
    const f = fixture(); hooks.states[0] = '1'; hooks.states[1] = '1'; hooks.states[2] = '2';
    if (key === 'cheap-history') f.getSender.mockRejectedValueOnce(new Error('Connected wallet lease is unavailable.'));
    const button = f.button('Preview deposit'); expect(button.props.disabled).toBe(false);
    button.props.onClick!();
    await vi.waitFor(() => expect(text(f.render())).toContain(key==='cheap-history'?'Connected wallet lease is unavailable.':'native App submission admission is absent'));
    expect(f.getPool).not.toHaveBeenCalled(); expect(f.getSender).toHaveBeenCalledTimes(key==='cheap-history'?1:0); expect(f.request).not.toHaveBeenCalled(); expect(hooks.confirm).not.toHaveBeenCalled();
  });
  it.each(['pair', 'candidate', 'owner'] as const)('hides an old private preview after %s changes', change => {
    const f = fixture();
    hooks.states[9] = { scope: hooks.refs[2].current, value: { amounts: { operation: 'add', used0: 1234567n, used1: 2345678n,
      unused0: 0n, unused1: 0n, mintedShares: 17n, ownedShares: 17n, toleranceN: 1n, toleranceD: 200n } } };
    expect(text(f.render())).toContain('1.234567');
    if (change === 'pair') f.props.selectedPair = ['BCN', 'HBR'];
    if (change === 'candidate') f.props.candidateKey = 'cheap-current';
    if (change === 'owner') f.props.sharedWalletSession = { ...f.props.sharedWalletSession, walletAddress: `0x${'33'.repeat(20)}` };
    expect(text(f.render())).not.toContain('1.234567');
    expect(elements(f.render()).some(element => element.props['aria-label'] === 'Authenticated Pool preview')).toBe(false);
  });
  it.each([['EMBR', 'EMBR'], ['unknown', 'ORBT']])('rejects unsupported pair %s/%s', (a, b) => {
    const f = fixture(); f.props.selectedPair = [a, b]; expect(() => f.render()).toThrow();
    expect(f.getPool).not.toHaveBeenCalled(); expect(f.getSender).not.toHaveBeenCalled();
  });
  it('requires live submission capability before approval preparation or confirmations', async () => {
    const f = fundingFixture();
    if (key === 'cheap-history') f.getSender.mockRejectedValueOnce(new Error('Connected wallet lease is unavailable.'));
    f.button(`Approve exact ${f.pair.tokens[0].label}`).props.onClick!();
    await vi.waitFor(() => expect(text(f.render())).toContain(key==='cheap-history'?'Connected wallet lease is unavailable.':'native App submission admission is absent'));
    expect(f.getSender).toHaveBeenCalledTimes(key==='cheap-history'?1:0); expect(hooks.confirm).not.toHaveBeenCalled();
    expect(f.sender.prepareSharedPoolApproval).not.toHaveBeenCalled();
    expect(f.sender.submitSharedPoolApproval).not.toHaveBeenCalled();
  });
  it.each([false, true])('shows candidate-specific funding signature count (packed=%s)', async packed => {
    const profile = vi.spyOn(poolInputs, 'usesPackedPoolInputs').mockReturnValue(packed);
    try {
      hooks.allowNative = true; const f = fundingFixture(); hooks.states[10] = null;
      const amounts = { ...f.funding.amounts, operation: 'add', unused0: 0n, unused1: 0n,
        mintedShares: 17n, ownedShares: 17n, toleranceN: 1n, toleranceD: 200n };
      hooks.states[9] = { value: { prepareFunding: async (confirm: (v: unknown) => Promise<boolean>) => {
        await confirm(amounts); return null;
      }, intent: f.funding.intent, amounts }, scope: f.scope };
      hooks.states[18] = { value: { intent: f.funding.intent }, scope: f.scope };
      f.button('Review funding').props.onClick!();
      await vi.waitFor(() => expect(text(f.render())).toContain('Pool funding cancelled.'));
      expect(hooks.confirm).toHaveBeenCalledWith(expect.objectContaining({ summaryRows: expect.arrayContaining([
        { label: 'Private-input signatures for funding', value: packed ? '8' : '13' }
      ]) }));
      expect(f.sender.submitPoolFunding).not.toHaveBeenCalled();
    } finally { profile.mockRestore(); }
  });
  it('stages the confirmed deposit before either approval or funding', async () => {
    hooks.allowNative = true; const f = fundingFixture(); hooks.states[10] = null;
    const prepareFunding = vi.fn(async () => f.funding);
    hooks.states[9] = { value: { prepareFunding, intent: f.funding.intent, amounts: { ...f.funding.amounts, operation: 'add', unused0: 0n, unused1: 0n,
      mintedShares: 17n, ownedShares: 17n, toleranceN: 1n, toleranceD: 200n } }, scope: f.scope };
    hooks.states[18] = { value: { intent: f.funding.intent }, scope: f.scope };
    f.button('Review funding').props.onClick!();
    await vi.waitFor(() => expect(text(f.render())).toContain('Review and approve each exact token amount'));
    expect(f.getSender).toHaveBeenCalledWith(BigInt(candidate.chainId), { candidate: key });
    expect(f.sender.submitPoolFunding).not.toHaveBeenCalled(); expect(f.sender.prepareSharedPoolApproval).not.toHaveBeenCalled();
    expect(f.button('Review and fund Pool')).toBeUndefined();
  });
  it('reuses existing exact allowances during funding review', async () => {
    hooks.allowNative = true; const f = fundingFixture(); hooks.states[10] = null;
    hooks.states[9] = { value: { prepareFunding: vi.fn(async () => f.funding), intent: f.funding.intent,
      amounts: { ...f.funding.amounts, operation: 'add', unused0: 0n, unused1: 0n,
        mintedShares: 17n, ownedShares: 17n, toleranceN: 1n, toleranceD: 200n } }, scope: f.scope };
    hooks.states[18] = { value: { intent: f.funding.intent }, scope: f.scope };
    f.sender.readSharedPoolAllowances.mockResolvedValueOnce([true, false]);
    f.button('Review funding').props.onClick!();
    await vi.waitFor(() => expect(f.button(`Approve exact ${f.pair.tokens[1].label}`)).toBeDefined());
    expect(f.button(`Approve exact ${f.pair.tokens[0].label}`)).toBeUndefined();
    expect(f.button(`Approve exact ${f.pair.tokens[1].label}`).props.disabled).toBe(false);
    expect(f.sender.submitSharedPoolApproval).not.toHaveBeenCalled();
  });
  it('rechecks the allowance before sending an approval', async () => {
    hooks.allowNative = true; const f = fundingFixture();
    f.sender.readSharedPoolAllowances.mockResolvedValueOnce([true, true]);
    f.button(`Approve exact ${f.pair.tokens[0].label}`).props.onClick!();
    await vi.waitFor(() => expect(text(f.render())).toContain(`Exact ${f.pair.tokens[0].label} allowance verified`));
    expect(f.sender.prepareSharedPoolApproval).not.toHaveBeenCalled();
    expect(f.button('Review and fund Pool').props.disabled).toBe(false);
  });
  it('keeps recovery available and locks its controls while busy', () => {
    const f = fundingFixture();
    const recovery = elements(f.render()).find(element => element.type === 'details' &&
      elements(element).some(child => child.type === 'summary' && text(child) === 'Status and recovery'));
    expect(recovery).toBeDefined();
    expect(elements(recovery).some(child => child.type === 'button' && text(child) === 'Check Pool status')).toBe(false);
    expect(f.button('Check Pool status').props.disabled).toBe(false);
    expect(f.button(`Approve exact ${f.pair.tokens[1].label}`)).toBeUndefined();
    hooks.states[5] = true;
    expect(f.button(`Approve exact ${f.pair.tokens[0].label}`).props.disabled).toBe(true);
    expect(f.button('Check Pool status').props.disabled).toBe(true);
    expect(f.button('Review stop and clear approvals').props.disabled).toBe(true);
  });
  if (key === 'cheap-history') it('admits an engineering owner with exact creation terms before capability access', async () => {
    hooks.states[0] = '1'; hooks.states[1] = '1'; hooks.states[2] = '2'; hooks.states[3] = 0; hooks.states[4] = '0.5';
    const f = fixture();
    f.props.sharedWalletSession = { ...f.props.sharedWalletSession, walletAddress: CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY.owner };
    const pair = readCurrentDexDisplay(candidate).pairs.find(value => value.tokens.every(token => ['EMBR', 'ORBT'].includes(token.label)))!;
    const hash = `0x${'44'.repeat(32)}`;
    const prepared = { data: 'prepared' };
    const preparePoolCreation = vi.fn(async (request: { confirmPrivateInputs: () => Promise<boolean> }) =>
      await request.confirmPrivateInputs() ? prepared : null);
    const sender = { checkCurrentCheapCandidate: vi.fn(async () => ({ owner: CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY.owner,
      chainId: BigInt(candidate.chainId), graph: candidate.graph, core: candidate.core, packageSha256: candidate.packageSha256, readyToSign: false })),
      submitPoolPreview: vi.fn(async () => ({ transactionHash: hash, recover: vi.fn(async () => null) })) };
    f.request.mockResolvedValue({ number: '0x1', hash }); f.getSender.mockResolvedValue(sender);
    f.getPool.mockResolvedValue({ preparePoolCreation });
    f.button('Preview deposit').props.onClick!();
    await vi.waitFor(() => expect(preparePoolCreation).toHaveBeenCalledOnce());
    expect(f.getPool).toHaveBeenCalledWith(BigInt(candidate.chainId), { candidate: key });
    expect(preparePoolCreation.mock.calls[0][0]).toEqual(expect.objectContaining({ pair: pair.tokens.map(token => token.address),
      intent: expect.objectContaining({ classId: 0n, budgets: [1_000_000n, 1_000_000n], terms: expect.any(Array) }) }));
  });
  it('uses the selected funding object and requires private proof before enabling funding', async () => {
    hooks.allowNative = true; const f = fundingFixture();
    f.tokens.find(token => token.address === f.pair.tokens[0].address)!.allowance = f.funding.amounts.used0;
    f.button(`Approve exact ${f.pair.tokens[0].label}`).props.onClick!();
    await vi.waitFor(() => expect(f.sender.submitSharedPoolApproval).toHaveBeenCalledWith(f.prepared));
    expect(f.sender.prepareSharedPoolApproval).toHaveBeenCalledWith({ funding: f.funding, canonicalIndex: 0, cleanup: false, approvalMode: expect.any(Function), confirm: expect.any(Function) });
    f.button('Check Pool status').props.onClick!();
    await vi.waitFor(() => expect(text(f.render())).toContain(`Exact ${f.pair.tokens[0].label} approval verified`));
    expect(f.button('Review and fund Pool')).toBeUndefined();
    f.outcome.token = f.pair.tokens[1].address;
    f.tokens.find(token => token.address === f.pair.tokens[1].address)!.allowance = f.funding.amounts.used1;
    f.button(`Approve exact ${f.pair.tokens[1].label}`).props.onClick!();
    await vi.waitFor(() => expect(f.sender.submitSharedPoolApproval).toHaveBeenCalledTimes(2));
    f.button('Check Pool status').props.onClick!();
    await vi.waitFor(() => expect(f.button('Review and fund Pool').props.disabled).toBe(false));
  });
  it.each(['private', 'amount', 'token', 'owner', 'graph', 'package'])('does not accept a false %s approval result', async fault => {
    hooks.allowNative = true; const f = fundingFixture();
    f.tokens.find(token => token.address === f.pair.tokens[0].address)!.allowance = f.funding.amounts.used0;
    if (fault === 'private') f.outcome.privateAccountingVerified = false;
    if (fault === 'amount') f.tokens.find(token => token.address === f.pair.tokens[0].address)!.allowance--;
    if (fault === 'token') f.outcome.token = owner;
    if (fault === 'owner') f.outcome.funds.owner = candidate.core;
    if (fault === 'graph') Object.assign(f.outcome.funds, { graph: 'changed' });
    if (fault === 'package') Object.assign(f.outcome.funds, { packageSha256: 'changed' });
    f.button(`Approve exact ${f.pair.tokens[0].label}`).props.onClick!();
    await vi.waitFor(() => expect(f.sender.submitSharedPoolApproval).toHaveBeenCalledOnce());
    f.button('Check Pool status').props.onClick!();
    await vi.waitFor(() => expect(f.sender.recoverPendingSharedPoolApproval).toHaveBeenCalledOnce());
    expect(f.button('Review and fund Pool')).toBeUndefined();
    expect(text(f.render())).toContain('no authenticated private result');
  });
  it('stops the exact unfunded deposit and exposes only remaining zero-approval cleanup', async () => {
    hooks.allowNative = true; const f = fundingFixture(); hooks.states[19] = true;
    f.button('Review stop and clear approvals').props.onClick!();
    await vi.waitFor(() => expect(f.funding.abandonUnfunded).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(text(f.render())).toContain('Funding cannot restart'));
    expect(f.getSender).not.toHaveBeenCalled();
    expect(f.button('Review and fund Pool')).toBeUndefined();
    expect(f.button(`Clear ${f.pair.tokens[1].label} approval`).props.disabled).toBe(true);
    f.button(`Clear ${f.pair.tokens[0].label} approval`).props.onClick!();
    await vi.waitFor(() => expect(f.sender.prepareSharedPoolApproval).toHaveBeenCalledWith(expect.objectContaining({ funding: f.funding, cleanup: true })));
  });
  if (key === 'cheap-history') it('clears an unused approval after local Pool preparation is lost, without another preview', async () => {
    hooks.allowNative = true; const f = fundingFixture(); hooks.states[10] = null;
    Object.assign(f.outcome, { recoveredCleanup: true, cleanup: true });
    f.button(`Clear unused ${f.pair.tokens[0].label} approval`).props.onClick!();
    await vi.waitFor(() => expect(f.sender.submitSharedPoolApproval).toHaveBeenCalledWith(f.prepared));
    expect(f.sender.prepareSharedPoolAllowanceCleanup).toHaveBeenCalledWith(expect.objectContaining({ marketId: f.pair.marketId, canonicalIndex: 0 }));
    f.button('Check Pool status').props.onClick!();
    await vi.waitFor(() => expect(text(f.render())).toContain('Unused '+f.pair.tokens[0].label+' approval cleared'));
    expect(f.button(`Clear unused ${f.pair.tokens[0].label} approval`).props.disabled).toBe(true);
    expect(f.getPool).not.toHaveBeenCalled(); expect(f.sender.submitPoolFunding).not.toHaveBeenCalled();
  });
  if (key === 'cheap-history') it.each([
    ['Known Pool verification failure. Manual reconciliation is required.', 'The first private proof failed.'],
    ['A distinct fallback recovery failure.', 'A distinct fallback recovery failure.']
  ])('keeps the useful recovery reason when the funding fallback fails with %s', async (fallbackError, expectedMessage) => {
    const f = fundingFixture(), originalError = new Error('The first private proof failed.');
    const recover = vi.fn(async () => { throw originalError; });
    const pending = { phase: 'fund' as const, recover, scope: f.scope };
    hooks.states[6] = true; hooks.states[13] = pending; hooks.states[14] = `0x${'55'.repeat(32)}`;
    f.sender.recoverCurrentPreparedPoolFundingResult.mockRejectedValue(new Error(fallbackError));
    f.button('Check Pool status').props.onClick!();
    await vi.waitFor(() => expect(text(f.render())).toContain(expectedMessage));
    expect(recover).toHaveBeenCalledOnce();
    expect(f.sender.recoverCurrentPreparedPoolFundingResult).toHaveBeenCalledOnce();
    expect(hooks.states[6]).toBe(true); expect(hooks.states[13]).toBe(pending);
    expect(f.sender.submitPoolFunding).not.toHaveBeenCalled(); expect(hooks.confirm).not.toHaveBeenCalled();
  });
  if (key === 'cheap-history') it.each(['private-proof', 'nonzero-allowance'])('does not accept recovered cleanup with %s', async fault => {
    hooks.allowNative = true; const f = fundingFixture(); hooks.states[10] = null;
    Object.assign(f.outcome, { recoveredCleanup: true, cleanup: true });
    if (fault === 'private-proof') f.outcome.privateAccountingVerified = false;
    else f.tokens.find(token => token.address === f.pair.tokens[0].address)!.allowance = 1n;
    f.button(`Clear unused ${f.pair.tokens[0].label} approval`).props.onClick!();
    await vi.waitFor(() => expect(f.sender.submitSharedPoolApproval).toHaveBeenCalledOnce());
    f.button('Check Pool status').props.onClick!();
    await vi.waitFor(() => expect(text(f.render())).toContain('no authenticated private result'));
    expect(hooks.states[12]).toEqual([false, false]);
    expect(f.sender.submitPoolFunding).not.toHaveBeenCalled();
  });
});

});
