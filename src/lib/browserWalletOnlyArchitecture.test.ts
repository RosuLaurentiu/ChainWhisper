import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_ROOT = resolve(process.cwd());
const SRC_ROOT = join(APP_ROOT, 'src');

const retiredRuntimePaths = [
  'src/features/trading/hooks/useP2PBurnerWalletConnection.ts',
  'src/features/wallet/accountFundsAssets.ts',
  'src/features/wallet/components/AccountFundsModal.tsx',
  'src/features/wallet/components/AppWalletSwitchButton.tsx',
  'src/features/wallet/components/BurnerBackupModal.tsx',
  'src/features/wallet/components/BurnerImportModal.tsx',
  'src/features/wallet/components/BurnerPinModal.tsx',
  'src/features/wallet/components/RecoverySaveConfirmModal.tsx',
  'src/features/wallet/components/RecoveryTransactionStatus.tsx',
  'src/features/wallet/components/TopUpModal.tsx',
  'src/features/wallet/components/WalletSessionModals.tsx',
  'src/features/wallet/hooks/useAccountFundsTransfer.ts',
  'src/features/wallet/hooks/useAccountFundsViewModel.ts',
  'src/features/wallet/hooks/useBurnerWallet.ts',
  'src/features/wallet/hooks/useBurnerWalletDisplay.ts',
  'src/features/wallet/hooks/useOwnerRecoveryBootstrap.ts',
  'src/lib/appShared/burnerVault.ts',
  'src/lib/appWalletRecovery.ts',
  'src/lib/burnerWalletVault.ts',
  'src/lib/directChatChain.ts',
  'src/lib/groupActions.ts',
  'src/lib/groupChatChain.ts',
  'src/lib/groupJoinCodes.ts',
  'src/lib/recoveryExplorer.ts',
  'src/shell/walletPolicy.ts'
] as const;

const retiredRuntimeSymbols = [
  'AccountFundsModal',
  'AppWalletSwitchButton',
  'BurnerBackupModal',
  'BurnerImportModal',
  'BurnerPinModal',
  'RecoverySaveConfirmModal',
  'RecoveryTransactionStatus',
  'TopUpModal',
  'WalletSessionModals',
  'useAccountFundsTransfer',
  'useAccountFundsViewModel',
  'useBurnerWallet',
  'useBurnerWalletDisplay',
  'useOwnerRecoveryBootstrap'
] as const;

const listProductionSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listProductionSourceFiles(path);
    if (!/\.(?:ts|tsx)$/u.test(entry.name) || /\.(?:test|spec)\.(?:ts|tsx)$/u.test(entry.name)) return [];
    return [path];
  });

const productionSources = listProductionSourceFiles(SRC_ROOT).map((path) => ({
  content: readFileSync(path, 'utf8'),
  path,
  relativePath: relative(APP_ROOT, path).replace(/\\/gu, '/')
}));

describe('browser-wallet-only architecture boundary', () => {
  it('keeps former Group viewport acknowledgement separate from current incoming coverage', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');
    const visible = app.slice(app.indexOf('const markLatestGroupV2MessageVisible ='), app.indexOf('    chatMessagesRef: setChatMessagesContainerRef,', app.indexOf('const markLatestGroupV2MessageVisible =')));
    expect(visible.includes("message.groupV2?.contentState === 'available'")).toBe(true);
    expect(visible.includes('group.id === selectedGroupId && group.membershipEnded')).toBe(true);
    expect(visible.includes('!runtime.isCurrent()')).toBe(true);
    expect(visible.includes("message.groupV2?.finality !== 'finalized'")).toBe(true);
    expect(visible.includes('&& !visibleHistoricalMessage')).toBe(true);
    expect(visible.includes('await runtime.readCursors.advanceVisible(scope, message, context)')).toBe(true);
    expect(app.includes('if (group.membershipEnded) delete nextUnreadGroups[String(group.id)];')).toBe(true);
    expect(app.includes('groupChatV2DiscoveryCaughtUpRef.current[String(selectedGroupId)] = true')).toBe(false);
  });
  it('keeps every retired app-wallet runtime module deleted', () => {
    for (const path of retiredRuntimePaths) {
      expect(existsSync(join(APP_ROOT, path)), `${path} must stay deleted`).toBe(false);
    }
  });

  it('keeps retired chat contracts read-only and behind an explicit compatibility boundary', () => {
    const expectedLegacyReaders = [
      'src/lib/chatGc.ts'
    ];
    const legacyImporters = productionSources
      .filter(({ relativePath }) => relativePath !== 'src/lib/legacyChatContracts.ts')
      .filter(({ content }) => content.includes('legacyChatContracts'))
      .map(({ relativePath }) => relativePath)
      .sort();
    const compatibilitySource = readFileSync(
      join(SRC_ROOT, 'lib/legacyChatContracts.ts'),
      'utf8'
    );
    const sharedContracts = readFileSync(join(SRC_ROOT, 'lib/appShared/contracts.ts'), 'utf8');
    const functionFragments = [...compatibilitySource.matchAll(/'function ([^']+)'/gu)]
      .map((match) => match[1] ?? '');

    expect(legacyImporters).toEqual(expectedLegacyReaders);
    expect(functionFragments.length).toBeGreaterThan(0);
    for (const fragment of functionFragments) {
      expect(fragment, `legacy ABI reintroduced a write selector: ${fragment}`).toMatch(
        /\bview\s+returns\b|\bpure\s+returns\b/u
      );
    }
    expect(sharedContracts).not.toMatch(/CHAT_CONTRACT_(?:ADDRESS|ABI)/u);
    expect(compatibilitySource).not.toMatch(
      /submit(?:Multipart|GroupMessage)?\(|setMyNickname\(|createGroup\(|addMembers\(|inviteMembers\(|approve\(/u
    );
  });

  it('does not import or render retired wallet controls from production source', () => {
    for (const source of productionSources) {
      for (const symbol of retiredRuntimeSymbols) {
        expect(source.content, `${source.relativePath} reintroduced ${symbol}`).not.toContain(symbol);
      }
      expect(source.content, `${source.relativePath} reintroduced local account creation`).not.toMatch(
        /(?:Create|Import) ChainWhisper Account|(?:Create|Import) account/u
      );
    }
  });

  it('requires a connected browser wallet for the only account scope', () => {
    const core = readFileSync(join(SRC_ROOT, 'lib/appShared/core.ts'), 'utf8');
    const accountScope = readFileSync(join(SRC_ROOT, 'lib/walletAccountScope.ts'), 'utf8');
    const walletSession = readFileSync(join(SRC_ROOT, 'lib/walletSession.ts'), 'utf8');

    expect(core).toContain("export type WalletAccountRole = 'owner';");
    expect(accountScope).not.toContain('actionAesReady');
    expect(accountScope).not.toContain('actionAddress');
    expect(accountScope).toContain(
      "const connectedAddress = isWalletAddress(normalizedOwnerAddress) ? normalizedOwnerAddress : '';"
    );
    expect(walletSession).toContain('export const resolveBrowserWalletPrivacyState');
    expect(walletSession).not.toContain('resolveOwnerRecoveryWalletState');
    expect(walletSession).not.toContain('browserWalletAddress.trim() ||');
  });

  it('restores an already-authorized browser wallet after an app reload without reconnecting', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');

    expect(app).not.toContain('allowPassiveBrowserRestore: false');
  });

  it('does not log raw provider objects from active wallet and chat failure boundaries', () => {
    const errorBoundary = readFileSync(
      join(SRC_ROOT, 'app/components/AppErrorBoundary.tsx'),
      'utf8'
    );
    const mobileConnect = readFileSync(join(SRC_ROOT, 'lib/metamaskConnectMobile.ts'), 'utf8');

    expect(errorBoundary).toContain('getProviderErrorMessage(error,');
    expect(errorBoundary).not.toContain("console.error('[AppErrorBoundary]', error");
    expect(mobileConnect).toContain(
      "getProviderErrorMessage(error, 'MetaMask Connect initialization failed.')"
    );
    expect(mobileConnect).not.toContain('message: error instanceof Error ? error.message');
  });

  it('clears owner Chat private state when the wallet or privacy session changes', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');

    expect(app).toContain(
      'const browserOwnerDataScopeKey = buildBrowserOwnerDataScopeKey(walletAddress);'
    );
    expect(app).toMatch(
      /setContacts\(\[\]\);[\s\S]*?messagesByContactRef\.current = \{\};[\s\S]*?\}, \[directChatV2DiscoveryScope\]\);/u
    );
    expect(app).toMatch(
      /setGroups\(\[\]\);[\s\S]*?setMessagesByGroup\(\{\}\);[\s\S]*?\}, \[browserOwnerDataScopeKey\]\);/u
    );
    expect(app).toContain('const nextWallet = browserOwnerDataScopeKey;');
    expect(app).toContain('directChatV2PrivateScopeRef.current = directChatV2DiscoveryScope;');
    expect(app.match(/createdRuntime = bindBrowserWalletRuntimePrivacyScope\(createdRuntime, isPrivateScopeCurrent\);/gu)).toHaveLength(2);
    expect(app).toContain('[directChatV2RuntimeScopeKey, browserOwnerDataScopeKey, ownerAesKey, ownerAesReady]');
    expect(app).toContain('if (!isPrivateScopeCurrent()) return;');
    expect(app).toContain('directChatPrivateDisplayScope === directChatV2DiscoveryScope');
    expect(app).toContain('hasAesReady={chatPrivateDisplayReady}');
    expect(app).toContain('chatPrivateDisplayReady && activeContact');
  });

  it('keeps chat, group, token, OTC, and liquidity loaders on canonical owner keys', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');
    const sidebar = readFileSync(
      join(SRC_ROOT, 'features/chat/hooks/useConversationSidebarState.ts'),
      'utf8'
    );
    const groupThread = readFileSync(
      join(SRC_ROOT, 'features/groups/hooks/useActiveGroupThreadState.ts'),
      'utf8'
    );
    const reactions = readFileSync(
      join(SRC_ROOT, 'features/chat/hooks/useMessageReactions.ts'),
      'utf8'
    );
    const watchlist = readFileSync(
      join(SRC_ROOT, 'features/wallet/hooks/useWalletTokenWatchlist.ts'),
      'utf8'
    );
    const oneOff = readFileSync(
      join(SRC_ROOT, 'features/trading/hooks/useOneOffTradeV2Data.ts'),
      'utf8'
    );
    const balances = readFileSync(
      join(SRC_ROOT, 'features/trading/hooks/useP2PTradeTokenData.ts'),
      'utf8'
    );
    const liquidity = readFileSync(
      join(SRC_ROOT, 'features/trading/hooks/usePrivateLiquidityWorkspaceData.ts'),
      'utf8'
    );
    const tradingPage = readFileSync(
      join(SRC_ROOT, 'features/trading/components/P2PTradingPage.tsx'),
      'utf8'
    );

    expect(app).toContain('const browserOwnerDataScopeKey = buildBrowserOwnerDataScopeKey(walletAddress);');
    expect(app).not.toMatch(/setMessagesByContact, walletAddress\]\);/u);
    expect(sidebar).toContain('const walletScopeKey = walletAddress.trim().toLowerCase();');
    expect(sidebar).not.toMatch(/sortedContacts, walletAddress\]\);/u);
    expect(groupThread).toContain('const walletScopeKey = walletAddress.trim().toLowerCase();');
    expect(groupThread).not.toMatch(/onChainNicknameCacheRef, walletAddress\]\);/u);
    expect(reactions).toContain('const walletScopeKey = walletAddress.trim().toLowerCase();');
    expect(reactions).not.toMatch(/chatReactionsV1States, walletAddress\]/u);
    expect(watchlist).toContain('const walletScopeKey = normalizeWalletAddress(walletAddress);');
    expect(watchlist).not.toMatch(/\}, \[chainId, walletAddress\]\);/u);
    expect(oneOff).toContain('const walletScopeKey = walletAddress.trim().toLowerCase();');
    expect(oneOff).not.toMatch(/runtime, walletAddress\]\);/u);
    expect(balances).toContain('const normalizedWalletAddress = walletAddress.trim().toLowerCase();');
    expect(balances).not.toMatch(/readCurrentPrivateBalanceState, walletAddress/u);
    expect(liquidity).toContain(
      "const ownerDataScopeKey = buildBrowserOwnerDataScopeKey(walletAddress ?? '');"
    );
    expect(liquidity).not.toMatch(/selectedPositionId, walletAddress\]\);/u);
    expect(tradingPage).toContain('address: walletKey,');
    expect(tradingPage).not.toMatch(/sharedWalletSession\?\.walletReadAccounts, walletAddress,/u);
  });

  it('keeps retired Chat and Group readers out of current App entry paths', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');
    const retired = ['useDirectConversationSync', 'useDirectConversationRealtimeSync',
      'useGroupDataSync', 'useGroupRealtimeSync', 'useStateBackupSync', 'useConversationReadStateActions'];
    for (const name of retired) expect(app).not.toContain(name);
    expect(app).not.toContain('markAllLegacyConversationsAsRead');
    expect(app).not.toContain('loadOlderMessagesForActiveContact');
    const scroll = readFileSync(join(SRC_ROOT, 'features/chat/hooks/useChatThreadScroll.ts'), 'utf8');
    expect(scroll).not.toContain('loadOlderMessagesForActiveContact');
    expect(app).toContain('markAllV2ConversationsAsRead');
    expect(app).toContain('activeGroupIdRef.current = groupId;');
  });

  it('keeps human signing on a selected browser-wallet lease and limits choices to MetaMask or CipherTrade', () => {
    const signerLease = readFileSync(
      join(SRC_ROOT, 'features/wallet/hooks/useSharedWalletSigner.ts'),
      'utf8'
    );
    const walletOptions = readFileSync(join(SRC_ROOT, 'lib/walletOptions.ts'), 'utf8');

    expect(signerLease).toContain("throw new Error('ChainWhisper only accepts a selected browser-wallet signer.');");
    expect(signerLease).toMatch(/'privateKey' in signer[\s\S]*'signingKey' in signer[\s\S]*'mnemonic' in signer/u);
    expect(walletOptions).toContain(
      'isPreferredMetaMaskWalletOption(option) || isCypherTradeWalletOption(option)'
    );
    expect(walletOptions).toContain('options.filter(isAllowedBrowserWalletOption)');

    const walletConnect = readFileSync(join(SRC_ROOT, 'lib/walletConnectMobile.ts'), 'utf8');
    expect(walletConnect).toContain("throw new Error('This WalletConnect option only accepts CipherTrade Mobile.');");
    expect(walletConnect).toContain('isCipherTradeWalletConnectPeer(provider.session?.peer?.metadata)');
  });

  it('has one signer factory for chat, trading, swaps, and owner-funds actions', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');
    const sharedSignerUtilities = readFileSync(
      join(SRC_ROOT, 'features/wallet/hooks/useSharedWalletSigner.ts'),
      'utf8'
    );
    const walletOnboarding = readFileSync(
      join(SRC_ROOT, 'features/wallet/hooks/useWalletOnboarding.ts'),
      'utf8'
    );
    const ownerSignerFactory = readFileSync(
      join(SRC_ROOT, 'features/wallet/hooks/useAccountFundsSigners.ts'),
      'utf8'
    );
    const p2pSigner = readFileSync(
      join(SRC_ROOT, 'features/trading/hooks/useP2PTradeSigner.ts'),
      'utf8'
    );
    const p2pTransactionFlow = readFileSync(
      join(SRC_ROOT, 'features/trading/hooks/useP2PTradeWalletPromptFlow.ts'),
      'utf8'
    );

    expect(sharedSignerUtilities).not.toMatch(/export default function useSharedWalletSigner/u);
    expect(app).not.toContain('getCachedBrowserWalletReadSigner');
    expect(app).toMatch(
      /const getOwnerMemoReadSigner = useCallback\(\s*\(requirePrivacy: boolean\) => getOwnerFundsSigner\(requirePrivacy\)/u
    );
    expect(ownerSignerFactory).toContain('issueOwnerCotiMetaMaskCapability<JsonRpcSigner>({');
    expect(ownerSignerFactory).not.toMatch(/new JsonRpcSigner|createCotiBrowserProvider/u);
    expect(walletOnboarding).toMatch(
      /const browserProvider = await createCotiBrowserProvider[\s\S]*?try \{[\s\S]*?return onboardInfo;[\s\S]*?finally \{[\s\S]*?destroyCotiSignerProviderOnce\(browserProvider\);/u
    );
    expect(p2pSigner).not.toMatch(/createCotiBrowserProvider|eth_accounts|eth_chainId|getOrRecoverAesForWallet/u);
    expect(p2pSigner).toContain('sharedGetSigner(requireAes, options)');
    expect(p2pTransactionFlow).not.toMatch(/eth_accounts|eth_chainId|runWalletTransactionFlow\(/u);
    expect(p2pTransactionFlow).toContain('sharedRunWalletTransactionFlow(async () =>');
  });

  it('allows no production private-key Wallet constructor except the non-custodial join-code proof helper', () => {
    const walletConstructorSources = productionSources.filter(({ content }) =>
      /\bnew Wallet\s*\(/u.test(content)
    );

    expect(walletConstructorSources.map(({ relativePath }) => relativePath)).toEqual([
      'src/lib/groupChatV2JoinCode.ts'
    ]);
    expect(walletConstructorSources[0]?.content).toContain(
      'new Wallet(keccak256(toUtf8Bytes('
    );
    for (const source of productionSources) {
      expect(source.content, `${source.relativePath} reintroduced private-key import handling`)
        .not.toMatch(/normalizePrivateKeyInput|looksLikePrivateKeyInput|normalizeImportInput/u);
      expect(source.content, `${source.relativePath} reintroduced random local wallet creation`)
        .not.toMatch(/Wallet\.(?:createRandom|fromPhrase|fromEncryptedJson)/u);
    }
  });

  it('does not repeat public OTC admission when privacy readiness changes', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');
    const start = app.indexOf('const otcV2RuntimeScopeKey = useMemo(');
    const end = app.indexOf('const handleOtcV2InitialDiscoverySettled', start);
    const binding = app.slice(start, end);
    expect(binding).toContain("variant: 'public-identity'");
    expect(binding).not.toContain("variant: hasAesReady ? 'private' : 'public'");
    expect(binding).toContain('resolveBrowserWalletPrivacyReadScope(');
    expect(binding).toContain('otcV2DiscoveryScopeKey');
  });

  it('defers unused cold OTC admission outside its P2P screens without disabling Chat trades', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');
    const scopeStart = app.indexOf('const otcV2StartupScopeKey =');
    expect(scopeStart).toBeGreaterThan(-1);
    const scope = app.slice(scopeStart, scopeStart + 550);
    expect(scope).toContain('resolveBrowserRuntimeStartupScope(');
    expect(scope).toContain('otcV2RuntimeScopeKey, otcV2StartupScopeRef.current,');
    expect(scope).toContain("activePage !== 'trades' && !(activePage === 'dex' && navigationPath === '/dex/agent')");
    expect(scope).toContain('otcV2StartupScopeRef.current = otcV2StartupScopeKey;');
    const setupStart = app.indexOf('    let createdRuntime: OtcTradeHistoryV2Runtime | null = null;');
    const setupEnd = app.indexOf('  }, [otcV2RuntimeScopeKey, otcV2StartupScopeKey]);', setupStart);
    expect(setupEnd).toBeGreaterThan(setupStart);
    const setup = app.slice(setupStart, setupEnd);
    const guard = setup.indexOf('if (!otcV2StartupScopeKey)');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(setup.indexOf("import('./lib/otcTradeHistoryV2Runtime')"));
    const chatTradeStart = app.indexOf('useInChatTradeActions({');
    const chatTrade = app.slice(chatTradeStart, chatTradeStart + 1_500);
    expect(chatTrade).toContain('directTradeV2Runtime,');
    expect(chatTrade).not.toContain('otcV2ActionRuntime');
  });

  it('does not unlock OTC private history from a background sync before privacy is ready', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');
    const runtimeStart = app.indexOf('createOtcTradeHistoryV2Runtime({');
    const runtimeEnd = app.indexOf('      if (!disposed)', runtimeStart);
    expect(runtimeEnd).toBeGreaterThan(runtimeStart);
    const runtimeBinding = app.slice(runtimeStart, runtimeEnd);

    expect(runtimeStart).toBeGreaterThan(-1);
    expect(runtimeBinding).toMatch(
      /getOwnerCapability:\s*\(\) => \{[\s\S]*?const privacyScope = otcV2PrivacyReadScopeRef\.current;[\s\S]*?assertPrivateReadCurrent\(\);\s*return issueOtcV2MetaMaskCapability/u
    );
    expect(runtimeBinding).toContain('assertBrowserWalletPrivacyReadScopeCurrent(privacyScope, otcV2PrivacyReadScopeRef.current)');
    expect(runtimeBinding).toContain('assertCapabilityCurrent: assertPrivateReadCurrent');
    expect(runtimeBinding).toMatch(/assertLeaseCurrent: async \(currentLease\) =>\s*browserRuntimeDependenciesRef\.current\.assertBrowserWalletSignerLeaseSnapshotCurrent\(currentLease\)/u);
    expect(runtimeBinding).toMatch(/assertLeaseSnapshotCurrent:\s*browserRuntimeDependenciesRef\.current\.assertBrowserWalletSignerLeaseSnapshotCurrent/u);
    expect(runtimeBinding).toMatch(
      /assertCurrent:\s*guard\.assertCurrent/u
    );
    const setupBinding = app.slice(app.lastIndexOf('useEffect(() => {', runtimeStart), runtimeEnd);
    expect(setupBinding).toContain('createBrowserWalletRuntimeReadGuard(() => dependencies.assertBrowserWalletSignerLeaseSnapshotCurrent(lease))');
    expect(setupBinding).toContain('await guard.run(() => loadCotiStartupReadProvider())');
    expect(runtimeBinding).toMatch(/const foregroundStartup = \(!startupAdmissionComplete \|\| participantReadPriorityRef\.current\) &&\s*activePageRef\.current === 'trades' && !isWalletTransactionPromptActive\(\);/u);
    expect(app).toContain('participantReadPriorityRef.current = deferP2PReadPass;');
    expect(runtimeBinding).toMatch(/return sendCotiScopedRead\(foregroundStartup \? startupReadProvider : readProvider,\s*guard, method/u);
    expect(app.slice(runtimeEnd - 180, runtimeEnd + 220)).toMatch(/startupAdmissionComplete = true;[\s\S]*?setOtcV2Runtime\(createdRuntime\)/u);
    expect(runtimeBinding).not.toContain('assertCurrent: () => undefined');
  });

  it('does not rebuild the OTC action capability when cached privacy state is refreshed', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');
    const accountSigners = readFileSync(
      join(SRC_ROOT, 'features/wallet/hooks/useAccountFundsSigners.ts'),
      'utf8'
    );

    expect(app).toMatch(
      /const getOtcV2Capability = useCallback\([\s\S]*?sessionOnboardInfo: ownerTradeOnboardInfoRef\.current[\s\S]*?\[\s*assertBrowserWalletSignerLeaseCurrent,[\s\S]*?setSessionOnboardInfo\s*\]/u
    );
    expect(accountSigners).toContain('const sessionOnboardInfoRef = useRef(sessionOnboardInfo);');
    expect(accountSigners).toContain('cached: sessionOnboardInfoRef.current[cacheKey],');
  });

  it('guards Direct Trade setup reads separately and acquires the owner signer only through the capability callback', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');
    const runtimeStart = app.indexOf('createDirectTradeV2Runtime({');
    const runtimeSetup = app.slice(runtimeStart, runtimeStart + 2_500);

    expect(runtimeStart).toBeGreaterThan(-1);
    expect(runtimeSetup).toMatch(
      /getOwnerCapability:\s*\(requirePrivacy\)\s*=>\s*\{\s*const dependencies = browserRuntimeDependenciesRef\.current;\s*const lease = dependencies\.captureBrowserWalletSignerLease\(\)/u
    );
    expect(runtimeSetup).toContain('expectedOwnerAddress: ownerAddress');
    expect(runtimeSetup.match(/captureBrowserWalletSignerLease\(\)/gu)).toHaveLength(1);
    expect(runtimeSetup).toContain('assertCurrent: guard.assertCurrent');
    const setup = app.slice(app.lastIndexOf('useEffect(() => {', runtimeStart), runtimeStart);
    expect(setup).toContain('createBrowserWalletRuntimeReadGuard(() => dependencies.assertBrowserWalletSignerLeaseSnapshotCurrent(lease))');
    expect(setup).toContain('await guard.run(() => loadCotiReadProvider(true))');
  });

  it('does not initialize or synchronize Group Chat V2 before privacy is ready', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');

    expect(app).toMatch(
      /const groupChatV2RuntimeScopeKey = useMemo\([\s\S]*?GROUP_CHAT_V2_DEPLOYMENT_CONFIG\.status === 'active' && hasAesReady[\s\S]*?buildBrowserWalletRuntimeScopeKey[\s\S]*?if \(GROUP_CHAT_V2_DEPLOYMENT_CONFIG\.status !== 'active' \|\| !groupChatV2RuntimeScopeKey\)[\s\S]*?createGroupChatV2Runtime/u
    );
    expect(app).toMatch(
      /const runtime = groupChatV2Runtime;\s*if \(!runtime\?\.enabled \|\| !hasAesReady \|\| deferChatBackgroundStartup\) return;\s*let disposed = false;[\s\S]*?runtime\.discovery\.sync\(retry, publishOverview, \(\) => chatReadDeferredRef.current, \{/u
    );
    expect(app).toMatch(
      /useGroupChatV2History\(\{\s*runtime: activePage === 'chat' \? groupChatV2Runtime : null,\s*activeGroupId,\s*activeGroupIdRef,\s*hasAesReady,[\s\S]*?setEpochSyncRequest: setGroupChatV2EpochSyncRequest/u
    );
    const groupHistory = readFileSync(join(SRC_ROOT, 'features/groups/hooks/useGroupChatV2History.ts'), 'utf8');
    expect(groupHistory).toMatch(
      /const selectedGroupId = activeGroupId;\s*if \(!runtime\?\.enabled \|\| !hasAesReady \|\| selectedGroupId === null\) \{\s*setEpochSyncRequest\(null\);\s*return;\s*\}[\s\S]*?runtime\.history\.sync/u
    );
    expect(groupHistory).toMatch(/const isCurrent = \(\) =>[\s\S]*?view\.current\.hasAesReady/u);
    expect(groupHistory).toMatch(/if \(!isCurrent\(\)\) return;\s*const result = await \(older \? runtime\.history\.loadOlder : runtime\.history\.sync\)/u);
    expect(app).toMatch(
      /const privacyLocked =\s*GROUP_CHAT_V2_DEPLOYMENT_CONFIG\.status === 'active' && !hasAesReady;[\s\S]*?setGroups\(\[\]\);[\s\S]*?setMessagesByGroup\(\{\}\)/u
    );
  });

  it('keeps Private Liquidity attestation and revealed owner data stable across equivalent wrappers', () => {
    const workspace = readFileSync(
      join(SRC_ROOT, 'features/trading/hooks/usePrivateLiquidityWorkspaceData.ts'),
      'utf8'
    );
    const ownerData = readFileSync(
      join(SRC_ROOT, 'features/trading/hooks/usePrivateLiquidityOwnerData.ts'),
      'utf8'
    );

    expect(workspace).toContain('const configRef = useRef(config);');
    expect(workspace).toMatch(
      /const deploymentScopeKey = buildPrivateLiquidityWorkspaceDeploymentScopeKey\(config\);[\s\S]*?\}, \[attestationRetryRevision, deploymentScopeKey, enabled\]\);/u
    );
    expect(ownerData).toContain('const loadContextRef = useRef({');
    expect(ownerData).toMatch(
      /const load = useCallback\(async \(\{ interactive \}: \{ interactive: boolean \}\) => \{[\s\S]*?\n {2}\}, \[\]\);/u
    );
  });

  it('restores Direct Chat V2 contacts from the canonical participant conversation index', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');

    expect(app).toMatch(
      /const discoverKnownConversations = async \(older = false\) => \{[\s\S]*?!ownerAesReady[\s\S]*?runtime\.session\.listConversations\(beforeIndexExclusive, 32n\)[\s\S]*?mergeUniqueContacts\(previous, peers\)[\s\S]*?if \(rememberDirectChatV2Preview\(seenPreviews, preview\)\) rememberIncomingPeer\(preview.peer, false, true\)/u
    );
  });

  it('gives initial Chat/DEX reads priority without deferring their own discovery', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');
    expect(app).toMatch(/const deferNotificationStartup = useInitialReadPriority\([\s\S]*?selectedReadPending[\s\S]*?\) \|\| deferP2PReadPass/u);
    expect(app).toContain('directTradeV2RuntimeScopeKey, directTradeStartupScopeRef.current, deferNotificationStartup || !ownerAesReady');
    expect(app).toMatch(/chatReactionsV1RuntimeScopeKey, reactionsStartupScopeRef.current,\s*deferNotificationStartup \|\| !ownerAesReady \|\| activePage !== 'chat'/u);
    expect(app).toContain('!browserOwnerDataScopeKey || !ownerAesReady || deferChatBackgroundStartup');
    expect(app).toContain("activePage === 'dex' ? currentMarketReference.status === 'loading'");
    expect(app).toContain('const continueBackground = () => shouldContinue()');
    expect(app).toContain('for (const peer of result.changedPeers) rememberIncomingPeer(peer, false, true)');
    expect(app).toContain('activeContactRef.current === selectedContact && activeGroupIdRef.current === selectedGroup');
    expect(app).toMatch(/useChatReactionsV1Runtime\(\{[\s\S]*?deferSync: deferNotificationStartup \|\| !ownerAesReady \|\| activePage !== 'chat'/u);
    expect(app).toContain('directTradeReadDeferredRef.current = deferNotificationStartup;');
    const tradePolling = app.slice(app.indexOf('const runtime = directTradeV2Runtime;'), app.indexOf('const requestChainWhisperFundingAfterError'));
    expect(tradePolling).toContain('if (!runtime || !runtime.isCurrent() || !browserOwnerDataScopeKey || !ownerAesReady) return;');
    expect(tradePolling).toContain('canonicalComplete: batch.historyComplete');
    expect(tradePolling).toMatch(/if \(directTradeReadDeferredRef.current\) \{\s*schedule\(1_000\);\s*return;\s*\}\s*try \{\s*const batch = await runtime.sync\(\);\s*if \(!shouldContinue\(\)\) return/u);
    // A pause must not dispose an in-flight result after runtime.sync commits it.
    expect(tradePolling.slice(tradePolling.lastIndexOf('}, ['))).not.toContain('deferNotificationStartup');
    expect(app).toMatch(/useRewardTokenMetrics\(\{[\s\S]*?bridgeEnabled: activePage === 'swap'/u);
  });

  it('pauses new background Chat work during selected DEX reads without dropping committed results', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');
    expect(app).toContain("chatReadDeferredRef.current = deferSelectedGroupHistory || (activePage !== 'chat' && deferNotificationStartup);");
    const groupPolling = app.slice(app.indexOf('    const runtime = groupChatV2Runtime;'),
      app.indexOf('  const { historyUnavailable: groupChatV2HistoryUnavailable,'));
    const groupSync = groupPolling.slice(groupPolling.indexOf('const sync = async () => {'));
    expect(groupSync).toMatch(/if \(!isCurrent\(\) \|\| inFlight\) return;\s*if \(chatReadDeferredRef.current\) \{\s*schedule\(1_000\);\s*return;\s*\}\s*inFlight = true/u);
    expect(groupSync).toMatch(/const result = await runtime.discovery.sync\(retry, publishOverview, \(\) => chatReadDeferredRef.current, \{[\s\S]*?\}\);\s*if \(!isCurrent\(\)\) return;\s*publishOverview\(result\)/u);
    expect(groupSync.includes("const older = olderRequested || (hasOlderGroups && activePageRef.current === 'chat');")).toBe(true);
    expect(groupSync.includes('hasOlderGroups = result.hasOlder;')).toBe(true);
    expect(groupSync).toMatch(/catch \(cause\) \{\s*const \{ isGroupChatV2DiscoveryYield \} = await import\('\.\/lib\/groupChatV2DiscoveryRuntime'\);\s*if \(isGroupChatV2DiscoveryYield\(cause\)\) \{\s*retryFailed \|\|= retry;\s*olderRequested \|\|= older;\s*schedule\(1_000\);\s*return;\s*\}\s*failed = true/u);
    expect(groupSync).not.toContain("schedule(result.complete ? pollDelay() : activePageRef.current === 'chat' ? 0 : 1_000)");
    expect(groupSync).toContain('result.incomingCompleteGroupIds.map(String)');
    expect(app).toContain('onLoadOlderHistory={() => { void loadOlderGroupHistory(); }}');
    expect(app.includes('onLoadOlderGroups=')).toBe(false);
    expect(/const forceSyncAllData = async \(\) => \{[\s\S]*?if \(directChatV2Runtime\?\.enabled\) \{\s*refreshDirectChatV2\(\);\s*if \(selectedDirectDiscovery\?\.hasOlder\) directChatV2LoadOlderContactsRef\.current\?\.\(\);\s*\}[\s\S]*?refreshGroupChatV2\(groupChatV2DiscoveryView\?\.runtime === groupChatV2Runtime && groupChatV2DiscoveryView\.hasOlder === true\)/u.test(app)).toBe(true);
    expect(/const refreshGroupChatV2 = \(older = false\) => \{\s*if \(older\) groupChatV2LoadOlderRef\.current\?\.\(\);\s*else groupChatV2RefreshRef\.current\?\.\(\);\s*setGroupChatV2HistoryRefreshNonce\(previous => previous \+ 1\)/u.test(app)).toBe(true);
    expect(groupPolling.slice(groupPolling.lastIndexOf('}, ['))).not.toContain('deferNotificationStartup');

    const directPolling = app.slice(app.indexOf('    let backgroundSyncInFlight = false;'),
      app.indexOf('  const directChatV2ContactSettingsScope'));
    const peerSync = directPolling.slice(directPolling.indexOf('const synchronizePeer = async'),
      directPolling.indexOf('const rememberIncomingPeer ='));
    expect(peerSync).toMatch(/if \(chatReadDeferredRef.current\) \{\s*schedulePeer\(peer, 1_000\);\s*return;\s*\}[\s\S]*?const batch = await runtime.history.sync/u);
    expect(peerSync.slice(peerSync.indexOf('const continueBackground ='), peerSync.indexOf('      try {')))
      .not.toContain('chatReadDeferredRef');
    expect(peerSync).toMatch(/if \(!continueBackground\(\)\) \{[^\n]*\}\s*messagesByContactRef.current = batch.apply/u);
    const previews = directPolling.slice(directPolling.indexOf('const discoverKnownConversations ='),
      directPolling.indexOf('const discoverIncoming ='));
    expect(previews.includes('previewsOlderRequested ||= older;')).toBe(true);
    expect(/if \(previewsInFlight\) \{ previewsWakeRequested = true; return; \}\s*if \(chatReadDeferredRef.current\) \{\s*scheduleConversationPreviews\(1_000\);\s*return;\s*\}/u.test(previews)).toBe(true);
    expect(/older = \(older \|\| previewsOlderRequested\) && olderConversationCursor !== undefined && olderConversationCursor > 0n;\s*previewsOlderRequested = false;/u.test(previews)).toBe(true);
    expect(/catch \(error\) \{\s*previewsOlderRequested = false;/u.test(previews)).toBe(true);
    expect(/if \(shouldContinue\(\) && \(previewsWakeRequested \|\| previewsOlderRequested\)\) \{/u.test(previews)).toBe(true);
    expect(previews.slice(previews.indexOf('} finally {')).includes('previewsWakeRequested = false')).toBe(false);
    expect(/previewsInFlight = true;\s*if \(!older\) previewsWakeRequested = false;/u.test(previews)).toBe(true);
    expect(/const requestDiscoveryRefresh = \(\) => \{[\s\S]*?previewsWakeRequested = true;\s*scheduleConversationPreviews\(0\);/u.test(directPolling)).toBe(true);
    expect(previews).not.toContain('for (let pageIndex');
    expect(previews).toContain('const beforeIndexExclusive = older ? olderConversationCursor : undefined');
    const incoming = directPolling.slice(directPolling.indexOf('const discoverIncoming ='));
    expect(incoming).toMatch(/if \(discoveryInFlight\) \{ discoveryWakeRequested = true; return; \}\s*if \(chatReadDeferredRef.current\) \{\s*scheduleDiscovery\(1_000\);\s*return;\s*\}/u);
    expect(incoming).toMatch(/const result = await runtime.history.discoverIncoming\(\(\) => shouldContinue\(\) && !chatReadDeferredRef.current\);\s*if \(!shouldContinue\(\)\) return;\s*for \(const peer of result.peers\)/u);
    expect(directPolling.slice(directPolling.lastIndexOf('}, ['))).not.toContain('deferNotificationStartup');
  });

  it('gives selected Group first content a bounded turn without pausing its history reader', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');
    expect(app).toMatch(/const deferSelectedGroupHistory = useInitialReadPriority\([\s\S]*?activePage === 'chat' && groupChatV2RuntimeScopeKey && activeGroupId !== null[\s\S]*?hasAesReady && activeGroupMessageLoadPhase === 'initial' && activeGroupId !== null &&\s*!messagesByGroup\[String\(activeGroupId\)\]\?\.length/u);
    expect(app).toContain(') || deferP2PReadPass || deferSelectedGroupHistory;');
    const selectedHistory = readFileSync(join(SRC_ROOT, 'features/groups/hooks/useGroupChatV2History.ts'), 'utf8');
    expect(selectedHistory).not.toContain('chatReadDeferred');
    expect(selectedHistory).not.toContain('deferSelectedGroupHistory');
    expect(app.includes('groupHistoryReadPriorityRef.current = deferSelectedGroupHistory;')).toBe(true);
    expect(/issueGroupChatV2MetaMaskCapability\(\{\s*shouldPrioritizeRead: \(groupId\) => !disposed && createdRuntime\?\.isCurrent\(\) === true &&\s*activePageRef.current === 'chat' && groupHistoryReadPriorityRef.current &&\s*groupId === BigInt\(activeGroupIdRef.current \?\? 0\)/u.test(app)).toBe(true);
  });

  it('does not poll MetaMask for active chat, trading, token, or liquidity receipts after broadcast', () => {
    const faucet = readFileSync(join(SRC_ROOT, 'lib/chainWhisperTestnetFaucet.ts'), 'utf8');
    const admission = readFileSync(join(SRC_ROOT, 'lib/chainWhisperTestnetTokenAdmission.ts'), 'utf8');
    const appLookup = readFileSync(join(SRC_ROOT, 'lib/appLookup.ts'), 'utf8');
    const appChain = readFileSync(join(SRC_ROOT, 'lib/appChain.ts'), 'utf8');
    const ownerCapability = readFileSync(join(SRC_ROOT, 'features/wallet/ownerCotiMetaMaskCapability.ts'), 'utf8');
    const directChat = readFileSync(join(SRC_ROOT, 'lib/directChatV2Chain.ts'), 'utf8');
    const groupChat = readFileSync(join(SRC_ROOT, 'lib/groupChatV2Chain.ts'), 'utf8');
    const directTrade = readFileSync(join(SRC_ROOT, 'lib/directTradeV2Actions.ts'), 'utf8');
    const standardTrade = readFileSync(join(SRC_ROOT, 'lib/standardTradeV2Actions.ts'), 'utf8');
    const privateTrade = readFileSync(join(SRC_ROOT, 'lib/privateTradeV2Actions.ts'), 'utf8');
    const recurringTrade = readFileSync(join(SRC_ROOT, 'lib/recurringTradeV2Actions.ts'), 'utf8');
    const privateRecurringTrade = readFileSync(join(SRC_ROOT, 'lib/privateRecurringTradeV2Actions.ts'), 'utf8');
    const privateLiquidity = readFileSync(join(SRC_ROOT, 'lib/privateLiquidityActions.ts'), 'utf8');
    const reactions = readFileSync(join(SRC_ROOT, 'lib/chatReactionsV1Runtime.ts'), 'utf8');
    const tokenSwapActions = readFileSync(join(SRC_ROOT, 'features/tokenTools/useTokenSwapActions.ts'), 'utf8');
    const walletFunds = readFileSync(join(SRC_ROOT, 'lib/walletFunds.ts'), 'utf8');
    const wispBridge = readFileSync(join(SRC_ROOT, 'lib/wispPrivacyBridge.ts'), 'utf8');

    expect(faucet).not.toMatch(/transaction\.wait\(/u);
    expect(faucet).toContain('provider.getTransactionReceipt(transaction.hash)');
    expect(faucet).toMatch(/before\.tokens\.find\(\(\{ key \}\) => key === expectedTokenKey\)/u);
    expect(admission).not.toMatch(/transaction\.wait\(/u);
    expect(admission).toContain('binding.readProvider.getTransactionReceipt(transaction.hash)');
    expect(admission).toMatch(/reader\.readApproval\(operation\.targetAddress, operation\.getter, operation\.tokenAddress\)/u);
    expect(appLookup).not.toMatch(/tx\.wait\(/u);
    expect(appLookup).not.toMatch(/waitForPublicTransactionReceipt|waitForTransaction|\.setMyNickname\(/u);
    expect(appChain).not.toMatch(/\.wait\(\)/u);
    expect(appChain).toMatch(/waitForAppChainReceipt\(transaction, 'Privacy conversion'\)/u);
    expect(ownerCapability).toMatch(
      /const readProvider = await loadCotiReadProvider\(true\);[\s\S]*?bindCapability\(\{[\s\S]*?browserProvider,[\s\S]*?readProvider,/u
    );
    for (const chain of [directChat, groupChat]) {
      expect(chain).toMatch(
        /wait: readProvider === browserProvider[\s\S]*?readProvider\.getTransactionReceipt\(transactionHash\)/u
      );
    }
    for (const trade of [standardTrade, privateTrade, recurringTrade, privateRecurringTrade]) {
      expect(trade).toMatch(
        /binding\.readProvider\s*\?[\s\S]*?waitForOwnerTradeV2Receipt\(binding, hash\)/u
      );
    }
    expect(directTrade).toMatch(
      /binding\.readProvider\s*\?[\s\S]*?waitForOwnerTradeV2Receipt\(binding, hash, \{\s*finalityLagBlocks: BigInt\(deployment\.finalityLagBlocks\)\s*\}\)/u
    );
    expect(privateLiquidity).toMatch(
      /wait: binding\?\.readProvider[\s\S]*?waitForPublicTransactionReceipt\(\{[\s\S]*?readProvider: binding\.readProvider/u
    );
    expect(privateLiquidity).toMatch(
      /transactionEnvelope\(rawTransaction, \{[\s\S]*?\}, 'Private-liquidity swap', binding\)/u
    );
    expect(tokenSwapActions).not.toMatch(/transaction\.wait\(/u);
    expect(tokenSwapActions).toContain('executeChainWhisperWispBridgeConversion');
    expect(appChain).toContain("waitForReceipt: (submitted) => waitForAppChainReceipt(submitted, 'ChainWhisper WISP conversion')");
    expect(wispBridge).not.toMatch(/transaction\.wait\(/u);
    expect(wispBridge).toContain('const receipt = await waitForReceipt(transaction);');
    expect(walletFunds).not.toMatch(/tx\.wait\(/u);
    expect(walletFunds.match(/waitForPublicTransactionReceipt\(/gu)).toHaveLength(3);
    expect(reactions).toMatch(
      /readProvider\.getTransactionReceipt\(transactionHash\)[\s\S]*?setChatReactionsV1Reaction\(\{[\s\S]*?waitForReceipt/u
    );
  });

  it('does not send privacy-onboarding error diagnostics back through a failing wallet RPC', () => {
    const onboarding = readFileSync(
      join(SRC_ROOT, 'features/wallet/hooks/useWalletOnboarding.ts'),
      'utf8'
    );

    expect(onboarding).not.toContain('browserProvider.getBalance(address)');
    expect(onboarding).toMatch(
      /loadCotiReadProvider\(true\)[\s\S]*?readProvider\.getBalance\(address\)/u
    );
  });

  it('does not revoke an unchanged signer lease for an internal wallet lifecycle operation', () => {
    const onboarding = readFileSync(
      join(SRC_ROOT, 'features/wallet/hooks/useWalletOnboarding.ts'),
      'utf8'
    );

    expect(onboarding).toContain('const walletLifecycleEpochRef = useRef(0);');
    expect(onboarding).toContain('const browserWalletSignerLeaseEpochRef = useRef(0);');
    expect(onboarding).toMatch(
      /const beginWalletLifecycleOperation[\s\S]*?walletLifecycleEpochRef\.current \+= 1;[\s\S]*?const retireBrowserWalletSignerLeases/u
    );
    expect(onboarding).toMatch(
      /const captureBrowserWalletSignerLease[\s\S]*?epoch: browserWalletSignerLeaseEpochRef\.current/u
    );
  });
});
