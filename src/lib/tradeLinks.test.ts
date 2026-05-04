import { describe, expect, it } from 'vitest';
import {
  decodeTradeLink,
  doesAccessSecretMatchHash,
  encodeTradeLink,
  normalizeAccessHash,
  PRIVATE_LINK_SECRET_MISMATCH_MESSAGE
} from './tradeLinks';

const secret = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('trade links', () => {
  it('round-trips compact public links', () => {
    const code = encodeTradeLink(22);

    expect(code.length).toBeLessThan(11);
    expect(decodeTradeLink(code)).toEqual({ tradeId: 22, accessSecret: undefined });
  });

  it('round-trips compact private links', () => {
    const code = encodeTradeLink(22, secret);

    expect(code.length).toBeLessThan(54);
    expect(decodeTradeLink(code)).toEqual({ tradeId: 22, accessSecret: secret });
  });

  it('decodes previous fixed-width links', () => {
    expect(decodeTradeLink('VQEAAAAAABYBI0VniavN7wEjRWeJq83vASNFZ4mrze8BI0VniavN7w')).toEqual({
      tradeId: 22,
      accessSecret: secret
    });
  });

  it('normalizes and validates private-link access hashes before a fill can use them', () => {
    const accessHash = `0x${'ab'.repeat(32)}`;
    const wrongHash = `0x${'cd'.repeat(32)}`;
    const hashAccessSecret = (candidate: string) => (candidate === secret ? accessHash.toUpperCase() : wrongHash);

    expect(normalizeAccessHash(accessHash.toUpperCase())).toBe(accessHash);
    expect(doesAccessSecretMatchHash(secret, accessHash, hashAccessSecret)).toBe(true);
    expect(doesAccessSecretMatchHash(`0x${'99'.repeat(32)}`, accessHash, hashAccessSecret)).toBe(false);
    expect(PRIVATE_LINK_SECRET_MISMATCH_MESSAGE).toContain('full Share link');
  });
});
