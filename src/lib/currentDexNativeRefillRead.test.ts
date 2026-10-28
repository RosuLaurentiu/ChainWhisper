import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { readCurrentTokenRefill } from './currentDexTokenRefill';

it.skipIf(process.env.CW_CURRENT_REFILL_READ !== '1')('reads the actual current refill vault after both native claims', async () => {
  const proof = JSON.parse(readFileSync('reports/next-dex-app-2026-10-04/current-refill-native-binding-3.json', 'utf8'));
  expect(proof.status).toBe('DEVELOPMENT_PRIVATE_REFILL_NATIVE_ACCEPTED');
  const requests: string[] = [];
  const rpc = async (method: string, params: unknown[]): Promise<unknown> => {
    if (!['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionReceipt', 'eth_getCode', 'eth_call'].includes(method)) throw new Error('Public refill read only.');
    requests.push(method);
    const response = await fetch('https://testnet.coti.io/rpc', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: requests.length, method, params }) });
    if (!response.ok) throw new Error('Public refill HTTP failure.');
    const body = await response.json();
    if (body.error || !Object.prototype.hasOwnProperty.call(body, 'result')) throw new Error('Public refill RPC failure.');
    return body.result;
  };
  const headRaw = await rpc('eth_getBlockByNumber', ['latest', false]) as { number: string; hash: string; timestamp: string };
  const head = { number: BigInt(headRaw.number), hash: headRaw.hash, timestamp: BigInt(headRaw.timestamp) };
  const assertCurrent = async () => {
    expect(BigInt(await rpc('eth_chainId', []) as string)).toBe(7082400n);
    const genesis = await rpc('eth_getBlockByNumber', ['0x0', false]) as { hash: string };
    expect(genesis.hash.toLowerCase()).toBe(proof.genesisHash.toLowerCase());
    const canonical = await rpc('eth_getBlockByNumber', [headRaw.number, false]) as { hash: string };
    expect(canonical.hash.toLowerCase()).toBe(head.hash.toLowerCase());
  };
  const deployment = proof.transactions[0];
  const receipt = await rpc('eth_getTransactionReceipt', [deployment.hash]) as { status: string; contractAddress: string; blockNumber: string; blockHash: string; transactionIndex: string };
  const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]) as { hash: string; transactions: string[] };
  expect(BigInt(receipt.status)).toBe(1n);
  expect(receipt.contractAddress.toLowerCase()).toBe(proof.vault.toLowerCase());
  expect(block.hash.toLowerCase()).toBe(deployment.blockHash.toLowerCase());
  expect(block.hash.toLowerCase()).toBe(receipt.blockHash.toLowerCase());
  expect(block.transactions[Number(BigInt(receipt.transactionIndex))].toLowerCase()).toBe(deployment.hash.toLowerCase());
  const owner = '0x8b749251CF1f712D4e39FD048C53394af03E10bE';
  const results = [];
  for (const tokenIndex of [0, 1] as const) {
    const state = await readCurrentTokenRefill({ candidate: 'cheap-native', tokenIndex, owner, initialClaimed: true, head, rpc, assertCurrent,
      binding: { address: proof.vault, runtimeHash: proof.runtimeHash, recovery: proof.recovery, expiresAt: BigInt(proof.expiresAt) } });
    expect(state.availability).toBe('cooldown');
    expect(state.quota).toBe(999_000n * 10n ** 18n);
    expect(state.amount).toBe(1_000n * 10n ** 18n);
    expect(state.nextClaimAt > head.timestamp).toBe(true);
    results.push({ token: state.token, availability: state.availability, quota: String(state.quota), nextClaimAt: String(state.nextClaimAt) });
  }
  writeFileSync('reports/next-dex-app-2026-10-04/current-refill-native-read-1.json', JSON.stringify({ status: 'CURRENT_REFILL_NATIVE_APP_READ_PASSED',
    graph: proof.candidate.graph, vault: proof.vault, runtimeHash: proof.runtimeHash, head: headRaw, results, requests: requests.length,
    noWallet: true, noPrivateBalanceReads: true, noSigning: true, noWrites: true }, null, 2) + '\n', { flag: 'wx' });
}, 60_000);
