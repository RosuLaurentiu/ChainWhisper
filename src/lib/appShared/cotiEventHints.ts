import {
  COTI_NETWORK, loadCotiWsProvider, markCotiWsHealthyNow, resetCotiWsProvider,
  WS_HEALTHCHECK_TTL_MS, WS_RETRY_COOLDOWN_MS
} from './core';
import { attachWsDisconnectListeners, ignoreRealtimeSubscriptionAction } from '../../shell/realtimeConnection';

export type CotiEventHintStatus = 'connected' | 'reconnecting';
export type CotiEventHintSubscription = {
  address: string | readonly string[];
  topics?: readonly (string | readonly string[] | null)[];
  onHint: (log?: unknown) => void;
  onStatus?: (status: CotiEventHintStatus) => void;
};
export type CotiEventHintSubscriber = (request: CotiEventHintSubscription) => Promise<() => void>;
type HintFilter = { address: string[]; topics?: (string | string[] | null)[] };
type HintProvider = {
  getNetwork: () => Promise<{ chainId: bigint }>;
  on: (event: string | HintFilter, listener: (log?: unknown) => void) => Promise<unknown>;
  off: (event: string | HintFilter, listener: (log?: unknown) => void) => Promise<unknown>;
};
type Listener = {
  active: boolean;
  request: CotiEventHintSubscription;
  filter: HintFilter;
  onLog: (log?: unknown) => void;
  installed?: { provider: HintProvider; generation: number; acknowledged: boolean };
  connectedGeneration?: number;
};
type SubscriptionAck = { result: Promise<void>; resolve: () => void; reject: (error: Error) => void };
const subscriptionKey = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null;
  const filter = value as HintFilter;
  const addresses = typeof filter.address === 'string' ? [filter.address] : filter.address;
  if (!Array.isArray(addresses) || !addresses.every(address => typeof address === 'string')) return null;
  const topics = (filter.topics ?? []).map(topic => Array.isArray(topic)
    ? [...new Set(topic.map(item => item.toLowerCase()))].sort() : topic?.toLowerCase() ?? null);
  return JSON.stringify({ address: [...new Set(addresses.map(address => address.toLowerCase()))].sort(), topics });
};

/** One socket lifecycle for hints only. Canonical and financial reads stay on HTTP. */
export const createCotiEventHintSubscriber = ({
  loadProvider, resetProvider, chainId, onHealthy = () => {},
  retryMs = WS_RETRY_COOLDOWN_MS, healthMs = WS_HEALTHCHECK_TTL_MS, setupMs = 10_000
}: {
  loadProvider: () => Promise<HintProvider>;
  resetProvider: () => Promise<void>;
  chainId: bigint;
  onHealthy?: () => void;
  retryMs?: number;
  healthMs?: number;
  setupMs?: number;
}): CotiEventHintSubscriber => {
  const listeners = new Set<Listener>();
  let generation = 0;
  type Connection = { provider: HintProvider; generation: number; detach: (() => void) | null;
    onBlock: () => void; onDebug: (event?: unknown) => void; hasHeartbeat: boolean;
    acks: Map<string, SubscriptionAck>; rpcIds: Map<number, SubscriptionAck> };
  let connection: Connection | null = null;
  let connecting: Promise<void> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let healthTimer: ReturnType<typeof setTimeout> | null = null;
  const notify = (listener: Listener, status: CotiEventHintStatus) => {
    if (listener.active) { try { listener.request.onStatus?.(status); } catch { /* Observer only. */ } }
  };
  const publishConnected = (listener: Listener) => {
    if (connection?.hasHeartbeat && listener.installed?.acknowledged &&
      listener.installed.generation === connection.generation && listener.connectedGeneration !== connection.generation) {
      listener.connectedGeneration = connection.generation;
      notify(listener, 'connected');
    }
  };
  const detachConnection = (old: Connection) => {
    old.detach?.();
    ignoreRealtimeSubscriptionAction(() => old.provider.off('block', old.onBlock));
    ignoreRealtimeSubscriptionAction(() => old.provider.off('debug', old.onDebug));
    for (const ack of old.acks.values()) ack.reject(new Error('COTI event hint scope changed.'));
    old.acks.clear(); old.rpcIds.clear();
  };
  const bounded = async <T,>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('COTI event hint setup timed out.')), setupMs);
      })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
  const remove = (listener: Listener) => {
    if (!listener.installed) return;
    const { provider } = listener.installed;
    listener.installed = undefined;
    listener.connectedGeneration = undefined;
    ignoreRealtimeSubscriptionAction(() => provider.off(listener.filter, listener.onLog));
    const key = subscriptionKey(listener.filter)!;
    if (connection?.provider === provider && ![...listeners].some(other => other !== listener && other.active &&
      other.installed && subscriptionKey(other.filter) === key)) {
      const ack = connection.acks.get(key);
      ack?.reject(new Error('COTI event hint listener disposed.'));
      connection.acks.delete(key);
      for (const [id, pending] of connection.rpcIds) if (pending === ack) connection.rpcIds.delete(id);
    }
  };
  const clearTimers = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    if (healthTimer !== null) clearTimeout(healthTimer);
    retryTimer = healthTimer = null;
  };
  const heartbeat = () => {
    if (!connection || listeners.size === 0) return;
    onHealthy();
    connection.hasHeartbeat = true;
    for (const listener of listeners) publishConnected(listener);
    if (healthTimer !== null) clearTimeout(healthTimer);
    healthTimer = setTimeout(() => loseConnection(), healthMs);
  };
  const queueReconnect = () => {
    if (listeners.size === 0 || retryTimer !== null) return;
    retryTimer = setTimeout(() => { retryTimer = null; void connect(); }, retryMs);
  };
  const loseConnection = () => {
    const old = connection;
    connection = null;
    generation++;
    clearTimers();
    if (old) detachConnection(old);
    for (const listener of listeners) { remove(listener); notify(listener, 'reconnecting'); }
    // A reset affects only the shared hint socket. HTTP snapshots keep their provider.
    void resetProvider().catch(() => {});
    queueReconnect();
  };
  const install = async (listener: Listener) => {
    const current = connection;
    if (!current || !listener.active || listener.installed?.generation === current.generation) return;
    listener.installed = { provider: current.provider, generation: current.generation, acknowledged: false };
    const key = subscriptionKey(listener.filter)!;
    let ack = current.acks.get(key);
    if (!ack) {
      let resolve!: () => void, reject!: (error: Error) => void;
      const result = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
      // Scope disposal can precede provider.on; keep the rejection handled.
      void result.catch(() => {});
      ack = { result, resolve, reject }; current.acks.set(key, ack);
    }
    const registration = current.provider.on(listener.filter, listener.onLog);
    void registration.then(() => {
      if (!listener.active || connection !== current) {
        ignoreRealtimeSubscriptionAction(() => current.provider.off(listener.filter, listener.onLog));
      }
    }, () => {});
    try { await bounded(Promise.all([registration, ack.result])); }
    catch (error) { if (listener.active && connection === current) throw error; else return; }
    if (listener.active && connection === current && listener.installed) {
      listener.installed.acknowledged = true;
      publishConnected(listener);
    }
  };
  const connect = async () => {
    if (connecting || listeners.size === 0) return;
    if (connection) {
      try { await Promise.all([...listeners].map(install)); } catch { loseConnection(); }
      return;
    }
    const attempt = ++generation;
    connecting = (async () => {
      try {
        const provider = await bounded(loadProvider());
        if (attempt !== generation || listeners.size === 0) return;
        const network = await bounded(provider.getNetwork());
        if (attempt !== generation || listeners.size === 0) return;
        if (network.chainId !== chainId) throw new Error('COTI event hints returned a different chain.');
        const current: Connection = { provider, generation: attempt, detach: null, hasHeartbeat: false,
          acks: new Map(), rpcIds: new Map(),
          onBlock: () => { if (connection === current) heartbeat(); },
          onDebug: event => {
            if (connection !== current || !event || typeof event !== 'object') return;
            // Installed SDK public debug lifecycle. Retain only selected filter
            // keys and RPC IDs; never retain packet bodies, results or log data.
            const debug = event as { action?: string; payload?: unknown; result?: unknown };
            if (debug.action === 'sendRpcPayload') {
              for (const item of Array.isArray(debug.payload) ? debug.payload : [debug.payload]) {
                const payload = item as { id?: number; method?: string; params?: unknown[] } | undefined;
                if (payload?.method !== 'eth_subscribe' || payload.params?.[0] !== 'logs' ||
                  !Number.isSafeInteger(payload.id)) continue;
                const key = subscriptionKey(payload.params[1]), ack = key ? current.acks.get(key) : undefined;
                if (ack) current.rpcIds.set(payload.id!, ack);
              }
            } else if (debug.action === 'receiveRpcResult') {
              for (const item of Array.isArray(debug.result) ? debug.result : [debug.result]) {
                const reply = item as { id?: number; result?: unknown; error?: unknown } | undefined;
                if (!reply || !Number.isSafeInteger(reply.id)) continue;
                const ack = current.rpcIds.get(reply.id!);
                if (!ack) continue;
                current.rpcIds.delete(reply.id!);
                if (reply.error || typeof reply.result !== 'string' || !reply.result) {
                  ack.reject(new Error('COTI event hint subscription was refused.'));
                } else ack.resolve();
              }
            } else if (debug.action === 'receiveRpcError') {
              for (const ack of current.rpcIds.values()) ack.reject(new Error('COTI event hint subscription failed.'));
              current.rpcIds.clear();
            }
          } };
        connection = current;
        current.detach = attachWsDisconnectListeners(provider, () => { if (connection === current) loseConnection(); });
        await bounded(provider.on('debug', current.onDebug));
        if (connection !== current) return;
        const registration = provider.on('block', current.onBlock);
        void registration.then(() => {
          if (connection !== current) ignoreRealtimeSubscriptionAction(() => provider.off('block', current.onBlock));
        }, () => {});
        await bounded(registration);
        if (connection !== current) return;
        // Correct chain + listener installation is not a subscription ACK or
        // a heartbeat. Until both arrive, consumers keep their HTTP fallback.
        if (!current.hasHeartbeat) healthTimer = setTimeout(() => loseConnection(), healthMs);
        await Promise.all([...listeners].map(install));
      } catch {
        if (attempt === generation) loseConnection();
      } finally {
        connecting = null;
        if (!connection) queueReconnect();
        else if ([...listeners].some(listener => listener.installed?.generation !== connection?.generation)) void connect();
      }
    })();
    await connecting;
  };

  return async request => {
    const address = typeof request.address === 'string' ? [request.address] : [...request.address];
    if (address.length === 0 || address.length > 32 || address.some(value => !/^0x[0-9a-f]{40}$/i.test(value))) {
      throw new Error('COTI event hints require exact contract addresses.');
    }
    const filter: HintFilter = { address, topics: request.topics?.map(topic => Array.isArray(topic) ? [...topic] : topic) as HintFilter['topics'] };
    const listener: Listener = { active: true, request, filter, onLog: log => {
      if (!listener.active || !connection || listener.installed?.generation !== connection.generation) return;
      try { request.onHint(log); } catch { /* Hints cannot change subscription state. */ }
    } };
    listeners.add(listener);
    notify(listener, 'reconnecting');
    if (retryTimer === null) void connect();
    return () => {
      if (!listener.active) return;
      listener.active = false;
      listeners.delete(listener);
      remove(listener);
      if (listeners.size === 0) {
        generation++;
        clearTimers();
        if (connection) {
          detachConnection(connection);
        }
        connection = null;
      }
    };
  };
};

export const subscribeCotiEventHints = createCotiEventHintSubscriber({
  loadProvider: loadCotiWsProvider,
  resetProvider: resetCotiWsProvider,
  chainId: BigInt(COTI_NETWORK.chainIdDecimal),
  onHealthy: markCotiWsHealthyNow
});
