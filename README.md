# ChainWhisper (COTI Messaging App)

ChainWhisper is a browser-based encrypted chat app on the COTI network.  
It supports 1:1 chat, group chat, wallet-to-wallet tips, and basic unread/read-state recovery across sessions.

## Product Overview (Short)

ChainWhisper is a wallet-native encrypted messenger built for COTI. Connect MetaMask or a PIN-protected burner wallet, then chat directly with contacts or groups without relying on centralized accounts.

Messages are encrypted client-side and sent through COTI smart contracts, with realtime updates, on-chain group access controls, and built-in COTI tipping. The app also keeps lightweight read-state backups so sessions can recover quickly after reconnecting.

## How It Works

1. You connect a wallet.
   The app supports MetaMask or a local burner wallet.
2. The app prepares encryption keys (AES onboarding).
   It uses `@coti-io/coti-ethers` and requires AES onboarding before encrypted messaging.
3. Messages are encrypted in the browser and sent on-chain.
   Direct messages use the chat contract `submit(...)`; group messages use `submitGroupMessage(...)`.
4. The app syncs message history from chain events.
   It reads `MessageSubmitted` and group events, decrypts payloads locally, and builds per-contact/per-group timelines.
5. Realtime updates come from WebSocket subscriptions with polling fallback.
   If WS is unhealthy, it switches to RPC polling and retries WS later.
6. Read state is tracked locally and backed up to chain.
   The app periodically writes a compact self-message backup (read-state timestamp) so unread state can be restored after reconnecting.
7. Groups are managed on-chain.
   You can create groups, invite wallets, create expiring join codes (single or multi-use), accept/decline invites, rename groups, remove members, leave, or disband.
8. Optional extras:
   On-chain nickname sync, encrypted contact alias sync, reply metadata, tip transfers, notification sound, and encrypted image rendering from external blob storage.

## Wallet Modes

- Burner wallet:
  Generated/imported locally, encrypted with a PIN, stored in browser storage, and can be topped up from MetaMask.
- MetaMask:
  Connected directly through EIP-1193, switched to COTI automatically, then AES onboarding is completed through signature flow.

## Data Model (Practical View)

- On-chain:
  Encrypted chat payloads, group membership/invites/join-code state, nickname records, and read-state backup memo.
- Browser local state:
  UI state, cached decrypted timelines, unread maps, audio preference, and encrypted burner wallet vault.
- External API:
  Encrypted image blobs are fetched from `https://api-ciphertrade.innovunode.io/chat/blob/:blobId` and decrypted client-side for display.

Note: sending new image messages is currently blocked in the UI for security hardening; existing tagged image messages can still render.

## Network and Contracts

- Network: COTI Mainnet (`chainId` `2632500`, hex `0x282b34`)
- Direct chat contract: `0x3b7151a7B7F1ccEB9b2325A27f99B24b6479d2D7`
- Group chat contract: `0xe9D356d11094E38B1F6529cd51cb995991F06E6F`

## Local Development

```bash
npm install
npm run dev
```

Other scripts:

- `npm run build` - type-check and production build
- `npm run preview` - preview built app
- `npm run lint` - run ESLint
- `npm run test` - run Vitest
