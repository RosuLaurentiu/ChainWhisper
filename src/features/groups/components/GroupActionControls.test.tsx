import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import GroupActionControls from './GroupActionControls';

const renderControls = (isPrivateGroup: boolean) =>
  renderToStaticMarkup(
    <GroupActionControls
      isActiveGroupAdmin
      isPrivateGroup={isPrivateGroup}
      groupRenameOpen={false}
      groupRenameInput=""
      onGroupRenameInputChange={vi.fn()}
      canSubmitGroupRename={false}
      processingGroupAction={false}
      onBeginRename={vi.fn()}
      onCancelRename={vi.fn()}
      onSubmitRename={vi.fn()}
      onLeave={vi.fn()}
      onHandoffAdminAndLeave={vi.fn()}
      onDisband={vi.fn()}
    />
  );

describe('GroupActionControls private title policy', () => {
  it('offers a generic-title migration instead of soliciting a private rename', () => {
    const markup = renderControls(true);

    expect(markup).toContain('Private groups use a generic public label.');
    expect(markup).toContain('Reset legacy title');
    expect(markup).not.toContain('>Rename<');
  });

  it('keeps rename available for public groups', () => {
    const markup = renderControls(false);

    expect(markup).toContain('>Rename<');
    expect(markup).not.toContain('Reset legacy title');
  });
});
