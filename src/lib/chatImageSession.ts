import {
  buildChatImageSessionAuthorizationMessage,
  CHAT_IMAGE_SESSION_TTL_SECONDS,
  normalizeChatImageSessionAuthorization
} from '../../supabase/functions/_shared/chat-image-session';

type ChatImageSessionEntry = Readonly<{
  expiresAt: number;
  token: string;
}>;

export type ChatImageSessionRequest = Readonly<{
  assertCurrent: () => void | Promise<void>;
  chainId: bigint;
  ownerAddress: string;
  signAuthorization: (message: string) => Promise<string>;
}>;

const SESSION_EXPIRY_SAFETY_SECONDS = 60;
const sessionCache = new Map<string, ChatImageSessionEntry>();
const sessionRequests = new Map<string, Promise<ChatImageSessionEntry>>();

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const canonicalScope = (
  supabaseUrl: string,
  ownerAddress: string,
  chainId: bigint
): string => {
  const owner = ownerAddress.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/u.test(owner) || chainId <= 0n) {
    throw new Error('Chat image session requires the current owner wallet and chain.');
  }
  return `${new URL(supabaseUrl).origin.toLowerCase()}:${chainId.toString()}:${owner}`;
};

const requestChatImageSession = async ({
  assertCurrent,
  chainId,
  ownerAddress,
  signAuthorization
}: ChatImageSessionRequest): Promise<ChatImageSessionEntry> => {
  const [{ getSupabaseBrowserClient, getSupabaseUrl }] = await Promise.all([
    import('./supabaseClient')
  ]);
  await assertCurrent();
  const issuedAt = Math.floor(Date.now() / 1000);
  const authorization = normalizeChatImageSessionAuthorization({
    audience: getSupabaseUrl(),
    chainId: `0x${chainId.toString(16)}`,
    expiresAt: issuedAt + CHAT_IMAGE_SESSION_TTL_SECONDS,
    issuedAt,
    nonce: bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32))),
    ownerAddress
  });
  const signature = await signAuthorization(
    buildChatImageSessionAuthorizationMessage(authorization)
  );
  await assertCurrent();
  const { data, error } = await getSupabaseBrowserClient().functions.invoke('chat-image-session', {
    body: { ...authorization, signature }
  });
  await assertCurrent();
  if (error || !data || typeof data !== 'object') {
    throw new Error('Unable to authorize encrypted image uploads for this wallet session.');
  }
  const token = typeof (data as { token?: unknown }).token === 'string'
    ? (data as { token: string }).token.trim()
    : '';
  const expiresAt = Number((data as { expiresAt?: unknown }).expiresAt);
  if (
    !token ||
    token.length > 4_096 ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt !== authorization.expiresAt
  ) {
    throw new Error('Chat image upload session response is invalid.');
  }
  return Object.freeze({ expiresAt, token });
};

export const getChatImageSessionToken = async (
  request: ChatImageSessionRequest
): Promise<string> => {
  const { getSupabaseUrl } = await import('./supabaseClient');
  const scope = canonicalScope(getSupabaseUrl(), request.ownerAddress, request.chainId);
  const now = Math.floor(Date.now() / 1000);
  const cached = sessionCache.get(scope);
  if (cached && cached.expiresAt > now + SESSION_EXPIRY_SAFETY_SECONDS) {
    await request.assertCurrent();
    return cached.token;
  }
  sessionCache.delete(scope);
  let pending = sessionRequests.get(scope);
  if (!pending) {
    pending = requestChatImageSession(request);
    sessionRequests.set(scope, pending);
  }
  try {
    const entry = await pending;
    await request.assertCurrent();
    sessionCache.set(scope, entry);
    return entry.token;
  } finally {
    if (sessionRequests.get(scope) === pending) sessionRequests.delete(scope);
  }
};

export const clearChatImageSessionTokens = (): void => {
  sessionCache.clear();
  sessionRequests.clear();
};
