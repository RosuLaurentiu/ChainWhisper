# ChainWhisper

ChainWhisper is a browser-based COTI Mainnet app hub for private coordination. It combines a Home launcher, encrypted wallet chat, OTC escrow trading, the Privacy Portal token-conversion page, and Treasury Data analytics in one Vite + React + TypeScript project.

The app uses `@coti-io/coti-ethers`, `viem`, Recharts, Zustand, TanStack Virtual, and Supabase Storage for temporary encrypted chat image blobs.

This is a documentation-only description of the current app. Runtime routes, contract calls, schemas, and public interfaces are owned by the source files listed below.

## Routes And Apps

Current route behavior is intentional and should stay as-is unless a future change explicitly updates `src/shell/routing.ts` and its tests.

- `/` - canonical Home launcher. `/home` is accepted as an alias.
- `/chat` - ChainWhisper Chat. `/messages` and `/messenger` are accepted aliases.
- `/otc` and `/otc/...` - canonical OTC trading workspace. `/trades` and `/otcdesk` routes are accepted as legacy aliases.
- `/portal` - canonical Privacy Portal conversion page. `/swap`, `/shield`, and `/whisper-shield` are accepted aliases.
- `/treasury` - Treasury Data. `/treasury-data` is accepted as an alias.

### Home (`/`)

The home page launches the app suite and routes in-place to Chat, OTC Trading, Privacy Portal, and Treasury Data so the wallet session can remain available across pages.

Home does not show wallet controls because it is a launcher rather than an interactive contract page.

### ChainWhisper Chat (`/chat`)

The chat app is a wallet-native encrypted messenger for COTI.

- Direct wallet-to-wallet encrypted messages.
- Group chat with on-chain group creation, invites, join codes, member removal, admin handoff, rename, leave, and disband flows.
- Owner-first wallet model: MetaMask/browser wallet is owner login, recovery, and funding; the ChainWhisper account is the default chat/trading identity.
- Recoverable ChainWhisper accounts can be saved/restored through the COTI GC profile registry with owner-wallet privacy.
- App wallet, MetaMask, and CipherTrade wallet sessions, with owner + ChainWhisper account activity shown together where supported.
- Contact aliases, hidden and muted conversations, replies, emoji reactions, read-state backup, notification sound, and wallet-to-wallet tips.
- Encrypted image attachments uploaded to Supabase Storage and cleaned up after 24 hours.
- Inline OTC order offers inside private chats using the shared trade composer and escrow action logic.
- Linked order context from OTC-to-chat navigation, compact order references in sent messages, and Open order actions from chat trade cards/links.
- Contacts are the first chat workspace on desktop and mobile; wallet actions live in the top header wallet menu.

### OTC Trading (`/otc`)

The standalone OTC app is an escrow trading workspace backed by COTI contracts. It has four top-level surfaces and one detail surface.

- `Trade` at `/otc` is the action surface with `Swap`, `Limit`, and `Recurring` modes.
- `Desk` at `/otc/desk` browses active public orders with search, filters, refresh, inline order review, and wallet balance context.
- `Agent` at `/otc/agent` opens in free App Help mode for product questions without a wallet. Its separate paid WISP Trade Agent mode finds prices, drafts or explains orders, and opens safe prefilled actions for review.
- Agent Setup installs the external [`@chainwhisper/agent-tools`](https://github.com/RosuLaurentiu/ChainWhisper-MCP) package as two local MCP connections: a keyless ChainWhisper planner and a signer-owned Agent Wallet/Agent Control process.
- The external MCP can perform the ChainWhisper economic actions exposed by the app: best-single-order Swap; one-off Public, Unlisted, and Direct orders; visible or private liquidity; fill, partial fill, counter, edit/replace, cancel, and decline; reusable recurring orders; Privacy Portal conversions; private order state; and order-linked private negotiation.
- Agent Control is one persistent local dashboard for wallet setup, one-time privacy onboarding, verified public/private balances, one confirmation per complete manual action, bounded or 24-hour full autonomy, transaction progress, and merged local plus wallet-wide ChainWhisper activity.
- ChainWhisper private negotiation already uses the official COTI private-messaging SDK inside the local signer. No COTI skill or standalone messaging MCP is required. An independent COTI MCP may remain available for generic COTI operations, but ChainWhisper never calls it or shares Agent Wallet credentials with it.
- The in-app paid WISP Trade Agent remains a separate drafting/help experience. External MCP actions use normal COTI gas and ChainWhisper protocol fees, not the Trade Agent request fee.
- `Orders` at `/otc/orders` groups received offers, active offers, and history for the connected owner + ChainWhisper account scope.
- `Order` review lives under `/otc/order...`. Canonical generated links use `/otc/order/link/:code`, `/otc/order/:id`, or `/otc/order/recurring/:id`.
- Legacy `/trades...`, `/otcdesk...`, and old terminal links still resolve for compatibility, but new app-generated links should use `/otc...`.
- Swap finds and can execute the best single compatible ChainWhisper order for the selected pair and side. It never routes or averages across multiple orders.
- Swap follows the same mental model as order review: `Sell`/`Buy` chooses the executable side; the center token flip changes the displayed price basis. Carbon and ChainWhisper prices must always share the exact same basis.
- When no single order is available, Swap points users toward browsing Desk or opening a Limit order.
- Limit creates one-off OTC offers with Public, Unlisted, Direct, counter/edit flows, `Private liquidity`, `Visible amounts`, expiry, fee, and hybrid private-token support.
- Recurring creates reusable two-sided OTC liquidity in the same Trade ticket, with independent sell-side and buy-side prices/liquidity.
- Normal trades use the Trading V1 OTC escrow and reader contracts and support public, private-link, direct, counter, partial fill, cancel, decline, permanent/no-expiry, edit-by-replace, and visible private-token amount flows.
- Private tokens are not automatically hidden. When `Visible amounts` is selected, private-token order size, fills, and remaining amounts are public and route through the normal OTC contract.
- Hidden-amount private orders use the Trading V1 private-orders contract. Fully private orders use private tokens on both sides; hybrid private orders offer a private token while the taker pays with public/native assets.
- Hidden-amount private orders and private recurring orders use a user-scoped private ledger for maker live liquidity snapshots and participant fill receipts.
- Owner recovery uses the COTI MetaMask Snap for owner privacy where available. ChainWhisper account privacy remains wallet-scoped so owner and ChainWhisper privacy state stay separate.
- Hidden-amount public/detail views hide private amounts and fill amounts while showing price ratio, direction, expiry, and access type.
- Makers can reveal their own private-order progress and recurring live liquidity from Orders after privacy is available. Fillers can reveal their own private fill history, including partial fills on open orders. Standard private-liquidity cards and order review views show two-sided progress when private fill receipts reveal both values.
- Unlisted orders are not auto-posted into chat, but copied share links can be pasted into conversations.
- Recurring orders are reusable two-sided OTC liquidity, not timed/cadence orders: buy fills add base inventory to the sell side, and sell fills add quote inventory to the buy side. Makers can edit prices, per-side amounts, and add/remove live liquidity without changing the order link; closing the order returns remaining inventory.
- Open compact order links, full URLs, legacy trade IDs, or redirected GitHub Pages links.
- A completed counter trade cancels the parent/initial trade automatically.
- The shared top-header wallet control uses the ChainWhisper account for new trade actions by default. Owner-wallet fallback is reserved for funding/recovery and existing owner-targeted actions where the contract requires the owner address.
- The trading UI can show combined owner + ChainWhisper balances, move missing funds before important trade actions, preserve a small COTI fee reserve, and confirm maker actions with app-styled modals.

### Privacy Portal (`/portal`)

Privacy Portal is a DEX-style interface for COTI's official public/private token bridges. `/swap`, `/shield`, and `/whisper-shield` remain aliases.

- Converts COTI, WETH, WBTC, USDT, USDC.e, WADA, and gCOTI between public and private form through their verified COTI Mainnet bridges.
- Reads live bridge status, limits, liquidity, amount-specific fees, and oracle timestamps before every conversion.
- Lists WISP first in the same asset selector as the seven official pairs. The WISP card supports the current ChainWhisper WISP/pWISP bridge in both directions and clearly identifies it as ChainWhisper-provided rather than an official COTI bridge.
- Keeps the old-pWISP-to-WISP compatibility exit collapsed at the bottom as a legacy recovery option; that legacy route cannot create private WISP.
- Uses the same owner-first ChainWhisper account header as Chat and OTC.
- Keeps account setup, recovery, backup, move/withdraw funds, and advanced owner-wallet fallback actions in the wallet menu.

### Treasury Data (`/treasury`)

Treasury Data is a read-only analytics dashboard for COTI treasury metrics.

- Loads live treasury totals from the Treasury API.
- Loads historical snapshots from `public/snapshots.json`, optional API history sources, and on-chain snapshot sources.
- Reads the snapshot store contract and explorer transaction history.
- Displays timeframe filters, metric switching, chart tooltips, saved snapshot counts, live values, and on-chain references.
- Does not require wallet interaction.

## Project Structure

The app is organized around feature ownership, with shared code kept small and explicit.

- `src/App.tsx` is the top-level composition shell. It still owns shared wallet/chat state, but group sync, direct-message actions, trade actions, account funding, and page rendering have been pulled into feature hooks/components where practical.
- `src/app/` owns app-shell UI, navigation, route lazy loading, the Home page, notification sound, and app-level helper hooks.
- `src/features/chat/` owns direct-chat UI state, panels, message actions, sync hooks, tips, reactions, image status, and chat-specific Zustand state.
- `src/features/groups/` owns group panels, group actions, group sync orchestration, invites, member/admin flows, and group-specific Zustand state.
- `src/features/trading/` owns the OTC page, Trade/Desk/Agent/Orders surfaces, terminal rendering, Trade Agent panel/session/action hooks, trading balances, swap quote state, recurring order actions, and in-chat trade orchestration.
- `src/features/wallet/` owns the shared wallet header, ChainWhisper account vault, owner recovery/onboarding, funds modals, wallet readiness, and account transfer flows.
- `src/features/tokenTools/` owns Privacy Portal conversion state/actions, WISP recovery, and token-tool UI state.
- `src/features/treasury/` owns Treasury Data UI and data normalization.
- `src/shared/` owns reusable cross-feature UI, chat rendering pieces, modal/clipboard/virtual-scroll hooks, and small state utilities.
- `src/shell/` owns route parsing, canonical route aliases, realtime status helpers, and browser-location sync.
- `src/lib/` owns non-React chain, wallet, trade, parsing, storage, encoding, COTI provider, and contract helpers.
- `src/styles.css` is the ordered stylesheet import hub. Route/domain CSS lives in `src/styles/`.

Zustand is used as feature-local UI state, not as a replacement for contract/business logic. Keep money movement, wallet recovery, routing, and chain reads/writes in the shared libs/hooks that already own them.

See `AGENTS.md` for future-maintenance rules. Local proposal and research notes are intentionally ignored.

## Network And Contracts

- Network: COTI Mainnet, chain ID `2632500`, hex `0x282b34`.
- Direct chat contract: `0xE5101D33986c91565D2C9f8b49AAF0b8FFeE2243`.
- Group chat contract: `0xE175ec590CE13FB6349f1CAd8b7e9D5d21eaa32b`.
- ChainWhisper OTC escrow V1: `0x7a232810f250a2C6e90895215aFf826116DFDb06`.
- ChainWhisper Direct OTC escrow V1: `0x634c6dddda784c29d0435Cc54ca072Af0551914a`.
- ChainWhisper Private OTC escrow V1: `0xe211c032E4432FdeB9e48f06b69EB98583B2A231`.
- ChainWhisper Recurring OTC escrow V1: `0x7235B18b9CD59fB9853BC3BF3a0A65bc32162cd5`.
- ChainWhisper OTC reader V1: `0x77889B2f9F9fD812ad65AfF41048426fA1382660`.
- ChainWhisper OTC history reader V1: `0x650666328A771d70881c189F3B2BB1F3fBfe0514`.
- ChainWhisper OTC registry V1: `0x91e32EdFAb1e74DA07ea3012491a44D983aeBA46`.
- ChainWhisper profile registry GCV2: `0xf37196Fafe760E92d3542D837a1595B2a625F618`.
- Reward token: `0xb70c55bd0823436F44877DC6A9f46E0C55f2C3A8`.
- Private reward token: `0x682e3142e62a7aDe2a0CA5bdC87b205CaDe4B17a`.
- Verified ecosystem token presets live in `src/lib/appHelpers.ts`; they include public token `0xe8C3D2248a578e9E020C2447f8148e606090fbfe` and private token `0xefe07cbd73538b2f7b3dd8cbc3a435fd4ee16213`.
- WISP Privacy Bridge: `0x3bCeA2eD4b31107eF877899416dC97213bdc2809`.
- Legacy reward swap vault: `0x5C35CD3659991051F4Fb04F2C4120643739b7BdE`.
- Treasury snapshot store default: `0x25975eda0B0Ef3E5D86787Cb89D0A3468C17Bece`.

## Data And Storage

- On-chain: encrypted direct messages, encrypted group messages, group membership/invite/join-code state, nickname records, read-state backup memos, Trading V1 OTC trades, hidden-amount private orders, recurring OTC orders, token fees, and Treasury snapshot history.
- Browser storage: UI state, cached decrypted timelines, unread maps, notification preference, wallet preference, known trade access secrets, known maker-side private-order reveal context, selected wallet IDs, and encrypted ChainWhisper account vaults.
- Supabase Storage and Edge Functions: encrypted chat image blobs in the `chat-images` bucket plus scheduled cleanup.

Sensitive local data should stay minimized. Private trade access secrets and maker-side private-order records are convenience caches and should not be treated as public app state.

## Local Development

```bash
npm install
npm run dev
```

Other scripts:

- `npm run lint` - run ESLint.
- `npm run test` - run Vitest tests.
- `npm run test:wallet` - run focused wallet/account/recovery/funding tests.
- `npm run test:trading` - run focused OTC/trading tests.
- `npm run test:chat` - run focused chat/parsing/sync tests.
- `npm run build` - type-check and produce a production build.
- `npm run test:browser` - run focused Playwright smoke tests for route wallet policy and mobile layout guardrails.
- `npm run verify:privacy-contracts` - verify the seven checked-in bridge pairs against COTI Mainnet.
- `npm run preview` - preview the built app.

Before finishing changes, run:

```bash
npm run lint
npm run test
npm run build
npm run test:browser
npm run verify:privacy-contracts
```

### Authorized mainnet smoke checklist

Do not run funded mainnet conversions as part of automated release checks. With explicit authorization and deliberately small amounts, verify each item below for both the default ChainWhisper account and the Owner account:

1. Native round trip: COTI to p.COTI, then p.COTI back to COTI. Confirm the amount-specific fee, reserved gas on Max, both wallet confirmations, final receipt, explorer link, and refreshed public/private balances.
2. ERC-20 round trip: choose one of WETH, WBTC, USDT, USDC.e, WADA, or gCOTI; convert public to private and back. Confirm exact approval behavior, the fresh post-approval quote, unchanged token output, native COTI fee, final receipt, explorer link, and refreshed balances.
3. Account isolation: before each round trip, confirm the selected account address and private-balance unlock state. Switch accounts only after the sequence is complete and verify the other account's form, quote, and balances are independent.
4. WISP round trip: select WISP, confirm its ChainWhisper provenance label, shield a small WISP amount to current pWISP, then unshield it and verify both explorer links.
5. Legacy isolation: expand the collapsed legacy option at the bottom, confirm it only offers old pWISP to WISP, and verify it is not described as an official COTI bridge.

Run `npm run test:browser` as well for route, wallet-header, layout, or other visible UI changes.

For focused checks, use the domain scripts first:

```bash
npm run test:wallet
npm run test:trading
npm run test:chat
```

## Environment

Copy `.env.example` to `.env` and fill any project-specific values.

Core variables:

- `VITE_SUPABASE_PROJECT_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_TREASURY_API_BASE_URL`
- `VITE_TREASURY_TOTALS_PATH`

Optional Treasury history variables:

- `VITE_API_BASE_URL`
- `VITE_SNAPSHOT_URL`
- `VITE_CONTRACT_ADDRESS`
- `VITE_COTI_RPC_URL`
- `VITE_COTI_EXPLORER_URL`
- `VITE_COTI_EXPLORER_API_URL`

## Supabase App Help and Trade Agent

`supabase/functions/trade-agent` serves isolated free-help and paid-agent request paths:

- `kind: "help"` answers curated, high-confidence product questions locally and refuses unrelated or sensitive questions without calling OpenAI. Broader ChainWhisper questions use server-owned help topics with `gpt-5-nano` by default, a 300-token output cap, no tools, and `store: false`.
- `kind: "estimate"` returns the non-binding WISP fee label.
- `kind: "quote"` validates and hashes the exact safe request, then returns a 15-minute HMAC-authenticated quote and an EIP-191 authorization message.
- `kind: "run"` verifies the signed quote and exact public WISP transfer. Duplicate requests return the cached validated response or a processing/retryable state instead of charging again.
- `kind: "recover"` uses a fresh wallet signature to recover a completed, processing, or retryable request after a reload or lost HTTP response.

Paid responses may only prefill, copy, or open trusted local data; they never execute a trade. Raw prompts and contexts are not stored in the payment table.

Production Edge Function secrets:

- `OPENAI_API_KEY`
- `APP_HELP_RATE_LIMIT_SECRET` (a random 32-byte-or-longer secret used only to HMAC client IPs)
- `TRADE_AGENT_QUOTE_SECRET` (a separate high-entropy secret of at least 32 characters used only to authenticate paid-agent quotes)
- `APP_HELP_MODEL` (optional, defaults to `gpt-5-nano`)
- `OPENAI_MODEL` (optional paid-agent override, defaults to `gpt-5-mini`)

`supabase/migrations/20260713103016_app_help_rate_limits.sql` creates an RLS-protected counter table and a service-role-only, atomic `claim_app_help_request` function. AI-assisted help is capped at 10 calls per HMAC-hashed IP per UTC day and 1,000 calls globally per UTC day. Rate-limit errors fail closed before OpenAI; curated local answers remain available.

Deployment outline:

1. Apply the App Help rate-limit migration and the additive Trade Agent payment-v2 migration.
2. Set the Edge Function secrets above.
3. Deploy `supabase/functions/trade-agent` with JWT verification disabled as configured in `supabase/config.toml`. This strict v2 function rejects legacy paid clients before they can receive a final fee quote.
4. Deploy the matching frontend, then audit legacy `pending` or `failed` rows for manual resolution.

## Supabase Image Storage

Temporary encrypted image messaging uses Supabase assets included in this repo:

- `supabase/migrations/20260420205439_chat_image_storage.sql` creates the public `chat-images` bucket, sets the encrypted image size limit, adds the browser upload policy, and schedules cleanup every 15 minutes.
- `supabase/functions/chat-image-cleanup` deletes bucket objects older than 24 hours.

The bucket is public for reads because blobs are encrypted client-side before upload. Decryption material is delivered through the encrypted chat message payload, not through Supabase.

Deployment outline:

1. Apply `supabase/migrations/20260420205439_chat_image_storage.sql`.
2. Deploy `supabase/functions/chat-image-cleanup`.
3. Set `VITE_SUPABASE_PROJECT_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

## GitHub Pages

The app is configured for a custom-domain GitHub Pages deployment from the repository root (`base: '/'`). The deploy workflow preserves `CNAME` and writes `dist/.nojekyll`.

CI runs on pull requests and main branch pushes:

```bash
npm run lint
npm run test
npm run build
```

Use `npm run test:browser` locally for browser smoke coverage before shipping UI-sensitive changes.
