import { describe, expect, it } from 'vitest';
import { decodeTradeLink, encodeTradeLink } from './tradeLinks';

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
});
