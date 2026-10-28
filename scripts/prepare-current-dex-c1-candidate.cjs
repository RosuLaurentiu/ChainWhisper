/* global require, module, __dirname, process, console, fetch, AbortSignal */
/* eslint-disable @typescript-eslint/no-require-imports -- This Node CommonJS helper reuses the frozen CJS candidate and runner exports. */
'use strict';
// Public read-only candidate binding. No wallet, private input, signing or send API.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const workspace = path.resolve(__dirname, '../..');
const validation = path.join(workspace, 'ChainWhisper Contracts V2/validation');
const candidateRoot = path.join(validation, 'candidates/core-advance-boundary-2026-10-06');
const load = createRequire(path.join(validation, 'package.json'));
const { Interface, AbiCoder, keccak256, id, getCreateAddress } = load('ethers');
const sha = value => createHash('sha256').update(value).digest('hex');
const lower = value => String(value).toLowerCase();
const same = (a, b, label) => assert.equal(lower(a), lower(b), label);
const PACKAGE = 'f6ad0271b231c1926a8b79c262262b94372ccc13640b3ebc5dbd51552c839ab8';
const RPC = 'https://testnet.coti.io/rpc';
// This candidate uses the retained COTI creation sequence (nonce step 2).
// Factory creates NFT, evaluator, then Engine. Do not use Ethereum's step 1.
const FACTORY_CHILD_NONCES = Object.freeze({ positionNFT: 1, terminalEvaluator: 3, fixedEngine: 5 });

function inputs() {
  const frozen = require(path.join(candidateRoot, 'candidate.cjs')).frozen();
  const pkg = JSON.parse(fs.readFileSync(path.join(candidateRoot, 'unsigned-deployment-1.json'), 'utf8'));
  assert.equal(sha(JSON.stringify(pkg)), PACKAGE, 'D06_PACKAGE_DRIFT');
  const journal = fs.readFileSync(path.join(candidateRoot, 'deployment-1.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  const verified = journal.filter(row => row.kind === 'verified');
  assert.equal(verified.length, 43); assert.equal(pkg.calls.length, 43);
  const runtimes = pkg.calls.map(row => {
    const matches = verified.filter(v => v.index === row.index); assert.equal(matches.length, 1);
    const v = matches[0]; assert.equal(v.status, 1); same(v.address, row.predictedAddress, 'CONSTRUCTOR_ADDRESS');
    assert.equal(v.packageSha256, PACKAGE); return [row.name, lower(v.address), v.runtimeHash];
  });
  const factory = pkg.calls.find(row => row.name === 'ChainWhisperFixedEngineFactory');
  const api = name => new Interface(frozen.artifacts[name].abi);
  const runtime = require(path.join(candidateRoot, 'runtime.cjs')).runtimeFor(frozen, pkg);
  // The Engine contains an optimized child image that differs from the standalone
  // matcher artifact. Reuse its accepted assembly proof only after exact containment.
  const embeddedBytes = fs.readFileSync(path.join(validation, 'candidates/estimate-compatible-native-2026-10-04/native-deployment/embedded-matcher-1.json'));
  assert.equal(sha(embeddedBytes), '1163a1fbcceb6b97cc2255a3fb985ad6ef1981296d773b5d86a6eaa6042e7c8d', 'EMBEDDED_PROOF_DRIFT');
  const embedded = JSON.parse(embeddedBytes);
  assert.equal(embedded.status, 'EXACT_EMBEDDED_MATCHER_ASSEMBLY_PASS');
  assert.equal(frozen.artifacts.ChainWhisperFixedEngine.bytecode.slice(2 + embedded.engineCreationOffset * 2,
    2 + (embedded.engineCreationOffset + embedded.creationBytes) * 2), embedded.creation, 'EMBEDDED_CREATION_CHANGED');
  assert.equal(embedded.creation.slice(embedded.runtimeOffset * 2), embedded.runtime, 'EMBEDDED_RUNTIME_CHANGED');
  const factoryStorage = [0, 1, 2, 8].map((arg, index) => [String([5, 6, 7, 10][index]),
    '0x' + BigInt(factory.args[arg]).toString(16).padStart(64, '0')]);
  return { frozen, pkg, runtimes, factory, factoryStorage, api, runtime, verified, embedded };
}

function checkMatcher(code, input) {
  const { embedded, pkg, runtimes } = input;
  const ratio = pkg.addresses.ChainWhisperFixedProtectedRatio;
  const hash = runtimes.find(row => row[0] === 'ChainWhisperFixedProtectedRatio')[2];
  let expected = embedded.runtime;
  for (const [key, refs] of Object.entries(embedded.immutableReferences)) {
    const value = embedded.immutableNames[key] === 'ratio' ? ratio : embedded.immutableNames[key] === 'ratioRuntime' ? hash : null;
    assert(value, 'UNKNOWN_MATCHER_IMMUTABLE');
    for (const ref of refs) {
      assert.equal(ref.length, 32);
      expected = expected.slice(0, ref.start * 2) + BigInt(value).toString(16).padStart(64, '0') + expected.slice((ref.start + ref.length) * 2);
    }
  }
  same(code, '0x' + expected, 'EXACT_EMBEDDED_MATCHER');
}

// The same allowlisted reader works against one RPC capture or a saved capture.
async function collect(rpc, input) {
  const { pkg, api, runtimes, factory, factoryStorage, runtime, verified } = input;
  same(BigInt(await rpc('eth_chainId', [])), pkg.chainId, 'CHAIN');
  const genesis = await rpc('eth_getBlockByNumber', ['0x0', false]); same(genesis.hash, pkg.genesisHash, 'GENESIS');
  const head = await rpc('eth_getBlockByNumber', ['latest', false]);
  assert(BigInt(head.number) >= BigInt(verified.at(-1).blockNumber), 'HEAD_BEFORE_DEPLOYMENT');
  const tag = { blockHash: head.hash, requireCanonical: true };
  const read = async (name, address, method) => {
    const abi = api(name), data = abi.encodeFunctionData(method, []);
    const raw = await rpc('eth_call', [{ to: address, data }, tag]);
    const values = abi.decodeFunctionResult(method, raw);
    same(abi.encodeFunctionResult(method, values), raw, 'CANONICAL_GETTER'); return values[0];
  };
  const core = lower(pkg.expectedCore);
  const coreNames = ['releaseId', 'marketId', 'feePpm', 'maxWorkLifetime', 'tokenAdmissionCommitment', 'inputToken', 'outputToken',
    'inputRuntimeHash', 'outputRuntimeHash', 'fixedEngine', 'fixedEngineRuntimeHash', 'terminalEvaluator',
    'terminalEvaluatorRuntimeHash', 'terminalEvaluatorBindingCommitment', 'positionNFT', 'positionNFTRuntimeHash', 'fastPoolQuote', 'poolTerms'];
  const coreValues = Object.fromEntries(await Promise.all(coreNames.map(async name => [name, await read('ChainWhisperDexCore', core, name)])));
  const config = { releaseId: pkg.release, marketId: pkg.market, feePpm: pkg.feePpm, maxWorkLifetime: pkg.maxWorkLifetime,
    tokenAdmissionCommitment: pkg.reviewedTokenSet, inputToken: pkg.tokenAddresses[0], outputToken: pkg.tokenAddresses[1],
    inputRuntimeHash: pkg.tokenRuntimeHashes[0], outputRuntimeHash: pkg.tokenRuntimeHashes[1] };
  for (const [name, value] of Object.entries(config)) same(coreValues[name], value, name);
  assert.equal(pkg.nonceStep, '2', 'CANDIDATE_CREATION_SEQUENCE');
  for (const [name, creator, nonce] of [...Object.entries(FACTORY_CHILD_NONCES).map(([name, nonce]) => [name, factory.predictedAddress, nonce]),
    ['fastPoolQuote', core, 1]]) {
    same(coreValues[name], getCreateAddress({ from: creator, nonce }), 'CREATED_' + name);
  }
  const poolTerms = lower(coreValues.poolTerms), sharedMath = lower(await read('ChainWhisperPoolTerms', poolTerms, 'sharedMath'));
  const engine = lower(coreValues.fixedEngine), matcher = lower(getCreateAddress({ from: engine, nonce: 1 }));
  const engineLayout = input.frozen.info.output.contracts[input.frozen.artifacts.ChainWhisperFixedEngine.sourceName].ChainWhisperFixedEngine.storageLayout;
  const state = engineLayout.storage.find(row => row.label === '_matchState');
  const cfg = engineLayout.types[state.type].members.find(row => row.label === 'config');
  const matchMembers = engineLayout.types[cfg.type].members;
  const matchWords = {};
  for (const name of ['matcher', 'matcherRuntime']) {
    const member = matchMembers.find(row => row.label === name); assert.equal(member.offset, 0);
    const slot = BigInt(state.slot) + BigInt(cfg.slot) + BigInt(member.slot);
    matchWords[name] = await rpc('eth_getStorageAt', [engine, '0x' + slot.toString(16), tag]);
  }
  same(BigInt(matchWords.matcher), BigInt(matcher), 'ENGINE_MATCHER');
  const nested = [['ChainWhisperPoolTerms', poolTerms], ['ChainWhisperSharedPoolMath', sharedMath], ['ChainWhisperDirectLimitMatch', matcher]];
  const companions = [['ChainWhisperFixedEngine', engine], ['ChainWhisperDexWideTerminalGT', lower(coreValues.terminalEvaluator)],
    ['ChainWhisperDexFastPoolQuote', lower(coreValues.fastPoolQuote)], ['ChainWhisperDexPositionNFT', lower(coreValues.positionNFT)]];
  const pendingCode = await Promise.all([...runtimes, ...nested, ...companions].map(async row =>
    ({ row, code: await rpc('eth_getCode', [row[1], tag]) })));
  const codeRows = pendingCode.map(({ row: [name, address, expected], code }) => {
    assert(code !== '0x', 'EMPTY_RUNTIME_' + name);
    const hash = keccak256(code); if (expected) same(hash, expected, name);
    const row = pkg.calls.find(c => lower(c.predictedAddress) === address) ?? { name, predictedAddress: address };
    try { if (name === 'ChainWhisperDirectLimitMatch') checkMatcher(code, input); else runtime(row, code); }
    catch (error) { throw new Error(name + ': ' + error.message); }
    return [name, address, hash];
  });
  const hashFor = address => codeRows.find(row => row[1] === lower(address))[2];
  for (const name of ['fixedEngine', 'terminalEvaluator', 'positionNFT']) same(coreValues[name + 'RuntimeHash'], hashFor(coreValues[name]), name + '_HASH');
  same(matchWords.matcherRuntime, hashFor(matcher), 'MATCHER_HASH');
  for (const [name, address] of [['ChainWhisperPoolTerms', poolTerms], ['ChainWhisperSharedPoolMath', sharedMath],
    ['ChainWhisperFixedEngine', engine], ['ChainWhisperDexFastPoolQuote', coreValues.fastPoolQuote], ['ChainWhisperDexPositionNFT', coreValues.positionNFT]]) {
    same(await read(name, address, 'core'), core, name + '_CORE');
  }
  const sortedTokens = [...pkg.tokenAddresses].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
  for (const [name, expected] of Object.entries({ releaseId: pkg.release, marketId: pkg.market, positionNFT: coreValues.positionNFT,
    token0: sortedTokens[0], token1: sortedTokens[1] })) same(await read('ChainWhisperPoolTerms', poolTerms, name), expected, 'POOL_TERMS_' + name);
  for (const [method, contract] of Object.entries({ snapshotOwner: 'ChainWhisperFixedOwner', recurringOwner: 'ChainWhisperRecurringOwnerControls',
    ownerLifecycle: 'ChainWhisperOrderOwnerLifecycle', orderWork: 'ChainWhisperOrderWork', workLifecycle: 'ChainWhisperFixedWorkLifecycle',
    rangeOwner: 'ChainWhisperRangeOwner', rangeWork: 'ChainWhisperRangeWork', matchWork: 'ChainWhisperFixedMatchWork' })) {
    same(await read('ChainWhisperFixedEngineFactory', factory.predictedAddress, method), pkg.addresses[contract], 'FACTORY_' + method);
  }
  const selector = runtimes.find(row => row[0] === 'ChainWhisperFixedBoundedSelector');
  for (const [name, expected] of Object.entries({ ...config, positionNFT: coreValues.positionNFT, selector: selector[1], selectorRuntimeHash: selector[2] })) {
    if (['tokenAdmissionCommitment', 'inputRuntimeHash', 'outputRuntimeHash'].includes(name)) continue;
    same(await read('ChainWhisperFixedEngine', engine, name), expected, 'ENGINE_' + name);
  }
  const ratio = await read('ChainWhisperFixedBoundedSelector', selector[1], 'ratioHelper');
  same(await read('ChainWhisperDirectLimitMatch', matcher, 'ratio'), ratio, 'MATCH_RATIO');
  same(await read('ChainWhisperDirectLimitMatch', matcher, 'ratioRuntime'), hashFor(ratio), 'MATCH_RATIO_HASH');
  const evaluatorBinding = keccak256(AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'address', 'address', 'bytes32', 'bytes32', 'bytes32', 'uint16', 'bytes32', 'uint32'],
    [pkg.chainId, coreValues.terminalEvaluator, core, pkg.release, pkg.market, id('chainwhisper.dex.role.terminal-evaluator'), 7,
      id('chainwhisper.dex.terminal.wide512.bounded-net-payout.minimum-input.v7'), pkg.feePpm]));
  same(coreValues.terminalEvaluatorBindingCommitment, evaluatorBinding, 'EVALUATOR_BINDING');
  same(await read('ChainWhisperDexWideTerminalGT', coreValues.terminalEvaluator, 'bindingCommitment'), evaluatorBinding, 'EVALUATOR_GETTER');
  for (const [slot, word] of factoryStorage) same(await rpc('eth_getStorageAt', [factory.predictedAddress, '0x' + BigInt(slot).toString(16), tag]), word, 'FACTORY_SLOT');
  const tokens = await Promise.all(pkg.tokenAddresses.map(async (address, index) => {
    const code = await rpc('eth_getCode', [address, tag]); same(keccak256(code), pkg.tokenRuntimeHashes[index], 'TOKEN_CODE');
    return [lower(address), keccak256(code)];
  }));
  same((await rpc('eth_getBlockByNumber', [head.number, false])).hash, head.hash, 'FINAL_BLOCK');
  same(BigInt(await rpc('eth_chainId', [])), pkg.chainId, 'FINAL_CHAIN');
  return { graph: pkg.artifactGraphSha256, packageSha256: PACKAGE, chainId: String(pkg.chainId), genesisHash: pkg.genesisHash,
    core, releaseId: pkg.release, marketId: pkg.market, reviewedTokenSet: pkg.reviewedTokenSet,
    feePpm: Number(pkg.feePpm), maxWorkLifetime: Number(pkg.maxWorkLifetime), readyToSign: false,
    attestationBlock: { number: String(BigInt(head.number)), hash: head.hash }, tokens,
    runtimes: codeRows.slice(0, runtimes.length + nested.length), companions: codeRows.slice(-companions.length), evaluatorBinding, poolTerms, factoryStorage };
}

async function main(mode, output) {
  assert(['--capture', '--check'].includes(mode) && output, 'MODE_AND_CAPTURE_PATH_REQUIRED');
  const input = inputs(); let count = 0;
  const capture = mode === '--capture' ? { schema: 'D06_APP_PUBLIC_BINDING_V1', destination: RPC, reads: [] } : JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(capture.schema, 'D06_APP_PUBLIC_BINDING_V1'); assert.equal(capture.destination, RPC);
  const cache = new Map(capture.reads.map(row => [JSON.stringify([row.method, row.params]), row.result]));
  const rpc = async (method, params) => {
    assert(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getStorageAt', 'eth_call'].includes(method), 'PUBLIC_METHOD_ONLY');
    assert(++count <= 150, 'READ_BOUND'); const key = JSON.stringify([method, params]);
    if (mode === '--check') { assert(cache.has(key), 'MISSING_CAPTURED_READ'); return cache.get(key); }
    const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: count, method, params }), signal: AbortSignal.timeout(15000) });
    assert(response.ok, 'RPC_HTTP'); const body = await response.json(); assert(!body.error, JSON.stringify(body.error));
    capture.reads.push({ method, params, result: body.result }); return body.result;
  };
  let data;
  try { data = await collect(rpc, input); }
  finally {
    // A failed public capture is diagnostic data, not an admitted descriptor.
    // Replaying it must still pass collect() before data can be consumed.
    if (mode === '--capture') fs.writeFileSync(output, JSON.stringify(capture, null, 2) + '\n');
  }
  data.attestationSha256 = sha(fs.readFileSync(output));
  console.log(JSON.stringify({ status: 'D06_PUBLIC_BINDING_VERIFIED', reads: count, data }));
}
module.exports = { inputs, collect, main, checkMatcher, FACTORY_CHILD_NONCES };
if (require.main === module) main(process.argv[2], process.argv[3]).catch(error => { console.error(error.message); process.exitCode = 1; });
