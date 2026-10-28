const UINT256_MAX = (1n << 256n) - 1n;

/**
 * Normalizes a wallet transaction response's chain without adding another RPC.
 *
 * The COTI Contract response can omit `chainId`. In that case the caller's
 * already-attested capability/deployment chain remains authoritative. Any
 * explicit response chain is still parsed and compared by the caller.
 */
export const resolveBoundTransactionChain = (
  responseChainId: unknown,
  expectedChainId: bigint,
  label: string
): bigint => {
  let expected: bigint;
  try {
    expected = BigInt(expectedChainId);
  } catch {
    throw new Error(`${label} expected chain must be an unsigned integer.`);
  }
  if (expected <= 0n || expected > UINT256_MAX) {
    throw new Error(`${label} expected chain is out of range.`);
  }
  if (responseChainId === undefined || responseChainId === null) return expected;

  let explicit: bigint;
  try {
    explicit = BigInt(responseChainId as bigint);
  } catch {
    throw new Error(`${label} transaction chain must be an unsigned integer.`);
  }
  if (explicit < 0n || explicit > UINT256_MAX) {
    throw new Error(`${label} transaction chain is out of range.`);
  }
  return explicit;
};
