import { writeFile } from 'node:fs/promises';
import {
  DIRECT_CHAT_V2_CREATE_SELECTOR,
  DIRECT_CHAT_V2_ROTATE_SELECTOR
} from '../../src/lib/directChatV2Chain';
import {
  assertCleanMetaMaskIdle,
  assertNoUnaccountedMetaMaskPromptDecisions,
  expect,
  observeManualWalletPhase,
  test
} from './metamask.fixture';
import {
  assertPromptFreeReadPhase,
  assertSessionBootstrapPhase,
  assertWalletConnectPhase,
  assertWarmTransactionPhase,
  buildEvidenceDocument,
  buildPhaseEvidence,
  serializeEvidenceDocument,
  type PhaseEvidence,
  type RealWalletPhase,
  type RealWalletRole,
  type RoleEvidence
} from './promptEvidence';
import { DIRECT_CHAT_V2_SEND_SELECTOR } from './transactionPolicy';
import { PINNED_COTI_SNAP_VERSION } from './metamaskPolicy';
import {
  consumeObservationLedger,
  createObservationLedgerCursor,
  sealObservationLedgerCursor
} from './observationLedger';

type WarmRealWalletPhase = Exclude<
  RealWalletPhase,
  'privacy-onboarding' | 'snap-install' | 'snap-key-store'
>;

const ACTION_BY_PHASE: Record<WarmRealWalletPhase, string> = {
  'wallet-connect': 'connect-wallet',
  'snap-unlock': 'unlock-snap',
  'deployment-attestation': 'attest',
  'warm-create': 'create',
  'envelope-recovery': 'recover',
  'warm-send': 'send',
  'warm-rotate': 'rotate'
};

test.describe.configure({ mode: 'serial' });

test('manual MetaMask and COTI Snap prompt measurement', async ({ realWallet }, testInfo) => {
  const launches: Array<Awaited<ReturnType<typeof realWallet.launch>>> = [];
  let finalized = false;

  const startRole = async (role: RealWalletRole) => {
    const launched = await realWallet.launch(role);
    launches.push(launched);
    if (
      launches.some(
        (candidate) =>
          candidate.extensionId !== launched.extensionId ||
          candidate.browserVersion !== launched.browserVersion
      )
    ) {
      throw new Error('All roles must use the same pinned wallet and browser runtime.');
    }
    const account = realWallet.scenario.participants[role];
    const peer = realWallet.scenario.participants[role === 'alice' ? 'bob' : 'alice'];
    await launched.page.addInitScript(
      (publicConfig) => {
        window.__CHAINWHISPER_REAL_WALLET_TEST_CONFIG__ = publicConfig;
      },
      {
        account,
        journey: 'warm' as const,
        manifest: realWallet.scenario.manifest,
        peer,
        role
      }
    );
    await launched.page.goto('/tests/real-wallet/harness/');
    await expect(launched.page.getByRole('heading', { name: /prompt measurement/i })).toBeVisible();

    const phases: PhaseEvidence[] = [];
    let observationCursor = createObservationLedgerCursor();
    const runPhase = async (phase: WarmRealWalletPhase): Promise<PhaseEvidence> => {
      const contexts = launches.map(({ context }) => context);
      const harnessPages = launches.map(({ page }) => page);
      await assertCleanMetaMaskIdle({
        context: launched.context,
        contexts,
        extensionId: launched.extensionId,
        harnessPage: launched.page,
        harnessPages,
        phase
      });
      const before = await launched.page.evaluate(
        () => window.__CHAINWHISPER_REAL_WALLET_HARNESS__?.getObservations().length ?? 0
      );
      const observing = observeManualWalletPhase({
        context: launched.context,
        contexts,
        extensionId: launched.extensionId,
        harnessPage: launched.page,
        harnessPages,
        phase
      });
      await launched.page.locator(`[data-action="${ACTION_BY_PHASE[phase]}"]`).click();
      const uiPrompts = await observing;
      const status = await launched.page
        .locator(`[data-phase="${phase}"]`)
        .getAttribute('data-status');
      if (status !== 'success') throw new Error(`Manual ${phase} phase stopped safely.`);
      const allRpc = await launched.page.evaluate(
        () => window.__CHAINWHISPER_REAL_WALLET_HARNESS__?.getObservations() ?? []
      );
      const consumed = consumeObservationLedger({
        beforeCount: before,
        cursor: observationCursor,
        observations: allRpc
      });
      observationCursor = consumed.cursor;
      return buildPhaseEvidence({
        phase,
        rpc: consumed.entries as unknown as Array<Record<string, unknown>>,
        uiPrompts: uiPrompts as unknown as Array<Record<string, unknown>>
      });
    };

    const sealLedger = async (): Promise<void> => {
      assertNoUnaccountedMetaMaskPromptDecisions(launches.map(({ context }) => context));
      const currentCount = await launched.page.evaluate(
        () => window.__CHAINWHISPER_REAL_WALLET_HARNESS__?.getObservations().length ?? -1
      );
      const sealedCursor = sealObservationLedgerCursor({ currentCount, cursor: observationCursor });
      const sealed = await launched.page.evaluate(
        (expectedCount) =>
          window.__CHAINWHISPER_REAL_WALLET_HARNESS__?.sealObservationLedger(expectedCount) ??
          false,
        currentCount
      );
      if (!sealed) throw new Error('The warm real-wallet observation ledger did not seal.');
      observationCursor = sealedCursor;
    };

    return { launched, phases, role, runPhase, sealLedger };
  };

  const connectAndAttest = async (session: Awaited<ReturnType<typeof startRole>>) => {
    const connected = await session.runPhase('wallet-connect');
    assertWalletConnectPhase(connected);
    session.phases.push(connected);

    const bootstrap = await session.runPhase('snap-unlock');
    assertSessionBootstrapPhase(bootstrap);
    session.phases.push(bootstrap);

    const attestation = await session.runPhase('deployment-attestation');
    assertPromptFreeReadPhase(attestation);
    session.phases.push(attestation);

    const cotiSnapVersion = await session.launched.page.evaluate(
      () => window.__CHAINWHISPER_REAL_WALLET_HARNESS__?.getCotiSnapVersion() ?? null
    );
    if (cotiSnapVersion !== PINNED_COTI_SNAP_VERSION) {
      throw new Error('COTI Snap attestation did not retain the reviewed release version.');
    }
    return cotiSnapVersion;
  };

  try {
    const alice = await startRole('alice');
    const aliceCotiSnapVersion = await connectAndAttest(alice);

    const created = await alice.runPhase('warm-create');
    assertWarmTransactionPhase(
      created,
      realWallet.scenario.manifest.contractAddress,
      DIRECT_CHAT_V2_CREATE_SELECTOR
    );
    alice.phases.push(created);

    const aliceEpochOne = await alice.runPhase('envelope-recovery');
    assertPromptFreeReadPhase(aliceEpochOne);
    alice.phases.push(aliceEpochOne);

    const aliceSent = await alice.runPhase('warm-send');
    assertWarmTransactionPhase(
      aliceSent,
      realWallet.scenario.manifest.contractAddress,
      DIRECT_CHAT_V2_SEND_SELECTOR
    );
    alice.phases.push(aliceSent);

    const aliceRotated = await alice.runPhase('warm-rotate');
    assertWarmTransactionPhase(
      aliceRotated,
      realWallet.scenario.manifest.contractAddress,
      DIRECT_CHAT_V2_ROTATE_SELECTOR
    );
    alice.phases.push(aliceRotated);

    const bob = await startRole('bob');
    const bobCotiSnapVersion = await connectAndAttest(bob);

    const bobEpochTwo = await bob.runPhase('envelope-recovery');
    assertPromptFreeReadPhase(bobEpochTwo);
    bob.phases.push(bobEpochTwo);

    const bobSent = await bob.runPhase('warm-send');
    assertWarmTransactionPhase(
      bobSent,
      realWallet.scenario.manifest.contractAddress,
      DIRECT_CHAT_V2_SEND_SELECTOR
    );
    bob.phases.push(bobSent);

    const bobRotated = await bob.runPhase('warm-rotate');
    assertWarmTransactionPhase(
      bobRotated,
      realWallet.scenario.manifest.contractAddress,
      DIRECT_CHAT_V2_ROTATE_SELECTOR
    );
    bob.phases.push(bobRotated);
    await bob.sealLedger();

    const aliceEpochThree = await alice.runPhase('envelope-recovery');
    assertPromptFreeReadPhase(aliceEpochThree);
    alice.phases.push(aliceEpochThree);
    const recoveryAnchor = await alice.launched.page.evaluate(
      () => window.__CHAINWHISPER_REAL_WALLET_HARNESS__?.getRecoveryAnchor() ?? null
    );
    const authenticatedRecovery = await alice.launched.page.evaluate(
      () => window.__CHAINWHISPER_REAL_WALLET_HARNESS__?.getAuthenticatedRecovery() ?? null
    );
    if (
      !recoveryAnchor ||
      !authenticatedRecovery ||
      authenticatedRecovery.conversationId !== recoveryAnchor.conversationId ||
      authenticatedRecovery.messageId !== recoveryAnchor.latestMessageId ||
      authenticatedRecovery.messageBlock !== recoveryAnchor.latestMessageBlock ||
      authenticatedRecovery.messageBlockHash !== recoveryAnchor.latestMessageBlockHash
    ) {
      throw new Error('Final Alice recovery did not attest the canonical authenticated decrypt.');
    }
    await alice.sealLedger();

    if (
      alice.launched.extensionId !== bob.launched.extensionId ||
      alice.launched.browserVersion !== bob.launched.browserVersion ||
      aliceCotiSnapVersion !== bobCotiSnapVersion
    ) {
      throw new Error('Alice and Bob must use the same pinned wallet, Snap, and browser runtime.');
    }
    const postRunFingerprint = await realWallet.finalize();
    finalized = true;
    const roles: RoleEvidence[] = [
      { role: alice.role, phases: alice.phases },
      { role: bob.role, phases: bob.phases }
    ];
    const evidence = buildEvidenceDocument({
      authenticatedRecovery,
      capturedAt: new Date().toISOString(),
      contract: {
        address: realWallet.scenario.manifest.contractAddress,
        chainId: realWallet.scenario.manifest.chainId,
        deploymentBlock: realWallet.scenario.manifest.deploymentBlock,
        runtimeBytecodeHash: realWallet.scenario.manifest.runtimeBytecodeHash
      },
      participants: {
        alice: realWallet.scenario.participants.alice,
        bob: realWallet.scenario.participants.bob
      },
      recoveryAnchor,
      roles,
      walletRuntime: {
        browserVersion: alice.launched.browserVersion,
        cotiSnapVersion: aliceCotiSnapVersion,
        extensionId: alice.launched.extensionId,
        metamaskOfficialArchiveSha256: realWallet.provenance.metamaskOfficialArchiveSha256,
        metamaskUnpackedDirectorySha256: realWallet.provenance.metamaskUnpackedDirectorySha256,
        metamaskUnpackedDirectorySha256AfterRun: postRunFingerprint,
        metamaskVersion: realWallet.provenance.metamaskVersion,
        playwrightVersion: realWallet.provenance.playwrightVersion
      }
    });
    const evidencePath = testInfo.outputPath('chat-v2-prompt-evidence.json');
    await writeFile(evidencePath, serializeEvidenceDocument(evidence), {
      encoding: 'utf8',
      flag: 'wx'
    });
    await testInfo.attach('sanitized-chat-v2-prompt-evidence', {
      path: evidencePath,
      contentType: 'application/json'
    });
  } finally {
    if (!finalized) {
      await Promise.allSettled(launches.map(({ clearSensitiveState }) => clearSensitiveState()));
    }
  }
});
