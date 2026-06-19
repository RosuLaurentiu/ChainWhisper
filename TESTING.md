# Testing Policy

Use focused tests first while developing, then run the full verification before handing off larger changes.

## Scripts

- `npm run test:wallet`: owner wallet, ChainWhisper account, recovery, AES/Snap, funding, and wallet-session helpers.
- `npm run test:trading`: OTC routes, trade math, signer selection, balances, confirmations, and trade action helpers.
- `npm run test:chat`: chat parsing, links, message references, direct/group sync helpers, and mobile/bootstrap helpers.
- `npm run test`: full Vitest suite.
- `npm run lint` and `npm run build`: final app verification.

## When To Add Tests

Add or update tests for changes that affect money movement, recovery/encryption, private-balance reads, signer choice, route/link parsing, message encoding, or a fixed regression.

For styling, copy, spacing, and simple layout changes, prefer manual/browser smoke checks. Do not add unit tests unless the UI state protects a critical wallet, recovery, trade, or privacy path.

Prefer pure helper/model tests over component tests when the behavior can be expressed without rendering React.
