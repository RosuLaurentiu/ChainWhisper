import { memo, type Ref } from 'react';
import {
  formatMessageTimestamp,
  isWalletAddress,
  shortenAddress,
  type ChatMessage,
  type Contact,
  type GroupInvite,
  type GroupSummary
} from '../lib/appShared';

type ContactGroupPanelRatio = {
  contactsPanelFlex: number;
  groupsPanelFlex: number;
};

type ContactsSidebarProps = {
  nicknameEditorRef: Ref<HTMLDivElement>;
  nicknameMaxBytes: number;
  hasAesReady: boolean;
  walletAddress: string;
  onNicknameInputChange: (value: string) => void;
  onSaveNickname: () => void;
  hasUnreadConversations: boolean;
  readStateActionsDisabled: boolean;
  walletPromptSensitiveActionsTitle: string;
  onMarkAllConversationsAsRead: () => void;
  onForceSync: () => void;
  syncingHistory: boolean;
  syncingGroups: boolean;
  onOpenNewChat: () => void;
  showHiddenContacts: boolean;
  onToggleShowHiddenContacts: () => void;
  hiddenContactsCount: number;
  hiddenContactsLabel: string;
  contactGroupPanelRatio: ContactGroupPanelRatio;
  visibleSortedContacts: Contact[];
  contactsListEmptyMessage: string;
  activeContact: string | null;
  editingContactAddress: string | null;
  editingContactName: string;
  onEditingContactNameChange: (value: string) => void;
  isConversationStateSyncPending: (address: string) => boolean;
  conversationMetadataActionsDisabled: boolean;
  messagesByContact: Record<string, ChatMessage[]>;
  lastCopiedKey: string | null;
  unreadMap: Record<string, boolean>;
  onCopyWithFeedback: (value: string, feedbackKey: string) => Promise<void>;
  onActivateContact: (address: string) => void;
  onStartRenameContact: (address: string, name?: string) => void;
  onRemoveContact: (address: string) => void;
  onSaveRenamedContact: (address: string) => void;
  onCancelRenameContact: () => void;
  sortedGroupInvites: GroupInvite[];
  onAcceptGroupInvite: (groupId: number) => void;
  onDeclineGroupInvite: (groupId: number) => void;
  processingGroupAction: boolean;
  sortedGroups: GroupSummary[];
  activeGroupId: number | null;
  messagesByGroup: Record<string, ChatMessage[]>;
  unreadGroupMap: Record<string, boolean>;
  onActivateGroup: (groupId: number) => void;
  error: string;
};

function ContactsSidebar({
  nicknameEditorRef,
  nicknameMaxBytes,
  hasAesReady,
  walletAddress,
  onNicknameInputChange,
  onSaveNickname,
  hasUnreadConversations,
  readStateActionsDisabled,
  walletPromptSensitiveActionsTitle,
  onMarkAllConversationsAsRead,
  onForceSync,
  syncingHistory,
  syncingGroups,
  onOpenNewChat,
  showHiddenContacts,
  onToggleShowHiddenContacts,
  hiddenContactsCount,
  hiddenContactsLabel,
  contactGroupPanelRatio,
  visibleSortedContacts,
  contactsListEmptyMessage,
  activeContact,
  editingContactAddress,
  editingContactName,
  onEditingContactNameChange,
  isConversationStateSyncPending,
  conversationMetadataActionsDisabled,
  messagesByContact,
  lastCopiedKey,
  unreadMap,
  onCopyWithFeedback,
  onActivateContact,
  onStartRenameContact,
  onRemoveContact,
  onSaveRenamedContact,
  onCancelRenameContact,
  sortedGroupInvites,
  onAcceptGroupInvite,
  onDeclineGroupInvite,
  processingGroupAction,
  sortedGroups,
  activeGroupId,
  messagesByGroup,
  unreadGroupMap,
  onActivateGroup,
  error
}: ContactsSidebarProps) {
  const syncInProgress = syncingHistory || syncingGroups;

  return (
    <aside className="contacts-sidebar">
      <div className="contact-profile-card contact-profile-card-fixed">
        <span className="contact-profile-label">Name</span>
        <div className="contact-profile-editor-wrap">
          <div
            ref={nicknameEditorRef}
            className="contact-profile-editor"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="false"
            aria-label="Name"
            data-placeholder="Choose name"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            onInput={(event) => {
              const raw = event.currentTarget.textContent ?? '';
              const singleLine = raw.replace(/\r?\n/g, '').slice(0, nicknameMaxBytes);
              if (singleLine !== raw) {
                event.currentTarget.textContent = singleLine;
              }
              onNicknameInputChange(singleLine);
            }}
            onBlur={() => {
              if (!hasAesReady || !walletAddress) {
                return;
              }

              onSaveNickname();
            }}
          />
          <button
            type="button"
            className="contact-profile-editor-action"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={onSaveNickname}
            disabled={!hasAesReady || !walletAddress}
          >
            Save
          </button>
        </div>
        <div className="contact-actions-panel">
          <div className="contact-actions-grid">
            <button
              type="button"
              className="contact mark-read-button contact-action-btn"
              onClick={onMarkAllConversationsAsRead}
              disabled={readStateActionsDisabled || !hasUnreadConversations}
              title={readStateActionsDisabled ? walletPromptSensitiveActionsTitle : undefined}
            >
              Mark all as read
            </button>
            <button
              type="button"
              className="contact mark-read-button contact-action-btn"
              onClick={onForceSync}
              disabled={syncInProgress || !hasAesReady}
            >
              {syncInProgress ? 'Syncing...' : 'Force sync'}
            </button>
            <button
              type="button"
              className="contact mark-read-button contact-action-btn contact-action-btn-primary"
              onClick={onOpenNewChat}
              disabled={!hasAesReady || !walletAddress}
            >
              New chat
            </button>
            <button
              type="button"
              className={
                showHiddenContacts
                  ? 'contact mark-read-button contact-action-btn contact-action-btn-toggle active'
                  : 'contact mark-read-button contact-action-btn contact-action-btn-toggle'
              }
              onClick={onToggleShowHiddenContacts}
              aria-pressed={showHiddenContacts}
              title={
                showHiddenContacts
                  ? 'Return to your main conversations'
                  : hiddenContactsCount > 0
                    ? `Show ${hiddenContactsLabel}`
                    : 'No hidden chats yet'
              }
              disabled={!showHiddenContacts && hiddenContactsCount === 0}
            >
              {showHiddenContacts
                ? 'Back to main chats'
                : hiddenContactsCount > 0
                  ? `Show hidden chats (${hiddenContactsCount})`
                  : 'No hidden chats'}
            </button>
          </div>
        </div>
      </div>

      <div
        className="contact-profile-card contact-profile-card-scroll contact-profile-card-contacts"
        style={{ flexGrow: contactGroupPanelRatio.contactsPanelFlex }}
      >
        <div className="contacts-panel-header">
          <span className="contact-profile-label">Contacts</span>
          {showHiddenContacts ? (
            <span className="contact-view-badge hidden">Hidden view</span>
          ) : hiddenContactsCount > 0 ? (
            <span className="contact-view-badge">{hiddenContactsLabel}</span>
          ) : null}
        </div>
        <ul className="contacts-list contacts-list-scroll contacts-main-list">
          {visibleSortedContacts.length === 0 ? (
            <li className="contacts-empty-state">{contactsListEmptyMessage}</li>
          ) : (
            visibleSortedContacts.map((contact) => {
              const normalizedAddress = contact.address.toLowerCase();
              const isActive = activeContact?.toLowerCase() === normalizedAddress;
              const isEditing = editingContactAddress?.toLowerCase() === normalizedAddress;
              const conversationStatePending = isConversationStateSyncPending(contact.address);
              const hasName = Boolean(contact.name?.trim());
              const hasConversation = (messagesByContact[normalizedAddress]?.length ?? 0) > 0;
              const contactCopyKey = `contact:${normalizedAddress}`;
              const isContactCopied = lastCopiedKey === contactCopyKey;

              return (
                <li key={contact.address}>
                  <div
                    className={
                      conversationStatePending
                        ? isActive
                          ? 'contact-card active syncing'
                          : contact.hidden
                            ? 'contact-card hidden syncing'
                            : 'contact-card syncing'
                        : isActive
                          ? 'contact-card active'
                          : contact.hidden
                            ? 'contact-card hidden'
                            : 'contact-card'
                    }
                    role="button"
                    tabIndex={0}
                    onClick={() => onActivateContact(contact.address)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onActivateContact(contact.address);
                      }
                    }}
                  >
                    <div className="contact-top">
                      <div className="contact-main" title={contact.address}>
                        {hasName ? (
                          <>
                            <span className="contact-name-inline">{contact.name}</span>
                            <button
                              type="button"
                              className={
                                isContactCopied
                                  ? 'contact-copy contact-copy-secondary copied'
                                  : 'contact-copy contact-copy-secondary'
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                onCopyWithFeedback(contact.address, contactCopyKey).catch(() => {});
                              }}
                              title={isContactCopied ? 'Copied' : 'Copy address'}
                            >
                              {isContactCopied ? 'Copied' : shortenAddress(contact.address)}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className={isContactCopied ? 'contact-copy copied' : 'contact-copy'}
                            onClick={(event) => {
                              event.stopPropagation();
                              onCopyWithFeedback(contact.address, contactCopyKey).catch(() => {});
                            }}
                            title={isContactCopied ? 'Copied' : 'Copy address'}
                          >
                            {isContactCopied ? 'Copied' : shortenAddress(contact.address)}
                          </button>
                        )}
                      </div>
                      {hasConversation ? (
                        <span
                          className="contact-chat-icon"
                          aria-label={unreadMap[normalizedAddress] ? 'Unread messages' : 'Has conversation'}
                          title={unreadMap[normalizedAddress] ? 'Unread messages' : 'Has conversation'}
                          style={{ marginRight: 6, color: unreadMap[normalizedAddress] ? '#e33' : undefined }}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="18"
                            height="18"
                            aria-hidden="true"
                            focusable="false"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              fill="currentColor"
                              d="M20 2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4l4 4 4-4h4a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"
                            />
                          </svg>
                        </span>
                      ) : null}
                      {!isEditing ? (
                        <>
                          <button
                            type="button"
                            className="contact-icon"
                            onClick={(event) => {
                              event.stopPropagation();
                              onStartRenameContact(contact.address, contact.name);
                            }}
                            disabled={conversationStatePending}
                            aria-label="Rename contact"
                            title={conversationStatePending ? 'Wait for sync to finish' : 'Rename'}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              width="14"
                              height="14"
                              aria-hidden="true"
                              focusable="false"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path
                                fill="currentColor"
                                d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm17.71-10.04a1 1 0 0 0 0-1.42l-2.5-2.5a1 1 0 0 0-1.42 0l-1.96 1.96 3.75 3.75 2.13-2.09z"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className={conversationStatePending ? 'contact-icon loading' : 'contact-icon'}
                            onClick={(event) => {
                              event.stopPropagation();
                              onRemoveContact(contact.address);
                            }}
                            disabled={conversationStatePending || conversationMetadataActionsDisabled}
                            aria-label={
                              conversationMetadataActionsDisabled
                                ? 'Conversation sync unavailable'
                                : conversationStatePending
                                ? 'Conversation update in progress'
                                : contact.hidden
                                  ? 'Unhide conversation'
                                  : 'Hide conversation'
                            }
                            title={
                              conversationMetadataActionsDisabled
                                ? walletPromptSensitiveActionsTitle
                                : conversationStatePending
                                ? 'Waiting for confirmation...'
                                : contact.hidden
                                  ? 'Unhide'
                                  : 'Hide'
                            }
                          >
                            <svg
                              viewBox="0 0 24 24"
                              width="15"
                              height="15"
                              aria-hidden="true"
                              focusable="false"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path
                                d="M3 6h18"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                              <path
                                d="M8 6V4h8v2"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <path
                                d="M19 6l-1 14H6L5 6"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <path
                                d="M10 11v6M14 11v6"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                            </svg>
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {isEditing ? (
                    <div className="contact-rename">
                      <input
                        value={editingContactName}
                        onChange={(event) => onEditingContactNameChange(event.target.value)}
                        placeholder="Enter name"
                        aria-label="Rename contact"
                      />
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSaveRenamedContact(contact.address);
                        }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onCancelRenameContact();
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      </div>

      <div
        className="contact-profile-card contact-profile-card-scroll contact-profile-card-groups"
        style={{ flexGrow: contactGroupPanelRatio.groupsPanelFlex }}
      >
        <span className="contact-profile-label">Groups</span>

        {sortedGroupInvites.length > 0 ? (
          <>
            <span className="contact-section-label">Invites</span>
            <ul className="contacts-list contacts-list-scroll groups-invites-list">
              {sortedGroupInvites.map((invite) => (
                <li key={`invite-${invite.groupId}`}>
                  <div className="contact-card">
                    <div className="contact-top">
                      <div className="contact-main">
                        <span className="contact-name-inline">
                          {(invite.title ?? `Group ${invite.groupId}`) +
                            ` (#${invite.groupId})` +
                            (invite.isPrivate ? ' \u00B7 Private' : '')}
                        </span>
                      </div>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
                      From:{' '}
                      {isWalletAddress(invite.inviter) ? shortenAddress(invite.inviter) : invite.inviter || 'Unknown'} | Exp:{' '}
                      {invite.expiresAt > 0 ? formatMessageTimestamp(invite.expiresAt) : 'N/A'}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button
                        type="button"
                        className="contact"
                        onClick={() => onAcceptGroupInvite(invite.groupId)}
                        disabled={processingGroupAction}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="contact"
                        onClick={() => onDeclineGroupInvite(invite.groupId)}
                        disabled={processingGroupAction}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <ul className="contacts-list contacts-list-scroll groups-main-list">
          {sortedGroups.map((group) => {
            const isActive = activeGroupId === group.id;
            const groupTitle = group.title || `Group ${group.id}`;
            const groupKey = String(group.id);
            const hasConversation = group.lastTimestamp > 0 || (messagesByGroup[groupKey]?.length ?? 0) > 0;

            return (
              <li key={`group-${group.id}`}>
                <div
                  className={isActive ? 'contact-card active' : 'contact-card'}
                  role="button"
                  tabIndex={0}
                  onClick={() => onActivateGroup(group.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onActivateGroup(group.id);
                    }
                  }}
                >
                  <div className="contact-top">
                    <div className="contact-main">
                      <span className="contact-name-inline">
                        {groupTitle} (#{group.id})
                        {group.isPrivate ? ' \u00B7 Private' : ''}
                      </span>
                    </div>
                    {hasConversation ? (
                      <span
                        className="contact-chat-icon"
                        aria-label={unreadGroupMap[groupKey] ? 'Unread group messages' : 'Has group messages'}
                        title={unreadGroupMap[groupKey] ? 'Unread group messages' : 'Has group messages'}
                        style={{ marginRight: 6, color: unreadGroupMap[groupKey] ? '#e33' : undefined }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          aria-hidden="true"
                          focusable="false"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            fill="currentColor"
                            d="M20 2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4l4 4 4-4h4a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"
                          />
                        </svg>
                      </span>
                    ) : null}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
                    M: {group.memberCount} | Last: {group.lastTimestamp > 0 ? formatMessageTimestamp(group.lastTimestamp) : 'N/A'}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {error ? <p className="error">{error}</p> : null}
    </aside>
  );
}

export default memo(ContactsSidebar);
