# ChainWhisper App Improvements And Optimizations

This file tracks proposals from a deep read of the current ChainWhisper app. It is advisory only: no runtime APIs, schemas, contract calls, or routes are changed by this document.

## Active Backlog

### High Impact

#### Continue splitting oversized app surfaces

- `src/App.tsx` still owns app shell routing, wallet session orchestration, chat sync, group sync, read-state backup, token balances, trade actions, modals, and page rendering.
- Continue extracting cohesive hooks or components where they reduce risk and match the existing app boundaries.
- Good next extraction targets: chat trade actions, group admin/actions, realtime subscription setup, and remaining page-local wallet session mutation.
- `src/components/P2PTradingPage.tsx` still owns wallet vault/AES onboarding, composer form state, and dense view rendering.
- Continue splitting P2P into wallet session, composer state, and view components.
- `src/styles.css` is over 10k lines. Split by shell/chat/trades/swap/treasury/shared tokens to reduce accidental style regressions.

#### Continue wallet/session consolidation

- Keep page-specific defaults: Chat and Shield prefer app wallets; Trades prefers MetaMask/CipherTrade; Home and Treasury stay wallet-free.
- Preserve the rule that navigating between apps never disconnects or re-prompts an already connected wallet.
- Continue extracting remaining page-local wallet session state into shared hooks once the oversized page files are split further.

#### Reduce initial and route bundle weight

- Current production build still shows large chunks for `coti-ethers`, `charts-vendor`, `web3-vendor`, `supabase-vendor`, and the main `index` chunk.
- Audit broad imports from `src/lib/appShared.ts`; direct imports from narrower modules can avoid pulling parsers, ABIs, provider helpers, and unrelated constants into routes that do not need them.
- Keep Recharts isolated to the Treasury route and Supabase/image logic isolated to image attachment flows.
- Consider preloading route chunks on Home hover/focus for Chat, Trades, Shield, and Treasury to improve perceived navigation speed without changing route behavior.

#### Continue group sync speed hardening

- Keep group sync split between overview, active-message, and active-member ranges as more group features are added.
- Add broader integration tests around full group invite and join-code user flows once contract mocking is available.
- Continue moving remaining contract-read and merge orchestration out of `src/App.tsx` in small helper-backed steps.

#### Harden trade identity and sensitive storage

- Continue keying private liquidity, links, fetches, and UI state by `buildTradeSnapshotKey(tradeId, escrowContract)`.
- Add a visible "clear saved trade links/secrets" affordance in the P2P wallet or settings area.
- Prefer removing persistent local storage for trade access secrets once maker recovery can be handled through encrypted on-chain metadata.
- See `SMART_CONTRACT_IMPROVEMENTS.md` for the encrypted maker recovery note proposal.
- Add tests that private liquidity public/detail views never expose hidden amounts or fill amounts.

### Medium Impact

#### Expand focused test coverage

- Routing: canonical route paths and aliases for `/`, `/home`, `/chat`, `/shield`, `/swap`, `/trades/...`, and `/treasury-data`.
- Trade links: compact code parsing with escrow contract hints, legacy IDs, full URLs, and GitHub Pages redirect query handling.
- Wallet behavior: saved app wallet preference, browser wallet preference, Brave filtering, and preserving connected sessions across route changes.
- Private liquidity: public explorer/detail privacy, maker-only reveal, partial fill labels, and contract-local trade IDs.
- Chat sync: global read-state timestamp behavior, restore cache, hidden/muted conversation state, and group overview/active-message sync.

### Polish


#### Accessibility and keyboard follow-ups

- Continue using `aria-live` for syncing, sending, and loading states.
- Keep Escape-to-close behavior for menus, details, image lightbox, and modals.
- Continue checking focus restoration when new popovers or dialogs are added.

#### Supabase image attachment follow-ups

- Keep Supabase usage limited to encrypted chat image attachments.
- Consider upload progress, cancel before send, and image compression if larger attachments become common.

#### Documentation hygiene

- Keep `README.md` focused on current user/developer setup.
- Keep `AGENTS.md` focused on rules future agents must preserve.
- Keep this file as the proposal backlog, updating priorities as improvements are implemented.

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

### Internal Chat Link Navigation And Group Link Parity

- Moved chat URL/link parsing into shared helpers and a shared message text renderer.
- Direct and group chat now both linkify HTTP(S) URLs and same-origin app trade links.
- Same-origin app links use app-shell navigation so internal trade links preserve wallet/session context.
- Modifier-click and new-tab behavior remain normal because only plain left-click internal links are intercepted.
- Private liquidity links pasted into group chat render as links only, matching direct chat behavior without creating trade cards.
