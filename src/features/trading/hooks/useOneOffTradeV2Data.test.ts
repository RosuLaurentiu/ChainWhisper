import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useOneOffTradeV2Data from './useOneOffTradeV2Data';
import type { DirectTradeV2TradeTerms } from '../../../lib/directTradeV2Actions';
import type { OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import {
  clearDirectTradeV2RevealErrors,
  hydrateOneOffDirectTradeV2ParticipantTerms,
  mergeOneOffDirectTradeV2Views,
  readOneOffDirectTradeV2ParticipantTerms,
  readOneOffDirectTradeV2PrivateTerms,
  readOneOffTradeV2Reference,
  readOneOffTradeV2OwnerIds,
  readRetainedOneOffTradeV2Orders,
  selectAutomaticDirectTradeV2Reveals
} from './useOneOffTradeV2Data';
import { CURRENT_P2P_BINDING } from '../../../lib/currentP2PBinding';
import { PRIVATE_BOOK_V2_RUNTIME_HASH } from '../../../lib/privateBookV2Actions';

it('keeps an exact order reference pending until the verified runtime is ready', () => {
  function PendingOrder() {
    const result = useOneOffTradeV2Data({
      runtime: null, walletAddress: `0x${'11'.repeat(20)}`, dataScopeKey: 'current-owner',
      privateReadsEnabled: false, tokenInfoByKey: {}, ensureTokenInfo: async () => {},
      reference: { chainId: '7082400', contractAddress: CURRENT_P2P_BINDING.deployments['private-v2'].contractAddress, orderId: '1' }
    });
    return createElement('output', null, result.referencedTradeError || (result.loadingReferencedTrade ? 'Loading order' : 'No order'));
  }
  expect(renderToStaticMarkup(createElement(PendingOrder))).toBe('<output>Loading order</output>');
});

describe('retained owner discovery', () => {
  it('follows the existing list cursor without repeating a page', async () => {
    const page = vi.fn(async (offset: bigint) => offset === 0n
      ? { tradeIds: ['1', '2'], nextOffset: '2' } : { tradeIds: ['3'], nextOffset: '0' });
    expect(await readOneOffTradeV2OwnerIds(page, () => true)).toEqual(['1', '2', '3']);
    expect(page.mock.calls.map(([offset]) => offset)).toEqual([0n, 2n]);
  });
  it('stops on a stalled cursor or revoked reader', async () => {
    const page = vi.fn(async () => ({ tradeIds: ['1'], nextOffset: '1' }));
    await expect(readOneOffTradeV2OwnerIds(page, () => true)).rejects.toThrow(/cursor/);
    expect(page).toHaveBeenCalledTimes(2);
    page.mockClear();
    await expect(readOneOffTradeV2OwnerIds(page, () => false)).rejects.toThrow(/current/);
    expect(page).not.toHaveBeenCalled();
  });
  it('discovers retained owner orders by exact escrow, never through an open-market scan', async () => {
    const owner = `0x${'11'.repeat(20)}`, address = `0x${'88'.repeat(20)}`;
    const deployment = { ...CURRENT_P2P_BINDING.deployments['standard-v2'], contractAddress: address };
    const listStandard = vi.fn(async (scope: string) => ({ tradeIds: scope === 'maker' ? ['7'] : [], nextOffset: '0' }));
    const readStandard = vi.fn(async () => ({ tradeId: '7', maker: owner }));
    const child = { isCurrent: () => true, deployments: { 'standard-v2': deployment }, listStandard, readStandard };
    const forReference = vi.fn(async () => child), selectedRead = vi.fn();
    const runtime = { isCurrent: () => true, retainedDeployments: [deployment, deployment], forReference, readStandard: selectedRead } as unknown as OtcV2ActionRuntime;
    const result = await readRetainedOneOffTradeV2Orders({ runtime, viewer: owner, privateReadsEnabled: false });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ deployment, kind: 'standard', view: { tradeId: '7' } });
    expect(listStandard.mock.calls.map(([scope]) => scope)).toEqual(['maker', 'filler']);
    expect(readStandard).toHaveBeenCalledExactlyOnceWith('7'); expect(selectedRead).not.toHaveBeenCalled();
    expect(forReference).toHaveBeenCalledWith({ chainId: deployment.chainId, contractAddress: address, orderId: '7' });
  });
  it('keeps same-ID book and Direct orders separate and reveals a book budget only to its maker', async () => {
    const owner = `0x${'11'.repeat(20)}`, outsider = `0x${'22'.repeat(20)}`;
    const book = { ...CURRENT_P2P_BINDING.deployments['private-v2'], contractAddress: `0x${'88'.repeat(20)}` };
    const direct = { ...CURRENT_P2P_BINDING.deployments['direct-v2'], contractAddress: `0x${'99'.repeat(20)}` };
    const list = vi.fn(async () => ({ orderIds: ['7'], nextOffset: '0' }));
    const read = vi.fn(async () => ({ orderId: '7', maker: owner })), readAccount = vi.fn(async () => ({ orderId: '7' }));
    const readDirect = vi.fn(async () => ({ tradeId: '7', maker: owner, taker: outsider }));
    const runtime = { isCurrent: () => true, retainedDeployments: [book, direct],
      deployments: { 'private-v2': book, 'direct-v2': direct }, privateBook: { list, read, readAccount }, readDirect,
      listDirect: vi.fn(async () => ({ tradeIds: ['7'], nextOffset: '0' })) } as unknown as OtcV2ActionRuntime;
    const root = { ...runtime, forReference: vi.fn(async () => runtime) };
    const mine = await readRetainedOneOffTradeV2Orders({ runtime: root, viewer: owner, privateReadsEnabled: true });
    expect(mine.map(item => item.deployment.contractAddress)).toEqual([book.contractAddress, direct.contractAddress]);
    expect(read).toHaveBeenCalledExactlyOnceWith('7'); expect(readAccount).toHaveBeenCalledExactlyOnceWith('7');
    expect(readDirect).toHaveBeenCalledExactlyOnceWith('7', true);
    readAccount.mockClear();
    await readRetainedOneOffTradeV2Orders({ runtime: root, viewer: outsider, privateReadsEnabled: true });
    await readRetainedOneOffTradeV2Orders({ runtime: root, viewer: owner, privateReadsEnabled: false });
    expect(readAccount).not.toHaveBeenCalled();
  });
});

describe('readOneOffTradeV2Reference', () => {
  const owner = `0x${'11'.repeat(20)}`;
  const fixture = (hash = CURRENT_P2P_BINDING.deployments['private-v2'].runtimeBytecodeHash) => {
    let alive = true;
    const view = { orderId: '501', maker: owner, mode: 'private-pair' };
    const read = vi.fn(async () => view), readAccount = vi.fn(async () => ({ orderId: '501', sequence: '1' }));
    const readStandard = vi.fn(async () => ({ tradeId: '501' })), readDirect = vi.fn(async () => ({ tradeId: '501' }));
    const runtime = { isCurrent: () => alive, deployments: CURRENT_P2P_BINDING.deployments,
      privateBook: { read, readAccount }, readStandard, readDirect } as unknown as OtcV2ActionRuntime;
    const actual = { ...runtime, deployments: { ...runtime.deployments, 'private-v2': { ...runtime.deployments['private-v2'], runtimeBytecodeHash: hash } } };
    const reference = { chainId: '7082400', contractAddress: runtime.deployments['private-v2'].contractAddress, orderId: '501' };
    return { runtime: actual, reference, read, readAccount, readStandard, readDirect, view, close: () => { alive = false; } };
  };

  it.each([PRIVATE_BOOK_V2_RUNTIME_HASH, CURRENT_P2P_BINDING.deployments['private-v2'].runtimeBytecodeHash])('reads an exact book reference outside the list page for %s', async hash => {
    const f = fixture(hash);
    const detail = await readOneOffTradeV2Reference({ runtime: f.runtime, reference: f.reference, viewer: owner, privateReadsEnabled: true });
    expect(detail).toMatchObject({ kind: 'book', view: f.view, deployment: f.runtime.deployments['private-v2'] });
    expect(f.read).toHaveBeenCalledExactlyOnceWith('501');
    expect(f.readAccount).toHaveBeenCalledExactlyOnceWith('501');
    expect(f.readStandard).not.toHaveBeenCalled(); expect(f.readDirect).not.toHaveBeenCalled();
  });

  it('does not request the maker budget for an outsider or locked wallet', async () => {
    const f = fixture();
    for (const options of [{ viewer: `0x${'22'.repeat(20)}`, privateReadsEnabled: true }, { viewer: owner, privateReadsEnabled: false }]) {
      const detail = await readOneOffTradeV2Reference({ runtime: f.runtime, reference: f.reference, ...options });
      expect(detail).toMatchObject({ kind: 'book', view: f.view }); expect(detail).not.toHaveProperty('account');
    }
    expect(f.readAccount).not.toHaveBeenCalled();
  });

  it('uses the resolved older runtime for a full detail reference', async () => {
    const f = fixture();
    const forReference = vi.fn(async () => f.runtime);
    const root = { ...f.runtime, deployments: { ...f.runtime.deployments, 'private-v2': { ...f.runtime.deployments['private-v2'], contractAddress: `0x${'99'.repeat(20)}` } }, forReference };
    await expect(readOneOffTradeV2Reference({ runtime: root, reference: f.reference, viewer: owner, privateReadsEnabled: true })).resolves.toMatchObject({ kind: 'book', deployment: f.runtime.deployments['private-v2'] });
    expect(forReference).toHaveBeenCalledExactlyOnceWith(f.reference);
    expect(f.read).toHaveBeenCalledExactlyOnceWith('501');
  });

  it('selects Standard or Direct by the full reference and never by local order ID', async () => {
    const f = fixture();
    for (const protocol of ['standard-v2', 'direct-v2'] as const) {
      const reference = { ...f.reference, contractAddress: f.runtime.deployments[protocol].contractAddress };
      await expect(readOneOffTradeV2Reference({ runtime: f.runtime, reference, viewer: owner, privateReadsEnabled: false })).resolves.toMatchObject({ kind: protocol === 'standard-v2' ? 'standard' : 'direct' });
    }
    expect(f.readStandard).toHaveBeenCalledExactlyOnceWith('501');
    expect(f.readDirect).toHaveBeenCalledExactlyOnceWith('501', false);
    expect(f.read).not.toHaveBeenCalled();
  });

  it('keeps an admitted legacy private order on its existing reader and receipt path', async () => {
    const f = fixture('0xe20848f75e59634a16c7d33dd393e91698292a9b29400d456ff57ab0c04ac680');
    const readPrivateTrade = vi.fn(async () => ({ ...f.view, mode: 'fully-private' }));
    const readPrivateTradeAccount = vi.fn(async () => ({ orderId: '501', sequence: '1' }));
    const runtime = { ...f.runtime, readPrivateTrade, readPrivateTradeAccount } as unknown as OtcV2ActionRuntime;
    await expect(readOneOffTradeV2Reference({ runtime, reference: f.reference, viewer: owner, privateReadsEnabled: true })).resolves.toMatchObject({ kind: 'private', account: { orderId: '501' } });
    expect(readPrivateTrade).toHaveBeenCalledExactlyOnceWith('501');
    expect(readPrivateTradeAccount).toHaveBeenCalledExactlyOnceWith('501');
    expect(f.read).not.toHaveBeenCalled(); expect(f.readAccount).not.toHaveBeenCalled();
  });

  it('does not downgrade a book reference when its admitted API is missing', async () => {
    const f = fixture(), readPrivateTrade = vi.fn();
    const runtime = { ...f.runtime, privateBook: undefined, readPrivateTrade };
    await expect(readOneOffTradeV2Reference({ runtime, reference: f.reference, viewer: owner, privateReadsEnabled: true })).rejects.toThrow(/book reader/);
    expect(readPrivateTrade).not.toHaveBeenCalled();
  });

  it('rejects wrong chain, unknown escrow, invalid ID and expired runtime before reading', async () => {
    const f = fixture();
    for (const reference of [{ ...f.reference, chainId: '1' }, { ...f.reference, contractAddress: `0x${'99'.repeat(20)}` }, { ...f.reference, orderId: '0' }, { ...f.reference, orderId: '501.1' }]) {
      await expect(readOneOffTradeV2Reference({ runtime: f.runtime, reference, viewer: owner, privateReadsEnabled: false })).rejects.toThrow();
    }
    f.close();
    await expect(readOneOffTradeV2Reference({ runtime: f.runtime, reference: f.reference, viewer: owner, privateReadsEnabled: false })).rejects.toThrow(/current/);
    expect(f.read).not.toHaveBeenCalled(); expect(f.readStandard).not.toHaveBeenCalled(); expect(f.readDirect).not.toHaveBeenCalled();
  });

  it('rejects a mismatched returned ID and a runtime closed during the read', async () => {
    const f = fixture();
    f.read.mockResolvedValueOnce({ ...f.view, orderId: '502' });
    await expect(readOneOffTradeV2Reference({ runtime: f.runtime, reference: f.reference, viewer: owner, privateReadsEnabled: true })).rejects.toThrow(/order/);
    f.read.mockImplementationOnce(async () => { f.close(); return f.view; });
    await expect(readOneOffTradeV2Reference({ runtime: f.runtime, reference: f.reference, viewer: owner, privateReadsEnabled: true })).rejects.toThrow(/current/);
    expect(f.readAccount).not.toHaveBeenCalled();
  });
});

describe('clearDirectTradeV2RevealErrors', () => {
  it('preserves an already-empty state so the privacy-locked effect cannot rerender forever', () => {
    const empty = {};

    expect(clearDirectTradeV2RevealErrors(empty)).toBe(empty);
    expect(clearDirectTradeV2RevealErrors({ '3': 'temporary failure' })).toEqual({});
  });
});

const revealed = {
  tradeId: '3',
  maker: '0x1111111111111111111111111111111111111111',
  taker: '0x2222222222222222222222222222222222222222',
  status: 'open',
  amountMode: 'private',
  offerAsset: { assetType: 'private-erc20', token: '0x3333333333333333333333333333333333333333' },
  requestAsset: { assetType: 'private-erc20', token: '0x4444444444444444444444444444444444444444' },
  offerAmount: '10',
  requestAmount: '25',
  createdAt: '1',
  expiresAt: '0',
  parentTradeId: '0',
  rootTradeId: '3',
  counterDepth: '0',
  activeCounterTradeId: '0',
  replacementTradeId: '0',
  replacesTradeId: '0'
} as DirectTradeV2TradeTerms;

describe('readOneOffDirectTradeV2PrivateTerms', () => {
  it('uses the Direct V2 participant reader with private decryption enabled', async () => {
    const readDirect = vi.fn(async () => revealed);
    const runtime = {
      isCurrent: () => true,
      readDirect
    } as Pick<OtcV2ActionRuntime, 'isCurrent' | 'readDirect'>;

    await expect(readOneOffDirectTradeV2PrivateTerms({
      runtime,
      tradeId: 3,
      privateReadsEnabled: true
    })).resolves.toBe(revealed);

    expect(readDirect).toHaveBeenCalledWith('3', true);
  });

  it('automatically asks for exact participant terms once privacy is unlocked', async () => {
    const readDirect = vi.fn(async () => revealed);
    const runtime = {
      isCurrent: () => true,
      readDirect
    } as Pick<OtcV2ActionRuntime, 'isCurrent' | 'readDirect'>;

    await expect(readOneOffDirectTradeV2ParticipantTerms({
      runtime,
      tradeIds: ['3'],
      privateReadsEnabled: true
    })).resolves.toEqual([revealed]);

    expect(readDirect).toHaveBeenCalledOnce();
    expect(readDirect).toHaveBeenCalledWith('3', true);
  });

  it('serializes participant reads so the wallet capability is checked one trade at a time', async () => {
    let active = 0;
    let maxActive = 0;
    const readDirect = vi.fn(async (id: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return { ...revealed, tradeId: id };
    });
    const runtime = {
      isCurrent: () => true,
      readDirect
    } as Pick<OtcV2ActionRuntime, 'isCurrent' | 'readDirect'>;

    await expect(readOneOffDirectTradeV2ParticipantTerms({
      runtime,
      tradeIds: ['3', '4'],
      privateReadsEnabled: true
    })).resolves.toHaveLength(2);

    expect(maxActive).toBe(1);
  });

  it('keeps the amount-free public card when privacy is locked', async () => {
    const publicTerms = { ...revealed, offerAmount: undefined, requestAmount: undefined };
    const readDirect = vi.fn(async () => publicTerms);
    const runtime = {
      isCurrent: () => true,
      readDirect
    } as Pick<OtcV2ActionRuntime, 'isCurrent' | 'readDirect'>;

    await expect(readOneOffDirectTradeV2ParticipantTerms({
      runtime,
      tradeIds: ['3'],
      privateReadsEnabled: false
    })).resolves.toEqual([publicTerms]);

    expect(readDirect).toHaveBeenCalledOnce();
    expect(readDirect).toHaveBeenCalledWith('3', false);
  });

  it('falls back to the amount-free card when the viewer is not an eligible participant', async () => {
    const publicTerms = { ...revealed, offerAmount: undefined, requestAmount: undefined };
    const readDirect = vi.fn(async (_id: string, includePrivate: boolean) => {
      if (includePrivate) throw new Error('not a participant');
      return publicTerms;
    });
    const runtime = {
      isCurrent: () => true,
      readDirect
    } as Pick<OtcV2ActionRuntime, 'isCurrent' | 'readDirect'>;

    await expect(readOneOffDirectTradeV2ParticipantTerms({
      runtime,
      tradeIds: ['3'],
      privateReadsEnabled: true
    })).resolves.toEqual([publicTerms]);

    expect(readDirect.mock.calls).toEqual([['3', true], ['3', false]]);
  });

  it('does not read private terms before privacy is unlocked', async () => {
    const readDirect = vi.fn(async () => revealed);
    const runtime = {
      isCurrent: () => true,
      readDirect
    } as Pick<OtcV2ActionRuntime, 'isCurrent' | 'readDirect'>;

    await expect(readOneOffDirectTradeV2PrivateTerms({
      runtime,
      tradeId: '3',
      privateReadsEnabled: false
    })).rejects.toThrow('Unlock privacy');

    expect(readDirect).not.toHaveBeenCalled();
  });

  it('hydrates only unresolved private Direct terms after privacy unlock', async () => {
    const alreadyRevealed = { ...revealed, tradeId: '4' };
    const unresolved = { ...revealed, offerAmount: undefined, requestAmount: undefined };
    const readDirect = vi.fn(async (id: string) => ({ ...revealed, tradeId: id }));
    const runtime = {
      isCurrent: () => true,
      readDirect
    } as Pick<OtcV2ActionRuntime, 'isCurrent' | 'readDirect'>;

    await expect(hydrateOneOffDirectTradeV2ParticipantTerms({
      runtime,
      views: [unresolved, alreadyRevealed],
      privateReadsEnabled: true
    })).resolves.toEqual({
      views: [revealed, alreadyRevealed],
      errorsByTradeId: {}
    });

    expect(readDirect).toHaveBeenCalledOnce();
    expect(readDirect).toHaveBeenCalledWith('3', true);
  });

  it('keeps the public card and records a retryable error when automatic reveal fails', async () => {
    const unresolved = { ...revealed, offerAmount: undefined, requestAmount: undefined };
    const readDirect = vi.fn(async () => { throw new Error('temporary privacy read failure'); });
    const runtime = {
      isCurrent: () => true,
      readDirect
    } as Pick<OtcV2ActionRuntime, 'isCurrent' | 'readDirect'>;

    await expect(hydrateOneOffDirectTradeV2ParticipantTerms({
      runtime,
      views: [unresolved],
      privateReadsEnabled: true
    })).resolves.toEqual({
      views: [unresolved],
      errorsByTradeId: { '3': 'temporary privacy read failure' }
    });

    expect(readDirect).toHaveBeenCalledOnce();
  });

  it('does not automatically retry a failed reveal until the user retries or the wallet session changes', () => {
    const unresolved = { ...revealed, offerAmount: undefined, requestAmount: undefined };
    const anotherUnresolved = { ...unresolved, tradeId: '4' };

    expect(selectAutomaticDirectTradeV2Reveals({
      views: [unresolved, anotherUnresolved, revealed],
      errorsByTradeId: { '3': 'temporary privacy read failure' }
    })).toEqual([anotherUnresolved]);
  });

  it('does not let a slower public refresh overwrite successfully revealed terms', () => {
    const publicTerms = { ...revealed, offerAmount: undefined, requestAmount: undefined };

    expect(mergeOneOffDirectTradeV2Views({
      current: [revealed],
      incoming: [publicTerms],
      preserveRevealed: true
    })).toEqual([revealed]);
    expect(mergeOneOffDirectTradeV2Views({
      current: [revealed],
      incoming: [publicTerms],
      preserveRevealed: false
    })).toEqual([publicTerms]);
  });
});
