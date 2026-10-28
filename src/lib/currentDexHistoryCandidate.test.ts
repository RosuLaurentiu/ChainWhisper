import { describe, expect, it } from 'vitest';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as history } from './currentDexHistoryCandidate';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE as previous, resolveCurrentCheapDexCandidate,
  currentCheapDexCandidateKey, currentCheapDexStages, currentCheapDexQuoteProtocol,
  assertCurrentCheapDexNativeAdmission, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { currentDexDisplayPair, parseDexCandidateTokenAmount, readCurrentDexDisplay } from './currentDexDisplay';
import { currentLimitAbiForCandidate, exitLimitAbi, currentLimitOwnerNativeAdmission,
  resolveCurrentLimitScope } from './currentDexLimit';
import { assertCurrentD06AppAuthority, assertCurrentAppSigningCount, CURRENT_APP_SWAP_OWNER } from './currentDexC1SwapPolicy';
import { resolveCurrentDexAppCandidate } from './currentDexAppScope';

const key: CurrentCheapDexCandidateKey = 'cheap-history';

describe('shared history public candidate and separate signing admission', () => {
  it('resolves the exact new identity and four-work protocol without replacing the old candidate', () => {
    expect(resolveCurrentCheapDexCandidate(key)).toBe(history);
    expect(currentCheapDexCandidateKey(history)).toBe(key);
    expect(resolveCurrentCheapDexCandidate('cheap-exit')).toBe(previous);
    expect(currentCheapDexStages(history)).toEqual({ workCalls: 4, ready: 5, funded: 6, settled: 7, released: 8 });
    expect(currentCheapDexQuoteProtocol(history)).toBe('quote-slippage');
    expect(history.readyToSign).toBe(false);
    expect(() => assertCurrentCheapDexNativeAdmission(history)).toThrow('submission admission is absent');
    expect(resolveCurrentDexAppCandidate('coti-testnet-candidate').candidate).toBe(history);
    expect(resolveCurrentDexAppCandidate('coti-testnet-candidate', 'cheap-exit').candidate).toBe(previous);
  });

  it('rejects mixed public descriptors and preserves all six exact market pairs and decimals', () => {
    expect(resolvePreparedDexScope(key).candidate).toBe(history);
    expect(resolvePreparedDexScope(history).key).toBe(key);
    for (const field of ['graph', 'packageSha256', 'core'] as const)
      expect(() => resolvePreparedDexScope({ ...history, [field]: previous[field] })).toThrow('candidate changed');
    expect(() => resolvePreparedDexScope({ ...history, readyToSign: true } as unknown as Parameters<typeof resolvePreparedDexScope>[0])).toThrow('candidate changed');
    const display = readCurrentDexDisplay(history);
    expect(display.tokens).toHaveLength(4);
    expect(display.pairs).toHaveLength(6);
    for (const pair of display.pairs) {
      expect(currentDexDisplayPair(history, pair.tokens[1].address, pair.tokens[0].address).marketId).toBe(pair.marketId);
      for (const token of pair.tokens) {
        expect(token.decimals).toBe(6);
        expect(parseDexCandidateTokenAmount(history, token.address, '0.000001', 'Amount', true)).toBe(1n);
      }
      expect(resolveCurrentLimitScope(key, pair.tokens.map(token => token.address) as [string, string]).marketId).toBe(pair.marketId);
    }
  });

  it('uses admitted Limit phases and owner swaps while retaining other signing holds', () => {
    expect(currentLimitAbiForCandidate(key)).toBe(exitLimitAbi);
    expect(currentLimitOwnerNativeAdmission(key)).toEqual({ refresh: true, claim: true, pause: true,
      resume: true, close: true, topup: true, reprice: true });
    expect(() => assertCurrentD06AppAuthority(history.graph)).toThrow('hold');
    expect(() => assertCurrentD06AppAuthority(history.graph, { principal: CURRENT_APP_SWAP_OWNER,
      destination: CURRENT_APP_SWAP_OWNER, profile: 'cheap-async', inputToken: history.tokens[1][0],
      outputToken: history.tokens[0][0], maximumInput: 1_000_000n })).not.toThrow();
    expect(() => assertCurrentD06AppAuthority(history.graph, { principal: CURRENT_APP_SWAP_OWNER,
      destination: history.core, profile: 'cheap-async', inputToken: history.tokens[1][0],
      outputToken: history.tokens[0][0], maximumInput: 1_000_000n })).toThrow('hold');
  });

  it('keeps the exhausted b2aa Quote count charged', () => {
    expect(() => assertCurrentAppSigningCount(previous.graph, CURRENT_APP_SWAP_OWNER, 'quote',
      Array.from({ length: 4 }, () => ({ phase: 'quote' })))).toThrow('reserved');
  });
});
