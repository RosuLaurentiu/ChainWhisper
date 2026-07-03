import { describe, expect, it } from 'vitest';
import {
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS
} from '../../lib/appShared';
import {
  HOTDOG_PRIVATE_TOKEN_ADDRESS,
  VERIFIED_ECOSYSTEM_TOKENS,
  buildTradeCustomTokenInfoKey,
  type TradeCustomTokenInfo
} from '../../lib/appHelpers';
import { buildAccountFundsAssets } from './accountFundsAssets';

const chainwhisperWallet = '0x1111111111111111111111111111111111111111';
const ownerWallet = '0x2222222222222222222222222222222222222222';

const buildCustomTokenInfo = (
  token: { address: string; kind: 'erc20' | 'private-erc20'; symbol: string },
  walletKey: string,
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

const verifiedTokenBySymbol = (symbol: string) => {
  const token = VERIFIED_ECOSYSTEM_TOKENS.find((candidate) => candidate.symbol === symbol);
  if (!token) {
    throw new Error(`Missing verified token fixture: ${symbol}`);
  }
  return token;
};

describe('account funds assets', () => {
  it('builds ordered owner and ChainWhisper funding assets', () => {
    const gcoti = verifiedTokenBySymbol('gCOTI');
    const hotdog = VERIFIED_ECOSYSTEM_TOKENS.find(
      (token) => token.address.toLowerCase() === HOTDOG_PRIVATE_TOKEN_ADDRESS.toLowerCase()
    );
    expect(hotdog).toBeDefined();

    const items = buildAccountFundsAssets({
      burnerAddress: chainwhisperWallet,
      burnerBalanceWei: 5n,
      chainwhisperCustomTokenInfoByAddress: {
        [buildTradeCustomTokenInfoKey(hotdog!.kind, hotdog!.address)]: buildCustomTokenInfo(
          hotdog!,
          chainwhisperWallet,
          {
            privateBalanceState: { status: 'ready', balanceWei: 42n }
          }
        )
      },
      chainwhisperHasAesReady: false,
      ownerAesReady: true,
      ownerCustomTokenInfoByAddress: {
        [buildTradeCustomTokenInfoKey(gcoti.kind, gcoti.address)]: buildCustomTokenInfo(gcoti, ownerWallet, {
          balanceWei: 7n
        })
      },
      ownerNativeBalanceWei: 9n,
      ownerPrivateRewardBalanceLocked: false,
      ownerPrivateRewardTokenBalanceWei: null,
      ownerRewardTokenBalanceWei: 11n,
      ownerWalletAddress: ownerWallet,
      privateRewardTokenBalanceWei: null,
      privateRewardTokenDecimals: 6,
      privateRewardTokenSymbol: 'pWISP',
      rewardTokenBalanceWei: 13n,
      rewardTokenDecimals: 6,
      rewardTokenSymbol: 'WISP',
      walletAddress: chainwhisperWallet
    });

    expect(items[0].id).toBe('native:coti');
    expect(items.find((item) => item.asset.tokenAddress === REWARD_TOKEN_ADDRESS)?.ownerBalanceWei).toBe(11n);
    expect(items.find((item) => item.asset.symbol === 'gCOTI')?.ownerBalanceWei).toBe(7n);
    expect(items.find((item) => item.asset.symbol === 'HOTDOG')?.chainwhisperBalanceWei).toBe(42n);
    expect(items.find((item) => item.asset.tokenAddress === PRIVATE_REWARD_TOKEN_ADDRESS)?.chainwhisperPrivacyRequired).toBe(true);
  });
});
