import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useGroupAdminActions, { isGroupAdminActionContextCurrent } from './useGroupAdminActions';
import type { GroupChatV2SessionController } from '../../../lib/groupChatV2Session';

afterEach(() => vi.unstubAllGlobals());

describe('group admin action context', () => {
  it('does not send an invite while the verified group roster is incomplete', async () => {
    const inviteMembers = vi.fn(), setError = vi.fn();
    let actions!: ReturnType<typeof useGroupAdminActions>;
    function Harness() {
      actions = useGroupAdminActions({ activeGroupId: 4, activeGroupMeta: { isPrivate: true, membersLoaded: false },
        isActiveGroupAdmin: true, walletAddress: '0x1111111111111111111111111111111111111111',
        groupChatV2Session: { inviteMembers }, setError
      } as unknown as Parameters<typeof useGroupAdminActions>[0]);
      return null;
    }
    renderToStaticMarkup(createElement(Harness));
    await actions.inviteMembersToActiveGroup();
    expect(inviteMembers).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith('Wait for the group members to load before inviting.');
  });

  it('allows a generated join code to publish only to the group and wallet that created it', () => {
    const activeGroupIdRef = { current: 7 };
    const currentWalletKeyRef = { current: '0xabc' };

    expect(
      isGroupAdminActionContextCurrent({
        activeGroupIdRef,
        currentWalletKeyRef,
        groupId: 7,
        walletKey: '0xabc'
      })
    ).toBe(true);

    activeGroupIdRef.current = 8;
    expect(
      isGroupAdminActionContextCurrent({
        activeGroupIdRef,
        currentWalletKeyRef,
        groupId: 7,
        walletKey: '0xabc'
      })
    ).toBe(false);

    activeGroupIdRef.current = 7;
    currentWalletKeyRef.current = '0xdef';
    expect(
      isGroupAdminActionContextCurrent({
        activeGroupIdRef,
        currentWalletKeyRef,
        groupId: 7,
        walletKey: '0xabc'
      })
    ).toBe(false);
  });

  it.each([false, true])('asks to archive and refreshes current groups only after confirmation: %s', async confirmed => {
    const confirm = vi.fn(() => confirmed);
    vi.stubGlobal('window', { confirm });
    const noop = () => undefined;
    const disband = vi.fn();
    const onGroupChanged = vi.fn();
    let actions: ReturnType<typeof useGroupAdminActions> | undefined;
    function Harness() {
      actions = useGroupAdminActions({
        activeGroupId: 4, activeGroupIdRef: { current: 4 }, activeGroupMeta: null, activateGroup: noop,
        currentWalletKeyRef: { current: 'owner' }, generatedGroupInviteCode: '', generatedGroupJoinCodeHash: '',
        groupChatV2Session: { disband } as unknown as GroupChatV2SessionController, isGroupChatV2ScopeCurrent: () => true,
        groupInviteMembersInput: '', groupInviteTtlInput: '', groupJoinCodeInput: '', groupJoinCodeMaxUsesInput: '',
        groupJoinCodeMode: 'single', groupRenameInput: '', isActiveGroupAdmin: true, newGroupIsPrivate: true,
        newGroupMembersInput: '', newGroupTitle: '', processingGroupAction: false,
        setActiveGroupId: noop, setActiveGroupJoinCodes: noop, setError: noop, setGeneratedGroupJoinCode: noop,
        setGroupInviteMembersInput: noop, setGroupJoinCodeInput: noop, setGroupRenameInput: noop, setGroupRenameOpen: noop,
        setLoadingActiveGroupJoinCodes: noop, setNewGroupIsPrivate: noop, setNewGroupMembersInput: noop, setNewGroupTitle: noop,
        setProcessingGroupAction: noop, setRevokingGroupJoinCodeHash: noop, setShowQuickActionsModal: noop,
        onGroupChanged, walletAddress: '0x1111111111111111111111111111111111111111'
      });
      return null;
    }
    renderToStaticMarkup(createElement(Harness));
    await actions!.disbandActiveGroup();

    expect(confirm).toHaveBeenCalledExactlyOnceWith(
      'Archive this group? New messages will stop. Existing messages and authorized history remain available.'
    );
    if (confirmed) {
      expect(disband).toHaveBeenCalledExactlyOnceWith(4n);
      expect(onGroupChanged).toHaveBeenCalledOnce();
      expect(onGroupChanged.mock.invocationCallOrder[0]).toBeGreaterThan(disband.mock.invocationCallOrder[0]);
    } else {
      expect(disband).not.toHaveBeenCalled();
      expect(onGroupChanged).not.toHaveBeenCalled();
    }
  });
});
