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
    onPrefetchGroup: vi.fn(),
    error: '',
    ...overrides
  } as ComponentProps<typeof ContactsSidebar>;

  return renderToStaticMarkup(createElement(ContactsSidebar, props));
}

describe('ContactsSidebar group discovery status', () => {
  it('shows a loading status while group discovery is in progress', () => {
    const markup = renderSidebar({ groupDiscoveryState: 'loading' });

    expect(markup).toContain('role="status"');
    expect(markup).toContain('Loading groups…');
    expect(markup).not.toContain('No groups yet.');
  });

  it('shows a retry status when group discovery fails', () => {
    const markup = renderSidebar({ groupDiscoveryState: 'error' });

    expect(markup).toContain('role="status"');
    expect(markup).toContain('Groups unavailable. Refresh to retry.');
    expect(markup).not.toContain('No groups yet.');
  });

  it('shows the empty state only after discovery is ready or in legacy mode', () => {
    expect(renderSidebar({ groupDiscoveryState: 'ready' })).toContain('No groups yet.');
    expect(renderSidebar()).toContain('No groups yet.');
  });

  it('keeps discovered groups visible when refresh fails', () => {
    const markup = renderSidebar({
      groupDiscoveryState: 'error',
      sortedGroups: [{ id: 7, title: 'Project group', isPrivate: false, memberCount: 2, lastTimestamp: 0,
        admin: '0xowner', createdAt: 0, members: [], lastBlock: 0 }]
    });

    expect(markup).toContain('Groups may be incomplete. Refresh to retry.');
    expect(markup).toContain('Project group (#7)');
  });
});
