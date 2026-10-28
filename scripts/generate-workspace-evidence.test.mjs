import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildWorkspaceEvidenceReport,
  collectRepositoryEvidence,
  isSensitiveWorkspacePath,
  parsePorcelainStatus,
  redactWorkspacePath
} from './generate-workspace-evidence.mjs';

const run = (root, args) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
}).trim();

const createRepository = () => {
  const root = mkdtempSync(join(tmpdir(), 'chainwhisper-workspace-evidence-'));
  run(root, ['init']);
  run(root, ['config', 'user.email', 'workspace-evidence@example.invalid']);
  run(root, ['config', 'user.name', 'Workspace Evidence Test']);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'index.js'), 'export const value = 1;\n');
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  run(root, ['add', '.']);
  run(root, ['commit', '-m', 'fixture']);
  return root;
};

test('parses NUL-delimited Git status without path quoting', () => {
  assert.deepEqual(parsePorcelainStatus(' M src/a.js\0?? notes with spaces.md\0'), [
    { status: ' M', path: 'src/a.js', originalPath: undefined },
    { status: '??', path: 'notes with spaces.md', originalPath: undefined }
  ]);
  assert.throws(() => parsePorcelainStatus('bad\0'), /malformed/u);
});

test('redacts secret-like paths but keeps public examples reviewable', () => {
  assert.equal(isSensitiveWorkspacePath('.env.local'), true);
  assert.equal(isSensitiveWorkspacePath('proof/private-key.json'), true);
  assert.equal(isSensitiveWorkspacePath('.env.example'), false);
  assert.match(redactWorkspacePath('.env.local'), /^\[redacted-sensitive-path:[0-9a-f]{12}\]$/u);
  assert.equal(redactWorkspacePath('src/walletOptions.ts'), 'src/walletOptions.ts');
});

test('collects deterministic identities and never serializes file contents or sensitive paths', () => {
  const root = createRepository();
  try {
    writeFileSync(join(root, 'src', 'index.js'), 'export const value = 2;\n');
    writeFileSync(join(root, 'notes.md'), 'review me\n');
    writeFileSync(join(root, '.env.local'), 'PRIVATE_KEY=must-not-appear\n');
    const first = collectRepositoryEvidence({ name: 'Fixture', root });
    const second = collectRepositoryEvidence({ name: 'Fixture', root });
    assert.deepEqual(first, second);
    assert.equal(first.counts.total, 3);
    assert.equal(first.counts.modified, 1);
    assert.equal(first.counts.untracked, 2);
    assert.equal(first.lockfiles['package-lock.json'].length, 64);
    const report = buildWorkspaceEvidenceReport({
      repositories: [first], gitVersion: 'git version test', nodeVersion: 'v-test'
    });
    assert.doesNotMatch(report, /PRIVATE_KEY|must-not-appear|\.env\.local/u);
    assert.match(report, /redacted-sensitive-path/u);
    assert.match(report, /src\/index\.js/u);
    assert.match(report, /notes\.md/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('can exclude its own generated output from the evidence identity', () => {
  const root = createRepository();
  try {
    const output = join(root, 'docs', 'WORKSPACE_CURRENT_STATE.md');
    mkdirSync(join(root, 'docs'));
    writeFileSync(output, 'first\n');
    const first = collectRepositoryEvidence({ name: 'Fixture', root, excludedPaths: [output] });
    writeFileSync(output, 'second\n');
    const second = collectRepositoryEvidence({ name: 'Fixture', root, excludedPaths: [output] });
    assert.deepEqual(first, second);
    assert.equal(first.counts.total, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
