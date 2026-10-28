import {
  TRADE_AGENT_PROHIBITED_KEY_RE,
  redactTradeAgentSecretMaterialText
} from './trade-agent-secret-material.ts';

const REDACTED_ACCESS_SECRET = '[redacted-access-secret]';

export const redactTradeAgentSecretText = (value: string): string =>
  redactTradeAgentSecretMaterialText(value);

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
      // Preserve the older broad object-key boundary as a defense in depth:
      // provider/client-specific names such as `clientSecret` must be removed
      // even when their value does not look like a wallet credential.
      TRADE_AGENT_PROHIBITED_KEY_RE.test(key) || /secret/iu.test(key)
        ? REDACTED_ACCESS_SECRET
        : redactTradeAgentSecrets(nested)
    ])
  );
};
