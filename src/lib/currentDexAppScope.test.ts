import { describe, expect, it } from 'vitest';
import { currentDexAppPair, resolveCurrentDexAppCandidate } from './currentDexAppScope';
import { CURRENT_CHEAP_DEX_CANDIDATE, STAGED_EXIT_PREVIEW_DEX_CANDIDATE } from './dexV2Deployment';
import { CURRENT_DEX_DISPLAY_PAIR } from './currentDexDisplay';
import { currentNativeDexDailyPriceConfig } from './currentDexNativeDailyPriceTestnet';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE, assertCurrentCheapDexNativeAdmission } from './dexV2Deployment';
import { currentLimitOwnerNativeAdmission } from './currentDexLimit';
import { assertCurrentD06AppAuthority } from './currentDexC1SwapPolicy';

describe('main App DEX scope', () => {
  it('allows the exact shared-history Testnet scope while App swap signing remains held', () => {
    const scope=resolveCurrentDexAppCandidate('coti-testnet-candidate','cheap-history');
    expect(scope.key).toBe('cheap-history');expect(scope.candidate).toBe(STAGED_SHARED_HISTORY_DEX_CANDIDATE);
    for(const market of STAGED_SHARED_HISTORY_DEX_CANDIDATE.pairs){
      const symbols=new Map(STAGED_SHARED_HISTORY_DEX_CANDIDATE.tokenMetadata.map(t=>[t.address,t.symbol]));
      const pair=market.tokens.map(token=>symbols.get(token)!)as[string,string];
      expect(currentDexAppPair(scope,pair)).toBe(pair);
    }
    expect(()=>assertCurrentCheapDexNativeAdmission(scope.candidate)).toThrow();
    expect(()=>assertCurrentD06AppAuthority(scope.candidate.graph)).toThrow();
    expect(currentLimitOwnerNativeAdmission('cheap-history')).toEqual({refresh:true,claim:true,pause:true,resume:true,close:true,topup:true,reprice:true});
    expect(()=>resolveCurrentDexAppCandidate('production','cheap-history')).toThrow();
  });
  it.each(['production', 'development', 'test', ''])('keeps the normal candidate without selection in %s', mode => {
    const scope = resolveCurrentDexAppCandidate(mode);
    expect(scope.candidate).toBe(CURRENT_CHEAP_DEX_CANDIDATE);
    expect(scope.key).toBe('cheap-current');
    expect(currentDexAppPair(scope, ['BCN', 'HBR'])).toBe(CURRENT_DEX_DISPLAY_PAIR);
  });
  it.each([undefined, ''])('uses the maintained beta candidate by default in the Testnet build: %s', selection => {
    const scope = resolveCurrentDexAppCandidate('coti-testnet-candidate', selection);
    expect(scope.candidate).toBe(STAGED_SHARED_HISTORY_DEX_CANDIDATE);
    expect(scope.key).toBe('cheap-history');
    expect(scope.candidate.readyToSign).toBe(false);
    expect(() => assertCurrentD06AppAuthority(scope.candidate.graph)).toThrow('signing hold');
    expect(currentDexAppPair(scope, ['BCN', 'HBR'])).toEqual(['BCN', 'HBR']);
  });
  it.each(['production', 'development', 'test', ''])('rejects b2aa selection outside the Testnet build: %s', mode => {
    expect(() => resolveCurrentDexAppCandidate(mode, 'cheap-exit')).toThrow('Invalid development DEX candidate selection');
  });
  it.each(['cheap-prepared', 'cheap-current', 'cheap-native', 'unknown', ' cheap-exit'])('rejects unsupported explicit selection: %s', selection => {
    expect(() => resolveCurrentDexAppCandidate('coti-testnet-candidate', selection)).toThrow('Invalid development DEX candidate selection');
  });
  it('binds all six b2aa markets and both orientations to their exact recorder/Core', () => {
    const scope = resolveCurrentDexAppCandidate('coti-testnet-candidate', 'cheap-exit');
    expect(scope.candidate).toBe(STAGED_EXIT_PREVIEW_DEX_CANDIDATE);
    expect(scope.key).toBe('cheap-exit');
    if (scope.key !== 'cheap-exit') throw new Error('Expected selected beta scope.');
    const symbols = new Map(scope.candidate.tokenMetadata.map(token => [token.address, token.symbol]));
    const recorders = new Set<string>();
    for (const market of scope.candidate.pairs) {
      for (const addresses of [market.tokens, [...market.tokens].reverse()]) {
        const pair = addresses.map(address => symbols.get(address)!) as [string, string];
        expect(currentDexAppPair(scope, pair)).toBe(pair);
        const config = currentNativeDexDailyPriceConfig(scope.candidate, pair);
        expect(config.status).toBe('active');
        if (config.status !== 'active') throw new Error('Expected current recorder.');
        expect(config.manifest.source.toLowerCase()).toBe(scope.candidate.core.toLowerCase());
        expect(config.manifest.market).toBe(market.marketId);
        expect(config.manifest.sourceGraph).toBe(scope.candidate.graph);
        recorders.add(config.manifest.address);
      }
    }
    expect(recorders.size).toBe(6);
  });
  it.each([['BCN', 'unknown'], ['BCN', 'BCN'], ['Test token 0', 'Test token 1']])('rejects an out-of-scope pair %s/%s', (a, b) => {
    expect(() => currentDexAppPair(resolveCurrentDexAppCandidate('coti-testnet-candidate', 'cheap-exit'), [a, b])).toThrow('outside the development DEX candidate');
  });
});
