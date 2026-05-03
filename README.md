# ChainWhisper

ChainWhisper is a browser-based COTI Mainnet app suite for private coordination. It combines a home launcher, encrypted chat, P2P escrow trading, Whisper Shield token swaps, and Treasury Data analytics in one Vite + React + TypeScript project.

The app uses `@coti-io/coti-ethers`, `viem`, Recharts, Zustand, TanStack Virtual, and Supabase Storage for temporary encrypted chat image blobs.

This is a documentation-only description of the current app. Runtime routes, contract calls, schemas, and public interfaces are owned by the source files listed below.

## Routes And Apps

Current route behavior is intentional and should stay as-is unless a future change explicitly updates `src/shell/routing.ts` and its tests.

- `/` - canonical Home launcher. `/home` is accepted as an alias.
- `/chat` - ChainWhisper Chat. `/messages` and `/messenger` are accepted aliases.
- `/trades` and `/trades/...` - P2P trading workspace and deep trade routes.
- `/shield` - canonical Whisper Shield swap page. `/swap` and `/whisper-shield` are accepted aliases.
- `/treasury` - Treasury Data. `/treasury-data` is accepted as an alias.

### Home (`/`)

The home page launches the app suite and routes in-place to Chat, P2P Trades, Whisper Shield, and Treasury Data so the wallet session can remain available across pages.

Home does not show wallet controls because it is a launcher rather than an interactive contract page.

### ChainWhisper Chat (`/chat`)

The chat app is a wallet-native encrypted messenger for COTI.

- Direct wallet-to-wallet encrypted messages.
- Group chat with on-chain group creation, invites, join codes, member removal, admin handoff, rename, leave, and disband flows.
- Client-side AES onboarding through `@coti-io/coti-ethers`.
- App wallet, MetaMask, and CipherTrade wallet sessions.
- Contact aliases, hidden and muted conversations, replies, emoji reactions, read-state backup, notification sound, and wallet-to-wallet tips.
- Encrypted image attachments uploaded to Supabase Storage and cleaned up after 24 hours.
- Inline P2P trade offers inside private chats using the shared trade composer and escrow action logic.
- Contacts are the first chat workspace on desktop and mobile; wallet actions live in the top header wallet menu.

### P2P Trades (`/trades`)

The standalone P2P app is a trading workspace backed by COTI escrow contracts.

- Public trade directory with search and refresh.
- Create public, private-link, direct-recipient, and counter trades.
- Normal trades use the standard escrow contract and support public, private-link, direct, counter, partial fill, cancel, decline, and edit-by-replace flows.
- Private liquidity trades use the private fixed-price escrow contract, require private tokens on both sides, and hide liquidity and fill amounts while showing price ratio, direction, expiry, and access type.
- Makers can reveal their own private liquidity and fill progress from My Trades after AES is available.
- Private liquidity offers are not auto-posted into chat, but copied share links can be pasted into conversations.
- Open compact trade links, full URLs, legacy trade IDs, or redirected GitHub Pages links.
- A completed counter trade cancels the parent/initial trade automatically.
- My Trades groups received offers, active offers, and history.
- The top-header wallet control prioritizes MetaMask and CipherTrade, excludes Brave Wallet from the trading wallet list, and still exposes app wallet options.

### Whisper Shield (`/shield`)

Whisper Shield is a compact reward-token swap page.

- Swaps reward tokens into private token form and back through the reward swap vault.
- Uses the app-wallet-focused header wallet behavior shared with chat.
- Keeps top-up, app wallet backup, PIN change, import, generate, and disconnect actions in the wallet menu.

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
- `src/App.tsx` owns the app shell, shared chat wallet state, top-level page composition, and lazy loading of page apps.
- `src/lib/appShared.ts` re-exports shared COTI constants, provider loading, wallet helpers, memo encoding, parsers, formatters, and common types from `src/lib/appShared/`.
- `src/hooks/useWalletOnboarding.ts` manages browser wallet connection, COTI network switching, and AES onboarding for the main app wallet context.
- `src/hooks/useBurnerWallet.ts` manages the PIN-protected local app-wallet vault.
- `src/components/WalletHeaderPanel.tsx` is the shared compact header wallet surface.
- `src/components/TradeComposerPanel.tsx` is the shared trade creation/editing surface.
- `src/components/TradeOfferCard.tsx` renders trade links and in-chat trade cards.
- `src/lib/tradeComposer.ts` derives trade composer state, validation, labels, balances, fees, and private-liquidity availability.
- `src/lib/tradeActions.ts` submits escrow create, accept, fill, decline, cancel, edit, and counter-close transactions.
- `src/lib/tradeLinks.ts` encodes and decodes compact trade links.
- `src/lib/tradePerspective.ts` resolves maker/taker/open-trade perspective, buy/sell order semantics, ratio labels, and My Trades grouping.
- `src/lib/appChain.ts` reads trade snapshots from both escrow contracts and normalizes private-token metadata.
- `src/lib/treasuryData.ts` normalizes live, feed, explorer, and on-chain Treasury Data sources.
- `src/lib/imagePull.ts` encrypts and decrypts image attachments before Supabase upload/read.

See `AGENTS.md` for future-maintenance rules and `APP_IMPROVEMENTS.md` for proposed follow-up work found during the app review.

## Network And Contracts

- Network: COTI Mainnet, chain ID `2632500`, hex `0x282b34`.
- Direct chat contract: `0xF4cab1599aafBBB68677682354B7c1760bCF6c48`.
- Group chat contract: `0xE175ec590CE13FB6349f1CAd8b7e9D5d21eaa32b`.
- Standard trade escrow contract: `0x7Ff60527677156a4c20419Ec862355A6137F8D47`.
- Private liquidity trade escrow contract: `0xaaf6E676e46bF60eC04769E26EAaAde81D2f4410`.
- Reward token: `0xb70c55bd0823436F44877DC6A9f46E0C55f2C3A8`.
- Private reward token: `0x922B39AC9FD4ccb5E5a9de0694C8189DC2D214E8`.
- Verified private ecosystem token: `0xefe07cbd73538b2f7b3dd8cbc3a435fd4ee16213`.
- Reward swap vault: `0x5C35CD3659991051F4Fb04F2C4120643739b7BdE`.
- Treasury snapshot store default: `0x25975eda0B0Ef3E5D86787Cb89D0A3468C17Bece`.

## Data And Storage

- On-chain: encrypted direct messages, encrypted group messages, group membership/invite/join-code state, nickname records, read-state backup memos, standard P2P escrow trades, private fixed-price liquidity trades, token fees, and Treasury snapshot history.
- Browser storage: UI state, cached decrypted timelines, unread maps, notification preference, wallet preference, known trade access secrets, known maker-side private liquidity, selected wallet IDs, and encrypted app-wallet vaults.
- Supabase Storage and Edge Functions: encrypted chat image blobs in the `chat-images` bucket plus scheduled cleanup.

Sensitive local data should stay minimized. Private trade access secrets and maker-side liquidity records are convenience caches and should not be treated as public app state.

## Local Development

```bash
npm install
npm run dev
```

Other scripts:

- `npm run lint` - run ESLint.
- `npm run test` - run Vitest tests.
- `npm run build` - type-check and produce a production build.
- `npm run preview` - preview the built app.

Before finishing changes, run:

```bash
npm run lint
npm run test
npm run build
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

## GitHub Pages

The app is configured for a custom-domain GitHub Pages deployment from the repository root (`base: '/'`). The deploy workflow preserves `CNAME` and writes `dist/.nojekyll`.

CI runs on pull requests and main branch pushes:

```bash
npm run lint
npm run test
npm run build
```
