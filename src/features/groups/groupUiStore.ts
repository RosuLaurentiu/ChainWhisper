import { create } from 'zustand';
import {
  type ActiveGroupJoinCode,
  DEFAULT_GROUP_JOIN_CODE_MULTI_USES
} from '../../lib/appShared';
import { resolveStateUpdate, type StateUpdate } from '../../shared/state/storeUtils';

export type GroupJoinCodeMode = 'single' | 'multi';
export type GroupInviteMenuView = 'invite' | 'code';

type GroupUiState = {
  newGroupTitle: string;
  newGroupIsPrivate: boolean;
  newGroupMembersInput: string;
  groupInviteMembersInput: string;
  groupInviteTtlInput: string;
  groupJoinCodeMode: GroupJoinCodeMode;
  groupJoinCodeMaxUsesInput: string;
  generatedGroupInviteCode: string;
  generatedGroupJoinCodeHash: string;
  activeGroupJoinCodes: ActiveGroupJoinCode[];
  loadingActiveGroupJoinCodes: boolean;
  revokingGroupJoinCodeHash: string;
  groupInviteMenuView: GroupInviteMenuView;
  groupJoinCodeInput: string;
  groupRenameOpen: boolean;
  groupRenameInput: string;
  groupTipRecipientAddress: string;
  sendingGroupMessage: boolean;
  processingGroupAction: boolean;
  syncingGroups: boolean;
  mobileGroupOptionsOpen: boolean;
  setNewGroupTitle: (next: StateUpdate<string>) => void;
  setNewGroupIsPrivate: (next: StateUpdate<boolean>) => void;
  setNewGroupMembersInput: (next: StateUpdate<string>) => void;
  setGroupInviteMembersInput: (next: StateUpdate<string>) => void;
  setGroupInviteTtlInput: (next: StateUpdate<string>) => void;
  setGroupJoinCodeMode: (next: StateUpdate<GroupJoinCodeMode>) => void;
  setGroupJoinCodeMaxUsesInput: (next: StateUpdate<string>) => void;
  setGeneratedGroupInviteCode: (next: StateUpdate<string>) => void;
  setGeneratedGroupJoinCodeHash: (next: StateUpdate<string>) => void;
  setActiveGroupJoinCodes: (next: StateUpdate<ActiveGroupJoinCode[]>) => void;
  setLoadingActiveGroupJoinCodes: (next: StateUpdate<boolean>) => void;
  setRevokingGroupJoinCodeHash: (next: StateUpdate<string>) => void;
  setGroupInviteMenuView: (next: StateUpdate<GroupInviteMenuView>) => void;
  setGroupJoinCodeInput: (next: StateUpdate<string>) => void;
  setGroupRenameOpen: (next: StateUpdate<boolean>) => void;
  setGroupRenameInput: (next: StateUpdate<string>) => void;
  setGroupTipRecipientAddress: (next: StateUpdate<string>) => void;
  setSendingGroupMessage: (next: StateUpdate<boolean>) => void;
  setProcessingGroupAction: (next: StateUpdate<boolean>) => void;
  setSyncingGroups: (next: StateUpdate<boolean>) => void;
  setMobileGroupOptionsOpen: (next: StateUpdate<boolean>) => void;
};

export const useGroupUiStore = create<GroupUiState>((set) => ({
  newGroupTitle: '',
  newGroupIsPrivate: false,
  newGroupMembersInput: '',
  groupInviteMembersInput: '',
  groupInviteTtlInput: '8',
  groupJoinCodeMode: 'single',
  groupJoinCodeMaxUsesInput: String(DEFAULT_GROUP_JOIN_CODE_MULTI_USES),
  generatedGroupInviteCode: '',
  generatedGroupJoinCodeHash: '',
  activeGroupJoinCodes: [],
  loadingActiveGroupJoinCodes: false,
  revokingGroupJoinCodeHash: '',
  groupInviteMenuView: 'invite',
  groupJoinCodeInput: '',
  groupRenameOpen: false,
  groupRenameInput: '',
  groupTipRecipientAddress: '',
  sendingGroupMessage: false,
  processingGroupAction: false,
  syncingGroups: false,
  mobileGroupOptionsOpen: false,
  setNewGroupTitle: (next) => set((state) => ({ newGroupTitle: resolveStateUpdate(next, state.newGroupTitle) })),
  setNewGroupIsPrivate: (next) =>
    set((state) => ({ newGroupIsPrivate: resolveStateUpdate(next, state.newGroupIsPrivate) })),
  setNewGroupMembersInput: (next) =>
    set((state) => ({ newGroupMembersInput: resolveStateUpdate(next, state.newGroupMembersInput) })),
  setGroupInviteMembersInput: (next) =>
    set((state) => ({ groupInviteMembersInput: resolveStateUpdate(next, state.groupInviteMembersInput) })),
  setGroupInviteTtlInput: (next) =>
    set((state) => ({ groupInviteTtlInput: resolveStateUpdate(next, state.groupInviteTtlInput) })),
  setGroupJoinCodeMode: (next) =>
    set((state) => ({ groupJoinCodeMode: resolveStateUpdate(next, state.groupJoinCodeMode) })),
  setGroupJoinCodeMaxUsesInput: (next) =>
    set((state) => ({ groupJoinCodeMaxUsesInput: resolveStateUpdate(next, state.groupJoinCodeMaxUsesInput) })),
  setGeneratedGroupInviteCode: (next) =>
    set((state) => ({ generatedGroupInviteCode: resolveStateUpdate(next, state.generatedGroupInviteCode) })),
  setGeneratedGroupJoinCodeHash: (next) =>
    set((state) => ({ generatedGroupJoinCodeHash: resolveStateUpdate(next, state.generatedGroupJoinCodeHash) })),
  setActiveGroupJoinCodes: (next) =>
    set((state) => ({ activeGroupJoinCodes: resolveStateUpdate(next, state.activeGroupJoinCodes) })),
  setLoadingActiveGroupJoinCodes: (next) =>
    set((state) => ({
      loadingActiveGroupJoinCodes: resolveStateUpdate(next, state.loadingActiveGroupJoinCodes)
    })),
  setRevokingGroupJoinCodeHash: (next) =>
    set((state) => ({ revokingGroupJoinCodeHash: resolveStateUpdate(next, state.revokingGroupJoinCodeHash) })),
  setGroupInviteMenuView: (next) =>
    set((state) => ({ groupInviteMenuView: resolveStateUpdate(next, state.groupInviteMenuView) })),
  setGroupJoinCodeInput: (next) =>
    set((state) => ({ groupJoinCodeInput: resolveStateUpdate(next, state.groupJoinCodeInput) })),
  setGroupRenameOpen: (next) =>
    set((state) => ({ groupRenameOpen: resolveStateUpdate(next, state.groupRenameOpen) })),
  setGroupRenameInput: (next) =>
    set((state) => ({ groupRenameInput: resolveStateUpdate(next, state.groupRenameInput) })),
  setGroupTipRecipientAddress: (next) =>
    set((state) => ({ groupTipRecipientAddress: resolveStateUpdate(next, state.groupTipRecipientAddress) })),
  setSendingGroupMessage: (next) =>
    set((state) => ({ sendingGroupMessage: resolveStateUpdate(next, state.sendingGroupMessage) })),
  setProcessingGroupAction: (next) =>
    set((state) => ({ processingGroupAction: resolveStateUpdate(next, state.processingGroupAction) })),
  setSyncingGroups: (next) => set((state) => ({ syncingGroups: resolveStateUpdate(next, state.syncingGroups) })),
  setMobileGroupOptionsOpen: (next) =>
    set((state) => ({ mobileGroupOptionsOpen: resolveStateUpdate(next, state.mobileGroupOptionsOpen) }))
}));
