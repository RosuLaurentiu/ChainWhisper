# ChainWhisper Smart Contract Improvement Backlog

This file captures ideas that would require a future smart contract version or contract-adjacent protocol change. It is separate from `APP_IMPROVEMENTS.md` so app-only cleanup and contract design proposals stay easy to reason about.

No runtime app behavior, deployed contract address, ABI, schema, or route is changed by this document.

## High Impact

### Encrypted maker recovery note for private trade links

Problem:

- Unlisted/private trade links currently depend on an off-chain `accessSecret`.
- The contract can safely store only `accessHash = keccak256(accessSecret)` for enforcement.
- If the raw secret is stored on-chain, the private link is no longer private because anyone can read it.
- If the app does not persist the secret locally, the maker can still manage the trade but cannot recreate the full private share link after reload unless they saved it.

Proposal:

- Keep `accessHash` as the enforcement primitive.
- Add contract support for maker-recoverable encrypted access metadata.
- The app creates the `accessSecret`, encrypts it for the maker, and passes the encrypted payload when creating an unlisted/private trade.
- The contract stores or emits only ciphertext, never the raw secret.
- Later, the maker opens My Trades, the app reads the encrypted payload from chain, decrypts it with the maker wallet/AES context, and rebuilds the private share link.

Possible contract shapes:

```solidity
struct Trade {
    uint256 tradeId;
    address maker;
    address taker;
    bytes32 accessHash;
    bytes makerEncryptedAccessSecret;
    // existing fields...
}
```

or event-only recovery metadata:

```solidity
event TradeAccessBackup(
    uint256 indexed tradeId,
    address indexed maker,
    bytes makerEncryptedAccessSecret
);
```

Design notes:

- Prefer preserving the current `accessHash` behavior so accept/fill authorization stays simple.
- Treat encrypted recovery as optional metadata, not as the access-control mechanism.
- Include the escrow contract address in app-side recovery keys because trade IDs are contract-local.
- Support older trades that do not have encrypted recovery metadata.
- Consider whether a maker should be able to rotate or clear the encrypted recovery note.
- If event-only storage is used, confirm indexers/app sync can reliably recover historical backup events.

App follow-up once contract support exists:

- Remove persistent local storage for trade access secrets.
- Keep private trade secrets only in the current URL, memory for the active session, or encrypted on-chain maker recovery metadata.
- Update My Trades to show a "Copy private link" action only when the maker can decrypt the recovery note or the current session already has the secret.
- Update user copy so makers understand that private links are recoverable only when encrypted recovery metadata exists.

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
- Make disclosure explicit in events so the app can show "Private liquidity" for the category and a compact "partially private" label where needed.
- Add contract tests for each pair shape: public/public, private/public, public/private, and private/private.
- Add app tests that hybrid private-liquidity cards never reveal the private side amount or private fill progress.

## Future Ideas

- Add new smart contract ideas here as they come up, especially when an app UX issue would be cleaner with protocol support instead of local browser state.
