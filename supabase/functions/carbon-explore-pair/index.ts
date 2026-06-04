import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeaders, handleCorsPreflight } from '../_shared/cors.ts';

const DEFAULT_CARBON_MCP_API_BASE_URL = 'https://mcp.carbondefi.xyz';

type CarbonExplorePairRequest = {
  base_token?: unknown;
  chain?: unknown;
  quote_token?: unknown;
  top_n?: unknown;
};

const jsonResponse = (payload: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      ...init.headers
    }
  });

const isValidToken = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const normalizeRequestBody = (body: CarbonExplorePairRequest): Record<string, unknown> | null => {
  if (!isValidToken(body.base_token) || !isValidToken(body.quote_token)) {
    return null;
  }

  return {
    base_token: body.base_token.trim(),
    chain: typeof body.chain === 'string' && body.chain.trim() ? body.chain.trim() : 'coti',
    quote_token: body.quote_token.trim(),
    top_n: typeof body.top_n === 'number' && Number.isFinite(body.top_n) ? body.top_n : 3
  };
};

Deno.serve(async (request) => {
  const corsResponse = handleCorsPreflight(request);
  if (corsResponse) {
    return corsResponse;
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, { status: 405 });
  }

  let carbonRequest: Record<string, unknown> | null = null;
  try {
    carbonRequest = normalizeRequestBody((await request.json()) as CarbonExplorePairRequest);
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!carbonRequest) {
    return jsonResponse({ error: 'base_token and quote_token are required.' }, { status: 400 });
  }

  const carbonBaseUrl = (Deno.env.get('CARBON_MCP_API_BASE_URL')?.trim() || DEFAULT_CARBON_MCP_API_BASE_URL).replace(
    /\/+$/u,
    ''
  );

  try {
    const carbonResponse = await fetch(`${carbonBaseUrl}/tools/explore_pair`, {
      body: JSON.stringify(carbonRequest),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json'
      },
      method: 'POST'
    });

    const responseBody = await carbonResponse.text();
    return new Response(responseBody || '{}', {
      headers: {
        ...corsHeaders,
        'Content-Type': carbonResponse.headers.get('content-type') ?? 'application/json'
      },
      status: carbonResponse.status
    });
  } catch {
    return jsonResponse({ error: 'Carbon price lookup failed.' }, { status: 502 });
  }
});
