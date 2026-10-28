/* global require */
/* eslint-disable @typescript-eslint/no-require-imports -- Offline candidate tests. */
'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const adapter = require('./prepare-current-dex-history-candidate.cjs');

test('history public adapter binds all frozen constructors and exact embedded Engine output', async () => {
  const input = adapter.inputs(), result = await adapter.main('--check-inputs');
  assert.equal(input.pkg.artifactGraphSha256, input.embedded.graph);
  assert.equal(input.runtimes.length, 44); assert.equal(input.protocol.stages.workCalls, 4);
  assert.equal(result.noNetwork, true); assert.equal(result.readyToSign, false);
});

test('history public adapter rejects unsupported modes before any provider is created', async () => {
  await assert.rejects(adapter.main('--send'), /HISTORY_PUBLIC_MODE/);
});

test('history capture from another graph cannot reach the collector or emit a candidate', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-history-binding-'));
  const file = path.join(folder, 'capture.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ schema: 'HISTORY_APP_PUBLIC_BINDING_V1',
      destination: 'wss://testnet.coti.io/ws', graph: 'wrong', reads: [] }));
    await assert.rejects(adapter.main('--check', file), /Expected values to be strictly equal/);
  } finally { fs.unlinkSync(file); fs.rmdirSync(folder); }
});
