import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'supabase';
import { recoverMessageAddress, type Hex } from 'viem';
import { corsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import {
  assertChatImageAuthorizationFresh,
  assertChatImageAuthorizationSignature,
  buildChatImageUploadAuthorizationMessage,
  constantTimeEqualHex,
  getChatImageAuthorizationDomain,
  normalizeChatImageUploadAuthorization,
  sha256Hex
} from '../_shared/chat-image-authorization.ts';
import {
  ChatImageRequestError,
  getChatImageClientHash,
  parseChatImageInteger,
  readRequestBodyWithLimit
} from '../_shared/chat-image-request-security.ts';
import { verifyChatImageSessionToken } from '../_shared/chat-image-session.ts';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  BLOB_ID_REGEX,
  CHAT_IMAGES_BUCKET,
  CHAT_IMAGE_UPLOADS_TABLE,
  MAX_IMAGE_ENCRYPTED_BYTES,
  MAX_IMAGE_PLAINTEXT_BYTES,
  COTI_CHAIN_ID_HEX,
  WALLET_ADDRESS_REGEX,
  jsonResponse,
  normalizeMimeType
} from '../_shared/chat-image.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CHAT_IMAGE_RATE_LIMIT_SECRET = Deno.env.get('CHAT_IMAGE_RATE_LIMIT_SECRET') ?? '';
const CHAT_IMAGE_SESSION_SECRET = Deno.env.get('CHAT_IMAGE_SESSION_SECRET') ?? '';
const CHAT_IMAGE_CHAIN_ID_HEX = (
  Deno.env.get('CHAT_IMAGE_CHAIN_ID_HEX') ?? COTI_CHAIN_ID_HEX
).trim().toLowerCase();
const CONVERSATION_KINDS = new Set(['direct', 'group']);
const CHAT_IMAGE_PROTOCOLS = new Set(['legacy-v1', 'direct-v2', 'group-v2']);

type WorkAdmissionRow = {
  allowed?: boolean;
  reason?: string;
  retry_after_seconds?: number;
};

type WorkAdmissionClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

const buildErrorResponse = (
  message: string,
  status = 400,
  extraHeaders?: HeadersInit
): Response =>
  jsonResponse({ error: message }, { status, headers: { ...corsHeaders, ...(extraHeaders ?? {}) } });

const normalizeHeader = (request: Request, name: string): string => request.headers.get(name)?.trim() ?? '';

const claimUploadWork = async (
  supabaseAdmin: WorkAdmissionClient,
  clientHash: string,
  ownerAddress: string,
  encryptedSize: number
): Promise<WorkAdmissionRow> => {
  const { data, error } = await supabaseAdmin.rpc('claim_chat_image_work', {
    p_kind: 'upload',
    p_client_hash: clientHash,
    p_wallet_address: ownerAddress,
    p_cost_units: 1,
    p_bytes: encryptedSize
  });
  if (error) {
    throw new ChatImageRequestError('Chat image work admission is unavailable.', 503);
  }
  const row = (Array.isArray(data) ? data[0] : data) as WorkAdmissionRow | null;
  if (!row || typeof row.allowed !== 'boolean') {
    throw new ChatImageRequestError('Chat image work admission is unavailable.', 503);
  }
  return row;
};

export const handleChatImageUploadHttpRequest = async (request: Request): Promise<Response> => {
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

  try {
    const blobId = normalizeHeader(request, 'x-chat-image-blob-id').toLowerCase();
    const ownerAddress = normalizeHeader(request, 'x-chat-image-owner').toLowerCase();
    const mime = normalizeMimeType(normalizeHeader(request, 'x-chat-image-mime'));
    const kind = normalizeHeader(request, 'x-chat-image-kind').toLowerCase();
    const protocol = (normalizeHeader(request, 'x-chat-image-protocol').toLowerCase() || 'legacy-v1');
    const conversationTarget = normalizeHeader(request, 'x-chat-image-target');
    const plaintextSize = parseChatImageInteger(
      normalizeHeader(request, 'x-chat-image-plaintext-size'),
      'image size'
    );
    const encryptedSize = parseChatImageInteger(
      normalizeHeader(request, 'x-chat-image-encrypted-size'),
      'encrypted image size'
    );
    const ciphertextSha256 = normalizeHeader(request, 'x-chat-image-ciphertext-sha256').toLowerCase();
    const confirmationTokenHash = normalizeHeader(request, 'x-chat-image-confirmation-token-hash').toLowerCase();
    const sessionToken = normalizeHeader(request, 'x-chat-image-session-token');

    if (!BLOB_ID_REGEX.test(blobId)) {
      throw new ChatImageRequestError('Invalid image blob id.');
    }
    if (!WALLET_ADDRESS_REGEX.test(ownerAddress)) {
      throw new ChatImageRequestError('Invalid image owner wallet.');
    }
    if (!ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
      throw new ChatImageRequestError('Unsupported image format.');
    }
    if (!CONVERSATION_KINDS.has(kind)) {
      throw new ChatImageRequestError('Invalid image conversation kind.');
    }
    if (
      !CHAT_IMAGE_PROTOCOLS.has(protocol) ||
      (protocol === 'direct-v2' && kind !== 'direct') ||
      (protocol === 'group-v2' && kind !== 'group')
    ) {
      throw new ChatImageRequestError('Invalid image chat protocol.');
    }
    if (plaintextSize <= 0 || plaintextSize > MAX_IMAGE_PLAINTEXT_BYTES) {
      throw new ChatImageRequestError('Invalid image size.');
    }
    if (encryptedSize <= 0 || encryptedSize > MAX_IMAGE_ENCRYPTED_BYTES) {
      throw new ChatImageRequestError('Encrypted image blob exceeds the supported size limit.', 413);
    }

    const domain = getChatImageAuthorizationDomain(kind as 'direct' | 'group');
    let issuedAt: number;
    let expiresAt: number;
    let authorizationVersion: 1 | 2;
    const authorizationChainId = protocol !== 'legacy-v1'
      ? CHAT_IMAGE_CHAIN_ID_HEX
      : domain.chainId;
    if (sessionToken) {
      if (
        !/^[a-fA-F0-9]{64}$/u.test(CHAT_IMAGE_SESSION_SECRET) ||
        !/^0x[1-9a-f][0-9a-f]*$/u.test(authorizationChainId)
      ) {
        throw new ChatImageRequestError('Chat image sessions are unavailable.', 503);
      }
      const session = await verifyChatImageSessionToken({
        expectedChainId: authorizationChainId,
        expectedOwnerAddress: ownerAddress,
        secretHex: CHAT_IMAGE_SESSION_SECRET,
        supabaseUrl: SUPABASE_URL,
        token: sessionToken
      });
      issuedAt = session.issuedAt;
      expiresAt = session.expiresAt;
      authorizationVersion = 2;
    } else {
      issuedAt = parseChatImageInteger(
        normalizeHeader(request, 'x-chat-image-issued-at'),
        'image authorization issue time'
      );
      expiresAt = parseChatImageInteger(
        normalizeHeader(request, 'x-chat-image-expires-at'),
        'image authorization expiry'
      );
      authorizationVersion = 1;
    }
    const authorization = normalizeChatImageUploadAuthorization({
      audience: SUPABASE_URL,
      blobId,
      chainId: authorizationChainId,
      ciphertextSha256,
      confirmationTokenHash,
      contractAddress: domain.contractAddress,
      conversationKind: kind as 'direct' | 'group',
      conversationTarget,
      encryptedSize,
      expiresAt,
      issuedAt,
      mime,
      ownerAddress,
      plaintextSize
    });
    if (!sessionToken) {
      assertChatImageAuthorizationFresh(authorization.issuedAt, authorization.expiresAt);
      const authorizationSignature = assertChatImageAuthorizationSignature(
        normalizeHeader(request, 'x-chat-image-authorization-signature')
      );
      const authorizationMessage = buildChatImageUploadAuthorizationMessage(authorization);
      const recoveredAddress = await recoverMessageAddress({
        message: authorizationMessage,
        signature: authorizationSignature as Hex
      });
      if (recoveredAddress.toLowerCase() !== authorization.ownerAddress) {
        throw new ChatImageRequestError('Image upload authorization was signed by a different wallet.', 403);
      }
    }

    const clientHash = await getChatImageClientHash(request, CHAT_IMAGE_RATE_LIMIT_SECRET);
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const admission = await claimUploadWork(
      supabaseAdmin as unknown as WorkAdmissionClient,
      clientHash,
      authorization.ownerAddress,
      authorization.encryptedSize
    );
    if (!admission.allowed) {
      const retryAfter = Math.max(1, Math.floor(Number(admission.retry_after_seconds) || 60));
      return buildErrorResponse(
        admission.reason || 'Chat image upload limit reached.',
        429,
        { 'retry-after': String(retryAfter) }
      );
    }

    const encrypted = await readRequestBodyWithLimit(
      request,
      MAX_IMAGE_ENCRYPTED_BYTES,
      authorization.encryptedSize
    );
    const actualCiphertextSha256 = await sha256Hex(encrypted);
    if (!constantTimeEqualHex(actualCiphertextSha256, authorization.ciphertextSha256)) {
      throw new ChatImageRequestError('Encrypted image digest does not match its authorization.');
    }

    const { error: insertError } = await supabaseAdmin.from(CHAT_IMAGE_UPLOADS_TABLE).insert({
      blob_id: authorization.blobId,
      owner_address: authorization.ownerAddress,
      conversation_kind: authorization.conversationKind,
      conversation_target: authorization.conversationTarget,
      mime: authorization.mime,
      plaintext_size: authorization.plaintextSize,
      encrypted_size: authorization.encryptedSize,
      authorization_version: authorizationVersion,
      protocol_version: protocol === 'legacy-v1' ? 1 : 2,
      authorization_issued_at: new Date(authorization.issuedAt * 1000).toISOString(),
      ciphertext_sha256: authorization.ciphertextSha256,
      confirmation_token_hash: authorization.confirmationTokenHash,
      authorization_expires_at: new Date(authorization.expiresAt * 1000).toISOString()
    });

    if (insertError) {
      return buildErrorResponse('Failed to create pending image upload.', 409);
    }

    const encryptedBody = encrypted.buffer.slice(
      encrypted.byteOffset,
      encrypted.byteOffset + encrypted.byteLength
    ) as ArrayBuffer;
    const { error: uploadError } = await supabaseAdmin.storage.from(CHAT_IMAGES_BUCKET).upload(
      authorization.blobId,
      new Blob([encryptedBody], { type: 'application/octet-stream' }),
      {
        cacheControl: '86400',
        contentType: 'application/octet-stream',
        upsert: false,
        metadata: {
          status: 'pending'
        }
      }
    );

    if (uploadError) {
      await supabaseAdmin.from(CHAT_IMAGE_UPLOADS_TABLE).delete().eq('blob_id', authorization.blobId);
      return buildErrorResponse('Failed to upload encrypted image.', 500);
    }

    return jsonResponse({ blobId: authorization.blobId, status: 'pending' }, { headers: corsHeaders });
  } catch (error) {
    if (error instanceof ChatImageRequestError) {
      return buildErrorResponse(error.message, error.status);
    }
    return buildErrorResponse('Invalid chat image upload authorization.', 400);
  }
};

if (import.meta.main) {
  Deno.serve((request) => handleChatImageUploadHttpRequest(request));
}
