'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const pacing = require('./current-dex-rpc-pacing.cjs');
const root = path.resolve(__dirname, '../..');
const service = path.join(root, 'ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/app-async-service');
const cli = require(path.join(service, 'runtime/app-host-cli.cjs'));
const { loadPublicBinding, captureFile, GRAPH, CORE } = require(path.join(service, 'public-binding.cjs'));
const operatorField = 'CHAINWHISPER_TEST_DEX_MALLORY_PRIVATE_KEY';

function readKey() {
  if (process.env[cli.KEY_NAME]) return process.env[cli.KEY_NAME];
  // Read only the configured operator entry; do not load the fixture or its AES keys.
  const entries = fs.readFileSync(path.join(root, 'Testing/wallets/.env.coti-testnet.local'), 'utf8')
    .split(/\r?\n/).filter(line => new RegExp('^\\s*' + operatorField + '\\s*=').test(line));
  assert.equal(entries.length, 1, 'CURRENT_DEX_KEEPER_OPERATOR_CONFIG');
  return parseEnv(entries[0])[operatorField];
}

function hostConfiguration(requireSaved = false, graph = GRAPH) {
  assert(/^[a-f0-9]{64}$/.test(graph) && (requireSaved || graph === GRAPH),'CURRENT_DEX_KEEPER_HOST_GRAPH');
  const hostFile = path.join(service, `app-host-${graph.slice(0, 8)}-23abde1d22019d52852d6845c9444326dde1d99e/HOST.json`);
  if (!fs.existsSync(hostFile)) {
    assert(!fs.existsSync(path.dirname(hostFile)), 'CURRENT_DEX_KEEPER_HOST_RECOVERY_REQUIRED');
    if(requireSaved)return null;
    loadPublicBinding();
    const capture = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
    const head = capture.reads.find(row => row.method === 'eth_getBlockByNumber' && row.params[0] === 'latest')?.result;
    assert(/^0x[0-9a-f]+$/i.test(head?.number) && /^0x[0-9a-f]{64}$/i.test(head?.hash), 'CURRENT_DEX_KEEPER_START_BLOCK');
    return { operator: '0x23abde1d22019d52852d6845c9444326dde1d99e',
      startBlock: { number: String(BigInt(head.number)), hash: head.hash } };
  }
  const stat = fs.lstatSync(hostFile);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 1048576,
    'CURRENT_DEX_KEEPER_HOST_CONFIG');
  return JSON.parse(fs.readFileSync(hostFile, 'utf8'));
}

async function main(args, onHost) {
  assert(Array.isArray(args) && args.length === 1 &&
    ['--check', '--start', '--once', '--reconcile'].includes(args[0]), 'CURRENT_DEX_KEEPER_USAGE');
  if (args[0] === '--check') return { ...await cli.runCli(args), graph: GRAPH, core: CORE };
  const host = hostConfiguration();
  return cli.runCli([args[0], host.operator, host.startBlock.number, host.startBlock.hash],
    { readKey, ...(onHost ? { onHost } : {}) });
}

function stopResult(error) {
  const first = String(error?.message ?? '').split(/\r?\n/, 1)[0];
  const guard = /^(?:APP_HOST|NORMAL_KEEPER|CURRENT_DEX_KEEPER)_[A-Z0-9_]+$/.test(first)
    ? first : 'CURRENT_DEX_KEEPER_REJECTED';
  const traffic = pacing.stats();
  return { status: 'CURRENT_DEX_KEEPER_STOP', guard, noAutomaticRetry: true,
    ...(traffic?.lastFailure ? { rpcFailure: { service: traffic.service, ...traffic.lastFailure } } : {}) };
}
module.exports = { main, stopResult, hostConfiguration };
if (require.main === module) main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result)))
  .catch(error => {
    console.error(JSON.stringify(stopResult(error)));
    process.exitCode = 1;
  });
