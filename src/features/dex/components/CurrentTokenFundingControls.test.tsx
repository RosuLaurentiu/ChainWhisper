import { renderToStaticMarkup } from 'react-dom/server';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CurrentTokenFundingControls, { CURRENT_TOKEN_FUNDING_UI_ADMITTED } from './CurrentTokenFundingControls';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { CURRENT_CHEAP_DEX_CANDIDATE as c } from '../../../lib/dexV2Deployment';

const hooks = vi.hoisted(() => ({ enabled: false, index: 0, refIndex: 0, states: [] as unknown[], refs: [] as { current: unknown }[], confirm: true }));
vi.mock('react', async original => { const actual = await original<typeof import('react')>(); return { ...actual,
  useState: (initial: unknown) => { if (!hooks.enabled) return actual.useState(initial); const i = hooks.index++; if (!(i in hooks.states)) hooks.states[i] = initial; return [hooks.states[i], (value: unknown) => { hooks.states[i] = value; }]; },
  useRef: (initial: unknown) => { if (!hooks.enabled) return actual.useRef(initial); const i = hooks.refIndex++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); } }; });
vi.mock('../../trading/hooks/useTradeActionConfirmationState', () => ({ default: () => ({ confirmation: null, requestConfirmation: async () => hooks.confirm, resolveConfirmation: () => {} }) }));
const elements = (node: ReactNode): ReactElement<{ children?: ReactNode; disabled?: boolean; onClick?: () => void }>[] => Array.isArray(node) ? node.flatMap(elements) : isValidElement<{ children?: ReactNode }>(node) ? [node, ...elements(node.props.children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const owner = `0x${'22'.repeat(20)}`, unit = 10n ** 18n;
function fixture() {
  hooks.enabled = true;
  const value = { tokenIndex: 0, balance: 20n * unit, allowance: 0n, claimed: true };
  const recover = vi.fn(async () => ({ ...value, fundingOutcome: 'verified' })), sender = {
    readCurrentTokenFunding: vi.fn(async () => value), recoverPendingCurrentTokenFunding: vi.fn(async () => null),
    prepareCurrentTokenFunding: vi.fn(async ({ confirm }: { confirm: (review: object) => Promise<boolean> }) => await confirm({ tokenIndex: 0, amount: 10n * unit, previousAllowance: 0n, spender: c.core }) ? { prepared: true } : null),
    submitCurrentTokenFunding: vi.fn(async () => ({ transactionHash: 'local-hash', recover })), waitForCurrentCheapReceipt: vi.fn(async () => null)
  };
  const session = { walletAddress: owner, chainId: Number(c.chainId), browserProvider: { request: vi.fn() }, activeSignerSource: 'browser', browserWalletId: 'metamask',
    sessionOnboardInfo: { [owner]: { aesKey: 'local-fixture' } }, walletAesHealthByAddress: {}, actions: { getCurrentDexSubmissionCapability: vi.fn(async () => sender) } } as unknown as SharedWalletSession;
  let tokenIndex: 0 | 1 = 0, maximumInput = String(10n * unit);
  const render = () => { hooks.index = 0; hooks.refIndex = 0; return CurrentTokenFundingControls({ sharedWalletSession: session, tokenIndex, maximumInput, disabled: false }); };
  const button = (name: string) => elements(render()).find(e => e.type === 'button' && text(e.props.children) === name)!;
  const click = async (name: string) => { button(name).props.onClick!(); await vi.waitFor(() => expect(hooks.states[1]).toBe(false)); };
  render(); return { session, sender, recover, value, render, button, click, select: (index: 0 | 1) => { tokenIndex = index; }, input: (amount: bigint) => { maximumInput = String(amount); } };
}
afterEach(() => { hooks.enabled = false; hooks.states = []; hooks.refs = []; hooks.confirm = true; });
describe('current-token funding admission', () => {
  it('declares exact current-token units and fixed test mint without enabling disconnected writes', () => {
    const html = renderToStaticMarkup(<CurrentTokenFundingControls tokenIndex={1} maximumInput="20000000000000000000" disabled={false} />);
    expect(html).toContain('Get test tokens: refill'); expect(html).toContain('Writes are held'); expect(html).toContain('18 decimals'); expect(html).toContain('public test data'); expect(html).toContain('exact allowance');
    expect(html).toMatch(/disabled=""[^>]*>Claim current test-token faucet/); expect(html).toMatch(/disabled=""[^>]*>Approve exact input allowance/);
    expect(CURRENT_TOKEN_FUNDING_UI_ADMITTED).toBe(true); expect(html).not.toContain('Funding writes await the frozen local review');
    expect(html).toContain('at most 100.0 test tokens per finite approval');
  });
});

describe('initial funding concurrency and privacy scope', () => {
  it('blocks an over-cap approval before preparation but permits the exact cap', async () => {
    const f = fixture(); f.value.balance = 1000n * unit; f.input(101n * unit); await f.click('Check current input funds');
    expect(f.button('Approve exact input allowance').props.disabled).toBe(true); await f.click('Approve exact input allowance');
    expect(f.sender.prepareCurrentTokenFunding).not.toHaveBeenCalled(); f.input(100n * unit); await f.click('Check current input funds');
    expect(f.button('Approve exact input allowance').props.disabled).toBe(false);
  });
  it('starts only one funds check before React state has updated', async () => {
    const f = fixture(); let finish!: (value: typeof f.value) => void;
    f.sender.readCurrentTokenFunding.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const click = f.button('Check current input funds').props.onClick!; click(); click();
    await vi.waitFor(() => expect(f.sender.readCurrentTokenFunding).toHaveBeenCalled());
    expect(f.sender.readCurrentTokenFunding).toHaveBeenCalledTimes(1); finish(f.value);
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
  });
  it('prepares and submits only one approval for rapid duplicate clicks', async () => {
    const f = fixture(); await f.click('Check current input funds'); const click = f.button('Approve exact input allowance').props.onClick!; click(); click();
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
    expect(f.sender.prepareCurrentTokenFunding).toHaveBeenCalledTimes(1); expect(f.sender.submitCurrentTokenFunding).toHaveBeenCalledTimes(1);
    expect(f.button('Approve exact input allowance').props.disabled).toBe(true);
  });
  it.each(['onboard', 'health'] as const)('hides private funds when the %s identity changes while privacy remains ready', async kind => {
    const f = fixture(); await f.click('Check current input funds'); expect(text(f.render())).toContain('Balance 20.0');
    if (kind === 'onboard') f.session.sessionOnboardInfo = { [owner]: { aesKey: 'new-local-fixture' } };
    else f.session.walletAesHealthByAddress = { [owner]: { healthy: true } } as never;
    expect(text(f.render())).not.toContain('Balance 20.0');
    expect(f.button('Approve exact input allowance').props.disabled).toBe(true);
  });
  it('does not accept a private funds read from a replaced privacy session', async () => {
    const f = fixture(); let finish!: (value: typeof f.value) => void;
    f.sender.readCurrentTokenFunding.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.button('Check current input funds').props.onClick!(); await vi.waitFor(() => expect(f.sender.readCurrentTokenFunding).toHaveBeenCalled());
    f.session.sessionOnboardInfo = { [owner]: { aesKey: 'new-local-fixture' } }; f.render(); finish(f.value);
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
    expect(text(f.render())).not.toContain('Balance 20.0'); expect(f.sender.submitCurrentTokenFunding).not.toHaveBeenCalled();
  });
  it('does not submit after review cancellation and permits a new explicit check', async () => {
    const f = fixture(); await f.click('Check current input funds'); hooks.confirm = false; await f.click('Approve exact input allowance');
    expect(f.sender.submitCurrentTokenFunding).not.toHaveBeenCalled(); expect(text(f.render())).toContain('cancelled');
    await f.click('Check current input funds'); expect(text(f.render())).toContain('Balance 20.0');
  });
  it('retains an uncertain send and does not read funds while its hash is unresolved', async () => {
    const f = fixture(); await f.click('Check current input funds'); f.sender.submitCurrentTokenFunding.mockRejectedValueOnce(new Error('Uncertain signature; do not resend'));
    await f.click('Approve exact input allowance'); expect(f.button('Approve exact input allowance').props.disabled).toBe(true);
    f.sender.recoverPendingCurrentTokenFunding.mockResolvedValueOnce({ status: 'manual-reconciliation-required' } as never);
    const reads = f.sender.readCurrentTokenFunding.mock.calls.length; await f.click('Check funding status');
    expect(f.sender.readCurrentTokenFunding).toHaveBeenCalledTimes(reads); expect(f.sender.submitCurrentTokenFunding).toHaveBeenCalledTimes(1);
  });
  it('reconciles a submitted known hash once before another action', async () => {
    const f = fixture(); await f.click('Check current input funds'); await f.click('Approve exact input allowance');
    expect(f.recover).not.toHaveBeenCalled(); await f.click('Check funding status'); expect(f.recover).toHaveBeenCalledOnce();
    expect(text(f.render())).toContain('Exact private funding result verified');
  });
  it.each(['owner', 'token'] as const)('hides private readiness when %s changes', async kind => {
    const f = fixture(); await f.click('Check current input funds');
    if (kind === 'owner') f.session.walletAddress = `0x${'33'.repeat(20)}`; else f.select(1);
    expect(text(f.render())).not.toContain('Balance 20.0'); expect(f.button('Approve exact input allowance').props.disabled).toBe(true);
  });
});

