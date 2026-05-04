# ChainWhisper Smart Contract Improvement Backlog

This file captures ideas that would require a future smart contract version or contract-adjacent protocol change. It is separate from `APP_IMPROVEMENTS.md` so app-only cleanup and contract design proposals stay easy to reason about.

No runtime app behavior, deployed contract address, ABI, schema, or route is changed by this document.

## Current Trading V1 State

The app now targets the fresh Trading V1 suite only for active P2P behavior:

- `ChainWhisperOTCEscrowV1`: `0xFe76733F6698F1682f8D85FA915D0fbA75A59090`
- `ChainWhisperOTCReaderV1`: `0xb868E143a9B5dC94719D33509Ed9486FBCd9C80C`
- `ChainWhisperPrivateOrdersV1`: `0x2CEa94cDe8F6279d4669d4df8c28D1156Ac1ACf2`
- `ChainWhisperRecurringOTCV1`: `0xd9CF385c42A90fA7F5b624F52dBAa8654C061Cb2`

Trading V1 terminology:

- Use "private orders", not "private liquidity", for hidden amount/fill OTC offers.
- Private tokens do not imply hidden order size. Visible private-token OTC orders route through `ChainWhisperOTCEscrowV1` and show public size, fill, and remaining amounts.
- Hidden amount is an explicit maker choice. Hidden-size one-off orders route through `ChainWhisperPrivateOrdersV1`; hidden recurring private-token orders route through the private recurring path on `ChainWhisperRecurringOTCV1`.
- Use "hybrid private order" when a private-token side is handled by the private-order or recurring contract and the other side is public/native.
- Recurring V1 is a two-sided reusable OTC order, not a timed/cadence template. Buy and sell sides have independent prices, and live liquidity recycles between sides.
- Recurring V1 supports edit-in-place for prices plus live liquidity add/remove controls. The app should not expose a separate per-fill amount setting.
- Hidden one-off and recurring orders use a user-scoped private ledger: maker-readable live snapshots are written on create, edit, fill, cancel, and close, and maker/filler receipts are emitted for every fill.
- The app uses the COTI MetaMask Snap only for Trades privacy AES flows. Chat/group messaging and Whisper Shield stay on the existing wallet/onboarding paths.
- Each active trading contract that can hold private tokens has owner-only private-token encryption-account setup for pWISP.
- Old trading contracts and old trading links are intentionally unsupported in active app behavior.

Review inputs:

- App behavior in this repository, especially chat sync, group admin flows, P2P trade actions, and private-liquidity UI rules.
- Contract sources in `C:\Users\rosu_\Desktop\COTI Projects\conf\group-chat-contract\contracts`.
- COTI docs for private data types, `MpcCore`, Private ERC-20, encrypted inputs, and encrypted outputs.

## Contract Direction

- Keep future privacy work aligned with COTI garbled-circuit primitives: encrypted inputs as `it*`, private computation as `gt*`, encrypted storage as `ct*`, and user-readable outputs as `ut*`.
- Do not move group messaging to a plain app-managed shared-key model. If future contracts borrow any idea from `GroupChatManagerV3`, borrow only indexing/read-helper convenience, not the shared ciphertext delivery model.
- Prefer contract APIs that make the app faster without exposing more data: better IDs, cursors, counters, and user-scoped encrypted outputs.

## Ideas At A Glance

- Encrypted maker recovery note for private trade links.
- Garbled-circuit group delivery with message IDs.
- Group sync read helpers for the current privacy model.
- Pending invite and join-code admin indexes.
- Batch trade reads for faster P2P desk loading.
- Per-trade fill policy for better OTC order control.
- Trade replacement lineage helpers.
- Quote and simulation helpers.
- Approval-assisted trade flows.
- Public desk indexes by pair, maker, and access type.
- Private fill receipts for hidden-liquidity trade history.
- Encrypted app-state backup channel.
- Contract-scoped trade identity metadata.
- Private liquidity privacy invariants.
- Hybrid private liquidity for one-private-token orders.
- Contract version and feature flags.
- Recurring OTC buy/sell order templates.
- Permanent OTC offers with no expiry.

## High Impact

### Encrypted maker recovery note for private trade links

Problem:

- Unlisted/private trade links currently depend on an off-chain `accessSecret`.
- The contract can safely store only `accessHash = keccak256(accessSecret)` for enforcement.
- If the raw secret is stored on-chain, the private link is no longer private because anyone can read it.
- If the app does not persist the secret locally, the maker can still manage the trade but cannot recreate the full private share link after reload unless they saved it.

Proposal:

- Keep `accessHash` as the enforcement primitive.
- Add contract support for maker-recoverable encrypted access metadata using COTI private data types.
- The app creates the `accessSecret`, encrypts it as an `itString` or compact encrypted bytes payload for the escrow function, and the contract validates/offboards it only to the maker.
- The contract stores or emits only `utString`/ciphertext, never the raw secret.
- Later, the maker opens My Trades, the app reads the encrypted payload from chain, decrypts it with the maker wallet/AES context, and rebuilds the private share link.

Possible contract shapes:

```solidity
struct Trade {
    uint256 tradeId;
    address maker;
    address taker;
    bytes32 accessHash;
    utString makerEncryptedAccessSecret;
    // existing fields...
}
```

or event-only recovery metadata:

```solidity
event TradeAccessBackup(
    uint256 indexed tradeId,
    address indexed maker,
    utString makerEncryptedAccessSecret
);
```

Design notes:

- Prefer preserving the current `accessHash` behavior so accept/fill authorization stays simple.
- Treat encrypted recovery as optional metadata, not as the access-control mechanism.
- Include the escrow contract address in app-side recovery keys because trade IDs are contract-local.
- Support older trades that do not have encrypted recovery metadata.
- Consider whether a maker should be able to rotate or clear the encrypted recovery note.
- If event-only storage is used, confirm indexers/app sync can reliably recover historical backup events.
- Keep the backup ciphertext user-scoped to the maker; do not emit a reusable secret encrypted only with the network key.

App follow-up once contract support exists:

- Remove persistent local storage for trade access secrets.
- Keep private trade secrets only in the current URL, memory for the active session, or encrypted on-chain maker recovery metadata.
- Update My Trades to show a "Copy private link" action only when the maker can decrypt the recovery note or the current session already has the secret.
- Update user copy so makers understand that private links are recoverable only when encrypted recovery metadata exists.

### Garbled-circuit group delivery with message IDs

Problem:

- `GroupChatManagerV2` already uses the right privacy model: sender submits one `itString`, the contract validates it, and emits per-user `utString` delivery events with `MpcCore.offBoardCombined`.
- The app still has to scan wider block ranges because group message events do not expose stable message IDs.
- `GroupChatManagerV3` adds message IDs, but its shared ciphertext/group-key delivery design is not the desired ChainWhisper privacy direction.

Proposal:

- Keep V2-style per-recipient garbled-circuit delivery.
- Add a monotonic `messageId` per group and include it in sender and recipient events.
- Keep `lastMessageBlockForGroup`, and add `nextMessageIdForGroup` or `lastMessageIdForGroup` so the app can reason with message cursors instead of only block windows.
- Preserve sender and recipient decryptability through `utString` outputs.

Possible contract shape:

```solidity
event GroupMessageSubmittedV2(
    uint256 indexed groupId,
    uint64 indexed messageId,
    address indexed from,
    utString messageForSender,
    uint256 valueSent,
    uint256 feeTaken
);

event GroupMessageDeliveredV2(
    uint256 indexed groupId,
    uint64 indexed messageId,
    address indexed recipient,
    address from,
    utString messageForRecipient
);
```

Design notes:

- Keep `messageId` public because it is metadata only; message content remains user-scoped encrypted output.
- Use `messageId` for app-side dedupe, reply references, and active-group incremental sync.
- Do not emit plaintext message bodies, shared group keys, or reusable shared ciphertext as the primary privacy model.

### Group sync read helpers for the current privacy model

Problem:

- The app reconstructs group overview state from multiple event filters, member reads, invite reads, and cached block cursors.
- Group sync is slower than direct chat because the app has to infer what changed before it knows which group/message range matters.
- The contract can expose compact metadata without weakening message privacy.

Proposal:

- Add V2-compatible view helpers that return group overview metadata in pages or batches.
- Include non-sensitive sync hints: `memberCount`, `pendingInviteCount`, `lastBlock`, `lastTimestamp`, `lastMessageBlock`, and latest message ID.
- Add a member sync page that returns `GroupInfoView[]` for the wallet's current groups.

Possible contract shape:

```solidity
struct GroupInfoView {
    uint256 groupId;
    address admin;
    uint64 createdAt;
    uint32 memberCount;
    uint256 pendingInviteCount;
    uint256 lastBlock;
    uint256 lastTimestamp;
    uint256 lastMessageBlock;
    uint64 nextMessageId;
}

function getGroupInfoBatch(uint256[] calldata groupIds) external view returns (GroupInfoView[] memory);
function getGroupsForMemberSyncPage(address account, uint256 cursor, uint256 limit)
    external
    view
    returns (GroupInfoView[] memory groups, uint256 nextCursor);
```

Design notes:

- These helpers should not return encrypted messages or private join-code contents.
- Keep group membership truth on-chain with `isMember` and `getGroupMembers`.
- The app can use these helpers to prioritize the active group and avoid broad scans when only overview metadata changed.

### Pending invite and join-code admin indexes

Problem:

- The app currently scans invite and join-code events to build pending invite state and active admin join-code lists.
- V2 already stores pending invites and active join-code hashes, but app-friendly read pages are incomplete.
- Admins need fast management without exposing raw join codes to non-admins.

Proposal:

- Track pending invite group IDs per account and expose a paged pending-invites read.
- Add a paged active join-code view for admins that returns hash, creator, signer, expiry, uses left, active, and expired flags.
- Keep raw join-code recovery admin-only and encrypted with COTI user output.

Possible contract shape:

```solidity
struct PendingInviteView {
    uint256 groupId;
    address inviter;
    uint64 expiresAt;
    bool pending;
    bool expired;
}

function getPendingInvitesForAccountPage(address account, uint256 cursor, uint256 limit)
    external
    view
    returns (PendingInviteView[] memory invites, uint256 nextCursor);

function getActiveJoinCodesPage(uint256 groupId, uint256 offset, uint256 limit)
    external
    view
    returns (JoinCodeView[] memory codes, uint256 nextOffset);
```

Design notes:

- Returning hashes and metadata is fine; never return the raw join code from a public view.
- Keep `getJoinCodeForAdmin` as a non-view user-scoped encrypted offboard function when the admin needs to recover/copy a code.
- Expired invite/code rows may stay visible until cleanup, but the view should label them so the app does not need extra calls.

### Batch trade reads for faster P2P desk loading

Problem:

- The app loads trade ID pages and then resolves each trade's details, metadata, fill state, replacement state, and sometimes private-maker progress separately.
- This is workable for a small desk, but it makes public discovery, My Trades, and history feel slower as the number of offers grows.
- The contract already has the data needed to return compact trade views in a single call.

Proposal:

- Add batch read methods for standard trades and private-liquidity trades.
- Preserve the current public/private disclosure boundary: batch public views must not reveal private hidden amounts or fill amounts.
- Keep paged ID reads for backwards compatibility, but let the app prefer view pages when supported.

Possible contract shape:

```solidity
function getTradeViews(uint256[] calldata tradeIds) external view returns (TradeView[] memory views);

function getOpenPublicTradeViewsPage(uint256 offset, uint256 limit)
    external
    view
    returns (TradeView[] memory views, uint256 nextOffset);

function getTradeViewsForMaker(address maker, uint256 offset, uint256 limit)
    external
    view
    returns (TradeView[] memory views, uint256 nextOffset);
```

Design notes:

- For `P2PPrivateTradeEscrow`, `TradeView.fillState` should remain zeroed for hidden-liquidity public reads unless the method is explicitly maker/filler scoped and encrypted.
- Consider separate public view structs if `TradeView` grows too broad.
- Add limits like `MAX_PAGE_LIMIT` to prevent oversized reads.

### Per-trade fill policy

Problem:

- `minPartialFillBps` is currently global on `P2PTradeEscrowV2`.
- OTC makers may want different rules per order: no partial fills, a minimum fill size, or a maximum fill per wallet.
- A global rule makes the UI explain contract behavior that may not match the maker's intent for a specific offer.

Proposal:

- Add optional per-trade fill policy metadata to standard and future private-liquidity offers.
- Let makers choose whether partial fills are allowed, the minimum fill amount or BPS, and whether one wallet can fill multiple times.
- Keep sensible owner-level defaults, but snapshot the selected policy into each trade when it is created.

Possible contract shape:

```solidity
struct FillPolicy {
    bool partialFillsAllowed;
    uint16 minPartialFillBps;
    uint256 minRequestAmount;
    uint256 maxRequestAmountPerWallet;
    bool oneFillPerWallet;
}
```

Design notes:

- If both `minPartialFillBps` and `minRequestAmount` are set, enforce the stricter value.
- For private-liquidity trades, public views should disclose the policy only where it does not reveal hidden remaining liquidity.
- Add tests for exact fill only, minimum fill rejection, final small remainder handling, and repeated fills by the same wallet.

### Trade replacement lineage helpers

Problem:

- The contracts already track `replacementTradeId` and `replacesTradeId`.
- The app still has to walk replacement chains to decide whether a copied link points to the latest version or an older cancelled version.
- History would be easier to read if replacement/edit lineage were explicit and cheap to resolve.

Proposal:

- Add helpers that resolve the latest replacement and optionally return the full replacement chain.
- Emit replacement events that include the root trade ID when a trade is edited multiple times.

Possible contract shape:

```solidity
function getLatestReplacement(uint256 tradeId) external view returns (uint256 latestTradeId);
function getReplacementChain(uint256 tradeId, uint256 limit) external view returns (uint256[] memory tradeIds);

event TradeReplacementLinked(
    uint256 indexed rootTradeId,
    uint256 indexed previousTradeId,
    uint256 indexed nextTradeId
);
```

Design notes:

- Guard against long chains with a limit or max edit count.
- Keep existing `replacementTradeId` and `replacesTradeId` for backwards compatibility.
- The app can use this to show "This offer was edited" and jump users to the current live offer.

### Quote and simulation helpers

Problem:

- The app duplicates fill math to preview expected receive amounts, final-fill behavior, and slippage checks.
- If the contract math changes, app previews can become stale.
- Private-liquidity quote logic must not reveal hidden liquidity.

Proposal:

- Add safe read helpers for public/standard trade quotes.
- Add encrypted or user-scoped quote helpers only where COTI privacy allows the intended user to decrypt the result.
- Keep quote methods advisory; the write method remains the source of truth.

Possible contract shape:

```solidity
function quoteFill(uint256 tradeId, uint256 requestAmountIn)
    external
    view
    returns (
        uint256 offerAmountOut,
        uint256 nextRemainingOfferAmount,
        uint256 nextRemainingRequestAmount,
        bool wouldFill
    );
```

Design notes:

- Standard public trades can return plaintext quote results because their amounts are already public.
- Private-liquidity quote helpers should avoid public remaining amounts and may need `utUint64` outputs scoped to maker/filler.
- Add tests that quote and fill paths agree exactly, including final-fill rounding.

### Approval-assisted trade flows

Problem:

- Creating and filling ERC-20 trades can require an approve transaction followed by the trade action.
- Private ERC-20 approval is even more sensitive because it depends on encrypted allowance handling and AES readiness.
- Extra transaction steps make the OTC desk feel heavier than it needs to.

Proposal:

- Add permit-style or approval-assisted flows where token standards support them safely.
- For public ERC-20s, consider `createTradeWithPermit` and `fillTradeWithPermit`.
- For private ERC-20s, only add an equivalent if COTI's private-token approval model supports it without weakening encrypted allowance guarantees.

Possible contract shape:

```solidity
function createTradeWithPermit(
    TradeAsset calldata offerAsset,
    TradeAsset calldata requestAsset,
    address taker,
    uint64 expiresAt,
    bool isPublic,
    bytes32 accessHash,
    bytes calldata permitData
) external payable returns (uint256 tradeId);
```

Design notes:

- Keep normal approve-and-action flows available.
- Permit data should be token-specific and optional; unsupported tokens should fail clearly.
- Avoid adding private-token shortcuts until the encrypted allowance semantics are fully understood and tested.

### Public desk indexes by pair, maker, and access type

Problem:

- The public desk currently loads public trade IDs and filters/grouping happens in the app.
- As the desk grows, the app will spend more time fetching offers that are not relevant to the active pair/search.
- OTC discovery benefits from pair-focused browsing without turning the product into a pool/router DEX.

Proposal:

- Add optional on-chain indexes for open public trades by token pair, maker, and access/privacy mode.
- Keep these as discovery helpers; trade truth still lives in each trade record.
- Consider activity ordering for edited, partially filled, or maker-refreshed offers.

Possible contract shape:

```solidity
function getOpenTradeIdsForPair(
    address offerToken,
    address requestToken,
    uint8 offerAssetType,
    uint8 requestAssetType,
    uint256 offset,
    uint256 limit
) external view returns (uint256[] memory tradeIds, uint256 nextOffset);

function getOpenTradeIdsForMaker(address maker, uint256 offset, uint256 limit)
    external
    view
    returns (uint256[] memory tradeIds, uint256 nextOffset);
```

Design notes:

- Keep private-link and direct-recipient trades out of public indexes unless their access mode explicitly allows discovery.
- Pair keys should normalize asset type plus token address, not token address alone, because native COTI uses `address(0)`.
- If storage cost becomes too high, prefer event/indexer support instead of heavy on-chain indexes.

### Private fill receipts for hidden-liquidity trades

Problem:

- `P2PPrivateTradeEscrow` correctly hides public fill amounts and remaining amounts.
- Makers can offboard remaining private liquidity with `offboardPrivateFixedPriceRemainingForMaker`.
- Fillers currently get only public status such as `fullyFilled`; the app cannot show a precise private receipt without deriving it indirectly from wallet balance changes.
- This would improve history for partially filled private-liquidity trades because the maker/filler history can show exact decrypted receipt rows while the public desk stays private.

Proposal:

- Emit user-scoped encrypted fill receipts for the filler and maker after a private fixed-price fill.
- Keep public events limited to `tradeId`, `filler`, and `fullyFilled`.
- Offboard exact request-in, offer-out, and maker remaining amount only to the intended user.

Possible contract shape:

```solidity
event PrivateFixedPriceFillReceipt(
    uint256 indexed tradeId,
    address indexed account,
    uint8 indexed role,
    utUint64 requestAmountIn,
    utUint64 offerAmountOut,
    utUint64 remainingOfferAmount
);
```

Design notes:

- `role` can distinguish maker and filler receipts.
- For filler receipts, `remainingOfferAmount` can be omitted or set to zero if only maker should know remaining liquidity.
- Use `MpcCore.offBoardCombined` to the specific account and avoid plaintext decrypts except for the unavoidable `fullyFilled` decision already present.
- The app can use these receipts for My Trades/History fill rows, partial-fill summaries, and copied-link context without exposing the values publicly.

### Encrypted app-state backup channel

Problem:

- The app stores read/unread backup and conversation preference state as encrypted self-memos because there is no dedicated on-chain user-state channel.
- Self-memos work, but they add message noise and force the app to parse control payloads out of normal chat history.

Proposal:

- Add a small user-state contract or extension that stores/emits user-scoped encrypted settings blobs.
- Use COTI encrypted input and user output, not plaintext storage.
- Keep the state generic enough for `lastReadAllTs`, muted/hidden conversation state, and future small preferences.

Possible contract shape:

```solidity
event UserStateUpdated(address indexed account, bytes32 indexed namespace, utString encryptedState);

function setUserState(bytes32 namespace, itString calldata encryptedState) external;
function getUserState(bytes32 namespace) external returns (utString memory encryptedState);
```

Design notes:

- Namespace values should be fixed constants such as `chainwhisper.read_state.v1`.
- Avoid per-conversation public read markers; keep one compact encrypted blob per namespace.
- This should replace control self-memos only after migration support exists in the app.

### Contract-scoped trade identity metadata

Problem:

- Trade IDs are contract-local, so `tradeId = 1` can exist in multiple escrow contracts or future contract versions.
- The app already keys private liquidity, trade links, fetches, and UI state with `buildTradeSnapshotKey(tradeId, escrowContract)`.
- Future contract migrations would be easier if the contract/protocol exposed an explicit identity domain instead of relying only on app-side conventions.

Proposal:

- Add a stable contract/domain identifier to future trade-created events and optional read methods.
- Include the escrow contract address, contract version, and chain ID in app-facing trade identity metadata.
- Keep current numeric `tradeId` behavior for contract-local lookups, but make full external identity explicit in events/indexing.

Possible contract shape:

```solidity
event TradeCreated(
    uint256 indexed tradeId,
    address indexed maker,
    address indexed taker,
    address escrowContract,
    uint256 chainId,
    uint16 contractVersion
);
```

Design notes:

- Do not break existing links; this is additive metadata for future contract versions and indexers.
- Keep link parsing tolerant of old links that only include `tradeId` plus app-known escrow context.
- Use the explicit identity metadata anywhere encrypted recovery notes, private liquidity state, or external indexers refer to a trade.

### Private liquidity privacy invariants

Problem:

- Private liquidity trades must not expose hidden token amounts or fill amounts in public/detail views.
- The app can hide fields, but future contract methods/events should avoid making sensitive private-liquidity progress easier to scrape.
- Maker-only reveal and taker settlement paths need clear boundaries so the UI does not accidentally depend on public hidden data.

Proposal:

- Keep public private-liquidity events focused on direction, token pair, ratio/access type, expiry, maker, and status.
- Avoid public getters/events that reveal hidden offer amount, hidden request amount, filled amount, or remaining amount.
- Add maker/taker-scoped encrypted progress metadata only if the reader can decrypt it with the intended wallet context.
- Consider explicit view methods or events that separate public listing data from private progress data.

Design notes:

- Treat public explorer data and maker-only My Trades data as different disclosure levels.
- Keep partial fill/overshoot settlement private at the contract-action layer.
- Add contract and app tests that verify public private-liquidity reads cannot reveal hidden amounts or fill progress.

### Hybrid private liquidity for one-private-token orders

Problem:

- Current private liquidity thinking assumes both sides of the trade use private ERC-20 tokens.
- Some useful orders only have one private side, for example private WISP against public COTI, or public WISP against private COTI.
- These trades are not as private as full private-liquidity orders because one token side is public, but they still benefit from hiding the private side amount/fill progress.
- Treating them as normal public trades would expose too much about the private side and would make the UX feel inconsistent with private liquidity.

Proposal:

- Add support for a `hybridPrivateLiquidity` trade mode when exactly one side of the pair is a private token.
- Keep the private token amount, private fill amount, and private remaining amount hidden from public reads/events.
- Allow the public token side to remain visible where required by the settlement path.
- Categorize these orders under the private-liquidity family in app/indexer metadata, but expose a disclosure level so the UI can label them as partially private rather than fully private.
- Use garbled-circuit computation for the private side amount/fill math, even when the other side settles as a public ERC-20 or native token.

Possible contract shape:

```solidity
enum LiquidityPrivacyMode {
    Public,
    HybridPrivate,
    FullyPrivate
}

struct TradePrivacy {
    LiquidityPrivacyMode mode;
    bool offerIsPrivate;
    bool requestIsPrivate;
}
```

Design notes:

- Require at least one private token for `HybridPrivate` or `FullyPrivate` modes.
- Reject `HybridPrivate` if neither side is private, and reject `FullyPrivate` unless both sides are private.
- Keep public ratio/direction metadata available enough for users to understand the order.
- Keep public-side settlement amounts visible only when they must be visible for the public token transfer path.
- Make disclosure explicit in events so the app can show "Private liquidity" for the category and a compact "partially private" label where needed.
- Add contract tests for each pair shape: public/public, private/public, public/private, and private/private.
- Add app tests that hybrid private-liquidity cards never reveal the private side amount or private fill progress.

### Contract version and feature flags

Problem:

- Trade contracts expose `contractVersion()`, but the group chat contract does not.
- The app currently has to infer which ABI shape exists from configured addresses and failed calls.
- Future upgrades will be easier if the app can detect support for message IDs, sync pages, encrypted join-code recovery, permanent offers, recurring orders, and private fill receipts.

Proposal:

- Add `contractVersion()` and a compact feature flag method to future app-facing contracts.
- Keep this read-only and additive.

Possible contract shape:

```solidity
function contractVersion() external pure returns (string memory);
function supportsFeature(bytes32 featureId) external pure returns (bool);
```

Design notes:

- Use stable feature IDs such as `GROUP_MESSAGE_IDS_V1`, `GROUP_SYNC_PAGE_V1`, `PRIVATE_FILL_RECEIPTS_V1`, and `NO_EXPIRY_TRADES_V1`.
- This lets the app support old and new contracts at the same time without brittle fallback calls.

### Recurring OTC buy/sell order templates

Problem:

- The current escrow contracts support one trade at a time, including public/private links, direct recipients, counters, edit-by-replace, and partial fills.
- A partially fillable order can behave like a standing limit order until its escrowed liquidity is exhausted, but it is not a true recurring order.
- A true recurring buy or sell order needs rules for interval, per-period amount, max total budget, expiry, replenishment, and execution authority.
- Smart contracts cannot wake themselves up on a timer, so recurrence needs either user-triggered execution, taker-triggered interval fills, or an automation/keeper path.

Proposal:

- Add a future recurring order template contract or extension that stores reusable order rules and lets eligible fills execute only when the next interval is available.
- Let makers define direction, token pair, price ratio, per-interval amount, max total amount, start time, interval length, end time, max executions, access mode, and privacy mode.
- Track executed intervals and total filled amounts so the contract prevents over-filling and double execution for the same period.
- Support both public recurring offers and direct/private-link recurring offers.
- Preserve the OTC desk model: each execution should still produce clear settlement/fill events that the app can show as recurring order history.

Possible contract shape:

```solidity
struct RecurringOrderConfig {
    address maker;
    TradeAsset offerAsset;
    TradeAsset requestAsset;
    uint256 offerAmountPerInterval;
    uint256 requestAmountPerInterval;
    uint64 startsAt;
    uint64 intervalSeconds;
    uint64 expiresAt;
    uint32 maxExecutions;
    bool isPublic;
    bytes32 accessHash;
}

event RecurringOrderCreated(uint256 indexed orderId, address indexed maker);
event RecurringOrderExecuted(uint256 indexed orderId, uint32 indexed executionIndex, address indexed filler);
event RecurringOrderCancelled(uint256 indexed orderId);
```

Design notes:

- Decide whether maker liquidity is fully escrowed up front or pulled per execution from allowance/private allowance.
- Up-front escrow is simpler and safer but locks more capital; per-execution pull is more flexible but needs allowance, balance, and failure handling.
- For private-token recurring orders, preserve private amount/fill invariants and consider whether each interval needs fresh ciphertext.
- Execution can be taker-triggered when the interval opens; optional keeper support can be added later but should not be required for correctness.
- Include pause/cancel controls and a clear maker-only history view.
- Consider whether recurring executions should mint child trade IDs, emit fill-only events, or both. Child trade IDs may be easier for current app history and links.
- Add tests for interval gating, max executions, cancellation, partial remaining intervals, allowance/balance failure, and private disclosure boundaries.

### Permanent OTC offers with no expiry

Problem:

- Current trade creation paths require an `expiresAt` timestamp.
- Makers may want standing OTC offers that stay open until filled, cancelled, or replaced.
- The app already has some display support for "No expiration", but contract behavior and indexing rules need to make permanent offers explicit and safe.
- Permanent offers can clutter public discovery if there is no refresh, activity, or maker-cancel expectation.

Proposal:

- Add an explicit permanent/no-expiry mode for future escrow contracts instead of overloading an accidental timestamp value.
- Treat `expiresAt = 0` or a dedicated `noExpiry` flag as "open until filled/cancelled/replaced", depending on what is safest for compatibility.
- Keep maker cancel, edit-by-replace, and filled-state behavior available for permanent offers.
- Add events/metadata that let the app/indexer distinguish permanent offers from expiring offers.

Possible contract shape:

```solidity
struct TradeExpiry {
    bool noExpiry;
    uint64 expiresAt;
}
```

or compatible timestamp semantics:

```solidity
// expiresAt == 0 means no expiry.
function createTradeAdvanced(..., uint64 expiresAt, ...);
```

Design notes:

- Prefer explicit `noExpiry` metadata in events/indexer output even if the stored contract value is `expiresAt == 0`.
- Keep `reclaimExpiredTrade` unavailable for permanent offers.
- Require maker cancellation to close stale permanent offers.
- Consider optional public-desk sorting that prioritizes recently created, recently filled, or recently refreshed permanent offers below fresh expiring offers.
- Consider whether permanent public offers should have a maker-refresh action/event so inactive makers do not dominate the desk forever.
- Add tests for no-expiry creation, acceptance, partial fill, cancel, edit-by-replace, private-link access, direct-recipient access, and `reclaimExpiredTrade` rejection.

## Future Ideas

- Add new smart contract ideas here as they come up, especially when an app UX issue would be cleaner with protocol support instead of local browser state.
