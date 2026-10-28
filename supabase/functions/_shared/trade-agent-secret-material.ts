import { BIP39_ENGLISH_WORDS } from './bip39-english.ts';

export const TRADE_AGENT_PROHIBITED_KEY_RE =
  /^(?:access[_ -]?secret|private[_ -]?key|mnemonic|seed[_ -]?phrase|recovery[_ -]?phrase|secret|share[_ -]?code)$/iu;

export type TradeAgentSecretMaterialKind =
  | 'private order link'
  | 'wallet recovery phrase'
  | 'wallet secret';

const PRIVATE_LINK_MAGIC = 0x54;
const PRIVATE_LINK_VERSION_FIXED_ID = 1;
const PRIVATE_LINK_VERSION_COMPACT_ID = 2;
const PRIVATE_LINK_HAS_SECRET = 1;
const PRIVATE_LINK_FIXED_ID_BYTES = 6;
const PRIVATE_LINK_SECRET_BYTES = 32;
const MAX_DECODED_TEXT_CHARS = 20_000;
const MAX_PERCENT_DECODE_DEPTH = 6;
const MAX_PRIVATE_LINK_REDIRECT_DEPTH = 6;
const MAX_TEXT_VARIANTS = 32;
const MNEMONIC_WORD_COUNTS = [24, 21, 18, 15, 12] as const;

const SECRET_HEX_SOURCE = '(?<![a-f0-9])(?:0x)?[a-f0-9]{64}(?![a-f0-9])';
const SECRET_HEX_RE = new RegExp(SECRET_HEX_SOURCE, 'iu');
const SECRET_HEX_GLOBAL_RE = new RegExp(SECRET_HEX_SOURCE, 'giu');
const LABELED_SECRET_RE =
  /\b(?:private\s*key|seed\s*phrase|recovery\s*phrase|mnemonic|access\s*secret)\b\s*(?::|=|is)?\s*(?:0x)?[a-f0-9]{64}\b|\b(?:seed\s*phrase|recovery\s*phrase|mnemonic)\b\s*(?::|=|is)\s*[a-z]+(?:\s+[a-z]+){11,23}/iu;
const LABELED_SECRET_GLOBAL_RE = new RegExp(LABELED_SECRET_RE.source, 'giu');
const PRIVATE_LINK_PATH_RE =
  /(\/(?:otc\/order\/(?:link|l)|trades\/l|otcdesk\/terminal\/l)\/)([A-Za-z0-9_-]{4,90})/giu;
const PRIVATE_LINK_CODE_TOKEN_RE =
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{47,54}(?![A-Za-z0-9_-])/gu;
const WORD_RE = /[a-z]+/giu;

type WordMatch = { end: number; start: number; value: string };

const decodeBase64Url = (value: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
    return null;
  }
  try {
    const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/');
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
};

export const isPrivateTradeLinkCode = (value: string): boolean => {
  const bytes = decodeBase64Url(value.trim());
  if (!bytes || bytes.length < 3) {
    return false;
  }
  const version = bytes[0] ^ PRIVATE_LINK_MAGIC;
  if (version !== PRIVATE_LINK_VERSION_FIXED_ID && version !== PRIVATE_LINK_VERSION_COMPACT_ID) {
    return false;
  }
  if ((bytes[1] & PRIVATE_LINK_HAS_SECRET) !== PRIVATE_LINK_HAS_SECRET) {
    return false;
  }
  const tradeIdBytes = version === PRIVATE_LINK_VERSION_COMPACT_ID
    ? ((bytes[1] >> 1) & 0x07) + 1
    : PRIVATE_LINK_FIXED_ID_BYTES;
  if (tradeIdBytes <= 0 || tradeIdBytes > PRIVATE_LINK_FIXED_ID_BYTES) {
    return false;
  }
  const expectedLength = 2 + tradeIdBytes + PRIVATE_LINK_SECRET_BYTES;
  if (bytes.length !== expectedLength) {
    return false;
  }
  let tradeId = 0n;
  for (let index = 0; index < tradeIdBytes; index += 1) {
    tradeId = (tradeId << 8n) + BigInt(bytes[2 + index]);
  }
  const parsedTradeId = Number(tradeId);
  return Number.isSafeInteger(parsedTradeId) && parsedTradeId > 0;
};

type TextVariant = {
  percentDepth: number;
  redirectDepth: number;
  value: string;
};

const getRedirectedTradeLinkInput = (value: string): string | null => {
  try {
    const parsed = new URL(value, 'https://chainwhisper.invalid');
    const redirected = parsed.searchParams.get('p')?.trim();
    if (redirected) {
      return redirected;
    }
  } catch {
    // A malformed unrelated URL component must not hide a valid p= value.
  }

  const rawSearch = value.startsWith('?') ? value.slice(1) : value;
  if (!/(?:^|&)p=/u.test(rawSearch)) {
    return null;
  }
  try {
    return new URLSearchParams(rawSearch).get('p')?.trim() || null;
  } catch {
    return null;
  }
};

const getDecodedTextVariants = (value: string): string[] => {
  const variants: string[] = [];
  const seen = new Set<string>();
  const queue: TextVariant[] = [{ percentDepth: 0, redirectDepth: 0, value }];

  while (queue.length > 0 && variants.length < MAX_TEXT_VARIANTS) {
    const current = queue.shift();
    if (!current || seen.has(current.value)) {
      continue;
    }
    seen.add(current.value);
    variants.push(current.value);

    if (current.value.length > MAX_DECODED_TEXT_CHARS) {
      continue;
    }

    if (current.redirectDepth < MAX_PRIVATE_LINK_REDIRECT_DEPTH) {
      const redirected = getRedirectedTradeLinkInput(current.value);
      if (redirected && !seen.has(redirected)) {
        queue.push({
          percentDepth: current.percentDepth,
          redirectDepth: current.redirectDepth + 1,
          value: redirected
        });
      }
    }

    if (current.percentDepth < MAX_PERCENT_DECODE_DEPTH && current.value.includes('%')) {
      try {
        const decoded = decodeURIComponent(current.value);
        if (decoded !== current.value && !seen.has(decoded)) {
          queue.push({
            percentDepth: current.percentDepth + 1,
            redirectDepth: current.redirectDepth,
            value: decoded
          });
        }
      } catch {
        // URLSearchParams above still extracts a valid p= value when another
        // component contains a malformed escape such as %ZZ.
      }
    }
  }

  return variants;
};

const findPrivateLinkCode = (value: string): boolean => {
  for (const match of value.matchAll(PRIVATE_LINK_PATH_RE)) {
    if (isPrivateTradeLinkCode(match[2] ?? '')) {
      return true;
    }
  }
  for (const match of value.matchAll(PRIVATE_LINK_CODE_TOKEN_RE)) {
    if (isPrivateTradeLinkCode(match[0])) {
      return true;
    }
  }
  return false;
};

const getWordMatches = (value: string): WordMatch[] =>
  Array.from(value.matchAll(WORD_RE), (match) => ({
    end: (match.index ?? 0) + match[0].length,
    start: match.index ?? 0,
    value: match[0].toLowerCase()
  }));

const findRecoveryPhraseRange = (value: string): { end: number; start: number } | null => {
  const words = getWordMatches(value);
  for (const count of MNEMONIC_WORD_COUNTS) {
    for (let start = 0; start + count <= words.length; start += 1) {
      const candidate = words.slice(start, start + count);
      if (candidate.every((word) => BIP39_ENGLISH_WORDS.has(word.value))) {
        return {
          start: candidate[0].start,
          end: candidate[candidate.length - 1].end
        };
      }
    }
  }
  return null;
};

const findDirectSecretText = (value: string): TradeAgentSecretMaterialKind | null => {
  if (findPrivateLinkCode(value)) {
    return 'private order link';
  }
  if (SECRET_HEX_RE.test(value) || LABELED_SECRET_RE.test(value)) {
    return 'wallet secret';
  }
  if (findRecoveryPhraseRange(value)) {
    return 'wallet recovery phrase';
  }
  return null;
};

export const findTradeAgentSecretText = (value: string): TradeAgentSecretMaterialKind | null => {
  for (const variant of getDecodedTextVariants(value)) {
    const finding = findDirectSecretText(variant);
    if (finding) {
      return finding;
    }
  }
  return null;
};

export const containsTradeAgentSecretMaterial = (value: string): boolean =>
  findTradeAgentSecretText(value) !== null;

const redactPrivateLinkCodes = (value: string): string => {
  const withPathsRedacted = value.replace(
    PRIVATE_LINK_PATH_RE,
    (full, prefix: string, code: string) => isPrivateTradeLinkCode(code)
      ? `${prefix}[redacted-trade-link]`
      : full
  );
  return withPathsRedacted.replace(
    PRIVATE_LINK_CODE_TOKEN_RE,
    (code) => isPrivateTradeLinkCode(code) ? '[redacted-trade-link]' : code
  );
};

const redactRecoveryPhrases = (value: string): string => {
  let redacted = value;
  let range = findRecoveryPhraseRange(redacted);
  while (range) {
    redacted = `${redacted.slice(0, range.start)}[redacted-recovery-phrase]${redacted.slice(range.end)}`;
    range = findRecoveryPhraseRange(redacted);
  }
  return redacted;
};

export const redactTradeAgentSecretMaterialText = (value: string): string => {
  let redacted = redactPrivateLinkCodes(value)
    .replace(SECRET_HEX_GLOBAL_RE, '[redacted-access-secret]')
    .replace(LABELED_SECRET_GLOBAL_RE, '[redacted-wallet-secret]');
  redacted = redactRecoveryPhrases(redacted);

  if (redacted === value) {
    const decodedVariants = getDecodedTextVariants(value).slice(1);
    if (decodedVariants.some((variant) => findDirectSecretText(variant))) {
      return '[redacted-private-material]';
    }
  }
  return redacted;
};
