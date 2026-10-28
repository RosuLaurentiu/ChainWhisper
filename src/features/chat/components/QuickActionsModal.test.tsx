import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import QuickActionsModal from './QuickActionsModal';

vi.mock('../chatUiStore', () => {
  const setQuickActionTab = vi.fn();
  return {
    useChatUiStore: (selector: (state: { quickActionTab: string; setQuickActionTab: typeof setQuickActionTab }) => unknown) =>
      selector({ quickActionTab: 'create-group', setQuickActionTab })
  };
});

const renderCreateGroup = (newGroupIsPrivate: boolean) =>
  renderToStaticMarkup(
    <QuickActionsModal
      isOpen
      onClose={vi.fn()}
      newContact=""
      onNewContactChange={vi.fn()}
      onAddContactSubmit={vi.fn()}
      newGroupTitle="Sensitive project name"
      onNewGroupTitleChange={vi.fn()}
      newGroupMembersInput=""
      onNewGroupMembersInputChange={vi.fn()}
      newGroupIsPrivate={newGroupIsPrivate}
      onNewGroupIsPrivateChange={vi.fn()}
      onCreateGroup={vi.fn(async () => {})}
      processingGroupAction={false}
      hasAesReady
      groupJoinCodeInput=""
      onGroupJoinCodeInputChange={vi.fn()}
      onJoinGroupWithCode={vi.fn(async () => {})}
      error=""
    />
  );

describe('QuickActionsModal private group title policy', () => {
  it('does not render a user-supplied title in the private-group form', () => {
    const markup = renderCreateGroup(true);

    expect(markup).not.toContain('Sensitive project name');
    expect(markup).toContain('value="Private group"');
    expect(markup).toContain('aria-label="Private group public label"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('Custom private titles are not stored on-chain.');
  });

  it('keeps public group titles editable', () => {
    const markup = renderCreateGroup(false);

    expect(markup).toContain('value="Sensitive project name"');
    expect(markup).toContain('aria-label="Group title"');
    expect(markup).not.toContain('Custom private titles are not stored on-chain.');
  });
});
