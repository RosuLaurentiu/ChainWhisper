import {
  encodeGroupInviteCode,
  formatMessageTimestamp,
  isWalletAddress,
  shortenAddress,
  type ActiveGroupJoinCode
} from '../lib/appShared';

type GroupInviteMode = 'invite' | 'code';
type GroupJoinCodeMode = 'single' | 'multi';

type SharedGroupInviteToolProps = {
  processingGroupAction: boolean;
  hasAesReady: boolean;
  isActiveGroupAdmin: boolean;
  lastCopiedKey: string | null;
  onCopyWithFeedback: (value: string, feedbackKey: string) => Promise<void> | void;
};

type GeneratedInviteCodeProps = SharedGroupInviteToolProps & {
  generatedGroupInviteCode: string;
  generatedGroupJoinCodeHash: string;
  onRevokeGeneratedJoinCode: () => void;
};

type GroupInviteMembersPanelProps = {
  canInviteToActiveGroup: boolean;
  processingGroupAction: boolean;
  hasAesReady: boolean;
  groupInviteMembersInput: string;
  onGroupInviteMembersInputChange: (value: string) => void;
  groupInviteTtlInput: string;
  onGroupInviteTtlInputChange: (value: string) => void;
  onInviteMembers: () => void;
};

type GroupJoinCodePanelProps = SharedGroupInviteToolProps & {
  mobile: boolean;
  groupJoinCodeMode: GroupJoinCodeMode;
  onGroupJoinCodeModeChange: (mode: GroupJoinCodeMode) => void;
  groupJoinCodeMaxUsesInput: string;
  onGroupJoinCodeMaxUsesInputChange: (value: string) => void;
  onGenerateJoinCode: () => void;
  generatedGroupInviteCode: string;
  generatedGroupJoinCodeHash: string;
  onRevokeGeneratedJoinCode: () => void;
};

export type GroupInviteMenuProps = SharedGroupInviteToolProps & {
  mobile?: boolean;
  activeGroupId: number | null;
  walletAddress: string;
  canInviteToActiveGroup: boolean;
  canManageActiveGroupJoinCodes: boolean;
  groupInviteMenuView: GroupInviteMode;
  onGroupInviteMenuViewChange: (view: GroupInviteMode) => void;
  groupInviteMembersInput: string;
  onGroupInviteMembersInputChange: (value: string) => void;
  groupInviteTtlInput: string;
  onGroupInviteTtlInputChange: (value: string) => void;
  onInviteMembers: () => void;
  groupJoinCodeMode: GroupJoinCodeMode;
  onGroupJoinCodeModeChange: (mode: GroupJoinCodeMode) => void;
  groupJoinCodeMaxUsesInput: string;
  onGroupJoinCodeMaxUsesInputChange: (value: string) => void;
  onGenerateJoinCode: () => void;
  generatedGroupInviteCode: string;
  generatedGroupJoinCodeHash: string;
  onRevokeGeneratedJoinCode: () => void;
};

export type ActiveJoinCodeListProps = {
  mobile?: boolean;
  activeGroupJoinCodes: ActiveGroupJoinCode[];
  loadingActiveGroupJoinCodes: boolean;
  lastCopiedKey: string | null;
  onCopyWithFeedback: (value: string, feedbackKey: string) => Promise<void> | void;
  revokingGroupJoinCodeHash: string;
  onRevokeJoinCode: (codeHash: string, code?: string) => void;
  processingGroupAction: boolean;
  isActiveGroupAdmin: boolean;
};

function GeneratedInviteCode({
  generatedGroupInviteCode,
  generatedGroupJoinCodeHash,
  lastCopiedKey,
  onCopyWithFeedback,
  onRevokeGeneratedJoinCode,
  processingGroupAction,
  hasAesReady,
  isActiveGroupAdmin
}: GeneratedInviteCodeProps) {
  if (!generatedGroupInviteCode) {
    return null;
  }

  const generatedCodeCopyKey = `group-code:${generatedGroupInviteCode}`;
  return (
    <div className="group-generated-code-stack">
      <div className="group-generated-code group-generated-code-compact">
        <input className="group-generated-code-value" value={generatedGroupInviteCode} readOnly aria-label="Generated join code" />
        <button
          type="button"
          className={lastCopiedKey === generatedCodeCopyKey ? 'contact group-generated-code-copy copied' : 'contact group-generated-code-copy'}
          onClick={() => {
            Promise.resolve(onCopyWithFeedback(generatedGroupInviteCode, generatedCodeCopyKey)).catch(() => {});
          }}
        >
          {lastCopiedKey === generatedCodeCopyKey ? 'Copied' : 'Copy code'}
        </button>
      </div>
      <button
        type="button"
        className="contact group-generated-code-revoke-btn"
        onClick={onRevokeGeneratedJoinCode}
        disabled={processingGroupAction || !hasAesReady || !isActiveGroupAdmin || !generatedGroupJoinCodeHash}
      >
        {processingGroupAction ? 'Working...' : 'Revoke code'}
      </button>
    </div>
  );
}

function GroupInviteMembersPanel({
  canInviteToActiveGroup,
  processingGroupAction,
  hasAesReady,
  groupInviteMembersInput,
  onGroupInviteMembersInputChange,
  groupInviteTtlInput,
  onGroupInviteTtlInputChange,
  onInviteMembers
}: GroupInviteMembersPanelProps) {
  return (
    <form
      className="group-header-invite group-header-invite-compact"
      onSubmit={(event) => {
        event.preventDefault();
        onInviteMembers();
      }}
    >
      <div className="group-header-invite-row">
        <input
          value={groupInviteMembersInput}
          onChange={(event) => onGroupInviteMembersInputChange(event.target.value)}
          className="group-header-invite-address"
          placeholder={canInviteToActiveGroup ? 'Invite wallets (comma/space separated)' : 'Private group: only admin can invite'}
          aria-label="Invite members"
          disabled={processingGroupAction || !hasAesReady || !canInviteToActiveGroup}
        />
        <div className="group-header-invite-ttl-wrap">
          <input
            value={groupInviteTtlInput}
            onChange={(event) => onGroupInviteTtlInputChange(event.target.value.replace(/[^\d]/g, ''))}
            className="group-header-invite-ttl"
            placeholder="8"
            aria-label="Invite and join code timeout in hours"
            disabled={processingGroupAction || !hasAesReady || !canInviteToActiveGroup}
          />
        </div>
        <button className="group-header-primary-btn" type="submit" disabled={processingGroupAction || !hasAesReady || !canInviteToActiveGroup}>
          {processingGroupAction ? 'Sending...' : 'Invite'}
        </button>
      </div>
    </form>
  );
}

function GroupJoinCodePanel({
  mobile,
  groupJoinCodeMode,
  onGroupJoinCodeModeChange,
  groupJoinCodeMaxUsesInput,
  onGroupJoinCodeMaxUsesInputChange,
  onGenerateJoinCode,
  generatedGroupInviteCode,
  generatedGroupJoinCodeHash,
  lastCopiedKey,
  onCopyWithFeedback,
  onRevokeGeneratedJoinCode,
  processingGroupAction,
  hasAesReady,
  isActiveGroupAdmin
}: GroupJoinCodePanelProps) {
  const modeInputName = mobile ? 'group-join-code-mode-mobile' : 'group-join-code-mode-desktop';

  return (
    <div className="group-invite-code-panel">
      <div className="group-join-code-settings group-join-code-settings-compact">
        <div className="group-join-code-header">
          <span className="group-join-code-label">Join code</span>
          <span className="group-join-code-helper">
            {groupJoinCodeMode === 'single' ? 'One join per code.' : 'Reusable code with max uses.'}
          </span>
        </div>
        <div className="group-join-code-main">
          <div className="group-join-code-main-left">
            <div className="group-join-code-mode">
              <label className={groupJoinCodeMode === 'single' ? 'group-join-code-mode-option active' : 'group-join-code-mode-option'}>
                <input
                  type="radio"
                  name={modeInputName}
                  checked={groupJoinCodeMode === 'single'}
                  onChange={() => onGroupJoinCodeModeChange('single')}
                  disabled={processingGroupAction || !hasAesReady || !isActiveGroupAdmin}
                />
                Single-use
              </label>
              <label className={groupJoinCodeMode === 'multi' ? 'group-join-code-mode-option active' : 'group-join-code-mode-option'}>
                <input
                  type="radio"
                  name={modeInputName}
                  checked={groupJoinCodeMode === 'multi'}
                  onChange={() => onGroupJoinCodeModeChange('multi')}
                  disabled={processingGroupAction || !hasAesReady || !isActiveGroupAdmin}
                />
                Multi-use
              </label>
            </div>
            {groupJoinCodeMode === 'multi' ? (
              <label className="group-join-code-max">
                <span>Max uses</span>
                <input
                  type="number"
                  min={2}
                  step={1}
                  value={groupJoinCodeMaxUsesInput}
                  onChange={(event) => onGroupJoinCodeMaxUsesInputChange(event.target.value.replace(/[^\d]/g, ''))}
                  aria-label="Join code max uses"
                  className="group-join-code-max-input"
                  disabled={processingGroupAction || !hasAesReady || !isActiveGroupAdmin}
                />
              </label>
            ) : (
              <span className="group-join-code-hint">One join per code.</span>
            )}
          </div>
          <button
            type="button"
            className="group-join-code-generate group-header-primary-btn"
            onClick={onGenerateJoinCode}
            disabled={processingGroupAction || !hasAesReady || !isActiveGroupAdmin}
          >
            {processingGroupAction ? 'Working...' : 'Create code'}
          </button>
        </div>
      </div>
      <GeneratedInviteCode
        generatedGroupInviteCode={generatedGroupInviteCode}
        generatedGroupJoinCodeHash={generatedGroupJoinCodeHash}
        lastCopiedKey={lastCopiedKey}
        onCopyWithFeedback={onCopyWithFeedback}
        onRevokeGeneratedJoinCode={onRevokeGeneratedJoinCode}
        processingGroupAction={processingGroupAction}
        hasAesReady={hasAesReady}
        isActiveGroupAdmin={isActiveGroupAdmin}
      />
    </div>
  );
}

export function GroupInviteMenu({
  mobile = false,
  activeGroupId,
  walletAddress,
  canInviteToActiveGroup,
  canManageActiveGroupJoinCodes,
  groupInviteMenuView,
  onGroupInviteMenuViewChange,
  groupInviteMembersInput,
  onGroupInviteMembersInputChange,
  groupInviteTtlInput,
  onGroupInviteTtlInputChange,
  onInviteMembers,
  groupJoinCodeMode,
  onGroupJoinCodeModeChange,
  groupJoinCodeMaxUsesInput,
  onGroupJoinCodeMaxUsesInputChange,
  onGenerateJoinCode,
  generatedGroupInviteCode,
  generatedGroupJoinCodeHash,
  lastCopiedKey,
  onCopyWithFeedback,
  onRevokeGeneratedJoinCode,
  processingGroupAction,
  hasAesReady,
  isActiveGroupAdmin
}: GroupInviteMenuProps) {
  const menuClassName = mobile ? 'group-invite-menu group-invite-menu-mobile' : 'group-invite-menu';

  return (
    <details
      className={menuClassName}
      key={`group-invite-menu:${mobile ? 'mobile' : 'desktop'}:${activeGroupId ?? 'none'}:${walletAddress.trim().toLowerCase()}`}
    >
      <summary>Invite</summary>
      <div className="group-invite-menu-panel">
        {canManageActiveGroupJoinCodes ? (
          <>
            <div className="group-invite-menu-switch" role="tablist" aria-label="Group invite options">
              <button
                type="button"
                role="tab"
                aria-selected={groupInviteMenuView === 'invite'}
                className={groupInviteMenuView === 'invite' ? 'group-invite-menu-switch-btn active' : 'group-invite-menu-switch-btn'}
                onClick={() => onGroupInviteMenuViewChange('invite')}
              >
                Invite
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={groupInviteMenuView === 'code'}
                className={groupInviteMenuView === 'code' ? 'group-invite-menu-switch-btn active' : 'group-invite-menu-switch-btn'}
                onClick={() => onGroupInviteMenuViewChange('code')}
              >
                Invite code
              </button>
            </div>
            {groupInviteMenuView === 'invite' ? (
              <GroupInviteMembersPanel
                canInviteToActiveGroup={canInviteToActiveGroup}
                processingGroupAction={processingGroupAction}
                hasAesReady={hasAesReady}
                groupInviteMembersInput={groupInviteMembersInput}
                onGroupInviteMembersInputChange={onGroupInviteMembersInputChange}
                groupInviteTtlInput={groupInviteTtlInput}
                onGroupInviteTtlInputChange={onGroupInviteTtlInputChange}
                onInviteMembers={onInviteMembers}
              />
            ) : (
              <GroupJoinCodePanel
                mobile={mobile}
                groupJoinCodeMode={groupJoinCodeMode}
                onGroupJoinCodeModeChange={onGroupJoinCodeModeChange}
                groupJoinCodeMaxUsesInput={groupJoinCodeMaxUsesInput}
                onGroupJoinCodeMaxUsesInputChange={onGroupJoinCodeMaxUsesInputChange}
                onGenerateJoinCode={onGenerateJoinCode}
                generatedGroupInviteCode={generatedGroupInviteCode}
                generatedGroupJoinCodeHash={generatedGroupJoinCodeHash}
                lastCopiedKey={lastCopiedKey}
                onCopyWithFeedback={onCopyWithFeedback}
                onRevokeGeneratedJoinCode={onRevokeGeneratedJoinCode}
                processingGroupAction={processingGroupAction}
                hasAesReady={hasAesReady}
                isActiveGroupAdmin={isActiveGroupAdmin}
              />
            )}
          </>
        ) : (
          <GroupInviteMembersPanel
            canInviteToActiveGroup={canInviteToActiveGroup}
            processingGroupAction={processingGroupAction}
            hasAesReady={hasAesReady}
            groupInviteMembersInput={groupInviteMembersInput}
            onGroupInviteMembersInputChange={onGroupInviteMembersInputChange}
            groupInviteTtlInput={groupInviteTtlInput}
            onGroupInviteTtlInputChange={onGroupInviteTtlInputChange}
            onInviteMembers={onInviteMembers}
          />
        )}
      </div>
    </details>
  );
}

export function ActiveJoinCodeList({
  mobile = false,
  activeGroupJoinCodes,
  loadingActiveGroupJoinCodes,
  lastCopiedKey,
  onCopyWithFeedback,
  revokingGroupJoinCodeHash,
  onRevokeJoinCode,
  processingGroupAction,
  isActiveGroupAdmin
}: ActiveJoinCodeListProps) {
  const dropdownClassName = mobile
    ? 'group-active-codes-dropdown group-active-codes-dropdown-mobile'
    : 'group-active-codes-dropdown';
  const summaryLabel = loadingActiveGroupJoinCodes
    ? 'Active codes (loading...)'
    : `Active codes ${activeGroupJoinCodes.length}`;

  return (
    <details className={dropdownClassName}>
      <summary>{summaryLabel}</summary>
      {loadingActiveGroupJoinCodes ? (
        <ul className="group-active-codes-list">
          <li className="group-active-code-empty">Loading active codes...</li>
        </ul>
      ) : activeGroupJoinCodes.length === 0 ? (
        <ul className="group-active-codes-list">
          <li className="group-active-code-empty">No active codes found for this group.</li>
        </ul>
      ) : (
        <ul className="group-active-codes-list">
          {activeGroupJoinCodes.map((entry) => {
            const copyValue = entry.code
              ? encodeGroupInviteCode({
                  version: 2,
                  groupId: entry.groupId,
                  code: entry.code,
                  expiresAt: entry.expiresAt,
                  inviter: isWalletAddress(entry.creator) ? entry.creator : undefined
                })
              : entry.codeHash;
            const copyKey = `group-active-code:${entry.groupId}:${entry.codeHash}`;
            const isRevokingThisCode = revokingGroupJoinCodeHash.toLowerCase() === entry.codeHash.toLowerCase();

            return (
              <li key={`active-join-code:${entry.groupId}:${entry.codeHash}`} className="group-active-code-item">
                <div className="group-active-code-row">
                  <div className="group-active-code-value" title={copyValue}>
                    {copyValue}
                  </div>
                  <button
                    type="button"
                    className={lastCopiedKey === copyKey ? 'contact group-generated-code-copy copied' : 'contact group-generated-code-copy'}
                    onClick={(event) => {
                      Promise.resolve(onCopyWithFeedback(copyValue, copyKey)).catch(() => {});
                      const detailsElement = event.currentTarget.closest('details');
                      if (detailsElement instanceof HTMLDetailsElement) {
                        detailsElement.open = false;
                      }
                    }}
                  >
                    {lastCopiedKey === copyKey ? 'Copied' : entry.code ? 'Copy code' : 'Copy hash'}
                  </button>
                  <button
                    type="button"
                    className="contact group-active-code-revoke"
                    onClick={() => onRevokeJoinCode(entry.codeHash, entry.code)}
                    disabled={!isActiveGroupAdmin || processingGroupAction}
                  >
                    {isRevokingThisCode ? 'Revoking...' : 'Revoke'}
                  </button>
                </div>
                <div className="group-active-code-meta">
                  <span>
                    {entry.code ? `Uses left: ${entry.usesLeft}` : 'Hash only (code text unavailable).'}
                  </span>
                  <span>
                    {entry.expiresAt > 0 ? `Expires: ${formatMessageTimestamp(entry.expiresAt)}` : 'No expiry set.'}
                  </span>
                  {isWalletAddress(entry.creator) ? <span>{`Creator: ${shortenAddress(entry.creator)}`}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
