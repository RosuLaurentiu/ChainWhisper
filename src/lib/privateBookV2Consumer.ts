import type { TradeSnapshot } from './appShared/core';
import { isPrivateBookV2RuntimeHash, type PrivateBookV2Action } from './privateBookV2Actions';
import type { PrivateBookV2ProjectedSnapshot } from './oneOffTradeV2Snapshot';
import { normalizePrivateBookV2Price, preparePrivateBookV2FillTerms } from './privateBookV2Terms';

export const getPrivateBookV2Projection = (snapshot: TradeSnapshot): PrivateBookV2ProjectedSnapshot['privateBook'] | undefined => {
  const book = (snapshot as Partial<PrivateBookV2ProjectedSnapshot>).privateBook;
  if (!book) return undefined;
  if (snapshot.v2?.protocol !== 'private-v2' || !isPrivateBookV2RuntimeHash(book.runtimeBytecodeHash) ||
      book.fillBehavior !== 'remaining-at-reviewed-price' || book.priceTerms.offerAmount !== snapshot.offer.amount ||
      book.priceTerms.requestAmount !== snapshot.request.amount) {
    throw new Error('Private book terms do not match their current projection.');
  }
  normalizePrivateBookV2Price(book.priceTerms);
  return book;
};

export const buildPrivateBookV2FillAction = (snapshot: TradeSnapshot, maximumPayment: bigint): Extract<PrivateBookV2Action, { kind: 'fill' }> => {
  const book = getPrivateBookV2Projection(snapshot);
  if (!book || !snapshot.v2?.revision || snapshot.status !== 'open') throw new Error('Refresh the current private book order before filling.');
  const mode = snapshot.v2.privateMode;
  const common = { priceTerms: book.priceTerms, fillBehavior: book.fillBehavior };
  const terms = mode === 'fully-private'
    ? { ...common, mode: 'private-pair' as const, maxRequestAmount: maximumPayment }
    : mode === 'private-offer-public-request'
      ? { ...common, mode, publicRequestAmount: maximumPayment }
      : mode === 'public-offer-private-request'
        ? { ...common, mode, publicOfferAmount: maximumPayment * BigInt(book.priceTerms.offerAmount) / BigInt(book.priceTerms.requestAmount), maxPrivateRequestAmount: maximumPayment }
        : undefined;
  if (!terms) throw new Error('Private book mode is unavailable.');
  preparePrivateBookV2FillTerms(terms);
  return Object.freeze({ kind: 'fill', orderId: snapshot.tradeId, expectedRevision: snapshot.v2.revision, terms: Object.freeze(terms) });
};

/** A maker budget is capacity, not a record of sold units or proceeds. */
export const getPrivateBookV2OwnerBudget = (snapshot: TradeSnapshot, viewer: string) => {
  const budget = getPrivateBookV2Projection(snapshot)?.ownerBudget;
  const recipient = viewer.trim().toLowerCase();
  if (!budget || recipient !== snapshot.maker.toLowerCase() || budget.recipient !== recipient ||
      budget.orderId !== String(snapshot.tradeId) || budget.sequence !== snapshot.v2?.revision) return undefined;
  return budget;
};
