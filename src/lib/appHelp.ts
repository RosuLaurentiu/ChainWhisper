import {
  APP_HELP_MAX_QUESTION_CHARS,
  APP_HELP_CLARIFICATION_ANSWER,
  APP_HELP_OFF_TOPIC_ANSWER,
  APP_HELP_QUICK_QUESTIONS,
  APP_HELP_SECRET_ANSWER,
  APP_HELP_TOPICS,
  buildAppHelpAiResult,
  containsSensitiveAppHelpMaterial,
  getAppHelpSurface,
  getAppHelpSurfacePath,
  getAppHelpTopic,
  isTrustedAppHelpRoute,
  matchAppHelpTopics,
  normalizeAppHelpCurrentPath,
  normalizeAppHelpQuestion,
  resolveLocalAppHelpAnswer,
  type AppHelpMatch,
  type AppHelpSurface,
  type AppHelpTopic,
  type LocalAppHelpAnswer
} from '../../supabase/functions/_shared/app-help-knowledge';

export {
  APP_HELP_MAX_QUESTION_CHARS,
  APP_HELP_CLARIFICATION_ANSWER,
  APP_HELP_OFF_TOPIC_ANSWER,
  APP_HELP_QUICK_QUESTIONS,
  APP_HELP_SECRET_ANSWER,
  APP_HELP_TOPICS,
  buildAppHelpAiResult,
  containsSensitiveAppHelpMaterial,
  getAppHelpSurface,
  getAppHelpSurfacePath,
  getAppHelpTopic,
  isTrustedAppHelpRoute,
  matchAppHelpTopics,
  normalizeAppHelpCurrentPath,
  normalizeAppHelpQuestion,
  resolveLocalAppHelpAnswer
};
export type { AppHelpMatch, AppHelpSurface, AppHelpTopic, LocalAppHelpAnswer };

export type AppHelpResponseSource = 'local' | 'ai' | 'refusal';

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
  const rawSource = normalizeString(record.source);
  const source = (rawSource === 'nano' ? 'ai' : rawSource) as AppHelpResponseSource;
  const topicId = normalizeString(record.topicId);
  if (!answer || answer.length > 2_000) {
    throw new Error('App Help response was empty or invalid.');
  }
  if (source !== 'local' && source !== 'ai' && source !== 'refusal') {
    throw new Error('App Help returned an invalid response source.');
  }
  const topic = topicId ? getAppHelpTopic(topicId) : null;
  if (source !== 'refusal' && !topic) {
    throw new Error('App Help returned an unknown topic.');
  }
  const relatedTopicIds = source !== 'refusal' && Array.isArray(record.relatedTopicIds)
    ? record.relatedTopicIds
        .map(normalizeString)
        .filter((id, index, items) => Boolean(getAppHelpTopic(id)) && id !== topicId && items.indexOf(id) === index)
        .slice(0, 3)
    : [];
  return {
    answer,
    relatedTopicIds,
    source,
    topicId: source === 'refusal' ? null : topic?.id ?? null
  };
};

export type AppHelpClientResolution =
  | { kind: 'invalid'; message: string }
  | { kind: 'local'; response: AppHelpResponse }
  | { kind: 'clarification'; message: string; topicIds: string[] }
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
  if (containsSensitiveAppHelpMaterial(rawQuestion)) {
    return {
      kind: 'refusal',
      response: {
        answer: APP_HELP_SECRET_ANSWER,
        relatedTopicIds: [],
        source: 'refusal',
        topicId: null
      }
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
  if (match.ambiguous && match.topic) {
    return {
      kind: 'clarification',
      message: APP_HELP_CLARIFICATION_ANSWER,
      topicIds: [match.topic.id, ...match.relatedTopics.map((topic) => topic.id)].slice(0, 3)
    };
  }
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

export const APP_HELP_REQUEST_TIMEOUT_MS = 20_000;

export type AskAppHelpOptions = {
  previousTopicId?: string | null;
  signal?: AbortSignal;
};

export const askAppHelp = async (
  question: string,
  currentPath?: string,
  options: AskAppHelpOptions = {}
): Promise<AppHelpResponse> => {
  const { getSupabaseBrowserClient } = await import('./supabaseClient');
  const supabase = getSupabaseBrowserClient();
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, APP_HELP_REQUEST_TIMEOUT_MS);
  const previousTopicId = getAppHelpTopic(options.previousTopicId)?.id;
  let data: unknown;
  let error: { context?: unknown; message?: string } | null = null;
  try {
    const result = await supabase.functions.invoke<unknown>('trade-agent', {
      body: {
        kind: 'help',
        previousTopicId,
        question,
        surface: getAppHelpSurface(currentPath)
      },
      signal: controller.signal
    });
    data = result.data;
    error = result.error;
  } catch (requestError) {
    if (timedOut) {
      throw new Error('App Help took too long to respond. Try again.');
    }
    if (options.signal?.aborted) {
      throw new DOMException('App Help request cancelled.', 'AbortError');
    }
    throw requestError;
  } finally {
    globalThis.clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
  if (timedOut) {
    throw new Error('App Help took too long to respond. Try again.');
  }
  if (options.signal?.aborted) {
    throw new DOMException('App Help request cancelled.', 'AbortError');
  }
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
