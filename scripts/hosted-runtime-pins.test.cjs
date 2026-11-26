'use strict';
// CW-140.07: hosted runtime pins come from one place and must agree.
const test = require('node:test');
const assert = require('node:assert/strict');
const {sha, checkPins, buildPins, appendRecordedWindows, watchdogPins} = require('./hosted-runtime-pins.cjs');

const d = n => n.toString(16).padStart(64, '0');
const fixture = () => {
  const manifest = Buffer.from(JSON.stringify({graph: 'g', files: {'a.cjs': sha(Buffer.from('a1')), 'b.cjs': sha(Buffer.from('b1'))}}, null, 2));
  const selection = Buffer.from(JSON.stringify({graph: 'g', manifest: sha(manifest)}));
  const watchdog = Buffer.from(`const runtimeManifestSha256 = build13 ? '${sha(manifest)}' : standing ? '${d(1)}' : '${d(2)}';\n` +
    `pinnedFiles: { [controller + '/runtime-selection.json']: '${sha(selection)}' }\n`);
  return {manifestBytes: manifest, selectionBytes: selection, watchdogBytes: watchdog};
};

test('builds all four pins for a changed source and keeps every other byte', () => {
  const f = fixture(), result = buildPins({...f, sources: {'a.cjs': Buffer.from('a2')}});
  const [source, manifest, selection, watchdog] = result.changes;
  assert.equal(source.target.endsWith('/a.cjs'), true);
  assert.equal(JSON.parse(manifest.bytes).files['a.cjs'], sha(Buffer.from('a2')));
  assert.equal(JSON.parse(manifest.bytes).files['b.cjs'], sha(Buffer.from('b1')));
  assert.equal(JSON.parse(selection.bytes).manifest, sha(manifest.bytes));
  assert.deepEqual(watchdogPins(watchdog.bytes.toString()), {manifest: sha(manifest.bytes), selection: sha(selection.bytes)});
  assert.doesNotThrow(() => checkPins({manifestBytes: manifest.bytes, selectionBytes: selection.bytes, watchdogBytes: watchdog.bytes,
    sources: {'a.cjs': Buffer.from('a2')}}));
});

test('refuses inputs whose pins already disagree (the CW-137 stale selection pin)', () => {
  const f = fixture(), staleSelection = Buffer.from(JSON.stringify({graph: 'g', manifest: sha(f.manifestBytes), note: 'changed'}));
  assert.throws(() => buildPins({...f, selectionBytes: staleSelection, sources: {'a.cjs': Buffer.from('a2')}}), /watchdog\.cjs: selection pin/);
  const wrongManifest = Buffer.from(JSON.stringify({graph: 'g', manifest: d(9)}));
  assert.throws(() => checkPins({...f, selectionBytes: wrongManifest}), /runtime-selection\.json: manifest pin/);
});

test('refuses unknown or unchanged sources', () => {
  const f = fixture();
  assert.throws(() => buildPins({...f, sources: {'c.cjs': Buffer.from('c')}}), /not a pinned runtime file/);
  assert.throws(() => buildPins({...f, sources: {'a.cjs': Buffer.from('a1')}}), /unchanged/);
  assert.throws(() => buildPins({...f, sources: {}}), /no changed source/);
});

test('appends recorded windows with or without a trailing comma and never leaves a hole', () => {
  const row = n => [d(n), d(n + 1), d(n + 2)];
  for (const trailing of [true, false]) {
    const src = `const x=1;\nconst originalReceiptReaderWindows=[\n  ${JSON.stringify(row(10))}${trailing ? ',' : ''}\n];\nfunction f(){}\n`;
    const {source, count} = appendRecordedWindows(src, [row(20), row(30)], 'test windows');
    assert.equal(count, 3);
    const list = Function(`"use strict";${source.slice(source.indexOf('const originalReceiptReaderWindows'), source.indexOf('\n];') + 3)}return originalReceiptReaderWindows;`)();
    assert.equal(list.length, 3);
    assert.equal(list.every(Boolean), true);
    assert.deepEqual(list[2], row(30));
  }
  const holed = `const originalReceiptReaderWindows=[\n  ${JSON.stringify(row(10))},,\n];\n`;
  assert.throws(() => appendRecordedWindows(holed, [row(20)], 'x'), /hole/);
  const once = `const originalReceiptReaderWindows=[\n  ${JSON.stringify(row(10))},\n];\n`;
  assert.throws(() => appendRecordedWindows(once, [row(10)], 'x'), /already recorded/);
});
