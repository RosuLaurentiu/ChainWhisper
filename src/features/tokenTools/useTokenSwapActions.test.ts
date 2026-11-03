import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useTokenSwapActions from './useTokenSwapActions';
import { useTokenToolsStore } from './tokenToolsStore';
import type { SwapDirection } from '../../lib/appShared';

const execute = vi.hoisted(() => vi.fn());
vi.mock('../../lib/appChain', () => ({ executeChainWhisperWispBridgeConversion: execute }));

const owner = `0x${'11'.repeat(20)}`;
const hash = `0x${'22'.repeat(32)}`;
const create = (direction: SwapDirection = 'shield', balance: bigint | null = 2_000000n) => {
  const setError = vi.fn(), getSwapSigner = vi.fn(async () => ({ cacheKey: owner,
    signer: { getUserOnboardInfo: () => ({}) } as never }));
  let actions!: ReturnType<typeof useTokenSwapActions>;
  function Harness() {
    actions = useTokenSwapActions({ activeSwapVaultContractAddress: `0x${'33'.repeat(20)}`,
      currentSwapDirectionEnabled: true, getSwapSigner, onCotiNetwork: true,
      runSwapTransactionFlow: async operation => operation(), setError, setSessionOnboardInfo: vi.fn(),
      setWalletBalanceRefreshNonce: vi.fn(), shieldVaultTokenBalanceWei: 3_000000n,
      swapAmountInput: '1', swapDirection: direction, swapInputDecimals: 6, swapInputSymbol: direction === 'shield' ? 'WISP' : 'pWISP',
      swapPrivateRewardTokenBalanceWei: balance, swapPrivateRewardTokenDecimals: 6,
      swapPrivateRewardTokenSymbol: 'pWISP', walletAddress: owner });
    return null;
  }
  renderToString(createElement(Harness));
  return { actions, setError, getSwapSigner };
};

describe('current WISP conversion actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTokenToolsStore.setState({ swapStatusMessage: '', swapTransactionHash: '', swapActionStage: null, swappingTokens: false });
    execute.mockResolvedValue({ quote: { feeWei: 1n }, transactionHash: hash });
  });
  it.each(['shield', 'unshield'] as const)('uses the current bridge for %s and retains its confirmed result', async direction => {
    const { actions, getSwapSigner } = create(direction);
    await actions.swapRewardTokens();
    expect(execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ownerAddress: owner, direction, amountWei: 1_000000n }));
    expect(getSwapSigner).toHaveBeenCalledOnce();
    expect(useTokenToolsStore.getState()).toMatchObject({ swapTransactionHash: hash, swapFeeWei: 1n, swappingTokens: false });
  });
  it('rejects an obsolete direction before acquiring the signer', async () => {
    const { actions, getSwapSigner, setError } = create('legacy-unshield' as SwapDirection);
    await actions.swapRewardTokens();
    expect(getSwapSigner).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith('The selected WISP conversion direction is unavailable.');
  });
  it.each([null, 500000n])('keeps unshield unavailable when the current private balance is %s', async balance => {
    const { actions, getSwapSigner } = create('unshield', balance);
    await actions.swapRewardTokens();
    expect(getSwapSigner).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it('does not retry or select an old vault after a current bridge failure', async () => {
    execute.mockRejectedValue(new Error('Current conversion unavailable'));
    const { actions, getSwapSigner, setError } = create();
    await actions.swapRewardTokens();
    expect(execute).toHaveBeenCalledOnce(); expect(getSwapSigner).toHaveBeenCalledOnce();
    expect(setError.mock.lastCall?.[0]).toContain('Current conversion unavailable');
    expect(useTokenToolsStore.getState()).toMatchObject({ swappingTokens: false, swapStatusMessage: '' });
  });
});
