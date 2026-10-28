import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  setters: {} as Record<string, ReturnType<typeof vi.fn>>,
  activeCalls: 0,
  peakCalls: 0,
  results: {} as Record<string, unknown>
}));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { harness.effects.push(effect); }
}));

vi.mock('./tokenToolsStore', () => ({
  useTokenToolsStore: () => Object.fromEntries([
    'setGroupRewardsContractAddress', 'setGroupRewardsPaused', 'setRewardsCallerAllowed',
    'setRewardsContractPaused', 'setRewardsPublicPerInteractionWei', 'setRewardsPublicReserveWei',
    'setShieldVaultTokenBalanceWei', 'setRewardTokenBalanceWei', 'setPrivateRewardTokenBalanceWei',
    'setRewardTokenSymbol', 'setPrivateRewardTokenSymbol', 'setRewardTokenDecimals',
    'setPrivateRewardTokenDecimals', 'setSwapFeeWei', 'setSwapTokenFeeAmount', 'setLoadingRewardBalances'
  ].map((name) => [name, harness.setters[name] ??= vi.fn((value: unknown) => { harness.results[name] = value; })]))
}));

vi.mock('../../lib/appChain', () => ({
  readCurrentPrivateErc20BalanceWei: vi.fn(),
  readLegacyPrivateRewardBalanceWei: vi.fn()
}));

vi.mock('../../lib/appShared', () => {
  const address = '0x0000000000000000000000000000000000000011';
  const methodResults: Record<string, unknown> = {
    balanceOf: 101n, symbol: 'RWD', decimals: 18, feeAmount: 7n, tokenFeeAmount: 8n,
    rewardsContract: address, rewardsPaused: false, paused: false,
    allowedInteractionContracts: true, publicRewardAmount: 9n,
    'estimateDepositFee(uint256)': [10n], 'estimateWithdrawFee(uint256)': [11n],
    swapFeeWei: 12n, getTokenFeeAmount: 13n, nativeCotiFee: 14n
  };
  const methods = new Proxy({}, {
    get: (_target, method: string) => async (..._args: unknown[]) => {
      harness.activeCalls += 1;
      harness.peakCalls = Math.max(harness.peakCalls, harness.activeCalls);
      await Promise.resolve();
      harness.activeCalls -= 1;
      return methodResults[method] ?? null;
    }
  });
  return {
    COTI_NETWORK: { chainIdDecimal: 1 },
    EARLIER_LEGACY_SWAP_VAULT_CONTRACT_ABI: [], LEGACY_GROUP_CHAT_CONTRACT_ABI: [],
    LEGACY_GROUP_CHAT_CONTRACT_ADDRESS: address, ERC20_TOKEN_ABI: [],
    FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL: 'PRIVATE', FALLBACK_REWARD_TOKEN_DECIMALS: 18,
    FALLBACK_REWARD_TOKEN_SYMBOL: 'REWARD', LEGACY_PRIVATE_REWARD_TOKEN_ADDRESS: address,
    LEGACY_SWAP_VAULT_CONTRACT_ABI: [], PRIVATE_ERC20_TOKEN_VNEXT_ABI: [],
    PRIVATE_REWARD_TOKEN_ADDRESS: address, PRIVATE_TOKEN_BALANCE_ABI: [], REWARD_TOKEN_ADDRESS: address,
    WISP_PRIVACY_BRIDGE_CONTRACT_ABI: [], WHISPER_REWARDS_ABI: [],
    isWalletAddress: (value: string) => /^0x[\da-f]{40}$/i.test(value),
    isLegacyUnshieldDirection: (direction: string) => direction.startsWith('legacy-unshield'),
    loadCotiEthersModule: async () => ({ Contract: class { constructor() { return methods; } } }),
    loadCotiReadProvider: async () => ({}),
    mergeOnboardInfoByAddress: vi.fn(), normalizeTokenDecimals: (value: number) => value
  };
});

const flushEffects = async () => {
  await Promise.all(harness.effects.map((effect) => effect()));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('useRewardTokenMetrics contract read concurrency', () => {
  beforeEach(() => {
    harness.effects = [];
    harness.setters = {};
    harness.results = {};
    harness.activeCalls = 0;
    harness.peakCalls = 0;
  });
  afterEach(() => vi.resetModules());

  it.each([[false, 1], [true, 2]] as const)(
    'loads representative metrics with swap direction enabled=%s and serial contract reads', async (enabled, expectedPeak) => {
      const { default: useRewardTokenMetrics } = await import('./useRewardTokenMetrics');
      useRewardTokenMetrics({
        activeSwapVaultContractAddress: '0x0000000000000000000000000000000000000022',
        chainId: 1,
        currentSwapDirectionEnabled: enabled,
        getMemoSigner: async () => { throw new Error('Locked fixture must not request a signer'); },
        groupRequiredFeeCacheRef: { current: null },
        groupTokenFeeCacheRef: { current: null },
        hasAesReady: false,
        refreshNonce: 0,
        setLegacyPrivateRewardTokenBalanceWei: vi.fn(),
        setLegacyPrivateRewardTokenDecimals: vi.fn(),
        setLegacyPrivateRewardTokenSymbol: vi.fn(),
        setSessionOnboardInfo: vi.fn(),
        swapDirection: 'unshield',
        walletAddress: '0x0000000000000000000000000000000000000033'
      });

      await flushEffects();

      expect(harness.peakCalls).toBe(expectedPeak);
      expect(harness.results.setRewardTokenBalanceWei).toBe(101n);
      expect(harness.results.setRewardTokenSymbol).toBe('RWD');
      expect(harness.results.setRewardTokenDecimals).toBe(18);
      expect(harness.results.setRewardsPublicPerInteractionWei).toBe(9n);
      expect(harness.results.setRewardsPublicReserveWei).toBe(101n);
      expect(harness.results.setSwapFeeWei).toBe(enabled ? 11n : null);
      expect(harness.results.setSwapTokenFeeAmount).toBe(enabled ? 0n : null);
      expect(harness.results.setShieldVaultTokenBalanceWei).toBe(enabled ? 101n : null);
    }
  );
});
