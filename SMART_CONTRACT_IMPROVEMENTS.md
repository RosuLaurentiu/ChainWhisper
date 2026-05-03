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

## Future Ideas

- Add new smart contract ideas here as they come up, especially when an app UX issue would be cleaner with protocol support instead of local browser state.
