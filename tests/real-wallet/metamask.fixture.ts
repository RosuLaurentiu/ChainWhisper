import { readFile, realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Page
} from '@playwright/test';
import {
  assertPromptAllowedInPhase,
  classifyMetaMaskSurface,
  findForbiddenRealWalletEnvironmentKeys,
  PINNED_METAMASK_DIRECTORY_SHA256,
  PINNED_METAMASK_OFFICIAL_ARCHIVE_SHA256,
  PINNED_METAMASK_VERSION,
  parseRealWalletScenario,
  type RealWalletScenario
} from './metamaskPolicy';
import type {
  RealWalletPhase,
  RealWalletRole,
  SanitizedWalletPromptObservation,
  WalletPromptKind
} from './promptEvidence';
import { fingerprintExtensionDirectory } from './extensionFingerprint';
import {
  ALICE_RESTORED_PROFILE_ACK,
  assertCanonicalProfileDirectoryLayout,
  createIdempotentAsyncAction,
  createIdempotentRetirement,
  ProfileLaunchRegistry,
  resolveProfileLaunchRequest,
  type RealWalletProfile
} from './realWalletProfileLifecycle';

const OPERATOR_ACK = 'MANUAL_APPROVALS_ONLY';
const ALICE_RESTORED_PROFILE_ACK_ENV = 'CW_REAL_WALLET_ALICE_RESTORED_PROFILE_ACK';
const ALICE_RESTORED_PROFILE_DIR_ENV = 'CW_REAL_WALLET_ALICE_RESTORED_PROFILE_DIR';
const CHAINWHISPER_WORKSPACE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
);
const require = createRequire(import.meta.url);
const PLAYWRIGHT_VERSION = String(
  (require('@playwright/test/package.json') as { version?: unknown }).version ?? ''
);
const REQUIRED_ENV = [
  'CW_REAL_WALLET_OPERATOR_ACK',
  'CW_REAL_WALLET_METAMASK_EXTENSION_DIR',
  'CW_REAL_WALLET_METAMASK_VERSION',
  'CW_REAL_WALLET_METAMASK_SHA256',
  'CW_REAL_WALLET_ALICE_PROFILE_DIR',
  'CW_REAL_WALLET_BOB_PROFILE_DIR',
  'CW_REAL_WALLET_SCENARIO_PATH'
] as const;

export type RealWalletLaunch = {
  browserVersion: string;
  clearSensitiveState: () => Promise<void>;
  context: BrowserContext;
  extensionId: string;
  page: Page;
  profile: RealWalletProfile;
  retire: () => Promise<void>;
  role: RealWalletRole;
};

export type RealWalletController = {
  finalize: () => Promise<string>;
  launch: (profile: RealWalletProfile) => Promise<RealWalletLaunch>;
  provenance: {
    metamaskOfficialArchiveSha256: string;
    metamaskUnpackedDirectorySha256: string;
    metamaskVersion: string;
    playwrightVersion: string;
  };
  scenario: RealWalletScenario;
};

type PromptDecision = {
  atMs: number;
  outcome: 'rejected' | 'resolved';
};

const METAMASK_DECISION_BINDING = '__chainwhisperRecordMetaMaskPromptDecision';
const promptDecisions = new WeakMap<Page, PromptDecision[]>();
const promptDecisionLedger: Array<PromptDecision & { page: Page }> = [];
const recordedPromptDecisionCount = new WeakMap<BrowserContext, number>();
const accountedPromptDecisionCount = new WeakMap<BrowserContext, number>();
const retiredContexts = new WeakSet<BrowserContext>();
const retiredHarnessPages = new WeakSet<Page>();

const installMetaMaskDecisionMeter = (): void => {
  const meteredWindow = window as typeof window & {
    __chainwhisperMetaMaskDecisionMeterInstalled?: boolean;
    __chainwhisperRecordMetaMaskPromptDecision?: (
      outcome: 'rejected' | 'resolved'
    ) => Promise<void>;
  };
  if (meteredWindow.__chainwhisperMetaMaskDecisionMeterInstalled) return;
  Object.defineProperty(meteredWindow, '__chainwhisperMetaMaskDecisionMeterInstalled', {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  });
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-testid]') : null;
      const testId = target?.dataset.testid ?? '';
      const outcome =
        testId === 'confirmation-submit-button' || testId === 'confirm-footer-button'
          ? 'resolved'
          : testId === 'confirmation-cancel-button' || testId === 'confirm-footer-cancel-button'
            ? 'rejected'
            : null;
      if (!outcome || !meteredWindow.__chainwhisperRecordMetaMaskPromptDecision) return;
      void meteredWindow.__chainwhisperRecordMetaMaskPromptDecision(outcome).catch(() => undefined);
    },
    true
  );
};

const requiredEnvironment = (name: (typeof REQUIRED_ENV)[number]): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required public real-wallet setting: ${name}.`);
  }
  return value;
};

const requireAbsolutePath = (value: string, label: string): string => {
  if (!path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute local path.`);
  }
  return path.normalize(value);
};

const resolveExistingDirectory = async (value: string, label: string): Promise<string> => {
  const canonicalDirectory = await realpath(requireAbsolutePath(value, label));
  if (!(await stat(canonicalDirectory)).isDirectory()) {
    throw new Error(`${label} path must be a directory.`);
  }
  return canonicalDirectory;
};

const loadControllerConfig = async () => {
  if (process.env.CI) {
    throw new Error('The manual real-wallet lane is forbidden in CI.');
  }
  const forbidden = findForbiddenRealWalletEnvironmentKeys(process.env);
  if (forbidden.length) {
    throw new Error('Secret-shaped CW_REAL_WALLET environment variables are forbidden.');
  }
  for (const name of REQUIRED_ENV) requiredEnvironment(name);
  if (requiredEnvironment('CW_REAL_WALLET_OPERATOR_ACK') !== OPERATOR_ACK) {
    throw new Error('Manual operator approval acknowledgement is missing.');
  }

  const workspace = await resolveExistingDirectory(
    CHAINWHISPER_WORKSPACE,
    'ChainWhisper workspace'
  );
  const extensionDir = await resolveExistingDirectory(
    requiredEnvironment('CW_REAL_WALLET_METAMASK_EXTENSION_DIR'),
    'MetaMask extension directory'
  );
  const aliceProfile = await resolveExistingDirectory(
    requiredEnvironment('CW_REAL_WALLET_ALICE_PROFILE_DIR'),
    'Alice user-data directory'
  );
  const bobProfile = await resolveExistingDirectory(
    requiredEnvironment('CW_REAL_WALLET_BOB_PROFILE_DIR'),
    'Bob user-data directory'
  );
  const aliceRestoredProfileValue = process.env[ALICE_RESTORED_PROFILE_DIR_ENV]?.trim();
  const aliceRestoredProfile = aliceRestoredProfileValue
    ? await resolveExistingDirectory(
        aliceRestoredProfileValue,
        'Alice restored user-data directory'
      )
    : undefined;
  const profiles = {
    alice: aliceProfile,
    bob: bobProfile,
    ...(aliceRestoredProfile ? { 'alice-restored': aliceRestoredProfile } : {})
  };
  assertCanonicalProfileDirectoryLayout({ extensionDir, profiles, workspace });

  const extensionManifest = JSON.parse(
    await readFile(path.join(extensionDir, 'manifest.json'), 'utf8')
  ) as { version?: unknown };
  if (
    requiredEnvironment('CW_REAL_WALLET_METAMASK_VERSION') !== PINNED_METAMASK_VERSION ||
    extensionManifest.version !== PINNED_METAMASK_VERSION
  ) {
    throw new Error('MetaMask must match the reviewed 13.41.0.0 release.');
  }
  const expectedHash = requiredEnvironment('CW_REAL_WALLET_METAMASK_SHA256').toLowerCase();
  if (
    expectedHash !== PINNED_METAMASK_DIRECTORY_SHA256 ||
    (await fingerprintExtensionDirectory(extensionDir)) !== PINNED_METAMASK_DIRECTORY_SHA256
  ) {
    throw new Error('MetaMask directory does not match the reviewed unpacked fingerprint.');
  }

  const scenarioPath = requireAbsolutePath(
    requiredEnvironment('CW_REAL_WALLET_SCENARIO_PATH'),
    'Scenario JSON path'
  );
  const scenario = parseRealWalletScenario(JSON.parse(await readFile(scenarioPath, 'utf8')));
  return {
    aliceRestoredProfile,
    aliceRestoredProfileAck: process.env[ALICE_RESTORED_PROFILE_ACK_ENV]?.trim(),
    aliceProfile,
    bobProfile,
    extensionDir,
    scenario
  };
};

const extensionIdFromContext = async (context: BrowserContext): Promise<string> => {
  const prefix = 'chrome-extension://';
  let worker = context.serviceWorkers().find(({ url }) => url().startsWith(prefix));
  worker ??= await context.waitForEvent('serviceworker', {
    predicate: ({ url }) => url().startsWith(prefix),
    timeout: 15_000
  });
  const extensionIds = new Set(
    context
      .serviceWorkers()
      .filter(({ url }) => url().startsWith(prefix))
      .map(({ url }) => new URL(url()).hostname)
  );
  const extensionId = new URL(worker.url()).hostname;
  extensionIds.add(extensionId);
  if (extensionIds.size !== 1) throw new Error('Expected exactly one loaded extension identity.');
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('Pinned MetaMask extension ID is invalid.');
  return extensionId;
};

const assertActiveHarnessPage = (harnessPage: Page): void => {
  if (harnessPage.isClosed() || retiredHarnessPages.has(harnessPage)) {
    throw new Error('A retired wallet harness page cannot be measured.');
  }
};

const readPromptHint = async (harnessPage: Page): Promise<WalletPromptKind | null> => {
  assertActiveHarnessPage(harnessPage);
  return harnessPage.evaluate(
    () => window.__CHAINWHISPER_REAL_WALLET_HARNESS__?.getPromptHint() ?? null
  );
};

const activeMonitoredContexts = (
  contexts: readonly BrowserContext[]
): BrowserContext[] => contexts.filter((context) => !retiredContexts.has(context));

const activeHarnessPages = (pages: readonly Page[]): Page[] =>
  pages.filter((page) => !page.isClosed() && !retiredHarnessPages.has(page));

export const assertNoUnaccountedMetaMaskPromptDecisions = (
  contexts: readonly BrowserContext[]
): void => {
  for (const context of activeMonitoredContexts(contexts)) {
    if (
      (recordedPromptDecisionCount.get(context) ?? 0) !==
      (accountedPromptDecisionCount.get(context) ?? 0)
    ) {
      throw new Error('A MetaMask confirmation decision occurred outside a measured phase.');
    }
  }
};

const assertNoForeignExtensionPage = (url: string, extensionId: string): void => {
  if (!url.startsWith('chrome-extension://')) {
    throw new Error('Unknown non-harness page is open in the dedicated wallet profile.');
  }
  if (!url.startsWith(`chrome-extension://${extensionId}/`)) {
    throw new Error('Unknown extension surface is open in the dedicated wallet profile.');
  }
};

const decisionsForPage = (page: Page): readonly PromptDecision[] =>
  promptDecisions.get(page) ?? [];

const isGenericConfirmationPage = (page: Page): boolean => {
  try {
    const parsed = new URL(page.url());
    const route = decodeURIComponent(parsed.hash)
      .replace(/^#\/?/, '/')
      .split(/[?&]/, 1)[0]
      ?.replace(/\/+$/, '')
      .toLowerCase();
    return route === '/confirmation';
  } catch {
    return false;
  }
};

export const assertCleanMetaMaskIdle = async ({
  context,
  contexts = [context],
  extensionId,
  harnessPage,
  harnessPages = [harnessPage],
  phase
}: {
  context: BrowserContext;
  contexts?: readonly BrowserContext[];
  extensionId: string;
  harnessPage: Page;
  harnessPages?: readonly Page[];
  phase: RealWalletPhase;
}): Promise<void> => {
  if (retiredContexts.has(context)) {
    throw new Error('A retired wallet context cannot be measured.');
  }
  if ((await readPromptHint(harnessPage)) !== null) {
    throw new Error('A wallet RPC is already in flight before the measured action.');
  }
  const monitoredContexts = activeMonitoredContexts(contexts);
  assertNoUnaccountedMetaMaskPromptDecisions(monitoredContexts);
  const monitoredHarnessPages = activeHarnessPages(harnessPages);
  for (const monitoredContext of monitoredContexts) {
    for (const page of monitoredContext.pages()) {
      if (monitoredHarnessPages.includes(page) || page.isClosed()) continue;
      assertNoForeignExtensionPage(page.url(), extensionId);
      const surface = classifyMetaMaskSurface({
        extensionId,
        phase,
        promptHint: null,
        url: page.url()
      });
      if (surface && surface.state !== 'idle') {
        throw new Error('A MetaMask prompt was already open before the measured action.');
      }
    }
  }
};

export const observeManualWalletPhase = async ({
  context,
  contexts = [context],
  extensionId,
  harnessPage,
  harnessPages = [harnessPage],
  phase,
  timeoutMs = 10 * 60 * 1_000
}: {
  context: BrowserContext;
  contexts?: readonly BrowserContext[];
  extensionId: string;
  harnessPage: Page;
  harnessPages?: readonly Page[];
  phase: RealWalletPhase;
  timeoutMs?: number;
}): Promise<SanitizedWalletPromptObservation[]> => {
  if (retiredContexts.has(context)) {
    throw new Error('A retired wallet context cannot be measured.');
  }
  assertActiveHarnessPage(harnessPage);
  assertNoUnaccountedMetaMaskPromptDecisions(contexts);
  const observations: SanitizedWalletPromptObservation[] = [];
  const active = new Map<
    Page,
    {
      decisionOffset: number;
      identity: string;
      kind: WalletPromptKind;
      missingSince?: number;
      requiresExplicitDecision: boolean;
      startedAtMs: number;
    }
  >();
  const resolved = new Map<
    Page,
    {
      decisionOffset: number;
      identity: string;
      kind: WalletPromptKind;
      startedAtMs: number;
    }
  >();
  const startedAt = Date.now();
  const decisionLedgerOffset = promptDecisionLedger.length;
  let explicitDecisionObservationCount = 0;
  let sawRunning = false;
  let stableSince: number | null = null;

  const appendExplicitDecisions = (
    prompt: { kind: WalletPromptKind; startedAtMs: number },
    decisions: readonly PromptDecision[]
  ): number => {
    let promptStartedAtMs = prompt.startedAtMs;
    for (const decision of decisions) {
      explicitDecisionObservationCount += 1;
      observations.push({
        durationMs: Math.max(0, decision.atMs - promptStartedAtMs),
        kind: prompt.kind,
        outcome: decision.outcome,
        phase,
        startedAtMs: promptStartedAtMs
      });
      promptStartedAtMs = Math.max(promptStartedAtMs, decision.atMs);
    }
    return promptStartedAtMs;
  };

  while (Date.now() - startedAt < timeoutMs) {
    assertActiveHarnessPage(harnessPage);
    const status = await harnessPage
      .locator(`[data-phase="${phase}"]`)
      .getAttribute('data-status');
    sawRunning ||= status === 'running' || status === 'success' || status === 'error';
    const promptHint = await readPromptHint(harnessPage);
    const visiblePrompts = new Map<
      Page,
      {
        decisionOffset: number;
        identity: string;
        kind: WalletPromptKind;
        requiresExplicitDecision: boolean;
      }
    >();
    assertActiveHarnessPage(harnessPage);
    const monitoredContexts = activeMonitoredContexts(contexts);
    const monitoredHarnessPages = activeHarnessPages(harnessPages);
    for (const promptPage of [...active.keys(), ...resolved.keys()]) {
      if (
        promptPage.isClosed() ||
        retiredContexts.has(promptPage.context()) ||
        !monitoredContexts.includes(promptPage.context())
      ) {
        active.delete(promptPage);
        resolved.delete(promptPage);
      }
    }
    for (const monitoredContext of monitoredContexts) {
      for (const page of monitoredContext.pages()) {
        if (monitoredHarnessPages.includes(page) || page.isClosed()) continue;
        assertNoForeignExtensionPage(page.url(), extensionId);
        const previous = active.get(page) ?? resolved.get(page);
        const surface = classifyMetaMaskSurface({
          extensionId,
          phase,
          promptHint: promptHint ?? previous?.kind ?? null,
          url: page.url()
        });
        if (!surface || surface.state === 'idle') continue;
        if (!(await page.locator('body').isVisible().catch(() => false))) continue;
        if (monitoredContext !== context) {
          throw new Error('A prompt opened in the inactive wallet profile during measurement.');
        }
        assertPromptAllowedInPhase(phase, surface.kind);
        visiblePrompts.set(page, {
          decisionOffset: decisionsForPage(page).length,
          identity: surface.identity,
          kind: surface.kind,
          requiresExplicitDecision: surface.requiresExplicitDecision
        });
      }
    }

    for (const [page, prompt] of active) {
      const next = visiblePrompts.get(page);
      if (prompt.requiresExplicitDecision) {
        const decisions = decisionsForPage(page);
        const pending = decisions.slice(prompt.decisionOffset);
        if (pending.length > 0) {
          const nextStartedAtMs = appendExplicitDecisions(prompt, pending);
          active.delete(page);
          resolved.set(page, {
            decisionOffset: decisions.length,
            identity: prompt.identity,
            kind: prompt.kind,
            startedAtMs: nextStartedAtMs
          });
          continue;
        }
        if (!next || next.kind !== prompt.kind || next.identity !== prompt.identity) {
          prompt.missingSince ??= Date.now();
          if (Date.now() - prompt.missingSince >= 500) {
            throw new Error('Generic MetaMask confirmation changed without a measured decision.');
          }
        } else {
          prompt.missingSince = undefined;
        }
      } else if (!next || next.kind !== prompt.kind || next.identity !== prompt.identity) {
        observations.push({
          durationMs: Date.now() - prompt.startedAtMs,
          kind: prompt.kind,
          outcome: 'resolved',
          phase,
          startedAtMs: prompt.startedAtMs
        });
        active.delete(page);
      }
    }

    for (const [page, prompt] of resolved) {
      const decisions = decisionsForPage(page);
      const pending = decisions.slice(prompt.decisionOffset);
      if (pending.length > 0) {
        prompt.startedAtMs = appendExplicitDecisions(prompt, pending);
        prompt.decisionOffset = decisions.length;
      }
      const next = visiblePrompts.get(page);
      if (!next || next.kind !== prompt.kind || next.identity !== prompt.identity) {
        resolved.delete(page);
      }
    }
    for (const [page, prompt] of visiblePrompts) {
      if (!active.has(page) && !resolved.has(page)) {
        active.set(page, { ...prompt, startedAtMs: Date.now() });
      }
    }

    const completed = status === 'success' || status === 'error';
    if (completed && active.size === 0 && resolved.size === 0 && sawRunning) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= 300) {
        const measuredDecisionEntries = promptDecisionLedger
          .slice(decisionLedgerOffset)
          .filter(({ page }) => monitoredContexts.includes(page.context()));
        if (measuredDecisionEntries.length !== explicitDecisionObservationCount) {
          throw new Error('A generic MetaMask confirmation decision escaped prompt observation.');
        }
        for (const monitoredContext of monitoredContexts) {
          const newlyAccounted = measuredDecisionEntries.filter(
            ({ page }) => page.context() === monitoredContext
          ).length;
          const nextAccounted =
            (accountedPromptDecisionCount.get(monitoredContext) ?? 0) + newlyAccounted;
          if ((recordedPromptDecisionCount.get(monitoredContext) ?? 0) !== nextAccounted) {
            throw new Error('A MetaMask confirmation decision escaped phase accounting.');
          }
          accountedPromptDecisionCount.set(monitoredContext, nextAccounted);
        }
        return observations;
      }
    } else {
      stableSince = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Manual wallet phase timed out or left a prompt open.');
};

export const test = base.extend<{ realWallet: RealWalletController }>({
  realWallet: async ({ baseURL }, provideFixture) => {
    const config = await loadControllerConfig();
    const launchRegistry = new ProfileLaunchRegistry();
    const launches = new Set<RealWalletLaunch>();
    let finalizePromise: Promise<string> | null = null;
    let fixtureError: unknown;
    const finalize = (): Promise<string> => {
      if (finalizePromise) return finalizePromise;
      finalizePromise = (async () => {
        const retirementResults = await Promise.allSettled(
          [...launches].map(({ retire }) => retire())
        );
        const teardownFailures = retirementResults
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map(({ reason }) => reason);
        let fingerprint: string | undefined;
        try {
          fingerprint = await fingerprintExtensionDirectory(config.extensionDir);
          if (fingerprint !== PINNED_METAMASK_DIRECTORY_SHA256) {
            throw new Error('MetaMask unpacked directory changed before teardown completed.');
          }
        } catch (error) {
          teardownFailures.push(error);
        }
        if (teardownFailures.length > 0) {
          throw new AggregateError(teardownFailures, 'Wallet context teardown failed.');
        }
        return fingerprint!;
      })();
      return finalizePromise;
    };
    try {
      await provideFixture({
        finalize,
        provenance: {
          metamaskOfficialArchiveSha256: PINNED_METAMASK_OFFICIAL_ARCHIVE_SHA256,
          metamaskUnpackedDirectorySha256: PINNED_METAMASK_DIRECTORY_SHA256,
          metamaskVersion: PINNED_METAMASK_VERSION,
          playwrightVersion: PLAYWRIGHT_VERSION
        },
        scenario: config.scenario,
        launch: async (profile) => {
          if (finalizePromise) throw new Error('Wallet contexts were already finalized.');
          if (profile === 'alice-restored') {
            if (!config.aliceRestoredProfile) {
              throw new Error(
                `Missing optional recovery profile setting: ${ALICE_RESTORED_PROFILE_DIR_ENV}.`
              );
            }
            if (config.aliceRestoredProfileAck !== ALICE_RESTORED_PROFILE_ACK) {
              throw new Error(
                `Restored-profile launch requires ${ALICE_RESTORED_PROFILE_ACK_ENV}=${ALICE_RESTORED_PROFILE_ACK}.`
              );
            }
          }
          const { profileDirectory, role } = resolveProfileLaunchRequest({
            aliceRestoredProfileAck: config.aliceRestoredProfileAck,
            profile,
            profiles: {
              alice: config.aliceProfile,
              bob: config.bobProfile,
              ...(config.aliceRestoredProfile
                ? { 'alice-restored': config.aliceRestoredProfile }
                : {})
            }
          });
          const reservation = launchRegistry.reserve(profile, profileDirectory);
          let context: BrowserContext | null = null;
          try {
            context = await chromium.launchPersistentContext(profileDirectory, {
              args: [
                `--disable-extensions-except=${config.extensionDir}`,
                `--load-extension=${config.extensionDir}`
              ],
              baseURL,
              channel: 'chromium',
              headless: false,
              recordVideo: undefined
            });
            await context.exposeBinding(
              METAMASK_DECISION_BINDING,
              ({ page: sourcePage }, outcome: unknown) => {
                if (
                  retiredContexts.has(context!) ||
                  sourcePage.isClosed() ||
                  !sourcePage.url().startsWith('chrome-extension://') ||
                  !isGenericConfirmationPage(sourcePage) ||
                  (outcome !== 'rejected' && outcome !== 'resolved')
                ) {
                  return;
                }
                const decisions = promptDecisions.get(sourcePage) ?? [];
                const decision: PromptDecision = { atMs: Date.now(), outcome };
                decisions.push(decision);
                promptDecisions.set(sourcePage, decisions);
                promptDecisionLedger.push({ ...decision, page: sourcePage });
                const sourceContext = sourcePage.context();
                recordedPromptDecisionCount.set(
                  sourceContext,
                  (recordedPromptDecisionCount.get(sourceContext) ?? 0) + 1
                );
              }
            );
            await context.addInitScript(installMetaMaskDecisionMeter);
            const extensionId = await extensionIdFromContext(context);
            const existingPages = context.pages();
            const foreignPages = existingPages.filter(
              (existingPage) =>
                existingPage.url() !== 'about:blank' &&
                !existingPage.url().startsWith(`chrome-extension://${extensionId}/`)
            );
            if (foreignPages.length > 0) {
              throw new Error('Dedicated wallet profiles must not restore foreign browser pages.');
            }
            const blankPages = existingPages.filter(
              (existingPage) => existingPage.url() === 'about:blank'
            );
            if (blankPages.length > 1) {
              throw new Error('Dedicated wallet profile opened multiple untrusted blank pages.');
            }
            await Promise.all(
              existingPages
                .filter((existingPage) =>
                  existingPage.url().startsWith(`chrome-extension://${extensionId}/`)
                )
                .map((existingPage) => existingPage.evaluate(installMetaMaskDecisionMeter))
            );
            const page = blankPages[0] ?? (await context.newPage());
            const browserVersion = context.browser()?.version() ?? '';
            if (!browserVersion) {
              throw new Error('Unable to determine the measured Chromium version.');
            }
            const clearSensitiveState = createIdempotentAsyncAction(async () => {
              assertNoUnaccountedMetaMaskPromptDecisions([context!]);
              await page.evaluate(() => {
                const harness = window.__CHAINWHISPER_REAL_WALLET_HARNESS__;
                if (!harness) throw new Error('Sensitive-state cleanup hook is unavailable.');
                if (!harness.clearSensitiveState()) {
                  throw new Error('Sensitive-state cleanup hook did not attest completion.');
                }
              });
            });
            const retire = createIdempotentRetirement({
              clearSensitiveState,
              closeContext: () => context!.close(),
              markRetired: () => {
                retiredContexts.add(context!);
                retiredHarnessPages.add(page);
                for (let index = promptDecisionLedger.length - 1; index >= 0; index -= 1) {
                  if (promptDecisionLedger[index]!.page.context() === context) {
                    promptDecisionLedger.splice(index, 1);
                  }
                }
              },
              releaseReservation: () => launchRegistry.release(reservation)
            });
            const launch: RealWalletLaunch = {
              browserVersion,
              clearSensitiveState,
              context,
              extensionId,
              page,
              profile,
              retire,
              role
            };
            launches.add(launch);
            return launch;
          } catch (launchError) {
            const cleanupFailures: unknown[] = [];
            let contextClosed = context === null;
            if (context) {
              retiredContexts.add(context);
              try {
                await context.close();
                contextClosed = true;
              } catch (cleanupError) {
                cleanupFailures.push(cleanupError);
              }
            }
            if (contextClosed) {
              try {
                launchRegistry.release(reservation);
              } catch (cleanupError) {
                cleanupFailures.push(cleanupError);
              }
            }
            if (cleanupFailures.length > 0) {
              throw new AggregateError(
                [launchError, ...cleanupFailures],
                'Wallet profile launch and cleanup failed.'
              );
            }
            throw launchError;
          }
        }
      });
    } catch (error) {
      fixtureError = error;
    }
    try {
      await finalize();
    } catch (cleanupError) {
      if (fixtureError !== undefined) {
        throw new AggregateError([fixtureError, cleanupError], 'Wallet measurement and teardown failed.');
      }
      throw cleanupError;
    }
    if (fixtureError !== undefined) throw fixtureError;
  }
});

export { expect };
