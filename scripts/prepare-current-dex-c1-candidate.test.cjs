/* global require, __dirname, structuredClone */
/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS tests exercise the frozen CJS helper without a loader or build. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { inputs, collect, checkMatcher, FACTORY_CHILD_NONCES } = require('./prepare-current-dex-c1-candidate.cjs');
const { getCreateAddress } = require('../../ChainWhisper Contracts V2/validation/node_modules/ethers');
const capture = JSON.parse(fs.readFileSync(path.join(__dirname, '../reports/current-dex-c1-integration-2026-10-06/public-capture-5.json'), 'utf8'));
const lower = value => String(value).toLowerCase();

function replay(rows) {
  const saved = new Map(rows.map(row => [JSON.stringify([row.method, row.params]), row.result]));
  return async (method, params) => {
    const key = JSON.stringify([method, params]);
    assert(saved.has(key), 'MISSING_SAVED_PUBLIC_READ');
    return saved.get(key);
  };
}

function matcherRead(input, rows) {
  const engine = getCreateAddress({ from: input.factory.predictedAddress, nonce: FACTORY_CHILD_NONCES.fixedEngine });
  const matcher = getCreateAddress({ from: engine, nonce: 1 });
  const row = rows.find(row => row.method === 'eth_getCode' && lower(row.params[0]) === lower(matcher));
  assert(row, 'SAVED_MATCHER_CODE_REQUIRED');
  return row;
}

test('uses the candidate COTI creation sequence, also observed in the retained fa71 deployment', () => {
  const graph = require('../../ChainWhisper Contracts V2/validation/candidates/estimate-compatible-native-2026-10-04/native-deployment/native-graph-1.json');
  const pkg = require('../../ChainWhisper Contracts V2/validation/candidates/estimate-compatible-native-2026-10-04/native-deployment/unsigned-deployment-1.json');
  const factory = pkg.calls.find(row => row.name === 'ChainWhisperFixedEngineFactory').predictedAddress;
  const names = { positionNFT: 'ChainWhisperDexPositionNFT', terminalEvaluator: 'ChainWhisperDexWideTerminalGT', fixedEngine: 'ChainWhisperFixedEngine' };
  assert.equal(pkg.nonceStep, '2');
  for (const [name, nonce] of Object.entries(FACTORY_CHILD_NONCES)) {
    assert.equal(getCreateAddress({ from: factory, nonce }).toLowerCase(), graph.companions[names[name]].toLowerCase());
  }
});

test('binds the existing d06 compiler and all confirmed constructors without network access', () => {
  const value = inputs();
  assert.equal(value.runtimes.length, 43);
  assert.equal(new Set(value.runtimes.map(row => row[1])).size, 43);
  assert.equal(value.pkg.expectedCore.toLowerCase(), '0x25bac9ae92197eaaf9a890e7095cc30a612caaf2');
  assert.equal(value.factoryStorage[3][1], '0x' + BigInt(value.pkg.expectedCore).toString(16).padStart(64, '0'));
});

test('rejects the wrong chain before any contract or storage read', async () => {
  const methods = [];
  await assert.rejects(collect(async method => { methods.push(method); return '0x1'; }, inputs()), /CHAIN/);
  assert.deepEqual(methods, ['eth_chainId']);
});

test('replays every saved public input to the exact complete d06 read identity', async () => {
  assert.equal(capture.schema, 'D06_APP_PUBLIC_BINDING_V1');
  const input = inputs(), data = await collect(replay(capture.reads), input);
  assert.equal(data.graph, 'd06b6640dad22e5018a5e50d46602fd6d9b534d0b8eb4497cb5b42aee55e5962');
  assert.equal(data.packageSha256, 'f6ad0271b231c1926a8b79c262262b94372ccc13640b3ebc5dbd51552c839ab8');
  assert.equal(data.core, '0x25bac9ae92197eaaf9a890e7095cc30a612caaf2');
  assert.equal(data.runtimes.length, 46);
  assert.equal(data.companions.length, 4);
  assert.equal(data.tokens.length, 2);
  assert.deepEqual(data.factoryStorage, input.factoryStorage);
  assert.equal(data.readyToSign, false);
  assert.deepEqual(data.attestationBlock, { number: '9947207', hash: '0x8f150b1c2023980dd3ef0dd7abe57c23624d59911a33aa9ff4d4a4a4a123a072' });
  // Pin the whole returned descriptor, including every companion and runtime row.
  assert.equal(createHash('sha256').update(JSON.stringify(data)).digest('hex'), '0aa630d033db523b5988bbf1d0e1ee44da7829ae3d03ace83ff4aaa3ec852059');
  checkMatcher(matcherRead(input, capture.reads).result, input);
});

test('rejects changed embedded matcher bytecode through the exact checker and full capture replay', async () => {
  const input = inputs(), rows = structuredClone(capture.reads), row = matcherRead(input, rows);
  row.result = (row.result.slice(0, 4) === '0x00' ? '0x01' : '0x00') + row.result.slice(4);
  assert.throws(() => checkMatcher(row.result, input), /EXACT_EMBEDDED_MATCHER/);
  await assert.rejects(collect(replay(rows), input), /ChainWhisperDirectLimitMatch:.*EXACT_EMBEDDED_MATCHER/);
});

test('rejects a changed public evaluator binding in the saved Core getter', async () => {
  const input = inputs(), rows = structuredClone(capture.reads), api = input.api('ChainWhisperDexCore');
  const data = api.encodeFunctionData('terminalEvaluatorBindingCommitment');
  const row = rows.find(row => row.method === 'eth_call' && lower(row.params[0].to) === lower(input.pkg.expectedCore) && row.params[0].data === data);
  assert(row, 'SAVED_EVALUATOR_BINDING_REQUIRED');
  row.result = api.encodeFunctionResult('terminalEvaluatorBindingCommitment', ['0x' + '11'.repeat(32)]);
  await assert.rejects(collect(replay(rows), input), /EVALUATOR_BINDING/);
});

test('rejects changed public factory constructor storage', async () => {
  const input = inputs(), rows = structuredClone(capture.reads);
  const row = rows.find(row => row.method === 'eth_getStorageAt' && lower(row.params[0]) === lower(input.factory.predictedAddress) && BigInt(row.params[1]) === 10n);
  assert(row, 'SAVED_FACTORY_STORAGE_REQUIRED');
  row.result = '0x' + '00'.repeat(32);
  await assert.rejects(collect(replay(rows), input), /FACTORY_SLOT/);
});

test('rejects a changed final canonical block after the public read closure', async () => {
  const input = inputs(), rows = structuredClone(capture.reads);
  const head = rows.find(row => row.method === 'eth_getBlockByNumber' && row.params[0] === 'latest').result;
  const row = rows.find(row => row.method === 'eth_getBlockByNumber' && row.params[0] === head.number);
  assert(row, 'SAVED_FINAL_BLOCK_REQUIRED');
  row.result.hash = '0x' + '11'.repeat(32);
  await assert.rejects(collect(replay(rows), input), /FINAL_BLOCK/);
});
