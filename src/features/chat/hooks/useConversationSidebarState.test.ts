import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { selectDirectChatDiscoveryView } from './useConversationSidebarState';
import { getBrowserRuntimeSetupError } from '../../../lib/browserWalletRuntimeScope';

describe('Direct sidebar discovery scope', () => {
  const runtime = { enabled: true };
  const scope = {};
  const view = { runtime, scope, state: 'ready' as const, refreshing: false };

  it('uses ready only for the same runtime and owner/privacy scope', () => {
    expect(selectDirectChatDiscoveryView({ runtime, scope, privacyReady: true, view })).toBe(view);
    expect(selectDirectChatDiscoveryView({ runtime: { enabled: true }, scope, privacyReady: true, view }))
      .toMatchObject({ state: 'loading' });
    expect(selectDirectChatDiscoveryView({ runtime, scope: {}, privacyReady: true, view }))
      .toMatchObject({ state: 'loading' });
    const oldError = { ...view, state: 'error' as const, error: 'Old owner admission error.' };
    expect(selectDirectChatDiscoveryView({ runtime, scope: {}, privacyReady: true, view: oldError }))
      .toEqual({ state: 'loading', refreshing: false });
    expect(selectDirectChatDiscoveryView({ runtime, scope, privacyReady: false, view })).toBeUndefined();
  });

  it('distinguishes pending setup from an unavailable selected runtime', () => {
    expect(selectDirectChatDiscoveryView({ runtime: null, scope, privacyReady: true, view }))
      .toMatchObject({ state: 'loading' });
    expect(selectDirectChatDiscoveryView({ runtime: { enabled: false, error: 'Admission unavailable.' },
      scope, privacyReady: true, view })).toMatchObject({ state: 'error', error: 'Admission unavailable.' });
  });

  it('surfaces a current setup failure without importing an old owner failure', () => {
    const failure = { scopeKey: 'owner-A', message: 'Direct setup import failed.' };
    expect(selectDirectChatDiscoveryView({ runtime: null, scope, privacyReady: true, view,
      setupError: getBrowserRuntimeSetupError('owner-A', failure) }))
      .toMatchObject({ state: 'error', error: failure.message, refreshing: false });
    expect(selectDirectChatDiscoveryView({ runtime: null, scope, privacyReady: true, view,
      setupError: getBrowserRuntimeSetupError('owner-B', failure) }))
      .toMatchObject({ state: 'loading' });
    expect(selectDirectChatDiscoveryView({ runtime: null, scope, privacyReady: false, view,
      setupError: failure.message })).toBeUndefined();
    const app = readFileSync(fileURLToPath(new URL('../../../App.tsx', import.meta.url)), 'utf8');
    const setup = app.slice(app.indexOf('let createdRuntime: DirectChatV2Runtime | null'), app.indexOf('let createdRuntime: OtcTradeHistoryV2Runtime | null'));
    expect(setup).toMatch(/catch\(\(cause\) =>[\s\S]*?if \(!disposed\)[\s\S]*?setDirectChatV2SetupFailure\(\{ scopeKey: directChatV2RuntimeScopeKey/u);
    expect(app).toContain('canRefreshContacts={directChatV2Runtime?.enabled === true && !directChatV2SetupError}');
  });

  it('keeps manual refresh on existing schedulers and terminal readiness on indexed pages', () => {
    const app = readFileSync(fileURLToPath(new URL('../../../App.tsx', import.meta.url)), 'utf8');
    const discovery = app.slice(app.indexOf('const discoverKnownConversations ='), app.indexOf('const directChatV2ContactSettingsScope ='));
    expect(discovery).toContain("publishDirectDiscovery(olderConversationCursor === 0n ? 'ready' : 'partial', false)");
    expect(discovery).toMatch(/catch \(error\)[\s\S]*?publishDirectDiscovery\('error', false/u);
    expect(discovery).toMatch(/const requestDiscoveryRefresh = \(\) => \{[\s\S]*?scheduleDiscovery\(0\);[\s\S]*?scheduleConversationPreviews\(0\)/u);
    expect(discovery).toContain('directChatV2DiscoveryRefreshRef.current = requestDiscoveryRefresh');
    expect(discovery).toContain('if (directChatV2DiscoveryRefreshRef.current === requestDiscoveryRefresh)');
    expect(discovery).not.toContain('pageIndex < 4');
    expect(discovery).toContain('const beforeIndexExclusive = older ? olderConversationCursor : undefined');
    expect(discovery).toContain('older || olderConversationCursor === undefined || page.nextBeforeIndex < olderConversationCursor');
    expect(discovery).toContain('void discoverKnownConversations(true)');
    expect(discovery).toContain('directChatV2LoadOlderContactsRef.current === requestOlderConversations');
    expect(discovery).not.toContain('scheduleDiscovery(result.hasMore');
    expect(discovery).toMatch(/const indexGeneration = conversationIndexGeneration;\s*const page = await runtime.session.listConversations[\s\S]*?if \(!shouldContinue\(\) \|\| indexGeneration !== conversationIndexGeneration\) return;/u);
    expect(discovery).toMatch(/if \(result.reorged && ownerAesReady\) \{\s*seenPreviews.clear\(\);\s*conversationIndexGeneration \+= 1;\s*olderConversationCursor = undefined;/u);
    expect(discovery).toContain('listConversations(beforeIndexExclusive, 32n)');
    expect(discovery).toContain('scheduleConversationPreviews(pollDelay(false))');
    expect(discovery).toContain('scheduleConversationPreviews(pollDelay())');
    expect(app).toContain('[directChatV2RuntimeScopeKey, browserOwnerDataScopeKey, ownerAesKey, ownerAesReady]');
    expect(app).toMatch(/const refreshDirectChatV2 = \(\) => \{[\s\S]*?directChatV2DiscoveryRefreshRef\.current\?\.\(\);[\s\S]*?directChatV2RefreshRef\.current\?\.\(\)/u);
  });
});
