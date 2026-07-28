import { describe, expect, it } from 'vitest';
import { shouldLoadTradeAgentChatFeeLabels } from './useTradeAgentChatFeeLabels';

describe('shouldLoadTradeAgentChatFeeLabels', () => {
  it('loads chat action estimates only on Chat', () => {
    expect(shouldLoadTradeAgentChatFeeLabels('chat')).toBe(true);
    expect(shouldLoadTradeAgentChatFeeLabels('trades')).toBe(false);
    expect(shouldLoadTradeAgentChatFeeLabels('home')).toBe(false);
    expect(shouldLoadTradeAgentChatFeeLabels('swap')).toBe(false);
    expect(shouldLoadTradeAgentChatFeeLabels('treasury')).toBe(false);
  });
});
