import { create } from 'zustand';
import type { ChatMessage, TipTokenSelection } from '../../lib/appShared';
import { resolveStateUpdate, type StateUpdate } from '../../shared/state/storeUtils';

export type QuickActionTab = 'contact' | 'create-group' | 'join-group';

const SOUND_ENABLED_STORAGE_KEY = 'coti-chat-sound-enabled';

const getInitialSoundEnabled = (): boolean => {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(SOUND_ENABLED_STORAGE_KEY) : null;
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
};

const persistSoundEnabled = (soundEnabled: boolean) => {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SOUND_ENABLED_STORAGE_KEY, String(soundEnabled));
    }
  } catch {}
};

type ChatUiState = {
  newContact: string;
  newContactName: string;
  showHiddenContacts: boolean;
  editingContactAddress: string | null;
  editingContactName: string;
  showQuickActionsModal: boolean;
  showTopUpModal: boolean;
  quickActionTab: QuickActionTab;
  messageInput: string;
  persistedContactOrder: string[];
  unreadMap: Record<string, boolean>;
  unreadGroupMap: Record<string, boolean>;
  lastCopiedKey: string | null;
  lastReadAllTs: number;
  soundEnabled: boolean;
  sending: boolean;
  uploadingImage: boolean;
  sendingReaction: boolean;
  syncingHistory: boolean;
  loadingOlderHistory: boolean;
  replyingToMessage: ChatMessage | null;
  reactionPickerMessageId: string | null;
  highlightedMessageId: string | null;
  tipping: boolean;
  tipComposerOpen: boolean;
  tipTokenSelection: TipTokenSelection;
  tipAmountInput: string;
  setNewContact: (next: StateUpdate<string>) => void;
  setNewContactName: (next: StateUpdate<string>) => void;
  setShowHiddenContacts: (next: StateUpdate<boolean>) => void;
  setEditingContactAddress: (next: StateUpdate<string | null>) => void;
  setEditingContactName: (next: StateUpdate<string>) => void;
  setShowQuickActionsModal: (next: StateUpdate<boolean>) => void;
  setShowTopUpModal: (next: StateUpdate<boolean>) => void;
  setQuickActionTab: (next: StateUpdate<QuickActionTab>) => void;
  setMessageInput: (next: StateUpdate<string>) => void;
  setPersistedContactOrder: (next: StateUpdate<string[]>) => void;
  setUnreadMap: (next: StateUpdate<Record<string, boolean>>) => void;
  setUnreadGroupMap: (next: StateUpdate<Record<string, boolean>>) => void;
  setLastCopiedKey: (next: StateUpdate<string | null>) => void;
  setLastReadAllTs: (next: StateUpdate<number>) => void;
  setSoundEnabled: (next: StateUpdate<boolean>) => void;
  setSending: (next: StateUpdate<boolean>) => void;
  setUploadingImage: (next: StateUpdate<boolean>) => void;
  setSendingReaction: (next: StateUpdate<boolean>) => void;
  setSyncingHistory: (next: StateUpdate<boolean>) => void;
  setLoadingOlderHistory: (next: StateUpdate<boolean>) => void;
  setReplyingToMessage: (next: StateUpdate<ChatMessage | null>) => void;
  setReactionPickerMessageId: (next: StateUpdate<string | null>) => void;
  setHighlightedMessageId: (next: StateUpdate<string | null>) => void;
  setTipping: (next: StateUpdate<boolean>) => void;
  setTipComposerOpen: (next: StateUpdate<boolean>) => void;
  setTipTokenSelection: (next: StateUpdate<TipTokenSelection>) => void;
  setTipAmountInput: (next: StateUpdate<string>) => void;
};

export const useChatUiStore = create<ChatUiState>((set) => ({
  newContact: '',
  newContactName: '',
  showHiddenContacts: false,
  editingContactAddress: null,
  editingContactName: '',
  showQuickActionsModal: false,
  showTopUpModal: false,
  quickActionTab: 'contact',
  messageInput: '',
  persistedContactOrder: [],
  unreadMap: {},
  unreadGroupMap: {},
  lastCopiedKey: null,
  lastReadAllTs: 0,
  soundEnabled: getInitialSoundEnabled(),
  sending: false,
  uploadingImage: false,
  sendingReaction: false,
  syncingHistory: false,
  loadingOlderHistory: false,
  replyingToMessage: null,
  reactionPickerMessageId: null,
  highlightedMessageId: null,
  tipping: false,
  tipComposerOpen: false,
  tipTokenSelection: 'coti',
  tipAmountInput: '',
  setNewContact: (next) => set((state) => ({ newContact: resolveStateUpdate(next, state.newContact) })),
  setNewContactName: (next) => set((state) => ({ newContactName: resolveStateUpdate(next, state.newContactName) })),
  setShowHiddenContacts: (next) =>
    set((state) => ({ showHiddenContacts: resolveStateUpdate(next, state.showHiddenContacts) })),
  setEditingContactAddress: (next) =>
    set((state) => ({ editingContactAddress: resolveStateUpdate(next, state.editingContactAddress) })),
  setEditingContactName: (next) =>
    set((state) => ({ editingContactName: resolveStateUpdate(next, state.editingContactName) })),
  setShowQuickActionsModal: (next) =>
    set((state) => ({ showQuickActionsModal: resolveStateUpdate(next, state.showQuickActionsModal) })),
  setShowTopUpModal: (next) => set((state) => ({ showTopUpModal: resolveStateUpdate(next, state.showTopUpModal) })),
  setQuickActionTab: (next) => set((state) => ({ quickActionTab: resolveStateUpdate(next, state.quickActionTab) })),
  setMessageInput: (next) => set((state) => ({ messageInput: resolveStateUpdate(next, state.messageInput) })),
  setPersistedContactOrder: (next) =>
    set((state) => ({ persistedContactOrder: resolveStateUpdate(next, state.persistedContactOrder) })),
  setUnreadMap: (next) => set((state) => ({ unreadMap: resolveStateUpdate(next, state.unreadMap) })),
  setUnreadGroupMap: (next) => set((state) => ({ unreadGroupMap: resolveStateUpdate(next, state.unreadGroupMap) })),
  setLastCopiedKey: (next) => set((state) => ({ lastCopiedKey: resolveStateUpdate(next, state.lastCopiedKey) })),
  setLastReadAllTs: (next) => set((state) => ({ lastReadAllTs: resolveStateUpdate(next, state.lastReadAllTs) })),
  setSoundEnabled: (next) =>
    set((state) => {
      const soundEnabled = resolveStateUpdate(next, state.soundEnabled);
      persistSoundEnabled(soundEnabled);
      return { soundEnabled };
    }),
  setSending: (next) => set((state) => ({ sending: resolveStateUpdate(next, state.sending) })),
  setUploadingImage: (next) => set((state) => ({ uploadingImage: resolveStateUpdate(next, state.uploadingImage) })),
  setSendingReaction: (next) =>
    set((state) => ({ sendingReaction: resolveStateUpdate(next, state.sendingReaction) })),
  setSyncingHistory: (next) => set((state) => ({ syncingHistory: resolveStateUpdate(next, state.syncingHistory) })),
  setLoadingOlderHistory: (next) =>
    set((state) => ({ loadingOlderHistory: resolveStateUpdate(next, state.loadingOlderHistory) })),
  setReplyingToMessage: (next) =>
    set((state) => ({ replyingToMessage: resolveStateUpdate(next, state.replyingToMessage) })),
  setReactionPickerMessageId: (next) =>
    set((state) => ({ reactionPickerMessageId: resolveStateUpdate(next, state.reactionPickerMessageId) })),
  setHighlightedMessageId: (next) =>
    set((state) => ({ highlightedMessageId: resolveStateUpdate(next, state.highlightedMessageId) })),
  setTipping: (next) => set((state) => ({ tipping: resolveStateUpdate(next, state.tipping) })),
  setTipComposerOpen: (next) =>
    set((state) => ({ tipComposerOpen: resolveStateUpdate(next, state.tipComposerOpen) })),
  setTipTokenSelection: (next) =>
    set((state) => ({ tipTokenSelection: resolveStateUpdate(next, state.tipTokenSelection) })),
  setTipAmountInput: (next) => set((state) => ({ tipAmountInput: resolveStateUpdate(next, state.tipAmountInput) }))
}));
