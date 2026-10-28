import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Interface } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE as exit } from './currentDexExitCandidate';
import { STAGED_PREPARED_DEX_CANDIDATE as prepared } from './currentDexPreparedCandidate';
import { CURRENT_CHEAP_DEX_CANDIDATE, STAGED_D06_DEX_CANDIDATE,
  resolveCurrentCheapDexCandidate, currentCheapDexCandidateKey, currentCheapDexStages,
  currentCheapDexQuoteProtocol, assertCurrentCheapDexNativeAdmission } from './dexV2Deployment';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { CURRENT_SLIPPAGE_DEX_QUOTE_ABI } from './currentDexOperation';

const helper = createRequire(import.meta.url)('../../scripts/prepare-current-dex-exit-candidate.cjs');
const capturePath = new URL('../../reports/exit-candidate-2026-10-07/public-capture-2.json', import.meta.url);

describe('exit-preview shared-Core public candidate', () => {
  it('replays the capture and reproduces every generated descriptor byte', async () => {
    const bytes = readFileSync(capturePath);
    const capture = JSON.parse(bytes.toString());
    expect(capture.schema).toBe(helper.SCHEMA);
    expect(capture.reads).toHaveLength(225);
    expect(capture.reads.every((row: { method: string }) =>
      ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getStorageAt', 'eth_call'].includes(row.method))).toBe(true);
    const result = await helper.main('--check', fileURLToPath(capturePath));
    expect(result.reads).toBe(242);
    expect(result.data).toEqual(exit);
    expect(exit.attestationSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(readFileSync(new URL('./currentDexExitCandidate.ts', import.meta.url), 'utf8')).toBe(helper.render(result.data));
    const input = helper.seedInputs(helper.inputs());
    expect(input.pkg.calls).toHaveLength(44);
    expect(input.runtimes).toHaveLength(44);
    expect(exit.runtimes).toHaveLength(47);
    expect(exit.companions).toHaveLength(4);
    expect(exit.tokens).toHaveLength(4);
    expect(exit.pairs).toHaveLength(6);
    expect(new Set(exit.pairs.map(row => row.canonicalId)).size).toBe(6);
    expect(exit.protocol).toEqual(input.protocol);
    expect(exit.reviewedTokenSet).toBe(input.pkg.tokenAdmissionCommitment);
    expect(exit.primaryReviewedTokenSet).toBe(input.pkg.reviewedTokenSet);
    expect(exit.additionalReviewedTokenSet).toBe(input.pkg.additionalReviewedTokenSet);
  }, 30000);

  it('binds the distinct key, ABI and stages and keeps signing closed', () => {
    expect(resolveCurrentCheapDexCandidate('cheap-exit')).toBe(exit);
    expect(currentCheapDexCandidateKey(exit)).toBe('cheap-exit');
    expect(currentCheapDexQuoteProtocol(exit)).toBe('quote-slippage');
    expect(currentCheapDexStages(exit)).toEqual({ workCalls: 4, ready: 5, funded: 6, settled: 7, released: 8 });
    expect(exit.protocol.quoteSignature).toBe(new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI).getFunction('quoteCheapAsync')!.format('sighash'));
    expect(CURRENT_CHEAP_DEX_CANDIDATE).toBe(STAGED_D06_DEX_CANDIDATE);
    expect(resolveCurrentCheapDexCandidate('cheap-current')).toBe(STAGED_D06_DEX_CANDIDATE);
    expect(exit.readyToSign).toBe(false);
    expect(exit.nativeScope).toEqual({ sixMarketPublicBinding: true, fullFixtureAdmission: false, connectedAppWalletHeld: true, noBetaAcceptance: true });
    expect(() => assertCurrentCheapDexNativeAdmission(exit)).toThrow('native App submission admission');
    for (const patch of [{ graph: prepared.graph }, { packageSha256: prepared.packageSha256 }, { core: prepared.core }]) {
      expect(() => currentCheapDexCandidateKey({ ...exit, ...patch })).toThrow('do not match');
    }
  });

  it('resolves only the complete descriptors for both candidates', () => {
    expect(resolvePreparedDexScope().candidate).toBe(prepared);
    for (const [key, candidate] of [['cheap-prepared', prepared], ['cheap-exit', exit]] as const) {
      expect(resolvePreparedDexScope(key)).toEqual({ key, candidate });
      expect(resolvePreparedDexScope(candidate).candidate).toBe(candidate);
      expect(resolvePreparedDexScope(structuredClone(candidate)).candidate).toBe(candidate);
      for (const field of Reflect.ownKeys(candidate)) {
        const changed = { ...candidate, [field]: undefined };
        expect(() => resolvePreparedDexScope(changed)).toThrow('candidate changed');
      }
      const extra = { ...candidate, extra: undefined };
      const forged = { ...candidate, toJSON: () => candidate };
      const hidden = Object.defineProperty({ ...candidate }, 'hidden', { value: undefined });
      const symbol = { ...candidate, [Symbol('extra')]: undefined };
      const accessor = Object.defineProperty({ ...candidate }, 'core', { get: () => { throw new Error('GETTER_MUST_NOT_RUN'); } });
      expect(() => resolvePreparedDexScope(extra)).toThrow('candidate changed');
      expect(() => resolvePreparedDexScope(forged)).toThrow('candidate changed');
      expect(() => resolvePreparedDexScope(hidden)).toThrow('candidate changed');
      expect(() => resolvePreparedDexScope(symbol)).toThrow('candidate changed');
      expect(() => resolvePreparedDexScope(accessor)).toThrow('candidate changed');
      const stages = { ...candidate, protocol: { ...candidate.protocol, stages: { ...candidate.protocol.stages, ready: 4 } } };
      const pairs = { ...candidate, pairs: candidate.pairs.slice(1) };
      expect(() => resolvePreparedDexScope(stages)).toThrow('candidate changed');
      expect(() => resolvePreparedDexScope(pairs)).toThrow('candidate changed');
    }
    for (const key of ['cheap-current', 'cheap-d06', 'cheap-native', 'wrong']) {
      expect(() => resolvePreparedDexScope(key as 'cheap-prepared')).toThrow('candidate changed');
    }
  });

  it('freezes every nested public descriptor object and array', () => {
    const check = (value: unknown): void => {
      if (value && typeof value === 'object') {
        expect(Object.isFrozen(value)).toBe(true);
        Object.values(value).forEach(check);
      }
    };
    check(exit);
  });
});
