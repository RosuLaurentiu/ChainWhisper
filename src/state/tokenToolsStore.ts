import { create } from 'zustand';
import {
  FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL,
  FALLBACK_REWARD_TOKEN_DECIMALS,
  FALLBACK_REWARD_TOKEN_SYMBOL,
  type GroupFeeModeSelection,
  type SwapDirection,
  type SwapFeeModeSelection
} from '../lib/appShared';
import { resolveStateUpdate, type StateUpdate } from './storeUtils';

type TokenToolsState = {
  topUpAmountWei: bigint | null;
  requiredFeeWei: bigint | null;
  tipNativeBalanceWei: bigint | null;
  groupRewardsContractAddress: string;
  groupRewardsPaused: boolean | null;
  rewardsContractPaused: boolean | null;
  rewardsCallerAllowed: boolean | null;
  rewardsPublicPerInteractionWei: bigint | null;
  rewardsPublicReserveWei: bigint | null;
  rewardTokenBalanceWei: bigint | null;
  privateRewardTokenBalanceWei: bigint | null;
  rewardTokenSymbol: string;
  privateRewardTokenSymbol: string;
  rewardTokenDecimals: number;
  privateRewardTokenDecimals: number;
  swapFeeWei: bigint | null;
  swapTokenFeeAmount: bigint | null;
  groupFeeModeSelection: GroupFeeModeSelection;
  swapFeeModeSelection: SwapFeeModeSelection;
  swapDirection: SwapDirection;
  swapAmountInput: string;
  swappingTokens: boolean;
  swapStatusMessage: string;
  loadingTopUpQuote: boolean;
  loadingRewardBalances: boolean;
  setTopUpAmountWei: (next: StateUpdate<bigint | null>) => void;
  setRequiredFeeWei: (next: StateUpdate<bigint | null>) => void;
  setTipNativeBalanceWei: (next: StateUpdate<bigint | null>) => void;
  setGroupRewardsContractAddress: (next: StateUpdate<string>) => void;
  setGroupRewardsPaused: (next: StateUpdate<boolean | null>) => void;
  setRewardsContractPaused: (next: StateUpdate<boolean | null>) => void;
  setRewardsCallerAllowed: (next: StateUpdate<boolean | null>) => void;
  setRewardsPublicPerInteractionWei: (next: StateUpdate<bigint | null>) => void;
  setRewardsPublicReserveWei: (next: StateUpdate<bigint | null>) => void;
  setRewardTokenBalanceWei: (next: StateUpdate<bigint | null>) => void;
  setPrivateRewardTokenBalanceWei: (next: StateUpdate<bigint | null>) => void;
  setRewardTokenSymbol: (next: StateUpdate<string>) => void;
  setPrivateRewardTokenSymbol: (next: StateUpdate<string>) => void;
  setRewardTokenDecimals: (next: StateUpdate<number>) => void;
  setPrivateRewardTokenDecimals: (next: StateUpdate<number>) => void;
  setSwapFeeWei: (next: StateUpdate<bigint | null>) => void;
  setSwapTokenFeeAmount: (next: StateUpdate<bigint | null>) => void;
  setGroupFeeModeSelection: (next: StateUpdate<GroupFeeModeSelection>) => void;
  setSwapFeeModeSelection: (next: StateUpdate<SwapFeeModeSelection>) => void;
  setSwapDirection: (next: StateUpdate<SwapDirection>) => void;
  setSwapAmountInput: (next: StateUpdate<string>) => void;
  setSwappingTokens: (next: StateUpdate<boolean>) => void;
  setSwapStatusMessage: (next: StateUpdate<string>) => void;
  setLoadingTopUpQuote: (next: StateUpdate<boolean>) => void;
  setLoadingRewardBalances: (next: StateUpdate<boolean>) => void;
};

export const useTokenToolsStore = create<TokenToolsState>((set) => ({
  topUpAmountWei: null,
  requiredFeeWei: null,
  tipNativeBalanceWei: null,
  groupRewardsContractAddress: '',
  groupRewardsPaused: null,
  rewardsContractPaused: null,
  rewardsCallerAllowed: null,
  rewardsPublicPerInteractionWei: null,
  rewardsPublicReserveWei: null,
  rewardTokenBalanceWei: null,
  privateRewardTokenBalanceWei: null,
  rewardTokenSymbol: FALLBACK_REWARD_TOKEN_SYMBOL,
  privateRewardTokenSymbol: FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL,
  rewardTokenDecimals: FALLBACK_REWARD_TOKEN_DECIMALS,
  privateRewardTokenDecimals: FALLBACK_REWARD_TOKEN_DECIMALS,
  swapFeeWei: null,
  swapTokenFeeAmount: null,
  groupFeeModeSelection: 'coti',
  swapFeeModeSelection: 'coti',
  swapDirection: 'shield',
  swapAmountInput: '',
  swappingTokens: false,
  swapStatusMessage: '',
  loadingTopUpQuote: false,
  loadingRewardBalances: false,
  setTopUpAmountWei: (next) => set((state) => ({ topUpAmountWei: resolveStateUpdate(next, state.topUpAmountWei) })),
  setRequiredFeeWei: (next) => set((state) => ({ requiredFeeWei: resolveStateUpdate(next, state.requiredFeeWei) })),
  setTipNativeBalanceWei: (next) =>
    set((state) => ({ tipNativeBalanceWei: resolveStateUpdate(next, state.tipNativeBalanceWei) })),
  setGroupRewardsContractAddress: (next) =>
    set((state) => ({
      groupRewardsContractAddress: resolveStateUpdate(next, state.groupRewardsContractAddress)
    })),
  setGroupRewardsPaused: (next) =>
    set((state) => ({ groupRewardsPaused: resolveStateUpdate(next, state.groupRewardsPaused) })),
  setRewardsContractPaused: (next) =>
    set((state) => ({ rewardsContractPaused: resolveStateUpdate(next, state.rewardsContractPaused) })),
  setRewardsCallerAllowed: (next) =>
    set((state) => ({ rewardsCallerAllowed: resolveStateUpdate(next, state.rewardsCallerAllowed) })),
  setRewardsPublicPerInteractionWei: (next) =>
    set((state) => ({
      rewardsPublicPerInteractionWei: resolveStateUpdate(next, state.rewardsPublicPerInteractionWei)
    })),
  setRewardsPublicReserveWei: (next) =>
    set((state) => ({ rewardsPublicReserveWei: resolveStateUpdate(next, state.rewardsPublicReserveWei) })),
  setRewardTokenBalanceWei: (next) =>
    set((state) => ({ rewardTokenBalanceWei: resolveStateUpdate(next, state.rewardTokenBalanceWei) })),
  setPrivateRewardTokenBalanceWei: (next) =>
    set((state) => ({
      privateRewardTokenBalanceWei: resolveStateUpdate(next, state.privateRewardTokenBalanceWei)
    })),
  setRewardTokenSymbol: (next) =>
    set((state) => ({ rewardTokenSymbol: resolveStateUpdate(next, state.rewardTokenSymbol) })),
  setPrivateRewardTokenSymbol: (next) =>
    set((state) => ({ privateRewardTokenSymbol: resolveStateUpdate(next, state.privateRewardTokenSymbol) })),
  setRewardTokenDecimals: (next) =>
    set((state) => ({ rewardTokenDecimals: resolveStateUpdate(next, state.rewardTokenDecimals) })),
  setPrivateRewardTokenDecimals: (next) =>
    set((state) => ({ privateRewardTokenDecimals: resolveStateUpdate(next, state.privateRewardTokenDecimals) })),
  setSwapFeeWei: (next) => set((state) => ({ swapFeeWei: resolveStateUpdate(next, state.swapFeeWei) })),
  setSwapTokenFeeAmount: (next) =>
    set((state) => ({ swapTokenFeeAmount: resolveStateUpdate(next, state.swapTokenFeeAmount) })),
  setGroupFeeModeSelection: (next) =>
    set((state) => ({ groupFeeModeSelection: resolveStateUpdate(next, state.groupFeeModeSelection) })),
  setSwapFeeModeSelection: (next) =>
    set((state) => ({ swapFeeModeSelection: resolveStateUpdate(next, state.swapFeeModeSelection) })),
  setSwapDirection: (next) => set((state) => ({ swapDirection: resolveStateUpdate(next, state.swapDirection) })),
  setSwapAmountInput: (next) =>
    set((state) => ({ swapAmountInput: resolveStateUpdate(next, state.swapAmountInput) })),
  setSwappingTokens: (next) => set((state) => ({ swappingTokens: resolveStateUpdate(next, state.swappingTokens) })),
  setSwapStatusMessage: (next) =>
    set((state) => ({ swapStatusMessage: resolveStateUpdate(next, state.swapStatusMessage) })),
  setLoadingTopUpQuote: (next) =>
    set((state) => ({ loadingTopUpQuote: resolveStateUpdate(next, state.loadingTopUpQuote) })),
  setLoadingRewardBalances: (next) =>
    set((state) => ({ loadingRewardBalances: resolveStateUpdate(next, state.loadingRewardBalances) }))
}));
