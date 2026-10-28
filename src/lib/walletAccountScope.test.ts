import type { OnboardInfo } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import { mergeOnboardInfoByAddress, type TradeSnapshot } from './appShared';
import {
  assertWalletReadSignerMatchesAccount,
  buildWalletAccountScope,
  buildWalletReadAccountsKey,
  getTradeAccountPerspectiveAddress,
  mergeWalletAccountMatches,
  resolveTradeActionWalletAddress,
  resolveWalletReadSignerRoute
} from './walletAccountScope';

const owner = '0x1111111111111111111111111111111111111111';
const staleLegacyAddress = '0x2222222222222222222222222222222222222222';
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

describe('mergeOnboardInfoByAddress', () => {
  it('returns the same state object when onboard info is unchanged', () => {
    const previous = {
      [owner]: {
        aesKey: 'aes',
        rsaKey: {
          privateKey: new Uint8Array([1, 2, 3]),
          publicKey: new Uint8Array([4, 5, 6])
        },
        txHash: '0xabc'
      } as OnboardInfo
    };

    const next = mergeOnboardInfoByAddress(previous, owner, {
      aesKey: 'aes',
      rsaKey: {
        privateKey: new Uint8Array([1, 2, 3]),
        publicKey: new Uint8Array([4, 5, 6])
      },
      txHash: '0xabc'
    } as OnboardInfo);

    expect(next).toBe(previous);
  });
});

describe('browser-wallet-only account scope', () => {
  it('uses one connected browser wallet for actions, reads, and ownership', () => {
    const scope = buildWalletAccountScope({
      ownerAddress: owner,
      ownerAesReady: true
    });

    expect(scope.actionAccount).toBe(scope.ownerAccount);
    expect(scope.readAccounts).toEqual([
      expect.objectContaining({
        address: owner,
        key: owner.toLowerCase(),
        label: 'Connected wallet',
        role: 'owner',
        canReadPrivate: true,
        isActionAccount: true
      })
    ]);
  });

  it('uses only the browser wallet privacy state', () => {
    const scope = buildWalletAccountScope({
      ownerAddress: owner,
      ownerAesReady: false
    });

    expect(scope.actionAccount?.address).toBe(owner);
    expect(scope.actionAccount?.canReadPrivate).toBe(false);
    expect(scope.readAccounts).toHaveLength(1);
  });

  it('returns an empty scope when no browser wallet is connected', () => {
    const scope = buildWalletAccountScope({
      ownerAddress: '',
      ownerAesReady: false
    });

    expect(scope.actionAccount).toBeNull();
    expect(scope.ownerAccount).toBeNull();
    expect(scope.readAccounts).toEqual([]);
  });

  it('builds one stable owner key with optional privacy state', () => {
    const scope = buildWalletAccountScope({
      ownerAddress: owner,
      ownerAesReady: true
    });

    expect(buildWalletReadAccountsKey(scope.readAccounts)).toBe(`owner:${owner}`);
    expect(buildWalletReadAccountsKey(scope.readAccounts, { includePrivateReadState: true })).toBe(`owner:${owner}:r`);
  });
});

describe('browser-wallet signer routing', () => {
  it('routes the exact connected wallet to the owner signer', () => {
    const scope = buildWalletAccountScope({
      ownerAddress: owner,
      ownerAesReady: true
    });

    expect(resolveWalletReadSignerRoute({
      account: scope.actionAccount!,
      ownerAddress: owner
    })).toBe('owner');
    expect(() => assertWalletReadSignerMatchesAccount(scope.actionAccount!, owner)).not.toThrow();
  });

  it('fails closed for malformed, unknown, or changed signer accounts', () => {
    const account = buildWalletAccountScope({
      ownerAddress: owner,
      ownerAesReady: true
    }).actionAccount!;

    expect(() => resolveWalletReadSignerRoute({
      account: { ...account, key: staleLegacyAddress },
      ownerAddress: owner
    })).toThrow('malformed');
    expect(() => resolveWalletReadSignerRoute({
      account: { ...account, address: maker, key: maker },
      ownerAddress: owner
    })).toThrow('read scope changed');
    expect(() => assertWalletReadSignerMatchesAccount(account, staleLegacyAddress)).toThrow('signer changed');
  });
});

describe('browser-wallet action selection', () => {
  const scope = buildWalletAccountScope({
    ownerAddress: owner,
    ownerAesReady: true
  });

  it('uses the connected wallet for every trade action and perspective', () => {
    const snapshot = trade({ maker: staleLegacyAddress, taker: owner, accountAddress: staleLegacyAddress, accountRole: 'owner' });
    expect(getTradeAccountPerspectiveAddress(snapshot, scope)).toBe(owner);
    for (const action of ['accept', 'cancel', 'decline', 'fill'] as const) {
      expect(resolveTradeActionWalletAddress({
        action,
        fallbackAddress: owner,
        readAccounts: scope.readAccounts,
        trade: snapshot
      })).toBe(owner);
    }
  });

  it('keeps only owner-wallet matches when merging trade snapshots', () => {
    const merged = mergeWalletAccountMatches(
      trade({ accountMatches: [{ address: owner, role: 'owner' }] }),
      trade({
        accountAddress: taker,
        accountRole: 'owner',
        accountMatches: [
          { address: owner, role: 'owner' },
          { address: staleLegacyAddress, role: 'owner' }
        ]
      })
    );

    expect(merged.accountMatches).toEqual([
      { address: owner, role: 'owner' },
      { address: staleLegacyAddress, role: 'owner' },
      { address: taker, role: 'owner' }
    ]);
  });
});
