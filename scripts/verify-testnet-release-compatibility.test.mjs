import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

import { computeActionRuntimeCatalogV2Hash } from '../../MCP/dist/shared/index.js';
import {
  RELEASE_COMPATIBILITY_PATHS,
  buildTestnetReleaseCompatibilityMatrix,
  loadTestnetReleaseCompatibilityInputs,
  verifyAndWriteTestnetReleaseCompatibility
} from './verify-testnet-release-compatibility.mjs';

const inputs = await loadTestnetReleaseCompatibilityInputs();

test('builds one exact cross-layer matrix from the current reviewed artifacts', () => {
  const report = buildTestnetReleaseCompatibilityMatrix(inputs);
  assert.match(report, /15\/15 exact components/u);
  assert.match(report, /APP \| Embedded candidate manifest \| Exact hash\/chain\/RPC\/finality match/u);
  assert.match(report, /Supabase images .* ABI exact/u);
  assert.match(report, /Daily-price chart .* exactly manifest-bound/u);
  assert.match(report, /Record the first finalized UTC close/u);
  assert.match(report, /Remote values are deliberately reported as unverified/u);
});

test('rejects a freshly sealed MCP catalog that drifts from one candidate runtime', () => {
  const catalog = JSON.parse(inputs.catalogText);
  const first = catalog.body.contracts[0];
  const second = catalog.body.contracts[1];
  [first.address, second.address] = [second.address, first.address];
  catalog.manifestHash = computeActionRuntimeCatalogV2Hash(catalog.body);
  assert.throws(
    () => buildTestnetReleaseCompatibilityMatrix({
      ...inputs,
      catalogText: JSON.stringify(catalog)
    }),
    /MCP catalog drifted/u
  );
});

test('rejects a stale or missing APP candidate projection', () => {
  assert.throws(
    () => buildTestnetReleaseCompatibilityMatrix({
      ...inputs,
      appEnvText: inputs.appEnvText.replace(
        /VITE_CHAINWHISPER_TESTNET_CANDIDATE_MANIFEST=.*$/mu,
        "VITE_CHAINWHISPER_TESTNET_CANDIDATE_MANIFEST='{}'"
      )
    }),
    /candidate manifest|candidate identity/iu
  );
});

test('rejects an APP daily-price projection that drifts from the attested Store', () => {
  assert.throws(
    () => buildTestnetReleaseCompatibilityMatrix({
      ...inputs,
      appEnvText: inputs.appEnvText.replace(
        /VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_ADDRESS=.*$/mu,
        'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_ADDRESS=0x1111111111111111111111111111111111111111'
      )
    }),
    /analytics projection drifted/u
  );
});

test('rejects Supabase selector drift and embedded candidate addresses', () => {
  assert.throws(
    () => buildTestnetReleaseCompatibilityMatrix({
      ...inputs,
      supabaseConfirmSource: inputs.supabaseConfirmSource.replace('0x9c37c00d', '0x11111111')
    }),
    /selectors\/topics drifted/u
  );
  const candidate = JSON.parse(inputs.candidateText);
  const direct = candidate.components.find(({ key }) => key === 'directChatV2');
  assert.ok(direct);
  assert.throws(
    () => buildTestnetReleaseCompatibilityMatrix({
      ...inputs,
      supabaseConfirmSource: `${inputs.supabaseConfirmSource}\n// ${direct.address}`
    }),
    /must not embed candidate addresses/u
  );
});

test('rejects a Worker source that embeds a current component address', () => {
  const candidate = JSON.parse(inputs.candidateText);
  assert.throws(
    () => buildTestnetReleaseCompatibilityMatrix({
      ...inputs,
      workerIndexSource: `${inputs.workerIndexSource}\n// ${candidate.components[0].address}`
    }),
    /Worker\/API embeds the current/u
  );
});

test('does not rewrite an unchanged compatibility matrix', async () => {
  const output = await verifyAndWriteTestnetReleaseCompatibility();
  assert.equal(output, RELEASE_COMPATIBILITY_PATHS.output);
  const before = await stat(output);
  await verifyAndWriteTestnetReleaseCompatibility();
  const after = await stat(output);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(
    await readFile(output, 'utf8'),
    buildTestnetReleaseCompatibilityMatrix(await loadTestnetReleaseCompatibilityInputs())
  );
});

test('runs the compatibility gate after Contracts, MCP, and APP candidate generation', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const command = packageJson.scripts['refresh:testnet-suite'];
  const contracts = command.indexOf('generate:testnet-candidate');
  const mcp = command.indexOf('generate:testnet-runtime-catalog');
  const app = command.indexOf('prepare-testnet-candidate-mode.mjs');
  const compatibility = command.indexOf('verify:testnet-compatibility');
  assert.ok(contracts >= 0 && mcp > contracts && app > mcp && compatibility > app);
  assert.equal(command.includes('deploy'), false);
  assert.equal(command.includes('wrangler'), false);
});
