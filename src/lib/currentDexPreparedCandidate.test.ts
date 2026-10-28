import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Interface } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import { STAGED_PREPARED_DEX_CANDIDATE as prepared } from './currentDexPreparedCandidate';
import { CURRENT_CHEAP_DEX_CANDIDATE, STAGED_D06_DEX_CANDIDATE, resolveCurrentCheapDexCandidate,
  currentCheapDexCandidateKey, currentCheapDexQuoteProtocol, currentCheapDexStages,
  assertCurrentCheapDexNativeAdmission } from './dexV2Deployment';
import { CURRENT_SLIPPAGE_DEX_QUOTE_ABI } from './currentDexOperation';

const helper = createRequire(import.meta.url)('../../scripts/prepare-current-dex-prepared-candidate.cjs');
const captureBytes = readFileSync(new URL('../../reports/prepared-candidate-2026-10-07/public-capture-2.json', import.meta.url));
type Read = { method: string; params: unknown[]; result: unknown };
const capture = JSON.parse(captureBytes.toString()) as { schema: string; graph: string; packageSha256: string; reads: Read[] };
const input = helper.inputs();
const replay = async (change?: (row: Read) => unknown) => {
  const saved = new Map(capture.reads.map(row => [JSON.stringify([row.method, row.params]), row]));
  return helper.collect(async (method: string, params: unknown[]) => {
    expect(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getStorageAt', 'eth_call']).toContain(method);
    const row = saved.get(JSON.stringify([method, params]));
    if (!row) throw new Error('MISSING_CAPTURED_READ');
    return change ? change(row) : row.result;
  }, input);
};

describe('prepared shared-Core public candidate', () => {
  it('replays the exact public capture and reproduces the generated source', async () => {
    expect(capture.schema).toBe('PREPARED_APP_PUBLIC_BINDING_V1');
    expect(capture.graph).toBe(prepared.graph); expect(capture.packageSha256).toBe(prepared.packageSha256);
    expect(input.pkg.calls).toHaveLength(44);
    expect(input.runtimes).toHaveLength(44);
    const attestationSha256 = createHash('sha256').update(captureBytes).digest('hex');
    const data = { ...await replay(), attestationSha256 };
    expect(data).toEqual(prepared);
    expect(readFileSync(new URL('./currentDexPreparedCandidate.ts', import.meta.url), 'utf8')).toBe(helper.render(data));
    expect(prepared.runtimes).toHaveLength(47);
    expect(prepared.companions).toHaveLength(4);
    expect(prepared.tokens).toHaveLength(4);
    expect(prepared.pairs).toHaveLength(6);
    expect(new Set(prepared.pairs.map(row => row.canonicalId)).size).toBe(6);
    expect(prepared.reviewedTokenSet).toBe(input.pkg.tokenAdmissionCommitment);
    expect(prepared.primaryReviewedTokenSet).toBe(input.pkg.reviewedTokenSet);
    expect(prepared.additionalReviewedTokenSet).toBe(input.pkg.additionalReviewedTokenSet);
  }, 30000);

  it('binds the actual ABI and stages, while it keeps the held default', () => {
    expect(resolveCurrentCheapDexCandidate('cheap-prepared')).toBe(prepared);
    expect(currentCheapDexCandidateKey(prepared)).toBe('cheap-prepared');
    expect(currentCheapDexStages(prepared)).toEqual({ workCalls: 4, ready: 5, funded: 6, settled: 7, released: 8 });
    expect(currentCheapDexQuoteProtocol(prepared)).toBe('quote-slippage');
    const appAbi = new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI);
    expect(prepared.protocol.quoteSignature).toBe(appAbi.getFunction('quoteCheapAsync')!.format('sighash'));
    expect(CURRENT_CHEAP_DEX_CANDIDATE).toBe(STAGED_D06_DEX_CANDIDATE);
    expect(resolveCurrentCheapDexCandidate('cheap-current')).toBe(STAGED_D06_DEX_CANDIDATE);
    expect(prepared.readyToSign).toBe(false);
    expect(() => assertCurrentCheapDexNativeAdmission(prepared)).toThrow('native App submission admission');
    expect(() => currentCheapDexCandidateKey({ ...prepared, packageSha256: STAGED_D06_DEX_CANDIDATE.packageSha256 })).toThrow('do not match');
    expect(() => currentCheapDexCandidateKey({ ...prepared, core: STAGED_D06_DEX_CANDIDATE.core })).toThrow('do not match');
  });

  it('freezes each nested public identity object and array', () => {
    const check = (value: unknown): void => {
      if (value && typeof value === 'object') { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(check); }
    };
    check(prepared);
  });

  it('rejects drift in each of the four token runtimes', async () => {
    for (const [token] of prepared.tokens) {
      await expect(replay(row => row.method === 'eth_getCode' && String(row.params[0]).toLowerCase() === token ? '0x00' : row.result)).rejects.toThrow();
    }
  }, 30000);

  it('rejects an incomplete capture and a changed canonical head', async () => {
    await expect(helper.collect(async () => { throw new Error('MISSING_CAPTURED_READ'); }, input)).rejects.toThrow('MISSING_CAPTURED_READ');
    await expect(replay(row => row.method === 'eth_getBlockByNumber' && row.params[0] === 'latest'
      ? { ...(row.result as object), number: '0x1' } : row.result)).rejects.toThrow('HEAD_BEFORE_DEPLOYMENT');
    let chainReads = 0;
    await expect(replay(row => row.method === 'eth_chainId' && ++chainReads === 3 ? '0x1' : row.result)).rejects.toThrow('PREPARED_FINAL_CHAIN');
  });

  it('rejects assembly literals that do not match the frozen embedded bytes', () => {
    const compiled = JSON.parse(readFileSync(new URL('../../reports/prepared-candidate-2026-10-07/engine-assembly.json', import.meta.url), 'utf8'));
    const engine = compiled.contracts[input.frozen.artifacts.ChainWhisperFixedEngine.sourceName].ChainWhisperFixedEngine;
    const literal = engine.evm.legacyAssembly['.data']['1']['.data']['0']['.code'].find((row: { name: string }) => row.name === 'PUSH');
    literal.value = (BigInt(`0x${literal.value}`) + 1n).toString(16);
    expect(() => helper.verifyEmbedded(compiled, input)).toThrow('ASSEMBLY_LITERAL');
  });

  it('rejects Engine-to-matcher storage drift for every market', async () => {
    for (const pair of prepared.pairs) {
      await expect(replay(row => row.method === 'eth_getStorageAt' && String(row.params[0]).toLowerCase() === pair.engine
        ? `0x${'00'.repeat(32)}` : row.result)).rejects.toThrow();
    }
  }, 30000);
});
