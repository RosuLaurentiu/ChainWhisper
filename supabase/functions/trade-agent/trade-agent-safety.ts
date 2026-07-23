const PROHIBITED_KEY_RE =
  /^(?:access[_ -]?secret|private[_ -]?key|mnemonic|seed[_ -]?phrase|recovery[_ -]?phrase|secret|share[_ -]?code)$/iu;
const PRIVATE_LINK_RE =
  /\/(?:otc\/order|trades)\/(?:link|l)\/[A-Za-z0-9_-]+|[?&#]secret=|#0x[a-fA-F0-9]{64}\b/iu;
const LABELED_SECRET_RE =
  /\b(?:private\s*key|seed\s*phrase|recovery\s*phrase|mnemonic|access\s*secret)\b\s*(?::|=|is)?\s*(?:0x[a-fA-F0-9]{64}|[a-z]+(?:\s+[a-z]+){11,23})/iu;
const RAW_SECRET_HEX_RE = /\b0x[a-fA-F0-9]{64}\b/u;
const WALLET_ADDRESS_RE = /\b0x[a-fA-F0-9]{40}\b/u;
const DISALLOWED_CONTEXT_KEY_RE =
  /^(?:address|balance|balances|counterparty|error|errors|history|maker|messages|owner|payer|privateAmount|privateInventory|privateProgress|receipt|receipts|recipient|stack|taker|terminalPath|transactionHash|txHash)$/iu;

const findSensitiveText = (value: string): string | null => {
  if (PRIVATE_LINK_RE.test(value)) {
    return 'private order link';
  }
  if (LABELED_SECRET_RE.test(value)) {
    return 'wallet secret';
  }
  if (RAW_SECRET_HEX_RE.test(value)) {
    return '64-byte secret';
  }
  return null;
};

export const findProhibitedTradeAgentMaterial = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return findSensitiveText(value);
  }
  if (Array.isArray(value)) {
    for (const nested of value) {
      const finding = findProhibitedTradeAgentMaterial(nested);
      if (finding) {
        return finding;
      }
    }
    return null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (PROHIBITED_KEY_RE.test(key) && nested !== null && nested !== undefined && nested !== '') {
      return key;
    }
    const finding = findProhibitedTradeAgentMaterial(nested);
    if (finding) {
      return finding;
    }
  }
  return null;
};

export const findDisallowedTradeAgentContextMaterial = (
  value: unknown,
  key = ''
): string | null => {
  if (typeof value === 'string') {
    return key !== 'escrowContract' && WALLET_ADDRESS_RE.test(value) ? 'wallet address' : null;
  }
  if (Array.isArray(value)) {
    for (const nested of value) {
      const finding = findDisallowedTradeAgentContextMaterial(nested, key);
      if (finding) {
        return finding;
      }
    }
    return null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  for (const [nestedKey, nested] of Object.entries(value as Record<string, unknown>)) {
    if (DISALLOWED_CONTEXT_KEY_RE.test(nestedKey)) {
      return nestedKey;
    }
    const finding = findDisallowedTradeAgentContextMaterial(nested, nestedKey);
    if (finding) {
      return finding;
    }
  }
  return null;
};

export const hasUnresolvedTradeAgentPlaceholders = (prompt: string): boolean =>
  /\[[^\]\r\n]{1,80}\]/u.test(prompt);

const TOKEN_DECIMALS = new Map<string, number>([
  ['coti', 18],
  ['gcoti', 18],
  ['pengo', 18],
  ['wbbt', 18],
  ['wbtc', 8],
  ['usdc.e', 6],
  ['usdt', 6],
  ['wada', 18],
  ['night', 18],
  ['weth', 18],
  ['wisp', 6],
  ['p.coti', 18],
  ['p.gcoti', 18],
  ['p.usdc.e', 6],
  ['p.wisp', 6],
  ['p.weth', 18],
  ['p.wbtc', 8],
  ['p.usdt', 6],
  ['p.wada', 18],
  ['p.pengo', 18],
  ['hotdog', 18]
]);

const TOKEN_ALIASES = new Map([
  ['usdc', 'usdc.e'],
  ...Array.from(TOKEN_DECIMALS.keys(), (token) => [token, token] as const)
]);

const TOKEN_DISPLAY_REFERENCES = new Map<string, string>([
  ['coti', 'COTI'],
  ['gcoti', 'gCOTI'],
  ['pengo', 'Pengo'],
  ['wbbt', 'WBBT'],
  ['wbtc', 'WBTC'],
  ['usdc.e', 'USDC.e'],
  ['usdt', 'USDT'],
  ['wada', 'wADA'],
  ['night', 'NIGHT'],
  ['weth', 'WETH'],
  ['wisp', 'WISP'],
  ['p.coti', 'p.COTI'],
  ['p.gcoti', 'p.gCOTI'],
  ['p.usdc.e', 'p.USDC.e'],
  ['p.wisp', 'p.WISP'],
  ['p.weth', 'p.WETH'],
  ['p.wbtc', 'p.WBTC'],
  ['p.usdt', 'p.USDT'],
  ['p.wada', 'p.wADA'],
  ['p.pengo', 'p.PENGO'],
  ['hotdog', 'HOTDOG']
]);

const getKnownTokenMentions = (prompt: string): string[] => {
  const mentions: string[] = [];
  for (const candidate of prompt.toLowerCase().match(/[a-z][a-z0-9.]*/gu) ?? []) {
    const token = TOKEN_ALIASES.get(candidate.replace(/\.+$/u, ''));
    if (token && !mentions.includes(token)) {
      mentions.push(token);
    }
  }
  return mentions;
};

export const getKnownTradeAgentPromptTokens = (prompt: string): string[] =>
  getKnownTokenMentions(prompt)
    .map((token) => TOKEN_DISPLAY_REFERENCES.get(token) ?? '')
    .filter(Boolean);

const getPositiveDecimal = (value: string, decimals: number): string => {
  if (!new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${decimals}})?$`, 'u').test(value)) {
    return '';
  }
  try {
    return BigInt(value.replace('.', '')) > 0n ? value : '';
  } catch {
    return '';
  }
};

const readPromptNumber = (prompt: string, expression: RegExp): string => prompt.match(expression)?.[1] ?? '';

export const getSemanticTradeAgentPreflightError = ({
  action,
  context,
  prompt
}: {
  action: string;
  context: unknown;
  prompt: string;
}): string => {
  if (action === 'explain_order' || action === 'draft_counter' || action === 'review_orders') {
    return '';
  }
  if (action === 'chat_to_trade') {
    const selectedMessage =
      context && typeof context === 'object'
        ? (context as { selectedMessage?: unknown }).selectedMessage
        : null;
    const text =
      selectedMessage && typeof selectedMessage === 'object'
        ? String((selectedMessage as { text?: unknown }).text ?? '').trim()
        : '';
    return text ? '' : 'Select one chat message before asking the Agent to draft a trade.';
  }

  const tokens = getKnownTokenMentions(prompt);
  if (tokens.length > 2) {
    return 'Name one token pair at a time so the Agent can respond clearly.';
  }

  if (action === 'draft_recurring') {
    const buyPrice = readPromptNumber(prompt, /\bbuy\s+price\s*:?\s*(-?\d+(?:\.\d+)?)/iu);
    const sellPrice = readPromptNumber(prompt, /\bsell\s+price\s*:?\s*(-?\d+(?:\.\d+)?)/iu);
    const buyLiquidity = readPromptNumber(
      prompt,
      /\b(?:buy\s+budget|quote\s+liquidity)\s*:?\s*(-?\d+(?:\.\d+)?)/iu
    );
    const sellLiquidity = readPromptNumber(
      prompt,
      /\b(?:sell\s+inventory|base\s+liquidity)\s*:?\s*(-?\d+(?:\.\d+)?)/iu
    );
    if (
      (buyPrice && !getPositiveDecimal(buyPrice, 18)) ||
      (sellPrice && !getPositiveDecimal(sellPrice, 18)) ||
      (buyLiquidity && !getPositiveDecimal(buyLiquidity, TOKEN_DECIMALS.get(tokens[1]) ?? 18)) ||
      (sellLiquidity && !getPositiveDecimal(sellLiquidity, TOKEN_DECIMALS.get(tokens[0]) ?? 18))
    ) {
      return 'Any recurring prices or liquidity you provide must be positive and use supported precision.';
    }
    return '';
  }

  const hasBuy = /\bbuy(?:ing)?\b/iu.test(prompt);
  const hasSell = /\bsell(?:ing)?\b/iu.test(prompt);
  if (hasBuy && hasSell) {
    return 'Choose one direction—buy or sell—for this request.';
  }
  const directedAmountMatch = prompt.match(
    /\b(?:buy|sell)\s+(-?\d+(?:\.\d+)?)(?:\s+([a-z][a-z0-9.]*))?/iu
  );
  const directedToken = TOKEN_ALIASES.get(directedAmountMatch?.[2]?.toLowerCase() ?? '');
  const directedAmount = directedAmountMatch?.[1] ?? '';
  if (
    directedAmount &&
    !getPositiveDecimal(directedAmount, TOKEN_DECIMALS.get(directedToken ?? '') ?? 18)
  ) {
    return 'Any amount you provide must be positive and use supported token precision.';
  }
  if (action === 'find_price') {
    return '';
  }
  if (action === 'draft_limit') {
    const price = readPromptNumber(
      prompt,
      /\b(?:at|price(?:\s+of)?(?:\s*:|\s+))\s*(-?\d+(?:\.\d+)?)/iu
    );
    if (price && !getPositiveDecimal(price, 18)) {
      return 'Any limit price you provide must be positive.';
    }
    return '';
  }
  return '';
};
