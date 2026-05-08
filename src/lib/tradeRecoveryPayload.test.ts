import { describe, expect, it } from 'vitest';
import {
  applyTradeRecoveryPayloadToSnapshot,
  buildTradeRecoveryPayload,
  decryptTradeRecoveryPayload,
  encryptTradeRecoveryPayload
} from './tradeRecoveryPayload';
import { createTradeAccessSecret } from './directTradeTerms';
import type { TradeSnapshot } from './appShared';

describe('tradeRecoveryPayload', () => {
  it('stores private-link recovery data as maker-AES encrypted bytes', async () => {
    const accessSecret = createTradeAccessSecret();
    const payload = buildTradeRecoveryPayload({
      kind: 'direct',
      accessSecret,
      maker: '0x1111111111111111111111111111111111111111',
      taker: '0x2222222222222222222222222222222222222222',
      offer: { kind: 'erc20', tokenAddress: '0x3333333333333333333333333333333333333333', amount: '1000' },
      request: { kind: 'native', amount: '2500' },
      expiresAt: 123
    });

    const encrypted = await encryptTradeRecoveryPayload(payload, 'maker-aes-key');
    expect(encrypted).toMatch(/^0x[0-9a-f]+$/);
    await expect(decryptTradeRecoveryPayload(encrypted, 'wrong-aes-key')).rejects.toThrow();
    await expect(decryptTradeRecoveryPayload(encrypted, 'maker-aes-key')).resolves.toEqual(payload);
  });

  it('hydrates Direct exact terms for maker views after recovery', () => {
    const snapshot = {
      tradeId: 1,
      maker: '0x1111111111111111111111111111111111111111',
      taker: '0x2222222222222222222222222222222222222222',
      offer: { kind: 'erc20', tokenAddress: '0x3333333333333333333333333333333333333333', symbol: 'TOK', decimals: 6, amount: '0' },
      request: { kind: 'native', symbol: 'COTI', decimals: 18, amount: '0' },
      createdAt: 1,
      expiresAt: 2,
      status: 'open',
      hiddenLiquidity: true
    } satisfies TradeSnapshot;
    const payload = buildTradeRecoveryPayload({
      kind: 'direct',
      accessSecret: createTradeAccessSecret(),
      maker: snapshot.maker,
      taker: snapshot.taker,
      offer: { kind: 'erc20', tokenAddress: snapshot.offer.tokenAddress, amount: '123' },
      request: { kind: 'native', amount: '456' },
      expiresAt: snapshot.expiresAt
    });

    const hydrated = applyTradeRecoveryPayloadToSnapshot(snapshot, payload);
    expect(hydrated.offer.amount).toBe('123');
    expect(hydrated.request.amount).toBe('456');
    expect(hydrated.hiddenLiquidity).toBe(false);
  });
});
