import { PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ADDRESS, type TradeSnapshot } from '../../../lib/appShared';
import type { OtcSwapQuoteCandidate } from '../../../lib/otcSwapQuote';
import { getSnapshotKey } from '../../../lib/p2pTradeView';

// Fixed sample offers and trades for the approved-offers design check (CW-166). The page uses them in a
// development build only, when the address has designQa=approved-offers.
export const buildApprovedOffersQaCandidates = (): OtcSwapQuoteCandidate[] => {
  const scale = 10n ** 18n;
  const token = (symbol: 'cwTPB' | 'cwTPQ', addressSuffix: string) => ({
    kind: 'private-erc20' as const,
    tokenAddress: `0x${addressSuffix.repeat(40)}`,
    symbol,
    decimals: 18,
    key: `private-erc20:0x${addressSuffix.repeat(40)}`
  });
  const sellToken = token('cwTPQ', '1');
  const buyToken = token('cwTPB', '2');
  const candidate = (
    tradeId: number,
    rate: string,
    payment: string,
    availability: OtcSwapQuoteCandidate['availability']
  ): OtcSwapQuoteCandidate => {
    const escrowContract = availability.kind === 'terminal'
      ? PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS
      : TRADE_ESCROW_CONTRACT_ADDRESS;
    const offeredAmountWei = availability.kind === 'known' ? availability.maxBuyAmountWei : 800n * scale;
    const requestedAmountWei = offeredAmountWei * BigInt(rate.replace('.', '')) / 10_000n;
    const estimatedPaymentWei = BigInt(payment.replace('.', '')) * scale / 100n;
    const trade = {
      tradeId,
      escrowContract,
      maker: '0x1111111111111111111111111111111111111111',
      taker: '0x0000000000000000000000000000000000000000',
      offer: { ...buyToken, amount: offeredAmountWei.toString() },
      request: { ...sellToken, amount: requestedAmountWei.toString() },
      createdAt: 1_787_328_000,
      expiresAt: 0,
      status: 'open',
      isPublic: availability.kind === 'known',
      hasAccessHash: availability.kind === 'terminal',
      hiddenLiquidity: availability.kind === 'terminal'
    } as TradeSnapshot;
    return {
      trade,
      tradeId,
      tradeKey: getSnapshotKey(trade),
      escrowContract,
      sourceType: 'standard',
      sellToken,
      buyToken,
      requestedSellAmountWei: estimatedPaymentWei,
      requestedBuyAmountWei: 500n * scale,
      estimatedSellAmountWei: estimatedPaymentWei,
      estimatedBuyAmountWei: 500n * scale,
      complete: true,
      price: BigInt(rate.replace('.', '')) * scale / 10_000n,
      priceScale: scale,
      availability,
      terminalPrefill: { kind: 'standard', inputSide: 'buy', amountWei: 500n * scale }
    };
  };
  return [
    candidate(91, '0.2512', '125.60', {
      kind: 'known', maxBuyAmountWei: 1_250n * scale, maxSellAmountWei: 314n * scale
    }),
    candidate(92, '0.2480', '124.00', { kind: 'terminal' }),
    candidate(93, '0.2441', '122.05', {
      kind: 'known', maxBuyAmountWei: 2_400n * scale, maxSellAmountWei: 586n * scale
    })
  ];
};

export const buildApprovedManagementQaTrades = (
  walletAddress: string,
  candidates: readonly OtcSwapQuoteCandidate[]
): TradeSnapshot[] => {
  const [marketOffer, privateOffer, bestOffer] = candidates;
  if (!marketOffer || !privateOffer || !bestOffer || !walletAddress) return [];
  const peerA = '0x1111111111111111111111111111111111111111';
  const peerB = '0x2222222222222222222222222222222222222222';
  const openTaker = '0x0000000000000000000000000000000000000000';
  return [
    {
      ...privateOffer.trade,
      tradeId: 201,
      maker: peerA,
      taker: walletAddress,
      createdAt: 1_787_472_000,
      status: 'open',
      isPublic: false,
      hasAccessHash: false
    },
    {
      ...bestOffer.trade,
      tradeId: 202,
      maker: walletAddress,
      taker: openTaker,
      createdAt: 1_787_468_400,
      status: 'open',
      isPublic: true
    },
    {
      ...marketOffer.trade,
      tradeId: 203,
      maker: walletAddress,
      taker: peerB,
      createdAt: 1_787_382_000,
      status: 'accepted',
      isPublic: false
    },
    {
      ...bestOffer.trade,
      tradeId: 204,
      maker: peerB,
      taker: walletAddress,
      createdAt: 1_787_295_600,
      status: 'cancelled',
      isPublic: false
    }
  ];
};
