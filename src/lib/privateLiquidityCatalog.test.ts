import { describe, expect, it, vi } from 'vitest';

vi.mock('./privateLiquidityChain', async (importOriginal) => ({
  ...await importOriginal<typeof import('./privateLiquidityChain')>(),
  assertAttestedPrivateLiquidityDeployment: vi.fn(),
  assertCanonicalPrivateLiquidityCatalogAnchor: vi.fn(),
  assertCanonicalPrivateLiquidityLogRange: vi.fn()
}));

import {
  materializeCanonicalPrivateLiquidityPositionCatalog,
  readCanonicalPrivateLiquidityCatalogPage
} from './privateLiquidityCatalog';
import type {
  AttestedPrivateLiquidityDeployment,
  CanonicalPrivateLiquidityCatalogAnchor,
  CanonicalPrivateLiquidityLogRange
} from './privateLiquidityChain';
import type { ParsedPrivateLiquidityV1Log } from './privateLiquidityEvents';
import {
  buildPrivateLiquidityHistorySyncScopeKey,
  type PrivateLiquidityHistorySyncState
} from './privateLiquiditySync';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;
const ZERO = address('00');
const CONTRACT = address('11');
const OWNER = address('22');
const OTHER = address('33');
const BASE = address('44');
const QUOTE = address('55');
const CHAIN_ID = '7082400';

const deployment = Object.freeze({
  chainId: CHAIN_ID,
  contractAddress: CONTRACT,
  deploymentBlock: '100'
}) as unknown as AttestedPrivateLiquidityDeployment;

const anchor = (positionCount = '2'): CanonicalPrivateLiquidityCatalogAnchor => Object.freeze({
  scope: Object.freeze({ chainId: CHAIN_ID, contractAddress: CONTRACT, deploymentBlock: '100' }),
  atBlock: Object.freeze({ number: '120', hash: hash('12') }),
  nextPositionId: (BigInt(positionCount) + 1n).toString(),
  positionCount
}) as unknown as CanonicalPrivateLiquidityCatalogAnchor;

let logIndex = 0;
const provenance = (blockNumber: string, transactionHash: string) => ({
  chainId: CHAIN_ID,
  contractAddress: CONTRACT,
  blockNumber,
  blockHash: hash(Number(blockNumber).toString(16).padStart(2, '0').slice(-2)),
  transactionHash,
  transactionIndex: 0,
  logIndex: logIndex++
});

const mint = (
  positionId: string,
  owner: string,
  blockNumber: string,
  transactionHash: string
): ParsedPrivateLiquidityV1Log => {
  const eventProvenance = provenance(blockNumber, transactionHash);
  return {
    kind: 'position-transfer',
    positionId,
    from: ZERO,
    to: owner,
    provenance: eventProvenance,
    rawEventKey: `${transactionHash}:${eventProvenance.logIndex}`
  };
};

const created = (
  positionId: string,
  owner: string,
  blockNumber: string,
  transactionHash: string
): ParsedPrivateLiquidityV1Log => {
  const eventProvenance = provenance(blockNumber, transactionHash);
  return {
    kind: 'position-created',
    positionId,
    positionOwner: owner,
    pairKey: hash('66'),
    baseToken: BASE,
    quoteToken: QUOTE,
    buyTerms: { baseAmount: '1', quoteAmount: '9' },
    sellTerms: { baseAmount: '1', quoteAmount: '11' },
    createdAt: blockNumber,
    revision: '1',
    provenance: eventProvenance,
    rawEventKey: `${transactionHash}:${eventProvenance.logIndex}`
  };
};

const transfer = (
  positionId: string,
  from: string,
  to: string,
  blockNumber: string,
  transactionHash: string
): ParsedPrivateLiquidityV1Log => {
  const eventProvenance = provenance(blockNumber, transactionHash);
  return {
    kind: 'position-transfer',
    positionId,
    from,
    to,
    provenance: eventProvenance,
    rawEventKey: `${transactionHash}:${eventProvenance.logIndex}`
  };
};

const page = (
  fromBlock: string,
  toBlock: string,
  events: readonly ParsedPrivateLiquidityV1Log[]
): CanonicalPrivateLiquidityLogRange => Object.freeze({
  scope: Object.freeze({ chainId: CHAIN_ID, contractAddress: CONTRACT, deploymentBlock: '100' }),
  range: Object.freeze({
    fromBlock,
    toBlock,
    fromBlockHash: hash(fromBlock === '100' ? '10' : '11'),
    toBlockHash: toBlock === '120' ? hash('12') : hash('11')
  }),
  safeHead: Object.freeze({ number: '120', hash: hash('12') }),
  checkedBlocks: Object.freeze([]),
  events: Object.freeze(events)
}) as unknown as CanonicalPrivateLiquidityLogRange;

const state = (pages: readonly CanonicalPrivateLiquidityLogRange[]): PrivateLiquidityHistorySyncState => {
  const key = buildPrivateLiquidityHistorySyncScopeKey(deployment);
  return Object.freeze({
    scopes: Object.freeze({
      [key]: Object.freeze({
        revision: 2,
        pages: Object.freeze(pages),
        checkpoint: Object.freeze({ blockNumber: '120', blockHash: hash('12') })
      })
    })
  });
};

describe('privateLiquidityCatalog', () => {
  it('deduplicates overlap, proves contiguous creation count, and projects ERC-721 ownership', () => {
    logIndex = 0;
    const tx1 = hash('a1');
    const tx2 = hash('a2');
    const mint1 = mint('1', OWNER, '101', tx1);
    const create1 = created('1', OWNER, '101', tx1);
    const mint2 = mint('2', OWNER, '109', tx2);
    const create2 = created('2', OWNER, '109', tx2);
    const move = transfer('1', OWNER, OTHER, '115', hash('a3'));
    const catalog = materializeCanonicalPrivateLiquidityPositionCatalog({
      deployment,
      anchor: anchor(),
      syncState: state([
        page('100', '110', [mint1, create1, mint2, create2]),
        page('108', '120', [create2, move])
      ])
    });

    expect(catalog.positionCount).toBe('2');
    expect(catalog.entries).toMatchObject([
      { positionId: '1', initialOwner: OWNER, lastObservedOwner: OTHER },
      { positionId: '2', initialOwner: OWNER, lastObservedOwner: OWNER }
    ]);
    expect(Object.isFrozen(catalog.entries)).toBe(true);
    expect(readCanonicalPrivateLiquidityCatalogPage({ catalog, limit: 1 })).toEqual({
      positionIds: ['1'],
      nextOffset: '1',
      complete: false
    });
    expect(readCanonicalPrivateLiquidityCatalogPage({ catalog, offset: '1', limit: 2 })).toEqual({
      positionIds: ['2'],
      complete: true
    });
  });

  it('rejects a provider-omitted creation against the block-pinned position count', () => {
    logIndex = 0;
    const tx1 = hash('b1');
    expect(() => materializeCanonicalPrivateLiquidityPositionCatalog({
      deployment,
      anchor: anchor('2'),
      syncState: state([page('100', '120', [
        mint('1', OWNER, '101', tx1),
        created('1', OWNER, '101', tx1)
      ])])
    })).toThrow(/do not match the on-chain position count/);
  });

  it('rejects range gaps, checkpoint mismatches, and impossible transfer history', () => {
    logIndex = 0;
    const tx1 = hash('c1');
    const valid = [mint('1', OWNER, '101', tx1), created('1', OWNER, '101', tx1)];
    expect(() => materializeCanonicalPrivateLiquidityPositionCatalog({
      deployment,
      anchor: anchor('1'),
      syncState: state([page('100', '105', valid), page('107', '120', [])])
    })).toThrow(/gap/);

    const wrongCheckpoint = state([page('100', '120', valid)]);
    const key = buildPrivateLiquidityHistorySyncScopeKey(deployment);
    const mutated: PrivateLiquidityHistorySyncState = {
      scopes: {
        [key]: { ...wrongCheckpoint.scopes[key], checkpoint: { blockNumber: '119', blockHash: hash('12') } }
      }
    };
    expect(() => materializeCanonicalPrivateLiquidityPositionCatalog({
      deployment,
      anchor: anchor('1'),
      syncState: mutated
    })).toThrow(/checkpoint/);

    const badMove = transfer('1', OTHER, OWNER, '115', hash('c2'));
    expect(() => materializeCanonicalPrivateLiquidityPositionCatalog({
      deployment,
      anchor: anchor('1'),
      syncState: state([page('100', '120', [...valid, badMove])])
    })).toThrow(/does not follow observed/);
  });

  it('rejects structural catalog forgeries and unsafe page requests', () => {
    expect(() => readCanonicalPrivateLiquidityCatalogPage({
      catalog: {} as never,
      limit: 1
    })).toThrow(/not canonical/);
  });
});
