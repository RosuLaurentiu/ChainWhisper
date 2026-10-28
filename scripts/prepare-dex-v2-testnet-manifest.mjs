import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AbiCoder, getAddress, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';

export const DEX_V2_APP_MANIFEST_PATH = 'deployments/coti-testnet-dex-v2-app-manifest.json';
export const DEX_V2_DEPLOYMENT_PLAN_DOMAIN = 'chainwhisper-dex-v2-deployment-plan-v2';
export const DEX_V2_ACTIVATION_PLAN_DOMAIN = 'chainwhisper-dex-v2-live-activation-plan-v1';
export const DEX_V2_CANDIDATE_DOMAIN = 'chainwhisper-dex-v2-testnet-candidate-v1';

const COMPONENT_KEYS = Object.freeze([
  'factory', 'pool', 'limit', 'recurring', 'swap', 'core', 'positionToken'
]);

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};

export const hashCanonicalDexV2Json = (value) =>
  keccak256(toUtf8Bytes(JSON.stringify(canonicalize(value)))).toLowerCase();

const fail = (condition, code) => {
  if (!condition) throw new Error(code);
};

const hash = (value, code) => {
  fail(typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value), code);
  return value.toLowerCase();
};

const decimal = (value, code) => {
  fail(typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value), code);
  return value;
};

const transaction = (candidate, name) => {
  const observation = candidate.observations?.find((item) => item?.name === name);
  fail(observation && Number.isSafeInteger(observation.blockNumber), `MISSING_${name.toUpperCase()}_OBSERVATION`);
  return observation;
};

const validatePlan = (plan) => {
  fail(plan?.schemaVersion === 2, 'DEPLOYMENT_PLAN_SCHEMA_MISMATCH');
  fail(plan?.suite === 'chainwhisper-dex-v2-discrete-bin-six-contract-coti-create-stride2-testnet', 'DEPLOYMENT_PLAN_SUITE_MISMATCH');
  fail(plan?.core?.chainId === '7082400', 'DEPLOYMENT_PLAN_CHAIN_MISMATCH');
  fail(
    plan.planHash === hashCanonicalDexV2Json({ domain: DEX_V2_DEPLOYMENT_PLAN_DOMAIN, core: plan.core }),
    'DEPLOYMENT_PLAN_HASH_MISMATCH'
  );
  const baseToken = getAddress(plan.core?.pair?.baseToken).toLowerCase();
  const quoteToken = getAddress(plan.core?.pair?.quoteToken).toLowerCase();
  fail(BigInt(baseToken) < BigInt(quoteToken), 'DEPLOYMENT_PLAN_PAIR_ORDER_MISMATCH');
  fail(
    plan.core.pair.pairKey.toLowerCase() === keccak256(AbiCoder.defaultAbiCoder().encode(
      ['address', 'address'],
      [baseToken, quoteToken]
    )).toLowerCase(),
    'DEPLOYMENT_PLAN_PAIR_KEY_MISMATCH'
  );
  fail(
    Array.isArray(plan.core.pair.admissiblePrivateTokenRuntimeHashes) &&
      plan.core.pair.admissiblePrivateTokenRuntimeHashes.length > 0,
    'DEPLOYMENT_PLAN_TOKEN_MANIFEST_EMPTY'
  );
};

const validateActivationPlan = (activationPlan, deploymentPlan, candidate) => {
  fail(activationPlan?.schemaVersion === 1, 'ACTIVATION_PLAN_SCHEMA_MISMATCH');
  fail(
    activationPlan.planHash === hashCanonicalDexV2Json({
      domain: DEX_V2_ACTIVATION_PLAN_DOMAIN,
      core: activationPlan.core
    }),
    'ACTIVATION_PLAN_HASH_MISMATCH'
  );
  fail(activationPlan.core?.deploymentPlanHash === deploymentPlan.planHash, 'ACTIVATION_DEPLOYMENT_PLAN_MISMATCH');
  fail(activationPlan.core?.deploymentCandidateHash === candidate.candidateHash, 'ACTIVATION_CANDIDATE_MISMATCH');
  fail(activationPlan.core?.orderedTransactions?.length === 16, 'ACTIVATION_TRANSACTION_COUNT_MISMATCH');
};

const validateCandidate = (candidate, plan) => {
  fail(candidate?.schemaVersion === 1, 'CANDIDATE_SCHEMA_MISMATCH');
  fail(candidate?.checkpoint === 'chainwhisper-dex-v2-testnet-candidate', 'CANDIDATE_TYPE_MISMATCH');
  fail(candidate?.result === 'deployed-and-pair-registered-live-route-gate-pending', 'CANDIDATE_RESULT_MISMATCH');
  fail(candidate?.productionActivationEvidence === false, 'CANDIDATE_BOUNDARY_MISMATCH');
  const omittedCandidateFields = new Set([
    'schemaVersion',
    'checkpoint',
    'result',
    'productionActivationEvidence',
    'candidateHash'
  ]);
  const core = Object.fromEntries(
    Object.entries(candidate).filter(([key]) => !omittedCandidateFields.has(key))
  );
  fail(
    candidate.candidateHash === hashCanonicalDexV2Json({ domain: DEX_V2_CANDIDATE_DOMAIN, core }),
    'CANDIDATE_HASH_MISMATCH'
  );
  fail(candidate.planHash === plan.planHash, 'CANDIDATE_PLAN_MISMATCH');
  fail(JSON.stringify(candidate.addresses) === JSON.stringify(plan.core.addresses), 'CANDIDATE_ADDRESS_MISMATCH');
  fail(candidate.pairKey === plan.core.pair.pairKey, 'CANDIDATE_PAIR_MISMATCH');
  fail(candidate.finalState?.allSevenAddressesHaveCode === true, 'CANDIDATE_CODE_PROOF_MISSING');
  fail(candidate.finalState?.allSevenRuntimesMatchAtCurrentAndFiveDeepBlocks === true, 'CANDIDATE_RUNTIME_PROOF_MISSING');
  fail(candidate.finalState?.pairRegisteredAtRevisionZero === true, 'CANDIDATE_PAIR_PROOF_MISSING');
  fail(COMPONENT_KEYS.every((key) => candidate.finalState?.runtimeHashes?.[key]), 'CANDIDATE_RUNTIME_SET_INCOMPLETE');
};

const validateReport = (report, reportHash, plan, activationPlan, candidate) => {
  fail(report?.schemaVersion === 1, 'ACTIVATION_REPORT_SCHEMA_MISMATCH');
  fail(report?.result === 'pass', 'ACTIVATION_REPORT_NOT_PASS');
  fail(report?.productionActivationEvidence === false, 'ACTIVATION_REPORT_BOUNDARY_MISMATCH');
  fail(report?.activationPlanHash === activationPlan.planHash, 'ACTIVATION_REPORT_PLAN_MISMATCH');
  fail(report?.deploymentPlanHash === plan.planHash, 'ACTIVATION_REPORT_DEPLOYMENT_PLAN_MISMATCH');
  fail(report?.deploymentCandidateHash === candidate.candidateHash, 'ACTIVATION_REPORT_CANDIDATE_MISMATCH');
  fail(report?.observations?.length === 16, 'ACTIVATION_REPORT_TRANSACTION_COUNT_MISMATCH');
  fail(report?.routeMetrics?.measuredRouteCount === 4, 'ACTIVATION_REPORT_ROUTE_COUNT_MISMATCH');
  fail(report.routeMetrics.gasP95Passed === true, 'ACTIVATION_REPORT_P95_GAS_FAILED');
  fail(report.routeMetrics.gasMaximumPassed === true, 'ACTIVATION_REPORT_MAX_GAS_FAILED');
  fail(report.routeMetrics.receiptLatencyP95Passed === true, 'ACTIVATION_REPORT_LATENCY_FAILED');
  fail(isRecord(report.proves) && Object.keys(report.proves).length > 0 &&
    Object.values(report.proves).every((value) => value === true), 'ACTIVATION_REPORT_PROOFS_INCOMPLETE');
  fail(report?.terminalAttestation && Number.isSafeInteger(report.terminalAttestation.blockNumber), 'ACTIVATION_TERMINAL_ATTESTATION_MISSING');
  hash(reportHash, 'ACTIVATION_REPORT_HASH_INVALID');
};

export const buildDexV2AppManifest = ({
  deploymentPlan,
  candidate,
  activationPlan,
  activationReport,
  activationReportHash
}) => {
  validatePlan(deploymentPlan);
  validateCandidate(candidate, deploymentPlan);
  validateActivationPlan(activationPlan, deploymentPlan, candidate);
  validateReport(activationReport, activationReportHash, deploymentPlan, activationPlan, candidate);

  const factory = transaction(candidate, 'factoryDeployment');
  const economicSuite = transaction(candidate, 'atomicDeployment');
  const pairRegistration = transaction(candidate, 'pairRegistration');
  const body = {
    schemaVersion: 1,
    status: 'activated-testnet',
    network: 'cotiTestnet',
    chainId: '7082400',
    productionActivationEvidence: false,
    operator: deploymentPlan.core.operator,
    owner: deploymentPlan.core.owner,
    deploymentPlanHash: deploymentPlan.planHash,
    deploymentCandidateHash: candidate.candidateHash,
    activationPlanHash: activationPlan.planHash,
    activationReportHash: activationReportHash.toLowerCase(),
    addresses: Object.fromEntries(COMPONENT_KEYS.map((key) => [key, candidate.addresses[key]])),
    runtimeHashes: Object.fromEntries(COMPONENT_KEYS.map((key) => [key, candidate.finalState.runtimeHashes[key]])),
    deploymentAnchors: {
      factory: { number: String(factory.blockNumber), hash: factory.blockHash },
      economicSuite: { number: String(economicSuite.blockNumber), hash: economicSuite.blockHash },
      pairRegistration: { number: String(pairRegistration.blockNumber), hash: pairRegistration.blockHash }
    },
    pair: {
      pairKey: deploymentPlan.core.pair.pairKey,
      baseToken: deploymentPlan.core.pair.baseToken,
      quoteToken: deploymentPlan.core.pair.quoteToken,
      baseTokenRuntimeHash: deploymentPlan.core.pair.baseTokenRuntimeHash,
      quoteTokenRuntimeHash: deploymentPlan.core.pair.quoteTokenRuntimeHash,
      privateTokenRuntimeManifestHash: deploymentPlan.core.pair.privateTokenRuntimeManifestHash,
      privateTokenRuntimeManifestLength: deploymentPlan.core.pair.admissiblePrivateTokenRuntimeHashes.length,
      baseDecimals: deploymentPlan.core.pair.baseDecimals,
      quoteDecimals: deploymentPlan.core.pair.quoteDecimals,
      baseLotSize: decimal(deploymentPlan.core.pair.baseLotSize, 'BASE_LOT_SIZE_INVALID'),
      quoteLotSize: decimal(deploymentPlan.core.pair.quoteLotSize, 'QUOTE_LOT_SIZE_INVALID'),
      maximumAggregateLots: decimal(deploymentPlan.core.pair.maximumAggregateLots, 'MAXIMUM_AGGREGATE_LOTS_INVALID'),
      tickTableHash: deploymentPlan.core.pair.tickTableHash
    },
    activation: {
      result: 'pass',
      transactionCount: 16,
      measuredRouteCount: 4,
      finalBlock: {
        number: String(activationReport.terminalAttestation.blockNumber),
        hash: activationReport.terminalAttestation.blockHash
      },
      allProofsPassed: true,
      routeGasP95Passed: true,
      routeGasMaximumPassed: true,
      routeLatencyP95Passed: true
    }
  };
  return Object.freeze({ ...body, manifestHash: hashCanonicalDexV2Json(body) });
};

export const publishDexV2AppManifest = (manifest, outputPath) => {
  fail(!existsSync(outputPath), 'DEX_V2_APP_MANIFEST_ALREADY_EXISTS');
  mkdirSync(dirname(outputPath), { recursive: true });
  const descriptor = openSync(outputPath, 'wx', 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

const readJson = (path, code) => {
  fail(existsSync(path), code);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${code}_INVALID_JSON`);
  }
};

export const prepareDexV2AppManifest = ({ appRoot, contractsRoot }) => {
  const deploymentPlanPath = resolve(contractsRoot, 'deployments/coti-testnet-dex-v2-performance-rerun-1-reviewed-plan.json');
  const candidatePath = resolve(contractsRoot, 'deployments/coti-testnet-dex-v2-performance-rerun-1-candidate.json');
  const activationPlanPath = resolve(contractsRoot, 'deployments/coti-testnet-dex-v2-performance-rerun-1-reviewed-activation-plan.json');
  const activationReportPath = resolve(contractsRoot, 'deployments/coti-testnet-dex-v2-performance-rerun-1-activation-report.json');
  const reportBytes = existsSync(activationReportPath) ? readFileSync(activationReportPath) : null;
  fail(reportBytes, 'ACTIVATION_REPORT_MISSING');
  const manifest = buildDexV2AppManifest({
    deploymentPlan: readJson(deploymentPlanPath, 'DEPLOYMENT_PLAN_MISSING'),
    candidate: readJson(candidatePath, 'CANDIDATE_MISSING'),
    activationPlan: readJson(activationPlanPath, 'ACTIVATION_PLAN_MISSING'),
    activationReport: readJson(activationReportPath, 'ACTIVATION_REPORT_MISSING'),
    activationReportHash: keccak256(reportBytes).toLowerCase()
  });
  const outputPath = resolve(appRoot, DEX_V2_APP_MANIFEST_PATH);
  publishDexV2AppManifest(manifest, outputPath);
  return Object.freeze({ manifest, outputPath });
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const contractsRoot = resolve(appRoot, '..', 'ChainWhisper Contracts');
    const { manifest, outputPath } = prepareDexV2AppManifest({ appRoot, contractsRoot });
    process.stdout.write(`${JSON.stringify({
      checkpoint: 'chainwhisper-dex-v2-app-manifest-published',
      manifestHash: manifest.manifestHash,
      activationReportHash: manifest.activationReportHash,
      outputPath,
      networkAccessed: false,
      transactionSigned: false,
      transactionBroadcast: false
    })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      checkpoint: 'chainwhisper-dex-v2-app-manifest-not-published',
      code: error instanceof Error ? error.message : 'DEX_V2_APP_MANIFEST_PREPARATION_FAILED',
      networkAccessed: false,
      transactionSigned: false,
      transactionBroadcast: false
    })}\n`);
    process.exitCode = 1;
  }
}
