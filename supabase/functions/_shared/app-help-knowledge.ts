import { containsTradeAgentSecretMaterial } from './trade-agent-secret-material.ts';

export const APP_HELP_MAX_QUESTION_CHARS = 600;
export const APP_HELP_MAX_INPUT_TOKENS = 2_000;

export type AppHelpSurface = 'home' | 'chat' | 'otc' | 'portal' | 'treasury' | 'error';

export type AppHelpTopic = {
  id: string;
  title: string;
  summary: string;
  answer: string;
  prerequisites: readonly string[];
  steps: readonly string[];
  cautions: readonly string[];
  aliases: readonly string[];
  relatedTopicIds: readonly string[];
  surfaceAffinity: readonly AppHelpSurface[];
  route: string;
  questions: readonly string[];
  phrases: readonly string[];
  keywords: readonly string[];
};

export type AppHelpMatchConfidence = 'exact' | 'high' | 'moderate' | 'none';

export type AppHelpMatch = {
  ambiguous: boolean;
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
  'I can help with browser wallets, privacy, Chat, DEX, OTC, the Privacy Portal, and COTI Private TVL.';
export const APP_HELP_UNSUPPORTED_ANSWER =
  'I do not have enough verified ChainWhisper information to answer that.';
export const APP_HELP_SECRET_ANSWER =
  'For your privacy, do not share wallet addresses, private keys, recovery phrases, access secrets, or private order links. Remove them, then ask again.';
export const APP_HELP_CLARIFICATION_ANSWER =
  'I found a few possible ChainWhisper topics. Which one did you mean?';

export type AppHelpAiResultInput = {
  answer: string;
  relatedTopicIds: string[];
  supported: boolean;
  topicId: string;
};

export type AppHelpAiResult =
  | {
      answer: string;
      relatedTopicIds: string[];
      source: 'ai';
      topicId: string;
    }
  | {
      answer: string;
      relatedTopicIds: [];
      source: 'refusal';
      topicId: null;
    };

export const buildAppHelpAiResult = (result: AppHelpAiResultInput): AppHelpAiResult => {
  const answer = result.answer.trim();
  if (!result.supported || !answer || containsTradeAgentSecretMaterial(answer)) {
    return {
      answer: APP_HELP_UNSUPPORTED_ANSWER,
      relatedTopicIds: [],
      source: 'refusal',
      topicId: null
    };
  }
  return {
    answer,
    relatedTopicIds: result.relatedTopicIds,
    source: 'ai',
    topicId: result.topicId
  };
};

export const APP_HELP_TOPICS: readonly AppHelpTopic[] = [
  {
    id: 'getting-started',
    title: 'Start',
    summary: 'Choose an app from Home, then complete only the readiness steps that app requests.',
    answer:
      'Choose an app from Home. Home and COTI Private TVL need no wallet. Chat, DEX, OTC, and the Privacy Portal guide you through browser-wallet, network, and privacy setup only when needed.',
    prerequisites: [],
    steps: ['Choose an app on Home.', 'Follow that app’s readiness prompt.', 'Keep the same connected session while moving between apps.'],
    cautions: ['Never enter a recovery phrase or private key into App Help.'],
    aliases: ['first steps', 'begin', 'onboarding'],
    relatedTopicIds: ['browser-wallet', 'readiness-troubleshooting'],
    surfaceAffinity: ['home', 'error'],
    route: '/',
    questions: ['How do I start?', 'How does ChainWhisper work?'],
    phrases: ['get started with chainwhisper', 'how chainwhisper works', 'first time using chainwhisper'],
    keywords: ['getting started', 'start', 'home', 'chainwhisper', 'app']
  },
  {
    id: 'browser-wallet',
    title: 'Browser wallet',
    summary: 'MetaMask or CipherTrade is the only wallet used by the human application.',
    answer:
      'Connect MetaMask or CipherTrade. That selected wallet signs messages and trades and directly owns every order, asset, proceed, refund, and liquidity position. ChainWhisper does not create, store, fund, or recover a separate application wallet.',
    prerequisites: ['Connect MetaMask or CipherTrade on the requested COTI network.'],
    steps: ['Choose MetaMask or CipherTrade.', 'Confirm the selected address and network.', 'Unlock COTI privacy when a private action requires it.'],
    cautions: ['Never enter a wallet recovery phrase or private key into ChainWhisper or App Help.'],
    aliases: ['browser wallet', 'metamask', 'ciphertrade', 'cyphertrade', 'signing wallet'],
    relatedTopicIds: ['privacy-and-recovery', 'account-funding'],
    surfaceAffinity: ['home', 'chat', 'otc', 'portal', 'error'],
    route: '/',
    questions: ['Which wallet does ChainWhisper use?'],
    phrases: ['which wallet does chainwhisper use', 'connect metamask', 'connect ciphertrade'],
    keywords: ['metamask', 'ciphertrade', 'cyphertrade', 'browser wallet', 'wallet', 'account', 'signer']
  },
  {
    id: 'privacy-and-recovery',
    title: 'Privacy & recovery',
    summary: 'Unlock COTI privacy for the selected MetaMask or CipherTrade account.',
    answer:
      'Connect MetaMask or CipherTrade and unlock the COTI privacy key for that same address. ChainWhisper never creates or restores a separate application signing wallet.',
    prerequisites: ['Use the requested COTI network and a supported MetaMask or CipherTrade session.', 'Approve the compatible COTI privacy interface when prompted.'],
    steps: ['Connect MetaMask or CipherTrade.', 'Confirm the address and network.', 'Unlock privacy for that address.'],
    cautions: ['Never paste a private key or recovery phrase into App Help.'],
    aliases: ['unlock aes', 'wallet privacy', 'snap privacy'],
    relatedTopicIds: ['browser-wallet', 'readiness-troubleshooting'],
    surfaceAffinity: ['chat', 'otc', 'portal', 'error'],
    route: '/chat',
    questions: ['How do I unlock or recover?'],
    phrases: ['unlock privacy', 'recover my account', 'privacy recovery', 'metamask snap recovery'],
    keywords: ['privacy', 'unlock', 'recover', 'recovery', 'aes', 'snap', 'account']
  },
  {
    id: 'account-funding',
    title: 'Wallet funds',
    summary: 'The connected wallet must already hold the assets and gas required by an action.',
    answer:
      'Chat, DEX, OTC, and conversion actions use the selected MetaMask or CipherTrade address directly. If a balance is insufficient, fund that address through your wallet or an exchange, then refresh ChainWhisper. The app never moves funds into a separate application wallet.',
    prerequisites: ['Connect the MetaMask or CipherTrade address that will own the action.'],
    steps: ['Check the required asset and gas.', 'Fund the connected address outside ChainWhisper if needed.', 'Refresh after confirmation.'],
    cautions: ['Private-token balances require privacy to reveal.'],
    aliases: ['fund wallet', 'deposit', 'missing gas', 'insufficient balance'],
    relatedTopicIds: ['browser-wallet', 'readiness-troubleshooting'],
    surfaceAffinity: ['chat', 'otc', 'portal', 'error'],
    route: '/otc',
    questions: ['How do I fund my account?'],
    phrases: ['fund my wallet', 'missing gas', 'insufficient wallet balance'],
    keywords: ['fund', 'funding', 'deposit', 'withdraw', 'balance', 'gas', 'account']
  },
  {
    id: 'direct-and-group-chat',
    title: 'Chat',
    summary: 'Chat supports encrypted direct messages and managed group conversations.',
    answer:
      'Direct Chat supports encrypted messages, replies, reactions, tips, and direct trade offers. Group Chat adds invites and member controls. A pasted order URL remains a link unless you explicitly create an in-chat trade.',
    prerequisites: ['Connect MetaMask or CipherTrade and unlock privacy.'],
    steps: ['Choose a direct conversation or group.', 'Write and confirm the message.', 'Use the conversation menu for group or notification controls.'],
    cautions: ['Only the explicitly selected message should be used when asking the Trade Agent to draft a trade.'],
    aliases: ['messenger', 'dm', 'direct message', 'group message'],
    relatedTopicIds: ['browser-wallet', 'order-access-types'],
    surfaceAffinity: ['chat'],
    route: '/chat',
    questions: ['How does Chat work?', 'How do group chats work?'],
    phrases: ['direct and group chat', 'send an encrypted message', 'group chat invites', 'chat with someone'],
    keywords: ['chat', 'message', 'direct chat', 'group chat', 'invite', 'reaction', 'reply', 'tip']
  },
  {
    id: 'otc-navigation',
    title: 'P2P basics',
    summary: 'Offers compares individual orders, Create makes offers, and My trades tracks activity.',
    answer:
      'Offers lists individual P2P orders around the Carbon market reference. Create makes one-off or recurring orders with Public, Private link, or Direct access. My trades tracks active and historical orders. P2P fills one chosen order; it does not aggregate or route across offers.',
    prerequisites: [],
    steps: ['Choose Offers, Create, or My trades.', 'Review the order and displayed price ratio.', 'Confirm every wallet action yourself.'],
    cautions: ['P2P is order based, not a pool router or best-execution aggregator.'],
    aliases: ['trading app', 'order desk', 'otc tabs', 'p2p tabs'],
    relatedTopicIds: ['swap-limit-recurring', 'order-access-types', 'links-counters-and-settlement'],
    surfaceAffinity: ['otc'],
    route: '/otc',
    questions: ['What can I do in P2P?', 'How does P2P work?'],
    phrases: ['what can i do in p2p', 'offers create and my trades', 'how p2p works', 'p2p navigation', 'how otc works'],
    keywords: ['p2p', 'otc', 'offers', 'create', 'my trades', 'orders']
  },
  {
    id: 'dex-navigation',
    title: 'DEX basics',
    summary: 'DEX uses strategy liquidity; P2P trades one individual offer at a time.',
    answer:
      'DEX and P2P share one Trading shell but execute differently. DEX Swap can use compatible strategy liquidity; Pool, Limit, and Recurring create DEX positions. P2P Offers fills one selected order, while Create and My trades manage one-off, recurring, private-link, or direct orders.',
    prerequisites: ['Use supported private tokens and unlock privacy for private inventory or owner-only history.'],
    steps: ['Choose DEX or P2P.', 'Use DEX Swap, Strategies, or Positions; or P2P Offers, Create, or My trades.', 'Review the displayed price ratio and private amounts before confirming.'],
    cautions: ['A recurring strategy is two reusable opposite-side limit orders, not a timer or pool.', 'Do not infer hidden market depth from a displayed marginal price.'],
    aliases: ['dex', 'private dex', 'strategy nft', 'recurring strategy'],
    relatedTopicIds: ['recurring-liquidity', 'otc-navigation', 'private-liquidity'],
    surfaceAffinity: ['otc'],
    route: '/dex',
    questions: ['What is the difference between DEX and P2P?', 'How do DEX recurring strategies work?'],
    phrases: ['difference between dex and p2p', 'difference between dex and otc', 'dex recurring strategies', 'private dex', 'strategy nft'],
    keywords: ['dex', 'p2p', 'otc', 'strategy', 'position nft', 'recurring limit', 'private swap', 'pool']
  },
  {
    id: 'swap-limit-recurring',
    title: 'Swap, Limit, Recurring',
    summary: 'Swap takes one existing order, Limit creates a one-sided order, and Recurring creates reusable two-sided liquidity.',
    answer:
      'Swap fills one compatible existing order. Limit creates a one-sided offer at your chosen ratio. Recurring creates reusable two-sided liquidity whose fills move inventory between sides; it is not a timer or scheduled purchase.',
    prerequisites: ['Select distinct supported tokens.', 'Enter positive prices and amounts.'],
    steps: ['Choose Swap, Limit, or Recurring.', 'Set the pair and direction.', 'Review price basis, access, visibility, and liquidity.', 'Confirm the transaction.'],
    cautions: ['Flipping tokens changes display basis; Sell and Buy change the executable side.'],
    aliases: ['trade modes', 'scheduled order', 'limit versus recurring'],
    relatedTopicIds: ['recurring-liquidity', 'private-liquidity', 'order-access-types'],
    surfaceAffinity: ['otc'],
    route: '/otc',
    questions: ['Swap, Limit, or Recurring?'],
    phrases: ['swap limit or recurring', 'difference between trade modes', 'limit versus recurring'],
    keywords: ['swap', 'limit', 'recurring', 'trade mode', 'price ratio']
  },
  {
    id: 'trade-agent-capabilities',
    title: 'Trade Agent',
    summary: 'Trade Agent compares references, explains orders, and prepares drafts without executing them.',
    answer:
      'App Help answers product questions for free. The paid Trade Agent can compare compatible price references, explain or review orders, and draft Limit, Recurring, counter, or selected-chat trade details. It can prefill forms but never signs, sends, or executes.',
    prerequisites: ['Connect and fund the selected MetaMask or CipherTrade address before a paid request.'],
    steps: ['Choose a relevant action.', 'Complete every placeholder.', 'Review the public WISP fee.', 'Sign, pay, and inspect the returned draft.'],
    cautions: ['Agent output is a draft; you confirm every resulting action.'],
    aliases: ['agent abilities', 'ai trade help', 'agent autopilot'],
    relatedTopicIds: ['wisp-fees-and-confirmations', 'swap-limit-recurring'],
    surfaceAffinity: ['otc'],
    route: '/otc/agent',
    questions: ['What can the Trade Agent do?', 'App Help or Trade Agent?'],
    phrases: ['what can the trade agent do', 'app help and trade agent', 'trade agent capabilities', 'does the agent execute trades'],
    keywords: ['trade agent', 'app help', 'draft trade', 'prefill', 'execute', 'autopilot', 'wisp']
  },
  {
    id: 'order-access-types',
    title: 'Offer access',
    summary: 'Public is listed, Private link is shareable, and Direct is fixed to one recipient.',
    answer:
      'Public offers appear in Offers. Private link offers stay off the public list but can be reviewed and filled by any eligible wallet with the link. Direct proposals are locked to one recipient wallet. Access is separate from whether token amounts are hidden.',
    prerequisites: [],
    steps: ['Choose Public, Private link, or Direct while creating the offer.', 'For Direct, enter the recipient wallet.', 'Share private links only with intended people.'],
    cautions: ['A private link helps someone review the offer; the contract remains the settlement authority.', 'Never paste a private order link or access secret into App Help.'],
    aliases: ['private link', 'recipient only', 'listed order'],
    relatedTopicIds: ['private-liquidity', 'links-counters-and-settlement'],
    surfaceAffinity: ['chat', 'otc'],
    route: '/otc/desk',
    questions: ['Public, Private link, or Direct?'],
    phrases: ['public private link and direct offers', 'public unlisted and direct orders', 'difference between order access types', 'private order link', 'direct recipient order'],
    keywords: ['public', 'private link', 'unlisted', 'direct', 'order link', 'recipient', 'access', 'offers']
  },
  {
    id: 'private-liquidity',
    title: 'Private liquidity',
    summary: 'Visible amounts use normal OTC disclosure; Private liquidity hides protected token amounts and fills.',
    answer:
      'Visible amounts use normal OTC orders even when a token is private. Private liquidity hides protected order and fill amounts. After privacy is unlocked, makers and fillers can reveal only their own applicable inventory, progress, or receipts.',
    prerequisites: ['Use a supported private token.', 'Unlock the appropriate account privacy to reveal owner-only values.'],
    steps: ['Choose Visible amounts or Private liquidity.', 'Review which terms will be public.', 'Confirm the order yourself.'],
    cautions: ['Private tokens do not automatically make order amounts hidden.'],
    aliases: ['hidden amounts', 'amount privacy', 'private inventory'],
    relatedTopicIds: ['order-access-types', 'recurring-liquidity'],
    surfaceAffinity: ['otc'],
    route: '/otc',
    questions: ['What is private liquidity?', 'Private or visible amounts?'],
    phrases: ['private liquidity', 'visible amounts', 'hidden amount order', 'hide order amounts'],
    keywords: ['private liquidity', 'visible amounts', 'hidden', 'private token', 'amounts', 'liquidity', 'reveal']
  },
  {
    id: 'recurring-liquidity',
    title: 'Recurring liquidity',
    summary: 'Recurring orders reuse two-sided inventory until the maker closes them.',
    answer:
      'Recurring orders are reusable two-sided liquidity, not scheduled orders. Buy fills add base inventory to the sell side; sell fills add quote inventory to the buy side. Makers can edit prices or liquidity and close the order to withdraw what remains.',
    prerequisites: ['Choose distinct base and quote tokens.', 'Set buy and sell prices plus both liquidity amounts.'],
    steps: ['Create the recurring pair.', 'Monitor inventory in Orders.', 'Edit prices or liquidity in place.', 'Close the order to withdraw remaining inventory.'],
    cautions: ['Inventory committed to a recurring order is live liquidity, not unused wallet funds.'],
    aliases: ['two sided order', 'market making order', 'reusable order'],
    relatedTopicIds: ['swap-limit-recurring', 'private-liquidity'],
    surfaceAffinity: ['otc'],
    route: '/otc',
    questions: ['How do recurring orders work?'],
    phrases: ['recurring orders work', 'recurring liquidity', 'reusable two sided order', 'recurring order timer'],
    keywords: ['recurring', 'inventory', 'liquidity', 'two sided', 'close order', 'reusable']
  },
  {
    id: 'links-counters-and-settlement',
    title: 'Orders & counters',
    summary: 'Order identity includes its escrow; counters are new direct offers linked to a parent.',
    answer:
      'An order link identifies both the numeric order and its escrow contract. A counter is a new Direct order between the parties; completing it cancels the parent. Private-order counters are not currently supported. You review and confirm every settlement action.',
    prerequisites: ['Open the trusted order or its shared link.'],
    steps: ['Review both assets, price basis, access, and status.', 'Create or accept a supported counter if needed.', 'Confirm settlement in your wallet.'],
    cautions: ['A numeric order ID alone is not a complete identity.'],
    aliases: ['my orders', 'order history', 'counter offer', 'settle trade'],
    relatedTopicIds: ['order-access-types', 'otc-navigation'],
    surfaceAffinity: ['otc'],
    route: '/otc/orders',
    questions: ['How do counters work?', 'How do my orders work?'],
    phrases: ['order links counters and settlement', 'counter an order', 'settle an order', 'my otc orders'],
    keywords: ['order', 'orders', 'link', 'counter', 'settlement', 'history', 'received', 'parent order']
  },
  {
    id: 'wisp-fees-and-confirmations',
    title: 'Agent WISP fees',
    summary: 'Each paid Agent request shows and transfers a public WISP fee; App Help is free.',
    answer:
      'App Help is free. Each paid Trade Agent request shows a public WISP fee before processing. The signed authorization binds the exact request and payment. A matching technical failure can retry without another transfer; terminal cases remain available for manual review.',
    prerequisites: ['Fund the selected MetaMask or CipherTrade address with WISP and gas.'],
    steps: ['Complete the request.', 'Review the fee.', 'Sign the request authorization.', 'Confirm the WISP transfer.', 'Wait for the validated response.'],
    cautions: ['There is no pWISP payment, escrow, prepaid balance, or automatic on-chain refund.'],
    aliases: ['agent payment', 'agent refund', 'retry payment', 'public fee'],
    relatedTopicIds: ['trade-agent-capabilities', 'account-funding'],
    surfaceAffinity: ['otc'],
    route: '/otc/agent',
    questions: ['Why does Agent charge WISP?', 'Can I retry without paying?'],
    phrases: ['trade agent charge wisp', 'retry without paying', 'wisp fee confirmation', 'paid agent request'],
    keywords: ['wisp', 'fee', 'payment', 'confirmation', 'retry', 'paid', 'trade agent']
  },
  {
    id: 'privacy-portal',
    title: 'Privacy Portal',
    summary: 'Privacy Portal converts supported assets between their public and private token forms.',
    answer:
      'Privacy Portal uses verified bridges for seven supported COTI asset pairs. The ChainWhisper-provided WISP bridge supports both WISP-to-pWISP and pWISP-to-WISP conversions. The separate collapsed legacy pWISP recovery option only exits old pWISP.',
    prerequisites: ['Connect on COTI Mainnet.', 'Unlock privacy before a private-token balance or conversion requires it.'],
    steps: ['Choose a supported pair and direction.', 'Enter the amount.', 'Approve when required.', 'Confirm the conversion.', 'Use legacy recovery only for old pWISP.'],
    cautions: ['The WISP bridge is ChainWhisper-provided; the other listed pairs use official COTI bridges.'],
    aliases: ['shield', 'unshield', 'token bridge', 'public private conversion', 'wisp bridge'],
    relatedTopicIds: ['privacy-and-recovery', 'account-funding'],
    surfaceAffinity: ['portal'],
    route: '/portal',
    questions: ['What does Privacy Portal do?', 'How does WISP bridge work?'],
    phrases: ['what does the privacy portal do', 'privacy portal swap', 'public to private tokens', 'private token bridge', 'wisp recovery'],
    keywords: ['privacy portal', 'portal', 'private token', 'bridge', 'coti', 'wisp recovery', 'shield', 'unshield']
  },
  {
    id: 'private-tvl',
    title: 'COTI Private TVL',
    summary: 'COTI Private TVL is a read-only view of assets locked in reviewed privacy bridges.',
    answer:
      'COTI Private TVL reads the public reserves locked in reviewed privacy bridges, checks them against the corresponding private-token liabilities, and values fresh references with Band Protocol. Liabilities are not counted twice. It needs no connected wallet and submits no transactions.',
    prerequisites: [],
    steps: ['Open COTI Private TVL from the header or Home.', 'Review locked reserves, liability coverage, Band price status, and the USD total.'],
    cautions: ['Stale or unavailable Band prices are excluded from the USD total.', 'Displayed analytics are informational and do not execute financial actions.'],
    aliases: ['private tvl', 'bridge tvl', 'treasury analytics', 'token metrics', 'read only data'],
    relatedTopicIds: ['getting-started'],
    surfaceAffinity: ['treasury', 'home'],
    route: '/tvl',
    questions: ['What is COTI Private TVL?', 'How is private TVL calculated?'],
    phrases: ['what is private tvl', 'how is private tvl calculated', 'treasury analytics', 'does tvl need a wallet'],
    keywords: ['private tvl', 'bridge', 'reserve', 'liability', 'band', 'usd', 'treasury', 'read only', 'wallet']
  },
  {
    id: 'readiness-troubleshooting',
    title: 'Readiness help',
    summary: 'Disabled actions usually identify a missing wallet, network, privacy, account, or funding prerequisite.',
    answer:
      'If an action is unavailable, follow its readiness message: connect MetaMask or CipherTrade, switch to the requested COTI network, unlock privacy, or fund the connected address. Refresh balances after confirmed transfers.',
    prerequisites: [],
    steps: ['Read the nearest readiness message.', 'Complete only the named prerequisite.', 'Retry after confirmation or refresh.'],
    cautions: ['Do not share addresses, transaction hashes, error stacks, recovery phrases, private keys, or access secrets with App Help.'],
    aliases: ['button disabled', 'wrong network', 'not ready', 'balance missing', 'generic error'],
    relatedTopicIds: ['browser-wallet', 'privacy-and-recovery', 'account-funding'],
    surfaceAffinity: ['chat', 'otc', 'portal', 'error'],
    route: '/',
    questions: ['Why is this unavailable?', 'Why is my balance missing?'],
    phrases: ['button disabled', 'balance missing', 'cannot click', 'action is unavailable', 'wallet not ready', 'wrong network'],
    keywords: ['disabled', 'balance', 'missing', 'unavailable', 'connect', 'network', 'funds', 'ready', 'error']
  }
];

const TOPICS_BY_ID = new Map(APP_HELP_TOPICS.map((topic) => [topic.id, topic]));
const TRUSTED_ROUTES = new Set(APP_HELP_TOPICS.map((topic) => topic.route));
const TRUSTED_SURFACES = new Set<AppHelpSurface>(['home', 'chat', 'otc', 'portal', 'treasury', 'error']);
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
const WALLET_ADDRESS_RE = /\b0x[a-f0-9]{40}\b/iu;

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
  if (path === '/private-tvl' || path === '/treasury' || path === '/treasury-data') return '/tvl';
  if (path === '/dex' || path.startsWith('/dex/')) return '/dex';
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
  if (path.startsWith('/tvl') || path.startsWith('/private-tvl') || path.startsWith('/treasury')) return '/tvl';
  return '/';
};

export const getAppHelpSurface = (value: unknown): AppHelpSurface => {
  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase() as AppHelpSurface;
    if (TRUSTED_SURFACES.has(normalizedValue)) {
      return normalizedValue;
    }
  }
  const path = normalizeAppHelpCurrentPath(value);
  if (path === '/chat') return 'chat';
  if (path === '/dex' || path.startsWith('/otc')) return 'otc';
  if (path === '/portal') return 'portal';
  if (path === '/tvl') return 'treasury';
  return 'home';
};

export const getAppHelpSurfacePath = (surfaceValue: unknown): string => {
  switch (getAppHelpSurface(surfaceValue)) {
    case 'chat':
      return '/chat';
    case 'otc':
      return '/otc/agent';
    case 'portal':
      return '/portal';
    case 'treasury':
      return '/tvl';
    default:
      return '/';
  }
};

export const isTrustedAppHelpRoute = (value: unknown): value is string =>
  typeof value === 'string' && TRUSTED_ROUTES.has(value);

export const getAppHelpTopic = (topicId: unknown): AppHelpTopic | null =>
  typeof topicId === 'string' ? TOPICS_BY_ID.get(topicId) ?? null : null;

export const containsSensitiveAppHelpMaterial = (value: unknown): boolean => {
  if (typeof value !== 'string') {
    return false;
  }
  return containsTradeAgentSecretMaterial(value) || WALLET_ADDRESS_RE.test(value);
};

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

const stemToken = (token: string): string => {
  if (token.length > 6 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 5 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 5 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1);
  return token;
};

const toStemSet = (value: string): Set<string> =>
  new Set(value.split(' ').filter(Boolean).map(stemToken));

const pathAffinity = (topic: AppHelpTopic, currentPath: string): number => {
  const currentSurface = getAppHelpSurface(currentPath);
  if (topic.route === currentPath) {
    return 4;
  }
  if (topic.surfaceAffinity.includes(currentSurface)) {
    return 2;
  }
  if (topic.route.startsWith('/otc') && currentPath.startsWith('/otc')) {
    return 1;
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
  const tokens = toStemSet(question);
  const exactCandidates = [...topic.questions, ...topic.aliases].map(normalizeCatalogValue);
  const exact = exactCandidates.includes(question);
  let phraseHits = 0;
  let keywordHits = 0;
  let score = exact ? 100 : 0;

  [...topic.phrases, ...topic.aliases].forEach((phrase) => {
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
    const keywordTokens = normalizedKeyword.split(' ').filter(Boolean).map(stemToken);
    const matched = normalizedKeyword.includes(' ')
      ? question.includes(normalizedKeyword)
      : keywordTokens.every((token) => tokens.has(token));
    if (matched) {
      keywordHits += 1;
      score += normalizedKeyword.includes(' ') ? 5 : 3;
    }
  });

  if (score > 0) {
    score += pathAffinity(topic, currentPath);
  }
  return { exact, keywordHits, phraseHits, score, topic };
};

const resolveRelatedTopics = (best: RankedTopic, ranked: RankedTopic[]): AppHelpTopic[] => {
  const ids = [
    ...best.topic.relatedTopicIds,
    ...ranked.filter((item) => item.topic.id !== best.topic.id).map((item) => item.topic.id)
  ];
  return ids
    .filter((id, index) => id !== best.topic.id && ids.indexOf(id) === index)
    .map((id) => TOPICS_BY_ID.get(id))
    .filter((topic): topic is AppHelpTopic => Boolean(topic))
    .slice(0, 3);
};

export const matchAppHelpTopics = (questionValue: unknown, currentPathValue?: unknown): AppHelpMatch => {
  const question = normalizeAppHelpQuestion(questionValue);
  if (!question) {
    return { ambiguous: false, confidence: 'none', relatedTopics: [], score: 0, topic: null };
  }
  const currentPath = normalizeAppHelpCurrentPath(currentPathValue);
  const ranked = APP_HELP_TOPICS
    .map((topic) => rankTopic(question, topic, currentPath))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.topic.title.localeCompare(right.topic.title));
  const best = ranked[0];
  if (!best) {
    return { ambiguous: false, confidence: 'none', relatedTopics: [], score: 0, topic: null };
  }

  const confidence: AppHelpMatchConfidence = best.exact
    ? 'exact'
    : best.phraseHits > 0 || best.keywordHits >= 2
      ? 'high'
      : 'moderate';
  const second = ranked[1];
  const ambiguous =
    confidence === 'moderate' &&
    Boolean(second) &&
    (best.score <= 6 || (second?.score ?? 0) >= best.score - 3);
  return {
    ambiguous,
    confidence,
    relatedTopics: resolveRelatedTopics(best, ranked),
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
  'browser-wallet',
  'privacy-and-recovery',
  'otc-navigation',
  'private-liquidity',
  'privacy-portal'
] as const;

export const APP_HELP_QUICK_QUESTIONS = QUICK_TOPIC_IDS.map((topicId) => {
  const topic = TOPICS_BY_ID.get(topicId)!;
  return { label: topic.title, question: topic.questions[0], topicId: topic.id };
});
