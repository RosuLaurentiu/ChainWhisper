import { describe, expect, it } from 'vitest';
import {
  applyDirectTradeTermsToSnapshot,
  applyPrivateLinkTradeTermsToSnapshot,
  buildDirectTradeTerms,
  createTradeAccessSecret,
  decryptDirectTradeTerms,
  encryptDirectTradeTerms
} from './directTradeTerms';
import type { TradeSnapshot } from './appShared';

describe('directTradeTerms', () => {
  it('encrypts and decrypts direct-visible trade terms with the private link secret', async () => {
    const accessSecret = createTradeAccessSecret();
    const terms = buildDirectTradeTerms({
      maker: '0x1111111111111111111111111111111111111111',
      taker: '0x2222222222222222222222222222222222222222',
      offer: { kind: 'private-erc20', tokenAddress: '0x3333333333333333333333333333333333333333', amount: '1000' },
      request: { kind: 'native', amount: '2500' },
      expiresAt: 123,
      parentEscrowContract: '0x4444444444444444444444444444444444444444',
      parentTradeId: 7
    });

    const encrypted = await encryptDirectTradeTerms(terms, accessSecret);
    expect(encrypted).toMatch(/^0x[0-9a-f]+$/);

    await expect(decryptDirectTradeTerms(encrypted, createTradeAccessSecret())).rejects.toThrow();
    await expect(decryptDirectTradeTerms(encrypted, accessSecret)).resolves.toEqual(terms);
  });

  it('hydrates exact amounts only after terms are decrypted', () => {
    const snapshot = {
      tradeId: 1,
      maker: '0x1111111111111111111111111111111111111111',
      taker: '0x2222222222222222222222222222222222222222',
      offer: { kind: 'private-erc20', tokenAddress: '0x3333333333333333333333333333333333333333', symbol: 'pTOK', decimals: 6, amount: '0' },
      request: { kind: 'native', symbol: 'COTI', decimals: 18, amount: '0' },
      createdAt: 1,
      expiresAt: 2,
      status: 'open',
      fillState: {
        remainingOfferAmount: '0',
        remainingRequestAmount: '0',
        filledOfferAmount: '0',
        filledRequestAmount: '0'
      },
      hiddenLiquidity: true
    } satisfies TradeSnapshot;
    const terms = buildDirectTradeTerms({
      maker: snapshot.maker,
      taker: snapshot.taker,
      offer: { kind: 'private-erc20', tokenAddress: snapshot.offer.tokenAddress, amount: '123' },
      request: { kind: 'native', amount: '456' },
      expiresAt: snapshot.expiresAt
    });

    const hydrated = applyDirectTradeTermsToSnapshot(snapshot, terms);
    expect(hydrated.offer.amount).toBe('123');
    expect(hydrated.request.amount).toBe('456');
    expect(hydrated.fillState?.remainingOfferAmount).toBe('123');
    expect(hydrated.fillState?.remainingRequestAmount).toBe('456');
    expect(hydrated.hiddenLiquidity).toBe(false);
  });

  it('hydrates private-link hidden order terms without changing the hidden-liquidity settlement path', () => {
    const snapshot = {
      tradeId: 7,
      maker: '0x1111111111111111111111111111111111111111',
      taker: '0x0000000000000000000000000000000000000000',
      offer: { kind: 'private-erc20', tokenAddress: '0x3333333333333333333333333333333333333333', symbol: 'pTOK', decimals: 6, amount: '0' },
      request: { kind: 'private-erc20', tokenAddress: '0x4444444444444444444444444444444444444444', symbol: 'pUSD', decimals: 6, amount: '0' },
      createdAt: 1,
      expiresAt: 2,
      status: 'open',
      hiddenLiquidity: true
    } satisfies TradeSnapshot;
    const terms = buildDirectTradeTerms({
      maker: snapshot.maker,
      taker: snapshot.taker,
      offer: { kind: 'private-erc20', tokenAddress: snapshot.offer.tokenAddress, amount: '1000000' },
      request: { kind: 'private-erc20', tokenAddress: snapshot.request.tokenAddress, amount: '2500000' },
      expiresAt: snapshot.expiresAt
    });

    const hydrated = applyPrivateLinkTradeTermsToSnapshot(snapshot, terms);

    expect(hydrated.offer.amount).toBe('1000000');
    expect(hydrated.request.amount).toBe('2500000');
    expect(hydrated.hiddenLiquidity).toBe(true);
  });
});
