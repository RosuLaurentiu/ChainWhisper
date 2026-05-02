import { useRef, type FormEvent } from 'react';
import { useModalA11y } from '../hooks/useModalA11y';

type QuickActionTab = 'contact' | 'create-group' | 'join-group';

type QuickActionsModalProps = {
  isOpen: boolean;
  quickActionTab: QuickActionTab;
  onSelectTab: (tab: QuickActionTab) => void;
  onClose: () => void;
  newContactName: string;
  onNewContactNameChange: (value: string) => void;
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
  quickActionTab,
  onSelectTab,
  onClose,
  newContactName,
  onNewContactNameChange,
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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y({ dialogRef, isOpen, onClose });

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-card quick-actions-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-actions-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="quick-actions-title">New</h3>
        <div className="quick-actions-tabs" role="tablist" aria-label="Quick actions">
          <button
            type="button"
            role="tab"
            aria-selected={quickActionTab === 'contact'}
            className={quickActionTab === 'contact' ? 'active' : undefined}
            onClick={() => onSelectTab('contact')}
          >
            Add contact
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={quickActionTab === 'create-group'}
            className={quickActionTab === 'create-group' ? 'active' : undefined}
            onClick={() => onSelectTab('create-group')}
          >
            Create
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={quickActionTab === 'join-group'}
            className={quickActionTab === 'join-group' ? 'active' : undefined}
            onClick={() => onSelectTab('join-group')}
          >
            Join
          </button>
        </div>

        {quickActionTab === 'contact' ? (
          <form className="contact-form quick-actions-form" onSubmit={onAddContactSubmit}>
            <input
              value={newContactName}
              onChange={(event) => onNewContactNameChange(event.target.value)}
              placeholder="Contact name (optional)"
              aria-label="Contact name"
            />
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
            className="contact-form quick-actions-form"
            onSubmit={(event) => {
              event.preventDefault();
              onCreateGroup().catch(() => {});
            }}
          >
            <input
              value={newGroupTitle}
              onChange={(event) => onNewGroupTitleChange(event.target.value)}
              placeholder="Group title"
              aria-label="Group title"
            />
            <input
              value={newGroupMembersInput}
              onChange={(event) => onNewGroupMembersInputChange(event.target.value)}
              placeholder="Initial members (comma/space separated)"
              aria-label="Initial group members"
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={newGroupIsPrivate}
                onChange={(event) => onNewGroupIsPrivateChange(event.target.checked)}
              />
              Private group (only admin can invite)
            </label>
            <button type="submit" disabled={processingGroupAction || !hasAesReady}>
              {processingGroupAction ? 'Creating...' : 'Create'}
            </button>
          </form>
        ) : null}

        {quickActionTab === 'join-group' ? (
          <form
            className="contact-form quick-actions-form"
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
            <div style={{ fontSize: 12, opacity: 0.82 }}>
              Join codes are now enforced on-chain and can expire.
            </div>
          </form>
        ) : null}

        {error ? <p className="error">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="connect-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
