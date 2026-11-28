import type { FormEvent } from 'react';
import { GROUP_PRIVATE_TITLE_LABEL } from '../../../lib/appShared';
import AppDialog from '../../../shared/ui/AppDialog';
import { AppTab, AppTabList } from '../../../shared/ui/AppTabs';
import { useChatUiStore } from '../chatUiStore';

type QuickActionsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  newContact: string;
  onNewContactChange: (value: string) => void;
  onAddContactSubmit: (event: FormEvent<HTMLFormElement>) => void;
  newGroupTitle: string;
  onNewGroupTitleChange: (value: string) => void;
  newGroupMembersInput: string;
  onNewGroupMembersInputChange: (value: string) => void;
  newGroupIsPrivate: boolean;
  onNewGroupIsPrivateChange: (isPrivate: boolean) => void;
  onCreateGroup: () => Promise<void>;
  processingGroupAction: boolean;
  hasAesReady: boolean;
  groupJoinCodeInput: string;
  onGroupJoinCodeInputChange: (value: string) => void;
  onJoinGroupWithCode: () => Promise<void>;
  error: string;
};

export default function QuickActionsModal({
  isOpen,
  onClose,
  newContact,
  onNewContactChange,
  onAddContactSubmit,
  newGroupTitle,
  onNewGroupTitleChange,
  newGroupMembersInput,
  onNewGroupMembersInputChange,
  newGroupIsPrivate,
  onNewGroupIsPrivateChange,
  onCreateGroup,
  processingGroupAction,
  hasAesReady,
  groupJoinCodeInput,
  onGroupJoinCodeInputChange,
  onJoinGroupWithCode,
  error
}: QuickActionsModalProps) {
  const quickActionTab = useChatUiStore((state) => state.quickActionTab);
  const setQuickActionTab = useChatUiStore((state) => state.setQuickActionTab);

  return (
    <AppDialog open={isOpen} onClose={onClose} surfaceClassName="modal-backdrop" labelledBy="quick-actions-title">
      <div className="modal-card quick-actions-modal">
        <h3 id="quick-actions-title">New</h3>
        <AppTabList className="quick-actions-tabs" label="Quick actions" value={quickActionTab} onChange={setQuickActionTab}>
          <AppTab id="quick-actions-contact-tab" value="contact">
            Add contact
          </AppTab>
          <AppTab id="quick-actions-create-tab" value="create-group">
            Create
          </AppTab>
          <AppTab id="quick-actions-join-tab" value="join-group">
            Join
          </AppTab>
        </AppTabList>

        {quickActionTab === 'contact' ? (
          <form
            id="quick-actions-contact-panel"
            className="contact-form quick-actions-form"
            role="tabpanel"
            aria-labelledby="quick-actions-contact-tab"
            onSubmit={onAddContactSubmit}
          >
            <input
              value={newContact}
              onChange={(event) => onNewContactChange(event.target.value)}
              placeholder="0x... wallet address"
              aria-label="Wallet address"
            />
            <button type="submit">Save Contact</button>
          </form>
        ) : null}

        {quickActionTab === 'create-group' ? (
          <form
            id="quick-actions-create-panel"
            className="contact-form quick-actions-form"
            role="tabpanel"
            aria-labelledby="quick-actions-create-tab"
            onSubmit={(event) => {
              event.preventDefault();
              onCreateGroup().catch(() => {});
            }}
          >
            <label className="quick-actions-field">{newGroupIsPrivate ? 'Public label' : 'Group title'}<input
              value={newGroupIsPrivate ? GROUP_PRIVATE_TITLE_LABEL : newGroupTitle}
              onChange={(event) => onNewGroupTitleChange(event.target.value)}
              placeholder={newGroupIsPrivate ? GROUP_PRIVATE_TITLE_LABEL : 'Group title'}
              aria-label={newGroupIsPrivate ? 'Private group public label' : 'Group title'}
              disabled={newGroupIsPrivate}
            /></label>
            <label className="quick-actions-field">Initial members<input
              value={newGroupMembersInput}
              onChange={(event) => onNewGroupMembersInputChange(event.target.value)}
              placeholder="0x…"
              aria-label="Initial members"
              aria-describedby="initial-group-members-help"
            /></label>
            <small id="initial-group-members-help">Separate wallet addresses with commas or spaces.</small>
            <label className="quick-actions-checkbox-row">
              <input
                type="checkbox"
                checked={newGroupIsPrivate}
                onChange={(event) => {
                  const isPrivate = event.target.checked;
                  onNewGroupIsPrivateChange(isPrivate);
                  if (isPrivate) {
                    onNewGroupTitleChange('');
                  }
                }}
              />
              Private group (only admin can invite)
            </label>
            {newGroupIsPrivate ? (
              <small>Private groups use a generic public label. Custom private titles are not stored on-chain.</small>
            ) : null}
            <button type="submit" disabled={processingGroupAction || !hasAesReady}>
              {processingGroupAction ? 'Creating...' : 'Create'}
            </button>
          </form>
        ) : null}

        {quickActionTab === 'join-group' ? (
          <form
            id="quick-actions-join-panel"
            className="contact-form quick-actions-form"
            role="tabpanel"
            aria-labelledby="quick-actions-join-tab"
            onSubmit={(event) => {
              event.preventDefault();
              onJoinGroupWithCode().catch(() => {});
            }}
          >
            <input
              value={groupJoinCodeInput}
              onChange={(event) => onGroupJoinCodeInputChange(event.target.value)}
              placeholder="Paste group join code"
              aria-label="Group join code"
            />
            <button type="submit" disabled={processingGroupAction || !hasAesReady || !groupJoinCodeInput.trim()}>
              {processingGroupAction ? 'Working...' : 'Join'}
            </button>
            <div className="quick-actions-helper">
              Join codes are now enforced on-chain and can expire.
            </div>
          </form>
        ) : null}

        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="connect-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </AppDialog>
  );
}
