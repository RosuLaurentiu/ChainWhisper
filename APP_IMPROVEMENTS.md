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
- Continue extracting signer resolution, disconnect handling, and wallet vault mutation into a shared hook once the oversized page files are split.

#### Reduce initial and route bundle weight

- Current production build still shows large chunks for `coti-ethers`, `charts-vendor`, `web3-vendor`, `supabase-vendor`, and the main `index` chunk.
- Audit broad imports from `src/lib/appShared.ts`; direct imports from narrower modules can avoid pulling parsers, ABIs, provider helpers, and unrelated constants into routes that do not need them.
- Keep Recharts isolated to the Treasury route and Supabase/image logic isolated to image attachment flows.
- Consider preloading route chunks on Home hover/focus for Chat, Trades, Shield, and Treasury to improve perceived navigation speed without changing route behavior.

#### Improve group sync speed

- Group sync still does wider scans than direct chat and is called out as slower.
- Add tighter per-group block cursors and cache separate overview/member/message ranges so opening one group does not force unnecessary overview work.
- Prefer active-group incremental message fetches after WS `GroupMessageSubmitted`/`GroupMessageDelivered` events, with deep backfill only when entering a group or cache gaps are detected.
- Add tests around overview-only sync, active-messages-only sync, and no-regression behavior for group invites/join codes.

#### Harden trade identity and sensitive storage

- Continue keying private liquidity, links, fetches, and UI state by `buildTradeSnapshotKey(tradeId, escrowContract)`.
- Add a visible "clear saved trade links/secrets" affordance in the P2P wallet or settings area.
- Prefer removing persistent local storage for trade access secrets once maker recovery can be handled through encrypted on-chain metadata.
- See `SMART_CONTRACT_IMPROVEMENTS.md` for the encrypted maker recovery note proposal.
- Add tests that private liquidity public/detail views never expose hidden amounts or fill amounts.

### Medium Impact

#### Preserve app context for internal trade links

- Direct chat renders `/trades/l/...` links, but anchors can still trigger normal browser navigation behavior depending on how the user opens them.
- Add an internal navigation helper for same-origin app links so wallet/session state is preserved when opening trade links from chat.
- Mirror this behavior in group chat once group link rendering is added.

#### Add group-chat link rendering parity

- Direct chat linkifies HTTP(S) URLs and internal trade links; group chat currently displays message text more plainly.
- Share the direct-chat link renderer or move it to a small helper component.
- Ensure pasted private liquidity links render only as links, not as auto-posted trade cards.

#### Expand focused test coverage

- Routing: canonical route paths and aliases for `/`, `/home`, `/chat`, `/shield`, `/swap`, `/trades/...`, and `/treasury-data`.
- Trade links: compact code parsing with escrow contract hints, legacy IDs, full URLs, and GitHub Pages redirect query handling.
- Wallet behavior: saved app wallet preference, browser wallet preference, Brave filtering, and preserving connected sessions across route changes.
- Private liquidity: public explorer/detail privacy, maker-only reveal, partial fill labels, and contract-local trade IDs.
- Chat sync: global read-state timestamp behavior, restore cache, hidden/muted conversation state, and group overview/active-message sync.

#### Improve empty, loading, and error states

- Give each page more specific empty states for first-run setup, no wallet, no AES, no COTI network, no public trades, no group messages, and unavailable treasury feeds.
- Keep messages short and action-oriented: connect, unlock AES, switch network, refresh, open My Trades, or create a trade.
- Add consistent retry buttons where the app already has a safe refresh action.

### Polish

#### Trading dashboard follow-ups

- Keep public/private liquidity cards focused on direction and price ratio.
- Consider a subtle icon-only flip affordance if users miss that the ratio can be reversed.
- Revisit market-style order headlines such as `Buy WISP at 2 COTI/WISP` only after the wording is designed end-to-end across composer, explorer cards, detail cards, and in-chat cards. The first attempt added too much explanatory text and was reverted.

#### Accessibility and keyboard follow-ups

- Continue using `aria-live` for syncing, sending, and loading states.
- Keep Escape-to-close behavior for menus, details, image lightbox, and modals.
- Continue checking focus restoration when new popovers or dialogs are added.

#### Supabase image attachment follow-ups

- Keep Supabase usage limited to encrypted chat image attachments.
- Consider upload progress, cancel/retry before send, and image compression if larger attachments become common.

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

### Make Wallet/AES Readiness Easier To Understand

- Standardized header status wording and tones around `Disconnected`, `Wrong network`, `Privacy locked`, and `Ready`.
- Standardized primary next-action labels around `Connect wallet`, `Switch to COTI`, and `Unlock privacy`.
- Moved `Unlock privacy` into the wallet status indicator when privacy is locked, reducing one extra header chip while keeping the action visible.
- Shield now uses the same privacy wording as Chat and Trades.
- Secondary wallet choices stay in the header menu.

### Trading Dashboard Clarity - Initial Pass

- Normalized trade order labels so cards use "You sell", "You buy", and "Buyer pays" consistently across P2P, detail, and in-chat surfaces.
- Kept reversible price-ratio controls compact so cards show the ratio without extra explanatory copy.
- Shortened maker edit actions to `Edit` while preserving existing buy, private fill, counter, refuse, and cancel flows.

### Accessibility And Keyboard Polish - Initial Pass

- Replaced compact `+` and `R` message actions with accessible icon buttons in a shared message action component.
- Reaction pickers now support Escape-to-close, Tab wrapping inside the emoji picker, and focus restoration to the React button.
- Image thumbnails now open from a keyboard-focusable button, the lightbox focuses its Close button, Escape closes it, and focus returns to the thumbnail.
- Mobile group tools now expose dialog semantics and restore focus to the trigger when closed with Escape.

### Treasury UX

- Treasury remains read-only.
- Added independent status cards for live totals, saved snapshots, and onchain references.
- Preserved partial source failures from the dashboard loader so the UI can show degraded states without losing usable data.
- Treasury remains route-lazy and now prefetches from the Home Treasury button on hover/focus.
- Added cached Treasury module/data preloading so quick opens can reuse warmed route and dashboard work.

### Supabase Image Attachment UX

- Supabase remains limited to encrypted chat image attachments.
- Implemented composer previews, clearer upload/load/decrypt/size errors, expired-image copy, and retry for failed image loads.
