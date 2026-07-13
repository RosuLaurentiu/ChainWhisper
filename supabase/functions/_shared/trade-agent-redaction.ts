const REDACTED_ACCESS_SECRET = '[redacted-access-secret]';
const REDACTED_TRADE_LINK = '[redacted-trade-link]';
const TRADE_LINK_CODE_RE = /(\/(?:otc\/order|trades)\/(?:link|l)\/)[A-Za-z0-9_-]+/giu;
const SECRET_PARAM_RE = /([?&#]secret=)0x[a-f0-9]{64}\b/giu;
const SECRET_FRAGMENT_RE = /#0x[a-f0-9]{64}\b/giu;

export const redactTradeAgentSecretText = (value: string): string =>
  value
    .replace(TRADE_LINK_CODE_RE, `$1${REDACTED_TRADE_LINK}`)
    .replace(SECRET_PARAM_RE, `$1${REDACTED_ACCESS_SECRET}`)
    .replace(SECRET_FRAGMENT_RE, `#${REDACTED_ACCESS_SECRET}`);

export const redactTradeAgentSecrets = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return redactTradeAgentSecretText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactTradeAgentSecrets);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      /secret/i.test(key) ? REDACTED_ACCESS_SECRET : redactTradeAgentSecrets(nested)
    ])
  );
};
