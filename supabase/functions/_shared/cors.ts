export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-chat-image-blob-id, x-chat-image-mime, x-chat-image-plaintext-size, x-chat-image-kind',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
} as const;

export const handleCorsPreflight = (request: Request): Response | null => {
  if (request.method !== 'OPTIONS') {
    return null;
  }

  return new Response('ok', { headers: corsHeaders });
};
