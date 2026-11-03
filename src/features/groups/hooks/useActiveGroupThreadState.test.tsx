import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import useActiveGroupThreadState from './useActiveGroupThreadState';
import type { GroupSummary } from '../../../lib/appShared';

it('keeps the verified member count but does not present a partial roster as complete', () => {
  const owner = '0x1111111111111111111111111111111111111111';
  const peer = '0x2222222222222222222222222222222222222222';
  let group: GroupSummary = { id: 4, admin: owner, title: 'Group #4', isPrivate: true,
    createdAt: 1, memberCount: 2, members: [], membersLoaded: false, lastBlock: 10, lastTimestamp: 10 };
  let result!: ReturnType<typeof useActiveGroupThreadState>;
  function Harness() {
    result = useActiveGroupThreadState({ activeGroupId: 4, groups: [group], contacts: [],
      groupRenameInput: '', groupRenameOpen: false, groupTipRecipientAddress: '', myNickname: '',
      onChainNicknameCacheRef: { current: {} }, setGroupRenameInput: vi.fn(), setGroupRenameOpen: vi.fn(),
      setGroupTipRecipientAddress: vi.fn(), walletAddress: owner });
    return null;
  }
  renderToStaticMarkup(<Harness />);
  expect(result.activeGroupMemberCount).toBe(2);
  expect(result.activeGroupParticipants).toEqual([]);
  expect(result.activeGroupTipRecipients).toEqual([]);
  expect(result.isActiveGroupAdmin).toBe(true);
  expect(result.canInviteToActiveGroup).toBe(false);
  group = { ...group, members: [owner, peer], membersLoaded: true };
  renderToStaticMarkup(<Harness />);
  expect(result.activeGroupParticipants).toHaveLength(2);
  expect(result.activeGroupTipRecipients.map(item => item.address)).toEqual([peer]);
  expect(result.canInviteToActiveGroup).toBe(true);
  group = { ...group, membershipEnded: true };
  renderToStaticMarkup(<Harness />);
  expect(result.activeGroupParticipants).toEqual([]);
  expect(result.activeGroupTipRecipients).toEqual([]);
  expect(result.isActiveGroupAdmin).toBe(false);
  expect(result.canInviteToActiveGroup).toBe(false);
  expect(result.canSubmitGroupRename).toBe(false);
});
