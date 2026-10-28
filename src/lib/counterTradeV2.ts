import { AbiCoder, Interface, getAddress, keccak256 } from '@coti-io/coti-ethers';
import { COUNTER_TRADE_V2_ABI } from './counterTradeV2Abi';
import { LINK_TRADE_V2_ABI } from './linkTradeV2Abi';
import { STANDARD_TRADE_V2_ACTION_ABI } from './standardTradeV2Actions';
import { readLinkTradeV2CounterMaterial, type LinkTradeV2CounterMaterial, type LinkTradeV2Deployment, type LinkTradeV2Review } from './linkTradeV2';
import { normalizeLinkTradeV2Reference, type LinkTradeV2Reference } from './linkTradeV2Terms';
import { assertAttestedTradeHistoryV2Deployment, readAttestedTradeHistoryV2View,
  type AttestedTradeHistoryV2Deployment, type TradeHistoryV2ReadCapability } from './tradeHistoryV2Chain';
import { getOwnerTradeV2CapabilityBinding, assertOwnerTradeV2CapabilityCurrent, assertOwnerTradeV2CapabilitySnapshotCurrent,
  type OwnerTradeV2MetaMaskCapability } from './ownerTradeV2Capability';
import { encryptPrivateUint256Input, decryptPrivateUint256Output } from './privateUint256';

const ABI = new Interface(COUNTER_TRADE_V2_ABI), LINK = new Interface(LINK_TRADE_V2_ABI), STANDARD = new Interface(STANDARD_TRADE_V2_ACTION_ABI);
const REFERENCE = 'tuple(uint256 chainId,address escrow,uint256 id,uint64 revision,uint64 credentialEpoch)';
export type CounterTradeV2Deployment = AttestedTradeHistoryV2Deployment<'counter-v2'>;
export type CounterTradeV2ParentDeployment = LinkTradeV2Deployment | AttestedTradeHistoryV2Deployment<'private-v2' | 'standard-v2'>;
export type CounterTradeV2Context = Readonly<{ readCapability: TradeHistoryV2ReadCapability; deployment: CounterTradeV2Deployment;
  parentDeployment: CounterTradeV2ParentDeployment; parentDeployments?: readonly CounterTradeV2ParentDeployment[]; capability: OwnerTradeV2MetaMaskCapability; privateOnly?: boolean; publicOnly?: boolean; recoveryOnly?: boolean }>;
export const assertCounterTradeV2ModeAdmission = (input: Pick<CounterTradeV2Context, 'privateOnly' | 'publicOnly' | 'recoveryOnly'>, privatePair: boolean): void => {
  if (input.recoveryOnly === true) throw new Error('Counter trading is not enabled.');
  if (input.privateOnly === true && !privatePair) throw new Error('Public counteroffers are not enabled.');
  if (input.publicOnly === true && privatePair) throw new Error('Private counteroffers are not enabled.');
};
export type CounterTradeV2Parent = LinkTradeV2Review | { proposalId: string } | Readonly<{
  bookReference: LinkTradeV2Reference; maker: string; offerToken: string; requestToken: string }>;
export type CounterTradeV2Amounts = Readonly<{ offer: string; request: string; expiresAt: string }>;
export type CounterTradeV2Material = CounterTradeV2Amounts & Readonly<{
  root: LinkTradeV2Reference; rootCodeHash: string; parentProposal: string; depth: number;
  maker: string; taker: string; offerToken: string; requestToken: string; offerCodeHash: string; requestCodeHash: string; privatePair: boolean;
}>;
export type CounterTradeV2Proposal = CounterTradeV2Material & Readonly<{ id: string; status: number; effectiveStatus: number; offerLocked: boolean }>;
export const counterTradeV2MaterialOf = (proposal: CounterTradeV2Proposal): CounterTradeV2Material => {
  const { id: _id, status: _status, effectiveStatus: _effective, offerLocked: _locked, ...material } = proposal;
  void _id; void _status; void _effective; void _locked;
  return normalizeCounterTradeV2Material(material);
};
export const counterTradeV2RootKey = (ref: LinkTradeV2Reference) => keccak256(AbiCoder.defaultAbiCoder().encode([REFERENCE], [normalizeCounterTradeV2Reference(ref)]));
export const counterTradeV2Uint = (v: string, bits = 256, positive = false) => {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(v) || BigInt(v) >= (1n << BigInt(bits)) || positive && v === '0') throw new Error('Invalid counter amount or identity.');
  return v;
};
const address = (v: string) => { const result = getAddress(v).toLowerCase(); if (BigInt(result) === 0n) throw new Error('Invalid counter address.'); return result; };
const normalizeCounterTradeV2Reference = (ref: LinkTradeV2Reference): LinkTradeV2Reference => {
  const fields = ['chainId', 'escrow', 'id', 'revision', 'credentialEpoch'];
  if (!ref || Object.keys(ref).length !== fields.length || fields.some(k => !Object.prototype.hasOwnProperty.call(ref, k))) throw new Error('Invalid counter reference.');
  return Object.freeze({ chainId: counterTradeV2Uint(ref.chainId, 256, true), escrow: address(ref.escrow),
    id: counterTradeV2Uint(ref.id, 256, true), revision: counterTradeV2Uint(ref.revision, 64, true), credentialEpoch: counterTradeV2Uint(ref.credentialEpoch, 64) });
};
const hash = (v: string) => { if (!/^0x[0-9a-fA-F]{64}$/.test(v) || BigInt(v) === 0n) throw new Error('Invalid counter code identity.'); return v.toLowerCase(); };
export const normalizeCounterTradeV2Material = (v: CounterTradeV2Material): CounterTradeV2Material => {
  const fields = ['offer', 'request', 'expiresAt', 'root', 'rootCodeHash', 'parentProposal', 'depth', 'maker', 'taker', 'offerToken', 'requestToken', 'offerCodeHash', 'requestCodeHash', 'privatePair'];
  if (!v || Object.keys(v).length !== fields.length || fields.some(k => !Object.prototype.hasOwnProperty.call(v, k)) ||
      !Number.isInteger(v.depth) || v.depth < 1 || v.depth > 16 || typeof v.privatePair !== 'boolean') throw new Error('Invalid counter recovery terms.');
  const material = Object.freeze({ root: normalizeCounterTradeV2Reference(v.root), rootCodeHash: hash(v.rootCodeHash),
    parentProposal: counterTradeV2Uint(v.parentProposal), depth: v.depth, maker: address(v.maker), taker: address(v.taker),
    offerToken: address(v.offerToken), requestToken: address(v.requestToken), offerCodeHash: hash(v.offerCodeHash), requestCodeHash: hash(v.requestCodeHash),
    privatePair: v.privatePair, offer: counterTradeV2Uint(v.offer, 128, true), request: counterTradeV2Uint(v.request, 128, true), expiresAt: counterTradeV2Uint(v.expiresAt, 64) });
  if (material.maker === material.taker || material.offerToken === material.requestToken || (material.parentProposal === '0') !== (material.depth === 1)) throw new Error('Invalid counter parties or depth.');
  return material;
};
export const counterTradeV2ParentDeployment = (input: CounterTradeV2Context, escrow = input.parentDeployment.contractAddress): CounterTradeV2ParentDeployment => {
  const parents = [input.parentDeployment, ...(input.parentDeployments ?? [])].filter(p => p.contractAddress.toLowerCase() === escrow.toLowerCase());
  const parent = parents[0];
  if (!parent || !['link-v2', 'private-v2', 'standard-v2'].includes(parent.protocol) || parents.some(p => p.protocol !== parent.protocol || p.runtimeBytecodeHash !== parent.runtimeBytecodeHash) ||
      parent.chainId !== input.deployment.chainId) throw new Error('Counter parent is not an admitted deployment.');
  assertAttestedTradeHistoryV2Deployment(parent, parent.protocol);
  return parent;
};
export const readCounterTradeV2View = async (input: CounterTradeV2Context, name: string, args: readonly unknown[], parent = false, parentEscrow?: string) => {
  const deployment = parent ? counterTradeV2ParentDeployment(input, parentEscrow) : input.deployment;
  const abi = parent ? deployment.protocol === 'standard-v2' && name === 'getTradeView' ? STANDARD : LINK : ABI;
  assertAttestedTradeHistoryV2Deployment(deployment, parent ? deployment.protocol : 'counter-v2');
  const binding = getOwnerTradeV2CapabilityBinding(input.capability);
  await assertOwnerTradeV2CapabilityCurrent(binding);
  if (binding.chainId.toString() !== deployment.chainId || input.parentDeployment.chainId !== input.deployment.chainId) throw new Error('Counter wallet and deployment chains differ.');
  const raw = await readAttestedTradeHistoryV2View({ capability: input.readCapability, deployment,
    data: abi.encodeFunctionData(name, args), ...(name === 'getTermsForAccount' ? { from: binding.ownerAddress.toLowerCase() } :
      name === 'admitCounter' ? { from: input.deployment.contractAddress } : {}) });
  const decoded = abi.decodeFunctionResult(name, raw);
  if (abi.encodeFunctionResult(name, decoded).toLowerCase() !== raw.toLowerCase()) throw new Error('Invalid counter response.');
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return decoded;
};

/** Participant terms remain readable after closure; cancellation does not require a live parent. */
export const readCounterTradeV2Proposal = async (input: CounterTradeV2Context & { proposalId: string }): Promise<CounterTradeV2Proposal> => {
  const id = counterTradeV2Uint(input.proposalId, 256, true), binding = getOwnerTradeV2CapabilityBinding(input.capability);
  const [p, amounts, effective] = await readCounterTradeV2View(input, 'getCounter', [id]);
  const owner = binding.ownerAddress.toLowerCase();
  if (![p.maker.toLowerCase(), p.taker.toLowerCase()].includes(owner)) throw new Error('Counter terms are available only to its participants.');
  if (p.status < 1n || p.status > 6n || effective < 1n || effective > 6n || p.offerLocked !== (p.status === 1n)) throw new Error('Invalid counter status.');
  const [root] = await readCounterTradeV2View(input, 'getCounterRoot', [p.rootKey]);
  const reference = normalizeCounterTradeV2Reference({ chainId: root.ref.chainId.toString(), escrow: root.ref.escrow,
    id: root.ref.id.toString(), revision: root.ref.revision.toString(), credentialEpoch: root.ref.credentialEpoch.toString() });
  const parent = counterTradeV2ParentDeployment(input, reference.escrow);
  if (parent.protocol === 'link-v2') normalizeLinkTradeV2Reference(reference);
  if (reference.chainId !== input.deployment.chainId || parent.protocol !== 'link-v2' && (reference.credentialEpoch !== '0' || p.privatePair !== (parent.protocol === 'private-v2')) ||
      root.parentCodeHash.toLowerCase() !== parent.runtimeBytecodeHash || counterTradeV2RootKey(reference) !== p.rootKey.toLowerCase()) throw new Error('Counter root does not match its admitted parent.');
  const c = root.context, odd = Number(p.depth) % 2 === 1;
  if (c.privatePair !== p.privatePair || c.revision !== root.ref.revision || c.credentialEpoch !== root.ref.credentialEpoch ||
      (odd ? p.taker : p.maker).toLowerCase() !== c.maker.toLowerCase() ||
      p.offerToken.toLowerCase() !== (odd ? c.requestToken : c.offerToken).toLowerCase() ||
      p.requestToken.toLowerCase() !== (odd ? c.offerToken : c.requestToken).toLowerCase() ||
      p.offerCodeHash.toLowerCase() !== (odd ? c.requestCodeHash : c.offerCodeHash).toLowerCase() ||
      p.requestCodeHash.toLowerCase() !== (odd ? c.offerCodeHash : c.requestCodeHash).toLowerCase()) throw new Error('Counter parties or tokens do not match its root.');
  let offer = amounts.offer.toString(), request = amounts.request.toString();
  if (p.privatePair) {
    if (offer !== '0' || request !== '0') throw new Error('Private counter exposes public terms.');
    const [terms] = await readCounterTradeV2View(input, 'getTermsForAccount', [id]);
    if (!terms.initialized) throw new Error('Private counter terms are unavailable.');
    offer = decryptPrivateUint256Output(binding.signer, terms.offer.userCiphertext).toString();
    request = decryptPrivateUint256Output(binding.signer, terms.request.userCiphertext).toString();
  }
  const material = normalizeCounterTradeV2Material({ root: reference, rootCodeHash: root.parentCodeHash, parentProposal: p.parentProposal.toString(), depth: Number(p.depth),
    maker: p.maker, taker: p.taker, offerToken: p.offerToken, requestToken: p.requestToken, offerCodeHash: p.offerCodeHash, requestCodeHash: p.requestCodeHash,
    privatePair: p.privatePair, offer, request, expiresAt: p.expiresAt.toString() });
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({ ...material, id, status: Number(p.status), effectiveStatus: Number(effective), offerLocked: p.offerLocked as boolean });
};

export const reviewCounterTradeV2Proposal = async (input: CounterTradeV2Context & { amounts: CounterTradeV2Amounts;
  parent: CounterTradeV2Parent }): Promise<Readonly<{ material: CounterTradeV2Material; link?: LinkTradeV2CounterMaterial }>> => {
  // A child derives its mode from the authenticated parent; Book mode comes from its admitted protocol.
  if (input.recoveryOnly || 'terms' in input.parent) assertCounterTradeV2ModeAdmission(input, 'terms' in input.parent ? input.parent.terms.privatePair : true);
  const binding = getOwnerTradeV2CapabilityBinding(input.capability), maker = binding.ownerAddress.toLowerCase();
  await assertOwnerTradeV2CapabilityCurrent(binding);
  let base: Omit<CounterTradeV2Material, keyof CounterTradeV2Amounts>, link: LinkTradeV2CounterMaterial | undefined;
  if ('proposalId' in input.parent) {
    const p = await readCounterTradeV2Proposal({ ...input, proposalId: input.parent.proposalId });
    if (p.status !== 1 || p.effectiveStatus !== 1 || p.taker !== maker || p.depth >= 16) throw new Error('Counter is not open for a child proposal from this wallet.');
    base = { root: p.root, rootCodeHash: p.rootCodeHash, parentProposal: p.id, depth: p.depth + 1, maker, taker: p.maker,
      offerToken: p.requestToken, requestToken: p.offerToken, offerCodeHash: p.requestCodeHash, requestCodeHash: p.offerCodeHash, privatePair: p.privatePair };
  } else if ('bookReference' in input.parent) {
    const reference = normalizeCounterTradeV2Reference(input.parent.bookReference), parent = counterTradeV2ParentDeployment(input, reference.escrow);
    if (!['private-v2', 'standard-v2'].includes(parent.protocol) || reference.chainId !== parent.chainId || reference.credentialEpoch !== '0') throw new Error('Invalid Book reference.');
    const [context] = await readCounterTradeV2View(input, 'getCounterContext', [reference.id], true, reference.escrow);
    if (context.privatePair !== (parent.protocol === 'private-v2') || !context.open || context.revision.toString() !== reference.revision || context.credentialEpoch !== 0n ||
        context.maker.toLowerCase() !== address(input.parent.maker) || context.offerToken.toLowerCase() !== address(input.parent.offerToken) ||
        context.requestToken.toLowerCase() !== address(input.parent.requestToken)) throw new Error('Counter parent changed after review.');
    base = { root: reference, rootCodeHash: parent.runtimeBytecodeHash, parentProposal: '0', depth: 1, maker, taker: context.maker.toLowerCase(),
      offerToken: context.requestToken.toLowerCase(), requestToken: context.offerToken.toLowerCase(), offerCodeHash: context.requestCodeHash.toLowerCase(),
      requestCodeHash: context.offerCodeHash.toLowerCase(), privatePair: context.privatePair as boolean };
  } else {
    link = await readLinkTradeV2CounterMaterial(input.parent);
    base = { root: link.reference, rootCodeHash: input.parentDeployment.runtimeBytecodeHash, parentProposal: '0', depth: 1, maker, taker: link.maker,
      offerToken: link.terms.requestToken, requestToken: link.terms.offerToken, offerCodeHash: link.requestCodeHash, requestCodeHash: link.offerCodeHash, privatePair: link.terms.privatePair };
  }
  const material = normalizeCounterTradeV2Material({ ...base, ...input.amounts });
  await recheckCounterTradeV2Proposal(input, material, false);
  return Object.freeze({ material, ...(link ? { link } : {}) });
};

export const recheckCounterTradeV2Proposal = async (input: CounterTradeV2Context, value: CounterTradeV2Material, authorized = true, accepting = false) => {
  const m = normalizeCounterTradeV2Material(value);
  assertCounterTradeV2ModeAdmission(input, m.privatePair);
  const binding = getOwnerTradeV2CapabilityBinding(input.capability);
  const parent = counterTradeV2ParentDeployment(input, m.root.escrow);
  if (parent.protocol === 'link-v2') normalizeLinkTradeV2Reference(m.root);
  if (binding.ownerAddress.toLowerCase() !== (accepting ? m.taker : m.maker) || m.root.chainId !== input.deployment.chainId ||
      m.rootCodeHash !== parent.runtimeBytecodeHash || parent.protocol !== 'link-v2' && (m.root.credentialEpoch !== '0' || m.privatePair !== (parent.protocol === 'private-v2'))) throw new Error('Counter review belongs to another wallet or deployment.');
  const [target] = await readCounterTradeV2View(input, 'counterEscrow', [], true, m.root.escrow), [targetHash] = await readCounterTradeV2View(input, 'counterEscrowCodeHash', [], true, m.root.escrow);
  const [parentHash] = await readCounterTradeV2View(input, 'approvedParentCodeHash', [m.root.escrow]);
  if (target.toLowerCase() !== input.deployment.contractAddress || targetHash.toLowerCase() !== input.deployment.runtimeBytecodeHash || parentHash.toLowerCase() !== m.rootCodeHash) throw new Error('Counter and parent runtime bindings differ.');
  const [context] = await readCounterTradeV2View(input, authorized && m.parentProposal === '0' ? 'admitCounter' : 'getCounterContext',
    authorized && m.parentProposal === '0' ? [m.root, m.maker] : [m.root.id], true, m.root.escrow);
  const odd = m.depth % 2 === 1;
  if (!context.open || context.privatePair !== m.privatePair || context.revision.toString() !== m.root.revision || context.credentialEpoch.toString() !== m.root.credentialEpoch ||
      (odd ? m.taker : m.maker) !== context.maker.toLowerCase() || m.offerToken !== (odd ? context.requestToken : context.offerToken).toLowerCase() ||
      m.requestToken !== (odd ? context.offerToken : context.requestToken).toLowerCase() || m.offerCodeHash !== (odd ? context.requestCodeHash : context.offerCodeHash).toLowerCase() ||
      m.requestCodeHash !== (odd ? context.offerCodeHash : context.requestCodeHash).toLowerCase()) throw new Error('Counter parent changed after review.');
  const [winner] = await readCounterTradeV2View(input, 'winner', [counterTradeV2RootKey(m.root)]);
  if (winner !== 0n) throw new Error('A counter already settled this root.');
  if (m.parentProposal !== '0') {
    const parent = await readCounterTradeV2Proposal({ ...input, proposalId: m.parentProposal });
    if (parent.status !== 1 || parent.effectiveStatus !== 1 || parent.taker !== m.maker || parent.maker !== m.taker || parent.depth + 1 !== m.depth ||
        counterTradeV2RootKey(parent.root) !== counterTradeV2RootKey(m.root)) throw new Error('Counter parent is no longer available.');
  }
};

export const recheckCounterTradeV2Acceptance = async (input: CounterTradeV2Context, proposalId: string, material: CounterTradeV2Material) => {
  const current = await readCounterTradeV2Proposal({ ...input, proposalId });
  if (current.status !== 1 || current.effectiveStatus !== 1 || !current.offerLocked ||
      JSON.stringify(counterTradeV2MaterialOf(current)) !== JSON.stringify(normalizeCounterTradeV2Material(material))) throw new Error('Counter changed after acceptance review.');
  await recheckCounterTradeV2Proposal(input, material, false, true);
};
/** The Standard parent revision binds its public remaining refund before Accept. */
export const readCounterTradeV2RootRefund = async (input: CounterTradeV2Context, material: CounterTradeV2Material): Promise<string | undefined> => {
  if (counterTradeV2ParentDeployment(input, material.root.escrow).protocol !== 'standard-v2') return undefined;
  const [view] = await readCounterTradeV2View(input, 'getTradeView', [material.root.id], true, material.root.escrow);
  const odd = material.depth % 2 === 1, trade = view.trade;
  if (material.privatePair || material.root.credentialEpoch !== '0' || trade.status !== 1n || view.effectiveStatus !== 1n || !trade.offerLocked ||
      view.fillState.revision.toString() !== material.root.revision || trade.maker.toLowerCase() !== (odd ? material.taker : material.maker) ||
      trade.offerAsset.assetType !== 1n || trade.requestAsset.assetType !== 1n ||
      trade.offerAsset.token.toLowerCase() !== (odd ? material.requestToken : material.offerToken) ||
      trade.requestAsset.token.toLowerCase() !== (odd ? material.offerToken : material.requestToken) ||
      trade.offerTokenCodeHash.toLowerCase() !== (odd ? material.requestCodeHash : material.offerCodeHash) ||
      trade.requestTokenCodeHash.toLowerCase() !== (odd ? material.offerCodeHash : material.requestCodeHash) ||
      view.fillState.remainingOfferAmount > trade.offerAsset.amount) throw new Error('Counter parent refund changed after review.');
  return counterTradeV2Uint(view.fillState.remainingOfferAmount.toString(), 128, true);
};
export const prepareCounterTradeV2Acceptance = async (input: CounterTradeV2Context, proposalId: string, material: CounterTradeV2Material) => {
  await recheckCounterTradeV2Acceptance(input, proposalId, material);
  const binding = getOwnerTradeV2CapabilityBinding(input.capability), name = material.privatePair ? 'acceptPrivateCounter' : 'acceptPublicCounter';
  const encrypt = async (value: string) => {
    await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
    return encryptPrivateUint256Input(binding.signer, BigInt(value), input.deployment.contractAddress, ABI.getFunction(name)!.selector);
  };
  const args = material.privatePair ? [proposalId, await encrypt(material.offer), await encrypt(material.request)] : [proposalId, [material.offer, material.request]];
  await recheckCounterTradeV2Acceptance(input, proposalId, material);
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({ to: input.deployment.contractAddress, data: ABI.encodeFunctionData(name, args) });
};

/** Inputs are fresh on every continuation; only unsigned terms enter recovery storage. */
export const prepareCounterTradeV2Proposal = async (input: CounterTradeV2Context, material: CounterTradeV2Material) => {
  const m = normalizeCounterTradeV2Material(material);
  await recheckCounterTradeV2Proposal(input, m);
  const binding = getOwnerTradeV2CapabilityBinding(input.capability), child = m.parentProposal !== '0';
  const name = m.privatePair ? child ? 'createPrivateChild' : 'createPrivateCounter' : child ? 'createPublicChild' : 'createPublicCounter';
  const encrypt = async (value: string) => {
    await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
    return encryptPrivateUint256Input(binding.signer, BigInt(value), input.deployment.contractAddress, ABI.getFunction(name)!.selector);
  };
  const amounts = m.privatePair ? [await encrypt(m.offer), await encrypt(m.request)] : [[m.offer, m.request]];
  await recheckCounterTradeV2Proposal(input, m);
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({ to: input.deployment.contractAddress, data: ABI.encodeFunctionData(name, [child ? m.parentProposal : m.root, ...amounts, m.expiresAt]) });
};
