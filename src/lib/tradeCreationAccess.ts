export type TradeVisibility = 'public' | 'unlisted' | 'direct';

export type OneOffTradeAccessPlan = {
  shouldCreateAccessSecret: boolean;
  useHiddenDirectWalletAuthority: boolean;
};

export const resolveOneOffTradeAccessPlan = ({
  hiddenLiquidity,
  tradeVisibility,
  isEditTrade = false,
  isCounterTrade = false,
  isEditingDirectTrade = false
}: {
  hiddenLiquidity: boolean;
  tradeVisibility: TradeVisibility;
  isEditTrade?: boolean;
  isCounterTrade?: boolean;
  isEditingDirectTrade?: boolean;
}): OneOffTradeAccessPlan => {
  const useHiddenDirectWalletAuthority = Boolean(
    hiddenLiquidity &&
      tradeVisibility === 'direct' &&
      !isEditTrade &&
      !isCounterTrade
  );
  const shouldCreateAccessSecret = Boolean(
    isEditingDirectTrade ||
      (!isEditTrade &&
        (isCounterTrade || (tradeVisibility !== 'public' && !useHiddenDirectWalletAuthority)))
  );

  return {
    shouldCreateAccessSecret,
    useHiddenDirectWalletAuthority
  };
};
