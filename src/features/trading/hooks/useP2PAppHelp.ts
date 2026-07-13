import { useCallback, useEffect, useRef, useState, type FormEventHandler } from 'react';
import {
  APP_HELP_QUICK_QUESTIONS,
  askAppHelp,
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
      text: 'Ask about accounts, privacy, chat, OTC, WISP Portal, or Treasury Data.'
    }
  ]);
  const [appHelpLoading, setAppHelpLoading] = useState(false);
  const [appHelpError, setAppHelpError] = useState('');
  const appHelpMessageCounterRef = useRef(0);
  const appHelpMessagesEndRef = useRef<HTMLDivElement | null>(null);

  const appendAppHelpMessage = useCallback((message: Omit<TradeAgentChatMessage, 'id'>) => {
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
        ...(response.topicId ? { helpTopicId: response.topicId } : {})
      });
    },
    [appendAppHelpMessage]
  );

  const askAppHelpQuestion = useCallback(
    async (questionValue: string) => {
      if (appHelpLoading) {
        return;
      }
      const resolution = resolveAppHelpOnClient(questionValue, currentPath);
      if (resolution.kind === 'invalid') {
        setAppHelpError(resolution.message);
        return;
      }

      setAppHelpError('');
      setAppHelpPrompt('');
      appendAppHelpMessage({ role: 'user', title: 'You', text: questionValue.trim() });
      if (resolution.kind === 'local' || resolution.kind === 'refusal') {
        appendAssistantResponse(resolution.response);
        return;
      }

      setAppHelpLoading(true);
      try {
        const response = await askAppHelp(resolution.question, currentPath);
        appendAssistantResponse(response);
      } catch (error) {
        setAppHelpError(error instanceof Error ? error.message : 'App Help is unavailable right now.');
      } finally {
        setAppHelpLoading(false);
      }
    },
    [appHelpLoading, appendAppHelpMessage, appendAssistantResponse, currentPath]
  );

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
    if (!active) {
      return;
    }
    const messagesContainer = appHelpMessagesEndRef.current?.parentElement;
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }, [active, appHelpLoading, appHelpMessages]);

  return {
    appHelpError,
    appHelpLoading,
    appHelpMessages,
    appHelpMessagesEndRef,
    appHelpPrompt,
    appHelpQuickQuestions: APP_HELP_QUICK_QUESTIONS,
    askAppHelpQuestion,
    submitAppHelp,
    updateAppHelpPrompt
  };
}
