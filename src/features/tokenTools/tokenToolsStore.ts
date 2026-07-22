import { create } from 'zustand';
import {
  FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL,
  FALLBACK_REWARD_TOKEN_DECIMALS,
  FALLBACK_REWARD_TOKEN_SYMBOL,
  type GroupFeeModeSelection,
  type SwapDirection,
  type SwapFeeModeSelection
} from '../../lib/appShared';
import type { PrivacyDirection } from '../../lib/privacyPortal';
import type { ChainWhisperWispStage } from '../../lib/wispPrivacyBridge';
import { resolveStateUpdate, type StateUpdate } from '../../shared/state/storeUtils';

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
  shieldVaultTokenBalanceWei: bigint | null;
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
  privacyAmountInput: string;
  swappingTokens: boolean;
  swapActionStage: ChainWhisperWispStage | null;
  swapStatusMessage: string;
  swapTransactionHash: string;
  selectedPrivacyPairId: string;
  privacyDirection: PrivacyDirection;
  privacyTokenSearch: string;
  privacyRecoveryOpen: boolean;
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
  setShieldVaultTokenBalanceWei: (next: StateUpdate<bigint | null>) => void;
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
  setPrivacyAmountInput: (next: StateUpdate<string>) => void;
  setSwappingTokens: (next: StateUpdate<boolean>) => void;
  setSwapActionStage: (next: StateUpdate<ChainWhisperWispStage | null>) => void;
  setSwapStatusMessage: (next: StateUpdate<string>) => void;
  setSwapTransactionHash: (next: StateUpdate<string>) => void;
  setSelectedPrivacyPairId: (next: StateUpdate<string>) => void;
  setPrivacyDirection: (next: StateUpdate<PrivacyDirection>) => void;
  setPrivacyTokenSearch: (next: StateUpdate<string>) => void;
  setPrivacyRecoveryOpen: (next: StateUpdate<boolean>) => void;
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
  shieldVaultTokenBalanceWei: null,
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
  privacyAmountInput: '',
  swappingTokens: false,
  swapActionStage: null,
  swapStatusMessage: '',
  swapTransactionHash: '',
  selectedPrivacyPairId: 'coti',
  privacyDirection: 'public-to-private',
  privacyTokenSearch: '',
  privacyRecoveryOpen: false,
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
  setShieldVaultTokenBalanceWei: (next) =>
    set((state) => ({ shieldVaultTokenBalanceWei: resolveStateUpdate(next, state.shieldVaultTokenBalanceWei) })),
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
  setPrivacyAmountInput: (next) =>
    set((state) => ({ privacyAmountInput: resolveStateUpdate(next, state.privacyAmountInput) })),
  setSwappingTokens: (next) => set((state) => ({ swappingTokens: resolveStateUpdate(next, state.swappingTokens) })),
  setSwapActionStage: (next) =>
    set((state) => ({ swapActionStage: resolveStateUpdate(next, state.swapActionStage) })),
  setSwapStatusMessage: (next) =>
    set((state) => ({ swapStatusMessage: resolveStateUpdate(next, state.swapStatusMessage) })),
  setSwapTransactionHash: (next) =>
    set((state) => ({ swapTransactionHash: resolveStateUpdate(next, state.swapTransactionHash) })),
  setSelectedPrivacyPairId: (next) =>
    set((state) => ({
      selectedPrivacyPairId: resolveStateUpdate(next, state.selectedPrivacyPairId),
      privacyAmountInput: ''
    })),
  setPrivacyDirection: (next) =>
    set((state) => ({
      privacyDirection: resolveStateUpdate(next, state.privacyDirection),
      privacyAmountInput: ''
    })),
  setPrivacyTokenSearch: (next) =>
    set((state) => ({ privacyTokenSearch: resolveStateUpdate(next, state.privacyTokenSearch) })),
  setPrivacyRecoveryOpen: (next) =>
    set((state) => ({ privacyRecoveryOpen: resolveStateUpdate(next, state.privacyRecoveryOpen) })),
  setLoadingTopUpQuote: (next) =>
    set((state) => ({ loadingTopUpQuote: resolveStateUpdate(next, state.loadingTopUpQuote) })),
  setLoadingRewardBalances: (next) =>
    set((state) => ({ loadingRewardBalances: resolveStateUpdate(next, state.loadingRewardBalances) }))
}));
