import {
  CHAT_IMAGE_CLEANUP_BATCH_LIMIT,
  CHAT_IMAGE_CLEANUP_LEASE_SECONDS,
  handleChatImageCleanupHttpRequest,
  type ChatImageCleanupAdminClient,
  type ChatImageCleanupRuntime
} from './index.ts';

const CLEANUP_SECRET = 'chat-image-cleanup-test-secret-0123456789abcdef';

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const cleanupRequest = (secret = CLEANUP_SECRET): Request =>
  new Request('http://localhost/chat-image-cleanup', {
    method: 'POST',
    headers: { 'x-chat-image-cleanup-secret': secret }
  });

const makeBlobId = (index: number): string =>
  `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;

type MockState = {
  claimedArgs: Record<string, unknown> | null;
  deleteBatches: string[][];
  finishTokens: string[];
  listOptions: Array<Record<string, unknown>>;
  removeBatches: string[][];
};

const makeRuntime = (
  claim: Record<string, unknown>,
  options: {
    listData?: Array<{ created_at?: string; name?: string }>;
    listError?: string;
    removeError?: string;
  } = {}
): { runtime: ChatImageCleanupRuntime; state: MockState } => {
  const state: MockState = {
    claimedArgs: null,
    deleteBatches: [],
    finishTokens: [],
    listOptions: [],
    removeBatches: []
  };
  const client = {
    from: () => ({
      delete: () => ({
        in: (_column: string, values: string[]) => {
          state.deleteBatches.push([...values]);
          return Promise.resolve({ error: null });
        }
      })
    }),
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === 'claim_chat_image_cleanup_batch') {
        state.claimedArgs = args;
        return Promise.resolve({ data: claim, error: null });
      }
      if (name === 'finish_chat_image_cleanup_run') {
        state.finishTokens.push(String(args.p_lease_token ?? ''));
        return Promise.resolve({ data: true, error: null });
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
    storage: {
      from: () => ({
        list: (_path: string, listOptions: Record<string, unknown>) => {
          state.listOptions.push(listOptions);
          return Promise.resolve({
            data: options.listData ?? [],
            error: options.listError ? { message: options.listError } : null
          });
        },
        remove: (values: string[]) => {
          state.removeBatches.push([...values]);
          return Promise.resolve({
            error: options.removeError ? { message: options.removeError } : null
          });
        }
      })
    }
  } as unknown as ChatImageCleanupAdminClient;
  return {
    runtime: {
      cleanupSecret: CLEANUP_SECRET,
      createAdminClient: () => client,
      now: () => Date.parse('2026-08-09T12:00:00.000Z')
    },
    state
  };
};

Deno.test('cleanup rejects browser and unauthenticated calls before privileged work', async () => {
  let createdClients = 0;
  const runtime: ChatImageCleanupRuntime = {
    cleanupSecret: CLEANUP_SECRET,
    createAdminClient: () => {
      createdClients += 1;
      throw new Error('must not create a service-role client');
    },
    now: () => Date.now()
  };

  const missing = await handleChatImageCleanupHttpRequest(cleanupRequest(''), runtime);
  const wrong = await handleChatImageCleanupHttpRequest(cleanupRequest(`${CLEANUP_SECRET}-wrong`), runtime);
  const preflight = await handleChatImageCleanupHttpRequest(
    new Request('http://localhost/chat-image-cleanup', { method: 'OPTIONS' }),
    runtime
  );

  assert(missing.status === 401);
  assert(wrong.status === 401);
  assert(preflight.status === 405);
  assert(preflight.headers.get('access-control-allow-origin') === null);
  assert(createdClients === 0);
});

Deno.test('cleanup fails closed when its server secret is not high entropy', async () => {
  let createdClients = 0;
  const response = await handleChatImageCleanupHttpRequest(cleanupRequest('short'), {
    cleanupSecret: 'short',
    createAdminClient: () => {
      createdClients += 1;
      throw new Error('must not create a service-role client');
    },
    now: () => Date.now()
  });

  assert(response.status === 500);
  assert(createdClients === 0);
});

Deno.test('cleanup treats a held database lease as a successful no-op', async () => {
  const { runtime, state } = makeRuntime({
    admitted: false,
    retryAfterSeconds: 120
  });
  const response = await handleChatImageCleanupHttpRequest(cleanupRequest(), runtime);
  const body = await response.json() as Record<string, unknown>;

  assert(response.status === 202, JSON.stringify(body));
  assert(body.status === 'busy');
  assert(body.retryAfterSeconds === 120);
  assert(state.claimedArgs?.p_limit === CHAT_IMAGE_CLEANUP_BATCH_LIMIT);
  assert(state.claimedArgs?.p_lease_seconds === CHAT_IMAGE_CLEANUP_LEASE_SECONDS);
  assert(state.removeBatches.length === 0);
  assert(state.deleteBatches.length === 0);
  assert(state.finishTokens.length === 0);
});

Deno.test('cleanup caps database output and uses bounded delete batches', async () => {
  const leaseToken = '11111111-1111-4111-8111-111111111111';
  const blobIds = Array.from({ length: CHAT_IMAGE_CLEANUP_BATCH_LIMIT + 10 }, (_, index) => makeBlobId(index));
  const { runtime, state } = makeRuntime({ admitted: true, leaseToken, blobIds });

  const response = await handleChatImageCleanupHttpRequest(cleanupRequest(), runtime);
  const body = await response.json() as Record<string, unknown>;

  assert(response.status === 200, JSON.stringify(body));
  assert(body.deletedCount === CHAT_IMAGE_CLEANUP_BATCH_LIMIT);
  assert(state.removeBatches.flat().length === CHAT_IMAGE_CLEANUP_BATCH_LIMIT);
  assert(state.deleteBatches.flat().length === CHAT_IMAGE_CLEANUP_BATCH_LIMIT);
  assert(state.removeBatches.every((batch) => batch.length <= 100));
  assert(state.deleteBatches.every((batch) => batch.length <= 100));
  assert(state.finishTokens.length === 1 && state.finishTokens[0] === leaseToken);
});

Deno.test('cleanup releases its lease after a storage failure', async () => {
  const leaseToken = '22222222-2222-4222-8222-222222222222';
  const { runtime, state } = makeRuntime(
    { admitted: true, leaseToken, blobIds: [makeBlobId(1)] },
    { removeError: 'storage unavailable' }
  );

  const response = await handleChatImageCleanupHttpRequest(cleanupRequest(), runtime);
  const body = await response.json() as Record<string, unknown>;

  assert(response.status === 500, JSON.stringify(body));
  assert(state.deleteBatches.length === 0);
  assert(state.finishTokens.length === 1 && state.finishTokens[0] === leaseToken);
});

Deno.test('cleanup adds only one bounded page of expired orphan objects', async () => {
  const leaseToken = '33333333-3333-4333-8333-333333333333';
  const tracked = makeBlobId(10);
  const expiredOrphan = makeBlobId(11);
  const freshOrphan = makeBlobId(12);
  const { runtime, state } = makeRuntime(
    { admitted: true, leaseToken, blobIds: [tracked] },
    {
      listData: [
        { name: expiredOrphan, created_at: '2026-08-08T11:59:59.000Z' },
        { name: freshOrphan, created_at: '2026-08-09T11:59:59.000Z' },
        { name: 'not-a-blob-id', created_at: '2026-08-08T11:59:59.000Z' }
      ]
    }
  );

  const response = await handleChatImageCleanupHttpRequest(cleanupRequest(), runtime);
  const body = await response.json() as Record<string, unknown>;

  assert(response.status === 200, JSON.stringify(body));
  assert(body.candidateCount === 2);
  assert(state.listOptions.length === 1);
  assert(state.listOptions[0]?.limit === 100);
  assert(JSON.stringify(state.listOptions[0]?.sortBy) === JSON.stringify({
    column: 'created_at',
    order: 'asc'
  }));
  assert(state.removeBatches.flat().includes(tracked));
  assert(state.removeBatches.flat().includes(expiredOrphan));
  assert(!state.removeBatches.flat().includes(freshOrphan));
});
