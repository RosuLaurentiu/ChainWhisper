import { Interface, getAddress, keccak256, toBeHex } from '@coti-io/coti-ethers';
import { TRADE_BALANCE_DISCLOSURE_V2_ABI } from './tradeBalanceDisclosureV2Abi';
import { LINK_TRADE_V2_ABI } from './linkTradeV2Abi';
import { COUNTER_TRADE_V2_ABI } from './counterTradeV2Abi';
import { PRIVATE_BOOK_V2_ACTION_ABI } from './privateBookV2Actions';
import { DIRECT_TRADE_V2_ACTION_ABI } from './directTradeV2Actions';
import { assertCurrentP2PTradeBalanceAdmission, type CurrentP2PTradeBalanceAdmission, type TradeBalanceNativeVariant } from './currentP2PBinding';
import { assertAttestedTradeHistoryV2Deployment, readAttestedTradeHistoryV2View, readCanonicalTradeV2RawLogRange,
  readTradeHistoryV2CanonicalBlock, readTradeHistoryV2LatestBlockNumber, type TradeHistoryV2ReadCapability } from './tradeHistoryV2Chain';
import { getOwnerTradeV2CapabilityBinding, assertOwnerTradeV2CapabilityCurrent, assertOwnerTradeV2CapabilitySnapshotCurrent,
  type OwnerTradeV2MetaMaskCapability } from './ownerTradeV2Capability';
import { decryptPrivateUint256Output } from './privateUint256';
import { normalizeTradeBalanceDisclosureV2Action, type TradeBalanceDisclosureV2Action, type TradeBalanceDisclosureV2Journal, type TradeBalanceDisclosureV2Deployment } from './linkTradeV2CreationJournal';
import { sendLinkTradeV2Transaction, confirmLinkTradeV2Transaction } from './linkTradeV2CreationFlow';
import { findLinkTradeV2Transaction } from './linkTradeV2TransactionRecovery';
import { readLinkTradeV2ReceiptEvents } from './linkTradeV2OwnerActions';

const ABI = new Interface(TRADE_BALANCE_DISCLOSURE_V2_ABI), LINK = new Interface(LINK_TRADE_V2_ABI), COUNTER = new Interface(COUNTER_TRADE_V2_ABI),
  BOOK = new Interface(PRIVATE_BOOK_V2_ACTION_ABI), DIRECT = new Interface(DIRECT_TRADE_V2_ACTION_ABI);
export type TradeBalanceDisclosureV2Input = { readCapability: TradeHistoryV2ReadCapability; deployment: TradeBalanceDisclosureV2Deployment;
  capability: OwnerTradeV2MetaMaskCapability; journal: TradeBalanceDisclosureV2Journal; admission?: CurrentP2PTradeBalanceAdmission };
type Entry = Readonly<{ id: string; maker: string; taker?: string; offerToken: string; privatePair: boolean; variant: TradeBalanceNativeVariant; revision: string; status: number }>;
export type TradeBalanceDisclosureV2State = Entry & Readonly<{ owner: string; recipient?: string; grant?: Readonly<{ allowed: boolean; generation: string }>;
  availability: 'off' | 'current' | 'stale' | 'unavailable'; balance?: string }>;
const integer = (v: string, bits = 256, positive = false) => {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(v) || BigInt(v) >= (1n << BigInt(bits)) || positive && v === '0') throw new Error('Invalid trade-balance identity.');
  return v;
};
const address = (v: string) => { const result = getAddress(v).toLowerCase(); if (BigInt(result) === 0n) throw new Error('Invalid balance recipient.'); return result; };
const bindingFor = async (input: TradeBalanceDisclosureV2Input) => {
  assertAttestedTradeHistoryV2Deployment(input.deployment);
  if (!['private-v2', 'direct-v2', 'link-v2', 'counter-v2'].includes(input.deployment.protocol)) throw new Error('Unsupported balance-disclosure protocol.');
  const binding = getOwnerTradeV2CapabilityBinding(input.capability); await assertOwnerTradeV2CapabilityCurrent(binding);
  if (binding.chainId.toString() !== input.deployment.chainId) throw new Error('Trade-balance wallet chain differs.'); return binding;
};
const decode = (abi: Interface, name: string, raw: string) => {
  const value = abi.decodeFunctionResult(name, raw);
  if (abi.encodeFunctionResult(name, value).toLowerCase() !== raw.toLowerCase()) throw new Error('Invalid trade-balance response.'); return value;
};
const view = (input: TradeBalanceDisclosureV2Input, data: string, owner: string) => readAttestedTradeHistoryV2View({
  capability: input.readCapability, deployment: input.deployment, data, from: owner
});
const entry = async (input: TradeBalanceDisclosureV2Input, orderId: string): Promise<Entry> => {
  integer(orderId, 256, true); const binding = await bindingFor(input), owner = binding.ownerAddress.toLowerCase();
  const protocol = input.deployment.protocol, counter = protocol === 'counter-v2', book = protocol === 'private-v2', direct = protocol === 'direct-v2';
  const abi = counter ? COUNTER : book ? BOOK : direct ? DIRECT : LINK, name = counter ? 'getCounter' : direct ? 'getTradeView' : 'getOrderView';
  const decoded = decode(abi, name, await view(input, abi.encodeFunctionData(name, [orderId]), owner)), row = counter ? decoded.proposal : direct ? decoded[0].trade : decoded[0].order;
  const maker = address(row.maker), taker = counter || direct ? address(row.taker) : undefined;
  if ((counter || direct) && owner !== maker && owner !== taker) throw new Error('Trade balance is available only to its participants.');
  const privatePair = book ? row.mode === 0n && row.offerAsset.assetType === 2n && row.requestAsset.assetType === 2n
    : direct ? row.amountMode === 1n && row.offerAsset.assetType === 2n && row.requestAsset.assetType === 2n : row.privatePair;
  const maximumStatus = counter ? 6n : book ? 5n : direct ? 7n : 3n;
  if (row.status < 1n || row.status > maximumStatus || privatePair && (counter ? decoded.amounts.offer !== 0n || decoded.amounts.request !== 0n
    : direct ? decoded[0].publicAmounts.offerAmount !== 0n || decoded[0].publicAmounts.requestAmount !== 0n
      : book ? row.offerAsset.publicAmount !== 0n || row.requestAsset.publicAmount !== 0n
        : decoded[0].publicRemaining !== 0n || decoded[0].publicBudget !== 0n || decoded[0].publicPrice.offer !== 0n || decoded[0].publicPrice.request !== 0n)) throw new Error('Invalid private trade-balance state.');
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({ id: orderId, maker, ...(taker ? { taker } : {}), offerToken: address(book || direct ? row.offerAsset.token : row.offerToken), privatePair: privatePair as boolean,
    variant: 'private-pair', revision: counter || direct ? '1' : row.revision.toString(), status: Number(row.status) });
};
export const readTradeBalanceDisclosureV2 = async (input: TradeBalanceDisclosureV2Input & { orderId: string; recipient?: string }): Promise<TradeBalanceDisclosureV2State> => {
  const binding = await bindingFor(input), owner = binding.ownerAddress.toLowerCase(), current = await entry(input, input.orderId);
  if (!current.privatePair) throw new Error('Balance sharing is unavailable for this trade.');
  const recipient = owner === current.maker ? input.recipient ? address(input.recipient) : current.taker : owner;
  if (input.recipient && owner !== current.maker && address(input.recipient) !== owner || recipient === current.maker || current.taker && recipient && recipient !== current.taker) throw new Error('Invalid trade-balance recipient.');
  const access = recipient ? decode(ABI, 'getTradeBalanceAccess', await view(input, ABI.encodeFunctionData('getTradeBalanceAccess', [current.id, recipient]), owner))[0] : undefined;
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  const base = { ...current, owner, ...(recipient ? { recipient } : {}), ...(access ? { grant: Object.freeze({ allowed: access.allowed as boolean, generation: access.generation.toString() }) } : {}) };
  if (owner !== current.maker && !access?.allowed) return Object.freeze({ ...base, availability: 'off' });
  let raw: string | undefined;
  try { raw = await view(input, ABI.encodeFunctionData('getTradeBalanceSnapshot', [current.id]), owner); }
  catch { /* A missing/stale snapshot or unavailable node is not a zero balance. */ }
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  if (raw === undefined) return Object.freeze({ ...base, availability: 'unavailable' });
  const snapshot = decode(ABI, 'getTradeBalanceSnapshot', raw)[0], generation = owner === current.maker ? '0' : access!.generation.toString();
  if (!snapshot.initialized || snapshot.revision.toString() !== current.revision || snapshot.status !== BigInt(current.status) || snapshot.generation.toString() !== generation) return Object.freeze({ ...base, availability: 'stale' });
  const balance = decryptPrivateUint256Output(binding.signer, snapshot.remaining.userCiphertext);
  if (balance < 0n || balance >= (1n << 256n)) throw new Error('Invalid private escrow balance.');
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({ ...base, availability: 'current', balance: balance.toString() });
};
const calldata = (action: TradeBalanceDisclosureV2Action) => action.kind === 'grant'
  ? ABI.encodeFunctionData('setTradeBalanceAccess', [action.orderId, action.recipient, action.allowed]) : ABI.encodeFunctionData('refreshTradeBalanceSnapshot', [action.orderId]);
const account = (input: TradeBalanceDisclosureV2Input, action: TradeBalanceDisclosureV2Action, receipt: unknown) => {
  const name = action.kind === 'grant' ? 'TradeBalanceConsent' : 'TradeBalanceSnapshot';
  const events = readLinkTradeV2ReceiptEvents(receipt, input.deployment.contractAddress, ABI, name), e = events[0];
  if (events.length !== 1 || e.tradeId.toString() !== action.orderId || e.recipient.toLowerCase() !== action.recipient ||
      action.kind === 'grant' && (e.allowed !== action.allowed || e.generation !== BigInt(action.generation) + 1n) ||
      action.kind === 'snapshot' && (e.revision === 0n || e.status < 1n || e.status > (input.deployment.protocol === 'counter-v2' ? 6n : input.deployment.protocol === 'private-v2' ? 5n : input.deployment.protocol === 'direct-v2' ? 7n : 3n))) throw new Error('Trade-balance receipt differs from the request.');
  return Object.freeze({ kind: action.kind, orderId: action.orderId, recipient: action.recipient, generation: e.generation.toString() });
};
export const executeTradeBalanceDisclosureV2 = async (input: TradeBalanceDisclosureV2Input & { orderId: string; kind: 'grant' | 'snapshot'; recipient?: string; allowed?: boolean }) => {
  assertCurrentP2PTradeBalanceAdmission(input.deployment, input.admission);
  const state = await readTradeBalanceDisclosureV2(input), binding = await bindingFor(input);
  assertCurrentP2PTradeBalanceAdmission(input.deployment, input.admission, state.variant);
  if (input.kind === 'grant' ? state.owner !== state.maker || !state.recipient || typeof input.allowed !== 'boolean' : state.owner !== state.maker && !state.grant?.allowed) throw new Error('Trade-balance permission is unavailable for this wallet.');
  const action = normalizeTradeBalanceDisclosureV2Action({ kind: input.kind, orderId: state.id, maker: state.maker, owner: state.owner,
    recipient: input.kind === 'grant' ? state.recipient! : state.owner, generation: input.kind === 'grant' || state.owner !== state.maker ? state.grant!.generation : '0',
    ...(input.kind === 'grant' ? { allowed: input.allowed } : {}) });
  if (action.kind === 'grant' && BigInt(action.generation) === (1n << 64n) - 1n) throw new Error('Trade-balance grant generation is exhausted.');
  await input.journal.beginDisclosure(action);
  try {
    let result: ReturnType<typeof account> | undefined;
    await sendLinkTradeV2Transaction({ binding, step: action.kind === 'grant' ? 'consent' : 'balance-snapshot', to: input.deployment.contractAddress,
      data: calldata(action), onPending: input.journal.onPending, admit: async () => {
        const fresh = await readTradeBalanceDisclosureV2({ ...input, recipient: action.kind === 'grant' ? action.recipient : undefined });
        if (fresh.maker !== action.maker || fresh.owner !== action.owner || fresh.revision !== state.revision || fresh.status !== state.status ||
            action.kind === 'grant' && fresh.grant?.generation !== action.generation || action.kind === 'snapshot' && fresh.owner !== fresh.maker && (!fresh.grant?.allowed || fresh.grant.generation !== action.generation)) throw new Error('Trade-balance permission or source changed before signing.');
      }, complete: async receipt => { result = account(input, action, receipt); } });
    if (!result) throw new Error('Trade-balance request needs reconciliation.'); return result;
  } catch (error) { await input.journal.releaseUnsent(); throw error; }
};
export const readTradeBalanceDisclosureV2Pending = async (input: TradeBalanceDisclosureV2Input & { orderId?: string }) => {
  const binding = await bindingFor(input), saved = await input.journal.read();
  if (!saved?.disclosure || saved.abandoned || input.orderId !== undefined && saved.disclosure.orderId !== integer(input.orderId, 256, true) || input.orderId === undefined && !saved.active) return null;
  if (saved.scope.owner !== binding.ownerAddress.toLowerCase() || saved.scope.chainId !== input.deployment.chainId || saved.scope.escrow !== input.deployment.contractAddress ||
      saved.scope.runtimeHash !== input.deployment.runtimeBytecodeHash) throw new Error('Saved balance request belongs to another wallet or deployment.');
  return Object.freeze({ id: saved.id, active: saved.active, action: saved.disclosure, feeWei: saved.feeWei, last: saved.records[saved.records.length - 1] });
};
export const reconcileTradeBalanceDisclosureV2 = async (input: TradeBalanceDisclosureV2Input & { transactionHash?: string }) => {
  const saved = await readTradeBalanceDisclosureV2Pending(input), binding = await bindingFor(input), original = saved?.last;
  if (!saved || !original || original.state === 'rejected') throw new Error('No submitted trade-balance request is available.');
  if (original.state === 'failed') return undefined;
  if (original.dataHash !== keccak256(calldata(saved.action))) throw new Error('Saved balance request data differs.');
  const found = await findLinkTradeV2Transaction(binding.readProvider!, original, input.journal, input.transactionHash);
  if (!found) return null;
  let result: ReturnType<typeof account> | undefined;
  await confirmLinkTradeV2Transaction(binding, found.record, found.receipt, original.state === 'confirmed' ? async () => {} : input.journal.onPending,
    async receipt => { result = account(input, saved.action, receipt); }, async () => {});
  return result;
};
export const readTradeBalanceDisclosureV2Recipients = async (input: TradeBalanceDisclosureV2Input & { orderId: string; cursor?: Readonly<{ number: string; hash: string }> }) => {
  const binding = await bindingFor(input), current = await entry(input, input.orderId);
  if (current.maker !== binding.ownerAddress.toLowerCase() || !current.privatePair) throw new Error('Only the maker can manage this recipient list.');
  let cursor = input.cursor, reset = false;
  if (cursor && (await readTradeHistoryV2CanonicalBlock({ capability: input.readCapability, blockNumber: BigInt(integer(cursor.number)) }))?.hash !== cursor.hash) { cursor = undefined; reset = true; }
  const latest = BigInt(await readTradeHistoryV2LatestBlockNumber(input.readCapability)), lag = BigInt(input.deployment.finalityLagBlocks);
  if (latest < lag) throw new Error('Trade-balance history head is unavailable.');
  const head = latest - lag;
  if (cursor && BigInt(cursor.number) > head) { cursor = undefined; reset = true; }
  const from = cursor ? BigInt(cursor.number) + 1n : BigInt(input.deployment.deploymentBlock);
  if (from > head) return Object.freeze({ recipients: [] as readonly string[], cursor, complete: true, reset });
  const to = from + 2047n < head ? from + 2047n : head;
  const page = await readCanonicalTradeV2RawLogRange({ capability: input.readCapability, deployment: input.deployment, fromBlock: from, toBlock: to,
    topics: [ABI.getEvent('TradeBalanceConsent')!.topicHash, toBeHex(BigInt(current.id), 32)] });
  const recipients = new Set<string>();
  for (const log of page.logs) {
    const e = ABI.decodeEventLog('TradeBalanceConsent', log.data, [...log.topics]), encoded = ABI.encodeEventLog(ABI.getEvent('TradeBalanceConsent')!, [...e]);
    if (encoded.data !== log.data || encoded.topics.join(',') !== log.topics.join(',') || e.tradeId.toString() !== current.id || e.generation === 0n) throw new Error('Invalid trade-balance consent history.');
    recipients.add(address(e.recipient));
  }
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({ recipients: Object.freeze([...recipients]), cursor: Object.freeze({ number: page.range.toBlock, hash: page.range.toBlockHash }), complete: to === head, reset });
};

export type TradeBalanceDisclosureV2Runtime = Readonly<{
  ownerAddress: string;
  available?: boolean;
  read(orderId: string, recipient?: string): ReturnType<typeof readTradeBalanceDisclosureV2>;
  execute(action: Readonly<{ orderId: string; kind: 'grant' | 'snapshot'; recipient?: string; allowed?: boolean }>): ReturnType<typeof executeTradeBalanceDisclosureV2>;
  pending(orderId?: string): ReturnType<typeof readTradeBalanceDisclosureV2Pending>;
  reconcile(transactionHash?: string): ReturnType<typeof reconcileTradeBalanceDisclosureV2>;
  recipients(orderId: string, cursor?: Readonly<{ number: string; hash: string }>): ReturnType<typeof readTradeBalanceDisclosureV2Recipients>;
}>;
