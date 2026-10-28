import { describe, expect, it } from 'vitest';
import {
  DIRECT_CHAT_V2_CREATE_SELECTOR,
  DIRECT_CHAT_V2_ROTATE_SELECTOR
} from '../../src/lib/directChatV2Chain';
import { deriveDirectChatV2ConversationId } from '../../src/lib/directChatV2Crypto';
import {
  assertPromptFreeReadPhase,
  assertSessionBootstrapPhase,
  assertWarmTransactionPhase,
  buildEvidenceDocument,
  buildPhaseEvidence,
  parseEvidenceDocument,
  sanitizeRpcObservation,
  serializeEvidenceDocument,
  type ChatV2RecoveryAnchor,
  type PhaseEvidence,
  type RealWalletEvidenceDocument,
  type RealWalletEvidenceInput,
  type RealWalletPhase,
  type RealWalletRole
} from './promptEvidence';
import {
  PINNED_COTI_SNAP_VERSION,
  PINNED_METAMASK_DIRECTORY_SHA256,
  PINNED_METAMASK_OFFICIAL_ARCHIVE_SHA256,
  PINNED_METAMASK_VERSION
} from './metamaskPolicy';
import { DIRECT_CHAT_V2_SEND_SELECTOR } from './transactionPolicy';

const CONTRACT = '0x1111111111111111111111111111111111111111';
const ALICE = '0x2222222222222222222222222222222222222222';
const BOB = '0x3333333333333333333333333333333333333333';
const SELECTOR = '0x12345678';
const PARTICIPANTS = { alice: ALICE, bob: BOB };
const RECOVERY_ANCHOR: ChatV2RecoveryAnchor = {
  conversationId: deriveDirectChatV2ConversationId({
    chainId: 7_082_400n,
    contractAddress: CONTRACT,
    participantA: ALICE,
    participantB: BOB
  }),
  currentEpoch: '3',
  latestMessageBlock: '456',
  latestMessageBlockHash: `0x${'cd'.repeat(32)}`,
  latestMessageId: '2',
  latestRecipient: ALICE,
  latestSender: BOB,
  messageCount: '2'
};
const AUTHENTICATED_RECOVERY = {
  conversationId: RECOVERY_ANCHOR.conversationId,
  epoch: '2',
  messageBlock: RECOVERY_ANCHOR.latestMessageBlock,
  messageBlockHash: RECOVERY_ANCHOR.latestMessageBlockHash,
  messageId: RECOVERY_ANCHOR.latestMessageId,
  recipient: RECOVERY_ANCHOR.latestRecipient,
  sender: RECOVERY_ANCHOR.latestSender
};
const WALLET_RUNTIME = {
  browserVersion: '141.0.0.0',
  cotiSnapVersion: PINNED_COTI_SNAP_VERSION,
  extensionId: 'abcdefghijklmnopabcdefghijklmnop',
  metamaskOfficialArchiveSha256: PINNED_METAMASK_OFFICIAL_ARCHIVE_SHA256,
  metamaskUnpackedDirectorySha256: PINNED_METAMASK_DIRECTORY_SHA256,
  metamaskUnpackedDirectorySha256AfterRun: PINNED_METAMASK_DIRECTORY_SHA256,
  metamaskVersion: PINNED_METAMASK_VERSION,
  playwrightVersion: '1.59.1'
};
const PHASES_BY_ROLE: Record<RealWalletRole, readonly RealWalletPhase[]> = {
  alice: [
    'wallet-connect',
    'snap-unlock',
    'deployment-attestation',
    'warm-create',
    'envelope-recovery',
    'warm-send',
    'warm-rotate',
    'envelope-recovery'
  ],
  bob: [
    'wallet-connect',
    'snap-unlock',
    'deployment-attestation',
    'envelope-recovery',
    'warm-send',
    'warm-rotate'
  ]
};
const validPhasesFor = (role: RealWalletRole): PhaseEvidence[] =>
  PHASES_BY_ROLE[role].map((phase, index) => {
    const startedAtMs = index + 1;
    if (phase === 'wallet-connect') {
      return {
        phase,
        rpc: [{ durationMs: 1, method: 'eth_requestAccounts', outcome: 'success', phase, startedAtMs }],
        uiPrompts: []
      };
    }
    if (phase === 'snap-unlock') {
      return {
        phase,
        rpc: [
          { durationMs: 1, method: 'wallet_invokeSnap', operation: 'connect-to-wallet', outcome: 'success', phase, startedAtMs },
          { durationMs: 1, method: 'wallet_invokeSnap', operation: 'has-aes-key', outcome: 'success', phase, startedAtMs: startedAtMs + 0.1 },
          { durationMs: 1, method: 'wallet_invokeSnap', operation: 'get-aes-key', outcome: 'success', phase, startedAtMs: startedAtMs + 0.2 }
        ],
        uiPrompts: [
          { durationMs: 1, kind: 'snap-connect-wallet', outcome: 'resolved', phase, startedAtMs },
          { durationMs: 1, kind: 'snap-aes-access', outcome: 'resolved', phase, startedAtMs: startedAtMs + 0.2 }
        ]
      };
    }
    if (phase === 'warm-create' || phase === 'warm-send' || phase === 'warm-rotate') {
      const selector =
        phase === 'warm-create'
          ? DIRECT_CHAT_V2_CREATE_SELECTOR
          : phase === 'warm-send'
            ? DIRECT_CHAT_V2_SEND_SELECTOR
            : DIRECT_CHAT_V2_ROTATE_SELECTOR;
      return {
        phase,
        rpc: [
          {
            durationMs: 1,
            method: 'eth_sendTransaction',
            outcome: 'success',
            phase,
            selector,
            startedAtMs,
            target: CONTRACT
          }
        ],
        uiPrompts: [
          { durationMs: 1, kind: 'transaction', outcome: 'resolved', phase, startedAtMs }
        ]
      };
    }
    return {
      phase,
      rpc: [{ durationMs: 1, method: 'eth_call', outcome: 'success', phase, startedAtMs }],
      uiPrompts: []
    };
  });

const evidenceInput = (): RealWalletEvidenceInput => ({
  authenticatedRecovery: { ...AUTHENTICATED_RECOVERY },
  capturedAt: '2026-08-09T12:00:00.000Z',
  contract: {
    address: CONTRACT,
    chainId: '7082400',
    deploymentBlock: '123',
    runtimeBytecodeHash: `0x${'ab'.repeat(32)}`
  },
  participants: { ...PARTICIPANTS },
  recoveryAnchor: { ...RECOVERY_ANCHOR },
  roles: [
    { role: 'alice', phases: validPhasesFor('alice') },
    { role: 'bob', phases: validPhasesFor('bob') }
  ],
  walletRuntime: { ...WALLET_RUNTIME }
});

const evidenceInputFromDocument = (
  document: RealWalletEvidenceDocument
): RealWalletEvidenceInput => {
  const { schemaVersion: _schemaVersion, ...input } = document;
  return input;
};

describe('real-wallet prompt evidence', () => {
  it('drops parameters, results, errors, and secret-shaped extra fields', () => {
    const sentinel = 'NEVER_SERIALIZE_THIS_SECRET';
    const observation = sanitizeRpcObservation({
      aesKey: sentinel,
      durationMs: 4.25,
      error: sentinel,
      method: 'wallet_invokeSnap',
      operation: 'get-aes-key',
      outcome: 'success',
      params: { privateKey: sentinel },
      phase: 'snap-unlock',
      result: sentinel,
      startedAtMs: 10
    });

    const serialized = JSON.stringify(observation);
    expect(serialized).not.toContain(sentinel);
    expect(Object.keys(observation).sort()).toEqual([
      'durationMs',
      'method',
      'operation',
      'outcome',
      'phase',
      'startedAtMs'
    ]);
  });

  it('accepts exactly one allowlisted warm transaction and visible transaction prompt', () => {
    const phase = buildPhaseEvidence({
      phase: 'warm-send',
      rpc: [
        {
          durationMs: 3,
          method: 'eth_call',
          outcome: 'success',
          phase: 'warm-send',
          startedAtMs: 1
        },
        {
          durationMs: 25,
          method: 'eth_sendTransaction',
          outcome: 'success',
          phase: 'warm-send',
          selector: SELECTOR,
          startedAtMs: 5,
          target: CONTRACT
        }
      ],
      uiPrompts: [
        {
          durationMs: 20,
          kind: 'transaction',
          outcome: 'resolved',
          phase: 'warm-send',
          startedAtMs: 7
        }
      ]
    });

    expect(() => assertWarmTransactionPhase(phase, CONTRACT, SELECTOR)).not.toThrow();
  });

  it('rejects extra signing, Snap calls, extra sends, or misleading prompt counts', () => {
    const baseRpc = {
      durationMs: 1,
      outcome: 'success',
      phase: 'warm-create',
      startedAtMs: 1
    } as const;
    const transaction = {
      ...baseRpc,
      method: 'eth_sendTransaction',
      selector: SELECTOR,
      target: CONTRACT
    };
    const prompt = {
      durationMs: 1,
      kind: 'transaction',
      outcome: 'resolved',
      phase: 'warm-create',
      startedAtMs: 1
    } as const;

    for (const unexpectedMethod of [
      'eth_signTransaction',
      'personal_sendTransaction',
      'personal_sign',
      'eth_signTypedData_v4',
      'wallet_invokeSnap'
    ]) {
      const phase = buildPhaseEvidence({
        phase: 'warm-create',
        rpc: [
          transaction,
          {
            ...baseRpc,
            method: unexpectedMethod,
            ...(unexpectedMethod === 'wallet_invokeSnap' ? { operation: 'get-aes-key' } : {})
          }
        ],
        uiPrompts: [prompt]
      });
      expect(() => assertWarmTransactionPhase(phase, CONTRACT, SELECTOR)).toThrow();
    }

    const duplicate = buildPhaseEvidence({
      phase: 'warm-create',
      rpc: [transaction, { ...transaction, startedAtMs: 2 }],
      uiPrompts: [prompt]
    });
    expect(() => assertWarmTransactionPhase(duplicate, CONTRACT, SELECTOR)).toThrow();

    const noVisiblePrompt = buildPhaseEvidence({
      phase: 'warm-create',
      rpc: [transaction],
      uiPrompts: []
    });
    expect(() => assertWarmTransactionPhase(noVisiblePrompt, CONTRACT, SELECTOR)).toThrow();
  });

  it('requires envelope recovery to remain prompt-free and transaction-free', () => {
    const read = buildPhaseEvidence({
      phase: 'envelope-recovery',
      rpc: [
        {
          durationMs: 2,
          method: 'eth_call',
          outcome: 'success',
          phase: 'envelope-recovery',
          startedAtMs: 1
        }
      ],
      uiPrompts: []
    });
    expect(() => assertPromptFreeReadPhase(read)).not.toThrow();

    const prompted = {
      ...read,
      uiPrompts: [
        {
          durationMs: 1,
          kind: 'snap-aes-access' as const,
          outcome: 'resolved' as const,
          phase: 'envelope-recovery' as const,
          startedAtMs: 1
        }
      ]
    };
    expect(() => assertPromptFreeReadPhase(prompted)).toThrow();
  });

  it('requires exactly connect, prompt-free key check, key access and two confirmations', () => {
    const rpcBase = {
      durationMs: 1,
      method: 'wallet_invokeSnap',
      outcome: 'success' as const,
      phase: 'snap-unlock' as const,
      startedAtMs: 1
    };
    const promptBase = {
      durationMs: 1,
      outcome: 'resolved' as const,
      phase: 'snap-unlock' as const,
      startedAtMs: 1
    };
    const valid = buildPhaseEvidence({
      phase: 'snap-unlock',
      rpc: [
        { ...rpcBase, operation: 'connect-to-wallet' },
        { ...rpcBase, operation: 'has-aes-key', startedAtMs: 2 },
        { ...rpcBase, operation: 'get-aes-key', startedAtMs: 3 }
      ],
      uiPrompts: [
        { ...promptBase, kind: 'snap-connect-wallet' },
        { ...promptBase, kind: 'snap-aes-access', startedAtMs: 2 }
      ]
    });
    expect(() => assertSessionBootstrapPhase(valid)).not.toThrow();

    expect(() =>
      assertSessionBootstrapPhase({
        ...valid,
        uiPrompts: [valid.uiPrompts[0]]
      })
    ).toThrow(/exactly two/i);
    expect(() =>
      assertSessionBootstrapPhase({
        ...valid,
        rpc: valid.rpc.filter(({ operation }) => operation !== 'has-aes-key')
      })
    ).toThrow(/prompt-free key check/i);
  });

  it('rejects phase-label mismatches before evidence is accepted', () => {
    expect(() =>
      buildPhaseEvidence({
        phase: 'warm-send',
        rpc: [
          {
            durationMs: 1,
            method: 'eth_call',
            outcome: 'success',
            phase: 'warm-rotate',
            startedAtMs: 1
          }
        ],
        uiPrompts: []
      })
    ).toThrow(/phase/i);
  });

  it('serializes only the fixed evidence schema', () => {
    const document = buildEvidenceDocument(evidenceInput());
    const serialized = serializeEvidenceDocument(document);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      'authenticatedRecovery',
      'capturedAt',
      'contract',
      'participants',
      'recoveryAnchor',
      'roles',
      'schemaVersion',
      'walletRuntime'
    ]);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.authenticatedRecovery).toEqual(AUTHENTICATED_RECOVERY);
    expect(parsed.recoveryAnchor).toEqual(RECOVERY_ANCHOR);
    expect(parsed.walletRuntime).toMatchObject({
      cotiSnapVersion: PINNED_COTI_SNAP_VERSION
    });
    expect(serialized).not.toMatch(/aesKey|privateKey|mnemonic|password|params|result/i);
    expect(() =>
      buildEvidenceDocument({
        ...evidenceInputFromDocument(document),
        walletRuntime: { ...WALLET_RUNTIME, metamaskVersion: '13.41.0.1' }
      })
    ).toThrow(/provenance/i);
    expect(() =>
      buildEvidenceDocument({
        ...evidenceInputFromDocument(document),
        walletRuntime: { ...WALLET_RUNTIME, cotiSnapVersion: '1.0.51' }
      })
    ).toThrow(/provenance/i);
    expect(() =>
      buildEvidenceDocument({
        ...evidenceInputFromDocument(document),
        roles: [
          { role: 'alice', phases: validPhasesFor('alice').slice(0, -1) },
          { role: 'bob', phases: validPhasesFor('bob') }
        ],
        walletRuntime: WALLET_RUNTIME
      })
    ).toThrow(/phase sequence/i);
  });

  it('rejects wrong-chain or empty-phase evidence as a standalone document', () => {
    const base = evidenceInput();

    expect(() =>
      buildEvidenceDocument({
        ...base,
        contract: { ...base.contract, chainId: '1' }
      })
    ).toThrow(/7082400/i);

    const aliceWithEmptyPhase = validPhasesFor('alice');
    aliceWithEmptyPhase[0] = { ...aliceWithEmptyPhase[0], rpc: [] };
    expect(() =>
      buildEvidenceDocument({
        ...base,
        roles: [
          { role: 'alice', phases: aliceWithEmptyPhase },
          { role: 'bob', phases: validPhasesFor('bob') }
        ]
      })
    ).toThrow(/RPC activity/i);
  });

  it('binds the canonical warm recovery anchor to the final Bob-to-Alice message', () => {
    const input = evidenceInput();
    expect(() =>
      buildEvidenceDocument({
        ...input,
        recoveryAnchor: { ...input.recoveryAnchor, latestSender: ALICE }
      })
    ).toThrow(/Bob as sender.*Alice as recipient/i);
    expect(() =>
      buildEvidenceDocument({
        ...input,
        recoveryAnchor: { ...input.recoveryAnchor, currentEpoch: '4' }
      })
    ).toThrow(/two-message, three-epoch/i);
    expect(() =>
      buildEvidenceDocument({
        ...input,
        recoveryAnchor: { ...input.recoveryAnchor, latestMessageId: '1' }
      })
    ).toThrow(/latest message ID/i);
    expect(() =>
      buildEvidenceDocument({
        ...input,
        recoveryAnchor: { ...input.recoveryAnchor, conversationId: `0x${'ef'.repeat(32)}` }
      })
    ).toThrow(/participants and deployment/i);
  });

  it('requires the separate authenticated-decrypt receipt in warm evidence', () => {
    const input = evidenceInput();
    expect(() =>
      buildEvidenceDocument({ ...input, authenticatedRecovery: null as never })
    ).toThrow();
    expect(() =>
      buildEvidenceDocument({
        ...input,
        authenticatedRecovery: { ...input.authenticatedRecovery, messageId: '1' }
      })
    ).toThrow(/authenticated message decrypt/i);
  });

  it('strictly parses only schema v2 evidence with exact JSON-safe fields', () => {
    const document = buildEvidenceDocument(evidenceInput());
    expect(parseEvidenceDocument(serializeEvidenceDocument(document))).toEqual(document);

    const wrongVersion = { ...document, schemaVersion: 1 };
    expect(() => parseEvidenceDocument(wrongVersion)).toThrow(/schemaVersion.*2/i);

    const extraAnchorField = JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
    (extraAnchorField.recoveryAnchor as Record<string, unknown>).privateKey = 'forbidden';
    expect(() => parseEvidenceDocument(extraAnchorField)).toThrow(/exact evidence schema/i);

    const extraRpcField = JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
    const roles = extraRpcField.roles as Array<Record<string, unknown>>;
    const phases = roles[0].phases as Array<Record<string, unknown>>;
    const rpc = phases[0].rpc as Array<Record<string, unknown>>;
    rpc[0].params = ['forbidden'];
    expect(() => parseEvidenceDocument(extraRpcField)).toThrow(/exact evidence schema/i);

    expect(() => parseEvidenceDocument('{not-json')).toThrow(/valid JSON/i);
  });

  it('rejects duplicate or missing role evidence', () => {
    const input = evidenceInput();

    expect(() =>
      buildEvidenceDocument({
        ...input,
        roles: [{ role: 'alice', phases: [] }],
        walletRuntime: WALLET_RUNTIME
      })
    ).toThrow(/Alice.*Bob/i);
    expect(() =>
      buildEvidenceDocument({
        ...input,
        roles: [
          { role: 'alice', phases: [] },
          { role: 'alice', phases: [] }
        ],
        walletRuntime: WALLET_RUNTIME
      })
    ).toThrow(/Alice.*Bob/i);
  });
});
