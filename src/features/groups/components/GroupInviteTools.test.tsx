import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GroupInviteMenu, type GroupInviteMenuProps } from './GroupInviteTools';

const noop = () => {};
const props: GroupInviteMenuProps = {
  activeGroupId: 6, walletAddress: '0x1111111111111111111111111111111111111111',
  canInviteToActiveGroup: false, canManageActiveGroupJoinCodes: true,
  groupInviteMenuView: 'invite', onGroupInviteMenuViewChange: noop,
  groupInviteMembersInput: '', onGroupInviteMembersInputChange: noop,
  groupInviteTtlInput: '8', onGroupInviteTtlInputChange: noop, onInviteMembers: noop,
  groupJoinCodeMode: 'single', onGroupJoinCodeModeChange: noop,
  groupJoinCodeMaxUsesInput: '1', onGroupJoinCodeMaxUsesInputChange: noop,
  onGenerateJoinCode: noop, generatedGroupInviteCode: '', generatedGroupJoinCodeHash: '',
  onRevokeGeneratedJoinCode: noop, lastCopiedKey: null, onCopyWithFeedback: noop,
  processingGroupAction: false, hasAesReady: true, isActiveGroupAdmin: true
};

describe('Group invitation readiness', () => {
  it('explains unavailable membership to a known admin without enabling invitations', () => {
    const html = renderToStaticMarkup(<GroupInviteMenu {...props} />);
    expect(html).toContain('Invite unavailable');
    expect(html).toContain('Group membership is unavailable');
    expect(html).not.toContain('Only the admin can invite');
    expect(html).toMatch(/aria-label="Wallet addresses"[^>]*disabled=""/);
    expect(html).toContain('aria-label="Expires in (hours)"');
    expect(html).toMatch(/disabled=""[^>]*>Invite<\/button>/);
  });

  it('explains locked privacy before permission details', () => {
    const html = renderToStaticMarkup(<GroupInviteMenu {...props} hasAesReady={false} />);
    expect(html).toContain('Unlock privacy to invite members');
    expect(html).toContain('Invite locked');
    expect(html).toMatch(/disabled=""[^>]*>Invite<\/button>/);
  });

  it('keeps private-group permission denial explicit', () => {
    const html = renderToStaticMarkup(<GroupInviteMenu {...props} isActiveGroupAdmin={false} />);
    expect(html).toContain('Only the admin can invite members to this private group.');
    expect(html).toMatch(/disabled=""[^>]*>Invite<\/button>/);
  });

  it.each([true, false])('preserves admitted invitation controls (admin=%s)', admin => {
    const html = renderToStaticMarkup(<GroupInviteMenu {...props} canInviteToActiveGroup isActiveGroupAdmin={admin} />);
    expect(html).toContain('Separate wallet addresses with commas or spaces.');
    expect(html).not.toContain('disabled=""');
  });
});
