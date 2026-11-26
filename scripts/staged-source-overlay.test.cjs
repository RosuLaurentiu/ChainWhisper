'use strict';
// CW-140.07: a restart check can load staged runtime code while file reads still see the installed bytes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFileSync} = require('node:child_process');

test('require() loads the staged file; readFileSync still returns the installed bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-'));
  try {
    const installed = path.join(dir, 'runtime.cjs'), staged = path.join(dir, 'staged.cjs'), entry = path.join(dir, 'entry.cjs');
    fs.writeFileSync(installed, "module.exports='installed';");
    fs.writeFileSync(staged, "module.exports='staged';");
    fs.writeFileSync(entry, "const fs=require('fs');process.stdout.write(JSON.stringify({loaded:require('./runtime.cjs'),read:fs.readFileSync(__dirname+'/runtime.cjs','utf8')}));");
    const run = env => JSON.parse(execFileSync(process.execPath, ['--require', path.join(__dirname, 'staged-source-overlay.cjs'), entry],
      {env: {...process.env, ...env}, encoding: 'utf8'}));
    assert.deepEqual(run({CHAINWHISPER_STAGED_OVERLAY: JSON.stringify({[installed]: staged})}), {loaded: 'staged', read: "module.exports='installed';"});
    assert.deepEqual(run({CHAINWHISPER_STAGED_OVERLAY: ''}), {loaded: 'installed', read: "module.exports='installed';"});
    assert.throws(() => run({CHAINWHISPER_STAGED_OVERLAY: JSON.stringify({[installed]: path.join(dir, 'missing.cjs')})}));
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
