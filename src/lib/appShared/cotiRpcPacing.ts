import type { FetchGetUrlFunc } from '@coti-io/coti-ethers';

// Exact ABI selectors, derived once with the installed SDK's id(signature).
const BACKGROUND_METADATA_SELECTORS = new Set([
  '0x95d89b41', // symbol()
  '0x313ce567', // decimals()
  '0xa0a8e460', // contractVersion()
  '0x70955607' // supportsFeature(bytes32)
]);
const DIAGNOSTIC_METHODS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber',
  'eth_getBlockByHash', 'eth_getCode', 'eth_getBalance', 'eth_getTransactionCount', 'eth_call',
  'eth_getLogs', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getStorageAt',
  'eth_estimateGas', 'eth_gasPrice', 'eth_feeHistory', 'eth_sendRawTransaction']);

type RpcFailure = Readonly<{
  at: number;
  kind: 'http' | 'timeout' | 'rpc';
  method: string;
  callSelector?: string;
  rpcCode?: number;
  revertSelector?: string;
  category: 'foreground' | 'essential' | 'background';
  provider: string;
  queuedMs: number;
  physicalMs: number;
  status?: number;
  headers: Readonly<Record<string, string>>;
}>;

type QueueTiming = Readonly<{
  ahead: number;
  completed: number;
  waitedMs: number;
  budgetMs: number;
  transportMs: number;
  pacingMs: number;
  nextStartMs: number;
}>;

export type CotiRpcQueueSnapshot = Readonly<{
  sampledAt: number;
  queuedEssential: number;
  queuedBackground: number;
  inFlight: boolean;
  started: number;
  completed: number;
  transportMs: number;
  pacingMs: number;
  stopped: boolean;
  failure?: RpcFailure;
  requestTimeout?: Readonly<{ queuedMs: number; budgetMs: number; remainingMs: number; physicalMs: number;
    source: 'deadline' | 'sdk' }>;
  comparison?: Readonly<{ timingStartedAt: number | null; startedBeforeTiming: number | null; reason: string | null }>;
}>;
type ScopedFetchGetUrl = (request: Parameters<FetchGetUrlFunc>[0],
  signal?: Parameters<FetchGetUrlFunc>[1], pendingScope?: AbortSignal,
  assertPendingCurrent?: () => void) => ReturnType<FetchGetUrlFunc>;
type PacedCotiRpc = ScopedFetchGetUrl & Readonly<{ foreground: ScopedFetchGetUrl;
  beginComparison: () => void; stopComparison: (reason: string) => void }>;

export function describeCotiRpcQueueExpiry(cause: Error): string | null {
  if (!('code' in cause) || cause.code !== 'COTI_RPC_QUEUE_EXPIRED' || !('queueTiming' in cause)) return null;
  const timing = cause.queueTiming as QueueTiming | undefined;
  if (!timing || ![timing.ahead, timing.completed, timing.waitedMs, timing.budgetMs,
    timing.transportMs, timing.pacingMs, timing.nextStartMs].every(value => Number.isSafeInteger(value) && value >= 0)) return null;
  return `request expired in queue; ${timing.waitedMs}/${timing.budgetMs}ms elapsed; ${timing.ahead} ahead, ${timing.completed} completed; ${timing.transportMs}ms transport, ${timing.pacingMs}ms pacing, ${timing.nextStartMs}ms next start`;
}

// One physical request per tab. Services and wallet extensions have separate traffic.
export function createPacedCotiRpc(
  getUrl: FetchGetUrlFunc,
  observe?: (snapshot: CotiRpcQueueSnapshot) => void,
  comparison = false,
  comparisonIntervalMs: 0 | 334 | 500 = 334
): PacedCotiRpc {
  type Work = () => Promise<void>;
  const foregroundWork: Work[] = [], essential: Work[] = [], background: Work[] = [];
  let running = false, highTurns = 0, foregroundTurns = 0;
  const drain = async () => {
    if (running) return;
    running = true;
    try {
      while (foregroundWork.length || essential.length || background.length) {
        // Current setup precedes ordinary producers. Background still gets a
        // turn after three high-priority reads; ordinary essential work gets a
        // turn after three foreground reads. All share the same transport.
        const backfillTurn = background.length > 0 && (highTurns >= 3 || !foregroundWork.length && !essential.length);
        let work: Work;
        if (backfillTurn) {
          work = background.shift()!;
          highTurns = 0;
        } else {
          const foregroundTurn = foregroundWork.length > 0 && (foregroundTurns < 3 || !essential.length);
          work = (foregroundTurn ? foregroundWork : essential).shift()!;
          foregroundTurns = foregroundTurn ? foregroundTurns + 1 : 0;
          highTurns = Math.min(3, highTurns + 1);
        }
        await work();
      }
    } finally {
      running = false;
    }
  };
  let lastStart: number | null = null;
  let stopped: Error | null = null;
  let requestTimeout: CotiRpcQueueSnapshot['requestTimeout'];
  let failure: RpcFailure | undefined;
  let pending = 0, completed = 0, started = 0;
  let transportMs = 0, pacingMs = 0;
  let transportStartedAt: number | null = null, pacingStartedAt: number | null = null;
  let physicalStartedAt: number | null = null, physicalTransportMs = 0, physicalCompleted = 0;
  const intervalMs = comparison ? comparisonIntervalMs : 0;
  // The zero-gap DEX History check has a separate approved complete-page allowance.
  const comparisonRequestLimit = comparisonIntervalMs === 0 ? 2_000 : 600;
  let timingStartedAt: number | null = null, startedBeforeTiming: number | null = null;
  let deadline: number | null = null, comparisonReason: string | null = null;
  let comparisonTimer: ReturnType<typeof setTimeout> | undefined;
  const timing = () => {
    const now = performance.now();
    return { now, transport: transportMs + (transportStartedAt === null ? 0 : now - transportStartedAt),
      pacing: pacingMs + (pacingStartedAt === null ? 0 : now - pacingStartedAt) };
  };
  const publish = () => {
    if (!observe) return;
    const current = timing();
    // Counters and the first sanitized failure only; never payloads or identities.
    const snapshot: CotiRpcQueueSnapshot = Object.freeze({ sampledAt: Date.now(),
      queuedEssential: foregroundWork.length + essential.length, queuedBackground: background.length,
      inFlight: physicalStartedAt !== null, started, completed: physicalCompleted,
      transportMs: Math.round(physicalTransportMs + (physicalStartedAt === null ? 0 : current.now - physicalStartedAt)),
      pacingMs: Math.round(current.pacing), stopped: stopped !== null,
      ...(requestTimeout ? { requestTimeout } : {}),
      ...(failure ? { failure } : {}),
      ...(comparison ? { comparison: { timingStartedAt, startedBeforeTiming, reason: comparisonReason } } : {}) });
    try { observe(snapshot); } catch { /* Development observation is optional. */ }
  };
  const stopComparison = (reason: string) => {
    if (!comparison || comparisonReason !== null) return;
    comparisonReason = reason;
    if (comparisonTimer !== undefined) clearTimeout(comparisonTimer);
    stopped ??= new Error(`COTI RPC comparison stopped: ${reason}. No automatic retry.`);
    publish();
  };
  const beginComparison = () => {
    if (!comparison || stopped || timingStartedAt !== null) return;
    timingStartedAt = Date.now();
    startedBeforeTiming = started;
    deadline = performance.now() + 300_000;
    comparisonTimer = setTimeout(() => stopComparison('time-limit'), 300_000);
    publish();
  };
  const checkComparison = () => {
    if (!comparison) return;
    if (started >= comparisonRequestLimit) stopComparison('request-limit');
    if (deadline !== null && performance.now() >= deadline) stopComparison('time-limit');
    if (stopped) throw stopped;
  };
  const enqueue = (request: Parameters<FetchGetUrlFunc>[0], signal: Parameters<FetchGetUrlFunc>[1], foreground: boolean,
    pendingScope?: AbortSignal, assertPendingCurrent?: () => void) => {
    const entered = timing(), ahead = pending++, completedAtEntry = completed;
    const expires = entered.now + request.timeout;
    let method = 'other', isBackground = false, callSelector: string | undefined;
    let expectedLimitHistoryId: number | undefined;
    const recordFailure = (kind: RpcFailure['kind'], admittedAt: number, status?: number,
      headers: Record<string, string> = {}, rpcError?: unknown) => {
      if (failure) return;
      const safeHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) {
        const name = key.toLowerCase();
        if (['retry-after', 'x-request-id', 'x-correlation-id', 'cf-ray'].includes(name) &&
          typeof value === 'string' && /^[A-Za-z0-9 .,:_-]{1,128}$/.test(value)) safeHeaders[name] = value;
      }
      let provider = 'unknown';
      try { provider = new URL(request.url).hostname; } catch { /* No raw URL in diagnostics. */ }
      const rpc = rpcError && typeof rpcError === 'object' ? rpcError as { code?: unknown; data?: unknown } : undefined;
      failure = Object.freeze({ at: Date.now(), kind, method,
        ...(callSelector ? { callSelector } : {}),
        ...(typeof rpc?.code === 'number' && Number.isSafeInteger(rpc.code) ? { rpcCode: rpc.code } : {}),
        // A no-argument error selector is public ABI metadata; do not retain error arguments or messages.
        ...(method === 'eth_call' && typeof rpc?.data === 'string' && /^0x[0-9a-f]{8}$/i.test(rpc.data) ? { revertSelector: rpc.data.toLowerCase() } : {}),
        category: foreground ? 'foreground' : isBackground ? 'background' : 'essential', provider,
        queuedMs: Math.round(admittedAt - entered.now), physicalMs: Math.round(performance.now() - admittedAt),
        ...(status === undefined ? {} : { status }), headers: Object.freeze(safeHeaders) });
    };
    const expired = (nextStartMs = 0) => {
      const current = timing();
      // Numeric local evidence only. Never retain URLs, headers, bodies or params.
      const queueTiming: QueueTiming = Object.freeze({ ahead, completed: completed - completedAtEntry,
        waitedMs: Math.round(current.now - entered.now), budgetMs: request.timeout,
        transportMs: Math.round(current.transport - entered.transport),
        pacingMs: Math.round(current.pacing - entered.pacing), nextStartMs });
      return Object.assign(new Error('COTI RPC read expired in queue.'), { code: 'COTI_RPC_QUEUE_EXPIRED', queueTiming });
    };
    let settled = false, sent = false;
    let wakeWaiting!: () => void;
    const unsentDone = new Promise<void>(resolve => { wakeWaiting = resolve; });
    let clearQueuedDeadline = () => {};
    const work = async () => {
      if (settled) return;
      if (stopped) throw stopped;
      signal?.checkSignal();
      checkComparison();
      while (lastStart !== null && performance.now() - lastStart < intervalMs) {
        const delay = Math.ceil(intervalMs - (performance.now() - lastStart));
        if (performance.now() + delay >= expires) throw expired(delay);
        pacingStartedAt = performance.now();
        publish();
        let pacingTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([new Promise(resolve => { pacingTimer = setTimeout(resolve, delay); }), unsentDone]);
        } finally {
          if (pacingTimer !== undefined) clearTimeout(pacingTimer);
          // Timer elapsed time includes browser scheduling delay, not just the requested spacing.
          pacingMs += performance.now() - pacingStartedAt;
          pacingStartedAt = null;
          publish();
        }
        if (settled) return;
      }
      signal?.checkSignal();
      if (performance.now() >= expires) throw expired();
      assertPendingCurrent?.();
      // Recheck after pacing; no physical start may cross the trial boundary.
      checkComparison();
      const paced = request.clone();
      // Queue expiry and response timeout are separate finite budgets.
      paced.timeout = request.timeout;
      const admittedAt = performance.now();
      sent = true;
      clearQueuedDeadline();
      lastStart = performance.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // The transport may still be reading a stalled body. Stop this queue
          // before rejecting; never start a replacement alongside that request.
          requestTimeout ??= Object.freeze({ queuedMs: Math.round(admittedAt - entered.now), budgetMs: request.timeout,
            remainingMs: paced.timeout, physicalMs: Math.round(performance.now() - admittedAt), source: 'deadline' });
          recordFailure('timeout', admittedAt);
          stopped ??= Object.assign(new Error('COTI RPC reads stopped after request timeout. No automatic retry.'), { code: 'TIMEOUT', rpcFailure: failure });
          publish();
          reject(stopped);
        }, paced.timeout);
      });
      let response: Awaited<ReturnType<FetchGetUrlFunc>>;
      transportStartedAt = performance.now();
      physicalStartedAt = transportStartedAt;
      started++;
      publish();
      const transport = async () => {
        try { return await getUrl(paced, signal); }
        finally {
          physicalTransportMs += performance.now() - physicalStartedAt!;
          physicalStartedAt = null;
          physicalCompleted++;
          publish();
        }
      };
      try {
        response = await Promise.race([transport(), deadline]);
      } catch (error) {
        // The SDK can report its own TIMEOUT before our deadline timer fires.
        if (error && typeof error === 'object' && 'code' in error && error.code === 'TIMEOUT') {
          requestTimeout ??= Object.freeze({ queuedMs: Math.round(admittedAt - entered.now), budgetMs: request.timeout,
            remainingMs: paced.timeout, physicalMs: Math.round(performance.now() - admittedAt), source: 'sdk' });
          recordFailure('timeout', admittedAt);
          stopped ??= Object.assign(new Error('COTI RPC reads stopped after request timeout. No automatic retry.'), { code: 'TIMEOUT', rpcFailure: failure });
          throw stopped;
        }
        throw error;
      } finally {
        transportMs += performance.now() - transportStartedAt;
        transportStartedAt = null;
        completed++;
        if (timer !== undefined) clearTimeout(timer);
      }
      // Stop before ethers can retry a throttle response or follow a redirect.
      if (response.statusCode === 403 || response.statusCode === 429) {
        recordFailure('http', admittedAt, response.statusCode, response.headers);
        stopped = Object.assign(new Error(`COTI RPC reads stopped after HTTP ${response.statusCode}. No automatic retry.`), { rpcFailure: failure });
        throw stopped;
      }
      if (comparison) {
        if (stopped) throw stopped;
        if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('Comparison HTTP failure.');
        let body;
        try { body = JSON.parse(new TextDecoder().decode(response.body ?? new Uint8Array())); }
        catch {
          recordFailure('rpc', admittedAt, response.statusCode, response.headers);
          throw new Error('Comparison RPC failure.');
        }
        const replies = Array.isArray(body) ? body : [body];
        const failed = replies.findIndex(reply => !reply || typeof reply !== 'object' || 'error' in reply || !('result' in reply));
        // Pass only the expected non-owner receipt denial to the existing SDK/reader handler.
        const expectedDenial = expectedLimitHistoryId !== undefined && response.statusCode === 200 &&
          body && typeof body === 'object' && !Array.isArray(body) && body.jsonrpc === '2.0' &&
          body.id === expectedLimitHistoryId && !('result' in body) && body.error?.code === 3 &&
          typeof body.error?.message === 'string' && body.error?.data === '0x26abae6e';
        if (!replies.length || failed >= 0 && !expectedDenial) {
          recordFailure('rpc', admittedAt, response.statusCode, response.headers, replies[failed]?.error);
          throw new Error('Comparison RPC failure.');
        }
        if (started === comparisonRequestLimit) stopComparison('request-limit');
      }
      if (response.statusCode >= 300 && response.statusCode < 400) {
        throw new Error('COTI RPC redirect refused.');
      }
      return response;
    };
    try {
      const payload = JSON.parse(new TextDecoder().decode(request.body ?? new Uint8Array()));
      // Do not retain the payload or coalesce transport responses (IDs differ).
      const items = Array.isArray(payload) ? payload : [payload];
      method = items.length === 1 && DIAGNOSTIC_METHODS.has(items[0]?.method) ? items[0].method : 'other';
      const data = method === 'eth_call' ? items[0]?.params?.[0]?.data : undefined;
      if (typeof data === 'string' && /^0x[0-9a-f]{8}(?:[0-9a-f]{2})*$/i.test(data)) callSelector = data.slice(0, 10).toLowerCase();
      const call = payload?.params?.[0], block = payload?.params?.[1];
      if (comparison && pendingScope && assertPendingCurrent && !Array.isArray(payload) &&
          Number.isSafeInteger(payload?.id) && payload.id < 0 && payload.jsonrpc === '2.0' &&
          method === 'eth_call' && payload.params?.length === 2 && call && Object.keys(call).length === 3 &&
          typeof call.from === 'string' && /^0x[0-9a-f]{40}$/i.test(call.from) &&
          typeof call.to === 'string' && /^0x[0-9a-f]{40}$/i.test(call.to) &&
          typeof data === 'string' && /^0x397d04650{63}1[0-9a-f]{64}$/i.test(data) &&
          block && typeof block === 'object' && !Array.isArray(block) && Object.keys(block).length === 2 &&
          block.requireCanonical === true && typeof block.blockHash === 'string' && /^0x[0-9a-f]{64}$/i.test(block.blockHash)) {
        expectedLimitHistoryId = payload.id;
      }
      isBackground = !foreground && items.length > 0 && items.every(item =>
        item.method === 'eth_getLogs' || item.method === 'eth_getCode' ||
        (item.method === 'eth_call' && BACKGROUND_METADATA_SELECTORS.has(item.params?.[0]?.data?.slice(0, 10)?.toLowerCase())));
    } catch {
      // Unknown/financial requests keep essential admission; no payload is logged.
    }
    return new Promise<Awaited<ReturnType<FetchGetUrlFunc>>>((resolve, reject) => {
      const queue = foreground ? foregroundWork : isBackground ? background : essential;
      const finish = () => {
        settled = true;
        clearQueuedDeadline();
        pending--;
        publish();
      };
      const queuedWork = async () => {
        try {
          const response = await work();
          if (!settled) { finish(); resolve(response!); }
        } catch (error) {
          // A trial stops on any failed physical request, including JSON-RPC errors.
          if (comparison && sent) stopComparison('rpc-failure');
          if (!settled) { finish(); reject(error); }
        }
      };
      const cancelUnsent = (error: unknown) => {
        if (sent || settled) return;
        const index = queue.indexOf(queuedWork);
        if (index !== -1) queue.splice(index, 1);
        finish();
        reject(error);
        wakeWaiting();
      };
      const abortScope = () => cancelUnsent(pendingScope!.reason);
      const queueTimer = setTimeout(() => cancelUnsent(stopped ?? expired()), request.timeout);
      clearQueuedDeadline = () => {
        clearTimeout(queueTimer);
        pendingScope?.removeEventListener('abort', abortScope);
      };
      queue.push(queuedWork);
      pendingScope?.addEventListener('abort', abortScope, { once: true });
      if (pendingScope?.aborted) abortScope();
      if (signal) {
        const cancelSignal = () => {
          try { signal.checkSignal(); } catch (error) { cancelUnsent(error); }
        };
        try { signal.addListener(cancelSignal); } catch { cancelSignal(); }
      }
      publish();
      void drain();
    });
  };
  // Both entries use the exact same queue, spacing, transport and sticky stop.
  const normal: ScopedFetchGetUrl = (request, signal, pendingScope, assertPendingCurrent) =>
    enqueue(request, signal, false, pendingScope, assertPendingCurrent);
  const foreground: ScopedFetchGetUrl = (request, signal, pendingScope, assertPendingCurrent) =>
    enqueue(request, signal, true, pendingScope, assertPendingCurrent);
  return Object.assign(normal, { foreground, beginComparison, stopComparison });
}
