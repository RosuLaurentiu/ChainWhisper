'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const root = path.resolve(__dirname, '../..');
const service = path.join(root, 'ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/app-async-service');
const cli = require(path.join(service, 'runtime/app-host-cli.cjs'));
const hostFile = path.join(service, 'app-host-23abde1d22019d52852d6845c9444326dde1d99e/HOST.json');
const operatorField = 'CHAINWHISPER_TEST_DEX_MALLORY_PRIVATE_KEY';

function readKey() {
  if (process.env[cli.KEY_NAME]) return process.env[cli.KEY_NAME];
  // Read only the configured operator entry; do not load the fixture or its AES keys.
  const entries = fs.readFileSync(path.join(root, 'Testing/wallets/.env.coti-testnet.local'), 'utf8')
    .split(/\r?\n/).filter(line => new RegExp('^\\s*' + operatorField + '\\s*=').test(line));
  assert.equal(entries.length, 1, 'CURRENT_DEX_KEEPER_OPERATOR_CONFIG');
  return parseEnv(entries[0])[operatorField];
}

async function main(args, onHost) {
  assert(Array.isArray(args) && args.length === 1 &&
    ['--check', '--start', '--once', '--reconcile'].includes(args[0]), 'CURRENT_DEX_KEEPER_USAGE');
  if (args[0] === '--check') return cli.runCli(args);
  const stat = fs.lstatSync(hostFile);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 1048576,
    'CURRENT_DEX_KEEPER_HOST_CONFIG');
  const host = JSON.parse(fs.readFileSync(hostFile, 'utf8'));
  return cli.runCli([args[0], host.operator, host.startBlock.number, host.startBlock.hash],
    { readKey, ...(onHost ? { onHost } : {}) });
}

module.exports = { main };
if (require.main === module) main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result)))
  .catch(error => {
    const first = String(error?.message ?? '').split(/\r?\n/, 1)[0];
    const guard = /^(?:APP_HOST|NORMAL_KEEPER|CURRENT_DEX_KEEPER)_[A-Z0-9_]+$/.test(first)
      ? first : 'CURRENT_DEX_KEEPER_REJECTED';
    console.error(JSON.stringify({ status: 'CURRENT_DEX_KEEPER_STOP', guard, noAutomaticRetry: true }));
    process.exitCode = 1;
  });
