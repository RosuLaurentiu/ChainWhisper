import { AbiCoder, Interface, getAddress } from '@coti-io/coti-ethers';
import type { PrivateUint256Output } from './privateUint256';

export const CURRENT_LIMIT_FILL_HISTORY_GRAPH = '3717c866cd23fcd793f98753df5fc5974d25cdffbc5d57633bca353aaa13fdc1';
export const SHARED_RECEIPT_LIMIT_FILL_HISTORY_GRAPH = '7b67bcbb7c5941a24471e62ba5a0d939c0800671b0bf121e81bad14cca737456';
export const CURRENT_LIMIT_FILL_HISTORY_GRAPHS: readonly string[] = Object.freeze([
  CURRENT_LIMIT_FILL_HISTORY_GRAPH, SHARED_RECEIPT_LIMIT_FILL_HISTORY_GRAPH
]);
export const currentLimitFillHistoryAbi = new Interface([
  'function limitFillHistory(uint8 action,uint256 record) returns(bytes)',
  'error ReceiptAccessDenied()'
]);
export type CurrentDexLimitFill = Readonly<{
  engine: string; record: bigint; positionId: bigint; blockNumber: bigint; blockHash: string; timestamp: bigint;
  soldToken: string; receivedToken: string; sold: bigint; received: bigint;
  readyToSign: false; nativeAdmission: false;
}>;
type Head = Readonly<{ number: bigint; hash: string; timestamp: bigint }>;
const coder = AbiCoder.defaultAbiCoder(), uintMax = (1n << 256n) - 1n;
const receiptTypes = ['uint256', 'uint256', 'tuple(uint256 ciphertextHigh,uint256 ciphertextLow)[4]'];
const sharedReceiptTypes = ['uint256', 'uint256', 'tuple(uint256 ciphertextHigh,uint256 ciphertextLow)[3]', 'uint256'];
const denied = currentLimitFillHistoryAbi.getError('ReceiptAccessDenied')!.selector;
const quantity = (raw: unknown): bigint => {
  if (typeof raw !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(raw)) throw new Error('Limit fill block is unavailable.');
  return BigInt(raw);
};

/** Read saved-owner envelopes only; this reader cannot refresh, sign or spend. */
export const readCurrentLimitFillHistoryPage = async ({ graph, owner, engine, poolTokens, head, rpc,
  assertCurrent, attest, decrypt, decryptBool, before, pageSize = 32 }: {
  graph: string; owner: string; engine: string; poolTokens: readonly [string, string]; head: Head;
  rpc: (method: string, params: unknown[]) => Promise<unknown>;
  assertCurrent: () => void | Promise<void>; attest: (head: Head) => void | Promise<void>;
  decrypt: (cipher: PrivateUint256Output) => bigint; decryptBool?: (cipher: bigint) => boolean;
  before?: bigint; pageSize?: number;
}) => {
  if (!CURRENT_LIMIT_FILL_HISTORY_GRAPHS.includes(graph)) throw new Error('Individual Limit history is unavailable for this candidate.');
  const sharedReceipt = graph === SHARED_RECEIPT_LIMIT_FILL_HISTORY_GRAPH;
  if (sharedReceipt && !decryptBool) throw new Error('Private Boolean history decoder is unavailable.');
  const types = sharedReceipt ? sharedReceiptTypes : receiptTypes;
  const account = getAddress(owner).toLowerCase(), host = getAddress(engine).toLowerCase();
  const tokens = poolTokens.map(token => getAddress(token).toLowerCase());
  if (BigInt(account) === 0n || BigInt(host) === 0n || tokens.length !== 2 || BigInt(tokens[0]) === 0n ||
      BigInt(tokens[0]) >= BigInt(tokens[1]) || typeof head.number !== 'bigint' || head.number < 0n || head.number > BigInt(Number.MAX_SAFE_INTEGER) ||
      !/^0x[0-9a-f]{64}$/i.test(head.hash) || typeof head.timestamp !== 'bigint' || head.timestamp < 0n ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 64) throw new Error('Limit fill history scope is invalid.');
  await assertCurrent(); await attest(head); await assertCurrent();
  const read = async (action: 0 | 1, record: bigint) => {
    await assertCurrent();
    const raw = await rpc('eth_call', [{ from: account, to: host,
      data: currentLimitFillHistoryAbi.encodeFunctionData('limitFillHistory', [action, record]) },
    { blockHash: head.hash, requireCanonical: true }]);
    await assertCurrent();
    if (typeof raw !== 'string') throw new Error('Limit fill canonical encoding is unavailable.');
    const decoded = currentLimitFillHistoryAbi.decodeFunctionResult('limitFillHistory', raw);
    if (currentLimitFillHistoryAbi.encodeFunctionResult('limitFillHistory', decoded).toLowerCase() !== raw.toLowerCase())
      throw new Error('Limit fill canonical encoding changed.');
    return decoded[0] as string;
  };
  const countRaw = await read(0, 0n), count = coder.decode(['uint256'], countRaw)[0] as bigint;
  if (coder.encode(['uint256'], [count]).toLowerCase() !== countRaw.toLowerCase()) throw new Error('Limit fill canonical count changed.');
  const end = before ?? count;
  if (typeof end !== 'bigint' || end < 0n || end > count) throw new Error('Limit fill history cursor changed.');
  const start = end > BigInt(pageSize) ? end - BigInt(pageSize) : 0n;
  const readBlock = async (number: bigint) => {
    await assertCurrent();
    const raw = await rpc('eth_getBlockByNumber', [`0x${number.toString(16)}`, false]);
    await assertCurrent();
    if (!raw || typeof raw !== 'object') throw new Error('Limit fill block is unavailable.');
    const block = raw as Record<string, unknown>;
    if (quantity(block.number) !== number || typeof block.hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(block.hash))
      throw new Error('Limit fill block identity changed.');
    return { hash: block.hash.toLowerCase(), timestamp: quantity(block.timestamp) };
  };
  const fills: CurrentDexLimitFill[] = [];
  for (let record = end; record > start;) {
    record -= 1n;
    let raw: string;
    try { raw = await read(1, record); }
    catch (error) {
      await assertCurrent();
      if (error && typeof error === 'object' && 'code' in error && error.code === 'CALL_EXCEPTION' &&
          'data' in error && error.data === denied) continue;
      throw error;
    }
    const values = coder.decode(types, raw);
    if (coder.encode(types, values).toLowerCase() !== raw.toLowerCase()) throw new Error('Limit fill canonical receipt changed.');
    const [blockNumber, timestamp, ciphers] = values as unknown as [bigint, bigint, PrivateUint256Output[]];
    if (blockNumber > head.number || timestamp > head.timestamp || timestamp > 8_640_000_000_000n)
      throw new Error('Limit fill receipt block is outside the history head.');
    // Check every owned slot, including zero fills, so private fill size does not select RPC work.
    const block = await readBlock(blockNumber);
    if (block.timestamp !== timestamp) throw new Error('Limit fill receipt block time changed.');
    await assertCurrent();
    let privateValues: bigint[];
    try {
      privateValues = ciphers.map(cipher => decrypt(cipher));
      if (sharedReceipt) {
        const direction = decryptBool!(values[3] as bigint);
        if (typeof direction !== 'boolean') throw new Error('Invalid private Boolean.');
        privateValues.push(direction ? 1n : 0n);
      }
    }
    catch { throw new Error('Unlock the saved owner privacy to read Limit fills.'); }
    await assertCurrent();
    if (privateValues.some(value => typeof value !== 'bigint' || value < 0n || value > uintMax)) throw new Error('Limit fill private values are invalid.');
    const [positionId, sold, received, direction] = privateValues;
    if (positionId === 0n || direction > 1n) throw new Error('Limit fill identity is invalid.');
    if ((sold === 0n) !== (received === 0n)) throw new Error('Limit fill amounts do not preserve zero charge and output.');
    if (sold !== 0n) fills.push(Object.freeze({ engine: host, record, positionId, blockNumber, blockHash: block.hash,
      timestamp, soldToken: tokens[direction === 1n ? 0 : 1], receivedToken: tokens[direction === 1n ? 1 : 0],
      sold, received, readyToSign: false, nativeAdmission: false }));
  }
  const canonical = await readBlock(head.number);
  if (canonical.hash !== head.hash.toLowerCase() || canonical.timestamp !== head.timestamp) throw new Error('Limit fill history head changed. Refresh history.');
  await assertCurrent();
  return Object.freeze({ fills: Object.freeze(fills), count, nextBefore: start, complete: start === 0n,
    readyToSign: false as const, nativeAdmission: false as const });
};
