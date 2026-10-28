import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, keccak256 } from '@coti-io/coti-ethers';
import {
  DEX_V2_ACTIVATION_PLAN_DOMAIN,
  DEX_V2_CANDIDATE_DOMAIN,
  DEX_V2_DEPLOYMENT_PLAN_DOMAIN,
  buildDexV2AppManifest,
  hashCanonicalDexV2Json,
  publishDexV2AppManifest
} from './prepare-dex-v2-testnet-manifest.mjs';

const address = (byte) => `0x${byte.toString(16).padStart(2, '0').repeat(20)}`;
const hash = (byte) => `0x${byte.toString(16).padStart(2, '0').repeat(32)}`;
const pairKey = (baseToken, quoteToken) =>
  keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'address'], [baseToken, quoteToken])).toLowerCase();
const keys = ['factory', 'pool', 'limit', 'recurring', 'swap', 'core', 'positionToken'];

const fixtures = () => {
  const addresses = Object.fromEntries(keys.map((key, index) => [key, address(index + 1)]));
  const runtimeHashes = Object.fromEntries(keys.map((key, index) => [key, hash(index + 1)]));
  const deploymentCore = {
    chainId: '7082400',
    operator: address(59),
    owner: address(60),
    addresses,
    pair: {
      baseToken: address(40),
      quoteToken: address(41),
      pairKey: pairKey(address(40), address(41)),
      baseTokenRuntimeHash: hash(31),
      quoteTokenRuntimeHash: hash(31),
      privateTokenRuntimeManifestHash: hash(32),
      admissiblePrivateTokenRuntimeHashes: [hash(31)],
      baseDecimals: 6,
      quoteDecimals: 6,
      baseLotSize: '100',
      quoteLotSize: '100',
      maximumAggregateLots: '2000000',
      tickTableHash: hash(33)
    },
    activationScenarioHash: hash(34)
  };
  const deploymentPlan = {
    schemaVersion: 2,
    suite: 'chainwhisper-dex-v2-discrete-bin-six-contract-coti-create-stride2-testnet',
    core: deploymentCore,
    planHash: hashCanonicalDexV2Json({ domain: DEX_V2_DEPLOYMENT_PLAN_DOMAIN, core: deploymentCore })
  };
  const candidateCore = {
    planHash: deploymentPlan.planHash,
    attemptHash: hash(35),
    addresses,
    pairKey: deploymentCore.pair.pairKey,
    activationScenarioHash: deploymentCore.activationScenarioHash,
    observations: [
      { name: 'factoryDeployment', blockNumber: 100, blockHash: hash(40) },
      { name: 'atomicDeployment', blockNumber: 105, blockHash: hash(41) },
      { name: 'pairRegistration', blockNumber: 110, blockHash: hash(42) }
    ],
    finalState: {
      allSevenAddressesHaveCode: true,
      allSevenRuntimesMatchAtCurrentAndFiveDeepBlocks: true,
      pairRegisteredAtRevisionZero: true,
      runtimeHashes
    },
    terminalNonce: '39'
  };
  const candidate = {
    schemaVersion: 1,
    checkpoint: 'chainwhisper-dex-v2-testnet-candidate',
    result: 'deployed-and-pair-registered-live-route-gate-pending',
    productionActivationEvidence: false,
    ...candidateCore,
    candidateHash: hashCanonicalDexV2Json({ domain: DEX_V2_CANDIDATE_DOMAIN, core: candidateCore })
  };
  const activationCore = {
    deploymentPlanHash: deploymentPlan.planHash,
    deploymentCandidateHash: candidate.candidateHash,
    orderedTransactions: Array.from({ length: 16 }, (_, index) => ({ index }))
  };
  const activationPlan = {
    schemaVersion: 1,
    core: activationCore,
    planHash: hashCanonicalDexV2Json({ domain: DEX_V2_ACTIVATION_PLAN_DOMAIN, core: activationCore })
  };
  const proves = Object.fromEntries(Array.from({ length: 13 }, (_, index) => [`proof${index}`, true]));
  const activationReport = {
    schemaVersion: 1,
    result: 'pass',
    productionActivationEvidence: false,
    activationPlanHash: activationPlan.planHash,
    deploymentPlanHash: deploymentPlan.planHash,
    deploymentCandidateHash: candidate.candidateHash,
    observations: Array.from({ length: 16 }, (_, index) => ({ index })),
    routeMetrics: {
      measuredRouteCount: 4,
      gasP95Passed: true,
      gasMaximumPassed: true,
      receiptLatencyP95Passed: true
    },
    proves,
    terminalAttestation: { blockNumber: 150, blockHash: hash(50) }
  };
  return { deploymentPlan, candidate, activationPlan, activationReport };
};

test('builds the compact app manifest only from a complete activation pass', () => {
  const input = fixtures();
  const manifest = buildDexV2AppManifest({ ...input, activationReportHash: hash(51) });
  assert.equal(manifest.status, 'activated-testnet');
  assert.equal(manifest.activation.transactionCount, 16);
  assert.equal(manifest.activation.finalBlock.number, '150');
  assert.equal(manifest.runtimeHashes.swap, input.candidate.finalState.runtimeHashes.swap);
  const { manifestHash, ...body } = manifest;
  assert.equal(manifestHash, hashCanonicalDexV2Json(body));
});

test('rejects report failures, incomplete proofs, plan drift, and candidate tampering', () => {
  {
    const input = fixtures();
    input.activationReport.result = 'semantic-pass-performance-incomplete';
    assert.throws(() => buildDexV2AppManifest({ ...input, activationReportHash: hash(51) }), /NOT_PASS/);
  }
  {
    const input = fixtures();
    input.activationReport.proves.proof4 = false;
    assert.throws(() => buildDexV2AppManifest({ ...input, activationReportHash: hash(51) }), /PROOFS_INCOMPLETE/);
  }
  {
    const input = fixtures();
    input.activationPlan.core.orderedTransactions.pop();
    input.activationPlan.planHash = hashCanonicalDexV2Json({
      domain: DEX_V2_ACTIVATION_PLAN_DOMAIN,
      core: input.activationPlan.core
    });
    input.activationReport.activationPlanHash = input.activationPlan.planHash;
    assert.throws(() => buildDexV2AppManifest({ ...input, activationReportHash: hash(51) }), /TRANSACTION_COUNT/);
  }
  {
    const input = fixtures();
    input.candidate.finalState.runtimeHashes.swap = hash(99);
    assert.throws(() => buildDexV2AppManifest({ ...input, activationReportHash: hash(51) }), /CANDIDATE_HASH_MISMATCH/);
  }
});

test('publishes with no-overwrite semantics', () => {
  const input = fixtures();
  const manifest = buildDexV2AppManifest({ ...input, activationReportHash: hash(51) });
  const directory = mkdtempSync(join(tmpdir(), 'chainwhisper-dex-v2-app-'));
  const output = join(directory, 'manifest.json');
  publishDexV2AppManifest(manifest, output);
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), manifest);
  assert.throws(() => publishDexV2AppManifest(manifest, output), /ALREADY_EXISTS/);
});
