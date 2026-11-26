'use strict';
// CW-140.07: lets a read-only restart check run new runtime code before any host file is written.
// Preload with `node --require <this file>` and set CHAINWHISPER_STAGED_OVERLAY to a JSON object
// {"<absolute installed path>": "<absolute staged path>"}. A require() of an installed path loads the staged file.
// Only module loading changes: file reads (for example source digests) still see the installed bytes, so a check
// that compares installed digests keeps working. Never use it for a service start.
const Module = require('node:module'), fs = require('node:fs'), path = require('node:path');

const raw = process.env.CHAINWHISPER_STAGED_OVERLAY;
if (raw) {
  let map;
  try { map = JSON.parse(raw); } catch { throw new Error('CHAINWHISPER_STAGED_OVERLAY is not valid JSON.'); }
  if (!map || typeof map !== 'object' || Array.isArray(map) || !Object.keys(map).length) throw new Error('CHAINWHISPER_STAGED_OVERLAY is empty.');
  const overlay = new Map();
  for (const [installed, staged] of Object.entries(map)) {
    if (!path.isAbsolute(installed) || !path.isAbsolute(staged) || !fs.statSync(staged).isFile())
      throw new Error(`Staged overlay entry is invalid: ${installed}`);
    overlay.set(path.resolve(installed), path.resolve(staged));
  }
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function stagedResolve(request, parent, ...rest) {
    const resolved = resolve.call(this, request, parent, ...rest);
    return overlay.get(resolved) ?? resolved;
  };
  process.env.CHAINWHISPER_STAGED_OVERLAY_ACTIVE = String(overlay.size);
}
