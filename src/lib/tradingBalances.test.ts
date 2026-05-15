import { describe, expect, it } from 'vitest';
import {
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS
} from './appShared';
import {
  HOTDOG_PRIVATE_TOKEN_ADDRESS,
  VERIFIED_ECOSYSTEM_TOKENS,
  buildTradeCustomTokenInfoKey,
  type TradeCustomTokenInfo
} from './appHelpers';
import { buildVisibleTradingBalanceItems } from './tradingBalances';

const walletKey = '0x1234567890abcdef1234567890abcdef12345678';
const tokenUnits = (amount: bigint, decimals = 6): bigint => amount * 10n ** BigInt(decimals);

const buildCustomTokenInfo = (
  token: { address: string; kind: 'erc20' | 'private-erc20'; symbol: string },
  overrides: Partial<TradeCustomTokenInfo>
): TradeCustomTokenInfo => ({
  address: token.address,
  kind: token.kind,
  symbol: token.symbol,
  decimals: 6,
  balanceWei: null,
  loading: false,
  walletKey,
  ...overrides
});

describe('trading balance display model', () => {
  it('shows only loaded non-zero allowed balances', () => {
    const publicToken = VERIFIED_ECOSYSTEM_TOKENS.find((token) => token.symbol === 'gCOTI');
    const privateToken = VERIFIED_ECOSYSTEM_TOKENS.find(
      (token) => token.address.toLowerCase() === HOTDOG_PRIVATE_TOKEN_ADDRESS.toLowerCase()
    );
    expect(publicToken).toBeDefined();
    expect(privateToken).toBeDefined();

    const items = buildVisibleTradingBalanceItems({
      customTradeTokenInfoByAddress: {
        [buildTradeCustomTokenInfoKey(publicToken!.kind, publicToken!.address)]: buildCustomTokenInfo(publicToken!, {
          balanceWei: 0n
        }),
        [buildTradeCustomTokenInfoKey(privateToken!.kind, privateToken!.address)]: buildCustomTokenInfo(privateToken!, {
          balanceWei: tokenUnits(42n),
          loading: true,
          privateBalanceState: { status: 'ready', balanceWei: tokenUnits(42n) }
        })
      },
      nativeBalanceWei: 0n,
      privateRewardTokenBalanceState: { status: 'locked' },
      privateRewardTokenDecimals: 6,
      privateRewardTokenSymbol: 'pWISP',
      rewardTokenBalanceWei: tokenUnits(25n),
      rewardTokenDecimals: 6,
      rewardTokenSymbol: 'WISP',
      walletKey
    });

    expect(items.map((item) => item.symbol)).toEqual(['WISP', 'HOTDOG']);
    expect(items.find((item) => item.address === REWARD_TOKEN_ADDRESS)?.amountLabel).toBe('25');
    expect(items.find((item) => item.address === PRIVATE_REWARD_TOKEN_ADDRESS)).toBeUndefined();
  });

  it('formats balances with two decimals and groups large whole numbers', () => {
    const publicToken = VERIFIED_ECOSYSTEM_TOKENS.find((token) => token.symbol === 'Pengo');
    expect(publicToken).toBeDefined();

    const items = buildVisibleTradingBalanceItems({
      customTradeTokenInfoByAddress: {
        [buildTradeCustomTokenInfoKey(publicToken!.kind, publicToken!.address)]: buildCustomTokenInfo(publicToken!, {
          balanceWei: 957_570_123_456n
        })
      },
      nativeBalanceWei: 1_500n * 10n ** 18n,
      privateRewardTokenBalanceState: { status: 'ready', balanceWei: 12_345_678n },
      privateRewardTokenDecimals: 6,
      privateRewardTokenSymbol: 'pWISP',
      rewardTokenBalanceWei: 1n,
      rewardTokenDecimals: 6,
      rewardTokenSymbol: 'WISP',
      walletKey
    });

    expect(items.find((item) => item.symbol === 'COTI')?.amountLabel).toBe('1,500');
    expect(items.find((item) => item.symbol === 'Pengo')?.amountLabel).toBe('957,570');
    expect(items.find((item) => item.symbol === 'pWISP')?.amountLabel).toBe('12.34');
    expect(items.find((item) => item.symbol === 'WISP')?.amountLabel).toBe('<0.01');
  });
});
