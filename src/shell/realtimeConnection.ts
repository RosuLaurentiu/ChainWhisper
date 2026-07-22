export type RealtimeConnectionStatus = 'idle' | 'connected' | 'reconnecting';

export const ignoreRealtimeSubscriptionAction = (action: () => unknown): void => {
  try {
    void Promise.resolve(action()).catch(() => {});
  } catch {
  }
};

type WsConnectionTarget = {
  addEventListener?: (event: string, listener: () => void) => void;
  removeEventListener?: (event: string, listener: () => void) => void;
  on?: (event: string, listener: () => void) => void;
  off?: (event: string, listener: () => void) => void;
  removeListener?: (event: string, listener: () => void) => void;
};

const getWsConnectionTarget = (provider: unknown): WsConnectionTarget | null => {
  if (!provider || typeof provider !== 'object') {
    return null;
  }

  const providerRecord = provider as Record<string, unknown>;
  const candidates = [
    providerRecord.websocket,
    providerRecord._websocket,
    providerRecord._ws,
    (providerRecord.provider as Record<string, unknown> | undefined)?._websocket
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const target = candidate as WsConnectionTarget;
    if (typeof target.addEventListener === 'function' || typeof target.on === 'function') {
      return target;
    }
  }

  return null;
};

export const attachWsDisconnectListeners = (
  provider: unknown,
  onDisconnect: () => void
): (() => void) | null => {
  const target = getWsConnectionTarget(provider);
  if (!target) {
    return null;
  }

  let notified = false;
  const handleDisconnect = () => {
    if (notified) {
      return;
    }

    notified = true;
    onDisconnect();
  };

  target.addEventListener?.('close', handleDisconnect);
  target.addEventListener?.('error', handleDisconnect);
  target.on?.('close', handleDisconnect);
  target.on?.('error', handleDisconnect);

  return () => {
    target.removeEventListener?.('close', handleDisconnect);
    target.removeEventListener?.('error', handleDisconnect);
    target.off?.('close', handleDisconnect);
    target.off?.('error', handleDisconnect);
    target.removeListener?.('close', handleDisconnect);
    target.removeListener?.('error', handleDisconnect);
  };
};
