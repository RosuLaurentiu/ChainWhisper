import { Interface } from '@coti-io/coti-ethers';
import { LINK_TRADE_V2_ABI } from './linkTradeV2Abi';
import {
  deriveLinkTradeV2Credential, linkTradeV2CredentialDomain, normalizeLinkTradeV2Reference,
  normalizeLinkTradeV2Terms, openLinkTradeV2Terms, sealLinkTradeV2Terms,
  type LinkTradeV2Context, type LinkTradeV2Reference, type LinkTradeV2Terms
} from './linkTradeV2Terms';
import { createTradeAccessSecret } from './directTradeTerms';
import { buildLinkTradeV2Path } from './linkTradeV2Links';
import {
  assertAttestedTradeHistoryV2Deployment, readAttestedTradeHistoryV2View,
  type AttestedTradeHistoryV2Deployment, type TradeHistoryV2ReadCapability
} from './tradeHistoryV2Chain';
import {
  assertOwnerTradeV2CapabilityCurrent, assertOwnerTradeV2CapabilitySnapshotCurrent,
  getOwnerTradeV2CapabilityBinding, type OwnerTradeV2MetaMaskCapability
} from './ownerTradeV2Capability';
import { encryptPrivateUint256Input } from './privateUint256';

const ABI = new Interface(LINK_TRADE_V2_ABI);
export type LinkTradeV2Deployment = AttestedTradeHistoryV2Deployment<'link-v2'>;
declare const REVIEW: unique symbol;
export type LinkTradeV2Review = Readonly<{
  maker: string;
  reference: LinkTradeV2Reference;
  terms: LinkTradeV2Terms;
  readonly [REVIEW]: true;
}>;
type ReviewInput = Readonly<{
  capability: TradeHistoryV2ReadCapability;
  deployment: LinkTradeV2Deployment;
  reference: LinkTradeV2Reference;
  secret: string;
}>;
const REVIEWS = new WeakMap<object, ReviewInput & { context: LinkTradeV2Context; sealed: string; offerCodeHash: string; requestCodeHash: string }>();

/** A shared URL can predate a partial fill. Obtain a new review, never change an already reviewed call. */
export const readLinkTradeV2CurrentReview = async (input: ReviewInput): Promise<LinkTradeV2Review> => {
  assertAttestedTradeHistoryV2Deployment(input.deployment, 'link-v2');
  const reference = normalizeLinkTradeV2Reference(input.reference);
  if (reference.chainId !== input.deployment.chainId || reference.escrow !== input.deployment.contractAddress) throw new Error('Link reference does not match its attested deployment.');
  const raw = await readAttestedTradeHistoryV2View({ capability: input.capability, deployment: input.deployment,
    data: ABI.encodeFunctionData('getOrderView', [reference.id]) });
  const decoded = ABI.decodeFunctionResult('getOrderView', raw), order = decoded[0].order;
  if (ABI.encodeFunctionResult('getOrderView', decoded).toLowerCase() !== raw.toLowerCase() ||
      order.credentialEpoch.toString() !== reference.credentialEpoch || order.revision < BigInt(reference.revision)) throw new Error('Link credential or revision changed.');
  return readLinkTradeV2Review({ ...input, reference: { ...reference, revision: order.revision.toString() } });
};

/** Uses the existing canonical public reader; no owner wallet or encrypted input is needed. */
export const readLinkTradeV2Review = async (input: ReviewInput): Promise<LinkTradeV2Review> => {
  const { capability, deployment, secret } = input;
  assertAttestedTradeHistoryV2Deployment(deployment, 'link-v2');
  const reference = normalizeLinkTradeV2Reference(input.reference);
  if (reference.chainId !== deployment.chainId || reference.escrow !== deployment.contractAddress) {
    throw new Error('Link reference does not match its attested deployment.');
  }
  const data = ABI.encodeFunctionData('getOrderView', [BigInt(reference.id)]);
  const raw = await readAttestedTradeHistoryV2View({ capability, deployment, data });
  const decoded = ABI.decodeFunctionResult('getOrderView', raw);
  if (ABI.encodeFunctionResult('getOrderView', decoded).toLowerCase() !== raw.toLowerCase()) {
    throw new Error('Invalid Link order response.');
  }
  const view = decoded[0], order = view.order;
  if (order.revision.toString() !== reference.revision || order.credentialEpoch.toString() !== reference.credentialEpoch) {
    throw new Error('Link review is stale.');
  }
  if (order.status !== 1n || view.effectiveStatus !== 1n || !order.linkEnabled) {
    throw new Error('Link order is closed, expired or revoked.');
  }
  const context: LinkTradeV2Context = Object.freeze({ chainId: reference.chainId, escrow: reference.escrow,
    maker: order.maker.toLowerCase(), makerNonce: order.makerNonce, credentialEpoch: reference.credentialEpoch });
  if (linkTradeV2CredentialDomain(context) !== view.credentialDomain.toLowerCase()) {
    throw new Error('Link credential domain does not match its order.');
  }
  const terms = await openLinkTradeV2Terms(context, view.sealedTerms, secret);
  if (terms.offerToken !== order.offerToken.toLowerCase() || terms.requestToken !== order.requestToken.toLowerCase() ||
      terms.privatePair !== order.privatePair || terms.expiresAt !== order.expiresAt.toString()) {
    throw new Error('Link terms do not match the canonical order.');
  }
  if (terms.privatePair) {
    if (view.publicPrice.offer !== 0n || view.publicPrice.request !== 0n ||
        view.publicBudget !== 0n || view.publicRemaining !== 0n) throw new Error('Private Link exposes unexpected public amounts.');
  } else if (terms.priceOffer !== view.publicPrice.offer.toString() || terms.priceRequest !== view.publicPrice.request.toString()) {
    throw new Error('Link reviewed price does not match the public order.');
  }
  const review = Object.freeze({ reference, terms, maker: context.maker }) as LinkTradeV2Review;
  REVIEWS.set(review, Object.freeze({ capability, deployment, reference, secret, context, sealed: view.sealedTerms,
    offerCodeHash: order.offerCodeHash.toLowerCase(), requestCodeHash: order.requestCodeHash.toLowerCase() }));
  return review;
};

/** Preparation only: the sender must still admit fit/fees/allowance and retain submitted hashes before polling. */
export type LinkTradeV2FillMaterial = Readonly<{ reference: LinkTradeV2Reference; terms: LinkTradeV2Terms; secret: string;
  maker: string; offerCodeHash: string; requestCodeHash: string; maximumPayment: string }>;

export type LinkTradeV2CounterMaterial = Omit<LinkTradeV2FillMaterial, 'maximumPayment'>;
export const readLinkTradeV2CounterMaterial = async (review: LinkTradeV2Review): Promise<LinkTradeV2CounterMaterial> => {
  const state = review && REVIEWS.get(review);
  if (!state) throw new Error('Counter authorization requires the original Link review.');
  const fresh = await readLinkTradeV2Review(state), current = REVIEWS.get(fresh)!;
  if (current.sealed !== state.sealed || current.offerCodeHash !== state.offerCodeHash || current.requestCodeHash !== state.requestCodeHash ||
      JSON.stringify(fresh.terms) !== JSON.stringify(review.terms)) throw new Error('Link changed after counter review.');
  return Object.freeze({ reference: fresh.reference, terms: fresh.terms, secret: state.secret, maker: fresh.maker,
    offerCodeHash: state.offerCodeHash, requestCodeHash: state.requestCodeHash });
};

/** The credential is signed for Link itself. Counter never receives it. */
export const prepareLinkTradeV2CounterAuthorization = async ({ review, capability }: {
  review: LinkTradeV2Review; capability: OwnerTradeV2MetaMaskCapability;
}) => {
  const material = await readLinkTradeV2CounterMaterial(review), state = REVIEWS.get(review)!;
  const binding = getOwnerTradeV2CapabilityBinding(capability);
  await assertOwnerTradeV2CapabilityCurrent(binding);
  if (binding.chainId.toString() !== material.reference.chainId || binding.ownerAddress.toLowerCase() === material.maker) throw new Error('Invalid counter proposer.');
  const credential = await encryptPrivateUint256Input(binding.signer, await deriveLinkTradeV2Credential(state.context, state.secret),
    state.deployment.contractAddress, ABI.getFunction('authorizeCounter')!.selector);
  await readLinkTradeV2CounterMaterial(review);
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  return Object.freeze({ to: state.deployment.contractAddress, data: ABI.encodeFunctionData('authorizeCounter', [material.reference, credential]) });
};
type PreparedFill = Readonly<{ chainId: string; from: string; to: string; value: 0n; data: string; maximumPayment: string;
  reference: LinkTradeV2Reference; terms: LinkTradeV2Terms }>;
const FILLS = new WeakMap<object, () => Promise<void>>();
export const recheckLinkTradeV2Fill = async (prepared: PreparedFill) => {
  const check = FILLS.get(prepared);
  if (!check) throw new Error('Link fill requires the original preparation.');
  await check();
};
export const prepareLinkTradeV2Fill = async ({ review, capability, maximumPayment, onRecovery }: {
  review: LinkTradeV2Review;
  capability: OwnerTradeV2MetaMaskCapability;
  maximumPayment: string;
  onRecovery?: (material: LinkTradeV2FillMaterial) => Promise<void>;
}) => {
  const state = review && REVIEWS.get(review);
  if (!state) throw new Error('Link fill requires the original authenticated review.');
  if (typeof maximumPayment !== 'string' || !/^[1-9][0-9]{0,38}$/.test(maximumPayment) ||
      BigInt(maximumPayment) >= (1n << 128n)) throw new Error('Link maximum payment must be a positive uint128.');
  const maximum = BigInt(maximumPayment);
  const binding = getOwnerTradeV2CapabilityBinding(capability);
  await assertOwnerTradeV2CapabilityCurrent(binding);
  const owner = binding.ownerAddress.toLowerCase();
  if (binding.chainId.toString() !== review.reference.chainId || owner === state.context.maker) {
    throw new Error('Link fill wallet chain or participant is invalid.');
  }
  const recheck = async () => {
    const current = await readLinkTradeV2Review(state);
    const currentState = REVIEWS.get(current)!;
    if (currentState.sealed !== state.sealed || currentState.offerCodeHash !== state.offerCodeHash || currentState.requestCodeHash !== state.requestCodeHash || linkTradeV2CredentialDomain(currentState.context) !==
        linkTradeV2CredentialDomain(state.context) || JSON.stringify(current.terms) !== JSON.stringify(review.terms)) {
      throw new Error('Link order changed after review.');
    }
  };
  await recheck();
  await onRecovery?.(Object.freeze({ reference: review.reference, terms: review.terms, secret: state.secret,
    maker: state.context.maker, offerCodeHash: state.offerCodeHash, requestCodeHash: state.requestCodeHash, maximumPayment }));
  const functionName = review.terms.privatePair ? 'fillPrivateLink' : 'fillPublicLink';
  const selector = ABI.getFunction(functionName)!.selector;
  const encrypt = async (value: bigint) => {
    await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
    const encrypted = await encryptPrivateUint256Input(binding.signer, value, state.deployment.contractAddress, selector);
    await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
    return encrypted;
  };
  const credential = await encrypt(await deriveLinkTradeV2Credential(state.context, state.secret));
  const args = review.terms.privatePair
    ? [review.reference, credential, await encrypt(maximum), await encrypt(BigInt(review.terms.priceOffer)),
      await encrypt(BigInt(review.terms.priceRequest))]
    : [review.reference, credential, maximum, [review.terms.priceOffer, review.terms.priceRequest]];
  await recheck();
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  const prepared = Object.freeze({ chainId: review.reference.chainId, from: owner, to: state.deployment.contractAddress,
    value: 0n as const, data: ABI.encodeFunctionData(functionName, args), maximumPayment,
    reference: review.reference, terms: review.terms });
  FILLS.set(prepared, recheck);
  return prepared;
};

declare const CREATE: unique symbol;
export type PreparedLinkTradeV2Create = Readonly<{
  chainId: string; from: string; to: string; value: 0n; data: string;
  offerBudget: string; terms: LinkTradeV2Terms; readonly [CREATE]: true;
}>;
const CREATIONS = new WeakMap<object, Readonly<{ context: LinkTradeV2Context; secret: string; recheck: () => Promise<void> }>>();
export type LinkTradeV2CreationMaterial = Readonly<{
  context: LinkTradeV2Context; secret: string; terms: LinkTradeV2Terms; offerBudget: string; offerCodeHash: string;
}>;

export const recheckLinkTradeV2Create = async (prepared: PreparedLinkTradeV2Create): Promise<void> => {
  const state = prepared && CREATIONS.get(prepared);
  if (!state) throw new Error('Link creation requires the original preparation.');
  await state.recheck();
};

type CreateInput = {
  readCapability: TradeHistoryV2ReadCapability; deployment: LinkTradeV2Deployment;
  capability: OwnerTradeV2MetaMaskCapability; terms: LinkTradeV2Terms; offerBudget: string;
  onRecovery?: (material: LinkTradeV2CreationMaterial) => Promise<void>;
};
/** Preparation only. The admitted sender owns allowance, fit, hash retention and exact accounting. */
export const prepareLinkTradeV2Create = (input: CreateInput) => prepareCreation(input);

/** Retain only the unsigned domain and secret. Every COTI input and signature is fresh. */
export const prepareLinkTradeV2CreateRecovery = (input: Omit<CreateInput, 'terms' | 'offerBudget'> & {
  material: LinkTradeV2CreationMaterial;
}) => {
  linkTradeV2CredentialDomain(input.material.context);
  const material = Object.freeze({ context: Object.freeze({ ...input.material.context }), secret: input.material.secret,
    terms: normalizeLinkTradeV2Terms(input.material.terms), offerBudget: input.material.offerBudget, offerCodeHash: input.material.offerCodeHash });
  return prepareCreation({ ...input, terms: material.terms, offerBudget: material.offerBudget }, material);
};

const prepareCreation = async (input: CreateInput, recovery?: LinkTradeV2CreationMaterial): Promise<PreparedLinkTradeV2Create> => {
  const { readCapability, deployment, capability, offerBudget } = input;
  const terms = normalizeLinkTradeV2Terms(input.terms);
  if (typeof offerBudget !== 'string' || !/^[1-9][0-9]{0,38}$/.test(offerBudget) ||
      BigInt(offerBudget) >= (1n << 128n)) throw new Error('Link offer budget must be a positive uint128.');
  assertAttestedTradeHistoryV2Deployment(deployment, 'link-v2');
  const binding = getOwnerTradeV2CapabilityBinding(capability);
  await assertOwnerTradeV2CapabilityCurrent(binding);
  if (binding.chainId.toString() !== deployment.chainId) throw new Error('Link creation wallet and deployment chains differ.');
  if (recovery && (recovery.context.chainId !== deployment.chainId || recovery.context.escrow !== deployment.contractAddress ||
      recovery.context.maker !== binding.ownerAddress.toLowerCase() || recovery.context.credentialEpoch !== '1')) {
    throw new Error('Link recovery does not match the selected owner and deployment.');
  }
  const context: LinkTradeV2Context = recovery?.context ?? Object.freeze({ chainId: deployment.chainId, escrow: deployment.contractAddress,
    maker: binding.ownerAddress.toLowerCase(), makerNonce: createTradeAccessSecret(), credentialEpoch: '1' });
  const secret = recovery?.secret ?? createTradeAccessSecret();
  const sealedTerms = await sealLinkTradeV2Terms(context, terms, secret);
  const read = async (name: string, args: readonly unknown[]) => {
    const raw = await readAttestedTradeHistoryV2View({ capability: readCapability, deployment,
      data: ABI.encodeFunctionData(name, args) });
    const decoded = ABI.decodeFunctionResult(name, raw);
    if (ABI.encodeFunctionResult(name, decoded).toLowerCase() !== raw.toLowerCase()) throw new Error('Invalid Link creation admission response.');
    return decoded[0];
  };
  const nonceUnused = async () => {
    if (await read('usedMakerNonce', [context.maker, context.makerNonce])) throw new Error('Link maker nonce is already used.');
  };
  await nonceUnused();
  const tokensApproved = async () => {
    const approval = terms.privatePair ? 'approvedPrivateTokenCodeHash' : 'approvedPublicTokenCodeHash';
    let offerCodeHash = '';
    for (const token of [terms.offerToken, terms.requestToken]) {
      const codeHash = (await read(approval, [token]) as string).toLowerCase();
      if (BigInt(codeHash) === 0n) throw new Error('Link token is not approved for this privacy mode.');
      if (token === terms.offerToken) offerCodeHash = codeHash;
    }
    return offerCodeHash;
  };
  const offerCodeHash = await tokensApproved();
  if (recovery && recovery.offerCodeHash !== offerCodeHash) throw new Error('Link offer-token admission changed.');
  await input.onRecovery?.(Object.freeze({ context, secret, terms, offerBudget, offerCodeHash }));
  const name = terms.privatePair ? 'createPrivateLink' : 'createPublicLink';
  const selector = ABI.getFunction(name)!.selector;
  const encrypt = async (value: bigint) => {
    await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
    const encrypted = await encryptPrivateUint256Input(binding.signer, value, deployment.contractAddress, selector);
    await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
    return encrypted;
  };
  const config = { offerToken: terms.offerToken, requestToken: terms.requestToken,
    expiresAt: terms.expiresAt, makerNonce: context.makerNonce };
  const credential = await deriveLinkTradeV2Credential(context, secret);
  const args = terms.privatePair
    ? [config, await encrypt(BigInt(offerBudget)), await encrypt(BigInt(terms.priceOffer)),
      await encrypt(BigInt(terms.priceRequest)), await encrypt(credential), sealedTerms]
    : [config, BigInt(offerBudget), [terms.priceOffer, terms.priceRequest], await encrypt(credential), sealedTerms];
  await nonceUnused();
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  const prepared = Object.freeze({ chainId: deployment.chainId, from: context.maker, to: deployment.contractAddress,
    value: 0n as const, data: ABI.encodeFunctionData(name, args), offerBudget, terms }) as PreparedLinkTradeV2Create;
  CREATIONS.set(prepared, Object.freeze({ context, secret, recheck: async () => {
    await assertOwnerTradeV2CapabilityCurrent(binding);
    await nonceUnused();
    if (await tokensApproved() !== offerCodeHash) throw new Error('Link offer-token admission changed.');
  } }));
  return prepared;
};

/** Binds an already independently verified canonical receipt; this parser does not prove finality or accounting. */
export const parseLinkTradeV2CreationReceipt = ({ prepared, transactionHash, receipt }: {
  prepared: PreparedLinkTradeV2Create; transactionHash: string; receipt: unknown;
}) => {
  const state = prepared && CREATIONS.get(prepared);
  if (!state || !receipt || typeof receipt !== 'object') throw new Error('Link creation recovery needs its original preparation and receipt.');
  return bindLinkTradeV2CreationReceipt({ material: { ...state, terms: prepared.terms, offerBudget: prepared.offerBudget }, transactionHash, receipt });
};

/** Unsigned recovery material must come from the authenticated owner journal. No inputs are reused or sent. */
export const bindLinkTradeV2CreationReceipt = ({ material, transactionHash, receipt }: {
  material: Omit<LinkTradeV2CreationMaterial, 'offerCodeHash'>; transactionHash: string; receipt: unknown;
}) => {
  linkTradeV2CredentialDomain(material.context);
  const terms = normalizeLinkTradeV2Terms(material.terms);
  const state = material;
  const prepared = { from: material.context.maker, to: material.context.escrow, chainId: material.context.chainId,
    offerBudget: material.offerBudget, terms };
  const invalid = (): never => { throw new Error('Link creation receipt does not match the prepared trade.'); };
  if (!receipt || typeof receipt !== 'object' || material.context.credentialEpoch !== '1' ||
      !/^[1-9][0-9]{0,38}$/.test(material.offerBudget) || BigInt(material.offerBudget) >= (1n << 128n)) invalid();
  const record = receipt as Record<string, unknown>;
  const lower = (value: unknown) => typeof value === 'string' ? value.toLowerCase() : '';
  const hash = (value: unknown) => {
    const valueHash = lower(value);
    if (!/^0x[0-9a-f]{64}$/.test(valueHash) || BigInt(valueHash) === 0n) invalid();
    return valueHash;
  };
  const uint = (value: unknown) => {
    if (!(typeof value === 'bigint' && value >= 0n) &&
        !(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) &&
        !(typeof value === 'string' && /^(0|[1-9][0-9]*|0x[0-9a-fA-F]+)$/.test(value))) invalid();
    return BigInt(value as bigint);
  };
  const txHash = hash(transactionHash), blockHash = hash(record.blockHash), blockNumber = uint(record.blockNumber);
  if (uint(record.status) !== 1n || hash(record.hash ?? record.transactionHash) !== txHash || blockNumber === 0n ||
      lower(record.from) !== prepared.from || lower(record.to) !== prepared.to || !Array.isArray(record.logs)) invalid();
  const topic = ABI.getEvent('LinkOpened')!.topicHash;
  let match: { id: string; logIndex: string } | undefined;
  for (const entry of record.logs as unknown[]) {
    if (!entry || typeof entry !== 'object') invalid();
    const log = entry as Record<string, unknown>;
    if (lower(log.address) !== prepared.to || !Array.isArray(log.topics) || lower(log.topics[0]) !== topic) continue;
    if (match || log.removed === true || hash(log.transactionHash) !== txHash || hash(log.blockHash) !== blockHash ||
        uint(log.blockNumber) !== blockNumber || typeof log.data !== 'string') invalid();
    const event = ABI.decodeEventLog('LinkOpened', log.data as string, log.topics as string[]);
    const canonical = ABI.encodeEventLog(ABI.getEvent('LinkOpened')!, [...event]);
    if (canonical.data !== lower(log.data) || canonical.topics.join(',') !== (log.topics as string[]).map(lower).join(',')) invalid();
    const { context } = state;
    if (lower(event.maker) !== context.maker || lower(event.offerToken) !== prepared.terms.offerToken ||
        lower(event.requestToken) !== prepared.terms.requestToken || event.privatePair !== prepared.terms.privatePair ||
        lower(event.makerNonce) !== context.makerNonce || event.expiresAt.toString() !== prepared.terms.expiresAt ||
        event.publicBudget !== (prepared.terms.privatePair ? 0n : BigInt(prepared.offerBudget)) ||
        event.publicPrice.offer !== (prepared.terms.privatePair ? 0n : BigInt(prepared.terms.priceOffer)) ||
        event.publicPrice.request !== (prepared.terms.privatePair ? 0n : BigInt(prepared.terms.priceRequest))) invalid();
    match = { id: event.id.toString(), logIndex: uint(log.index ?? log.logIndex).toString() };
  }
  if (!match) return invalid();
  const reference = normalizeLinkTradeV2Reference({ chainId: prepared.chainId, escrow: prepared.to,
    id: match.id, revision: '1', credentialEpoch: '1' });
  return Object.freeze({ reference, sharePath: buildLinkTradeV2Path(reference, state.secret),
    transactionHash: txHash, blockNumber: blockNumber.toString(), blockHash, logIndex: match.logIndex });
};
