export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-chat-image-blob-id, x-chat-image-mime, x-chat-image-owner, x-chat-image-plaintext-size, x-chat-image-encrypted-size, x-chat-image-kind, x-chat-image-protocol, x-chat-image-target, x-chat-image-ciphertext-sha256, x-chat-image-confirmation-token-hash, x-chat-image-issued-at, x-chat-image-expires-at, x-chat-image-authorization-signature, x-chat-image-session-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
} as const;

export const handleCorsPreflight = (request: Request): Response | null => {
  if (request.method !== 'OPTIONS') {
    return null;
  }

  return new Response('ok', { headers: corsHeaders });
};
