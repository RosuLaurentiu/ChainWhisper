import { describe, expect, it } from 'vitest';
import type { DirectTradeV2ChatEntry } from '../../lib/directTradeV2ChatProjection';
import {
  buildDirectTradeNotificationStorageKey,
  markDirectTradeNotificationsRead,
  parseDirectTradeNotifications,
  reconcileDirectTradeNotifications,
  serializeDirectTradeNotifications,
  type DirectTradeNotificationScope
} from './directTradeNotifications';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;
const scope: DirectTradeNotificationScope = Object.freeze({
  chainId: '7082400',
  contractAddress: address('11'),
  ownerAddress: address('22')
});

const opening = (
  id: string,
  tradeId: string,
  parentTradeId: string,
  eventKind: 'opened' | 'status' = 'opened'
): DirectTradeV2ChatEntry => Object.freeze({
  viewer: address('22'),
  contact: address('33'),
  message: Object.freeze({
    id: `direct-trade-v2:${id}`,
    direction: 'incoming',
    text: 'trade',
    timestamp: Number(tradeId),
    directTradeV2: Object.freeze({
      protocol: 'direct-trade-v2',
      eventKind,
      chainId: scope.chainId,
      contractAddress: scope.contractAddress,
      tradeId,
      relatedTradeId: parentTradeId,
      transactionHash: hash('44'),
      blockNumber: tradeId,
      blockHash: hash('55'),
      logIndex: 1,
      finality: 'finalized'
    })
  })
});

describe('direct trade notification persistence', () => {
  it('keeps the original escrow for retained offers with the same local ID', () => {
    const current = opening('current', '1', '0');
    const old = opening('old', '1', '0');
    const retained = { ...old, message: { ...old.message, directTradeV2: { ...old.message.directTradeV2!, contractAddress: address('88') } } };
    const unknown = { ...old, message: { ...old.message, id: 'direct-trade-v2:unknown', directTradeV2: { ...old.message.directTradeV2!, contractAddress: address('99') } } };
    const items = reconcileDirectTradeNotifications({ scope: { ...scope, supportedContracts: [scope.contractAddress, address('88')] },
      previous: [], newOpenings: [current, retained, unknown], canonicalOpenings: [current, retained, unknown], canonicalComplete: true });
    expect(items).toHaveLength(2);
    expect(items.find(item => item.id === retained.message.id)?.contractAddress).toBe(address('88'));
    expect(items.find(item => item.id === current.message.id)?.contractAddress).toBe(scope.contractAddress);
    expect(parseDirectTradeNotifications(serializeDirectTradeNotifications(items))).toEqual(items);
  });
  it('scopes storage by chain, contract, and owner', () => {
    expect(buildDirectTradeNotificationStorageKey(scope)).toBe(
      `chainwhisper:direct-trade-notifications-v1:7082400:${address('11')}:${address('22')}`
    );
  });

  it('adds only direct openings and counter openings and preserves read state', () => {
    const direct = opening('direct', '1', '0');
    const counter = opening('counter', '2', '1');
    const status = opening('status', '3', '0', 'status');
    const first = reconcileDirectTradeNotifications({
      scope,
      previous: [],
      newOpenings: [direct, counter, status],
      canonicalOpenings: [direct, counter],
      canonicalComplete: true
    });
    expect(first.map(({ kind, tradeId }) => [kind, tradeId])).toEqual([
      ['counter', '2'],
      ['direct', '1']
    ]);

    const marked = markDirectTradeNotificationsRead(first, direct.message.id);
    const second = reconcileDirectTradeNotifications({
      scope,
      previous: marked,
      newOpenings: [direct],
      canonicalOpenings: [direct, counter],
      canonicalComplete: true
    });
    expect(second.find((item) => item.id === direct.message.id)?.read).toBe(true);
  });

  it('removes orphaned openings only after the canonical scan is complete', () => {
    const direct = opening('direct', '1', '0');
    const initial = reconcileDirectTradeNotifications({
      scope,
      previous: [],
      newOpenings: [direct],
      canonicalOpenings: [direct],
      canonicalComplete: true
    });
    expect(reconcileDirectTradeNotifications({
      scope,
      previous: initial,
      newOpenings: [],
      canonicalOpenings: [],
      canonicalComplete: false
    })).toHaveLength(1);
    expect(reconcileDirectTradeNotifications({
      scope,
      previous: initial,
      newOpenings: [],
      canonicalOpenings: [],
      canonicalComplete: true
    })).toEqual([]);
  });

  it('repairs stored routing metadata from the canonical opening while preserving read state', () => {
    const direct = opening('direct', '1', '0');
    const tampered = {
      ...reconcileDirectTradeNotifications({
        scope,
        previous: [],
        newOpenings: [direct],
        canonicalOpenings: [direct],
        canonicalComplete: true
      })[0]!,
      contactAddress: address('99'),
      tradeId: '77',
      read: true
    };
    const repaired = reconcileDirectTradeNotifications({
      scope,
      previous: [tampered],
      newOpenings: [],
      canonicalOpenings: [direct],
      canonicalComplete: true
    });
    expect(repaired).toMatchObject([{
      contactAddress: address('33'),
      tradeId: '1',
      read: true
    }]);
  });

  it('round-trips a bounded privacy-safe record and rejects malformed data', () => {
    const direct = opening('direct', '1', '0');
    const items = reconcileDirectTradeNotifications({
      scope,
      previous: [],
      newOpenings: [direct],
      canonicalOpenings: [direct],
      canonicalComplete: true
    });
    const encoded = serializeDirectTradeNotifications(items);
    expect(parseDirectTradeNotifications(encoded)).toEqual(items);
    expect(encoded).not.toContain('tradeText');
    expect(encoded).not.toContain('ciphertext');
    expect(parseDirectTradeNotifications('{"schema":1,"items":[{}]}')).toEqual([]);
  });
});
