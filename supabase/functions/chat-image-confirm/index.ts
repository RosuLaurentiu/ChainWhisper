import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'supabase';
import { corsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
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
const BLOCK_TIME_SKEW_MS = 2 * 60 * 1000;

type RpcReceipt = {
  blockNumber?: string;
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
  confirmed_at: string | null;
  created_at: string;
  owner_address: string;
};

const buildErrorResponse = (message: string, status = 400): Response =>
  jsonResponse({ error: message }, { status, headers: corsHeaders });

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const normalizeAddress = (value: string): string => value.trim().toLowerCase();

const readJson = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const rpcCall = async <T>(method: string, params: unknown[]): Promise<T | null> => {
  if (!COTI_RPC_URL) {
    throw new Error('COTI RPC is not configured.');
  }
  const response = await fetch(COTI_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const body = await response.json().catch(() => null) as { error?: { message?: string }; result?: T } | null;
  if (!response.ok || body?.error) {
    throw new Error(body?.error?.message || 'COTI RPC request failed.');
  }
  return body?.result ?? null;
};

const verifyChatMessageTransaction = async (txHash: string, ownerAddress: string, createdAt: string): Promise<void> => {
  const chainId = await rpcCall<string>('eth_chainId', []);
  if ((chainId ?? '').toLowerCase() !== COTI_CHAIN_ID_HEX) {
    throw new Error('Image confirmation RPC is not connected to COTI mainnet.');
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
  const isDirectMessageTx =
    toAddress === normalizeAddress(CHAT_CONTRACT_ADDRESS) && DIRECT_CHAT_SUBMIT_SELECTORS.has(selector);
  const isGroupMessageTx =
    toAddress === normalizeAddress(GROUP_CHAT_CONTRACT_ADDRESS) && GROUP_CHAT_SUBMIT_SELECTORS.has(selector);
  if (!isDirectMessageTx && !isGroupMessageTx) {
    throw new Error('Image confirmation transaction is not a ChainWhisper message.');
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

  const body = await readJson(request);
  const blobId = normalizeString(body.blobId).toLowerCase();
  const txHash = normalizeString(body.txHash).toLowerCase();
  if (!BLOB_ID_REGEX.test(blobId)) {
    return buildErrorResponse('Invalid image blob id.');
  }
  if (!TX_HASH_REGEX.test(txHash)) {
    return buildErrorResponse('Invalid image transaction hash.');
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: uploadRow, error: loadError } = await supabaseAdmin
    .from(CHAT_IMAGE_UPLOADS_TABLE)
    .select('confirmed_at, created_at, owner_address')
    .eq('blob_id', blobId)
    .single();

  const upload = uploadRow as ImageUploadRow | null;
  if (loadError || !upload) {
    return buildErrorResponse('Pending image upload was not found.', 404);
  }

  if (upload.confirmed_at) {
    return jsonResponse({ blobId, status: 'confirmed' }, { headers: corsHeaders });
  }

  const createdAtMs = Date.parse(upload.created_at);
  if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > PENDING_IMAGE_RETENTION_MINUTES * 60 * 1000) {
    return buildErrorResponse('Pending image upload expired before confirmation.', 410);
  }

  try {
    await verifyChatMessageTransaction(txHash, upload.owner_address, upload.created_at);
  } catch (error) {
    return buildErrorResponse(error instanceof Error ? error.message : 'Failed to verify image message transaction.', 400);
  }

  const { error: updateError } = await supabaseAdmin
    .from(CHAT_IMAGE_UPLOADS_TABLE)
    .update({
      confirmed_at: new Date().toISOString(),
      confirmed_tx_hash: txHash
    })
    .eq('blob_id', blobId)
    .is('confirmed_at', null);

  if (updateError) {
    return buildErrorResponse(updateError.message || 'Failed to confirm image upload.', 409);
  }

  return jsonResponse({ blobId, status: 'confirmed' }, { headers: corsHeaders });
});
