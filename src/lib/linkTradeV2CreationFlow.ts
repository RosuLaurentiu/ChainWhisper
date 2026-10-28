import { Interface, keccak256 } from '@coti-io/coti-ethers';
import { LINK_TRADE_V2_ABI } from './linkTradeV2Abi';
import { findLinkTradeV2Transaction } from './linkTradeV2TransactionRecovery';
import { PRIVATE_ERC20_TOKEN_VNEXT_ABI } from './appShared/core';
import { readPrivateTokenAllowanceWei, readPrivateTokenBalanceWei, resolvePrivateTokenAllowanceWritePlan } from './appChain';
import { captureWalletActionIntent, readWalletActionIntent } from './walletActionIntent';
import { resolveBoundTransactionChain } from './boundTransactionChain';
import { encryptPrivateUint256Input } from './privateUint256';
import { normalizeLinkTradeV2Terms, type LinkTradeV2Terms } from './linkTradeV2Terms';
import { parseLinkTradeV2Path } from './linkTradeV2Links';
import { prepareLinkTradeV2Create, prepareLinkTradeV2CreateRecovery, recheckLinkTradeV2Create, parseLinkTradeV2CreationReceipt,
  bindLinkTradeV2CreationReceipt, readLinkTradeV2Review, type LinkTradeV2Deployment } from './linkTradeV2';
import { assertOwnerTradeV2CapabilityCurrent, assertOwnerTradeV2CapabilitySnapshotCurrent,
  getOwnerTradeV2CapabilityBinding, waitForOwnerTradeV2Receipt, type OwnerTradeV2MetaMaskCapability } from './ownerTradeV2Capability';
import { assertAttestedTradeHistoryV2Deployment, readAttestedTradeHistoryV2View, type TradeHistoryV2ReadCapability } from './tradeHistoryV2Chain';
import { normalizeLinkTradeV2CreationRecovery, type LinkTradeV2CreationRecovery,
  type createLinkTradeV2CreationJournal } from './linkTradeV2CreationJournal';

const TOKEN = new Interface(['function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)',
  'event Transfer(address indexed from,address indexed to,uint256 value)']);
const PRIVATE_TOKEN = new Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI);
export type LinkTradeV2CreationAction = Readonly<{ terms: LinkTradeV2Terms; offerBudget: string }>;
export type LinkTradeV2CreationRecord = Readonly<{
  step: 'authorize' | 'approval-reset' | 'approval' | 'create' | 'replace' | 'fill' | 'cancel' | 'reclaim-expired' | 'withdraw-native-credit' | 'budget-visibility' | 'cleanup' | 'accept' | 'decline' | 'consent' | 'balance-snapshot'; state: 'sending' | 'submitted' | 'confirmed' | 'rejected' | 'failed';
  chainId: string; owner: string; to: string; nonce: number; dataHash: string;
  gasLimit: string; gasPrice: string; value?: string; transactionHash?: string; gasUsed?: string; feeWei?: string;
  blockNumber?: string; blockHash?: string;
  admission?: Readonly<{ number: string; hash: string }>;
  search?: Readonly<{ throughBlock: string; blockHash: string; headBlock: string }>;
  mined?: Readonly<{ transactionHash: string; to: string | null; dataHash: string; value: string; gasLimit: string; gasPrice: string;
    outcome?: 'cancelled' | 'replaced' | 'reverted' }>;
}>;
export type LinkTradeV2CreationJournal = Readonly<{
  assertNoPending: () => Promise<void>;
  onRecovery: (material: LinkTradeV2CreationRecovery) => Promise<void>;
  releaseUnsent: () => Promise<void>;
  onPending: (record: LinkTradeV2CreationRecord) => Promise<void>;
}>;
export type LinkTradeV2CreationRecoveryJournal = LinkTradeV2CreationJournal & Pick<ReturnType<typeof createLinkTradeV2CreationJournal>, 'read' | 'beginOwnerAction' | 'finishCleanup' | 'advanceSearch' | 'beginFill'> & Partial<Pick<ReturnType<typeof createLinkTradeV2CreationJournal>, 'forDisclosure' | 'close'>>;
const uint = (value: unknown): bigint => {
  if (!(typeof value === 'bigint' && value >= 0n) && !(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) &&
      !(typeof value === 'string' && /^(0|[1-9][0-9]*|0x[0-9a-fA-F]+)$/.test(value))) throw new Error('Invalid Link transaction integer.');
  return BigInt(value as bigint);
};
const lower = (v: unknown) => typeof v === 'string' ? v.toLowerCase() : '';
const hash = (value: unknown) => {
  const result = lower(value);
  if (!/^0x[0-9a-f]{64}$/.test(result) || BigInt(result) === 0n) throw new Error('Invalid Link transaction hash.');
  return result;
};
type Binding = ReturnType<typeof getOwnerTradeV2CapabilityBinding>;
type ReadContext = { readCapability: TradeHistoryV2ReadCapability; deployment: LinkTradeV2Deployment };
const assertTransaction = (binding: Binding, record: LinkTradeV2CreationRecord, tx: unknown) => {
  if (!tx || typeof tx !== 'object') throw new Error('The submitted Link transaction is unavailable.');
  const v = tx as Record<string, unknown>;
  const call = record.mined ?? record;
  if (hash(v.hash) !== call.transactionHash || lower(v.from) !== record.owner || lower(v.to) !== lower(call.to) ||
      typeof v.data !== 'string' || keccak256(v.data) !== call.dataHash || uint(v.value) !== BigInt(record.mined?.value ?? record.value ?? '0') ||
      uint(v.nonce) !== BigInt(record.nonce) || uint(v.gasLimit) !== BigInt(call.gasLimit) ||
      (record.mined && v.maxFeePerGas != null ? uint(v.maxFeePerGas) < BigInt(call.gasPrice) : uint(v.gasPrice) !== BigInt(call.gasPrice)) ||
      resolveBoundTransactionChain(v.chainId, binding.chainId, 'Link') !== binding.chainId) throw new Error('Submitted Link transaction differs from the reviewed call.');
};
export const confirmLinkTradeV2Transaction = async (binding: Binding, record: LinkTradeV2CreationRecord, receipt: unknown,
  onPending: LinkTradeV2CreationJournal['onPending'], complete: (receipt: unknown) => Promise<void>, resolveFailure?: () => Promise<void>) => {
  const provider = binding.readProvider;
  if (!provider) throw new Error('Independent Link chain access is unavailable.');
  const r = receipt as Record<string, unknown>;
  const call = record.mined ?? record;
  if (!r || uint(r.status) > 1n || hash(r.hash ?? r.transactionHash) !== call.transactionHash ||
      lower(r.from) !== record.owner || lower(r.to) !== lower(call.to)) throw new Error('Link transaction did not confirm successfully.');
  const receiptBlock = Number(uint(r.blockNumber));
  if (!Number.isSafeInteger(receiptBlock)) throw new Error('Link receipt block number is invalid.');
  const canonical = await provider.getBlock(receiptBlock);
  if (record.blockHash && (hash(r.blockHash) !== record.blockHash || uint(r.blockNumber).toString() !== record.blockNumber)) {
    throw new Error('Saved Link receipt block changed. Keep the operation on hold.');
  }
  if (!canonical || lower(canonical.hash) !== hash(r.blockHash) || !canonical.transactions.some(v => lower(v) === call.transactionHash)) {
    throw new Error('Link receipt inclusion is not canonical. Keep the saved hash; do not resend.');
  }
  assertTransaction(binding, record, await provider.getTransaction(call.transactionHash!));
  if (record.mined) {
    const sameCall = record.mined.to === record.to && record.mined.dataHash === record.dataHash && record.mined.value === (record.value ?? '0');
    const outcome = uint(r.status) === 0n ? 'reverted' : sameCall ? undefined
      : record.mined.to === record.owner && record.mined.value === '0' && record.mined.dataHash === keccak256('0x') ? 'cancelled' : 'replaced';
    if (record.mined.outcome !== outcome) throw new Error('Saved Link transaction outcome does not match its receipt.');
  }
  const gasUsed = uint(r.gasUsed), paidPrice = uint(r.gasPrice ?? r.effectiveGasPrice);
  if (gasUsed > BigInt(call.gasLimit) || paidPrice !== BigInt(call.gasPrice) ||
      (r.fee !== undefined && uint(r.fee) !== gasUsed * paidPrice) ||
      (record.gasUsed !== undefined && (BigInt(record.gasUsed) !== gasUsed || BigInt(record.feeWei!) !== gasUsed * paidPrice))) throw new Error('Link receipt fee accounting does not match the signed call.');
  const accounted = Object.freeze({ ...record, gasUsed: gasUsed.toString(), feeWei: (gasUsed * paidPrice).toString(),
    blockNumber: receiptBlock.toString(), blockHash: hash(r.blockHash) });
  await onPending(accounted);
  const failed = uint(r.status) === 0n || Boolean(record.mined?.outcome);
  if (failed && !resolveFailure) throw new Error('Link transaction reverted or was replaced. Its fee is retained; reconcile before another send.');
  await assertOwnerTradeV2CapabilityCurrent(binding);
  if (failed) await resolveFailure!();
  else await complete(receipt);
  const finalBlock = await provider.getBlock(receiptBlock);
  if (!finalBlock || lower(finalBlock.hash) !== hash(r.blockHash)) throw new Error('Link receipt was reorganized during accounting. Keep the saved hash; do not resend.');
  await onPending(Object.freeze({ ...accounted, state: failed ? 'failed' : 'confirmed' }));
};
const publicRead = async (binding: Binding, token: string, name: string, args: readonly unknown[]) => {
  if (!binding.readProvider) throw new Error('Independent Link chain access is unavailable.');
  const raw = await binding.readProvider.call({ to: token, data: TOKEN.encodeFunctionData(name, args) });
  const decoded = TOKEN.decodeFunctionResult(name, raw);
  if (TOKEN.encodeFunctionResult(name, decoded).toLowerCase() !== raw.toLowerCase()) throw new Error('Invalid Link token response.');
  return uint(decoded[0]);
};
export const readLinkTradeV2Balance = (binding: Binding, terms: Pick<LinkTradeV2Terms, 'offerToken' | 'privatePair'>) => terms.privatePair
  ? readPrivateTokenBalanceWei(terms.offerToken, binding.ownerAddress, binding.signer, false)
  : publicRead(binding, terms.offerToken, 'balanceOf', [binding.ownerAddress]);
export const readLinkTradeV2Allowance = (binding: Binding, terms: Pick<LinkTradeV2Terms, 'offerToken' | 'privatePair'>, escrow: string) => terms.privatePair
  ? readPrivateTokenAllowanceWei(terms.offerToken, binding.ownerAddress, escrow, binding.signer, false)
  : publicRead(binding, terms.offerToken, 'allowance', [binding.ownerAddress, escrow]);
/** Creation and fill use the same exact allowance sequence. The caller admits and journals each send. */
export const ensureLinkTradeV2Allowance = async (binding: Binding, terms: Pick<LinkTradeV2Terms, 'offerToken' | 'privatePair'>,
  escrow: string, budget: bigint, send: (step: LinkTradeV2CreationRecord['step'], to: string, data: string, complete: () => Promise<void>) => Promise<unknown>) => {
  const allowance = () => readLinkTradeV2Allowance(binding, terms, escrow);
  const currentAllowance = await allowance();
  if (currentAllowance === null) throw new Error('Link allowance is unavailable.');
  if (currentAllowance === budget) return;
  if (terms.privatePair) {
    const plan = resolvePrivateTokenAllowanceWritePlan(currentAllowance, budget, 'exact');
    const selector = PRIVATE_TOKEN.getFunction(plan.selectorSignature)!.selector;
    const encrypted = await encryptPrivateUint256Input(binding.signer, plan.amountWei, terms.offerToken, selector);
    await send('approval', terms.offerToken, PRIVATE_TOKEN.encodeFunctionData(plan.selectorSignature, [escrow, encrypted]), async () => {
      if (await allowance() !== budget) throw new Error('Private Link allowance does not match the reviewed budget.');
    });
  } else {
    if (currentAllowance !== 0n) await send('approval-reset', terms.offerToken, TOKEN.encodeFunctionData('approve', [escrow, 0n]), async () => {
      if (await allowance() !== 0n) throw new Error('Public Link allowance reset did not confirm.');
    });
    if (budget === 0n) return;
    await send('approval', terms.offerToken, TOKEN.encodeFunctionData('approve', [escrow, budget]), async () => {
      if (await allowance() !== budget) throw new Error('Public Link allowance does not match the reviewed budget.');
    });
  }
};
const accountCreation = async (input: ReadContext, binding: Binding, material: LinkTradeV2CreationRecovery,
  created: ReturnType<typeof parseLinkTradeV2CreationReceipt>, receipt: unknown) => {
  const link = parseLinkTradeV2Path(created.sharePath);
  if (!link?.secret) throw new Error('Confirmed Link reference is invalid.');
  const review = await readLinkTradeV2Review({ capability: input.readCapability, deployment: input.deployment,
    reference: created.reference, secret: link.secret });
  if (JSON.stringify(review.terms) !== JSON.stringify(material.terms)) throw new Error('Created Link terms differ from review.');
  const after = await readLinkTradeV2Balance(binding, material.terms), budget = BigInt(material.offerBudget);
  if (after === null || BigInt(material.beforeBalance) - after !== budget) throw new Error('Link owner debit is not exactly accounted. Keep the saved hash; do not recreate.');
  if (!material.terms.privatePair) {
    const r = receipt as { logs: Array<{ address: string; data: string; topics: string[] }> };
    const transfers = r.logs.filter(log => lower(log.address) === material.terms.offerToken && lower(log.topics[0]) === TOKEN.getEvent('Transfer')!.topicHash);
    if (transfers.length !== 1) throw new Error('Public Link custody receipt is not exact.');
    const event = TOKEN.decodeEventLog('Transfer', transfers[0].data, transfers[0].topics);
    if (lower(event.from) !== material.context.maker || lower(event.to) !== material.context.escrow || event.value !== budget) throw new Error('Public Link custody amount differs from the reviewed budget.');
  }
};

/** Run inside the existing owner transaction queue; the journal must save before signing and polling. */
type CreationInput = {
  readCapability: TradeHistoryV2ReadCapability; deployment: LinkTradeV2Deployment;
  capability: OwnerTradeV2MetaMaskCapability; ownerAddress: string; action: LinkTradeV2CreationAction;
} & LinkTradeV2CreationJournal;
export const sendLinkTradeV2Transaction = async ({ binding, step, to, data, value = 0n, onPending, admit, complete }: {
  binding: Binding; step: LinkTradeV2CreationRecord['step']; to: string; data: string; value?: bigint;
  onPending: LinkTradeV2CreationJournal['onPending']; admit: (timestamp: bigint) => void | Promise<void>;
  complete: (receipt: unknown) => Promise<void>;
}) => {
  const provider = binding.readProvider, owner = binding.ownerAddress.toLowerCase();
  const nativeValue = uint(value);
  if (!provider) throw new Error('Independent Link chain access is unavailable.');
  await assertOwnerTradeV2CapabilityCurrent(binding);
  const block = await provider.getBlock('latest');
  if (!block) throw new Error('Fresh Link block data is unavailable.');
  await admit(uint(block.timestamp));
  let estimate: bigint;
  try { estimate = uint(await provider.estimateGas({ from: owner, to, data, value: nativeValue })); }
  catch { throw new Error('Link gas estimation failed. Nothing was sent for this step.'); }
  const gasLimit = (estimate * 125n + 99n) / 100n;
  if (estimate === 0n || gasLimit * 10n > uint(block.gasLimit) * 9n) throw new Error('Link transaction does not fit with gas headroom.');
  const gasPrice = (await provider.getFeeData()).gasPrice;
  if (gasPrice === null || gasPrice <= 0n || await provider.getBalance(owner) < nativeValue + gasLimit * gasPrice) throw new Error('Link signing fee or native balance is unavailable.');
  const nonce = await provider.getTransactionCount(owner, 'pending');
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error('Fresh Link nonce is invalid.');
  const record: LinkTradeV2CreationRecord = Object.freeze({ step, state: 'sending', chainId: binding.chainId.toString(),
    owner, to, nonce, dataHash: keccak256(data), gasLimit: gasLimit.toString(), gasPrice: gasPrice.toString(), ...(nativeValue !== 0n ? { value: nativeValue.toString() } : {}),
    admission: Object.freeze({ number: uint(block.number).toString(), hash: hash(block.hash) }) });
  await onPending(record);
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  let transaction;
  try { transaction = await binding.signer.sendTransaction({ to, data, value: nativeValue, gasLimit, gasPrice, nonce }); }
  catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 4001 || code === 'ACTION_REJECTED') {
      await onPending(Object.freeze({ ...record, state: 'rejected' })); throw error;
    }
    throw new Error('Link submission is uncertain. Reconcile the saved operation before another send.');
  }
  const transactionHash = hash(transaction.hash), submitted = Object.freeze({ ...record, state: 'submitted' as const, transactionHash });
  try { await onPending(submitted); }
  catch { throw Object.assign(new Error('Link transaction was sent, but its hash could not be saved. Do not resend.'), { transactionHash }); }
  assertTransaction(binding, submitted, transaction);
  const receipt = await waitForOwnerTradeV2Receipt(binding, transactionHash);
  await confirmLinkTradeV2Transaction(binding, submitted, receipt, onPending, complete);
  return receipt;
};
export const executeLinkTradeV2Creation = (input: CreationInput) => runCreation(input);

const runCreation = async (input: CreationInput, recovery?: LinkTradeV2CreationRecovery) => {
  assertAttestedTradeHistoryV2Deployment(input.deployment, 'link-v2');
  const action = readWalletActionIntent(captureWalletActionIntent(input.action));
  const terms = normalizeLinkTradeV2Terms(action.terms), budget = uint(action.offerBudget);
  if (budget === 0n || budget >= (1n << 128n)) throw new Error('Link budget must be a positive uint128.');
  const binding = getOwnerTradeV2CapabilityBinding(input.capability), provider = binding.readProvider;
  await assertOwnerTradeV2CapabilityCurrent(binding);
  if (binding.ownerAddress.toLowerCase() !== input.ownerAddress.toLowerCase()) throw new Error('Link creation wallet changed after review.');
  if (!provider || binding.chainId.toString() !== input.deployment.chainId ||
      (await provider.getNetwork()).chainId !== binding.chainId) throw new Error('Independent Link chain access is unavailable.');
  const escrow = input.deployment.contractAddress;
  const before = await readLinkTradeV2Balance(binding, terms);
  if (before === null || before < budget) throw new Error('The Link offer balance is unavailable or too small.');
  if (recovery && before.toString() !== recovery.beforeBalance) throw new Error('The saved Link balance changed. Reconcile before continuing.');
  let claimed = false;
  let material: LinkTradeV2CreationRecovery | undefined;
  try {
    const onRecovery = async (value: Omit<LinkTradeV2CreationRecovery, 'beforeBalance'>) => {
      if (!recovery) { await input.assertNoPending(); claimed = true; }
      material = Object.freeze({ ...value, beforeBalance: before.toString() });
      await input.onRecovery(material);
    };
    const prepared = recovery ? await prepareLinkTradeV2CreateRecovery({ ...input, material: recovery, onRecovery })
      : await prepareLinkTradeV2Create({ ...input, terms, offerBudget: budget.toString(), onRecovery });
    if ((!claimed && !recovery) || !material) throw new Error('Unsigned Link recovery was not saved.');

    const send = (step: LinkTradeV2CreationRecord['step'], to: string, data: string, complete: (receipt: unknown) => Promise<void>) =>
      sendLinkTradeV2Transaction({ binding, step, to, data, complete, onPending: input.onPending, admit: async timestamp => {
        const expiry = BigInt(terms.expiresAt);
        if (expiry !== 0n && (expiry <= timestamp || expiry > timestamp + 2592000n)) throw new Error('Link expiry is outside its current 30-day window.');
        if (!material || keccak256(await provider.getCode(terms.offerToken)) !== material.offerCodeHash) throw new Error('Link offer-token code changed before signing.');
        if (terms.privatePair) {
          const raw = await provider.call({ to: terms.offerToken, data: PRIVATE_TOKEN.encodeFunctionData('publicAmountsEnabled') });
          if (raw.toLowerCase() !== PRIVATE_TOKEN.encodeFunctionResult('publicAmountsEnabled', [false])) throw new Error('Link private-token amounts are not private.');
        }
      } });

    await ensureLinkTradeV2Allowance(binding, terms, escrow, budget, send);
    await recheckLinkTradeV2Create(prepared);
    let result: ReturnType<typeof parseLinkTradeV2CreationReceipt> | undefined;
    await send('create', escrow, prepared.data, async receipt => {
      const r = receipt as Record<string, unknown>;
      const created = parseLinkTradeV2CreationReceipt({ prepared, transactionHash: hash(r.hash ?? r.transactionHash), receipt });
      if (!material) throw new Error('Unsigned Link recovery was not saved.');
      await accountCreation(input, binding, material, created, receipt);
      result = created;
    });
    if (!result) throw new Error('Link creation remains pending reconciliation.');
    return result;
  } catch (error) {
    // Only a creation with no reserved send can release its lock.
    if (claimed) await input.releaseUnsent();
    throw error;
  }
};

/** Recover the reserved nonce without another send. Business-state failures keep the lock. */
export const reconcileLinkTradeV2Creation = async (input: ReadContext & {
  capability: OwnerTradeV2MetaMaskCapability; journal: LinkTradeV2CreationRecoveryJournal; transactionHash?: string;
}) => {
  assertAttestedTradeHistoryV2Deployment(input.deployment, 'link-v2');
  const saved = await input.journal.read();
  if (!saved?.recovery) throw new Error('Saved Link recovery is unavailable. Do not recreate.');
  const material = normalizeLinkTradeV2CreationRecovery(saved.recovery);
  const binding = getOwnerTradeV2CapabilityBinding(input.capability), provider = binding.readProvider;
  await assertOwnerTradeV2CapabilityCurrent(binding);
  if (!provider || material.context.chainId !== binding.chainId.toString() || material.context.maker !== binding.ownerAddress.toLowerCase() ||
      material.context.escrow !== input.deployment.contractAddress || saved.scope.runtimeHash !== input.deployment.runtimeBytecodeHash ||
      input.deployment.chainId !== material.context.chainId || (await provider.getNetwork()).chainId !== binding.chainId) {
    throw new Error('Saved Link recovery does not match the current owner and deployment.');
  }
  const original = saved.records[saved.records.length - 1];
  if (!original || original.state === 'rejected') throw new Error('Link submission needs reconciliation. Do not resend.');
  if (original.state === 'failed') return undefined;
  const found = await findLinkTradeV2Transaction(provider, original, input.journal, input.transactionHash);
  if (!found) return null;
  const { record, receipt } = found;
  let result: ReturnType<typeof parseLinkTradeV2CreationReceipt> | undefined;
  const complete = async (r: unknown) => {
    if (record.step !== 'create') {
      if (await readLinkTradeV2Allowance(binding, material.terms, material.context.escrow) !== (record.step === 'approval-reset' ? 0n : BigInt(material.offerBudget))) {
        throw new Error('Recovered Link allowance does not match the reviewed budget.');
      }
      return;
    }
    result = bindLinkTradeV2CreationReceipt({ material, transactionHash: record.mined!.transactionHash, receipt: r });
    if (original.state !== 'confirmed') await accountCreation(input, binding, material, result, r);
  };
  // A confirmed record can be checked again without rewriting its retained fee.
  const retain = original.state === 'confirmed' ? async () => undefined : input.journal.onPending;
  await confirmLinkTradeV2Transaction(binding, record, receipt, retain, complete, async () => {
    const abi = new Interface(LINK_TRADE_V2_ABI);
    const raw = await readAttestedTradeHistoryV2View({ capability: input.readCapability, deployment: input.deployment,
      data: abi.encodeFunctionData('usedMakerNonce', [material.context.maker, material.context.makerNonce]) });
    if (raw.toLowerCase() !== abi.encodeFunctionResult('usedMakerNonce', [false])) throw new Error('The Link maker nonce was used. Keep the creation on hold.');
    if (record.mined?.outcome !== 'reverted' && await readLinkTradeV2Balance(binding, material.terms) !== BigInt(material.beforeBalance)) {
      throw new Error('The replaced Link balance changed. Keep the creation on hold.');
    }
  });
  return result;
};

/** Continue only this active journal after earlier calls confirm. Keep the same trade and maker nonce. */
export const continueLinkTradeV2Creation = async (input: ReadContext & {
  capability: OwnerTradeV2MetaMaskCapability; journal: LinkTradeV2CreationRecoveryJournal; creationId: string;
}) => {
  const saved = await input.journal.read();
  if (!saved?.active || saved.id !== input.creationId || !saved.recovery ||
      saved.records.some(r => r.state !== 'confirmed' || r.step === 'create')) {
    throw new Error('This Link creation is not ready to continue. Check its saved transactions first.');
  }
  const material = normalizeLinkTradeV2CreationRecovery(saved.recovery);
  if (saved.scope.runtimeHash !== input.deployment.runtimeBytecodeHash || material.context.escrow !== input.deployment.contractAddress) {
    throw new Error('Link recovery deployment changed.');
  }
  return runCreation({ ...input, ownerAddress: material.context.maker, action: { terms: material.terms, offerBudget: material.offerBudget },
    ...input.journal }, material);
};
