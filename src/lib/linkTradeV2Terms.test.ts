import { AbiCoder, concat, getBytes, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import { createTradeAccessSecret } from './directTradeTerms';
import { toArrayBuffer } from './byteEncoding';
import {
  deriveLinkTradeV2Credential, linkTradeV2CredentialDomain, normalizeLinkTradeV2Reference,
  openLinkTradeV2Terms, sealLinkTradeV2Terms, type LinkTradeV2Context
} from './linkTradeV2Terms';

const context: LinkTradeV2Context = {
  chainId: '7082400', escrow: `0x${'11'.repeat(20)}`, maker: `0x${'22'.repeat(20)}`,
  makerNonce: `0x${'33'.repeat(32)}`, credentialEpoch: '1'
};
const terms = {
  offerToken: `0x${'44'.repeat(20)}`, requestToken: `0x${'55'.repeat(20)}`,
  privatePair: true, priceOffer: '1000000', priceRequest: '1500000', expiresAt: '0'
};

describe('Link V2 terms client boundary', () => {
  it('matches the exact contract credential domain and preserves full-width reference integers', () => {
    expect(linkTradeV2CredentialDomain(context)).toBe(keccak256(AbiCoder.defaultAbiCoder().encode(
      ['string', 'uint256', 'address', 'address', 'bytes32', 'uint64'],
      ['CHAINWHISPER_LINK_OTC_V2', context.chainId, context.escrow, context.maker,
        context.makerNonce, context.credentialEpoch]
    )));
    const ref = { chainId: context.chainId, escrow: context.escrow,
      id: ((1n << 256n) - 1n).toString(), revision: '9007199254740993', credentialEpoch: '1' };
    expect(normalizeLinkTradeV2Reference(ref)).toEqual(ref);
    expect(() => normalizeLinkTradeV2Reference({ ...ref, id: (1n << 256n).toString() })).toThrow();
    expect(() => normalizeLinkTradeV2Reference({ ...ref, revision: '01' })).toThrow();
    expect(() => normalizeLinkTradeV2Reference({ ...ref, credentialEpoch: '0' })).toThrow();
  });

  it.each([false, true])('authenticates a bounded price envelope, privatePair=%s', async privatePair => {
    const secret = createTradeAccessSecret(), reviewed = { ...terms, privatePair };
    const first = await sealLinkTradeV2Terms(context, reviewed, secret);
    const second = await sealLinkTradeV2Terms(context, reviewed, secret);
    expect(first).not.toBe(second);
    expect((first.length - 2) / 2).toBeLessThanOrEqual(2048);
    await expect(openLinkTradeV2Terms(context, first, secret)).resolves.toEqual(reviewed);
    const credential = await deriveLinkTradeV2Credential(context, secret);
    expect(credential).toBeGreaterThan(0n);
    expect(credential).toBeLessThan(1n << 256n);
    expect(credential).not.toBe(BigInt(secret));
    await expect(deriveLinkTradeV2Credential(context, secret)).resolves.toBe(credential);
  });

  it('rejects secret, chain, escrow, maker, nonce and epoch substitution', async () => {
    const secret = createTradeAccessSecret(), sealed = await sealLinkTradeV2Terms(context, terms, secret);
    await expect(openLinkTradeV2Terms(context, sealed, createTradeAccessSecret())).rejects.toThrow();
    for (const changed of [
      { chainId: '2632500' }, { escrow: `0x${'66'.repeat(20)}` },
      { maker: `0x${'77'.repeat(20)}` }, { makerNonce: `0x${'88'.repeat(32)}` },
      { credentialEpoch: '2' }
    ]) {
      await expect(openLinkTradeV2Terms({ ...context, ...changed }, sealed, secret)).rejects.toThrow();
      expect(await deriveLinkTradeV2Credential({ ...context, ...changed }, secret))
        .not.toBe(await deriveLinkTradeV2Credential(context, secret));
    }
  });

  it('rejects corrupted, truncated, unknown-version and oversized envelopes', async () => {
    const secret = createTradeAccessSecret(), sealed = await sealLinkTradeV2Terms(context, terms, secret);
    const changedByte = sealed.slice(0, -2) + (sealed.endsWith('00') ? '01' : '00');
    for (const invalid of [changedByte, sealed.slice(0, -2), `0x02${sealed.slice(4)}`,
      '0x01', `0x${'00'.repeat(2049)}`, '0x01zz']) {
      await expect(openLinkTradeV2Terms(context, invalid, secret)).rejects.toThrow();
    }
  });

  it('captures the reviewed domain and economics before asynchronous crypto', async () => {
    const secret = createTradeAccessSecret(), mutableContext = { ...context }, mutableTerms = { ...terms };
    const pending = sealLinkTradeV2Terms(mutableContext, mutableTerms, secret);
    mutableContext.credentialEpoch = '2';
    mutableTerms.priceRequest = '1';
    const sealed = await pending;
    await expect(openLinkTradeV2Terms(context, sealed, secret)).resolves.toEqual(terms);
    await expect(openLinkTradeV2Terms(mutableContext, sealed, secret)).rejects.toThrow();
    const ref = { chainId: context.chainId, escrow: context.escrow, id: '1', revision: '2', credentialEpoch: '1' };
    expect(normalizeLinkTradeV2Reference(ref).revision).toBe('2');
    await expect(openLinkTradeV2Terms(context, sealed, secret)).resolves.toEqual(terms);
  });

  it('rejects an authenticated envelope with an invalid plaintext schema', async () => {
    const secret = createTradeAccessSecret(), domain = getBytes(linkTradeV2CredentialDomain(context));
    const source = await crypto.subtle.importKey('raw', toArrayBuffer(getBytes(secret)), 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: toArrayBuffer(domain),
      info: toArrayBuffer(toUtf8Bytes('ChainWhisperLinkOTCV2/terms')) }, source, 256);
    const key = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt']);
    for (const invalid of [{ ...terms, budget: '10' }, { ...terms, priceRequest: '0' },
      { ...terms, privatePair: 'true' }, null]) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: toArrayBuffer(domain) },
        key, toArrayBuffer(toUtf8Bytes(JSON.stringify(invalid))));
      await expect(openLinkTradeV2Terms(context, concat(['0x01', iv, new Uint8Array(ciphertext)]), secret))
        .rejects.toThrow();
    }
  });

  it('rejects invalid economics, unsupported fields and malformed credential material', async () => {
    const secret = createTradeAccessSecret();
    for (const invalid of [
      { ...terms, priceOffer: '0' }, { ...terms, priceRequest: (1n << 128n).toString() },
      { ...terms, expiresAt: (1n << 64n).toString() }, { ...terms, requestToken: terms.offerToken },
      { ...terms, offerToken: `0x${'00'.repeat(20)}` }, { ...terms, privatePair: 'true' },
      { ...terms, budget: '100' }
    ]) {
      await expect(sealLinkTradeV2Terms(context, invalid as typeof terms, secret)).rejects.toThrow();
    }
    for (const invalid of ['0x01', `0x${'00'.repeat(32)}`, 'password']) {
      await expect(deriveLinkTradeV2Credential(context, invalid)).rejects.toThrow();
    }
    await expect(sealLinkTradeV2Terms({ ...context, makerNonce: `0x${'00'.repeat(32)}` }, terms, secret))
      .rejects.toThrow();
  });
});
