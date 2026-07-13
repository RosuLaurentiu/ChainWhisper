import type { FormEventHandler, Ref } from 'react';
import { APP_HELP_MAX_QUESTION_CHARS, getAppHelpTopic } from '../../../lib/appHelp';
import type { TradeAgentQuickAction, TradeAgentResponseAction } from '../../../lib/tradeAgent';
import type { TradeAgentChatMessage } from './P2PTradingPage.helpers';

export type TradeAgentPanelMode = 'help' | 'trade';

type AppHelpQuickQuestion = {
  label: string;
  question: string;
  topicId: string;
};

type TradeAgentPanelProps = {
  mode: TradeAgentPanelMode;
  onModeChange: (mode: TradeAgentPanelMode) => void;
  helpMessages: TradeAgentChatMessage[];
  helpLoading: boolean;
  helpMessagesEndRef: Ref<HTMLDivElement>;
  helpError: string;
  helpQuickQuestions: readonly AppHelpQuickQuestion[];
  helpPrompt: string;
  helpCanSubmit: boolean;
  onAskHelpQuestion: (question: string) => Promise<void>;
  onHelpPromptChange: (value: string) => void;
  onHelpSubmit: FormEventHandler<HTMLFormElement>;
  onOpenHelpTopic: (topicId: string) => void;
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
  mode,
  onModeChange,
  helpMessages,
  helpLoading,
  helpMessagesEndRef,
  helpError,
  helpQuickQuestions,
  helpPrompt,
  helpCanSubmit,
  onAskHelpQuestion,
  onHelpPromptChange,
  onHelpSubmit,
  onOpenHelpTopic,
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
  const helpMode = mode === 'help';
  const visibleMessages = helpMode ? helpMessages : messages;
  const activeLoading = helpMode ? helpLoading : loading;
  const activeMessagesEndRef = helpMode ? helpMessagesEndRef : messagesEndRef;

  return (
    <section className="standalone-trades-section p2p-agent-section p2p-trade-workspace-panel" aria-label="ChainWhisper Assistant">
      <div className="p2p-trade-entry-panel p2p-agent-panel">
        <div className="p2p-agent-mode-toggle" role="tablist" aria-label="Assistant mode">
          <button
            type="button"
            role="tab"
            aria-selected={helpMode}
            className={helpMode ? 'active' : undefined}
            onClick={() => onModeChange('help')}
          >
            App Help
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!helpMode}
            className={!helpMode ? 'active' : undefined}
            onClick={() => onModeChange('trade')}
          >
            Trade Agent
          </button>
        </div>

        <div className="p2p-agent-hero">
          <div>
            <span>{helpMode ? 'App Help' : 'Trade Agent'}</span>
            <strong>{helpMode ? 'Learn how ChainWhisper works.' : 'Trading help, not autopilot.'}</strong>
          </div>
          <small>{helpMode ? 'Free — no wallet required.' : feeLoading ? 'Checking WISP fee...' : feeLabel}</small>
        </div>

        <div className="p2p-agent-chat-window">
          <div className="p2p-agent-messages" role="log" aria-live="polite">
            {visibleMessages.map((message) => {
              const actions = helpMode ? [] : (message.actions ?? []).filter(canUseAction);
              const helpTopic = helpMode ? getAppHelpTopic(message.helpTopicId) : null;
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
                  {helpTopic ? (
                    <button
                      type="button"
                      className="standalone-trade-secondary-btn p2p-agent-source-link"
                      onClick={() => onOpenHelpTopic(helpTopic.id)}
                    >
                      Open {helpTopic.routeLabel}
                    </button>
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

            {activeLoading ? (
              <div className="p2p-agent-message p2p-agent-message-assistant">
                <span>{helpMode ? 'App Help' : 'Trade Agent'}</span>
                <p>{helpMode ? 'Checking ChainWhisper help...' : status || 'Working...'}</p>
              </div>
            ) : null}
            <div ref={activeMessagesEndRef} />
          </div>

          {helpMode ? (
            <div className="p2p-agent-composer">
              {helpError ? <p className="error p2p-agent-error">{helpError}</p> : null}
              <div className="p2p-agent-quick-actions" aria-label="Common App Help questions">
                {helpQuickQuestions.map((item) => (
                  <button
                    key={item.topicId}
                    type="button"
                    disabled={helpLoading}
                    onClick={() => {
                      onAskHelpQuestion(item.question).catch(() => {});
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <form className="p2p-agent-prompt" onSubmit={onHelpSubmit}>
                <textarea
                  value={helpPrompt}
                  onChange={(event) => onHelpPromptChange(event.target.value)}
                  placeholder="Ask a question about ChainWhisper..."
                  maxLength={APP_HELP_MAX_QUESTION_CHARS}
                  rows={3}
                />
                <div className="p2p-agent-submit-row">
                  <span>{helpPrompt.length}/{APP_HELP_MAX_QUESTION_CHARS} · Common answers stay on this device.</span>
                  <button
                    type="submit"
                    className="trade-card-action trade-card-action-accept"
                    disabled={!helpCanSubmit}
                  >
                    {helpLoading ? 'Checking...' : 'Ask free'}
                  </button>
                </div>
              </form>
            </div>
          ) : (
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
          )}
        </div>
      </div>
    </section>
  );
}
