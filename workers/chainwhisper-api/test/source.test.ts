import { describe, expect, it } from 'vitest';
import { keccak256, type Abi, type Address, type Hex } from 'viem';
import { encodeTradeLink } from '../../../src/lib/tradeLinks';
import { CONTRACTS, resolveVerifiedAsset } from '../src/registry';
import {
  RpcContractRevertedError,
  RpcUnavailableError,
  type ContractReader
} from '../src/rpc';
import { LiveApiSource, RUNTIME_VERIFICATION_SCOPE } from '../src/source';

const fakeCode = '0x6000' as Hex;
const maker = '0x1111111111111111111111111111111111111111';
const zero = '0x0000000000000000000000000000000000000000';

class FakeReader implements ContractReader {
  partialFillsAllowed = true;
  tradeReadError: Error | null = null;
  deskLimits: bigint[] = [];

  async request<T>(method: string): Promise<T> {
    if (method === 'eth_chainId') return '0x282b34' as T;
    if (method === 'eth_getCode') return fakeCode as T;
    throw new Error('unexpected request');
  }

  async readContract(input: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown> {
    if (input.functionName === 'getContracts') {
      return {
        standardEscrow: CONTRACTS.standardEscrow,
        privateEscrow: CONTRACTS.privateEscrow,
        directEscrow: CONTRACTS.directEscrow,
        recurringEscrow: CONTRACTS.recurringEscrow,
        reader: CONTRACTS.reader,
        historyReader: CONTRACTS.historyReader
      };
    }
    if (input.functionName === 'getPublicDeskPage') {
      this.deskLimits.push(BigInt(String(input.args?.[4] ?? 0)));
      return {
        items: [{
          contractAddress: CONTRACTS.standardEscrow,
          localId: 1n,
          kind: 1,
          maker,
          taker: zero,
          status: 1,
          isPublic: true,
          hiddenAmount: false,
          hasPrivateInventory: false,
          lastActivityBlock: 10n
        }],
        nextOffset: 0n
      };
    }
    if (
      input.functionName === 'getTradeView' &&
      input.address.toLowerCase() === CONTRACTS.standardEscrow.toLowerCase()
    ) {
      if (this.tradeReadError) throw this.tradeReadError;
      return {
        trade: {
          maker,
          taker: zero,
          status: 1,
          offerAsset: {
            assetType: 1,
            token: resolveVerifiedAsset('WISP')!.address,
            amount: 10_000_000n
          },
          requestAsset: {
            assetType: 0,
            token: zero,
            amount: 9_000_000_000_000_000_000n
          },
          createdAt: 1_753_747_200n,
          expiresAt: 0n
        },
        metadata: { isPublic: true, accessHash: `0x${'0'.repeat(64)}` },
        fillState: {
          remainingOfferAmount: 10_000_000n,
          remainingRequestAmount: 9_000_000_000_000_000_000n,
          filledOfferAmount: 0n,
          filledRequestAmount: 0n
        },
        fillPolicy: {
          partialFillsAllowed: this.partialFillsAllowed,
          minPartialFillBps: 0,
          minRequestAmount: 0n,
          maxRequestAmountPerWallet: 0n,
          oneFillPerWallet: false
        },
        effectiveStatus: 1
      };
    }
    throw new Error(`unexpected contract read: ${input.functionName}`);
  }
}

class RecurringFakeReader extends FakeReader {
  override async readContract(input: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown> {
    if (input.functionName === 'getPublicDeskPage') {
      return {
        items: [{
          contractAddress: CONTRACTS.recurringEscrow,
          localId: 2n
        }],
        nextOffset: 0n
      };
    }
    if (input.functionName === 'getOrderView') {
      return {
        order: {
          maker,
          taker: zero,
          status: 1,
          mode: 0,
          baseAsset: {
            assetType: 1,
            token: resolveVerifiedAsset('WISP')!.address
          },
          quoteAsset: {
            assetType: 0,
            token: zero
          },
          buyTerms: {
            baseAmount: 1_000_000n,
            quoteAmount: 900_000_000_000_000_000n
          },
          sellTerms: {
            baseAmount: 1_000_000n,
            quoteAmount: 1_100_000_000_000_000_000n
          },
          isPublic: true,
          accessHash: `0x${'0'.repeat(64)}`,
          createdAt: 1_753_747_200n,
          publicBaseInventory: 10_000_000n,
          publicQuoteInventory: 9_000_000_000_000_000_000n
        },
        buySideOpen: true,
        sellSideOpen: true,
        hasPrivateBaseInventory: false,
        hasPrivateQuoteInventory: false
      };
    }
    return super.readContract(input);
  }
}

const sourceFor = (reader: FakeReader) =>
  new LiveApiSource({
    rpc: reader,
    now: () => Date.parse('2026-07-29T00:00:00.000Z'),
    codeHashes: new Map([[CONTRACTS.registry.toLowerCase(), keccak256(fakeCode)]])
  });

describe('Live ChainWhisper API source', () => {
  it('attests runtime, normalizes public orders, and preserves the app link encoding', async () => {
    const source = sourceFor(new FakeReader());
    const status = await source.getStatus();
    expect(status).toMatchObject({ ready: true, runtimeVerified: true, issueCode: null });
    expect(status.verificationScope).toEqual(RUNTIME_VERIFICATION_SCOPE);
    expect(status.verificationScope.privacyPortalRoutes).toHaveLength(8);
    expect(status.verificationScope.privateTokenAssets).toHaveLength(10);

    const page = await source.listOrders({ cursor: 0, limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      offerAsset: { symbol: 'WISP' },
      requestAsset: { symbol: 'COTI' },
      offerAmount: '10',
      requestAmount: '9',
      liquidityVisibility: 'visible'
    });
    expect(page.items[0]!.appUrl).toBe(
      `https://chainwhisper.chat/otc/order/link/${encodeTradeLink(1)}`
    );
  });

  it('selects one complete order and enforces the on-chain partial-fill policy', async () => {
    const reader = new FakeReader();
    const source = sourceFor(reader);
    const sellAsset = resolveVerifiedAsset('COTI')!;
    const buyAsset = resolveVerifiedAsset('WISP')!;
    const quote = await source.quoteBestSingleSwap({
      sellAsset,
      buyAsset,
      amount: '1',
      amountMode: 'sell'
    });
    expect(quote).toMatchObject({
      estimatedSellAmount: '1',
      estimatedBuyAmount: '1.111111',
      orderKind: 'one-off'
    });
    expect(reader.deskLimits).toEqual([8n, 8n]);

    reader.partialFillsAllowed = false;
    const freshSource = sourceFor(reader);
    await expect(freshSource.quoteBestSingleSwap({
      sellAsset,
      buyAsset,
      amount: '1',
      amountMode: 'sell'
    })).resolves.toBeNull();
    await expect(freshSource.quoteBestSingleSwap({
      sellAsset,
      buyAsset,
      amount: '9',
      amountMode: 'sell'
    })).resolves.toMatchObject({
      estimatedBuyAmount: '10'
    });
  });

  it('labels recurring swap sides from the user perspective', async () => {
    const source = sourceFor(new RecurringFakeReader());
    const coti = resolveVerifiedAsset('COTI')!;
    const wisp = resolveVerifiedAsset('WISP')!;

    await expect(source.quoteBestSingleSwap({
      sellAsset: wisp,
      buyAsset: coti,
      amount: '1',
      amountMode: 'sell'
    })).resolves.toMatchObject({
      recurringSide: 'sell',
      estimatedBuyAmount: '0.9'
    });
    await expect(source.quoteBestSingleSwap({
      sellAsset: coti,
      buyAsset: wisp,
      amount: '1.1',
      amountMode: 'sell'
    })).resolves.toMatchObject({
      recurringSide: 'buy',
      estimatedBuyAmount: '1'
    });
  });

  it('uses public counterparts for private-token market references', async () => {
    const source = new LiveApiSource({
      rpc: new FakeReader(),
      now: () => Date.parse('2026-07-29T00:00:00.000Z'),
      fetcher: async (input) => {
        const address = new URL(String(input)).searchParams.get('address')!.toLowerCase();
        const wisp = resolveVerifiedAsset('WISP')!.address!.toLowerCase();
        return Response.json({ data: { USD: address === wisp ? 0.1 : 0.05 } });
      }
    });
    const reference = await source.getMarketReference(
      resolveVerifiedAsset('p.WISP')!,
      resolveVerifiedAsset('p.COTI')!
    );
    expect(reference).toMatchObject({
      price: '2',
      usedPublicCounterparts: true,
      executable: false
    });
  });

  it('fails closed when any listed or quoted order cannot be read', async () => {
    const reader = new FakeReader();
    reader.tradeReadError = new RpcUnavailableError();
    const source = sourceFor(reader);

    await expect(source.listOrders({ cursor: 0, limit: 10 })).rejects.toMatchObject({
      code: 'upstream_unavailable',
      status: 503
    });
    await expect(source.quoteBestSingleSwap({
      sellAsset: resolveVerifiedAsset('COTI')!,
      buyAsset: resolveVerifiedAsset('WISP')!,
      amount: '1',
      amountMode: 'sell'
    })).rejects.toMatchObject({
      code: 'upstream_unavailable',
      status: 503
    });
  });

  it('treats a verified getTradeView revert as missing and transport failure as unavailable', async () => {
    const missingReader = new FakeReader();
    missingReader.tradeReadError = new RpcContractRevertedError();
    await expect(sourceFor(missingReader).getOrder('standard', 999n)).resolves.toBeNull();

    const unavailableReader = new FakeReader();
    unavailableReader.tradeReadError = new RpcUnavailableError();
    await expect(sourceFor(unavailableReader).getOrder('standard', 1n)).rejects.toBeInstanceOf(
      RpcUnavailableError
    );
  });
});
