import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { readCurrentDexDailyPrice, isVerifiedCurrentDexDailyPrice, CURRENT_DEX_DAILY_PRICE_CONFIG,
  type CurrentDexDailyPriceManifest } from './currentDexDailyPrice';

// Explicit opt-in public native read. No wallet, encryption key or sender path.
it.skipIf(process.env.CW_CURRENT_HISTORY_READ !== '1')('reads the actual current recorder as an empty authenticated history', async () => {
  const manifest = JSON.parse(readFileSync('reports/next-dex-app-2026-10-04/current-history-native-manifest-1.json', 'utf8')) as CurrentDexDailyPriceManifest;
  const requests: string[] = [];
  const provider = { request: async ({ method, params }: { method: string; params?: unknown[] | object }) => {
    if (!['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionReceipt', 'eth_getCode', 'eth_call'].includes(method)) throw new Error('Public history read only.');
    requests.push(method);
    const reply = await fetch('https://testnet.coti.io/rpc', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: requests.length, method, params: params ?? [] }) });
    if (!reply.ok) throw new Error('Public history HTTP failure.');
    const body = await reply.json() as { result?: unknown; error?: unknown };
    if (body.error || !Object.prototype.hasOwnProperty.call(body, 'result')) throw new Error('Public history RPC failure.');
    return body.result;
  } };
  const snapshot = await readCurrentDexDailyPrice({ provider, manifest, finalityLagBlocks: 2 });
  expect(isVerifiedCurrentDexDailyPrice(snapshot)).toBe(true);
  expect(snapshot.slots).toHaveLength(32);
  expect(snapshot.slots.every(slot => slot.point === null)).toBe(true);
  expect(snapshot.currentReference).not.toBe('available');
  expect(CURRENT_DEX_DAILY_PRICE_CONFIG.status).toBe('inactive');
  writeFileSync('reports/next-dex-app-2026-10-04/current-history-native-read-1.json', JSON.stringify({
    status: 'CURRENT_RECORDER_NATIVE_APP_READ_PASSED', sourceGraph: manifest.sourceGraph, recorder: manifest.address,
    runtimeHash: manifest.runtimeHash, deploymentTransactionHash: manifest.deploymentTransactionHash,
    atBlock: snapshot.atBlock, slots: snapshot.slots.length, realPoints: 0, gaps: 32,
    currentReference: snapshot.currentReference, requests: requests.length, requestMethods: requests,
    noWallet: true, noPrivateReads: true, noSigning: true, noWrites: true, feedStillInactive: true
  }, null, 2) + '\n', { flag: 'wx' });
}, 60_000);
