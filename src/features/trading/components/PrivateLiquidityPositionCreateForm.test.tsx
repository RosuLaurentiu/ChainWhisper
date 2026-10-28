import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PrivateLiquidityPositionToken } from '../../../lib/privateLiquidityPositionFlow';
import PrivateLiquidityPositionCreateForm from './PrivateLiquidityPositionCreateForm';

const address = (pair: string): string => `0x${pair.repeat(20)}`;

const tokens: readonly PrivateLiquidityPositionToken[] = [
  { selection: 'high', address: address('22'), symbol: 'p.HIGH', decimals: 6 },
  { selection: 'low', address: address('11'), symbol: 'p.LOW', decimals: 6 }
];

describe('PrivateLiquidityPositionCreateForm', () => {
  it('shows the midpoint, balanced budget, spread, and derived-price review flow', () => {
    const markup = renderToStaticMarkup(createElement(PrivateLiquidityPositionCreateForm, {
      tokens,
      deploymentReady: true,
      walletReady: true,
      busy: false,
      onCreate: () => undefined
    }));
    expect(markup).toContain('Canonical pair:');
    expect(markup).toContain('<strong>p.LOW</strong> base');
    expect(markup).toContain('<strong>p.HIGH</strong> quote');
    expect(markup).toContain('Starting price');
    expect(markup).toContain('Balanced budget');
    expect(markup).toContain('Total spread');
    expect(markup).toContain('Encrypted inventory');
    expect(markup).toContain('Position buys at');
    expect(markup).toContain('Position sells at');
    expect(markup).toContain('Review Position NFT');
    expect(markup).toContain('disabled=""');
  });

  it('fails closed without a reviewed deployment or two private tokens', () => {
    const markup = renderToStaticMarkup(createElement(PrivateLiquidityPositionCreateForm, {
      tokens: tokens.slice(0, 1),
      deploymentReady: false,
      walletReady: true,
      busy: false,
      onCreate: () => undefined
    }));
    expect(markup).toContain('Choose two different verified private tokens.');
    expect(markup).toContain('Private liquidity deployment pending');
    expect(markup).toContain('disabled=""');
  });
});
