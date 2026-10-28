# ChainWhisper Chat V2 real-wallet gates

These are isolated, manual release gates. The warm lane measures what Alice and Bob actually see in MetaMask and the COTI Snap. The recovery lane then proves that Alice can still decrypt Bob's existing message after a real browser restart and from a distinct, manually restored profile.

Neither lane puts wallet credentials in source code, environment variables, Playwright output, screenshots, traces, or videos. The COTI AES key necessarily enters the harness page's memory so the COTI signer can decrypt envelopes; it is never emitted or persisted, and signer state is explicitly cleared during teardown.

These are not production-app integration tests and must not run in CI.

## Warm-lane prerequisites

1. Use the exact attested `ChainWhisperChatV2` candidate on COTI testnet, chain ID `7082400`. Keep its address, deployment block, and exact runtime bytecode hash. The selected Alice/Bob pair must not already have a conversation on that candidate; use two fresh participant accounts rather than redeploying an otherwise valid candidate.
2. Create two dedicated test-only MetaMask profiles outside the entire ChainWhisper workspace. Create a fresh Alice account in one and a fresh Bob account in the other through MetaMask itself. Do not automate or export their passwords, private keys, mnemonics, or recovery phrases.
3. Configure COTI testnet and install the reviewed COTI Snap `1.0.52-eeccdb` in each profile. Fund and onboard both wallets before the warm measurement. Cold Snap installation and wallet onboarding are deliberately outside this lane. The lane reads each profile's live `wallet_getSnaps` manifest and stops unless both installed versions exactly match this pin.
4. Use the reviewed MetaMask `13.41.0.0` unpacked artifact described below. Keep the directory immutable for the run.

The contract proof uses a separate Mallory wallet, but the visible prompt lane needs only Alice and Bob.

## Public scenario file

Create a JSON file containing only public values. Keeping it outside the repository avoids accidentally treating one testnet deployment as active application configuration.

```json
{
  "schemaVersion": 1,
  "manifest": {
    "chainId": "7082400",
    "contractAddress": "0xE6B2933ac6407B678769a4Db2834E6257a21A02f",
    "deploymentBlock": "8981982",
    "runtimeBytecodeHash": "0x7ba5b1b9cfd675905cd70dc62ad81c841daf6f1ba95dab0738254a36256ca970"
  },
  "maxTransactionValueWei": "0",
  "participants": {
    "alice": "0x0000000000000000000000000000000000000000",
    "bob": "0x0000000000000000000000000000000000000000"
  }
}
```

Replace only the two participant placeholders with the fresh Alice and Bob public addresses. The deployment values above are the exact candidate re-attested on 2026-08-11. The parser rejects zero addresses, malformed hashes, extra fields, duplicate participants, noncanonical numbers, every chain except COTI testnet `7082400`, and every value ceiling except `0`. Deployment attestation also requires `messageFee() == 0`, and every submitted transaction must omit value or use canonical `0x0`.

Funding `0.01 COTI` per participant is deliberately conservative for this zero-message-fee journey and its ordinary testnet gas. Do not fund these dedicated prompt-measurement profiles with valuable mainnet assets.

## Pin the extension

The reviewed release pins are compiled into the lane:

- MetaMask version: `13.41.0.0`
- official archive SHA-256: `4d651e5e1b63d24202e3004f82925be4449161d06045526d7a37c026b7ef2afc`
- reviewed unpacked-directory fingerprint: `76e3dd8101e2c4700c131345d6a0018677e48418d5a0e3f9c753bedbd2a5cf43`
- COTI Snap package version: `1.0.52-eeccdb`

Compute the deterministic unpacked-directory fingerprint with Node 24 or newer:

```powershell
npm run wallet:real:fingerprint -- "C:\absolute\path\to\unpacked-metamask"
```

The output must equal the reviewed unpacked-directory fingerprint above. The same function is used before launch and again after all wallet contexts close. Symlinks, a version mismatch, or any file change stops the run. The official archive hash is recorded as provenance; the unpacked-directory fingerprint is the artifact actually enforced at launch.

## Required public environment settings

Set these only in the terminal that starts the manual test:

```text
CW_REAL_WALLET_OPERATOR_ACK=MANUAL_APPROVALS_ONLY
CW_REAL_WALLET_METAMASK_EXTENSION_DIR=<absolute unpacked extension directory>
CW_REAL_WALLET_METAMASK_VERSION=13.41.0.0
CW_REAL_WALLET_METAMASK_SHA256=76e3dd8101e2c4700c131345d6a0018677e48418d5a0e3f9c753bedbd2a5cf43
CW_REAL_WALLET_ALICE_PROFILE_DIR=<absolute Alice Chromium user-data directory>
CW_REAL_WALLET_BOB_PROFILE_DIR=<absolute Bob Chromium user-data directory>
CW_REAL_WALLET_SCENARIO_PATH=<absolute public scenario JSON path>
```

Any `CW_REAL_WALLET_*` variable whose name suggests a password, key, seed, mnemonic, passphrase, or secret stops the run. Profile directories must already exist, must be distinct and non-nested, and must neither sit inside nor contain the ChainWhisper workspace.

## Run the warm lane

First run the noninteractive checks:

```powershell
npm run test:wallet:real:unit
npx tsc -p tests/real-wallet/tsconfig.json --noEmit
npx playwright test --config=playwright.real-wallet.config.ts --list
```

The list command must discover exactly one manual warm test. Then start the headed lane:

```powershell
npm run test:wallet:real
```

Playwright clicks each harness action, but the operator must unlock and approve MetaMask/Snap screens manually. Do not add password or confirmation automation. Every phase begins only after the profile has no pending MetaMask confirmation surface or in-flight prompt-capable RPC.

Expected warm results:

- already-installed/onboarded COTI session bootstrap: exactly two visible confirmations, in order—`connect-to-wallet`, then `get-aes-key`; the intervening `has-aes-key` operation must be prompt-free;
- create conversation: one visible MetaMask transaction prompt, one successful `eth_sendTransaction`, no signing, private-input, or Snap call;
- recover envelope: no prompt and no transaction;
- Alice and Bob send message: one visible MetaMask transaction prompt each, one successful `eth_sendTransaction` each, no signing, private-input, or Snap call;
- Alice and Bob rotate key: one visible MetaMask transaction prompt each, one successful `eth_sendTransaction` each, no signing, private-input, or Snap call;
- Bob recovery after Alice's rotation and Alice recovery after Bob's rotation: no prompt and no transaction; each recovery loads the latest counterparty `MessagePosted` event, recovers its prior-epoch envelope, and proves authenticated decryption of the fixed test message without serializing it.

Cold Snap install/onboarding prompts are forbidden in this measurement. The session bootstrap permits only the reviewed `connect-to-wallet`, prompt-free `has-aes-key`, and `get-aes-key` calls. All other phases use explicit RPC allowlists. Generic MetaMask confirmation routes are counted by the pinned release's submit/cancel decision controls, so consecutive confirmations at one URL remain separate observations. An unknown wallet screen, restored foreign browser page, uncorrelated confirmation route, wrong account or chain, unexpected signing method, unapproved target, decoded calldata argument, selector, value, gas/fee field, extra prompt, missing prompt, or failed action stops the run.

## Run persistent and restored-profile recovery

Run this second lane only after the warm lane succeeds and writes `chat-v2-prompt-evidence.json`. Warm evidence uses schema version 2 and contains a public canonical recovery anchor for the final Bob-to-Alice message. The recovery lane reuses that exact candidate, Alice/Bob pair, conversation, epoch, message ID, block, and block hash. It must not create a conversation, rotate a key, refresh an envelope, or send a transaction.

Prepare recovery without exposing Alice's recovery phrase to Codex, Playwright, source code, or environment variables:

1. Keep the original Alice profile unchanged. The first recovery stage closes and reopens that same canonical user-data directory, unlocks the pinned COTI Snap, and authenticates/decrypts Bob's existing message.
2. Create a third, dedicated MetaMask profile outside the ChainWhisper workspace. Manually import the same test-only Alice EOA through MetaMask's own UI. Do not copy Alice's Chromium profile or Snap storage, and do not expose or automate the recovery phrase or password.
3. In the restored profile, use only COTI's official testnet companion at `https://dev.metamask.coti.io` to install and onboard the exact pinned COTI Snap `1.0.52-eeccdb`. Complete that one-time flow manually, then close the companion and restored profile before starting Playwright. The pinned Snap itself rejects `set-aes-key` from localhost, so the ChainWhisper harness never attempts to install, onboard, recover, or store the Snap key.
4. Keep the original and restored Alice profiles closed before the run. The fixture never keeps them live at the same time and rejects equal, nested, missing, workspace-contained, or extension-contained profile paths. The no-copy requirement is a separate manual operator attestation.

Add these public recovery settings to the common settings above:

```text
CW_REAL_WALLET_ALICE_RESTORED_PROFILE_DIR=<absolute restored-Alice Chromium user-data directory>
CW_REAL_WALLET_ALICE_RESTORED_PROFILE_ACK=SAME_TEST_EOA_MANUAL_RESTORE_ONLY
CW_REAL_WALLET_OFFICIAL_COTI_ONBOARDING_ACK=OFFICIAL_TESTNET_COMPANION_COMPLETED
CW_REAL_WALLET_WARM_EVIDENCE_PATH=<absolute chat-v2-prompt-evidence.json path>
```

The acknowledgements record the operator's procedure; they are not substitutes for wallet or cryptographic checks. The lane independently requires the restored wallet address to equal scenario Alice, re-attests chain, candidate runtime, MetaMask, and Snap pins, and authenticates/decrypts the canonical old Bob message.

Run the noninteractive recovery checks:

```powershell
npm run test:wallet:real:unit
npx tsc -p tests/real-wallet/tsconfig.json --noEmit
npx playwright test --config=playwright.real-wallet-recovery.config.ts --list
```

The list command must discover exactly one manual recovery test. Then run:

```powershell
npm run test:wallet:real:recovery
```

For both Alice launches, `wallet-connect` may require the ordinary manual wallet unlock/connect interaction. The COTI session bootstrap must contain exactly two visible Snap confirmations—`connect-to-wallet`, then `get-aes-key`—with prompt-free `has-aes-key`. Deployment attestation and old-message envelope recovery must be read-only, prompt-free, and transaction-free.

The recovery report deliberately records `onboardingMeasuredInHarness: false`. It proves restored-profile access to the old Chat V2 envelope and message; it does not claim a prompt count for MetaMask account restoration, Snap installation, or the one-time official COTI onboarding flow.

## Evidence

Only after sensitive state is cleared, browser contexts close, and the final extension rehash succeeds is allowlisted JSON evidence written. The warm lane writes under ignored `test-results/real-wallet/`; the recovery lane writes under ignored `test-results/real-wallet-recovery/` and binds itself to the exact warm evidence file by SHA-256.

The reports contain public deployment identity, public participants and recovery anchors, the pinned MetaMask version/archive/directory hashes, the attested COTI Snap version, the post-teardown directory rehash, derived extension ID, Chromium and Playwright versions, plus method/phase/timing/outcome and prompt category/count data. Both reports carry a separate public receipt created only after AES-GCM authentication and exact fixed-message verification. Both lanes consume every RPC observation once, account for generic MetaMask decisions, and seal the ledgers before teardown; an extra between-phase or final action stops evidence publication. The reports do not contain RPC parameters or results, transaction calldata, plaintext, ciphertext, COTI AES material, profile paths or contents, wallet credentials, screenshots, video, or traces.

Review both manual reports together with the real-COTI Alice/Bob/Mallory contract proof. No single report proves the full M1 Chat gate.
