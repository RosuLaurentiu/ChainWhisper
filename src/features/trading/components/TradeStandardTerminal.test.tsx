import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload,
  type TradeSnapshot
} from '../../../lib/appShared';
import { PRIVATE_BOOK_V2_RUNTIME_HASH } from '../../../lib/privateBookV2Actions';
import type { PrivateBookV2ProjectedSnapshot } from '../../../lib/oneOffTradeV2Snapshot';
import { CURRENT_P2P_BINDING } from '../../../lib/currentP2PBinding';
import TradeStandardTerminal from './TradeStandardTerminal';
import { buildMakerControlsKey } from './P2PTradingPage.helpers';
import { getSnapshotKey } from '../../../lib/p2pTradeView';

const maker = '0x1111111111111111111111111111111111111111';
const taker = '0x2222222222222222222222222222222222222222';

const asset = (symbol: string, tokenAddress: string): TradeAssetPayload => ({
  kind: 'private-erc20',
  tokenAddress,
  symbol,
  decimals: 6,
  amount: '100000000'
});

const directTrade: TradeSnapshot = {
  tradeId: 3,
  escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  maker,
  taker,
  offer: asset('cwTPB', '0x3333333333333333333333333333333333333333'),
  request: asset('cwTPQ', '0x4444444444444444444444444444444444444444'),
  createdAt: 1,
  expiresAt: 0,
  status: 'open',
  hiddenLiquidity: true,
  v2: {
    protocol: 'direct-v2',
    chainId: '7082400',
    contractAddress: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
    amountMode: 'private'
  }
};

const privateBudgetTrade: TradeSnapshot = {
  ...directTrade,
  tradeId: 4,
  escrowContract: undefined,
  taker: '0x0000000000000000000000000000000000000000',
  isPublic: false,
  hasAccessHash: true,
  v2: undefined
};

const render = (
  snapshot: TradeSnapshot | PrivateBookV2ProjectedSnapshot = directTrade,
  inputs: { pay?: string; buy?: string; wallet?: string; route?: string; manage?: boolean; budgetAdmitted?: boolean; balanceContext?: boolean } = {}
): string => renderToStaticMarkup(createElement(TradeStandardTerminal, {
  snapshot,
  routeView: inputs.route ?? 'trade',
  walletAddress: inputs.wallet ?? taker,
  walletKey: (inputs.wallet ?? taker).toLowerCase(),
  onCotiNetwork: true,
  lastCopiedKey: '',
  reversedRateTradeIds: {},
  expandedMakerControls: inputs.manage ? { [buildMakerControlsKey('terminal', getSnapshotKey(snapshot))]: true } : {},
  terminalFillInputSide: 'pay',
  terminalPayInput: inputs.pay ?? '',
  terminalBuyInput: inputs.buy ?? '',
  processingTradeActionId: '',
  terminalHistorySheetKey: '',
  setTerminalFillInputSide: vi.fn(),
  setTerminalPayInput: vi.fn(),
  setTerminalBuyInput: vi.fn(),
  setTerminalHistorySheetKey: vi.fn(),
  acceptTrade: vi.fn(async () => {}),
  askAgentAboutOrder: vi.fn(),
  beginCounterTrade: vi.fn(),
  beginEditTrade: vi.fn(),
  buildTradeShareUrl: vi.fn(() => ''),
  cancelTrade: vi.fn(async () => {}),
  changePrivateBookBudgetVisibility: vi.fn(async () => {}),
  bookBudgetAdmission: inputs.budgetAdmitted ? { chainId: snapshot.v2!.chainId, contractAddress: snapshot.v2!.contractAddress,
    runtimeBytecodeHash: (snapshot as PrivateBookV2ProjectedSnapshot).privateBook.runtimeBytecodeHash, mode: 'active' } : undefined,
  renderTradeBalanceDisclosure: inputs.balanceContext ? trade => createElement('span', null, `Selected balance sharing ${trade.tradeId}`) : undefined,
  copyWithFeedback: vi.fn(async () => {}),
  declineTrade: vi.fn(async () => {}),
  getCarbonReferenceDisplay: vi.fn(() => null),
  getStandardTerminalHistoryConfig: vi.fn(() => ({
    tradeKey: 'direct-v2:3',
    title: 'Direct OTC #3',
    count: 0,
    emptyCopy: 'No history yet.'
  })),
  partialFillTrade: vi.fn(async () => {}),
  renderActionNotice: vi.fn(() => null),
  renderTradeConversationButton: vi.fn(() => null),
  resolveKnownTradeAccessSecret: vi.fn(() => ''),
  resolveTerminalAssetBalanceLabel: vi.fn(() => 'Bal 0'),
  toggleMakerControls: vi.fn(),
  toggleTradeRateDirection: vi.fn()
}));

describe('TradeStandardTerminal Direct V2 full-fill ticket', () => {
  it('shows the counter control for the current private Direct recipient and omits it for the maker', () => {
    const deployment = CURRENT_P2P_BINDING.deployments['direct-v2'];
    const current = { ...directTrade, escrowContract: deployment.contractAddress,
      v2: { ...directTrade.v2!, contractAddress: deployment.contractAddress, chainId: deployment.chainId } };
    expect(CURRENT_P2P_BINDING.directCounterAppActivated).toBe(true);
    expect(render(current)).toContain('>Counter</button>');
    expect(render(current, { wallet: maker })).not.toContain('>Counter</button>');
  });

  it('shows the fixed bilateral amounts and no partial-fill calculator', () => {
    const markup = render();

    expect(markup).toContain('100 cwTPQ');
    expect(markup).toContain('100 cwTPB');
    expect(markup).toContain('Buy 100 cwTPB');
    expect(markup).not.toContain('Trade amount calculator');
    expect(markup).not.toContain('Enter amount');
    expect(markup).not.toContain('<input');
  });

  it('keeps legacy Direct offers on the same fixed full-fill path', () => {
    const markup = render({ ...directTrade, v2: undefined });

    expect(markup).toContain('100 cwTPQ');
    expect(markup).toContain('100 cwTPB');
    expect(markup).toContain('Buy 100 cwTPB');
    expect(markup).not.toContain('Trade amount calculator');
    expect(markup).not.toContain('Enter amount');
    expect(markup).not.toContain('<input');
  });
});

describe('TradeStandardTerminal private-budget fill ticket', () => {
  it('treats the entered amount as a maximum and never blocks it against hidden liquidity', () => {
    const markup = render(privateBudgetTrade, { pay: '500' });

    expect(markup).toContain('Maximum amount:');
    expect(markup).toContain('the remainder returns');
    expect(markup).toContain('Buy up to 500 cwTPB');
    expect(markup).not.toContain('Amount too high');
    expect(markup).not.toContain('cannot be filled');
  });
});

const currentBook: PrivateBookV2ProjectedSnapshot = { ...privateBudgetTrade, escrowContract: '0x6666666666666666666666666666666666666666',
  isPublic: true, hasAccessHash: false, offer: { ...privateBudgetTrade.offer, amount: '1' }, request: { ...privateBudgetTrade.request, amount: '2' },
  v2: { protocol: 'private-v2', chainId: '7082400', contractAddress: '0x6666666666666666666666666666666666666666', revision: '2', amountMode: 'private', privateMode: 'fully-private' },
  privateBook: { runtimeBytecodeHash: PRIVATE_BOOK_V2_RUNTIME_HASH, priceTerms: { offerAmount: '1', requestAmount: '2' }, fillBehavior: 'remaining-at-reviewed-price',
    ownerBudget: { orderId: '4', sequence: '2', recipient: maker, totalOfferAmount: '123000000', totalRequestAmount: '246000000', remainingOfferAmount: '61000000' } }
};
describe('promoted public-price private book terminal', () => {
  it('contextual trade balance controls use the selected trade and stay out of public views', () => {
    expect(render(currentBook, { wallet: maker, balanceContext: true })).toContain('Selected balance sharing 4');
    expect(render(currentBook, { wallet: maker, route: 'public', balanceContext: true })).not.toContain('Selected balance sharing');
  });
  it('offers publication only to the maker with fresh private budget and known hidden status', () => {
    const hidden = { ...currentBook, privateBook: { ...currentBook.privateBook, publicBudgetVisibility: false } };
    expect(render(hidden, { wallet: maker, manage: true, budgetAdmitted: true })).toContain('Publish original budget');
    expect(render(hidden, { wallet: taker, manage: true, budgetAdmitted: true })).not.toContain('Publish original budget');
    expect(render(hidden, { wallet: maker, route: 'public', manage: true, budgetAdmitted: true })).not.toContain('Publish original budget');
    expect(render({ ...hidden, privateBook: { ...hidden.privateBook, ownerBudget: undefined } }, { wallet: maker, manage: true, budgetAdmitted: true })).not.toContain('Publish original budget');
    expect(render(currentBook, { wallet: maker, manage: true, budgetAdmitted: true })).toContain('Budget visibility unavailable');
    expect(render(hidden, { wallet: maker, manage: true })).toContain('Budget visibility unavailable');
    expect(render(hidden, { wallet: maker, manage: true })).not.toContain('Publish original budget');
  });
  it('shows only the explicitly published original budget on the public route and permits hiding without private data', () => {
    const published = { ...currentBook, privateBook: { ...currentBook.privateBook, publicBudgetVisibility: true, publicOfferBudget: '123000000' } };
    const markup = render(published, { wallet: maker, route: 'public' });
    expect(markup).toContain('Published original budget'); expect(markup).toContain('123 cwTPB');
    expect(markup).not.toContain('61 cwTPB'); expect(markup).not.toContain('Your private escrow budget');
    const withoutPrivate = { ...published, privateBook: { ...published.privateBook, ownerBudget: undefined } };
    expect(render(withoutPrivate, { wallet: maker, manage: true, budgetAdmitted: true })).toContain('Hide budget');
    expect(render(withoutPrivate, { wallet: taker, manage: true, budgetAdmitted: true })).not.toContain('Hide budget');
    expect(render({ ...published, privateBook: { ...published.privateBook, publicOfferBudget: undefined } }, { route: 'public' })).not.toContain('123 cwTPB');
  });
  it('labels maximums, allows input above price units and states zero output without exposing maker budget', () => {
    const markup = render(currentBook, { pay: '500' });
    expect(markup).toContain('Maximum payment cwTPQ'); expect(markup).toContain('Receive up to cwTPB');
    expect(markup).toContain('There is no minimum output'); expect(markup).toContain('zero output and your full payment');
    expect(markup).toContain('Buy up to 250 cwTPB'); expect(markup).not.toContain('Amount too high');
    expect(markup).not.toContain('123 cwTPB'); expect(markup).not.toContain('61 cwTPB');
    expect(markup).not.toContain('>Counter</button>');
  });
  it('shows only the maker recorded escrow budget without estimated fill or proceeds', () => {
    const markup = render(currentBook, { wallet: maker });
    expect(markup).toContain('Your private escrow budget'); expect(markup).toContain('123 cwTPB'); expect(markup).toContain('61 cwTPB');
    expect(markup).not.toContain('246 cwTPQ'); expect(markup).not.toContain('Fill progress');
    expect(render(currentBook, { wallet: maker, route: 'public' })).not.toContain('Your private escrow budget');
    expect(render({ ...currentBook, privateBook: { ...currentBook.privateBook, ownerBudget: undefined } } as PrivateBookV2ProjectedSnapshot, { wallet: maker })).not.toContain('Your private escrow budget');
  });
});
