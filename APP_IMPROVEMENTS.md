# ChainWhisper App Improvements And Optimizations

This file tracks proposals from a deep read of the current ChainWhisper app. It is advisory only: no runtime APIs, schemas, contract calls, or routes are changed by this document.

Last reviewed: May 3, 2026, after finishing the route preload and perceived-load pass.

## Current App Priorities

Keep this list focused on improvements users can feel inside the React app. Smart contract or protocol changes belong in `SMART_CONTRACT_IMPROVEMENTS.md`, and test-only work should stay a maintenance detail instead of a product priority.

### 1. Make The App Easier To Work On

- Keep reducing `src/App.tsx`, `src/components/P2PTradingPage.tsx`, `src/hooks/useDirectConversationSync.ts`, and `src/styles.css`.
- Only split code when it makes a real app change easier, not just to move lines around.
- Best next targets: in-chat trade actions, group admin flows, remaining sync orchestration, and route-specific CSS sections that make styling risky.

### 2. Improve P2P Trading Clarity

- Keep cards concise: clear buy/sell direction, price ratio, short actions, and low visual noise.
- Keep private liquidity views private: no public hidden amounts, no public fill amounts, and clear maker-only reveal states.
- Keep history useful by showing created time, outcome, fill summary, trade type, and copied-link context where it helps.
- Maintain verified token options when real tokens are added.

### 3. Keep UX Polish Practical

- Improve empty, loading, and error states only where users get stuck or confused.
- Preserve Escape-to-close, focus restoration, `aria-live`, and accessible labels for menus, modals, image previews, and message actions.
- Keep mobile layouts usable for the wallet header, P2P tabs/cards, group tools, image previews, and Treasury controls.
- Keep Supabase image work limited to encrypted chat attachments; only add upload progress/compression if large attachments become common.

### 4. Keep Docs And Guardrails Lean

- `README.md`: current setup and developer workflow.
- `AGENTS.md`: rules future agents must preserve.
- `APP_IMPROVEMENTS.md`: practical app backlog and completed app work.
- `SMART_CONTRACT_IMPROVEMENTS.md`: future contract/protocol ideas.
- Keep the existing wallet defaults and route behavior, but do not add new test-only work unless it protects a real bug or risky app change.

## Out Of Scope Until Contracts Change

- Do not expand private trade access-secret or private-liquidity browser-cache behavior until the smart contract recovery path is updated.
- Revisit clear-cache UI, helper extraction, and persistent-secret removal after encrypted maker recovery and related contract changes are available.
- Keep contract-side ideas in `SMART_CONTRACT_IMPROVEMENTS.md`.

## Completed Work

### Documentation Baseline

- Initial docs pass verified with `npm run lint`, `npm run test`, and `npm run build`.
- Initial baseline at that time: lint passed, 33 tests passed, and production build passed.

### Split Oversized App Surfaces - Initial Extraction Pass

- Moved chat image attachment preview lifecycle and direct/group image send state into focused hook/helper modules.
- Moved Chat wallet header rendering, menu actions, and shared wallet display labels into a focused hook while preserving page-specific wallet defaults.
- Moved P2P wallet header rendering, menu actions, app-wallet switching, and readiness display assembly into a focused hook.
- Moved P2P route parsing, route sync, trade-link input parsing, and trade navigation helpers into a focused hook with parser coverage.
- Moved P2P public/my/detail trade refresh state, loading/error state, refresh queuing, and route-detail loading into a focused data hook.
- Moved P2P existing-trade write handlers for accept, partial fill, cancel, and decline into a focused action hook.
- Moved P2P create/edit/counter composer action orchestration into a focused hook while keeping the current routes and form behavior intact.
- Moved P2P trade token metadata, verified/custom token loading, balance refresh, and escrow fee prefetch into a focused hook.

### Consolidate Wallet/Session Logic - Initial Pass

- Added a page-neutral wallet session model and shared wallet header/readiness helpers used by Chat, Trades, and Shield.
- Chat and Trades now derive AES readiness, network status, mode labels, primary wallet labels, and wallet status tones from shared logic.
- Moved P2P wallet disconnect cleanup into `useP2PWalletDisconnect`, preserving connected-session handoff rules and existing wallet defaults.
- Moved P2P trade signer resolution into `useP2PTradeSigner`, preserving app-wallet-first and browser-wallet fallback behavior.

### Consolidate Wallet/Session Logic - Vault Mutation Pass

- Moved app-wallet generation, import parsing, saved-wallet selection, encrypted vault upsert, and PIN re-save helpers into `src/lib/burnerWalletVault.ts`.
- Chat and Trades now use the same vault mutation helpers while keeping their page-specific wallet defaults and AES/funding behavior.
- Added focused coverage for saved app-wallet selection by id, address, and active-wallet fallback.

### Consolidate Wallet/Session Logic - Browser Wallet Discovery Pass

- Moved injected browser-wallet discovery and EIP-6963 provider announcement handling into `useInjectedWalletOptions`.
- Chat/shell wallet onboarding and the Trades page now share the same provider refresh behavior while keeping Trades' MetaMask/CipherTrade default.
- Removed the duplicated provider listener setup from `src/components/P2PTradingPage.tsx` and `src/hooks/useWalletOnboarding.ts`.

### Make Wallet/AES Readiness Easier To Understand

- Standardized header status wording and tones around `Disconnected`, `Wrong network`, `Privacy locked`, and `Ready`.
- Standardized primary next-action labels around `Connect wallet`, `Switch to COTI`, and `Unlock privacy`.
- Moved `Unlock privacy` into the wallet status indicator when privacy is locked, reducing one extra header chip while keeping the action visible.
- Shield now uses the same privacy wording as Chat and Trades.
- Secondary wallet choices stay in the header menu.
- Kept saved app-wallet selection in the separate switch control and made selection use the wallet address as a stable fallback for older vaults with regenerated wallet IDs.
- Kept the quick preferred browser-wallet chip visible, including the disconnected app-wallet-primary state in Trades, while removing that same wallet from the dropdown menu to avoid duplicate MetaMask/CipherTrade actions.

### Wallet/Session Convergence - Quick Action Coverage Pass

- Moved shared wallet quick-action and wallet-menu visibility decisions into `resolveWalletHeaderActionVisibility`.
- Chat and Trades now use the same helper for preferred browser quick actions, app-wallet switch/create actions, and duplicate menu filtering.
- Added focused tests for disconnected app-wallet-primary quick browser actions, connected app-wallet browser switch actions, duplicate menu filtering, saved app-wallet switch visibility, and app-wallet creation visibility.

### Wallet UX Regression Coverage - App Shell Policy Pass

- Added an app-shell wallet policy helper for each route so wallet controls and page defaults are explicit and testable.
- `App.tsx` now uses that policy when deciding whether to render Chat, Trades, or no header wallet controls.
- Added tests that Home and Treasury stay wallet-free, Chat and Shield stay app-wallet focused, Trades stays browser-wallet focused, and connected wallet sessions are preserved across app routes.

### Wallet UX Regression Coverage - Browser Smoke Pass

- Added Playwright browser smoke tests for the route wallet header policy.
- Browser smoke now checks that Home and Treasury stay wallet-free, Chat and Shield show app-wallet controls, and Trades shows the wallet header without duplicating the preferred browser wallet action in the menu.
- Browser smoke also covers route aliases: `/home` stays wallet-free and `/swap` keeps Shield's app-wallet-focused header behavior.
- Added `npm run test:browser` for focused browser verification.

### Wallet UX Regression Coverage - Saved App Wallet Pass

- Moved saved app-wallet switch option modeling into a shared helper used by Chat and Trades.
- Added coverage that the active app wallet stays disabled while other saved app wallets remain selectable by address.
- Covered the zero-balance COTI onboarding error through the shared insufficient-funds matcher, and reused that matcher in Chat and Trades app-wallet onboarding paths.
- Plain app-wallet reconnect now defaults to the first saved app wallet, while the saved-wallet chooser remains available for selecting a different saved wallet after disconnect.

### UX Polish - Mobile Browser Smoke Pass

- Added mobile Playwright smoke checks for the Chat wallet header, P2P wallet header, P2P trade tabs, and Treasury metric/window controls.
- Added a horizontal-overflow guard so mobile layout regressions are caught before they ship.
- Kept this pass to verification guardrails only; no app routes, wallet defaults, Supabase behavior, or card semantics changed.

### Trading Dashboard Clarity - Initial Pass

- Normalized trade order labels so cards use "You sell", "You buy", and "Buyer pays" consistently across P2P, detail, and in-chat surfaces.
- Kept reversible price-ratio controls compact so cards show the ratio without extra explanatory copy.
- Shortened maker edit actions to `Edit` while preserving existing buy, private fill, counter, refuse, and cancel flows.
- Removed the extra maker list open action because the card already exposes edit, copy, reveal, and cancel actions directly.
- Expanded history cards with created time, outcome, fill summary, and trade type details inline.

### Accessibility And Keyboard Polish - Initial Pass

- Replaced compact `+` and `R` message actions with accessible icon buttons in a shared message action component.
- Reaction pickers now support Escape-to-close, Tab wrapping inside the emoji picker, and focus restoration to the React button.
- Image thumbnails now open from a keyboard-focusable button, the lightbox focuses its Close button, Escape closes it, and focus returns to the thumbnail.
- Mobile group tools now expose dialog semantics and restore focus to the trigger when closed with Escape.

### Treasury UX

- Treasury remains read-only.
- Preserved partial source failures from the dashboard loader so the UI can show degraded states without losing usable data.
- Treasury remains route-lazy and now prefetches from the Home Treasury button on hover/focus.
- Added cached Treasury module/data preloading so quick opens can reuse warmed route and dashboard work.
- Removed the verbose live/saved/onchain source-status strip after UX review to keep the page quieter.

### Perceived Load Time - Route And Bundle Pass

- Kept Treasury route-lazy and moved route preloading to explicit Home hover/focus intent for Chat, Trades, Shield, and Treasury.
- Added compact route skeleton fallbacks for Trades, Shield, and Treasury instead of plain loading text.
- Added a quiet Treasury chart skeleton for the data-loading state without reintroducing verbose source-status panels.
- Deferred Supabase client loading until encrypted image upload/download is actually needed, keeping image storage limited to chat attachments.

### Supabase Image Attachment UX

- Supabase remains limited to encrypted chat image attachments.
- Implemented composer previews, clearer upload/load/decrypt/size errors, expired-image copy, and retry for failed image loads.
- Added retry from the composer preview for failed encrypted image sends in direct and group chat, without retrying invalid file selections.

### Empty, Loading, And Error States - P2P Initial Pass

- Added action-oriented P2P market states for loading, refresh failures, no public offers, and no search matches.
- Added trade-window recovery actions for failed trade loads, private-link-required states, and empty trade-link input states.
- Added My Trades loading/error/empty states with retry, connect-wallet, clear-search, and create-trade actions where appropriate.

### Empty, Loading, And Error States - Chat, Shield, And Treasury Pass

- Chat no-wallet and no-selection placeholders now use clearer title/copy without adding extra controls.
- Direct and group empty message states now explain the next action and keep to one safe sync/refresh button.
- Shield now shows compact readiness states for wallet needed, wrong network, privacy locked, loading balances, and unavailable quotes.
- Treasury chart failures and empty data states now show clearer retry cards, and the recent snapshots table handles no rows explicitly.
- Button additions were kept minimal for this pass: only sync, refresh, or retry where the app already has a safe refresh path.

### Group Sync Speed - Initial Pass

- Added shared group sync planning helpers for pending option merging and block cursor range calculation.
- Preserved active-message-only deep backfills so opening a group no longer forces a full deep overview sync.
- Added a separate active-group member-event cursor alongside the existing overview and message cursors.
- Active group backfills now fetch member system events through the scoped active-group path.
- Added focused tests for overview-only planning, active-message-only deep backfill planning, caught-up cursors, incremental ranges, and first-open wide-load ranges.

### Group Sync Speed - Event Planning Pass

- Moved group event id extraction, removal-event marker selection, and realtime active-vs-overview sync selection into shared helpers.
- Covered invite/member/join-code-style overview logs, member removal marker ordering, and realtime active-group routing with focused tests.
- Kept group sync orchestration in `src/App.tsx` behaviorally unchanged while shrinking the untested decision logic inside it.

### Group Sync Speed - Loading Phase Helper Pass

- Moved active-group loading phase selection into `groupSyncPlan` so overview-only and prefetch syncs do not accidentally trigger message loading UI.
- Added focused tests for initial active-message loads, history loads, deep active-group sync, overview-only sync, prefetch sync, and pending-load matching.
- Kept runtime behavior unchanged while reducing another small piece of group sync orchestration inside `src/App.tsx`.

### Group Sync Speed - Prefetch And Backfill Planning Pass

- Moved group prefetch cache-key and sync-option planning into `groupSyncPlan`.
- Moved active-group first-open fast-sync/deep-backfill planning into `groupSyncPlan`.
- Added focused tests for prefetch cache versions, duplicate prefetch skips, readiness guards, first-open deep backfill, and repeat-open fast sync.

### Direct Chat Sync Planning Pass

- Moved pending direct-sync option merging into `directSyncPlan`.
- Moved direct sync block-range calculation and older-history pagination range calculation into tested helpers.
- Added focused tests for deep sync, incremental head sync, caught-up explicit ranges, pending range widening, and older-message pagination before the earliest cached message.

### Sync Speed - Active Thread Completion Pass

- Direct-chat realtime events now prefer the open conversation when the changed event matches the active contact, while non-active events update contact previews.
- Direct message sends, reactions, and tip notices now refresh the active conversation instead of kicking off broad message-stream work.
- Group sends and group reactions now refresh active messages only, while join-code/admin actions stay on overview/member sync paths.
- The post-overview active group refresh now reuses the fast active-group helper with separate message and member cursors instead of duplicating wider scans.
- Group loading labels now distinguish catching up from loading older history with shorter copy.

### Internal Chat Link Navigation And Group Link Parity

- Moved chat URL/link parsing into shared helpers and a shared message text renderer.
- Direct and group chat now both linkify HTTP(S) URLs and same-origin app trade links.
- Same-origin app links use app-shell navigation so internal trade links preserve wallet/session context.
- Modifier-click and new-tab behavior remain normal because only plain left-click internal links are intercepted.
- Private liquidity links pasted into group chat render as links only, matching direct chat behavior without creating trade cards.
