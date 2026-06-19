import { describe, expect, it } from 'vitest';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeSnapshot
} from './appShared';
import {
  buildLinkedTradeContext,
  buildTradeMessageReferenceFromContext,
  extractTradeTerminalPathFromMessage,
  resolveTradeChatTarget
} from './linkedTradeContext';
import { encodeTradeLink } from './tradeLinks';
import { buildTradeTerminalPath } from '../hooks/useP2PTradeRoute';

const maker = '0x1111111111111111111111111111111111111111';
const taker = '0x2222222222222222222222222222222222222222';
const otherWallet = '0x3333333333333333333333333333333333333333';
const zeroAddress = '0x0000000000000000000000000000000000000000';
const accessSecret = `0x${'12'.repeat(32)}`;

const createSnapshot = (overrides: Partial<TradeSnapshot> = {}): TradeSnapshot => ({
  tradeId: 42,
  escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
  maker,
  taker,
  offer: {
    kind: 'native',
    symbol: 'COTI',
    decimals: 18,
    amount: '1000000000000000000'
  },
  request: {
    kind: 'erc20',
    tokenAddress: '0x4444444444444444444444444444444444444444',
    symbol: 'USDC',
    decimals: 6,
    amount: '1000000'
  },
  createdAt: 1_700_000_000,
  expiresAt: 1_700_086_400,
  status: 'open',
  ...overrides
});

describe('linkedTradeContext', () => {
  it('targets the maker when the current wallet is not the maker', () => {
    expect(resolveTradeChatTarget(createSnapshot(), otherWallet)).toEqual({
      address: maker,
      role: 'maker'
    });
  });

  it('targets a fixed taker when the maker owns the trade', () => {
    expect(resolveTradeChatTarget(createSnapshot(), maker)).toEqual({
      address: taker,
      role: 'taker'
    });
  });

  it('does not target anyone for maker-owned open offers without a fixed taker', () => {
    expect(resolveTradeChatTarget(createSnapshot({ taker: zeroAddress }), maker)).toBeNull();
  });

  it('does not target anyone without a connected wallet or valid maker', () => {
    expect(resolveTradeChatTarget(createSnapshot(), '')).toBeNull();
    expect(resolveTradeChatTarget(createSnapshot({ maker: 'not-an-address' }), otherWallet)).toBeNull();
  });

  it('builds a compact linked trade context from a snapshot', () => {
    const snapshot = createSnapshot({ escrowContract: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS });
    const terminalPath = buildTradeTerminalPath(snapshot.tradeId, accessSecret, snapshot.escrowContract);
    const context = buildLinkedTradeContext({
      counterpartyAddress: maker,
      shareUrl: 'https://chainwhisper.example/trades/l/example',
      snapshot,
      source: 'terminal',
      terminalPath
    });

    expect(context).toMatchObject({
      counterpartyAddress: maker,
      escrowContract: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
      source: 'terminal',
      terminalPath,
      tradeId: 42
    });
    expect(context.previewOffer).toMatchObject({
      tradeId: 42,
      maker,
      taker
    });
  });

  it('builds a message trade reference from linked context', () => {
    const snapshot = createSnapshot();
    const terminalPath = buildTradeTerminalPath(snapshot.tradeId, accessSecret, snapshot.escrowContract);
    const context = buildLinkedTradeContext({
      counterpartyAddress: maker,
      snapshot,
      source: 'terminal',
      terminalPath
    });

    expect(buildTradeMessageReferenceFromContext(context)).toMatchObject({
      version: 1,
      tradeId: 42,
      escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
      terminalPath: buildTradeTerminalPath(snapshot.tradeId, undefined, snapshot.escrowContract)
    });
  });

  it('extracts canonical terminal paths from internal trade links', () => {
    const privateCode = encodeTradeLink(8, accessSecret);
    expect(
      extractTradeTerminalPathFromMessage(
        `Open /trades/l/${privateCode}?escrow=private when ready.`,
        'https://chainwhisper.app'
      )
    ).toBe(buildTradeTerminalPath(8, accessSecret, PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS));

    expect(
      extractTradeTerminalPathFromMessage(
        `Use /otcdesk/terminal/l/${privateCode}?escrow=direct`,
        'https://chainwhisper.app'
      )
    ).toBe(buildTradeTerminalPath(8, accessSecret, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS));
  });

  it('extracts terminal paths from same-origin redirected app links', () => {
    const directPath = `/trades/l/${encodeTradeLink(9, accessSecret)}?escrow=direct`;
    expect(
      extractTradeTerminalPathFromMessage(
        `Use https://chainwhisper.app/?p=${encodeURIComponent(directPath)}`,
        'https://chainwhisper.app'
      )
    ).toBe(buildTradeTerminalPath(9, accessSecret, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS));
  });

  it('ignores external trade-looking links', () => {
    const code = encodeTradeLink(10, accessSecret);
    expect(
      extractTradeTerminalPathFromMessage(`Use https://evil.example/trades/l/${code}`, 'https://chainwhisper.app')
    ).toBeNull();
  });
});
