import { Interface, keccak256 } from '@coti-io/coti-ethers';
import { COUNTER_TRADE_V2_ABI } from './counterTradeV2Abi';
import { LINK_TRADE_V2_ABI } from './linkTradeV2Abi';
import { PRIVATE_ERC20_TOKEN_VNEXT_ABI } from './appShared/core';
import { assertCounterTradeV2ModeAdmission, reviewCounterTradeV2Proposal, prepareCounterTradeV2Proposal, recheckCounterTradeV2Proposal, readCounterTradeV2Proposal,
  counterTradeV2RootKey, counterTradeV2MaterialOf, prepareCounterTradeV2Acceptance, recheckCounterTradeV2Acceptance, readCounterTradeV2View, counterTradeV2ParentDeployment, readCounterTradeV2RootRefund,
  type CounterTradeV2Context, type CounterTradeV2Amounts, type CounterTradeV2Material, type CounterTradeV2Proposal, type CounterTradeV2Parent } from './counterTradeV2';
import { readLinkTradeV2Review, prepareLinkTradeV2CounterAuthorization } from './linkTradeV2';
import { normalizeCounterTradeV2Recovery, type CounterTradeV2Recovery, type createLinkTradeV2CreationJournal } from './linkTradeV2CreationJournal';
import { sendLinkTradeV2Transaction, confirmLinkTradeV2Transaction, ensureLinkTradeV2Allowance, readLinkTradeV2Balance,
  readLinkTradeV2Allowance, type LinkTradeV2CreationRecord } from './linkTradeV2CreationFlow';
import { getOwnerTradeV2CapabilityBinding, assertOwnerTradeV2CapabilityCurrent } from './ownerTradeV2Capability';
import { readLinkTradeV2ReceiptEvents } from './linkTradeV2OwnerActions';
import { encryptPrivateUint256Input, decryptPrivateUint256Output } from './privateUint256';
import { findLinkTradeV2Transaction } from './linkTradeV2TransactionRecovery';

const ABI = new Interface(COUNTER_TRADE_V2_ABI), LINK = new Interface(LINK_TRADE_V2_ABI), PRIVATE = new Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI);
const BOOK = new Interface(['event PrivateOrderStatusChanged(uint256 indexed orderId,address indexed maker,uint8 previousStatus,uint8 nextStatus,address actor,uint256 relatedOrderId,uint64 revision)',
  'event CounterParentSettled(uint256 indexed id,uint256 indexed selectedCounter)']);
const STANDARD = new Interface(['event StandardTradeStatusChanged(uint256 indexed tradeId,address indexed maker,uint8 previousStatus,uint8 nextStatus,address actor,uint256 relatedTradeId,uint64 revision)',
  'event CounterParentSettled(uint256 indexed id,uint256 indexed selectedCounter)']);
const PUBLIC = new Interface(['function approve(address,uint256) returns(bool)', 'event Transfer(address indexed from,address indexed to,uint256 value)']);
const TRANSFER = new Interface(['event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
type Journal = ReturnType<typeof createLinkTradeV2CreationJournal>;
type Input = CounterTradeV2Context & { journal: Journal };
type Binding = ReturnType<typeof getOwnerTradeV2CapabilityBinding>;
export type CounterTradeV2Result = Readonly<{ kind: CounterTradeV2Recovery['kind']; proposalId?: string; transactionHash?: string;
  offerToken: string; requestToken: string; privatePair: boolean; offer: string; request: string; refund: string; payment?: string; received?: string }>;
const token = (m: CounterTradeV2Material) => ({ offerToken: m.offerToken, privatePair: m.privatePair });
const payingToken = (r: CounterTradeV2Recovery) => ({ offerToken: r.kind === 'accept' || r.cleanupToken === 'request' ? r.material.requestToken : r.material.offerToken, privatePair: r.material.privatePair });
const cleanupRecovery = (r: CounterTradeV2Recovery, beforeBalance: string): CounterTradeV2Recovery => ({ kind: 'cleanup', material: r.material, beforeBalance,
  ...(r.kind === 'accept' || r.cleanupToken === 'request' ? { cleanupToken: 'request' as const } : {}) });
const scope = async (input: Input) => {
  const binding = getOwnerTradeV2CapabilityBinding(input.capability);
  await assertOwnerTradeV2CapabilityCurrent(binding);
  if (!binding.readProvider || binding.chainId.toString() !== input.deployment.chainId ||
      (await binding.readProvider.getNetwork()).chainId !== binding.chainId) throw new Error('Independent counter chain access is unavailable.');
  return binding;
};
const currentTokens = async (binding: Binding, m: CounterTradeV2Material, funding: boolean) => {
  for (const [address, codeHash] of funding ? [[m.offerToken, m.offerCodeHash], [m.requestToken, m.requestCodeHash]] : [[m.offerToken, m.offerCodeHash]]) {
    if (keccak256(await binding.readProvider!.getCode(address)) !== codeHash) throw new Error('Counter token code changed.');
    if (funding && m.privatePair) {
      const raw = await binding.readProvider!.call({ to: address, data: PRIVATE.encodeFunctionData('publicAmountsEnabled') });
      if (raw.toLowerCase() !== PRIVATE.encodeFunctionResult('publicAmountsEnabled', [false])) throw new Error('Counter token amounts are not private.');
    }
  }
};
const receiptTransfer = (binding: Binding, input: Input, r: CounterTradeV2Recovery, receipt: unknown, refund: boolean) => {
  const logs = readLinkTradeV2ReceiptEvents(receipt, r.material.offerToken, r.material.privatePair ? TRANSFER : PUBLIC, 'Transfer');
  const owner = binding.ownerAddress.toLowerCase(), escrow = input.deployment.contractAddress;
  if (logs.length !== 1 || logs[0].from.toLowerCase() !== (refund ? escrow : owner) || logs[0].to.toLowerCase() !== (refund ? owner : escrow)) throw new Error('Counter token transfer path is not exact.');
  const amount = r.material.privatePair ? decryptPrivateUint256Output(binding.signer, logs[0][refund ? 'receiverValue' : 'senderValue']) : BigInt(logs[0].value);
  if (amount !== BigInt(r.material.offer)) throw new Error('Counter debit or refund differs from the reviewed amount.');
  return amount;
};
const account = async (input: Input, binding: Binding, recovery: CounterTradeV2Recovery, receipt: unknown, confirmed = false): Promise<CounterTradeV2Result> => {
  if (recovery.kind === 'accept') return accountAcceptance(input, binding, recovery, receipt, confirmed);
  if (recovery.kind === 'decline') return accountDecline(input, binding, recovery, receipt, confirmed);
  const m = recovery.material, escrow = input.deployment.contractAddress;
  let proposalId = recovery.proposalId, refund = 0n;
  if (recovery.kind === 'create') {
    const rows = readLinkTradeV2ReceiptEvents(receipt, escrow, ABI, 'CounterOpened');
    const e = rows[0];
    if (rows.length !== 1 || e.id === 0n || e.maker.toLowerCase() !== m.maker || e.taker.toLowerCase() !== m.taker || e.rootKey !== counterTradeV2RootKey(m.root) ||
        e.parentProposal.toString() !== m.parentProposal || Number(e.depth) !== m.depth || e.offerToken.toLowerCase() !== m.offerToken ||
        e.requestToken.toLowerCase() !== m.requestToken || e.privatePair !== m.privatePair || e.expiresAt.toString() !== m.expiresAt ||
        e.publicOffer !== (m.privatePair ? 0n : BigInt(m.offer)) || e.publicRequest !== (m.privatePair ? 0n : BigInt(m.request))) throw new Error('Counter receipt differs from the reviewed proposal.');
    proposalId = e.id.toString();
    const roots = readLinkTradeV2ReceiptEvents(receipt, escrow, ABI, 'CounterRootBound');
    if (m.parentProposal === '0' ? roots.length !== 1 || roots[0].rootKey !== counterTradeV2RootKey(m.root) || roots[0].chainId.toString() !== m.root.chainId ||
        roots[0].parent.toLowerCase() !== m.root.escrow || roots[0].parentId.toString() !== m.root.id || roots[0].revision.toString() !== m.root.revision || roots[0].credentialEpoch.toString() !== m.root.credentialEpoch : roots.length !== 0) throw new Error('Counter receipt has a different root.');
    const terms = readLinkTradeV2ReceiptEvents(receipt, escrow, ABI, 'CounterPrivateTerms');
    if (m.privatePair) {
      const own = terms.filter(t => t.recipient.toLowerCase() === m.maker);
      if (terms.length !== 2 || own.length !== 1 || terms.filter(t => t.recipient.toLowerCase() === m.taker).length !== 1 ||
          terms.some(t => t.id.toString() !== proposalId) || decryptPrivateUint256Output(binding.signer, own[0].offer.userCiphertext) !== BigInt(m.offer) ||
          decryptPrivateUint256Output(binding.signer, own[0].request.userCiphertext) !== BigInt(m.request)) throw new Error('Counter private terms or recipients differ.');
    } else if (terms.length) throw new Error('Public counter has unexpected private terms.');
    receiptTransfer(binding, input, recovery, receipt, false);
  } else if (recovery.kind === 'cancel') {
    const rows = readLinkTradeV2ReceiptEvents(receipt, escrow, ABI, 'CounterClosed');
    if (rows.length !== 1 || rows[0].id.toString() !== proposalId || rows[0].status !== 3n || rows[0].actor.toLowerCase() !== m.maker) throw new Error('Counter refund receipt does not match.');
    refund = receiptTransfer(binding, input, recovery, receipt, true);
  }
  if (!confirmed) {
    if (recovery.kind === 'cleanup') {
      if (await readLinkTradeV2Allowance(binding, payingToken(recovery), escrow) !== 0n) throw new Error('Counter allowance did not clear.');
    } else {
      const current = await readCounterTradeV2Proposal({ ...input, proposalId: proposalId! });
      const { id: _id, status, effectiveStatus: _effective, offerLocked, ...material } = current; void _id; void _effective;
      if (JSON.stringify(material) !== JSON.stringify(m) || status !== (recovery.kind === 'create' ? 1 : 3) || offerLocked !== (recovery.kind === 'create')) throw new Error('Counter state differs from its receipt.');
    }
    const expected = BigInt(recovery.beforeBalance) + refund - (recovery.kind === 'create' ? BigInt(m.offer) : 0n);
    if (await readLinkTradeV2Balance(binding, recovery.kind === 'cleanup' ? payingToken(recovery) : token(m)) !== expected) throw new Error('Counter wallet debit or refund is not exactly accounted. Keep the saved transaction.');
  }
  const r = receipt as { hash?: string; transactionHash?: string };
  return Object.freeze({ kind: recovery.kind, proposalId, transactionHash: r.hash ?? r.transactionHash, offerToken: m.offerToken,
    requestToken: m.requestToken, privatePair: m.privatePair, offer: m.offer, request: m.request, refund: refund.toString() });
};
const resultFor = (r: CounterTradeV2Recovery, receipt: unknown, refund: bigint, payment?: bigint, received?: bigint): CounterTradeV2Result => {
  const tx = receipt as { hash?: string; transactionHash?: string }, m = r.material;
  return Object.freeze({ kind: r.kind, proposalId: r.proposalId, transactionHash: tx.hash ?? tx.transactionHash,
    offerToken: m.offerToken, requestToken: m.requestToken, privatePair: m.privatePair, offer: m.offer, request: m.request, refund: refund.toString(),
    ...(payment === undefined ? {} : { payment: payment.toString(), received: received!.toString() }) });
};
const ownBalances = async (binding: Binding, r: Pick<CounterTradeV2Recovery, 'material'>) => Promise.all([
  readLinkTradeV2Balance(binding, token(r.material)),
  readLinkTradeV2Balance(binding, { offerToken: r.material.requestToken, privatePair: r.material.privatePair })
]);
const accountAcceptance = async (input: Input, binding: Binding, r: CounterTradeV2Recovery, receipt: unknown, confirmed: boolean) => {
  const m = r.material, escrow = input.deployment.contractAddress, owner = m.taker, ancestors = r.ancestors!;
  const closed = readLinkTradeV2ReceiptEvents(receipt, escrow, ABI, 'CounterClosed');
  const ids = [r.proposalId!, ...ancestors.map(a => a.id)];
  if (closed.length !== ids.length || closed.some((e, index) => e.id.toString() !== ids[index] || e.status !== (index === 0 ? 2n : 6n) || e.actor.toLowerCase() !== owner)) throw new Error('Counter selection or ancestor refunds do not match the reviewed chain.');
  const odd = m.depth % 2 === 1, rootMaker = odd ? m.taker : m.maker, rootToken = odd ? m.requestToken : m.offerToken;
  const parentProtocol = counterTradeV2ParentDeployment(input, m.root.escrow).protocol;
  const bookParent = parentProtocol === 'private-v2', standardParent = parentProtocol === 'standard-v2', parentAbi = standardParent ? STANDARD : bookParent ? BOOK : LINK;
  if (standardParent && r.rootRefund === undefined) throw new Error('Saved counter parent refund is unavailable. Keep the saved transaction.');
  const rootClosed = readLinkTradeV2ReceiptEvents(receipt, m.root.escrow, parentAbi, standardParent ? 'StandardTradeStatusChanged' : bookParent ? 'PrivateOrderStatusChanged' : 'LinkClosed');
  const closedRoot = rootClosed[0];
  const exactClosure = rootClosed.length === 1 && (standardParent
    ? closedRoot.tradeId.toString() === m.root.id && closedRoot.maker.toLowerCase() === rootMaker && closedRoot.previousStatus === 1n && closedRoot.nextStatus === 3n &&
      closedRoot.actor.toLowerCase() === escrow && closedRoot.relatedTradeId.toString() === m.root.id && closedRoot.revision === BigInt(m.root.revision)
    : bookParent ? closedRoot.orderId.toString() === m.root.id && closedRoot.maker.toLowerCase() === rootMaker && closedRoot.previousStatus === 1n && closedRoot.nextStatus === 3n &&
      closedRoot.actor.toLowerCase() === escrow && closedRoot.relatedOrderId.toString() === m.root.id && closedRoot.revision === BigInt(m.root.revision)
    : closedRoot.id.toString() === m.root.id && closedRoot.status === 2n && closedRoot.revision === BigInt(m.root.revision) + 1n);
  const rootSelected = readLinkTradeV2ReceiptEvents(receipt, m.root.escrow, parentAbi, 'CounterParentSettled');
  if (!exactClosure || rootSelected.length !== 1 || rootSelected[0].id.toString() !== m.root.id || rootSelected[0].selectedCounter.toString() !== r.proposalId) throw new Error('Counter did not settle its exact parent.');
  const expected = [
    { token: rootToken, from: m.root.escrow, to: rootMaker, amount: standardParent ? r.rootRefund : undefined, kind: 'refund' },
    ...ancestors.map(a => ({ token: a.offerToken, from: escrow, to: a.maker, amount: a.offer, kind: 'refund' })),
    { token: m.requestToken, from: owner, to: m.maker, amount: m.request, kind: 'payment' },
    { token: m.offerToken, from: escrow, to: owner, amount: m.offer, kind: 'delivery' }
  ];
  let refund = 0n, payment = 0n, received = 0n;
  for (const address of [m.offerToken, m.requestToken]) {
    const logs = readLinkTradeV2ReceiptEvents(receipt, address, m.privatePair ? TRANSFER : PUBLIC, 'Transfer'), paths = expected.filter(p => p.token === address);
    if (logs.length !== paths.length) throw new Error('Counter settlement token transfer count differs.');
    logs.forEach((event, index) => {
      const path = paths[index];
      if (event.from.toLowerCase() !== path.from || event.to.toLowerCase() !== path.to) throw new Error('Counter settlement token transfer path differs.');
      const own = path.from === owner || path.to === owner;
      // Foreign private refunds are enforced by the pinned contract; only their recipient can decrypt them.
      if (m.privatePair && !own) return;
      const amount = m.privatePair ? decryptPrivateUint256Output(binding.signer, event[path.to === owner ? 'receiverValue' : 'senderValue']) : BigInt(event.value);
      if (amount < 0n || amount >= (1n << 256n) || path.amount !== undefined && amount !== BigInt(path.amount)) throw new Error('Counter settlement amount differs from reviewed terms.');
      if (own && path.kind === 'refund') {
        if (address !== m.requestToken || path.to !== owner) throw new Error('Counter refund asset or recipient differs.');
        refund += amount;
      } else if (own && path.kind === 'payment') payment += amount;
      else if (own && path.kind === 'delivery') received += amount;
    });
  }
  if (payment !== BigInt(m.request) || received !== BigInt(m.offer)) throw new Error('Counter payment or delivery is not exact.');
  if (!confirmed) {
    const current = await readCounterTradeV2Proposal({ ...input, proposalId: r.proposalId! }), [winner] = await readCounterTradeV2View(input, 'winner', [counterTradeV2RootKey(m.root)]);
    if (current.status !== 2 || current.offerLocked || winner.toString() !== r.proposalId) throw new Error('Counter final state does not match selection.');
    const [offer, request] = await ownBalances(binding, r);
    if (offer !== BigInt(r.beforeBalance) + received || request !== BigInt(r.beforeRequestBalance!) + refund - payment) throw new Error('Counter wallet payment, delivery or refunds are not exactly accounted.');
  }
  return resultFor(r, receipt, refund, payment, received);
};
const accountDecline = async (input: Input, binding: Binding, r: CounterTradeV2Recovery, receipt: unknown, confirmed: boolean) => {
  const m = r.material, closed = readLinkTradeV2ReceiptEvents(receipt, input.deployment.contractAddress, ABI, 'CounterClosed');
  const transfers = readLinkTradeV2ReceiptEvents(receipt, m.offerToken, m.privatePair ? TRANSFER : PUBLIC, 'Transfer');
  if (closed.length !== 1 || closed[0].id.toString() !== r.proposalId || closed[0].status !== 4n || closed[0].actor.toLowerCase() !== m.taker ||
      transfers.length !== 1 || transfers[0].from.toLowerCase() !== input.deployment.contractAddress || transfers[0].to.toLowerCase() !== m.maker ||
      !m.privatePair && transfers[0].value !== BigInt(m.offer) || readLinkTradeV2ReceiptEvents(receipt, m.requestToken, m.privatePair ? TRANSFER : PUBLIC, 'Transfer').length) throw new Error('Counter decline or maker-refund path differs.');
  if (!confirmed) {
    const current = await readCounterTradeV2Proposal({ ...input, proposalId: r.proposalId! }), [offer, request] = await ownBalances(binding, r);
    if (current.status !== 4 || current.offerLocked || offer !== BigInt(r.beforeBalance) || request !== BigInt(r.beforeRequestBalance!)) throw new Error('Counter decline changed the recipient wallet or did not release the offer.');
  }
  return resultFor(r, receipt, 0n);
};
const accept = async (input: Input, r: CounterTradeV2Recovery) => {
  assertCounterTradeV2ModeAdmission(input, r.material.privatePair);
  const binding = await scope(input), m = r.material;
  const send = (step: LinkTradeV2CreationRecord['step'], to: string, data: string, complete: (receipt: unknown) => Promise<void>) =>
    sendLinkTradeV2Transaction({ binding, step, to, data, complete, onPending: input.journal.onPending, admit: async () => {
      await currentTokens(binding, m, true); await recheckCounterTradeV2Acceptance(input, r.proposalId!, m);
      if (await readCounterTradeV2RootRefund(input, m) !== r.rootRefund) throw new Error('Counter parent refund changed before signing.');
      const [offer, request] = await ownBalances(binding, r);
      if (offer !== BigInt(r.beforeBalance) || request !== BigInt(r.beforeRequestBalance!)) throw new Error('Counter acceptance wallet balance changed before signing.');
    } });
  // Do not reject on the pre-refund balance: estimate the complete call, then account every debit and refund.
  await ensureLinkTradeV2Allowance(binding, { offerToken: m.requestToken, privatePair: m.privatePair }, input.deployment.contractAddress, BigInt(m.request), send);
  const prepared = await prepareCounterTradeV2Acceptance(input, r.proposalId!, m);
  let result: CounterTradeV2Result | undefined;
  await send('accept', prepared.to, prepared.data, async receipt => { result = await account(input, binding, r, receipt); });
  if (!result) throw new Error('Counter acceptance needs reconciliation.');
  return result;
};
export const executeCounterTradeV2RecipientAction = async (input: Input & { proposal: CounterTradeV2Proposal; kind: 'accept' | 'decline' }) => {
  if (input.kind === 'accept') assertCounterTradeV2ModeAdmission(input, input.proposal.privatePair);
  const binding = await scope(input), selected = await readCounterTradeV2Proposal({ ...input, proposalId: input.proposal.id });
  const material = counterTradeV2MaterialOf(selected);
  if (selected.taker !== binding.ownerAddress.toLowerCase() || selected.status !== 1 || !selected.offerLocked ||
      JSON.stringify(material) !== JSON.stringify(counterTradeV2MaterialOf(input.proposal)) || input.kind === 'accept' && selected.effectiveStatus !== 1) throw new Error('Counter is not available at the reviewed terms for this recipient.');
  const ancestors: (CounterTradeV2Material & { id: string })[] = [];
  if (input.kind === 'accept') {
    let id = material.parentProposal;
    for (let step = 0; id !== '0' && step < 15; step++) {
      const parent = await readCounterTradeV2Proposal({ ...input, proposalId: id });
      if (parent.status !== 1 || parent.effectiveStatus !== 1) throw new Error('Counter ancestor is unavailable.');
      ancestors.push(Object.freeze({ ...counterTradeV2MaterialOf(parent), id })); id = parent.parentProposal;
    }
    if (id !== '0') throw new Error('Counter ancestry exceeds the contract bound.');
  }
  const rootRefund = input.kind === 'accept' ? await readCounterTradeV2RootRefund(input, material) : undefined;
  const [offer, request] = await ownBalances(binding, { material });
  if (offer === null || request === null) throw new Error('Counter recipient balances are unavailable.');
  const recovery = normalizeCounterTradeV2Recovery({ kind: input.kind, material, proposalId: selected.id, beforeBalance: offer.toString(),
    beforeRequestBalance: request.toString(), ...(input.kind === 'accept' ? { ancestors } : {}), ...(rootRefund === undefined ? {} : { rootRefund }) });
  await input.journal.beginCounter(recovery);
  try {
    if (input.kind === 'accept') return await accept(input, recovery);
    let result: CounterTradeV2Result | undefined;
    await sendLinkTradeV2Transaction({ binding, step: 'decline', to: input.deployment.contractAddress, data: ABI.encodeFunctionData('declineCounter', [selected.id]), onPending: input.journal.onPending,
      admit: async () => { await currentTokens(binding, material, false); const current = await readCounterTradeV2Proposal({ ...input, proposalId: selected.id });
        if (current.taker !== material.taker || current.status !== 1 || !current.offerLocked) throw new Error('Counter is no longer open for decline.'); },
      complete: async receipt => { result = await account(input, binding, recovery, receipt); } });
    if (!result) throw new Error('Counter decline needs reconciliation.'); return result;
  } catch (error) { await input.journal.releaseUnsent(); throw error; }
};
const savedState = async (input: Input) => {
  const binding = await scope(input), saved = await input.journal.read();
  if (!saved?.counter || saved.scope.owner !== binding.ownerAddress.toLowerCase() || saved.scope.chainId !== input.deployment.chainId ||
      saved.scope.escrow !== input.deployment.contractAddress || saved.scope.runtimeHash !== input.deployment.runtimeBytecodeHash) throw new Error('Saved counter does not match this wallet and deployment.');
  return { binding, saved, recovery: normalizeCounterTradeV2Recovery(saved.counter) };
};
const authorizationReceipt = (input: Input, r: CounterTradeV2Recovery, receipt: unknown) => {
  const events = readLinkTradeV2ReceiptEvents(receipt, r.material.root.escrow, LINK, 'CounterAuthorized'), e = events[0], m = r.material;
  if (events.length !== 1 || e.id.toString() !== m.root.id || e.proposer.toLowerCase() !== m.maker || e.revision.toString() !== m.root.revision || e.epoch.toString() !== m.root.credentialEpoch ||
      readLinkTradeV2ReceiptEvents(receipt, input.deployment.contractAddress, ABI, 'CounterOpened').length) throw new Error('Counter authorization does not match its reviewed Link.');
};
const fund = async (input: Input, r: CounterTradeV2Recovery) => {
  assertCounterTradeV2ModeAdmission(input, r.material.privatePair);
  const binding = await scope(input), m = r.material, provider = binding.readProvider!;
  if (await readLinkTradeV2Balance(binding, token(m)) !== BigInt(r.beforeBalance)) throw new Error('Counter funding balance changed. Reconcile before continuing.');
  const saved = await input.journal.read();
  const send = (step: LinkTradeV2CreationRecord['step'], to: string, data: string, complete: (receipt: unknown) => Promise<void>) =>
    sendLinkTradeV2Transaction({ binding, step, to, data, onPending: input.journal.onPending, complete, admit: async timestamp => {
      if (m.expiresAt !== '0' && (BigInt(m.expiresAt) <= timestamp || BigInt(m.expiresAt) > timestamp + 2592000n)) throw new Error('Counter expiry is outside its 30-day window.');
      await currentTokens(binding, m, true);
      await recheckCounterTradeV2Proposal(input, m, step !== 'authorize');
      if (await readLinkTradeV2Balance(binding, token(m)) !== BigInt(r.beforeBalance)) throw new Error('Counter funding balance changed before signing.');
      if (keccak256(await provider.getCode(input.deployment.contractAddress)) !== input.deployment.runtimeBytecodeHash) throw new Error('Counter runtime changed before signing.');
    } });
  if (r.link && !saved?.records.some(record => record.step === 'authorize' && record.state === 'confirmed')) {
    const parent = counterTradeV2ParentDeployment(input, m.root.escrow);
    if (parent.protocol !== 'link-v2') throw new Error('Link authorization requires its admitted Link deployment.');
    const review = await readLinkTradeV2Review({ capability: input.readCapability, deployment: parent, reference: r.link.reference, secret: r.link.secret });
    const prepared = await prepareLinkTradeV2CounterAuthorization({ review, capability: input.capability });
    await send('authorize', prepared.to, prepared.data, async receipt => {
      authorizationReceipt(input, r, receipt);
      if (await readLinkTradeV2Balance(binding, token(m)) !== BigInt(r.beforeBalance)) throw new Error('Counter authorization changed the funding balance.');
    });
  }
  await ensureLinkTradeV2Allowance(binding, token(m), input.deployment.contractAddress, BigInt(m.offer), send);
  const prepared = await prepareCounterTradeV2Proposal(input, m);
  let result: CounterTradeV2Result | undefined;
  await send('create', prepared.to, prepared.data, async receipt => { result = await account(input, binding, r, receipt); });
  if (!result) throw new Error('Counter needs reconciliation. Do not fund it again.');
  return result;
};
export const executeCounterTradeV2Proposal = async (input: Input & { parent: CounterTradeV2Parent; amounts: CounterTradeV2Amounts }) => {
  const binding = await scope(input), reviewed = await reviewCounterTradeV2Proposal(input);
  const before = await readLinkTradeV2Balance(binding, token(reviewed.material));
  if (before === null) throw new Error('Counter balance is unavailable.');
  const recovery = normalizeCounterTradeV2Recovery({ kind: 'create', ...reviewed, beforeBalance: before.toString() });
  await input.journal.beginCounter(recovery);
  try { return await fund(input, recovery); }
  catch (error) { await input.journal.releaseUnsent(); throw error; }
};
export const continueCounterTradeV2Proposal = async (input: Input & { recoveryId: string }) => {
  const { saved, recovery } = await savedState(input);
  if (!saved.active || saved.id !== input.recoveryId || saved.abandoned || !['create', 'accept'].includes(recovery.kind) || saved.records.some(r => r.state !== 'confirmed' || ['create', 'accept', 'cleanup'].includes(r.step))) throw new Error('Check the saved counter before continuing.');
  return recovery.kind === 'accept' ? accept(input, recovery) : fund(input, recovery);
};
export const cancelCounterTradeV2Proposal = async (input: Input & { proposalId: string }) => {
  const binding = await scope(input), p = await readCounterTradeV2Proposal(input);
  if (p.maker !== binding.ownerAddress.toLowerCase() || p.status !== 1 || !p.offerLocked) throw new Error('This counter cannot be cancelled by this wallet.');
  const { id, status: _status, effectiveStatus: _effective, offerLocked: _locked, ...material } = p; void _status; void _effective; void _locked;
  const before = await readLinkTradeV2Balance(binding, token(material));
  if (before === null) throw new Error('Counter refund balance is unavailable.');
  const recovery = normalizeCounterTradeV2Recovery({ kind: 'cancel', material, proposalId: id, beforeBalance: before.toString() });
  await input.journal.beginCounter(recovery);
  try {
    let result: CounterTradeV2Result | undefined;
    await sendLinkTradeV2Transaction({ binding, step: 'cancel', to: input.deployment.contractAddress, data: ABI.encodeFunctionData('cancelCounter', [id]), onPending: input.journal.onPending,
      admit: async () => { await currentTokens(binding, material, false); const fresh = await readCounterTradeV2Proposal(input);
        if (fresh.maker !== material.maker || fresh.status !== 1 || !fresh.offerLocked || fresh.offer !== material.offer) throw new Error('Counter refund state changed.'); },
      complete: async receipt => { result = await account(input, binding, recovery, receipt); } });
    if (!result) throw new Error('Counter refund needs reconciliation.');
    return result;
  } catch (error) { await input.journal.releaseUnsent(); throw error; }
};
export const cleanupCounterTradeV2Allowance = async (input: Input) => {
  const { binding, saved, recovery } = await savedState(input);
  if (saved.active && (['cancel', 'decline'].includes(recovery.kind) || saved.records.some(r => r.state !== 'confirmed' || ['create', 'cancel', 'accept', 'decline', 'cleanup'].includes(r.step)))) throw new Error('Check the pending counter transaction before cleanup.');
  const before = await readLinkTradeV2Balance(binding, payingToken(recovery));
  if (before === null) throw new Error('Counter cleanup balance is unavailable.');
  const r = normalizeCounterTradeV2Recovery(cleanupRecovery(recovery, before.toString()));
  if (!saved.active) await input.journal.beginCounter(r);
  else if (before.toString() !== (recovery.kind === 'accept' ? recovery.beforeRequestBalance : recovery.beforeBalance)) throw new Error('Counter balance changed before cleanup.');
  const asset = payingToken(r), allowance = await readLinkTradeV2Allowance(binding, asset, input.deployment.contractAddress);
  if (allowance === null) throw new Error('Counter allowance is unavailable.');
  if (allowance === 0n) { await input.journal.finishCounterCleanup(); return Object.freeze({ kind: 'cleanup' as const, ...asset, requestToken: r.material.requestToken, offer: r.material.offer, request: r.material.request, refund: '0' }); }
  const data = r.material.privatePair ? PRIVATE.encodeFunctionData('approve(address,((uint256,uint256),bytes))', [input.deployment.contractAddress,
    await encryptPrivateUint256Input(binding.signer, 0n, asset.offerToken, PRIVATE.getFunction('approve(address,((uint256,uint256),bytes))')!.selector)]) : PUBLIC.encodeFunctionData('approve', [input.deployment.contractAddress, 0n]);
  let result: CounterTradeV2Result | undefined;
  await sendLinkTradeV2Transaction({ binding, step: 'cleanup', to: asset.offerToken, data, onPending: input.journal.onPending,
    admit: async () => { const codeHash = r.cleanupToken === 'request' ? r.material.requestCodeHash : r.material.offerCodeHash;
      if (keccak256(await binding.readProvider!.getCode(asset.offerToken)) !== codeHash) throw new Error('Counter cleanup token code changed.'); }, complete: async receipt => { result = await account(input, binding, r, receipt); } });
  return result!;
};
export const reconcileCounterTradeV2Proposal = async (input: Input & { transactionHash?: string }) => {
  const { binding, saved, recovery } = await savedState(input), original = saved.records[saved.records.length - 1];
  if (!original || original.state === 'rejected') throw new Error('Counter transaction is not available for reconciliation.');
  if (original.state === 'failed') return undefined;
  const found = await findLinkTradeV2Transaction(binding.readProvider!, original, input.journal, input.transactionHash);
  if (!found) return null;
  if (original.step === 'cleanup' || ['approval', 'approval-reset'].includes(original.step)) {
    const asset = payingToken(recovery), expected = asset.offerToken === recovery.material.requestToken ? recovery.material.requestCodeHash : recovery.material.offerCodeHash;
    if (keccak256(await binding.readProvider!.getCode(asset.offerToken)) !== expected) throw new Error('Recovered counter allowance token code changed.');
  } else {
    await currentTokens(binding, recovery.material, false);
    if (recovery.kind === 'accept' || recovery.kind === 'decline') {
      if (keccak256(await binding.readProvider!.getCode(recovery.material.requestToken)) !== recovery.material.requestCodeHash) throw new Error('Recovered counter payment token code changed.');
    }
  }
  let result: CounterTradeV2Result | undefined;
  await confirmLinkTradeV2Transaction(binding, found.record, found.receipt, original.state === 'confirmed' ? async () => {} : input.journal.onPending, async receipt => {
    if (original.step === 'authorize') authorizationReceipt(input, recovery, receipt);
    else if (['create', 'cancel', 'cleanup', 'accept', 'decline'].includes(original.step)) result = await account(input, binding,
      original.step === 'cleanup' ? cleanupRecovery(recovery, recovery.kind === 'accept' ? recovery.beforeRequestBalance! : recovery.beforeBalance) : recovery, receipt, original.state === 'confirmed');
    else if (await readLinkTradeV2Allowance(binding, payingToken(recovery), input.deployment.contractAddress) !== (original.step === 'approval-reset' ? 0n : BigInt(recovery.kind === 'accept' ? recovery.material.request : recovery.material.offer))) throw new Error('Recovered counter allowance differs from review.');
  }, async () => {
    if (found.record.mined?.outcome !== 'reverted' && await readLinkTradeV2Balance(binding, token(recovery.material)) !== BigInt(recovery.beforeBalance)) throw new Error('Replaced counter balance changed. Keep it on hold.');
    if (found.record.mined?.outcome !== 'reverted' && recovery.beforeRequestBalance !== undefined && await readLinkTradeV2Balance(binding,
      { offerToken: recovery.material.requestToken, privatePair: recovery.material.privatePair }) !== BigInt(recovery.beforeRequestBalance)) throw new Error('Replaced counter payment balance changed. Keep it on hold.');
  });
  return result;
};
