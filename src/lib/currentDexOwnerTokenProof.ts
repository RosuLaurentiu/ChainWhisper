import { Interface, getAddress } from '@coti-io/coti-ethers';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE as candidate } from './currentDexExitCandidate';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from './currentDexHistoryCandidate';
import type { PrivateUint256Output } from './privateUint256';

// Owner-local proof under the approved Decision-029 runtime responsibility split.
// The caller must first verify the exact operation, call, receipt and protections.
export const currentDexOwnerTransferAbi = new Interface([
  'event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)'
]);
export type CurrentDexOwnerTokenAmounts = Readonly<{
  filled: boolean; maximumInput: bigint; actualInput: bigint; refund: bigint;
  grossOutput: bigint; fee: bigint; netOutput: bigint;
}>;
export type CurrentDexOwnerTokenBinding = Readonly<{
  graph: string; packageSha256: string; chainId: bigint; core: string; owner: string;
  destination: string; inputToken: string; outputToken: string; operationId: bigint;
  contextHash: string; transactionHash: string; blockNumber: number; blockHash: string;
}>;
export type CurrentDexOwnerTokenLog = Readonly<{
  address: string; topics: readonly string[]; data: string; index: number;
  transactionHash: string; blockNumber: number; blockHash: string; removed: boolean;
}>;
export type CurrentDexOwnerTokenReceipt = Readonly<{
  hash: string; status: number; blockNumber: number; blockHash: string;
  logs: readonly CurrentDexOwnerTokenLog[];
}>;
export type CurrentDexOwnerTokenPhase = 'accept' | 'terminal' | 'fast-settle' | 'recover' | 'cancel';
const fail = (code: string): never => { throw new Error(`Owner token proof: ${code}`); };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const hash = (v: string) => typeof v === 'string' && /^0x[0-9a-f]{64}$/i.test(v);
const uint = (v: bigint) => typeof v === 'bigint' && v >= 0n && v < 1n << 256n;
const address = (v: string) => {
  try { const a = getAddress(v); if (BigInt(a) === 0n) return fail('ADDRESS'); return a; }
  catch { return fail('ADDRESS'); }
};
const transferTopic = currentDexOwnerTransferAbi.getEvent('Transfer')!.topicHash;

export const verifyCurrentDexOwnerTokenMovements = async ({ binding, receipt, amounts, phase,
  decrypt, assertCurrent, verifyCanonical }: {
  binding: CurrentDexOwnerTokenBinding; receipt: CurrentDexOwnerTokenReceipt;
  amounts: CurrentDexOwnerTokenAmounts; phase: CurrentDexOwnerTokenPhase;
  decrypt: (cipher: PrivateUint256Output) => bigint | Promise<bigint>;
  assertCurrent: () => void | Promise<void>;
  // Existing trusted issuer must verify exact call/operation and canonical inclusion,
  // including the receipt's complete logs, initially and after private decryption.
  verifyCanonical: (binding: CurrentDexOwnerTokenBinding, receipt: CurrentDexOwnerTokenReceipt) => Promise<void>;
}) => {
  if (!binding || !receipt || !Array.isArray(receipt.logs) || receipt.logs.length > 256 ||
      !amounts || typeof decrypt !== 'function' || typeof assertCurrent !== 'function' ||
      typeof verifyCanonical !== 'function') fail('INPUT');
  if (receipt.logs.some(log => !log || !Array.isArray(log.topics) || log.topics.length > 4 ||
      typeof log.address !== 'string' || typeof log.data !== 'string' || log.data.length > 65538)) fail('LOG_SHAPE');
  const b = Object.freeze({ graph: binding.graph, packageSha256: binding.packageSha256,
    chainId: binding.chainId, core: binding.core, owner: binding.owner, destination: binding.destination,
    inputToken: binding.inputToken, outputToken: binding.outputToken, operationId: binding.operationId,
    contextHash: binding.contextHash, transactionHash: binding.transactionHash,
    blockNumber: binding.blockNumber, blockHash: binding.blockHash });
  const a = Object.freeze({ filled: amounts.filled, maximumInput: amounts.maximumInput,
    actualInput: amounts.actualInput, refund: amounts.refund, grossOutput: amounts.grossOutput,
    fee: amounts.fee, netOutput: amounts.netOutput });
  const r = Object.freeze({ hash: receipt.hash, status: receipt.status,
    blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
    logs: Object.freeze(receipt.logs.map(log => Object.freeze({ address: log.address,
      topics: Object.freeze([...log.topics]), data: log.data, index: log.index,
      transactionHash: log.transactionHash, blockNumber: log.blockNumber,
      blockHash: log.blockHash, removed: log.removed }))) });
  const core = address(b.core), owner = address(b.owner), destination = address(b.destination);
  const input = address(b.inputToken), output = address(b.outputToken);
  const selected = [candidate, STAGED_SHARED_HISTORY_DEX_CANDIDATE].find(c =>
    b.graph === c.graph && b.packageSha256 === c.packageSha256 &&
    b.chainId === BigInt(c.chainId) && same(core, c.core));
  if (!selected) fail('CANDIDATE');
  if (!same(owner, destination) || same(core, owner) || same(input, output) ||
      ![input, output].every(t => selected!.tokens.some(([at]) => same(at, t)))) fail('PARTIES');
  if (!uint(b.operationId) || b.operationId === 0n || !hash(b.contextHash) ||
      !hash(b.transactionHash) || !hash(b.blockHash) ||
      !Number.isSafeInteger(b.blockNumber) || b.blockNumber < 0) fail('BINDING');
  if (r.status !== 1 || !hash(r.hash) || !hash(r.blockHash) || !same(r.hash, b.transactionHash) ||
      r.blockNumber !== b.blockNumber || !same(r.blockHash, b.blockHash)) fail('RECEIPT');
  if (typeof a.filled !== 'boolean' ||
      ![a.maximumInput, a.actualInput, a.refund, a.grossOutput, a.fee, a.netOutput].every(uint) ||
      a.maximumInput === 0n || a.actualInput + a.refund !== a.maximumInput ||
      a.fee + a.netOutput !== a.grossOutput ||
      (a.filled ? a.actualInput === 0n || a.netOutput === 0n :
        a.actualInput !== 0n || a.grossOutput !== 0n || a.fee !== 0n || a.netOutput !== 0n)) fail('CONSERVATION');
  if ((phase === 'recover' || phase === 'cancel') && a.filled) fail('RELEASE');
  if (!['accept', 'terminal', 'fast-settle', 'recover', 'cancel'].includes(phase)) fail('PHASE');
  const legs: { token: string; from: string; to: string; envelope: 'senderValue' | 'receiverValue'; amount: bigint }[] = [];
  if (phase === 'accept' || phase === 'fast-settle')
    legs.push({ token: input, from: owner, to: core, envelope: 'senderValue', amount: a.maximumInput });
  // The frozen contract calls both payouts even for zero amounts. Missing zero
  // transfers fail too; private fill/refund does not change this expected shape.
  if (phase === 'terminal' || phase === 'fast-settle') {
    legs.push({ token: output, from: core, to: owner, envelope: 'receiverValue', amount: a.netOutput });
    legs.push({ token: input, from: core, to: owner, envelope: 'receiverValue', amount: a.refund });
  }
  if (phase === 'recover')
    legs.push({ token: input, from: core, to: owner, envelope: 'receiverValue', amount: a.maximumInput });
  const seenIndexes = new Set<number>(), seenLegs = new Set<number>();
  const envelopes: { value: PrivateUint256Output; amount: bigint }[] = [];
  for (const log of r.logs) {
    if (!Number.isSafeInteger(log.index) || log.index < 0 || seenIndexes.has(log.index) ||
        log.removed !== false || !hash(log.transactionHash) || !same(log.transactionHash, b.transactionHash) ||
        log.blockNumber !== b.blockNumber || !hash(log.blockHash) || !same(log.blockHash, b.blockHash) ||
        typeof log.data !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(log.data) ||
        log.topics.some(t => !hash(t))) fail('LOG_ORIGIN');
    seenIndexes.add(log.index);
    const at = address(log.address);
    if (!log.topics.length || !same(log.topics[0], transferTopic)) continue;
    let event: ReturnType<Interface['parseLog']>;
    try {
      event = currentDexOwnerTransferAbi.parseLog({ topics: [...log.topics], data: log.data });
      if (!event) return fail('TRANSFER_ABI');
      const encoded = currentDexOwnerTransferAbi.encodeEventLog(event.fragment, event.args);
      if (!same(encoded.data, log.data) || encoded.topics.length !== log.topics.length ||
          encoded.topics.some((t, i) => !same(t, log.topics[i]))) return fail('TRANSFER_ABI');
    } catch { return fail('TRANSFER_ABI'); }
    const legIndex = legs.findIndex(leg => same(at, leg.token) &&
      same(event!.args.from, leg.from) && same(event!.args.to, leg.to));
    if (legIndex < 0 || seenLegs.has(legIndex)) fail('TRANSFER_SET');
    seenLegs.add(legIndex);
    const leg = legs[legIndex], cipher = event.args[leg.envelope];
    envelopes.push({ value: Object.freeze({ ciphertextHigh: BigInt(cipher.ciphertextHigh),
      ciphertextLow: BigInt(cipher.ciphertextLow) }), amount: leg.amount });
  }
  if (seenLegs.size !== legs.length) fail('TRANSFER_SET');
  const current = async () => { try { await assertCurrent(); } catch { fail('SESSION'); } };
  const canonical = async () => {
    await current();
    try { await verifyCanonical(b, r); } catch { fail('CANONICAL'); }
    await current();
  };
  await canonical();
  for (const envelope of envelopes) {
    await current();
    let amount: bigint;
    try { amount = await decrypt(envelope.value); } catch { return fail('PRIVATE_ENVELOPE'); }
    await current();
    if (!uint(amount) || amount !== envelope.amount) fail('TOKEN_AMOUNT');
  }
  await canonical();
  // This result is transaction-specific owner evidence, not maker/global state,
  // a signing capability, a keeper admission or a durable success record.
  return Object.freeze({ schema: 'CURRENT_DEX_OWNER_TOKEN_MOVEMENTS_V1' as const, phase,
    operationId: b.operationId, contextHash: b.contextHash, transactionHash: b.transactionHash,
    blockNumber: b.blockNumber, blockHash: b.blockHash, ownerTokenMovementsVerified: true as const,
    fullFixtureAccountingVerified: false as const, nativeAdmission: false as const, readyToSign: false as const });
};
