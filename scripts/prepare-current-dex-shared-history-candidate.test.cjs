/* global require, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Offline candidate tests. */
'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const adapter = require('./prepare-current-dex-shared-history-candidate.cjs');
const prepared = require('./prepare-current-dex-prepared-candidate.cjs');
const report = path.resolve(__dirname, '../reports/shared-history-candidate-2026-10-13');
const root = path.resolve(__dirname, '../../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13');

test('shared-history adapter binds all44 constructor/source/package records and exact frozen Engine proof without network or credentials', async () => {
  const read = fs.readFileSync, oldFetch = global.fetch;
  fs.readFileSync = function(file, ...args) { assert(!/(?:^|[\\/])\.env(?:[.\\/]|$)|credentials\.json|private.keys/i.test(String(file))); return read.call(this, file, ...args); };
  global.fetch = () => assert.fail('NO_NETWORK');
  try {
    const input = adapter.inputs(), result = await adapter.main('--check-inputs');
    assert.equal(input.pkg.artifactGraphSha256, adapter.GRAPH);
    assert.equal(input.frozen.manifest.binding.graphSha256, input.embedded.graph);
    assert.equal(input.pkg.expectedCore, adapter.CORE); assert.equal(input.packageSha256, adapter.PACKAGE);
    assert.equal(input.runtimes.length, 44); assert.equal(input.protocol.stages.workCalls, 4);
    assert.equal(input.minimumBlock, '10064595'); assert.equal(result.constructors, 44);
    assert.equal(result.noNetwork, true); assert.equal(result.readyToSign, false);
    assert.equal(result.fullFixtureAdmission, false); assert.equal(result.connectedAppWalletHeld, true);
  } finally { fs.readFileSync = read; global.fetch = oldFetch; }
});

test('saved constructor journal rejects missing/pending records, source/package drift, hash/nonce gaps and bad runtime metadata', () => {
  const input = adapter.baseInputs(), rows = fs.readFileSync(path.join(root, 'native-deployment-1/journal.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse), sources = require(path.join(root, 'native-deployment.cjs')).sourcePins();
  assert.equal(adapter.verifyJournal(rows, input.pkg, sources).length, 44);
  for (const mutate of [
    x => x.pop(), x => x[0].packageSha256 = 'wrong', x => x[0].graph = 'wrong',
    x => x.find(r => r.kind === 'signed').hash = '0x' + '11'.repeat(32),
    x => x[0].nonce = '1', x => x.push(structuredClone(x.at(-1))),
    x => x.find(r => r.kind === 'verified').status = 0,
    x => x.find(r => r.kind === 'verified').address = input.pkg.actor,
    x => x.find(r => r.kind === 'verified').runtimeHash = '0x00',
  ]) { const changed = structuredClone(rows); mutate(changed); assert.throws(() => adapter.verifyJournal(changed, input.pkg, sources)); }
});

test('embedded verifier rejects another graph Engine creation/runtime and changed embedded assembly', () => {
  const input = adapter.baseInputs(), output = JSON.parse(fs.readFileSync(path.join(report, 'engine-assembly.json'))), key = input.frozen.artifacts.ChainWhisperFixedEngine.sourceName;
  assert.equal(prepared.verifyEmbedded(output, input, adapter.GRAPH).graph, adapter.GRAPH);
  for (const mutate of [
    x => x.contracts[key].ChainWhisperFixedEngine.evm.bytecode.object += '00',
    x => x.contracts[key].ChainWhisperFixedEngine.evm.deployedBytecode.object += '00',
    x => x.contracts[key].ChainWhisperFixedEngine.evm.legacyAssembly['.data']['1']['.data']['0']['.auxdata'] = '00',
  ]) { const changed = structuredClone(output); mutate(changed); assert.throws(() => prepared.verifyEmbedded(changed, input, adapter.GRAPH)); }
});

test('unsupported send/enable modes and old-graph captures cannot reach the maintained collector', async () => {
  for (const mode of ['--send', '--enable', '--run', '--sign']) await assert.rejects(adapter.main(mode), /HISTORY_PUBLIC_MODE/);
  const folder = fs.mkdtempSync(path.join(report, 'test-read-')), file = path.join(folder, 'capture.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ schema: 'SHARED_HISTORY_APP_PUBLIC_BINDING_V1', destination: 'wss://testnet.coti.io/ws', graph: '3717c866cd23fcd793f98753df5fc5974d25cdffbc5d57633bca353aaa13fdc1', packageSha256: adapter.PACKAGE, reads: [] }));
    await assert.rejects(adapter.main('--check', file), /Expected values to be strictly equal/);
    fs.writeFileSync(file, JSON.stringify({ schema: 'SHARED_HISTORY_APP_PUBLIC_BINDING_V1', destination: 'wss://testnet.coti.io/ws', graph: adapter.GRAPH, packageSha256: 'wrong', reads: [] }));
    await assert.rejects(adapter.main('--check', file), /Expected values to be strictly equal/);
  } finally { fs.unlinkSync(file); fs.rmdirSync(folder); }
});
