import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { CURRENT_CHEAP_DEX_CANDIDATE as current,STAGED_EXIT_PREVIEW_DEX_CANDIDATE as exit,STAGED_SHARED_HISTORY_DEX_CANDIDATE as history } from '../../../lib/dexV2Deployment';
import { CURRENT_DEX_DISPLAY_PAIR,readCurrentDexDisplay } from '../../../lib/currentDexDisplay';
import { type CurrentDexDailyPriceView } from '../../../lib/currentDexDailyPrice';
import { EXIT_TESTNET_DEX_DAILY_PRICE_MANIFESTS } from '../../../lib/currentDexExitDailyPriceTestnet';
import { HISTORY_FIXTURE_DAY,makeHistoryFixture } from '../../../../tests/fixtures/history.fixture';
import { loadCurrentDexDailyPrice } from './useCurrentDexDailyPrice';
import useCurrentDexMarketReference,{loadCurrentDexMarketReference} from './useCurrentDexMarketReference';

const state=vi.hoisted(()=>({view:{status:'unconfigured'}as CurrentDexDailyPriceView,read:vi.fn()}));
vi.mock('./useCurrentDexDailyPrice',async original=>({...await original<typeof import('./useCurrentDexDailyPrice')>(),default:(input:unknown)=>{state.read(input);return{view:state.view,refresh:()=>{}};}}));
afterEach(()=>{state.view={status:'unconfigured'};vi.clearAllMocks();vi.useRealTimers();});
describe('selected candidate market-reference hook',()=>{
  it('retains the historical default and active read configuration',()=>{
    function View(){return <output>{useCurrentDexMarketReference(true).status}</output>;}
    expect(renderToStaticMarkup(<View/>)).toContain('unavailable');
    expect(state.read).toHaveBeenLastCalledWith(expect.objectContaining({pair:CURRENT_DEX_DISPLAY_PAIR,count:1,config:expect.objectContaining({status:'active',manifest:expect.objectContaining({source:expect.any(String)})})}));
  });
  it('binds each current market and orientation to its accepted recorder',()=>{
    for(const pair of readCurrentDexDisplay(exit).pairs){const selected=pair.tokens.map(token=>token.label)as[string,string];
      const manifest=EXIT_TESTNET_DEX_DAILY_PRICE_MANIFESTS.find(m=>m.market===pair.marketId);
      expect(manifest).toBeDefined();
      for(const direction of [selected,[selected[1],selected[0]]as[string,string]]){
      function View(){return <output>{useCurrentDexMarketReference(true,exit,direction).status}</output>;}
      expect(renderToStaticMarkup(<View/>)).toContain('unavailable');
      expect(state.read).toHaveBeenLastCalledWith({pair:direction,count:1,config:expect.objectContaining({status:'active',manifest})});
      }
    }
  });
  it('uses the selected ratio for a verified observation and never reuses it for a different pair',async()=>{
    const f=makeHistoryFixture();state.view=await loadCurrentDexDailyPrice({config:f.config,pair:f.manifest.symbols,provider:f.provider});
    vi.useFakeTimers();vi.setSystemTime(Number(HISTORY_FIXTURE_DAY*86400n+100n)*1000);
    const reversed=[f.manifest.symbols[1],f.manifest.symbols[0]]as const;
    function View(){const r=useCurrentDexMarketReference(true,current,reversed);return <output>{r.status==='available'?r.price:r.status}</output>;}
    expect(renderToStaticMarkup(<View/>)).toContain('0.5');
    function Other(){return <output>{useCurrentDexMarketReference(true,current,['BCN','HBR']).status}</output>;}
    expect(renderToStaticMarkup(<Other/>)).toContain('unavailable');
  });
  it('starts the current candidate Core read without a daily recorder and keeps inactive pages unavailable',()=>{
    for(const active of [true,false]){
      function View(){return <output>{useCurrentDexMarketReference(active,history,['HBR','BCN']).status}</output>;}
      expect(renderToStaticMarkup(<View/>)).toContain(active?'loading':'unavailable');
      expect(state.read).toHaveBeenLastCalledWith({pair:['HBR','BCN'],count:1,config:{status:'inactive'}});
    }
  });
  it('does not expose an earlier candidate daily price on the current candidate',async()=>{
    const f=makeHistoryFixture();state.view=await loadCurrentDexDailyPrice({config:f.config,pair:f.manifest.symbols,provider:f.provider});
    function View(){return <output>{useCurrentDexMarketReference(true,history,f.manifest.symbols).status}</output>;}
    expect(renderToStaticMarkup(<View/>)).toContain('loading');
  });
  it('keeps a changed current descriptor outside the public read path',()=>{
    function View(){return <output>{useCurrentDexMarketReference(true,{...history,core:exit.core},['HBR','BCN']).status}</output>;}
    expect(renderToStaticMarkup(<View/>)).toContain('unavailable');
    expect(state.read).toHaveBeenLastCalledWith({pair:['HBR','BCN'],count:1,config:{status:'inactive'}});
  });
  it('rejects superseded public reads and RPC failures without using recorder data',async()=>{
    const provider={request:vi.fn(async()=>{throw Error('RPC unavailable');})};
    expect(await loadCurrentDexMarketReference({candidate:history,pair:['HBR','BCN'],provider})).toMatchObject({status:'error',kind:'rpc'});
    provider.request.mockClear();
    expect(await loadCurrentDexMarketReference({candidate:history,pair:['HBR','BCN'],provider,assertCurrent:()=>{throw Error('superseded');}})).toMatchObject({status:'error',message:'superseded'});
    expect(provider.request).not.toHaveBeenCalled();
  });
  it('rejects invalid candidate and pair scopes before a public request',async()=>{
    const provider={request:vi.fn(async()=>{throw Error('MUST_NOT_READ');})};
    for(const input of [{candidate:{...history,core:exit.core},pair:['HBR','BCN'] as const},{candidate:history,pair:['HBR','wrong'] as const}]){
      expect(await loadCurrentDexMarketReference({...input,provider})).toMatchObject({status:'error'});
    }
    expect(provider.request).not.toHaveBeenCalled();
  });
});
