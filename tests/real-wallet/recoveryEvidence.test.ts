import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_ONBOARD_ADDRESS,
  ACCOUNT_ONBOARD_RUNTIME_HASH,
  ACCOUNT_ONBOARD_SELECTOR,
  buildChatV2RecoveryEvidence,
  buildRecoveryPhaseEvidence,
  COTI_ETHERS_VERSION,
  COTI_SDK_VERSION,
  OFFICIAL_COTI_ONBOARDING_ACK,
  OFFICIAL_COTI_TESTNET_COMPANION_ORIGIN,
  RESTORED_PROFILE_ACK,
  serializeChatV2RecoveryEvidence,
  type ChatV2RecoveryEvidenceDocument,
  type ChatRecoveryAnchor,
  type RecoveryPhaseEvidence,
  type RecoveryWalletPhase
} from './recoveryEvidence';
import {
  PINNED_COTI_SNAP_VERSION,
  PINNED_METAMASK_DIRECTORY_SHA256,
  PINNED_METAMASK_OFFICIAL_ARCHIVE_SHA256,
  PINNED_METAMASK_VERSION
} from './metamaskPolicy';

const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const CHAT = '0x3333333333333333333333333333333333333333';
const HASH_A = `0x${'aa'.repeat(32)}`;
const HASH_B = `0x${'bb'.repeat(32)}`;
const CONVERSATION = `0x${'cc'.repeat(32)}`;

const rpc = (
  phase: RecoveryWalletPhase,
  method: string,
  extra: Record<string, unknown> = {},
  startedAtMs = 1
) => ({ durationMs: 1, method, outcome: 'success', phase, startedAtMs, ...extra });

const prompt = (
  phase: RecoveryWalletPhase,
  kind: string,
  startedAtMs = 1
) => ({ durationMs: 1, kind, outcome: 'resolved', phase, startedAtMs });

const phase = (
  phaseName: RecoveryWalletPhase,
  rpcEntries: Array<Record<string, unknown>>,
  prompts: Array<Record<string, unknown>> = []
): RecoveryPhaseEvidence => buildRecoveryPhaseEvidence({ phase: phaseName, rpc: rpcEntries, uiPrompts: prompts });

const walletConnect = () =>
  phase('wallet-connect', [rpc('wallet-connect', 'eth_requestAccounts'), rpc('wallet-connect', 'eth_chainId', {}, 2)]);

const snapUnlock = () =>
  phase(
    'snap-unlock',
    [
      rpc('snap-unlock', 'wallet_getSnaps'),
      rpc('snap-unlock', 'wallet_invokeSnap', { operation: 'connect-to-wallet' }, 2),
      rpc('snap-unlock', 'wallet_invokeSnap', { operation: 'has-aes-key' }, 3),
      rpc('snap-unlock', 'wallet_invokeSnap', { operation: 'get-aes-key' }, 4)
    ],
    [prompt('snap-unlock', 'snap-connect-wallet'), prompt('snap-unlock', 'snap-aes-access', 2)]
  );

const attestation = () =>
  phase('deployment-attestation', [rpc('deployment-attestation', 'eth_getCode')]);

const recovery = () => phase('envelope-recovery', [rpc('envelope-recovery', 'eth_getLogs')]);

const anchor: ChatRecoveryAnchor = {
  conversationId: CONVERSATION,
  currentEpoch: '3',
  latestMessageBlock: '900',
  latestMessageBlockHash: HASH_B,
  latestMessageId: '2',
  latestRecipient: ALICE,
  latestSender: BOB,
  messageCount: '2'
};

const authenticatedRecovery = () => ({
  conversationId: CONVERSATION,
  epoch: '2',
  messageBlock: '900',
  messageBlockHash: HASH_B,
  messageId: '2',
  recipient: ALICE,
  sender: BOB
});

const validInput = (): Omit<ChatV2RecoveryEvidenceDocument, 'schemaVersion'> => ({
  capturedAt: '2026-08-10T00:00:00.000Z',
  contract: {
    address: CHAT,
    chainId: '7082400' as const,
    deploymentBlock: '800',
    runtimeBytecodeHash: HASH_A
  },
  onboarding: {
    address: ACCOUNT_ONBOARD_ADDRESS,
    runtimeBytecodeHash: ACCOUNT_ONBOARD_RUNTIME_HASH,
    selector: ACCOUNT_ONBOARD_SELECTOR
  },
  packageRuntime: {
    cotiEthersVersion: COTI_ETHERS_VERSION,
    cotiSdkVersion: COTI_SDK_VERSION
  },
  participants: { alice: ALICE, bob: BOB },
  persistentReload: {
    after: { ...anchor },
    authenticatedRecovery: authenticatedRecovery(),
    before: { ...anchor },
    envelopeRefresh: 'not-required' as const,
    isolation: 'same-canonical-profile-after-context-close' as const,
    phases: [walletConnect(), snapUnlock(), attestation(), recovery()]
  },
  restoredProfile: {
    after: { ...anchor },
    authenticatedRecovery: authenticatedRecovery(),
    before: { ...anchor },
    envelopeRefresh: 'not-required' as const,
    initialSnapState: 'pre-onboarded-by-official-companion' as const,
    isolation: 'distinct-nonnested-canonical-profile' as const,
    onboardingMeasuredInHarness: false as const,
    onboardingOperatorAck: OFFICIAL_COTI_ONBOARDING_ACK,
    onboardingOrigin: OFFICIAL_COTI_TESTNET_COMPANION_ORIGIN,
    operatorAck: RESTORED_PROFILE_ACK,
    ownerAddress: ALICE,
    verificationPhases: [walletConnect(), snapUnlock(), attestation(), recovery()]
  },
  walletRuntime: {
    browserVersion: '140.0.0.0',
    cotiSnapVersion: PINNED_COTI_SNAP_VERSION,
    extensionId: 'a'.repeat(32),
    metamaskOfficialArchiveSha256: PINNED_METAMASK_OFFICIAL_ARCHIVE_SHA256,
    metamaskUnpackedDirectorySha256: PINNED_METAMASK_DIRECTORY_SHA256,
    metamaskUnpackedDirectorySha256AfterRun: PINNED_METAMASK_DIRECTORY_SHA256,
    metamaskVersion: PINNED_METAMASK_VERSION,
    playwrightVersion: '1.59.1'
  },
  warmEvidenceSha256: HASH_A
});

describe('Chat V2 recovery evidence', () => {
  it('builds a separate, pinned persistence and restored-profile report', () => {
    const document = buildChatV2RecoveryEvidence(validInput());
    expect(document.schemaVersion).toBe(1);
    expect(document.persistentReload.envelopeRefresh).toBe('not-required');
    expect(document.restoredProfile.initialSnapState).toBe(
      'pre-onboarded-by-official-companion'
    );
    expect(document.restoredProfile.onboardingOrigin).toBe(
      OFFICIAL_COTI_TESTNET_COMPANION_ORIGIN
    );
  });

  it('rejects reordered or incomplete recovery journeys', () => {
    const input = validInput();
    expect(() =>
      buildChatV2RecoveryEvidence({
        ...input,
        persistentReload: {
          ...input.persistentReload,
          phases: [...input.persistentReload.phases].reverse()
        }
      })
    ).toThrow(/phase sequence/i);
    expect(() =>
      buildChatV2RecoveryEvidence({
        ...input,
        restoredProfile: {
          ...input.restoredProfile,
          verificationPhases: input.restoredProfile.verificationPhases.slice(0, -1)
        }
      })
    ).toThrow(/phase sequence/i);
  });

  it('requires a separate receipt from the authenticated decrypt path', () => {
    const input = validInput();
    expect(() =>
      buildChatV2RecoveryEvidence({
        ...input,
        persistentReload: {
          ...input.persistentReload,
          authenticatedRecovery: null as never
        }
      })
    ).toThrow();
    expect(() =>
      buildChatV2RecoveryEvidence({
        ...input,
        restoredProfile: {
          ...input.restoredProfile,
          authenticatedRecovery: {
            ...input.restoredProfile.authenticatedRecovery,
            messageId: '1'
          }
        }
      })
    ).toThrow(/authenticated message decrypt/i);
  });

  it('rejects any chat-anchor mutation or wrong decrypted direction', () => {
    const input = validInput();
    expect(() =>
      buildChatV2RecoveryEvidence({
        ...input,
        restoredProfile: {
          ...input.restoredProfile,
          after: { ...input.restoredProfile.after, currentEpoch: '4' }
        }
      })
    ).toThrow(/anchor|authenticated/i);
    const wrongDirection = { ...anchor, latestSender: ALICE };
    expect(() =>
      buildChatV2RecoveryEvidence({
        ...input,
        persistentReload: {
          ...input.persistentReload,
          before: wrongDirection,
          after: wrongDirection,
          authenticatedRecovery: {
            ...input.persistentReload.authenticatedRecovery,
            sender: ALICE
          }
        },
        restoredProfile: {
          ...input.restoredProfile,
          before: wrongDirection,
          after: wrongDirection,
          authenticatedRecovery: {
            ...input.restoredProfile.authenticatedRecovery,
            sender: ALICE
          }
        }
      })
    ).toThrow(/Bob-to-Alice/i);
  });

  it('rejects wrong onboarding, wallet, package, or warm-run provenance', () => {
    const input = validInput();
    expect(() =>
      buildChatV2RecoveryEvidence({
        ...input,
        onboarding: { ...input.onboarding, runtimeBytecodeHash: HASH_A as never }
      })
    ).toThrow(/provenance/i);
    expect(() =>
      buildChatV2RecoveryEvidence({
        ...input,
        packageRuntime: { ...input.packageRuntime, cotiEthersVersion: '1.0.6' as never }
      })
    ).toThrow(/provenance/i);
    expect(() =>
      buildChatV2RecoveryEvidence({ ...input, warmEvidenceSha256: 'not-a-hash' })
    ).toThrow(/SHA-256/i);
  });

  it('fails if the restored profile was not isolated and prepared through the official companion', () => {
    const input = validInput();
    expect(() =>
      buildChatV2RecoveryEvidence({
        ...input,
        restoredProfile: { ...input.restoredProfile, initialSnapState: 'absent' as never }
      })
    ).toThrow(/isolation/i);
    expect(() =>
      buildChatV2RecoveryEvidence({
        ...input,
        restoredProfile: { ...input.restoredProfile, operatorAck: 'COPIED_PROFILE' as never }
      })
    ).toThrow(/isolation/i);
    expect(() =>
      buildChatV2RecoveryEvidence({
        ...input,
        restoredProfile: {
          ...input.restoredProfile,
          onboardingOrigin: 'https://example.com' as never
        }
      })
    ).toThrow(/isolation/i);
  });

  it('rejects unsafe phase methods, prompt counts, or extra observation fields', () => {
    const input = validInput();
    const badRecovery = recovery();
    badRecovery.rpc.push(rpc('envelope-recovery', 'eth_sendRawTransaction') as never);
    expect(() =>
      buildChatV2RecoveryEvidence({
        ...input,
        restoredProfile: {
          ...input.restoredProfile,
          verificationPhases: [walletConnect(), snapUnlock(), attestation(), badRecovery]
        }
      })
    ).toThrow(/prompt-free read/i);
    expect(() =>
      buildRecoveryPhaseEvidence({
        phase: 'snap-key-store',
        rpc: [
          {
            ...rpc('snap-key-store', 'wallet_invokeSnap', { operation: 'set-aes-key' }),
            params: { newUserAesKey: '11'.repeat(16) }
          }
        ],
        uiPrompts: []
      })
    ).toThrow(/sanitized schema/i);
  });

  it('serializes no cryptographic material, message body, profile path, or RPC payload', () => {
    const serialized = serializeChatV2RecoveryEvidence(
      buildChatV2RecoveryEvidence(validInput())
    );
    expect(serialized).not.toMatch(
      /aesKey|ciphertext|mnemonic|params|passphrase|password|plaintext|privateKey|profile(?:Dir|Path)|result|rsa(?:Key|Private|Public|Share)|seed|signature(?:Body|Hex|Payload)|userKey[12]/i
    );
    expect(serialized).toContain(ACCOUNT_ONBOARD_RUNTIME_HASH);
  });
});
