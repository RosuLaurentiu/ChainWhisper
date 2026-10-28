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
  it('keeps every retired app-wallet runtime module deleted', () => {
    for (const path of retiredRuntimePaths) {
      expect(existsSync(join(APP_ROOT, path)), `${path} must stay deleted`).toBe(false);
    }
  });

  it('keeps retired chat contracts read-only and behind an explicit compatibility boundary', () => {
    const expectedLegacyReaders = [
      'src/features/chat/hooks/useDirectConversationRealtimeSync.ts',
      'src/features/chat/hooks/useDirectConversationSync.ts',
      'src/features/groups/hooks/useGroupDataSync.ts',
      'src/features/groups/hooks/useGroupRealtimeSync.ts',
      'src/features/tokenTools/useRewardTokenMetrics.ts',
      'src/lib/appLookup.ts',
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
    const directSync = readFileSync(
      join(SRC_ROOT, 'features/chat/hooks/useDirectConversationSync.ts'),
      'utf8'
    );
    const mobileConnect = readFileSync(join(SRC_ROOT, 'lib/metamaskConnectMobile.ts'), 'utf8');

    expect(errorBoundary).toContain('getProviderErrorMessage(error,');
    expect(errorBoundary).not.toContain("console.error('[AppErrorBoundary]', error");
    expect(directSync).toContain(
      "getProviderErrorMessage(syncError, 'Legacy chat history synchronization failed.')"
    );
    expect(directSync).not.toContain("console.error('[sync] ChatGC error', syncError)");
    expect(mobileConnect).toContain(
      "getProviderErrorMessage(error, 'MetaMask Connect initialization failed.')"
    );
    expect(mobileConnect).not.toContain('message: error instanceof Error ? error.message');
  });

  it('clears owner chat and group state only when the canonical wallet address changes', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');

    expect(app).toContain(
      'const browserOwnerDataScopeKey = buildBrowserOwnerDataScopeKey(walletAddress);'
    );
    expect(app).toMatch(
      /setContacts\(\[\]\);[\s\S]*?\}, \[browserOwnerDataScopeKey\]\);/u
    );
    expect(app).toMatch(
      /setGroups\(\[\]\);[\s\S]*?setMessagesByGroup\(\{\}\);[\s\S]*?\}, \[browserOwnerDataScopeKey, resetGroupFeeCaches\]\);/u
    );
    expect(app).toContain('const nextWallet = browserOwnerDataScopeKey;');
  });

  it('keeps chat, group, token, OTC, and liquidity loaders on canonical owner keys', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');
    const readState = readFileSync(
      join(SRC_ROOT, 'features/chat/hooks/useConversationReadStateActions.ts'),
      'utf8'
    );
    const sidebar = readFileSync(
      join(SRC_ROOT, 'features/chat/hooks/useConversationSidebarState.ts'),
      'utf8'
    );
    const groupSync = readFileSync(
      join(SRC_ROOT, 'features/groups/hooks/useGroupDataSync.ts'),
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
    const recurring = readFileSync(
      join(SRC_ROOT, 'features/trading/hooks/useRecurringTradeV2Data.ts'),
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
    expect(readState).toContain('const ownerDataScopeKey = walletAddress.trim().toLowerCase();');
    expect(readState).not.toMatch(/unreadMapRef,\s*walletAddress\s*\]/u);
    expect(sidebar).toContain('const walletScopeKey = walletAddress.trim().toLowerCase();');
    expect(sidebar).not.toMatch(/sortedContacts, walletAddress\]\);/u);
    expect(groupSync).toContain('const walletScopeKey = walletAddress.trim().toLowerCase();');
    expect(groupSync).not.toMatch(/syncGroupDataRef, walletAddress\]\);/u);
    expect(groupThread).toContain('const walletScopeKey = walletAddress.trim().toLowerCase();');
    expect(groupThread).not.toMatch(/onChainNicknameCacheRef, walletAddress\]\);/u);
    expect(reactions).toContain('const walletScopeKey = walletAddress.trim().toLowerCase();');
    expect(reactions).not.toMatch(/chatReactionsV1States, walletAddress\]/u);
    expect(watchlist).toContain('const walletScopeKey = normalizeWalletAddress(walletAddress);');
    expect(watchlist).not.toMatch(/\}, \[chainId, walletAddress\]\);/u);
    expect(oneOff).toContain('const walletScopeKey = walletAddress.trim().toLowerCase();');
    expect(oneOff).not.toMatch(/runtime, walletAddress\]\);/u);
    expect(recurring).toContain('const walletScopeKey = walletAddress.trim().toLowerCase();');
    expect(recurring).not.toMatch(/runtime, walletAddress\]\);/u);
    expect(balances).toContain('const normalizedWalletAddress = walletAddress.trim().toLowerCase();');
    expect(balances).not.toMatch(/readCurrentPrivateBalanceState, walletAddress/u);
    expect(liquidity).toContain(
      "const ownerDataScopeKey = buildBrowserOwnerDataScopeKey(walletAddress ?? '');"
    );
    expect(liquidity).not.toMatch(/selectedPositionId, walletAddress\]\);/u);
    expect(tradingPage).toContain('address: walletKey,');
    expect(tradingPage).not.toMatch(/sharedWalletSession\?\.walletReadAccounts, walletAddress,/u);
  });

  it('never writes legacy on-chain read-state backup messages', () => {
    const source = readFileSync(join(APP_ROOT, 'src/app/hooks/useStateBackupSync.ts'), 'utf8');
    expect(source).not.toMatch(/encryptValue|LEGACY_CHAT_BACKUP|runWalletTransactionFlow|\.submit\s*\(/u);
    expect(source).toContain('localStorage');
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

  it('does not unlock OTC private history from a background sync before privacy is ready', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');
    const runtimeStart = app.indexOf('createOtcTradeHistoryV2Runtime({');
    const runtimeEnd = app.indexOf('      if (!disposed)', runtimeStart);
    expect(runtimeEnd).toBeGreaterThan(runtimeStart);
    const runtimeBinding = app.slice(runtimeStart, runtimeEnd);

    expect(runtimeStart).toBeGreaterThan(-1);
    expect(app).toContain(
      'const privateReadsEnabled = browserRuntimeDependenciesRef.current.hasAesReady;'
    );
    expect(runtimeBinding).toMatch(
      /getOwnerCapability:\s*privateReadsEnabled\s*\?[\s\S]*?:\s*undefined/u
    );
    expect(runtimeBinding).toMatch(
      /assertCurrent:\s*\(\)\s*=>\s*dependencies\.assertBrowserWalletSignerLeaseSnapshotCurrent\(lease\)/u
    );
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

  it('captures the Direct Trade owner lease only when an explicit capability is requested', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');
    const runtimeStart = app.indexOf('createDirectTradeV2Runtime({');
    const runtimeSetup = app.slice(runtimeStart, runtimeStart + 2_500);

    expect(runtimeStart).toBeGreaterThan(-1);
    expect(runtimeSetup).toMatch(
      /getOwnerCapability:\s*\(requirePrivacy\)\s*=>\s*\{\s*const dependencies = browserRuntimeDependenciesRef\.current;\s*const lease = dependencies\.captureBrowserWalletSignerLease\(\)/u
    );
    expect(runtimeSetup).toContain('expectedOwnerAddress: ownerAddress');
    expect(runtimeSetup.match(/captureBrowserWalletSignerLease\(\)/gu)).toHaveLength(1);
  });

  it('does not initialize or synchronize Group Chat V2 before privacy is ready', () => {
    const app = readFileSync(join(SRC_ROOT, 'App.tsx'), 'utf8');

    expect(app).toMatch(
      /const groupChatV2RuntimeScopeKey = useMemo\([\s\S]*?GROUP_CHAT_V2_DEPLOYMENT_CONFIG\.status === 'active' && hasAesReady[\s\S]*?buildBrowserWalletRuntimeScopeKey[\s\S]*?if \(GROUP_CHAT_V2_DEPLOYMENT_CONFIG\.status !== 'active' \|\| !groupChatV2RuntimeScopeKey\)[\s\S]*?createGroupChatV2Runtime/u
    );
    expect(app).toMatch(
      /const runtime = groupChatV2Runtime;\s*if \(!runtime\?\.enabled \|\| !hasAesReady\) return;\s*let disposed = false;[\s\S]*?runtime\.discovery\.sync\(\)/u
    );
    expect(app).toMatch(
      /useGroupChatV2History\(\{\s*runtime: groupChatV2Runtime,\s*activeGroupId,\s*activeGroupIdRef,\s*hasAesReady,[\s\S]*?setEpochSyncRequest: setGroupChatV2EpochSyncRequest/u
    );
    const groupHistory = readFileSync(join(SRC_ROOT, 'features/groups/hooks/useGroupChatV2History.ts'), 'utf8');
    expect(groupHistory).toMatch(
      /const selectedGroupId = activeGroupId;\s*if \(!runtime\?\.enabled \|\| !hasAesReady \|\| selectedGroupId === null\) \{\s*setEpochSyncRequest\(null\);\s*return;\s*\}[\s\S]*?runtime\.history\.sync/u
    );
    expect(groupHistory).toMatch(/const isCurrent = \(\) =>[\s\S]*?view\.current\.hasAesReady/u);
    expect(groupHistory).toMatch(/if \(!isCurrent\(\)\) return;\s*const result = await runtime\.history\.sync/u);
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
      /const discoverKnownConversations = async \(\) => \{[\s\S]*?!ownerAesReady[\s\S]*?runtime\.session\.listConversations\(beforeIndexExclusive, 32n\)[\s\S]*?mergeUniqueContacts\(previous, peers\)[\s\S]*?rememberIncomingPeer\(peer, false\)/u
    );
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
    for (const trade of [directTrade, standardTrade, privateTrade, recurringTrade, privateRecurringTrade]) {
      expect(trade).toMatch(
        /binding\.readProvider\s*\?[\s\S]*?waitForOwnerTradeV2Receipt\(binding, hash\)/u
      );
    }
    expect(privateLiquidity).toMatch(
      /wait: binding\?\.readProvider[\s\S]*?waitForPublicTransactionReceipt\(\{[\s\S]*?readProvider: binding\.readProvider/u
    );
    expect(privateLiquidity).toMatch(
      /transactionEnvelope\(rawTransaction, \{[\s\S]*?\}, 'Private-liquidity swap', binding\)/u
    );
    expect(tokenSwapActions).not.toMatch(/transaction\.wait\(/u);
    expect(tokenSwapActions).toMatch(/waitForPublicTransactionReceipt\(\{[\s\S]*?transactionHash,[\s\S]*?timeoutMs: 180_000/u);
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
