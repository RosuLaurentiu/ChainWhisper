import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { ChatMessage } from '../../../lib/appShared';
import MessageActions from './MessageActions';

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
  useId: () => 'picker',
  useRef: () => ({ current: null })
}));

const message = { id: 'message' } as ChatMessage;

function reactionButtons(sendingReaction = false) {
  const onSendReaction = vi.fn(async () => {});
  const tree = MessageActions({
    message, pickerOpen: true, reactedEmojiSet: new Set(['👍']), sendingReaction,
    reactionDisabled: false, reactionTitle: 'React', replyDisabled: false, replyTitle: 'Reply',
    reactionDisclosure: 'Reactions are public on-chain.',
    onToggleReactionPicker: vi.fn(), onSendReaction, onReplyToMessage: vi.fn()
  });
  const children = tree.props.children as ReactElement[];
  const picker = children.find((child) => child?.props?.role === 'dialog')!;
  const buttons = (picker.props.children as unknown[]).flat().filter(
    (child): child is ReactElement => Boolean(child && typeof child === 'object' && (child as ReactElement).type === 'button')
  );
  return { buttons, onSendReaction };
}

describe('MessageActions reaction picker', () => {
  it('allows removal of an existing reaction and preserves public disclosure', () => {
    const { buttons, onSendReaction } = reactionButtons();
    const own = buttons.find((button) => button.props.children === '👍')!;
    const other = buttons.find((button) => button.props.children !== '👍')!;
    expect(own.props.disabled).toBe(false);
    expect(own.props.title).toBe('Remove reaction 👍');
    expect(own.props['aria-label']).toBe('Remove public on-chain reaction 👍');
    expect(other.props.title).toBe(`React with ${other.props.children}`);
    own.props.onClick();
    expect(onSendReaction).toHaveBeenCalledOnce();
    expect(onSendReaction).toHaveBeenCalledWith(message, '👍');
  });

  it('disables reaction choices during a send', () => {
    const { buttons } = reactionButtons(true);
    expect(buttons.length).toBeGreaterThan(1);
    expect(buttons.every((button) => button.props.disabled)).toBe(true);
  });
});
