import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const manifestPath = process.env.CHAINWHISPER_TESTNET_CANDIDATE_MANIFEST_PATH;
const rpcUrl = process.env.CHAINWHISPER_TESTNET_RPC_URL;
const analyticsRequested = process.argv.includes('--analytics');
const analyticsManifestPath =
  process.env.CHAINWHISPER_TESTNET_PRIVATE_LIQUIDITY_ANALYTICS_MANIFEST_PATH;
if (!manifestPath || manifestPath !== manifestPath.trim()) {
  throw new Error('Set CHAINWHISPER_TESTNET_CANDIDATE_MANIFEST_PATH for the live API smoke.');
}
if (!rpcUrl || rpcUrl !== rpcUrl.trim()) {
  throw new Error('Set CHAINWHISPER_TESTNET_RPC_URL for the live API smoke.');
}
if (
  analyticsRequested &&
  (!analyticsManifestPath || analyticsManifestPath !== analyticsManifestPath.trim())
) {
  throw new Error(
    'Set CHAINWHISPER_TESTNET_PRIVATE_LIQUIDITY_ANALYTICS_MANIFEST_PATH for the live analytics API smoke.'
  );
}

const vitest = resolve('node_modules', 'vitest', 'vitest.mjs');
const child = spawn(process.execPath, [
  vitest,
  'run',
  'workers/chainwhisper-api/test/live-private-liquidity-v2.test.ts',
  ...(analyticsRequested
    ? ['workers/chainwhisper-api/test/live-private-liquidity-daily-price.test.ts']
    : [])
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CHAINWHISPER_LIVE_TESTNET_API_READONLY: 'true',
    ...(analyticsRequested
      ? { CHAINWHISPER_LIVE_TESTNET_ANALYTICS_READONLY: 'true' }
      : {})
  },
  stdio: 'inherit'
});

const exitCode = await new Promise((resolveExit, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (signal) reject(new Error(`Live API smoke ended from signal ${signal}.`));
    else resolveExit(code ?? 1);
  });
});
if (exitCode !== 0) process.exit(exitCode);
