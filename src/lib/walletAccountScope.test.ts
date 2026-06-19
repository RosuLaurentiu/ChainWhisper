import { describe, expect, it } from 'vitest';
import {
  buildWalletAccountScope,
  buildWalletReadAccountsKey,
  getTradeAccountPerspectiveAddress,
  resolveTradeActionWalletAddress
} from './walletAccountScope';
import type { TradeSnapshot } from './appShared';

const owner = '0x1111111111111111111111111111111111111111';
const chainwhisper = '0x2222222222222222222222222222222222222222';
const maker = '0x3333333333333333333333333333333333333333';
const taker = '0x4444444444444444444444444444444444444444';

const trade = (overrides: Partial<TradeSnapshot> = {}): TradeSnapshot =>
  ({
    tradeId: 1,
    maker,
    taker,
    offer: { token: '0x0000000000000000000000000000000000000001', symbol: 'A', amount: '1', decimals: 18 },
    request: { token: '0x0000000000000000000000000000000000000002', symbol: 'B', amount: '1', decimals: 18 },
    createdAt: 1,
    expiresAt: 2,
    status: 'open',
    ...overrides
  }) as TradeSnapshot;

describe('buildWalletAccountScope', () => {
  it('resolves one ChainWhisper action account and one owner read account', () => {
    const scope = buildWalletAccountScope({
      actionAddress: chainwhisper,
      actionAesReady: true,
      ownerAddress: owner,
      ownerAesReady: false
    });

    expect(scope.actionAccount?.address).toBe(chainwhisper);
    expect(scope.ownerAccount?.address).toBe(owner);
    expect(scope.readAccounts.map((account) => [account.role, account.canReadPrivate])).toEqual([
      ['chainwhisper', true],
      ['owner', false]
    ]);
  });

  it('dedupes identical owner and action addresses', () => {
    const scope = buildWalletAccountScope({
      actionAddress: owner,
      actionAesReady: false,
      ownerAddress: owner,
      ownerAesReady: true
    });

    expect(scope.readAccounts).toHaveLength(1);
    expect(scope.readAccounts[0]).toMatchObject({
      address: owner,
      canReadPrivate: true,
      isActionAccount: true,
      role: 'chainwhisper'
    });
  });
});

describe('buildWalletReadAccountsKey', () => {
  it('builds stable keys with optional privacy state', () => {
    const scope = buildWalletAccountScope({
      actionAddress: chainwhisper,
      actionAesReady: true,
      ownerAddress: owner,
      ownerAesReady: false
    });

    expect(buildWalletReadAccountsKey(scope.readAccounts)).toBe(`chainwhisper:${chainwhisper}|owner:${owner}`);
    expect(buildWalletReadAccountsKey(scope.readAccounts, { includePrivateReadState: true })).toBe(
      `chainwhisper:${chainwhisper}:r|owner:${owner}:l`
    );
  });
});

describe('getTradeAccountPerspectiveAddress', () => {
  it('prefers ChainWhisper perspective when both accounts match', () => {
    const scope = buildWalletAccountScope({
      actionAddress: chainwhisper,
      actionAesReady: true,
      ownerAddress: owner,
      ownerAesReady: true
    });

    expect(getTradeAccountPerspectiveAddress(trade({ maker: chainwhisper, taker: owner }), scope)).toBe(chainwhisper);
  });

  it('uses owner perspective for owner-only trades', () => {
    const scope = buildWalletAccountScope({
      actionAddress: chainwhisper,
      actionAesReady: true,
      ownerAddress: owner,
      ownerAesReady: true
    });

    expect(getTradeAccountPerspectiveAddress(trade({ maker, taker: owner, accountAddress: owner, accountRole: 'owner' }), scope)).toBe(
      owner
    );
  });
});

describe('resolveTradeActionWalletAddress', () => {
  it('keeps fill and new action flows on the ChainWhisper account', () => {
    const scope = buildWalletAccountScope({
      actionAddress: chainwhisper,
      actionAesReady: true,
      ownerAddress: owner,
      ownerAesReady: true
    });

    expect(
      resolveTradeActionWalletAddress({
        action: 'fill',
        fallbackAddress: chainwhisper,
        readAccounts: scope.readAccounts,
        trade: trade({ maker, taker: owner, accountAddress: owner, accountRole: 'owner' })
      })
    ).toBe(chainwhisper);
  });

  it('uses the owner wallet only for existing owner-targeted reactionary actions', () => {
    const scope = buildWalletAccountScope({
      actionAddress: chainwhisper,
      actionAesReady: true,
      ownerAddress: owner,
      ownerAesReady: true
    });

    expect(
      resolveTradeActionWalletAddress({
        action: 'accept',
        fallbackAddress: chainwhisper,
        readAccounts: scope.readAccounts,
        trade: trade({ maker, taker: owner, accountAddress: owner, accountRole: 'owner' })
      })
    ).toBe(owner);
  });

  it('prefers the ChainWhisper account when both accounts match the trade', () => {
    const scope = buildWalletAccountScope({
      actionAddress: chainwhisper,
      actionAesReady: true,
      ownerAddress: owner,
      ownerAesReady: true
    });

    expect(
      resolveTradeActionWalletAddress({
        action: 'cancel',
        fallbackAddress: chainwhisper,
        readAccounts: scope.readAccounts,
        trade: trade({ maker: chainwhisper, taker: owner, accountAddress: owner, accountRole: 'owner' })
      })
    ).toBe(chainwhisper);
  });
});
