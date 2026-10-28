export type ChainWhisperBrowserNotificationKind = 'direct-trade';

export type BrowserNotificationPermissionResult = NotificationPermission | 'unsupported';

const notificationApi = (): typeof Notification | null =>
  typeof Notification === 'undefined' ? null : Notification;

/** Must be called from an explicit user gesture. It never runs during startup or synchronization. */
export const requestChainWhisperBrowserNotificationPermission = async ():
Promise<BrowserNotificationPermissionResult> => {
  const api = notificationApi();
  if (!api) return 'unsupported';
  if (api.permission !== 'default') return api.permission;
  try {
    return await api.requestPermission();
  } catch {
    return 'denied';
  }
};

const contentFor = (kind: ChainWhisperBrowserNotificationKind) => {
  if (kind === 'direct-trade') {
    return {
      title: 'New ChainWhisper trade activity',
      body: 'A direct trade or counter is ready to review.',
      tag: 'chainwhisper-direct-trade'
    };
  }
  throw new Error('Unsupported ChainWhisper browser notification kind.');
};

/**
 * Shows only generic metadata while the page is hidden. No address, amount,
 * token, message text, access secret, or encrypted payload enters the browser
 * notification surface.
 */
export const showChainWhisperBrowserNotification = ({
  kind,
  onOpen
}: {
  kind: ChainWhisperBrowserNotificationKind;
  onOpen?: () => void;
}): boolean => {
  const api = notificationApi();
  if (!api || api.permission !== 'granted' || typeof document === 'undefined' ||
      document.visibilityState === 'visible') return false;
  const content = contentFor(kind);
  try {
    const notification = new api(content.title, {
      body: content.body,
      icon: AppFavicon,
      silent: true,
      tag: content.tag
    });
    notification.onclick = () => {
      notification.close();
      try {
        window.focus();
      } catch {}
      onOpen?.();
    };
    return true;
  } catch {
    return false;
  }
};
import AppFavicon from '../assets/favicon.png';
