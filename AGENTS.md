# ChainWhisper App instructions

Updated 2026-10-29 for CW-035.06. The [root instructions](../AGENTS.md),
[architecture](../ARCHITECTURE.md) and [roadmap](../MASTER_ROADMAP.md) control
product scope and authority. Backlog is the only planner. The unchanged
[previous instructions](reports/current-app-clean-slate-2026-10-29/APP-AGENTS-before.md)
are historical evidence, not current compatibility requirements.

## Current-contract App

- Owner correction, 2026-11-12: old positions49/54 are not prerequisites for
  the new App. The two exact saved old-candidate records may be archived once,
  reversibly, without claiming private accounting passed. Keep current/unknown
  pending-send checks and preserve historical evidence. Do not add a general
  ignore-old-record rule. Old Chat/P2P investigation does not gate this App;
  API/SDK/MCP release work follows App completion. See
  [decision-032](../Planning/maintenance/current-product-audit-2026-11-12/APP_FIRST_DECISION.md).

- Owner decision: this App is a clean slate. Do not load previous deployments,
  merge their history, mount old readers while current setup is unavailable, or
  retry through an old ABI. Reject unsupported contract references explicitly.
- Use the exact current manifest, chain, contract and owner identity. A loading,
  held or failed current runtime must stay unavailable; it must not select an
  old runtime. Read-only admission does not grant signing authority.
- Keep current-contract history, participant receipts, pending journals, privacy
  controls and recovery. Preserve historical source, native evidence and any
  old liabilities separately. Do not delete keys or recovery material as cleanup.
- A version suffix is not evidence of obsolete code. Reactions V1 is current.
  Route aliases and a provider fallback for the same selected contract are not
  old-contract compatibility.
- Preserve existing Builder changes. Trace callers before deletion. Fix the
  confirmed gap; do not redesign the App or add a compatibility framework.

## Required beta

- One usable Testnet App includes DEX, P2P and Chat. Component evidence is not
  whole-beta acceptance. Use CW-009.06, CW-020, CW-025 and CW-035 as specified
  in the root instructions.
- DEX: shared Full Range Pools, position NFTs, plain Limits, Fast and asynchronous
  swaps, prices/chart/slippage, four-token claims/refills, Your Positions,
  My Orders, My Activity, services and safe exits. No old candidate fallback.
- P2P: Offers / Create / My trades, book, shared link and Direct trades, public
  and private ERC20, counters, history and safe exits. Use current Book/Math,
  Standard/Direct and Link/Counter bindings. Do not mount retired recurring
  discovery or old financial graphs. Preserve approved disclosure rules.
- Owner correction, 2026-10-30: normal P2P is escrow trading between people,
  with book/link/Direct offers, counteroffers and negotiation. Remove bid/ask
  strategies and hidden limits from normal creation, offers and matching; DEX
  Limit matching supplies the automated limit-order product. Ordinary private
  offers keep optional budget privacy. Preserve existing strategy/hidden-limit
  funds and owner withdrawal/refund recovery under My trades. Their source and
  native proof remain retained, outside beta; no new activation without approval.
- Chat: current Direct/Group epoch envelopes and AES-GCM messages, replies,
  reactions, profiles, encrypted attachments, membership and reconnect recovery.
  No retired ChatGC/Group readers or global timestamp read-state backup.
- Normal use must not need chat instructions, manual files or routine NFT IDs.
  Show locked, pending, stale, incomplete, unsupported and unavailable states.
- WISP/Portal, Private TVL and MCP/Agent Wallet remain
  in the wider product. Do not remove their current features or turn them into
  new beta requirements during this cleanup.

## Wallet, privacy and funds

- Use one connected owner wallet: MetaMask or CipherTrade, including supported
  mobile/WalletConnect sessions. Preserve it across route changes.
- Obtain signers only from the live lease-guarded EIP-1193 owner session and COTI
  BrowserProvider. No local wallet, burner, silent signer fallback or dual write.
- Keep privacy keys session-only. Never store keys or plaintext private terms in
  local storage, Supabase, logs, planning or reports. Attachments stay encrypted.
- Preserve candidate/chain/ABI checks, bounded RPC dispatch and stop-on-403, fresh financial
  admission, exact accounting/refunds, current-state checks, no-resend and recovery.
  Unknown sends must be reconciled before continuation. Existing holds still bind.
- My trades and Activity may publish verified partial results. Mark coverage
  incomplete until each required current source finishes. Session replacement or
  privacy lock must reject old private results and clear private projections.
- Direct/Group unread state uses finalized per-conversation message-ID cursors.
  Advance only after viewport acknowledgement. Cross-device sync is authenticated
  and cursor-only; no on-chain maintenance messages for read state.
- Keep the keeper narrow: public pending discovery, permitted steps and restart
  reconciliation. Do not replay unchanged fixture/history checks in normal swaps.

## UI and ownership

- Preserve the approved dark-purple design and shared Trading shell. No broad
  layout, navigation or palette change. Use clear terms and accessible controls.
- When updating a local preview, retain hash-named assets needed by the actual
  active client until its reload adopts the new build. Copy only missing files
  from that verified build; reject a same-name hash mismatch. Keep the new HTML
  and manifests unchanged. This retains UI files, not old-contract readers.
- ui-sdk (CW-159): before you use `@ui-sdk/react`, follow the ui-sdk skill in
  `.agents/skills/ui-sdk` and read `node_modules/@ui-sdk/react/docs/llms.txt`.
  To build a new component, also search `node_modules/@ui-sdk/react/docs/core.md`
  by heading and read `rendering.md` next to it. Style each part with the App
  tokens; the default `web.css` look must not replace the approved design.
  Feature code uses the wrappers in `src/shared/ui` (CW-160) and does not import
  ui-sdk parts directly. Compare computed styles before and after a conversion.
  A wrapper puts the class `app-ui` on each part; the `app-ui-reset` layer in
  base.css then removes the ui-sdk default look (CW-162).
- Route ownership is in src/shell/routing.ts. Keep same-App navigation and
  harmless aliases. An old contract link may show unsupported; never reinterpret
  its ID as an order on the current contract.
- Trade identity includes chain, escrow and order ID. Prices, amounts and privacy
  follow the approved protocol; display data is not authority for a send.
- Keep current WISP and official bridge behavior distinct. Archived vaults and
  legacy rewards contracts are not a fallback for current Portal or Chat setup.
- Home and Private TVL are read-only surfaces. Do not add wallet prompts there.
- External MCP is separate from the selected browser wallet. Do not accept keys
  in prompts or move Agent Wallet signing into the App.

## Checks and handoff

- Use focused tests for each changed path and the existing App build. Check
  wallet/privacy invalidation, contract selection, money movement and recovery
  when affected. A copy-only edit needs no contract rerun.
- Use existing browser checks for changed rendered flows when permitted.
  No automatic full-suite or funded-test campaign after every edit. Reuse native
  proof when contract bytes and its assumptions are unchanged.
- Record exact source/build identity, affected results, limits and one next
  action in Backlog. Local tests/build are not connected-wallet acceptance.
- Reports and experiments belong with this component. Preserve useful evidence;
  remove owned disposable output when it is no longer needed.

## Publication

- Owner decision, 2026-11-15 (CW-087): the `main` branch publishes
  chainwhisper.app. A push to `main` runs the deploy workflow and replaces the
  hosted Testnet App. Each such push needs the owner's explicit approval. Do not
  publish through the `whisper` branch or its manual workflow.
- Check a release build in a clean tree with LF files. A GitHub build has
  tracked files only; the generated `.env.coti-testnet-candidate.local` is not
  in it, so the tracked settings must hold the released values.
- The deploy takes old hash-named files for open tabs from the hosted
  `BUILD_MANIFEST.json`. If the hosted site cannot be read, the deploy stops.
  [Record](reports/pages-release-2026-11-15/RELEASE_RESULT.json).
