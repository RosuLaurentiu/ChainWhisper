import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Interface, toBeHex } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import { createDexV2ReadCapability, readCurrentSharedPoolDexGraph, readCurrentDexOperation } from './dexV2Chain';
import { CURRENT_CHEAP_DEX_OPERATION_ABI } from './currentDexOperation';
import { resolveCurrentCheapDexCandidate } from './dexV2Deployment';

// decision-034: only the selected current candidate remains. The retained shared-Pool, archived and d06 graph
// fixtures were removed with those candidates; this file keeps the current qualification-reuse checks.
const coreAbi = new Interface([
  'function releaseId() view returns (bytes32)', 'function marketId() view returns (bytes32)',
  'function feePpm() view returns (uint32)', 'function maxWorkLifetime() view returns (uint32)',
  'function tokenAdmissionCommitment() view returns (bytes32)',
  'function inputToken() view returns (address)', 'function outputToken() view returns (address)',
  'function inputRuntimeHash() view returns (bytes32)', 'function outputRuntimeHash() view returns (bytes32)',
  'function fixedEngine() view returns (address)', 'function fixedEngineRuntimeHash() view returns (bytes32)',
  'function terminalEvaluator() view returns (address)', 'function terminalEvaluatorRuntimeHash() view returns (bytes32)',
  'function terminalEvaluatorBindingCommitment() view returns (bytes32)',
  'function positionNFT() view returns (address)', 'function positionNFTRuntimeHash() view returns (bytes32)',
  'function fastPoolQuote() view returns (address)', 'function poolTerms() view returns (address)'
]);
const binding = `0x${'33'.repeat(32)}`;
const currentHash = `0x${'55'.repeat(32)}`;
describe('current directory deployment qualification reuse', () => {
  const selected = resolveCurrentCheapDexCandidate('cheap-history');
  const captureBytes = readFileSync(new URL('../../../ChainWhisper Contracts V2/validation/candidates/c1-band-sizing-2026-11-21/native-bob-dense-1/APP_PUBLIC_CAPTURE.json', import.meta.url));
  expect(createHash('sha256').update(captureBytes).digest('hex')).toBe(selected.attestationSha256);
  const capture = JSON.parse(captureBytes.toString());
  const number = BigInt(selected.attestationBlock.number) + 10n;
  const operationAbi = new Interface(CURRENT_CHEAP_DEX_OPERATION_ABI);
  function fixture() {
    let active = true, chain = '0x6c11a0', reorg = false, changedFee = false;
    const request = vi.fn(async ({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> => {
      if (method === 'eth_chainId') return chain;
      if (method === 'eth_getBlockByNumber') {
        const n = params[0] === 'latest' ? number : BigInt(String(params[0]));
        return { number: `0x${n.toString(16)}`, timestamp: '0x64', hash: n === 0n ? selected.genesisHash :
          n === BigInt(selected.attestationBlock.number) ? selected.attestationBlock.hash :
          n === number ? reorg ? binding : currentHash : toBeHex(n, 32) };
      }
      if (method === 'eth_call' && (params[0] as { data: string }).data === operationAbi.encodeFunctionData('cheapAsyncPublic', [7n])) {
        return operationAbi.encodeFunctionResult('cheapAsyncPublic', [1n, `0x${'00'.repeat(32)}`, 200n]);
      }
      const key = method === 'eth_call' ? (p: unknown[]) => {
        const call = p[0] as { to: string; data: string }; return `${call.to.toLowerCase()}:${call.data}`;
      } : (p: unknown[]) => `${String(p[0]).toLowerCase()}:${method === 'eth_getStorageAt' ? p[1] : ''}`;
      const row = capture.reads.find((r: { method: string; params: unknown[] }) => r.method === method && key(r.params) === key(params));
      if (!row) throw new Error(`Unexpected current directory fixture ${method}`);
      if (changedFee && method === 'eth_call' && (params[0] as { data: string }).data === coreAbi.encodeFunctionData('feePpm')) {
        return coreAbi.encodeFunctionResult('feePpm', [selected.feePpm + 1]);
      }
      return row.result;
    });
    const makeCapability = () => createDexV2ReadCapability({ provider: { request }, chainId: 7082400n,
      assertCurrent: () => { if (!active) throw new Error('Session revoked'); } });
    const capability = makeCapability();
    return { request, capability, makeCapability,
      read: (at = number) => readCurrentSharedPoolDexGraph({ capability, blockNumber: at, blockHash: at === number ? currentHash : toBeHex(at, 32), candidate: 'cheap-history' }),
      revoke: () => { active = false; }, wrongChain: () => { chain = '0x1'; }, reorg: () => { reorg = true; }, changeFee: () => { changedFee = true; } };
  }
  it('does not repeat immutable deployment work on unchanged progress reads', async () => {
    const f = fixture(); await f.read(); const setup = f.request.mock.calls.length;
    f.request.mockClear(); await f.read();
    expect(setup).toBe(107); expect(f.request.mock.calls.length).toBe(2);
    expect(f.request.mock.calls.filter(([r]) => r.method === 'eth_getCode')).toHaveLength(0);
    expect(f.request.mock.calls.some(([r]) => r.method === 'eth_call' &&
      (r.params![0] as { data: string }).data === coreAbi.encodeFunctionData('feePpm'))).toBe(false);
    f.request.mockClear(); await f.read(number + 1n);
    expect(f.request.mock.calls.length).toBe(15);
    expect(f.request.mock.calls.filter(([r]) => r.method === 'eth_getCode')).toHaveLength(5);
    expect(f.request.mock.calls.filter(([r]) => r.method === 'eth_call')).toHaveLength(1);
  });
  it('runs full qualification in a new capability and keeps changed chain/configuration held', async () => {
    const f = fixture(); await f.read(); f.request.mockClear();
    await readCurrentSharedPoolDexGraph({ capability: f.makeCapability(), blockNumber: number, blockHash: currentHash, candidate: 'cheap-history' });
    expect(f.request.mock.calls.some(([r]) => r.method === 'eth_getCode')).toBe(true);
    f.changeFee(); await expect(readCurrentSharedPoolDexGraph({ capability: f.makeCapability(), blockNumber: number,
      blockHash: currentHash, candidate: 'cheap-history' })).rejects.toThrow('feePpm');
    const g = fixture(); await g.read(); g.wrongChain(); await expect(g.read()).rejects.toThrow('networks');
  });
  it('uses 14 App logical calls for an unchanged operation progress read after 107 setup calls', async () => {
    const f = fixture(); await f.read(); expect(f.request).toHaveBeenCalledTimes(107); f.request.mockClear();
    const operation = await readCurrentDexOperation({ capability: f.capability, candidate: selected, profile: 'cheap-async', operationId: 7n,
      expected: { chainId: 7082400n, core: selected.core, releaseId: selected.releaseId,
        runtimeHash: selected.runtimes.find(([name]) => name === 'ChainWhisperDexCore')![2], originBlockNumber: number, originBlockHash: currentHash } });
    await readCurrentSharedPoolDexGraph({ capability: f.capability, candidate: 'cheap-history', blockNumber: operation.block.number, blockHash: operation.block.hash });
    expect(f.request).toHaveBeenCalledTimes(14);
    expect(operation.operation.phase).toBe('preparing-quote');
  });
  it('rejects a reorg of the qualification block and a cancelled wallet session', async () => {
    const f = fixture(); await f.read(); f.reorg();
    await expect(f.read(number + 1n)).rejects.toThrow();
    const g = fixture(); await g.read(); g.revoke(); g.request.mockClear();
    await expect(g.read()).rejects.toThrow('Session revoked'); expect(g.request).not.toHaveBeenCalled();
  });
});
