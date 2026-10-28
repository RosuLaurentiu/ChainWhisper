import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CurrentTokenFundingControls from './CurrentTokenFundingControls';
import CurrentTokenRefillControls from './CurrentTokenRefillControls';
import { CURRENT_CHEAP_DEX_CANDIDATE as c } from '../../../lib/dexV2Deployment';
import type { SharedWalletSession } from '../../../lib/walletSession';

const hooks = vi.hoisted(() => ({ index: 0, refIndex: 0, states: [] as unknown[], refs: [] as { current: unknown }[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.states)) hooks.states[i] = initial; return [hooks.states[i], (value: unknown) => { hooks.states[i] = value; }]; },
  useRef: (initial: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); }
}));
vi.mock('../../trading/hooks/useTradeActionConfirmationState', () => ({ default: () => ({ confirmation: null, requestConfirmation: vi.fn(), resolveConfirmation: vi.fn() }) }));
type Props = { children?: ReactNode; onClick?: () => void; disabled?: boolean; role?: string };
const elements = (node: ReactNode): ReactElement<Props>[] => Array.isArray(node) ? node.flatMap(elements) : isValidElement<Props>(node) ? [node, ...elements(node.props.children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : isValidElement<Props>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const owner = `0x${'22'.repeat(20)}`, other = `0x${'33'.repeat(20)}`;
const failure = 'Original private funding failure: exact credit needs reconciliation.';
type Panel = 'funding' | 'refill';
type Change = 'owner' | 'chain' | 'provider' | 'walletId' | 'onboard' | 'health' | 'lock' | 'token' | 'input';
function fixture(panel: Panel) {
  const store = new Map<string, string>();
  vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) } });
  const snapshot = { tokens: [0, 1].map(i => ({ token: c.tokens[i][0], balance: 10n ** 18n, allowance: 0n })),
    refills: [0, 1].map(i => ({ token: c.tokens[i][0], availability: 'ready', quota: 1000n * 10n ** 18n, nextClaimAt: 0n, expiresAt: 200000n })) };
  const read = vi.fn(async () => panel === 'funding' ? { tokenIndex: 0, balance: 10n ** 18n, allowance: 0n, claimed: true } : snapshot);
  const write = vi.fn(async () => { throw new Error('Unexpected send'); });
  const sender = { readCurrentTokenFunding: read, readCurrentTokenRefillSubmission: read,
    recoverPendingCurrentTokenFunding: vi.fn(async () => null), recoverPendingCurrentTokenRefill: vi.fn(async () => null),
    prepareCurrentTokenFunding: write, submitCurrentTokenFunding: write, prepareCurrentTokenRefill: write, submitCurrentTokenRefill: write };
  const session = { walletAddress: owner, chainId: Number(c.chainId), browserProvider: { request: vi.fn() }, browserWalletId: 'metamask', activeSignerSource: 'browser',
    sessionOnboardInfo: { [owner]: { aesKey: 'local-fixture-only' } }, walletAesHealthByAddress: {}, actions: { getCurrentDexSubmissionCapability: vi.fn(async () => sender) } } as unknown as SharedWalletSession;
  let token: 0 | 1 = 0, maximumInput = '1000000000000000000';
  const render = () => { hooks.index = 0; hooks.refIndex = 0; return panel === 'funding'
    ? CurrentTokenFundingControls({ sharedWalletSession: session, tokenIndex: token, maximumInput, disabled: false })
    : CurrentTokenRefillControls({ sharedWalletSession: session, tokenIndex: token }); };
  const button = () => elements(render()).find(e => e.type === 'button' && text(e.props.children) === (panel === 'funding' ? 'Check current input funds' : 'Check refill availability'))!;
  const status = () => text(elements(render()).find(e => e.props.role === 'status')?.props.children);
  const change = (kind: Change) => {
    if (kind === 'owner') session.walletAddress = other;
    if (kind === 'chain') session.chainId = 1;
    if (kind === 'provider') session.browserProvider = { request: vi.fn() } as never;
    if (kind === 'walletId') session.browserWalletId = 'changed-fixture-wallet' as never;
    if (kind === 'onboard') session.sessionOnboardInfo = { ...session.sessionOnboardInfo };
    if (kind === 'health') session.walletAesHealthByAddress = {};
    if (kind === 'lock') session.sessionOnboardInfo = {};
    if (kind === 'token') token = 1;
    if (kind === 'input') maximumInput = '2000000000000000000';
    render();
  };
  const settle = async () => { await vi.waitFor(() => expect(hooks.states[1]).toBe(false)); };
  render(); return { read, write, store, button, status, change, settle, render };
}
afterEach(() => { hooks.states = []; hooks.refs = []; vi.unstubAllGlobals(); });
for (const panel of ['funding', 'refill'] as const) describe(`${panel} failure result scope`, () => {
  const changes: Change[] = ['owner', 'chain', 'provider', 'walletId', 'onboard', 'health', 'lock', 'token', ...(panel === 'funding' ? ['input' as const] : [])];
  it.each(changes)('rejects a delayed prior-scope error after %s changes', async kind => {
    const f = fixture(panel); let reject!: (error: Error) => void;
    f.read.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    f.button().props.onClick!(); await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce());
    f.change(kind); reject(new Error(failure)); await f.settle();
    expect(f.status()).not.toContain(failure); expect(f.status()).toContain('changed');
    expect(hooks.states[2]).toBe(true); expect(f.write).not.toHaveBeenCalled(); expect(f.store.size).toBe(0);
  });
  it.each(changes)('hides an already displayed old-scope error after %s changes', async kind => {
    const f = fixture(panel); f.read.mockRejectedValueOnce(new Error(failure)); f.button().props.onClick!(); await f.settle();
    expect(f.status()).toBe(failure); f.change(kind); expect(f.status()).not.toContain(failure);
    expect(hooks.states[2]).toBe(true); expect(f.write).not.toHaveBeenCalled();
  });
  it('retains the exact same-session failure and conservative block', async () => {
    const f = fixture(panel); f.read.mockRejectedValueOnce(new Error(failure)); f.button().props.onClick!(); await f.settle();
    expect(f.status()).toBe(failure); expect(hooks.states[2]).toBe(true); expect(f.button().props.disabled).toBe(false);
  });
  it('permits a fresh explicit check after the old status hides', async () => {
    const f = fixture(panel); f.read.mockRejectedValueOnce(new Error(failure)); f.button().props.onClick!(); await f.settle();
    f.change('health'); expect(f.status()).not.toContain(failure); f.button().props.onClick!(); await f.settle();
    expect(f.status()).toContain(panel === 'funding' ? 'Private current-token balance' : 'Current private funds checked');
    expect(hooks.states[2]).toBe(false); expect(f.read).toHaveBeenCalledTimes(2); expect(f.write).not.toHaveBeenCalled();
  });
});
