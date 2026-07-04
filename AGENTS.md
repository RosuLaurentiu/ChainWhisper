# Project Notes For Future App Work

## Product Shape

This repository is a Vite + React + TypeScript project for ChainWhisper, a privacy-first blockchain messenger and trading hub built on COTI Mainnet (chain ID `2632500`). The runtime is an app hub where each page behaves like its own app but shares wallet, network, trade, and account logic.

Current route behavior is intentional:

- `/` - canonical Home launcher and product overview. `/home` is an alias. No wallet controls shown here.
- `/chat` - main encrypted messaging app for direct chat and group chat. `/messages` and `/messenger` are aliases.
- `/otc` and nested `/otc/...` - canonical OTC trading app. `/trades` and `/otcdesk` are legacy aliases that must keep resolving.
- `/portal` - canonical WISP Portal private-token swap app. `/swap`, `/shield`, and `/whisper-shield` are aliases.
- `/treasury` - Treasury Data analytics. `/treasury-data` is an alias. No wallet interaction needed.

## Navigation Rules

- Keep the route map above as-is unless the user explicitly asks to change routing.
- Top-level route ownership lives in `src/shell/routing.ts`; update `src/shell/routing.test.ts` with any route change.
- Launching apps from Home must navigate in-place with client-side routing. Do not open a new browser tab or trigger a full page reload because wallet session state should remain available across apps.
- Generate new OTC links under `/otc...`; keep old `/trades...` and `/otcdesk...` routes working as aliases.
- Internal trade links should preserve app context whenever practical. Trade terminal links opened from WISP Portal may keep that terminal open when moving into OTC Desk; do not make the reverse direction preserve terminal state unless explicitly requested.

## Wallet Rules

- Chat, OTC Trading, and WISP Portal use the owner-first ChainWhisper account model: MetaMask/browser wallet is owner login, recovery, funding, and fallback; the ChainWhisper account is the default chat/trading/swap account.
- Connect/recover the owner-linked ChainWhisper account automatically after owner privacy is available. If no account exists, show create/import/recover setup actions.
- Home and Treasury are non-interactive pages and must not show wallet controls.
- Shared rule: if a wallet is already connected when navigating between apps, keep it connected. Do not disconnect or re-prompt.
- Keep the ChainWhisper account vault behavior consistent between chat, trades, and shield. Internal `burner` naming can remain where risky to rename, but user-facing text should say ChainWhisper account, owner wallet, or browser wallet.
- Read/display can include both owner wallet and ChainWhisper account activity where supported; new messages, new trades, counters, and normal app actions default to the ChainWhisper account.
- Owner-wallet signing should be limited to funding/recovery and existing owner-targeted fallback actions where the current contract requires the owner address.

## Chat App - Feature Summary

### Direct Chat

- Encrypted 1-to-1 messaging via COTI garbled circuits.
- Emoji reactions on messages.
- Replies with a message reference.
- Tips sent inline in chat.
- In-chat trading: a trade offer created inside a DM is a direct trade between the two participants.
- Unlisted orders should not be auto-posted into chat, but a copied trade link may be pasted and rendered as a link.
- Mute/hide per conversation; state is persisted on-chain as an encrypted hidden message.
- Read/unread state is a single global timestamp (`lastReadAllTs`). Saved on-chain when all messages are read. Do not introduce per-conversation on-chain read state because it does not scale.

### Group Chat

- Similar to direct chat but with multiple participants.
- Group menu and group admin options include add/remove members, admin controls, leave, handoff, rename, and disband.
- Group invites support expiry and join codes.
- Group sync is split between overview, active-message, and active-member/member-event paths. Preserve that split so opening one group does not force broad overview scans.
- Group chat shares direct-chat link rendering for HTTP(S) URLs and internal trade links. Keep pasted private-order links as links only, not auto-posted trade cards.

### Sync Architecture

- History syncs from chain by scanning block ranges.
- Incremental (`updateHead`) syncs scan only new blocks.
- WS subscriptions trigger debounced incremental syncs on message and group events.
- Active direct conversations and active groups should refresh the focused thread first; broad overview work should stay secondary.
- Read/unread state is backed up as an on-chain self-memo.
- Block cache (`restoreCache`) skips re-scanning already-indexed read-state backup blocks on reconnect.

## OTC Trading App - Feature Summary

- OTC is an order-based trading app, not a pool/router-style DEX. Use Trade, Desk, Orders, Order review, offer, peer, shared link, and settlement language where it reads naturally.
- Top navigation is `Trade`, `Desk`, `Agent`, `Orders`.
- `Trade` at `/otc` contains `Swap`, `Limit`, and `Recurring`.
- `Desk` at `/otc/desk` is for browsing active public offers from anyone.
- `Agent` at `/otc/agent` is paid WISP Trade Agent help. It may explain orders, find price context, draft limit/counter orders, prefill swap/order forms, and open order links for review. It must not execute trades automatically.
- `Orders` at `/otc/orders` is for account-owned and received order activity.
- `Order` review lives under `/otc/order...`. Generate new links under `/otc/order/link/:code`, `/otc/order/:id`, or `/otc/order/recurring/:id`; keep `/trades...` and `/otcdesk...` aliases working.
- Swap is a best single-order surface. It can execute one selected ChainWhisper order directly, but must never aggregate, route, or average across multiple orders.
- Swap and Order review share the same price mental model: `Sell`/`Buy` changes the executable side, while the token flip changes the displayed ratio basis. Carbon and ChainWhisper prices must always be displayed in the same basis.
- Same-token pairs should be impossible to select in Trade modes, not merely rejected after selection.
- Trade cards should read like buy/sell orders at a price ratio, not like generic token transfer cards.
- Normal trades use the Trading V1 OTC escrow/reader contracts and support public offers, private links, direct-recipient links, partial fills, permanent/no-expiry offers, counters, cancel, decline, edit by cancel-and-replace, and visible private-token amount flows.
- Private tokens are not automatically hidden. If `Visible amounts` is selected, private-token order size, fills, and remaining amounts are public and the order routes through the normal OTC contract.
- Hidden-amount private orders use `PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS`. Fully private hidden-amount orders use private ERC-20 tokens on both sides; hybrid private orders offer a private token and let the taker pay with a public/native asset.
- Hidden-amount private orders must hide private token amounts and private fill amounts from public/detail views. Public views should prioritize price ratio, order direction, expiry, and access type.
- Hidden-amount private orders and private recurring orders use user-scoped private ledger snapshots and fill receipts. Makers can reveal their own live budget/liquidity and progress from Orders once privacy is available. Fillers can reveal their own buy/sell history even when an order is only partially filled. Do not expose maker-only values in the public explorer view.
- For hidden-amount standard trades, private fill receipts can be the only revealed source for the payment side when public request terms are hidden. Keep card and order-review progress summaries two-sided whenever receipt amounts are available.
- Owner recovery/privacy uses the COTI MetaMask Snap where available. Keep owner AES and ChainWhisper-account AES state separate; do not let the active ChainWhisper account privacy state stand in for owner recovery privacy.
- Hidden-amount private-order fills are settled by the contract from the taker payment amount; the contract path handles partial fill/overshoot privately where private tokens are involved.
- Recurring orders live in the Trade page. They are reusable two-sided OTC orders, not cadence/timer orders: maker buy fills add base inventory to the sell side, and maker sell fills add quote inventory to the buy side. Recurring private-token orders must offer explicit `Private liquidity` and `Visible amounts` paths.
- Recurring inventory is live order liquidity, not normal unused funds. Makers can edit prices, per-side amounts, and add/remove liquidity in place without changing the order link. The normal closing action should read as "Close order" and return remaining inventory.
- Private-link and direct trades should only be visible when their requirements are satisfied. Direct links may be shared manually.
- Counters: a counter-offer to an existing standard trade is itself a direct trade between the parties.
- A completed counter cancels the parent/initial trade automatically.
- Private-order counters are not currently supported by the action layer; avoid presenting them as available unless contract/action support changes.
- Trade IDs are contract-local. Always include the escrow contract in links, keys, fetches, and UI identity. Use `buildTradeSnapshotKey(tradeId, escrowContract)`.
- Trade cards show offer/request assets, price ratio, expiry countdown with urgency color-coding, status, access type, and relevant maker/taker actions.
- Order links can be shared publicly.

## Treasury App

- Reads smart contract data and live feed data; no write operations.
- Only improvements warranted here are design/UX, readability, data presentation, performance, or test coverage unless explicitly requested.

## WISP Portal

- Canonical route: `/portal`.
- Alias routes: `/swap`, `/shield`, `/whisper-shield`.
- Purpose: swap reward tokens into private token form and back through the reward swap vault.
- Keep changes scoped. Do not turn this into a separate wallet/session model.

## Design Guidelines

- Dark purple minimalist aesthetic is intentional and should be preserved.
- Small polish improvements to spacing, typography, hierarchy, and empty states are welcome.
- No major layout restructuring, theme toggles, or new color palettes without a specific request.
- OTC should feel like a focused order-based trading app: clear buy/sell direction, consistent price basis, concise ratio display, direct action buttons, peer/settlement language, and low visual noise.
- Hidden-amount private-order cards should lead with price ratio and direction. Do not show one side's amount if the other side is hidden.
- Keep display text consistent: use "You sell", "You buy", "Buyer pays", "Price ratio", "Private liquidity", "Visible amounts", and "Unlisted" consistently across explorer cards, detail cards, and in-chat cards.
- Wallet/privacy readiness states should be clear enough that users know whether they need to connect owner wallet, unlock privacy, recover/create a ChainWhisper account, move funds, or use an owner-wallet fallback.

## Project Structure

- `src/App.tsx` - top-level composition shell. It still owns shared wallet/chat state, but feature orchestration has been pulled into feature hooks where practical.
- `src/app/` - app shell UI, Home, header navigation, mobile nav, lazy route loading, app-level hooks, notification sound, and formatting helpers.
- `src/features/chat/` - direct-chat components, chat UI Zustand store, message sync/actions, reactions, tips, attachments, read state, and direct message send/tip actions.
- `src/features/groups/` - group chat components, group UI Zustand store, group sync orchestration, group admin actions, invites, member events, and group message sends.
- `src/features/trading/` - OTC Trading page, Trade/Desk/Agent/Orders surfaces, Trade Agent panel/session/actions, terminal renderers, order cards, swap quote state, balances, recurring order actions, and in-chat trade actions.
- `src/features/wallet/` - shared wallet header, ChainWhisper account vault, owner onboarding/recovery, account funds modals, readiness, wallet preference, and transfer flows.
- `src/features/tokenTools/` - WISP Portal swap page, token swap view model/actions, reward-token metrics, and token-tool UI Zustand store.
- `src/features/treasury/` - Treasury Data page plus live/feed/on-chain data loading and normalization.
- `src/shared/` - reusable cross-feature UI, chat rendering pieces, modal/clipboard/virtual-scroll hooks, block timestamp cache, and small state utilities.
- `src/shell/` - top-level route parsing, canonical route paths, aliases, realtime status helpers, and browser-location sync.
- `src/lib/` - non-React chain, wallet, trade, parsing, storage, encoding, COTI provider, and contract helpers.
- `src/styles.css` - ordered stylesheet import hub. Route/domain CSS lives in `src/styles/`; preserve import order when moving rules.
- Ignored local Markdown files, such as `APP_IMPROVEMENTS.md`, are scratchpads. Do not use them as completed-work changelogs.

## Important Source Map

- `src/app/lazyRoutes.tsx` - lazy-loaded page modules and preload hooks for Chat, OTC Trading, WISP Portal, and Treasury.
- `src/features/trading/components/P2PTradingPage.tsx` - standalone OTC trading app. Internal P2P/terminal names still exist; user-facing language should be Trade, Desk, Agent, Orders, and Order.
- `src/features/trading/components/TradeAgentPanel.tsx`, `src/features/trading/hooks/useP2PTradeAgentSession.ts`, `src/features/trading/hooks/useP2PTradeAgentActions.ts`, and `src/lib/tradeAgent.ts` - Trade Agent UI, session state, paid action handling, response normalization, fees, and action labels.
- `src/features/trading/components/TradeComposerPanel.tsx` - shared trade create/edit form.
- `src/features/trading/components/TradeOfferCard.tsx` - trade card used for shared links and in-chat rendering.
- `src/features/treasury/components/TreasuryPage.tsx` and `src/features/treasury/treasuryData.ts` - Treasury Data presentation and data normalization.
- `src/features/tokenTools/components/TokenSwapPage.tsx` - WISP Portal swap presentation.
- `src/shared/components/chat/MessageTextWithLinks.tsx` and `src/lib/chatLinks.ts` - shared chat link rendering and internal app-link interception.
- `src/lib/appShared.ts` - compatibility barrel for `src/lib/appShared/core.ts`, `src/lib/appShared/parsers.ts`, and `src/lib/appShared/burnerVault.ts`. Prefer direct imports when touching nearby code.
- `src/features/wallet/hooks/useWalletOnboarding.ts` and `src/features/wallet/hooks/useBurnerWallet.ts` - reusable owner wallet, ChainWhisper account, recovery, and onboarding hooks.
- `src/lib/appWalletRecovery.ts`, `src/lib/burnerWalletVault.ts`, `src/lib/walletAccountScope.ts`, and `src/lib/walletFunds.ts` - recovery payloads, local account vaults, owner + ChainWhisper read scope, and move/withdraw funding helpers.
- `src/features/trading/hooks/useInChatTradeActions.ts` and `src/features/chat/hooks/useDirectMessageActions.ts` - DM trade and direct message/tip action orchestration.
- `src/features/groups/hooks/useGroupAdminActions.ts` and `src/features/groups/hooks/useGroupDataSync.ts` - group admin actions and group sync orchestration.
- `src/lib/groupMessageSync.ts` - active-group message and member-event sync helpers.
- `src/lib/directConversationSyncHelpers.ts` - direct-chat merge, unread, nickname/contact, and optimistic reconciliation helpers.
- `src/lib/p2pTradeView.ts` - OTC display, search/filter, snapshot-key, explorer-link, local storage, and maker-private-progress helpers.
- `src/lib/tradeHistory.ts` - wallet-scoped trade history rows, including private fill receipt rows used by Orders and order-review history.
- `src/lib/otcSwapQuote.ts`, `src/lib/otcSwapUi.ts`, and `src/lib/otcSwapIntent.ts` - Swap quote selection, side/basis UI rules, order-review handoff, direct execution intent, and local requested-vs-filled notes.
- `src/lib/appHelpers.ts` - verified ecosystem token presets, message helpers, and shared user-facing error helpers.
- `src/lib/tradeComposer.ts`, `src/lib/tradeActions.ts`, `src/lib/tradeLinks.ts`, `src/lib/tradePerspective.ts`, and `src/lib/appChain.ts` - shared trade logic. Extend these before duplicating trade behavior in components.
- `src/lib/walletOptions.ts` - browser wallet filtering/detection. Browser wallets are owner/fallback wallets in the normal app model.
- `src/shared/hooks/useModalA11y.ts` - shared modal focus trap, Escape, and focus-restore behavior.
- Supabase image storage is limited to encrypted chat image attachments: `src/lib/imagePull.ts`, `src/lib/supabaseClient.ts`, and `supabase/`.

## Consistency Rules

- Keep COTI network constants, contract addresses, token formatting, token amount parsing, wallet detection, and token verification in shared libs.
- Wallet controls belong in the universal top header.
- Keep trade display semantics consistent through `tradePerspective`, `tradeComposer`, `tradeLinks`, `appChain`, and `TradeOfferCard`.
- All new contract reads should go through `appChain.ts`; all new trade writes should go through `tradeActions.ts`.
- Each app keeps its own layout and density: chat is a workspace, OTC is an order desk, Treasury is analytics, Home is a launcher, and WISP Portal is a compact swap tool.
- Keep `src/styles.css` as the import hub; add route/domain CSS under `src/styles/` when a split reduces risk.
- For private orders, never key state only by numeric trade ID. Include the escrow contract address.
- For private tokens, respect 6-decimal formatting where token metadata resolves that way, and require AES before displaying private balances or maker-only private progress.
- Sensitive local caches such as trade access secrets and maker private-order reveal context are convenience data. Keep them scoped, documented, and easy to clear when improving storage behavior.
- Verified ecosystem token presets belong in `src/lib/appHelpers.ts`. Keep token kind (`erc20` or `private-erc20`) accurate.
- Oversized files have been reduced, but keep extracting cohesive hooks/components/helpers when it makes a real app change safer.

## Verification

Run these before finishing any changes:

```bash
npm run lint
npm run test
npm run build
```

Run `npm run test:browser` for route, wallet-header, mobile layout, and other visible UI changes.

Use focused tests first, then run the full suite:

```bash
npm run test:wallet
npm run test:trading
npm run test:chat
```

Add or update tests for money movement, recovery/encryption, private-balance reads, signer choice, route/link parsing, message encoding, or fixed regressions. For simple styling/copy/layout changes, prefer manual/browser smoke checks unless the UI state protects a critical wallet, recovery, trade, or privacy path.

Local testing notes, research notes, and proposal drafts that should not be uploaded belong in ignored Markdown files such as `TESTING.md`, `APP_IMPROVEMENTS.md`, or `OTC_SECURITY_PRIVACY_REVIEW.md`.
