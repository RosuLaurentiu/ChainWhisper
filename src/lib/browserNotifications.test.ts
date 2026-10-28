import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  requestChainWhisperBrowserNotificationPermission,
  showChainWhisperBrowserNotification
} from './browserNotifications';

const originalNotification = globalThis.Notification;
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;

type FakeInstance = {
  body: string;
  close: ReturnType<typeof vi.fn>;
  onclick: (() => void) | null;
  options: NotificationOptions;
  title: string;
};

const installBrowser = ({
  permission = 'granted',
  visibility = 'hidden'
}: {
  permission?: NotificationPermission;
  visibility?: DocumentVisibilityState;
} = {}) => {
  const instances: FakeInstance[] = [];
  class FakeNotification {
    static permission = permission;
    static requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
    close = vi.fn();
    onclick: (() => void) | null = null;
    constructor(readonly title: string, readonly options: NotificationOptions = {}) {
      instances.push(this as unknown as FakeInstance);
    }
    get body() { return this.options.body ?? ''; }
  }
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    value: FakeNotification
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { visibilityState: visibility }
  });
  const focus = vi.fn();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { focus }
  });
  return { FakeNotification, focus, instances };
};

afterEach(() => {
  Object.defineProperty(globalThis, 'Notification', { configurable: true, value: originalNotification });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
});

describe('browserNotifications', () => {
  it('requests permission only through the explicit permission function', async () => {
    const { FakeNotification } = installBrowser({ permission: 'default' });
    expect(await requestChainWhisperBrowserNotificationPermission()).toBe('granted');
    expect(FakeNotification.requestPermission).toHaveBeenCalledOnce();
  });

  it('does not show notifications while the app is visible or permission is absent', () => {
    const visible = installBrowser({ visibility: 'visible' });
    expect(showChainWhisperBrowserNotification({ kind: 'direct-trade' })).toBe(false);
    expect(visible.instances).toHaveLength(0);

    const denied = installBrowser({ permission: 'denied' });
    expect(showChainWhisperBrowserNotification({ kind: 'direct-trade' })).toBe(false);
    expect(denied.instances).toHaveLength(0);
  });

  it('shows privacy-safe hidden-page trade text and focuses the exact app on click', () => {
    const { focus, instances } = installBrowser();
    const onOpen = vi.fn();
    expect(showChainWhisperBrowserNotification({ kind: 'direct-trade', onOpen })).toBe(true);
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      title: 'New ChainWhisper trade activity',
      body: 'A direct trade or counter is ready to review.'
    });
    expect(JSON.stringify(instances[0])).not.toMatch(/0x|amount|token|secret|cipher/iu);
    instances[0]!.onclick?.();
    expect(instances[0]!.close).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
