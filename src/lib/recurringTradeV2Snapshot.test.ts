import { describe, expect, it } from 'vitest';
import {
  projectPrivateRecurringTradeV2Snapshot,
  projectRecurringTradeV2Snapshot
} from './recurringTradeV2Snapshot';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;
const deployment = (protocol: 'recurring-v2' | 'private-recurring-v2') => ({
  protocol,
  chainId: '7082400',
  contractAddress: address(protocol === 'recurring-v2' ? '11' : '22'),
  deploymentBlock: '100',
  runtimeBytecodeHash: hash('aa'),
  attestationBlock: { number: '120', hash: hash('bb') }
});
const metadata = (kind: 'erc20' | 'private-erc20', token: string) => ({
  symbol: `${kind === 'private-erc20' ? 'p' : ''}${token.slice(2, 5)}`,
  decimals: 6,
  custom: true
});

describe('recurring OTC V2 snapshot projection', () => {
  it('projects public inventory and an exact action identity', () => {
    const snapshot = projectRecurringTradeV2Snapshot({
      deployment: deployment('recurring-v2') as never,
      resolveTokenMetadata: metadata,
      view: {
        orderId: '7', maker: address('33'), status: 'active',
        baseAsset: { assetType: 'erc20', token: address('44') },
        quoteAsset: { assetType: 'native', token: address('00') },
        buyTerms: { baseAmount: '10', quoteAmount: '9' },
        sellTerms: { baseAmount: '10', quoteAmount: '11' },
        baseInventory: '80', quoteInventory: '160', createdAt: '1000', expiresAt: '0',
        revision: '4', executionCount: '2', pairKey: hash('cc')
      }
    });

    expect(snapshot).toMatchObject({
      tradeId: 7,
      escrowContract: address('11').toLowerCase(),
      offer: { amount: '80', kind: 'erc20' },
      request: { amount: '160', kind: 'native' },
      recurringOrder: {
        mode: 'public', buySideOpen: true, sellSideOpen: true,
        v2: { protocol: 'recurring-v2', revision: '4', contractAddress: address('11') }
      }
    });
  });

  it('keeps private inventory hidden except for an authorized maker snapshot', () => {
    const input = {
      deployment: deployment('private-recurring-v2') as never,
      resolveTokenMetadata: metadata,
      view: {
        orderId: '8', maker: address('33'), status: 'active' as const,
        baseToken: address('44'), quoteToken: address('55'),
        buyTerms: { baseAmount: '10', quoteAmount: '9' },
        sellTerms: { baseAmount: '10', quoteAmount: '11' },
        createdAt: '1000', expiresAt: '0', revision: '5', executionCount: '3', pairKey: hash('dd')
      }
    };
    const publicProjection = projectPrivateRecurringTradeV2Snapshot(input);
    const makerProjection = projectPrivateRecurringTradeV2Snapshot({
      ...input,
      makerInventory: { orderId: '8', sequence: '5', baseAmount: '70', quoteAmount: '140' }
    });

    expect(publicProjection.offer.amount).toBe('0');
    expect(publicProjection.recurringOrder?.makerPrivateInventory).toBeUndefined();
    expect(makerProjection.recurringOrder).toMatchObject({
      makerPrivateInventory: { baseInventory: '70', quoteInventory: '140' },
      v2: { protocol: 'private-recurring-v2', revision: '5' }
    });
  });
});
