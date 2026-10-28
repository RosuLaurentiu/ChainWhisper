import { describe, expect, it, vi } from 'vitest';

vi.mock('./privateLiquidityChain', async (importOriginal) => ({
  ...await importOriginal<typeof import('./privateLiquidityChain')>(),
  assertCompleteCanonicalPrivateLiquidityPositionSnapshot: vi.fn()
}));
import {
  buildPrivateLiquiditySwapConfirmation,
  preparePrivateLiquiditySwap
} from './privateLiquiditySwapFlow';
import { buildPrivateLiquidityPairKey } from './privateLiquidity';
import type { CompleteCanonicalPrivateLiquidityPositionSnapshot } from './privateLiquidityChain';
import { buildPrivateLiquidityWorkspaceModel } from './privateLiquidityWorkspaceModel';

const CONTRACT = '0x1000000000000000000000000000000000000001';
const BASE = '0x2000000000000000000000000000000000000002';
const QUOTE = '0x3000000000000000000000000000000000000003';

const model = buildPrivateLiquidityWorkspaceModel({
  snapshot: ({
    scope: { chainId: '7082400', contractAddress: CONTRACT, deploymentBlock: '10' },
    atBlock: { number: '20', hash: `0x${'11'.repeat(32)}` },
    positionCount: '1',
    positions: [{
      identity: { chainId: '7082400', contractAddress: CONTRACT, positionId: '1' },
      owner: '0x4000000000000000000000000000000000000004',
      pairKey: buildPrivateLiquidityPairKey(BASE, QUOTE),
      baseToken: BASE,
      quoteToken: QUOTE,
      buyTerms: { baseAmount: '1000000', quoteAmount: '2000000' },
      sellTerms: { baseAmount: '1000000', quoteAmount: '2200000' },
      status: 'active',
      revision: '1',
      buySideAvailable: true,
      sellSideAvailable: true,
      privacyOwner: '0x4000000000000000000000000000000000000004',
      createdAt: '1',
      lastActivityBlock: '20'
    }]
  }) as unknown as CompleteCanonicalPrivateLiquidityPositionSnapshot
});

const token = (tokenAddress: string, symbol: string) => ({
  kind: 'private-erc20' as const,
  tokenAddress,
  symbol,
  decimals: 6
});

describe('private liquidity swap flow', () => {
  it('derives a quote from the complete same-block position projection', () => {
    const prepared = preparePrivateLiquiditySwap({
      chainId: '7082400',
      contractAddress: CONTRACT,
      model,
      sellToken: token(BASE, 'p.BASE'),
      buyToken: token(QUOTE, 'p.QUOTE'),
      sellAmountInput: '1',
      slippageBps: 50,
      minimumFillBps: 2500
    });

    expect(prepared.plan.direction).toBe('base-to-quote');
    expect(prepared.quote.maximumInput).toBe('1000000');
    expect(prepared.quote.minimumInputFilled).toBe('250000');
    expect(prepared.quote.selectedCandidateCount).toBe(1);
    expect(buildPrivateLiquiditySwapConfirmation(prepared).stats).toEqual([
      { label: 'COTI private inputs', value: '1 confirmation' },
      { label: 'On-chain action', value: '1 transaction' },
      {
        label: 'Token approval',
        value: 'If needed: 1 transaction; private-only approval also adds 1 COTI confirmation'
      },
      { label: 'Chat notification', value: '0 transactions' }
    ]);
  });

  it('fails closed for public tokens, invalid amounts, and missing routes', () => {
    expect(() => preparePrivateLiquiditySwap({
      chainId: '7082400', contractAddress: CONTRACT, model,
      sellToken: { kind: 'erc20', tokenAddress: BASE, symbol: 'BASE', decimals: 6 },
      buyToken: token(QUOTE, 'p.QUOTE'), sellAmountInput: '1', slippageBps: 50, minimumFillBps: 0
    })).toThrow('supported private token');
    expect(() => preparePrivateLiquiditySwap({
      chainId: '7082400', contractAddress: CONTRACT, model,
      sellToken: token(BASE, 'p.BASE'), buyToken: token(QUOTE, 'p.QUOTE'),
      sellAmountInput: '0', slippageBps: 50, minimumFillBps: 0
    })).toThrow('valid private-liquidity spend amount');
    expect(() => preparePrivateLiquiditySwap({
      chainId: '7082400', contractAddress: CONTRACT, model,
      sellToken: token(BASE, 'p.BASE'),
      buyToken: token('0x5000000000000000000000000000000000000005', 'p.OTHER'),
      sellAmountInput: '1', slippageBps: 50, minimumFillBps: 0
    })).toThrow('No active NFT liquidity position');
  });

  it('explains when only the reverse inventory side remains available', () => {
    const oneWayModel = {
      ...model,
      positions: model.positions.map((position) => ({
        ...position,
        buySideAvailable: false,
        sellSideAvailable: true
      }))
    } as typeof model;
    expect(() => preparePrivateLiquiditySwap({
      chainId: '7082400', contractAddress: CONTRACT, model: oneWayModel,
      sellToken: token(BASE, 'p.BASE'), buyToken: token(QUOTE, 'p.QUOTE'),
      sellAmountInput: '1', slippageBps: 50, minimumFillBps: 0
    })).toThrow('Flip the tokens to trade the available reverse direction');
  });
});
