# Project Notes For Future App Work

## Current DEX beta delivery

For DEX work, use the [root instructions](../AGENTS.md), the architecture's
[beta completion boundary](../ARCHITECTURE.md#dex-beta-completion-boundary) and
the [current roadmap](../MASTER_ROADMAP.md#remaining-dex-beta-path). Backlog is the
only planner. Existing non-DEX sections below are not a new DEX scope or authority.

The DEX beta is a complete user App on the admitted COTI Testnet candidate, not the
Mainnet hub deployment. Include market price/freshness and daily chart, both swap
modes and protections, four-token funding, Your Positions, My Orders, My Activity,
supported services and safe exits. Reuse existing views/readers and receipt state;
normal use needs no chat, manual work files or routine NFT-ID entry. Keep the keeper
on public pending work and permitted steps; private result checks belong to the
owner App. No new runner, indexer, wallet model or design overhaul is required.

CW-009.03 collects the App deliveries; .01-.04 own keeper/swaps and owner controls,
CW-032.02 owns funding and CW-033.01 owns DEX activity. Collect timing, cost and
handoff from these same journeys. Preserve current candidate checks, privacy,
exact accounting, recovery and all live holds. Follow root proportional checks;
instruction-only changes need text/link checks, not contract or Testnet reruns.

## Product Shape

This repository is a Vite + React + TypeScript project for ChainWhisper, a privacy-first blockchain messenger and trading hub built on COTI Mainnet (chain ID `2632500`). The runtime is an app hub where each page behaves like its own app but shares wallet, network, trade, and account logic.

Current route behavior is intentional:

- `/` - canonical Home launcher and product overview. `/home` is an alias. No wallet controls shown here.
- `/chat` - main encrypted messaging app for direct chat and group chat. `/messages` and `/messenger` are aliases.
- `/otc` and nested `/otc/...` - canonical OTC trading app. `/trades` and `/otcdesk` are legacy aliases that must keep resolving.
- `/portal` - canonical Privacy Portal app for official COTI public/private token bridges. `/swap`, `/shield`, and `/whisper-shield` are aliases.
- `/tvl` - canonical COTI Private TVL analytics. `/private-tvl`, `/treasury`, and `/treasury-data` are aliases. No wallet interaction needed.

## Navigation Rules

- Keep the route map above as-is unless the user explicitly asks to change routing.
- Top-level route ownership lives in `src/shell/routing.ts`; update `src/shell/routing.test.ts` with any route change.
- Launching apps from Home must navigate in-place with client-side routing. Do not open a new browser tab or trigger a full page reload because wallet session state should remain available across apps.
- Generate new OTC links under `/otc...`; keep old `/trades...` and `/otcdesk...` routes working as aliases.
- Internal trade links should preserve app context whenever practical. Trade terminal links opened from Privacy Portal may keep that terminal open when moving into OTC Desk; do not make the reverse direction preserve terminal state unless explicitly requested.

## Wallet Rules

- Chat, OTC, and Privacy Portal use one connected owner wallet. Supported sessions are MetaMask and CipherTrade, including injected desktop/mobile providers and the CipherTrade Mobile WalletConnect path.
- Direct Chat V2, Group Chat V2, Reactions V1, and trading contracts use that selected owner directly. Issue signer capabilities only from the exact live, lease-guarded EIP-1193 session and COTI `BrowserProvider`; never accept a local `Wallet`, generic RPC signer, app wallet, burner, executor registry, or silent fallback.
- Do not add local account creation, private-key custody, account recovery vaults, secondary wallet balances, or move-funds flows back into the app.
- Home and Treasury are non-interactive pages and must not show wallet controls.
- Shared rule: if a wallet is already connected when navigating between apps, keep it connected. Do not disconnect or re-prompt.
- Historical protocol versions may remain readable where needed, but every active write is owner-only and versioned; never dual-write, downgrade, or retry through an obsolete signer after a V2 failure.
- MetaMask privacy unlock uses the COTI Snap. CipherTrade sessions use explicit, session-only COTI privacy onboarding; never persist the resulting AES key or private wallet material in local storage, Supabase, logs, or application state beyond the live wallet session.

## Chat App - Feature Summary

### Direct Chat

- Legacy direct chat encrypts through COTI per message. Direct Chat V2 instead creates one COTI-protected epoch seed, shares participant-specific envelopes once per epoch, and uses local AES-256-GCM plus one ordinary MetaMask transaction per message.
- Emoji reactions on messages.
- Replies with a message reference.
- Tips sent inline in chat.
- In-chat trading: a trade offer created inside a DM is a direct trade between the two participants.
- Unlisted orders should not be auto-posted into chat, but a copied trade link may be pasted and rendered as a link.
- Legacy mute/hide and contact preferences may remain readable, but V2 preferences must not create encrypted maintenance messages merely to persist UI state.
- Legacy read/unread uses the global on-chain `lastReadAllTs` self-memo. V2 uses a per-wallet, per-conversation finalized message-ID cursor advanced only after viewport acknowledgement, persisted locally and synchronized across tabs without a wallet prompt. Never put a per-read cursor, plaintext, ciphertext, or epoch key on-chain. Any later cross-device service must be owner-authenticated and cursor-only.

### Group Chat

- Group Chat V2 uses the same one-seed-per-membership-epoch and AES-GCM message model as Direct V2, with caller-only epoch-envelope synchronization and direct MetaMask authority.
- Group creation activates only the consenting creator. Other addresses are invited and become members only through their own accept/join transaction; do not reintroduce forced `addMembers` behavior.
- Group menu and group admin options include invite/accept/decline/revoke, remove members, join codes, admin handoff, leave, optional encrypted metadata, rekey, and disband.
- Group invites support expiry and join codes.
- Group sync is split between overview, active-message, and active-member/member-event paths. Preserve that split so opening one group does not force broad overview scans.
- Group chat shares direct-chat link rendering for HTTP(S) URLs and internal trade links. Keep pasted private-order links as links only, not auto-posted trade cards.

### Sync Architecture

- History syncs from chain by scanning block ranges.
- Incremental (`updateHead`) syncs scan only new blocks.
- WS subscriptions trigger debounced incremental syncs on message and group events.
- Active direct conversations and active groups should refresh the focused thread first; broad overview work should stay secondary.
- The on-chain read-state self-memo and `restoreCache` optimization are legacy-only. V2 history uses safe-head scans, canonical block-hash checkpoints, bounded overlap/replay, contiguous stable message IDs, and V2-only orphan removal; V2 unread uses the finalized cursor described above.

## OTC Trading App - Feature Summary

- OTC is an order-based trading app, not a pool/router-style DEX. Use Trade, Desk, Orders, Order review, offer, peer, shared link, and settlement language where it reads naturally.
- Top navigation is `Trade`, `Desk`, `Agent`, `Orders`.
- `Trade` at `/otc` contains `Swap`, `Limit`, and `Recurring`.
- `Desk` at `/otc/desk` is for browsing active public offers from anyone.
- `Agent` at `/otc/agent` is paid WISP Trade Agent help. It may explain orders, find price context, draft limit/counter orders, prefill swap/order forms, and open order links for review. It must not execute trades automatically.
- `Agent Setup` is the free installation guide for the separate `@chainwhisper/agent-tools` package. Keep it visually and behaviorally separate from the paid WISP Trade Agent.
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
- Owner privacy uses the COTI MetaMask Snap for MetaMask sessions and explicit session-only COTI onboarding for CipherTrade sessions. Never persist privacy AES material outside the live wallet session.
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

### External ChainWhisper MCP

- The external MCP repository is `https://github.com/RosuLaurentiu/ChainWhisper-MCP`. The app setup page pins `@chainwhisper/agent-tools@0.1.0-beta.0` and registers `chainwhisper-mcp` plus `chainwhisper-coti-signer`.
- `chainwhisper-mcp` is keyless planning. `chainwhisper-coti-signer` owns the dedicated Agent Wallet, privacy material, local Agent Control dashboard, policies, complete-action confirmations, signing, broadcast, recovery, and order-linked private negotiation.
- A COTI skill or standalone private-messaging MCP is not required. The official COTI private-messaging SDK is embedded in the ChainWhisper signer. A separate compatible COTI MCP is independent and useful only for generic COTI operations; ChainWhisper must never call it or receive wallet credentials from it.
- Agent Control stays local and persistent. It handles existing/new Agent Wallet setup, funding context, one-time privacy onboarding, verified balances, manual confirmation, bounded/full autonomy, progress, and merged wallet activity. It is not a second order-composition or market-discovery app.
- Manual mode asks for one human confirmation per complete logical ChainWhisper action, not one confirmation per approval/reset/protocol transaction. The signer may submit several exact network transactions after that single authorization.
- Bounded autonomy is limited by explicit policy terms for up to 30 days. Full audited economic autonomy lasts at most 24 hours. Wallet replacement, privacy/token setup, policy changes, arbitrary calldata/transfers, administration, and secret deletion remain local or forbidden.
- Keep Agent Setup copy aligned with the MCP README and public tool catalog. Never instruct users to paste private keys, AES/privacy material, mnemonics, passphrases, pairing/session tokens, or access secrets into an agent prompt or MCP argument.
- The external MCP covers current app economic actions, including best-single-order Swap, one-off Public/Unlisted/Direct orders, visible/private liquidity, lifecycle actions, recurring liquidity, Privacy Portal conversions, private state, and structured order negotiation. It does not replace generic COTI utilities or the in-app paid Trade Agent.

## Treasury App

- Reads smart contract data and live feed data; no write operations.
- Only improvements warranted here are design/UX, readability, data presentation, performance, or test coverage unless explicitly requested.

## Privacy Portal

- Canonical route: `/portal`.
- Alias routes: `/swap`, `/shield`, `/whisper-shield`.
- Purpose: convert the seven verified COTI Mainnet token pairs through their official privacy bridges.
- WISP is the first item in the same unified selector as the official pairs. Its current WISP/pWISP bridge supports both directions and must remain labeled as ChainWhisper-provided rather than an official COTI bridge. Keep the old-pWISP exit collapsed at the bottom as a legacy, unshield-only compatibility option.
- Keep changes scoped. Do not turn this into a separate wallet/session model.

## Design Guidelines

- Dark purple minimalist aesthetic is intentional and should be preserved.
- Small polish improvements to spacing, typography, hierarchy, and empty states are welcome.
- No major layout restructuring, theme toggles, or new color palettes without a specific request.
- OTC should feel like a focused order-based trading app: clear buy/sell direction, consistent price basis, concise ratio display, direct action buttons, peer/settlement language, and low visual noise.
- Hidden-amount private-order cards should lead with price ratio and direction. Do not show one side's amount if the other side is hidden.
- Keep display text consistent: use "You sell", "You buy", "Buyer pays", "Price ratio", "Private liquidity", "Visible amounts", and "Unlisted" consistently across explorer cards, detail cards, and in-chat cards.
- Wallet/privacy readiness states should clearly tell users whether they need to connect MetaMask or CipherTrade, select the correct network, or unlock privacy for the connected owner.

## Project Structure

- `src/App.tsx` - top-level composition shell. It still owns shared wallet/chat state, but feature orchestration has been pulled into feature hooks where practical.
- `src/app/` - app shell UI, Home, header navigation, mobile nav, lazy route loading, app-level hooks, notification sound, and formatting helpers.
- `src/features/chat/` - direct-chat components, chat UI Zustand store, message sync/actions, reactions, tips, attachments, read state, and direct message send/tip actions.
- `src/features/groups/` - group chat components, group UI Zustand store, group sync orchestration, group admin actions, invites, member events, and group message sends.
- `src/features/trading/` - OTC Trading page, Trade/Desk/Agent/Orders surfaces, Trade Agent panel/session/actions, terminal renderers, order cards, swap quote state, balances, recurring order actions, and in-chat trade actions.
- `src/features/wallet/` - shared wallet header, owner-session onboarding, lease-guarded signer capabilities, privacy readiness, network selection, and wallet preference.
- `src/features/tokenTools/` - Privacy Portal page/state/actions, WISP recovery view/actions, reward-token metrics, and token-tool UI Zustand store.
- `src/features/treasury/` - COTI Private TVL presentation and cached loading. TVL is the official bridge reserve; private liabilities are coverage evidence and are never counted twice.
- `src/shared/` - reusable cross-feature UI, chat rendering pieces, modal/clipboard/virtual-scroll hooks, block timestamp cache, and small state utilities.
- `src/shell/` - top-level route parsing, canonical route paths, aliases, realtime status helpers, and browser-location sync.
- `src/lib/` - non-React chain, wallet, trade, parsing, storage, encoding, COTI provider, and contract helpers.
- `src/styles.css` - ordered stylesheet import hub. Route/domain CSS lives in `src/styles/`; preserve import order when moving rules.
- Ignored local Markdown files, such as `APP_IMPROVEMENTS.md`, are scratchpads. Do not use them as completed-work changelogs.

## Important Source Map

- `src/app/lazyRoutes.tsx` - lazy-loaded page modules and preload hooks for Chat, Trading, Privacy Portal, and COTI Private TVL.
- `src/features/trading/components/P2PTradingPage.tsx` - standalone OTC trading app. Internal P2P/terminal names still exist; user-facing language should be Trade, Desk, Agent, Orders, and Order.
- `src/features/trading/components/TradeAgentPanel.tsx`, `src/features/trading/hooks/useP2PTradeAgentSession.ts`, `src/features/trading/hooks/useP2PTradeAgentActions.ts`, and `src/lib/tradeAgent.ts` - Trade Agent UI, session state, paid action handling, response normalization, fees, and action labels.
- `src/features/trading/components/TradeComposerPanel.tsx` - shared trade create/edit form.
- `src/features/trading/components/TradeOfferCard.tsx` - trade card used for shared links and in-chat rendering.
- `src/features/treasury/components/PrivateTvlPage.tsx`, `src/features/treasury/privateTvlData.ts`, `src/lib/privateTvl.ts`, and `src/lib/appChain.ts` - COTI Private TVL presentation, caching, canonical accounting, and block-pinned bridge/Band reads.
- `src/features/tokenTools/components/TokenSwapPage.tsx` - unified Privacy Portal conversion presentation, including the ChainWhisper WISP pair and collapsed legacy recovery UI.
- `src/shared/components/chat/MessageTextWithLinks.tsx` and `src/lib/chatLinks.ts` - shared chat link rendering and internal app-link interception.
- `src/lib/appShared.ts` - compatibility barrel for `src/lib/appShared/core.ts` and `src/lib/appShared/parsers.ts`. Prefer direct imports when touching nearby code.
- `src/features/wallet/hooks/useWalletOnboarding.ts`, `src/features/wallet/ownerCotiMetaMaskCapability.ts`, and `src/lib/walletConnectMobile.ts` - reusable owner-wallet onboarding, lease-guarded COTI capabilities, and CipherTrade Mobile WalletConnect session handling.
- `src/lib/walletAccountScope.ts` and `src/lib/walletFunds.ts` - single connected-owner read scope and owner balance/allowance helpers. They must not recreate a second account or internal funding path.
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
- Each app keeps its own layout and density: chat is a workspace, OTC is an order desk, Treasury is analytics, Home is a launcher, and Privacy Portal is a focused DEX-style conversion tool.
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
