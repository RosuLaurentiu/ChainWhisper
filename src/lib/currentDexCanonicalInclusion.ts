import type { CurrentTransport } from './currentDexSubmission';

type Inputs = Parameters<NonNullable<CurrentTransport['verifyCanonicalInclusion']>>;
type Rpc = (method: string, params: unknown[]) => Promise<unknown>;
const fail = (): never => { throw new Error('Current DEX canonical transaction inclusion changed. Do not resend.'); };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail();
const hex = (value: unknown, bytes?: number): string => typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value) && (bytes === undefined || value.length === 2 + bytes * 2) ? value.toLowerCase() : fail();
const hash = (value: unknown) => { const result = hex(value, 32); return BigInt(result) !== 0n ? result : fail(); };
const address = (value: unknown) => value === null ? null : hex(value, 20);
const quantity = (value: unknown): bigint => typeof value === 'string' && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value) ? BigInt(value) : fail();
const safe = (value: unknown): number => { const n = quantity(value); return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : fail(); };
const integer = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail();
const amount = (value: unknown): bigint => typeof value === 'bigint' && value >= 0n ? value : fail();
const originFields = ['index', 'transactionHash', 'blockNumber', 'blockHash', 'removed'] as const;
type CanonicalLog = { address: string; topics: string[]; data: string; origin?: {
  index: number; transactionHash: string; blockNumber: number; blockHash: string; removed: false;
} };
const logs = (value: unknown, raw = false, expected?: readonly CanonicalLog[]): CanonicalLog[] => {
  if (!Array.isArray(value)) return fail();
  const seenIndexes = new Set<number>();
  return value.map((item, index) => {
    const row = object(item);
    if (!Array.isArray(row.topics) || row.removed === true) return fail();
    const body = { address: hex(row.address, 20), topics: row.topics.map(topic => hex(topic, 32)), data: hex(row.data) };
    const hasOrigin = raw ? expected?.[index]?.origin !== undefined : originFields.some(field => Object.prototype.hasOwnProperty.call(row, field));
    if (!hasOrigin) return body;
    if (!raw && !originFields.every(field => field === 'removed' || Object.prototype.hasOwnProperty.call(row, field))) return fail();
    const origin = raw ? {
      index: safe(row.logIndex), transactionHash: hash(row.transactionHash), blockNumber: safe(row.blockNumber),
      blockHash: hash(row.blockHash), removed: row.removed
    } : {
      index: integer(row.index), transactionHash: hash(row.transactionHash), blockNumber: integer(row.blockNumber),
      // SDK logs omit removed; the independent raw receipt must still confirm false.
      blockHash: hash(row.blockHash), removed: row.removed === undefined ? false : row.removed
    };
    if (origin.removed !== false || seenIndexes.has(origin.index)) return fail();
    seenIndexes.add(origin.index);
    return { ...body, origin: { ...origin, removed: false as const } };
  });
};
const block = (value: unknown) => { const row = object(value); if (!Array.isArray(row.transactions)) return fail();
  return { number: safe(row.number), hash: hash(row.hash), transactions: row.transactions.map(hash) }; };
const equal = (left: unknown, right: unknown) => { if (JSON.stringify(left) !== JSON.stringify(right)) fail(); };

/** Public receipt reconciliation only. This helper grants no signing or private-read authority. */
export const verifyCurrentDexCanonicalInclusion = async ({ rpc, assertCurrent }: { rpc: Rpc; assertCurrent: () => void | Promise<void> },
  transaction: Inputs[0], receipt: Inputs[1]): Promise<void> => {
  const expectedTx = { hash: hash(transaction.hash), chainId: amount(transaction.chainId).toString(), from: address(transaction.from),
    to: address(transaction.to), value: amount(transaction.value).toString(), data: hex(transaction.data), nonce: integer(transaction.nonce),
    gasLimit: amount(transaction.gasLimit).toString(), blockNumber: integer(transaction.blockNumber), blockHash: hash(transaction.blockHash) };
  if (expectedTx.from === null || receipt.from === null || receipt.status !== 0 && receipt.status !== 1) fail();
  const expectedReceipt = { hash: hash(receipt.hash), status: receipt.status, from: address(receipt.from), to: address(receipt.to),
    blockNumber: integer(receipt.blockNumber), blockHash: hash(receipt.blockHash), logs: logs(receipt.logs) };
  if (expectedReceipt.hash !== expectedTx.hash || expectedReceipt.blockNumber !== expectedTx.blockNumber || expectedReceipt.blockHash !== expectedTx.blockHash ||
      expectedReceipt.from !== expectedTx.from || expectedReceipt.to !== expectedTx.to) fail();
  const read = async (method: string, params: unknown[]) => { await assertCurrent(); const value = await rpc(method, params); await assertCurrent(); return value; };
  const tag = `0x${expectedTx.blockNumber.toString(16)}`;
  const before = block(await read('eth_getBlockByNumber', [tag, false]));
  const rawTx = object(await read('eth_getTransactionByHash', [expectedTx.hash]));
  const rawReceipt = object(await read('eth_getTransactionReceipt', [expectedTx.hash]));
  equal({ hash: hash(rawTx.hash), chainId: quantity(rawTx.chainId).toString(), from: address(rawTx.from), to: address(rawTx.to),
    value: quantity(rawTx.value).toString(), data: hex(rawTx.input), nonce: safe(rawTx.nonce), gasLimit: quantity(rawTx.gas).toString(),
    blockNumber: safe(rawTx.blockNumber), blockHash: hash(rawTx.blockHash) }, expectedTx);
  equal({ hash: hash(rawReceipt.transactionHash), status: safe(rawReceipt.status), from: address(rawReceipt.from), to: address(rawReceipt.to),
    blockNumber: safe(rawReceipt.blockNumber), blockHash: hash(rawReceipt.blockHash), logs: logs(rawReceipt.logs, true, expectedReceipt.logs) }, expectedReceipt);
  const txIndex = safe(rawTx.transactionIndex), receiptIndex = safe(rawReceipt.transactionIndex);
  if (txIndex !== receiptIndex || before.number !== expectedTx.blockNumber || before.hash !== expectedTx.blockHash || before.transactions[txIndex] !== expectedTx.hash) fail();
  const after = block(await read('eth_getBlockByNumber', [tag, false]));
  equal(after, before);
  await assertCurrent();
};
