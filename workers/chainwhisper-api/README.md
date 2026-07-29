# ChainWhisper Read API

One public, keyless Cloudflare Worker mounted in front of the existing GitHub Pages site:

`https://chainwhisper.chat/api/v1/*`

The Worker owns only ChainWhisper discovery and public read normalization. It has no wallet, database, account, signing, AES, private-amount, unlisted-order, direct-order, calldata, or generic COTI surface.

Its public, versioned, self-describing read surface follows the useful part of
[Carbon DeFi's public REST API](https://docs.carbondefi.xyz/rest-api/carbon-defi-public-rest-api)
model. Carbon is also the attributed reference-price source; ChainWhisper
independently verifies its own contracts and never delegates execution or
signing to that API.

## Routes

- `GET /api/v1`
- `GET /api/v1/openapi.json`
- `GET /api/v1/status`
- `GET /api/v1/capabilities`
- `GET /api/v1/orders?cursor=0&limit=10`
- `GET /api/v1/orders/{standard|private|recurring|verified-address}/{localId}`
- `GET /api/v1/market-reference?base=p.WISP&quote=p.COTI`
- `POST /api/v1/quote/swap`

Swap quotes are deliberately limited to one complete visible public ChainWhisper order. Private liquidity, unlisted orders, and direct orders stay local to an authorized signer. If the bounded pair scan or any required order read cannot prove complete coverage, the endpoint refuses the quote instead of claiming a best order. The deployed Worker limits this expensive route to 12 requests per minute per connecting address.

The machine-readable contract is generated from `src/openapi.ts` and served at `GET /api/v1/openapi.json`.

`runtimeVerified` covers the registry, public-order read contracts, all eight advertised Privacy Portal bridges, and every advertised private-token contract. The status response also lists what is deliberately outside that scope.

## Verify locally

From `APP`:

```text
node node_modules/typescript/bin/tsc -p workers/chainwhisper-api/tsconfig.json
node node_modules/vitest/vitest.mjs run workers/chainwhisper-api/test
npm run check:api:bundle
```

To run the Worker locally with the pinned CLI without adding it to the app:

```text
npm exec --yes wrangler@4.115.0 -- dev --config workers/chainwhisper-api/wrangler.jsonc
```

## Deploy

1. Put `chainwhisper.chat` on a Cloudflare zone and keep its GitHub Pages DNS record proxied.
2. Authenticate Wrangler with a scoped Cloudflare token.
3. Run:

```text
npm exec --yes wrangler@4.115.0 -- deploy --config workers/chainwhisper-api/wrangler.jsonc
```

Only the two `/api/v1` route patterns invoke the Worker. All app paths continue directly to GitHub Pages; no origin proxy code is needed.

`COTI_RPC_URL` and `CARBON_API_BASE_URL` default to public HTTPS endpoints and can be changed as Worker variables. No browser or MCP user receives those backend configuration values.
