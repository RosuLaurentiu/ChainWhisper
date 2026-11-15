/* global require, module, __dirname, process, console, setTimeout, clearTimeout */
'use strict';
// Reuse the public six-market collector. This does not grant signing authority.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto'), { createRequire } = require('node:module');
const validation = path.resolve(__dirname, '../../ChainWhisper Contracts V2/validation');
const root = path.join(validation, 'candidates/limit-fill-history-shared-receipt-2026-10-13');
const report = path.resolve(__dirname, '../reports/limit-directory-adoption-2026-11-04/public-binding');
const deploymentAdapter = require(path.join(validation, 'candidates/packed-rate-input-2026-11-03/directory-deployment.cjs'));
const { candidate } = deploymentAdapter;
const { deployments } = require(path.join(root, 'deployment-package.cjs'));
const deploymentBoundary = require(path.join(validation, 'candidates/shared-core-markets-2026-10-07/deployment-boundary.cjs'));
const { runtimeFor } = require(path.join(validation, 'candidates/core-advance-boundary-2026-10-06/runtime.cjs'));
const prepared = require('./prepare-current-dex-prepared-candidate.cjs');
const load = createRequire(path.join(validation, 'package.json'));
const { Interface, WebSocketProvider } = load('ethers');
const sha = value => createHash('sha256').update(value).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const endpoint = 'wss://testnet.coti.io/ws';
const schema = 'SHARED_HISTORY_APP_PUBLIC_BINDING_V1';
const GRAPH = '958eea2faf9aec536df3318d5b770acec1da36efa1665cfc11a0c788d97f8fdf';
const MANIFEST = '1114fa31f799eed9caeef51507cb1415c186fddbfa6dd168f91d6e0b72a42be5';
const CORE = '0x74ace210762C91CEA53E59edc232898F612F47A9';
const PACKAGE = '0abc9673d4b81d1a300da3f28bf2fe0f27b489b532e9de08c1a2736a40f62a31';
const DEPLOYMENT_FILES = Object.freeze({
  'base.json': 'bceecc3d62ed7dfc0a0be322eeea725f2757a615d45d87a4d9a2b25c4e39d6cb',
  'package.json': '2bd8a03398d57cd9083737edc5e83be10092cd5b0196fa5a015f485d6f8c4ce5',
  'RESULT.json': '3f82ec2fbca77ecb1ad920da22a64dcb6276e2b8badff9a36f231da3bbd76a25',
  'journal.jsonl': '16435ad90c6b422d96c362cbe20fcde5c29f5ec52d3f49552ede22967ab7710b',
  'admission.json': 'dc0347dec119361780bf329e35ca1b56d30ceef365279cf4000c35d01ff7c920',
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
  const frozen = candidate.frozen(), deployment = deploymentAdapter.directory;
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
  assert.deepEqual(deployments(json(path.join(deployment, 'base.json')), frozen, GRAPH), pkg, 'HISTORY_PACKAGE_REPRODUCTION');
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
  const storage = json(path.join(candidate.build, 'all-storage-checks.json'));
  for (const check of Object.values(storage)) assert.equal(check.allPriorFieldsUnchanged, true, 'SHARED_HISTORY_STORAGE');
  const previous = require(path.join(validation, 'candidates/packed-rate-input-2026-11-03/candidate.cjs')).frozen();
  const engineLayout = value => {
    const artifact = value.artifacts.ChainWhisperFixedEngine;
    const layout = value.info.output.contracts[artifact.sourceName].ChainWhisperFixedEngine.storageLayout;
    const shape = id => { const type = layout.types[id]; return { encoding: type.encoding, label: type.label, numberOfBytes: type.numberOfBytes,
      ...(type.members ? { members: type.members.map(member => ({ label: member.label, slot: member.slot, offset: member.offset, type: shape(member.type) })) } : {}),
      ...(type.base ? { base: shape(type.base) } : {}), ...(type.key ? { key: shape(type.key), value: shape(type.value) } : {}) }; };
    return layout.storage.map(field => ({ label: field.label, slot: field.slot, offset: field.offset, type: shape(field.type) }));
  };
  const oldEngine = engineLayout(previous), newEngine = engineLayout(frozen);
  assert.deepEqual(newEngine.slice(0, oldEngine.length), oldEngine, 'SHARED_HISTORY_ENGINE_STORAGE');
  assert.equal(newEngine.length, oldEngine.length + 1, 'SHARED_HISTORY_ENGINE_STORAGE_COUNT');
  assert.equal(newEngine.at(-1).label, '_directoryPages', 'SHARED_HISTORY_ENGINE_DIRECTORY');
  assert.equal(newEngine.at(-1).slot, '46', 'SHARED_HISTORY_ENGINE_DIRECTORY_SLOT');
  const abi = json(path.join(candidate.build, 'abi-changes.json'));
  for (const change of Object.values(abi)) assert.deepEqual(change, { added: [], removed: [] }, 'SHARED_HISTORY_ABI');
  assert.deepEqual(frozen.artifacts.ChainWhisperFixedEngine.abi, previous.artifacts.ChainWhisperFixedEngine.abi, 'SHARED_HISTORY_ENGINE_ABI');
  assert.equal(protocol.coreAbiSha256, 'ebfe0ed3617c22a6c1db293430961532510838e40273038c2a980dc487834086', 'PACKED_CORE_ABI');
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
    const input = baseInputs(), key = input.frozen.artifacts.ChainWhisperFixedEngine.sourceName;
    const phase = path.join(validation, 'candidates/packed-rate-input-2026-11-03/directory-build-1');
    const requestBytes = fs.readFileSync(path.join(phase, 'modules-request.json'));
    const outputBytes = fs.readFileSync(path.join(phase, 'modules-output.json'));
    assert.equal(sha(requestBytes), 'beafc1750c36f0c6ffcbefd3740ca8e555152c43cf806ff0b2c37dbe3971ec6a', 'HISTORY_ENGINE_REQUEST');
    assert.equal(sha(outputBytes), '71f9dbf8f4874fccd3d8d2c9ca5274d3e402334d623da839d7d0a219f12ec259', 'HISTORY_ENGINE_OUTPUT');
    const recorded = JSON.parse(outputBytes).contracts[key].ChainWhisperFixedEngine;
    assert.equal('0x' + recorded.evm.bytecode.object, input.frozen.artifacts.ChainWhisperFixedEngine.bytecode, 'HISTORY_ENGINE_PHASE');
    const request = JSON.parse(requestBytes);
    request.settings.outputSelection[key].ChainWhisperFixedEngine.push('evm.legacyAssembly');
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
