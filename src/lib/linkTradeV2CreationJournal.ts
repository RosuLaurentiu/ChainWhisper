import { getAddress, keccak256 } from '@coti-io/coti-ethers';
import { linkTradeV2CredentialDomain, normalizeLinkTradeV2Terms, normalizeLinkTradeV2Reference, type LinkTradeV2Context, type LinkTradeV2Terms } from './linkTradeV2Terms';
import { encryptLinkCreationRecoveryForSigner, decryptLinkCreationRecoveryForSigner } from './tradeRecoveryPayload';
import { getOwnerTradeV2CapabilityBinding, assertOwnerTradeV2CapabilityCurrent,
  assertOwnerTradeV2CapabilitySnapshotCurrent, type OwnerTradeV2MetaMaskCapability } from './ownerTradeV2Capability';
import { assertAttestedTradeHistoryV2Deployment, type AttestedTradeHistoryV2Deployment } from './tradeHistoryV2Chain';
import type { PrivateBookV2Action } from './privateBookV2Actions';
import { normalizePrivateBookV2RecoveryAction, privateBookV2RecoveryActionNeedsPrivacy } from './privateBookV2Terms';
import type { LinkTradeV2Deployment, LinkTradeV2FillMaterial } from './linkTradeV2';
import type { LinkTradeV2CounterMaterial } from './linkTradeV2';
import { normalizeCounterTradeV2Material, counterTradeV2RootKey, counterTradeV2Uint, type CounterTradeV2Material, type CounterTradeV2Deployment } from './counterTradeV2';
import type { LinkTradeV2CreationRecord } from './linkTradeV2CreationFlow';
import { createIndexedDbLinkTradeV2CreationStore, type LinkTradeV2CreationStore, type LinkTradeV2CreationStoredRow } from './linkTradeV2CreationStore';

export type LinkTradeV2CreationRecovery = Readonly<{
  context: LinkTradeV2Context; secret: string; terms: LinkTradeV2Terms; offerBudget: string; beforeBalance: string; offerCodeHash: string;
}>;
export type LinkTradeV2OwnerAction = Readonly<{
  kind: 'cancel' | 'cleanup'; orderId?: string; offerToken: string; privatePair: boolean; tokenCodeHash: string; beforeBalance: string;
}>;
export type LinkTradeV2FillRecovery = LinkTradeV2FillMaterial & Readonly<{ beforeOfferBalance: string; beforeRequestBalance: string }>;
export type TradeBalanceDisclosureV2Action = Readonly<{ kind: 'grant' | 'snapshot'; orderId: string; maker: string; owner: string; recipient: string; generation: string; allowed?: boolean }>;
export const normalizeTradeBalanceDisclosureV2Action = (v: TradeBalanceDisclosureV2Action): TradeBalanceDisclosureV2Action => {
  keys(v, ['kind', 'orderId', 'maker', 'owner', 'recipient', 'generation'], ['allowed']);
  if (!['grant', 'snapshot'].includes(v.kind) || v.kind === 'grant' && typeof v.allowed !== 'boolean' || v.kind === 'snapshot' && v.allowed !== undefined) invalid();
  const maker = getAddress(v.maker).toLowerCase(), owner = getAddress(v.owner).toLowerCase(), recipient = getAddress(v.recipient).toLowerCase();
  if ([maker, owner, recipient].some(a => BigInt(a) === 0n) || (v.kind === 'grant' ? maker !== owner || recipient === maker : recipient !== owner)) invalid();
  return Object.freeze({ kind: v.kind, orderId: counterTradeV2Uint(v.orderId, 256, true), maker, owner, recipient, generation: amount(v.generation, (1n << 64n) - 1n), ...(v.kind === 'grant' ? { allowed: v.allowed } : {}) });
};
export type CounterTradeV2Recovery = Readonly<{ kind: 'create' | 'cancel' | 'cleanup' | 'accept' | 'decline'; material: CounterTradeV2Material;
  beforeBalance: string; beforeRequestBalance?: string; proposalId?: string; link?: LinkTradeV2CounterMaterial;
  ancestors?: readonly (CounterTradeV2Material & { id: string })[]; rootRefund?: string; cleanupToken?: 'request' }>;
export const counterTradeV2RecoveryOwner = (r: CounterTradeV2Recovery) => ['accept', 'decline'].includes(r.kind) || r.cleanupToken === 'request' ? r.material.taker : r.material.maker;

export const normalizeCounterTradeV2Recovery = (v: CounterTradeV2Recovery): CounterTradeV2Recovery => {
  keys(v, ['kind', 'material', 'beforeBalance'], ['proposalId', 'link', 'beforeRequestBalance', 'ancestors', 'rootRefund', 'cleanupToken']);
  const material = normalizeCounterTradeV2Material(v.material), beforeBalance = amount(v.beforeBalance);
  if (!['create', 'cancel', 'cleanup', 'accept', 'decline'].includes(v.kind) || ['cancel', 'accept', 'decline'].includes(v.kind) !== (v.proposalId !== undefined) ||
      v.kind === 'create' && BigInt(beforeBalance) < BigInt(material.offer) ||
      ['accept', 'decline'].includes(v.kind) !== (v.beforeRequestBalance !== undefined) ||
      v.cleanupToken !== undefined && (v.kind !== 'cleanup' || v.cleanupToken !== 'request') ||
      v.rootRefund !== undefined && (v.kind !== 'accept' || material.privatePair || material.root.credentialEpoch !== '0')) invalid();
  let ancestors: CounterTradeV2Recovery['ancestors'];
  if (v.kind === 'accept') {
    if (!Array.isArray(v.ancestors) || v.ancestors.length !== material.depth - 1) invalid();
    let child = material;
    const ids = new Set([v.proposalId]);
    ancestors = Object.freeze(v.ancestors!.map(value => {
      const { id, ...raw } = value;
      const m = normalizeCounterTradeV2Material(raw);
      counterTradeV2Uint(id, 256, true);
      if (ids.has(id) || child.parentProposal !== id || child.depth !== m.depth + 1 || child.maker !== m.taker || child.taker !== m.maker ||
          child.offerToken !== m.requestToken || child.requestToken !== m.offerToken || child.offerCodeHash !== m.requestCodeHash || child.requestCodeHash !== m.offerCodeHash ||
          child.privatePair !== m.privatePair || counterTradeV2RootKey(child.root) !== counterTradeV2RootKey(m.root) || child.rootCodeHash !== m.rootCodeHash) invalid();
      ids.add(id); child = m; return Object.freeze({ ...m, id });
    }));
    if (child.parentProposal !== '0') invalid();
  } else if (v.ancestors !== undefined) invalid();
  let link: LinkTradeV2CounterMaterial | undefined;
  if (v.link) {
    keys(v.link, ['reference', 'terms', 'secret', 'maker', 'offerCodeHash', 'requestCodeHash']);
    link = Object.freeze({ reference: normalizeLinkTradeV2Reference(v.link.reference), terms: normalizeLinkTradeV2Terms(v.link.terms),
      secret: bytes(v.link.secret), maker: getAddress(v.link.maker).toLowerCase(), offerCodeHash: bytes(v.link.offerCodeHash), requestCodeHash: bytes(v.link.requestCodeHash) });
    if (v.kind !== 'create' || material.parentProposal !== '0' || counterTradeV2RootKey(link.reference) !== counterTradeV2RootKey(material.root) ||
        link.maker !== material.taker || link.terms.requestToken !== material.offerToken || link.terms.offerToken !== material.requestToken ||
        link.requestCodeHash !== material.offerCodeHash || link.offerCodeHash !== material.requestCodeHash || link.terms.privatePair !== material.privatePair) invalid();
  }
  if (v.kind === 'create' && (material.parentProposal === '0' && material.root.credentialEpoch !== '0') !== Boolean(link)) invalid();
  return Object.freeze({ kind: v.kind, material, beforeBalance, ...(v.beforeRequestBalance === undefined ? {} : { beforeRequestBalance: amount(v.beforeRequestBalance) }),
    ...(ancestors ? { ancestors } : {}), ...(v.rootRefund === undefined ? {} : { rootRefund: counterTradeV2Uint(v.rootRefund, 128, true) }), ...(v.cleanupToken ? { cleanupToken: v.cleanupToken } : {}),
    ...(v.proposalId ? { proposalId: counterTradeV2Uint(v.proposalId, 256, true) } : {}), ...(link ? { link } : {}) });
};
type Scope = Readonly<{ chainId: string; owner: string; escrow: string; runtimeHash: string }>;
type Snapshot = Readonly<{ version: 1; scope: Scope; recovery?: LinkTradeV2CreationRecovery; fill?: LinkTradeV2FillRecovery; ownerAction?: LinkTradeV2OwnerAction;
  counter?: CounterTradeV2Recovery; disclosure?: TradeBalanceDisclosureV2Action; abandoned?: true; records: readonly LinkTradeV2CreationRecord[] }>;
export type TradeBalanceDisclosureV2Journal = Readonly<{
  close?(): void;
  beginDisclosure(value: TradeBalanceDisclosureV2Action): Promise<void>;
  read(): Promise<Readonly<Snapshot & { id: string; active: boolean; feeWei: string }> | null>;
  onPending(value: LinkTradeV2CreationRecord): Promise<void>;
  releaseUnsent(): Promise<void>;
  advanceSearch(nonce: number, search: NonNullable<LinkTradeV2CreationRecord['search']>): Promise<void>;
}>;
const TERMINAL_STEPS = ['create', 'fill', 'cancel', 'cleanup', 'accept', 'decline', 'consent', 'balance-snapshot'];
const invalid = (): never => { throw new Error('Saved Link creation is invalid. Keep it for reconciliation; do not resend.'); };
const keys = (v: object, required: string[], optional: string[] = []) => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || required.some(k => !Object.prototype.hasOwnProperty.call(v, k)) ||
      Object.keys(v).some(k => !required.includes(k) && !optional.includes(k))) invalid();
};
const amount = (v: string, maximum = (1n << 256n) - 1n): string => {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(v) || BigInt(v) > maximum) invalid();
  return v;
};
const bytes = (v: string): string => {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(v) || BigInt(v) === 0n) invalid();
  return v.toLowerCase();
};
export const normalizeLinkTradeV2CreationRecovery = (v: LinkTradeV2CreationRecovery): LinkTradeV2CreationRecovery => {
  keys(v, ['context', 'secret', 'terms', 'offerBudget', 'beforeBalance', 'offerCodeHash']);
  linkTradeV2CredentialDomain(v.context);
  if (v.context.credentialEpoch !== '1') invalid();
  const context = Object.freeze({ ...v.context, maker: getAddress(v.context.maker).toLowerCase(),
    escrow: getAddress(v.context.escrow).toLowerCase(), makerNonce: bytes(v.context.makerNonce) });
  const offerBudget = amount(v.offerBudget, (1n << 128n) - 1n), beforeBalance = amount(v.beforeBalance);
  if (BigInt(offerBudget) === 0n || BigInt(beforeBalance) < BigInt(offerBudget)) invalid();
  return Object.freeze({ context, secret: bytes(v.secret), terms: normalizeLinkTradeV2Terms(v.terms), offerBudget, beforeBalance, offerCodeHash: bytes(v.offerCodeHash) });
};
const normalizeOwnerAction = (v: LinkTradeV2OwnerAction): LinkTradeV2OwnerAction => {
  keys(v, ['kind', 'offerToken', 'privatePair', 'tokenCodeHash', 'beforeBalance'], ['orderId']);
  const token = getAddress(v.offerToken).toLowerCase();
  if (!['cancel', 'cleanup'].includes(v.kind) || BigInt(token) === 0n || typeof v.privatePair !== 'boolean' ||
      (v.kind === 'cancel' && v.orderId === undefined) || (v.orderId !== undefined && amount(v.orderId) === '0')) invalid();
  return Object.freeze({ kind: v.kind, offerToken: token, privatePair: v.privatePair, tokenCodeHash: bytes(v.tokenCodeHash),
    beforeBalance: amount(v.beforeBalance), ...(v.orderId === undefined ? {} : { orderId: v.orderId }) });
};
export const normalizeLinkTradeV2FillRecovery = (v: LinkTradeV2FillRecovery): LinkTradeV2FillRecovery => {
  keys(v, ['reference', 'terms', 'secret', 'maker', 'offerCodeHash', 'requestCodeHash', 'maximumPayment', 'beforeOfferBalance', 'beforeRequestBalance']);
  const maker = getAddress(v.maker).toLowerCase(), maximumPayment = amount(v.maximumPayment, (1n << 128n) - 1n);
  if (BigInt(maker) === 0n || maximumPayment === '0' || BigInt(amount(v.beforeRequestBalance)) < BigInt(maximumPayment)) invalid();
  return Object.freeze({ reference: normalizeLinkTradeV2Reference(v.reference), terms: normalizeLinkTradeV2Terms(v.terms),
    secret: bytes(v.secret), maker, offerCodeHash: bytes(v.offerCodeHash), requestCodeHash: bytes(v.requestCodeHash), maximumPayment,
    beforeOfferBalance: amount(v.beforeOfferBalance), beforeRequestBalance: v.beforeRequestBalance });
};
const normalizeRecord = (v: LinkTradeV2CreationRecord, scope: Scope, state: Pick<Snapshot, 'recovery' | 'fill' | 'ownerAction' | 'counter' | 'disclosure'> & { book?: PrivateBookV2RecoveryMeta }): LinkTradeV2CreationRecord => {
  keys(v, ['step', 'state', 'chainId', 'owner', 'to', 'nonce', 'dataHash', 'gasLimit', 'gasPrice'], ['value', 'transactionHash', 'gasUsed', 'feeWei', 'blockNumber', 'blockHash', 'admission', 'search', 'mined']);
  const counter = state.counter;
  const token = counter ? counter.kind === 'accept' || counter.cleanupToken === 'request' ? counter.material.requestToken : counter.material.offerToken
    : state.ownerAction?.offerToken ?? state.fill?.terms.requestToken ?? state.recovery?.terms.offerToken;
  const target = state.book ? v.step === state.book.kind ? scope.escrow : state.book.approvalToken : v.step === 'authorize' ? counter?.material.root.escrow : TERMINAL_STEPS.includes(v.step) && v.step !== 'cleanup' ? scope.escrow : token;
  const allowed = state.book ? [state.book.kind, ...(state.book.approvalToken ? ['approval-reset', 'approval', 'cleanup'] : [])] : state.disclosure ? [state.disclosure.kind === 'grant' ? 'consent' : 'balance-snapshot'] : counter ? counter.kind === 'create' ? ['authorize', 'approval-reset', 'approval', 'create', 'cleanup']
    : counter.kind === 'accept' ? ['approval-reset', 'approval', 'accept', 'cleanup'] : [counter.kind] : ['approval-reset', 'approval', 'create', 'fill', 'cancel', 'cleanup'];
  if (!allowed.includes(v.step) || !['sending', 'submitted', 'confirmed', 'rejected', 'failed'].includes(v.state) ||
      v.chainId !== scope.chainId || v.owner !== scope.owner || !Number.isSafeInteger(v.nonce) || v.nonce < 0 ||
      v.to !== target || !target || BigInt(getAddress(target)) === 0n || (v.step === 'authorize' && !state.counter?.link) ||
      (!state.book && !state.counter && !state.disclosure && (((v.step === 'cancel' || v.step === 'cleanup') && v.step !== state.ownerAction?.kind) ||
      (!state.recovery && !state.fill && v.step !== state.ownerAction?.kind) ||
      (v.step === 'fill' && !state.fill) || (v.step === 'create' && !state.recovery)))) invalid();
  const gasLimit = amount(v.gasLimit), gasPrice = amount(v.gasPrice), value = amount(v.value ?? '0');
  if (value !== '0' && (!state.book || !['create', 'replace', 'fill'].includes(v.step))) invalid();
  if (gasLimit === '0' || gasPrice === '0') invalid();
  const transactionHash = v.transactionHash === undefined ? undefined : bytes(v.transactionHash);
  if (['submitted', 'confirmed', 'failed'].includes(v.state) !== Boolean(transactionHash)) invalid();
  const admission = v.admission && (() => {
    keys(v.admission, ['number', 'hash']);
    const number = amount(v.admission.number, BigInt(Number.MAX_SAFE_INTEGER));
    return Object.freeze({ number, hash: bytes(v.admission.hash) });
  })();
  const search = v.search && (() => {
    keys(v.search, ['throughBlock', 'blockHash', 'headBlock']);
    const throughBlock = amount(v.search.throughBlock, BigInt(Number.MAX_SAFE_INTEGER)), headBlock = amount(v.search.headBlock, BigInt(Number.MAX_SAFE_INTEGER));
    if (!admission || BigInt(throughBlock) < BigInt(admission.number) || BigInt(headBlock) < BigInt(throughBlock)) invalid();
    return Object.freeze({ throughBlock, blockHash: bytes(v.search.blockHash), headBlock });
  })();
  const mined = v.mined && (() => {
    keys(v.mined, ['transactionHash', 'to', 'dataHash', 'value', 'gasLimit', 'gasPrice'], ['outcome']);
    if (!['submitted', 'confirmed', 'failed'].includes(v.state)) invalid();
    const to = v.mined.to === null ? null : getAddress(v.mined.to).toLowerCase();
    const dataHash = bytes(v.mined.dataHash), value = amount(v.mined.value);
    const sameCall = to === v.to && dataHash === v.dataHash && value === (v.value ?? '0');
    const outcome = v.mined.outcome;
    if (outcome !== undefined && !['cancelled', 'replaced', 'reverted'].includes(outcome) || !sameCall && !outcome ||
        outcome === 'cancelled' && (to !== scope.owner || value !== '0' || dataHash !== keccak256('0x')) ||
        outcome === 'replaced' && sameCall || v.state === 'confirmed' && Boolean(outcome) || v.state === 'failed' && !outcome) invalid();
    const gasLimit = amount(v.mined.gasLimit), gasPrice = amount(v.mined.gasPrice);
    if (gasLimit === '0') invalid();
    return Object.freeze({ transactionHash: bytes(v.mined.transactionHash), to, dataHash, value, gasLimit, gasPrice, ...(outcome ? { outcome } : {}) });
  })();
  if (v.state === 'failed' && !mined) invalid();
  if ((v.gasUsed === undefined) !== (v.feeWei === undefined)) invalid();
  if ((v.blockNumber === undefined) !== (v.blockHash === undefined) || (v.gasUsed === undefined) !== (v.blockHash === undefined)) invalid();
  if ((v.state === 'sending' || v.state === 'rejected') && v.gasUsed !== undefined) invalid();
  if (v.gasUsed !== undefined && (BigInt(amount(v.gasUsed)) > BigInt(mined?.gasLimit ?? gasLimit) ||
      BigInt(amount(v.feeWei!)) !== BigInt(v.gasUsed) * BigInt(mined?.gasPrice ?? gasPrice))) invalid();
  if (['confirmed', 'failed'].includes(v.state) && v.feeWei === undefined) invalid();
  return Object.freeze({ step: v.step, state: v.state, chainId: v.chainId, owner: v.owner, to: v.to, nonce: v.nonce,
    dataHash: bytes(v.dataHash), gasLimit, gasPrice, ...(v.value === undefined ? {} : { value }), ...(transactionHash ? { transactionHash } : {}),
    ...(admission ? { admission } : {}), ...(search ? { search } : {}), ...(mined ? { mined } : {}),
    ...(v.gasUsed === undefined ? {} : { gasUsed: v.gasUsed, feeWei: v.feeWei,
      blockNumber: amount(v.blockNumber!), blockHash: bytes(v.blockHash!) }) });
};
const aad = (row: LinkTradeV2CreationStoredRow, scope: Scope) => JSON.stringify([
  'ChainWhisperLinkCreationJournalV1', scope, row.id, row.ownerKey, row.activeOwner ?? '', row.createdAt, row.revision
]);

export type TradeBalanceDisclosureV2Deployment = AttestedTradeHistoryV2Deployment<'private-v2' | 'direct-v2' | 'link-v2' | 'counter-v2'>;
export const createLinkTradeV2CreationJournal = ({ capability, deployment, store = createIndexedDbLinkTradeV2CreationStore(), purpose }: {
  capability: OwnerTradeV2MetaMaskCapability; deployment: LinkTradeV2Deployment | CounterTradeV2Deployment | TradeBalanceDisclosureV2Deployment; store?: LinkTradeV2CreationStore; purpose?: 'disclosure';
}) => {
  const isCounter = deployment.protocol === 'counter-v2';
  if (!['link-v2', 'counter-v2'].includes(deployment.protocol) && purpose !== 'disclosure') invalid();
  assertAttestedTradeHistoryV2Deployment(deployment, deployment.protocol);
  const binding = getOwnerTradeV2CapabilityBinding(capability);
  const scope: Scope = Object.freeze({ chainId: binding.chainId.toString(), owner: binding.ownerAddress.toLowerCase(),
    escrow: deployment.contractAddress, runtimeHash: bytes(deployment.runtimeBytecodeHash) });
  if (scope.chainId !== deployment.chainId) invalid();
  const lockKey = `${scope.chainId}:${scope.owner}`;
  // Keep the existing Link key/AAD and one active wallet lock across both protocols.
  const ownerKey = purpose === 'disclosure' ? `${lockKey}:balance:${deployment.protocol}:${scope.escrow}` : isCounter ? `${lockKey}:counter:${scope.escrow}` : lockKey;
  let currentId: string | undefined;
  const open = async (row: LinkTradeV2CreationStoredRow): Promise<Snapshot> => {
    await assertOwnerTradeV2CapabilityCurrent(binding);
    if (row.ownerKey !== ownerKey || (row.activeOwner !== undefined && row.activeOwner !== lockKey) ||
        !Number.isSafeInteger(row.revision) || row.revision <= 0 || !Number.isSafeInteger(row.createdAt) || row.createdAt <= 0 ||
        typeof row.id !== 'string' || !/^[0-9a-f-]{36}$/.test(row.id)) invalid();
    const parsed = JSON.parse(await decryptLinkCreationRecoveryForSigner(binding.signer, row.sealed, aad(row, scope))) as Snapshot;
    keys(parsed, ['version', 'scope', 'records'], ['recovery', 'fill', 'abandoned', 'ownerAction', 'counter', 'disclosure']);
    if (parsed.version !== 1 || JSON.stringify(parsed.scope) !== JSON.stringify(scope) || !Array.isArray(parsed.records)) invalid();
    const recovery = parsed.recovery ? normalizeLinkTradeV2CreationRecovery(parsed.recovery) : undefined;
    const fill = parsed.fill ? normalizeLinkTradeV2FillRecovery(parsed.fill) : undefined;
    if (fill && (recovery || fill.reference.chainId !== scope.chainId || fill.reference.escrow !== scope.escrow || fill.maker === scope.owner)) invalid();
    const ownerAction = parsed.ownerAction ? normalizeOwnerAction(parsed.ownerAction) : undefined;
    const counter = parsed.counter ? normalizeCounterTradeV2Recovery(parsed.counter) : undefined;
    const disclosure = parsed.disclosure ? normalizeTradeBalanceDisclosureV2Action(parsed.disclosure) : undefined;
    if ((purpose === 'disclosure') !== Boolean(disclosure)) invalid();
    if (disclosure && (recovery || fill || ownerAction || counter || disclosure.owner !== scope.owner)) invalid();
    if (isCounter && (recovery || fill || ownerAction) || !isCounter && counter || counter &&
        (counterTradeV2RecoveryOwner(counter) !== scope.owner || counter.material.root.chainId !== scope.chainId)) invalid();
    if (recovery && ownerAction && (ownerAction.kind !== 'cleanup' || ownerAction.orderId ||
        ownerAction.offerToken !== recovery.terms.offerToken || ownerAction.privatePair !== recovery.terms.privatePair || ownerAction.tokenCodeHash !== recovery.offerCodeHash)) invalid();
    if (fill && ownerAction && (ownerAction.kind !== 'cleanup' || ownerAction.orderId || ownerAction.offerToken !== fill.terms.requestToken ||
        ownerAction.privatePair !== fill.terms.privatePair || ownerAction.tokenCodeHash !== fill.requestCodeHash)) invalid();
    if (recovery && (recovery.context.maker !== scope.owner || recovery.context.chainId !== scope.chainId || recovery.context.escrow !== scope.escrow)) invalid();
    if (parsed.records.length && !recovery && !fill && !ownerAction && !counter && !disclosure) invalid();
    const records = parsed.records.map(r => normalizeRecord(r, scope, { recovery, fill, ownerAction, counter, disclosure }));
    if (new Set(records.map(r => r.nonce)).size !== records.length) invalid();
    const hashes = records.flatMap(r => [...new Set([r.transactionHash, r.mined?.transactionHash].filter((h): h is string => Boolean(h)))]);
    const cleaned = Boolean(((recovery || fill) && ownerAction?.kind === 'cleanup' || counter && counter.kind !== 'cancel') &&
      records.every(r => r.state === 'confirmed' && !['create', 'fill', 'cancel', 'accept', 'decline'].includes(r.step)));
    if (new Set(hashes).size !== hashes.length || (parsed.abandoned !== undefined && (parsed.abandoned !== true || records.length && !cleaned))) invalid();
    for (let i = 1; i < records.length; i++) {
      if (records[i - 1].state !== 'confirmed' || TERMINAL_STEPS.includes(records[i - 1].step) || records[i - 1].nonce >= records[i].nonce ||
          records.slice(0, i).some(r => r.step === records[i].step)) invalid();
    }
    const terminal = parsed.abandoned || records.some(r => ['rejected', 'failed'].includes(r.state) || (TERMINAL_STEPS.includes(r.step) && r.state === 'confirmed'));
    if (Boolean(row.activeOwner) === Boolean(terminal)) invalid();
    await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
    return Object.freeze({ version: 1, scope, ...(recovery ? { recovery } : {}), ...(fill ? { fill } : {}), ...(ownerAction ? { ownerAction } : {}), ...(counter ? { counter } : {}), ...(disclosure ? { disclosure } : {}),
      ...(parsed.abandoned ? { abandoned: true as const } : {}), records: Object.freeze(records) });
  };
  const load = async () => {
    const row = currentId ? await store.read(currentId) : await store.active(lockKey) ?? await store.latest(ownerKey);
    if (!row) return null;
    if (row.ownerKey !== ownerKey) throw new Error('Another trade is pending for this wallet. Reconcile that trade first.');
    const snapshot = await open(row); currentId = row.id;
    return { row, snapshot };
  };
  const update = async (change: (state: Snapshot) => Snapshot | undefined) => {
    const loaded = await load();
    if (!loaded) return invalid();
    const { row, snapshot } = loaded;
    let next = change(snapshot);
    if (!next) return;
    if ((next.recovery || next.fill) && next.ownerAction?.kind === 'cleanup' && next.records.some(r => r.step === 'cleanup' && r.state === 'confirmed')) next = Object.freeze({ ...next, abandoned: true });
    if (!row.activeOwner) invalid();
    const terminal = next.abandoned || next.records.some(r => ['rejected', 'failed'].includes(r.state) || (TERMINAL_STEPS.includes(r.step) && r.state === 'confirmed'));
    const { activeOwner: _active, ...base } = row; void _active;
    const header = { ...base, ...(terminal ? {} : { activeOwner: lockKey }), revision: row.revision + 1 };
    const sealed = await encryptLinkCreationRecoveryForSigner(binding.signer, JSON.stringify(next), aad(header, scope));
    await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
    await store.replace(Object.freeze({ ...header, sealed }), row.revision);
  };
  const claim = async (ownerAction?: LinkTradeV2OwnerAction, fill?: LinkTradeV2FillRecovery, counter?: CounterTradeV2Recovery, disclosure?: TradeBalanceDisclosureV2Action) => {
      await assertOwnerTradeV2CapabilityCurrent(binding);
      const header = { id: crypto.randomUUID(), ownerKey, activeOwner: lockKey, createdAt: Date.now(), revision: 1, sealed: '' };
      const sealed = await encryptLinkCreationRecoveryForSigner(binding.signer,
        JSON.stringify({ version: 1, scope, ...(ownerAction ? { ownerAction } : {}), ...(fill ? { fill } : {}), ...(counter ? { counter } : {}), ...(disclosure ? { disclosure } : {}), records: [] } satisfies Snapshot), aad(header, scope));
      await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
      await store.claim(Object.freeze({ ...header, sealed })); currentId = header.id;
  };
  return Object.freeze({
    forDisclosure: (): TradeBalanceDisclosureV2Journal => createLinkTradeV2CreationJournal({ capability, deployment, store, purpose: 'disclosure' }),
    assertNoPending: () => { if (isCounter || purpose) return invalid(); return claim(); },
    beginDisclosure: async (value: TradeBalanceDisclosureV2Action) => {
      const disclosure = normalizeTradeBalanceDisclosureV2Action(value);
      if (purpose !== 'disclosure' || disclosure.owner !== scope.owner) invalid();
      await claim(undefined, undefined, undefined, disclosure);
    },
    beginCounter: async (value: CounterTradeV2Recovery) => {
      const counter = normalizeCounterTradeV2Recovery(value);
      if (!isCounter || purpose || counterTradeV2RecoveryOwner(counter) !== scope.owner || counter.material.root.chainId !== scope.chainId) invalid();
      await claim(undefined, undefined, counter);
    },
    finishCounterCleanup: async () => update(snapshot => {
      if (!snapshot.counter || ['cancel', 'decline'].includes(snapshot.counter.kind) || snapshot.records.some(r => r.state !== 'confirmed' || TERMINAL_STEPS.includes(r.step))) return invalid();
      return Object.freeze({ ...snapshot, abandoned: true as const });
    }),
    beginFill: async (value: LinkTradeV2FillRecovery) => {
      if (isCounter || purpose) invalid();
      const fill = normalizeLinkTradeV2FillRecovery(value);
      if (fill.reference.chainId !== scope.chainId || fill.reference.escrow !== scope.escrow || fill.maker === scope.owner) invalid();
      await claim(undefined, fill);
    },
    beginOwnerAction: async (value: LinkTradeV2OwnerAction, creationId?: string) => {
      if (isCounter || purpose) invalid();
      const ownerAction = normalizeOwnerAction(value);
      if (!creationId) return claim(ownerAction);
      await update(snapshot => {
        const token = snapshot.fill?.terms.requestToken ?? snapshot.recovery?.terms.offerToken;
        const code = snapshot.fill?.requestCodeHash ?? snapshot.recovery?.offerCodeHash;
        const privatePair = snapshot.fill?.terms.privatePair ?? snapshot.recovery?.terms.privatePair;
        if (currentId !== creationId || !token || snapshot.ownerAction || ownerAction.kind !== 'cleanup' || ownerAction.orderId ||
            ownerAction.offerToken !== token || ownerAction.privatePair !== privatePair || ownerAction.tokenCodeHash !== code ||
            snapshot.records.some(r => r.state !== 'confirmed' || ['create', 'fill'].includes(r.step))) return invalid();
        return Object.freeze({ ...snapshot, ownerAction });
      });
    },
    finishCleanup: async () => update(snapshot => {
      if (snapshot.ownerAction?.kind !== 'cleanup' || snapshot.records.some(r => r.state !== 'confirmed' || ['create', 'fill', 'cancel'].includes(r.step))) return invalid();
      return Object.freeze({ ...snapshot, abandoned: true as const });
    }),
    onRecovery: async (value: LinkTradeV2CreationRecovery) => {
      if (isCounter || purpose) invalid();
      const recovery = normalizeLinkTradeV2CreationRecovery(value);
      if (recovery.context.maker !== scope.owner || recovery.context.chainId !== scope.chainId || recovery.context.escrow !== scope.escrow) invalid();
      await update(snapshot => {
        if (snapshot.ownerAction || snapshot.fill || snapshot.counter || snapshot.disclosure) return invalid();
        if (snapshot.recovery) {
          if (JSON.stringify(snapshot.recovery) !== JSON.stringify(recovery)) invalid();
          return undefined;
        }
        return Object.freeze({ ...snapshot, recovery });
      });
    },
    onPending: async (value: LinkTradeV2CreationRecord) => {
      const captured: LinkTradeV2CreationRecord = structuredClone(value);
      await update(snapshot => {
        if (!snapshot.recovery && !snapshot.fill && !snapshot.ownerAction && !snapshot.counter && !snapshot.disclosure) return invalid();
        const record = normalizeRecord(captured, scope, snapshot);
        const hashes = [record.transactionHash, record.mined?.transactionHash].filter(Boolean);
        if (snapshot.records.some(r => r.nonce !== record.nonce && [r.transactionHash, r.mined?.transactionHash].some(h => h && hashes.includes(h)))) invalid();
        const old = snapshot.records.find(r => r.nonce === record.nonce);
        if (old && JSON.stringify(old) === JSON.stringify(record)) {
          if (record.state === 'sending') return invalid();
          return undefined;
        }
        if (old) {
          if (old.step !== record.step || old.to !== record.to || old.dataHash !== record.dataHash || (old.value ?? '0') !== (record.value ?? '0') || old.gasLimit !== record.gasLimit ||
              old.gasPrice !== record.gasPrice || (old.transactionHash && old.transactionHash !== record.transactionHash) ||
              JSON.stringify(old.admission) !== JSON.stringify(record.admission) || JSON.stringify(old.search) !== JSON.stringify(record.search) ||
              (old.mined && JSON.stringify(old.mined) !== JSON.stringify(record.mined)) ||
              (old.feeWei && (old.feeWei !== record.feeWei || old.gasUsed !== record.gasUsed || old.blockHash !== record.blockHash || old.blockNumber !== record.blockNumber)) ||
              ['confirmed', 'rejected', 'failed'].includes(old.state) ||
              (old.state === 'submitted' && !['submitted', 'confirmed', 'failed'].includes(record.state)) ||
              (old.state === 'sending' && record.state !== 'submitted' && record.state !== 'rejected')) invalid();
        } else if (record.state !== 'sending' || snapshot.records.some(r => r.state !== 'confirmed' || TERMINAL_STEPS.includes(r.step)) ||
            snapshot.records.some(r => r.step === record.step) || snapshot.records.some(r => r.nonce >= record.nonce)) invalid();
        return Object.freeze({ ...snapshot, records: Object.freeze([...snapshot.records.filter(r => r.nonce !== record.nonce), record]) });
      });
    },
    advanceSearch: async (nonce: number, value: NonNullable<LinkTradeV2CreationRecord['search']>): Promise<void> => {
      const search = Object.freeze({ ...value });
      return update(snapshot => {
        const old = snapshot.records[snapshot.records.length - 1];
        if (!old || old.nonce !== nonce || !['sending', 'submitted'].includes(old.state) || old.feeWei ||
            old.search && BigInt(search.throughBlock) <= BigInt(old.search.throughBlock)) return invalid();
        const next = normalizeRecord({ ...old, search }, scope, snapshot);
        return Object.freeze({ ...snapshot, records: Object.freeze([...snapshot.records.slice(0, -1), next]) });
      });
    },
    releaseUnsent: async () => {
      await update(snapshot => {
        if (snapshot.ownerAction && (snapshot.recovery || snapshot.fill) && !snapshot.records.some(r => r.step === snapshot.ownerAction!.kind)) {
          const { ownerAction: _action, ...creation } = snapshot; void _action; return Object.freeze(creation);
        }
        return snapshot.records.length || snapshot.abandoned ? undefined : Object.freeze({ ...snapshot, abandoned: true as const });
      });
    },
    read: async () => {
      if (!currentId) {
        const active = await store.active(lockKey);
        if (active && active.ownerKey !== ownerKey) return null;
      }
      const loaded = await load();
      return loaded ? Object.freeze({ id: loaded.row.id, active: Boolean(loaded.row.activeOwner), ...loaded.snapshot,
        feeWei: loaded.snapshot.records.reduce((sum, r) => sum + BigInt(r.feeWei ?? '0'), 0n).toString() }) : null;
    },
    close: () => store.close?.()
  });
};

export type PrivateBookV2RecoveryMeta = Readonly<{
  kind: PrivateBookV2Action['kind'];
  expectedEvent: 'PrivateOrderOpened' | 'PrivateOrderFilled' | 'PrivateOrderStatusChanged' | 'NativeCreditWithdrawn' | 'TradeBudgetVisibility';
  expectedOrderId?: string; expectedStatus?: string; expectedVisible?: boolean; approvalToken?: string; approvalPrivate?: boolean;
}>;
type BookFunding = Readonly<{ encoding: 'public'; action: PrivateBookV2Action }> | Readonly<{ encoding: 'sealed'; payload: string }>;
type BookSnapshot = Readonly<{ version: 1; scope: Scope; book: PrivateBookV2RecoveryMeta; funding?: BookFunding;
  abandoned?: true; cleanupOnly?: true; priorCleanup?: readonly LinkTradeV2CreationRecord[]; records: readonly LinkTradeV2CreationRecord[] }>;
export type PrivateBookV2RecoverySnapshot = Omit<BookSnapshot, 'funding'> & Readonly<{ id: string; active: boolean; feeWei: string }>;
const BOOK_FORMAT = 'ChainWhisperBookRecoveryPublicV1';
const bookKeys = (value: object, required: string[], optional: string[] = []) => {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).some(key => typeof key !== 'string' || !Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
        !Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value'))) invalid();
  keys(value, required, optional);
};
const normalizeBookMeta = (value: PrivateBookV2RecoveryMeta): PrivateBookV2RecoveryMeta => {
  bookKeys(value, ['kind', 'expectedEvent'], ['expectedOrderId', 'expectedStatus', 'expectedVisible', 'approvalToken', 'approvalPrivate']);
  const event = value.kind === 'create' || value.kind === 'replace' ? 'PrivateOrderOpened' : value.kind === 'fill' ? 'PrivateOrderFilled'
    : value.kind === 'cancel' || value.kind === 'reclaim-expired' ? 'PrivateOrderStatusChanged' : value.kind === 'withdraw-native-credit' ? 'NativeCreditWithdrawn'
    : value.kind === 'budget-visibility' ? 'TradeBudgetVisibility' : invalid();
  if (value.expectedEvent !== event || (['fill', 'cancel', 'reclaim-expired', 'budget-visibility'].includes(value.kind) !== (value.expectedOrderId !== undefined)) ||
      (value.expectedOrderId !== undefined && amount(value.expectedOrderId) === '0') ||
      value.expectedStatus !== (value.kind === 'cancel' ? '3' : value.kind === 'reclaim-expired' ? '4' : undefined) ||
      (value.kind === 'budget-visibility' ? typeof value.expectedVisible !== 'boolean' : value.expectedVisible !== undefined) ||
      (value.approvalToken !== undefined) !== (value.approvalPrivate !== undefined)) invalid();
  let approvalToken: string | undefined;
  if (value.approvalToken !== undefined) {
    approvalToken = getAddress(value.approvalToken).toLowerCase();
    if (BigInt(approvalToken) === 0n || typeof value.approvalPrivate !== 'boolean' || !['create', 'replace', 'fill'].includes(value.kind)) invalid();
  }
  return Object.freeze({ kind: value.kind, expectedEvent: event,
    ...(value.expectedOrderId === undefined ? {} : { expectedOrderId: value.expectedOrderId }),
    ...(value.expectedStatus === undefined ? {} : { expectedStatus: value.expectedStatus }),
    ...(value.expectedVisible === undefined ? {} : { expectedVisible: value.expectedVisible }),
    ...(approvalToken ? { approvalToken, approvalPrivate: value.approvalPrivate } : {}) });
};
const normalizeBookFunding = (value: unknown, meta: PrivateBookV2RecoveryMeta): PrivateBookV2Action => {
  const action = normalizePrivateBookV2RecoveryAction(value);
  if (action.kind !== meta.kind || !['create', 'replace', 'fill'].includes(action.kind)) invalid();
  if (action.kind === 'fill' && action.orderId !== meta.expectedOrderId) invalid();
  if (action.kind === 'create' || action.kind === 'replace') {
    if (action.offerAsset.assetType === 'native' ? meta.approvalToken !== undefined
      : action.offerAsset.token !== meta.approvalToken || (action.offerAsset.assetType === 'private-erc20') !== meta.approvalPrivate) invalid();
  }
  return action;
};
const bookApprovalOnly = (snapshot: Pick<BookSnapshot, 'book' | 'records'>) => Boolean(snapshot.book.approvalToken &&
  ['create', 'replace', 'fill'].includes(snapshot.book.kind) && snapshot.records.length &&
  snapshot.records.every(record => record.state === 'confirmed' && ['approval', 'approval-reset'].includes(record.step)));
const bookTerminal = (snapshot: BookSnapshot) => Boolean(snapshot.abandoned || snapshot.records.some(record =>
  record.step === 'cleanup' ? record.state === 'confirmed'
    : record.state === 'rejected' || record.state === 'failed' || record.step === snapshot.book.kind && record.state === 'confirmed'));
const bookFundingAad = (row: LinkTradeV2CreationStoredRow, scope: Scope, book: PrivateBookV2RecoveryMeta) =>
  JSON.stringify([BOOK_FORMAT, scope, row.id, row.ownerKey, row.createdAt, book]);

/** Public transaction metadata is not authenticated signing authority. Funding stays sealed when private.
 * Read/reconcile and funded exits never require the funding key. All sends still need fresh owner admission.
 */
export const createPrivateBookV2Journal = ({ capability, deployment, store = createIndexedDbLinkTradeV2CreationStore() }: {
  capability: OwnerTradeV2MetaMaskCapability; deployment: AttestedTradeHistoryV2Deployment<'private-v2'>; store?: LinkTradeV2CreationStore;
}) => {
  assertAttestedTradeHistoryV2Deployment(deployment, 'private-v2');
  const binding = getOwnerTradeV2CapabilityBinding(capability);
  const scope: Scope = Object.freeze({ chainId: binding.chainId.toString(), owner: getAddress(binding.ownerAddress).toLowerCase(),
    escrow: getAddress(deployment.contractAddress).toLowerCase(), runtimeHash: bytes(deployment.runtimeBytecodeHash) });
  if (scope.chainId !== deployment.chainId || BigInt(scope.owner) === 0n || BigInt(scope.escrow) === 0n) invalid();
  const lockKey = `${scope.chainId}:${scope.owner}`, ownerKey = `${lockKey}:book:${scope.escrow}`;
  let currentId: string | undefined;
  const open = async (row: LinkTradeV2CreationStoredRow): Promise<BookSnapshot> => {
    await assertOwnerTradeV2CapabilityCurrent(binding);
    if (row.ownerKey !== ownerKey || row.activeOwner !== undefined && row.activeOwner !== lockKey ||
        !Number.isSafeInteger(row.revision) || row.revision <= 0 || !Number.isSafeInteger(row.createdAt) || row.createdAt <= 0 ||
        typeof row.id !== 'string' || !/^[0-9a-f-]{36}$/.test(row.id) || typeof row.sealed !== 'string' || row.sealed.length > 1048576) invalid();
    const parsed = JSON.parse(row.sealed) as BookSnapshot & { format: string };
    bookKeys(parsed, ['format', 'version', 'scope', 'book', 'records'], ['funding', 'abandoned', 'cleanupOnly', 'priorCleanup']);
    bookKeys(parsed.scope, ['chainId', 'owner', 'escrow', 'runtimeHash']);
    if (parsed.format !== BOOK_FORMAT || parsed.version !== 1 || JSON.stringify(parsed.scope) !== JSON.stringify(scope) || !Array.isArray(parsed.records)) invalid();
    const book = normalizeBookMeta(parsed.book);
    if (['create', 'replace', 'fill'].includes(book.kind) !== Boolean(parsed.funding)) invalid();
    let funding: BookFunding | undefined;
    if (parsed.funding) {
      const raw = parsed.funding;
      if (raw.encoding === 'public') {
        bookKeys(raw, ['encoding', 'action']);
        const action = normalizeBookFunding(raw.action, book);
        if (privateBookV2RecoveryActionNeedsPrivacy(action)) invalid();
        funding = Object.freeze({ encoding: 'public', action });
      } else {
        bookKeys(raw, ['encoding', 'payload']);
        if (raw.encoding !== 'sealed' || typeof raw.payload !== 'string' || !/^0x01[0-9a-f]+$/.test(raw.payload) ||
            raw.payload.length % 2 !== 0 || raw.payload.length <= 60 || raw.payload.length > 524400) invalid();
        funding = Object.freeze({ encoding: 'sealed', payload: raw.payload });
      }
    }
    const records = parsed.records.map(record => normalizeRecord(record, scope, { book }));
    if (parsed.cleanupOnly !== undefined && parsed.cleanupOnly !== true || parsed.priorCleanup !== undefined && !Array.isArray(parsed.priorCleanup)) invalid();
    const priorCleanup = (parsed.priorCleanup ?? []).map(record => normalizeRecord(record, scope, { book }));
    if (priorCleanup.some(record => record.step !== 'cleanup' || !['rejected', 'failed'].includes(record.state) ||
        record.state === 'failed' && !['reverted', 'cancelled'].includes(record.mined?.outcome ?? ''))) invalid();
    // Earlier cleanup rows did not save this flag. Their reserved cleanup still forbids funding.
    const cleanupOnly = parsed.cleanupOnly === true || records.some(record => record.step === 'cleanup');
    if (priorCleanup.length && !cleanupOnly || cleanupOnly && !bookApprovalOnly({ book,
      records: records[records.length - 1]?.step === 'cleanup' ? records.slice(0, -1) : records })) invalid();
    if (records.some((record, index) => record.step === 'cleanup' && !bookApprovalOnly({ book, records: records.slice(0, index) }))) invalid();
    if (parsed.abandoned !== undefined && (parsed.abandoned !== true || records.length && !bookApprovalOnly({ book, records }))) invalid();
    if (new Set(records.map(record => record.nonce)).size !== records.length) invalid();
    const all = [...records, ...priorCleanup];
    const hashes = all.flatMap(record => [...new Set([record.transactionHash, record.mined?.transactionHash].filter((hash): hash is string => Boolean(hash)))]);
    if (new Set(hashes).size !== hashes.length) invalid();
    let consumedNonce = Math.max(-1, ...records.filter(record => record.step !== 'cleanup').map(record => record.nonce));
    for (const record of [...priorCleanup, ...records.filter(record => record.step === 'cleanup')]) {
      if (record.nonce <= consumedNonce) invalid();
      if (record.state !== 'rejected') consumedNonce = record.nonce;
    }
    for (let i = 1; i < records.length; i++) {
      if (records[i - 1].state !== 'confirmed' || records[i - 1].step === book.kind || records[i - 1].step === 'cleanup' || records[i - 1].nonce >= records[i].nonce ||
          records.slice(0, i).some(record => record.step === records[i].step)) invalid();
    }
    const snapshot: BookSnapshot = Object.freeze({ version: 1, scope, book, ...(funding ? { funding } : {}),
      ...(parsed.abandoned ? { abandoned: true as const } : {}), ...(cleanupOnly ? { cleanupOnly: true as const } : {}),
      ...(priorCleanup.length ? { priorCleanup: Object.freeze(priorCleanup) } : {}), records: Object.freeze(records) });
    if (Boolean(row.activeOwner) === bookTerminal(snapshot)) invalid();
    await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
    return snapshot;
  };
  const load = async () => {
    const row = currentId ? await store.read(currentId) : await store.active(lockKey) ?? await store.latest(ownerKey);
    if (!row || row.ownerKey !== ownerKey) return null;
    const snapshot = await open(row); currentId = row.id;
    return { row, snapshot };
  };
  const update = async (change: (snapshot: BookSnapshot) => BookSnapshot | undefined) => {
    const loaded = await load(); if (!loaded) return invalid();
    const { row, snapshot } = loaded, next = change(snapshot);
    if (!next) return;
    if (!row.activeOwner) invalid();
    const { activeOwner: _active, ...base } = row; void _active;
    const nextRow = Object.freeze({ ...base, ...(bookTerminal(next) ? {} : { activeOwner: lockKey }), revision: row.revision + 1,
      sealed: JSON.stringify({ format: BOOK_FORMAT, ...next }) });
    await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
    await store.replace(nextRow, row.revision);
  };
  return Object.freeze({
    beginBook: async (value: PrivateBookV2RecoveryMeta, material?: PrivateBookV2Action) => {
      const book = normalizeBookMeta(value), action = material === undefined ? undefined : normalizeBookFunding(material, book);
      if (['create', 'replace', 'fill'].includes(book.kind) !== Boolean(action)) invalid();
      await assertOwnerTradeV2CapabilityCurrent(binding);
      // Check before requesting privacy material; pending exits must not trigger an unlock prompt.
      if (await store.active(lockKey)) throw new Error('Another trade is pending for this wallet. Reconcile that trade first.');
      const row = { id: crypto.randomUUID(), ownerKey, activeOwner: lockKey, createdAt: Date.now(), revision: 1, sealed: '' };
      const funding: BookFunding | undefined = !action ? undefined : privateBookV2RecoveryActionNeedsPrivacy(action)
        ? Object.freeze({ encoding: 'sealed', payload: await encryptLinkCreationRecoveryForSigner(binding.signer, JSON.stringify(action), bookFundingAad(row, scope, book)) })
        : Object.freeze({ encoding: 'public', action });
      const snapshot: BookSnapshot = { version: 1, scope, book, ...(funding ? { funding } : {}), records: [] };
      await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
      await store.claim(Object.freeze({ ...row, sealed: JSON.stringify({ format: BOOK_FORMAT, ...snapshot }) })); currentId = row.id;
    },
    read: async (): Promise<PrivateBookV2RecoverySnapshot | null> => {
      const loaded = await load(); if (!loaded) return null;
      const { funding: _funding, ...publicSnapshot } = loaded.snapshot; void _funding;
      return Object.freeze({ ...publicSnapshot, id: loaded.row.id, active: Boolean(loaded.row.activeOwner),
        feeWei: [...loaded.snapshot.records, ...loaded.snapshot.priorCleanup ?? []].reduce((sum, record) => sum + BigInt(record.feeWei ?? '0'), 0n).toString() });
    },
    readFunding: async (): Promise<PrivateBookV2Action | undefined> => {
      const loaded = await load(); if (!loaded?.snapshot.funding) return undefined;
      const { funding, book } = loaded.snapshot;
      const action = normalizeBookFunding(funding.encoding === 'public' ? funding.action : JSON.parse(await decryptLinkCreationRecoveryForSigner(
        binding.signer, funding.payload, bookFundingAad(loaded.row, scope, book))), book);
      await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
      return action;
    },
    onPending: async (value: LinkTradeV2CreationRecord) => {
      const captured = structuredClone(value);
      await update(snapshot => {
        const record = normalizeRecord(captured, scope, { book: snapshot.book });
        if (snapshot.cleanupOnly && record.step !== 'cleanup') invalid();
        const hashes = [record.transactionHash, record.mined?.transactionHash].filter(Boolean);
        if ([...snapshot.records.filter(old => old.nonce !== record.nonce), ...snapshot.priorCleanup ?? []].some(old =>
          [old.transactionHash, old.mined?.transactionHash].some(hash => hash && hashes.includes(hash)))) invalid();
        const old = snapshot.records.find(candidate => candidate.nonce === record.nonce);
        if (old && JSON.stringify(old) === JSON.stringify(record)) {
          if (record.state === 'sending') invalid();
          return undefined;
        }
        if (old) {
          if (old.step !== record.step || old.to !== record.to || old.dataHash !== record.dataHash || (old.value ?? '0') !== (record.value ?? '0') ||
              old.gasLimit !== record.gasLimit || old.gasPrice !== record.gasPrice || old.transactionHash && old.transactionHash !== record.transactionHash ||
              JSON.stringify(old.admission) !== JSON.stringify(record.admission) || JSON.stringify(old.search) !== JSON.stringify(record.search) ||
              old.mined && JSON.stringify(old.mined) !== JSON.stringify(record.mined) ||
              old.feeWei && (old.feeWei !== record.feeWei || old.gasUsed !== record.gasUsed || old.blockHash !== record.blockHash || old.blockNumber !== record.blockNumber) ||
              ['confirmed', 'rejected', 'failed'].includes(old.state) || old.state === 'submitted' && !['submitted', 'confirmed', 'failed'].includes(record.state) ||
              old.state === 'sending' && record.state !== 'submitted' && record.state !== 'rejected') invalid();
        } else if (record.state !== 'sending' || record.step === 'cleanup' && (!snapshot.cleanupOnly || !bookApprovalOnly(snapshot)) ||
            snapshot.priorCleanup?.some(old => old.state === 'failed' && old.nonce >= record.nonce) ||
            snapshot.records.some(old => old.state !== 'confirmed' || old.step === snapshot.book.kind || old.step === 'cleanup' || old.step === record.step || old.nonce >= record.nonce)) invalid();
        return Object.freeze({ ...snapshot, records: Object.freeze([...snapshot.records.filter(old => old.nonce !== record.nonce), record]) });
      });
    },
    releaseUnsent: async () => update(snapshot => snapshot.records.length || snapshot.abandoned ? undefined : Object.freeze({ ...snapshot, abandoned: true as const })),
    beginCleanup: async (id: string) => {
      const loaded = await load();
      if (!loaded || loaded.row.id !== id || !loaded.row.activeOwner) invalid();
      await update(snapshot => {
        const last = snapshot.records[snapshot.records.length - 1];
        const retry = last?.step === 'cleanup';
        const approvals = retry ? snapshot.records.slice(0, -1) : snapshot.records;
        if (!bookApprovalOnly({ book: snapshot.book, records: approvals }) || retry && (!['rejected', 'failed'].includes(last.state) ||
            last.state === 'failed' && !['reverted', 'cancelled'].includes(last.mined?.outcome ?? ''))) invalid();
        if (!retry && snapshot.cleanupOnly) return undefined;
        return Object.freeze({ ...snapshot, cleanupOnly: true as const, records: Object.freeze(approvals),
          ...(retry ? { priorCleanup: Object.freeze([...snapshot.priorCleanup ?? [], last]) } : {}) });
      });
    },
    finishPreparation: async (id: string) => {
      const loaded = await load();
      if (!loaded || loaded.row.id !== id || !loaded.row.activeOwner || !bookApprovalOnly(loaded.snapshot)) invalid();
      await update(snapshot => {
        if (!bookApprovalOnly(snapshot)) return invalid();
        return Object.freeze({ ...snapshot, abandoned: true as const });
      });
    },
    advanceSearch: async (nonce: number, value: NonNullable<LinkTradeV2CreationRecord['search']>) => {
      const search = Object.freeze({ ...value });
      await update(snapshot => {
        const old = snapshot.records[snapshot.records.length - 1];
        if (!old || old.nonce !== nonce || !['sending', 'submitted'].includes(old.state) || old.feeWei ||
            old.search && BigInt(search.throughBlock) <= BigInt(old.search.throughBlock)) invalid();
        const record = normalizeRecord({ ...old, search }, scope, { book: snapshot.book });
        return Object.freeze({ ...snapshot, records: Object.freeze([...snapshot.records.slice(0, -1), record]) });
      });
    },
    close: () => store.close?.()
  });
};
