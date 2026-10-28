import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useGroupAdminActions, { isGroupAdminActionContextCurrent } from './useGroupAdminActions';
import type { GroupChatV2SessionController } from '../../../lib/groupChatV2Session';

afterEach(() => vi.unstubAllGlobals());

describe('group admin action context', () => {
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

  it('asks to archive while preserving existing messages and authorized history', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('window', { confirm });
    const noop = () => undefined;
    const disband = vi.fn();
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
        syncGroupData: async () => undefined, walletAddress: '0x1111111111111111111111111111111111111111'
      });
      return null;
    }
    renderToStaticMarkup(createElement(Harness));
    await actions!.disbandActiveGroup();

    expect(confirm).toHaveBeenCalledExactlyOnceWith(
      'Archive this group? New messages will stop. Existing messages and authorized history remain available.'
    );
    expect(disband).not.toHaveBeenCalled();
  });
});
