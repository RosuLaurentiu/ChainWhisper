import { describe, expect, it } from 'vitest';
import { getNextTradeAgentPanelMode } from './TradeAgentPanel';

describe('TradeAgentPanel tab keyboard navigation', () => {
  it('wraps horizontal arrow navigation in both directions', () => {
    expect(getNextTradeAgentPanelMode('help', 'ArrowLeft')).toBe('setup');
    expect(getNextTradeAgentPanelMode('help', 'ArrowRight')).toBe('trade');
    expect(getNextTradeAgentPanelMode('trade', 'ArrowLeft')).toBe('help');
    expect(getNextTradeAgentPanelMode('trade', 'ArrowRight')).toBe('setup');
    expect(getNextTradeAgentPanelMode('setup', 'ArrowLeft')).toBe('trade');
    expect(getNextTradeAgentPanelMode('setup', 'ArrowRight')).toBe('help');
  });

  it('supports Home and End without handling unrelated keys', () => {
    expect(getNextTradeAgentPanelMode('trade', 'Home')).toBe('help');
    expect(getNextTradeAgentPanelMode('help', 'End')).toBe('setup');
    expect(getNextTradeAgentPanelMode('help', 'Tab')).toBeNull();
  });
});
