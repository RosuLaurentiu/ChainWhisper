import type { FormEventHandler, KeyboardEventHandler, Ref } from 'react';
import { APP_HELP_MAX_QUESTION_CHARS, getAppHelpTopic } from '../../../lib/appHelp';
import type { TradeAgentQuickAction, TradeAgentResponseAction } from '../../../lib/tradeAgent';
import type { TradeAgentReadiness } from '../../../lib/tradeAgentReadiness';
import type { TradeAgentChatMessage } from './P2PTradingPage.helpers';

export type TradeAgentPanelMode = 'help' | 'trade';

export const getNextTradeAgentPanelMode = (
  currentMode: TradeAgentPanelMode,
  key: string
): TradeAgentPanelMode | null => {
  if (key === 'Home') {
    return 'help';
  }
  if (key === 'End') {
    return 'trade';
  }
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    return currentMode === 'help' ? 'trade' : 'help';
  }
  return null;
};

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
  helpCanRetry: boolean;
  onAskHelpQuestion: (question: string) => Promise<void>;
  onRetryHelpQuestion: () => Promise<void>;
  onHelpPromptChange: (value: string) => void;
  onHelpSubmit: FormEventHandler<HTMLFormElement>;
  feeLabel: string;
  messages: TradeAgentChatMessage[];
  loading: boolean;
  status: string;
  messagesEndRef: Ref<HTMLDivElement>;
  quickActions: TradeAgentQuickAction[];
  prompt: string;
  readiness: TradeAgentReadiness;
  retryPaymentTxHash: string;
  canUseAction: (action: TradeAgentResponseAction) => boolean;
  getActionButtonLabel: (action: TradeAgentResponseAction) => string;
  getActionDescription: (action: TradeAgentResponseAction) => string;
  getActionCta: (action: TradeAgentResponseAction) => string;
  resolveQuickActionPrompt: (item: TradeAgentQuickAction) => string;
  onApplyAction: (action: TradeAgentResponseAction) => Promise<void>;
  onActionError: (message: string) => void;
  onSelectQuickAction: (item: TradeAgentQuickAction, prompt: string) => void;
  onConnectAccount: () => void;
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
  helpCanRetry,
  onAskHelpQuestion,
  onRetryHelpQuestion,
  onHelpPromptChange,
  onHelpSubmit,
  feeLabel,
  messages,
  loading,
  status,
  messagesEndRef,
  quickActions,
  prompt,
  readiness,
  retryPaymentTxHash,
  canUseAction,
  getActionButtonLabel,
  getActionDescription,
  getActionCta,
  resolveQuickActionPrompt,
  onApplyAction,
  onActionError,
  onSelectQuickAction,
  onConnectAccount,
  onPromptChange,
  onSubmit
}: TradeAgentPanelProps) {
  const helpMode = mode === 'help';
  const visibleMessages = helpMode ? helpMessages : messages;
  const activeLoading = helpMode ? helpLoading : loading;
  const activeMessagesEndRef = helpMode ? helpMessagesEndRef : messagesEndRef;
  const compactConversation = visibleMessages.length <= 1 && !activeLoading;
  const handleModeKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    const nextMode = getNextTradeAgentPanelMode(mode, event.key);
    if (!nextMode) {
      return;
    }
    event.preventDefault();
    onModeChange(nextMode);
    event.currentTarget
      .querySelector<HTMLButtonElement>(nextMode === 'help' ? '#assistant-mode-help' : '#assistant-mode-trade')
      ?.focus();
  };

  return (
    <section className="standalone-trades-section p2p-agent-section p2p-trade-workspace-panel" aria-label="ChainWhisper Assistant">
      <div className="p2p-trade-entry-panel p2p-agent-panel">
        <div
          className="p2p-agent-mode-toggle"
          role="tablist"
          aria-label="Assistant mode"
          onKeyDown={handleModeKeyDown}
        >
          <button
            id="assistant-mode-help"
            type="button"
            role="tab"
            aria-selected={helpMode}
            aria-controls="assistant-mode-panel"
            tabIndex={helpMode ? 0 : -1}
            className={helpMode ? 'active' : undefined}
            onClick={() => onModeChange('help')}
          >
            App Help
          </button>
          <button
            id="assistant-mode-trade"
            type="button"
            role="tab"
            aria-selected={!helpMode}
            aria-controls="assistant-mode-panel"
            tabIndex={!helpMode ? 0 : -1}
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
          <small>{helpMode ? 'Free — no wallet required.' : feeLabel}</small>
        </div>

        <div
          id="assistant-mode-panel"
          className={`p2p-agent-chat-window${
            compactConversation ? ' p2p-agent-chat-window-compact' : ''
          }`}
          role="tabpanel"
          aria-labelledby={helpMode ? 'assistant-mode-help' : 'assistant-mode-trade'}
        >
          <div
            className="p2p-agent-messages"
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-busy={activeLoading}
          >
            {visibleMessages.map((message) => {
              const actions = helpMode ? [] : (message.actions ?? []).filter(canUseAction);
              const relatedHelpTopics = helpMode
                ? (message.relatedHelpTopicIds ?? [])
                    .map((topicId) => getAppHelpTopic(topicId))
                    .filter((topic) => Boolean(topic))
                : [];
              const hasResponseExtras = actions.length > 0 || relatedHelpTopics.length > 0 || Boolean(message.helpSource);
              return (
                <div
                  className={`p2p-agent-message p2p-agent-message-${message.role}${hasResponseExtras ? ' p2p-agent-response' : ''}`}
                  key={message.id}
                >
                  <span>{message.title}</span>
                  <p>{message.text}</p>
                  {helpMode && message.helpSource ? (
                    <small className={`p2p-agent-help-source p2p-agent-help-source-${message.helpSource}`}>
                      {message.helpSource === 'local'
                        ? 'Verified ChainWhisper help · answered on this device'
                        : message.helpSource === 'ai'
                          ? 'AI-assisted · grounded in ChainWhisper help'
                          : 'Safety check · nothing was sent'}
                    </small>
                  ) : null}
                  {message.warnings?.length ? (
                    <ul>
                      {message.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                  {relatedHelpTopics.length ? (
                    <div className="p2p-agent-related-topics" aria-label="Related help topics">
                      {relatedHelpTopics.map((topic) =>
                        topic ? (
                          <button
                            key={topic.id}
                            type="button"
                            disabled={helpLoading}
                            onClick={() => {
                              onAskHelpQuestion(topic.questions[0]).catch(() => {});
                            }}
                          >
                            {topic.title}
                          </button>
                        ) : null
                      )}
                    </div>
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
            <div className="p2p-agent-composer p2p-agent-composer-help">
              {helpError ? (
                <div className="error p2p-agent-error" role="alert">
                  <span>{helpError}</span>
                  {helpCanRetry ? (
                    <button
                      type="button"
                      className="standalone-trade-secondary-btn"
                      onClick={() => {
                        onRetryHelpQuestion().catch(() => {});
                      }}
                    >
                      Retry
                    </button>
                  ) : null}
                </div>
              ) : null}
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
                <label className="p2p-sr-only" htmlFor="app-help-question">
                  Ask App Help a question
                </label>
                <textarea
                  id="app-help-question"
                  value={helpPrompt}
                  onChange={(event) => onHelpPromptChange(event.target.value)}
                  placeholder="Ask a question about ChainWhisper..."
                  maxLength={APP_HELP_MAX_QUESTION_CHARS}
                  aria-describedby="app-help-question-hint"
                  rows={2}
                />
                <div className="p2p-agent-submit-row">
                  <span id="app-help-question-hint">
                    {helpPrompt.length}/{APP_HELP_MAX_QUESTION_CHARS} · Common answers stay on this device. Broader
                    questions may use AI after safety checks.
                  </span>
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
            <div className="p2p-agent-composer p2p-agent-composer-trade">
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
                <label className="p2p-sr-only" htmlFor="trade-agent-question">
                  Ask the Trade Agent
                </label>
                <textarea
                  id="trade-agent-question"
                  value={prompt}
                  onChange={(event) => onPromptChange(event.target.value)}
                  placeholder="Ask about a pair, paste a note, or describe the order you want..."
                  aria-describedby="trade-agent-readiness"
                  rows={2}
                />
                <div className="p2p-agent-submit-row">
                  <span
                    id="trade-agent-readiness"
                    className={`p2p-agent-readiness p2p-agent-readiness-${readiness.kind}`}
                    role={readiness.kind === 'error' ? 'alert' : 'status'}
                    aria-live={readiness.kind === 'error' ? 'assertive' : 'polite'}
                  >
                    {readiness.message}
                  </span>
                  {readiness.kind === 'account-needed' ? (
                    <button
                      type="button"
                      className="standalone-trade-secondary-btn p2p-agent-connect-account"
                      onClick={onConnectAccount}
                    >
                      Connect account
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="trade-card-action trade-card-action-accept"
                      disabled={!readiness.canSubmit}
                    >
                      {loading ? 'Working...' : retryPaymentTxHash ? 'Retry without paying' : 'Pay and send'}
                    </button>
                  )}
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
