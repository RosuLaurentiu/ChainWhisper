# ChainWhisper Trading UX/UI — design QA

## Final status

The approved Trading design family has been implemented and browser-verified.
The earlier rejected pass is superseded by the evidence in this file.

## DEX/P2P market-row parity - 2026-08-30

- Source references: `codex-clipboard-e99da504-6a51-4f78-be80-5b9423d1d80c.png` and `codex-clipboard-25052cea-0e1c-46d8-b8f8-8e4f03947e71.png`.
- Implementation evidence: `trading-smooth-dex-positions.png`, `trading-smooth-p2p-offers.png`, and `pair-selector-reference-final.png` in the session visualizations directory.
- The remaining mismatch came from DEX-only full-height, background, and right-padding rules. Removing those rules makes DEX use the shared market-row layout.
- At `2560 x 1440`, both product bars are `76px` high. The pair pickers match at `x=22`, `y=76.5`, `298 x 56`; the token icons match at `x=22`, `y=88`, `33 x 33`. Ratio, change, and product-switch coordinates also match.
- At `390 x 844`, both first token icons start at `x=9`, `y=147`, with no positive horizontal overflow. No console errors were recorded.
- The in-app Browser connection failed because the Windows sandbox could not apply read ACLs; the previously approved Playwright fallback was used.

Final result: passed.

## Shared P2P filter and DEX/P2P frame alignment - 2026-08-30

- Source references: `codex-clipboard-51d59dca-4def-4cbc-a284-96caea10ec48.png`, `codex-clipboard-99c63ca0-8eb4-4022-87c4-31754a585974.png`, `codex-clipboard-19cf2a4f-7b2f-4ff2-b2c8-e2f6dea2534e.png`, and `codex-clipboard-9cb723d1-e9a6-4828-9090-207c40207740.png`.
- Implementation evidence: `trading-smooth-p2p-offers.png`, `trading-smooth-p2p-create.png`, `trading-smooth-dex-positions.png`, and `trading-smooth-p2p-offers-390.png`. Side-by-side comparisons: `comparison-p2p-offers.png` and `comparison-dex-positions.png`.
- P2P Offers and Create now use the same compact offer-type filter. The redundant offer search is removed; the shared pair selector remains the market scope control.
- Offers, Create, and My trades now use the same `720 x 58` right navigation geometry at `x=1778.8125`, `y=143`. Their lists and terminals start at `y=201`, with no route-specific 8px shift.
- Filter interaction proof: type changed from `all` to `recurring`, the summary updated, Clear restored `all`, and the Offers filter contains zero search inputs. The same filter remains visible on Create.
- Desktop and `390 x 844` mobile have no positive horizontal overflow and no console errors. The in-app Browser connection failed because the Windows sandbox could not apply read ACLs; the previously approved Playwright fallback was used.
- Automated verification: Trading tests passed `644/644`; ESLint and the production build passed.

Final result: passed.

## Right-column DEX navigation and Trading alignment - 2026-08-30

- Source references: `codex-clipboard-26f17815-5b0a-4f2c-a2da-b80578022668.png`, `codex-clipboard-346266e6-6b48-42d2-9502-64561c810a39.png`, `codex-clipboard-861abc20-4e67-4e1f-85af-574d72e3a601.png`, `codex-clipboard-0276a52e-49ae-41bd-9754-e52b1c62f47a.png`, and `codex-clipboard-cb13a504-65b1-41d0-a001-c521b978423f.png`.
- Implementation evidence: `trading-smooth-p2p-offers.png`, `trading-smooth-p2p-create.png`, `trading-smooth-p2p-mine.png`, `trading-smooth-dex-positions.png`, and `trading-smooth-p2p-offers-390.png` in the session visualizations directory.
- The DEX outer navigation layer is limited to the right workspace. At `2560 x 1440`, it starts at `x=1778.8125`, has a width of `771.1875`, and contains the unchanged `720px` tab control plus the shared right gutter.
- P2P Offers and Create use the open left side of the navigation row for search and filters. Their list and terminal coordinates remain stable during route changes.
- The stray pair-row left divider is removed. Desktop and `390 x 844` mobile have no positive horizontal overflow and no console errors.
- Automated verification: Trading tests passed `644/644`; ESLint and the production build passed.

Final result: passed.

## Positions list and stable P2P terminals - 2026-08-30

- Source references: `codex-clipboard-da585e8f-5090-4ff5-9acc-c4f5d4031eeb.png`, `codex-clipboard-04892486-b926-4415-a9e2-43aafb363d4d.png`, `codex-clipboard-b1223dff-ac07-455d-8831-306747cc69cc.png`, and `codex-clipboard-78529198-2f57-4841-96ac-8328fef216a3.png`.
- Implementation evidence: `trading-final-positions.png`, `trading-final-p2p-offers.png`, `trading-final-p2p-create.png`, and `trading-final-p2p-mine.png` in the session visualizations directory. Captures use a `2560 x 1440` CSS viewport and device scale factor 1.
- DEX Positions now uses a positions list on the left and a fixed management terminal on the right. The market chart does not render on this page. Selection is explicit; the empty terminal asks the user to select a position.
- On desktop, selecting a position keeps the list visible and opens management on the right. On `390 x 844`, the detail replaces the list and includes Back to positions.
- P2P Offers, Create, and My trades share the same right-column coordinates: `x=1779`, `y=210`, `width=720` at the verification viewport. Only terminal content changes during navigation.
- Offers and Create preserve the same left workspace and content edge. The final 8px alignment correction removes the remaining vertical jump.
- All checked desktop and mobile routes have zero horizontal document overflow and zero console errors.
- Automated verification: DEX V2 80/80, Trading 644/644, Wallet 233/233, ESLint, and production build passed.

Final result: passed.

## Equal Swap and Strategies proportions - 2026-08-30

- Source visual truth: `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-ad4137cf-784e-48ba-b934-747d6fabeaf4.png` (1784 x 1310) and `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-75cbb223-8fe3-4a44-82f2-c2a15e913086.png` (1467 x 1310).
- Implementation evidence: `chainwhisper-equal-columns-swap.jpg` and `chainwhisper-equal-columns-strategies.jpg` (2559 x 1313 CSS viewport, device scale 1). Combined comparison: `chainwhisper-equal-columns-comparison.jpg`.
- State: connected-wallet references compared with the same cwTPB/cwTPQ DEX views in the local preview. Wallet state differs in the headless capture, but the Trading frame, navigation, chart, and right workspace are directly comparable.
- Earlier P2 finding: Swap and Strategies used different grid ratios. The chart ended at x=1791.31 on Swap and x=1599.92 on Strategies, which caused a visible width jump during navigation.
- Fix: both pages now use the same `minmax(0, 1fr) clamp(560px, 42vw, 720px)` desktop grid. This reaches the intended 720px workspace at normal wide-desktop viewports instead of shrinking to about 605px at the user's width.
- Follow-up source: `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-0975e572-a5d4-4bb0-a107-f9a9531ae871.png` (1043 x 1310). Same-size before/after comparison: `chainwhisper-stable-720-comparison.jpg`.
- Post-fix evidence: at 2160px, Swap and Strategies both use a 720px right workspace and a 1353.63px chart. At 2559px, both use a 720px workspace and a 1736.66px chart. At 1440px, both use the same responsive 604.8px workspace without overflow.
- Focused comparison: the combined image confirms equal chart and right-workspace boundaries. Typography, colors, existing assets, copy, control states, and mobile rules are unchanged.
- Interaction proof: clicking Strategies from Swap changed the route to `/dex/strategies`; the measured boundaries stayed fixed. No console errors, framework overlay, document overflow, or clipped controls were present.

Final result: passed.

## P2P Offers terminal and Create ticket alignment - 2026-08-30

- Source visual truth: the approved DEX Swap composer in `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-0975e572-a5d4-4bb0-a107-f9a9531ae871.png` and the user requirement to keep the existing P2P Offers list without adding a chart.
- Implementation evidence: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/chainwhisper-p2p-offers-terminal.png` and `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/chainwhisper-p2p-create-ticket.png`, captured at a `2160 x 1310` CSS viewport with device scale factor 1.
- Offers keeps the existing list in the main column. The desktop Trade terminal is always visible in a fixed 720 px right column and changes to the selected offer after an explicit action. No P2P chart canvas was added.
- Create uses the same 720 px right-side ticket width. The sell and buy amount sections are stacked in the same reading order as the DEX composer.
- Desktop terminal right edge is 2116.8 px, which preserves the shared outer gutter. The page has no horizontal document overflow and no console errors.
- At `390 x 844`, Offers remains a single list view, the persistent terminal is absent, and horizontal overflow is zero.
- Interaction proof: the focused Playwright spec verified the persistent desktop terminal, the unchanged mobile list, and the existing Offers/Create/My trades route flow. The in-app browser helper was unavailable because its Windows sandbox helper could not apply read ACLs, so the previously approved local Playwright fallback was used.
- Automated checks: focused browser tests passed 3/3; Trading tests passed 644/644; ESLint passed; the production build passed.

Final result: passed.

## Shared Trading page frame - 2026-08-30

- Source references: `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-1ab69a94-690d-4722-805f-faa65e546fd7.png` and `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-9894f8eb-8a64-4ebf-a203-5bc4db85d2c4.png`.
- DEX and P2P now use one full-width desktop page frame with a shared responsive 28-52px content gutter. The navigation remains 720 x 46 and is positioned 28px from the viewport's right edge.
- Verified routes: Swap, Strategies, Positions, DEX Agent, Offers, Create, My trades, and P2P Agent. At 2559 x 1313, primary content starts at x=51.17 and has a width of 2456.66px; the navigation starts at x=1811 and ends at x=2531.
- The labels remain product-specific: `Swap / Strategies / Positions / Agent` for DEX and `Offers / Create / My trades / Agent` for P2P.
- The container, button geometry, typography, hover, selected, and keyboard-focus treatments are shared. No tab clips or requires horizontal scrolling.
- Desktop and 390 x 844 mobile have no document overflow. The Offers-to-Create interaction changed the route to `/otc/limit`, and browser console errors were zero.
- Follow-up correction: the centered 1920px frame was rejected because it moved the navigation without fixing the different page-width caps. The final change removes those DEX and P2P caps at the shared frame level. All four labels are visible and the navigation has no internal overflow (`clientWidth=scrollWidth=718`).
- Trading regression: 644/644 passed. ESLint and the TypeScript/Vite production build passed.

Final result: passed.

## Locked references

- DEX desktop baseline: `design-audit/approved-dex-desktop-baseline.png`
- Swap protection states: `design-audit/dex-swap-review-v4-price-protection.png` and `design-audit/dex-swap-review-v4b-exact-price-state.png`
- Pool states: `design-audit/dex-strategies-pool-full-range-review-v5.png`, `design-audit/dex-strategies-pool-preset-range-review-v5.png`, and `design-audit/dex-strategies-pool-custom-range-review-v5.png`
- Limit visual family: `design-audit/dex-strategies-limit-review-v1.png`
- Mobile P2P Offers: `design-audit/approved-p2p-mobile-offers-baseline.png`
- Mental-model contract: `design-audit/trading-mental-model-spec.md`
- Wallet utilities source: `C:/Users/rosu_/.codex/generated_images/01a02b75-c54b-73f3-9207-ec729d5c6e8c/exec-92c615e9-dff0-4428-987a-7c45f5a58c6c.png`, with the user's explicit correction that the extra standalone chevron is a generation artifact and must not be implemented.
- Normalized wallet source used for comparison: `design-audit/wallet-menu-approved-source-normalized.jpg`.

## Playwright evidence

Playwright was explicitly approved by the user and run against the local app at
the exact target viewports:

- Desktop: `1486 × 1059`
- Mobile: `414 × 863`

The current capture suite covers Swap, Pool Full Range, Pool preset, Pool
Custom, Limit, Recurring, Positions, and the P2P Offers, Trade review, Create,
and My trades surfaces across desktop and mobile. It also covers Offers loading,
load-error, filtered-empty, true-empty, no-reference, stale-selection, and
reversed-ratio chart states. Trade review additionally covers wallet-confirmation,
on-chain pending, confirmed, failed-before-submission, and submitted-but-uncertain
feedback on desktop, plus uncertain-outcome recovery on mobile. Captures and the machine-readable report are in
`design-audit/qa-captures/`.

The durable mobile shell detail pack adds top states at 360, 390, and 430 px;
390 px scrolled, privacy-unlocking, privacy-ready, wallet-details, and
keyboard-open states; and equivalent P2P/DEX top and scrolled shell captures.
See `design-audit/mobile-shell-detail-pack.md`.

The whole-product capture suite now also verifies the connected shared header
on Chat and Privacy Portal at `360 × 800`, `390 × 844`, and `430 × 932`.
The address/copy, direct privacy-lock, and wallet-More controls remain one
38 px-high capsule, adjacent home/help controls do not overlap it, and the open
wallet menu remains inside the viewport. Fresh captures and the report are in
`design-audit/whole-product-captures/`.

Interaction assertions verify the complete direction invariant: reversing the
ratio relabels the same economic trade from Buy to Sell (or Sell to Buy) against
the new displayed base without changing spend/receive; choosing Buy/Sell then
reverses spend/receive without changing the selected ratio orientation. The
orientation persists through P2P Create and DEX Swap, Strategies, and Positions,
and private-link Trade review pre-fills the requested
maximum while stating that available liquidity fills and the remainder returns.
They also cover public, private-link, and direct-recipient audience semantics;
recurring private-liquidity controls; Active and History lifecycle groups with
Needs action and Made by me fast filters;
fresh direct-link entry; browser Back/Forward restoration; the compact privacy
lock; keyboard-open dock behavior; the semantic Whisper Line; Ratio Flip Motion;
and its reduced-motion fallback.
Responsive metrics also pass at `360 × 800`, `390 × 844`, `430 × 932`,
`768 × 1024`, `834 × 1194`, `1280 × 800`, `1440 × 1024`, and `1536 × 1024`.
Every viewport also verifies `viewport-fit=cover` so the existing safe-area
padding participates on edge-to-edge mobile browsers.

The clarified single-control invariant is now asserted directly: the shared
Trading bar contains the only ratio-reversal control, P2P Offers contains no
second pair/ratio picker or Pair filter, DEX Swap/Limit use one Buy/Sell control,
and fixed input/output tokens render as context rather than clickable selectors.

Reference-left / implementation-right comparisons are in
`design-audit/qa-comparisons/` for all locked visual references. The final
capture report records:

- exact viewport-sized pages;
- no horizontal overflow;
- no console or page errors;
- the mobile bottom navigation attached to the viewport;
- the compact connected-wallet address / privacy-lock / more-control state.

Populated P2P Offers and Positions use development-only `designQa` query
fixtures in the Playwright capture. They do not seed or replace production
orders, balances, or Position NFTs.

## Resolved findings

- P1 — Swap now defaults to Buy cwTPB, 900 cwTPQ, and an indicative 897.31
  cwTPB outcome, with Buy/Sell separate from ratio reversal.
- P1 — duplicate pair, ratio-reversal, token-selector, and direction-switch
  controls were removed; the shared Trading context is the single source of truth.
- P1 — ratio reversal now re-expresses the same trade everywhere: DEX Swap and
  Limit tabs, P2P Offers tabs and amount framing, Recurring legs, recurring
  position controls, protection inequality, units, and Carbon reference all
  invert together while the underlying spend/receive values remain unchanged.
- P1 — Swap protection now uses editable maximum slippage with the derived
  maximum/minimum price; exact price remains an advanced option.
- P1 — Pool Full Range hides bounds; concentrated presets and custom prices
  synchronize with the chart; fee tier remains independent.
- P1 — the shared Pool / Limit / Recurring selector sits above the creation
  composer and no longer pushes the composer down the desktop page.
- P1 — Limit uses a continuous price input, chart order line, signed market
  distance, and an honest preview-only review.
- P1 — Limit now names the economic action against the displayed base asset,
  presents one readable `1 base = price quote` equation, and separates Action
  from Fund in review. On mobile the composer appears before the supporting
  chart, keeping the order task reachable without a chart-length scroll.
- P1 — Recurring now expresses both economic legs as Buy/Sell of the currently
  displayed base asset, with persistent orientation, two charted prices, private
  inventories, and an honest preview-only review.
- P1 — Recurring is now explicitly presented as two reusable private limit
  orders, not a scheduler or one shaded range: spacing shortcuts lead to two
  directly editable prices, followed by the two private starting inventories
  and a clear fill-to-opposite-side explanation.
- P1 — Recurring now accepts one-sided or two-sided starting inventory as its
  copy promises, disables review only when both sides are empty, and relabels
  budget/inventory roles correctly in reversed-ratio review. The default screen
  stays focused while the repeated ratio explanation lives in Strategy summary.
- P1 — the Recurring chart now shows exactly two labeled strategy lines and no
  Active range fill. A future range-recurring mode is documented as a separate
  four-boundary design that is not supported by the current contract path.
- P1 — P2P offers are ordered around the Carbon market divider; the best rate
  depends on price and direction only.
- P1 — the optional P2P chart now contains a visible market-history line and a
  labeled horizontal selected-offer line on desktop and mobile. The current
  history is explicitly illustrative until the live Carbon history adapter is
  connected; Playwright rejects the former `not price history` placeholder copy.
- P1 — the market-divider insertion condition was corrected so worse offers
  remain above market and better offers remain below it.
- P1 — private-budget offers expose `Private`, not a fake public amount; public
  offers retain explicit availability.
- P1 — mobile Strategies and Positions now use stable vertical flows with no
  overlapping chart, selectors, or controls.
- P1 — Positions now labels its strategy shortcuts as explicit Create actions
  instead of ambiguous NFT/filter cards. Management rows prioritize lifecycle,
  privacy, ownership, and reveal; the secondary NFT-transfer form stays
  collapsed until requested and price context follows the shared orientation.
- P1 — P2P Create now uses the same fixed three-item mobile dock as Offers and
  My trades while retaining a single desktop navigation row.
- P1 — P2P Create restores a compact two-column sell/buy ticket on desktop while
  preserving the vertical mobile flow; My trades exposes New offer and Refresh
  as task actions above Received / Active / History.
- P1 — P2P Create now derives one explicit Buy/Sell selector from the shared
  ratio orientation and displays the shared pair as fixed amount-field labels;
  the repeated pair token selectors and duplicate middle flip control are gone.
- P2 — empty My trades groups now occupy the available workspace as an intentional
  focused state. Mobile removes the redundant header `New offer` action because
  the fixed Create destination remains visible at the bottom.
- P1 — the global Trading wallet-token amount strip and mobile balance sheet are
  removed; a quiet Contracts utility remains on desktop without competing with
  the current task.
- P2 — compact rate labels no longer repeat the pair basis inside every P2P row.
- P2 — mobile and desktop now use the agreed address, privacy-lock, and single
  More chevron capsule. Home remains a direct mobile action; network,
  notifications with sound, Help, and Disconnect live in the one wallet menu.
- P2 — the generated wallet drawing's extra standalone chevron was treated as
  an artifact. The implementation renders exactly one `.p2p-wallet-menu-trigger`,
  and no standalone notification or sound button remains beside the capsule.
- P1 — Chat and Privacy Portal now reuse that same compact connected-wallet
  capsule while preserving their useful home/help controls; layout-size
  transitions cannot temporarily stretch or overlap its three hit targets.
- P1 — Chat, Privacy Portal, P2P, and DEX now share one explicit header contract.
  Desktop measures the same `198 × 40` wallet capsule with `116 / 40 / 40`
  address, privacy, and More segments; mobile measures `168 × 38` with
  `94 / 36 / 36` segments. The address has no nested border, background, or
  shadow, while the capsule retains one outer border.
- P1 — DEX Positions and P2P trade management now use attached selected-object
  terminals with Overview / Activity tabs. Duplicate per-row management controls,
  the separate desktop history window, and the old mobile history trigger are removed.
- P1 — P2P Create now follows the shared creation rhythm used by DEX Strategies:
  type, intent/audience, terms, advanced details, then review. Audience choices
  span the available ticket width and retain a compact explanation of public,
  private-link, and direct access.
- P1 — the detail pass separates Activity eyebrow, event description, timestamp,
  and lifecycle chip into a readable hierarchy on desktop and mobile. Playwright
  now asserts those text rows do not overlap.
- P2 — empty My trades states and the desktop Recurring title were tightened so
  they preserve information without wasting vertical space or colliding with badges.
- P2 — Recharts animation is disabled for deterministic, complete order/range
  rendering during capture and reduced-motion use.
- P1 — the compact wallet menu is now fixed to safe-area-aware viewport insets;
  Playwright asserts that neither edge can leave the mobile viewport.
- P2 — the Home launcher now uses the agreed DEX/P2P name and describes the
  market-centered offer model instead of the retired OTC label.
- P2 — Chat's unselected desktop workspace now uses a compact, intentional task
  card rather than a full-canvas dashed placeholder. Its New chat action opens
  the existing Add contact / Create / Join dialog, and the page now has a
  persistent accessible heading.
- P1 — visible Trading language now consistently uses P2P across the shared
  header, Offers rows, Create composers, safety copy, Help, Agent sources, and
  product/legal descriptions. Exact historical `/otc` routes and OTC V2
  contract/deployment identifiers remain unchanged for compatibility and
  technical truth.
- P2 — the final cross-product refinement removes the last retired OTC wording
  from normal Counter and Recurring Create descriptions. Trade Agent now has a
  visible semantic page heading on desktop and mobile without changing its
  approved compact terminal styling.
- P1 — the final source-to-render fidelity pass found that the mobile shell had
  compressed DEX/P2P correctly but hidden the planned persistent pair/ratio
  context. The compact second row is restored with both token symbols, the full
  `1 base = price quote` equation, and the single ratio-reversal action. It
  remains visible at 360/390/430 px, while scrolled, and in both DEX and P2P.
- P1 — the mobile Trading shell now follows the approved scroll hierarchy rather
  than keeping every header row permanently visible. The owl/Home/wallet utility
  row leaves after the primary P2P or DEX workspace scrolls past 12 px; global
  navigation, DEX/P2P, pair/ratio context, reversal, and the workspace bottom
  dock remain stable. Top/scrolled comparisons are saved in
  `design-audit/completion-audit/07-mobile-p2p-top-left-scrolled-right.jpg` and
  `design-audit/completion-audit/08-mobile-dex-top-left-scrolled-right.jpg`.
- P2 — the P2P Trade review detail pass removes the redundant generic review
  banner and consolidates private-link access plus best-effort partial-fill
  behavior into one compact decision block. The fixed rate and unchanged
  pay/receive direction remain separate from the editable maximum amount. Mobile
  amount inputs and the primary action now retain at least 44 px target height.
  Before/after comparisons are saved as
  `design-audit/completion-audit/13-p2p-trade-review-mobile-before-left-after-right.jpg`
  and `design-audit/completion-audit/14-p2p-trade-review-desktop-before-left-after-right.jpg`.
- P2 — the P2P Create detail pass removes the repeated Access label/value and
  the implementation-oriented amount-privacy explanation from the default
  audience section. Each audience mode has one concise selected-state sentence;
  private-link contract readiness is one compact status row, and the signing
  safety check remains available inside collapsed Advanced options. The
  before/after comparison is
  `design-audit/completion-audit/17-p2p-create-detail-before-top-after-bottom.jpg`;
  private-link/direct states are in
  `design-audit/completion-audit/19-p2p-create-access-states.jpg`.
- P2 — the shared management detail pass keeps the same scan → select → manage
  rhythm without making DEX and P2P mechanically identical. P2P preserves pair
  scope, search, type, and sort, but its default zero-result Active view is now
  one concise state instead of two empty groups plus zero-count filters. DEX
  Positions retains lifecycle/type filters and the attached terminal while
  removing repeated current-pair and activated-deployment context already owned
  by the shared Trading header. Mobile My trades has a compact left-aligned
  header and a verified 44 px Refresh target. The rendered after-state is
  `design-audit/completion-audit/21-management-model-after-desktop-top-mobile-bottom.jpg`;
  the before/after comparison is
  `design-audit/completion-audit/22-management-model-before-left-after-right.jpg`.
- P1 — the DEX Positions mobile selection pass fixes a broken transition that
  changed the selected row without bringing its attached terminal into view.
  An explicit position tap now focuses and scrolls the Overview / Activity
  terminal directly beneath the persistent pair/ratio context; one 44 px
  `All positions` action returns to and focuses the selected row. This remains
  one inline workspace rather than opening a second page. The pass also restores
  the plan-required fixed DEX `Swap / Strategies / Positions` dock, including
  edge-to-edge safe-area placement, reserved content space, active-state
  continuity, and keyboard-aware hiding. The accepted three-step comparison is
  `design-audit/completion-audit/26-dex-positions-mobile-selection-flow.jpg`.
- P3 — Privacy Prism was accepted only as the existing restrained
  violet-to-cyan edge on private-link and private-capability states. A global
  encrypted texture was evaluated and deliberately not shipped because it
  reduced calm without improving task comprehension.

## Intentional implementation constraints

- Limit and Recurring continuous-price reviews do not request the wallet until
  matching contract paths are available.
- Pool selectable range and fee terms remain review-only while the current
  testnet Pool contract cannot execute them.
- A private P2P budget is not shown as an available amount. Fillable liquidity
  is discovered during execution; the available part fills and unused input is
  returned.
- Recurring and Positions have no separately locked final drawing. They were
  verified as sibling screens in the approved chart-led design system and are
  represented in the Playwright matrix for further product review.

## Wallet-menu focused comparison

- Source pixels: `1484 × 1060`; implementation pixels and CSS viewport:
  `1486 × 1059`; device scale factor: `1`. The source was also normalized to
  `700 × 500` only for a readable combined comparison; geometry was judged
  against the original near-matching desktop dimensions.
- State: connected wallet, P2P My trades, wallet utilities open, empty trade
  lifecycle content.
- Full-view evidence: `design-audit/qa-captures/desktop-wallet-utilities.png`.
  The approved hierarchy, dark-purple token family, compact top-right anchor,
  and one consolidated menu are retained without changing the trading shell.
- Focused evidence: `design-audit/qa-captures/mobile-shell-wallet-details-390.png`.
  The menu remains inside the 390 px viewport and the three wallet actions stay
  a single capsule: shortened address, privacy lock, and one More chevron.
- Typography: existing ChainWhisper font family, weights, compact labels, and
  muted secondary copy remain consistent with the approved trading UI.
- Spacing/layout: menu rows, separators, alignment, radii, and vertical rhythm
  match the source hierarchy; the implementation uses a slightly wider menu to
  preserve readable mobile labels without wrapping.
- Colors/tokens: existing purple, teal connected state, amber network warning,
  and red disconnect semantics are reused from the product tokens.
- Image/assets: the existing owl logo and the project's installed icon library
  are used; no placeholder, emoji, CSS-drawn, or replacement brand asset appears.
- Copy/content: the menu contains only Wallet utilities, Network,
  Notifications with Sound, Help, and Disconnect. It does not repeat the full
  wallet address, privacy unlock, balances, or wallet-provider choices.
- Comparison history: the earlier source drawing contained a second standalone
  chevron and the prior implementation retained a standalone sound bell. Both
  were removed. The post-fix desktop capture plus the Playwright assertions
  `singleWalletMoreControl: passed`, one menu trigger, and zero sound-toggle
  controls confirm the correction. No actionable P0, P1, or P2 finding remains.

## Automated verification

- Focused Trading regression suite: 644 passed in the final execution-feedback detail pass.
- Focused DEX/header/notification tests: 27 passed in the latest pass.
- Focused ESLint: passed.
- Production TypeScript/Vite build: passed.
- Playwright design-state matrix plus eight-viewport responsive checks: passed with
  zero console errors and zero horizontal overflow.
- Cross-page header geometry checks on Chat, Privacy Portal, P2P, and DEX pass
  on desktop and mobile, including exact segment adjacency and one outer border.
- Whole-product Playwright capture plus connected-header checks at 360/390/430:
  passed with zero console errors, zero horizontal overflow, aligned direct
  controls, an in-viewport wallet menu, a verified empty-Chat creation path,
  and a visible level-one Trade Agent heading on desktop and mobile.
- Mobile persistent pair-context regression: passed at the top and while
  scrolled in P2P, and after switching to DEX; the saved source-left/current-right
  comparison is `design-audit/completion-audit/01-p2p-offers-mobile-reference-left-current-right.jpg`.
- Mobile Trading scroll hierarchy: passed for both primary scroll owners. The
  application utility row is visible at top and hidden after scroll, while the
  global nav, DEX/P2P, pair/ratio equation, reversal action, and fixed bottom dock
  remain visible. P2P and DEX top/scrolled screenshots are in the completion audit.
- P2P Trade review detail checks: consolidated private-link/partial-fill summary
  visible, redundant generic warning absent, 500 cwTPB / 124 cwTPQ maximum prefill
  preserved, and both mobile amount inputs plus the primary action measure at
  least 44 px high. Wallet confirmation is distinct from submitted/pending;
  submitted confirmation timeouts remain an amber uncertain state with a
  persistent Dismiss recovery action rather than becoming a red failure. The
  mobile action is also geometrically asserted not to overlap the pay/receive grid.
- P2P Create detail checks: redundant default explanation absent; signing safety
  note hidden by default and visible after opening Advanced; public,
  private-link, and direct semantics preserved; private-link CTA remains disabled
  with contract activation pending; and all three mobile audience targets measure
  at least 44 px high.
- Shared management detail checks: the default P2P Active view has one empty
  state and no meaningless zero-count quick filters, mobile Refresh measures at
  least 44 px, and DEX Positions no longer repeats the activated deployment or
  block-number ownership context. Search/type/sort, pair scope, lifecycle tabs,
  position type filters, and attached terminals remain available.
- Populated P2P management checks: the deterministic QA state includes two
  Active and two History trades, exposes Needs action and Made by me only when
  useful, opens the selected trade in the attached Overview/Activity terminal,
  and returns to History without a second page model. On mobile, Back and every
  visible Open/Share/Manage action are at least 44 px; the first action can scroll
  completely above the fixed dock. Evidence is in
  `design-audit/completion-audit/57-p2p-my-trades-populated-desktop-flow.jpg` and
  `design-audit/completion-audit/58-p2p-my-trades-populated-mobile-flow.jpg`.
- Desktop populated-management geometry checks: Needs action and Made by me are
  two simultaneous columns at 901 px and above; each is at least 320 px wide.
  Every rendered rate and direction/progress block fits without internal text
  overflow, and all four Open/Share actions remain inside the visible workspace.
- DEX mobile selection checks: an explicit position tap focuses the attached
  terminal between 120–200 px from the viewport top, `All positions` restores
  focus to the selected row, and the fixed bottom dock stays attached to the
  visual viewport. The dock hides while the transfer field has a simulated
  software keyboard and returns after the keyboard closes.
- P2P Offers detail checks: the disconnected legacy public toolbar is absent,
  The ladder filter summary reports the three rendered rows, and search/type filtering is
  attached to the visible ladder. Desktop controls remain compact and visible;
  mobile uses one collapsed 44 px disclosure whose input, type selector, and
  reset control are each at least 44 px. Searching for offer 93 yields one row,
  recalculates the best-rate highlight from price only, and Reset restores the
  original market-price order.
- P2P Offers state-completeness checks: loading is announced with `aria-busy`;
  load failure offers Try again; a stale selected offer offers Clear selected
  offer; filtered-empty offers Clear filters; true-empty offers Create offer;
  and no-reference rows honestly report unavailable comparison. Mobile error
  and stale-recovery targets measure at least 44 px.
- Visual evidence: approved mobile reference/current implementation is
  design-audit/completion-audit/31-p2p-offers-mobile-approved-left-current-right.jpg;
  desktop before/after hierarchy is
  design-audit/completion-audit/32-p2p-offers-desktop-before-left-after-right.jpg.
- DEX Limit ratio checks: the default Buy cwTPB state and explicitly reversed
  Sell cwTPQ state preserve the same fund/receive flow, invert the displayed
  equation from 1.0050 cwTPQ per cwTPB to 0.9950 cwTPB per cwTPQ, and keep one
  chart limit line. Mobile Buy/Sell targets measure at least 44 px.
- DEX Recurring ratio checks: the same two underlying legs keep their prices and
  inventories while ratio reversal relabels them Sell cwTPQ / Buy cwTPQ. The
  semantic green Buy and magenta Sell treatments now follow those displayed
  labels in the composer, legend, and chart rather than remaining attached to
  the old canonical side. Both exact-price lines remain visible; no shaded range
  is introduced. Mobile spacing presets, price fields, and inventory fields
  measure at least 44 px.
- DEX strategy evidence: Limit approved/current is
  design-audit/completion-audit/47-dex-limit-approved-left-current-right.jpg;
  Limit default/reversed is
  design-audit/completion-audit/45-dex-limit-default-left-ratio-reversed-right.jpg;
  Recurring default/reversed is
  design-audit/completion-audit/46-dex-recurring-default-left-ratio-reversed-right.jpg.
- Whole-product product-owner review sheets:
  design-audit/completion-audit/54-trading-final-desktop-current.jpg and
  design-audit/completion-audit/55-trading-final-mobile-current.jpg. They
  contain the same fresh Playwright run for Swap, Pool, Limit, Recurring,
  Positions, Offers, Create, and My trades.
- P2P execution-feedback sheet:
  design-audit/completion-audit/56-p2p-execution-feedback-states.jpg.

final result: passed

## Wallet connecting-state refinement - 2026-08-30

**Source visual truth**
- User screenshot: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/wallet-connecting-reference.png`, `327 x 95` pixels.
- State: connected desktop header while MetaMask is connecting. The long provider label overlaps the privacy-lock control.

**Implementation evidence**
- Full page: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/wallet-connecting-full.png`, `2560 x 1440` pixels at a `2560 x 1440` CSS viewport and device scale factor 1.
- Focused implementation: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/wallet-connecting-implementation.png`, `327 x 95` pixels.
- Side-by-side comparison: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/wallet-connecting-comparison.png`, shown at natural density. No normalization was required.

**Findings and comparison history**
- P2: `Connecting MetaMask...` exceeded the primary-action width and collided with the adjacent lock. Fixed with the compact `Connecting...` label and the existing Lucide loading icon pattern.
- Post-fix measurements: the header panel remains `230 x 46` CSS pixels; the primary action is `148 x 44`; privacy and menu controls remain `40 x 44` each. The label fits and clears the privacy control.
- Full-view comparison: the global header height, wallet footprint, chart, terminal, and navigation positions are unchanged.
- Focused comparison: the loading icon and short label establish clear progress without obscuring the lock or chevron.

**Required fidelity surfaces**
- Typography: the existing header font, size, weight, and truncation behavior remain; the visible label now fits.
- Spacing and layout: the approved wallet-control footprint and adjacent control widths remain unchanged.
- Colors and tokens: the existing dark surface and purple state colors remain; the loader uses the established light-purple accent.
- Image and icon fidelity: the loading indicator uses the installed Lucide icon library. No raster or handcrafted icon was added.
- Copy and content: the visible copy is compact. `Connecting to MetaMask` remains in the title and accessible name.
- Accessibility: the primary action exposes `aria-busy=true`; reduced-motion users receive a static loading icon.

**Verification**
- Focused component tests: 5/5 passed.
- Browser-rendered check: label fits, controls do not overlap, no horizontal overflow, and zero console errors.
- The in-app Browser could not start because its Windows sandbox helper failed. The previously approved local Playwright fallback produced the evidence above.

final result: passed

## Integrated Trading market header and chart - 2026-08-30

**Source visual truth**
- `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-bda3f265-250a-42c6-b719-eb526f5dbf6c.png` (`2559 x 1313`): remove the redundant DEX chart titles and make the market row feel connected to the chart.
- `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-15d02b6a-616f-48a2-827b-a04364d47937.png` (`1725 x 538`): chart content must paint above the DEX navigation strip.
- `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-91e8cab6-a13c-4900-9e35-f920270eddf8.png` (`1732 x 1282`): pair and price must feel like part of the chart without changing the product language.

**Implementation evidence**
- DEX Swap: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/dex-market-integrated-swap-2560.png`, `2560 x 1440` pixels at a `2560 x 1440` CSS viewport and device scale factor 1.
- DEX Strategies: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/dex-market-integrated-strategies-2560.png`, same viewport and density.
- P2P Offers: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/p2p-market-integrated-offers-2560.png`, same viewport and density.
- Mobile: `dex-market-integrated-strategies-390.png` and `p2p-market-integrated-offers-390.png`, each at a `390 x 844` CSS viewport and device scale factor 1.
- Same-size DEX capture: `dex-market-integrated-pair-1732.png`, `1732 x 1282` pixels at a `1732 x 1282` CSS viewport and device scale factor 1.
- Combined source/implementation comparison: `dex-pair-chart-comparison.jpg`. Both halves use the same `1732 x 1282` source size and are scaled equally to `866 x 641`; no density correction was needed.
- Focused chart-header evidence: `dex-market-integrated-pair-focus.png` (`2560 x 360`) and `dex-market-above-nav-focus.png` (`2560 x 360`).

**State and findings**
- No actionable P0, P1, or P2 finding remains.
- Swap and Strategies have identical pair, chart, navigation, heading, and composer coordinates. At `2560 x 1440`, both charts are `1727.625 x 898` at `x=51.1875`, `y=143`.
- The DEX pair row now starts at the same `x=51.1875` edge as the chart. Pair, price, and 24-hour change use the chart surface color and shared divider rhythm. The DEX/P2P switch remains independent at the right.
- The chart header paints above the full-width navigation layer. The visible candle legend, latest value, period controls, and expand action stay inside the chart border.
- The redundant `DEX marginal history`, `Private Pool`, and visible P2P `Offers` headings are absent. Accessible chart and page names remain available to assistive technology.
- P2P keeps its existing Offers list and right trade terminal. Its navigation and order-book controls begin directly below the shared market context without a duplicate page title.

**Required fidelity surfaces**
- Fonts and typography: existing Space Grotesk and Inter families, weights, numeric alignment, truncation, and hierarchy are unchanged.
- Spacing and layout rhythm: pair and chart left edges match; chart and task navigation occupy one desktop row without clipping; Swap and Strategies remain coordinate-identical.
- Colors and visual tokens: existing dark chart surface, approved borders, purple active states, emerald positive state, and pink down candles remain unchanged.
- Image quality and assets: no image, logo, or icon asset was added, replaced, or approximated. Existing Lucide and product token icons remain.
- Copy and content: only redundant visible headings were removed. Market labels, controls, offers, and trade actions remain unchanged.

**Comparison history**
- P2: the chart originally started below an empty full-width navigation strip. It was raised by the shared navigation height while retaining its previous lower edge.
- P2: the raised chart header was clipped by the desktop main container and covered by the navigation paint layer. Desktop overflow is now visible at that boundary, and the chart uses the higher local paint order. Post-fix `elementsFromPoint` returns the chart legend above the navigation at the shared row.
- P2: pair and price started at a different left edge and read as a separate global strip. The DEX market row now aligns to the chart gutter and uses the chart surface for the pair, price, and change cells.
- P2: DEX and P2P repeated page names already communicated by navigation and context. The visible duplicates were removed; semantic labels remain.

**Verification**
- Primary interactions: Swap to Strategies, DEX to P2P Offers, desktop period controls present, and P2P list/terminal state rendered.
- Browser checks: zero console errors; desktop DEX and P2P have no horizontal document overflow; mobile DEX has no overflow and mobile P2P is exactly viewport width.
- Focused tests: `31/31` passed.
- ESLint: passed.
- TypeScript/Vite production build: passed.

final result: passed

## DEX Swap and Strategies transition alignment - 2026-08-30

**Source visual truth**
- Strategies: `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-2ad74355-0ba3-430e-8fab-afb09e745a67.png`, `2560 x 1440` pixels.
- Swap: `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-e0dd54a6-c091-461d-8175-b31806d8232c.png`, `2560 x 1440` pixels.
- The source images include `101px` of browser chrome. The normalized comparisons remove that chrome and compare `2560 x 1339` app regions at device scale factor 1.

**Implementation evidence**
- Swap: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/dex-smooth-swap-2560.png`, `2560 x 1440` pixels at a `2560 x 1440` CSS viewport and device scale factor 1.
- Strategies: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/dex-smooth-strategies-2560.png`, `2560 x 1440` pixels at the same viewport and density.
- Mobile Strategies: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/dex-smooth-strategies-390.png`, `390 x 844` pixels.
- Normalized full-view comparisons: `APP/design-audit/dex-smooth-swap-normalized-comparison.png` and `APP/design-audit/dex-smooth-strategies-normalized-comparison.png`, each `5120 x 1339` pixels with source on the left and implementation on the right.

**QA findings**
- Full view: Swap and Strategies now keep the same chart frame (`x 51.19`, `y 201`, `width 1727.63`, `height 840`) and the same top DEX navigation (`x 0`, `y 143`, `width 2550`, `height 58`).
- Focused right-column comparison: both headings start at `x 1807.81`, `y 217` and use `673 x 52`. Buy/Sell and Pool/Limit/Recurring both start at `x 1807.81`, `y 277` and use `673 x 46`. The first form section starts below the same control row.
- Typography: the existing Space Grotesk/Inter hierarchy is unchanged. Strategies now uses the same heading level and short supporting line as Swap.
- Spacing and layout rhythm: one stable right-column flex frame now owns the heading, secondary tabs, and strategy form. The chart no longer changes height when the page changes.
- Colors and tokens: the approved dark surface, border, purple active state, and emerald data colors are unchanged.
- Image and icon fidelity: no image, logo, or icon asset changed.
- Copy and content: `Create private strategy` gives the Strategies panel the same task-level context as `Buy cwTPB`; all existing strategy choices and fields remain.
- Responsive state: the `390 x 844` Strategies view has no horizontal document overflow. Desktop also has no overflow.
- Interaction and runtime: the browser check selected Strategies from Swap, waited for `/dex/strategies`, found zero console errors, and confirmed the fixed coordinates after navigation.

**Comparison history**
- P2: Strategies had no task heading, so its tabs and form started above the equivalent Swap controls. Fixed with one shared Strategies form column and a task heading.
- P2: the Strategies chart used a separate height rule. Fixed by using the same `840px` capped desktop chart rule as Swap.
- The post-fix normalized comparisons and coordinate check show no actionable P0, P1, or P2 difference in the shared frame.

**Automated verification**
- Focused DEX component tests: 15/15 passed.
- ESLint: passed.
- TypeScript/Vite production build: passed.

final result: passed

## DEX compact swap settings - 2026-08-30

- Source: `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-c576ab69-8374-4f05-ac56-c1423f4f1c8b.png`.
- Closed desktop: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/dex-swap-settings-desktop-closed.png`.
- Open desktop: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/dex-swap-settings-desktop-open.png`.
- Mobile states: `dex-swap-settings-mobile-closed.png` and `dex-swap-settings-mobile-open.png` in the same QA directory.
- Comparison: `dex-swap-settings-comparison.png` in the same QA directory.
- The closed card is two compact rows. It shows the active `0.50%` slippage and keeps all editing hidden.
- Advanced settings contains the custom numeric slippage input, the minimum-fill control, and exact-price mode. Minimum fill defaults to any available amount.
- The obsolete Route and pool details panel and its unused rendering code are absent. The obsolete mobile Privacy heading is also absent.
- Desktop and `390 x 844` browser checks passed with no document overflow or console errors. Custom `0.73%` input and the closed-by-default disclosure were verified.
- Focused DEX component tests: 15/15 passed. ESLint passed. Production build passed.

final result: passed

## P2P cross-page refinement pass - 2026-08-30

**Source visual truth**
- Existing four-page audit: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/p2p-audit-overview.png`.
- User-approved direction: refine Offers, Create, My trades, and Agent without changing the persistent Offers-list model or adding a chart.

**Implementation evidence**
- Desktop captures at `2160 x 1310`: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/p2p-refinement-pass/offers-desktop.png`, `create-desktop.png`, `my-trades-desktop.png`, and `agent-desktop.png`.
- Mobile captures at `390 x 844`: the matching `offers-mobile.png`, `create-mobile.png`, `my-trades-mobile.png`, and `agent-mobile.png` in the same directory.

**Resolved findings**
- Offers, Create, My trades, and Agent use the same `720 x 46` desktop navigation geometry at `x=1386.8125`, `y=149`.
- The persistent Offers terminal no longer draws an empty full-height column. It sizes to its content and keeps the approved right-column width.
- My trades keeps its page title, guidance, and New offer action when the wallet is disconnected.
- The Agent tool switch now uses the full shared content width with three equal controls. Its context column is narrower so the conversation keeps priority.
- Stable scrollbar space prevents horizontal page movement between short and long Trading pages.
- Desktop and mobile captures have zero document overflow and zero browser console errors.
- The in-app Browser was unavailable because its Windows sandbox helper could not apply read ACLs. The previously approved local Playwright fallback was used.

**Automated verification**
- P2P visual and geometry check: 4 pages across 2 viewports passed.
- Trading regression: 644/644 passed.
- ESLint: passed.
- TypeScript/Vite production build: passed.

final result: passed
# P2P Create task/type refinement — 2026-08-24

- The dynamic one-off/recurring heading is visible at desktop and mobile;
  desktop aligns task and type on one row.
- Both recurring side panels contain their complete price/liquidity content
  without internal overflow.
- Public, Private link, Direct proposal, and Recurring are captured in
  `design-audit/completion-audit/59-p2p-create-desktop-mobile-flow.jpg`.

# Cross-product detail-refinement pass — 2026-08-24

- Disconnected Chat now exposes one primary wallet-readiness task; the inactive
  Contacts sidebar and mobile dock are absent until connection.
- `Wallet needed` is a semantic level-two heading beneath the page-level
  `Encrypted Chat` heading.
- Private TVL no longer renders the unrelated standalone notification-sound
  button. A direct Playwright absence assertion prevents regression.
- Fresh desktop/mobile whole-product captures report zero horizontal overflow
  and no console errors. The full Trading capture matrix, 644 focused Trading
  tests, lint, and production build also pass.

# Privacy Portal readiness refinement — 2026-08-24

- Disconnected users can still inspect and change supported pairs, but the
  conversion form is withheld until a wallet is connected.
- One selected-pair readiness card replaces duplicate wallet messaging, the
  disabled action, and a network error that was not actionable before
  connection. The header remains the single wallet connection control.
- The mobile wallet label is now the deliberate `Connect`; desktop retains
  `Connect wallet`. Both retain the same accessible connection name.
- Current-run desktop/mobile evidence is
  `design-audit/completion-audit/61-privacy-portal-readiness-desktop-mobile.jpg`.
- Whole-product Playwright, the complete Trading matrix, 233 wallet tests, 644
  Trading tests, lint, and production build pass with zero reported horizontal
  overflow or console errors.

# Private TVL unavailable-state refinement — 2026-08-24

- Replaced the generic centered error with a semantic verification-paused task,
  one Retry action, and concise source/consistency/pricing safeguards.
- No estimate or placeholder TVL value is rendered while verification fails.
- Evidence: `design-audit/completion-audit/62-private-tvl-detail-refinement.jpg`.
- Whole-product Playwright reports no horizontal overflow or console errors;
  8 TVL tests, 233 wallet tests, 644 Trading tests, the complete Trading capture,
  lint, and production build pass.

# Trade Agent and App Help refinement — 2026-08-24

- Simplified the default Agent explanation and first quick action without
  changing its draft-only authority or payment flow.
- Mobile keeps the fee secondary and gives the disabled/ready primary action a
  separate full-width 44 px row.
- Curated help now describes DEX versus P2P, Offers/Create/My trades, and the
  Public/Private link/Direct access distinction consistently.
- Evidence: `design-audit/completion-audit/63-trade-agent-detail-refinement.jpg`.
- Whole-product and complete Trading Playwright passes report no horizontal
  overflow or console errors; 118 Agent tests, 644 Trading tests, lint, and
  production build pass.

# Shared header wallet-label refinement — 2026-08-24

- Desktop uses `0x7A3b…9F2c`; compact mobile uses `0x7…F2c`. Both remain one
  copy control and preserve the full address in the accessible title.
- Address, privacy lock, and the single Wallet utilities chevron keep separate
  actions inside one shared capsule across Chat, Privacy Portal, P2P, and DEX.
- Whole-product Playwright measures intrinsic label width at 360, 390, and
  430 px and passes with zero horizontal overflow or console errors. The full
  Trading interaction matrix, 644 Trading tests, lint, and production build
  also pass.
- Evidence: `design-audit/completion-audit/64-shared-header-wallet-detail-refinement.jpg`.

# DEX chart-density detail refinement — 2026-08-24

- The approved chart-led terminal identity is now preserved across Swap, Limit,
  and Recurring with a deterministic dense midpoint series and visible
  close-range marks instead of the sparse smooth-line treatment that drifted
  from the accepted drawing.
- Bid, ask, limit, and the two recurring strategy prices remain separately
  encoded; the denser midpoint treatment does not change the shared ratio or
  Buy/Sell semantics.
- Playwright now asserts at least 40 rendered close-range marks so a future data
  simplification cannot silently return the chart to the rejected sparse state.
- Current reference/desktop/mobile evidence:
  `design-audit/completion-audit/67-dex-limit-current-run-review.jpg`.
- The complete Trading Playwright matrix passes every recorded interaction and
  all eight responsive viewports with no horizontal overflow or console errors;
  644 focused Trading tests, lint, and production build also pass.

# Shared DEX/P2P management refinement — 2026-08-24

- DEX Positions and P2P My trades now present the same scan → select → attached
  terminal rhythm while preserving their different lifecycle and protocol
  controls.
- P2P My trades removes the duplicate top status counters and labels its search
  control `Search trades` instead of `Find offers`.
- Mobile My trades cards keep identity, status, price, and 44 px Open/Share
  actions; secondary term blocks and token verification no longer compete with
  the scan task and remain available in the attached terminal/details.
- Current-run evidence:
  `design-audit/completion-audit/68-shared-management-refinement-desktop-mobile.jpg`.
- The complete Trading Playwright matrix passes all interactions and eight
  responsive viewports with zero horizontal overflow or console errors; 644
  focused Trading tests, lint, and production build pass.

# P2P Create recurring detail refinement — 2026-08-24

- Removed duplicate Base/Quote selectors and the duplicate ratio action from
  recurring creation; the shared Trading pair/ratio context is now the only
  owner of both.
- The creation task exposes two opposite-side cards and four primary inputs.
  Ratio reversal relabels Sell cwTPB / Buy cwTPB as Buy cwTPQ / Sell cwTPQ
  without changing spend/receive assets.
- Playwright asserts no recurring token selectors, four visible inputs,
  equal-width desktop sides, mobile stacking, ratio relabeling, all eight
  responsive viewports, no horizontal overflow, and zero console errors.
- Evidence:
  `design-audit/completion-audit/69-p2p-create-recurring-refinement-desktop-mobile.jpg`.
- 644 focused Trading tests, lint, production build, and the complete Trading
  Playwright matrix pass.

# P2P Trade review and Activity detail refinement — 2026-08-24

- Preserved the shareable private-link model and maximum-request partial-fill
  rule without exposing the offer's private budget.
- Added a visible library chevron to the collapsed Offer details disclosure and
  regression coverage for its open/closed behavior.
- Replaced `Your history` plus a bare count with `Trade activity` and a semantic
  event count. Reduced the mobile Activity panel to a content-appropriate
  terminal height while retaining the Overview/Activity relationship.
- Evidence:
  `design-audit/completion-audit/70-p2p-trade-review-activity-refinement-desktop-mobile.jpg`.
- 644 focused Trading tests, lint, production build, and the complete Trading
  Playwright matrix pass across eight responsive viewports with no horizontal
  overflow or console errors.

# P2P one-off Create calculation clarity — 2026-08-24

- Preserved Public, Private link, and Direct access behavior and the shared
  pair/ratio/Buy-Sell mental model.
- Replaced slash price units with explicit `per` wording. The form now states
  `Enter two values; the third is calculated.` on desktop and mobile.
- The derived field is labeled `Calculated`, linked to the same guidance, and
  announced politely. Playwright verifies price `0.25` plus sell amount `500`
  produces buy amount `125` on desktop and mobile.
- Evidence:
  `design-audit/completion-audit/71-p2p-create-one-off-refinement-desktop-mobile.jpg`.
- 644 focused Trading tests, lint, production build, and the complete Trading
  Playwright matrix pass across eight responsive viewports with no horizontal
  overflow or console errors.

# DEX Limit input and review refinement — 2026-08-24

- The limit-price field accepts an ordinary decimal draft without formatting
  over the user's keystrokes, updates the chart/equation while valid, and
  commits a four-decimal value on blur or Enter.
- The displayed relation is now `above market` / `below market`, styled as
  neutral context rather than a green favorable outcome. Ratio reversal keeps
  the same fund/receive assets and updates the equation, units, action label,
  chart, and relation together.
- Review now leads with `Preview only — no wallet request`, states `At least
  25%`, combines private price and amount under Terms, and uses `Done` rather
  than implying a transaction will follow.
- Evidence:
  `design-audit/completion-audit/72-dex-limit-detail-refinement-desktop-mobile.jpg`.
- 644 focused Trading tests, 16 Node plus 77 DEX tests, lint, production build,
  and the complete Trading Playwright matrix pass across eight responsive
  viewports with no horizontal overflow or console errors.

# DEX Pool state and input refinement — 2026-08-24

- Full Range hides boundary inputs and the chart band; selecting a preset earns
  lower/upper controls and synchronizes the active chart range.
- The fee row matches the approved drawing: 0.01%, 0.05%, and 0.1% remain a
  segmented control while the editable Custom percentage is always visible
  beside them.
- Direct boundary editing commits on blur/Enter. Empty or invalid drafts restore
  the committed value, and an invalid Custom fee disables Review.
- Ratio reversal updates boundary values, units, market percentages, and chart
  range together without changing the underlying position.
- Review is explicitly preview-only and does not request a wallet while the
  current testnet Pool contract lacks selectable range/fee execution.
- Evidence:
  design-audit/completion-audit/73-dex-pool-detail-refinement-states.jpg.
- 644 Trading tests, 16 Node plus 77 DEX tests, lint, production build, and the
  complete Trading Playwright matrix pass across eight responsive viewports
  with no horizontal overflow or console errors.

# DEX Swap protection and review refinement — 2026-08-24

- Percentage slippage now derives its boundary from the 1.0030 indicative
  execution quote. The default 0.50% Buy state therefore shows a 1.0080
  maximum rather than calculating from the chart midpoint.
- Exact price is again a direct editable boundary, as approved. The same panel
  derives equivalent slippage and exposes the nearest executable protected
  price used by the reviewed contract path.
- Percentage review is explicitly preview-only/no-wallet. Exact review states
  wallet-next, uses cw display symbols, and retains maximum spend, indicative
  receive, minimum fill, and the visible boundary.
- Ratio-reversal assertions cover the protection inequality and reciprocal
  values: the same Buy cwTPB action relabels to Sell cwTPQ with a 0.9920
  minimum. Mobile exact input and review states remain clear above the fixed
  DEX dock.
- Evidence:
  `design-audit/completion-audit/74-dex-swap-detail-refinement-states.jpg`.
- 644 Trading tests, 16 Node plus 78 DEX tests, lint, production build, and the
  complete Trading Playwright matrix pass across eight responsive viewports
  with no horizontal overflow or console errors.

# DEX Positions activity and transfer refinement — 2026-08-24

- Preserved the accepted create-shortcut, lifecycle/filter, list, and attached
  terminal hierarchy on desktop and mobile.
- Activity separates the current lifecycle/privacy/owner-revision snapshot from
  recorded events, and labels the finalized block as data freshness rather than
  an event.
- Unavailable closed/transferred history remains explicit instead of being
  inferred from current state.
- Transfer requires a valid 42-character wallet address, exposes
  `aria-invalid`, explains the privacy/pause consequence before review, and
  enables only `Review transfer`.
- Evidence:
  `design-audit/completion-audit/76-dex-positions-detail-refinement-states.jpg`.
- Sixteen Node plus 78 DEX tests, lint, production build, and the complete
  Trading Playwright matrix pass across eight responsive viewports with no
  horizontal overflow or console errors.

# DEX Recurring input, disclosure, and review refinement — 2026-08-24

- Preserved the two-order model: two editable exact prices, two chart lines,
  spacing shortcuts, and private starting inventory on either side or both.
- Invalid blank or crossed price drafts restore the last valid pair on blur or
  Enter instead of disagreeing with the chart. Both price inputs expose
  `aria-invalid` and share the visible opposite-sides guidance.
- Moved the future four-boundary range-recurring limitation into Strategy
  summary. The primary action area keeps one concise exact-price/testnet note.
- Preview review now starts with no-wallet status, uses Status / Terms / Wallet,
  and ends with `Done`. Desktop and mobile both preserve the visible two-price
  terms and private inventory roles.
- Evidence:
  `design-audit/completion-audit/75-dex-recurring-detail-refinement-states.jpg`.
- 644 Trading tests, 16 Node plus 78 DEX tests, lint, production build, and the
  complete Trading Playwright matrix pass across eight responsive viewports
  with no horizontal overflow or console errors.

# P2P Offers hierarchy and mobile chart refinement — 2026-08-24

- Preserved the approved market-centered ladder, price-only Best rate rule,
  public availability, and hidden private budgets.
- Removed the detached desktop Active offers badge because the connected filter
  summary already owns the visible row count.
- Opening the optional chart on mobile now brings the chart body into the usable
  viewport above the fixed Offers / Create / My trades dock.
- Playwright verifies the single count owner, market sorting, both chart lines,
  mobile chart visibility, recovery states, and ratio reversal.
- Evidence:
  `design-audit/completion-audit/77-p2p-offers-detail-refinement-states.jpg`.
- 644 Trading tests, 16 Node plus 78 DEX tests, lint, production build, and the
  full eight-viewport Trading matrix pass with no horizontal overflow or
  console errors.

# Current product-owner candidate pack — 2026-08-24

- Refreshed the six still-unapproved implementation candidates from the latest
  post-refinement Playwright run.
- Desktop evidence:
  `design-audit/completion-audit/78-product-owner-candidates-current-desktop.jpg`.
- Mobile evidence:
  `design-audit/completion-audit/79-product-owner-candidates-current-mobile.jpg`.
- The mobile P2P Create cell intentionally uses the task-entry state, while its
  filled calculation state remains covered by the dedicated Create evidence.
- Both generated sheets were visually inspected; they show consistent shared
  shell ownership and no newly reproduced structural defect. Explicit
  product-owner acceptance remains required.

# P2P Create blocked-action honesty refinement — 2026-08-24

- Known wallet, network, privacy, loading/read, and balance blockers now disable
  `Create Offer` before interaction; ordinary missing-field validation retains
  the existing first-attempt reveal.
- The disabled button uses a subdued solid treatment with no active gradient or
  shadow. `Switch to COTI network` is owned by the readiness row and is not
  duplicated by the general validation region.
- Playwright asserts the behavior, accessible title, computed disabled style,
  and single message owner on desktop and mobile.
- Evidence:
  `design-audit/completion-audit/80-p2p-create-blocked-action-honesty.jpg`.
- 644 Trading tests, lint, production build, and the complete eight-viewport
  Trading matrix pass with no horizontal overflow or console errors.

# P2P My trades filter hierarchy refinement — 2026-08-24

- Search, Type, Sort, and Reset now live inside the `My trades` workspace under
  its heading rather than in a detached toolbar before the task title.
- Desktop keeps the complete row visible. Mobile defaults to one 44 px
  `Search & filters` disclosure; its expanded state uses a full-width search,
  a balanced Type/Sort row, and full-width Reset without covering the dock.
- Playwright verifies the new hierarchy owner, collapsed/expanded state,
  44 px mobile targets, complete control visibility, and restored collapse.
- Evidence:
  `design-audit/completion-audit/81-p2p-my-trades-filter-hierarchy.jpg`.
- 644 Trading tests, lint, production build, and the complete eight-viewport
  Trading matrix pass with no horizontal overflow or console errors.

# P2P Trade terminal detail refinement — 2026-08-24

- The approved Trade review keeps one decision path: private-link audience,
  fixed price, maximum-request partial-fill behavior, pay/receive amounts, and
  the truthful network blocker.
- Field-level `Unlock` labels are suppressed when the amount values are already
  visible, removing the false impression of two separate privacy actions.
  Available wallet-balance text remains eligible for the same header slot.
- A populated Activity panel now ends with its final event instead of reserving
  a large empty region; the dedicated empty-history state remains intentional.
- Playwright verifies the labels, blocker, event geometry, desktop/mobile
  terminal behavior, eight responsive viewports, no overflow, and no console
  errors.
- Evidence:
  `design-audit/completion-audit/82-p2p-trade-terminal-detail-refinement.jpg`.
- 644 Trading tests, lint, and production build pass.

# Shared header address visibility correction — 2026-08-24

- Desktop visibly renders the complete shortened address `0x7A3b…9F2c`
  without a second CSS truncation.
- Mobile renders `0x7A…9F2c`, preserving more identity than the former
  `0x7…F2c` while retaining the same address / privacy / More hierarchy.
- The connected capsule remains one visual unit; the address remains the copy
  action and no duplicate wallet control was added.
- Playwright measures the address label's intrinsic fit on Chat, Privacy
  Portal, P2P, and DEX at desktop and mobile sizes. The complete eight-viewport
  matrix passes with no overflow or console errors.
- Evidence:
  `design-audit/completion-audit/83-shared-header-address-visibility.jpg`.
- 233 wallet tests, lint, and production build pass.

# Shared disconnected-wallet simplification — 2026-08-24

- Removed `Wallet disconnected` because the adjacent Connect action already
  owns that state.
- Desktop now shows `Connect wallet` and Wallet; mobile shows the compact
  `Connect` action and wallet-menu icon without a redundant status label.
- The existing connected-only Chat privacy preference is restored to the
  connected wallet menu instead of an unreachable disconnected branch.
- Whole-product Playwright verifies disconnected Chat and Privacy Portal on
  desktop/mobile, connected address fit at 360/390/430 px, no overflow, and no
  console errors.
- Evidence:
  `design-audit/completion-audit/84-shared-header-disconnected-simplification.jpg`.
- Four shared-header tests, lint, and production build pass.

# P2P Create task hierarchy refinement — 2026-08-24

- One-off and recurring creation now start with a consistent product/task
  label, action title, and one-line purpose before their controls.
- One-off retains Audience → Trade terms → Advanced options → readiness →
  review. Recurring retains its two opposite-side orders and four primary
  values without adding a duplicate pair or ratio control.
- Mobile stacks the heading hierarchy cleanly above the type switch and keeps
  the fixed P2P dock unobstructed.
- Playwright verifies the task copy on desktop/mobile plus all eight responsive
  viewports, no horizontal overflow, and no console errors.
- Evidence:
  `design-audit/completion-audit/85-p2p-create-task-hierarchy.jpg`.
- Lint and production build pass. Product-owner acceptance remains open.

# Shared header route consistency refinement — 2026-08-24

- Chat, Privacy Portal, Private TVL, and Trading now share the same desktop
  header grid. The Chat brand/sidebar rail is 320 px rather than the old 300 px,
  so Home, app navigation, and wallet controls keep their position during route
  changes.
- Private TVL now uses the same connected address / privacy / More capsule.
  Network, notification, Help, and disconnect settings stay inside More; no
  second route-specific utility button was introduced.
- Whole-product Playwright records exact matching desktop geometry for all four
  routes and verifies compact connected headers at 360/390/430 px with no
  overflow or console errors.
- Evidence:
  `design-audit/completion-audit/86-shared-header-route-consistency-desktop.jpg`
  and
  `design-audit/completion-audit/87-shared-header-route-consistency-mobile.jpg`.
- The focused Private TVL shared-header browser case and 233 wallet tests pass.
  The wider legacy wallet-header file still contains older OTC/Treasury label
  and standalone-sound assumptions outside this bounded consistency change.
  Product-owner acceptance remains open.

# P2P Trade review mobile navigation continuity — 2026-08-24

- Mobile Trade review and Activity now keep the fixed Offers / Create / My
  trades dock visible, matching the rest of P2P and preserving terminal identity.
- Offers remains active for a trade opened from the ladder. The existing route
  source continues to select My trades for management-terminal journeys.
- The terminal and sticky primary action reserve the dock plus safe-area inset,
  so the action does not sit underneath navigation. Keyboard-open behavior still
  hides the dock.
- Playwright verifies fixed dock positioning, active context, primary-action
  clearance, both Overview and Activity, all eight responsive viewports, no
  horizontal overflow, and zero console errors.
- Evidence:
  `design-audit/completion-audit/88-p2p-trade-review-mobile-dock.jpg`.
- 644 focused Trading tests, lint, production build, and the complete Trading
  capture matrix pass. Product-owner acceptance remains open.

## Shared-header regression reconciliation — 2026-08-24

- Replaced retired OTC Desk / Treasury route assertions with the approved
  Trading / Private TVL labels.
- Verified one wallet capsule and one More-menu owner across Chat, Trading,
  Privacy Portal, and Private TVL.
- Verified Network, Notifications/Sound, Help, and Disconnect inside More;
  verified privacy unlock on the direct lock action.
- Added visible sanitized connection-failure feedback to the existing
  disconnected Chat readiness state.
- Result: 10/10 focused Playwright cases, 233/233 wallet tests, lint, testnet
  candidate build, and whole-product responsive capture pass; no reported
  horizontal overflow or console errors.

## Keyboard focus and ratio announcement — 2026-08-24

- Replaced the low-contrast Trading-only focus outline with the shared
  light-violet focus token; current capture reports `rgb(196, 181, 253)`.
- Made the shared price equation a polite atomic live region so price-ratio
  reversal announces the complete updated equation.
- Desktop keyboard QA covers reversal, Buy/Sell arrow keys, Wallet utilities
  order, and Escape focus restoration. Mobile QA covers the fixed P2P dock and
  Offers / Create / My trades route continuity.
- Evidence is in `design-audit/acceptance-accessibility/`.
- Result: 2/2 focused browser cases, 2/2 shared component tests, 644/644
  Trading tests, lint, and whole-product responsive QA pass with no reported
  overflow or console errors.
- Screenshot and automated keyboard evidence do not prove screen-reader,
  zoom/reflow, software-keyboard, or physical-device acceptance; those remain
  manual checks.

## DEX Limit candidate acceptance audit — 2026-08-24

- Re-captured default desktop, ratio-reversed desktop, preview review, and
  composer-first mobile states through the full Trading QA flow.
- Compared the approved Limit reference and current implementation at matched
  desktop dimensions in one side-by-side artifact.
- Confirmed one shared pair/ratio owner, right-side strategy selection, one
  editable limit, correct ratio-reversal relabeling, concise preview review,
  fixed mobile navigation, and honest contract limitation copy.
- No new implementation defect was reproduced. Evidence and notes are in
  `design-audit/acceptance-dex-limit/`.
- Product-owner approval remains open; the candidate is ready for decision.

## DEX Recurring candidate acceptance audit — 2026-08-24

- Re-captured default, asymmetric Custom, ratio-reversed, preview review, and
  mobile states through the full Trading QA flow.
- Compared the user's two-line/range clarification reference with the current
  implementation in one side-by-side artifact.
- Confirmed two reusable opposite-side limit orders, two editable prices, two
  chart lines, independent starting inventories, coherent ratio reversal, and
  four-boundary range-recurring disclosure under Strategy summary.
- No new implementation defect was reproduced. Evidence and notes are in
  `design-audit/acceptance-dex-recurring/`.
- Product-owner approval remains open; the candidate is ready for decision.

## Remaining candidate acceptance audits — 2026-08-24

- DEX Positions now keeps current pair/ratio ownership in the shared header.
  Mobile `All positions` restores focus and returns the selected row beneath the
  sticky Trading context. Evidence: `design-audit/acceptance-dex-positions/`.
- P2P Create preserves Public / Private link / Direct proposal distinctions and
  removes the repeated pair from Recurring. Evidence:
  `design-audit/acceptance-p2p-create/`.
- P2P Trade review preserves the attached terminal, private-budget partial-fill
  rule, Activity, dock clearance, and distinct execution-feedback states.
  Evidence: `design-audit/acceptance-p2p-trade-review/`.
- P2P My trades preserves the shared scan → select → manage model and now shows
  only one creation path in its empty state on each form factor. Evidence:
  `design-audit/acceptance-p2p-my-trades/`.
- Result: 644/644 focused Trading tests, lint, testnet candidate build, and the
  complete Trading capture matrix pass. Eight responsive viewports report no
  horizontal overflow, and the browser run reports zero console errors.
- Product-owner decisions plus manual screen-reader, zoom/reflow,
  software-keyboard, and physical-device checks remain open.

## Narrow-screen and reflow boundary QA — 2026-08-24

- Added 320x800 and 640x512 to the existing eight-viewport matrix.
- The first 320px capture reproduced clipped shared pair and ratio text without
  document overflow. The compact Trading context was refined and the capture
  now shows the complete `cwTPB / cwTPQ` and
  `1 cwTPB = 1.0000 cwTPQ` labels.
- Responsive QA now asserts intrinsic fit for both shared mental-model labels at
  all ten viewports, plus safe-area coverage, dock attachment where applicable,
  horizontal overflow, and console errors.
- Result: ten-viewport capture matrix passed, zero horizontal overflow, zero
  console errors, 644/644 focused Trading tests passed, lint passed, and the
  production build completed. Evidence: `design-audit/acceptance-reflow/`.
- The 640x512 viewport is a reflow proxy only; actual 200% browser zoom and
  assistive-technology/device acceptance remain manual.

## Compact reverse-price target QA — 2026-08-24

- The reverse-price button now measures at least 44px high at all ten viewports.
  Compact layouts retain a 30px inset visual control; desktop retains its full
  label and prior 35px inset border.
- The matrix requires the 44px target at every viewport and still requires
  complete pair and ratio intrinsic fit.
- At 320px, the full pair and full equation remain visible with no document
  overflow; only the duplicate decorative quote-token icon is suppressed.
- Result: ten-viewport matrix passed with zero console errors or horizontal
  overflow; 644/644 focused Trading tests, lint, and production build passed.
  Evidence is refreshed in `design-audit/acceptance-reflow/`.

## Mobile header, P2P Create, and DEX Positions refinement — 2026-08-24

- Source truth: the two user-supplied reference screenshots from this pass plus
  the explicit requirements to compact the mobile header, simplify P2P Create,
  remove the Positions chart, and default Positions to every pair.
- The mobile Trading header is 52px high and preserves the single Home control,
  connected address, privacy action, More menu, global navigation, and fixed
  mobile Trading dock.
- P2P Create now uses a compact DEX-like hierarchy: task title, offer type,
  Access, Price and amounts, Advanced options, one readiness owner, and the
  primary action. Public, private-link, and direct-wallet access remain distinct.
- DEX Positions has no chart. It defaults to All positions, offers a Selected
  pair scope, keeps lifecycle/type filters, and shows non-current-pair positions
  safely as read-only until their pair is selected.
- Full-view evidence:
  `design-audit/qa-captures/mobile-shell-top-360.png`,
  `design-audit/qa-captures/p2p-create-public-desktop.png`, and
  `design-audit/qa-captures/dex-positions-desktop.png`.
- Focused responsive evidence:
  `design-audit/qa-captures/p2p-create-mobile.png` and
  `design-audit/qa-captures/dex-positions-mobile.png`.
- QA history: the first Positions fixture used stale pair keys and hid the
  management state; the fixture was corrected. The second pass retained a
  chart-era assertion; the assertion was updated to the chart-free design.
- Final Playwright run passed at 320, 360, 390, 430, 640, 768, 834, 1280,
  1440, and 1536px with zero horizontal overflow or console errors. The shared
  header stayed geometrically consistent across Chat, Privacy Portal, P2P, and
  DEX. Trading tests passed 644/644; DEX tests passed 78/78; lint and production
  build passed.
- The in-app browser control could not start because the Windows sandbox denied
  its runtime read ACL. The user-approved standalone Playwright path was used
  for the complete responsive and interaction run.
- No P0, P1, or P2 visual defect remains in this scoped pass. Manual
  screen-reader, browser-zoom, software-keyboard, and physical-device checks
  remain outside automated evidence.

Final result: passed.

## DEX Agent to P2P route-state correction - 2026-08-29

- Source references: `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-f7c54d98-55b5-4b9b-85de-e02af4c0270a.png` and `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-3948276d-182a-4ecb-9fee-b6697310e29c.png`.
- Interaction verified at `2559 x 1313`: `/dex/agent` -> P2P -> `/otc/desk`.
- The resulting page contains `Offers / Create / My trades / Agent`, zero retired private-liquidity workspaces, zero `Limit` mode buttons, and no horizontal document overflow.
- DEX and P2P navigation coordinates are identical: x=347.5, y=149, width=516, height=46.
- Active DEX and P2P tabs now have identical background, radius, inset border, type size, weight, and color. Keyboard focus remains visible through the same inset treatment without the prior outer double ring.
- Console errors and warnings: zero.
- Trading regression: 644/644 passed. ESLint and the TypeScript/Vite production build passed.

Final result: passed.

## Trading amount-input consistency — 2026-08-24

- P2P recurring now shows the available balance and Max action for both funded
  sides, plus the calculated receive amount beneath each funding input.
- DEX Swap, Limit, Pool, and Recurring use the same Available / Max hierarchy.
  Max is disabled until that token balance is readable; price inputs remain
  price-only and the shared pair context is not duplicated.
- The recurring receive previews preserve the canonical pair math when the
  displayed price ratio is reversed.
- Trading tests passed 644/644. Lint and the production build passed.
- The complete Playwright Trading matrix passed at ten responsive viewports
  with no horizontal overflow or console errors. Focused assertions cover P2P
  recurring and DEX Swap, Limit, Pool, and Recurring amount controls.
- Automated evidence does not replace manual screen-reader, browser-zoom,
  software-keyboard, or physical-device checks.

Final result: passed.

## P2P Create density, mobile header motion, and Incoming trades — 2026-08-24

- Compared the three user-supplied problem screenshots with current-run
  Playwright captures in the same before/after sheets:
  `qa-current-2/header-before-after.jpg` and
  `qa-current-2/recurring-before-after.jpg` in the Codex visualization area.
- P2P Create is now one 780px Trading ticket instead of a wide detached
  workspace. The title/type selector is compact and the one-off form keeps only
  Access, Price and amounts, Advanced options, readiness, and the action.
- Recurring retains exactly two opposite-side price inputs and two starting
  funding inputs. Duplicate explainer, contract, funding, safety, and action-copy
  rows were removed; amount privacy is one compact control.
- The mobile Home target and wallet capsule are 36px controls inside a 52px row
  with explicit vertical breathing room. Scrolling transitions the app row
  through height, opacity, and translation rather than an abrupt display toggle.
- Incoming trades were not removed from the data model. The connected Active
  workspace now always shows All / Incoming / Made by me, including zero-count
  states. The disconnected state now explains that connection comes first and
  the lock control unlocks privacy afterward.
- Current-run evidence:
  `design-audit/qa-captures/p2p-create-public-desktop.png`,
  `design-audit/qa-captures/p2p-create-recurring-desktop.png`,
  `design-audit/qa-captures/p2p-create-mobile.png`,
  `design-audit/qa-captures/p2p-create-recurring-mobile.png`,
  `design-audit/qa-captures/p2p-my-trades-mobile.png`,
  `design-audit/qa-captures/mobile-shell-top-390.png`, and
  `design-audit/qa-captures/mobile-shell-scrolled-390.png`.
- The complete Trading Playwright matrix passed at ten responsive viewports
  with zero horizontal overflow and zero console errors. The mobile header is
  geometrically consistent across Chat, Privacy Portal, P2P, and DEX. Trading
  tests passed 644/644, wallet/privacy tests passed 233/233, lint passed, and the
  production build passed.
- Browser classification: invocation failed because the Windows sandbox denied
  the in-app browser runtime read ACL. The previously user-approved standalone
  Playwright fallback was used.
- No P0, P1, or P2 issue remains in this scoped pass. Screenshot and automation
  do not replace manual screen-reader, browser-zoom, software-keyboard, or
  physical-device checks.

Final result: passed.

## DEX Limit fields and wide Trading workspaces — 2026-08-25

- Source references: `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-ad2faec6-747b-4904-a840-43fe6c3388f1.png`, `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-8ab6fb0b-6a66-4465-b327-3a4f1d63111d.png`, and `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-fb02cae5-d853-489e-a4e5-0d359e489aa7.png`.
- Implementation owners: `src/features/dex/components/DexMarketChart.tsx` and `src/styles/110-approved-trading-design.css`.
- Desktop evidence at `2559 × 1313` verifies a 1760px DEX/P2P terminal frame. The DEX local tabs and main terminal share the same x-position, while the P2P Offers area expands to 1480px. The existing `1486 × 1059` layout remains fluid and full-width within its viewport.
- Mobile evidence at `390 × 844` verifies the centered 362px Pool / Limit / Recurring selector. DEX Swap, Limit, and Pool amount fields place the numeric input/output on the left and fixed token context on the right.
- The DEX midpoint is now a simple line. The candle-style vertical error bars were removed; bid and ask remain distinct stepped reference lines.
- Focused captures: `C:/Users/rosu_/AppData/Local/Temp/codex-trading-layout-refinement/dex-swap-2559x1313.png`, `C:/Users/rosu_/AppData/Local/Temp/codex-trading-layout-refinement/dex-swap-1486x1059.png`, `C:/Users/rosu_/AppData/Local/Temp/codex-trading-layout-refinement/dex-limit-390x844.png`, and `C:/Users/rosu_/AppData/Local/Temp/codex-trading-layout-refinement/p2p-offers-2559x1313.png`.
- Playwright geometry, interaction, overflow, and console checks passed. Unit tests passed 1788/1788; lint and production build passed.
- QA history: the in-app Browser runtime could not start because the Windows sandbox failed while applying read ACLs. The previously approved standalone Playwright fallback was used. The first fallback navigation used `networkidle`, which timed out against persistent app connections; it was corrected to `domcontentloaded` with explicit surface waits.
- No P0, P1, or P2 defect remains in this scoped pass. Manual screen-reader, browser-zoom, software-keyboard, and physical-device checks remain outside automated evidence.

Final result: passed.
## Shared Trading Agent workspace — 2026-08-27

- Product model: three distinct surfaces remain separate. Wallet → Help opens the simple App Help state; the shared Trading Agent is the API-backed trading workspace; MCP instructions explain how a user-owned agent connects to ChainWhisper.
- The normal Agent route now opens Trade Agent directly. MCP instructions are secondary and are not presented as settings.
- P2P and DEX both expose Agent in their Trading navigation. `/dex/agent` is preserved by canonical routing and uses the same pair, ratio orientation, and attached-context model as P2P.
- P2P preparation actions remain available. DEX is explicitly preview-only and does not expose paid or executable preparation actions until its integration is ready.
- Desktop uses a conversation workspace plus attached Trading context. Mobile keeps Agent in the fixed four-item Trading dock, provides collapsible context, and keeps the composer above the dock.
- Focused Playwright passed 3/3 cases: P2P desktop, P2P mobile, and DEX preview-only. It verifies active Agent navigation, attached context, no horizontal overflow, composer/dock clearance, and disabled unavailable DEX actions.
- Focused component tests passed 5/5. Trading regressions passed 644/644. ESLint and the production build passed.
- Playwright captures were written to `test-results/trading-agent-desktop.png` and `test-results/trading-agent-mobile.png`.
- The in-app Browser and local image viewer could not start because the Windows sandbox failed while applying read ACLs. The previously approved standalone Playwright path was used for responsive and interaction verification.
- The older broad Agent/App Help browser specifications still describe the retired three-equal-tab layout and require a separate reconciliation pass; the focused tests above cover the implemented model.

Final result: passed.

### Agent destinations and duplicate-control correction — 2026-08-27

- Source visual truth: `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-438ccfcd-f301-4462-b9b5-528cfde855b0.png` (`1964 × 1120`, supplied desktop state).
- Implementation evidence: `test-results/trading-agent-desktop.png` (`1440 × 900`, CSS viewport `1440 × 900`, device scale factor 1) and `test-results/trading-agent-mobile.png` (`375 × 812`, CSS viewport `375 × 812`, device scale factor 1).
- Combined comparison: `test-results/agent-mode-qa-comparison-final.jpg`. The images were width-normalized only for the combined review; the source and implementation were also inspected separately at readable scale.
- State: P2P Agent, Trade Agent selected, wallet disconnected.
- Full-view evidence: the final page exposes App Help, Trade Agent, and MCP for agents once in a single three-choice switch. The two former MCP buttons and the redundant page title block are absent. The primary trading workspace and attached context retain the existing terminal hierarchy.
- Focused evidence: the Agent switch, workspace top edge, attached context, composer, and mobile bottom-navigation clearance were inspected. No additional crop was needed because these surfaces are readable in the full desktop and mobile captures.
- Typography: existing Space Grotesk/Inter hierarchy, weights, wrapping, and muted-label treatment are preserved.
- Spacing/layout: the switch spans the workspace above the terminal. Desktop remains two-column inside the terminal; mobile exposes the same three choices and keeps the composer above the bottom dock.
- Colors/tokens: existing approved purple, surface, border, and muted tokens are reused; no new palette was introduced.
- Image/assets: no imagery or non-standard visual asset changed in this scoped correction.
- Copy/content: the three product meanings are explicit—simple App Help, API-backed Trade Agent, and MCP instructions for user-owned agents. `Agent settings` is not used.
- Interaction/accessibility: the choices are standard navigation buttons with `aria-current`; all three states were exercised. Focused Playwright passed 3/3 with no overflow or console errors; the component test and ESLint passed.
- Comparison history: initial review found a P1 information-architecture issue (MCP exposed twice while App Help was hidden) and a P1 layout issue from the retired two-column Agent grid. The duplicate controls/title were removed, the legacy placement was overridden at the shared panel owner, and post-fix desktop/mobile captures show the switch and terminal in the intended order.
- Follow-up polish: physical-device, browser-zoom, and screen-reader checks remain outside this automated pass.

Final result: passed.
## COTI Testnet DEX readiness gate — 2026-08-29

| Screen | Reference/current gap | Result |
| --- | --- | --- |
| Swap, desktop | The approved chart/composer hierarchy is preserved. Demo amounts were removed because `900` exceeds the attested pair ceiling. The primary action is disabled until seed evidence is present. | Pass, setup blocked |
| Swap, mobile | The approved chart-first flow, fixed Trading dock, pair ratio, and composer order are preserved with no horizontal overflow. | Pass, setup blocked |
| Testnet readiness | The collapsed panel now reports chain, wallet, privacy, balances, deployment revision, transaction/receipt, exact four-token status, faucet status, six-pair status, seed revision, and required owner. | Pass |
| Six-pair matrix | All six unordered pairs from cwTUB, cwTUQ, cwTPB, and cwTPQ are visible. cwTPB/cwTPQ is contract-active; all six remain unseeded because no deployment/seed manifest was supplied. | Pass, contract input required |
| Faucet | The existing fail-closed faucet is reused. It distinguishes wallet prompt, submitted, confirmed, uncertain, and failed states and links submitted transactions to the explorer. | Pass; no live claim sent |
| Strategies | Existing preview-only creation controls remain honest where the activated ABI does not support the approved product terms. | No visual change |
| Positions | Existing Position-NFT discovery, ownership, transfer, privacy, and exit controls remain tied to the connected owner. | No visual change |

- Required strategy/Position-NFT owner: `0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d`.
- Missing contract-side evidence: six-pair seed manifest, per-pair usable liquidity and strategy counts, seed revision, setup transaction status, and required owner assignment.
- Final comparison: `design-audit/testnet-readiness-final-reference-left-current-right.jpg`.
- Final current captures: `design-audit/testnet-readiness-final-desktop-collapsed.png`, `design-audit/testnet-readiness-final-desktop-expanded.png`, `design-audit/testnet-readiness-final-mobile-collapsed.png`, and `design-audit/testnet-readiness-final-mobile-expanded-bottom.jpg`.
- Playwright: desktop `1440 × 1000` and mobile `390 × 844`; six pairs on both, no horizontal overflow, no console errors, and the final mobile setup error scrolls above the fixed dock.
- Checks: 16 Node DEX tests, 79 Vitest DEX tests, 5 focused token/faucet tests, 233 wallet tests, and 644 Trading tests passed. ESLint and the COTI Testnet candidate build passed.
- No wallet request, faucet claim, deployment, seed, strategy creation, transfer, or live DEX transaction was sent.

Final result: visually ready; manual DEX execution blocked by missing seed and owner evidence.
## Shared pair picker refinement — 2026-08-29

- Source visual truth: `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-054b6e6b-7f1a-4715-883d-ba2b62a74ba7.png` (`716 × 336`).
- Implementation evidence: `C:/Users/rosu_/AppData/Local/Temp/chainwhisper-pair-picker-final-desktop.jpg` (`2048 × 900`, CSS viewport `2048 × 900`, device scale factor 1) and `C:/Users/rosu_/AppData/Local/Temp/chainwhisper-pair-picker-final-mobile.jpg` (`390 × 844`, CSS viewport `390 × 844`, device scale factor 1).
- Focused implementation capture: `C:/Users/rosu_/AppData/Local/Temp/chainwhisper-pair-picker-focus.png` (`620 × 199`). Combined comparison: `C:/Users/rosu_/AppData/Local/Temp/chainwhisper-pair-picker-comparison.png`. Natural pixel sizes were preserved; the focused panel was readable without density normalization.
- State: DEX Swap with the shared pair picker open. Testnet catalog is expanded; mainnet catalog is collapsed.
- Full-view evidence: the pair stays at the left, the price ratio remains central, and the DEX/P2P switch stays at the right. Desktop and mobile have no horizontal overflow.
- Focused evidence: the dense two-network chip wall was replaced by a current-pair summary, four visible testnet tokens, and a collapsed mainnet row with a token count and expand indicator. The mainnet row exposes all 19 existing catalog tokens when opened.
- Typography, spacing, colors, and copy reuse the approved Trading tokens and hierarchy. No image asset changed.
- Comparison history: the first comparison found a P2 density issue and a P3 missing expand affordance. The mainnet catalog was collapsed, the current pair was promoted, the panel background was made opaque, and an existing ChevronDown icon was added. The final captures show no remaining P0, P1, or P2 issue.
- Interactions: Playwright opened and closed the pair picker, expanded and collapsed mainnet, counted 4 testnet and 19 mainnet tokens, and checked desktop/mobile overflow and console output. No console errors were found.
- Automated checks: 238 test files and 1788 tests passed; ESLint passed.

Final result: passed.
## Pair catalog and product-switch refinement — 2026-08-29

- Source visual truth: `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-2122765a-bd63-4be2-9c01-b035d8c6832c.png` and `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-e9fcf66d-c40a-49db-a20c-c641f52ff046.png`.
- Implementation evidence: `C:/Users/rosu_/AppData/Local/Temp/chainwhisper-pair-panel-final.png` (`440 × 136`), `C:/Users/rosu_/AppData/Local/Temp/chainwhisper-product-switch-final.png` (`300 × 53`), and `C:/Users/rosu_/AppData/Local/Temp/chainwhisper-header-final.jpg` (`2048 × 900`, CSS viewport `2048 × 900`, device scale factor 1).
- Combined comparison: `C:/Users/rosu_/AppData/Local/Temp/chainwhisper-header-refinement-comparison.png`. Natural pixel sizes were preserved because both focused controls were readable without scaling.
- State: DEX Swap, shared pair panel open, Testnet selected.
- Full-view evidence: the pair boundary and desktop header brand boundary both end at 320px. The DEX/P2P switch remains right aligned and is 300px wide. Mobile keeps the 376px touch-width switch.
- Focused evidence: the duplicate current-pair row and simultaneous two-network chip wall were removed. Testnet and Mainnet are working tabs. Testnet shows four tokens; Mainnet shows 10 public and 9 private tokens in separate lists.
- Typography, spacing, colors, icons, and copy reuse the approved Trading system. No image asset changed.
- Comparison history: the first pass had P2 density and grouping issues, plus an oversized desktop switch. The panel was reduced to one visible network, mainnet tokens were grouped, the group layout specificity was corrected, and the switch was capped at 300px. The final comparison has no remaining P0, P1, or P2 issue.
- Interactions: Playwright opened the panel, changed networks, verified 10 public and 9 private mainnet tokens, checked the 320px desktop boundary, checked desktop and mobile switch widths, and found no overflow or console errors.
- Checks: the focused component tests passed 2/2 and ESLint passed.

Final result: passed.
## Clickable ratio and adjacent 24h change — 2026-08-29

- Source visual truth: `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-f8befc19-a20d-4895-9d68-01690c3c1b41.png`, `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-145c37d8-6153-47fd-9552-1b700ea3eb90.png`, and `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-b40c246f-49b1-4803-8839-aa9d6bfe1600.png` (`772 × 122`).
- Implementation evidence: `C:/Users/rosu_/AppData/Local/Temp/chainwhisper-ratio-change-final-2048.jpg` (`2048 × 900`, CSS viewport `2048 × 900`, device scale factor 1), `C:/Users/rosu_/AppData/Local/Temp/chainwhisper-ratio-change-final-390.jpg` (`390 × 844`, CSS viewport `390 × 844`, device scale factor 1), and focused capture `C:/Users/rosu_/AppData/Local/Temp/chainwhisper-ratio-change-focus.png` (`540 × 98`).
- Combined comparison: `C:/Users/rosu_/AppData/Local/Temp/chainwhisper-ratio-change-comparison.png`. Natural focused pixels were preserved; no density normalization was needed.
- State: DEX Swap, forward displayed ratio for comparison; reverse interaction was also tested.
- Full-view evidence: the standalone `Reverse price display` control is absent. The ratio value is the accessible button and retains the existing ArrowLeftRight icon. On desktop, 24h change begins 71px after the ratio trigger instead of floating inside a flexible middle column. Mobile keeps the ratio and reverse icon in the compact pair row.
- Focused evidence: the final price/24h group is visibly denser than the supplied state while preserving the established typography, muted label, emerald change color, borders, and spacing rhythm. No image asset changed.
- Comparison history: the initial implementation had a P2 duplicate action and a P2 excessive horizontal gap. The action was merged into the price value, the label copy was simplified, the desktop ratio track was fixed at 340px, and change padding was reduced. The final comparison has no remaining P0, P1, or P2 issue.
- Interactions: Playwright clicked the ratio at 2048, 1440, 1181, 921, and 390px widths and verified the displayed pair reversed each time. No removed action text, horizontal overflow, or console errors were found.
- Checks: focused component tests passed 2/2 and ESLint passed.

Final result: passed.
## App-header and Trading-row proportions — 2026-08-29

- Source visual truth: `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-0146f605-42a8-4bde-be54-b84c8e0e2ef9.png` (`430 × 185`) and `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-4503aa9a-45ec-4338-8751-843e0ff55920.png` (`917 × 190`).
- Implementation evidence: `C:/Users/rosu_/AppData/Local/Temp/chainwhisper-header-proportions-final-2048.jpg` (`2048 × 900`, CSS viewport `2048 × 900`, device scale factor 1), `C:/Users/rosu_/AppData/Local/Temp/chainwhisper-header-proportions-final-390.jpg` (`390 × 844`, CSS viewport `390 × 844`, device scale factor 1), and focused capture `C:/Users/rosu_/AppData/Local/Temp/chainwhisper-header-proportions-focus.png` (`917 × 142`).
- Combined comparison: `C:/Users/rosu_/AppData/Local/Temp/chainwhisper-header-proportions-comparison.png`. The source and focused implementation use the same 917px crop width and device scale factor 1.
- State: DEX Swap, wallet disconnected, desktop header and shared market row visible.
- Full-view evidence: the desktop app header is 66px and the Trading market row is now 76px instead of 98px. Pair, ratio, 24h change, and DEX/P2P controls retain their sizes and alignment. The mobile Trading header remains its existing 82px two-row layout.
- Focused evidence: the 10px desktop height difference produces a closer visual proportion and removes excess vertical padding without compressing text or touch targets.
- Typography, colors, icons, images, and copy are unchanged. Existing Trading tokens and spacing rules are preserved.
- Comparison history: the supplied state showed a P2 height imbalance between the main header and Trading row. The shared desktop row and shell track were reduced from 98px to 76px. The final comparison has no remaining P0, P1, or P2 issue.
- Playwright verified DEX and P2P at desktop and DEX at 390 × 844. There was no horizontal overflow or console error.

Final result: passed.
## Desktop control proportion refinement — 2026-08-29

- References: `codex-clipboard-6551e9da-3fe9-4764-9294-89e5caa33ec1.png` (531x173) and `codex-clipboard-4336a472-c364-4d3b-b38a-659353204cce.png` (389x163).
- Implementation captures: `chainwhisper-control-alignment-final-2048.jpg` at 2048x900 and `chainwhisper-control-alignment-final-390.jpg` at 390x844, device scale 1.
- Combined comparison: `chainwhisper-control-alignment-comparison.png`.
- Desktop ratio trigger and main navigation start both measure x=334.
- Desktop wallet actions and DEX/P2P switch both measure 230px wide; their right edges differ by less than 1px.
- DEX 2048, DEX 1181, DEX 921, P2P 1440, and DEX 390 have no horizontal overflow and no console errors.
- Mobile remains unchanged: 376px product switch and 82px Trading bar at 390x844.
- Existing type, color, border, token icons, and interaction behavior are unchanged.

Final result: passed.
## Trading navigation and desktop proportion refinement — 2026-08-29

**Source visual truth**
- `C:\Users\rosu_\AppData\Local\Temp\codex-clipboard-33c8591f-b44a-4136-be11-30635377477d.png` (2559x1312): user-marked current state and requested alignment/proportion changes.
- Earlier rejected state: `C:\Users\rosu_\AppData\Local\Temp\codex-clipboard-51a48822-7351-44f9-b84c-7bfb76d844f1.png` (2559x356).

**Implementation evidence**
- DEX: `C:\Users\rosu_\AppData\Local\Temp\chainwhisper-nav-product-aligned--dex.jpg` (2559x1312), CSS viewport 2559x1312, device scale 1.
- P2P: `C:\Users\rosu_\AppData\Local\Temp\chainwhisper-nav-product-aligned--otc.jpg` (2048x900), CSS viewport 2048x900, device scale 1.
- Full comparison: `C:\Users\rosu_\AppData\Local\Temp\chainwhisper-product-navigation-comparison.png`.
- Focused navigation comparison: `C:\Users\rosu_\AppData\Local\Temp\chainwhisper-product-navigation-focus.png`.

**Findings**
- No actionable P0/P1/P2 findings remain.
- DEX and P2P use the same 516x46 secondary navigation control, aligned to the shared content edge.
- All four buttons use equal 123.5x36 geometry and preserve their position during DEX mode changes.
- At 2559x1312, the chart is 1254.6px wide and the composer is 609.4px wide. The DEX page has no vertical or horizontal overflow.
- At 390x844, the existing 390x50 mobile navigation remains unchanged and has no horizontal overflow.
- Typography, copy, token colors, borders, icons, and interaction semantics remain from the existing ChainWhisper design system.
- No raster or custom assets were added or replaced.

**Comparison history**
- P1: the first centered segmented menu floated above the workspace and competed with the DEX/P2P product switch. Fixed by anchoring navigation to the shared content frame.
- P2: the following underline rail matched page position but not the product's segmented-control language. Fixed with the existing bordered, rounded, purple-selected control treatment.
- P2: the chart and composer were too close in width. Fixed with a 1.75fr chart and a 560px-minimum / approximately 609px composer at the supplied desktop viewport.
- Post-fix evidence: DEX/P2P navigation coordinates match their shared content edge, tab transitions retain geometry, browser console errors are zero, and the supplied desktop viewport does not scroll.

final result: passed

## Trading route and page-frame consistency correction - 2026-08-29

**Source visual truth**
- `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-106cf5e7-2e5a-423d-8d03-6865e963e316.png`
- `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-355bdcdd-d8f1-4747-949d-b131ef0913ae.png`
- `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-8113d41b-5aeb-4f7a-a72f-4c6abcda32c2.png`
- `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-08f5269d-3c3c-4be4-a469-826a519e982f.png`

**Implementation evidence**
- Desktop captures at `2559 x 1313`: `design-audit/consistency-captures/swap-aligned.png`, `strategies-aligned.png`, `positions-aligned.png`, `agent-aligned.png`, `offers-aligned.png`, and `my-trades-aligned.png`.
- Current P2P inspector: `design-audit/consistency-captures/p2p-inspector-current.png`.
- Reference-left / implementation-right sheet: `design-audit/consistency-captures/reported-vs-corrected.jpg`.
- Machine-readable geometry: `design-audit/consistency-captures/alignment-report.json`, `current-report.json`, and `mobile-report.json`.

**Resolved findings**
- P1 - P2P no longer opens the retired swap workspace. The canonical P2P entry and the DEX/P2P switch now open `/otc/desk`; direct `/otc` and `/otcdesk` bookmarks redirect there. The current switch check found one Offers workspace and zero old swap panels.
- P1 - DEX uses one shared navigation in the fixed `Swap / Strategies / Positions / Agent` order. Legacy DEX and private-liquidity routes redirect to the canonical DEX pages and no legacy notice renders.
- P2 - Swap, Strategies, Positions, Agent, Offers, and My trades now share the same 516 x 46 desktop navigation geometry at x=348, y=149 in the supplied viewport.
- P2 - Page bodies now start at y=201-204 and use the same content edge. The prior Strategies, Agent, and My trades top and horizontal offsets were removed.
- P1 - The explicit My trades inspector is a 460 px right column, does not create document overflow, closes through Back to my trades, and stays cleared after page changes.
- Mobile `390 x 844` checks cover all four DEX routes and Offers, Create, and My trades. Every route has zero horizontal overflow, and the DEX/P2P switch opens `/otc/desk`.

**Automated verification**
- Focused route/navigation tests: 43/43 passed; final route recheck: 24/24 passed.
- Trading regression suite: 644/644 passed.
- Wallet regression suite: 233/233 passed.
- ESLint: passed.
- TypeScript/Vite production build: passed; `dist/index.html` written at 2026-08-29 23:25:34.

Final result: passed.

## P2P stable Offers workspace refinement - 2026-08-30

**Source visual truth**
- Previous approved P2P captures: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/chainwhisper-p2p-offers-terminal.png` and `chainwhisper-p2p-create-ticket.png`, each `2160 x 1310` pixels at a `2160 x 1310` CSS viewport and device scale factor 1.
- User correction: keep the existing Offers list visible when Create is selected, keep Buy/Sell in the trade terminal, and remove the Offers amount control.

**Implementation evidence**
- Offers: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/chainwhisper-p2p-offers-refined.png`.
- Create: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/chainwhisper-p2p-create-refined.png`.
- Combined before-and-after comparison: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/chainwhisper-p2p-refinement-comparison.png`.
- Implementation captures use the same `2160 x 1310` CSS viewport, `2160 x 1310` pixels, and device scale factor 1. No density normalization was required.

**QA findings**
- Full view: Offers and Create now share the same two-column desktop frame. The existing Offers list stays in the `1396.8 px` main column. The right terminal or Create ticket is `720 px` wide and keeps the shared outer gutter.
- Focused controls: Buy/Sell is inside the persistent trade terminal. The separate Offers amount input and redundant terminal Create action are absent. Search, offer rows, private-link access, and the optional closed chart disclosure stay in the existing list.
- Create transition: selecting Create changes only the right task panel. The Offers list, content edge, navigation, and product context remain fixed.
- Responsive behavior: at `390 x 844`, Offers remains a single list with its mobile Buy/Sell control. Create remains a single form and does not duplicate the Offers list. Both routes have zero horizontal overflow.
- Typography and colors: existing Space Grotesk/Inter hierarchy, purple selection, emerald market state, dark surfaces, border tokens, and control radii are unchanged.
- Image and icon fidelity: no raster, logo, or icon asset was added, replaced, or approximated.
- Copy: the error state now refers to preserved direction and filters instead of a removed amount field.
- Browser-rendered checks found zero console errors, zero P2P chart canvases in Offers, and zero document overflow. The in-app Browser remained unavailable because its Windows sandbox helper could not apply read ACLs, so the previously approved local Playwright fallback was used.

**Comparison history**
- P2: Offers previously duplicated Buy/Sell and an amount control above the list. Fixed by moving direction to the terminal and removing the amount control.
- P2: Create previously left the main desktop column empty. Fixed by keeping the same Offers list in the left column and changing only the right task panel.
- Post-fix comparison shows no actionable P0, P1, or P2 issue.

**Automated verification**
- Focused browser regression: 3/3 passed.
- Trading regression: 644/644 passed.
- ESLint: passed.
- TypeScript/Vite production build: passed.

final result: passed
## DEX daily-close candlestick chart - 2026-08-30

- Reference: `codex-clipboard-0fca566b-c4a9-44d5-bf4d-a31c65fd6139.png`
- Desktop: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/dex-candles-desktop.png`
- Mobile: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/dex-candles-mobile.png`
- Browser fallback: local Playwright was used because the in-app Browser sandbox could not apply its Windows read ACLs.
- Desktop and 390x844 checks: 87 daily candles rendered, no document overflow, no browser console errors.
- Visual review: the chart keeps the approved DEX card, axes, controls, spacing, and pair orientation. Narrow green and pink bodies use a quieter grid and keep the latest close visible.
- Data review: each stored UTC day supplies one close. The next candle opens from the previous saved close; its high and low are only the open/close bounds. No wick, volume, or intraday price is invented.
- Verification: focused daily-candle tests, the existing private daily-chart tests, DEX tests, lint, and the production build passed.

final result: passed

## DEX advanced-settings chart height regression - 2026-08-30

- Source visual truth: `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-4b6c5a8c-1fab-434b-8467-4124745fa6f1.png`, `1908 x 916` pixels. It shows the chart stretched to the expanded right-column height.
- Implementation: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/dex-swap-settings-desktop-open.png`, `1600 x 1000` pixels at a `1600 x 1000` CSS viewport and device scale factor 1.
- Combined comparison: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/dex-chart-stretch-fix-comparison.png`.
- State: Swap page with Advanced settings open and custom slippage set to `0.73%`.
- Finding and fix: P1 grid-track stretching made the chart follow the taller form column and retain the excessive height. The shared desktop grid now aligns children to the start, so the chart and form size independently.
- Browser regression: the chart has the same measured height before opening, while open, and after closing Advanced settings. Desktop and `390 x 844` checks have no horizontal overflow or console errors.
- Fidelity review: typography, spacing within each card, approved colors, existing icon assets, and app copy are unchanged. No image asset changed.
- Production build passed.

final result: passed

## DEX taller chart and icon-led slippage disclosure - 2026-08-30

- Source visual truth: `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-73514ceb-10ce-4494-84d6-018c187af485.png`, `764 x 111` pixels, closed slippage state.
- Full implementation: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/dex-swap-settings-desktop-closed.png`, `1600 x 1000` pixels at a `1600 x 1000` CSS viewport and device scale factor 1.
- Focused states: `dex-swap-settings-desktop-focused-closed.png` at `625 x 40` pixels and `dex-swap-settings-desktop-focused-open.png` at `625 x 115` pixels.
- Focused comparison: `dex-settings-icon-row-comparison.png`. It compares the supplied two-row card with the final single-row disclosure at natural pixel density.
- State and interaction: the closed row shows slippage, recommendation, current value, and the established sliders icon. Selecting the row opens custom slippage, minimum fill, and exact-limit access in a compact two-column panel.
- Full-view finding and fix: the independent chart was too short after the stretch correction. It now uses a viewport-relative desktop height capped at `840px`; opening and closing settings does not change its measured height. Mobile resets to its existing fixed chart layout.
- Typography: existing Space Grotesk and approved compact weights remain. The redundant `Advanced settings` and `Best defaults` copy is absent.
- Spacing: the closed control is `40px` high. The advanced fields share one row on desktop and stack on mobile.
- Colors and tokens: approved border, purple focus, emerald recommendation, and dark-surface tokens remain unchanged.
- Image and icon fidelity: no raster asset changed. The sliders icon comes from the app's existing Lucide icon dependency.
- Copy and accessibility: Slippage tolerance remains the disclosure name; both form controls keep explicit labels and keyboard-native details behavior.
- Browser checks: custom slippage, minimum-fill default, open/close behavior, stable chart height, no horizontal overflow, and zero console errors passed at desktop and `390 x 844`.
- Focused component tests: 15/15 passed. ESLint and the production build passed.

final result: passed

## DEX market/header divider alignment - 2026-08-30

- Source visual truth: `C:/Users/rosu_/AppData/Local/Temp/codex-clipboard-d8929f0e-dbaa-4b8e-9f84-fec2f07f37bd.png` (`978 x 232`).
- Implementation evidence: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/dex-market-header-lines-aligned.png` (`1100 x 260`), captured at a `2560 x 1440` CSS viewport and device scale factor 1.
- The fixed desktop header brand boundary is `x=320`. The DEX pair/price divider is `x=319.984375`; the measured difference is `0.015625px` from subpixel grid rounding.
- The full `cwTPB / cwTPQ` label fits without truncation (`clientWidth=118`, `scrollWidth=118`).
- Swap and Strategies keep the same grid rule. P2P remains unchanged.
- Final browser QA found no DEX or P2P horizontal overflow and no console errors. The production build passed.

final result: passed

## Chat privacy gating and trading header alignment - 2026-08-30

- Source visual truth: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/chat-private-trade-reference.png` and `trading-header-alignment-reference.png`.
- Chat implementation: `chat-privacy-locked-full.png` and `chat-privacy-locked-implementation.png`, captured at `2560 x 1312` CSS pixels and device scale factor 1.
- Privacy behavior: locked chat filters private trade cards before virtualization, the empty-state action reads `Unlock privacy`, and the public/self-owned helper copy is removed. The locked QA state had zero trade cards and zero console errors.
- Trading alignment: DEX and P2P workspace tabs, plus the DEX/P2P product switch, now share the same right edge at `x=2536` in the `2560 x 1440` desktop viewport. DEX and P2P pair selectors retain identical mobile token coordinates.
- Responsive checks: desktop and `390 x 844` views have no horizontal overflow. Existing typography, colors, controls, routes, and transaction behavior are unchanged.
- Verification: focused chat tests and the production build passed.

final result: passed

## DEX and P2P terminal right-edge refinement - 2026-08-30

- Source visual truth: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/dex-terminal-spacing-reference.png` (`914 x 1190` pixels).
- Implementation: `dex-chart-top-gap.png`, captured at a `2560 x 1440` CSS viewport and device scale factor 1. Focused crop: `dex-terminal-spacing-implementation.png` (`914 x 1190` pixels).
- Combined focused comparison: `dex-terminal-spacing-comparison.png`. The source includes a developer-tools overlay, so the comparison judges the terminal, navigation, and right-edge relationship rather than overlay colors.
- P2 finding and fix: the 720 px terminal ended `37.1875px` before the 720 px workspace navigation. The DEX workspace now uses the available right gutter, and the P2P Offers, Create, and My trades terminals use the same right alignment. No terminal or menu width changed.
- Post-fix measurements: the product switch, workspace tabs, DEX terminal, Positions terminal, and all P2P terminals end at `x=2536`. Each task terminal remains `720px` wide.
- Typography, colors, icons, assets, copy, control heights, and interaction behavior are unchanged. Desktop and `390 x 844` checks have no horizontal overflow and zero console errors.
- Production build passed.

final result: passed

## DEX chart-to-terminal gutter - 2026-08-30

- Source visual truth: `C:/Users/rosu_/.codex/visualizations/2026/08/22/01a02b75-c54b-73f3-9207-ec729d5c6e8c/dex-chart-terminal-gap-reference.png` (`279 x 183` pixels).
- Implementation: `dex-chart-top-gap.png`, captured at a `2560 x 1440` CSS viewport and device scale factor 1. Focused crop: `dex-chart-terminal-gap-implementation.png` (`279 x 183` pixels).
- Combined focused comparison: `dex-chart-terminal-gap-comparison.png`. It shows the requested separation at the chart and terminal boundary.
- P3 finding and fix: the chart border and terminal touched. The shared desktop DEX grid now has a `10px` column gap. Swap, Strategies, and Positions use the same rhythm.
- Post-fix measurements: the chart ends at `x=1806`, the terminal starts at `x=1816`, and the terminal remains `720px` wide and aligned to `x=2536`.
- Typography, colors, icons, assets, copy, controls, and mobile layout are unchanged. Desktop and `390 x 844` checks have no horizontal overflow and zero console errors.
- Production build passed.

final result: passed

## DEX trading interface - 2026-10-03 (CW-035.03)

- Source visual truth: approved REVIEW.md and captures01-05 in APP/design-audit/dex-production-ux-2026-10-03.
- Final evidence: IMPLEMENTATION.md, implementation-evidence.json and captures11-18,21-24 in the same folder. Swap, Limit and Pool references and implementation images were inspected together. Full-shell and readable form details retain the dark purple/emerald design.
- Layout: Trade / Liquidity / Activity with Agent secondary. Swap/Limit/Recurring, deposit/positions and open orders/history have separate task views. Components stay mounted and local drafts survive view changes. Mobile presents the form before the chart.
- Typography/copy: clearer token units and requirements; exact normal token amounts; address-bound current trial labels. Read-only quote output is separate from editable output/fill floors. Test setup is one disclosure. Fast/Multi-source is beside the primary action.
- Icons/assets: existing icons and assets remain. Shared Full Range no longer has an unrelated range overlay. Sampled and illustrative charts remain explicit; no candles are fabricated.
- P2 defects repaired: inherited fixed P2P tabs hid Agent on mobile; compact header rows overlapped the44px controls and two-line token names. Scoped DEX rules now fit those controls. DEX Agent context no longer shows placeholder P2P symbols.
- Keyboard/disconnected checks: Enter toggles native disclosures; Tab reaches independent output protection with visible focus. Wallet actions remain blocked when disconnected; no wallet was connected. Buy/Sell, shared inversion, draft retention, aliases and DEX/P2P navigation were inspected.
- Narrow viewport: reported390x843 CSS pixels; body width376. All four44px bottom navigation entries fit. The Limit action is reachable by scrolling. Native desktop captures are1881x1567 PNGs from a1260x1050 capture region. Viewport override was reset. The read-only evaluator retained the mobile report after reset; native captures show the restored desktop rendering.
- Final typecheck-5, changed-file lint-4 and build-7 passed. No captured console errors returned. No test suites or new tests were run.
- Limits: active04ea still requires manual price protection; candidate slippage/history activation, native/funded wallet execution, private discovery, completed trade history, formal contrast/screen-reader/device/security acceptance remain open. Recurring retains its separate BCN/HBR context and unavailable admission. Pool API still needs an initial price before its private preview.

final result: passed for bounded local presentation acceptance

## DEX previous-record candles — 2026-10-03 (CW-040.02.01)

- Owner-selected rule: previous consecutive recorded value to latest recorded value, with no high/low wicks. This display convention does not make a first-fresh daily sample a final day close or live feed.
- Evidence: APP/design-audit/dex-close-candles-2026-10-03/IMPLEMENTATION.md, implementation-evidence.json, manual-observations.json and final captures05-13. Intermediate captures01-04 are retained separately from acceptance evidence.
- Visual/source review: existing dark chart, purple controls and emerald/pink marks remain. One Recharts range-bar series draws candle bodies and isolated points; it fixes the mixed-series tooltip defect. Date ticks, endpoint labels and times are explicit. Missing-day rows and markers remain visible.
- All/7D/30D, selected tooltip, reciprocal price inversion, first record, record after a gap, Enter on the data disclosure, expansion and Escape were inspected in CUA. The 7D first body keeps the opening value from outside the period.
- Mobile: reported390x843 CSS pixels; body width and scroll width376. The table scrolls inside its disclosure. Viewport override reset; native desktop rendering inspected after reset. No post-reset desktop CSS measurement is claimed from the cached read-only evaluator.
- Final typecheck-4, focused lint-4 and build-4 completed with exit0. Existing bundler warnings remain. Captured browser error log returned no errors. No test suite or wallet action ran.
- Limit: native recorder activation, source-to-App acceptance, live current-price updates and final daily closes remain open in CW-040.02. Local preview checks do not prove those capabilities.

final result: passed for bounded local candle presentation acceptance

## Owner dark design, contrast and Manage — 2026-10-25 (CW-035.04)

The selected reference is saved in reports/owner-dark-2026-10-24/selected-reference.png. The owner then requested more contrast, corrected borders, an Agent layout repair, and one Manage area. These instructions supersede the older purple surface treatment. All evidence for this work stays in that report folder.

The current App uses a near-black canvas, lighter charcoal panels and fields, brighter secondary text, and purple selection and primary-action states. Tab edges are straight. Empty recovery status regions remain mounted for announcements, but their empty frames are not drawn. Portaled dialogs use the same surface colors as the App.

The DEX has one Manage entry with Orders, Positions and History. Orders are Limit orders. Positions are Pool liquidity claims. Their workspaces and actions remain separate and mounted. Existing /dex/activity and /dex/positions links remain valid. Liquidity still opens the deposit controls.

The Agent defect was reproduced at 1280 by 720: its conversation was 548 px high while its available row was about 429 px. The fixed minimum heights are removed. Help no longer reserves an unused context column. On mobile, attached context starts collapsed. No execution permission or signing behavior changed.

The same Inter and Space Grotesk fonts are served locally. Their original font files, licenses and source hashes are retained. The browser runner now waits for the shared stylesheet before starting tests; its test timeouts were not increased.

### Reference comparison

| Area | Current result |
| --- | --- |
| Color | Dark canvas retained; panels, fields and secondary text have more contrast after owner feedback. |
| Shape and spacing | Small corner radii; one frame per main surface; aligned tab edges; chart and form use shared desktop tracks. |
| Text | Repeated headings and instructions reduced. Fees, privacy, stale/locked/unavailable states and recovery details remain. |
| Assets | Existing brand and token assets retained. No new artwork added. |
| Controls | Existing product navigation, DEX modes/protections/funding, owner actions, P2P access types, Portal pairs and shared dialogs retained. |

### Captured flow and findings

1. Manage: inspected Orders, Positions and History, the deposit view, and existing links. The empty status border is removed. See followup/07-manage-positions-final.jpg.
2. Agent and Help: inspected short desktop and mobile layouts, context disclosure, input reachability and mode switching. The composer stays inside the short desktop window. Help uses the full conversation width. See followup/10-agent-final.jpg and followup/09-help-final.jpg.
3. Shared surfaces: inspected Home, disconnected Chat, P2P Offers/Create/My trades, Portal pairs, TVL unavailable state, Wallet menu and Privacy dialog. Pair, Wallet, Portal and chart keyboard closure were checked. No real wallet was connected or unlocked.

At 390 by 620, the mobile composer bottom was 551.66 px and the navigation top was 572.10 px after keyboard focus moved to the action. No horizontal overflow was measured. Browser size overrides were reset after capture.

Remaining flow findings: the DEX Agent attached market still uses legacy Test token labels while the shared header shows BCN/HBR; DEX Agent execution remains explicitly unavailable. Review shared market context before enabling execution. Review quote/confirmation/pending/recovery windows, P2P counters, Portal conversion/recovery, and Chat/profile/group dialogs next. Unlocked private Chat flows and physical-wallet behavior were not manually exercised in this visual task.

### Verification and limits

- Initial affected local checks: 292 passed, 40 retained skips; affected-verified/result.json.
- Manage navigation and retained links: 80 passed; followup/manage-green/result.json. The new Manage assertions failed before the change.
- Agent/Manage browser checks: 5 passed; followup/agent-manage/result.json. The short-window Agent case failed before the size repair.
- Current build and changed-file lint: passed; followup/build/result.json and followup/lint/result.json.
- The preceding six-file screen run had 62 passes and one WISP fixture failure: the output balance remained Loading. See browser-final.json. This is not claimed as a completed Portal conversion.
- The broad local run had 7,149 passes, 31 failures and 56 skips, plus an archived snapshot import error. Later focused checks correct the changed UI assertions and recovery regions; the broad suite was not rerun or declared clear. See unit/result.json and its logs.
- The first full browser run had 117 passes, 160 failures and one skip. It preceded the final copy and test-readiness corrections. A bounded DEX startup diagnostic reports missing display metadata for that fixture's candidate. See browser-diagnostic.json. No product fallback was added to suppress it.
- Full-repository lint was stopped after 18.5 minutes at about 4 GB of memory. Its failed termination result is retained in lint/result.json. Changed-file lint is not a substitute for a full lint pass.
- Source recovery uses saved UI snapshots, not a clean Git checkout. SOURCE_BEFORE.json, SOURCE_CHANGES.json and CHANGES.diff retain this boundary. Code graph tools were unavailable; source review was limited to the declared UI paths.

Result: the design, concise copy, Manage navigation and bounded Agent layout repairs are implemented and checked in their stated scope. Wider regression acceptance, native wallet execution and release acceptance remain open.

## Trade confirmation and recovery — 2026-10-25 (CW-035.04)

The owner requested the same dark, clean design for trade confirmation and recovery, shorter text, all current controls, and corrected borders. Evidence is in reports/owner-dark-2026-10-24/trade-windows. The local preview is /tests/browser/fixtures/trade-review-harness.html on the existing App dev server. It uses the real confirmation and status components with sample data; it has no wallet or transaction path.

### Findings and repairs

- Recovery reused the Quote explanation and a generic Continue action. It now states the recovery purpose, refund verification and gas requirement, with Recover swap and Back actions. Cancel swap has its own explicit action and Back button.
- The confirmation paragraph inherited a card background and shadow. It is now plain supporting text. Values have one bordered summary with row dividers; action details have one frame. Empty action-detail grids are omitted.
- Long funding amounts and reasons were clipped by nowrap/ellipsis rules. They now wrap in full. The failing mobile browser assertion and the corrected result are retained.
- Confirmation content has its own scroll area. The footer stays outside it. The old modal scrollbar gutter was removed from this non-scrolling outer container so the footer border reaches both edges.
- Swap status, operation metadata, recovery controls and the transaction link now share one panel. CurrentSwapProgress is presentation only. Parent handlers, action eligibility, signing/reconciliation guards, wallet scope, deadlines and private result checks remain in CurrentSwapWorkspace.
- The transaction-hash input inherited the borderless amount-field style. It now has a visible field border, 44 px minimum height and a keyboard focus outline. The missing-border capture is retained as 08-unknown-missing-border.png.

### Flow checks

1. Quote inputs and Accept — passed in the local UI. Amounts, fill/price protections and both fee limits remain visible. The full price/slippage explanation is available in a disclosure. See 10-quote-inputs.png and 11-accept.png.
2. Cancel and Recover — passed in the local UI. Explicit actions and Back remain available. Operation identity and public state remain visible. See 12-recovery.png.
3. Pending, unknown, expired and verified results — passed in representative states. Manual Check current state, recovery hash entry, Recover swap, New Quote and transaction links remain in their applicable states. No resend action was added. See 13-expired.png and 14-unknown.png.
4. Funding and short mobile windows — passed at 390 by 620. Long values wrap, the content can scroll, and both footer actions remain in the viewport. See 15-funding-mobile.png, 16-quote-mobile.png and 17-accept-mobile.png. Desktop checks use 1280 by 720.

### Evidence and limits

- Affected local checks: 119 passed across confirmation, Quote protection, DexV2Page and owner recovery boundaries; unit-green/result.json.
- Six unique browser cases passed; browser-final/result.json. The final recovery input check passed in recovery-border/result.json. Final modal scroll/footer checks passed in short-screen-recheck/result.json. These focused rechecks do not add completion credit for the same cases.
- Full TypeScript/Vite build passed in build-checked/result.json. The final CSS-only bundle passed in final-css-build/result.json; no TypeScript changed after the full build.
- Changed-file lint passed in lint-final/result.json. The final browser assertion was also checked in lint-border/result.json.
- Final recovery/funding image refresh passed in recovery-captures-final/result.json. Final captures 10–17 were saved and inspected after their applicable CSS changes; the missing-border image 08 is diagnostic only.
- Initial command-start and restricted-cache failures did not run the checks and are not counted as passes. The existing supported runner was used with the working Node/npm interface. Only the verified stalled test process tree was stopped; the App preview remained running.
- Returned in-app browser image exports did not match their displayed frames on local readback and were rejected. Accepted final PNGs use the existing Playwright workflow with entry animations disabled during capture. The final files must be inspected before handoff.
- Existing source was dirty before this work. SOURCE_BEFORE.json and before/*.snapshot preserve that boundary; the new SOURCE_CHANGES.json and CHANGES.diff describe this increment. Earlier design evidence remains unchanged.
- The harness does not validate wallet prompts, candidate admission, native GC, on-chain gas, settlement or private refund accounting. No live wallet was connected, unlocked or used. Wider App regression failures and interrupted full-repository lint from the preceding checkpoint remain open; this is local presentation acceptance only.

Result: passed for the bounded confirmation/recovery presentation work. All current controls and their owning guards remain. Broader App, native and release acceptance are unchanged.

## 13 November 2026 — CW-035.04 evidence reconciliation

The local dark-design and concise-text delivery now has a criterion-by-criterion [acceptance review](reports/confirmed-ui-findings-2026-11-12/ACCEPTANCE_REVIEW.md). Retained October 24 terminal logs resolve its original nine DEX test failures; later scoped producers resolve the Agent/Portal guidance and maintained-lint gaps. No DEX tests were repeated for this reconciliation.

One existing Portal browser case passed after its obsolete old-vault-panel expectation was changed to require absence, as the approved clean-App policy already requires. Current WISP/bridge controls, public balance and private locked-state assertions remain. The selected case and test-file lint each exit zero. The current hosted App identity is unchanged; no product code or publication changed in this test-only correction.

Original broad-suite failures remain historical results, not passes. This closes local UI evidence only. Physical wallet prompts, native financial/recovery proof, full-beta acceptance and release gates remain with their owning tasks. The inconclusive top-up investigation stays closed; no deposit or paid preview was repeated.
