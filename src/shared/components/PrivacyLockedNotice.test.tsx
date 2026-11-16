import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import PrivacyLockedNotice from './PrivacyLockedNotice';

type Props = { children?: ReactNode; onClick?: () => void; disabled?: boolean };
const nodes = (value: ReactNode): ReactElement<Props>[] => Array.isArray(value) ? value.flatMap(nodes)
  : isValidElement<Props>(value) ? [value, ...nodes(value.props.children)] : [];
const button = (tree: ReactNode) => nodes(tree).find(node => node.type === 'button');

describe('privacy locked notice', () => {
  it('states the locked result and gives the unlock action in the same place', () => {
    const unlock = vi.fn(async () => undefined);
    const tree = PrivacyLockedNotice({ message: 'Your orders are locked.', onUnlock: unlock });
    const markup = renderToStaticMarkup(tree);
    expect(markup).toContain('role="status"');
    expect(markup).toContain('Your orders are locked.');
    expect(markup).toContain('>Unlock privacy</button>');
    expect(markup).not.toContain('in the header');
    expect(unlock).not.toHaveBeenCalled();
    button(tree)!.props.onClick!();
    expect(unlock).toHaveBeenCalledOnce();
  });

  it('does not leave an unhandled rejection when the wallet request is rejected', async () => {
    const unlock = vi.fn(async () => { throw new Error('User rejected the request.'); });
    expect(() => button(PrivacyLockedNotice({ message: 'Locked.', onUnlock: unlock }))!.props.onClick!()).not.toThrow();
    await Promise.resolve();
    expect(unlock).toHaveBeenCalledOnce();
  });

  it('points to the header only when no unlock action is available', () => {
    const tree = PrivacyLockedNotice({ message: 'Private trades are locked.' });
    expect(button(tree)).toBeUndefined();
    expect(renderToStaticMarkup(tree)).toContain('Private trades are locked. Unlock privacy in the header.');
  });

  it('disables the action while its screen is busy', () => {
    expect(button(PrivacyLockedNotice({ message: 'Locked.', onUnlock: vi.fn(), disabled: true }))!.props.disabled).toBe(true);
  });
});
