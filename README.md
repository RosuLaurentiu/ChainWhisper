# ChainWhisper

ChainWhisper is a browser-based COTI Mainnet app hub for private coordination. It combines a Home launcher, encrypted wallet chat, a P2P OTC escrow trading desk, Whisper Shield private-token swaps, and Treasury Data analytics in one Vite + React + TypeScript project.

The app uses `@coti-io/coti-ethers`, `viem`, Recharts, Zustand, TanStack Virtual, and Supabase Storage for temporary encrypted chat image blobs.

This is a documentation-only description of the current app. Runtime routes, contract calls, schemas, and public interfaces are owned by the source files listed below.

## Routes And Apps

Current route behavior is intentional and should stay as-is unless a future change explicitly updates `src/shell/routing.ts` and its tests.

- `/` - canonical Home launcher. `/home` is accepted as an alias.
- `/chat` - ChainWhisper Chat. `/messages` and `/messenger` are accepted aliases.
- `/trades` and `/trades/...` - P2P OTC trading workspace and deep trade routes.
- `/shield` - canonical Whisper Shield swap page. `/swap` and `/whisper-shield` are accepted aliases.
- `/treasury` - Treasury Data. `/treasury-data` is accepted as an alias.

### Home (`/`)

The home page launches the app suite and routes in-place to Chat, P2P Trades, Whisper Shield, and Treasury Data so the wallet session can remain available across pages.

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
- Inline P2P trade offers inside private chats using the shared trade composer and escrow action logic.
- Linked trade context from terminal-to-chat navigation, compact trade references in sent messages, and Open Terminal actions from chat trade cards/links.
- Contacts are the first chat workspace on desktop and mobile; wallet actions live in the top header wallet menu.

### P2P Trades (`/trades`)

The standalone P2P app is an OTC-style escrow desk backed by COTI contracts.

- Desk view for active public offers with search, filters, refresh, trade terminal, and wallet balance context.
- Create `Limit buy/sell` orders and `Recurring` reusable OTC orders from the Create window, with Public, Unlisted, Direct, counter, `Private liquidity`, `Visible amounts`, and hybrid private-token flows.
- Normal trades use the Trading V1 OTC escrow and reader contracts and support public, private-link, direct, counter, partial fill, cancel, decline, permanent/no-expiry, edit-by-replace, and visible private-token amount flows.
- Private tokens are not automatically hidden. When `Visible amounts` is selected, private-token order size, fills, and remaining amounts are public and route through the normal OTC contract.
- Hidden-amount private orders use the Trading V1 private-orders contract. Fully private orders use private tokens on both sides; hybrid private orders offer a private token while the taker pays with public/native assets.
- Hidden-amount private orders and private recurring orders use a user-scoped private ledger for maker live liquidity snapshots and participant fill receipts.
- Owner recovery uses the COTI MetaMask Snap for owner privacy where available. ChainWhisper account privacy remains wallet-scoped so owner and ChainWhisper AES state stay separate.
- Hidden-amount public/detail views hide private amounts and fill amounts while showing price ratio, direction, expiry, and access type.
- Makers can reveal their own private-order progress and recurring live liquidity from My Trades after AES is available. Fillers can reveal their own private fill history, including partial fills on open orders. Standard private-liquidity cards and terminal views show two-sided progress when private fill receipts reveal both values.
- Unlisted orders are not auto-posted into chat, but copied share links can be pasted into conversations.
- Recurring orders are reusable two-sided OTC liquidity, not timed/cadence orders: buy fills add base inventory to the sell side, and sell fills add quote inventory to the buy side. Makers can edit prices, per-side amounts, and add/remove live liquidity without changing the order link; closing the order returns remaining inventory.
- Open compact trade links, full URLs, legacy trade IDs, or redirected GitHub Pages links.
- A completed counter trade cancels the parent/initial trade automatically.
- My Trades groups received offers, active offers, and history.
- The shared top-header wallet control uses the ChainWhisper account for new trade actions by default. Owner-wallet fallback is reserved for funding/recovery and existing owner-targeted actions where the contract requires the owner address.
- The trading UI can show combined owner + ChainWhisper balances, move missing funds before important trade actions, preserve a small COTI fee reserve, and confirm maker actions with app-styled modals.

### Whisper Shield (`/shield`)

Whisper Shield is a compact reward-token swap page.

- Swaps reward tokens into private token form and back through the reward swap vault.
- Uses the same owner-first ChainWhisper account header as Chat and OTC Desk.
- Keeps account setup, recovery, backup, move/withdraw funds, and advanced owner-wallet fallback actions in the wallet menu.

### Treasury Data (`/treasury`)

Treasury Data is a read-only analytics dashboard for COTI treasury metrics.

- Loads live treasury totals from the Treasury API.
- Loads historical snapshots from `public/snapshots.json`, optional API history sources, and on-chain snapshot sources.
- Reads the snapshot store contract and explorer transaction history.
- Displays timeframe filters, metric switching, chart tooltips, saved snapshot counts, live values, and on-chain references.
- Does not require wallet interaction.

## Shared Logic

App pages should remain visually distinct where workflow density requires it, but shared behavior should live in shared modules.

- `src/shell/routing.ts` owns top-level route parsing, canonical paths, aliases, and browser location sync.
- `src/App.tsx` owns the app shell, shared wallet/account state, top-level page composition, and lazy loading of page apps. In-chat trade actions, group admin actions, account funding, and focused group message sync live in extracted hooks/helpers where practical.
- `src/lib/appShared.ts` re-exports shared COTI constants, provider loading, wallet helpers, memo encoding, parsers, formatters, and common types from `src/lib/appShared/`.
- `src/hooks/useWalletOnboarding.ts` manages browser wallet connection, COTI network switching, and owner/privacy onboarding.
- `src/hooks/useBurnerWallet.ts` manages the ChainWhisper account vault, owner-linked recovery, local PIN fallback, and account switching.
- `src/hooks/useInChatTradeActions.ts` owns DM trade create, accept, decline, cancel, and counter preparation orchestration.
- `src/hooks/useGroupAdminActions.ts` owns group create, invite, join-code, join-by-code, remove, rename, leave, handoff, disband, and invite accept/decline actions.
- `src/lib/groupMessageSync.ts` handles active-group message/member-event sync merging.
- `src/lib/directConversationSyncHelpers.ts` contains direct-message merge, unread, nickname/contact, and optimistic reconciliation helpers.
- `src/components/WalletHeaderPanel.tsx` is the shared compact header wallet surface.
- `src/components/TradeComposerPanel.tsx` is the shared trade creation/editing surface.
- `src/components/TradeOfferCard.tsx` renders trade links and in-chat trade cards.
- `src/lib/tradeComposer.ts` derives trade composer state, validation, labels, balances, fees, and private-order availability.
- `src/lib/tradeActions.ts` submits OTC, private-order, and recurring-order create/fill/control transactions.
- `src/lib/tradeLinks.ts` encodes and decodes compact trade links.
- `src/lib/tradePerspective.ts` resolves maker/taker/open-trade perspective, buy/sell order semantics, ratio labels, and My Trades grouping.
- `src/lib/p2pTradeView.ts` contains P2P display helpers, search/filter helpers, snapshot keys, explorer links, local trade access-secret cache helpers, and maker private-progress labels.
- `src/lib/tradeHistory.ts` builds wallet-scoped trade history rows, including private fill receipt rows used by My Trades and terminal history.
- `src/lib/cotiSnap.ts` wraps the COTI MetaMask Snap RPC methods used by owner recovery/privacy flows.
- `src/lib/appWalletRecovery.ts`, `src/lib/burnerWalletVault.ts`, `src/lib/walletAccountScope.ts`, and `src/lib/walletFunds.ts` own recovery payloads, local account vaults, owner + ChainWhisper account read scope, and move/withdraw funding helpers.
- `src/lib/appHelpers.ts` contains verified ecosystem token presets, message helpers, and shared user-facing error helpers.
- `src/lib/appChain.ts` reads active Trading V1 trade snapshots, blocks unsupported retired contract links, and normalizes private-token metadata.
- `src/lib/treasuryData.ts` normalizes live, feed, explorer, and on-chain Treasury Data sources.
- `src/lib/imagePull.ts` encrypts and decrypts image attachments before Supabase upload/read.
- `src/hooks/useModalA11y.ts` provides shared modal focus, Escape, and focus-restore behavior.
- `src/styles.css` is the ordered stylesheet import hub. Route/domain CSS lives in `src/styles/`.

See `AGENTS.md` for future-maintenance rules. `APP_IMPROVEMENTS.md` is intentionally cleared and should only contain new active proposals.

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
- WISP Privacy Bridge: `0xbd5392eccAAad850853D3c3654579d4E40E89efc`.
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
- `npm run preview` - preview the built app.

Before finishing changes, run:

```bash
npm run lint
npm run test
npm run build
```

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

## Supabase Image Storage

Temporary encrypted image messaging uses Supabase assets included in this repo:

- `supabase/migrations/20260417130500_chat_image_storage.sql` creates the public `chat-images` bucket, sets the encrypted image size limit, adds the browser upload policy, and schedules cleanup every 15 minutes.
- `supabase/functions/chat-image-cleanup` deletes bucket objects older than 24 hours.

The bucket is public for reads because blobs are encrypted client-side before upload. Decryption material is delivered through the encrypted chat message payload, not through Supabase.

Deployment outline:

1. Apply `supabase/migrations/20260417130500_chat_image_storage.sql`.
2. Deploy `supabase/functions/chat-image-cleanup`.
3. Set `VITE_SUPABASE_PROJECT_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Supabase Carbon Price Proxy

Carbon market price references use `supabase/functions/carbon-explore-pair` in production because the Carbon MCP endpoint is not browser-CORS friendly. GitHub Pages builds with `VITE_ENABLE_DEFAULT_CARBON_PROXY=true`, so the Edge Function must be deployed for deployed pages to show Carbon prices.

Deployment outline:

1. Add `SUPABASE_ACCESS_TOKEN` to GitHub repository secrets.
2. Keep `SUPABASE_PROJECT_ID` unset to use the default project `ousgmjyajyorywpqbdkf`, or set it as a repository variable.
3. Run the `Deploy Supabase Functions` workflow, or push changes under `supabase/functions/**`.

## GitHub Pages

The app is configured for a custom-domain GitHub Pages deployment from the repository root (`base: '/'`). The deploy workflow preserves `CNAME` and writes `dist/.nojekyll`.

CI runs on pull requests and main branch pushes:

```bash
npm run lint
npm run test
npm run build
```

Use `npm run test:browser` locally for browser smoke coverage before shipping UI-sensitive changes.
