import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CurrentTokenRefillControls, { checkCurrentRefill, currentRefillAvailabilityText, currentRefillConfirmation } from './CurrentTokenRefillControls';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { CURRENT_CHEAP_DEX_CANDIDATE as c } from '../../../lib/dexV2Deployment';
const hooks = vi.hoisted(() => ({ enabled: false, index: 0, refIndex: 0, states: [] as unknown[], refs: [] as { current: unknown }[], held: true, confirm: true, simulatedNativeAdmission: false }));
vi.mock('react', async original => { const actual = await original<typeof import('react')>(); return { ...actual,
  useState: (initial: unknown) => { if (!hooks.enabled) return actual.useState(initial); const i = hooks.index++; if (!(i in hooks.states)) hooks.states[i] = initial; return [hooks.states[i], (value: unknown) => { hooks.states[i] = value; }]; },
  useRef: (initial: unknown) => { if (!hooks.enabled) return actual.useRef(initial); const i = hooks.refIndex++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); } }; });
vi.mock('../../../lib/currentDexNativeTokenRefillDeployment', async original => ({ ...await original<typeof import('../../../lib/currentDexNativeTokenRefillDeployment')>(), assertCurrentNativeTokenRefillBinding: () => { if (hooks.held) throw new Error('Held'); } }));
vi.mock('../../../lib/dexV2Deployment', async original => {
  const actual = await original<typeof import('../../../lib/dexV2Deployment')>();
  return { ...actual, assertCurrentCheapDexNativeAdmission: (candidate: Parameters<typeof actual.assertCurrentCheapDexNativeAdmission>[0]) => {
    // Success-path fixtures simulate admission. Default cases use the real hold.
    if (!hooks.simulatedNativeAdmission) actual.assertCurrentCheapDexNativeAdmission(candidate);
  } };
});
vi.mock('../../trading/hooks/useTradeActionConfirmationState', () => ({ default: () => ({ confirmation: null, requestConfirmation: async () => hooks.confirm, resolveConfirmation: () => {} }) }));
const elements = (node: ReactNode): ReactElement<{ children?: ReactNode; disabled?: boolean; onClick?: () => void }>[] => Array.isArray(node) ? node.flatMap(elements) : isValidElement<{ children?: ReactNode }>(node) ? [node, ...elements(node.props.children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const block = { number: 1n, hash: `0x${'11'.repeat(32)}`, timestamp: 100n, gasLimit: 120_000_000n }, owner = `0x${'22'.repeat(20)}`;
const snapshot = () => ({ block, tokens: [0, 1].map(i => ({ token: c.tokens[i][0], balance: 9n, allowance: 2n })), refills: [0, 1].map(i => ({ token: c.tokens[i][0], availability: 'ready', quota: 999_000n * 10n ** 18n, nextClaimAt: 0n, expiresAt: 200_000n })) });
function fixture(nativeAdmission: 'current' | 'simulated-admitted' = 'current') {
  hooks.enabled = true;
  hooks.simulatedNativeAdmission = nativeAdmission === 'simulated-admitted';
  const store = new Map<string, string>(); vi.stubGlobal('window', { sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } } });
  const value = snapshot(), recover = vi.fn(async () => ({ refillOutcome: 'verified', privateAccountingVerified: true })), sender = {
    readCurrentTokenRefillSubmission: vi.fn(async () => value), recoverPendingCurrentTokenRefill: vi.fn(async () => null),
    prepareCurrentTokenRefill: vi.fn(async ({ confirm }: { confirm: (review: object) => Promise<boolean> }) => await confirm({ token: c.tokens[0][0], amount: 1000n * 10n ** 18n, vault: owner, cooldown: 86_400n, expiresAt: 200_000n }) ? { prepared: true } : null),
    submitCurrentTokenRefill: vi.fn(async () => ({ transactionHash: 'hash', recover })) };
  const session = { walletAddress: owner, chainId: Number(c.chainId), browserProvider: { request: vi.fn() }, activeSignerSource: 'browser', browserWalletId: 'metamask', sessionOnboardInfo: { [owner]: { aesKey: 'local-fixture' } }, actions: { getCurrentDexSubmissionCapability: vi.fn(async () => sender) } } as unknown as SharedWalletSession;
  let index: 0 | 1 = 0;
  const render = () => { hooks.index = 0; hooks.refIndex = 0; return CurrentTokenRefillControls({ sharedWalletSession: session, tokenIndex: index }); };
  const button = (name: string) => elements(render()).find(e => e.type === 'button' && text(e.props.children) === name)!;
  const click = async (name: string) => { button(name).props.onClick!(); await vi.waitFor(() => expect(hooks.states[1]).toBe(false)); };
  render(); return { session, sender, recover, value, store, render, button, click, select: (i: 0 | 1) => { index = i; } };
}
afterEach(() => { hooks.enabled = false; hooks.states = []; hooks.refs = []; hooks.held = true; hooks.confirm = true; hooks.simulatedNativeAdmission = false; vi.unstubAllGlobals(); });
describe('refill controls', () => {
  it('shows Testnet limits and the held candidate without enabling disconnected writes', () => { const html = renderToStaticMarkup(<CurrentTokenRefillControls tokenIndex={0} />); expect(html).toContain('Get test tokens: refill'); expect(html).toContain('24-hour'); expect(html).toContain('1,000,000'); expect(html).toContain('Writes are held'); expect(html).toMatch(/disabled=""[^>]*>Refill 1000 test tokens/); });
  it('keeps the active wrong graph held after a funds check', async () => { const f = fixture(); await f.click('Check refill availability'); expect(f.button('Refill 1000 test tokens').props.disabled).toBe(true); f.button('Refill 1000 test tokens').props.onClick!(); expect(f.sender.submitCurrentTokenRefill).not.toHaveBeenCalled(); });
  it('keeps the real native candidate hold even when the distributor is simulated as admitted', async () => {
    hooks.held = false; const f = fixture(); await f.click('Check refill availability');
    expect(text(f.render())).toContain('Writes are held'); expect(f.button('Refill 1000 test tokens').props.disabled).toBe(true);
    await f.click('Refill 1000 test tokens');
    expect(f.sender.prepareCurrentTokenRefill).not.toHaveBeenCalled(); expect(f.sender.submitCurrentTokenRefill).not.toHaveBeenCalled();
  });
  it('keeps distributor rejection even when native admission is simulated', async () => {
    const f = fixture('simulated-admitted'); await f.click('Check refill availability');
    expect(text(f.render())).toContain('Writes are held'); expect(f.button('Refill 1000 test tokens').props.disabled).toBe(true);
    await f.click('Refill 1000 test tokens');
    expect(f.sender.prepareCurrentTokenRefill).not.toHaveBeenCalled(); expect(f.sender.submitCurrentTokenRefill).not.toHaveBeenCalled();
  });
  it('reviews once, submits once and requires explicit exact-credit reconciliation', async () => { hooks.held = false; const f = fixture('simulated-admitted'); await f.click('Check refill availability'); await f.click('Refill 1000 test tokens'); expect(f.sender.submitCurrentTokenRefill).toHaveBeenCalledTimes(1); expect(f.recover).not.toHaveBeenCalled(); expect(f.button('Refill 1000 test tokens').props.disabled).toBe(true); await f.click('Check refill confirmation'); expect(f.recover).toHaveBeenCalledOnce(); expect(text(f.render())).toContain('exact 1000-token private refill verified'); });
  it('locks rapid duplicate clicks before React state updates', async () => { hooks.held = false; const f = fixture('simulated-admitted'); await f.click('Check refill availability'); const click = f.button('Refill 1000 test tokens').props.onClick!; click(); click(); await vi.waitFor(() => expect(hooks.states[1]).toBe(false)); expect(f.sender.prepareCurrentTokenRefill).toHaveBeenCalledTimes(1); expect(f.sender.submitCurrentTokenRefill).toHaveBeenCalledTimes(1); });
  it('does not submit after cancelled review', async () => { hooks.held = false; hooks.confirm = false; const f = fixture('simulated-admitted'); await f.click('Check refill availability'); await f.click('Refill 1000 test tokens'); expect(f.sender.submitCurrentTokenRefill).not.toHaveBeenCalled(); expect(text(f.render())).toContain('cancelled'); });
  it('hides old private balances when selected token or owner changes', async () => { const f = fixture(); await f.click('Check refill availability'); expect(text(f.render())).toContain('Private selected-token balance'); f.select(1); expect(text(f.render())).not.toContain('Private selected-token balance'); f.session.walletAddress = `0x${'33'.repeat(20)}`; expect(text(f.render())).not.toContain('Private selected-token balance'); });
  it.each(['owner', 'provider', 'privacy'] as const)('stops a preparation when %s changes', async kind => { hooks.held = false; const f = fixture('simulated-admitted'); await f.click('Check refill availability'); let finish!: (value: null) => void; f.sender.prepareCurrentTokenRefill.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); f.button('Refill 1000 test tokens').props.onClick!(); await vi.waitFor(() => expect(f.sender.prepareCurrentTokenRefill).toHaveBeenCalled()); if (kind === 'owner') f.session.walletAddress = `0x${'44'.repeat(20)}`; if (kind === 'provider') f.session.browserProvider = { request: vi.fn() }; if (kind === 'privacy') f.session.sessionOnboardInfo = {}; f.render(); finish(null); await vi.waitFor(() => expect(hooks.states[1]).toBe(false)); expect(f.sender.submitCurrentTokenRefill).not.toHaveBeenCalled(); });
  it('keeps a rejected wallet result locked until explicit canonical metadata recovery', async () => { hooks.held = false; const f = fixture('simulated-admitted'); await f.click('Check refill availability'); f.sender.submitCurrentTokenRefill.mockRejectedValue(new Error('Wallet rejected or lost hash. Do not resend.')); await f.click('Refill 1000 test tokens'); expect(f.button('Refill 1000 test tokens').props.disabled).toBe(true); f.sender.recoverPendingCurrentTokenRefill.mockRejectedValue(new Error('Refill has no hash')); const reads = f.sender.readCurrentTokenRefillSubmission.mock.calls.length; await f.click('Check refill confirmation'); expect(f.sender.readCurrentTokenRefillSubmission).toHaveBeenCalledTimes(reads); expect(f.sender.submitCurrentTokenRefill).toHaveBeenCalledTimes(1); });
  it('does not read private balances or unlock after a known verification failure', async () => { hooks.held = false; const f = fixture('simulated-admitted'); await f.click('Check refill availability'); await f.click('Refill 1000 test tokens'); f.recover.mockRejectedValue(new Error('Known refill verification failure')); const reads = f.sender.readCurrentTokenRefillSubmission.mock.calls.length; await f.click('Check refill confirmation'); expect(f.sender.readCurrentTokenRefillSubmission).toHaveBeenCalledTimes(reads); expect(f.button('Refill 1000 test tokens').props.disabled).toBe(true); });
  it.each(['initial-claim-required', 'cooldown', 'expired', 'exhausted'])('disables writes for %s', async availability => { hooks.held = false; const f = fixture('simulated-admitted'); f.value.refills[0].availability = availability; await f.click('Check refill availability'); expect(f.button('Refill 1000 test tokens').props.disabled).toBe(true); });
  it('has a finite confirmation and no approval request', () => { const model = currentRefillConfirmation({ token: owner, amount: 1000n * 10n ** 18n, vault: owner, cooldown: 86_400n, expiresAt: 200_000n }); expect(model.title).toContain('Get test tokens'); expect(model.summaryRows).toContainEqual({ label: 'Refill amount', value: '1000.0 tokens' }); expect(model.message).toContain('does not change your DEX allowance'); });
});
describe('canonical refill check helper', () => {
  it.each(['manual-reconciliation-required', 'awaiting-chain-confirmation'])('does not read private balances for %s', async status => { const read = vi.fn(); await expect(checkCurrentRefill({ recoverPendingCurrentTokenRefill: async () => ({ status, privateAccountingVerified: false }), readCurrentTokenRefillSubmission: read } as never)).rejects.toThrow('Do not resend'); expect(read).not.toHaveBeenCalled(); });
  it('labels metadata-only recovery and refreshes current balances after reconciliation', async () => { const read = vi.fn(async () => snapshot()); const result = await checkCurrentRefill({ recoverPendingCurrentTokenRefill: async () => ({ status: 'observed-mined', privateAccountingVerified: false }), readCurrentTokenRefillSubmission: read } as never, undefined, 'existing-hash'); expect(result.privateAccountingVerified).toBe(false); expect(read).toHaveBeenCalledOnce(); });
  it('can refresh status zero without a send or affordability check', async () => { const read = vi.fn(async () => snapshot()); const result = await checkCurrentRefill({ recoverPendingCurrentTokenRefill: async () => null, readCurrentTokenRefillSubmission: read } as never, async () => ({ refillOutcome: 'reverted', privateAccountingVerified: true })); expect(result.reverted).toBe(true); expect(read).toHaveBeenCalledOnce(); });
  it('shows all policy states with exact UTC cooldown', () => { for (const availability of ['initial-claim-required', 'expired', 'exhausted', 'cooldown', 'ready'] as const) expect(currentRefillAvailabilityText({ ...snapshot().refills[0], availability } as never)).toBeTruthy(); });
});
