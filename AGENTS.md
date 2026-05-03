# Project Notes For Future App Work

## Product Shape

This repository is a Vite + React + TypeScript project for ChainWhisper, a privacy-first blockchain messenger and trading hub built on COTI Mainnet (chain ID `2632500`). The runtime is an app hub where each page behaves like its own app but shares wallet, network, and trade logic.

Current route behavior is intentional:

- `/` - canonical Home launcher and product overview. `/home` is an alias. No wallet controls shown here.
- `/chat` - main encrypted messaging app for direct chat and group chat. `/messages` and `/messenger` are aliases.
- `/trades` and nested `/trades/...` - standalone P2P escrow trading app with deep trade routes.
- `/shield` - canonical Whisper Shield private-token swap app. `/swap` and `/whisper-shield` are aliases.
- `/treasury` - Treasury Data analytics. `/treasury-data` is an alias. No wallet interaction needed.

## Navigation Rules

- Keep the route map above as-is unless the user explicitly asks to change routing.
- Top-level route ownership lives in `src/shell/routing.ts`; update `src/shell/routing.test.ts` with any route change.
- Launching apps from Home must navigate in-place with client-side routing. Do not open a new browser tab or trigger a full page reload because wallet session state should remain available across apps.
- Keep deep trade routes under `/trades/...` intact when syncing browser location.
- Internal trade links should preserve app context whenever practical. Avoid changes that unexpectedly disconnect wallets or lose known access-secret context.

## Wallet Rules

- Chat app: prioritize the app wallet (generated/saved burner wallet). Connect the saved app wallet first on load; generate one when none is saved. Browser wallets remain available from the header menu.
- P2P Trading app: prioritize MetaMask and CipherTrade by default. Exclude Brave Wallet from the trading wallet list. App wallet options remain in the header menu.
- Whisper Shield: use the app-wallet-focused header wallet behavior shared with chat.
- Shared rule: if a wallet is already connected when navigating between apps, keep it connected. Do not disconnect or re-prompt.
- Home and Treasury are non-interactive pages and must not show wallet controls.
- Keep burner wallet vault behavior consistent between chat, trades, and shield. If wallet behavior changes, prefer extracting a page-neutral wallet session hook over patching one app only.

## Chat App - Feature Summary

### Direct Chat

- Encrypted 1-to-1 messaging via COTI garbled circuits.
- Emoji reactions on messages.
- Replies with a message reference.
- Tips sent inline in chat.
- In-chat trading: a trade offer created inside a DM is a direct trade between the two participants.
- Private liquidity trades should not be auto-posted into chat, but a copied trade link may be pasted and rendered as a link.
- Mute/hide per conversation; state is persisted on-chain as an encrypted hidden message.
- Read/unread state is a single global timestamp (`lastReadAllTs`). Saved on-chain when all messages are read. Do not introduce per-conversation on-chain read state because it does not scale.

### Group Chat

- Similar to direct chat but with multiple participants.
- Group menu and group admin options include add/remove members, admin controls, leave, handoff, rename, and disband.
- Group invites support expiry and join codes.
- Group sync is currently slower than direct chat sync; improving group sync speed is a priority.
- Group chat should gain link-rendering parity with direct chat when working on chat UX.

### Sync Architecture

- History syncs from chain by scanning block ranges.
- Incremental (`updateHead`) syncs scan only new blocks.
- WS subscriptions trigger debounced incremental syncs on message and group events.
- Read/unread state is backed up as an on-chain self-memo.
- Block cache (`restoreCache`) skips re-scanning already-indexed read-state backup blocks on reconnect.

## P2P Trading App - Feature Summary

- Public trade directory: users can browse open trades from anyone.
- Trade cards should read like buy/sell orders at a price ratio, not like generic token transfer cards.
- Normal trades use `TRADE_ESCROW_CONTRACT_ADDRESS` and support public listings, private links, direct-recipient links, partial fills, counters, cancel, decline, and edit by cancel-and-replace.
- Private liquidity trades use `PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS`. They require private ERC-20 tokens on both sides.
- Private liquidity trades must always hide token amounts and fill amounts from public/detail views. Public views should prioritize price ratio, order direction, expiry, and access type.
- Makers can reveal their own private liquidity/fill progress from My Trades once AES is available. Do not expose this in the public explorer view.
- Private liquidity fills are settled by the contract from the taker's private payment amount; the taker inputs what they want to spend, and the contract path handles partial fill/overshoot privately.
- Private-link and direct trades should only be visible when their requirements are satisfied. Direct links may be shared manually.
- Counters: a counter-offer to an existing standard trade is itself a direct trade between the parties.
- A completed counter cancels the parent/initial trade automatically.
- Private liquidity counters are not currently supported by the action layer; avoid presenting them as available unless contract/action support changes.
- Trade IDs are contract-local. Always include the escrow contract in links, keys, fetches, and UI identity. Use `buildTradeSnapshotKey(tradeId, escrowContract)`.
- Trade cards show offer/request assets, expiry countdown with urgency color-coding, status, access type, and relevant maker/taker actions.
- Trade links can be shared publicly.

## Treasury App

- Reads smart contract data and live feed data; no write operations.
- Only improvements warranted here are design/UX, readability, data presentation, performance, or test coverage unless explicitly requested.

## Whisper Shield

- Canonical route: `/shield`.
- Alias route: `/swap`.
- Purpose: swap reward tokens into private token form and back through the reward swap vault.
- Keep changes scoped. Do not turn this into a separate wallet/session model.

## Design Guidelines

- Dark purple minimalist aesthetic is intentional and should be preserved.
- Small polish improvements to spacing, typography, hierarchy, and empty states are welcome.
- No major layout restructuring, theme toggles, or new color palettes without a specific request.
- P2P should feel like a trading dashboard: clear buy/sell direction, concise ratio display, direct action buttons, and low visual noise.
- Private liquidity cards should lead with price ratio and direction. Do not show one side's amount if the other side is hidden.
- Keep display text consistent: use "You sell", "You buy", "Buyer pays", "Price ratio", and "Private liquidity" consistently across explorer cards, detail cards, and in-chat cards.
- Wallet/AES readiness states should be clear enough that users know whether they need to connect, switch network, sign AES, top up, or unlock an app wallet.

## Important Source Map

- `src/App.tsx` - app shell, top-level composition, chat orchestration, shared wallet state for chat, lazy loading of page apps.
- `src/shell/routing.ts` - top-level route parsing, canonical route paths, aliases, and browser location sync.
- `src/components/P2PTradingPage.tsx` - standalone trades app. Do not reintroduce the older `StandaloneTradesPage` path.
- `src/components/TradeComposerPanel.tsx` - shared trade create/edit form.
- `src/components/TradeOfferCard.tsx` - trade card used for shared links and in-chat rendering.
- `src/components/TreasuryPage.tsx` - Treasury Data presentation.
- `src/components/TokenSwapPage.tsx` - Whisper Shield swap presentation.
- `src/lib/treasuryData.ts` - live/feed/on-chain data loading and normalization.
- `src/lib/appShared.ts` - re-exports `src/lib/appShared/core.ts` and `src/lib/appShared/parsers.ts`. Shared constants, wallet helpers, parsers, memo encoding, COTI provider loading, and formatting belong there.
- `src/hooks/useWalletOnboarding.ts` and `src/hooks/useBurnerWallet.ts` - reusable wallet/onboarding hooks.
- `src/lib/tradeComposer.ts`, `src/lib/tradeActions.ts`, `src/lib/tradeLinks.ts`, `src/lib/tradePerspective.ts`, `src/lib/appChain.ts` - shared trade logic. Extend these before duplicating trade behavior in components.
- `src/lib/walletOptions.ts` - browser wallet filtering/detection. MetaMask and CipherTrade are allowed for trading; Brave is filtered out.
- Supabase image storage is limited to encrypted chat image attachments: `src/lib/imagePull.ts`, `src/lib/supabaseClient.ts`, and `supabase/`.
- `APP_IMPROVEMENTS.md` - prioritized proposals from the current app review. It is advisory, not runtime behavior.

## Consistency Rules

- Keep COTI network constants, contract addresses, token formatting, token amount parsing, wallet detection, and token verification in shared libs.
- Wallet controls belong in the universal top header.
- Keep trade display semantics consistent through `tradePerspective`, `tradeComposer`, `tradeLinks`, `appChain`, and `TradeOfferCard`.
- All new contract reads should go through `appChain.ts`; all new trade writes should go through `tradeActions.ts`.
- Each app keeps its own layout and density: chat is a workspace, P2P is a trading dashboard, Treasury is analytics, Home is a launcher, Whisper Shield is a compact swap tool.
- For private liquidity trades, never key state only by numeric trade ID. Include the escrow contract address.
- For private tokens, respect 6-decimal formatting where token metadata resolves that way, and require AES before displaying private balances or maker-only private progress.
- Sensitive local caches such as trade access secrets and maker private liquidity are convenience data. Keep them scoped, documented, and easy to clear when improving storage behavior.
- Oversized files are known technical debt. Prefer extracting cohesive hooks/components/helpers from `src/App.tsx`, `src/components/P2PTradingPage.tsx`, and `src/styles.css` when working nearby.

## Verification

Run these before finishing any changes:

```bash
npm run lint
npm run test
npm run build
```

Use focused tests for parser/link/perspective/routing changes first, then run the full suite.
