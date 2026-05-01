# Project Notes For Future App Work

## Product Shape

This repository is a Vite + React + TypeScript project for ChainWhisper. The runtime is a small app hub where each page behaves like its own app:

- `/home` is the launcher and product overview.
- `/` and `/chat` are the main encrypted messaging app.
- `/trades` and nested `/trades/...` routes are the standalone P2P escrow trading app.
- `/treasury` is the Treasury Data analytics app.

The pages can look and behave differently when the workflow calls for it, but they should share wallet, COTI network, trade, formatting, and storage logic wherever practical.

## Important Source Map

- `src/App.tsx` owns the app shell, top-level routing, chat orchestration, shared wallet state for chat, and lazy loading of page apps.
- `src/components/P2PTradingPage.tsx` owns the current standalone trades app. Do not reintroduce the older `StandaloneTradesPage` path.
- `src/components/TreasuryPage.tsx` owns Treasury Data presentation; `src/lib/treasuryData.ts` owns the live/feed/on-chain data loading and normalization.
- `src/lib/appShared.ts` re-exports `src/lib/appShared/core.ts` and `src/lib/appShared/parsers.ts`. Shared constants, wallet helpers, parsers, memo encoding, COTI provider loading, and formatting belong there.
- `src/hooks/useWalletOnboarding.ts` and `src/hooks/useBurnerWallet.ts` are the main reusable wallet/onboarding hooks from the chat app.
- `src/lib/tradeComposer.ts`, `src/lib/tradeActions.ts`, `src/lib/tradeLinks.ts`, `src/lib/tradePerspective.ts`, and `src/lib/appChain.ts` are shared trade logic. Prefer extending these before duplicating trade behavior in components.
- Supabase image storage is limited to encrypted chat image attachments: `src/lib/imagePull.ts`, `src/lib/supabaseClient.ts`, and `supabase/`.

## Consistency Rules

- Keep COTI network constants, contract addresses, token formatting, token amount parsing, and wallet detection in shared libs.
- Wallet controls belong in the universal top header. Use the compact trading-page wallet panel layout as the shared wallet surface.
- Chat should prioritize the app wallet: connect saved app wallet first, or generate an app wallet when none is saved. Browser wallets remain available from the header menu.
- Home and Treasury are non-interactive launcher/analytics pages and should not show wallet controls.
- P2P Trades should prioritize MetaMask by default, exclude Brave from the trading wallet list, and still list app wallet options in the header menu.
- Keep burner wallet vault behavior consistent between chat and trades. The current P2P page still has local wallet orchestration; if wallet behavior changes, consider extracting a page-neutral wallet session hook instead of patching one app only.
- Keep trade display semantics consistent through `tradePerspective`, `tradeComposer`, `tradeLinks`, and `TradeOfferCard`.
- Let each app keep its own layout and density: chat is a workspace, P2P is a trading dashboard, Treasury is analytics, and Home is a launcher.

## Verification

Run these before finishing app changes:

```bash
npm run lint
npm run test
npm run build
```

Use focused tests for parser/link/perspective changes first, then run the full suite.
