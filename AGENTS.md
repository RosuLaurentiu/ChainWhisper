# Project Notes For Future App Work

## Product Shape

This repository is a Vite + React + TypeScript project for ChainWhisper — a privacy-first blockchain messenger and trading hub built on COTI Mainnet (chain ID 2632500). The runtime is an app hub where each page behaves like its own app but shares wallet, network, and trade logic:

- `/home` — launcher and product overview. Links to all sub-apps. No wallet controls shown here.
- `/chat` — the main encrypted messaging app (direct chat + group chat).
- `/trades` and nested `/trades/...` — standalone P2P escrow trading app.
- `/treasury` — Treasury Data analytics (read-only, no wallet interaction needed).
- `/whisper-shield` — work in progress, do not touch.

## Navigation Rule

**Launching the chat app from the home page must NOT open a new browser tab or page.** It should navigate in-place (client-side routing) so the wallet session is preserved across apps. This is the main mechanism keeping wallet state consistent when moving between apps.

## Wallet Rules

- **Chat app**: prioritize the app wallet (generated/saved burner wallet). Connect the saved app wallet first on load; generate one when none is saved. Browser wallets (MetaMask etc.) remain available from the header menu.
- **P2P Trading app**: prioritize MetaMask by default. Exclude Brave Wallet from the trading wallet list. App wallet options remain in the header menu.
- **Shared rule**: if a wallet is already connected when navigating between apps, keep it connected — do not disconnect or re-prompt.
- **Home and Treasury** are non-interactive pages and must not show wallet controls.
- Keep burner wallet vault behavior consistent between chat and trades. The P2P page has its own local wallet orchestration; if wallet behavior changes, extract a page-neutral wallet session hook rather than patching one app only.

## Chat App — Feature Summary

### Direct Chat
- Encrypted 1-to-1 messaging via COTI garbled circuits.
- **Emoji reactions** on messages.
- **Replies** (threaded reply-to with message reference).
- **Tips** (send token tips inline in chat).
- **In-chat trading**: a trade offer created inside a DM is a direct trade between the two participants.
- Mute/hide per conversation (state persisted on-chain as an encrypted hidden message).
- Read/unread state is a single global timestamp (`lastReadAllTs`). Saved on-chain when all messages are read. Do not introduce per-conversation on-chain state — it does not scale.

### Group Chat
- Similar to direct chat but with multiple participants.
- Group menu and group admin options (add/remove members, admin controls).
- **Group sync is currently slower than direct chat sync — improving group sync speed is a priority.**
- Group invites with expiry.

### Sync Architecture
- History syncs from chain by scanning block ranges.
- Incremental (`updateHead`) syncs scan only new blocks.
- WS subscription triggers debounced incremental syncs on new `MessageSubmitted` events.
- Read/unread state is backed up as an on-chain self-memo (me→me encrypted message).
- Block cache (`restoreCache`) skips re-scanning already-indexed blocks on reconnect.

## P2P Trading App — Feature Summary

- Public trade directory: users can browse open trades from anyone.
- **Counters**: a counter-offer to an existing trade is itself a direct trade between the two parties.
- **A completed counter (accepted) cancels the parent/initial trade automatically.**
- Trade cards show offer/request assets, expiry countdown with urgency color-coding, and status.
- Trade links can be shared publicly.

## Treasury App

- Reads smart contract data and live feed data — no write operations.
- Only improvements warranted here are **design/UX** (layout, readability, data presentation). No logic changes needed.

## Whisper Shield

Work in progress. Do not modify.

## Design Guidelines

- Dark purple minimalist aesthetic — this is intentional and should be preserved.
- Small polish improvements (spacing, typography, color tweaks) are welcome.
- No major layout restructuring, no theme toggles, no new color palettes.

## Important Source Map

- `src/App.tsx` — app shell, top-level routing, chat orchestration, shared wallet state for chat, lazy loading of page apps.
- `src/components/P2PTradingPage.tsx` — standalone trades app. Do not reintroduce the older `StandaloneTradesPage` path.
- `src/components/TreasuryPage.tsx` — Treasury Data presentation.
- `src/lib/treasuryData.ts` — live/feed/on-chain data loading and normalization.
- `src/lib/appShared.ts` — re-exports `src/lib/appShared/core.ts` and `src/lib/appShared/parsers.ts`. Shared constants, wallet helpers, parsers, memo encoding, COTI provider loading, and formatting belong there.
- `src/hooks/useWalletOnboarding.ts` and `src/hooks/useBurnerWallet.ts` — reusable wallet/onboarding hooks.
- `src/lib/tradeComposer.ts`, `src/lib/tradeActions.ts`, `src/lib/tradeLinks.ts`, `src/lib/tradePerspective.ts`, `src/lib/appChain.ts` — shared trade logic. Extend these before duplicating trade behavior in components.
- Supabase image storage is limited to encrypted chat image attachments: `src/lib/imagePull.ts`, `src/lib/supabaseClient.ts`, and `supabase/`.

## Consistency Rules

- Keep COTI network constants, contract addresses, token formatting, token amount parsing, and wallet detection in shared libs.
- Wallet controls belong in the universal top header.
- Keep trade display semantics consistent through `tradePerspective`, `tradeComposer`, `tradeLinks`, and `TradeOfferCard`.
- Each app keeps its own layout and density: chat is a workspace, P2P is a trading dashboard, Treasury is analytics, Home is a launcher.
- All new contract calls should go through `appChain.ts`.

## Verification

Run these before finishing any changes:

```bash
npm run lint
npm run test
npm run build
```

Use focused tests for parser/link/perspective changes first, then run the full suite.
