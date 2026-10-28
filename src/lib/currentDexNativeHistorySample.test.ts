import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { readCurrentDexDailyPrice, isVerifiedCurrentDexDailyPrice, CURRENT_DEX_DAILY_PRICE_CONFIG,
  type CurrentDexDailyPriceManifest } from './currentDexDailyPrice';

// Explicit public native read after the one-record session. No wallet or sender.
it.skipIf(process.env.CW_CURRENT_HISTORY_SAMPLE_READ !== '1')('reads the authenticated current daily sample and preserves the missing days', async () => {
  const manifest = JSON.parse(readFileSync('reports/next-dex-app-2026-10-04/current-history-native-manifest-1.json', 'utf8')) as CurrentDexDailyPriceManifest;
  const methods: string[] = [];
  const provider = { request: async ({ method, params }: { method: string; params?: unknown[] | object }) => {
    if (!['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionReceipt', 'eth_getCode', 'eth_call'].includes(method)) throw new Error('Public history read only.');
    methods.push(method);
    const reply = await fetch('https://testnet.coti.io/rpc', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: methods.length, method, params: params ?? [] }) });
    if (!reply.ok) throw new Error('Public history HTTP failure.');
    const body = await reply.json() as { result?: unknown; error?: unknown };
    if (body.error || !Object.prototype.hasOwnProperty.call(body, 'result')) throw new Error('Public history RPC failure.');
    return body.result;
  } };
  const snapshot = await readCurrentDexDailyPrice({ provider, manifest, finalityLagBlocks: 2 });
  expect(isVerifiedCurrentDexDailyPrice(snapshot)).toBe(true);
  expect(snapshot.slots).toHaveLength(32);
  const points = snapshot.slots.flatMap(slot => slot.point ? [slot.point] : []);
  expect(points).toHaveLength(1);
  const point = points[0];
  expect(point.day).toBe('20730');
  expect(BigInt(point.priceE18) > 0n).toBe(true);
  expect(BigInt(point.recordedAt) - BigInt(point.sampledAt)).toBeLessThanOrEqual(120n);
  expect(BigInt(point.recordedAt) >= BigInt(point.sampledAt)).toBe(true);
  const receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: ['0xc70cdcd8f057cbe905830826f224dc3f2002cb93605e2142119fff8fcc29c631'] }) as { status: string; blockNumber: string; blockHash: string; to: string };
  expect(BigInt(receipt.status)).toBe(1n);
  expect(BigInt(receipt.blockNumber).toString()).toBe(point.recordedBlock);
  expect(receipt.blockHash.toLowerCase()).toBe(point.recordBlockHash.toLowerCase());
  expect(receipt.to.toLowerCase()).toBe(manifest.address.toLowerCase());
  expect(CURRENT_DEX_DAILY_PRICE_CONFIG.status).toBe('inactive');
  writeFileSync('reports/next-dex-app-2026-10-04/current-history-native-sample-read-1.json', JSON.stringify({
    status: 'CURRENT_RECORDER_ONE_SAMPLE_NATIVE_APP_READ_PASSED', sourceGraph: manifest.sourceGraph,
    recorder: manifest.address, runtimeHash: manifest.runtimeHash, recordTransactionHash: '0xc70cdcd8f057cbe905830826f224dc3f2002cb93605e2142119fff8fcc29c631',
    atBlock: snapshot.atBlock, slots: snapshot.slots.length, realPoints: points.length, gaps: 31, point,
    currentReference: snapshot.currentReference, requests: methods.length, requestMethods: methods,
    noWallet: true, noPrivateReads: true, noSigning: true, noWrites: true, feedStillInactive: true
  }, null, 2) + '\n', { flag: 'wx' });
}, 60_000);
