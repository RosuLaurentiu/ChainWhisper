import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import TradeActionConfirmModal from './TradeActionConfirmModal';

describe('TradeActionConfirmModal', () => {
  it('renders one action for a dismiss-only preview', () => {
    const markup = renderToStaticMarkup(<TradeActionConfirmModal
      confirmation={{
        fundingMoves: [],
        message: 'Preview only.',
        primaryLabel: 'Done',
        secondaryLabel: null,
        stats: [],
        summaryRows: [],
        title: 'Review private limit'
      }}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />);

    expect(markup).toContain('>Done</button>');
    expect(markup).not.toContain('>Cancel</button>');
    expect(markup).not.toContain('trade-action-confirm-stats-grid');
  });

  it('keeps optional explanations inside the review without changing its actions', () => {
    const markup = renderToStaticMarkup(<TradeActionConfirmModal
      confirmation={{ title: 'Review private quote', message: 'Expected amounts, after fees.',
        fundingMoves: [], stats: [], primaryLabel: 'Accept quote',
        summaryRows: [{ label: 'You receive', value: '26.24 BCN' }] }}
      details={<details><summary>Price and slippage</summary><p>Slippage protects the Quote net rate.</p></details>}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />);
    expect(markup).toContain('Price and slippage');
    expect(markup).toContain('Slippage protects the Quote net rate.');
    expect(markup).toContain('26.24 BCN');
    expect(markup).toContain('>Cancel</button>');
    expect(markup).toContain('>Accept quote</button>');
  });
});
