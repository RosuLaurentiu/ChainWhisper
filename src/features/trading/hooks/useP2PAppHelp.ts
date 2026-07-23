import { useCallback, useEffect, useRef, useState, type FormEventHandler } from 'react';
import {
  APP_HELP_QUICK_QUESTIONS,
  askAppHelp,
  getAppHelpTopic,
  resolveAppHelpOnClient,
  type AppHelpResponse
} from '../../../lib/appHelp';
import type { TradeAgentChatMessage } from '../components/P2PTradingPage.helpers';

type UseP2PAppHelpArgs = {
  active: boolean;
  currentPath: string;
};

export default function useP2PAppHelp({ active, currentPath }: UseP2PAppHelpArgs) {
  const [appHelpPrompt, setAppHelpPrompt] = useState('');
  const [appHelpMessages, setAppHelpMessages] = useState<TradeAgentChatMessage[]>([
    {
      id: 'app-help:intro',
      role: 'assistant',
      title: 'App Help',
      text: 'Ask about accounts, privacy, chat, OTC, Privacy Portal, or Treasury Data.'
    }
  ]);
  const [appHelpLoading, setAppHelpLoading] = useState(false);
  const [appHelpError, setAppHelpError] = useState('');
  const [failedAppHelpQuestion, setFailedAppHelpQuestion] = useState('');
  const appHelpMessageCounterRef = useRef(0);
  const appHelpMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const appHelpRequestRef = useRef<AbortController | null>(null);
  const appHelpRequestInFlightRef = useRef(false);
  const lastTrustedTopicIdRef = useRef<string | null>(null);
  const shouldAutoScrollRef = useRef(true);

  const appendAppHelpMessage = useCallback((message: Omit<TradeAgentChatMessage, 'id'>, forceScroll = false) => {
    const messagesContainer = appHelpMessagesEndRef.current?.parentElement;
    const distanceFromBottom = messagesContainer
      ? messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight
      : 0;
    shouldAutoScrollRef.current = forceScroll || distanceFromBottom <= 80;
    appHelpMessageCounterRef.current += 1;
    const id = `app-help:${Date.now()}:${appHelpMessageCounterRef.current}`;
    setAppHelpMessages((current) => [...current, { ...message, id }]);
  }, []);

  const appendAssistantResponse = useCallback(
    (response: AppHelpResponse) => {
      appendAppHelpMessage({
        role: 'assistant',
        title: 'App Help',
        text: response.answer,
        helpSource: response.source,
        relatedHelpTopicIds: response.relatedTopicIds,
        ...(response.topicId ? { helpTopicId: response.topicId } : {})
      });
      lastTrustedTopicIdRef.current = response.topicId;
    },
    [appendAppHelpMessage]
  );

  const showAppHelpTopic = useCallback(
    (topicId: string) => {
      const topic = getAppHelpTopic(topicId);
      if (!topic) {
        return false;
      }
      setAppHelpError('');
      setFailedAppHelpQuestion('');
      appendAssistantResponse({
        answer: topic.answer,
        relatedTopicIds: topic.relatedTopicIds.filter((id) => Boolean(getAppHelpTopic(id))).slice(0, 3),
        source: 'local',
        topicId: topic.id
      });
      return true;
    },
    [appendAssistantResponse]
  );

  const runAppHelpQuestion = useCallback(
    async (questionValue: string, isRetry = false) => {
      if (appHelpRequestInFlightRef.current) {
        return;
      }
      const resolution = resolveAppHelpOnClient(questionValue, currentPath);
      if (resolution.kind === 'invalid') {
        setAppHelpError(resolution.message);
        return;
      }

      setAppHelpError('');
      setFailedAppHelpQuestion('');
      setAppHelpPrompt('');
      if (!isRetry) {
        appendAppHelpMessage({ role: 'user', title: 'You', text: questionValue.trim() }, true);
      } else {
        shouldAutoScrollRef.current = true;
      }
      if (resolution.kind === 'local' || resolution.kind === 'refusal') {
        appendAssistantResponse(resolution.response);
        return;
      }
      if (resolution.kind === 'clarification') {
        appendAppHelpMessage({
          role: 'assistant',
          title: 'App Help',
          text: resolution.message,
          helpSource: 'local',
          relatedHelpTopicIds: resolution.topicIds
        });
        return;
      }

      appHelpRequestInFlightRef.current = true;
      setAppHelpLoading(true);
      const controller = new AbortController();
      appHelpRequestRef.current = controller;
      try {
        const response = await askAppHelp(resolution.question, currentPath, {
          previousTopicId: lastTrustedTopicIdRef.current,
          signal: controller.signal
        });
        appendAssistantResponse(response);
      } catch (error) {
        if (!controller.signal.aborted) {
          setFailedAppHelpQuestion(resolution.question);
          setAppHelpError(error instanceof Error ? error.message : 'App Help is unavailable right now.');
        }
      } finally {
        if (appHelpRequestRef.current === controller) {
          appHelpRequestRef.current = null;
          appHelpRequestInFlightRef.current = false;
          setAppHelpLoading(false);
        }
      }
    },
    [appendAppHelpMessage, appendAssistantResponse, currentPath]
  );

  const askAppHelpQuestion = useCallback(
    async (questionValue: string) => runAppHelpQuestion(questionValue),
    [runAppHelpQuestion]
  );

  const retryAppHelpQuestion = useCallback(async () => {
    if (!failedAppHelpQuestion) {
      return;
    }
    await runAppHelpQuestion(failedAppHelpQuestion, true);
  }, [failedAppHelpQuestion, runAppHelpQuestion]);

  const submitAppHelp: FormEventHandler<HTMLFormElement> = useCallback(
    (event) => {
      event.preventDefault();
      askAppHelpQuestion(appHelpPrompt).catch(() => {});
    },
    [appHelpPrompt, askAppHelpQuestion]
  );

  const updateAppHelpPrompt = useCallback((value: string) => {
    setAppHelpError('');
    setAppHelpPrompt(value);
  }, []);

  useEffect(() => {
    if (!active || !shouldAutoScrollRef.current) {
      return;
    }
    const messagesContainer = appHelpMessagesEndRef.current?.parentElement;
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }, [active, appHelpLoading, appHelpMessages]);

  useEffect(() => () => {
    appHelpRequestRef.current?.abort();
    appHelpRequestRef.current = null;
    appHelpRequestInFlightRef.current = false;
  }, []);

  return {
    appHelpCanRetry: Boolean(failedAppHelpQuestion && !appHelpLoading),
    appHelpError,
    appHelpLoading,
    appHelpMessages,
    appHelpMessagesEndRef,
    appHelpPrompt,
    appHelpQuickQuestions: APP_HELP_QUICK_QUESTIONS,
    askAppHelpQuestion,
    retryAppHelpQuestion,
    showAppHelpTopic,
    submitAppHelp,
    updateAppHelpPrompt
  };
}
