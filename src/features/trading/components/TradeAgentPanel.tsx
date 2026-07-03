import type { FormEventHandler, Ref } from 'react';
import type { TradeAgentQuickAction, TradeAgentResponseAction } from '../../../lib/tradeAgent';
import type { TradeAgentChatMessage } from './P2PTradingPage.helpers';

type TradeAgentPanelProps = {
  feeLabel: string;
  feeLoading: boolean;
  messages: TradeAgentChatMessage[];
  loading: boolean;
  status: string;
  messagesEndRef: Ref<HTMLDivElement>;
  error: string;
  quickActions: TradeAgentQuickAction[];
  prompt: string;
  canSubmitRequest: boolean;
  retryPaymentTxHash: string;
  canUseAction: (action: TradeAgentResponseAction) => boolean;
  getActionButtonLabel: (action: TradeAgentResponseAction) => string;
  getActionDescription: (action: TradeAgentResponseAction) => string;
  getActionCta: (action: TradeAgentResponseAction) => string;
  resolveQuickActionPrompt: (item: TradeAgentQuickAction) => string;
  onApplyAction: (action: TradeAgentResponseAction) => Promise<void>;
  onActionError: (message: string) => void;
  onSelectQuickAction: (item: TradeAgentQuickAction, prompt: string) => void;
  onPromptChange: (value: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
};

export default function TradeAgentPanel({
  feeLabel,
  feeLoading,
  messages,
  loading,
  status,
  messagesEndRef,
  error,
  quickActions,
  prompt,
  canSubmitRequest,
  retryPaymentTxHash,
  canUseAction,
  getActionButtonLabel,
  getActionDescription,
  getActionCta,
  resolveQuickActionPrompt,
  onApplyAction,
  onActionError,
  onSelectQuickAction,
  onPromptChange,
  onSubmit
}: TradeAgentPanelProps) {
  return (
    <section className="standalone-trades-section p2p-agent-section p2p-trade-workspace-panel" aria-label="Trade Agent">
      <div className="p2p-trade-entry-panel p2p-agent-panel">
        <div className="p2p-agent-hero">
          <div>
            <span>Trade Agent</span>
            <strong>Trading help, not autopilot.</strong>
          </div>
          <small>{feeLoading ? 'Checking WISP fee...' : feeLabel}</small>
        </div>

        <div className="p2p-agent-chat-window">
          <div className="p2p-agent-messages" role="log" aria-live="polite">
            {messages.map((message) => {
              const actions = (message.actions ?? []).filter(canUseAction);
              return (
                <div
                  className={`p2p-agent-message p2p-agent-message-${message.role}${actions.length ? ' p2p-agent-response' : ''}`}
                  key={message.id}
                >
                  <span>{message.title}</span>
                  <p>{message.text}</p>
                  {message.warnings?.length ? (
                    <ul>
                      {message.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                  {actions.length ? (
                    <div className="p2p-agent-response-actions">
                      {actions.map((action, index) => (
                        <div className="p2p-agent-action-card" key={`${message.id}:${action.type}:${index}`}>
                          <div>
                            <strong>{getActionButtonLabel(action)}</strong>
                            <small>{getActionDescription(action)}</small>
                          </div>
                          <button
                            type="button"
                            className="standalone-trade-secondary-btn"
                            onClick={() => {
                              onApplyAction(action).catch((applyError) => {
                                onActionError(applyError instanceof Error ? applyError.message : 'Could not use this draft.');
                              });
                            }}
                          >
                            {getActionCta(action)}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {loading ? (
              <div className="p2p-agent-message p2p-agent-message-assistant">
                <span>Trade Agent</span>
                <p>{status || 'Working...'}</p>
              </div>
            ) : null}
            <div ref={messagesEndRef} />
          </div>

          <div className="p2p-agent-composer">
            {error ? <p className="error p2p-agent-error">{error}</p> : null}
            <div className="p2p-agent-quick-actions" aria-label="Trade Agent actions">
              {quickActions.map((item) => {
                const quickPrompt = resolveQuickActionPrompt(item);
                return (
                  <button
                    key={`${item.action}:${item.label}`}
                    type="button"
                    className={prompt === quickPrompt ? 'active' : undefined}
                    onClick={() => onSelectQuickAction(item, quickPrompt)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <form className="p2p-agent-prompt" onSubmit={onSubmit}>
              <textarea
                value={prompt}
                onChange={(event) => onPromptChange(event.target.value)}
                placeholder="Ask about a pair, paste a note, or describe the order you want..."
                rows={3}
              />
              <div className="p2p-agent-submit-row">
                <span>{status || 'Paid from your ChainWhisper account.'}</span>
                <button
                  type="submit"
                  className="trade-card-action trade-card-action-accept"
                  disabled={!canSubmitRequest}
                >
                  {loading ? 'Working...' : retryPaymentTxHash ? 'Retry without paying' : 'Pay and send'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
