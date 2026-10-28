import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWorkspaceClassificationReport,
  classifyWorkspaceChange,
  classifyWorkspaceRepositories
} from './generate-workspace-classification.mjs';

const entry = (path, category = 'source', status = '??') => ({
  path, category, status, originalPath: null
});

test('routes architecture anchors into the five explicit dispositions', () => {
  assert.equal(classifyWorkspaceChange({
    repository: 'APP', entry: entry('src/features/wallet/hooks/useBurnerWallet.ts', 'source', ' D')
  }).disposition, 'Keep');
  assert.equal(classifyWorkspaceChange({
    repository: 'APP', entry: entry('src/App.tsx')
  }).disposition, 'Redesign');
  assert.equal(classifyWorkspaceChange({
    repository: 'APP', entry: entry('src/lib/chatGc.ts')
  }).disposition, 'Legacy-only');
  assert.equal(classifyWorkspaceChange({
    repository: 'Contracts', entry: entry('deployments/coti-testnet-unified-candidate.json', 'generated/deployment')
  }).disposition, 'Extract');
  assert.equal(classifyWorkspaceChange({
    repository: 'Contracts', entry: entry('contracts/editable/ChainWhisperHiddenIntentEscrowV1.sol')
  }).disposition, 'Shelve');
  assert.equal(classifyWorkspaceChange({
    repository: 'Contracts', entry: entry('contracts/active/ChainWhisperRecurringOTCEscrowV1.sol')
  }).disposition, 'Legacy-only');
  assert.equal(classifyWorkspaceChange({
    repository: 'MCP', entry: entry('src/signer/networkEnvelopeV2.ts')
  }).disposition, 'Keep');
  assert.equal(classifyWorkspaceChange({
    repository: 'APP', entry: entry('[redacted-sensitive-path:123456789abc]', 'sensitive')
  }).disposition, 'Shelve');
  assert.equal(classifyWorkspaceChange({
    repository: 'APP', entry: entry('debug.log', 'other')
  }).disposition, 'Shelve');
  assert.equal(classifyWorkspaceChange({
    repository: 'APP', entry: entry('.env.example', 'other', ' M')
  }).confidence, 'medium');
});

test('classifies every supplied dirty path and preserves repository status identity', () => {
  const repositories = classifyWorkspaceRepositories([{
    name: 'APP',
    statusDigest: 'a'.repeat(64),
    entries: [
      entry('src/App.tsx'),
      entry('src/lib/directChatV2Runtime.ts'),
      entry('runtime/candidate.json', 'generated/deployment'),
      entry('[redacted-sensitive-path:123456789abc]', 'sensitive')
    ]
  }]);
  assert.equal(repositories[0].statusDigest, 'a'.repeat(64));
  assert.equal(repositories[0].entries.length, 4);
  assert.deepEqual(repositories[0].counts, {
    Keep: 1, Extract: 1, Redesign: 1, 'Legacy-only': 0, Shelve: 1
  });
  assert.equal(repositories[0].entries.every((value) => value.disposition && value.reason), true);
});

test('builds deterministic provisional output without approving or exposing secrets', () => {
  const repositories = classifyWorkspaceRepositories([{
    name: 'APP',
    statusDigest: 'b'.repeat(64),
    entries: [entry('[redacted-sensitive-path:123456789abc]', 'sensitive')]
  }]);
  const first = buildWorkspaceClassificationReport({ evidenceId: 'c'.repeat(64), repositories });
  const second = buildWorkspaceClassificationReport({ evidenceId: 'c'.repeat(64), repositories });
  assert.deepEqual(first, second);
  assert.match(first.report, /Status: provisional and non-destructive/u);
  assert.match(first.report, /redacted-sensitive-path/u);
  assert.doesNotMatch(first.report, /PRIVATE_KEY=|must-not-appear/u);
  assert.match(first.report, /No disposition.*is approved/u);
});
