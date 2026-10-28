import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'supabase';
import { recoverMessageAddress, type Hex } from 'viem';
import { corsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { assertChatImageAuthorizationSignature } from '../_shared/chat-image-authorization.ts';
import {
  assertChatImageSessionFresh,
  buildChatImageSessionAuthorizationMessage,
  issueChatImageSessionToken,
  normalizeChatImageSessionAuthorization
} from '../_shared/chat-image-session.ts';
import {
  ChatImageRequestError,
  getChatImageClientHash,
  readRequestBodyWithLimit
} from '../_shared/chat-image-request-security.ts';
import { COTI_CHAIN_ID_HEX, jsonResponse } from '../_shared/chat-image.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CHAT_IMAGE_RATE_LIMIT_SECRET = Deno.env.get('CHAT_IMAGE_RATE_LIMIT_SECRET') ?? '';
const CHAT_IMAGE_SESSION_SECRET = Deno.env.get('CHAT_IMAGE_SESSION_SECRET') ?? '';
const CHAT_IMAGE_CHAIN_ID_HEX = (
  Deno.env.get('CHAT_IMAGE_CHAIN_ID_HEX') ?? COTI_CHAIN_ID_HEX
).trim().toLowerCase();
const MAX_SESSION_BODY_BYTES = 4_096;

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
): Response => jsonResponse(
  { error: message },
  { status, headers: { ...corsHeaders, ...(extraHeaders ?? {}) } }
);

const readJson = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const body = await readRequestBodyWithLimit(request, MAX_SESSION_BODY_BYTES);
    const parsed = JSON.parse(new TextDecoder().decode(body));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch (error) {
    if (error instanceof ChatImageRequestError) throw error;
    return {};
  }
};

const claimSessionWork = async (
  supabaseAdmin: WorkAdmissionClient,
  clientHash: string
): Promise<WorkAdmissionRow> => {
  const { data, error } = await supabaseAdmin.rpc('claim_chat_image_work', {
    p_kind: 'confirm',
    p_client_hash: clientHash,
    p_wallet_address: null,
    p_cost_units: 1,
    p_bytes: 0
  });
  if (error) throw new ChatImageRequestError('Chat image session admission is unavailable.', 503);
  const row = (Array.isArray(data) ? data[0] : data) as WorkAdmissionRow | null;
  if (!row || typeof row.allowed !== 'boolean') {
    throw new ChatImageRequestError('Chat image session admission is unavailable.', 503);
  }
  return row;
};

export const handleChatImageSessionHttpRequest = async (request: Request): Promise<Response> => {
  const corsResponse = handleCorsPreflight(request);
  if (corsResponse) return corsResponse;
  if (request.method !== 'POST') return buildErrorResponse('Method not allowed.', 405);
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !CHAT_IMAGE_RATE_LIMIT_SECRET ||
    !/^0x[1-9a-f][0-9a-f]*$/u.test(CHAT_IMAGE_CHAIN_ID_HEX) ||
    !/^[a-fA-F0-9]{64}$/u.test(CHAT_IMAGE_SESSION_SECRET)
  ) {
    return buildErrorResponse('Chat image session secrets are unavailable.', 500);
  }

  try {
    const clientHash = await getChatImageClientHash(request, CHAT_IMAGE_RATE_LIMIT_SECRET);
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const admission = await claimSessionWork(
      supabaseAdmin as unknown as WorkAdmissionClient,
      clientHash
    );
    if (!admission.allowed) {
      const retryAfter = Math.max(1, Math.floor(Number(admission.retry_after_seconds) || 60));
      return buildErrorResponse(
        admission.reason || 'Chat image session limit reached.',
        429,
        { 'retry-after': String(retryAfter) }
      );
    }

    const body = await readJson(request);
    const authorization = normalizeChatImageSessionAuthorization({
      audience: SUPABASE_URL,
      chainId: typeof body.chainId === 'string' ? body.chainId : '',
      expiresAt: Number(body.expiresAt),
      issuedAt: Number(body.issuedAt),
      nonce: typeof body.nonce === 'string' ? body.nonce : '',
      ownerAddress: typeof body.ownerAddress === 'string' ? body.ownerAddress : ''
    });
    if (authorization.chainId !== CHAT_IMAGE_CHAIN_ID_HEX) {
      throw new ChatImageRequestError('Chat image session chain does not match this deployment.');
    }
    assertChatImageSessionFresh(authorization.issuedAt, authorization.expiresAt);
    const signature = assertChatImageAuthorizationSignature(
      typeof body.signature === 'string' ? body.signature : ''
    );
    const recoveredAddress = await recoverMessageAddress({
      message: buildChatImageSessionAuthorizationMessage(authorization),
      signature: signature as Hex
    });
    if (recoveredAddress.toLowerCase() !== authorization.ownerAddress) {
      throw new ChatImageRequestError('Chat image session was signed by a different wallet.', 403);
    }
    const token = await issueChatImageSessionToken({
      authorization,
      secretHex: CHAT_IMAGE_SESSION_SECRET,
      supabaseUrl: SUPABASE_URL
    });
    return jsonResponse(
      { token, expiresAt: authorization.expiresAt },
      { headers: corsHeaders }
    );
  } catch (error) {
    if (error instanceof ChatImageRequestError) {
      return buildErrorResponse(error.message, error.status);
    }
    return buildErrorResponse('Invalid chat image session authorization.', 400);
  }
};

if (import.meta.main) {
  Deno.serve((request) => handleChatImageSessionHttpRequest(request));
}
