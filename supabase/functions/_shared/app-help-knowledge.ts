export const APP_HELP_MAX_QUESTION_CHARS = 600;
export const APP_HELP_MAX_INPUT_TOKENS = 2_000;

export type AppHelpTopic = {
  id: string;
  title: string;
  answer: string;
  route: string;
  routeLabel: string;
  questions: readonly string[];
  phrases: readonly string[];
  keywords: readonly string[];
};

export type AppHelpMatchConfidence = 'exact' | 'high' | 'moderate' | 'none';

export type AppHelpMatch = {
  confidence: AppHelpMatchConfidence;
  relatedTopics: AppHelpTopic[];
  score: number;
  topic: AppHelpTopic | null;
};

export type LocalAppHelpAnswer = {
  answer: string;
  confidence: 'exact' | 'high';
  relatedTopicIds: string[];
  topicId: string;
};

export const APP_HELP_OFF_TOPIC_ANSWER =
  'I answer questions about ChainWhisper accounts, privacy, chat, OTC, WISP Portal, and Treasury Data.';
export const APP_HELP_UNSUPPORTED_ANSWER =
  'I do not have enough verified ChainWhisper information to answer that.';

export const APP_HELP_TOPICS: readonly AppHelpTopic[] = [
  {
    id: 'getting-started',
    title: 'Start',
    answer:
      'Open an app from Home. Home and Treasury Data need no wallet. For Chat, OTC, or WISP Portal, connect and unlock privacy only when prompted.',
    route: '/',
    routeLabel: 'Home',
    questions: ['How do I start?', 'How does ChainWhisper work?'],
    phrases: ['get started with chainwhisper', 'how chainwhisper works', 'first time using chainwhisper'],
    keywords: ['getting started', 'start', 'home', 'chainwhisper', 'app']
  },
  {
    id: 'owner-and-chainwhisper-accounts',
    title: 'Wallet vs account',
    answer:
      'The owner wallet handles login, recovery, and funding. The ChainWhisper account sends messages and creates trades or swaps. Your session carries across apps.',
    route: '/',
    routeLabel: 'Home',
    questions: ['Owner wallet or ChainWhisper account?'],
    phrases: ['owner wallet and chainwhisper account', 'difference between owner and account', 'which wallet does chainwhisper use'],
    keywords: ['owner wallet', 'browser wallet', 'chainwhisper account', 'wallet', 'account', 'funding', 'signer']
  },
  {
    id: 'privacy-and-recovery',
    title: 'Privacy & recovery',
    answer:
      'Unlock privacy with the COTI MetaMask Snap. ChainWhisper then recovers the linked account or offers create and import options. Owner and ChainWhisper privacy keys stay separate.',
    route: '/chat',
    routeLabel: 'Chat',
    questions: ['How do I unlock or recover?'],
    phrases: ['unlock privacy', 'recover my account', 'privacy recovery', 'metamask snap recovery'],
    keywords: ['privacy', 'unlock', 'recover', 'recovery', 'aes', 'snap', 'account']
  },
  {
    id: 'direct-and-group-chat',
    title: 'Direct and group chat',
    answer:
      'Direct chat supports encrypted messages, replies, reactions, tips, and trade offers. Group chat adds invites and member controls. Pasted order links stay links unless you create an in-chat trade.',
    route: '/chat',
    routeLabel: 'Chat',
    questions: ['How do direct and group chat work?'],
    phrases: ['direct and group chat', 'send an encrypted message', 'group chat invites', 'chat with someone'],
    keywords: ['chat', 'message', 'direct chat', 'group chat', 'invite', 'reaction', 'reply', 'tip']
  },
  {
    id: 'otc-navigation',
    title: 'OTC basics',
    answer:
      'Trade creates Swap, Limit, or Recurring orders. Desk lists public offers. Agent helps with trades. Orders shows your activity. Swap uses one best order; it does not combine orders.',
    route: '/otc',
    routeLabel: 'OTC Trade',
    questions: ['What can I do in OTC?', 'What are Trade, Desk, Agent, and Orders?'],
    phrases: ['what can i do in otc', 'trade desk agent and orders', 'how otc works', 'otc navigation'],
    keywords: ['otc', 'trade', 'desk', 'orders', 'swap', 'limit', 'agent']
  },
  {
    id: 'trade-agent-capabilities',
    title: 'Trade Agent capabilities',
    answer:
      'App Help answers product questions for free. Trade Agent can explain orders, compare prices, and draft or prefill trades for WISP. It never signs or executes.',
    route: '/otc/agent',
    routeLabel: 'OTC Agent',
    questions: ['What can the Trade Agent do?', 'What is the difference between App Help and Trade Agent?'],
    phrases: ['what can the trade agent do', 'app help and trade agent', 'trade agent capabilities', 'does the agent execute trades'],
    keywords: ['trade agent', 'app help', 'draft trade', 'prefill', 'execute', 'autopilot', 'wisp']
  },
  {
    id: 'order-access-types',
    title: 'Public, unlisted, and direct orders',
    answer:
      'Public orders appear on Desk. Unlisted orders use a private link. Direct orders are limited to one recipient.',
    route: '/otc/desk',
    routeLabel: 'OTC Desk',
    questions: ['What is the difference between public, unlisted, and direct orders?'],
    phrases: ['public unlisted and direct orders', 'difference between order access types', 'private order link', 'direct recipient order'],
    keywords: ['public', 'unlisted', 'direct', 'order link', 'recipient', 'access', 'desk']
  },
  {
    id: 'private-liquidity',
    title: 'Private liquidity',
    answer:
      'Visible amounts use normal OTC orders. Private liquidity hides private-token order and fill amounts. Makers and fillers can reveal only their own progress after unlocking privacy.',
    route: '/otc',
    routeLabel: 'OTC Trade',
    questions: ['What is private liquidity?', 'What is the difference between private liquidity and visible amounts?'],
    phrases: ['private liquidity', 'visible amounts', 'hidden amount order', 'hide order amounts'],
    keywords: ['private liquidity', 'visible amounts', 'hidden', 'private token', 'amounts', 'liquidity', 'reveal']
  },
  {
    id: 'recurring-liquidity',
    title: 'Recurring liquidity',
    answer:
      'Recurring orders are reusable two-sided liquidity, not scheduled orders. Fills move inventory between sides. Makers can edit prices or liquidity, or close the order to withdraw what remains.',
    route: '/otc',
    routeLabel: 'OTC Recurring',
    questions: ['How do recurring orders work?'],
    phrases: ['recurring orders work', 'recurring liquidity', 'reusable two sided order', 'recurring order timer'],
    keywords: ['recurring', 'inventory', 'liquidity', 'two sided', 'close order', 'reusable']
  },
  {
    id: 'links-counters-and-settlement',
    title: 'Order links, counters, and settlement',
    answer:
      'Links identify an order and its escrow contract. A completed counter cancels the parent order. Private-order counters are not supported. You confirm every action.',
    route: '/otc/orders',
    routeLabel: 'OTC Orders',
    questions: ['How do order links, counters, and settlement work?', 'How do my OTC orders work?'],
    phrases: ['order links counters and settlement', 'counter an order', 'settle an order', 'my otc orders'],
    keywords: ['order', 'orders', 'link', 'counter', 'settlement', 'history', 'received', 'parent order']
  },
  {
    id: 'wisp-fees-and-confirmations',
    title: 'WISP fees and confirmations',
    answer:
      'Paid Trade Agent requests transfer the shown WISP fee before processing. A failed request keeps its payment reference for a free retry. App Help does not charge WISP.',
    route: '/otc/agent',
    routeLabel: 'OTC Agent',
    questions: ['Why does the Trade Agent charge WISP?', 'Can I retry a Trade Agent request without paying again?'],
    phrases: ['trade agent charge wisp', 'retry without paying', 'wisp fee confirmation', 'paid agent request'],
    keywords: ['wisp', 'fee', 'payment', 'confirmation', 'retry', 'paid', 'trade agent']
  },
  {
    id: 'privacy-portal',
    title: 'Privacy Portal',
    answer:
      'Privacy Portal converts seven supported COTI assets between public and private forms through verified official bridges. WISP is also listed as a clearly separated ChainWhisper recovery-only token for current or legacy pWISP withdrawals; new WISP shielding is unavailable.',
    route: '/portal',
    routeLabel: 'Privacy Portal',
    questions: ['What does the Privacy Portal do?'],
    phrases: ['what does the privacy portal do', 'privacy portal swap', 'public to private tokens', 'private token bridge', 'wisp recovery'],
    keywords: ['privacy portal', 'portal', 'private token', 'bridge', 'coti', 'wisp recovery', 'unshield']
  },
  {
    id: 'treasury-data',
    title: 'Treasury Data',
    answer:
      'Treasury Data is a read-only analytics app built from smart-contract and live-feed data. It does not need a connected wallet and does not submit transactions.',
    route: '/treasury',
    routeLabel: 'Treasury Data',
    questions: ['What is Treasury Data?'],
    phrases: ['what is treasury data', 'treasury analytics', 'does treasury need a wallet'],
    keywords: ['treasury', 'analytics', 'data', 'read only', 'wallet']
  },
  {
    id: 'readiness-troubleshooting',
    title: 'Wallet, privacy, and balance readiness',
    answer:
      'If an action is disabled, connect the wallet, use COTI Mainnet, unlock privacy, select or recover the ChainWhisper account, and check funds. Refresh balances after transfers.',
    route: '/',
    routeLabel: 'Home',
    questions: ['Why is a button disabled or my balance missing?'],
    phrases: ['button disabled', 'balance missing', 'cannot click', 'action is unavailable', 'wallet not ready'],
    keywords: ['disabled', 'balance', 'missing', 'unavailable', 'connect', 'network', 'funds', 'ready']
  }
];

const TOPICS_BY_ID = new Map(APP_HELP_TOPICS.map((topic) => [topic.id, topic]));
const TRUSTED_ROUTES = new Set(APP_HELP_TOPICS.map((topic) => topic.route));
const SPELLING_REPLACEMENTS = new Map([
  ['wisper', 'whisper'],
  ['whispr', 'whisper'],
  ['chainwisper', 'chainwhisper'],
  ['walet', 'wallet'],
  ['acount', 'account'],
  ['privcy', 'privacy'],
  ['recurrng', 'recurring'],
  ['treasry', 'treasury'],
  ['otcdesk', 'otc desk']
]);

const normalizePathname = (value: string): string => {
  const withoutQuery = value.split(/[?#]/u, 1)[0]?.trim().toLowerCase() || '/';
  if (!withoutQuery.startsWith('/')) {
    return '/';
  }
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/u, '') : '/';
};

export const normalizeAppHelpCurrentPath = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '/';
  }
  const path = normalizePathname(value);
  if (path === '/home') return '/';
  if (path === '/messages' || path === '/messenger') return '/chat';
  if (path === '/swap' || path === '/shield' || path === '/whisper-shield') return '/portal';
  if (path === '/treasury-data') return '/treasury';
  if (path === '/otcdesk' || path === '/trades/desk') return '/otc/desk';
  if (path === '/trades/agent') return '/otc/agent';
  if (path === '/trades/orders') return '/otc/orders';
  if (path.startsWith('/trades') || path.startsWith('/otcdesk')) return '/otc';
  if (path.startsWith('/otc/order')) return '/otc/orders';
  if (path.startsWith('/otc/desk')) return '/otc/desk';
  if (path.startsWith('/otc/agent')) return '/otc/agent';
  if (path.startsWith('/otc/orders')) return '/otc/orders';
  if (path.startsWith('/otc')) return '/otc';
  if (path.startsWith('/chat')) return '/chat';
  if (path.startsWith('/portal')) return '/portal';
  if (path.startsWith('/treasury')) return '/treasury';
  return '/';
};

export const isTrustedAppHelpRoute = (value: unknown): value is string =>
  typeof value === 'string' && TRUSTED_ROUTES.has(value);

export const getAppHelpTopic = (topicId: unknown): AppHelpTopic | null =>
  typeof topicId === 'string' ? TOPICS_BY_ID.get(topicId) ?? null : null;

export const normalizeAppHelpQuestion = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
  const corrected = normalized
    .split(/\s+/u)
    .map((token) => SPELLING_REPLACEMENTS.get(token) ?? token)
    .join(' ')
    .replace(/\bchain\s+whisper\b/gu, 'chainwhisper');
  return corrected.replace(/\s+/gu, ' ').trim();
};

const normalizeCatalogValue = (value: string): string => normalizeAppHelpQuestion(value);

const pathAffinity = (topicRoute: string, currentPath: string): number => {
  if (topicRoute === currentPath) {
    return 4;
  }
  if (topicRoute.startsWith('/otc') && currentPath.startsWith('/otc')) {
    return 2;
  }
  return 0;
};

type RankedTopic = {
  exact: boolean;
  keywordHits: number;
  phraseHits: number;
  score: number;
  topic: AppHelpTopic;
};

const rankTopic = (question: string, topic: AppHelpTopic, currentPath: string): RankedTopic => {
  const tokens = new Set(question.split(' ').filter(Boolean));
  const exact = topic.questions.some((item) => normalizeCatalogValue(item) === question);
  let phraseHits = 0;
  let keywordHits = 0;
  let score = exact ? 100 : 0;

  topic.phrases.forEach((phrase) => {
    const normalizedPhrase = normalizeCatalogValue(phrase);
    if (normalizedPhrase && question.includes(normalizedPhrase)) {
      phraseHits += 1;
      score += question === normalizedPhrase ? 30 : 14;
    }
  });

  topic.keywords.forEach((keyword) => {
    const normalizedKeyword = normalizeCatalogValue(keyword);
    if (!normalizedKeyword) {
      return;
    }
    const matched = normalizedKeyword.includes(' ')
      ? question.includes(normalizedKeyword)
      : tokens.has(normalizedKeyword);
    if (matched) {
      keywordHits += 1;
      score += normalizedKeyword.includes(' ') ? 5 : 3;
    }
  });

  if (score > 0) {
    score += pathAffinity(topic.route, currentPath);
  }
  return { exact, keywordHits, phraseHits, score, topic };
};

export const matchAppHelpTopics = (questionValue: unknown, currentPathValue?: unknown): AppHelpMatch => {
  const question = normalizeAppHelpQuestion(questionValue);
  if (!question) {
    return { confidence: 'none', relatedTopics: [], score: 0, topic: null };
  }
  const currentPath = normalizeAppHelpCurrentPath(currentPathValue);
  const ranked = APP_HELP_TOPICS
    .map((topic) => rankTopic(question, topic, currentPath))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.topic.title.localeCompare(right.topic.title));
  const best = ranked[0];
  if (!best) {
    return { confidence: 'none', relatedTopics: [], score: 0, topic: null };
  }

  const confidence: AppHelpMatchConfidence = best.exact
    ? 'exact'
    : best.phraseHits > 0 || best.keywordHits >= 2
      ? 'high'
      : 'moderate';
  return {
    confidence,
    relatedTopics: ranked.slice(1, 3).map((item) => item.topic),
    score: best.score,
    topic: best.topic
  };
};

export const resolveLocalAppHelpAnswer = (
  question: unknown,
  currentPath?: unknown
): LocalAppHelpAnswer | null => {
  const match = matchAppHelpTopics(question, currentPath);
  if (!match.topic || (match.confidence !== 'exact' && match.confidence !== 'high')) {
    return null;
  }
  return {
    answer: match.topic.answer,
    confidence: match.confidence,
    relatedTopicIds: match.relatedTopics.map((topic) => topic.id),
    topicId: match.topic.id
  };
};

const QUICK_TOPIC_IDS = [
  'getting-started',
  'owner-and-chainwhisper-accounts',
  'privacy-and-recovery',
  'otc-navigation',
  'private-liquidity',
  'privacy-portal'
] as const;

export const APP_HELP_QUICK_QUESTIONS = QUICK_TOPIC_IDS.map((topicId) => {
  const topic = TOPICS_BY_ID.get(topicId)!;
  return { label: topic.title, question: topic.questions[0], topicId: topic.id };
});
