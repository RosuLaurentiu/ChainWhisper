import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import useDirectComposerPromptEstimates from './useDirectComposerPromptEstimates';

const OWNER = '0x1111111111111111111111111111111111111111';
const PEER = '0x2222222222222222222222222222222222222222';

const renderTradeEstimate = ({
  enabled,
  kind,
  symbol
}: {
  enabled: boolean;
  kind: 'native' | 'erc20' | 'private-erc20';
  symbol: string;
}): string => {
  const Probe = () => {
    const { tradeComposerPromptEstimate } = useDirectComposerPromptEstimates({
      activeContact: PEER,
      activeGroupId: null,
      activeLinkedTradeContext: null,
      browserWalletLiteMode: true,
      directChatV2ConversationKnown: false,
      directChatV2Session: null,
      directTradeV2Enabled: enabled,
      messageInput: '',
      parsedTradeExpiryHours: 24,
      tradeComposerOpen: true,
      tradeCounterParentId: null,
      tradeOfferTokenKind: kind,
      tradeOfferTokenSymbol: symbol,
      walletAddress: OWNER
    });
    return <span>{tradeComposerPromptEstimate?.label ?? ''}</span>;
  };
  return renderToStaticMarkup(<Probe />);
};

describe('useDirectComposerPromptEstimates trade protocol routing', () => {
  it('shows the Direct Trade V2 escrow transaction instead of legacy chat prompt math', () => {
    const markup = renderTradeEstimate({ enabled: true, kind: 'erc20', symbol: 'TEST' });

    expect(markup).toContain('Direct Trade V2 estimates 1 offer transaction');
    expect(markup).toContain('no separate chat-notification transaction');
    expect(markup).not.toContain('Legacy wallet short mode');
    expect(markup).not.toContain('encryption prompts');
  });

  it('shows the packed private-input count for a private Direct Trade V2 offer', () => {
    const markup = renderTradeEstimate({ enabled: true, kind: 'private-erc20', symbol: 'pTEST' });

    expect(markup).toContain('2 packed COTI private-input confirmations plus 1 offer transaction');
    expect(markup).toContain('one-time private-token approval');
  });

  it('keeps legacy prompt math only when the V2 trade runtime is not active', () => {
    const markup = renderTradeEstimate({ enabled: false, kind: 'erc20', symbol: 'TEST' });

    expect(markup).toContain('Legacy wallet short mode');
  });
});
