import { createHash } from 'node:crypto';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertCleanMetaMaskIdle,
  assertNoUnaccountedMetaMaskPromptDecisions,
  expect,
  observeManualWalletPhase,
  test,
  type RealWalletLaunch
} from './metamask.fixture';
import {
  parseEvidenceDocument,
  type ChatV2AuthenticatedRecovery,
  type ChatRecoveryAnchor,
  type RealWalletEvidenceDocument,
  type RealWalletPhase
} from './promptEvidence';
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
  type RecoveryPhaseEvidence
} from './recoveryEvidence';
import { PINNED_COTI_SNAP_VERSION } from './metamaskPolicy';
import {
  consumeObservationLedger,
  createObservationLedgerCursor,
  sealObservationLedgerCursor
} from './observationLedger';

const WARM_EVIDENCE_ENV = 'CW_REAL_WALLET_WARM_EVIDENCE_PATH';
const OFFICIAL_ONBOARDING_ACK_ENV = 'CW_REAL_WALLET_OFFICIAL_COTI_ONBOARDING_ACK';
const MAX_WARM_EVIDENCE_BYTES = 1_048_576;
type RecoveryPhase = Extract<
  RealWalletPhase,
  | 'deployment-attestation'
  | 'envelope-recovery'
  | 'snap-unlock'
  | 'wallet-connect'
>;

const ACTION_BY_PHASE: Record<RecoveryPhase, string> = {
  'wallet-connect': 'connect-wallet',
  'snap-unlock': 'unlock-snap',
  'deployment-attestation': 'attest',
  'envelope-recovery': 'recover'
};

const readWarmEvidence = async (): Promise<{
  document: RealWalletEvidenceDocument;
  sha256: string;
}> => {
  const configuredPath = process.env[WARM_EVIDENCE_ENV]?.trim();
  if (!configuredPath || !path.isAbsolute(configuredPath)) {
    throw new Error(`${WARM_EVIDENCE_ENV} must name the absolute warm evidence JSON path.`);
  }
  const canonicalPath = await realpath(configuredPath);
  const metadata = await stat(canonicalPath);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_WARM_EVIDENCE_BYTES) {
    throw new Error('Warm evidence must be a bounded, non-empty regular file.');
  }
  const bytes = await readFile(canonicalPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Warm evidence is not valid JSON.');
  }
  return {
    document: parseEvidenceDocument(parsed),
    sha256: `0x${createHash('sha256').update(bytes).digest('hex')}`
  };
};

const requireRecoveryAnchor = async (launch: RealWalletLaunch): Promise<ChatRecoveryAnchor> => {
  const anchor = await launch.page.evaluate(
    () => window.__CHAINWHISPER_REAL_WALLET_HARNESS__?.getRecoveryAnchor() ?? null
  );
  if (!anchor) throw new Error('The harness did not produce a canonical recovery anchor.');
  return anchor;
};

const requireAuthenticatedRecovery = async (
  launch: RealWalletLaunch
): Promise<ChatV2AuthenticatedRecovery> => {
  const receipt = await launch.page.evaluate(
    () => window.__CHAINWHISPER_REAL_WALLET_HARNESS__?.getAuthenticatedRecovery() ?? null
  );
  if (!receipt) throw new Error('The harness did not attest an authenticated message decrypt.');
  return receipt;
};

test.describe.configure({ mode: 'serial' });

test('manual persistent and restored-profile Chat V2 recovery', async ({ realWallet }, testInfo) => {
  const warm = await readWarmEvidence();
  const launches: RealWalletLaunch[] = [];
  let finalized = false;

  if (process.env[OFFICIAL_ONBOARDING_ACK_ENV]?.trim() !== OFFICIAL_COTI_ONBOARDING_ACK) {
    throw new Error(
      `Restored-profile verification requires ${OFFICIAL_ONBOARDING_ACK_ENV}=${OFFICIAL_COTI_ONBOARDING_ACK}.`
    );
  }

  if (
    warm.document.contract.address !== realWallet.scenario.manifest.contractAddress ||
    warm.document.contract.chainId !== realWallet.scenario.manifest.chainId ||
    warm.document.contract.deploymentBlock !== realWallet.scenario.manifest.deploymentBlock ||
    warm.document.contract.runtimeBytecodeHash !== realWallet.scenario.manifest.runtimeBytecodeHash ||
    warm.document.participants.alice !== realWallet.scenario.participants.alice ||
    warm.document.participants.bob !== realWallet.scenario.participants.bob
  ) {
    throw new Error('Warm evidence does not match the exact recovery scenario.');
  }

  const launchRecoveryProfile = async (profile: 'alice' | 'alice-restored') => {
    const launched = await realWallet.launch(profile);
    launches.push(launched);
    const first = launches[0];
    if (
      first &&
      (launched.extensionId !== first.extensionId || launched.browserVersion !== first.browserVersion)
    ) {
      throw new Error('Every recovery stage must use the same pinned wallet and browser runtime.');
    }
    await launched.page.addInitScript(
      (publicConfig) => {
        window.__CHAINWHISPER_REAL_WALLET_TEST_CONFIG__ = publicConfig;
      },
      {
        account: realWallet.scenario.participants.alice,
        journey: 'recovery' as const,
        manifest: realWallet.scenario.manifest,
        peer: realWallet.scenario.participants.bob,
        role: 'alice' as const
      }
    );
    await launched.page.goto('/tests/real-wallet/harness/');
    await expect(launched.page.getByRole('heading', { name: /prompt measurement/i })).toBeVisible();

    let observationCursor = createObservationLedgerCursor();
    const runPhase = async (phase: RecoveryPhase): Promise<RecoveryPhaseEvidence> => {
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
      if (status !== 'success') throw new Error(`Manual ${phase} recovery phase stopped safely.`);
      const allRpc = await launched.page.evaluate(
        () => window.__CHAINWHISPER_REAL_WALLET_HARNESS__?.getObservations() ?? []
      );
      const consumed = consumeObservationLedger({
        beforeCount: before,
        cursor: observationCursor,
        observations: allRpc
      });
      observationCursor = consumed.cursor;
      return buildRecoveryPhaseEvidence({
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
      if (!sealed) throw new Error('The recovery observation ledger did not seal.');
      observationCursor = sealedCursor;
    };
    return { launched, runPhase, sealLedger };
  };

  try {
    const persistent = await launchRecoveryProfile('alice');
    const persistentPhases: RecoveryPhaseEvidence[] = [];
    for (const phase of [
      'wallet-connect',
      'snap-unlock',
      'deployment-attestation',
      'envelope-recovery'
    ] as const) {
      persistentPhases.push(await persistent.runPhase(phase));
    }
    const persistentAnchor = await requireRecoveryAnchor(persistent.launched);
    const persistentAuthenticatedRecovery = await requireAuthenticatedRecovery(persistent.launched);
    const persistentSnapVersion = await persistent.launched.page.evaluate(
      () => window.__CHAINWHISPER_REAL_WALLET_HARNESS__?.getCotiSnapVersion() ?? null
    );
    if (persistentSnapVersion !== PINNED_COTI_SNAP_VERSION) {
      throw new Error('Persistent-profile COTI Snap version does not match the reviewed pin.');
    }
    await persistent.sealLedger();
    await persistent.launched.retire();

    const restoredVerification = await launchRecoveryProfile('alice-restored');
    const restoredVerificationPhases: RecoveryPhaseEvidence[] = [];
    for (const phase of [
      'wallet-connect',
      'snap-unlock',
      'deployment-attestation'
    ] as const) {
      restoredVerificationPhases.push(await restoredVerification.runPhase(phase));
    }
    const restoredBefore = await requireRecoveryAnchor(restoredVerification.launched);
    restoredVerificationPhases.push(
      await restoredVerification.runPhase('envelope-recovery')
    );
    const restoredAfter = await requireRecoveryAnchor(restoredVerification.launched);
    const restoredAuthenticatedRecovery = await requireAuthenticatedRecovery(
      restoredVerification.launched
    );
    const restoredSnapVersion = await restoredVerification.launched.page.evaluate(
      () => window.__CHAINWHISPER_REAL_WALLET_HARNESS__?.getCotiSnapVersion() ?? null
    );
    if (restoredSnapVersion !== PINNED_COTI_SNAP_VERSION) {
      throw new Error('Restored-profile verification used an unexpected COTI Snap version.');
    }
    await restoredVerification.sealLedger();

    const postRunFingerprint = await realWallet.finalize();
    finalized = true;
    const firstLaunch = launches[0]!;
    const evidence = buildChatV2RecoveryEvidence({
      capturedAt: new Date().toISOString(),
      contract: {
        address: realWallet.scenario.manifest.contractAddress,
        chainId: realWallet.scenario.manifest.chainId,
        deploymentBlock: realWallet.scenario.manifest.deploymentBlock,
        runtimeBytecodeHash: realWallet.scenario.manifest.runtimeBytecodeHash
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
      participants: realWallet.scenario.participants,
      persistentReload: {
        after: persistentAnchor,
        authenticatedRecovery: persistentAuthenticatedRecovery,
        before: warm.document.recoveryAnchor,
        envelopeRefresh: 'not-required',
        isolation: 'same-canonical-profile-after-context-close',
        phases: persistentPhases
      },
      restoredProfile: {
        after: restoredAfter,
        authenticatedRecovery: restoredAuthenticatedRecovery,
        before: restoredBefore,
        envelopeRefresh: 'not-required',
        initialSnapState: 'pre-onboarded-by-official-companion',
        isolation: 'distinct-nonnested-canonical-profile',
        onboardingMeasuredInHarness: false,
        onboardingOperatorAck: OFFICIAL_COTI_ONBOARDING_ACK,
        onboardingOrigin: OFFICIAL_COTI_TESTNET_COMPANION_ORIGIN,
        operatorAck: RESTORED_PROFILE_ACK,
        ownerAddress: realWallet.scenario.participants.alice,
        verificationPhases: restoredVerificationPhases
      },
      walletRuntime: {
        browserVersion: firstLaunch.browserVersion,
        cotiSnapVersion: restoredSnapVersion,
        extensionId: firstLaunch.extensionId,
        metamaskOfficialArchiveSha256: realWallet.provenance.metamaskOfficialArchiveSha256,
        metamaskUnpackedDirectorySha256: realWallet.provenance.metamaskUnpackedDirectorySha256,
        metamaskUnpackedDirectorySha256AfterRun: postRunFingerprint,
        metamaskVersion: realWallet.provenance.metamaskVersion,
        playwrightVersion: realWallet.provenance.playwrightVersion
      },
      warmEvidenceSha256: warm.sha256
    });
    const evidencePath = testInfo.outputPath('chat-v2-recovery-evidence.json');
    await writeFile(evidencePath, serializeChatV2RecoveryEvidence(evidence), {
      encoding: 'utf8',
      flag: 'wx'
    });
    await testInfo.attach('sanitized-chat-v2-recovery-evidence', {
      path: evidencePath,
      contentType: 'application/json'
    });
  } finally {
    if (!finalized) {
      await Promise.allSettled(launches.map(({ clearSensitiveState }) => clearSensitiveState()));
    }
  }
});
