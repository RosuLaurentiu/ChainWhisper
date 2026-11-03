import { describe, expect, it, vi } from 'vitest';
import {
  bindBrowserWalletRuntimePrivacyScope,
  buildBrowserOwnerDataScopeKey,
  buildBrowserWalletRuntimeScopeKey,
  createBrowserWalletRuntimeReadGuard,
  getBrowserRuntimeSetupError,
  resolveBrowserWalletPrivacyReadScope,
  assertBrowserWalletPrivacyReadScopeCurrent,
  resolveBrowserRuntimeStartupScope,
  shouldDeferBrowserRuntimeStartup
} from './browserWalletRuntimeScope';
import { isP2PParticipantReadPassPending } from '../features/trading/components/P2PTradingPage.helpers';

const OWNER = '0x1111111111111111111111111111111111111111';
const CHAIN_ID = 7_082_400n;
const session = Object.freeze({
  address: OWNER,
  chainId: Number(CHAIN_ID),
  source: 'injected',
  walletId: 'metamask'
});

describe('browser-wallet Chat privacy runtime binding', () => {
  it('rejects a late private projection after its privacy token is replaced', async () => {
    const captured = {};
    let current = captured;
    const runtime = bindBrowserWalletRuntimePrivacyScope({ isCurrent: () => true }, () => current === captured);
    let finish!: (text: string) => void;
    let projection = '';
    const pending = new Promise<string>(resolve => { finish = resolve; }).then(text => {
      if (runtime.isCurrent()) projection = text;
    });
    expect(runtime.isCurrent()).toBe(true);
    current = {};
    expect(runtime.isCurrent()).toBe(false);
    finish('old decrypted text');
    await pending;
    expect(projection).toBe('');
  });

  it('keeps the same privacy token valid and delegates runtime closure', () => {
    const captured = {};
    const current = captured;
    let open = true;
    const close = vi.fn(() => { open = false; });
    const runtime = bindBrowserWalletRuntimePrivacyScope({ isCurrent: () => open, close }, () => current === captured);
    expect(runtime.isCurrent()).toBe(true);
    runtime.close();
    expect(close).toHaveBeenCalledOnce();
    expect(runtime.isCurrent()).toBe(false);
  });
});

describe('browser-wallet setup read disposal', () => {
  it('keeps background work deferred for the selected participant pass after one-off settles', () => {
    const runtime = { isCurrent: () => true };
    const base = { selected: true, scopeKey: 'owner:private', runtime, setupFailed: false,
      initialDiscovery: { scopeKey: 'owner:private', runtime } };
    expect(shouldDeferBrowserRuntimeStartup(base)).toBe(false);
    const input = { selected: true, privacyReady: true, setupPending: false, setupError: '' };
    const busySource = { busy: true, snapshot: { complete: false }, error: '' };
    const pending = (source: typeof busySource) => isP2PParticipantReadPassPending({ ...input, sources: [source] });
    const activeReadPass = { scopeKey: 'owner:private', pending: pending(busySource) };
    expect(shouldDeferBrowserRuntimeStartup({ ...base, activeReadPass })).toBe(true);
    expect(shouldDeferBrowserRuntimeStartup({ ...base, activeReadPass: { ...activeReadPass, pending: false } })).toBe(false);
    expect(shouldDeferBrowserRuntimeStartup({ ...base, activeReadPass, setupFailed: true })).toBe(false);
    expect(shouldDeferBrowserRuntimeStartup({ ...base, activeReadPass, selected: false })).toBe(false);
    expect(shouldDeferBrowserRuntimeStartup({ ...base, activeReadPass: { ...activeReadPass, scopeKey: 'other-session' } })).toBe(false);
    expect(pending({ ...busySource, busy: false })).toBe(false); // One incomplete pass settled; coverage remains incomplete.
    expect(pending({ ...busySource, busy: false, error: 'Read failed.' })).toBe(false);
    expect(isP2PParticipantReadPassPending({ ...input, sources: [], setupPending: true })).toBe(true);
    expect(isP2PParticipantReadPassPending({ ...input, sources: [], setupPending: true, setupError: 'Setup failed.' })).toBe(false);
    expect(isP2PParticipantReadPassPending({ ...input, sources: [busySource], selected: false })).toBe(false);
    expect(isP2PParticipantReadPassPending({ ...input, sources: [busySource], privacyReady: false })).toBe(false);
  });

  it('rejects a late result and does not start the next read after disposal', async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const guard = createBrowserWalletRuntimeReadGuard(() => {});
    let laterCalls = 0;
    const result = guard.run(async () => { await held; return 'old'; });
    const failure = expect(result).rejects.toThrow(/replaced/);
    expect(guard.signal.aborted).toBe(false);
    guard.close(); release();
    expect(guard.signal.aborted).toBe(true);
    expect(guard.signal.reason.message).toMatch(/replaced/);
    await failure;
    await expect(guard.run(async () => { laterCalls++; })).rejects.toThrow(/replaced/);
    expect(laterCalls).toBe(0);
  });
  it('checks the captured wallet lease before and after the existing read', async () => {
    let current = true;
    const guard = createBrowserWalletRuntimeReadGuard(() => { if (!current) throw new Error('Session changed'); });
    await expect(guard.run(async () => { current = false; return 'old'; })).rejects.toThrow(/Session changed/);
  });
});
const base = Object.freeze({
  activeSignerSource: 'metamask',
  deploymentFingerprint: 'candidate:direct-chat-v2',
  expectedChainId: CHAIN_ID,
  session,
  walletAddress: OWNER
});

describe('background browser-runtime startup', () => {
  it('does not release a new startup from a prior scope setup failure', () => {
    const oldFailure = { scopeKey: 'old-owner:public', message: 'Old setup failed' };
    const setupError = getBrowserRuntimeSetupError('new-owner:private', oldFailure);
    expect(setupError).toBe('');
    expect(shouldDeferBrowserRuntimeStartup({ selected: true, scopeKey: 'new-owner:private',
      runtime: { isCurrent: () => true }, setupFailed: Boolean(setupError) })).toBe(true);
    expect(getBrowserRuntimeSetupError('old-owner:public', oldFailure)).toBe(oldFailure.message);
    expect(getBrowserRuntimeSetupError(null, { scopeKey: null, message: 'Connect the wallet' })).toBe('Connect the wallet');
  });
  it('does not release cold work when the reader exists but owner discovery has not settled', () => {
    const runtime = { isCurrent: () => true };
    expect(shouldDeferBrowserRuntimeStartup({ selected: true, scopeKey: 'owner:private', runtime,
      setupFailed: false })).toBe(true);
    expect(shouldDeferBrowserRuntimeStartup({ selected: true, scopeKey: 'owner:private', runtime,
      setupFailed: false, initialDiscovery: { scopeKey: 'owner:private', runtime } })).toBe(false);
  });

  it.each(['other-owner', 'other-network', 'other-candidate', 'other-privacy'])('rejects a settled %s scope', scopeKey => {
    const runtime = { isCurrent: () => true };
    expect(shouldDeferBrowserRuntimeStartup({ selected: true, scopeKey, runtime, setupFailed: false,
      initialDiscovery: { scopeKey: 'owner:private', runtime } })).toBe(true);
  });

  it('rejects settlement from a replaced or closed reader', () => {
    const old = { isCurrent: () => true }, runtime = { isCurrent: () => true };
    expect(shouldDeferBrowserRuntimeStartup({ selected: true, scopeKey: 'owner:private', runtime,
      setupFailed: false, initialDiscovery: { scopeKey: 'owner:private', runtime: old } })).toBe(true);
    const closed = { isCurrent: () => false };
    expect(shouldDeferBrowserRuntimeStartup({ selected: true, scopeKey: 'owner:private', runtime: closed,
      setupFailed: false, initialDiscovery: { scopeKey: 'owner:private', runtime: closed } })).toBe(true);
  });

  it('does not block another selected App, an unavailable scope or a failed owner setup', () => {
    const base = { selected: true, scopeKey: 'owner:private', runtime: null, setupFailed: false };
    expect(shouldDeferBrowserRuntimeStartup(base)).toBe(true);
    expect(shouldDeferBrowserRuntimeStartup({ ...base, selected: false })).toBe(false);
    expect(shouldDeferBrowserRuntimeStartup({ ...base, scopeKey: null })).toBe(false);
    expect(shouldDeferBrowserRuntimeStartup({ ...base, setupFailed: true })).toBe(false);
  });

  it('defers a cold background runtime but admits it as soon as the current screen is ready', () => {
    const scope = buildBrowserWalletRuntimeScopeKey(base)!;
    expect(resolveBrowserRuntimeStartupScope(scope, null, true)).toBeNull();
    expect(resolveBrowserRuntimeStartupScope(scope, null, false)).toBe(scope);
  });

  it('does not restart the same admitted owner runtime when privacy preparation defers background work again', () => {
    const scope = buildBrowserWalletRuntimeScopeKey(base)!;
    const started = resolveBrowserRuntimeStartupScope(scope, null, false);
    expect(resolveBrowserRuntimeStartupScope(scope, started, true)).toBe(started);
  });

  it('does not carry startup permission across a different owner or deployment, or disconnection', () => {
    const scope = buildBrowserWalletRuntimeScopeKey(base)!;
    const changed = buildBrowserWalletRuntimeScopeKey({ ...base, deploymentFingerprint: 'new-candidate' })!;
    const otherOwner = '0x2222222222222222222222222222222222222222';
    const changedOwner = buildBrowserWalletRuntimeScopeKey({ ...base,
      walletAddress: otherOwner, session: { ...session, address: otherOwner } })!;
    expect(resolveBrowserRuntimeStartupScope(changed, scope, true)).toBeNull();
    expect(resolveBrowserRuntimeStartupScope(changedOwner, scope, true)).toBeNull();
    expect(resolveBrowserRuntimeStartupScope(null, scope, false)).toBeNull();
    expect(resolveBrowserRuntimeStartupScope(changed, scope, false)).toBe(changed);
  });
});

describe('browser-wallet runtime scope', () => {
  it('keeps public identity stable while each privacy transition replaces private access', () => {
    const publicKey = buildBrowserWalletRuntimeScopeKey({ ...base, variant: 'public-identity' });
    const locked = resolveBrowserWalletPrivacyReadScope(publicKey, false, null);
    const unlocked = resolveBrowserWalletPrivacyReadScope(publicKey, true, locked);
    const relocked = resolveBrowserWalletPrivacyReadScope(publicKey, false, unlocked);
    const unlockedAgain = resolveBrowserWalletPrivacyReadScope(publicKey, true, relocked);
    expect(buildBrowserWalletRuntimeScopeKey({ ...base, variant: 'public-identity' })).toBe(publicKey);
    expect(resolveBrowserWalletPrivacyReadScope(publicKey, true, unlockedAgain)).toBe(unlockedAgain);
    expect(unlockedAgain.revision).toBeGreaterThan(unlocked.revision);
    expect(() => assertBrowserWalletPrivacyReadScopeCurrent(locked, locked)).toThrow(/privacy/i);
    expect(() => assertBrowserWalletPrivacyReadScopeCurrent(unlocked, unlockedAgain)).toThrow(/privacy/i);
    expect(() => assertBrowserWalletPrivacyReadScopeCurrent(unlockedAgain, unlockedAgain)).not.toThrow();
  });

  it('rejects private work before a locked read and after lock/unlock during an existing read', async () => {
    const key = buildBrowserWalletRuntimeScopeKey(base);
    let current = resolveBrowserWalletPrivacyReadScope(key, false, null);
    const locked = current, startRead = vi.fn(async () => 'private');
    const lockedGuard = createBrowserWalletRuntimeReadGuard(() => assertBrowserWalletPrivacyReadScopeCurrent(locked, current));
    await expect(lockedGuard.run(startRead)).rejects.toThrow(/privacy/i);
    expect(startRead).not.toHaveBeenCalled();
    current = resolveBrowserWalletPrivacyReadScope(key, true, current);
    const captured = current;
    const guard = createBrowserWalletRuntimeReadGuard(() => assertBrowserWalletPrivacyReadScopeCurrent(captured, current));
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const reading = guard.run(async () => { await held; return 'private'; });
    const rejected = expect(reading).rejects.toThrow(/privacy/i);
    current = resolveBrowserWalletPrivacyReadScope(key, false, current);
    current = resolveBrowserWalletPrivacyReadScope(key, true, current);
    release(); await rejected;
  });

  it.each(['new-owner', 'new-network', 'new-candidate', null])('rejects old private access after identity changes to %s', nextKey => {
    const previous = resolveBrowserWalletPrivacyReadScope('old-identity', true, null);
    const current = resolveBrowserWalletPrivacyReadScope(nextKey, true, previous);
    expect(() => assertBrowserWalletPrivacyReadScopeCurrent(previous, current)).toThrow(/privacy/i);
  });

  it('keeps owner data stable across checksum casing and surrounding whitespace', () => {
    const checksummedOwner = '0x5DFcEe20b5a3FDd3577436A32f62d4C0b39e979d';
    const canonical = buildBrowserOwnerDataScopeKey(checksummedOwner);

    expect(canonical).toBe(checksummedOwner.toLowerCase());
    expect(buildBrowserOwnerDataScopeKey(`  ${checksummedOwner.toLowerCase()}  `)).toBe(canonical);
    expect(buildBrowserOwnerDataScopeKey('not-an-address')).toBe('');
  });

  it('is stable across equivalent session wrappers and unrelated live-chain state', () => {
    const first = buildBrowserWalletRuntimeScopeKey(base);
    const equivalent = buildBrowserWalletRuntimeScopeKey({
      ...base,
      session: { ...session }
    });

    expect(equivalent).toBe(first);
  });

  it('replaces public identity for a different provider but keeps equivalent wrappers of the same provider', () => {
    const provider = {}, otherProvider = {};
    const first = buildBrowserWalletRuntimeScopeKey({ ...base, session: { ...session, provider }, variant: 'public-identity' });
    const same = buildBrowserWalletRuntimeScopeKey({ ...base, session: { ...session, provider }, variant: 'public-identity' });
    const changed = buildBrowserWalletRuntimeScopeKey({ ...base, session: { ...session, provider: otherProvider }, variant: 'public-identity' });
    expect(same).toBe(first);
    expect(changed).not.toBe(first);
  });

  it('changes only for a deliberate runtime variant transition', () => {
    const publicScope = buildBrowserWalletRuntimeScopeKey({ ...base, variant: 'public' });
    const privateScope = buildBrowserWalletRuntimeScopeKey({ ...base, variant: 'private' });

    expect(publicScope).not.toBeNull();
    expect(privateScope).not.toBeNull();
    expect(privateScope).not.toBe(publicScope);
  });

  it('fails closed for a real signer, account, network, deployment, or wallet identity change', () => {
    expect(buildBrowserWalletRuntimeScopeKey({ ...base, activeSignerSource: null })).toBeNull();
    expect(buildBrowserWalletRuntimeScopeKey({
      ...base,
      session: { ...session, address: '0x2222222222222222222222222222222222222222' }
    })).toBeNull();
    expect(buildBrowserWalletRuntimeScopeKey({ ...base, session: { ...session, chainId: 1 } })).toBeNull();
    expect(buildBrowserWalletRuntimeScopeKey({ ...base, deploymentFingerprint: '' })).toBeNull();
    expect(buildBrowserWalletRuntimeScopeKey({ ...base, session: { ...session, walletId: '' } })).toBeNull();
  });

  it('rejects malformed session chain and address values without throwing', () => {
    expect(buildBrowserWalletRuntimeScopeKey({
      ...base,
      session: { ...session, chainId: Number.NaN }
    })).toBeNull();
    expect(buildBrowserWalletRuntimeScopeKey({
      ...base,
      session: { ...session, address: 'not-an-address' }
    })).toBeNull();
  });
});
