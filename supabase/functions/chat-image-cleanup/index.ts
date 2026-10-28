import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'supabase';
import {
  BLOB_ID_REGEX,
  CHAT_IMAGES_BUCKET,
  CHAT_IMAGE_UPLOADS_TABLE,
  IMAGE_RETENTION_HOURS,
  PENDING_IMAGE_RETENTION_MINUTES,
  jsonResponse
} from '../_shared/chat-image.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CHAT_IMAGE_CLEANUP_SECRET = Deno.env.get('CHAT_IMAGE_CLEANUP_SECRET') ?? '';

export const CHAT_IMAGE_CLEANUP_BATCH_LIMIT = 500;
export const CHAT_IMAGE_CLEANUP_LEASE_SECONDS = 300;
const REMOVE_BATCH_SIZE = 100;
const MIN_CLEANUP_SECRET_BYTES = 32;
const SUPABASE_REQUEST_TIMEOUT_MS = 8_000;
const LEASE_TOKEN_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CleanupError = { message?: string } | null;
type CleanupResult = PromiseLike<{ data?: unknown; error: CleanupError }>;

export type ChatImageCleanupAdminClient = {
  from: (table: string) => {
    delete: () => {
      in: (column: string, values: string[]) => CleanupResult;
    };
  };
  rpc: (name: string, args: Record<string, unknown>) => CleanupResult;
  storage: {
    from: (bucket: string) => {
      list: (
        path: string,
        options: {
          limit: number;
          offset: number;
          sortBy: { column: string; order: string };
        }
      ) => CleanupResult;
      remove: (values: string[]) => CleanupResult;
    };
  };
};

export type ChatImageCleanupRuntime = {
  cleanupSecret: string;
  configurationAvailable?: boolean;
  createAdminClient: () => ChatImageCleanupAdminClient;
  now: () => number;
};

type CleanupClaim = {
  admitted: boolean;
  blobIds: string[];
  leaseToken: string;
  retryAfterSeconds: number;
};

const defaultRuntime: ChatImageCleanupRuntime = {
  cleanupSecret: CHAT_IMAGE_CLEANUP_SECRET,
  configurationAvailable: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY),
  createAdminClient: () =>
    createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: {
        fetch: (input, init = {}) => fetch(input, {
          ...init,
          signal: AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS)
        })
      }
    }) as unknown as ChatImageCleanupAdminClient,
  now: () => Date.now()
};

const buildErrorResponse = (message: string, status: number): Response =>
  jsonResponse({ error: message }, { status });

const chunkPaths = (paths: string[], size: number): string[][] => {
  const chunks: string[][] = [];
  for (let index = 0; index < paths.length; index += size) {
    chunks.push(paths.slice(index, index + size));
  }
  return chunks;
};

const isConfiguredSecret = (secret: string): boolean =>
  new TextEncoder().encode(secret).byteLength >= MIN_CLEANUP_SECRET_BYTES;

const secretsMatch = async (expected: string, provided: string): Promise<boolean> => {
  const encoder = new TextEncoder();
  const [expectedDigest, providedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
    crypto.subtle.digest('SHA-256', encoder.encode(provided))
  ]);
  const expectedBytes = new Uint8Array(expectedDigest);
  const providedBytes = new Uint8Array(providedDigest);
  let mismatch = expectedBytes.length ^ providedBytes.length;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    mismatch |= expectedBytes[index] ^ (providedBytes[index] ?? 0);
  }
  return mismatch === 0;
};

const normalizeClaim = (value: unknown): CleanupClaim | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.admitted === false) {
    const retryAfterSeconds = Number(record.retryAfterSeconds ?? record.retry_after_seconds ?? 0);
    return {
      admitted: false,
      blobIds: [],
      leaseToken: '',
      retryAfterSeconds: Number.isFinite(retryAfterSeconds)
        ? Math.max(0, Math.min(CHAT_IMAGE_CLEANUP_LEASE_SECONDS, Math.ceil(retryAfterSeconds)))
        : 0
    };
  }
  const leaseToken = typeof record.leaseToken === 'string'
    ? record.leaseToken
    : typeof record.lease_token === 'string'
      ? record.lease_token
      : '';
  const rawBlobIds = Array.isArray(record.blobIds)
    ? record.blobIds
    : Array.isArray(record.blob_ids)
      ? record.blob_ids
      : null;
  if (record.admitted !== true || !LEASE_TOKEN_REGEX.test(leaseToken) || !rawBlobIds) {
    return null;
  }
  const blobIds: string[] = [];
  const seen = new Set<string>();
  for (const value of rawBlobIds) {
    if (typeof value !== 'string' || !BLOB_ID_REGEX.test(value)) {
      continue;
    }
    if (!seen.has(value)) {
      seen.add(value);
      blobIds.push(value);
    }
    if (blobIds.length >= CHAT_IMAGE_CLEANUP_BATCH_LIMIT) {
      break;
    }
  }
  return { admitted: true, blobIds, leaseToken, retryAfterSeconds: 0 };
};

const logCleanupError = (stage: string, error: unknown): void => {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String(error.message)
      : String(error);
  console.error(`chat-image-cleanup ${stage}: ${message}`);
};

export const handleChatImageCleanupHttpRequest = async (
  request: Request,
  runtime: ChatImageCleanupRuntime = defaultRuntime
): Promise<Response> => {
  if (request.method !== 'POST') {
    return buildErrorResponse('Method not allowed.', 405);
  }
  if (runtime.configurationAvailable === false || !isConfiguredSecret(runtime.cleanupSecret)) {
    return buildErrorResponse('Chat image cleanup is not configured.', 500);
  }
  const providedSecret = request.headers.get('x-chat-image-cleanup-secret') ?? '';
  if (!providedSecret || !(await secretsMatch(runtime.cleanupSecret, providedSecret))) {
    return buildErrorResponse('Unauthorized.', 401);
  }

  let supabaseAdmin: ChatImageCleanupAdminClient;
  try {
    supabaseAdmin = runtime.createAdminClient();
  } catch (error) {
    logCleanupError('client', error);
    return buildErrorResponse('Chat image cleanup is unavailable.', 500);
  }

  const nowMs = runtime.now();
  const pendingCutoffIso = new Date(
    nowMs - PENDING_IMAGE_RETENTION_MINUTES * 60 * 1000
  ).toISOString();
  const confirmedCutoffIso = new Date(nowMs - IMAGE_RETENTION_HOURS * 60 * 60 * 1000).toISOString();
  let claim: CleanupClaim | null = null;
  try {
    const { data, error } = await supabaseAdmin.rpc('claim_chat_image_cleanup_batch', {
      p_confirmed_cutoff: confirmedCutoffIso,
      p_lease_seconds: CHAT_IMAGE_CLEANUP_LEASE_SECONDS,
      p_limit: CHAT_IMAGE_CLEANUP_BATCH_LIMIT,
      p_pending_cutoff: pendingCutoffIso
    });
    if (error) {
      logCleanupError('claim', error);
      return buildErrorResponse('Failed to claim chat image cleanup work.', 500);
    }
    claim = normalizeClaim(data);
    if (!claim) {
      return buildErrorResponse('Invalid chat image cleanup claim.', 500);
    }
  } catch (error) {
    logCleanupError('claim', error);
    return buildErrorResponse('Failed to claim chat image cleanup work.', 500);
  }

  if (!claim.admitted) {
    return jsonResponse(
      { status: 'busy', retryAfterSeconds: claim.retryAfterSeconds },
      { status: 202 }
    );
  }

  const candidateBlobIds = [...claim.blobIds];
  const candidateSet = new Set(candidateBlobIds);
  let deletedCount = 0;
  let workError: unknown = null;
  const remainingCapacity = CHAT_IMAGE_CLEANUP_BATCH_LIMIT - candidateBlobIds.length;
  if (remainingCapacity > 0) {
    try {
      const { data, error } = await supabaseAdmin.storage.from(CHAT_IMAGES_BUCKET).list('', {
        limit: Math.min(REMOVE_BATCH_SIZE, remainingCapacity),
        offset: 0,
        sortBy: { column: 'created_at', order: 'asc' }
      });
      if (error) {
        workError = error;
      } else if (Array.isArray(data)) {
        const confirmedCutoffMs = Date.parse(confirmedCutoffIso);
        for (const entry of data) {
          if (!entry || typeof entry !== 'object') continue;
          const record = entry as Record<string, unknown>;
          const name = typeof record.name === 'string' ? record.name : '';
          const createdAt = typeof record.created_at === 'string'
            ? Date.parse(record.created_at)
            : Number.NaN;
          if (
            !BLOB_ID_REGEX.test(name) ||
            !Number.isFinite(createdAt) ||
            createdAt > confirmedCutoffMs ||
            candidateSet.has(name)
          ) {
            continue;
          }
          candidateSet.add(name);
          candidateBlobIds.push(name);
          if (candidateBlobIds.length >= CHAT_IMAGE_CLEANUP_BATCH_LIMIT) break;
        }
      }
    } catch (error) {
      workError = error;
    }
  }

  for (const batch of workError ? [] : chunkPaths(candidateBlobIds, REMOVE_BATCH_SIZE)) {
    try {
      const { error: removeError } = await supabaseAdmin.storage.from(CHAT_IMAGES_BUCKET).remove(batch);
      if (removeError) {
        workError = removeError;
        break;
      }
      const { error: deleteRowsError } = await supabaseAdmin
        .from(CHAT_IMAGE_UPLOADS_TABLE)
        .delete()
        .in('blob_id', batch);
      if (deleteRowsError) {
        workError = deleteRowsError;
        break;
      }
      deletedCount += batch.length;
    } catch (error) {
      workError = error;
      break;
    }
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('finish_chat_image_cleanup_run', {
      p_lease_token: claim.leaseToken
    });
    if (error || data !== true) {
      logCleanupError('release', error ?? 'lease token was not active');
      workError ??= error ?? new Error('Failed to release chat image cleanup lease.');
    }
  } catch (error) {
    logCleanupError('release', error);
    workError ??= error;
  }

  if (workError) {
    logCleanupError('work', workError);
    return buildErrorResponse('Failed to delete expired chat images.', 500);
  }

  return jsonResponse({
    bucket: CHAT_IMAGES_BUCKET,
    candidateCount: candidateBlobIds.length,
    confirmedCutoffIso,
    deletedCount,
    pendingCutoffIso,
    status: 'completed'
  });
};

if (import.meta.main) {
  Deno.serve((request) => handleChatImageCleanupHttpRequest(request));
}
