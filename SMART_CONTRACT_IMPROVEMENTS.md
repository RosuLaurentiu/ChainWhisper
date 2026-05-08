# ChainWhisper OTC Desk V1 Trade Paths

Status: the Direct OTC secret-envelope cleanup is deployed on COTI Mainnet, the app constants are cut over, and contract verification is intentionally skipped until live app smoke testing passes.

## Active Mainnet Contracts

- `ChainWhisperOTCEscrowV1`: `0x7a232810f250a2C6e90895215aFf826116DFDb06`
- `ChainWhisperOTCReaderV1`: `0x462122f0e49A67a1BC4F56401a7ab6890Ae5aA34`
- `ChainWhisperPrivateOTCEscrowV1`: `0xB5dEdC6f30B471D75e2fB0Bc22197Cc9EE2b8E31`
- `ChainWhisperDirectOTCEscrowV1`: `0x63287550C635c9433AA89EEFA25F224cb4341946`
- `ChainWhisperRecurringOTCEscrowV1`: `0x7235B18b9CD59fB9853BC3BF3a0A65bc32162cd5`
- `ChainWhisperOTCHistoryReaderV1`: `0x0F9190c2010Aab1D6282547b47954d25D6377D3f`
- `ChainWhisperOTCRegistryV1`: `0x91e32EdFAb1e74DA07ea3012491a44D983aeBA46`

## Active Private Tokens

- pWISP: `0x682e3142e62a7aDe2a0CA5bdC87b205CaDe4B17a`
- HOTDOG: `0x5085Ea0611A9C49316972C57390ca25C9CF236AB`
- Trading escrow private-token encryption address: `0xbf01185A70CDfEF1858659836D57BFf085ebed55`

## Naming

- `OTCEscrow`: public desk visible offers.
- `PrivateOTCEscrow`: hidden-liquidity private-token offers.
- `DirectOTCEscrow`: private-link, fixed-recipient direct offers, and all non-recurring counters with encrypted terms.
- `RecurringOTCEscrow`: reusable two-sided OTC inventory orders.
- `OTCReader`, `OTCHistoryReader`, and `OTCRegistry`: read/config companions only. They do not custody or settle funds.

## Shared Rules

- Private tokens are not automatically hidden. If Hide amount is off, the trade amount can be public depending on the route.
- Hide amount only makes sense where private-token amount paths are used.
- Native COTI and public ERC20 movement can still reveal settlement amounts at their own asset layer.
- Trade IDs are contract-local. App keys and links must include `contractAddress + localId`.
- New Direct links use `?escrow=direct`.
- Old pre-Direct links/contracts are intentionally not kept as active compatibility paths. Recreate those offers on the new Direct escrow if they need active support.

## One-Off Public Visible Offers

Contract path: `ChainWhisperOTCEscrowV1`

When used:

- One-off offer.
- Access is Public.
- Hide amount is off.

Options:

- Assets: native COTI, public ERC20, latest-standard private ERC20.
- Expiry: timed expiry or no-expiry/permanent.
- Fill behavior: exact accept or standard partial-fill path where enabled.
- Maker actions: edit by replacement, cancel.
- Taker actions: fill/accept, counter.

On-chain privacy:

- Asset contracts/types and exact amounts are public in standard OTC views/events.
- If a private token is used with Show amount, the private-token transfer itself is private at token level, but the escrow publishes the trade amount.

## One-Off Private-Link Visible Offers

Contract path: `ChainWhisperDirectOTCEscrowV1`

When used:

- One-off offer.
- Access is Private link.
- Hide amount is off.
- No fixed taker is set.

Options:

- Assets: native COTI, public ERC20, latest-standard private ERC20.
- Link secret: required to open and accept.
- Expiry: timed expiry or no-expiry.
- Maker actions: edit by replacement, cancel.
- Taker actions: open from link, accept/fill, counter.

On-chain privacy:

- Public Direct views/events expose maker, optional fixed taker, asset contracts/types, status, parent metadata, and access-hash metadata.
- Public Direct views/events do not expose exact terms/amounts.
- A canonical terms payload stores exact terms encrypted with the private-link secret.
- The maker can recover the same private-link secret from a wallet-scoped encrypted on-chain envelope.
- Link holders decrypt the same canonical terms payload from the URL secret.

## One-Off Direct Visible Offers

Contract path: `ChainWhisperDirectOTCEscrowV1`

When used:

- One-off offer.
- Access is Direct.
- Hide amount is off.
- A fixed recipient wallet is set.

Options:

- Assets: native COTI, public ERC20, latest-standard private ERC20.
- Recipient: required and cannot be the maker.
- Link: optional convenience link; the recipient wallet can act without it.
- Expiry: timed expiry or no-expiry.
- Maker actions: edit by replacement, cancel.
- Recipient actions: accept/fill, decline, counter.

On-chain privacy:

- Public Direct views/events do not expose exact terms/amounts.
- Maker and fixed taker can recover the Direct access secret through `getDirectAccessSecretForAccount`.
- Maker and fixed taker decrypt the same canonical terms payload used by the convenience link.
- Public/native/ERC20 settlement should not be described as cryptographically private.

## Hidden Private-Token Offers

Contract path: `ChainWhisperPrivateOTCEscrowV1`

When used:

- One-off offer.
- Hide amount is on.
- Maker offer asset is a private ERC20.
- The two sides are not the same token.

Modes:

- Hidden public offer: listed on the desk, but budget/liquidity stays hidden.
- Hidden private-link offer: unlisted and link-secret gated.
- Hidden direct offer: fixed recipient wallet.
- Fully private hidden offer: private ERC20 on both sides.
- Hybrid hidden offer: maker offers private ERC20 and taker pays native COTI or public ERC20.

Options:

- Access: public, private link, or direct.
- Expiry: timed expiry or no-expiry.
- Maker reveal: maker can reveal own remaining hidden liquidity after privacy unlock.
- Filler reveal: filler can reveal own private receipt/fill history after privacy unlock.
- Maker actions: edit by replacement where supported, cancel.
- Taker actions: fill, counter.

On-chain privacy:

- Hidden private-token offer inventory is stored as COTI private ciphertext, not a public amount.
- Public views show direction, assets, access, status, expiry, and ratio, but not hidden budget or exact private fill amounts.
- Maker recovery notes are encrypted bytes.
- Private fill receipts and account summaries are user-scoped encrypted values.
- Hybrid final settlement can reveal the public-side payment amount because that side is public.
- Hybrid overfill must keep max-payment UX: taker supplies a max public payment, the contract clips to remaining hidden liquidity, avoids overcharge/refunds excess, and closes the order.

## Recurring OTC Orders

Contract path: `ChainWhisperRecurringOTCEscrowV1`

When used:

- Reusable two-sided inventory order from the Create window.
- Not a timer/cadence order.
- Recurring orders do not support counters.

Options:

- Assets: base and quote can be native COTI, public ERC20, or latest-standard private ERC20.
- Maker buy side: maker buys base with quote.
- Maker sell side: maker sells base for quote.
- Price: separate buy and sell prices.
- Liquidity: maker can fund buy budget, sell inventory, or both.
- Privacy: Show amount or Hide amount when private tokens are involved.
- Maker actions: edit prices/liquidity in place, add/remove liquidity, close order.
- Filler actions: buy/sell against available side liquidity.

On-chain privacy:

- Show amount recurring orders expose public inventory and terms.
- Hide amount recurring orders keep private-token inventory and fills hidden through encrypted inventory and receipt paths.
- Public/native/ERC20 settlement amounts may still be visible at their own asset layer.
- Private recurring receipts and maker inventory snapshots are wallet-scoped encrypted values.
- Maker recovery payloads are encrypted bytes when recovery-note create functions are used.

## Counter Offers

Contract path: all new counters use `ChainWhisperDirectOTCEscrowV1`.

Supported parents:

- Standard visible OTC parent.
- Hidden private-liquidity parent on the active private escrow.
- Direct private-link parent.
- Direct fixed-recipient parent.
- Direct counter parent as a replacement counter.

Unsupported parents:

- Recurring orders.
- Retired/legacy contracts.

How counters work:

- A counter is a Direct offer between the relevant two wallets.
- Counter creation does not close the parent.
- Counter links are convenience links. The fixed recipient wallet can see and accept the counter without the link secret.
- Counter share links still include an access secret so the copied link can open and decrypt terms.
- Multiple counters can exist in parallel for the same original parent.
- The primary accept action is `Accept & close related`: it accepts the counter, closes the immediate parent, and declines/releases sibling Direct counters for that same parent key.
- The secondary accept action is `Accept only`: it accepts just that Direct counter and keeps the parent plus sibling counters open.
- If a user replies to an existing counter, the previous counter is declined/released and a new counter is created against the original parent.
- For standard and hidden-private parents, the parent escrow must trust the Direct escrow before Direct can close the parent.
- For hidden private parents, accepting a Direct counter closes the hidden parent and releases remaining hidden private inventory back to the parent maker.

Counter privacy:

- Public Direct views/events do not expose exact counter terms/amounts.
- Maker/taker wallets can reveal exact terms by decrypting their wallet-scoped Direct access-secret envelope.
- The recovered wallet secret decrypts the same canonical terms payload as the convenience link.
- Counters are Direct private-term offers, not hidden-liquidity orders; they should reveal terms through Direct secret envelopes, not private-order fill-history receipts.
- Public/native/ERC20 settlement can still reveal public-side movement at the asset layer.

## Trade History And Reveal Rules

- My Trades groups received direct/counter offers, active offers created by the wallet, and completed trade history.
- Makers should be able to see fills/counters against their own offers.
- Takers/fillers should be able to see what they bought or sold.
- Exact hidden/private-token amounts should only appear after privacy unlock and successful encrypted receipt/snapshot reveal.
- Without reveal access, hidden/private-token rows should show privacy-safe placeholders, never bogus decrypted values.

## Verification Status

Completed locally:

- Contract repo: `npm run build`, `npm run test`
- App repo: `npm run lint`, `npm run test`, `npm run build`, `npm run test:browser`
- Post-deploy read-only checks: contract versions, registry addresses, Direct trust, pWISP/HOTDOG encryption addresses, and `DIRECT_ACCOUNT_SECRET_ENVELOPES` / `DIRECT_EDIT_REPLACE` feature support.

Skipped intentionally:

- Contract verification on Cotiscan.
- Public address publication beyond this tracker.

## Live Smoke Checklist Before Verification

- Public visible OTC create, edit, fill, counter, cancel.
- Hidden private public offer create, fill, reveal.
- Private-link visible offer create, edit, open from link, accept.
- Direct visible offer create, edit, recipient opens from My Trades, accept/decline.
- Direct private-token private-link/direct/counter create, reveal, accept.
- Hidden private order create, Direct counter create, Direct counter accept, parent close, maker inventory release.
- Multiple counters against one parent, then accept one and confirm sibling counters close.
- Direct counter-to-counter replacement.
- Recurring visible and hidden private-token create, edit, fill, close.
- MetaMask Snap AES states: ready, missing, rejected, unavailable, repair/refresh, wallet switching.

## Remaining Before Verification

- Run the manual live smoke checklist in the app.
- If a live blocker appears, redeploy/fix before verification.
- Verify contracts only after smoke tests pass.
- Publish final addresses only after smoke tests pass.
