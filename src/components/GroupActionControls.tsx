type GroupActionControlsProps = {
  isActiveGroupAdmin: boolean;
  groupRenameOpen: boolean;
  groupRenameInput: string;
  onGroupRenameInputChange: (value: string) => void;
  canSubmitGroupRename: boolean;
  processingGroupAction: boolean;
  includeRefresh?: boolean;
  syncingGroups?: boolean;
  onBeginRename: () => void;
  onCancelRename: () => void;
  onSubmitRename: () => void;
  onLeave: () => void;
  onHandoffAdminAndLeave: () => void;
  onDisband: () => void;
  onRefresh?: () => void;
};

export default function GroupActionControls({
  isActiveGroupAdmin,
  groupRenameOpen,
  groupRenameInput,
  onGroupRenameInputChange,
  canSubmitGroupRename,
  processingGroupAction,
  includeRefresh = false,
  syncingGroups = false,
  onBeginRename,
  onCancelRename,
  onSubmitRename,
  onLeave,
  onHandoffAdminAndLeave,
  onDisband,
  onRefresh
}: GroupActionControlsProps) {
  return (
    <>
      {isActiveGroupAdmin ? (
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
      ) : null}

      {isActiveGroupAdmin ? (
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
            className="contact group-danger-button"
            onClick={onDisband}
            disabled={processingGroupAction}
          >
            {processingGroupAction ? 'Working...' : 'Disband'}
          </button>
        </>
      ) : (
        <button type="button" className="contact" onClick={onLeave} disabled={processingGroupAction}>
          {processingGroupAction ? 'Working...' : 'Leave'}
        </button>
      )}

      {includeRefresh ? (
        <button
          type="button"
          className="contact group-refresh-button"
          onClick={onRefresh}
          disabled={syncingGroups}
        >
          {syncingGroups ? 'Refreshing...' : 'Refresh'}
        </button>
      ) : null}
    </>
  );
}
