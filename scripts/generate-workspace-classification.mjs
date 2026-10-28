import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  WORKSPACE_CLASSIFICATION_OUTPUT,
  WORKSPACE_REPOSITORIES,
  generateWorkspaceEvidence
} from './generate-workspace-evidence.mjs';

const DISPOSITIONS = Object.freeze(['Keep', 'Extract', 'Redesign', 'Legacy-only', 'Shelve']);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const normalized = (value) => value.split(sep).join('/').replaceAll('\\', '/');
const markdownCell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

const SUPERSEDED_OR_LOCAL_EVIDENCE = /(?:^|\/)(?:.*(?:superseded|rejected|proof-attempt|actor-preparation|actor-aes|user-funding).*)(?:\/|$)/iu;
const GENERATED_EVIDENCE = /(?:^|\/)(?:deployments?|runtime)(?:\/|$)/iu;
const APP_REDESIGN = new Set([
  'src/App.tsx',
  'src/features/trading/components/P2PTradingPage.tsx',
  'src/features/chat/hooks/useDirectConversationSync.ts',
  'src/features/groups/hooks/useGroupDataSync.ts',
  'src/features/wallet/hooks/useWalletOnboarding.ts',
  'src/lib/appChain.ts',
  'src/lib/appShared/contracts.ts',
  'src/lib/appShared/core.ts',
  'src/lib/appShared/parsers.ts'
]);
const APP_LEGACY_ONLY = /(?:^|\/)(?:legacy(?:\/|$)|chatGc(?:\.|\/)|.*Legacy.*|tradeRecoveryPayload\.|useStateBackupSync\.)/u;
const CONTRACTS_LEGACY_ONLY = /(?:^|\/)(?:abi\/active\/ChainWhisperRecurringOTCEscrowV1|contracts\/(?:active|editable)\/ChainWhisperRecurringOTCEscrowV1|deployments\/coti-mainnet\.json|scripts\/verify-recurring-provenance\.js|test\/ChainWhisperTradingV1\.js)/u;
const CONTRACTS_SUPERSEDED = /(?:^|\/)(?:contracts\/editable\/ChainWhisperHiddenIntentEscrowV1\.sol|contracts\/editable\/ChainWhisperPrivateLiquidityBookV1\.sol|scripts\/.*private-liquidity-v1|test\/ChainWhisperHiddenIntentV1\.js|test\/ChainWhisperPrivateLiquidityBookV1\.js|test\/ChainWhisperPrivateLiquidityTestnetProof\.js|test\/ChainWhisperPrivateLiquidityTestnetTooling\.js)/u;

const decision = (disposition, confidence, reason) => Object.freeze({ disposition, confidence, reason });

export const classifyWorkspaceChange = ({ repository, entry }) => {
  if (entry.category === 'sensitive') {
    return decision('Shelve', 'high', 'Local sensitive material; never include in a source or release-evidence commit.');
  }
  if (entry.status.includes('D')) {
    return decision('Keep', 'high', 'Preserve the accepted deletion; do not resurrect the retired surface during checkpointing.');
  }
  const path = normalized(entry.path);
  if (/\.log$/iu.test(path)) {
    return decision('Shelve', 'high', 'Ephemeral local process output is not source or release evidence.');
  }
  if (/(?:^|\/)\.env(?:\.[^/]*)?\.example$/iu.test(path)) {
    return decision('Keep', 'medium', 'Public configuration template; retain only placeholder values and documented defaults.');
  }
  if (/\.html$/iu.test(path)) {
    return decision('Keep', 'medium', 'Product or test utility entry point; retain with its owning feature and rendered checks.');
  }
  if (SUPERSEDED_OR_LOCAL_EVIDENCE.test(path)) {
    return decision('Shelve', 'high', 'Superseded, rejected, attempt-specific, funding, or actor-local evidence is not release authority.');
  }
  if (repository === 'Contracts' && CONTRACTS_SUPERSEDED.test(path)) {
    return decision('Shelve', 'high', 'Superseded V1/prototype implementation remains outside the BookV2 release candidate.');
  }
  if (repository === 'Contracts' && CONTRACTS_LEGACY_ONLY.test(path)) {
    return decision('Legacy-only', 'high', 'Required only for deployed V1 compatibility, liabilities, or historical verification; no new V2 authority.');
  }
  if (repository === 'APP' && APP_LEGACY_ONLY.test(path)) {
    return decision('Legacy-only', 'medium', 'Keep only behind explicit versioned read/migration boundaries; no active write fallback.');
  }
  if (repository === 'APP' && APP_REDESIGN.has(path)) {
    return decision('Redesign', 'high', 'Mixed orchestration/version responsibilities should be separated before release checkpoint and final audit.');
  }
  if (entry.category === 'generated/deployment' || GENERATED_EVIDENCE.test(path)) {
    return decision('Extract', 'high', 'Review and checkpoint provenance/runtime evidence separately from product source changes.');
  }
  if (entry.category === 'test') {
    return decision('Keep', 'high', 'Retain regression or release-gate coverage with its owning implementation group.');
  }
  if (entry.category === 'documentation' || entry.category === 'configuration') {
    return decision('Keep', 'medium', 'Retain with the owning feature after checking that claims and configuration match current evidence.');
  }
  if (entry.category === 'source') {
    return decision('Keep', 'medium', 'Current implementation source; keep provisionally and review with its feature checkpoint.');
  }
  return decision('Keep', 'low', 'No higher-specificity rule matched; retain provisionally until manual review resolves the path.');
};

export const classifyWorkspaceRepositories = (repositories) => Object.freeze(repositories.map((repository) => {
  const entries = repository.entries.map((entry) => Object.freeze({
    ...entry,
    ...classifyWorkspaceChange({ repository: repository.name, entry })
  }));
  const counts = Object.fromEntries(DISPOSITIONS.map((disposition) => [
    disposition,
    entries.filter((entry) => entry.disposition === disposition).length
  ]));
  const confidence = Object.fromEntries(['high', 'medium', 'low'].map((level) => [
    level,
    entries.filter((entry) => entry.confidence === level).length
  ]));
  return Object.freeze({ name: repository.name, statusDigest: repository.statusDigest, counts, confidence, entries });
}));

export const buildWorkspaceClassificationReport = ({ evidenceId, repositories }) => {
  const classificationId = sha256(JSON.stringify({ evidenceId, repositories }));
  const total = Object.fromEntries(DISPOSITIONS.map((disposition) => [
    disposition,
    repositories.reduce((sum, repository) => sum + repository.counts[disposition], 0)
  ]));
  const lines = [
    '# ChainWhisper Provisional Workspace Change Classification',
    '',
    `Classification ID: \`${classificationId}\``,
    '',
    `Source workspace evidence: \`${evidenceId}\``,
    '',
    '**Status: provisional and non-destructive.** This ledger assigns every currently dirty path to one of the five roadmap dispositions. It does not delete, stage, commit, move, deploy, or approve any path. A human/feature-owner review must accept or override each group before checkpointing.',
    '',
    '## Disposition meanings',
    '',
    '- **Keep:** part of the current intended architecture, accepted removal, tests, or supporting documentation/configuration.',
    '- **Extract:** valid generated deployment/runtime/provenance evidence that should be reviewed and checkpointed separately from product source.',
    '- **Redesign:** valuable current work whose mixed responsibilities should be separated before release audit.',
    '- **Legacy-only:** retained solely for explicit V1 reads, liabilities, migration, or compatibility; never an active V2 write fallback.',
    '- **Shelve:** superseded prototype, rejected/attempt-specific artifact, or local sensitive material outside the release candidate.',
    '',
    '## Summary',
    '',
    '| Repository | Status digest | Keep | Extract | Redesign | Legacy-only | Shelve | High / medium / low confidence |',
    '|---|---|---:|---:|---:|---:|---:|---|'
  ];
  for (const repository of repositories) {
    lines.push(`| ${repository.name} | \`${repository.statusDigest}\` | ${repository.counts.Keep} | ${repository.counts.Extract} | ${repository.counts.Redesign} | ${repository.counts['Legacy-only']} | ${repository.counts.Shelve} | ${repository.confidence.high} / ${repository.confidence.medium} / ${repository.confidence.low} |`);
  }
  lines.push(`| **Total** |  | **${total.Keep}** | **${total.Extract}** | **${total.Redesign}** | **${total['Legacy-only']}** | **${total.Shelve}** |  |`);
  lines.push(
    '',
    '## Review order',
    '',
    '1. Review all **Redesign** paths first because they cross active architecture boundaries.',
    '2. Confirm **Legacy-only** paths have no active owner-wallet write fallback.',
    '3. Separate **Extract** provenance/runtime artifacts from source checkpoints.',
    '4. Confirm every **Shelve** item stays outside the release manifest and source commit.',
    '5. Review low-confidence **Keep** fallbacks individually before accepting the remaining feature groups.',
    ''
  );
  for (const repository of repositories) {
    lines.push(`## ${repository.name}`, '');
    lines.push('| Git status | Existing category | Disposition | Confidence | Path | Reason |', '|---|---|---|---|---|---|');
    for (const entry of repository.entries) {
      lines.push(`| \`${entry.status}\` | ${markdownCell(entry.category)} | **${entry.disposition}** | ${entry.confidence} | ${markdownCell(entry.path)} | ${markdownCell(entry.reason)} |`);
    }
    lines.push('');
  }
  lines.push(
    '## Approval boundary',
    '',
    '- No disposition in this generated ledger is approved merely because the classifier assigned it.',
    '- Override rules must be changed in code, covered by tests, and regenerated against the same workspace status digest.',
    '- A later checkpoint must bind exact commits plus this classification ID and rerun the appropriate tests/security gates.',
    '',
    'Regenerate from `APP` with `npm run classify:workspace`.',
    ''
  );
  return Object.freeze({ classificationId, report: lines.join('\n') });
};

export const generateWorkspaceClassification = async ({
  repositories = WORKSPACE_REPOSITORIES,
  output = WORKSPACE_CLASSIFICATION_OUTPUT
} = {}) => {
  const workspace = await generateWorkspaceEvidence({ repositories });
  const classified = classifyWorkspaceRepositories(workspace.repositories);
  const { classificationId, report } = buildWorkspaceClassificationReport({
    evidenceId: workspace.evidenceId,
    repositories: classified
  });
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.tmp`;
  await writeFile(temporary, report, { encoding: 'utf8', flag: 'w' });
  await rename(temporary, output);
  return Object.freeze({ output, evidenceId: workspace.evidenceId, classificationId, repositories: classified });
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  generateWorkspaceClassification().then(({ output, evidenceId, classificationId, repositories }) => {
    process.stdout.write(`${JSON.stringify({
      status: 'workspace-classification-written',
      output: normalized(relative(resolve(dirname(output), '..', '..'), output)),
      evidenceId,
      classificationId,
      repositories: repositories.map(({ name, counts, confidence }) => ({ name, counts, confidence }))
    }, null, 2)}\n`);
  }).catch(() => {
    process.stderr.write('Workspace classification generation failed. No repository content was printed.\n');
    process.exitCode = 1;
  });
}
