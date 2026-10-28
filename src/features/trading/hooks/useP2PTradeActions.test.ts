import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS, type TradeSnapshot } from '../../../lib/appShared';
import type { OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import { PRIVATE_BOOK_V2_RUNTIME_HASH, type PrivateBookV2OrderView } from '../../../lib/privateBookV2Actions';
import type { PrivateBookV2ProjectedSnapshot } from '../../../lib/oneOffTradeV2Snapshot';
import { TradeActionConfirmationCancelledError, type TradeFundingPreflightInput } from '../../../lib/tradeActionConfirm';

vi.mock('../../../lib/otcV2ActionRuntime', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/otcV2ActionRuntime')>('../../../lib/otcV2ActionRuntime');
  return { ...actual, assertOtcV2ActionRuntime: (value: OtcV2ActionRuntime) => value };
});

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useCallback: <T,>(callback: T) => callback,
    useState: <T,>(initial: T) => [initial, vi.fn()] as const
  };
});

import useP2PTradeActions from './useP2PTradeActions';

const OWNER = '0x1111111111111111111111111111111111111111';
const MAKER = '0x2222222222222222222222222222222222222222';
const TOKEN_A = '0x3333333333333333333333333333333333333333';
const TOKEN_B = '0x4444444444444444444444444444444444444444';
const STANDARD = '0x5555555555555555555555555555555555555555';
const PRIVATE = '0x6666666666666666666666666666666666666666';
const DIRECT = '0x7777777777777777777777777777777777777777';
const TX = `0x${'88'.repeat(32)}`;

const runtime = () => ({
  deployments: {
    'standard-v2': { chainId: '7082400', contractAddress: STANDARD },
    'private-v2': { chainId: '7082400', contractAddress: PRIVATE },
    'direct-v2': { chainId: '7082400', contractAddress: DIRECT }
  },
  standard: vi.fn(async () => ({ transactionHash: TX })),
  privateTrade: vi.fn(async () => ({ transactionHash: TX })),
  direct: vi.fn(async () => ({ transactionHash: TX })),
  quoteStandard: vi.fn(async () => ({
    revision: '2', requestAmountIn: '20', offerAmountOut: '10', isFinalFill: false,
    remainingOfferAmountAfter: '90', remainingRequestAmountAfter: '180'
  })),
  isCurrent: () => true
}) as unknown as OtcV2ActionRuntime;

const snapshot = (protocol: 'standard-v2' | 'private-v2' | 'direct-v2'): TradeSnapshot => ({
  tradeId: 7,
  escrowContract: protocol === 'standard-v2' ? STANDARD : protocol === 'private-v2' ? PRIVATE : DIRECT,
  maker: MAKER,
  taker: protocol === 'direct-v2' ? OWNER : '0x0000000000000000000000000000000000000000',
  offer: { kind: protocol === 'private-v2' ? 'private-erc20' : 'erc20', tokenAddress: TOKEN_A, symbol: 'A', decimals: 0, amount: '100' },
  request: { kind: protocol === 'private-v2' ? 'private-erc20' : 'erc20', tokenAddress: TOKEN_B, symbol: 'B', decimals: 0, amount: '200' },
  createdAt: 1,
  expiresAt: 0,
  status: 'open',
  hiddenLiquidity: protocol === 'private-v2',
  fillState: { remainingOfferAmount: '100', remainingRequestAmount: '200', filledOfferAmount: '0', filledRequestAmount: '0' },
  v2: {
    protocol,
    chainId: '7082400',
    contractAddress: protocol === 'standard-v2' ? STANDARD : protocol === 'private-v2' ? PRIVATE : DIRECT,
    ...(protocol === 'standard-v2' || protocol === 'private-v2' ? { revision: '2' } : {}),
    ...(protocol === 'private-v2' ? { amountMode: 'private' as const, privateMode: 'fully-private' as const } : { amountMode: 'public' as const })
  }
});

const args = (otcV2ActionRuntime: OtcV2ActionRuntime) => ({
  ensureTradeFunding: vi.fn(async (_input: TradeFundingPreflightInput) => undefined),
  getTradeSigner: vi.fn(),
  mergeTradeSnapshot: vi.fn(),
  openTrade: vi.fn(),
  rememberTradeTerminalReturn: vi.fn(),
  refreshTradeDataInBackground: vi.fn(),
  refreshOneOffV2Trades: vi.fn(),
  readTradeDetail: vi.fn(async (_id: number, contract?: string): Promise<TradeSnapshot | null> => {
    if (contract?.toLowerCase() === STANDARD.toLowerCase()) return snapshot('standard-v2');
    if (contract?.toLowerCase() === PRIVATE.toLowerCase()) return snapshot('private-v2');
    return snapshot('direct-v2');
  }),
  resolveKnownTradeAccessSecret: vi.fn(() => ''),
  resolvedRouteAccessSecret: '',
  routeTradeId: null,
  runTradeWalletPromptFlow: async <T,>(operation: () => Promise<T>) => operation(),
  setTradeActionError: vi.fn(),
  walletAddress: OWNER,
  onActionNotice: vi.fn(),
  otcV2ActionRuntime
});

describe('useP2PTradeActions OTC V2 routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cancels an older referenced order through its resolved runtime instead of the current same-ID instance', async () => {
    const current = runtime(), retained = runtime();
    const target = snapshot('standard-v2');
    const resolve = vi.fn(async () => retained);
    const root = { ...current, deployments: { ...current.deployments, 'standard-v2': { ...current.deployments['standard-v2'], contractAddress: `0x${'99'.repeat(20)}` } }, forReference: resolve };
    const input = args(root as OtcV2ActionRuntime);
    await useP2PTradeActions(input).cancelTrade(target);
    expect(resolve).toHaveBeenCalledWith({ chainId: target.v2!.chainId, contractAddress: target.escrowContract, orderId: '7' });
    expect(retained.standard).toHaveBeenCalledExactlyOnceWith({ kind: 'cancel', tradeId: 7 });
    expect(current.standard).not.toHaveBeenCalled();
  });

  it.each([
    ['standard-v2', 'acceptTrade', 'refreshOneOffV2Trades', 'accept'],
    ['private-v2', 'acceptTrade', 'openTrade', 'accept'],
    ['direct-v2', 'acceptTrade', 'openTrade', 'accept'],
    ['standard-v2', 'partialFillTrade', 'openTrade', 'fill'],
    ['private-v2', 'partialFillTrade', 'refreshOneOffV2Trades', 'fill'],
    ['standard-v2', 'cancelTrade', 'mergeTradeSnapshot', 'cancel'],
    ['private-v2', 'cancelTrade', 'refreshOneOffV2Trades', 'cancel'],
    ['direct-v2', 'cancelTrade', 'mergeTradeSnapshot', 'cancel'],
    ['direct-v2', 'declineTrade', 'mergeTradeSnapshot', 'decline']
  ] as const)('keeps %s %s confirmed despite %s failure', async (protocol, method, callback, action) => {
    const value = runtime(); const input = args(value);
    input[callback].mockImplementation(() => { throw new Error('Display unavailable'); });
    const actions = useP2PTradeActions(input);
    if (method === 'partialFillTrade') await actions.partialFillTrade(snapshot(protocol), '20');
    else await actions[method](snapshot(protocol));
    expect(input.onActionNotice).toHaveBeenCalledWith(expect.objectContaining({ action, status: 'success', txHash: TX,
      message: expect.stringContaining('display') }));
    expect(input.onActionNotice.mock.calls.some(([notice]) => notice.status === 'error')).toBe(false);
    expect(value.standard).toHaveBeenCalledTimes(protocol === 'standard-v2' ? 1 : 0);
    expect(input.refreshOneOffV2Trades).toHaveBeenCalledOnce();
  });

  it('quotes and partially fills Standard V2 without requesting a legacy signer', async () => {
    const value = runtime();
    const input = args(value);
    await useP2PTradeActions(input).partialFillTrade(snapshot('standard-v2'), '20');
    expect(value.quoteStandard).toHaveBeenCalledWith(7, 20n);
    expect(value.standard).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'fill', expectedRevision: '2', requestAmountIn: '20', minOfferAmountOut: '10'
    }));
    expect(input.ensureTradeFunding).toHaveBeenCalledWith(expect.objectContaining({
      confirmationPolicy: 'always',
      confirmationStats: [
        { label: 'COTI private inputs', value: '0 confirmations' },
        { label: 'On-chain action', value: '1 transaction' },
        { label: 'Private token setup', value: 'None' },
        { label: 'Token approval', value: 'B: if needed (1 transaction)' },
        { label: 'Chat notification', value: '0 transactions' }
      ]
    }));
    expect(input.getTradeSigner).not.toHaveBeenCalled();
    expect(input.refreshOneOffV2Trades).toHaveBeenCalled();
  });

  it('rejects Direct V2 and legacy Direct partial fills before any wallet or contract action', async () => {
    const value = runtime();
    const v2Input = args(value);

    await useP2PTradeActions(v2Input).partialFillTrade(snapshot('direct-v2'), '20');

    expect(value.direct).not.toHaveBeenCalled();
    expect(value.standard).not.toHaveBeenCalled();
    expect(v2Input.ensureTradeFunding).not.toHaveBeenCalled();
    expect(v2Input.setTradeActionError).toHaveBeenCalledWith(
      'Direct OTC offers are accepted in full and do not support partial fills.'
    );

    const legacy = {
      ...snapshot('direct-v2'),
      escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
      v2: undefined
    };
    const legacyInput = args(value);
    legacyInput.readTradeDetail.mockResolvedValueOnce(legacy);

    await useP2PTradeActions(legacyInput).partialFillTrade(legacy, '20');

    expect(value.direct).not.toHaveBeenCalled();
    expect(value.standard).not.toHaveBeenCalled();
    expect(legacyInput.ensureTradeFunding).not.toHaveBeenCalled();
    expect(legacyInput.setTradeActionError).toHaveBeenCalledWith(
      'Direct OTC offers are accepted in full and do not support partial fills.'
    );
  });

  it('accepts a fully-private V2 order with one packed fill action and no legacy fallback', async () => {
    const value = runtime();
    const input = args(value);
    await useP2PTradeActions(input).acceptTrade(snapshot('private-v2'));
    expect(value.privateTrade).toHaveBeenCalledWith({
      kind: 'fill', orderId: 7, expectedRevision: '2',
      terms: { mode: 'fully-private', maxRequestAmount: 200n, minOfferAmount: 100n }
    });
    expect(input.ensureTradeFunding).toHaveBeenCalledWith(expect.objectContaining({
      confirmationPolicy: 'always',
      confirmationStats: expect.arrayContaining([
        { label: 'COTI private inputs', value: '1 confirmation' },
        { label: 'Private token setup', value: 'B: if needed (1 one-time transaction)' },
        { label: 'Token approval', value: 'B: if needed (1 COTI confirmation + 1 transaction)' }
      ])
    }));
    expect(input.getTradeSigner).not.toHaveBeenCalled();
  });

  it('routes Direct V2 decline and cancel to the exact direct contract facade', async () => {
    const value = runtime();
    const input = args(value);
    const actions = useP2PTradeActions(input);
    await actions.declineTrade(snapshot('direct-v2'));
    await actions.cancelTrade(snapshot('direct-v2'));
    expect(value.direct).toHaveBeenNthCalledWith(1, { kind: 'decline', tradeId: 7 });
    expect(value.direct).toHaveBeenNthCalledWith(2, { kind: 'cancel', tradeId: 7 });
    expect(input.ensureTradeFunding).toHaveBeenNthCalledWith(1, expect.objectContaining({
      confirmationPolicy: 'always',
      confirmationStats: expect.arrayContaining([
        { label: 'COTI private inputs', value: '0 confirmations' },
        { label: 'Token approval', value: 'None' }
      ])
    }));
    expect(input.ensureTradeFunding).toHaveBeenNthCalledWith(2, expect.objectContaining({
      confirmationPolicy: 'always'
    }));
    expect(input.getTradeSigner).not.toHaveBeenCalled();
  });

  it('does not submit a V2 lifecycle action after the review is cancelled', async () => {
    const value = runtime();
    const input = args(value);
    input.ensureTradeFunding.mockRejectedValueOnce(new TradeActionConfirmationCancelledError());

    await useP2PTradeActions(input).cancelTrade(snapshot('standard-v2'));

    expect(value.standard).not.toHaveBeenCalled();
    expect(input.onActionNotice).toHaveBeenCalledWith(expect.objectContaining({
      action: 'cancel',
      status: 'info'
    }));
  });
});

const promoted = (mode: 'fully-private' | 'private-offer-public-request' | 'public-offer-private-request' = 'fully-private') => {
  const item: PrivateBookV2ProjectedSnapshot = { ...snapshot('private-v2'), isPublic: true, fillState: undefined,
    offer: { ...snapshot('private-v2').offer, amount: '1', kind: mode === 'public-offer-private-request' ? 'erc20' : 'private-erc20' },
    request: { ...snapshot('private-v2').request, amount: '2', kind: mode === 'private-offer-public-request' ? 'erc20' : 'private-erc20' },
    v2: { ...snapshot('private-v2').v2!, privateMode: mode },
    privateBook: { runtimeBytecodeHash: PRIVATE_BOOK_V2_RUNTIME_HASH, priceTerms: { offerAmount: '1', requestAmount: '2' }, fillBehavior: 'remaining-at-reviewed-price' }
  };
  const value = runtime();
  const view = { orderId: '7', revision: '2', status: 'open', mode: mode === 'fully-private' ? 'private-pair' : mode,
    priceTerms: item.privateBook.priceTerms, offerAsset: { assetType: item.offer.kind, token: TOKEN_A }, requestAsset: { assetType: item.request.kind, token: TOKEN_B }
  } as PrivateBookV2OrderView;
  const execute = vi.fn(async (_action: unknown) => ({ transactionHash: TX })); const read = vi.fn(async () => view);
  const current = { ...value, deployments: { ...value.deployments, 'private-v2': { ...value.deployments['private-v2'], runtimeBytecodeHash: PRIVATE_BOOK_V2_RUNTIME_HASH } },
    privateBook: { execute, read } } as unknown as OtcV2ActionRuntime;
  const input = args(current); input.readTradeDetail.mockResolvedValue(item);
  return { item, current, input, execute, read };
};

describe('promoted book action consumer (runtime admission mocked)', () => {
  const visibility = (visible = false) => {
    const f = promoted();
    f.input.walletAddress = MAKER;
    Object.assign(f.item.privateBook, { publicBudgetVisibility: visible });
    const readAccount = vi.fn(async () => ({ orderId: '7', sequence: '2', totalOfferAmount: '123', remainingOfferAmount: '61' }));
    Object.assign(f.current.privateBook!, { ownerAddress: MAKER, readAccount, budgetVisibilityAvailable: true });
    const originalRead = f.read.getMockImplementation()!;
    f.read.mockImplementation(async () => ({ ...await originalRead(), maker: MAKER }));
    return { ...f, readAccount };
  };
  it('publishes only after a fresh owner review and never funds or approves tokens', async () => {
    const f = visibility(); const actions = useP2PTradeActions(f.input);
    expect(f.execute).not.toHaveBeenCalled(); expect(f.readAccount).not.toHaveBeenCalled();
    await actions.changePrivateBookBudgetVisibility(f.item, true);
    expect(f.input.readTradeDetail).toHaveBeenCalledWith(7, PRIVATE);
    expect(f.execute).toHaveBeenCalledExactlyOnceWith({ kind: 'budget-visibility', orderId: 7, expectedRevision: '2', visible: true });
    expect(f.input.ensureTradeFunding).toHaveBeenCalledWith(expect.objectContaining({ requirements: [],
      confirmButtonLabel: 'Publish original budget', confirmTitle: 'Publish original budget',
      tradeSummary: expect.arrayContaining([{ label: 'Publish original budget', value: '123 A' },
        expect.objectContaining({ label: 'Disclosure', value: expect.stringContaining('cannot erase') })]) }));
    expect(f.input.refreshOneOffV2Trades).toHaveBeenCalledOnce();
    expect(f.input.onActionNotice).toHaveBeenCalledWith(expect.objectContaining({ action: 'budget-visibility', status: 'success', txHash: TX }));
  });
  it('Book budget native admission holds actions before fresh or private reads and confirmation', async () => {
    const f = visibility(); Object.assign(f.current.privateBook!, { budgetVisibilityAvailable: false });
    await useP2PTradeActions(f.input).changePrivateBookBudgetVisibility(f.item, true);
    expect(f.input.readTradeDetail).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled(); expect(f.readAccount).not.toHaveBeenCalled();
    expect(f.input.ensureTradeFunding).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
    expect(f.input.setTradeActionError).toHaveBeenCalledWith('Budget visibility is unavailable.');
  });
  it('Book budget native admission rejects a held retained scope before opening the wallet flow', async () => {
    const f = visibility(), flow = vi.fn();
    Object.assign(f.current, { forReference: vi.fn(async () => ({ ...f.current, privateBook: { ...f.current.privateBook!, budgetVisibilityAvailable: false } })) });
    await useP2PTradeActions({ ...f.input, runTradeWalletPromptFlow: <T,>(operation: () => Promise<T>): Promise<T> => {
      flow(); return operation();
    } }).changePrivateBookBudgetVisibility(f.item, true);
    expect(flow).not.toHaveBeenCalled(); expect(f.input.readTradeDetail).not.toHaveBeenCalled();
    expect(f.readAccount).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  });
  it('hides without reading private budget and skips a known unchanged setting', async () => {
    const f = visibility(true); const actions = useP2PTradeActions(f.input);
    await actions.changePrivateBookBudgetVisibility(f.item, false);
    expect(f.readAccount).not.toHaveBeenCalled();
    expect(f.input.ensureTradeFunding).toHaveBeenCalledWith(expect.objectContaining({ requirements: [], confirmButtonLabel: 'Hide budget', confirmTitle: 'Hide budget' }));
    expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ visible: false }));
    const unchanged = visibility(true);
    await useP2PTradeActions(unchanged.input).changePrivateBookBudgetVisibility(unchanged.item, true);
    expect(unchanged.execute).not.toHaveBeenCalled(); expect(unchanged.input.ensureTradeFunding).not.toHaveBeenCalled();
  });
  it.each(['owner', 'revision', 'unknown', 'missing'])('holds budget visibility after a fresh %s defect', async defect => {
    const f = visibility();
    if (defect === 'owner') f.input.walletAddress = OWNER;
    if (defect === 'revision') f.input.readTradeDetail.mockResolvedValueOnce({ ...f.item, v2: { ...f.item.v2!, revision: '3' } });
    if (defect === 'unknown') Object.assign(f.item.privateBook, { publicBudgetVisibility: undefined });
    if (defect === 'missing') f.input.readTradeDetail.mockResolvedValueOnce(null);
    await useP2PTradeActions(f.input).changePrivateBookBudgetVisibility(f.item, true);
    expect(f.execute).not.toHaveBeenCalled(); expect(f.input.ensureTradeFunding).not.toHaveBeenCalled();
  });
  it.each(['openTrade', 'refreshOneOffV2Trades'] as const)('keeps confirmed fill identity when %s throws', async callback => {
    const { item, input, execute } = promoted();
    input[callback].mockImplementation(() => { throw new Error('Display unavailable'); });
    await useP2PTradeActions(input).partialFillTrade(item, '20');
    expect(execute).toHaveBeenCalledOnce();
    expect(input.onActionNotice).toHaveBeenCalledWith(expect.objectContaining({ action: 'fill', status: 'success', txHash: TX,
      message: expect.stringContaining('display') }));
    expect(input.onActionNotice.mock.calls.some(([notice]) => notice.status === 'error')).toBe(false);
    expect(input.setTradeActionError).toHaveBeenCalledWith(expect.stringContaining('Do not submit'));
    expect(input.refreshOneOffV2Trades).toHaveBeenCalledOnce();
  });
  it('keeps confirmed cancellation identity when list refresh throws', async () => {
    const { item, input, execute } = promoted();
    input.refreshOneOffV2Trades.mockImplementation(() => { throw new Error('Display unavailable'); });
    await useP2PTradeActions(input).cancelTrade(item);
    expect(execute).toHaveBeenCalledOnce();
    expect(input.onActionNotice).toHaveBeenCalledWith(expect.objectContaining({ action: 'cancel', status: 'success', txHash: TX }));
    expect(input.onActionNotice.mock.calls.some(([notice]) => notice.status === 'error')).toBe(false);
  });
  it('keeps a rejected execution as failure and does not refresh the display', async () => {
    const { item, input, execute } = promoted();
    execute.mockRejectedValueOnce(new Error('Execution rejected'));
    await useP2PTradeActions(input).partialFillTrade(item, '20');
    expect(input.onActionNotice).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
    expect(input.openTrade).not.toHaveBeenCalled(); expect(input.refreshOneOffV2Trades).not.toHaveBeenCalled();
    expect(input.setTradeActionError).toHaveBeenCalledWith('Execution rejected');
  });
  it.each(['fully-private', 'private-offer-public-request', 'public-offer-private-request'] as const)('reviews exact maximum above price units for %s', async mode => {
    const { item, current, input, execute } = promoted(mode);
    await useP2PTradeActions(input).partialFillTrade(item, '20', { tradeSummary: [{ label: 'Bad override', value: 'Do not show' }] });
    expect(current.privateTrade).not.toHaveBeenCalled(); expect(input.getTradeSigner).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toMatchObject({ kind: 'fill', orderId: 7, expectedRevision: '2', terms: { priceTerms: { offerAmount: '1', requestAmount: '2' }, fillBehavior: 'remaining-at-reviewed-price' } });
    expect(input.ensureTradeFunding).toHaveBeenCalledWith(expect.objectContaining({ confirmationPolicy: 'always',
      requirements: [expect.objectContaining({ amountWei: 20n })], tradeSummary: expect.arrayContaining([
        { label: 'Maximum payment', value: '20 B' }, expect.objectContaining({ label: 'Output', value: expect.stringContaining('No minimum output') })]) }));
    expect(input.ensureTradeFunding.mock.calls[0]?.[0]?.tradeSummary).not.toContainEqual({ label: 'Bad override', value: 'Do not show' });
    expect(input.refreshOneOffV2Trades).toHaveBeenCalled();
  });
  it('requires reviewed maximum rather than treating price units as a full order', async () => {
    const { item, input, execute } = promoted(); await useP2PTradeActions(input).acceptTrade(item);
    expect(input.setTradeActionError).toHaveBeenCalledWith(expect.stringContaining('maximum payment'));
    expect(input.ensureTradeFunding).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it('does not send after missing confirmation, declined review or runtime closure', async () => {
    const a = promoted(); await useP2PTradeActions({ ...a.input, ensureTradeFunding: undefined }).partialFillTrade(a.item, '20');
    expect(a.execute).not.toHaveBeenCalled(); expect(a.input.setTradeActionError).toHaveBeenCalledWith(expect.stringContaining('transaction review'));
    const b = promoted(); b.input.ensureTradeFunding.mockRejectedValueOnce(new TradeActionConfirmationCancelledError());
    await useP2PTradeActions(b.input).partialFillTrade(b.item, '20'); expect(b.execute).not.toHaveBeenCalled();
    const c = promoted(); let alive = true; Object.assign(c.current, { isCurrent: () => alive });
    c.input.ensureTradeFunding.mockImplementation(async () => { alive = false; });
    await useP2PTradeActions(c.input).partialFillTrade(c.item, '20'); expect(c.execute).not.toHaveBeenCalled();
  });
  it('rejects stale current terms and wrong deployment before funding', async () => {
    const a = promoted(); a.read.mockResolvedValueOnce({ ...(await a.read()), revision: '3' });
    await useP2PTradeActions(a.input).partialFillTrade(a.item, '20'); expect(a.input.ensureTradeFunding).not.toHaveBeenCalled(); expect(a.execute).not.toHaveBeenCalled();
    const b = promoted(); b.input.readTradeDetail.mockResolvedValueOnce({ ...b.item, escrowContract: STANDARD });
    await useP2PTradeActions(b.input).partialFillTrade(b.item, '20'); expect(b.input.ensureTradeFunding).not.toHaveBeenCalled(); expect(b.execute).not.toHaveBeenCalled();
  });
  it('rejects a current snapshot on an old runtime and old terms on the current runtime', async () => {
    const a = promoted(); Object.assign(a.current.deployments['private-v2'], { runtimeBytecodeHash: 'old' });
    await useP2PTradeActions(a.input).partialFillTrade(a.item, '20'); expect(a.input.ensureTradeFunding).not.toHaveBeenCalled(); expect(a.execute).not.toHaveBeenCalled();
    const b = promoted(); b.input.readTradeDetail.mockResolvedValueOnce(snapshot('private-v2'));
    await useP2PTradeActions(b.input).partialFillTrade(b.item, '20'); expect(b.input.ensureTradeFunding).not.toHaveBeenCalled(); expect(b.execute).not.toHaveBeenCalled();
  });
  it('cancels through the exact reviewed current API with no token funding', async () => {
    const { item, current, input, execute } = promoted(); await useP2PTradeActions(input).cancelTrade(item);
    expect(execute).toHaveBeenCalledWith({ kind: 'cancel', orderId: 7 }); expect(current.privateTrade).not.toHaveBeenCalled();
    expect(input.ensureTradeFunding).toHaveBeenCalledWith(expect.objectContaining({ requirements: [], tradeSummary: expect.arrayContaining([expect.objectContaining({ label: 'Action', value: expect.stringContaining('return remaining') })]) }));
  });
});
