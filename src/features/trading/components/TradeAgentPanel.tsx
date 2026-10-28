import type { FormEventHandler, Ref } from 'react';
import { APP_HELP_MAX_QUESTION_CHARS, getAppHelpTopic } from '../../../lib/appHelp';
import type { TradeAgentQuickAction, TradeAgentResponseAction } from '../../../lib/tradeAgent';
import type { TradeAgentReadiness } from '../../../lib/tradeAgentReadiness';
import type { TradeAgentChatMessage } from './P2PTradingPage.helpers';
import AgentSetupPanel from './AgentSetupPanel';

export type TradeAgentPanelMode = 'help' | 'trade' | 'setup';

type AppHelpQuickQuestion = {
  label: string;
  question: string;
  topicId: string;
};

type TradeAgentPanelProps = {
  compactLayout?: boolean;
  mode: TradeAgentPanelMode;
  onModeChange: (mode: TradeAgentPanelMode) => void;
  venueLabel: 'DEX' | 'P2P';
  pairLabel: string;
  ratioLabel: string;
  actionsAvailable: boolean;
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
  compactLayout = false,
  mode,
  onModeChange,
  venueLabel,
  pairLabel,
  ratioLabel,
  actionsAvailable,
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
  const tradeMode = mode === 'trade';
  const setupMode = mode === 'setup';
  const visibleMessages = helpMode ? helpMessages : messages;
  const activeLoading = helpMode ? helpLoading : loading;
  const activeMessagesEndRef = helpMode ? helpMessagesEndRef : messagesEndRef;
  const emptyTradeConversation = tradeMode && visibleMessages.length <= 1 && !activeLoading;

  return (
    <section className="standalone-trades-section p2p-agent-section p2p-trade-workspace-panel" aria-label={helpMode ? 'ChainWhisper App Help' : 'ChainWhisper Trade Agent'}>
      <div className={`p2p-trade-entry-panel p2p-agent-panel${setupMode ? ' p2p-agent-panel-setup' : ''}`}>
        <nav className="p2p-agent-mode-toggle" aria-label="Agent tools">
          <button type="button" className={helpMode ? 'active' : ''} aria-current={helpMode ? 'page' : undefined} onClick={() => onModeChange('help')}>
            App Help
          </button>
          <button type="button" className={tradeMode ? 'active' : ''} aria-current={tradeMode ? 'page' : undefined} onClick={() => onModeChange('trade')}>
            Trade Agent
          </button>
          <button type="button" className={setupMode ? 'active' : ''} aria-current={setupMode ? 'page' : undefined} onClick={() => onModeChange('setup')}>
            MCP for agents
          </button>
        </nav>

        {setupMode ? (
          <AgentSetupPanel />
        ) : (
          <div className={`p2p-agent-workspace${helpMode ? ' p2p-agent-workspace-help' : ''}`}>
            <div className="p2p-agent-conversation">
              <div
                className={`p2p-agent-chat-window${emptyTradeConversation ? ' p2p-agent-chat-window-empty' : ''}`}
                role="tabpanel"
              >
                {emptyTradeConversation ? (
                  <div className="p2p-agent-empty-state">
                    <span>Private trading assistant</span>
                    <h2>What do you want to do?</h2>
                    <p>Start from the current Trading context or describe a different trade.</p>
                    <div className="p2p-agent-quick-actions p2p-agent-quick-action-grid" aria-label="Trade Agent actions">
                      {quickActions.map((item) => {
                        const quickPrompt = resolveQuickActionPrompt(item);
                        return (
                          <button
                            key={`${item.action}:${item.label}`}
                            type="button"
                            disabled={!actionsAvailable}
                            onClick={() => onSelectQuickAction(item, quickPrompt)}
                          >
                            <strong>{item.label}</strong>
                            <small>{actionsAvailable ? 'Use current Trading context' : 'DEX action coming soon'}</small>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
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
                      return (
                        <div className={`p2p-agent-message p2p-agent-message-${message.role}`} key={message.id}>
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
                            <ul>{message.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                          ) : null}
                          {relatedHelpTopics.length ? (
                            <div className="p2p-agent-related-topics" aria-label="Related help topics">
                              {relatedHelpTopics.map((topic) => topic ? (
                                <button
                                  key={topic.id}
                                  type="button"
                                  disabled={helpLoading}
                                  onClick={() => { onAskHelpQuestion(topic.questions[0]).catch(() => {}); }}
                                >
                                  {topic.title}
                                </button>
                              ) : null)}
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
                                    disabled={!actionsAvailable}
                                    onClick={() => {
                                      onApplyAction(action).catch((applyError) => {
                                        onActionError(applyError instanceof Error ? applyError.message : 'Could not use this draft.');
                                      });
                                    }}
                                  >
                                    {actionsAvailable ? getActionCta(action) : 'Coming soon'}
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
                )}

                {helpMode ? (
                  <div className="p2p-agent-composer p2p-agent-composer-help">
                    {helpError ? (
                      <div className="error p2p-agent-error" role="alert">
                        <span>{helpError}</span>
                        {helpCanRetry ? (
                          <button type="button" className="standalone-trade-secondary-btn" onClick={() => { onRetryHelpQuestion().catch(() => {}); }}>
                            Retry
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="p2p-agent-quick-actions" aria-label="Common App Help questions">
                      {helpQuickQuestions.map((item) => (
                        <button key={item.topicId} type="button" disabled={helpLoading} onClick={() => { onAskHelpQuestion(item.question).catch(() => {}); }}>
                          {item.label}
                        </button>
                      ))}
                    </div>
                    <form className="p2p-agent-prompt" onSubmit={onHelpSubmit}>
                      <label className="p2p-sr-only" htmlFor="app-help-question">Ask App Help a question</label>
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
                        <span id="app-help-question-hint">{helpPrompt.length}/{APP_HELP_MAX_QUESTION_CHARS} · Free product help.</span>
                        <button type="submit" className="trade-card-action trade-card-action-accept" disabled={!helpCanSubmit}>
                          {helpLoading ? 'Checking...' : 'Ask free'}
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <div className="p2p-agent-composer p2p-agent-composer-trade">
                    <form className="p2p-agent-prompt" onSubmit={onSubmit}>
                      <label className="p2p-sr-only" htmlFor="trade-agent-question">Ask the Trade Agent</label>
                      <textarea
                        id="trade-agent-question"
                        value={prompt}
                        onChange={(event) => onPromptChange(event.target.value)}
                        placeholder="Describe the trade you want to review or prepare..."
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
                          {actionsAvailable ? readiness.message : 'DEX preparation actions are preview-only for now.'}
                        </span>
                        {readiness.kind === 'account-needed' ? (
                          <button type="button" className="standalone-trade-secondary-btn p2p-agent-connect-account" onClick={onConnectAccount}>
                            Connect wallet
                          </button>
                        ) : (
                          <button type="submit" className="trade-card-action trade-card-action-accept" disabled={!actionsAvailable || !readiness.canSubmit}>
                            {loading ? 'Working...' : retryPaymentTxHash ? 'Retry without paying' : 'Pay and send'}
                          </button>
                        )}
                      </div>
                    </form>
                  </div>
                )}
              </div>
            </div>

            {tradeMode ? (
              <details className="p2p-agent-context" aria-label="Attached Trading context" open={!compactLayout}>
                <summary className="p2p-agent-context-heading">
                  <span>Attached context</span>
                  <strong>{venueLabel}</strong>
                </summary>
                <article>
                  <span>Market</span>
                  <strong>{pairLabel}</strong>
                  <small>{ratioLabel}</small>
                </article>
                <article>
                  <span>Attached item</span>
                  <strong>{prompt.trim() ? 'Draft request' : 'No trade attached'}</strong>
                  <small>{prompt.trim() ? 'The current prompt will be reviewed before any action.' : 'Select an offer, order, or strategy to bring it here.'}</small>
                </article>
                <article>
                  <span>Readiness</span>
                  <strong>{actionsAvailable ? 'P2P actions available' : 'DEX preview'}</strong>
                  <small>{actionsAvailable ? feeLabel : 'DEX execution actions will unlock when their integrations are ready.'}</small>
                </article>
              </details>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
