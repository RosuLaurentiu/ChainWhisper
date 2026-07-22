import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  BLOB_ID_REGEX,
  CHAT_IMAGES_BUCKET,
  CHAT_IMAGE_UPLOADS_TABLE,
  MAX_IMAGE_ENCRYPTED_BYTES,
  MAX_IMAGE_PLAINTEXT_BYTES,
  WALLET_ADDRESS_REGEX,
  jsonResponse,
  normalizeMimeType
} from '../_shared/chat-image.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CONVERSATION_KINDS = new Set(['direct', 'group']);

const buildErrorResponse = (message: string, status = 400): Response =>
  jsonResponse({ error: message }, { status, headers: corsHeaders });

const normalizeHeader = (request: Request, name: string): string => request.headers.get(name)?.trim() ?? '';

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

  const blobId = normalizeHeader(request, 'x-chat-image-blob-id').toLowerCase();
  const ownerAddress = normalizeHeader(request, 'x-chat-image-owner').toLowerCase();
  const mime = normalizeMimeType(normalizeHeader(request, 'x-chat-image-mime'));
  const kind = normalizeHeader(request, 'x-chat-image-kind').toLowerCase();
  const plaintextSize = Number(normalizeHeader(request, 'x-chat-image-plaintext-size'));

  if (!BLOB_ID_REGEX.test(blobId)) {
    return buildErrorResponse('Invalid image blob id.');
  }
  if (!WALLET_ADDRESS_REGEX.test(ownerAddress)) {
    return buildErrorResponse('Invalid image owner wallet.');
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
    return buildErrorResponse('Unsupported image format.');
  }
  if (!CONVERSATION_KINDS.has(kind)) {
    return buildErrorResponse('Invalid image conversation kind.');
  }
  if (!Number.isSafeInteger(plaintextSize) || plaintextSize <= 0 || plaintextSize > MAX_IMAGE_PLAINTEXT_BYTES) {
    return buildErrorResponse('Invalid image size.');
  }

  const encrypted = await request.arrayBuffer();
  if (encrypted.byteLength <= 0 || encrypted.byteLength > MAX_IMAGE_ENCRYPTED_BYTES) {
    return buildErrorResponse('Encrypted image blob exceeds the supported size limit.', 413);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { error: insertError } = await supabaseAdmin.from(CHAT_IMAGE_UPLOADS_TABLE).insert({
    blob_id: blobId,
    owner_address: ownerAddress,
    conversation_kind: kind,
    mime,
    plaintext_size: plaintextSize,
    encrypted_size: encrypted.byteLength
  });

  if (insertError) {
    return buildErrorResponse(insertError.message || 'Failed to create pending image upload.', 409);
  }

  const { error: uploadError } = await supabaseAdmin.storage.from(CHAT_IMAGES_BUCKET).upload(
    blobId,
    new Blob([encrypted], { type: 'application/octet-stream' }),
    {
      cacheControl: '86400',
      contentType: 'application/octet-stream',
      upsert: false,
      metadata: {
        conversationKind: kind,
        mime,
        ownerAddress,
        plaintextSize: String(plaintextSize),
        status: 'pending'
      }
    }
  );

  if (uploadError) {
    await supabaseAdmin.from(CHAT_IMAGE_UPLOADS_TABLE).delete().eq('blob_id', blobId);
    return buildErrorResponse(uploadError.message || 'Failed to upload encrypted image.', 500);
  }

  return jsonResponse({ blobId, status: 'pending' }, { headers: corsHeaders });
});
