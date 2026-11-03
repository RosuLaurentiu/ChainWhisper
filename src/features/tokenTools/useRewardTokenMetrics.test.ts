import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  cleanups: [] as Array<void | (() => void)>,
  setters: {} as Record<string, ReturnType<typeof vi.fn>>,
  activeCalls: 0,
  contracts: [] as string[],
  methods: [] as string[],
  calls: [] as Array<{ method: string; args: unknown[] }>,
  holdMethod: null as { name: string; wait: Promise<void> } | null,
  privateRead: vi.fn(),
  legacyRead: vi.fn(),
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
  readCurrentPrivateErc20BalanceWei: harness.privateRead,
  readLegacyPrivateRewardBalanceWei: harness.legacyRead
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
    get: (_target, method: string) => async (...args: unknown[]) => {
      harness.methods.push(method);
      harness.calls.push({ method, args });
      harness.activeCalls += 1;
      harness.peakCalls = Math.max(harness.peakCalls, harness.activeCalls);
      if (harness.holdMethod?.name === method) await harness.holdMethod.wait;
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
    loadCotiEthersModule: async () => ({ Contract: class { constructor(address: string) { harness.contracts.push(address); return methods; } } }),
    loadCotiReadProvider: async () => ({}),
    mergeOnboardInfoByAddress: vi.fn(), normalizeTokenDecimals: (value: number) => value
  };
});

const flushEffects = async () => {
  harness.cleanups.push(...harness.effects.splice(0).map((effect) => effect()));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const metricsArgs = (bridgeEnabled: boolean) => ({
  activeSwapVaultContractAddress: '0x0000000000000000000000000000000000000022',
  bridgeEnabled, chainId: 1, currentSwapDirectionEnabled: true,
  getMemoSigner: async () => ({ cacheKey: 'owner', signer: { getUserOnboardInfo: () => ({}) } as never }),
  hasAesReady: true, refreshNonce: 0, setSessionOnboardInfo: vi.fn(), swapDirection: 'unshield' as const,
  walletAddress: '0x0000000000000000000000000000000000000033'
});

describe('useRewardTokenMetrics contract read concurrency', () => {
  beforeEach(() => {
    harness.effects = [];
    harness.cleanups = [];
    harness.setters = {};
    harness.results = {};
    harness.activeCalls = 0;
    harness.contracts = [];
    harness.methods = [];
    harness.calls = [];
    harness.holdMethod = null;
    harness.privateRead.mockReset().mockResolvedValue(7n);
    harness.legacyRead.mockClear();
    harness.peakCalls = 0;
  });
  afterEach(() => { harness.cleanups.forEach(cleanup => cleanup?.()); vi.resetModules(); });

  it('keeps shared balances and metadata off-route without a bridge contract, fee or reserve read', async () => {
    const { default: useRewardTokenMetrics } = await import('./useRewardTokenMetrics');
    useRewardTokenMetrics(metricsArgs(false)); await flushEffects();
    expect(harness.contracts).not.toContain('0x0000000000000000000000000000000000000022');
    expect(harness.methods).not.toContain('estimateWithdrawFee(uint256)');
    expect(harness.calls.some(call => call.method === 'balanceOf' &&
      call.args[0] === '0x0000000000000000000000000000000000000022')).toBe(false);
    expect(harness.methods.filter(method => method === 'symbol' || method === 'decimals')).toHaveLength(4);
    expect(harness.results).toMatchObject({ setRewardTokenBalanceWei: 101n,
      setPrivateRewardTokenBalanceWei: 7n, setRewardTokenSymbol: 'RWD',
      setSwapFeeWei: null, setShieldVaultTokenBalanceWei: null });
  });

  it('clears bridge state on route exit and rejects a late private balance and onboard result', async () => {
    const { default: useRewardTokenMetrics } = await import('./useRewardTokenMetrics');
    let release!: (value: bigint) => void;
    const held = new Promise<bigint>(resolve => { release = resolve; });
    harness.privateRead.mockReturnValueOnce(held).mockResolvedValue(17n);
    const first = metricsArgs(true);
    useRewardTokenMetrics(first); await flushEffects();
    expect(harness.privateRead).toHaveBeenCalledOnce();
    expect(harness.results.setShieldVaultTokenBalanceWei).toBe(101n);
    harness.cleanups.splice(0).forEach(cleanup => cleanup?.());
    const next = { ...first, bridgeEnabled: false };
    useRewardTokenMetrics(next); await flushEffects();
    expect(harness.results).toMatchObject({ setSwapFeeWei: null, setShieldVaultTokenBalanceWei: null,
      setPrivateRewardTokenBalanceWei: 17n });
    release(99n); await new Promise(resolve => setTimeout(resolve, 0));
    expect(harness.results.setPrivateRewardTokenBalanceWei).toBe(17n);
    expect(first.setSessionOnboardInfo).toHaveBeenCalledOnce();
  });

  it('does not request a reserve or publish a fee after a held bridge read finishes off-route', async () => {
    const { default: useRewardTokenMetrics } = await import('./useRewardTokenMetrics');
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    harness.holdMethod = { name: 'estimateWithdrawFee(uint256)', wait: held };
    useRewardTokenMetrics(metricsArgs(true)); await flushEffects();
    expect(harness.methods).toContain('estimateWithdrawFee(uint256)');
    harness.cleanups.splice(0).forEach(cleanup => cleanup?.());
    useRewardTokenMetrics(metricsArgs(false)); await flushEffects();
    release(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(harness.calls.some(call => call.method === 'balanceOf' &&
      call.args[0] === '0x0000000000000000000000000000000000000022')).toBe(false);
    expect(harness.results).toMatchObject({ setSwapFeeWei: null, setShieldVaultTokenBalanceWei: null,
      setRewardTokenBalanceWei: 101n, setPrivateRewardTokenBalanceWei: 7n });
  });

  it.each([[false, 1, false], [true, 2, false], [true, 2, true]] as const)(
    'loads representative metrics with swap direction enabled=%s, peak=%s, privacy ready=%s', async (enabled, expectedPeak, privacyReady) => {
      const { default: useRewardTokenMetrics } = await import('./useRewardTokenMetrics');
      useRewardTokenMetrics({
        activeSwapVaultContractAddress: '0x0000000000000000000000000000000000000022',
        bridgeEnabled: true,
        chainId: 1,
        currentSwapDirectionEnabled: enabled,
        getMemoSigner: async () => {
          if (!privacyReady) throw new Error('Locked fixture must not request a signer');
          return { cacheKey: 'owner', signer: { getUserOnboardInfo: () => ({}) } as never };
        },
        hasAesReady: privacyReady,
        refreshNonce: 0,
        setSessionOnboardInfo: vi.fn(),
        swapDirection: 'unshield',
        walletAddress: '0x0000000000000000000000000000000000000033'
      });

      await flushEffects();

      expect(harness.peakCalls).toBe(expectedPeak);
      expect(harness.results.setRewardTokenBalanceWei).toBe(101n);
      expect(harness.results.setRewardTokenSymbol).toBe('RWD');
      expect(harness.results.setRewardTokenDecimals).toBe(18);
      expect(harness.legacyRead).not.toHaveBeenCalled();
      expect(harness.contracts.every(address => ['0x0000000000000000000000000000000000000011', '0x0000000000000000000000000000000000000022'].includes(address))).toBe(true);
      for (const method of ['feeAmount', 'tokenFeeAmount', 'rewardsContract', 'rewardsPaused']) expect(harness.methods).not.toContain(method);
      expect(harness.results.setPrivateRewardTokenBalanceWei).toBe(privacyReady ? 7n : null);
      expect(harness.results.setSwapFeeWei).toBe(enabled ? 11n : null);
      expect(harness.results.setShieldVaultTokenBalanceWei).toBe(enabled ? 101n : null);
    }
  );
});
