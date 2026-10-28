/* global require, module, __dirname, process, console, fetch, AbortSignal, Buffer, structuredClone */
/* eslint-disable @typescript-eslint/no-require-imports -- Offline frozen CJS readers. */
'use strict';
// Public binding only. No credentials, signer, private input or send API.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const validation = path.resolve(__dirname, '../../ChainWhisper Contracts V2/validation');
const root = path.join(validation, 'candidates/shared-core-prepared-markets-2026-10-07');
const report = path.resolve(__dirname, '../reports/prepared-candidate-2026-10-07');
const candidate = require(path.join(root, 'candidate.cjs'));
const legacy = require('./prepare-current-dex-c1-candidate.cjs');
const { runtimeFor } = require(path.join(validation, 'candidates/core-advance-boundary-2026-10-06/runtime.cjs'));
const { deployments } = require(path.join(root, 'deployment-package.cjs'));
const load = createRequire(path.join(validation, 'package.json'));
const { Interface, AbiCoder, keccak256, id, getCreateAddress } = load('ethers');
const sha = value => createHash('sha256').update(value).digest('hex');
const lower = value => String(value).toLowerCase();
const same = (a, b, label) => assert.equal(lower(a), lower(b), label);
const PACKAGE = 'd38ef53c7a9f5675206250527b127ca516b8fe78e82175b5a5efffb122d676e5';
const GRAPH = '85767f8adefa7323ca97b190b4d959ce8ee08b38be02e568c2415decf028052c';
const RPC = 'https://testnet.coti.io/rpc';
const SCHEMA = 'PREPARED_APP_PUBLIC_BINDING_V1';
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function baseInputs() {
  assert.equal(candidate.pins.graph, GRAPH, 'PREPARED_GRAPH');
  const frozen = candidate.frozen();
  const pkg = json(path.join(root, 'native-deployment-1/package.json'));
  assert.equal(sha(JSON.stringify(pkg)), PACKAGE, 'PREPARED_PACKAGE_DRIFT');
  assert.deepEqual(deployments(json(path.join(root, 'native-deployment-1/base.json')), frozen), pkg, 'PREPARED_PACKAGE_REPRODUCTION');
  const journalRaw = fs.readFileSync(path.join(root, 'native-deployment-1/journal.jsonl'), 'utf8');
  assert(journalRaw.endsWith('\n'), 'PREPARED_JOURNAL_TRUNCATED');
  const verified = journalRaw.trim().split(/\r?\n/).map(JSON.parse).filter(row => row.kind === 'verified');
  assert.equal(pkg.calls.length, 44); assert.equal(verified.length, 44);
  const runtimes = pkg.calls.map(row => {
    const matches = verified.filter(v => v.index === row.index); assert.equal(matches.length, 1);
    const v = matches[0]; assert.equal(v.status, 1); assert.equal(v.packageSha256, PACKAGE);
    same(v.address, row.predictedAddress, 'PREPARED_CONSTRUCTOR_ADDRESS');
    return [row.name, lower(v.address), v.runtimeHash];
  });
  // Only public identity fields are read from the accepted reconciliation.
  const reconciliation = json(path.join(root, 'seed-remaining/FINAL_RECONCILIATION.json'));
  assert.equal(reconciliation.status, 'SIX_MARKETS_INDEPENDENTLY_RECONCILED');
  assert.equal(reconciliation.graph, GRAPH); same(reconciliation.core, pkg.expectedCore, 'RECONCILIATION_CORE');
  const factory = pkg.calls.find(row => row.name === 'ChainWhisperFixedEngineFactory');
  const factoryStorage = [0, 1, 2, 8].map((arg, index) => [String([5, 6, 7, 10][index]),
    '0x' + BigInt(factory.args[arg]).toString(16).padStart(64, '0')]);
  const stagesSource = frozen.info.input.sources['contracts/dex/ChainWhisperDexCheapAsyncTypes.sol'].content;
  assert.match(stagesSource, /enum Stage\s*\{\s*NONE, POOL_BASELINE, TWO_POOL, LIMIT_FIRST, LIMIT_SECOND, READY, FUNDED, SETTLED, RELEASED\s*\}/, 'PREPARED_STAGES_DRIFT');
  const api = name => new Interface(frozen.artifacts[name].abi);
  const quote = api('ChainWhisperDexCore').getFunction('quoteCheapAsync');
  assert(quote, 'PREPARED_QUOTE_ABI');
  return { frozen, pkg, verified, runtimes, factory, factoryStorage, api, runtime: runtimeFor(frozen, pkg),
    minimumBlock: reconciliation.blockNumber,
    protocol: { name: 'quote-slippage', stages: { workCalls: 4, ready: 5, funded: 6, settled: 7, released: 8 },
      coreAbiSha256: sha(JSON.stringify(frozen.artifacts.ChainWhisperDexCore.abi)), quoteSignature: quote.format('sighash'),
      stagesSourceSha256: sha(stagesSource) } };
}

// The compiler assembly must belong to this exact frozen Engine. Another graph's
// optimized embedded matcher image is not a substitute for this proof.
function verifyEmbedded(output, input, graph = GRAPH) {
  const key = input.frozen.artifacts.ChainWhisperFixedEngine.sourceName;
  const engine = output.contracts[key].ChainWhisperFixedEngine;
  same('0x' + engine.evm.bytecode.object, input.frozen.artifacts.ChainWhisperFixedEngine.bytecode, 'EXACT_ENGINE_CREATION');
  same('0x' + engine.evm.deployedBytecode.object, input.frozen.artifacts.ChainWhisperFixedEngine.deployedBytecode, 'EXACT_ENGINE_RUNTIME');
  const parent = engine.evm.bytecode.object, childAsm = engine.evm.legacyAssembly['.data']['1'];
  const runtimeAsm = childAsm['.data']['0'];
  assert.equal(parent.split('60c034').length, 2, 'UNIQUE_CHILD_CONSTRUCTOR');
  const begin = parent.indexOf('60c034') / 2, bytes = Buffer.from(parent.slice(begin * 2), 'hex');
  assert.equal(bytes[9], 0x61, 'CHILD_PUSHSIZE'); assert.equal(childAsm['.code'][5].name, 'PUSHSIZE');
  const creationBytes = bytes.readUInt16BE(10), creation = bytes.subarray(0, creationBytes).toString('hex');
  const prefix = '610100806040526004361015610014'; assert.equal(creation.split(prefix).length, 2, 'UNIQUE_CHILD_RUNTIME');
  const offset = creation.indexOf(prefix) / 2, runtime = creation.slice(offset * 2), code = Buffer.from(runtime, 'hex');
  const opcodes = { ADD: 1, SUB: 3, LT: 16, GT: 17, SLT: 18, EQ: 20, ISZERO: 21, AND: 22, OR: 23, NOT: 25,
    SHL: 27, SHR: 28, CALLVALUE: 52, CALLDATALOAD: 53, CALLDATASIZE: 54, CALLDATACOPY: 55, CODESIZE: 56,
    RETURNDATASIZE: 61, RETURNDATACOPY: 62, EXTCODEHASH: 63, POP: 80, MLOAD: 81, MSTORE: 82,
    JUMP: 86, JUMPI: 87, GAS: 90, JUMPDEST: 91, CALL: 241, RETURN: 243, REVERT: 253 };
  const tags = {}, jumps = [], refs = {}; let pc = 0;
  for (const op of runtimeAsm['.code']) {
    if (op.name === 'tag') { assert(tags[op.value] === undefined); tags[op.value] = pc; continue; }
    const byte = code[pc++];
    if (op.name.startsWith('PUSH')) {
      assert(byte >= 0x60 && byte <= 0x7f, 'PUSH_OPCODE'); const width = byte - 0x5f, at = pc;
      const value = BigInt('0x' + code.subarray(pc, pc + width).toString('hex')); pc += width;
      if (op.name === 'PUSH') assert.equal(value, BigInt('0x' + op.value), 'ASSEMBLY_LITERAL');
      else if (op.name === 'PUSH [tag]') jumps.push({ tag: op.value, value });
      else if (op.name === 'PUSHIMMUTABLE') { assert.equal(width, 32); assert.equal(value, 0n); (refs[op.value] ??= []).push({ start: at, length: width }); }
      else assert.fail('UNSUPPORTED_PUSH_' + op.name);
    } else if (/^DUP\d+$/.test(op.name)) assert.equal(byte, 0x7f + Number(op.name.slice(3)));
    else if (/^SWAP\d+$/.test(op.name)) assert.equal(byte, 0x8f + Number(op.name.slice(4)));
    else { assert(opcodes[op.name] !== undefined, 'UNSUPPORTED_OPCODE_' + op.name); assert.equal(byte, opcodes[op.name]); }
  }
  for (const row of jumps) assert.equal(row.value, BigInt(tags[row.tag]), 'ASSEMBLY_JUMP_TARGET');
  assert.equal(runtime.slice(pc * 2), 'fe' + runtimeAsm['.auxdata'], 'EXACT_METADATA_SUFFIX');
  const sourceName = 'contracts/dex/ChainWhisperDirectLimitMatch.sol', immutableNames = {};
  assert.equal(Object.keys(refs).length, 2);
  for (const key of Object.keys(refs)) {
    const matches = runtimeAsm['.code'].filter(x => x.name === 'PUSHIMMUTABLE' && x.value === key);
    const excerpts = matches.map(x => input.frozen.info.input.sources[sourceName].content.slice(x.begin, x.end));
    assert(matches.every(x => x.source === output.sources[sourceName].id));
    const name = excerpts.includes('ChainWhisperFixedProtectedRatio public immutable ratio') ? 'ratio'
      : excerpts.includes('bytes32 public immutable ratioRuntime') ? 'ratioRuntime' : null;
    assert(name, 'IMMUTABLE_SOURCE_NAME'); immutableNames[key] = name;
  }
  return { graph, creation, runtime, engineCreationOffset: begin, creationBytes, runtimeOffset: offset,
    immutableReferences: refs, immutableNames };
}

function inputs() {
  const input = baseInputs(), file = path.join(report, 'engine-assembly.json');
  assert(fs.existsSync(file), 'PREPARED_EMBEDDED_PROOF_REQUIRED_RUN_PROVE_EMBEDDED');
  return { ...input, embedded: verifyEmbedded(json(file), input) };
}

async function collect(rpc, input, packageSha256 = PACKAGE) {
  // Reuse the maintained reader for the primary companions and all 44 actual
  // constructors. Its two-token configuration is an explicit primary projection.
  const primary = { ...input.pkg, tokenAddresses: input.pkg.tokenAddresses.slice(0, 2),
    tokenRuntimeHashes: input.pkg.tokenRuntimeHashes.slice(0, 2), reviewedTokenSet: input.pkg.tokenAdmissionCommitment };
  const data = await legacy.collect(rpc, { ...input, pkg: primary });
  assert(BigInt(data.attestationBlock.number) >= BigInt(input.minimumBlock), 'PREPARED_HEAD_BEFORE_SIX_MARKETS');
  const tag = { blockHash: data.attestationBlock.hash, requireCanonical: true };
  const call = async (name, address, method, args = []) => {
    const abi = input.api(name), raw = await rpc('eth_call', [{ to: address, data: abi.encodeFunctionData(method, args) }, tag]);
    const values = abi.decodeFunctionResult(method, raw); same(raw, abi.encodeFunctionResult(method, values), 'CANONICAL_PUBLIC_GETTER'); return values;
  };
  const tokens = [];
  const tokenMetadata = [];
  const tokenAbi = new Interface(['function decimals() view returns(uint8)', 'function publicAmountsEnabled() view returns(bool)']);
  for (let i = 0; i < 4; i++) {
    const address = lower(input.pkg.tokenAddresses[i]), hash = keccak256(await rpc('eth_getCode', [address, tag]));
    same(hash, input.pkg.tokenRuntimeHashes[i], 'PREPARED_TOKEN_RUNTIME'); tokens.push([address, hash]);
    for (const [method, expected] of [['decimals', 6n], ['publicAmountsEnabled', false]]) {
      const raw = await rpc('eth_call', [{ to: address, data: tokenAbi.encodeFunctionData(method) }, tag]);
      const values = tokenAbi.decodeFunctionResult(method, raw);
      same(raw, tokenAbi.encodeFunctionResult(method, values), 'CANONICAL_TOKEN_POLICY'); assert.equal(values[0], expected, 'PREPARED_TOKEN_POLICY');
    }
    tokenMetadata.push({ address, symbol: ['BCN', 'HBR', 'EMBR', 'ORBT'][i], decimals: 6, publicAmountsEnabled: false });
  }
  const pairs = [];
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const sorted = [tokens[i][0], tokens[j][0]].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
    const expected = keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32', 'uint256', 'address', 'bytes32', 'address', 'address'],
      [id('chainwhisper.dex.canonical-pair.v1'), input.pkg.chainId, input.pkg.expectedCore, input.pkg.release, ...sorted]));
    const forward = await call('ChainWhisperDexCore', data.core, 'marketForTokens', sorted);
    const reverse = await call('ChainWhisperDexCore', data.core, 'marketForTokens', [...sorted].reverse());
    assert.deepEqual(forward.toArray(true), reverse.toArray(true), 'PAIR_DIRECTION_IDENTITY');
    same(forward[0], expected, 'CANONICAL_PAIR'); assert(forward[1] > 0n && forward[4] === true, 'PAIR_NOT_ENABLED');
    const engine = lower(forward[5]), terms = lower(forward[6]);
    const sharedMath = lower((await call('ChainWhisperPoolTerms', terms, 'sharedMath'))[0]);
    const companions = [];
    for (const [name, address] of [['ChainWhisperFixedEngine', engine], ['ChainWhisperPoolTerms', terms],
      ['ChainWhisperSharedPoolMath', sharedMath], ['ChainWhisperDirectLimitMatch', lower(getCreateAddress({ from: engine, nonce: 1 }))]]) {
      const code = await rpc('eth_getCode', [address, tag]);
      if (name === 'ChainWhisperDirectLimitMatch') legacy.checkMatcher(code, input);
      else input.runtime({ name, predictedAddress: address }, code);
      companions.push([name, address, keccak256(code)]);
    }
    for (const [name, address] of [['ChainWhisperFixedEngine', engine], ['ChainWhisperPoolTerms', terms]]) {
      same((await call(name, address, 'core'))[0], data.core, 'PAIR_CORE');
      same((await call(name, address, 'releaseId'))[0], data.releaseId, 'PAIR_RELEASE');
      same((await call(name, address, 'marketId'))[0], expected, 'PAIR_MARKET');
    }
    same((await call('ChainWhisperSharedPoolMath', sharedMath, 'core'))[0], data.core, 'PAIR_MATH_CORE');
    const layout = input.frozen.info.output.contracts[input.frozen.artifacts.ChainWhisperFixedEngine.sourceName].ChainWhisperFixedEngine.storageLayout;
    const state = layout.storage.find(row => row.label === '_matchState');
    const cfg = layout.types[state.type].members.find(row => row.label === 'config');
    const members = layout.types[cfg.type].members;
    const matcherRow = companions.find(row => row[0] === 'ChainWhisperDirectLimitMatch');
    for (const [field, expected] of [['matcher', matcherRow[1]], ['matcherRuntime', matcherRow[2]]]) {
      const member = members.find(row => row.label === field); assert.equal(member.offset, 0);
      const slot = BigInt(state.slot) + BigInt(cfg.slot) + BigInt(member.slot);
      const word = await rpc('eth_getStorageAt', [engine, '0x' + slot.toString(16), tag]);
      same(BigInt(word), BigInt(expected), 'PAIR_ENGINE_MATCHER_BINDING');
    }
    for (const [method, expectedToken] of [['token0', sorted[0]], ['token1', sorted[1]]]) same((await call('ChainWhisperPoolTerms', terms, method))[0], expectedToken, 'PAIR_TERMS_TOKEN');
    same((await call('ChainWhisperPoolTerms', terms, 'positionNFT'))[0], data.companions.find(row => row[0] === 'ChainWhisperDexPositionNFT')[1], 'SHARED_POSITION_NFT');
    pairs.push({ marketId: expected, canonicalId: String(forward[1]), tokens: sorted, engine, poolTerms: terms, companions });
  }
  assert.equal(new Set(pairs.map(row => row.canonicalId)).size, 6, 'CANONICAL_PAIR_IDS');
  same((await rpc('eth_getBlockByNumber', ['0x' + BigInt(data.attestationBlock.number).toString(16), false])).hash, data.attestationBlock.hash, 'PREPARED_FINAL_BLOCK');
  same(BigInt(await rpc('eth_chainId', [])), input.pkg.chainId, 'PREPARED_FINAL_CHAIN');
  // The existing App reader calls this field reviewedTokenSet and compares it
  // to Core.tokenAdmissionCommitment. Keep that reader contract explicit.
  return { ...data, packageSha256, reviewedTokenSet: input.pkg.tokenAdmissionCommitment,
    primaryReviewedTokenSet: input.pkg.reviewedTokenSet,
    additionalReviewedTokenSet: input.pkg.additionalReviewedTokenSet, tokenAdmissionCommitment: input.pkg.tokenAdmissionCommitment,
    tokens, tokenMetadata, pairs, protocol: input.protocol, readyToSign: false };
}

function render(data, exportName = 'STAGED_PREPARED_DEX_CANDIDATE') {
  assert(/^[A-Z][A-Z0-9_]*$/.test(exportName), 'PUBLIC_EXPORT_NAME');
  return '// Generated from the exact prepared public capture. No signing admission.\n' +
    'const publicData = ' + JSON.stringify(data, null, 2) + ' as const;\n' +
    'const freeze = <T>(value: T): T => {\n' +
    "  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }\n" +
    '  return value;\n};\n' +
    'export const ' + exportName + ' = freeze(publicData);\n';
}

async function main(mode, output) {
  if (mode === '--prove-embedded') {
    const input = baseInputs(), request = structuredClone(input.frozen.info.input);
    const key = input.frozen.artifacts.ChainWhisperFixedEngine.sourceName;
    request.settings.outputSelection = { [key]: { ChainWhisperFixedEngine: ['evm.bytecode', 'evm.deployedBytecode', 'evm.legacyAssembly'] } };
    const native = require(path.join(validation, 'scripts/native-solc-019'));
    const raw = native.compile(request), compiled = JSON.parse(raw);
    assert.deepEqual((compiled.errors ?? []).filter(row => row.severity === 'error'), []);
    const proof = verifyEmbedded(compiled, input);
    fs.mkdirSync(report, { recursive: true }); fs.writeFileSync(path.join(report, 'engine-assembly.json'), raw);
    return { status: 'PREPARED_EMBEDDED_PROOF_VERIFIED', graph: GRAPH, compiler: native.identity,
      outputSha256: sha(raw), creationBytes: proof.creationBytes, noNetwork: true };
  }
  assert(['--capture', '--check', '--emit'].includes(mode) && output, 'MODE_AND_CAPTURE_PATH_REQUIRED');
  const input = inputs(); let count = 0;
  const capture = mode === '--capture' ? { schema: SCHEMA, destination: RPC, graph: GRAPH, packageSha256: PACKAGE, reads: [] } : json(output);
  assert.equal(capture.schema, SCHEMA); assert.equal(capture.destination, RPC); assert.equal(capture.graph, GRAPH); assert.equal(capture.packageSha256, PACKAGE);
  const saved = new Map(), cache = new Map(), cursors = new Map();
  for (const row of capture.reads) {
    const key = JSON.stringify([row.method, row.params]);
    if (!saved.has(key)) saved.set(key, []);
    saved.get(key).push(row.result);
  }
  const started = Date.now();
  const rpc = async (method, params) => {
    assert(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getStorageAt', 'eth_call'].includes(method), 'PUBLIC_METHOD_ONLY');
    assert(++count <= 350 && Date.now() - started < 12 * 60000, 'PUBLIC_READ_BOUND');
    const key = JSON.stringify([method, params]);
    // Code/getters/storage use one canonical blockHash and can share a result.
    // Chain and block checks must contact RPC again to detect a changed anchor.
    const reusable = !['eth_chainId', 'eth_getBlockByNumber'].includes(method);
    if (reusable && cache.has(key)) return cache.get(key);
    if (mode !== '--capture') {
      const cursor = cursors.get(key) ?? 0, rows = saved.get(key);
      assert(rows && cursor < rows.length, 'MISSING_CAPTURED_READ');
      const value = rows[cursor]; cursors.set(key, cursor + 1);
      if (reusable) cache.set(key, value); return value;
    }
    const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: count, method, params }), signal: AbortSignal.timeout(15000) });
    assert(response.ok, 'PUBLIC_RPC_HTTP'); const body = await response.json(); assert(!body.error, 'PUBLIC_RPC_ERROR');
    assert(Object.hasOwn(body, 'result')); capture.reads.push({ method, params, result: body.result });
    if (reusable) cache.set(key, body.result); return body.result;
  };
  let data;
  try { data = await collect(rpc, input); }
  finally { if (mode === '--capture') fs.writeFileSync(output, JSON.stringify(capture, null, 2) + '\n'); }
  data.attestationSha256 = sha(fs.readFileSync(output));
  if (mode === '--emit') fs.writeFileSync(path.resolve(__dirname, '../src/lib/currentDexPreparedCandidate.ts'), render(data));
  return { status: 'PREPARED_PUBLIC_BINDING_VERIFIED', reads: count, data };
}
module.exports = { baseInputs, inputs, collect, verifyEmbedded, render, main, GRAPH, PACKAGE };
if (require.main === module) main(process.argv[2], process.argv[3]).then(value => console.log(JSON.stringify(value)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });

