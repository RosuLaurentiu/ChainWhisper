// CW-136: bounded public wait for one submitted top-up transaction.
// It reads the receipt only. It signs nothing, sends nothing and clears no record.
export const TOP_UP_RESULT_WAIT = { tries: 6, delayMs: 5_000 };

type ReceiptProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

/** True when the wallet RPC returns a receipt. False when the bound ends or the view scope changed. */
export const waitForTopUpReceipt = async (provider: ReceiptProvider | null | undefined, transactionHash: string,
  active: () => boolean): Promise<boolean> => {
  // No provider: the caller makes its one normal check, which fails closed.
  if (!provider) return active();
  for (let attempt = 0; attempt < TOP_UP_RESULT_WAIT.tries; attempt++) {
    if (!active()) return false;
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, TOP_UP_RESULT_WAIT.delayMs));
    if (!active()) return false;
    let receipt: unknown = null;
    try { receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: [transactionHash] }); } catch { receipt = null; }
    if (receipt !== null && typeof receipt === 'object') return active();
  }
  return false;
};
