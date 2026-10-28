import { Interface } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import { CURRENT_P2P_BINDING } from './currentP2PBinding';
import {
  TRADE_HISTORY_V2_EVENT_ABIS,
  getTradeHistoryV2EventInterface,
  PRIVATE_BOOK_V2_HISTORY_RUNTIME_HASH,
  materializeDirectTradeV2Acceptance,
  materializeTradeHistoryV2ParticipantReceipt,
  parseTradeHistoryV2Log,
  type ParsedTradeHistoryV2Execution,
  type ParsedTradeHistoryV2PrivateReceipt,
  type ParsedDirectTradeV2Opened,
  type ParsedDirectTradeV2Status,
  type ParsedTradeHistoryV2Lifecycle,
  type TradeHistoryV2EventProtocol,
  type TradeHistoryV2RawLog
} from './tradeHistoryV2Events';
import currentArtifact from '../../tests/fixtures/validation-ChainWhisperPrivateOTCEscrowV2.json';

const CHAIN_ID = '7082400';

describe('runtime-bound promoted private book events', () => {
  const promoted = new Interface(currentArtifact.abi);
  const raw = (name: string, args: readonly unknown[]): TradeHistoryV2RawLog => {
    const encoded = promoted.encodeEventLog(promoted.getEvent(name)!, [...args]);
    return { address: CONTRACT, ...encoded, blockNumber: '0x64', blockHash: bytes32(100), transactionHash: bytes32(1000), transactionIndex: '0x2', logIndex: '0x0', removed: false };
  };
  const parseCurrent = (log: TradeHistoryV2RawLog) => parseTradeHistoryV2Log({ protocol: 'private-v2', chainId: CHAIN_ID, contractAddress: CONTRACT, runtimeBytecodeHash: PRIVATE_BOOK_V2_HISTORY_RUNTIME_HASH, log });
  it.each([PRIVATE_BOOK_V2_HISTORY_RUNTIME_HASH, CURRENT_P2P_BINDING.deployments['private-v2'].runtimeBytecodeHash])('matches the current artifact for %s', runtimeBytecodeHash => {
    const selected = getTradeHistoryV2EventInterface('private-v2', runtimeBytecodeHash);
    for (const fragment of selected.fragments) expect(promoted.getEvent(fragment.format('sighash'))?.format('full')).toBe(fragment.format('full'));
  });
  it.each([PRIVATE_BOOK_V2_HISTORY_RUNTIME_HASH, CURRENT_P2P_BINDING.deployments['private-v2'].runtimeBytecodeHash])('retains price without budget for %s', runtimeBytecodeHash => {
    const log = raw('PrivateOrderOpened', [1n, MAKER, bytes32(1), 0, 2, CONTRACT, 0n, 2, OTHER_CONTRACT, 0n, [3n, 2n], [false, 0, 0], 100n, 0n, 1n, 1n]);
    const parsed = parseTradeHistoryV2Log({ protocol: 'private-v2', chainId: CHAIN_ID, contractAddress: CONTRACT, runtimeBytecodeHash, log });
    expect(parsed).toMatchObject({ kind: 'lifecycle', publicPriceTerms: { offerAmount: '3', requestAmount: '2' } });
    expect(parseTradeHistoryV2Log({ protocol: 'private-v2', chainId: CHAIN_ID, contractAddress: CONTRACT, log })).toBeUndefined();
    expect(parsed).not.toHaveProperty('amounts');
  });
  it('reads a 64-bit fill marker without a false finality flag or private amounts', () => {
    const parsed = parseCurrent(raw('PrivateOrderFilled', [1n, FILLER, MAKER, 0, 301n, 300n, 0n, 0n]));
    expect(parsed).toMatchObject({ kind: 'execution', contractRevision: '301', observation: { sequence: '300', source: 'private-marker', amounts: {} } });
    expect(parsed).not.toHaveProperty('finalFill');
  });
  it('keeps the old instance decoder and rejects unknown explicit runtime identity', () => {
    expect(getTradeHistoryV2EventInterface('private-v2', '0xe20848f75e59634a16c7d33dd393e91698292a9b29400d456ff57ab0c04ac680').getEvent('PrivateOrderFilled')?.topicHash).toBe(interfaces['private-v2'].getEvent('PrivateOrderFilled')?.topicHash);
    expect(() => getTradeHistoryV2EventInterface('private-v2', bytes32(123))).toThrow(/no admitted/);
  });
});
const CONTRACT = '0x1000000000000000000000000000000000000001';
const OTHER_CONTRACT = '0x2000000000000000000000000000000000000002';
const MAKER = '0x3000000000000000000000000000000000000003';
const FILLER = '0x4000000000000000000000000000000000000004';
const bytes32 = (value: number): string => `0x${value.toString(16).padStart(64, '0')}`;
const encryptedUint256 = (
  userCiphertextHigh: bigint,
  userCiphertextLow = 0n,
  ciphertextHigh = 1n,
  ciphertextLow = 2n
) => [[ciphertextHigh, ciphertextLow], [userCiphertextHigh, userCiphertextLow]] as const;

const interfaces = {
  'standard-v2': new Interface(TRADE_HISTORY_V2_EVENT_ABIS.standard),
  'private-v2': new Interface(TRADE_HISTORY_V2_EVENT_ABIS.private),
  'recurring-v2': new Interface(TRADE_HISTORY_V2_EVENT_ABIS.recurring),
  'private-recurring-v2': new Interface(TRADE_HISTORY_V2_EVENT_ABIS.privateRecurring),
  'direct-v2': new Interface(TRADE_HISTORY_V2_EVENT_ABIS.direct)
} as const;

const rawEvent = ({
  protocol,
  eventName,
  args,
  logIndex = 0,
  transactionHash = bytes32(1000)
}: {
  protocol: TradeHistoryV2EventProtocol;
  eventName: string;
  args: readonly unknown[];
  logIndex?: number;
  transactionHash?: string;
}): TradeHistoryV2RawLog => {
  const event = interfaces[protocol].getEvent(eventName);
  if (!event) throw new Error(`Missing event ${eventName}.`);
  const encoded = interfaces[protocol].encodeEventLog(event, [...args]);
  return {
    address: CONTRACT,
    topics: encoded.topics,
    data: encoded.data,
    blockNumber: '0x64',
    blockHash: bytes32(100),
    transactionHash,
    transactionIndex: '0x2',
    logIndex: `0x${logIndex.toString(16)}`,
    removed: false
  };
};

const parse = (
  protocol: TradeHistoryV2EventProtocol,
  log: TradeHistoryV2RawLog
) => parseTradeHistoryV2Log({ protocol, chainId: CHAIN_ID, contractAddress: CONTRACT, log });

describe('tradeHistoryV2Events', () => {
  it('normalizes a standard fill using the actual fill amounts and revision-derived sequence', () => {
    const parsed = parse('standard-v2', rawEvent({
      protocol: 'standard-v2',
      eventName: 'StandardTradeFilled',
      args: [7n, FILLER, MAKER, 25n, 10n, 90n, 225n, 2n, false]
    })) as ParsedTradeHistoryV2Execution;

    expect(parsed.kind).toBe('execution');
    expect(parsed.contractRevision).toBe('2');
    expect(parsed.observation).toMatchObject({
      protocol: 'standard-v2',
      sequence: '1',
      side: 'fill',
      source: 'public-event',
      amounts: { offerAmount: '10', requestAmount: '25' },
      postState: { remainingOfferAmount: '90', remainingRequestAmount: '225' }
    });
  });

  it('normalizes public recurring buy and sell executions with exact inventory after the trade', () => {
    const buy = parse('recurring-v2', rawEvent({
      protocol: 'recurring-v2',
      eventName: 'RecurringOrderExecuted',
      args: [8n, FILLER, MAKER, 0, 4n, 9n, 50n, 75n, 950n, 425n]
    })) as ParsedTradeHistoryV2Execution;
    const sell = parse('recurring-v2', rawEvent({
      protocol: 'recurring-v2',
      eventName: 'RecurringOrderExecuted',
      args: [8n, FILLER, MAKER, 1, 5n, 10n, 20n, 35n, 970n, 390n],
      logIndex: 1
    })) as ParsedTradeHistoryV2Execution;

    expect(buy.observation).toMatchObject({
      sequence: '4',
      side: 'buy',
      amounts: { baseAmount: '50', quoteAmount: '75' },
      postState: { baseInventory: '950', quoteInventory: '425' }
    });
    expect(sell.observation).toMatchObject({ sequence: '5', side: 'sell' });
  });

  it('keeps mixed private fill markers amount-free and materializes only a same-transaction receipt', () => {
    const marker = parse('private-v2', rawEvent({
      protocol: 'private-v2',
      eventName: 'PrivateOrderFilled',
      args: [9n, FILLER, MAKER, 1, 3n, 2, false, 0n, 500n],
      logIndex: 2
    })) as ParsedTradeHistoryV2Execution;
    const receipt = parse('private-v2', rawEvent({
      protocol: 'private-v2',
      eventName: 'PrivateOrderAccountSnapshotUpdated',
      args: [
        9n, FILLER, FILLER, 3n,
        encryptedUint256(1000n), encryptedUint256(2000n), encryptedUint256(900n),
        encryptedUint256(111n), encryptedUint256(500n)
      ],
      logIndex: 3
    })) as ParsedTradeHistoryV2PrivateReceipt;

    expect(marker.observation).toMatchObject({
      sequence: '2',
      source: 'private-marker',
      amounts: {}
    });
    expect(receipt.encryptedAmounts).toEqual({
      offerAmount: {
        ciphertextHigh: '1', ciphertextLow: '2',
        userCiphertextHigh: '111', userCiphertextLow: '0'
      },
      requestAmount: {
        ciphertextHigh: '1', ciphertextLow: '2',
        userCiphertextHigh: '500', userCiphertextLow: '0'
      }
    });
    expect(materializeTradeHistoryV2ParticipantReceipt({
      receipt,
      marker,
      decryptedAmounts: { offerAmount: '100', requestAmount: '500' }
    })).toMatchObject({
      sequence: '2',
      source: 'participant-receipt',
      recipient: FILLER.toLowerCase(),
      amounts: { offerAmount: '100', requestAmount: '500' }
    });
  });

  it('joins private recurring receipts by exact execution index and side', () => {
    const marker = parse('private-recurring-v2', rawEvent({
      protocol: 'private-recurring-v2',
      eventName: 'PrivateRecurringOrderExecuted',
      args: [10n, FILLER, MAKER, 1, 6n, 12n],
      logIndex: 4
    })) as ParsedTradeHistoryV2Execution;
    const receipt = parse('private-recurring-v2', rawEvent({
      protocol: 'private-recurring-v2',
      eventName: 'PrivateRecurringExecutionReceiptUpdated',
      args: [10n, MAKER, FILLER, 1, 6n, encryptedUint256(900n), encryptedUint256(901n)],
      logIndex: 5
    })) as ParsedTradeHistoryV2PrivateReceipt;

    expect(materializeTradeHistoryV2ParticipantReceipt({
      receipt,
      marker,
      decryptedAmounts: { baseAmount: '80', quoteAmount: '120' }
    })).toMatchObject({
      protocol: 'private-recurring-v2',
      sequence: '6',
      side: 'sell',
      recipient: MAKER.toLowerCase(),
      amounts: { baseAmount: '80', quoteAmount: '120' }
    });
  });

  it('counts a public direct trade only after its exact Open-to-Accepted transition', () => {
    const opened = parse('direct-v2', rawEvent({
      protocol: 'direct-v2',
      eventName: 'DirectTradeOpened',
      args: [12n, MAKER, FILLER, '0x0000000000000000000000000000000000000000', 0n, 12n, 0, 0, '0x0000000000000000000000000000000000000000', 1, OTHER_CONTRACT, 0, 75n, 120n, 1n, 999999n]
    })) as ParsedDirectTradeV2Opened;
    const accepted = parse('direct-v2', rawEvent({
      protocol: 'direct-v2',
      eventName: 'DirectTradeStatusChanged',
      args: [12n, MAKER, FILLER, 1, 2, FILLER, 12n, 1_700_000_012n],
      logIndex: 1
    })) as ParsedDirectTradeV2Status;

    expect(materializeDirectTradeV2Acceptance({ opened, status: accepted })).toMatchObject({
      protocol: 'direct-v2',
      sequence: '1',
      participant: FILLER.toLowerCase(),
      side: 'accept',
      source: 'public-event',
      amounts: { offerAmount: '75', requestAmount: '120' },
      log: { logIndex: 1 }
    });
  });

  it('keeps private direct acceptances hidden for outsiders and exposes exact terms only to a participant', () => {
    const opened = parse('direct-v2', rawEvent({
      protocol: 'direct-v2',
      eventName: 'DirectTradeOpened',
      args: [13n, MAKER, FILLER, '0x0000000000000000000000000000000000000000', 0n, 13n, 0, 2, OTHER_CONTRACT, 2, CONTRACT, 1, 0n, 0n, 1n, 999999n]
    })) as ParsedDirectTradeV2Opened;
    const accepted = parse('direct-v2', rawEvent({
      protocol: 'direct-v2',
      eventName: 'DirectTradeStatusChanged',
      args: [13n, MAKER, FILLER, 1, 2, FILLER, 13n, 1_700_000_013n],
      logIndex: 1
    })) as ParsedDirectTradeV2Status;

    expect(materializeDirectTradeV2Acceptance({ opened, status: accepted })).toMatchObject({
      source: 'private-marker',
      amounts: {}
    });
    expect(materializeDirectTradeV2Acceptance({
      opened,
      status: accepted,
      recipient: MAKER,
      decryptedAmounts: { offerAmount: '55', requestAmount: '89' }
    })).toMatchObject({
      source: 'participant-receipt',
      recipient: MAKER.toLowerCase(),
      amounts: { offerAmount: '55', requestAmount: '89' }
    });
  });

  it('does not count direct cancel, decline, or unrelated acceptance status as traded volume', () => {
    const opened = parse('direct-v2', rawEvent({
      protocol: 'direct-v2',
      eventName: 'DirectTradeOpened',
      args: [14n, MAKER, FILLER, '0x0000000000000000000000000000000000000000', 0n, 14n, 0, 0, '0x0000000000000000000000000000000000000000', 1, OTHER_CONTRACT, 0, 1n, 2n, 1n, 999999n]
    })) as ParsedDirectTradeV2Opened;
    const cancelled = parse('direct-v2', rawEvent({
      protocol: 'direct-v2',
      eventName: 'DirectTradeStatusChanged',
      args: [14n, MAKER, FILLER, 1, 3, MAKER, 14n, 1_700_000_014n],
      logIndex: 1
    })) as ParsedDirectTradeV2Status;
    expect(() => materializeDirectTradeV2Acceptance({ opened, status: cancelled })).toThrow(/canonical acceptance/);

    const wrongActor = { ...cancelled, nextStatus: '2', actor: MAKER.toLowerCase() };
    expect(() => materializeDirectTradeV2Acceptance({ opened, status: wrongActor })).toThrow(/canonical acceptance/);
  });

  it('rejects a stale private snapshot, a different transaction, or a side mismatch', () => {
    const marker = parse('private-v2', rawEvent({
      protocol: 'private-v2',
      eventName: 'PrivateOrderFilled',
      args: [11n, FILLER, MAKER, 0, 4n, 3, false, 0n, 0n]
    })) as ParsedTradeHistoryV2Execution;
    const stale = parse('private-v2', rawEvent({
      protocol: 'private-v2',
      eventName: 'PrivateOrderAccountSnapshotUpdated',
      args: [
        11n, FILLER, FILLER, 3n,
        encryptedUint256(1n), encryptedUint256(1n), encryptedUint256(1n),
        encryptedUint256(1n), encryptedUint256(1n)
      ],
      logIndex: 1
    })) as ParsedTradeHistoryV2PrivateReceipt;
    expect(() => materializeTradeHistoryV2ParticipantReceipt({
      receipt: stale,
      marker,
      decryptedAmounts: { offerAmount: '1', requestAmount: '1' }
    })).toThrow(/revision/);

    const differentTx = { ...stale, contractRevision: '4', log: { ...stale.log, transactionHash: bytes32(999) } };
    expect(() => materializeTradeHistoryV2ParticipantReceipt({
      receipt: differentTx,
      marker,
      decryptedAmounts: { offerAmount: '1', requestAmount: '1' }
    })).toThrow(/exact execution marker/);
  });

  it('normalizes canonical cancellation, replacement, pause, and settlement lifecycle events', () => {
    const cancelled = parse('standard-v2', rawEvent({
      protocol: 'standard-v2',
      eventName: 'StandardTradeStatusChanged',
      args: [7n, MAKER, 1, 3, MAKER, 0n, 4n]
    })) as ParsedTradeHistoryV2Lifecycle;
    const replaced = parse('private-v2', rawEvent({
      protocol: 'private-v2',
      eventName: 'PrivateOrderStatusChanged',
      args: [8n, MAKER, 1, 5, MAKER, 9n, 3n]
    })) as ParsedTradeHistoryV2Lifecycle;
    const paused = parse('recurring-v2', rawEvent({
      protocol: 'recurring-v2',
      eventName: 'RecurringOrderStatusChanged',
      args: [10n, MAKER, 1, 2, MAKER, 5n]
    })) as ParsedTradeHistoryV2Lifecycle;
    const settled = parse('recurring-v2', rawEvent({
      protocol: 'recurring-v2',
      eventName: 'RecurringInventorySettled',
      args: [10n, MAKER, 125n, 275n]
    })) as ParsedTradeHistoryV2Lifecycle;

    expect(cancelled).toMatchObject({
      kind: 'lifecycle', lifecycleKind: 'status', protocol: 'standard-v2',
      orderId: '7', previousStatus: '1', nextStatus: '3', actor: MAKER.toLowerCase(),
      relatedOrderId: '0', contractRevision: '4'
    });
    expect(replaced).toMatchObject({
      lifecycleKind: 'status', protocol: 'private-v2', nextStatus: '5', relatedOrderId: '9'
    });
    expect(paused).toMatchObject({
      lifecycleKind: 'status', protocol: 'recurring-v2', nextStatus: '2', contractRevision: '5'
    });
    expect(settled).toMatchObject({
      lifecycleKind: 'settlement', protocol: 'recurring-v2',
      settledAmounts: { baseAmount: '125', quoteAmount: '275' }
    });
  });

  it('normalizes canonical openings, recurring edits, and replacement linkage', () => {
    const standardOpened = parse('standard-v2', rawEvent({
      protocol: 'standard-v2',
      eventName: 'StandardTradeOpened',
      args: [
        21n, MAKER, bytes32(21), 1, OTHER_CONTRACT, 500n, 1, CONTRACT, 750n,
        [true, 2500, 10n, 100n, false], 1_700_000_021n, 1_700_100_021n, 1n, 21n
      ]
    })) as ParsedTradeHistoryV2Lifecycle;
    const recurringEdited = parse('recurring-v2', rawEvent({
      protocol: 'recurring-v2',
      eventName: 'RecurringOrderEdited',
      args: [
        22n, MAKER, [2n, 3n], [4n, 5n],
        100n, 200n, 25n, 50n, 1_075n, 2_150n, 1_700_100_022n, 4n
      ],
      logIndex: 1
    })) as ParsedTradeHistoryV2Lifecycle;
    const replaced = parse('direct-v2', rawEvent({
      protocol: 'direct-v2',
      eventName: 'DirectTradeReplaced',
      args: [23n, 24n, 23n],
      logIndex: 2
    })) as ParsedTradeHistoryV2Lifecycle;

    expect(standardOpened).toMatchObject({
      lifecycleKind: 'opened', protocol: 'standard-v2', orderId: '21',
      maker: MAKER.toLowerCase(), createdAt: '1700000021', expiresAt: '1700100021',
      contractRevision: '1', rootOrderId: '21'
    });
    expect(recurringEdited).toMatchObject({
      lifecycleKind: 'edited', protocol: 'recurring-v2', orderId: '22',
      contractRevision: '4',
      editAmounts: { baseAdded: '100', quoteAdded: '200', baseRemoved: '25', quoteRemoved: '50' }
    });
    expect(replaced).toMatchObject({
      lifecycleKind: 'replacement', protocol: 'direct-v2', orderId: '23',
      replacementOrderId: '24', rootOrderId: '23'
    });
  });

  it('ignores unrelated event topics instead of treating them as a different protocol execution', () => {
    const standardLog = rawEvent({
      protocol: 'standard-v2',
      eventName: 'StandardTradeFilled',
      args: [1n, FILLER, MAKER, 1n, 1n, 0n, 0n, 2n, true]
    });
    expect(parse('recurring-v2', standardLog)).toBeUndefined();
  });

  it('fails closed for removed logs, wrong contract provenance, and noncanonical RPC quantities', () => {
    const valid = rawEvent({
      protocol: 'standard-v2',
      eventName: 'StandardTradeFilled',
      args: [1n, FILLER, MAKER, 1n, 1n, 0n, 0n, 2n, true]
    });
    expect(() => parse('standard-v2', { ...valid, removed: true })).toThrow(/Removed/);
    expect(() => parse('standard-v2', { ...valid, address: OTHER_CONTRACT })).toThrow(/expected contract/);
    expect(() => parse('standard-v2', { ...valid, logIndex: '0x00' })).toThrow(/canonical JSON-RPC quantity/);
  });
});
