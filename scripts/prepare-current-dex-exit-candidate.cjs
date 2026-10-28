/* global require, module, __dirname, process, console, fetch, AbortSignal */
/* eslint-disable @typescript-eslint/no-require-imports -- Offline frozen CJS readers. */
'use strict';
// Public binding only. No credentials, signer, private input or send API.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const prepared = require('./prepare-current-dex-prepared-candidate.cjs');
const validation = path.resolve(__dirname, '../../ChainWhisper Contracts V2/validation');
const root = path.join(validation, 'candidates/shared-core-exit-preview-native-2026-10-07');
const report = path.resolve(__dirname, '../reports/exit-candidate-2026-10-07');
const candidate = require(path.join(root, 'candidate.cjs'));
const native = require(path.join(root, 'native-deployment.cjs'));
const { runtimeFor } = require(path.join(validation, 'candidates/core-advance-boundary-2026-10-06/runtime.cjs'));
const { Interface } = createRequire(path.join(validation, 'package.json'))('ethers');
const GRAPH = 'b2aa0895d7661a43e3a7db85c9ae24daaa641db238a06bec5c64d031dcf382cd';
const PACKAGE = 'b79db02d2a1c89c94c2f9e1cadbb3f2dc2c34113fea5ad8261e7d8ae57835a56';
const CORE = '0x52d5D2acC60Ada57A7316de996221766BAffFe27';
const RPC = 'https://testnet.coti.io/rpc';
const SCHEMA = 'EXIT_PREVIEW_APP_PUBLIC_BINDING_V1';
const EXPORT_NAME = 'STAGED_EXIT_PREVIEW_DEX_CANDIDATE';
const sha = value => createHash('sha256').update(value).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const same = (a, b, label) => assert.equal(String(a).toLowerCase(), String(b).toLowerCase(), label);
const hashFile = file => sha(fs.readFileSync(file));

function terminal(file) {
  const result = json(file);
  assert.equal(result.status, 'completed', 'EXIT_TERMINAL_STATUS');
  assert.equal(result.exitCode, 0, 'EXIT_TERMINAL_EXIT');
  assert.equal(result.signal, null, 'EXIT_TERMINAL_SIGNAL');
}

function constructorBindings(pkg, rows) {
  assert.equal(pkg.calls.length, 44, 'EXIT_CONSTRUCTOR_COUNT');
  const verified = rows.filter(row => row.kind === 'verified');
  assert.equal(verified.length, 44, 'EXIT_VERIFIED_COUNT');
  const runtimes = pkg.calls.map(row => {
    const matches = verified.filter(v => v.index === row.index);
    assert.equal(matches.length, 1, 'EXIT_CONSTRUCTOR_UNIQUE');
    const v = matches[0];
    assert.equal(v.status, 1, 'EXIT_CONSTRUCTOR_STATUS');
    assert.equal(v.packageSha256, PACKAGE, 'EXIT_CONSTRUCTOR_PACKAGE');
    assert.equal(v.graph, GRAPH, 'EXIT_CONSTRUCTOR_GRAPH');
    same(v.address, row.predictedAddress, 'EXIT_CONSTRUCTOR_ADDRESS');
    assert.match(v.runtimeHash, /^0x[0-9a-fA-F]{64}$/, 'EXIT_CONSTRUCTOR_RUNTIME');
    return [row.name, String(v.address).toLowerCase(), v.runtimeHash];
  });
  return { verified, runtimes };
}

function baseInputs() {
  assert.equal(candidate.pins.graph, GRAPH, 'EXIT_GRAPH');
  // These maintained exports reproduce the exact package and check source,
  // artifact, ABI, admission and toolchain identities. They do not use RPC.
  native.localChecks();
  const { pkg } = native.admit(true), frozen = candidate.frozen();
  assert.equal(sha(JSON.stringify(pkg)), PACKAGE, 'EXIT_PACKAGE_DRIFT');
  same(pkg.expectedCore, CORE, 'EXIT_CORE');
  assert.equal(pkg.artifactGraphSha256, GRAPH, 'EXIT_PACKAGE_GRAPH');
  assert.equal(pkg.tokenAddresses.length, 4, 'EXIT_FOUR_TOKENS');
  assert.equal(pkg.tokenRuntimeHashes.length, 4, 'EXIT_FOUR_TOKEN_RUNTIMES');
  const journalFile = path.join(root, 'native-deployment-1/journal.jsonl');
  const journalRaw = fs.readFileSync(journalFile, 'utf8');
  assert(journalRaw.endsWith('\n'), 'EXIT_JOURNAL_TRUNCATED');
  const { verified, runtimes } = constructorBindings(pkg, journalRaw.trim().split(/\r?\n/).map(JSON.parse));
  const deployment = json(path.join(root, 'FINAL_RECONCILIATION.json'));
  assert.equal(deployment.status, 'EXIT_PREVIEW_DEPLOYMENT_INDEPENDENTLY_RECONCILED');
  assert.equal(deployment.graph, GRAPH); same(deployment.core, CORE, 'EXIT_RECONCILIATION_CORE');
  assert.equal(deployment.count, 44); assert.equal(deployment.noPending, true);
  assert.equal(deployment.journalSha256, sha(journalRaw), 'EXIT_RECONCILIATION_JOURNAL');
  assert.equal(deployment.deploymentResultSha256, hashFile(path.join(root, 'native-deployment-1/RESULT.json')), 'EXIT_DEPLOYMENT_RESULT');
  assert.deepEqual(deployment.sourcePins, { ...native.sourcePins(), finalReaderSha256: hashFile(path.join(root, 'deployment-final-read.cjs')) }, 'EXIT_DEPLOYMENT_SOURCE_PINS');
  assert.deepEqual(deployment.supportPins, native.supportPins(), 'EXIT_DEPLOYMENT_SUPPORT_PINS');
  terminal(path.join(root, 'final-read-1/result.json'));
  const exit = json(path.join(root, 'exit-flow/FINAL_RECONCILIATION.json'));
  assert.equal(exit.status, 'EXACT_PRIVATE_EXIT_INDEPENDENTLY_RECONCILED');
  assert.equal(exit.graph, GRAPH); same(exit.core, CORE, 'EXIT_FLOW_CORE');
  for (const name of ['noPending', 'exactWalletReturn', 'zeroAllowances', 'nftBurned', 'oldStateProtected', 'noSign', 'noSend', 'connectedAppWalletHeld']) assert.equal(exit[name], true, 'EXIT_FLOW_' + name);
  for (const name of ['privateValuesPrinted', 'globalSystemCiphertextDecrypted']) assert.equal(exit[name], false, 'EXIT_FLOW_' + name);
  const exitSourcePins = path.join(root, 'exit-flow/ROOT_SOURCE_PINS.json');
  assert.equal(hashFile(exitSourcePins), 'f8eac7bba29966461738292711d6a09ef9af6da0c45180a9c413972be6c03799', 'EXIT_FLOW_SOURCE_PINS');
  for (const [name, hash] of Object.entries(json(exitSourcePins))) assert.equal(hashFile(path.resolve(root, 'exit-flow', name)), hash, 'EXIT_FLOW_SOURCE_DRIFT');
  assert.equal(exit.readerSha256, hashFile(path.join(root, 'exit-final-read.cjs')), 'EXIT_FLOW_FINAL_READER');
  assert.equal(exit.journalSha256, hashFile(path.join(root, 'exit-flow/native-2/journal.jsonl')), 'EXIT_FLOW_JOURNAL');
  terminal(path.join(root, 'exit-flow/final-read-1/result.json'));
  const factory = pkg.calls.find(row => row.name === 'ChainWhisperFixedEngineFactory');
  const factoryStorage = [0, 1, 2, 8].map((arg, index) => [String([5, 6, 7, 10][index]), '0x' + BigInt(factory.args[arg]).toString(16).padStart(64, '0')]);
  const stagesSource = frozen.info.input.sources['contracts/dex/ChainWhisperDexCheapAsyncTypes.sol'].content;
  assert.match(stagesSource, /enum Stage\s*\{\s*NONE, POOL_BASELINE, TWO_POOL, LIMIT_FIRST, LIMIT_SECOND, READY, FUNDED, SETTLED, RELEASED\s*\}/, 'EXIT_STAGES_DRIFT');
  const api = name => new Interface(frozen.artifacts[name].abi);
  const quote = api('ChainWhisperDexCore').getFunction('quoteCheapAsync');
  assert(quote, 'EXIT_QUOTE_ABI');
  return { frozen, pkg, verified, runtimes, factory, factoryStorage, api, runtime: runtimeFor(frozen, pkg),
    minimumBlock: String(exit.blockNumber),
    protocol: { name: 'quote-slippage', stages: { workCalls: 4, ready: 5, funded: 6, settled: 7, released: 8 },
      coreAbiSha256: sha(JSON.stringify(frozen.artifacts.ChainWhisperDexCore.abi)), quoteSignature: quote.format('sighash'), stagesSourceSha256: sha(stagesSource) } };
}

function inputs() {
  const input = baseInputs();
  const assembly = path.resolve(__dirname, '../reports/prepared-candidate-2026-10-07/engine-assembly.json');
  return { ...input, embedded: prepared.verifyEmbedded(json(assembly), input, GRAPH) };
}

// The final seed evidence is a separate prerequisite. An offline Engine proof
// or a successful deployment cannot satisfy this gate.
function seedInputs(input) {
  const file = path.join(root, 'seed-beta/FINAL_RECONCILIATION.json');
  assert(fs.existsSync(file), 'EXIT_SIX_MARKET_SEED_RECONCILIATION_REQUIRED');
  const seed = json(file);
  verifySeedIdentity(seed, input);
  const folder = path.join(root, 'seed-beta');
  const fixture = require(path.join(folder, 'fixture.cjs'));
  const reader = require(path.join(folder, 'reader.cjs'));
  const pp = require(path.join(validation, 'candidates/c1-shared-integration-2026-10-05/native-fixture/pp-trial.cjs'));
  const manifest = json(path.join(folder, 'native-1/manifest.json'));
  const saved = reader.saved();
  assert.equal(seed.manifestSha256, fixture.validateManifest(manifest, saved, { fresh: false }), 'EXIT_SEED_MANIFEST');
  assert.equal(manifest.packageSha256, PACKAGE, 'EXIT_SEED_PACKAGE');
  const journal = fs.readFileSync(path.join(folder, 'native-1/journal.jsonl'));
  assert.equal(journal.at(-1), 10, 'EXIT_SEED_JOURNAL_TRUNCATED');
  assert.equal(seed.journalSha256, sha(journal), 'EXIT_SEED_JOURNAL');
  const progress = pp.prefix(journal.toString().trim().split(/\r?\n/).map(JSON.parse), manifest, fixture.steps);
  assert.equal(progress.done.length, 22, 'EXIT_SEED_VERIFIED_ACTIONS');
  assert.equal(progress.pending, null, 'EXIT_SEED_PENDING_SEND');
  assert.equal(seed.finalModelSealSha256, pp.digest(progress.done.at(-1).afterSeal), 'EXIT_SEED_FINAL_SEAL');
  assert.deepEqual(seed.actions.map(row => [row.action, row.hash]), progress.done.map(row => [row.action, row.hash]), 'EXIT_SEED_ACTION_BINDING');
  const result = json(path.join(folder, 'native-1/RESULT.json'));
  assert.equal(result.status, 'SIX_MARKET_BETA_SEED_NATIVE', 'EXIT_SEED_NATIVE_STATUS');
  assert.equal(result.graph, GRAPH); same(result.core, CORE, 'EXIT_SEED_NATIVE_CORE');
  assert.equal(result.actions, 22); assert.equal(result.noPending, true);
  terminal(path.join(folder, 'native-run-1/result.json'));
  terminal(path.join(folder, 'final-read-1/result.json'));
  return { ...input, minimumBlock: String(seed.blockNumber) };
}

function verifySeedIdentity(seed, input) {
  assert.equal(seed.status, 'SIX_BETA_SEED_MARKETS_INDEPENDENTLY_RECONCILED', 'EXIT_SEED_STATUS');
  assert.equal(seed.graph, GRAPH, 'EXIT_SEED_GRAPH');
  same(seed.core, CORE, 'EXIT_SEED_CORE');
  for (const name of ['exactSixCanonicalMarkets', 'exactPrivateWalletAndPoolSnapshots', 'exactProtectedOldState', 'closedClaim8Retained', 'zeroAllowances', 'noPending', 'noSign', 'noSend', 'connectedAppWalletHeld', 'noBetaAcceptance']) assert.equal(seed[name], true, 'EXIT_SEED_' + name);
  assert.equal(seed.globalSystemCiphertextDecrypted, false, 'EXIT_SEED_GLOBAL_DECRYPTION');
  assert.equal(seed.actions.length, 22, 'EXIT_SEED_ACTION_COUNT');
  assert.equal(new Set(seed.actions.map(row => row.hash)).size, 22, 'EXIT_SEED_UNIQUE_ACTIONS');
  assert.equal(seed.actorChecks.length, 6, 'EXIT_SEED_ACTOR_COUNT');
  assert(seed.actorChecks.every(row => row.exact === true), 'EXIT_SEED_ACTOR_ACCOUNTING');
  assert.deepEqual(seed.poolIds, [9, 17, 25, 33, 41, 49], 'EXIT_SEED_POOL_IDS');
  assert(BigInt(seed.blockNumber) >= BigInt(input.minimumBlock), 'EXIT_SEED_BEFORE_EXIT');
}

async function collect(rpc, input) {
  const data = await prepared.collect(rpc, input, PACKAGE);
  return { ...data, nativeScope: { sixMarketPublicBinding: true, fullFixtureAdmission: false, connectedAppWalletHeld: true, noBetaAcceptance: true } };
}

function render(data) {
  assert.equal(data.graph, GRAPH, 'EXIT_RENDER_GRAPH');
  assert.equal(data.packageSha256, PACKAGE, 'EXIT_RENDER_PACKAGE');
  assert.equal(data.readyToSign, false, 'EXIT_RENDER_SIGNING');
  assert.equal(data.tokens.length, 4, 'EXIT_RENDER_TOKENS');
  assert.equal(data.pairs.length, 6, 'EXIT_RENDER_PAIRS');
  return prepared.render(data, EXPORT_NAME);
}

async function main(mode, output, emitTarget) {
  assert(['--check-inputs', '--capture', '--check', '--emit'].includes(mode), 'EXIT_MODE');
  const offline = inputs();
  if (mode === '--check-inputs') return { status: 'EXIT_PUBLIC_INPUTS_VERIFIED', graph: GRAPH, packageSha256: PACKAGE, core: CORE, constructors: offline.verified.length, embeddedGraph: offline.embedded.graph, noNetwork: true, readyToSign: false };
  assert(output, 'EXIT_CAPTURE_PATH_REQUIRED');
  const input = seedInputs(offline);
  if (mode === '--emit') {
    assert(emitTarget, 'EXIT_EXPLICIT_NEW_EMIT_TARGET_REQUIRED');
    assert(!fs.existsSync(emitTarget), 'EXIT_EMIT_TARGET_EXISTS');
    assert(path.extname(emitTarget) === '.ts', 'EXIT_EMIT_TARGET_TYPESCRIPT');
  }
  const capture = mode === '--capture' ? { schema: SCHEMA, destination: RPC, graph: GRAPH, packageSha256: PACKAGE, reads: [] } : json(output);
  assert.equal(capture.schema, SCHEMA); assert.equal(capture.destination, RPC);
  assert.equal(capture.graph, GRAPH); assert.equal(capture.packageSha256, PACKAGE);
  assert(Array.isArray(capture.reads), 'EXIT_CAPTURE_READS');
  const saved = new Map(), cache = new Map(), cursors = new Map();
  for (const row of capture.reads) {
    const key = JSON.stringify([row.method, row.params]);
    if (!saved.has(key)) saved.set(key, []);
    saved.get(key).push(row.result);
  }
  let count = 0; const started = Date.now();
  const rpc = async (method, params) => {
    assert(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getStorageAt', 'eth_call'].includes(method), 'EXIT_PUBLIC_METHOD_ONLY');
    assert(++count <= 350 && Date.now() - started < 12 * 60000, 'EXIT_PUBLIC_READ_BOUND');
    const key = JSON.stringify([method, params]);
    const reusable = !['eth_chainId', 'eth_getBlockByNumber'].includes(method);
    if (reusable) {
      const tag = params[method === 'eth_getStorageAt' ? 2 : 1];
      assert.equal(tag?.requireCanonical, true, 'EXIT_CANONICAL_READ_ONLY');
      assert.match(tag?.blockHash ?? '', /^0x[0-9a-fA-F]{64}$/, 'EXIT_CANONICAL_HASH');
      if (cache.has(key)) return cache.get(key);
    }
    if (mode !== '--capture') {
      const cursor = cursors.get(key) ?? 0, rows = saved.get(key);
      assert(rows && cursor < rows.length, 'EXIT_MISSING_CAPTURED_READ');
      const value = rows[cursor]; cursors.set(key, cursor + 1);
      if (reusable) cache.set(key, value); return value;
    }
    const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: count, method, params }), signal: AbortSignal.timeout(15000) });
    assert(response.ok, 'EXIT_PUBLIC_RPC_HTTP'); const body = await response.json();
    assert(!body.error, 'EXIT_PUBLIC_RPC_ERROR'); assert(Object.hasOwn(body, 'result'));
    capture.reads.push({ method, params, result: body.result });
    if (reusable) cache.set(key, body.result); return body.result;
  };
  let data;
  try { data = await collect(rpc, input); }
  finally { if (mode === '--capture') fs.writeFileSync(output, JSON.stringify(capture, null, 2) + '\n'); }
  data.attestationSha256 = hashFile(output);
  if (mode === '--emit') fs.writeFileSync(emitTarget, render(data), { flag: 'wx' });
  return { status: 'EXIT_PUBLIC_BINDING_VERIFIED', reads: count, data };
}
module.exports = { baseInputs, inputs, seedInputs, verifySeedIdentity, constructorBindings, collect, render, main, GRAPH, PACKAGE, CORE, SCHEMA, EXPORT_NAME, report };
if (require.main === module) main(process.argv[2], process.argv[3], process.argv[4]).then(value => console.log(JSON.stringify(value)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
