import { describe, expect, it } from 'vitest';
import {
  applyPartyTradeTermsToSnapshot,
  buildPartyTradeTerms,
  createTradeAccessSecret,
  decryptPartyTradeTerms,
  encryptPartyTradeTerms
} from './partyTradeTerms';
import type { TradeSnapshot } from './appShared';

describe('partyTradeTerms', () => {
  it('encrypts and decrypts party-visible trade terms with the private link secret', async () => {
    const accessSecret = createTradeAccessSecret();
    const terms = buildPartyTradeTerms({
      maker: '0x1111111111111111111111111111111111111111',
      taker: '0x2222222222222222222222222222222222222222',
      offer: { kind: 'private-erc20', tokenAddress: '0x3333333333333333333333333333333333333333', amount: '1000' },
      request: { kind: 'native', amount: '2500' },
      expiresAt: 123,
      parentEscrowContract: '0x4444444444444444444444444444444444444444',
      parentTradeId: 7
    });

    const encrypted = await encryptPartyTradeTerms(terms, accessSecret);
    expect(encrypted).toMatch(/^0x[0-9a-f]+$/);

    await expect(decryptPartyTradeTerms(encrypted, createTradeAccessSecret())).rejects.toThrow();
    await expect(decryptPartyTradeTerms(encrypted, accessSecret)).resolves.toEqual(terms);
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
      hiddenLiquidity: true
    } satisfies TradeSnapshot;
    const terms = buildPartyTradeTerms({
      maker: snapshot.maker,
      taker: snapshot.taker,
      offer: { kind: 'private-erc20', tokenAddress: snapshot.offer.tokenAddress, amount: '123' },
      request: { kind: 'native', amount: '456' },
      expiresAt: snapshot.expiresAt
    });

    const hydrated = applyPartyTradeTermsToSnapshot(snapshot, terms);
    expect(hydrated.offer.amount).toBe('123');
    expect(hydrated.request.amount).toBe('456');
    expect(hydrated.hiddenLiquidity).toBe(false);
  });
});
