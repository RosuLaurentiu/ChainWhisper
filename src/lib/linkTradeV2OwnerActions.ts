import { Interface, keccak256 } from '@coti-io/coti-ethers';
import { LINK_TRADE_V2_ABI } from './linkTradeV2Abi';
import type { LinkTradeV2Deployment } from './linkTradeV2';
import { assertAttestedTradeHistoryV2Deployment, readAttestedTradeHistoryV2View, type TradeHistoryV2ReadCapability } from './tradeHistoryV2Chain';
import { getOwnerTradeV2CapabilityBinding, assertOwnerTradeV2CapabilityCurrent, type OwnerTradeV2MetaMaskCapability } from './ownerTradeV2Capability';
import { sendLinkTradeV2Transaction, confirmLinkTradeV2Transaction, readLinkTradeV2Balance, readLinkTradeV2Allowance,
  type LinkTradeV2CreationRecoveryJournal } from './linkTradeV2CreationFlow';
import type { LinkTradeV2OwnerAction } from './linkTradeV2CreationJournal';
import { decryptPrivateUint256Output, encryptPrivateUint256Input } from './privateUint256';
import { PRIVATE_ERC20_TOKEN_VNEXT_ABI } from './appShared/core';
import { findLinkTradeV2Transaction } from './linkTradeV2TransactionRecovery';

const ABI = new Interface(LINK_TRADE_V2_ABI), PUBLIC_TOKEN = new Interface([
  'function approve(address,uint256) returns(bool)', 'event Transfer(address indexed from,address indexed to,uint256 value)']);
const PRIVATE_TOKEN = new Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI);
const PRIVATE_TRANSFER = new Interface(['event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
type Input = { readCapability: TradeHistoryV2ReadCapability; deployment: LinkTradeV2Deployment; capability: OwnerTradeV2MetaMaskCapability };
type ActionInput = Input & { journal: LinkTradeV2CreationRecoveryJournal };
type Binding = ReturnType<typeof getOwnerTradeV2CapabilityBinding>;
export type LinkTradeV2OwnerOrder = Readonly<{ id: string; maker: string; offerToken: string; requestToken: string;
  privatePair: boolean; tokenCodeHash: string; status: number; effectiveStatus: number; revision: string; publicRemaining: string; allowance: string }>;
export type LinkTradeV2OwnerResult = Readonly<{ action: 'cancel' | 'cleanup'; orderId?: string; offerToken: string; refund: string; transactionHash?: string }>;
const id = (v: string) => {
  if (typeof v !== 'string' || !/^[1-9][0-9]{0,77}$/.test(v) || BigInt(v) >= (1n << 256n)) throw new Error('Invalid Link order ID.');
  return v;
};
const scope = async (input: Input) => {
  assertAttestedTradeHistoryV2Deployment(input.deployment, 'link-v2');
  const binding = getOwnerTradeV2CapabilityBinding(input.capability);
  await assertOwnerTradeV2CapabilityCurrent(binding);
  if (!binding.readProvider || binding.chainId.toString() !== input.deployment.chainId ||
      (await binding.readProvider.getNetwork()).chainId !== binding.chainId) throw new Error('Link owner chain access is unavailable.');
  return binding;
};
const order = async (input: Input, binding: Binding, orderId: string) => {
  const raw = await readAttestedTradeHistoryV2View({ capability: input.readCapability, deployment: input.deployment,
    data: ABI.encodeFunctionData('getOrderView', [id(orderId)]) });
  const decoded = ABI.decodeFunctionResult('getOrderView', raw);
  if (ABI.encodeFunctionResult('getOrderView', decoded).toLowerCase() !== raw.toLowerCase()) throw new Error('Invalid Link owner state.');
  const view = decoded[0], o = view.order;
  if (o.maker.toLowerCase() !== binding.ownerAddress.toLowerCase()) return null;
  if (o.status < 1n || o.status > 3n || o.revision === 0n || BigInt(o.offerCodeHash) === 0n) throw new Error('Invalid Link owner state.');
  await assertOwnerTradeV2CapabilityCurrent(binding);
  return Object.freeze({ id: orderId, maker: o.maker.toLowerCase(), offerToken: o.offerToken.toLowerCase(), requestToken: o.requestToken.toLowerCase(),
    privatePair: o.privatePair as boolean, tokenCodeHash: o.offerCodeHash.toLowerCase(), status: Number(o.status),
    effectiveStatus: Number(view.effectiveStatus), revision: o.revision.toString(), publicRemaining: view.publicRemaining.toString() });
};
export const readLinkTradeV2OwnerOrder = async (input: Input & { orderId: string }): Promise<LinkTradeV2OwnerOrder | null> => {
  const binding = await scope(input), current = await order(input, binding, input.orderId);
  if (!current) return null;
  const allowance = await readLinkTradeV2Allowance(binding, current, input.deployment.contractAddress);
  if (allowance === null) throw new Error('Link allowance is unavailable.');
  await assertOwnerTradeV2CapabilityCurrent(binding);
  return Object.freeze({ ...current, allowance: allowance.toString() });
};
const tokenCurrent = async (binding: Binding, action: LinkTradeV2OwnerAction) => {
  const code = await binding.readProvider!.getCode(action.offerToken);
  if (code === '0x' || keccak256(code) !== action.tokenCodeHash) throw new Error('Link offer-token code changed.');
};
export const readLinkTradeV2ReceiptEvents = (receipt: unknown, address: string, abi: Interface, name: string) => {
  const r = receipt as { hash?: string; transactionHash?: string; blockHash: string; blockNumber: number; logs: Array<Record<string, unknown>> };
  if (!Array.isArray(r.logs)) throw new Error('Link action receipt logs are unavailable.');
  const selected = [], indexes = new Set<string>();
  for (const log of r.logs) {
    const index = String(log.index ?? log.logIndex);
    if (!/^(0|[1-9][0-9]*)$/.test(index) || indexes.has(index) || log.removed === true ||
        String(log.transactionHash).toLowerCase() !== (r.hash ?? r.transactionHash)?.toLowerCase() ||
        String(log.blockHash).toLowerCase() !== r.blockHash.toLowerCase() || BigInt(log.blockNumber as number) !== BigInt(r.blockNumber)) {
      throw new Error('Link action log origin is invalid.');
    }
    indexes.add(index);
    if (String(log.address).toLowerCase() !== address || !Array.isArray(log.topics) || log.topics[0] !== abi.getEvent(name)!.topicHash) continue;
    const decoded = abi.decodeEventLog(name, log.data as string, log.topics as string[]), encoded = abi.encodeEventLog(abi.getEvent(name)!, [...decoded]);
    if (encoded.data !== String(log.data).toLowerCase() || encoded.topics.join(',') !== (log.topics as string[]).map(t => t.toLowerCase()).join(',')) throw new Error('Link action event is not canonical.');
    selected.push(decoded);
  }
  return selected;
};
const account = async (input: Input, binding: Binding, action: LinkTradeV2OwnerAction, receipt: unknown, alreadyConfirmed = false) => {
  let refund = 0n;
  if (action.kind === 'cancel') {
    const closed = readLinkTradeV2ReceiptEvents(receipt, input.deployment.contractAddress, ABI, 'LinkClosed');
    if (closed.length !== 1 || closed[0].id.toString() !== action.orderId || closed[0].status !== 2n) throw new Error('Link cancellation receipt is not exact.');
    const token = action.privatePair ? PRIVATE_TRANSFER : PUBLIC_TOKEN, transfers = readLinkTradeV2ReceiptEvents(receipt, action.offerToken, token, 'Transfer');
    if (transfers.length !== 1 || transfers[0].from.toLowerCase() !== input.deployment.contractAddress ||
        transfers[0].to.toLowerCase() !== binding.ownerAddress.toLowerCase()) throw new Error('Link refund transfer is not exact.');
    refund = action.privatePair ? decryptPrivateUint256Output(binding.signer, transfers[0].receiverValue) : BigInt(transfers[0].value);
    if (refund < 0n || refund >= (1n << 256n)) throw new Error('Link refund amount is invalid.');
    if (!alreadyConfirmed) {
      const closedState = await order(input, binding, action.orderId!);
      if (!closedState || closedState.status !== 2 || closedState.publicRemaining !== '0' || closedState.revision !== closed[0].revision.toString()) throw new Error('Link closed state does not match its receipt.');
    }
  } else if (!alreadyConfirmed && await readLinkTradeV2Allowance(binding, action, input.deployment.contractAddress) !== 0n) throw new Error('Link allowance did not clear.');
  if (!alreadyConfirmed) {
    const after = await readLinkTradeV2Balance(binding, action);
    if (after === null || after - BigInt(action.beforeBalance) !== refund) throw new Error('Link owner refund is not exactly accounted. Keep the saved hash.');
  }
  await assertOwnerTradeV2CapabilityCurrent(binding);
  const r = receipt as { hash?: string; transactionHash?: string };
  return Object.freeze({ action: action.kind, orderId: action.orderId, offerToken: action.offerToken, refund: refund.toString(), transactionHash: r.hash ?? r.transactionHash });
};
const execute = async (input: ActionInput, action: LinkTradeV2OwnerAction, creationId?: string) => {
  const binding = await scope(input);
  await tokenCurrent(binding, action);
  await input.journal.beginOwnerAction(action, creationId);
  try {
    let data: string, to = input.deployment.contractAddress;
    if (action.kind === 'cancel') data = ABI.encodeFunctionData('cancelOrder', [action.orderId]);
    else {
      const current = await readLinkTradeV2Allowance(binding, action, to);
      if (current === null) throw new Error('Link allowance is unavailable.');
      if (current === 0n) {
        if (await readLinkTradeV2Balance(binding, action) !== BigInt(action.beforeBalance)) throw new Error('Link token balance changed during cleanup.');
        await input.journal.finishCleanup();
        return Object.freeze({ action: 'cleanup' as const, offerToken: action.offerToken, refund: '0', orderId: action.orderId });
      }
      to = action.offerToken;
      data = action.privatePair ? PRIVATE_TOKEN.encodeFunctionData('approve(address,((uint256,uint256),bytes))', [input.deployment.contractAddress,
        await encryptPrivateUint256Input(binding.signer, 0n, to, PRIVATE_TOKEN.getFunction('approve(address,((uint256,uint256),bytes))')!.selector)])
        : PUBLIC_TOKEN.encodeFunctionData('approve', [input.deployment.contractAddress, 0n]);
    }
    let result: LinkTradeV2OwnerResult | undefined;
    await sendLinkTradeV2Transaction({ binding, step: action.kind, to, data, onPending: input.journal.onPending,
      admit: async () => {
        await tokenCurrent(binding, action);
        if (action.kind === 'cancel') {
          const current = await order(input, binding, action.orderId!);
          if (!current || current.status !== 1 || current.offerToken !== action.offerToken || current.privatePair !== action.privatePair ||
              current.tokenCodeHash !== action.tokenCodeHash) throw new Error('Link order is no longer cancellable by this wallet.');
        }
      }, complete: async receipt => { result = await account(input, binding, action, receipt); } });
    if (!result) throw new Error('Link owner action needs reconciliation.');
    return result;
  } catch (error) { await input.journal.releaseUnsent(); throw error; }
};
export const executeLinkTradeV2OwnerOrderAction = async (input: ActionInput & { orderId: string; kind: 'cancel' | 'cleanup' }) => {
  const binding = await scope(input), current = await order(input, binding, id(input.orderId));
  if (!current || input.kind === 'cancel' && current.status !== 1) throw new Error('Link order is not available for this owner action.');
  const before = await readLinkTradeV2Balance(binding, current);
  if (before === null) throw new Error('Link owner token balance is unavailable.');
  return execute(input, Object.freeze({ kind: input.kind, orderId: current.id, offerToken: current.offerToken, privatePair: current.privatePair,
    tokenCodeHash: current.tokenCodeHash, beforeBalance: before.toString() }));
};
export const cleanupLinkTradeV2Creation = async (input: ActionInput & { creationId: string }) => {
  const saved = await input.journal.read();
  const last = saved?.records[saved.records.length - 1];
  const safeRecords = saved?.records.every(r => r.state === 'confirmed' && !['create', 'fill'].includes(r.step) || r === last && ['rejected', 'failed'].includes(r.state));
  if (!saved || (!saved.active && !['rejected', 'failed'].includes(last?.state ?? '')) || saved.id !== input.creationId || (!saved.recovery && !saved.fill) || saved.ownerAction ||
      !safeRecords || saved.scope.escrow !== input.deployment.contractAddress || saved.scope.chainId !== input.deployment.chainId ||
      saved.scope.runtimeHash !== input.deployment.runtimeBytecodeHash) throw new Error('This Link preparation cannot be cleared before reconciliation.');
  const binding = await scope(input), material = saved.fill ?? saved.recovery!;
  if (saved.scope.owner !== binding.ownerAddress.toLowerCase()) throw new Error('Link cleanup wallet changed.');
  const payer = { offerToken: saved.fill?.terms.requestToken ?? material.terms.offerToken, privatePair: material.terms.privatePair };
  const before = await readLinkTradeV2Balance(binding, payer);
  if (before === null) throw new Error('Link owner token balance is unavailable.');
  return execute(input, Object.freeze({ kind: 'cleanup', ...payer,
    tokenCodeHash: saved.fill?.requestCodeHash ?? material.offerCodeHash, beforeBalance: before.toString() }), saved.active ? input.creationId : undefined);
};
export const retryLinkTradeV2OwnerAction = async (input: ActionInput & { actionId: string }) => {
  const binding = await scope(input), saved = await input.journal.read(), action = saved?.ownerAction;
  if (!saved || saved.id !== input.actionId || saved.active || !action || !['rejected', 'failed'].includes(saved.records[saved.records.length - 1]?.state ?? '') ||
      saved.scope.owner !== binding.ownerAddress.toLowerCase() || saved.scope.escrow !== input.deployment.contractAddress ||
      saved.scope.chainId !== input.deployment.chainId ||
      saved.scope.runtimeHash !== input.deployment.runtimeBytecodeHash) throw new Error('Only a reconciled failed request can start a new owner action.');
  const before = await readLinkTradeV2Balance(binding, action);
  if (before === null) throw new Error('Link owner token balance is unavailable.');
  return execute(input, Object.freeze({ ...action, beforeBalance: before.toString() }));
};
export const reconcileLinkTradeV2OwnerAction = async (input: ActionInput & { transactionHash?: string }) => {
  const binding = await scope(input), saved = await input.journal.read(), action = saved?.ownerAction;
  if (!saved || !action || saved.scope.owner !== binding.ownerAddress.toLowerCase() || saved.scope.escrow !== input.deployment.contractAddress ||
      saved.scope.chainId !== input.deployment.chainId ||
      saved.scope.runtimeHash !== input.deployment.runtimeBytecodeHash) throw new Error('Saved Link owner action is unavailable.');
  const original = saved.records[saved.records.length - 1];
  if (original?.step !== action.kind || !['sending', 'submitted', 'confirmed', 'failed'].includes(original.state)) throw new Error('Link owner submission needs reconciliation. Do not resend.');
  if (original.state === 'failed') return undefined;
  const found = await findLinkTradeV2Transaction(binding.readProvider!, original, input.journal, input.transactionHash);
  if (!found) return null;
  const { record, receipt } = found;
  await tokenCurrent(binding, action);
  let result: LinkTradeV2OwnerResult | undefined;
  await confirmLinkTradeV2Transaction(binding, record, receipt,
    original.state === 'confirmed' ? async () => {} : input.journal.onPending,
    async value => { result = await account(input, binding, action, value, original.state === 'confirmed'); }, async () => {
      if (record.mined?.outcome === 'reverted') return;
      if (await readLinkTradeV2Balance(binding, action) !== BigInt(action.beforeBalance)) throw new Error('The replaced owner balance changed. Keep the action on hold.');
      if (action.kind === 'cancel') {
        const current = await order(input, binding, action.orderId!);
        if (!current || current.status !== 1 || current.offerToken !== action.offerToken || current.privatePair !== action.privatePair ||
            current.tokenCodeHash !== action.tokenCodeHash) throw new Error('The replaced Link order needs refund reconciliation.');
      }
    });
  return result;
};
