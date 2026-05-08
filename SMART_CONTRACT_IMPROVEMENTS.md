# ChainWhisper OTC Desk V1 Status

Status: OTC Desk V1 has been deployed to COTI Mainnet and the app constants have been cut over. Contract verification was intentionally skipped until live smoke tests pass.

## Deployed Contracts

- `ChainWhisperOTCEscrowV1`: `0x8bF62fF44a2BeB10545E51B8e4C3D0B49D53d9Eb`
- `ChainWhisperOTCReaderV1`: `0xD8C1f858E02c7F0627Cf5c263B466B8d721c9af7`
- `ChainWhisperPrivateOTCEscrowV1`: `0xafC2394B0Fe3929B4993f8F5a7901CF733E0c115`
- `ChainWhisperPartyOTCEscrowV1`: `0xea4dBDfE7187757830942C529691595197a09819`
- `ChainWhisperRecurringOTCEscrowV1`: `0x29aeE2CDdAae2dC9727Be3189BD873f1A7715964`
- `ChainWhisperOTCHistoryReaderV1`: `0xfAdB25bfd30A9eAa15082b042bA6317Da469AAF6`
- `ChainWhisperOTCRegistryV1`: `0x124E934FAeBBB75854623C9d1a21ce812DCA94E6`

Deployment command run: `npm run deploy:trading-v1`

No Hardhat/COTIscan verification was run.

## Deployment Configuration

- Network: COTI Mainnet, chain ID `2632500`
- Owner/deployer: `0xbf01185A70CDfEF1858659836D57BFf085ebed55`
- Fee recipient: `0xbf01185A70CDfEF1858659836D57BFf085ebed55`
- Initial private trading token configured from `PRIVATE_FEE_TOKEN`: `0x922B39AC9FD4ccb5E5a9de0694C8189DC2D214E8`
- Active pWISP private trading token configured after cutover: `0x682e3142e62a7aDe2a0CA5bdC87b205CaDe4B17a`
- Private-token encryption address: `0xbf01185A70CDfEF1858659836D57BFf085ebed55`

## Post-Deploy Checks Passed

- Every deployed contract returns the expected `contractVersion()`.
- Registry `getContracts()` points to the deployed standard, private, Party, recurring, reader, and history-reader addresses.
- Standard OTC trusts the deployed Party escrow through `trustedPartyCounterEscrow(partyAddress)`.
- `PRIVATE_FEE_TOKEN.accountEncryptionAddress(...)` is set to the deployer/encryption address for standard, private, Party, and recurring escrows.
- pWISP `accountEncryptionAddress(...)` is set to the deployer/encryption address for standard, private, Party, and recurring escrows.
- HOTDOG `accountEncryptionAddress(...)` is set to the deployer/encryption address for standard, private, Party, and recurring escrows.

## App Cutover

- Updated app constants in `src/lib/appShared/core.ts` for standard OTC, reader, private orders, Party OTC, recurring OTC, registry, and history reader.
- `PARTY_TRADE_ESCROW_CONTRACT_ADDRESS` is now configured, so private-token private-link/direct/counter Party creation is no longer blocked by an empty address.
- `DEFAULT_TRADING_CONTRACT_ADDRESSES.reader` now includes the deployed OTC reader fallback.
- Added approved private token `pWISP`: `0x682e3142e62a7aDe2a0CA5bdC87b205CaDe4B17a`.
- Added approved private token `HOTDOG`: `0x5085Ea0611A9C49316972C57390ca25C9CF236AB`.
- Removed old approved private Hotdog token: `0xe8C3D2248a578e9E020C2447f8148e606090fbfe`.
- Removed retired test private token from the approved app list: `0x23f0AE74466Fd0fc1d32bB947ebB8Cd553BECdA0`.
- Trading private-token amount writes now use `itUint256` input encryption instead of the legacy 64-bit `encryptValue(...)` path.
- Raised app gas caps for MPC-heavy private trading writes after failed private fill `0xb99c26aae4f38b5936731fb27284e9f769fa3c3e7924a000f4ac3849c9902356` exhausted the old `4,000,000` gas cap.
- Private-link/direct/counter secrets are no longer persisted as raw `localStorage` entries.
- New private-link/direct/counter offers route through Party escrow and store maker-AES encrypted recovery payloads on-chain.
- Hidden private orders and recurring hidden/private-link-capable create paths use maker recovery-note payloads where supported by the V1 contracts.

## pWISP Configuration Transactions

- `ChainWhisperOTCEscrowV1`: `0xb538d6ce12cf60a281f5c19c46b07bee8c7bd1cade476d65a5cdd1ac0160928c`
- `ChainWhisperPrivateOTCEscrowV1`: `0x3bdd7aa75354f667b630298545e71fc7b4bdb67878d324bbfb7b9da7f7e2d7e1`
- `ChainWhisperPartyOTCEscrowV1`: `0x95b5033aa3bfc3e3d483e9bc3e387bdd3881051a40e7b45db4d93cac56dcb2e5`
- `ChainWhisperRecurringOTCEscrowV1`: `0x79e38361a8aae2fa4573e09b44bb29c7e1d52a76e918b5cb78a2113ff5975227`

## HOTDOG Configuration Transactions

- `ChainWhisperOTCEscrowV1`: `0x9ca7dd583c538063a42abadb2fbb60e5a99d61401de92020079d6220d309c75c`
- `ChainWhisperPrivateOTCEscrowV1`: `0x9459c7c13a927bb27aa8e37e967bc0eee97285cfe15aa0eef5becceb41bde42f`
- `ChainWhisperPartyOTCEscrowV1`: `0x50c79e91a874393f08637e41ec5cde6456ec8f3dd088c64188caed20502ebd34`
- `ChainWhisperRecurringOTCEscrowV1`: `0x37d64eb8fe1f3ad05e7810a7bcd7fa72785b590b923ee44f575f77b5d9ed3c84`

## Verification Passed

- Contract repo: `npm run build`
- Contract repo: `npm run test`
- App repo: `npm run lint`
- App repo: `npm run test`
- App repo: `npm run build`

## Private Link Recovery Status

- Maker recovery for new Party trades is stored in `makerTermsPayload` as encrypted bytes.
- Counterparty/link terms for new Party trades remain encrypted by the access secret so shared links keep working.
- Hidden private order recovery uses `createPrivateOrderWithRecoveryNote`.
- Recurring recovery uses `createRecurringOrderWithRecoveryNote` or `createPrivateRecurringOrderWithRecoveryNote` when a recovery payload is supplied.
- Existing old trades without recovery payloads cannot be recovered from chain if their private-link secret was already lost.

## Still Relevant After Cutover

### 1. Live Smoke Tests

- Public visible OTC create/fill/cancel.
- Private hidden public offer create/fill/reveal.
- Private-link/direct standard visible trade.
- Party private-token private-link/direct/counter create, reveal, accept.
- Party counter closes standard parent and sibling counters on acceptance.
- Recurring visible and hidden private-token flows.
- MetaMask Snap AES states: ready, missing, rejected, unavailable, fallback wallet path.

### 2. Verification And Publication

- Verify contracts only after live smoke tests pass.
- Publish final deployed addresses only after smoke tests pass.
- If smoke tests reveal a blocker, redeploy instead of verifying or publishing the bad deployment.

### 3. Privacy Caveats To Recheck Live

- Private-token hidden public offers should keep hidden budgets out of public views/events.
- Party private-token private-link/direct/counter trades should keep exact private-token terms out of public views/events and reveal terms only through authorized encrypted payloads.
- Native COTI and public ERC20 settlement amounts may still be visible at the asset layer.
- Recurring private-to-public settlement may reveal the public-side amount because that asset side is public.

### 4. Deferred Prompt-Reduction Ideas

- Keep hidden/private amount settlement on approve-plus-fill for now.
- Reconsider public-amount `transferAndCall` only for visible private-token flows.
- Reconsider EIP-2612 `permit` only for public ERC20 tokens that support it.
- Avoid a shared global spender/router before launch because it concentrates approval risk.
