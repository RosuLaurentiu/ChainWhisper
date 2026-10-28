import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'supabase';
import { corsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import {
  assertChatImageConversationTargetFromCalldata,
  constantTimeEqualHex,
  sha256Hex
} from '../_shared/chat-image-authorization.ts';
import {
  ChatImageRequestError,
  getChatImageClientHash,
  readRequestBodyWithLimit
} from '../_shared/chat-image-request-security.ts';
import {
  BLOB_ID_REGEX,
  CHAT_CONTRACT_ADDRESS,
  CHAT_IMAGE_UPLOADS_TABLE,
  COTI_CHAIN_ID_HEX,
  DIRECT_CHAT_SUBMIT_SELECTORS,
  GROUP_CHAT_CONTRACT_ADDRESS,
  GROUP_CHAT_SUBMIT_SELECTORS,
  PENDING_IMAGE_RETENTION_MINUTES,
  TX_HASH_REGEX,
  jsonResponse
} from '../_shared/chat-image.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const COTI_RPC_URL = Deno.env.get('COTI_RPC_URL') ?? '';
const CHAT_IMAGE_RATE_LIMIT_SECRET = Deno.env.get('CHAT_IMAGE_RATE_LIMIT_SECRET') ?? '';
const CHAT_IMAGE_CHAIN_ID_HEX = (
  Deno.env.get('CHAT_IMAGE_CHAIN_ID_HEX') ?? COTI_CHAIN_ID_HEX
).trim().toLowerCase();
const DIRECT_CHAT_V2_ADDRESS = (Deno.env.get('DIRECT_CHAT_V2_ADDRESS') ?? '').trim().toLowerCase();
const GROUP_CHAT_V2_ADDRESS = (Deno.env.get('GROUP_CHAT_V2_ADDRESS') ?? '').trim().toLowerCase();
const BLOCK_TIME_SKEW_MS = 2 * 60 * 1000;
const MAX_CONFIRM_BODY_BYTES = 4096;
const RPC_TIMEOUT_MS = 10_000;
const RPC_MAX_RESPONSE_BYTES = 128 * 1024;
const RPC_MAX_IN_FLIGHT = 16;
const RPC_CACHE_MAX_ENTRIES = 256;

type RpcReceipt = {
  blockNumber?: string;
  logs?: Array<{
    address?: string;
    data?: string;
    topics?: string[];
  }>;
  status?: string;
};

type RpcTransaction = {
  from?: string;
  input?: string;
  to?: string;
};

type RpcBlock = {
  timestamp?: string;
};

type ImageUploadRow = {
  authorization_version: number;
  confirmation_token_hash: string | null;
  confirmed_at: string | null;
  confirmed_tx_hash: string | null;
  conversation_kind: 'direct' | 'group';
  conversation_target: string | null;
  created_at: string;
  owner_address: string;
  protocol_version: number;
};

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

type RpcCacheEntry = { expiresAt: number; value: unknown };

const rpcCache = new Map<string, RpcCacheEntry>();
const rpcInFlight = new Map<string, Promise<unknown>>();
let activeRpcCalls = 0;

const buildErrorResponse = (
  message: string,
  status = 400,
  extraHeaders?: HeadersInit
): Response =>
  jsonResponse({ error: message }, { status, headers: { ...corsHeaders, ...(extraHeaders ?? {}) } });

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const normalizeAddress = (value: string): string => value.trim().toLowerCase();
const DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC =
  '0xc1b1cd53414aa748881be289567f95e4860fba25bed82b5ae31129f90b5f9e6a';
const DIRECT_CHAT_V2_SEND_MESSAGE_SELECTOR = '0x9c37c00d';
const GROUP_CHAT_V2_MESSAGE_POSTED_TOPIC =
  '0xc179bb86b638762e8d9d1c349babf4f3ee84c2ef57188c590f4ad6ec281a09c8';
const GROUP_CHAT_V2_SEND_MESSAGE_SELECTOR = '0x67b2dfaa';

const indexedAddress = (topic: string | undefined): string => {
  const normalized = (topic ?? '').trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/u.test(normalized) ? `0x${normalized.slice(-40)}` : '';
};

const readJson = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const body = await readRequestBodyWithLimit(request, MAX_CONFIRM_BODY_BYTES);
    const parsed = JSON.parse(new TextDecoder().decode(body));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch (error) {
    if (error instanceof ChatImageRequestError) throw error;
    return {};
  }
};

const rpcCall = async <T>(method: string, params: unknown[]): Promise<T | null> => {
  if (!COTI_RPC_URL) {
    throw new ChatImageRequestError('Image confirmation RPC is unavailable.', 503);
  }
  const key = `${method}:${JSON.stringify(params)}`;
  const now = Date.now();
  const cached = rpcCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T | null;
  }
  if (cached) rpcCache.delete(key);
  const existing = rpcInFlight.get(key);
  if (existing) return existing as Promise<T | null>;
  if (activeRpcCalls >= RPC_MAX_IN_FLIGHT) {
    throw new ChatImageRequestError('Image confirmation RPC is busy.', 503);
  }

  const operation = (async (): Promise<T | null> => {
    activeRpcCalls += 1;
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), RPC_TIMEOUT_MS);
    try {
      const response = await fetch(COTI_RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: abortController.signal
      });
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > RPC_MAX_RESPONSE_BYTES) {
        throw new ChatImageRequestError('Image confirmation RPC response is too large.', 503);
      }
      const responseBytes = new Uint8Array(await response.arrayBuffer());
      if (responseBytes.byteLength > RPC_MAX_RESPONSE_BYTES) {
        throw new ChatImageRequestError('Image confirmation RPC response is too large.', 503);
      }
      let body: { error?: unknown; result?: T } | null = null;
      try {
        body = JSON.parse(new TextDecoder().decode(responseBytes)) as { error?: unknown; result?: T };
      } catch {
        throw new ChatImageRequestError('Image confirmation RPC returned invalid data.', 503);
      }
      if (!response.ok || body?.error) {
        throw new ChatImageRequestError('Image confirmation RPC request failed.', 503);
      }
      const result = body?.result ?? null;
      if (rpcCache.size >= RPC_CACHE_MAX_ENTRIES) {
        const oldest = rpcCache.keys().next().value;
        if (typeof oldest === 'string') rpcCache.delete(oldest);
      }
      const ttlMs = result === null ? 10_000 : method === 'eth_chainId' ? 5 * 60_000 : 60_000;
      rpcCache.set(key, { expiresAt: Date.now() + ttlMs, value: result });
      return result;
    } catch (error) {
      if (error instanceof ChatImageRequestError) throw error;
      throw new ChatImageRequestError('Image confirmation RPC request failed.', 503);
    } finally {
      clearTimeout(timeout);
      activeRpcCalls -= 1;
    }
  })();

  rpcInFlight.set(key, operation);
  try {
    return await operation;
  } finally {
    rpcInFlight.delete(key);
  }
};

const verifyChatMessageTransaction = async (
  txHash: string,
  ownerAddress: string,
  createdAt: string,
  conversationKind: 'direct' | 'group',
  conversationTarget: string,
  protocolVersion: number
): Promise<void> => {
  if (!/^0x[1-9a-f][0-9a-f]*$/u.test(CHAT_IMAGE_CHAIN_ID_HEX)) {
    throw new ChatImageRequestError('Image confirmation chain is unavailable.', 503);
  }
  const chainId = await rpcCall<string>('eth_chainId', []);
  if ((chainId ?? '').toLowerCase() !== CHAT_IMAGE_CHAIN_ID_HEX) {
    throw new Error('Image confirmation RPC is connected to a different chain.');
  }

  const [receipt, tx] = await Promise.all([
    rpcCall<RpcReceipt>('eth_getTransactionReceipt', [txHash]),
    rpcCall<RpcTransaction>('eth_getTransactionByHash', [txHash])
  ]);
  if (!receipt || receipt.status?.toLowerCase() !== '0x1' || !receipt.blockNumber || !tx) {
    throw new Error('Image message transaction is not confirmed.');
  }
  if (normalizeAddress(tx.from ?? '') !== normalizeAddress(ownerAddress)) {
    throw new Error('Image message transaction was sent by a different wallet.');
  }

  const selector = (tx.input ?? '').slice(0, 10).toLowerCase();
  const toAddress = normalizeAddress(tx.to ?? '');
  if (protocolVersion === 2) {
    const matchingEvents = conversationKind === 'direct'
      ? (() => {
          if (
            !/^0x[a-f0-9]{40}$/u.test(DIRECT_CHAT_V2_ADDRESS) ||
            toAddress !== DIRECT_CHAT_V2_ADDRESS ||
            selector !== DIRECT_CHAT_V2_SEND_MESSAGE_SELECTOR
          ) {
            throw new Error('Image confirmation transaction is not a Direct Chat V2 message.');
          }
          return (receipt.logs ?? []).filter((log) => {
            const topics = Array.isArray(log.topics) ? log.topics : [];
            return normalizeAddress(log.address ?? '') === DIRECT_CHAT_V2_ADDRESS &&
              topics.length === 4 &&
              (topics[0] ?? '').toLowerCase() === DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC &&
              indexedAddress(topics[2]) === normalizeAddress(ownerAddress) &&
              indexedAddress(topics[3]) === normalizeAddress(conversationTarget) &&
              /^0x(?:[a-f0-9]{2})+$/u.test((log.data ?? '').toLowerCase());
          });
        })()
      : (() => {
          if (
            !/^0x[a-f0-9]{40}$/u.test(GROUP_CHAT_V2_ADDRESS) ||
            toAddress !== GROUP_CHAT_V2_ADDRESS ||
            selector !== GROUP_CHAT_V2_SEND_MESSAGE_SELECTOR
          ) {
            throw new Error('Image confirmation transaction is not a Group Chat V2 message.');
          }
          return (receipt.logs ?? []).filter((log) => {
            const topics = Array.isArray(log.topics) ? log.topics : [];
            let eventGroupId = '';
            try {
              eventGroupId = BigInt(topics[1] ?? '').toString(10);
            } catch {
              return false;
            }
            return normalizeAddress(log.address ?? '') === GROUP_CHAT_V2_ADDRESS &&
              topics.length === 4 &&
              (topics[0] ?? '').toLowerCase() === GROUP_CHAT_V2_MESSAGE_POSTED_TOPIC &&
              eventGroupId === conversationTarget &&
              indexedAddress(topics[3]) === normalizeAddress(ownerAddress) &&
              /^0x(?:[a-f0-9]{2})+$/u.test((log.data ?? '').toLowerCase());
          });
        })();
    if (matchingEvents.length !== 1) {
      throw new Error(`${conversationKind === 'direct' ? 'Direct' : 'Group'} Chat V2 image message event does not match its scope.`);
    }
  } else if (protocolVersion !== 1) {
    throw new Error('Image confirmation protocol is unsupported.');
  }
  const isDirectMessageTx =
    toAddress === normalizeAddress(CHAT_CONTRACT_ADDRESS) && DIRECT_CHAT_SUBMIT_SELECTORS.has(selector);
  const isGroupMessageTx =
    toAddress === normalizeAddress(GROUP_CHAT_CONTRACT_ADDRESS) && GROUP_CHAT_SUBMIT_SELECTORS.has(selector);
  if (protocolVersion === 1) {
    if (
      (conversationKind === 'direct' && !isDirectMessageTx) ||
      (conversationKind === 'group' && !isGroupMessageTx)
    ) {
      throw new Error('Image confirmation transaction is not a ChainWhisper message.');
    }
    assertChatImageConversationTargetFromCalldata(
      tx.input ?? '',
      conversationKind,
      conversationTarget
    );
  }

  const block = await rpcCall<RpcBlock>('eth_getBlockByNumber', [receipt.blockNumber, false]);
  const blockTimestampSeconds = Number.parseInt(block?.timestamp ?? '', 16);
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(blockTimestampSeconds) || !Number.isFinite(createdAtMs)) {
    throw new Error('Unable to verify image message time.');
  }
  if (blockTimestampSeconds * 1000 + BLOCK_TIME_SKEW_MS < createdAtMs) {
    throw new Error('Image message transaction predates the upload.');
  }
};

const claimConfirmationWork = async (
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
  if (error) {
    throw new ChatImageRequestError('Chat image work admission is unavailable.', 503);
  }
  const row = (Array.isArray(data) ? data[0] : data) as WorkAdmissionRow | null;
  if (!row || typeof row.allowed !== 'boolean') {
    throw new ChatImageRequestError('Chat image work admission is unavailable.', 503);
  }
  return row;
};

const decodeHexToken = (token: string): Uint8Array => {
  const normalized = token.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new ChatImageRequestError('Invalid image confirmation token.');
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

export const handleChatImageConfirmHttpRequest = async (request: Request): Promise<Response> => {
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
    const clientHash = await getChatImageClientHash(request, CHAT_IMAGE_RATE_LIMIT_SECRET);
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const admission = await claimConfirmationWork(
      supabaseAdmin as unknown as WorkAdmissionClient,
      clientHash
    );
    if (!admission.allowed) {
      const retryAfter = Math.max(1, Math.floor(Number(admission.retry_after_seconds) || 60));
      return buildErrorResponse(
        admission.reason || 'Chat image confirmation limit reached.',
        429,
        { 'retry-after': String(retryAfter) }
      );
    }

    const body = await readJson(request);
    const blobId = normalizeString(body.blobId).toLowerCase();
    const txHash = normalizeString(body.txHash).toLowerCase();
    const confirmationToken = normalizeString(body.confirmationToken).toLowerCase();
    if (!BLOB_ID_REGEX.test(blobId)) {
      throw new ChatImageRequestError('Invalid image blob id.');
    }
    if (!TX_HASH_REGEX.test(txHash)) {
      throw new ChatImageRequestError('Invalid image transaction hash.');
    }
    const confirmationTokenHash = await sha256Hex(decodeHexToken(confirmationToken));

    const { data: uploadRow, error: loadError } = await supabaseAdmin
      .from(CHAT_IMAGE_UPLOADS_TABLE)
      .select(
        'authorization_version, confirmation_token_hash, confirmed_at, confirmed_tx_hash, conversation_kind, conversation_target, created_at, owner_address, protocol_version'
      )
      .eq('blob_id', blobId)
      .single();

    const upload = uploadRow as ImageUploadRow | null;
    if (loadError || !upload) {
      return buildErrorResponse('Pending image upload was not found.', 404);
    }
    if (
      ![1, 2].includes(upload.authorization_version) ||
      !upload.confirmation_token_hash ||
      !upload.conversation_target
    ) {
      return buildErrorResponse('Legacy unsigned image uploads cannot be confirmed.', 410);
    }
    if (!constantTimeEqualHex(confirmationTokenHash, upload.confirmation_token_hash)) {
      return buildErrorResponse('Invalid image confirmation token.', 403);
    }

    if (upload.confirmed_at) {
      if ((upload.confirmed_tx_hash ?? '').toLowerCase() !== txHash) {
        return buildErrorResponse('Image upload was already confirmed by a different transaction.', 409);
      }
      return jsonResponse({ blobId, status: 'confirmed' }, { headers: corsHeaders });
    }

    const createdAtMs = Date.parse(upload.created_at);
    if (
      !Number.isFinite(createdAtMs) ||
      Date.now() - createdAtMs > PENDING_IMAGE_RETENTION_MINUTES * 60 * 1000
    ) {
      return buildErrorResponse('Pending image upload expired before confirmation.', 410);
    }

    try {
      await verifyChatMessageTransaction(
        txHash,
        upload.owner_address,
        upload.created_at,
        upload.conversation_kind,
        upload.conversation_target,
        upload.protocol_version
      );
    } catch (error) {
      if (error instanceof ChatImageRequestError) throw error;
      return buildErrorResponse(
        error instanceof Error ? error.message : 'Failed to verify image message transaction.',
        400
      );
    }

    const { data: updatedRow, error: updateError } = await supabaseAdmin
      .from(CHAT_IMAGE_UPLOADS_TABLE)
      .update({
        confirmed_at: new Date().toISOString(),
        confirmed_tx_hash: txHash
      })
      .eq('blob_id', blobId)
      .eq('authorization_version', upload.authorization_version)
      .eq('confirmation_token_hash', upload.confirmation_token_hash)
      .is('confirmed_at', null)
      .select('blob_id, confirmed_tx_hash')
      .maybeSingle();

    if (updateError || !updatedRow) {
      return buildErrorResponse('Failed to confirm image upload.', 409);
    }

    return jsonResponse({ blobId, status: 'confirmed' }, { headers: corsHeaders });
  } catch (error) {
    if (error instanceof ChatImageRequestError) {
      return buildErrorResponse(error.message, error.status);
    }
    return buildErrorResponse('Failed to confirm image upload.', 500);
  }
};

if (import.meta.main) {
  Deno.serve((request) => handleChatImageConfirmHttpRequest(request));
}
