import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import {
  CHAT_IMAGES_BUCKET,
  CHAT_IMAGE_UPLOADS_TABLE,
  IMAGE_RETENTION_HOURS,
  PENDING_IMAGE_RETENTION_MINUTES,
  jsonResponse
} from '../_shared/chat-image.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const LIST_PAGE_SIZE = 100;
const REMOVE_BATCH_SIZE = 1000;

const buildErrorResponse = (message: string, status = 400): Response =>
  jsonResponse({ error: message }, { status, headers: corsHeaders });

const chunkPaths = (paths: string[], size: number): string[][] => {
  const chunks: string[][] = [];
  for (let index = 0; index < paths.length; index += size) {
    chunks.push(paths.slice(index, index + size));
  }
  return chunks;
};

const loadExpiredTrackedBlobIds = async (
  supabaseAdmin: ReturnType<typeof createClient>,
  pendingCutoffIso: string,
  confirmedCutoffIso: string
): Promise<string[]> => {
  const [pending, confirmed] = await Promise.all([
    supabaseAdmin
      .from(CHAT_IMAGE_UPLOADS_TABLE)
      .select('blob_id')
      .is('confirmed_at', null)
      .lte('created_at', pendingCutoffIso)
      .limit(REMOVE_BATCH_SIZE),
    supabaseAdmin
      .from(CHAT_IMAGE_UPLOADS_TABLE)
      .select('blob_id')
      .not('confirmed_at', 'is', null)
      .lte('confirmed_at', confirmedCutoffIso)
      .limit(REMOVE_BATCH_SIZE)
  ]);

  if (pending.error) {
    throw new Error(pending.error.message || 'Failed to list pending image uploads.');
  }
  if (confirmed.error) {
    throw new Error(confirmed.error.message || 'Failed to list confirmed image uploads.');
  }

  return [...(pending.data ?? []), ...(confirmed.data ?? [])]
    .map((row) => typeof row.blob_id === 'string' ? row.blob_id : '')
    .filter(Boolean);
};

Deno.serve(async (request) => {
  const corsResponse = handleCorsPreflight(request);
  if (corsResponse) {
    return corsResponse;
  }

  if (request.method !== 'POST') {
    return buildErrorResponse('Method not allowed.', 405);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return buildErrorResponse('Supabase function secrets are unavailable.', 500);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const nowMs = Date.now();
  const cutoffMs = nowMs - IMAGE_RETENTION_HOURS * 60 * 60 * 1000;
  const pendingCutoffIso = new Date(nowMs - PENDING_IMAGE_RETENTION_MINUTES * 60 * 1000).toISOString();
  const confirmedCutoffIso = new Date(cutoffMs).toISOString();
  const expiredPaths = new Set<string>();
  let scannedCount = 0;
  let offset = 0;

  try {
    for (const blobId of await loadExpiredTrackedBlobIds(supabaseAdmin, pendingCutoffIso, confirmedCutoffIso)) {
      expiredPaths.add(blobId);
    }
  } catch (error) {
    return buildErrorResponse(error instanceof Error ? error.message : 'Failed to list tracked image uploads.', 500);
  }

  while (true) {
    const { data, error } = await supabaseAdmin.storage.from(CHAT_IMAGES_BUCKET).list('', {
      limit: LIST_PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' }
    });

    if (error) {
      return buildErrorResponse(error.message || 'Failed to list chat image storage.', 500);
    }

    if (!data || data.length === 0) {
      break;
    }

    scannedCount += data.length;
    for (const entry of data) {
      if (!entry.name || !entry.created_at) {
        continue;
      }

      const createdAtMs = Date.parse(entry.created_at);
      if (!Number.isFinite(createdAtMs)) {
        continue;
      }

      if (createdAtMs <= cutoffMs) {
        expiredPaths.add(entry.name);
      }
    }

    if (data.length < LIST_PAGE_SIZE) {
      break;
    }
    offset += data.length;
  }

  let deletedCount = 0;
  for (const batch of chunkPaths([...expiredPaths], REMOVE_BATCH_SIZE)) {
    const { error } = await supabaseAdmin.storage.from(CHAT_IMAGES_BUCKET).remove(batch);
    if (error) {
      return buildErrorResponse(error.message || 'Failed to delete expired chat images.', 500);
    }
    const { error: deleteRowsError } = await supabaseAdmin.from(CHAT_IMAGE_UPLOADS_TABLE).delete().in('blob_id', batch);
    if (deleteRowsError) {
      return buildErrorResponse(deleteRowsError.message || 'Failed to delete expired image upload records.', 500);
    }
    deletedCount += batch.length;
  }

  return jsonResponse(
    {
      bucket: CHAT_IMAGES_BUCKET,
      scannedCount,
      deletedCount,
      confirmedCutoffIso,
      pendingCutoffIso
    },
    { headers: corsHeaders }
  );
});
