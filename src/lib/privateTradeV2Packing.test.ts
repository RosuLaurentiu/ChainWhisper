import { describe, expect, it } from 'vitest';
import {
  packPrivateTradeV2CreateTerms,
  packPrivateTradeV2FillTerms,
  unpackPrivateTradeV2Pair
} from './privateTradeV2Packing';

describe('privateTradeV2Packing', () => {
  it('packs fully-private create and fill values into one high/low input each', () => {
    const create = packPrivateTradeV2CreateTerms({
      offerAssetType: 'private-erc20', offerAmount: 10n,
      requestAssetType: 'private-erc20', requestAmount: 25n
    });
    expect(create).toMatchObject({
      mode: 'fully-private', publicOfferAmount: 0n, publicRequestAmount: 0n, privateInputCount: 1
    });
    expect(unpackPrivateTradeV2Pair(create.packedPrivateTerms)).toEqual({ high: 10n, low: 25n });

    const fill = packPrivateTradeV2FillTerms({
      mode: 'fully-private', maxRequestAmount: 5n, minOfferAmount: 2n
    });
    expect(fill).toMatchObject({ publicFillAmount: 0n, privateInputCount: 1 });
    expect(unpackPrivateTradeV2Pair(fill.packedPrivateFill)).toEqual({ high: 5n, low: 2n });
  });

  it('packs each hybrid mode without leaking the private side into public calldata', () => {
    expect(packPrivateTradeV2CreateTerms({
      offerAssetType: 'private-erc20', offerAmount: 10n,
      requestAssetType: 'erc20', requestAmount: 25n
    })).toMatchObject({
      mode: 'private-offer-public-request',
      publicOfferAmount: 0n,
      publicRequestAmount: 25n,
      packedPrivateTerms: 10n,
      privateInputCount: 1
    });
    expect(packPrivateTradeV2FillTerms({
      mode: 'private-offer-public-request', publicRequestAmount: 5n, minPrivateOfferAmount: 2n
    })).toEqual({
      mode: 'private-offer-public-request', publicFillAmount: 5n,
      packedPrivateFill: 2n, privateInputCount: 1
    });

    expect(packPrivateTradeV2CreateTerms({
      offerAssetType: 'native', offerAmount: 10n,
      requestAssetType: 'private-erc20', requestAmount: 25n
    })).toMatchObject({
      mode: 'public-offer-private-request',
      publicOfferAmount: 10n,
      publicRequestAmount: 0n,
      packedPrivateTerms: 25n,
      privateInputCount: 1
    });
    expect(packPrivateTradeV2FillTerms({
      mode: 'public-offer-private-request', publicOfferAmount: 2n, maxPrivateRequestAmount: 5n
    })).toEqual({
      mode: 'public-offer-private-request', publicFillAmount: 2n,
      packedPrivateFill: 5n, privateInputCount: 1
    });
  });

  it('rejects public-only orders, zero values, and uint128 overflow', () => {
    expect(() => packPrivateTradeV2CreateTerms({
      offerAssetType: 'erc20', offerAmount: 1n, requestAssetType: 'native', requestAmount: 2n
    })).toThrow(/at least one private/i);
    expect(() => packPrivateTradeV2FillTerms({
      mode: 'fully-private', maxRequestAmount: 0n, minOfferAmount: 1n
    })).toThrow(/between 1 and uint128 max/i);
    expect(() => packPrivateTradeV2CreateTerms({
      offerAssetType: 'private-erc20', offerAmount: 1n << 128n,
      requestAssetType: 'private-erc20', requestAmount: 1n
    })).toThrow(/uint128 max/i);
  });
});
