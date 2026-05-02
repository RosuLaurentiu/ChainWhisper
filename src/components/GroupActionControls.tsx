import { closeDetailsOnEscape } from './a11y';

type GroupActionControlsProps = {
  isActiveGroupAdmin: boolean;
  groupRenameOpen: boolean;
  groupRenameInput: string;
  onGroupRenameInputChange: (value: string) => void;
  canSubmitGroupRename: boolean;
  processingGroupAction: boolean;
  variant?: 'desktop' | 'mobile';
  onBeginRename: () => void;
  onCancelRename: () => void;
  onSubmitRename: () => void;
  onLeave: () => void;
  onHandoffAdminAndLeave: () => void;
  onDisband: () => void;
};

export default function GroupActionControls({
  isActiveGroupAdmin,
  groupRenameOpen,
  groupRenameInput,
  onGroupRenameInputChange,
  canSubmitGroupRename,
  processingGroupAction,
  variant = 'desktop',
  onBeginRename,
  onCancelRename,
  onSubmitRename,
  onLeave,
  onHandoffAdminAndLeave,
  onDisband
}: GroupActionControlsProps) {
  const renameControl = isActiveGroupAdmin ? (
    groupRenameOpen ? (
      <form
        className="group-rename-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmitRename();
        }}
      >
        <input
          value={groupRenameInput}
          onChange={(event) => onGroupRenameInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancelRename();
            }
          }}
          placeholder="Group name"
          aria-label="Rename group"
          autoFocus
          disabled={processingGroupAction}
        />
        <button type="submit" className="contact" disabled={processingGroupAction || !canSubmitGroupRename}>
          {processingGroupAction ? 'Saving...' : 'Save'}
        </button>
        <button type="button" className="contact" onClick={onCancelRename} disabled={processingGroupAction}>
          Cancel
        </button>
      </form>
    ) : (
      <button type="button" className="contact" onClick={onBeginRename} disabled={processingGroupAction}>
        Rename
      </button>
    )
  ) : null;

  const adminDangerControls = isActiveGroupAdmin ? (
    <>
      <button
        type="button"
        className="contact group-danger-button"
        onClick={onHandoffAdminAndLeave}
        disabled={processingGroupAction}
      >
        {processingGroupAction ? 'Working...' : 'Burn & Leave'}
      </button>
      <button
        type="button"
        className="contact group-danger-button group-danger-button-strong"
        onClick={onDisband}
        disabled={processingGroupAction}
      >
        {processingGroupAction ? 'Working...' : 'Disband'}
      </button>
    </>
  ) : null;

  const leaveControl = !isActiveGroupAdmin ? (
    <button type="button" className="contact group-danger-button" onClick={onLeave} disabled={processingGroupAction}>
      {processingGroupAction ? 'Working...' : 'Leave'}
    </button>
  ) : null;

  const hasAdminControls = Boolean(renameControl || adminDangerControls);
  const panelContent = (
    <div className="group-actions-panel-content">
      {renameControl ? (
        <section className="group-actions-section">
          <span className="group-actions-section-label">Admin only</span>
          <div className="group-actions-control-grid">
            {renameControl}
          </div>
        </section>
      ) : null}

      {adminDangerControls ? (
        <section className="group-actions-section group-actions-section-danger">
          <span className="group-actions-section-label">Admin exit</span>
          <div className="group-actions-control-grid">
            {adminDangerControls}
          </div>
        </section>
      ) : null}

      {leaveControl ? (
        <section className="group-actions-section group-actions-section-danger">
          <span className="group-actions-section-label">Membership</span>
          <div className="group-actions-control-grid">
            {leaveControl}
          </div>
        </section>
      ) : null}
    </div>
  );

  if (variant === 'mobile') {
    return <div className="group-actions-inline-panel">{panelContent}</div>;
  }

  if (!hasAdminControls) {
    return leaveControl;
  }

  return (
    <details className="group-actions-dropdown" onKeyDown={closeDetailsOnEscape}>
      <summary>Admin tools</summary>
      <div className="group-actions-menu-panel">{panelContent}</div>
    </details>
  );
}
