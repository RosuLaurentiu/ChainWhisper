/* global require, module, __dirname, process, console, structuredClone, setTimeout, clearTimeout */
/* eslint-disable @typescript-eslint/no-require-imports -- Frozen CJS candidate readers. */
'use strict';
// Reuse the public six-market collector. This does not grant signing authority.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto'), { createRequire } = require('node:module');
const validation = path.resolve(__dirname, '../../ChainWhisper Contracts V2/validation');
const root = path.join(validation, 'candidates/limit-fill-history-shared-receipt-2026-10-13');
const report = path.resolve(__dirname, '../reports/shared-history-candidate-2026-10-13');
const candidate = require(path.join(root, 'candidate.cjs'));
const { deployments } = require(path.join(root, 'deployment-package.cjs'));
const deploymentAdapter = require(path.join(root, 'native-deployment.cjs'));
const deploymentBoundary = require(path.join(validation, 'candidates/shared-core-markets-2026-10-07/deployment-boundary.cjs'));
const { runtimeFor } = require(path.join(validation, 'candidates/core-advance-boundary-2026-10-06/runtime.cjs'));
const prepared = require('./prepare-current-dex-prepared-candidate.cjs');
const load = createRequire(path.join(validation, 'package.json'));
const { Interface, WebSocketProvider } = load('ethers');
const sha = value => createHash('sha256').update(value).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const endpoint = 'wss://testnet.coti.io/ws';
const schema = 'SHARED_HISTORY_APP_PUBLIC_BINDING_V1';
const GRAPH = '7b67bcbb7c5941a24471e62ba5a0d939c0800671b0bf121e81bad14cca737456';
const MANIFEST = '97a923dbca5a7a5d2c5f382b614162283c5ecf7f54dea3befb0c8dcc754fa44a';
const CORE = '0xaB5374daddeA783C3e58DE19DB497B54C79fD4cc';
const PACKAGE = '82c4673cd899f16d8be1bf29de9043b169b8dcc5e723daf5cc2aa0d1713d4f4a';
const DEPLOYMENT_FILES = Object.freeze({
  'package.json': '7baace47f999fe77361d1a52535972674fc5547383cc456b17dd4611e6de612c',
  'RESULT.json': '78243d9153c9e44aff06a7ca4a9428da8ebee129763aa4475e06c2073a398bf4',
  'journal.jsonl': 'a1d0011e5547ca38b6991a77584a921ab22f375a4133ec0c56ca06a8ccbafef5',
  'admission.json': '172ac21774cec4dbe956d7fb24c7dc404a91ffee49c0a1b203833d578e7147fc',
});

function verifyJournal(rows, pkg, sources) {
  const state = deploymentBoundary.historyState(rows, pkg, PACKAGE);
  assert.equal(state.verified, 44, 'SHARED_HISTORY_ALL_CONSTRUCTORS');
  assert.equal(state.pending, null, 'SHARED_HISTORY_PENDING_CONSTRUCTOR');
  assert(rows.every(row => Object.entries(sources).every(([key, value]) => row[key] === value)), 'SHARED_HISTORY_CONSTRUCTOR_SOURCES');
  const verified = rows.filter(row => row.kind === 'verified');
  for (const call of pkg.calls) {
    const matches = verified.filter(row => row.index === call.index);
    assert.equal(matches.length, 1, 'SHARED_HISTORY_CONSTRUCTOR_RECORD');
    assert.equal(matches[0].status, 1, 'SHARED_HISTORY_CONSTRUCTOR_STATUS');
    assert.equal(matches[0].address.toLowerCase(), call.predictedAddress.toLowerCase(), 'SHARED_HISTORY_CONSTRUCTOR_ADDRESS');
    assert(/^0x[0-9a-f]{64}$/i.test(matches[0].runtimeHash), 'SHARED_HISTORY_CONSTRUCTOR_RUNTIME_HASH');
  }
  return verified;
}

function baseInputs() {
  assert.equal(candidate.pins.graph, GRAPH, 'SHARED_HISTORY_GRAPH');
  assert.equal(candidate.pins.manifest, MANIFEST, 'SHARED_HISTORY_MANIFEST');
  const frozen = candidate.frozen(), deployment = path.join(root, 'native-deployment-1');
  for (const [name, hash] of Object.entries(DEPLOYMENT_FILES)) assert.equal(sha(fs.readFileSync(path.join(deployment, name))), hash, 'SHARED_HISTORY_DEPLOYMENT_DRIFT');
  const accepted = deploymentAdapter.admit(true), result = json(path.join(deployment, 'RESULT.json'));
  const pkg = json(path.join(deployment, 'package.json')), packageSha256 = sha(JSON.stringify(pkg));
  assert.deepEqual(pkg, accepted.pkg, 'SHARED_HISTORY_ADMITTED_PACKAGE');
  assert.equal(packageSha256, PACKAGE, 'SHARED_HISTORY_PACKAGE_BINDING');
  assert.equal(pkg.expectedCore, CORE, 'SHARED_HISTORY_CORE');
  assert.equal(result.status, 'SHARED_MARKETS_CONSTRUCTORS_VERIFIED');
  assert.equal(result.count, 44); assert.equal(result.noPending, true);
  assert.equal(result.graph, GRAPH); assert.equal(result.core, CORE);
  assert.equal(result.operationValidation, false); assert.equal(result.connectedAppWalletHold, true);
  assert.equal(result.public.additionalPairsRequireAtomicFunding, true);
  assert.deepEqual(deployments(json(path.join(deployment, 'base.json')), frozen), pkg, 'HISTORY_PACKAGE_REPRODUCTION');
  assert.equal(pkg.artifactGraphSha256, candidate.pins.graph, 'HISTORY_PACKAGE_GRAPH');
  const journal = fs.readFileSync(path.join(deployment, 'journal.jsonl'), 'utf8');
  assert(journal.endsWith('\n'), 'HISTORY_CONSTRUCTOR_JOURNAL_TRUNCATED');
  const verified = verifyJournal(journal.trim().split(/\r?\n/).map(JSON.parse), pkg, deploymentAdapter.sourcePins());
  assert.equal(pkg.calls.length, 44); assert.equal(verified.length, 44);
  const runtimes = pkg.calls.map(row => {
    const matches = verified.filter(value => value.index === row.index); assert.equal(matches.length, 1);
    const value = matches[0]; assert.equal(value.status, 1); assert.equal(value.packageSha256, packageSha256);
    assert.equal(value.address.toLowerCase(), row.predictedAddress.toLowerCase(), 'HISTORY_CONSTRUCTOR_ADDRESS');
    return [row.name, value.address.toLowerCase(), value.runtimeHash];
  });
  const factory = pkg.calls.find(row => row.name === 'ChainWhisperFixedEngineFactory');
  const factoryStorage = [0, 1, 2, 8].map((arg, index) => [String([5, 6, 7, 10][index]),
    '0x' + BigInt(factory.args[arg]).toString(16).padStart(64, '0')]);
  const api = name => new Interface(frozen.artifacts[name].abi);
  const source = frozen.info.input.sources['contracts/dex/ChainWhisperDexCheapAsyncTypes.sol'].content;
  assert.match(source, /enum Stage\s*\{\s*NONE, POOL_BASELINE, TWO_POOL, LIMIT_FIRST, LIMIT_SECOND, READY, FUNDED, SETTLED, RELEASED\s*\}/);
  const protocol = { name: 'quote-slippage', stages: { workCalls: 4, ready: 5, funded: 6, settled: 7, released: 8 },
    coreAbiSha256: sha(JSON.stringify(frozen.artifacts.ChainWhisperDexCore.abi)),
    quoteSignature: api('ChainWhisperDexCore').getFunction('quoteCheapAsync').format('sighash'), stagesSourceSha256: sha(source) };
  const storage = json(path.join(root, 'build-1/all-storage-checks.json'));
  for (const name of ['ChainWhisperDexCore', 'ChainWhisperFixedEngine']) assert.equal(storage[name].unchanged, true, 'SHARED_HISTORY_STORAGE');
  const abi = json(path.join(root, 'build-1/abi-changes.json'));
  for (const name of ['ChainWhisperDexCore', 'ChainWhisperFixedEngine']) assert.deepEqual(abi[name], { added: [], removed: [] }, 'SHARED_HISTORY_CALLER_ABI');
  return { frozen, pkg, packageSha256, verified, runtimes, factory, factoryStorage, api,
    runtime: runtimeFor(frozen, pkg), minimumBlock: result.public.blockNumber, protocol };
}

function inputs() {
  const input = baseInputs();
  return { ...input, embedded: prepared.verifyEmbedded(json(path.join(report, 'engine-assembly.json')), input, candidate.pins.graph) };
}

async function main(mode, output, emitTarget) {
  assert(['--prove-embedded', '--check-inputs', '--capture', '--check', '--emit'].includes(mode), 'HISTORY_PUBLIC_MODE');
  if (mode === '--prove-embedded') {
    const input = baseInputs(), request = structuredClone(input.frozen.info.input);
    const key = input.frozen.artifacts.ChainWhisperFixedEngine.sourceName;
    request.settings.outputSelection = { [key]: { ChainWhisperFixedEngine: ['evm.bytecode', 'evm.deployedBytecode', 'evm.legacyAssembly'] } };
    const native = require(path.join(validation, 'scripts/native-solc-019'));
    const compiled = JSON.parse(native.compile(request));
    assert.deepEqual((compiled.errors ?? []).filter(row => row.severity === 'error'), []);
    const proof = prepared.verifyEmbedded(compiled, input, candidate.pins.graph);
    fs.mkdirSync(report, { recursive: true });
    const file = path.join(report, 'engine-assembly.json'); assert(!fs.existsSync(file), 'HISTORY_ASSEMBLY_EXISTS');
    // Retain only the exact output consumed by the maintained verifier.
    const value = { contracts: { [key]: compiled.contracts[key] }, sources: compiled.sources };
    fs.writeFileSync(file, JSON.stringify(value) + '\n', { flag: 'wx' });
    return { status: 'HISTORY_EMBEDDED_PROOF_VERIFIED', graph: candidate.pins.graph, compiler: native.identity,
      outputSha256: sha(fs.readFileSync(file)), creationBytes: proof.creationBytes, noNetwork: true, readyToSign: false };
  }
  const input = inputs();
  if (mode === '--check-inputs') return { status: 'HISTORY_PUBLIC_INPUTS_VERIFIED', graph: candidate.pins.graph,
    core: input.pkg.expectedCore, packageSha256: input.packageSha256, constructors: input.verified.length,
    minimumBlock: input.minimumBlock, noNetwork: true, readyToSign: false, fullFixtureAdmission: false, connectedAppWalletHeld: true };
  assert(output, 'HISTORY_CAPTURE_PATH_REQUIRED');
  if (mode === '--capture') assert(!fs.existsSync(output), 'HISTORY_CAPTURE_EXISTS');
  if (mode === '--emit') assert(emitTarget && path.extname(emitTarget) === '.ts' && !fs.existsSync(emitTarget), 'HISTORY_NEW_EMIT_TARGET_REQUIRED');
  const capture = mode === '--capture' ? { schema, destination: endpoint, graph: candidate.pins.graph,
    packageSha256: input.packageSha256, reads: [] } : json(output);
  assert.equal(capture.schema, schema); assert.equal(capture.destination, endpoint);
  assert.equal(capture.graph, candidate.pins.graph); assert.equal(capture.packageSha256, input.packageSha256);
  assert(Array.isArray(capture.reads));
  const saved = new Map(), cursors = new Map(), cache = new Map();
  for (const row of capture.reads) {
    const key = JSON.stringify([row.method, row.params]); if (!saved.has(key)) saved.set(key, []);
    saved.get(key).push(row.result);
  }
  let count = 0, provider; const started = Date.now();
  const rpc = async (method, params) => {
    assert(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getStorageAt', 'eth_call'].includes(method), 'HISTORY_PUBLIC_READ_ONLY');
    assert(++count <= 350 && Date.now() - started < 12 * 60000, 'HISTORY_PUBLIC_READ_BOUND');
    const key = JSON.stringify([method, params]), reusable = !['eth_chainId', 'eth_getBlockByNumber'].includes(method);
    if (reusable && cache.has(key)) return cache.get(key);
    let value;
    if (mode !== '--capture') {
      const cursor = cursors.get(key) ?? 0, rows = saved.get(key);
      assert(rows && cursor < rows.length, 'HISTORY_CAPTURED_READ_REQUIRED');
      value = rows[cursor]; cursors.set(key, cursor + 1);
    } else {
      provider ??= new WebSocketProvider(endpoint, { chainId: 7082400, name: 'coti-testnet' }, { staticNetwork: true });
      let timer;
      try { value = await Promise.race([provider.send(method, params), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('HISTORY_PUBLIC_RPC_TIMEOUT')), 30000);
      })]); } finally { clearTimeout(timer); }
      capture.reads.push({ method, params, result: value });
    }
    if (reusable) cache.set(key, value); return value;
  };
  let data;
  try { data = await prepared.collect(rpc, input, input.packageSha256); }
  finally {
    if (provider) await provider.destroy();
    if (mode === '--capture') fs.writeFileSync(output, JSON.stringify(capture, null, 2) + '\n', { flag: 'wx' });
  }
  data = { ...data, attestationSha256: sha(fs.readFileSync(output)), nativeScope: {
    sixMarketPublicBinding: true, fullFixtureAdmission: false, connectedAppWalletHeld: true, noBetaAcceptance: true } };
  assert.equal(data.graph, candidate.pins.graph); assert.equal(data.readyToSign, false);
  assert.equal(data.tokens.length, 4); assert.equal(data.pairs.length, 6);
  if (mode === '--emit') fs.writeFileSync(emitTarget, prepared.render(data, 'STAGED_SHARED_HISTORY_DEX_CANDIDATE'), { flag: 'wx' });
  return { status: 'HISTORY_PUBLIC_BINDING_VERIFIED', reads: count, graph: data.graph, core: data.core,
    pairs: data.pairs.length, attestationBlock: data.attestationBlock, readyToSign: false, noSign: true, noSend: true };
}
module.exports = { baseInputs, inputs, verifyJournal, main, GRAPH, MANIFEST, CORE, PACKAGE, DEPLOYMENT_FILES };
if (require.main === module) main(process.argv[2], process.argv[3], process.argv[4])
  .then(value => console.log(JSON.stringify(value))).catch(error => { console.error(error.message); process.exitCode = 1; });
