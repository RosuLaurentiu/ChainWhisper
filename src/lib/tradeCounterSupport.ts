import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  RECURRING_OTC_CONTRACT_ADDRESS,
  type TradeSnapshot
} from './appShared';
import { isLegacyPrivateOrderEscrowContractAddress, isPrivateOrderEscrowContractAddress } from './appChain';

export const PRIVATE_ORDER_COUNTER_UNAVAILABLE_MESSAGE =
  'This legacy hidden private order cannot receive counter offers. Fill it, cancel it, or ask the maker to recreate it on the upgraded private escrow.';

const normalizeAddress = (value?: string | null): string => value?.trim().toLowerCase() ?? '';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export const isPrivateOrderEscrowSnapshot = (snapshot: Pick<TradeSnapshot, 'escrowContract'>): boolean =>
  isPrivateOrderEscrowContractAddress(snapshot.escrowContract);

export const isRecurringOrderSnapshot = (snapshot: Pick<TradeSnapshot, 'escrowContract' | 'recurringOrder'>): boolean =>
  Boolean(snapshot.recurringOrder) || normalizeAddress(snapshot.escrowContract) === RECURRING_OTC_CONTRACT_ADDRESS.toLowerCase();

export const getCounterOfferUnavailableReason = (snapshot: TradeSnapshot, walletKey: string): string => {
  if (!walletKey) {
    return 'Connect a wallet before countering.';
  }
  if (isRecurringOrderSnapshot(snapshot)) {
    return 'Recurring orders do not support counter offers.';
  }
  if (snapshot.maker.toLowerCase() === walletKey) {
    return 'This is your offer. Cancel it and create a new one to change the terms.';
  }
  if (snapshot.status !== 'open') {
    return 'Only open trades can receive counter offers.';
  }
  if (isLegacyPrivateOrderEscrowContractAddress(snapshot.escrowContract)) {
    return PRIVATE_ORDER_COUNTER_UNAVAILABLE_MESSAGE;
  }
  if (snapshot.counterParentTradeId && snapshot.taker.toLowerCase() !== walletKey) {
    return 'Only the recipient of a counter offer can replace it with a new counter.';
  }

  return '';
};

export const canCreateCounterOffer = (snapshot: TradeSnapshot, walletKey: string): boolean =>
  getCounterOfferUnavailableReason(snapshot, walletKey) === '';

export const canUseWalletAuthorityForDirectAccess = (
  snapshot: Pick<TradeSnapshot, 'escrowContract' | 'taker'>,
  walletKey: string
): boolean => {
  const normalizedWallet = normalizeAddress(walletKey);
  const normalizedTaker = normalizeAddress(snapshot.taker);
  return Boolean(
    normalizedWallet &&
      normalizedTaker &&
      normalizedTaker !== ZERO_ADDRESS &&
      normalizedTaker === normalizedWallet &&
      normalizeAddress(snapshot.escrowContract) === DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase()
  );
};
