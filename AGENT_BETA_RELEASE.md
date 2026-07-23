# ChainWhisper Agent Competition Beta

## Release scope

This beta is prepared from the `agent` branch. It keeps App Help and Trade Agent on `/otc/agent`, uses the canonical `/otc/...` routes, and does not add autonomous execution or MCP tools.

App Help remains free and local-first. Trade Agent requests remain individually paid with a public WISP transfer from the ChainWhisper account. Agent actions can only prepare, copy, or open trusted local data; the user still reviews and confirms every trade action.

## Readiness gates

- Disconnected Trade Agent guidance opens the existing account connection flow.
- Composer availability is derived from the shared readiness state.
- Focused Agent tests cover `prompt-needed`, `account-needed`, `ready`, `loading`, `retryable`, and `error`.
- Browser coverage includes Agent, wallet, create-order, recurring-order, terminal, Privacy Portal, and mobile flows.
- CI runs on pushes to `agent` and `main`; GitHub Pages deployment remains unchanged.
- MCP is explicitly deferred to the next major capability phase.

## Payment verification boundary

The beta release check calls the live `estimate` and `quote` operations only. It verifies that the displayed amount is rounded to whole WISP and that the final quote includes its request ID/hash, quote token, authorization message, issue/expiry timestamps, payer, token, amount, and recipient binding.

`run`, retry, duplicate, expiry, and recovery behavior is covered with automated mocks and Deno tests. This release pass does **not** sign an authorization message, transfer real WISP, or run a live paid Agent request. Terminal payment cases remain identifiable for manual WISP refund review.

## Verification commands

```sh
npm run lint
npm run test
npm run test:agent
npm run build
cd supabase/functions/trade-agent
deno task check
deno task test
cd ../../..
npm run test:browser
```

## Verified release results

- Lint passes with no errors.
- Unit suite: 688/688 tests pass.
- Focused Agent suite: 84/84 tests pass, including every readiness state.
- Production TypeScript and Vite build passes.
- Trade Agent Edge Function: Deno check passes and 13/13 tests pass.
- Browser suite: 74/74 tests pass with zero skips, including critical Agent console-error and horizontal-overflow coverage.
- Live quote-only verification returned a rounded 622 WISP quote with complete signed-request fields. No authorization was signed and no WISP was transferred.

## GitHub Pages deployment checklist

This pass does not deploy.

1. Confirm the `agent` CI run is green.
2. Confirm the release commit is the intended `agent` branch head.
3. Recheck the production environment variables and `TRADE_AGENT_QUOTE_SECRET`.
4. Verify live `estimate` and `quote` without signing or transferring WISP.
5. Review the Figma release-readiness board at desktop and mobile sizes.
6. Merge through the normal reviewed release process only when the beta is accepted.
7. Let the existing GitHub Pages workflow deploy from its configured production branch.
8. Run a post-deploy App Help and quote-only smoke check.

No migration, Edge Function deployment, production Pages deployment, or merge to `main` is part of this beta-hardening pass.
