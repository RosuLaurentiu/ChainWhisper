# Privacy Portal design QA

## Comparison target

- Source visual truth:
  - Approved desktop concept: `C:\Users\rosu_\.codex\generated_images\019f8ab2-00dc-72f2-94a3-3531057e7feb\exec-d8056585-bc06-4318-939c-b5ec591e24c1.png` (1536x1024 px).
  - Approved mobile concept: `C:\Users\rosu_\.codex\generated_images\019f8ab2-00dc-72f2-94a3-3531057e7feb\exec-6a6fe5db-ceda-45fd-aab6-1f744ec5b36c.png` (853x1844 px).
  - Reported detached-legacy state: `C:\Users\rosu_\AppData\Local\Temp\codex-clipboard-329b6541-08a1-4043-9e86-f005c32e9f00.png` (2212x788 px).
  - Reported missing-output-balance state: `C:\Users\rosu_\AppData\Local\Temp\codex-clipboard-af956306-f24a-40e1-ad92-0ec240dc3d4c.png` (1566x988 px).
- Browser-rendered implementation:
  - `C:\Users\rosu_\.codex\visualizations\2026\07\22\019f8ab2-00dc-72f2-94a3-3531057e7feb\legacy-recovery-final-desktop.jpg` (1536x1024 px).
  - `C:\Users\rosu_\.codex\visualizations\2026\07\22\019f8ab2-00dc-72f2-94a3-3531057e7feb\legacy-recovery-final-expanded.jpg` (1536x1024 px).
  - `C:\Users\rosu_\.codex\visualizations\2026\07\22\019f8ab2-00dc-72f2-94a3-3531057e7feb\wisp-output-balance-matched-desktop.png` (1566x988 px).
  - `C:\Users\rosu_\.codex\visualizations\2026\07\22\019f8ab2-00dc-72f2-94a3-3531057e7feb\wisp-output-balance-final-mobile.png` (390x844 px).
- Route: `http://127.0.0.1:4173/portal`.
- CSS viewports and density: 1536x1024, 1566x988, and 390x844 at device pixel ratio 1. The balance comparison used the exact 1566x988 source dimensions; the approved mobile concept is a higher-density design reference and was judged against the responsive 390x844 CSS viewport without treating density as drift.
- State: dark theme, WISP selected, current ChainWhisper bridge, To private, disconnected wallet, privacy locked, legacy recovery collapsed by default; the expanded legacy state was captured separately.

## Comparison evidence

- Full-view comparison: `C:\Users\rosu_\.codex\visualizations\2026\07\22\019f8ab2-00dc-72f2-94a3-3531057e7feb\wisp-output-balance-before-after.png` places the reported state and final browser render in one comparison image.
- Focused comparison: `C:\Users\rosu_\.codex\visualizations\2026\07\22\019f8ab2-00dc-72f2-94a3-3531057e7feb\wisp-output-balance-focused-comparison.png` makes the receive-panel header legible and confirms the new `Balance: Locked` pWISP state.
- Legacy recovery evidence confirms one `.privacy-legacy-recovery` inside `.privacy-wisp-card`, none detached below `.swap-page-panel`, one CTA while expanded, and no legacy section for official-token selections.

## Required fidelity surfaces

- Fonts and typography: existing Space Grotesk/product typography, weights, casing, and compact metadata hierarchy are preserved; the new balance label uses the existing panel-header treatment.
- Spacing and layout rhythm: legacy recovery now shares the WISP card boundary and grid rhythm; desktop and 390px mobile views have no horizontal overflow.
- Colors and visual tokens: existing purple focus/brand states, muted metadata, dark surfaces, live green, and privacy-lock orange remain consistent.
- Image quality and asset fidelity: the checked-in WISP artwork and existing Lucide icon set remain sharp at desktop and mobile sizes; no placeholder or synthetic asset replaced a source asset.
- Copy and content: the output panel now reports the paired-token balance state, while the existing `1:1 before portal fee` row retains conversion information. Private values display `Locked` whenever privacy is locked and `Unavailable` after a failed read, never a false zero.

## Findings

- No actionable P0, P1, or P2 design findings remain in the Privacy Portal scope.
- No follow-up P3 polish is required for the reported balance issue.

## Comparison history

1. P2: legacy pWISP recovery appeared as a detached full-width strip. Fixed by nesting it in the WISP conversion card, keeping it collapsed by default, and hiding the current-bridge CTA while recovery is expanded. Post-fix evidence: `legacy-recovery-final-desktop.jpg` and `legacy-recovery-final-expanded.jpg`.
2. P2: the receive panel showed conversion copy but no paired-token balance. Fixed by adding the direction-aware output balance to the receive-panel header. Post-fix evidence: `wisp-output-balance-before-after.png` and `wisp-output-balance-focused-comparison.png`.
3. P1 privacy edge case found during review: a cached private bigint could briefly outlive the AES-ready state. Fixed by making privacy lock state take precedence over cached values and explicitly disabling private-direction Max while locked. Post-fix browser evidence shows `Balance: Locked`; automated checks pass.

## Interaction and regression checks

- Browser interactions: WISP selection, To private/To public direction switching, receive-side balance in both directions, disabled Max for locked private input, legacy collapse/expand, WISP-only recovery isolation, mobile token picker, keyboard Escape/focus restoration, and all route aliases.
- Browser diagnostics: nonblank render, no blocking overlay, no horizontal overflow at 1566x988 or 390x844, and no console error or warning entries.
- Automated checks: TypeScript passed; ESLint passed; Vitest passed 68 files and 634 tests; production build passed; Privacy Portal Playwright spec passed 5/5; all seven mainnet registry entries passed the read-only verifier.
- The repository-wide Playwright run remains red in unrelated pre-existing trading/wallet specs (31 passed, 35 failed, 5 skipped). All Privacy Portal browser cases passed in that run and in the focused rerun.

## Open questions

- None for this UI correction.

## Implementation checklist

- [x] Show the paired output-token balance.
- [x] Keep private balances masked while privacy is locked.
- [x] Prevent locked private Max usage.
- [x] Keep legacy recovery integrated, collapsed, and WISP-only.
- [x] Verify desktop, mobile, routes, tests, build, and mainnet registry reads.

final result: passed
