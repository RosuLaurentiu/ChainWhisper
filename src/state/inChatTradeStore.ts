import { create } from 'zustand';
import {
  DEFAULT_TRADE_EXPIRY_HOURS,
  type PendingTradeCounterContext,
  type TradeCustomTokenInfo,
  type TradeTokenPresetKey
} from '../lib/appHelpers';
import type { TradeFeeModeSelection, TradeSnapshot } from '../lib/appShared';
import { resolveStateUpdate, type StateUpdate } from './storeUtils';

type InChatTradeState = {
  tradeComposerOpen: boolean;
  creatingTrade: boolean;
  processingTradeActionId: string;
  tradeFeeModeSelection: TradeFeeModeSelection;
  tradeRequiredFeeWei: bigint | null;
  tradeOfferTokenSelection: TradeTokenPresetKey;
  tradeRequestTokenSelection: TradeTokenPresetKey;
  tradeOfferCustomTokenAddress: string;
  tradeRequestCustomTokenAddress: string;
  customTradeTokenInfoByAddress: Record<string, TradeCustomTokenInfo>;
  tradeOfferAmountInput: string;
  tradeRequestAmountInput: string;
  tradeExpiryHoursInput: string;
  tradeCounterParentId: number | null;
  tradeCounterContext: PendingTradeCounterContext | null;
  tradeSnapshotsById: Record<string, TradeSnapshot>;
  setTradeComposerOpen: (next: StateUpdate<boolean>) => void;
  setCreatingTrade: (next: StateUpdate<boolean>) => void;
  setProcessingTradeActionId: (next: StateUpdate<string>) => void;
  setTradeFeeModeSelection: (next: StateUpdate<TradeFeeModeSelection>) => void;
  setTradeRequiredFeeWei: (next: StateUpdate<bigint | null>) => void;
  setTradeOfferTokenSelection: (next: StateUpdate<TradeTokenPresetKey>) => void;
  setTradeRequestTokenSelection: (next: StateUpdate<TradeTokenPresetKey>) => void;
  setTradeOfferCustomTokenAddress: (next: StateUpdate<string>) => void;
  setTradeRequestCustomTokenAddress: (next: StateUpdate<string>) => void;
  setCustomTradeTokenInfoByAddress: (next: StateUpdate<Record<string, TradeCustomTokenInfo>>) => void;
  setTradeOfferAmountInput: (next: StateUpdate<string>) => void;
  setTradeRequestAmountInput: (next: StateUpdate<string>) => void;
  setTradeExpiryHoursInput: (next: StateUpdate<string>) => void;
  setTradeCounterParentId: (next: StateUpdate<number | null>) => void;
  setTradeCounterContext: (next: StateUpdate<PendingTradeCounterContext | null>) => void;
  setTradeSnapshotsById: (next: StateUpdate<Record<string, TradeSnapshot>>) => void;
};

export const useInChatTradeStore = create<InChatTradeState>((set) => ({
  tradeComposerOpen: false,
  creatingTrade: false,
  processingTradeActionId: '',
  tradeFeeModeSelection: 'coti',
  tradeRequiredFeeWei: null,
  tradeOfferTokenSelection: 'coti',
  tradeRequestTokenSelection: 'wisp',
  tradeOfferCustomTokenAddress: '',
  tradeRequestCustomTokenAddress: '',
  customTradeTokenInfoByAddress: {},
  tradeOfferAmountInput: '',
  tradeRequestAmountInput: '',
  tradeExpiryHoursInput: DEFAULT_TRADE_EXPIRY_HOURS,
  tradeCounterParentId: null,
  tradeCounterContext: null,
  tradeSnapshotsById: {},
  setTradeComposerOpen: (next) =>
    set((state) => ({ tradeComposerOpen: resolveStateUpdate(next, state.tradeComposerOpen) })),
  setCreatingTrade: (next) => set((state) => ({ creatingTrade: resolveStateUpdate(next, state.creatingTrade) })),
  setProcessingTradeActionId: (next) =>
    set((state) => ({ processingTradeActionId: resolveStateUpdate(next, state.processingTradeActionId) })),
  setTradeFeeModeSelection: (next) =>
    set((state) => ({ tradeFeeModeSelection: resolveStateUpdate(next, state.tradeFeeModeSelection) })),
  setTradeRequiredFeeWei: (next) =>
    set((state) => ({ tradeRequiredFeeWei: resolveStateUpdate(next, state.tradeRequiredFeeWei) })),
  setTradeOfferTokenSelection: (next) =>
    set((state) => ({ tradeOfferTokenSelection: resolveStateUpdate(next, state.tradeOfferTokenSelection) })),
  setTradeRequestTokenSelection: (next) =>
    set((state) => ({ tradeRequestTokenSelection: resolveStateUpdate(next, state.tradeRequestTokenSelection) })),
  setTradeOfferCustomTokenAddress: (next) =>
    set((state) => ({ tradeOfferCustomTokenAddress: resolveStateUpdate(next, state.tradeOfferCustomTokenAddress) })),
  setTradeRequestCustomTokenAddress: (next) =>
    set((state) => ({
      tradeRequestCustomTokenAddress: resolveStateUpdate(next, state.tradeRequestCustomTokenAddress)
    })),
  setCustomTradeTokenInfoByAddress: (next) =>
    set((state) => ({
      customTradeTokenInfoByAddress: resolveStateUpdate(next, state.customTradeTokenInfoByAddress)
    })),
  setTradeOfferAmountInput: (next) =>
    set((state) => ({ tradeOfferAmountInput: resolveStateUpdate(next, state.tradeOfferAmountInput) })),
  setTradeRequestAmountInput: (next) =>
    set((state) => ({ tradeRequestAmountInput: resolveStateUpdate(next, state.tradeRequestAmountInput) })),
  setTradeExpiryHoursInput: (next) =>
    set((state) => ({ tradeExpiryHoursInput: resolveStateUpdate(next, state.tradeExpiryHoursInput) })),
  setTradeCounterParentId: (next) =>
    set((state) => ({ tradeCounterParentId: resolveStateUpdate(next, state.tradeCounterParentId) })),
  setTradeCounterContext: (next) =>
    set((state) => ({ tradeCounterContext: resolveStateUpdate(next, state.tradeCounterContext) })),
  setTradeSnapshotsById: (next) =>
    set((state) => ({ tradeSnapshotsById: resolveStateUpdate(next, state.tradeSnapshotsById) }))
}));
