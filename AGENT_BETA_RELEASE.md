# ChainWhisper Agent Competition Beta

## Release scope

This beta is prepared from the `agent` branch. It keeps App Help and Trade Agent on `/otc/agent`, adds Agent Setup as the third tab, and uses the canonical `/otc/...` routes.

App Help remains free and local-first. Trade Agent requests remain individually paid with a public WISP transfer from the ChainWhisper account. Agent actions can only prepare, copy, or open trusted local data; the user still reviews and confirms every trade action.

The external Agent Setup path installs one release-pinned ChainWhisper package with two local MCP security boundaries: a keyless OTC planner and a credential-holding COTI signer. External writes are separate from the paid in-app Trade Agent, require MCP form confirmation for every transaction, and pay normal COTI gas and ChainWhisper contract fees.

## Readiness gates

- Disconnected Trade Agent guidance opens the existing account connection flow.
- Composer availability is derived from the shared readiness state.
- Focused Agent tests cover `prompt-needed`, `account-needed`, `ready`, `loading`, `retryable`, and `error`.
- Browser coverage includes Agent, wallet, create-order, recurring-order, terminal, Privacy Portal, and mobile flows.
- CI runs on pushes to `agent` and `main`; GitHub Pages deployment remains unchanged.
- Agent Setup remains free and has no wallet, payment, signature, or WISP side effects.
- CI builds, tests, and package-smoke-checks `@chainwhisper/agent-tools`.

## MCP beta boundary

- `chainwhisper-mcp` owns protocol reads, validation, price references, simulation, and authenticated `ActionEnvelopeV1` plans. It never receives wallet credentials or raw order secrets.
- `chainwhisper-coti-signer` owns the locally configured wallet and AES key, exact approvals, form confirmations, serialized writes, recovery, and the encrypted secret vault. Private-artifact execution remains fail closed in this beta.
- The official COTI private-messaging SDK is embedded in the signer through an allowlisted tool subset. There is no separate ChainWhisper skill or messaging MCP.
- Received `cw.otc/1` messages are untrusted and can draft, but cannot execute, an action.
- The deployed COTI Mainnet bytecode and committed runtime manifest are authoritative. Recurring writes remain disabled unless the live bytecode and `fill*WithSecret` selectors agree.
- The unconfigured signer exposes only `chainwhisper_signer_status` and reports `configuration-required`; it does not fail the MCP connection or expose write tools.
- Preparation reports `ready`, `needs_input`, or `unsupported`. Countering is negotiation-only and general order editing has no executable envelope in this beta.
- Executable MCP writes are limited to public visible one-off creation/fill, audited public lifecycle updates, and public visible recurring operations while the live runtime audit enables them.
- Direct, unlisted, private-liquidity, private-token, confidential-amount, and general edit execution fail closed with `unsupported` and no envelope. Encrypted messaging can negotiate editable drafts, but cannot turn those routes into executable actions in this beta.
- Clients without MCP form elicitation remain read-only.
- Generic COTI and Carbon MCP servers may coexist but are optional ecosystem tools, not ChainWhisper dependencies.
- Automated release verification performs no live signing, transaction broadcast, or private-message write. Those smoke tests require explicitly funded test wallets and separate authorization.

## Payment verification boundary

The beta release check calls the live `estimate` and `quote` operations only. It verifies that the displayed amount is rounded to whole WISP and that the final quote includes its request ID/hash, quote token, authorization message, issue/expiry timestamps, payer, token, amount, and recipient binding.

`run`, retry, duplicate, expiry, and recovery behavior is covered with automated mocks and Deno tests. This release pass does **not** sign an authorization message, transfer real WISP, or run a live paid Agent request. Terminal payment cases remain identifiable for manual WISP refund review.

## Verification commands

```sh
npm run lint
npm run test
npm run test:agent
npm run build:mcp
npm run test:mcp
npm run smoke:mcp
npm run pack:mcp
npm run smoke:mcp:live
npm run audit:runtime --workspace @chainwhisper/agent-tools
npm run build
cd supabase/functions/trade-agent
deno task check
deno task test
cd ../../..
npm run test:browser
```

## Verification record

Fresh local verification of the current working tree on July 27, 2026:

- Lint: passed with no errors.
- Unit suite: 81 files and 715/715 tests passed.
- Focused Agent suite: 14 files and 94/94 tests passed, including Agent Setup and every Trade Agent readiness state.
- Production TypeScript and Vite build: passed; 3,833 modules transformed.
- MCP TypeScript build: passed.
- MCP suite: 6 files and 85/85 tests passed.
- MCP stdio smoke: planner ready and signer safely reported unconfigured/read-only.
- Packed npm archive: inspected, unpacked into an isolated `node_modules` layout, and both packed binaries passed stdio smoke. The packed manifest exposes only the working `audit:runtime` script and uses public scoped-package metadata.
- Live read-only MCP status and runtime audit: passed at COTI block `0x81b076`; registry, contracts, bytecode, and selectors matched, and recurring writes were enabled.
- Trade Agent Edge Function: Deno check passed and 13/13 tests passed.
- Browser suite: 85/85 tests passed with zero skips, including Agent Setup side effects, Agent console-error coverage, wallet transitions, mobile layouts, and horizontal-overflow checks.
- Live quote-only verification: `estimate` and `quote` returned the same rounded 644 WISP fee with valid request ID/hash, quote token, authorization message, issue/expiry window, payer, action, and chain binding.
- No authorization was signed, no WISP was transferred, no Agent request was run, and no MCP transaction or private message was written.

This is a local working-tree result. GitHub CI will validate the same checks only
after an explicitly authorized commit and push to `agent`.

## Remaining publication gates

- Confirm ownership and release credentials for the `@chainwhisper` npm scope, then publish `@chainwhisper/agent-tools@0.1.0-beta.0` with the `beta` dist-tag.
- Add an owner-approved repository/package license file before publishing; the package currently declares MIT but the repository has no `LICENSE` file.
- Optionally strengthen the tarball gate with a clean dependency install and generated command-shim invocation. The current gate accurately covers archive contents, isolated unpacking, and direct packed-binary stdio startup.
- Commit and push only the intended `agent` changes so GitHub CI can attest the release candidate. Do not include local Vite logs.

## GitHub Pages deployment checklist

This pass does not deploy.

1. Confirm the `agent` CI run is green.
2. Confirm the release commit is the intended `agent` branch head.
3. Recheck the production environment variables and `TRADE_AGENT_QUOTE_SECRET`.
4. Verify live `estimate` and `quote` without signing or transferring WISP.
5. Verify both MCP status tools remain read-only unless local signer credentials and form elicitation are intentionally configured.
6. Review the Figma release-readiness board at desktop and mobile sizes.
7. Publish the pinned MCP package only after its package smoke check and bytecode audit pass.
8. Merge through the normal reviewed release process only when the beta is accepted.
9. Let the existing GitHub Pages workflow deploy from its configured production branch.
10. Run a post-deploy App Help and quote-only smoke check.

No migration, Edge Function deployment, production Pages deployment, or merge to `main` is part of this beta-hardening pass.
