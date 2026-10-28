import { Interface, keccak256 } from '@coti-io/coti-ethers';
import { PRIVATE_ERC20_TOKEN_VNEXT_ABI } from './appShared/core';
import { LINK_TRADE_V2_ABI } from './linkTradeV2Abi';
import { prepareLinkTradeV2Fill, recheckLinkTradeV2Fill, readLinkTradeV2Review,
  type LinkTradeV2Deployment, type LinkTradeV2Review } from './linkTradeV2';
import { normalizeLinkTradeV2FillRecovery, type LinkTradeV2FillRecovery } from './linkTradeV2CreationJournal';
import { sendLinkTradeV2Transaction, confirmLinkTradeV2Transaction, ensureLinkTradeV2Allowance,
  readLinkTradeV2Balance, readLinkTradeV2Allowance, type LinkTradeV2CreationRecord, type LinkTradeV2CreationRecoveryJournal } from './linkTradeV2CreationFlow';
import { readLinkTradeV2ReceiptEvents } from './linkTradeV2OwnerActions';
import { findLinkTradeV2Transaction } from './linkTradeV2TransactionRecovery';
import { getOwnerTradeV2CapabilityBinding, assertOwnerTradeV2CapabilityCurrent, type OwnerTradeV2MetaMaskCapability } from './ownerTradeV2Capability';
import { assertAttestedTradeHistoryV2Deployment, type TradeHistoryV2ReadCapability } from './tradeHistoryV2Chain';
import { decryptPrivateUint256Output } from './privateUint256';

const ABI = new Interface(LINK_TRADE_V2_ABI), PRIVATE_TOKEN = new Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI);
const PUBLIC_TRANSFER = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const PRIVATE_TRANSFER = new Interface(['event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
type Input = { capability: OwnerTradeV2MetaMaskCapability; readCapability: TradeHistoryV2ReadCapability;
  deployment: LinkTradeV2Deployment; journal: LinkTradeV2CreationRecoveryJournal };
type Binding = ReturnType<typeof getOwnerTradeV2CapabilityBinding>;
export type LinkTradeV2FillResult = Readonly<{ reference: LinkTradeV2Review['reference']; transactionHash: string;
  offerReceived: string; payment: string; refund: string }>;
const payer = (material: Pick<LinkTradeV2FillRecovery, 'terms'>) => ({ offerToken: material.terms.requestToken, privatePair: material.terms.privatePair });
const scope = async (input: Input) => {
  assertAttestedTradeHistoryV2Deployment(input.deployment, 'link-v2');
  const binding = getOwnerTradeV2CapabilityBinding(input.capability);
  await assertOwnerTradeV2CapabilityCurrent(binding);
  if (!binding.readProvider || binding.chainId.toString() !== input.deployment.chainId ||
      (await binding.readProvider.getNetwork()).chainId !== binding.chainId) throw new Error('Independent Link fill chain access is unavailable.');
  return binding;
};
const tokenCurrent = async (binding: Binding, material: LinkTradeV2FillRecovery, admission: boolean) => {
  for (const [token, codeHash] of [[material.terms.offerToken, material.offerCodeHash], [material.terms.requestToken, material.requestCodeHash]]) {
    const code = await binding.readProvider!.getCode(token);
    if (code === '0x' || keccak256(code) !== codeHash) throw new Error('Link fill token code changed.');
    if (admission && material.terms.privatePair) {
      const raw = await binding.readProvider!.call({ to: token, data: PRIVATE_TOKEN.encodeFunctionData('publicAmountsEnabled') });
      if (raw.toLowerCase() !== PRIVATE_TOKEN.encodeFunctionResult('publicAmountsEnabled', [false])) throw new Error('Link token amounts are not private.');
    }
  }
};
const account = async (binding: Binding, material: LinkTradeV2FillRecovery, receipt: unknown, confirmed = false): Promise<LinkTradeV2FillResult> => {
  const owner = binding.ownerAddress.toLowerCase(), escrow = material.reference.escrow, revision = BigInt(material.reference.revision) + 1n;
  const fills = readLinkTradeV2ReceiptEvents(receipt, escrow, ABI, 'LinkFilled');
  if (fills.length !== 1 || fills[0].id.toString() !== material.reference.id || fills[0].filler.toLowerCase() !== owner ||
      fills[0].revision !== revision) throw new Error('Link fill receipt does not match the reviewed trade.');
  let offer = BigInt(fills[0].publicOffer), payment = BigInt(fills[0].publicPayment), refund = BigInt(fills[0].publicRefund);
  if (material.terms.privatePair) {
    if (offer !== 0n || payment !== 0n || refund !== 0n) throw new Error('Private Link fill exposes public amounts.');
    const privateReceipts = readLinkTradeV2ReceiptEvents(receipt, escrow, ABI, 'PrivateLinkReceipt');
    const own = privateReceipts.filter(r => r.recipient.toLowerCase() === owner);
    if (privateReceipts.length !== 2 || own.length !== 1 || privateReceipts.some(r => r.id.toString() !== material.reference.id || r.revision !== revision) ||
        privateReceipts.filter(r => r.recipient.toLowerCase() === material.maker).length !== 1) throw new Error('Private Link fill recipients do not match.');
    [offer, payment, refund] = [own[0].offer, own[0].payment, own[0].refund].map(v => decryptPrivateUint256Output(binding.signer, v.userCiphertext));
  }
  const maximum = BigInt(material.maximumPayment), priceOffer = BigInt(material.terms.priceOffer), priceRequest = BigInt(material.terms.priceRequest);
  if ([offer, payment, refund].some(v => v < 0n || v >= (1n << 256n)) || payment + refund !== maximum ||
      offer > maximum * priceOffer / priceRequest || payment !== (offer * priceRequest + priceOffer - 1n) / priceOffer ||
      (offer === 0n) !== (payment === 0n)) throw new Error('Link fill price, payment or refund is not exact.');
  const tokenABI = material.terms.privatePair ? PRIVATE_TRANSFER : PUBLIC_TRANSFER;
  const offers = readLinkTradeV2ReceiptEvents(receipt, material.terms.offerToken, tokenABI, 'Transfer');
  const requests = readLinkTradeV2ReceiptEvents(receipt, material.terms.requestToken, tokenABI, 'Transfer');
  const select = (logs: typeof offers, from: string, to: string) => logs.filter(v => v.from.toLowerCase() === from && v.to.toLowerCase() === to);
  const received = select(offers, escrow, owner), funded = select(requests, owner, escrow), paid = select(requests, escrow, material.maker), returned = select(requests, escrow, owner);
  if (offers.length !== 1 || requests.length !== 3 || [received, funded, paid, returned].some(v => v.length !== 1)) throw new Error('Link fill token transfer path is not exact.');
  const amount = (event: typeof offers[number], side: 'senderValue' | 'receiverValue') => material.terms.privatePair
    ? decryptPrivateUint256Output(binding.signer, event[side]) : BigInt(event.value);
  if (amount(received[0], 'receiverValue') !== offer || amount(funded[0], 'senderValue') !== maximum || amount(returned[0], 'receiverValue') !== refund ||
      !material.terms.privatePair && BigInt(paid[0].value) !== payment) throw new Error('Link fill token amounts do not match the receipt.');
  if (!confirmed) {
    const [afterOffer, afterRequest] = await Promise.all([readLinkTradeV2Balance(binding, material.terms), readLinkTradeV2Balance(binding, payer(material))]);
    if (afterOffer === null || afterRequest === null || afterOffer - BigInt(material.beforeOfferBalance) !== offer ||
        BigInt(material.beforeRequestBalance) - afterRequest !== payment) throw new Error('Link fill wallet debit or delivery is not exactly accounted. Keep the saved transaction.');
  }
  const r = receipt as { hash?: string; transactionHash?: string };
  return Object.freeze({ reference: Object.freeze({ ...material.reference, revision: revision.toString() }), transactionHash: (r.hash ?? r.transactionHash)!,
    offerReceived: offer.toString(), payment: payment.toString(), refund: refund.toString() });
};
export const executeLinkTradeV2Fill = (input: Input & { review: LinkTradeV2Review; maximumPayment: string }) => runFill(input);
const runFill = async (input: Input & { review: LinkTradeV2Review; maximumPayment: string }, recovery?: LinkTradeV2FillRecovery) => {
  const binding = await scope(input), owner = binding.ownerAddress.toLowerCase();
  if (input.review.reference.chainId !== input.deployment.chainId || input.review.reference.escrow !== input.deployment.contractAddress) throw new Error('Link fill deployment differs from review.');
  const [beforeOffer, beforeRequest] = await Promise.all([readLinkTradeV2Balance(binding, input.review.terms), readLinkTradeV2Balance(binding, { offerToken: input.review.terms.requestToken, privatePair: input.review.terms.privatePair })]);
  if (beforeOffer === null || beforeRequest === null) throw new Error('Link fill balances are unavailable.');
  let claimed = false, material: LinkTradeV2FillRecovery | undefined;
  try {
    const prepared = await prepareLinkTradeV2Fill({ review: input.review, capability: input.capability, maximumPayment: input.maximumPayment,
      onRecovery: async value => {
        material = normalizeLinkTradeV2FillRecovery({ ...value, beforeOfferBalance: beforeOffer.toString(), beforeRequestBalance: beforeRequest.toString() });
        if (material.maker === owner || recovery && JSON.stringify(recovery) !== JSON.stringify(material)) throw new Error('Saved Link fill changed. Review it again.');
        if (!recovery) { await input.journal.beginFill(material); claimed = true; }
      } });
    if (!material || !claimed && !recovery) throw new Error('Link fill recovery was not saved.');
    const savedMaterial = material;
    const send = (step: LinkTradeV2CreationRecord['step'], to: string, data: string, complete: (receipt: unknown) => Promise<void>) =>
      sendLinkTradeV2Transaction({ binding, step, to, data, complete, onPending: input.journal.onPending, admit: async () => {
        await tokenCurrent(binding, savedMaterial, true); await recheckLinkTradeV2Fill(prepared);
      } });
    await ensureLinkTradeV2Allowance(binding, payer(material), input.deployment.contractAddress, BigInt(material.maximumPayment), send);
    let result: LinkTradeV2FillResult | undefined;
    await send('fill', prepared.to, prepared.data, async receipt => { result = await account(binding, savedMaterial, receipt); });
    if (!result) throw new Error('Link fill needs reconciliation.');
    return result;
  } catch (error) { if (claimed) await input.journal.releaseUnsent(); throw error; }
};
const savedFill = async (input: Input, fillId?: string) => {
  const binding = await scope(input), saved = await input.journal.read();
  if (!saved?.fill || saved.ownerAction || saved.abandoned || fillId !== undefined && fillId !== saved.id ||
      saved.scope.owner !== binding.ownerAddress.toLowerCase() || saved.scope.chainId !== input.deployment.chainId ||
      saved.scope.escrow !== input.deployment.contractAddress || saved.scope.runtimeHash !== input.deployment.runtimeBytecodeHash) throw new Error('Saved Link fill is unavailable for this wallet and deployment.');
  return { binding, saved, material: normalizeLinkTradeV2FillRecovery(saved.fill) };
};
export const continueLinkTradeV2Fill = async (input: Input & { fillId: string }) => {
  const { saved, material } = await savedFill(input, input.fillId);
  if (!saved.active || saved.records.some(r => r.state !== 'confirmed' || r.step === 'fill')) throw new Error('Check the saved Link fill before continuing.');
  const review = await readLinkTradeV2Review({ capability: input.readCapability, deployment: input.deployment, reference: material.reference, secret: material.secret });
  return runFill({ ...input, review, maximumPayment: material.maximumPayment }, material);
};
export const reconcileLinkTradeV2Fill = async (input: Input & { transactionHash?: string }) => {
  const { binding, saved, material } = await savedFill(input);
  const original = saved.records[saved.records.length - 1];
  if (!original || original.state === 'rejected') throw new Error('Link fill needs reconciliation. Do not send it again.');
  if (original.state === 'failed') return undefined;
  const found = await findLinkTradeV2Transaction(binding.readProvider!, original, input.journal, input.transactionHash);
  if (!found) return null;
  await tokenCurrent(binding, material, false);
  let result: LinkTradeV2FillResult | undefined;
  await confirmLinkTradeV2Transaction(binding, found.record, found.receipt, original.state === 'confirmed' ? async () => {} : input.journal.onPending,
    async receipt => {
      if (original.step === 'fill') result = await account(binding, material, receipt, original.state === 'confirmed');
      else if (await readLinkTradeV2Allowance(binding, payer(material), material.reference.escrow) !== (original.step === 'approval-reset' ? 0n : BigInt(material.maximumPayment))) {
        throw new Error('Recovered Link fill allowance differs from review.');
      }
    }, async () => {
      if (found.record.mined?.outcome === 'reverted') return;
      const [offer, request] = await Promise.all([readLinkTradeV2Balance(binding, material.terms), readLinkTradeV2Balance(binding, payer(material))]);
      if (offer !== BigInt(material.beforeOfferBalance) || request !== BigInt(material.beforeRequestBalance)) throw new Error('Replaced Link fill balances changed. Keep it on hold.');
      await readLinkTradeV2Review({ capability: input.readCapability, deployment: input.deployment, reference: material.reference, secret: material.secret });
    });
  return result;
};
