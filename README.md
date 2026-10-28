# ChainWhisper

ChainWhisper is a browser-based COTI app hub for private coordination. It combines a Home launcher, encrypted wallet chat, DEX and OTC trading, the Privacy Portal token-conversion page, and COTI Private TVL analytics in one Vite + React + TypeScript project.

## Hosted Testnet build

The `main` branch deploys the current Testnet App to https://chainwhisper.app/.
Run `npm ci` and `npm run build:pages` with Node 22 to build the same configuration.
The committed `.env.coti-testnet-candidate` contains only public browser settings:
the reviewed Testnet manifest, public addresses/hashes and the WalletConnect
project identifier. It is a saved deployment input, not a claim of fresh chain
attestation. The normal runtime candidate, wallet and transaction checks remain.

GitHub Pages does not need the sibling Contracts repository, local `.env` files,
wallet credentials or validation reports. Local engineering can still use
`build:testnet-candidate` to prepare its ignored `.local` override. Review and
update the committed public settings when adopting another candidate. Never put
keys, private inputs or server credentials in `VITE_*` values.

The Pages workflow publishes `release.json` with the deployed source commit and
network. `404.html` restores direct App links. Keeper, matching, C1, price services
and Supabase functions run separately; a frontend push does not start or deploy
them. Hosting this candidate does not close the beta acceptance or production
security gates. Existing service and wallet holds remain in force.

`npm run test:ci` runs self-contained App tests. It excludes the 38 tests that
load exact contract candidates or private/local evidence from the full workspace;
their explicit file list is in `package.json`. `npm test` retains those checks
for the full workspace. Small public ABI and synthetic chart fixtures live in
`tests/fixtures`, with source hashes. CI success is App evidence, not fresh
native-contract or wallet acceptance. Local reports are not uploaded to GitHub.

The source before this update is commit `00bef723d0ba89ca483d2f22de9cb6161f63924a`.
Use a reviewed forward revert if a rollback is required; do not force-push history.
A source rollback cannot undo blockchain actions or restore browser data from
the old domain.

The app uses `@coti-io/coti-ethers`, `viem`, Recharts, Zustand, TanStack Virtual, and Supabase Storage for temporary encrypted chat image blobs.

This is a documentation-only description of the current app. Runtime routes, contract calls, schemas, and public interfaces are owned by the source files listed below.

## Routes And Apps

Current route behavior is intentional and should stay as-is unless a future change explicitly updates `src/shell/routing.ts` and its tests.

- `/` - canonical Home launcher. `/home` is accepted as an alias.
- `/chat` - ChainWhisper Chat. `/messages` and `/messenger` are accepted aliases.
- `/otc` and `/otc/...` - canonical OTC trading workspace. `/trades` and `/otcdesk` routes are accepted as legacy aliases.
- `/portal` - canonical Privacy Portal conversion page. `/swap`, `/shield`, and `/whisper-shield` are accepted aliases.
- `/tvl` - canonical COTI Private TVL page. `/private-tvl`, `/treasury`, and `/treasury-data` are accepted as aliases.

### Home (`/`)

The home page launches the app suite and routes in-place to Chat, Trading, Privacy Portal, and COTI Private TVL so the wallet session can remain available across pages.

Home does not show wallet controls because it is a launcher rather than an interactive contract page.

### ChainWhisper Chat (`/chat`)

The chat app is a wallet-native encrypted messenger for COTI.

- Direct wallet-to-wallet encrypted messages.
- Group chat with on-chain group creation, invites, join codes, member removal, admin handoff, rename, leave, and disband flows.
- One-wallet authority model: the selected MetaMask or CipherTrade address directly owns and signs chat, trading, balances, proceeds, refunds, and liquidity positions.
- Desktop extensions, injected mobile dapp browsers, MetaMask Mobile, and CipherTrade Mobile over WalletConnect are supported. The WalletConnect option accepts sessions whose peer metadata identifies CipherTrade; wallet metadata is self-attested, while account, chain, provider, and session-lifecycle binding remain fail-closed.
- The browser app never generates, stores, funds, recovers, or silently falls back to a second application wallet.
- Public self-owned names, private saved contact names, one unified hidden/muted contact state, replies, emoji reactions, read state, notification sound, and wallet-to-wallet tips.
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
- `Orders` at `/otc/orders` groups received offers, active offers, and history for the connected wallet.
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
- MetaMask privacy uses the COTI Snap. CipherTrade privacy uses an explicit wallet-controlled COTI onboarding flow held only for the current browser session.
- Hidden-amount public/detail views hide private amounts and fill amounts while showing price ratio, direction, expiry, and access type.
- Makers can reveal their own private-order progress and recurring live liquidity from Orders after privacy is available. Fillers can reveal their own private fill history, including partial fills on open orders. Standard private-liquidity cards and order review views show two-sided progress when private fill receipts reveal both values.
- Unlisted orders are not auto-posted into chat, but copied share links can be pasted into conversations.
- Recurring orders are reusable two-sided OTC liquidity, not timed/cadence orders: buy fills add base inventory to the sell side, and sell fills add quote inventory to the buy side. Makers can edit prices, per-side amounts, and add/remove live liquidity without changing the order link; closing the order returns remaining inventory.
- Open compact order links, full URLs, legacy trade IDs, or redirected GitHub Pages links.
- A completed counter trade cancels the parent/initial trade automatically.
- The shared top-header wallet control uses the same connected address for every trade action and never moves funds to a hidden secondary account.
- The trading UI shows that wallet's balances, preserves a small COTI fee reserve, and confirms economic actions with app-styled review modals.

### Privacy Portal (`/portal`)

Privacy Portal is a DEX-style interface for COTI's official public/private token bridges. `/swap`, `/shield`, and `/whisper-shield` remain aliases.

- Converts COTI, WETH, WBTC, USDT, USDC.e, WADA, and gCOTI between public and private form through their verified COTI Mainnet bridges.
- Reads live bridge status, limits, liquidity, amount-specific fees, and oracle timestamps before every conversion.
- Lists WISP first in the same asset selector as the seven official pairs. The WISP card supports the current ChainWhisper WISP/pWISP bridge in both directions and clearly identifies it as ChainWhisper-provided rather than an official COTI bridge.
- Keeps the old-pWISP-to-WISP compatibility exit collapsed at the bottom as a legacy recovery option; that legacy route cannot create private WISP.
- Uses the same connected MetaMask or CipherTrade header as Chat and OTC.
- Keeps connect, privacy unlock, network selection, address copy, and disconnect actions in the wallet menu.

### COTI Private TVL (`/tvl`)

COTI Private TVL is a wallet-free, read-only view of assets locked in the reviewed COTI privacy bridges.

- Reads every reviewed bridge reserve and private-token liability at one canonical safe-head block.
- Counts the public reserve as TVL and uses the private liability only to reconcile backing; it never double counts both sides.
- Values fresh references with the reviewed Band Standard Reference proxy and excludes stale or unavailable prices from the USD total.
- Shows per-token reserve, liability, coverage, Band USD status, and USD TVL with block and contract provenance.
- Does not require wallet interaction.

## Project Structure

The app is organized around feature ownership, with shared code kept small and explicit.

- `src/App.tsx` is the top-level composition shell. It still owns shared wallet/chat state, but group sync, direct-message actions, trade actions, account funding, and page rendering have been pulled into feature hooks/components where practical.
- `src/app/` owns app-shell UI, navigation, route lazy loading, the Home page, notification sound, and app-level helper hooks.
- `src/features/chat/` owns direct-chat UI state, panels, message actions, sync hooks, tips, reactions, image status, and chat-specific Zustand state.
- `src/features/groups/` owns group panels, group actions, group sync orchestration, invites, member/admin flows, and group-specific Zustand state.
- `src/features/trading/` owns the OTC page, Trade/Desk/Agent/Orders surfaces, terminal rendering, Trade Agent panel/session/action hooks, trading balances, swap quote state, recurring order actions, and in-chat trade orchestration.
- `src/features/wallet/` owns the shared MetaMask/CipherTrade header, exact browser-session leases, COTI privacy onboarding, balances, and wallet readiness.
- `src/features/tokenTools/` owns Privacy Portal conversion state/actions, WISP recovery, and token-tool UI state.
- `src/features/treasury/` owns the COTI Private TVL UI, cached loader, and presentation; the canonical model lives in `src/lib/privateTvl.ts` and chain reads live in `src/lib/appChain.ts`.
- `src/shared/` owns reusable cross-feature UI, chat rendering pieces, modal/clipboard/virtual-scroll hooks, and small state utilities.
- `src/shell/` owns route parsing, canonical route aliases, realtime status helpers, and browser-location sync.
- `src/lib/` owns non-React chain, wallet, trade, parsing, storage, encoding, COTI provider, and contract helpers.
- `src/styles.css` is the ordered stylesheet import hub. Route/domain CSS lives in `src/styles/`.

Zustand is used as feature-local UI state, not as a replacement for contract/business logic. Keep money movement, wallet lifecycle, routing, and chain reads/writes in the shared libs/hooks that already own them.

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
- Reward token: `0xb70c55bd0823436F44877DC6A9f46E0C55f2C3A8`.
- Private reward token: `0x682e3142e62a7aDe2a0CA5bdC87b205CaDe4B17a`.
- Verified ecosystem token presets live in `src/lib/appHelpers.ts`; they include public token `0xe8C3D2248a578e9E020C2447f8148e606090fbfe` and private token `0xefe07cbd73538b2f7b3dd8cbc3a435fd4ee16213`.
- WISP Privacy Bridge: `0x3bCeA2eD4b31107eF877899416dC97213bdc2809`.
- Legacy reward swap vault: `0x5C35CD3659991051F4Fb04F2C4120643739b7BdE`.
- Treasury snapshot store default: `0x25975eda0B0Ef3E5D86787Cb89D0A3468C17Bece`.

## Data And Storage

- On-chain: encrypted direct messages, encrypted group messages, group membership/invite/join-code state, public nickname records, owner-private saved-name/hidden contact settings, legacy read-state backup memos, Trading V1 OTC trades, hidden-amount private orders, recurring OTC orders, token fees, and Treasury snapshot history.
- Browser storage: UI state, cached decrypted timelines, unread maps, notification preference, wallet preference, known trade access secrets, known maker-side private-order reveal context, and selected wallet IDs. Wallet private keys and COTI AES keys are not persisted by the app.
- Supabase Storage and Edge Functions: encrypted chat image blobs in the `chat-images` bucket plus scheduled cleanup.

Sensitive local data should stay minimized. Private trade access secrets and maker-side private-order records are convenience caches and should not be treated as public app state.

## Local Development

```bash
npm install
npm run dev
```

Other scripts:

- `npm run check:keeper` - check the current 7b67 Testnet keeper qualification without network or key access.
- `npm run dev:keeper` - start the current qualified public keeper with its saved queue and configured operator. Stop with Ctrl+C; use `npm run reconcile:keeper` before resuming uncertain work.
- `npm run lint` - run ESLint.
- `npm run knip` - report unused code and dependency issues without changing files.
- `npm run knip:json` - return the same advisory report as JSON.
- `npm run test` - run Vitest tests.
- `npm run test:wallet` - run focused MetaMask/CipherTrade connection, privacy, lease, and balance tests.
- `npm run test:trading` - run focused OTC/trading tests.
- `npm run test:chat` - run focused chat/parsing/sync tests.
- `npm run build` - type-check and produce a production build.
- `npm run test:browser` - run focused Playwright smoke tests for route wallet policy and mobile layout guardrails.
- `npm run verify:privacy-contracts` - verify the seven checked-in bridge pairs against COTI Mainnet.
- `npm run preview` - preview the built app.

The Testnet App selects the same 7b67 candidate by default. The keeper loads only
its configured operator key after admission, never a trader's signing or AES key.
It keeps the existing 30-minute process bound, five Work calls per operation,
110M gas cap and 50Mwei fixed signing fee. A failure stops the service without
automatic retry. Owner App signing holds remain separate. Native qualification
and an empty-queue service check do not accept the current connected-App journey.

### DEX Testnet candidate: App and services

The current integration candidate is `7b67`, COTI Testnet chain `7082400`, Core
`0xab5374daddea783c3e58de19db497b54c79fd4cc`. Both swap modes and four-token
funding have connected-App evidence. The completed journeys cover
[Fast and reload](reports/current-owner-fast-2026-10-17/fast-accept-fit/FAST7_HANDOFF.md),
[async delivery and recovery](reports/current-owner-app-admission-2026-10-17/OP5_HANDOFF.md),
[Pool creation, top-up, NFT transfer/return, withdrawal and Close](reports/current-pool-owner-app-2026-10-17/POOL_OWNER_HANDOFF.md),
[Limit management, fill, Claim and refund](reports/current-limit-owner-app-2026-10-18/LIMIT55_OWNER_HANDOFF.md)
and [My Activity](reports/current-owner-history-2026-10-17/final-2026-10-19/HANDOFF.md).
The [same-journey timing baseline](reports/current-two-mode-timing-2026-10-19/HANDOFF.md)
states actual costs and the remaining speed limits. Full App trial times exceed
the 1–2 minute engineering target.

The App now also proves an exact positive partial refund, funded keeper restart
and completed-record restore after reconnect in
[operation 8](reports/current-owner-app-admission-2026-10-17/PARTIAL_OP8_RESULT.json).
The beta handoff still needs final service availability and owner acceptance. A no-fill
Quote is rejected before funding; it must not be forced through Accept. The
owner set actual200%zoom and the funding actions remain readable/reachable. A
clipped-header repair is included in the checked final build. The owner's decision
on 21 October removes Decision-030's trial expiry, transaction-count quotas,
artificial amount caps and cumulative fee budget from normal owner App use.
Each action remains owner-initiated and MetaMask-confirmed, with transaction fit,
balance, slippage, accounting and recovery checks. Contract numeric bounds and
faucet eligibility still apply. Completed engineering trials remain consumed.
See the [owner policy result](reports/current-owner-beta-admission-2026-10-20/OWNER_NO_QUOTAS_RESULT.json).
The final App reconnected and restored operation8's exact payout/refund with all14
old charges retained. The matching coexistence repair passed its focused checks
and one complete12-call native window. Owner beta acceptance remains open.

The [fixture handoff](reports/current-beta-fixture-2026-10-19/HANDOFF.md) binds the
accepted results, current source hashes, retained seed records and service state.
Its public snapshot is an observation, not a future send admission.

From `APP`, start the normal App with `npm run dev` and open `/dex` at the URL
printed by Vite. This command selects the Testnet candidate. Keep `dev:mainnet`
separate. A disconnected App can display public prices and charts; private funds,
orders, positions and History require the selected wallet's privacy session.

For the owner beta, connect the approved wallet and unlock privacy. Use Get test
tokens if funds are needed, then select a pair, amount and mode. Get Quote does
not fund a swap; review the private result before Accept. Activity contains orders
and History; Liquidity contains position controls. For pending work, use Check
current state and the displayed cancel/recovery action. Do not repeat a send
after an uncertain result. Existing positions and orders retain their Close/Claim
exits. The completed engineering swaps are evidence, not new spending authority.

Operators use finite Testnet service windows. Owner App access does not promise
continuous unattended service uptime. A stopped window needs its
normal operator restart/admission; public prices show stale status when needed.
Continuous production operation, broad stress/security and owner acceptance stay
on their existing gates.

The four operator services have separate sender and recovery boundaries. Run each
in its own foreground terminal after its current admission passes. Their starts
can spend Test COTI; they are not read-only checks. Do not use the App trader's
keys to configure an operator or run two copies of the same sender.

| Service | Offline binding check | Bounded foreground start | Reconcile existing work |
| --- | --- | --- | --- |
| Async keeper | `npm run check:keeper` | `npm run dev:keeper` | `npm run reconcile:keeper` |
| Prices and daily records | `npm run check:prices` | `npm run dev:prices` | `npm run reconcile:prices` |
| Direct Limit matching | `npm run check:matching` | `npm run dev:matching` | `npm run reconcile:matching` |
| Separate same-pair C1 | `npm run check:c1` | `npm run dev:c1` | `npm run reconcile:c1` |

The network commands above preload `scripts/current-dex-rpc-pacing.cjs`.
They allow one RPC request in flight per process, with at least 500 ms between
requests (334 ms for C1). JSON-RPC batches are paced one call at a time. HTTP
403/429 and other transport failures close that process's queue; there is no
automatic retry or endpoint change. Preserve any pending hash and reconcile it
before a later restart. These are local test caps, not published COTI limits.
Use the npm commands. A direct Node command also needs
`--require ./scripts/current-dex-rpc-pacing.cjs` before the service entry.

During the low-rate resumption check, run only one service at a time. The caps
do not combine traffic from other services, browser tabs or wallet extensions.
The [21 October pacing result](reports/current-owner-beta-admission-2026-10-20/RPC_SERVICE_PACING_RESULT_20261021.md)
records current checks and blockers. Do not restart all four services from the
older combined-window result alone.
The [matching admission and price check](reports/current-owner-beta-admission-2026-10-20/MATCHING_ADMISSION_AND_PRICE_20261021.md)
then completed one matching call and one price refresh, separately, without HTTP
refusal. Both stopped with exact payer accounting and no pending transaction.
Matching now qualifies the fixed candidate once and keeps fresh mutable-state
checks. The [price read repair](reports/current-owner-beta-admission-2026-10-20/PRICE_CADENCE_REPAIR_20261021.md)
then completed 12 refreshes and six daily records at 2 RPC/s, with exact payer
accounting, no HTTP refusal and no pending action. However, the refresh-only round
took about 155 seconds: at its final publication the first pair was already 130
seconds old. Continuous six-pair freshness still fails the 120-second validity
rule. The [22 October publication repair](reports/current-owner-beta-admission-2026-10-20/PRICE_PUBLICATION_REPAIR_20261022.md)
then completed the same 18 actions at 2 RPC/s: 992 requests, all HTTP200, exact
payer accounting and no pending action. The refresh-only phase fell to 124.865
seconds, but still exceeds 120 without headroom. Daily-record work adds further
delay. All six timestamps were within 120 seconds at the final publication; continuous freshness is not
yet proved. Do not widen validity or restart combined traffic from these results.

The [normal repaired-source price window](reports/current-owner-beta-admission-2026-10-20/PRICE_ACTION_READS_NATIVE_20261022.md)
then completed 12 refreshes: 644 HTTP200 requests, exact payer accounting and no
pending transaction. Same-pair revisits were126 seconds. Stale references still
expire at120 seconds and cannot supply estimates; exact Quote/Accept protection
does not depend on the public marker. A whole six-pair/chart cycle below120seconds
is a quality target, not an extra transaction or beta-entry rule. The next step
is one bounded current combined-service window, with known stale-price intervals
reported. Do not infer continuous capacity from individual service results.

These commands use the existing bounded local operators, not an installed daemon.
For the combined paced check, `scripts/current-dex-services.cjs --once` starts
each existing `--once` entry in a separate process. From the workspace root, use
the existing capture command with a fresh report directory:

```powershell
node scripts/run-local-check.mjs APP/reports/service-group-new -- node APP/scripts/current-dex-services.cjs --once APP/reports/service-group-new
```

Use a new directory for each authorized window; an existing `group.json` stops
startup. The group requests a graceful stop on its first failed member, Ctrl+C,
parent disconnect or the 15-minute new-work deadline. Active calls still use
their existing confirmation and recovery rules. It does not kill children,
restart them, resend transactions, change spend caps or use the App wallet.
`group.json` and each service's output remain in the capture directory. A
completed check is one finite window, not a running service session for App use.
The [22 October combined result](reports/current-owner-beta-admission-2026-10-20/COMBINED_SERVICE_RESULT_20261022.md)
stopped safely at matching's final-head check, with819 HTTP200 requests and one
accounted price publication. Its signed, unbroadcast matching hash was retired
without a send. That window ended with services stopped; it did not permit an
App readiness claim or an automatic restart.

The later [matching repair and combined result](reports/current-owner-beta-admission-2026-10-20/MATCHING_ACCOUNT_READ_NATIVE_20261022.json)
completed all four entries:2170 HTTP200 requests,12 price refreshes, one matching
call and two idle C1 ticks. Exact fees were0.018978395 Test COTI, with no pending
send. Matching now reads payer balance, nonce and empty-code hash together at the
same canonical block; all scheduler guards remain unchanged.

For normal App operation, the same group command accepts `--start` in place of
`--once`. It starts each existing normal service entry and retains their spend,
call and recovery limits. The group uses their30-minute operating window;
`--once` retains its15-minute deadline. Use a fresh report directory. Check actual
process liveness and keeper discovery catch-up before declaring owner readiness.
The current operating record is
`reports/current-owner-beta-admission-2026-10-20/NORMAL_SERVICE_STATUS_20261022.json`.
It includes the fresh matching window opened after the first12-call normal
window completed cleanly. Earlier attempts and fees stay recorded.
This service window does not add a transaction quota or amount cap to normal
owner App use. Sustained production operation remains a separate gate.

For one price session, use `npm run once:prices`. The normal price window lasts
at most 30 minutes; when publication stops, the App correctly marks observations
older than 120 seconds as stale. Keep prices running during the beta trial.
An offline check proves only the local binding. It does not prove current RPC,
funding, transaction fit, service liveness or private delivery. C1 capital remains
separate; its completed qualification returned the case capital and left no
daemon running. Starting an operator does not fund its capital account.
The [current capital guide](reports/current-beta-fixture-2026-10-19/C1_CAPITAL_OPERATING.md)
records the later checked funding/exit interface and the separate service-capital
case. Read its current result before treating an operator as funded.

Stop the foreground service with Ctrl+C and wait for its terminal result. If a
send or confirmation is uncertain, use that service's reconcile command before
any restart. Never resend, delete its journal, raise its caps or reopen a closed
trial to clear uncertainty. `status:matching` and `status:c1` inspect saved state;
saved state alone is not proof that a process is running. `stop:prices` closes a
prepared price session; stop a running foreground price window with Ctrl+C first.
Do not restart a service solely because an observation timed out.

The C1 runner handles Ctrl+C/SIGTERM at its discovery and action boundaries. It
finishes a current admitted tick before exit and retains any unresolved hash/job
for reconciliation. Do not use another C1 start to clear that work. On renewal,
discovery skips only the canonical block prefix before the new public session
start; current-session blocks keep the normal bounded scan. Wallet History is
unchanged. A source update still needs the existing expired-unused-window
renewal rule; a passed local check does not adopt a new financial source.

The17October combined window and scoped restart repair are recorded in
[the current service checkpoint](reports/current-combined-service-2026-10-17/HANDOFF.md).
Keep its completed price/matching results; do not repeat them to adopt C1.

In the App, use **Get test tokens** for BCN, HBR, EMBR and ORBT; native Test COTI
is gas only. **Trade** provides Fast and Multi-source asynchronous modes and
editable slippage. **Your Positions**, **My orders** and **History** use the
selected wallet. For an existing pending action, open its status and recovery;
do not create another Quote to recover it. Use the supported position exit or
order close/claim controls to return funds. Missing private proof stays pending
or unavailable; public confirmation alone does not prove payment.

Operator limits and current producer evidence:
[keeper/App](reports/current-dex-keeper-integration-2026-10-14/HANDOFF.md),
[prices](reports/current-price-service-window-2026-10-15/HANDOFF.md),
[matching](reports/current-matching-service-integration-2026-10-15/HANDOFF.md),
[C1](reports/current-c1-service-integration-2026-10-15/OPERATING.md),
[funding](reports/current-four-token-funding-2026-10-15/HANDOFF.md),
[Pool controls](reports/current-pool-app-integration-2026-10-15/HANDOFF.md),
[Limit controls](reports/current-limit-app-integration-2026-10-15/HANDOFF.md) and
[History](reports/current-private-activity-integration-2026-10-15/HANDOFF.md).
Keep final App acceptance and production gates in Backlog; these instructions do
not release a wallet hold or authorize Mainnet or real assets.

Knip 6.41.0 is a local development tool. Its configuration covers the browser,
API worker, Edge Function and test entry points. Build output, archives and
retained reports are excluded from findings; imported files can still be read
to resolve dependencies. Node analysis cannot fully resolve Deno
URL imports or dynamic loading, so review findings against the source and its
consumers before removing anything. The report commands return zero when findings
exist; configuration or tool errors still fail. They are not build or release gates.
Use `npm ci` to reproduce the lockfile. When updating Knip, use
`npm install --save-dev --save-exact knip@<version> --install-strategy=nested`
and check the lockfile for unrelated dependency changes.

Before finishing changes, run:

```bash
npm run lint
npm run test
npm run build
npm run test:browser
npm run verify:privacy-contracts
```

### Authorized mainnet smoke checklist

Do not run funded mainnet conversions as part of automated release checks. With explicit authorization and deliberately small amounts, verify each item below with the connected MetaMask or CipherTrade wallet:

1. Native round trip: COTI to p.COTI, then p.COTI back to COTI. Confirm the amount-specific fee, reserved gas on Max, both wallet confirmations, final receipt, explorer link, and refreshed public/private balances.
2. ERC-20 round trip: choose one of WETH, WBTC, USDT, USDC.e, WADA, or gCOTI; convert public to private and back. Confirm exact approval behavior, the fresh post-approval quote, unchanged token output, native COTI fee, final receipt, explorer link, and refreshed balances.
3. Account isolation: before each round trip, confirm the selected address and private-balance unlock state. Switch wallets/accounts only after the sequence is complete and verify the other address's form, quote, and balances are independent.
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
- `TRADE_AGENT_RATE_LIMIT_SECRET` (optional separate 32-byte-or-longer HMAC secret; falls back to `APP_HELP_RATE_LIMIT_SECRET`)
- `TRADE_AGENT_QUOTE_SECRET` (a separate high-entropy secret of at least 32 characters used only to authenticate paid-agent quotes)
- `APP_HELP_MODEL` (optional, defaults to `gpt-5-nano`)
- `OPENAI_MODEL` (optional paid-agent override, defaults to `gpt-5-mini`)

`supabase/migrations/20260713103016_app_help_rate_limits.sql` creates an RLS-protected counter table and a service-role-only, atomic `claim_app_help_request` function. AI-assisted help is capped at 10 calls per HMAC-hashed IP per UTC day and 1,000 calls globally per UTC day. Rate-limit errors fail closed before OpenAI; curated local answers remain available.

`supabase/migrations/20260809090955_secure_trade_agent_work_limits.sql` adds service-role-only, atomic hourly admission counters and fenced paid-request claims. Project-wide counters are the cost-control boundary even if per-IP attribution is unavailable; per-IP fairness requires the managed ingress or self-hosted gateway to append or overwrite the final `x-forwarded-for` hop. Paid provider attempts are capped at three and transition to a terminal state after exhaustion.

Deployment outline:

1. Apply the App Help rate-limit, additive Trade Agent payment-v2, and `20260809090955_secure_trade_agent_work_limits.sql` migrations before deploying the updated function.
2. Set the Edge Function secrets above.
3. Deploy `supabase/functions/trade-agent` with JWT verification disabled as configured in `supabase/config.toml`. This strict v2 function rejects legacy paid clients before they can receive a final fee quote.
4. Deploy the matching frontend, then audit legacy `pending` or `failed` rows for manual resolution.

## V2 chat deployments

Direct Chat V2, Group Chat V2, and ChatReactionsV1 are fail-closed feature deployments. The frontend activates each only when its exact address, deployment block, and runtime hash are configured. ChatReactionsV1 additionally attests both immutable chat targets and inherits the stricter finalized-block lag. It scans only provider-owned bounded ranges, rebuilds after a checkpoint reorg, and never falls back to an encrypted legacy reaction memo. Reactions are public desired-state transactions; replies remain inside the encrypted Direct/Group V2 payload and reference stable finalized message IDs.

For the complete current COTI testnet suite, use `npm run dev:testnet-suite` or `npm run build:testnet-suite`. Each command first runs the Contracts repository's read-only 15-component network attestation and refuses to generate a manifest until all 16 owner token admissions are canonical. It then generates the inactive MCP runtime catalog from that exact manifest and only afterward replaces the ignored APP mode file. A failed Contracts or MCP gate therefore leaves the APP on its previous configuration and sends no transaction. The APP verifies the manifest hash and derives Direct Chat V2, Group Chat V2, reactions, all five OTC V2 protocols, the Private Liquidity V2 graph, and four dedicated test tokens atomically. Component-specific variables remain focused-test/legacy fallbacks. Retired executor/profile prototypes are excluded from this browser-wallet-only release manifest.

Every full suite refresh now finishes with `npm run verify:testnet-compatibility`. It regenerates `docs/COTI_TESTNET_RELEASE_COMPATIBILITY.md` only after proving that the Contracts candidate, APP projection, Worker/API manifest boundary, MCP runtime catalog, compiled Direct/Group chat selectors and event topics, and local Supabase RLS migration remain compatible. The report deliberately labels remote Worker/Supabase configuration and wallet journeys as unverified; a local matrix is not deployment evidence.

Before checkpointing or auditing accumulated work, run `npm run evidence:workspace`. It regenerates `docs/WORKSPACE_CURRENT_STATE.md` as a deterministic, content-free inventory of the APP, Contracts, and MCP repository identities, upstream divergence, dirty-path counts, diff statistics, lockfile hashes, and mechanically classified changed paths. The command uses per-process Git safe-directory bindings, does not modify global Git configuration, excludes its own output from the evidence identity, and replaces environment/key-like paths with deterministic redacted identifiers. This inventory proves worktree scope only; it does not replace test, review, deployment, or release evidence.

Then run `npm run classify:workspace` to bind `docs/WORKSPACE_CHANGE_CLASSIFICATION.md` to that exact evidence ID and assign every dirty path a provisional Keep, Extract, Redesign, Legacy-only, or Shelve disposition. The classifier preserves accepted deletions, isolates deployment/runtime provenance from source, calls out mixed architecture hotspots, confines explicit V1 paths to compatibility, and excludes superseded/local artifacts from release authority. Its output is deliberately non-destructive and unapproved: review or override the generated groups before staging or committing anything.

`npm run dev:testnet-candidate` and `npm run build:testnet-candidate` are offline/replay commands: they consume the already-generated manifest without claiming that it is the latest network candidate. `npm run refresh:testnet-candidate` refreshes Contracts plus the APP only. Prefer the `testnet-suite` commands before integrated testnet QA so the APP and MCP cannot start from different candidate identities. The public API intentionally remains inactive until the same manifest has passed the contract and multi-wallet journeys; then install its exact compact JSON as the Worker value `CHAINWHISPER_TESTNET_CANDIDATE_MANIFEST_JSON` and deploy in the separate API release step.

`npm run smoke:testnet-suite:readonly` is the post-generation machine gate. It
first runs the same fail-closed Contracts → MCP → APP refresh, then starts the
packaged keyless MCP planner and runs the production API source directly against
the credential-free COTI testnet RPC. Both layers must return the same manifest
hash, Book address, complete public position routes, and amount-free privacy
boundary. The gate rejects write tools and write RPC methods; it never deploys,
submits a transaction, or configures the Worker. Use it only after the owner
admission page reports 16/16, because a stale manifest is not release evidence.

The current deployed testnet candidate requires 16 one-time owner token-policy admissions before that unified manifest can be generated. Run `npm run dev:testnet-admission` (or use the normal Vite server and open `/testnet-token-admission.html`). This local setup page pins the exact reviewed owner, six target runtime hashes, four token runtime hashes, contract versions, private-only token policy, and all 16 selectors. It accepts an injected MetaMask/CipherTrade provider or an isolated CipherTrade Mobile WalletConnect session pinned directly to COTI Testnet. All inspection runs through the public COTI RPC, and the selected wallet submits only the single operation displayed as `Next`; the tool never requests a private key, batches transactions, or automatically proceeds to another operation. Refreshing the page reconstructs progress from canonical chain state. The official GitHub Pages build supplies ChainWhisper's public WalletConnect project ID; local/forked deployments must set `VITE_WALLETCONNECT_PROJECT_ID` for their own reviewed origins or the mobile QR option fails closed.

After candidate mode activates, OTC Desk replaces the mainnet trading catalog with `cwTUB`, `cwTUQ`, `cwTPB`, and `cwTPQ`. The four contracts are loaded from the attested manifest, not hard-coded UI addresses. A resumable faucet panel verifies each exact runtime and metadata, shows per-wallet claim state, and submits one value-zero MetaMask `claimFaucet()` transaction at a time. Public balances load normally; private balances require the wallet's COTI privacy session. The panel disappears once all four one-time claims are canonical, while the tokens remain available in Trade, Swap, Recurring, Private Liquidity, balances, and account-funds selectors.

## Private Liquidity V2 hidden intents

The Private Liquidity workspace uses the unified candidate's exact BookV2 deployment for Position NFTs and hidden recurring intents. Creating an intent packs the private side and rational limit into one COTI input and the maximum budget and minimum fill into a second; the visible scheduling fields are pair, cooldown, and expiry. After the one-time token allowance, creation is one MetaMask transaction.

The **Hidden intents** tab does not publish or index private terms. The connected owner explicitly unlocks COTI privacy to reveal their side, exact limit ratio, remaining budget, minimum fill, last execution amounts, fill count, cooldown, and expiry from recipient-bound owner receipts at one canonical block. Open intents can be cancelled and refunded with one ordinary transaction; expired open intents can be reclaimed with one ordinary transaction. Public market/depth/API readers receive only the amount-free public state.

The same tab can process the next bounded queue entries for a pair. It derives both price-ordered routes from the complete finalized Position NFT snapshot, checks that the pair has open intents, and submits one value-zero MetaMask transaction with no COTI private inputs. The request cannot name an intent or supply a private amount/price; the contract selects up to four queue entries and privately determines execution. Automated keeper scheduling, monitoring, and live real-COTI execution remain release gates until the keeper and adversarial privacy work is complete.

## Direct Trade V2 chat cards

Direct Trade V2 is a separate fail-closed deployment. Its finalized `DirectTradeOpened` and `DirectTradeStatusChanged` escrow events are projected into the existing DM trade-card timeline, so create, counter, accept, decline, cancel, expiry, supersede, and replace do not require a second parsed chat-message transaction. Legacy parsed trade messages remain readable during migration. The canonical projection is participant-filtered, block-hash checkpointed, overlap-replayed, and stored together with the trade-history materialization state so a reorg cannot leave a stale card behind. The live feature path is bound to the exact selected MetaMask/CipherTrade browser-wallet lease, attests the configured runtime before reading or writing, performs a one-time token/escrow allowance when required, and never retries through a local signer or legacy memo writer.

Public card terms are hydrated from the verified V2 contract. Private cards remain amount-hidden during background rendering and request the participant's COTI privacy capability only when the user explicitly needs to reveal or act on them. Initial history synchronization establishes a silent notification baseline; later finalized incoming offers, counters, and status changes update the existing unread/sound path without a wallet prompt.

See `.env.example` for the exact `VITE_CHAINWHISPER_DIRECT_TRADE_V2_*` manifest. Keep it disabled until the matching contract runtime, deployment block, owner/token policy, participant-private term reads, and Alice/Bob/Mallory testnet flow have all been independently reviewed.

## Supabase Image Storage

Temporary encrypted image messaging uses Supabase assets included in this repo:

- `supabase/migrations/20260420205439_chat_image_storage.sql` creates the `chat-images` bucket and the original cleanup schedule.
- `supabase/migrations/20260703232902_chat_image_confirmed_uploads.sql` adds service-role-only upload tracking and removes direct anonymous Storage inserts.
- `supabase/migrations/20260809113000_secure_chat_image_work.sql` adds upload/confirmation binding fields, atomic hourly client/wallet/project admission counters, cleanup indexes, a single-flight cleanup lease, a 500-object cleanup batch cap, and an authenticated cleanup schedule.
- `supabase/migrations/20260810164029_chat_image_wallet_sessions.sql` adds protocol-versioned Direct/Group Chat V2 rows and short-lived wallet-session authorization.
- `supabase/migrations/20261023114314_tighten_service_boundaries.sql` removes surplus default grants from the App Help rate-limit table and the legacy image-confirmation trigger. Apply it after the existing App Help and image migrations; the original migrations remain unchanged.
- `supabase/functions/chat-image-session`, `supabase/functions/chat-image-upload`, and `supabase/functions/chat-image-confirm` are the only supported authorization, write, and confirmation paths. `supabase/functions/chat-image-cleanup` removes pending objects after approximately 30 minutes and confirmed or orphaned objects after approximately 24 hours.

The bucket is public for reads because blobs are encrypted client-side before upload. Decryption material is delivered through the encrypted chat message payload, not through Supabase.

Direct and Group Chat V2 ask for one wallet signature on the first encrypted-image upload in a session, then reuse one wallet-, chain-, and Supabase-scoped bearer token from memory for up to 15 minutes. Each image still receives a fresh client-side AES key and is confirmed by its ordinary V2 message transaction. Reloading the app or changing wallet, chain, or verified chat deployment discards the upload session; neither the bearer token nor image keys are persisted.

Production Edge Function secrets:

- `COTI_RPC_URL` (the JSON-RPC endpoint for the exact configured COTI deployment, used to verify image-message receipts and conversation targets)
- `CHAT_IMAGE_CHAIN_ID_HEX` (canonical hexadecimal chain ID; defaults to COTI mainnet `0x282b34`; use COTI testnet `0x6c11a0` for the testnet stack)
- `DIRECT_CHAT_V2_ADDRESS` (the exact Direct Chat V2 deployment on `CHAT_IMAGE_CHAIN_ID_HEX`)
- `GROUP_CHAT_V2_ADDRESS` (the exact Group Chat V2 deployment on `CHAT_IMAGE_CHAIN_ID_HEX`)
- `CHAT_IMAGE_RATE_LIMIT_SECRET` (an independent random secret of at least 32 characters used only to HMAC client identities)
- `CHAT_IMAGE_SESSION_SECRET` (an independent random 32-byte secret encoded as exactly 64 hexadecimal characters, used only to authenticate short-lived upload sessions)
- `CHAT_IMAGE_CLEANUP_SECRET` (an independent random secret of at least 32 characters used only to authenticate the scheduled cleanup request)

Store the exact `CHAT_IMAGE_CLEANUP_SECRET` value in Supabase Vault under the name `chat_image_cleanup_secret` as well. The cron command reads that Vault entry at execution time; the secret value is not embedded in migration or cron source.

Deployment outline:

1. Generate the three independent Edge secrets above, configure the exact chain and Direct/Group Chat V2 addresses, and add the cleanup secret's duplicate Vault entry.
2. Deploy all four hardened Edge functions: `supabase/functions/chat-image-session`, `supabase/functions/chat-image-upload`, `supabase/functions/chat-image-confirm`, and `supabase/functions/chat-image-cleanup`. Before the required migrations exist, each function fails closed on its missing service-role-only admission or cleanup-claim RPC.
3. Apply all image migrations in chronological order through `20260810164029_chat_image_wallet_sessions.sql` (normally with the standard migration workflow). Do not deploy only the original storage migration: its temporary anonymous-insert policy is intentionally removed by the later migration. Do not apply the hardening migration first while the original unauthenticated cleanup function remains deployed. Existing unsigned rows remain authorization version 0/protocol version 1; per-upload signatures use authorization version 1, and Direct/Group Chat V2 wallet sessions use authorization version 2/protocol version 2.
4. Apply `20261023114314_tighten_service_boundaries.sql` after its existing App Help and image prerequisites. Then deploy the matching frontend with `VITE_SUPABASE_PROJECT_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` configured only after the Edge functions and migrations are ready.
5. Verify the `chat-image-cleanup-every-15-min` cron job receives a successful response. A missing Vault secret intentionally leaves cleanup unauthorized rather than exposing a public service-role operation.

## GitHub Pages

The app is configured for a custom-domain GitHub Pages deployment from the repository root (`base: '/'`). The deploy workflow preserves `CNAME` and writes `dist/.nojekyll`.

CI runs on pull requests and main branch pushes:

```bash
npm run lint
npm run test
npm run build
```

Use `npm run test:browser` locally for browser smoke coverage before shipping UI-sensitive changes.
