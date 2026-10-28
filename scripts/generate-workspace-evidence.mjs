import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_ROOT = resolve(APP_ROOT, '..');
export const WORKSPACE_EVIDENCE_OUTPUT = resolve(APP_ROOT, 'docs', 'WORKSPACE_CURRENT_STATE.md');
export const WORKSPACE_CLASSIFICATION_OUTPUT = resolve(APP_ROOT, 'docs', 'WORKSPACE_CHANGE_CLASSIFICATION.md');

export const WORKSPACE_REPOSITORIES = Object.freeze([
  Object.freeze({ name: 'APP', root: resolve(WORKSPACE_ROOT, 'APP') }),
  Object.freeze({ name: 'Contracts', root: resolve(WORKSPACE_ROOT, 'ChainWhisper Contracts') }),
  Object.freeze({ name: 'MCP', root: resolve(WORKSPACE_ROOT, 'MCP') })
]);

const LOCKFILES = Object.freeze(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);
const SENSITIVE_FILE = /(?:^|\/)(?:\.env(?:\.|$)|secrets?(?:\/|$)|credentials?(?:\/|$))|(?:private[-_]?key|mnemonic|seed[-_]?phrase|keystore|aes[-_]?key)|\.(?:pem|p12|pfx|jks|key)$/iu;
const SAFE_ENV_EXAMPLE = /(?:^|\/)\.env(?:\.[^/]*)?\.example$|(?:^|\/)\.env\.example$/iu;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const normalizePath = (value) => value.split(sep).join('/').replaceAll('\\', '/');
const markdownCell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

const git = (root, args, { optional = false } = {}) => {
  try {
    return execFileSync('git', [
      '-c',
      `safe.directory=${normalizePath(root)}`,
      '-C',
      root,
      ...args
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }).trimEnd();
  } catch (error) {
    if (optional) return '';
    const detail = error?.stderr?.toString().trim();
    throw new Error(detail || `Git command failed for ${basename(root)}.`);
  }
};

export const isSensitiveWorkspacePath = (path) => {
  const normalized = normalizePath(path);
  return !SAFE_ENV_EXAMPLE.test(normalized) && SENSITIVE_FILE.test(normalized);
};

export const redactWorkspacePath = (path) => isSensitiveWorkspacePath(path)
  ? `[redacted-sensitive-path:${sha256(normalizePath(path)).slice(0, 12)}]`
  : normalizePath(path);

const classifyPath = (path) => {
  const normalized = normalizePath(path).toLowerCase();
  if (isSensitiveWorkspacePath(normalized)) return 'sensitive';
  if (/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[^/]+$/u.test(normalized)) return 'test';
  if (/\.(?:md|mdx|txt)$/u.test(normalized) || /(?:^|\/)docs?(?:\/|$)/u.test(normalized)) return 'documentation';
  if (/(?:^|\/)(?:artifacts|cache|coverage|dist|build|deployments?|runtime)(?:\/|$)/u.test(normalized)) return 'generated/deployment';
  if (/(?:^|\/)(?:src|contracts|scripts|workers|supabase)(?:\/|$)|\.(?:ts|tsx|js|jsx|mjs|cjs|sol|sql)$/u.test(normalized)) return 'source';
  if (/(?:^|\/)(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|eslint[^/]*|vite[^/]*|hardhat[^/]*|\.github)(?:\/|$)/u.test(normalized)) return 'configuration';
  return 'other';
};

export const parsePorcelainStatus = (text) => {
  if (!text) return [];
  const records = text.split('\0');
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== ' ') {
      throw new Error('Git porcelain status record is malformed.');
    }
    const status = record.slice(0, 2);
    const path = record.slice(3);
    let originalPath;
    if (status.includes('R') || status.includes('C')) {
      originalPath = records[index + 1];
      if (!originalPath) throw new Error('Git rename/copy status is missing its original path.');
      index += 1;
    }
    entries.push(Object.freeze({ status, path, originalPath }));
  }
  return entries;
};

const diffTotals = (text) => {
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  let binaries = 0;
  for (const line of text.split(/\r?\n/u)) {
    if (!line) continue;
    const [added, removed] = line.split('\t', 3);
    files += 1;
    if (added === '-' || removed === '-') {
      binaries += 1;
      continue;
    }
    insertions += Number.parseInt(added, 10);
    deletions += Number.parseInt(removed, 10);
  }
  return Object.freeze({ files, insertions, deletions, binaries });
};

const countStatuses = (entries) => {
  const result = {
    total: entries.length,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    added: 0,
    modified: 0,
    deleted: 0,
    renamedOrCopied: 0,
    conflicted: 0
  };
  for (const entry of entries) {
    const [indexStatus, worktreeStatus] = entry.status;
    if (entry.status === '??') result.untracked += 1;
    if (indexStatus !== ' ' && indexStatus !== '?') result.staged += 1;
    if (worktreeStatus !== ' ' || entry.status === '??') result.unstaged += 1;
    if (entry.status.includes('A') || entry.status === '??') result.added += 1;
    if (entry.status.includes('M')) result.modified += 1;
    if (entry.status.includes('D')) result.deleted += 1;
    if (entry.status.includes('R') || entry.status.includes('C')) result.renamedOrCopied += 1;
    if (/[U]/u.test(entry.status) || ['AA', 'DD'].includes(entry.status)) result.conflicted += 1;
  }
  return Object.freeze(result);
};

const lockfileHashes = (root) => Object.freeze(Object.fromEntries(LOCKFILES.flatMap((file) => {
  const path = resolve(root, file);
  return existsSync(path) ? [[file, sha256(readFileSync(path))]] : [];
})));

export const collectRepositoryEvidence = ({ name, root, excludedPaths = [] }) => {
  const absoluteRoot = resolve(root);
  const excluded = new Set(excludedPaths.map((path) => normalizePath(relative(absoluteRoot, resolve(path)))));
  const rawEntries = parsePorcelainStatus(git(absoluteRoot, [
    'status', '--porcelain=v1', '-z', '--untracked-files=all'
  ]));
  const entries = rawEntries.filter((entry) =>
    !excluded.has(normalizePath(entry.path)) &&
    (!entry.originalPath || !excluded.has(normalizePath(entry.originalPath)))
  );
  const upstream = git(absoluteRoot, [
    'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'
  ], { optional: true });
  const divergence = upstream
    ? git(absoluteRoot, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`]).split(/\s+/u)
    : [];
  const statusIdentity = entries
    .map((entry) => `${entry.status}\0${normalizePath(entry.path)}\0${normalizePath(entry.originalPath ?? '')}`)
    .sort()
    .join('\n');
  const branch = git(absoluteRoot, ['symbolic-ref', '--short', '-q', 'HEAD'], { optional: true }) || '(detached)';
  return Object.freeze({
    name,
    root: normalizePath(relative(WORKSPACE_ROOT, absoluteRoot)),
    head: git(absoluteRoot, ['rev-parse', 'HEAD']),
    tree: git(absoluteRoot, ['rev-parse', 'HEAD^{tree}']),
    branch,
    upstream: upstream || null,
    ahead: upstream ? Number.parseInt(divergence[0], 10) : null,
    behind: upstream ? Number.parseInt(divergence[1], 10) : null,
    trackedFiles: git(absoluteRoot, ['ls-files', '-z']).split('\0').filter(Boolean).length,
    statusDigest: sha256(statusIdentity),
    counts: countStatuses(entries),
    unstagedDiff: diffTotals(git(absoluteRoot, ['diff', '--numstat'])),
    stagedDiff: diffTotals(git(absoluteRoot, ['diff', '--cached', '--numstat'])),
    lockfiles: lockfileHashes(absoluteRoot),
    entries: Object.freeze(entries.map((entry) => Object.freeze({
      status: entry.status,
      category: classifyPath(entry.path),
      path: redactWorkspacePath(entry.path),
      originalPath: entry.originalPath ? redactWorkspacePath(entry.originalPath) : null
    })))
  });
};

export const buildWorkspaceEvidenceReport = ({ repositories, gitVersion, nodeVersion }) => {
  const evidenceId = sha256(JSON.stringify(repositories));
  const lines = [
    '# ChainWhisper Current Workspace Evidence',
    '',
    `Evidence ID: \`${evidenceId}\``,
    '',
    'This report is a deterministic, read-only inventory of the APP, Contracts, and MCP Git worktrees. It records no file contents, environment values, private keys, wallet material, RPC responses, or test claims. Sensitive-looking paths are replaced by deterministic redacted identifiers.',
    '',
    `Toolchain: ${gitVersion}; Node ${nodeVersion}.`,
    '',
    '## Repository identities',
    '',
    '| Repository | Branch | HEAD | Committed tree | Upstream | Ahead / behind | Tracked files | Dirty paths | Status digest |',
    '|---|---|---|---|---|---:|---:|---:|---|'
  ];
  for (const repository of repositories) {
    lines.push(`| ${markdownCell(repository.name)} | ${markdownCell(repository.branch)} | \`${repository.head}\` | \`${repository.tree}\` | ${markdownCell(repository.upstream ?? 'none')} | ${repository.upstream ? `${repository.ahead} / ${repository.behind}` : 'n/a'} | ${repository.trackedFiles} | ${repository.counts.total} | \`${repository.statusDigest}\` |`);
  }
  lines.push('', '## Change summary', '');
  for (const repository of repositories) {
    const counts = repository.counts;
    lines.push(`### ${repository.name}`, '');
    lines.push(`- Status: ${counts.total === 0 ? 'clean' : 'dirty'}; staged ${counts.staged}, unstaged ${counts.unstaged}, untracked ${counts.untracked}, conflicts ${counts.conflicted}.`);
    lines.push(`- Paths: added ${counts.added}, modified ${counts.modified}, deleted ${counts.deleted}, renamed/copied ${counts.renamedOrCopied}.`);
    lines.push(`- Unstaged tracked diff: ${repository.unstagedDiff.files} files, +${repository.unstagedDiff.insertions}/-${repository.unstagedDiff.deletions}, ${repository.unstagedDiff.binaries} binary.`);
    lines.push(`- Staged tracked diff: ${repository.stagedDiff.files} files, +${repository.stagedDiff.insertions}/-${repository.stagedDiff.deletions}, ${repository.stagedDiff.binaries} binary.`);
    const lockfiles = Object.entries(repository.lockfiles);
    lines.push(`- Lockfiles: ${lockfiles.length === 0 ? 'none' : lockfiles.map(([file, hash]) => `\`${file}\` \`${hash}\``).join('; ')}.`);
    if (repository.entries.length === 0) {
      lines.push('', 'No changed paths.', '');
      continue;
    }
    lines.push('', '| Git status | Category | Current path | Original path |', '|---|---|---|---|');
    for (const entry of repository.entries) {
      lines.push(`| \`${entry.status}\` | ${entry.category} | ${markdownCell(entry.path)} | ${markdownCell(entry.originalPath ?? '')} |`);
    }
    lines.push('');
  }
  lines.push(
    '## Interpretation boundary',
    '',
    '- This proves repository identity and worktree scope only. It does not prove that changes are correct, tested, reviewed, deployed, or releasable.',
    '- The status digest covers Git status and path identity, not file contents. Re-run the repository test/build/security gates separately and attach their evidence to the release candidate.',
    '- Classifications are mechanical routing hints, not Keep/Extract/Redesign/Legacy-only/Shelve decisions.',
    '',
    'Regenerate from `APP` with `npm run evidence:workspace`.',
    ''
  );
  return lines.join('\n');
};

export const generateWorkspaceEvidence = async ({
  repositories = WORKSPACE_REPOSITORIES,
  output = WORKSPACE_EVIDENCE_OUTPUT
} = {}) => {
  const evidence = repositories.map((repository) => collectRepositoryEvidence({
    ...repository,
    excludedPaths: repository.name === 'APP'
      ? [output, WORKSPACE_EVIDENCE_OUTPUT, WORKSPACE_CLASSIFICATION_OUTPUT]
      : []
  }));
  const report = buildWorkspaceEvidenceReport({
    repositories: evidence,
    gitVersion: execFileSync('git', ['--version'], { encoding: 'utf8' }).trim(),
    nodeVersion: process.version
  });
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.tmp`;
  await writeFile(temporary, report, { encoding: 'utf8', flag: 'w' });
  await rename(temporary, output);
  return Object.freeze({ output, evidenceId: sha256(JSON.stringify(evidence)), repositories: evidence });
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  generateWorkspaceEvidence().then(({ output, evidenceId, repositories }) => {
    process.stdout.write(`${JSON.stringify({
      status: 'workspace-evidence-written',
      output: normalizePath(relative(WORKSPACE_ROOT, output)),
      evidenceId,
      repositories: repositories.map(({ name, head, statusDigest, counts }) => ({
        name, head, statusDigest, dirtyPaths: counts.total
      }))
    }, null, 2)}\n`);
  }).catch(() => {
    process.stderr.write('Workspace evidence generation failed. No repository content was printed.\n');
    process.exitCode = 1;
  });
}
