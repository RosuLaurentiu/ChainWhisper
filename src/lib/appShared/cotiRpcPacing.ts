import type { FetchGetUrlFunc } from '@coti-io/coti-ethers';

type QueueTiming = Readonly<{
  ahead: number;
  completed: number;
  waitedMs: number;
  budgetMs: number;
  transportMs: number;
  pacingMs: number;
  nextStartMs: number;
}>;

export function describeCotiRpcQueueExpiry(cause: Error): string | null {
  if (!('code' in cause) || cause.code !== 'COTI_RPC_QUEUE_EXPIRED' || !('queueTiming' in cause)) return null;
  const timing = cause.queueTiming as QueueTiming | undefined;
  if (!timing || ![timing.ahead, timing.completed, timing.waitedMs, timing.budgetMs,
    timing.transportMs, timing.pacingMs, timing.nextStartMs].every(value => Number.isSafeInteger(value) && value >= 0)) return null;
  return `request expired in queue; ${timing.waitedMs}/${timing.budgetMs}ms elapsed; ${timing.ahead} ahead, ${timing.completed} completed; ${timing.transportMs}ms transport, ${timing.pacingMs}ms pacing, ${timing.nextStartMs}ms next start`;
}

// shortcut: one queue per App tab; keep other services/tabs idle until combined load is measured.
export function createPacedCotiRpc(getUrl: FetchGetUrlFunc): FetchGetUrlFunc {
  let tail: Promise<unknown> = Promise.resolve();
  let lastStart: number | null = null;
  let stopped: Error | null = null;
  let pending = 0, completed = 0;
  let transportMs = 0, pacingMs = 0;
  let transportStartedAt: number | null = null, pacingStartedAt: number | null = null;
  const timing = () => {
    const now = performance.now();
    return { now, transport: transportMs + (transportStartedAt === null ? 0 : now - transportStartedAt),
      pacing: pacingMs + (pacingStartedAt === null ? 0 : now - pacingStartedAt) };
  };
  return (request, signal) => {
    const entered = timing(), ahead = pending++, completedAtEntry = completed;
    const expires = entered.now + request.timeout;
    const expired = (nextStartMs = 0) => {
      const current = timing();
      // Numeric local evidence only. Never retain URLs, headers, bodies or params.
      const queueTiming: QueueTiming = Object.freeze({ ahead, completed: completed - completedAtEntry,
        waitedMs: Math.round(current.now - entered.now), budgetMs: request.timeout,
        transportMs: Math.round(current.transport - entered.transport),
        pacingMs: Math.round(current.pacing - entered.pacing), nextStartMs });
      return Object.assign(new Error('COTI RPC read expired in queue.'), { code: 'COTI_RPC_QUEUE_EXPIRED', queueTiming });
    };
    const work = tail.then(async () => {
      if (stopped) throw stopped;
      signal?.checkSignal();
      while (lastStart !== null && performance.now() - lastStart < 500) {
        const delay = Math.ceil(500 - (performance.now() - lastStart));
        if (performance.now() + delay >= expires) throw expired(delay);
        pacingStartedAt = performance.now();
        try {
          await new Promise((resolve) => setTimeout(resolve, delay));
        } finally {
          // Timer elapsed time includes browser scheduling delay, not just the requested spacing.
          pacingMs += performance.now() - pacingStartedAt;
          pacingStartedAt = null;
        }
      }
      signal?.checkSignal();
      if (performance.now() >= expires) throw expired();
      const paced = request.clone();
      paced.timeout = Math.max(1, Math.floor(expires - performance.now()));
      lastStart = performance.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // The transport may still be reading a stalled body. Stop this queue
          // before rejecting; never start a replacement alongside that request.
          stopped ??= Object.assign(new Error('COTI RPC reads stopped after request timeout. No automatic retry.'), { code: 'TIMEOUT' });
          reject(stopped);
        }, paced.timeout);
      });
      let response: Awaited<ReturnType<FetchGetUrlFunc>>;
      transportStartedAt = performance.now();
      try {
        response = await Promise.race([getUrl(paced, signal), deadline]);
      } finally {
        transportMs += performance.now() - transportStartedAt;
        transportStartedAt = null;
        completed++;
        if (timer !== undefined) clearTimeout(timer);
      }
      // Stop before ethers can retry a throttle response or follow a redirect.
      if (response.statusCode === 403 || response.statusCode === 429) {
        stopped = new Error(`COTI RPC reads stopped after HTTP ${response.statusCode}. No automatic retry.`);
        throw stopped;
      }
      if (response.statusCode >= 300 && response.statusCode < 400) {
        throw new Error('COTI RPC redirect refused.');
      }
      return response;
    }).finally(() => { pending--; });
    tail = work.catch(() => {});
    return work;
  };
}
