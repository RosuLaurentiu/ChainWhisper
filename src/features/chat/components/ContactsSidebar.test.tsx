import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ContactsSidebar from './ContactsSidebar';

function renderSidebar(overrides: Partial<ComponentProps<typeof ContactsSidebar>> = {}) {
  const props = {
    nicknameEditorRef: { current: null },
    nicknameMaxBytes: 32,
    hasAesReady: true,
    canSavePublicName: true,
    walletAddress: '0xowner',
    onNicknameInputChange: vi.fn(),
    onSaveNickname: vi.fn(),
    hasUnreadConversations: false,
    readStateActionsDisabled: false,
    walletPromptSensitiveActionsTitle: '',
    onMarkAllConversationsAsRead: vi.fn(),
    onForceSync: vi.fn(),
    syncingHistory: false,
    syncingGroups: false,
    refreshingContacts: false,
    canRefreshContacts: true,
    onOpenNewChat: vi.fn(),
    showHiddenContacts: false,
    onToggleShowHiddenContacts: vi.fn(),
    hiddenContactsCount: 0,
    hiddenContactsLabel: 'hidden chats',
    contactGroupPanelRatio: { contactsPanelFlex: 1, groupsPanelFlex: 1 },
    visibleSortedContacts: [],
    contactsListEmptyMessage: 'No contacts yet.',
    activeContact: null,
    isConversationStateSyncPending: () => false,
    conversationMetadataActionsDisabled: false,
    messagesByContact: {},
    lastCopiedKey: null,
    unreadMap: {},
    onCopyWithFeedback: vi.fn(async () => undefined),
    onActivateContact: vi.fn(),
    onRemoveContact: vi.fn(),
    sortedGroupInvites: [],
    onAcceptGroupInvite: vi.fn(),
    onDeclineGroupInvite: vi.fn(),
    processingGroupAction: false,
    sortedGroups: [],
    activeGroupId: null,
    messagesByGroup: {},
    unreadGroupMap: {},
    onActivateGroup: vi.fn(),
    error: '',
    ...overrides
  } as ComponentProps<typeof ContactsSidebar>;

  return renderToStaticMarkup(createElement(ContactsSidebar, props));
}

describe('ContactsSidebar group discovery status', () => {
  it('uses Force sync as the only discovery control', () => {
    const markup = renderSidebar({ hasOlderContacts: true, hasOlderGroups: true });
    expect(markup.match(/>Force sync<\/button>/g)).toHaveLength(1);
    expect(markup).not.toContain('Refresh Direct conversations');
    expect(markup).not.toContain('Load older conversations');
    expect(markup).not.toContain('Load older groups');
  });
  it('keeps verified groups selectable while remaining coverage loads', () => {
    const markup = renderSidebar({ groupDiscoveryState: 'loading', sortedGroups: [
      { id: 7, title: 'Verified group', isPrivate: true, memberCount: 2, lastTimestamp: 0,
        admin: '0xowner', createdAt: 0, members: [], membersLoaded: false, lastBlock: 0 }
    ] });
    expect(markup).toContain('Verified group (#7)');
    expect(markup).toContain('More group details are loading');
    expect(markup).not.toContain('No groups yet.');
  });

  it('shows a loading status while group discovery is in progress', () => {
    const markup = renderSidebar({ groupDiscoveryState: 'loading' });

    expect(markup).toContain('role="status"');
    expect(markup).toContain('Loading groups…');
    expect(markup).not.toContain('No groups yet.');
  });

  it('shows a retry status when group discovery fails', () => {
    const markup = renderSidebar({ groupDiscoveryState: 'error' });

    expect(markup).toContain('role="status"');
    expect(markup).toContain('Groups unavailable. Use Force sync to retry.');
    expect(markup).not.toContain('No groups yet.');
  });

  it('shows the group empty state after discovery is ready or its optional status is absent', () => {
    expect(renderSidebar({ groupDiscoveryState: 'ready' })).toContain('No groups yet.');
    expect(renderSidebar()).toContain('No groups yet.');
  });

  it('marks an empty recent group page as incomplete', () => {
    const markup = renderSidebar({ groupDiscoveryState: 'ready', hasOlderGroups: true });
    expect(markup).toContain('Older groups load in the background.');
    expect(markup).not.toContain('No groups yet.');
    expect(renderSidebar({ groupDiscoveryState: 'ready', hasOlderGroups: true, sortedGroups: [
      { id: 7, title: 'Known group', isPrivate: false, memberCount: 2, lastTimestamp: 0,
        admin: '0xowner', createdAt: 0, members: [], lastBlock: 0 }
    ] })).toContain('Older groups load in the background.');
    const locked = renderSidebar({ hasAesReady: false, hasOlderGroups: true });
    expect(locked).toContain('Unlock privacy to load groups.');
    expect(locked).not.toContain('Older groups load in the background.');
  });

  it('keeps discovered groups visible when refresh fails', () => {
    const markup = renderSidebar({
      groupDiscoveryState: 'error',
      groupDiscoveryError: 'Group discovery (message history): Read unavailable.',
      error: 'Existing action error.',
      sortedGroups: [{ id: 7, title: 'Project group', isPrivate: false, memberCount: 2, lastTimestamp: 0,
        admin: '0xowner', createdAt: 0, members: [], lastBlock: 0 }]
    });

    expect(markup).toContain('Groups may be incomplete. Use Force sync to retry.');
    expect(markup).toContain('Group discovery (message history): Read unavailable.');
    expect(markup).toContain('<summary>Details</summary>');
    expect(markup).toContain('Existing action error.');
    expect(markup).toContain('Project group (#7)');
  });
});

it('keeps former Group history selectable without current member or unread claims', () => {
  const markup = renderSidebar({ groupDiscoveryState: 'ready', unreadGroupMap: { '4': true }, sortedGroups: [
    { id: 4, title: 'Group #4', isPrivate: true, membershipEnded: true, memberCount: 99,
      lastTimestamp: 100, admin: '0xowner', createdAt: 0, members: [], lastBlock: 0 }
  ] });
  expect(markup).toContain('Group #4 (#4)');
  expect(markup).toContain('Membership ended');
  expect(markup).not.toContain('M: 99');
  expect(markup).not.toContain('Unread group messages');
  expect(markup).toContain('role="button"');
});

describe('ContactsSidebar Direct discovery status', () => {
  it('marks older conversations as incomplete and preserves privacy lock', () => {
    expect(renderSidebar({ directDiscoveryState: 'ready', hasOlderContacts: true }))
      .toContain('More Direct conversations may remain. Use Force sync to load more.');
    expect(renderSidebar({ hasOlderContacts: true, hasAesReady: false })).toContain('Unlock privacy');
  });
  it('hides cached saved contact names and private group titles on privacy lock', () => {
    const markup = renderSidebar({ hasAesReady: false, visibleSortedContacts: [{ address: '0x1111111111111111111111111111111111111111', savedName: 'Secret saved peer' }], sortedGroups: [{ id: 7, title: 'Secret group', isPrivate: true, memberCount: 2, lastTimestamp: 0, admin: '0xowner', createdAt: 0, members: [], lastBlock: 0 }] });
    expect(markup).toContain('Unlock privacy');
    expect(markup).not.toContain('Secret saved peer');
    expect(markup).not.toContain('Secret group');
  });
  it('shows Direct setup errors without claiming the list is empty', () => {
    const markup = renderSidebar({ directDiscoveryState: 'error', canRefreshContacts: false, directDiscoveryError: 'Secure nonce storage unavailable.' });
    expect(markup).toContain('Direct Chat setup is unavailable.');
    expect(markup).not.toContain('Use Force sync to retry.');
    expect(markup).toContain('Secure nonce storage unavailable.');
    expect(markup).not.toContain('No contacts yet.');
  });

  it.each(['loading', 'partial', 'error'] as const)('does not imply empty contacts while discovery is %s', (state) => {
    const markup = renderSidebar({ directDiscoveryState: state });
    expect(markup).not.toContain('No contacts yet.');
    expect(markup).toContain('role="status"');
    expect(markup).toContain(state === 'error' ? 'Direct conversations unavailable. Use Force sync to retry.'
      : state === 'partial' ? 'More Direct conversations may remain. Use Force sync to load more.' : 'Loading Direct conversations…');
  });

  it('shows empty contacts only after the index is ready, and shows privacy lock separately', () => {
    expect(renderSidebar({ directDiscoveryState: 'ready' })).toContain('No contacts yet.');
    const locked = renderSidebar({ hasAesReady: false });
    expect(locked).not.toContain('No contacts yet.');
    expect(locked).toContain('Unlock privacy to load Direct conversations.');
  });

  it('keeps known contacts and Direct refresh available when Group sync or Direct discovery fails', () => {
    const markup = renderSidebar({ syncingGroups: true, directDiscoveryState: 'error',
      directDiscoveryError: 'Contract admission failed.', visibleSortedContacts: [
        { address: '0x1111111111111111111111111111111111111111', name: 'Known peer' }
      ] });
    expect(markup).toContain('Known peer');
    expect(markup).toContain('Direct conversations may be incomplete. Use Force sync to retry.');
    expect(markup).toContain('Contract admission failed.');
    expect(markup).toContain('Syncing...');
  });
});

