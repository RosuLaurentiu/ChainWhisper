/* global require, __dirname, structuredClone */
/* eslint-disable @typescript-eslint/no-require-imports -- Offline CJS adapter tests. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const exit = require('./prepare-current-dex-exit-candidate.cjs');
const prepared = require('./prepare-current-dex-prepared-candidate.cjs');
const root = path.resolve(__dirname, '../../ChainWhisper Contracts V2/validation/candidates/shared-core-exit-preview-native-2026-10-07');
const sha = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

test('old saved capture replays with exact accepted data and rendered bytes', async () => {
  const folder = path.resolve(__dirname, '../reports/prepared-candidate-2026-10-07');
  const result = await prepared.main('--check', path.join(folder, 'public-capture-2.json'));
  assert.equal(JSON.stringify(result), fs.readFileSync(path.join(folder, 'public-capture-check-2/stdout.log'), 'utf8').trim());
  assert.equal(sha(prepared.render(result.data)), '9ce751ed6bf4717ec7c401c2590db97037ac34665eb30b3a61a79e465770a0a0');
  assert.equal(sha(fs.readFileSync(path.join(exit.report, 'history/prepare-current-dex-prepared-candidate.before.cjs'))), 'c8ac6e2c9c7be6241fd42c884b70f5b86499343813f75caead33b93d1c4a1f03');
});

test('exact derivative package, all 44 constructors and unchanged embedded assembly pass offline', async () => {
  const result = await exit.main('--check-inputs');
  assert.equal(result.graph, exit.GRAPH); assert.equal(result.packageSha256, exit.PACKAGE);
  assert.equal(result.constructors, 44); assert.equal(result.embeddedGraph, exit.GRAPH);
  assert.equal(result.noNetwork, true); assert.equal(result.readyToSign, false);
});

test('wrong constructor package, address, graph and missing constructor stop', () => {
  const pkg = read(path.join(root, 'native-deployment-1/package.json'));
  const original = fs.readFileSync(path.join(root, 'native-deployment-1/journal.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse).filter(row => row.kind === 'verified');
  for (const [key, value, guard] of [['packageSha256', '0'.repeat(64), 'EXIT_CONSTRUCTOR_PACKAGE'], ['address', '0x' + '0'.repeat(40), 'EXIT_CONSTRUCTOR_ADDRESS'], ['graph', '0'.repeat(64), 'EXIT_CONSTRUCTOR_GRAPH']]) {
    const rows = structuredClone(original); rows[0][key] = value;
    assert.throws(() => exit.constructorBindings(pkg, rows), new RegExp(guard));
  }
  assert.throws(() => exit.constructorBindings(pkg, original.slice(1)), /EXIT_VERIFIED_COUNT/);
});

test('wrong embedded Engine proof stops before public capture', () => {
  const input = exit.baseInputs();
  const output = read(path.resolve(__dirname, '../reports/prepared-candidate-2026-10-07/engine-assembly.json'));
  output.contracts[input.frozen.artifacts.ChainWhisperFixedEngine.sourceName].ChainWhisperFixedEngine.evm.bytecode.object = '00';
  assert.throws(() => prepared.verifyEmbedded(output, input, exit.GRAPH), /EXACT_ENGINE_CREATION/);
});

test('missing real six-market final evidence stops capture and creates no output', async () => {
  if (fs.existsSync(path.join(root, 'seed-beta/FINAL_RECONCILIATION.json'))) return;
  const target = path.join(exit.report, 'must-not-be-created.json');
  await assert.rejects(exit.main('--capture', target), /EXIT_SIX_MARKET_SEED_RECONCILIATION_REQUIRED/);
  assert.equal(fs.existsSync(target), false);
});

test('seed identity gate rejects wrong candidate, incomplete markets, pending and missing safety facts', () => {
  // Synthetic identity only. This does not satisfy seedInputs or native evidence.
  const seed = { status: 'SIX_BETA_SEED_MARKETS_INDEPENDENTLY_RECONCILED', graph: exit.GRAPH, core: exit.CORE, blockNumber: '9959670', poolIds: [9, 17, 25, 33, 41, 49],
    actions: Array.from({ length: 22 }, (_, i) => ({ hash: String(i) })), actorChecks: Array.from({ length: 6 }, () => ({ exact: true })), globalSystemCiphertextDecrypted: false };
  for (const name of ['exactSixCanonicalMarkets', 'exactPrivateWalletAndPoolSnapshots', 'exactProtectedOldState', 'closedClaim8Retained', 'zeroAllowances', 'noPending', 'noSign', 'noSend', 'connectedAppWalletHeld', 'noBetaAcceptance']) seed[name] = true;
  const input = { minimumBlock: '9959669' };
  exit.verifySeedIdentity(seed, input);
  for (const [key, value] of [['graph', prepared.GRAPH], ['core', '0x' + '0'.repeat(40)], ['noPending', false], ['exactSixCanonicalMarkets', false], ['zeroAllowances', undefined], ['blockNumber', '9959668'], ['poolIds', [9]], ['actions', seed.actions.slice(1)]]) {
    assert.throws(() => exit.verifySeedIdentity({ ...seed, [key]: value }, input));
  }
});

test('new export retains full market shape and refuses signing or wrong graph', () => {
  const data = { graph: exit.GRAPH, packageSha256: exit.PACKAGE, readyToSign: false, tokens: Array(4).fill(null), pairs: Array(6).fill(null) };
  assert.match(exit.render(data), /export const STAGED_EXIT_PREVIEW_DEX_CANDIDATE = freeze\(publicData\)/);
  for (const patch of [{ graph: prepared.GRAPH }, { readyToSign: true }, { tokens: [null, null] }, { pairs: [null] }]) assert.throws(() => exit.render({ ...data, ...patch }));
});
