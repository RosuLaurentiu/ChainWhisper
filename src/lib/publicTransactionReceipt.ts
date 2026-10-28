import { loadCotiReadProvider, type CotiReadProvider } from './appShared/core';

const DEFAULT_POLL_INTERVAL_MS = 1_500;
const DEFAULT_TIMEOUT_MS = 300_000;

const canonicalHash = (value: unknown): string => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^0x[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error('Submitted transaction hash is invalid.');
  }
  return normalized;
};

export const waitForPublicTransactionReceipt = async ({
  transactionHash,
  label,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  readProvider,
  timeoutMs = DEFAULT_TIMEOUT_MS
}: Readonly<{
  transactionHash: unknown;
  label: string;
  pollIntervalMs?: number;
  readProvider?: CotiReadProvider;
  timeoutMs?: number;
}>): Promise<unknown> => {
  const hash = canonicalHash(transactionHash);
  if (!label.trim() || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Public transaction confirmation configuration is invalid.');
  }
  const provider = readProvider ?? await loadCotiReadProvider(true);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const receipt = await provider.getTransactionReceipt(hash);
      if (receipt) return receipt;
    } catch {
      // A transient public-RPC failure is retryable. Never fall back to the
      // selected browser wallet merely to poll a known public hash.
    }
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(
    `${label.trim()} was submitted, but COTI confirmation timed out. Check wallet activity before retrying.`
  );
};

