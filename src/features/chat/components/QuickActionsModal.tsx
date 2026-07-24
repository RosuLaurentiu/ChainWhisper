import { useRef, type FormEvent } from 'react';
import { moveFocusWithin } from '../../../shared/components/a11y';
import { useModalA11y } from '../../../shared/hooks/useModalA11y';
import { useChatUiStore } from '../chatUiStore';

type QuickActionsModalProps = {
  isOpen: boolean;
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
  const quickActionTab = useChatUiStore((state) => state.quickActionTab);
  const setQuickActionTab = useChatUiStore((state) => state.setQuickActionTab);
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
        <div
          className="quick-actions-tabs"
          role="tablist"
          aria-label="Quick actions"
          onKeyDown={(event) => {
            if (!moveFocusWithin(event, { orientation: 'horizontal', selector: '[role="tab"]' })) {
              return;
            }
            window.requestAnimationFrame(() => {
              (document.activeElement as HTMLButtonElement | null)?.click();
            });
          }}
        >
          <button
            id="quick-actions-contact-tab"
            type="button"
            role="tab"
            aria-selected={quickActionTab === 'contact'}
            aria-controls="quick-actions-contact-panel"
            tabIndex={quickActionTab === 'contact' ? 0 : -1}
            className={quickActionTab === 'contact' ? 'active' : undefined}
            onClick={() => setQuickActionTab('contact')}
          >
            Add contact
          </button>
          <button
            id="quick-actions-create-tab"
            type="button"
            role="tab"
            aria-selected={quickActionTab === 'create-group'}
            aria-controls="quick-actions-create-panel"
            tabIndex={quickActionTab === 'create-group' ? 0 : -1}
            className={quickActionTab === 'create-group' ? 'active' : undefined}
            onClick={() => setQuickActionTab('create-group')}
          >
            Create
          </button>
          <button
            id="quick-actions-join-tab"
            type="button"
            role="tab"
            aria-selected={quickActionTab === 'join-group'}
            aria-controls="quick-actions-join-panel"
            tabIndex={quickActionTab === 'join-group' ? 0 : -1}
            className={quickActionTab === 'join-group' ? 'active' : undefined}
            onClick={() => setQuickActionTab('join-group')}
          >
            Join
          </button>
        </div>

        {quickActionTab === 'contact' ? (
          <form
            id="quick-actions-contact-panel"
            className="contact-form quick-actions-form"
            role="tabpanel"
            aria-labelledby="quick-actions-contact-tab"
            onSubmit={onAddContactSubmit}
          >
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
            id="quick-actions-create-panel"
            className="contact-form quick-actions-form"
            role="tabpanel"
            aria-labelledby="quick-actions-create-tab"
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
            <label className="quick-actions-checkbox-row">
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
    </div>
  );
}
