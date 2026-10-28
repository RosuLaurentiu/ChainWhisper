declare const WALLET_ACTION_INTENT_BRAND: unique symbol;

export type WalletActionIntent<T> = Readonly<{
  readonly [WALLET_ACTION_INTENT_BRAND]: true;
  intentId: string;
  action: Readonly<T>;
}>;

const ACTION_INTENTS = new WeakSet<object>();
let nextIntentId = 0;

const snapshotValue = (value: unknown, ancestors: WeakSet<object>): unknown => {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') {
      throw new Error('Wallet action intent contains an unsupported value.');
    }
    return value;
  }
  if (ancestors.has(value)) {
    throw new Error('Wallet action intent must not contain a circular reference.');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((item) => snapshotValue(item, ancestors)));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Wallet action intent must contain only plain data.');
    }
    const snapshot: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) {
        throw new Error('Wallet action intent must not contain accessors.');
      }
      snapshot[key] = snapshotValue(descriptor.value, ancestors);
    }
    return Object.freeze(snapshot);
  } finally {
    ancestors.delete(value);
  }
};

/** Captures one immutable, locally unique wallet intent before any asynchronous work begins. */
export const captureWalletActionIntent = <T>(action: T): WalletActionIntent<T> => {
  const intent = Object.freeze({
    intentId: `wallet-action-${++nextIntentId}`,
    action: snapshotValue(action, new WeakSet<object>()) as Readonly<T>
  }) as WalletActionIntent<T>;
  ACTION_INTENTS.add(intent);
  return intent;
};

export const readWalletActionIntent = <T>(intent: WalletActionIntent<T>): Readonly<T> => {
  if (!intent || !ACTION_INTENTS.has(intent)) {
    throw new Error('Wallet action requires an intent captured by the active runtime.');
  }
  return intent.action;
};
