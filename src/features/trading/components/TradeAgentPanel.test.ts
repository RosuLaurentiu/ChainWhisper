import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TradeAgentPanel from './TradeAgentPanel';

describe('TradeAgentPanel', () => {
  it('renders trading as the primary workspace with attached context', () => {
    const markup = renderToStaticMarkup(createElement(TradeAgentPanel, {
      mode: 'trade',
      onModeChange: () => undefined,
      venueLabel: 'P2P',
      pairLabel: 'cwTPB / cwTPQ',
      ratioLabel: 'cwTPQ per cwTPB',
      actionsAvailable: true,
      helpMessages: [],
      helpLoading: false,
      helpMessagesEndRef: { current: null },
      helpError: '',
      helpQuickQuestions: [],
      helpPrompt: '',
      helpCanSubmit: false,
      helpCanRetry: false,
      onAskHelpQuestion: async () => undefined,
      onRetryHelpQuestion: async () => undefined,
      onHelpPromptChange: () => undefined,
      onHelpSubmit: () => undefined,
      feeLabel: 'Est. 1 WISP / request',
      messages: [{ id: 'intro', role: 'assistant', title: 'Trade Agent', text: 'Ready.' }],
      loading: false,
      status: '',
      messagesEndRef: { current: null },
      quickActions: [],
      prompt: '',
      readiness: { kind: 'ready', canSubmit: false, message: 'Describe a trade.' },
      retryPaymentTxHash: '',
      canUseAction: () => true,
      getActionButtonLabel: () => 'Review',
      getActionDescription: () => 'Review draft',
      getActionCta: () => 'Use draft',
      resolveQuickActionPrompt: () => '',
      onApplyAction: async () => undefined,
      onActionError: () => undefined,
      onSelectQuickAction: () => undefined,
      onConnectAccount: () => undefined,
      onPromptChange: () => undefined,
      onSubmit: () => undefined
    } as never));

    expect(markup).toContain('aria-label="Agent tools"');
    expect(markup).toContain('App Help');
    expect(markup).toContain('Trade Agent');
    expect(markup.match(/MCP for agents/g)).toHaveLength(1);
    expect(markup).toContain('What do you want to do?');
    expect(markup).toContain('Attached context');
    expect(markup).not.toContain('MCP instructions</button>');
    expect(markup).not.toContain('Agent settings');
    expect(markup).not.toContain('role="tablist"');
  });
});
