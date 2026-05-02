# ChainWhisper

ChainWhisper is a browser-based COTI app suite. It started as an encrypted messaging app and now includes app-like pages for chat, P2P escrow trades, Whisper Shield token swaps, Treasury Data, and the home launcher.

The project is built with Vite, React, TypeScript, `@coti-io/coti-ethers`, `viem`, Recharts, and Supabase Storage for temporary encrypted chat images.

## Current Apps

### Home (`/home`)

The home page is the launcher for the project. It explains the recommended first-run flow and routes in-place to Chat, P2P Trades, Whisper Shield, and Treasury Data so the wallet session is preserved.

The Home page does not expose wallet controls because it is only a launcher.

### ChainWhisper Chat (`/` and `/chat`)

The main app is a wallet-native encrypted messenger for COTI.

- Direct wallet-to-wallet encrypted messages.
- Group chat with on-chain group creation, invites, join codes, member removal, admin leave/handoff, rename, leave, and disband flows.
- Client-side AES onboarding through `@coti-io/coti-ethers`.
- MetaMask, CipherTrade, or local PIN-protected burner wallet sessions.
- Contact aliases, hidden and muted conversations, replies, reactions, read-state backup, notification sound, and wallet-to-wallet tips.
- Encrypted image attachments uploaded to Supabase Storage and cleaned up after 24 hours.
- Inline P2P trade offers inside private chats using the same trade composer and escrow action logic as the standalone trades app.
- Contacts are the first chat workspace on desktop and mobile; wallet actions live in the top header wallet menu.

### P2P Trades (`/trades`)

The standalone P2P app is a separate trading workspace backed by COTI escrow contracts.

- Public trade directory with search and refresh.
- Create public, private-link, direct-recipient, and counter trades.
- Normal trades use the standard escrow contract and support public/private/direct/counter flows.
- Private liquidity trades use the private fixed-price escrow contract, require private tokens on both sides, and keep liquidity and fill amounts private while showing the price ratio.
- Private liquidity orders behave like buy/sell orders at a fixed ratio: the taker enters how much they want to pay, the contract settles the fill privately, and any unspent amount is returned by the contract path.
- Public private liquidity listings show the order direction, price ratio, expiry, and access type, not token amounts.
- Makers can reveal their own private liquidity and fill progress from My Trades after AES is available.
- Private liquidity offers are not auto-posted into chat, but share links can be copied and pasted into a conversation.
- Open compact trade links, full URLs, legacy trade IDs, or redirected GitHub Pages links.
- Accept, fill, decline, cancel, edit by cancel-and-replace, and close counter-trade chains.
- A completed counter trade cancels the parent/initial trade automatically.
- My Trades view groups received offers, active offers, and history.
- Top-header wallet control prioritizes MetaMask and CipherTrade, excludes Brave from the trading wallet list, and still exposes app wallet options.
- Reuses shared trade logic from `src/lib/tradeComposer.ts`, `src/lib/tradeActions.ts`, `src/lib/tradeLinks.ts`, `src/lib/tradePerspective.ts`, and `src/lib/appChain.ts`.

### Whisper Shield (`/swap`)

Whisper Shield is a compact reward-token swap page.

- Swaps reward tokens into private token form and back through the reward swap vault.
- Uses the same app-wallet-focused header wallet control as chat.
- Keeps top-up, app wallet backup, PIN change, import, generate, and disconnect actions in the wallet menu.

### Treasury Data (`/treasury`)

The Treasury Data app is an analytics dashboard for COTI treasury metrics.

- Loads live treasury totals from the Treasury API.
- Loads historical snapshots from `public/snapshots.json`, an optional `VITE_API_BASE_URL`, and on-chain snapshot sources.
- Reads the snapshot store contract and explorer transaction history.
- Displays timeframe filters, metric switching, chart tooltips, saved snapshot counts, live values, and on-chain references.

## Shared Logic

The app pages should remain visually distinct where the workflow needs it, but shared behavior should live in shared modules:

- `src/shell/routing.ts` owns top-level app routing and keeps navigation client-side.
- `src/lib/appShared.ts` re-exports shared COTI constants, provider loading, wallet helpers, memo encoding, parsers, formatters, and common types.
- `src/hooks/useWalletOnboarding.ts` manages browser wallet connection, COTI network switching, and AES onboarding for the main chat app.
- `src/hooks/useBurnerWallet.ts` manages the PIN-protected local burner wallet vault used by the chat app.
- `src/components/WalletHeaderPanel.tsx` is the shared compact header wallet surface. Chat and Whisper Shield prefer app wallets; P2P Trades prefers MetaMask/CipherTrade. Home and Treasury do not show wallet controls.
- `src/components/TradeComposerPanel.tsx` is the shared trade creation/editing surface.
- `src/components/TradeOfferCard.tsx` renders trade links and in-chat trade cards.
- `src/lib/tradeComposer.ts` derives trade composer state, validation, labels, balances, and fee summaries.
- `src/lib/tradeActions.ts` submits escrow create, accept, fill, decline, cancel, edit, and counter-close transactions.
- `src/lib/tradeLinks.ts` encodes and decodes compact trade links.
- `src/lib/tradePerspective.ts` resolves maker/taker/open-trade perspective, buy/sell order semantics, ratio labels, and My Trades grouping.
- `src/lib/appChain.ts` reads trade snapshots from both escrow contracts and normalizes private-token metadata.
- `src/lib/treasuryData.ts` normalizes live, feed, explorer, and on-chain Treasury Data sources.
- `src/lib/imagePull.ts` encrypts/decrypts image attachments before Supabase upload/read.

See `AGENTS.md` for future-maintenance notes and consistency rules.

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

## Data Model

- On-chain: encrypted direct messages, encrypted group messages, group membership/invites/join-code state, nickname records, read-state backup memos, standard P2P escrow trades, private fixed-price private liquidity trades, token fees, and Treasury snapshot history.
- Browser storage: UI state, cached decrypted timelines, unread maps, notification preference, known trade access secrets, known maker-side private liquidity, selected wallet IDs, and encrypted burner wallet vaults.
- Supabase Storage and Edge Functions: encrypted chat image blobs in the `chat-images` bucket, plus scheduled cleanup.

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
