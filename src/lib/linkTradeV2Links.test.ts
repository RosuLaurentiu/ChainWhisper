import { describe, expect, it } from 'vitest';
import { buildLinkTradeV2Path, parseLinkTradeV2Path, stripLinkTradeV2Secret } from './linkTradeV2Links';
import { encodeBase64UrlBytes, TEXT_ENCODER } from './byteEncoding';

const secret = `0x${'ab'.repeat(32)}`;
const reference = { chainId: '7082400', escrow: `0x${'11'.repeat(20)}`,
  id: ((1n << 256n) - 1n).toString(), revision: '9007199254740993', credentialEpoch: '1' };

describe('Link V2 URL boundary', () => {
  it('keeps the complete exact reference in the path and the credential only in the fragment', () => {
    const path = buildLinkTradeV2Path(reference, secret), url = new URL(path, 'https://chainwhisper.example');
    expect(url.pathname).toMatch(/^\/otc\/order\/link\/lv2\./);
    expect(url.pathname + url.search).not.toContain(secret);
    expect(url.hash).toBe(`#secret=${secret}`);
    expect(parseLinkTradeV2Path(path)).toEqual({ reference, secret, publicPath: url.pathname });
    expect(stripLinkTradeV2Secret(path)).toBe(url.pathname);
  });
  it('allows a public reference without a credential but never invents one', () => {
    const path = buildLinkTradeV2Path(reference);
    expect(parseLinkTradeV2Path(path)?.secret).toBe('');
    expect(stripLinkTradeV2Secret(path)).toBe(path);
  });
  it('rejects query credentials, duplicate fragments and malformed credential material', () => {
    const path = buildLinkTradeV2Path(reference);
    for (const suffix of [`?secret=${secret}`, `?p=${secret}#secret=${secret}`,
      `#secret=${secret}&secret=${secret}`, '#secret=password', `#secret=0x${'00'.repeat(32)}`]) {
      expect(() => parseLinkTradeV2Path(path + suffix)).toThrow();
    }
    expect(() => buildLinkTradeV2Path(reference, 'password')).toThrow();
  });
  it('rejects extra fields, noncanonical references and oversized or broken codes', () => {
    const prefix = '/otc/order/link/lv2.';
    for (const object of [{ ...reference, secret }, { ...reference, id: '01' },
      { ...reference, id: (1n << 256n).toString() }, { ...reference, credentialEpoch: '0' }]) {
      const code = encodeBase64UrlBytes(TEXT_ENCODER.encode(JSON.stringify(object)));
      expect(() => parseLinkTradeV2Path(prefix + code)).toThrow();
    }
    expect(() => parseLinkTradeV2Path(prefix + 'a'.repeat(1025))).toThrow();
    expect(() => parseLinkTradeV2Path(prefix + '%')).toThrow();
  });
  it('leaves unrelated and legacy routes unchanged and canonicalizes supported Link aliases', () => {
    for (const path of ['/otc/order/17', '/trades/l/VhAB', '/chat#contact']) {
      expect(parseLinkTradeV2Path(path)).toBeNull();
      expect(stripLinkTradeV2Secret(path)).toBe(path);
    }
    const path = buildLinkTradeV2Path(reference, secret);
    expect(parseLinkTradeV2Path(path.replace('/otc/order/link/', '/trades/l/'))?.reference).toEqual(reference);
  });
});
