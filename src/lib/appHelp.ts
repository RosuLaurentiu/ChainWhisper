import {
  APP_HELP_MAX_QUESTION_CHARS,
  APP_HELP_OFF_TOPIC_ANSWER,
  APP_HELP_QUICK_QUESTIONS,
  APP_HELP_TOPICS,
  getAppHelpTopic,
  isTrustedAppHelpRoute,
  matchAppHelpTopics,
  normalizeAppHelpCurrentPath,
  normalizeAppHelpQuestion,
  resolveLocalAppHelpAnswer,
  type AppHelpMatch,
  type AppHelpTopic,
  type LocalAppHelpAnswer
} from '../../supabase/functions/_shared/app-help-knowledge';

export {
  APP_HELP_MAX_QUESTION_CHARS,
  APP_HELP_OFF_TOPIC_ANSWER,
  APP_HELP_QUICK_QUESTIONS,
  APP_HELP_TOPICS,
  getAppHelpTopic,
  isTrustedAppHelpRoute,
  matchAppHelpTopics,
  normalizeAppHelpCurrentPath,
  normalizeAppHelpQuestion,
  resolveLocalAppHelpAnswer
};
export type { AppHelpMatch, AppHelpTopic, LocalAppHelpAnswer };

export type AppHelpResponseSource = 'local' | 'nano' | 'refusal';

export type AppHelpResponse = {
  answer: string;
  relatedTopicIds: string[];
  source: AppHelpResponseSource;
  topicId: string | null;
};

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const normalizeAppHelpResponse = (value: unknown): AppHelpResponse => {
  if (!value || typeof value !== 'object') {
    throw new Error('App Help returned an invalid response.');
  }
  const record = value as Record<string, unknown>;
  const answer = normalizeString(record.answer);
  const source = normalizeString(record.source) as AppHelpResponseSource;
  const topicId = normalizeString(record.topicId);
  if (!answer || answer.length > 2_000) {
    throw new Error('App Help response was empty or invalid.');
  }
  if (source !== 'local' && source !== 'nano' && source !== 'refusal') {
    throw new Error('App Help returned an invalid response source.');
  }
  const topic = topicId ? getAppHelpTopic(topicId) : null;
  if (source !== 'refusal' && !topic) {
    throw new Error('App Help returned an unknown topic.');
  }
  const relatedTopicIds = Array.isArray(record.relatedTopicIds)
    ? record.relatedTopicIds
        .map(normalizeString)
        .filter((id, index, items) => Boolean(getAppHelpTopic(id)) && id !== topicId && items.indexOf(id) === index)
        .slice(0, 3)
    : [];
  return {
    answer,
    relatedTopicIds,
    source,
    topicId: topic?.id ?? null
  };
};

export type AppHelpClientResolution =
  | { kind: 'invalid'; message: string }
  | { kind: 'local'; response: AppHelpResponse }
  | { kind: 'refusal'; response: AppHelpResponse }
  | { kind: 'remote'; match: AppHelpMatch; question: string };

export const resolveAppHelpOnClient = (questionValue: unknown, currentPath?: unknown): AppHelpClientResolution => {
  const rawQuestion = typeof questionValue === 'string' ? questionValue.trim() : '';
  if (!rawQuestion) {
    return { kind: 'invalid', message: 'Ask a question about ChainWhisper first.' };
  }
  if (rawQuestion.length > APP_HELP_MAX_QUESTION_CHARS) {
    return {
      kind: 'invalid',
      message: `Keep App Help questions under ${APP_HELP_MAX_QUESTION_CHARS} characters.`
    };
  }
  const local = resolveLocalAppHelpAnswer(rawQuestion, currentPath);
  if (local) {
    return {
      kind: 'local',
      response: {
        answer: local.answer,
        relatedTopicIds: local.relatedTopicIds,
        source: 'local',
        topicId: local.topicId
      }
    };
  }
  const match = matchAppHelpTopics(rawQuestion, currentPath);
  if (!match.topic || match.confidence === 'none') {
    return {
      kind: 'refusal',
      response: {
        answer: APP_HELP_OFF_TOPIC_ANSWER,
        relatedTopicIds: [],
        source: 'refusal',
        topicId: null
      }
    };
  }
  return { kind: 'remote', match, question: rawQuestion };
};

export const askAppHelp = async (question: string, currentPath?: string): Promise<AppHelpResponse> => {
  const { getSupabaseBrowserClient } = await import('./supabaseClient');
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.functions.invoke<unknown>('trade-agent', {
    body: {
      kind: 'help',
      currentPath: normalizeAppHelpCurrentPath(currentPath),
      question
    }
  });
  if (error) {
    const response = (error as { context?: unknown }).context;
    if (response instanceof Response) {
      const payload = await response.clone().json().catch(() => null) as { error?: unknown } | null;
      const message = normalizeString(payload?.error) || await response.text().catch(() => '');
      if (message) {
        throw new Error(message);
      }
    }
    throw new Error(error.message || 'App Help request failed.');
  }
  return normalizeAppHelpResponse(data);
};
