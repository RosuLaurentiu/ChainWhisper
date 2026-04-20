import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import {
  CHAT_IMAGES_BUCKET,
  IMAGE_RETENTION_HOURS,
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
  const cutoffMs = Date.now() - IMAGE_RETENTION_HOURS * 60 * 60 * 1000;
  const expiredPaths: string[] = [];
  let scannedCount = 0;
  let offset = 0;

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
        expiredPaths.push(entry.name);
      }
    }

    if (data.length < LIST_PAGE_SIZE) {
      break;
    }
    offset += data.length;
  }

  let deletedCount = 0;
  for (const batch of chunkPaths(expiredPaths, REMOVE_BATCH_SIZE)) {
    const { error } = await supabaseAdmin.storage.from(CHAT_IMAGES_BUCKET).remove(batch);
    if (error) {
      return buildErrorResponse(error.message || 'Failed to delete expired chat images.', 500);
    }
    deletedCount += batch.length;
  }

  return jsonResponse(
    {
      bucket: CHAT_IMAGES_BUCKET,
      scannedCount,
      deletedCount,
      cutoffIso: new Date(cutoffMs).toISOString()
    },
    { headers: corsHeaders }
  );
});
