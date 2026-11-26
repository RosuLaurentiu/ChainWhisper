import { describe, expect, it } from 'vitest';
import { selectCurrentDexCandidate } from './selectedCurrentDexCandidate';
import { resolveCurrentCheapDexCandidate,  currentCheapDexCandidateKey, currentCheapDexStages, currentCheapDexQuoteProtocol,  rejectUnprovenNativeAdmission, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { currentDexDisplayPair, parseDexCandidateTokenAmount, readCurrentDexDisplay } from './currentDexDisplay';
import { currentLimitAbiForCandidate, packedLimitAbi, usesPackedLimitInputs, currentLimitOwnerNativeAdmission,
  resolveCurrentLimitScope } from './currentDexLimit';
import { assertCurrentD06AppAuthority, CURRENT_APP_SWAP_OWNER } from './currentDexC1SwapPolicy';
import { resolveCurrentDexAppCandidate } from './currentDexAppScope';

const key: CurrentCheapDexCandidateKey = 'cheap-history';
// The key 'cheap-history' names the selected current candidate. decision-034 removed the earlier shared-history
// and b2aa descriptors; changed identities stand for them.
const history = selectCurrentDexCandidate(undefined);
const retired = { ...history, graph: '11'.repeat(32), packageSha256: '22'.repeat(32), core: `0x${'33'.repeat(20)}` };
const previous = { graph: '44'.repeat(32), packageSha256: '55'.repeat(32), core: `0x${'66'.repeat(20)}` };

describe('shared history public candidate and separate signing admission', () => {
  it('selects only current App history', () => {
    expect(resolveCurrentCheapDexCandidate(key)).toBe(history);
    expect(currentCheapDexCandidateKey(history)).toBe(key);
    expect(retired.graph).not.toBe(history.graph);
    expect(() => currentCheapDexCandidateKey(retired)).toThrow('do not match a reviewed candidate');
    expect(currentCheapDexStages(history)).toEqual({ workCalls: 4, ready: 5, funded: 6, settled: 7, released: 8 });
    expect(currentCheapDexQuoteProtocol(history)).toBe('quote-slippage');
    expect(history.readyToSign).toBe(false);
    expect(() => rejectUnprovenNativeAdmission()).toThrow('submission admission is absent');
    expect(resolveCurrentDexAppCandidate('coti-testnet-candidate').candidate).toBe(history);
    expect(resolveCurrentDexAppCandidate('coti-testnet-candidate', key).candidate).toBe(history);
    expect(() => resolveCurrentDexAppCandidate('coti-testnet-candidate', 'cheap-exit')).toThrow('Invalid development DEX candidate selection');
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

  it('uses admitted Limit phases but holds owner swaps without a live browser signer', () => {
    // The selected graph takes packed Limit inputs, so its Limit ABI is the packed one (currentDexLimit.ts).
    expect(usesPackedLimitInputs(history)).toBe(true);
    expect(currentLimitAbiForCandidate(key)).toBe(packedLimitAbi);
    expect(currentLimitOwnerNativeAdmission(key)).toEqual({ refresh: true, claim: true, pause: true,
      resume: true, close: true, topup: true, reprice: true });
    expect(() => assertCurrentD06AppAuthority(history.graph)).toThrow('hold');
    expect(() => assertCurrentD06AppAuthority(history.graph, { principal: CURRENT_APP_SWAP_OWNER,
      destination: CURRENT_APP_SWAP_OWNER, profile: 'cheap-async', inputToken: history.tokens[1][0],
      outputToken: history.tokens[0][0], maximumInput: 1_000_000n })).toThrow('signing hold');
    expect(() => assertCurrentD06AppAuthority(history.graph, { principal: CURRENT_APP_SWAP_OWNER,
      destination: history.core, profile: 'cheap-async', inputToken: history.tokens[1][0],
      outputToken: history.tokens[0][0], maximumInput: 1_000_000n })).toThrow('hold');
  });
});
