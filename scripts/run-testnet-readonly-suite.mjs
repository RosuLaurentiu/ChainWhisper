import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(appRoot, '..');
const manifestPath = resolve(
  workspaceRoot,
  'ChainWhisper Contracts',
  'deployments',
  'coti-testnet-unified-candidate.json'
);
const rpcUrl = process.env.CHAINWHISPER_TESTNET_RPC_URL ?? 'https://testnet.coti.io/rpc';
const environment = {
  ...process.env,
  CHAINWHISPER_TESTNET_CANDIDATE_MANIFEST_PATH: manifestPath,
  CHAINWHISPER_TESTNET_RPC_URL: rpcUrl
};

const COTI_TESTNET_CHAIN_ID = 7_082_400n;
const DEFAULT_FINALITY_LAG = 5n;
const HASH = /^0x[0-9a-f]{64}$/u;

const wait = (delayMs) => delayMs === 0
  ? Promise.resolve()
  : new Promise((resolveWait) => globalThis.setTimeout(resolveWait, delayMs));

export const waitForCandidateFinality = async ({
  manifestPath: inputManifestPath,
  rpcUrl: inputRpcUrl,
  fetcher = globalThis.fetch.bind(globalThis),
  finalityLag = DEFAULT_FINALITY_LAG,
  pollIntervalMs = 1_000,
  timeoutMs = 90_000
}) => {
  if (
    typeof inputManifestPath !== 'string' || inputManifestPath.trim() !== inputManifestPath ||
    typeof inputRpcUrl !== 'string' || inputRpcUrl.trim() !== inputRpcUrl ||
    typeof fetcher !== 'function' ||
    typeof finalityLag !== 'bigint' || finalityLag < 1n || finalityLag > 4_096n ||
    !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0 || pollIntervalMs > 10_000 ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000
  ) throw new Error('Testnet candidate finality configuration is invalid.');
  const endpoint = new URL(inputRpcUrl);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !(loopback && endpoint.protocol === 'http:')) {
    throw new Error('Testnet candidate finality RPC must use HTTPS.');
  }
  const parsed = JSON.parse(await readFile(inputManifestPath, 'utf8'));
  const attestationNumber = BigInt(parsed?.attestationBlock?.number);
  const attestationHash = String(parsed?.attestationBlock?.hash ?? '').toLowerCase();
  if (attestationNumber < 1n || !HASH.test(attestationHash)) {
    throw new Error('Testnet candidate attestation block is malformed.');
  }
  let requestId = 0;
  const rpc = async (method, params = []) => {
    const id = ++requestId;
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error('Testnet candidate finality RPC was unavailable.');
    const payload = await response.json();
    if (
      !payload || typeof payload !== 'object' || Array.isArray(payload) ||
      payload.jsonrpc !== '2.0' || payload.id !== id || payload.error || payload.result === undefined
    ) throw new Error('Testnet candidate finality RPC response was invalid.');
    return payload.result;
  };
  if (BigInt(await rpc('eth_chainId')) !== COTI_TESTNET_CHAIN_ID) {
    throw new Error('Testnet candidate finality RPC returned the wrong chain.');
  }
  const deadline = Date.now() + timeoutMs;
  let latest = 0n;
  while (latest < attestationNumber + finalityLag) {
    latest = BigInt(await rpc('eth_blockNumber'));
    if (latest >= attestationNumber + finalityLag) break;
    if (Date.now() >= deadline) {
      throw new Error('Testnet candidate attestation did not finalize before the bounded timeout.');
    }
    await wait(pollIntervalMs);
  }
  const canonical = await rpc('eth_getBlockByNumber', [
    `0x${attestationNumber.toString(16)}`,
    false
  ]);
  if (
    !canonical || typeof canonical !== 'object' || Array.isArray(canonical) ||
    String(canonical.number ?? '').toLowerCase() !== `0x${attestationNumber.toString(16)}` ||
    String(canonical.hash ?? '').toLowerCase() !== attestationHash ||
    BigInt(await rpc('eth_chainId')) !== COTI_TESTNET_CHAIN_ID
  ) throw new Error('Testnet candidate attestation block is no longer canonical.');
  return Object.freeze({
    attestationNumber: attestationNumber.toString(),
    attestationHash,
    finalizedAtBlock: latest.toString(),
    finalityLag: finalityLag.toString()
  });
};

export const buildNpmInvocation = (
  args,
  platform = process.platform,
  commandInterpreter = process.env.ComSpec ?? 'cmd.exe'
) => platform === 'win32'
  ? Object.freeze({ command: commandInterpreter, args: Object.freeze(['/d', '/s', '/c', 'npm', ...args]) })
  : Object.freeze({ command: 'npm', args: Object.freeze([...args]) });

const run = async (cwd, args) => {
  const invocation = buildNpmInvocation(args);
  const child = spawn(invocation.command, invocation.args, {
    cwd,
    env: environment,
    stdio: 'inherit',
    windowsHide: true
  });
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${args.join(' ')} ended from signal ${signal}.`));
      else resolveExit(code ?? 1);
    });
  });
  if (exitCode !== 0) process.exit(exitCode);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const finalized = await waitForCandidateFinality({ manifestPath, rpcUrl });
  process.stdout.write(
    `PASS: candidate attestation ${finalized.attestationNumber} is canonical and ` +
    `${finalized.finalityLag} blocks finalized at ${finalized.finalizedAtBlock}.\n`
  );
  await run(resolve(workspaceRoot, 'MCP'), ['run', 'smoke:live:testnet:readonly']);
  await run(appRoot, ['run', 'smoke:api:testnet:readonly']);
  process.stdout.write(
    'ChainWhisper MCP and API live read-only testnet suite passed; no write operation was invoked.\n'
  );
}
