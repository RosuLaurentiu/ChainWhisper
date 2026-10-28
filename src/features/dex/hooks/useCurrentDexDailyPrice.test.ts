import { describe,expect,it } from 'vitest';
import { makeHistoryFixture } from '../../../../tests/fixtures/history.fixture';
import { currentDexDailyPriceScope,loadCurrentDexDailyPrice } from './useCurrentDexDailyPrice';
describe('Current DEX daily history request scope',()=>{
  it('accepts the reverse display pair without rewriting canonical source samples',async()=>{
    const f=makeHistoryFixture(),pair=[f.manifest.symbols[1],f.manifest.symbols[0]] as const;
    const view=await loadCurrentDexDailyPrice({config:f.config,pair,provider:f.provider});
    expect(view.status).toBe('ready');
    if(view.status!=='ready')throw Error('Missing verified history');
    expect(view.snapshot.manifest.symbols).toEqual(f.manifest.symbols);
    expect(view.snapshot.slots.some(slot=>slot.point!==null)).toBe(true);
  });
  it('keeps inactive configuration and changed pair outside RPC',async()=>{
    const f=makeHistoryFixture();expect(await loadCurrentDexDailyPrice({config:{status:'inactive'},pair:f.manifest.symbols,provider:{request:()=>{throw Error('MUST_NOT_READ');}}})).toEqual({status:'unconfigured'});
    expect(await loadCurrentDexDailyPrice({config:f.config,pair:['BCN','HBR'],provider:{request:()=>{throw Error('MUST_NOT_READ');}}})).toMatchObject({status:'error',kind:'mismatch'});
    expect(currentDexDailyPriceScope(f.config,['BCN','HBR'])).not.toBe(currentDexDailyPriceScope(f.config,f.manifest.symbols));
  });
  it.each(['ready','empty','rpc','reorg','mismatch'] as const)('returns the exact %s state through appChain',async mode=>{
    const f=makeHistoryFixture(mode),view=await loadCurrentDexDailyPrice({config:f.config,pair:f.manifest.symbols,provider:f.provider});expect(view.status).toBe(['rpc','reorg','mismatch'].includes(mode)?'error':mode);if(view.status==='error')expect(view.kind).toBe(mode);
  });
  it('rejects a superseded read before a settled page can be exposed',async()=>{
    const f=makeHistoryFixture();let calls=0;const view=await loadCurrentDexDailyPrice({config:f.config,pair:f.manifest.symbols,provider:f.provider,assertCurrent:()=>{if(++calls>4)throw Error('superseded');}});expect(view.status).toBe('error');
  });
});
