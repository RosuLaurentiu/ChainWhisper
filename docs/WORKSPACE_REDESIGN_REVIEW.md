# Workspace Redesign Hotspot Review

Date: 2026-08-13

Historical review. The 2026-10-29 owner clean-slate decision supersedes its
old-contract reader/compatibility requirements. Direct and Group legacy readers
are removed under [CW-035.06](../reports/current-app-clean-slate-2026-10-29/AUDIT.md).
Use current APP/AGENTS.md and ARCHITECTURE.md for new work. The original findings
below remain evidence; they do not require rebuilding the removed bridges.

This is the semantic review of the eight APP paths provisionally classified as
`Redesign` by `WORKSPACE_CHANGE_CLASSIFICATION.md`. It does not approve the
whole dirty workspace, create a recoverable checkpoint, freeze an ABI, or close
FND-001/FND-004. It records which structural work is required before the next
testnet functional pass and which broad refactors are deliberately deferred
until behavior is proven.

## Decision rule

- Remove an obsolete write path immediately when it can still reach a retired
  contract, signer, allowance, or transaction selector.
- Keep an explicit read-only compatibility path when removing it would make
  historical user data unavailable.
- Do not split a large, behaviorally sensitive wallet, sync, or trading file
  only to reduce line count while live testnet journeys are still pending.
- Require a source-level architecture test for every temporary legacy boundary.

## Reviewed paths

| Path | Current size | Decision before next testnet pass | Required release gate |
|---|---:|---|---|
| `src/App.tsx` | 4,732 lines | Keep as the current composition root. Extract only a cohesive runtime when an actual functional change benefits from it; do not perform a broad state rewrite now. | Browser-wallet-only architecture tests, account/network teardown tests, and MetaMask/CipherTrade live journeys must pass before release consolidation. |
| `src/features/trading/components/P2PTradingPage.tsx` | 3,648 lines | Keep the current use-case composition through functional QA. Continue moving independently testable terminals/hooks when changing those flows, but do not redesign the whole page before the separate UX phase. | Complete all Standard/Private/Direct/Recurring/Private Liquidity/Hidden Intent testnet journeys and then review the rendered desktop/mobile surface in M8. |
| `src/features/chat/hooks/useDirectConversationSync.ts` | 968 lines | Keep the intentional dual-read bridge: Direct V2 is canonical, while ChatGC remains historical read-only. The V1 address/ABI now comes only from `legacyChatContracts.ts`. | Retire this bridge only after an explicit legacy-history export/retirement decision; until then, its import is allowlisted and its ABI contains no write selector. |
| `src/features/groups/hooks/useGroupDataSync.ts` | 981 lines | Keep the intentional Group V2 plus historical Group V1 read bridge. The V1 address/ABI now comes only from `legacyChatContracts.ts`. | Remove only after the legacy-group history policy is approved; until then, safe read-only discovery and testnet Group V2 journeys remain mandatory. |
| `src/features/wallet/hooks/useWalletOnboarding.ts` | 2,179 lines | Do not broadly split the lease lifecycle while wallet stability is still being exercised. The retired app wallet is already absent; preserve one selected MetaMask/CipherTrade session and exact lease invalidation. | Live reconnect, privacy unlock, account/network switch, WalletConnect mobile, provider failure, and MetaMask crash/recovery journeys must pass before any structural rewrite. |
| `src/lib/appChain.ts` | 4,873 lines | Remove dead V1 transaction helpers now; otherwise keep stable chain helpers until their owning use case changes. The obsolete Group V1 allowance and message-gas helpers have been deleted. | New contract reads/writes must remain versioned and owner-capability-bound. Domain extraction is allowed during M7 fixes or M9 consolidation when backed by affected full suites. |
| `src/lib/appShared/contracts.ts` | 400 lines | Keep current token/trading compatibility constants, but do not expose retired chat contracts through the shared barrel. ChatGC/Group V1 definitions have moved to the explicit read-only module. | Frozen V2 manifests/ABIs replace provisional constants during release consolidation; stale and shelved contracts are removed in RC-002. |
| `src/lib/appShared/core.ts` | 1,707 lines | Keep the compatibility barrel during functional QA. Prefer direct imports when touching nearby code, but avoid a mass import churn unrelated to behavior. | The final candidate must contain only the owner wallet role, no app-wallet symbols, and no retired chat write surface; M9 may split the barrel after all use-case tests pass. |

## Boundary changes completed by this review

1. Added `src/lib/legacyChatContracts.ts` with only `view` functions and events
   for ChatGC and Group Chat V1.
2. Removed ChatGC and Group Chat V1 addresses/ABIs from the general
   `appShared/contracts.ts` export surface.
3. Migrated exactly seven approved production compatibility readers to the
   explicit legacy module.
4. Removed the unused legacy ChatGC nickname transaction implementation. Public
   nickname writes remain Direct Chat V2-only.
5. Removed unused legacy direct/group message fee selectors and fee readers.
6. Removed the unused Group V1 token-approval and message gas-estimation write
   helpers.
7. Added a source-level regression that rejects any new importer or any
   state-changing ABI fragment in the legacy compatibility module.

## Deferred work is not acceptance

The four broad deferrals above are sequencing decisions, not assertions that the
files are well-sized or final. They remain classified `Redesign` until the full
testnet functional rehearsal and separate UX pass show which boundaries are
stable. M9 must re-evaluate each path against the exact release candidate before
the requested Ponytail and Codex Security audits.
