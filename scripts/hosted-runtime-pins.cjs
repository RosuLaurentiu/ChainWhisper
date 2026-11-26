'use strict';
// CW-140.07: builds every pin of a hosted build 13 runtime change from one place, and refuses a package whose pins
// disagree. On 2026-11-26 (CW-137) two host applies held: a hand-appended window list with a doubled comma, and a
// watchdog that still pinned the old controller selection. Local and read-only on the host copies; it never installs.
//
// Pins of the hosted build 13 runtime:
//   runtime-public.json .files[<source>]          sha256 of each runtime source file
//   controller runtime-selection.json .manifest    sha256 of runtime-public.json
//   watchdog.cjs build13 runtimeManifestSha256     sha256 of runtime-public.json (a literal)
//   watchdog.cjs pinnedFiles runtime-selection     sha256 of runtime-selection.json (a literal)
//
// CLI: node scripts/hosted-runtime-pins.cjs <host-copies dir> <out dir> <repo root> <source path>...
//   <host-copies dir> holds the current host runtime-public.json, runtime-selection.json and watchdog.cjs.
//   Each <source path> is repo-relative and is read from <repo root>. Writes <out dir>/file-N and changes.json.
const fs = require('node:fs'), path = require('node:path');
const {createHash} = require('node:crypto');

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const DIGEST = /^[0-9a-f]{64}$/;
const HOST = Object.freeze({
  root: '/opt/chainwhisper-beta-5045070b-4671ad7a',
  controller: '/opt/chainwhisper-c1-controller-4671ad7a',
  watchdog: '/opt/server-dashboard/modules/chainwhisper-beta/watchdog.cjs',
});

const fail = message => { throw new Error(message); };
const replaceOnce = (text, from, to, what) => {
  const count = text.split(from).length - 1;
  if (count !== 1) fail(`${what}: expected exactly one occurrence, found ${count}`);
  return text.replace(from, to);
};

/** The build 13 pins that a watchdog file holds as literals. */
function watchdogPins(text) {
  const manifest = /const runtimeManifestSha256 = build13 \? '([0-9a-f]{64})'/.exec(text)?.[1];
  const selection = /\[controller \+ '\/runtime-selection\.json'\]: '([0-9a-f]{64})'/.exec(text)?.[1];
  if (!manifest || !selection) fail('watchdog: build 13 manifest or selection pin not found');
  return {manifest, selection};
}

/** Checks that the four pin kinds agree. Returns the digests. */
function checkPins({manifestBytes, selectionBytes, watchdogBytes, sources = {}}) {
  const manifest = JSON.parse(manifestBytes), selection = JSON.parse(selectionBytes);
  const manifestSha = sha(manifestBytes), selectionSha = sha(selectionBytes), pins = watchdogPins(watchdogBytes.toString('utf8'));
  if (!manifest.files || typeof manifest.files !== 'object') fail('runtime-public.json: files map missing');
  for (const [file, bytes] of Object.entries(sources))
    if (manifest.files[file] !== sha(bytes)) fail(`runtime-public.json: ${file} pin ${manifest.files[file]} differs from the source ${sha(bytes)}`);
  if (selection.manifest !== manifestSha) fail(`runtime-selection.json: manifest pin ${selection.manifest} differs from runtime-public.json ${manifestSha}`);
  if (pins.manifest !== manifestSha) fail(`watchdog.cjs: manifest pin ${pins.manifest} differs from runtime-public.json ${manifestSha}`);
  if (pins.selection !== selectionSha) fail(`watchdog.cjs: selection pin ${pins.selection} differs from runtime-selection.json ${selectionSha}`);
  return {manifestSha, selectionSha, watchdogSha: sha(watchdogBytes)};
}

/** Builds the changed runtime files for new source bytes. Only pin values change; every other byte stays. */
function buildPins({manifestBytes, selectionBytes, watchdogBytes, sources}) {
  if (!sources || !Object.keys(sources).length) fail('no changed source files');
  const before = checkPins({manifestBytes, selectionBytes, watchdogBytes});
  const manifest = JSON.parse(manifestBytes);
  let manifestText = manifestBytes.toString('utf8');
  const changes = [];
  for (const [file, bytes] of Object.entries(sources)) {
    const previous = manifest.files[file];
    if (!DIGEST.test(previous ?? '')) fail(`runtime-public.json: ${file} is not a pinned runtime file`);
    if (previous === sha(bytes)) fail(`${file}: source is unchanged`);
    manifestText = replaceOnce(manifestText, `"${file}": "${previous}"`, `"${file}": "${sha(bytes)}"`, `runtime-public.json pin of ${file}`);
    changes.push({target: `${HOST.root}/${file}`, previous, bytes});
  }
  const newManifest = Buffer.from(manifestText, 'utf8'), manifestSha = sha(newManifest);
  const parsed = JSON.parse(newManifest);
  for (const key of Object.keys(manifest.files)) if (!(key in sources) && parsed.files[key] !== manifest.files[key]) fail(`runtime-public.json: ${key} changed`);
  const newSelection = Buffer.from(replaceOnce(selectionBytes.toString('utf8'), before.manifestSha, manifestSha, 'runtime-selection.json manifest pin'), 'utf8');
  let watchdogText = watchdogBytes.toString('utf8');
  watchdogText = replaceOnce(watchdogText, `'${before.manifestSha}'`, `'${manifestSha}'`, 'watchdog manifest pin');
  watchdogText = replaceOnce(watchdogText, `'${before.selectionSha}'`, `'${sha(newSelection)}'`, 'watchdog selection pin');
  const newWatchdog = Buffer.from(watchdogText, 'utf8');
  const after = checkPins({manifestBytes: newManifest, selectionBytes: newSelection, watchdogBytes: newWatchdog, sources});
  changes.push({target: `${HOST.root}/runtime-public.json`, previous: before.manifestSha, bytes: newManifest});
  changes.push({target: `${HOST.controller}/runtime-selection.json`, previous: before.selectionSha, bytes: newSelection});
  changes.push({target: HOST.watchdog, previous: before.watchdogSha, bytes: newWatchdog});
  return {before, after, changes: changes.map(row => ({...row, digest: sha(row.bytes)}))};
}

/**
 * Appends recorded closed windows ([bundle, journal, cursor] digests) to `originalReceiptReaderWindows` in
 * rehearsal-continuation.cjs. It works with or without a trailing comma, refuses duplicates and checks the result
 * by counting the parsed rows (the CW-137 doubled comma made a hole at window 105).
 */
function appendRecordedWindows(source, rows, comment) {
  if (!rows.length || !rows.every(row => Array.isArray(row) && row.length === 3 && row.every(v => DIGEST.test(v)))) fail('windows: invalid rows');
  const start = source.indexOf('const originalReceiptReaderWindows=['), end = source.indexOf('\n];', start);
  if (start < 0 || end < 0) fail('windows: list not found');
  const body = source.slice(start + 'const originalReceiptReaderWindows=['.length, end);
  const parse = text => Function(`"use strict";return [${text}];`)();
  // Array.some skips the empty slots of a sparse array; check every index.
  const holed = list => Array.from({length: list.length}, (_, i) => i in list).includes(false);
  const existing = parse(body);
  if (holed(existing)) fail('windows: the current list has a hole');
  const seen = new Set(existing.map(row => row[0]));
  if (rows.some(row => seen.has(row[0]))) fail('windows: a bundle is already recorded');
  const trimmed = body.replace(/\s+$/, ''), separator = trimmed.endsWith(',') ? '' : ',';
  const added = `${separator}\n  // ${comment}\n${rows.map(row => `  ${JSON.stringify(row)}`).join(',\n')},`;
  const next = source.slice(0, start) + 'const originalReceiptReaderWindows=[' + trimmed + added + source.slice(end);
  const after = parse(next.slice(start + 'const originalReceiptReaderWindows=['.length, next.indexOf('\n];', start)));
  if (after.length !== existing.length + rows.length || holed(after)) fail('windows: appended list does not count correctly');
  return {source: next, count: after.length};
}

function main(argv) {
  const [hostDir, outDir, repoRoot, ...files] = argv;
  if (!hostDir || !outDir || !repoRoot || !files.length) fail('usage: hosted-runtime-pins.cjs <host-copies dir> <out dir> <repo root> <source path>...');
  const read = name => fs.readFileSync(path.join(hostDir, name));
  const sources = Object.fromEntries(files.map(file => [file, fs.readFileSync(path.join(repoRoot, file))]));
  const result = buildPins({manifestBytes: read('runtime-public.json'), selectionBytes: read('runtime-selection.json'),
    watchdogBytes: read('watchdog.cjs'), sources});
  fs.mkdirSync(outDir, {recursive: true});
  const changes = result.changes.map((row, i) => {
    fs.writeFileSync(path.join(outDir, `file-${i}`), row.bytes);
    return {target: row.target, previous: row.previous, digest: row.digest, file: `file-${i}`};
  });
  fs.writeFileSync(path.join(outDir, 'changes.json'), JSON.stringify(changes, null, 2) + '\n');
  return {status: 'HOSTED_RUNTIME_PINS_BUILT', runtimeManifestSha256: result.after.manifestSha,
    selectionSha256: result.after.selectionSha, watchdogSha256: result.after.watchdogSha, changes, noNetwork: true, noInstall: true};
}

module.exports = {sha, watchdogPins, checkPins, buildPins, appendRecordedWindows, HOST};
if (require.main === module) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)), null, 1)); }
  catch (error) { console.error(`hosted-runtime-pins: ${error.message}`); process.exitCode = 1; }
}
