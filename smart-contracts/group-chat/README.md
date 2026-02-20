# Group Chat Contract (Single Manager Model)

This folder contains a standalone Solidity contract for group chat on COTI gcEVM:

- `GroupChatManager.sol`

## Why this model

Instead of deploying one contract per group, this uses one contract for all groups:

- lower deployment overhead
- simpler indexing (single contract address)
- easier upgrades/migrations (one contract)

## Notes

- Built in the style of the reference single-chat contract:
  `https://github.com/CipherTrade-Wallet/chat-gc-contract`
- Uses COTI private types via:
  `@coti-io/coti-contracts/contracts/utils/mpc/MpcCore.sol`
- Group messages are emitted as encrypted per-member delivery events.

## Integration

You can integrate this folder into a dedicated Hardhat/Foundry project, or add a local contract toolchain in this repo when you are ready to deploy.
