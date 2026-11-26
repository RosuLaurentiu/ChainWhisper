import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { AbiCoder,Interface,keccak256 } from '@coti-io/coti-ethers';
const exit={core:`0x${'99'.repeat(20)}`};
import { STAGED_BUILD13_DEX_CANDIDATE as history } from '../../../lib/currentDexBuild13Candidate';
import { makeCurrentReferenceStorage } from '../../../../tests/fixtures/currentReferenceSource.fixture';
// The current build 13 candidate is the selected candidate.
import { CURRENT_DEX_DISPLAY_PAIR,readCurrentDexDisplay } from '../../../lib/currentDexDisplay';
import { type CurrentDexDailyPriceView } from '../../../lib/currentDexDailyPrice';
import { makeHistoryFixture } from '../../../../tests/fixtures/history.fixture';
import { loadCurrentDexDailyPrice } from './useCurrentDexDailyPrice';
import * as priceReads from '../../../lib/currentDexDailyPrice';
import useCurrentDexMarketReference,{loadCurrentDexMarketReference,MARKET_IDLE_AFTER_MS,MARKET_POLL_MS} from './useCurrentDexMarketReference';
import * as core from '../../../lib/appShared/core';

// Same synthetic runtime identities as currentDexMarketReference.test.ts.
vi.mock('@coti-io/coti-ethers',async original=>{
  const actual=await original<typeof import('@coti-io/coti-ethers')>();
  // '0x6001' stands for the Core runtime of the current build 13 candidate (its runtimes entry); '0x6002' for a token runtime.
  return{...actual,keccak256:(value:string)=>value==='0x6001'?'0x3f42c901c1e7f8cd20095801a685c23c4ac61ce0921822b29c08a3d974c94807':
    value==='0x6002'?'0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0':actual.keccak256(value)};
});

async function verifiedPublicSnapshot(mode:'available'|'stale'|'suppressed'='available'){
  const coder=AbiCoder.defaultAbiCoder(),api=new Interface(['function poolReference(bytes32) view returns(bytes)']);
  const market=history.pairs[0],display=readCurrentDexDisplay(history).pairs.find(row=>row.marketId===market.marketId)!;
  const [token0,token1]=display.tokens,core=history.runtimes.find(([role])=>role==='ChainWhisperDexCore')!;
  const at=1_800_000_000n,sampledAt=mode==='stale'?at-121n:at-1n;
  const types=['bytes32','bytes32','uint256','address','bytes32','bytes32','bytes32','bytes32','uint256','uint256','uint256','address','address','uint8','uint8','uint256','uint256','uint256','uint256','bytes32','bool'];
  const values=[priceReads.PACKED_INPUT_DEX_DAILY_PRICE_SOURCE.schema,priceReads.PACKED_INPUT_DEX_DAILY_PRICE_SOURCE.policy,history.chainId,
    history.core,core[2],history.releaseId,market.marketId,
    keccak256(coder.encode(['uint256','address','address'],[history.chainId,token0.address,token1.address])),
    market.canonicalId,1n,1n,token0.address,token1.address,token0.decimals,token1.decimals,2n*10n**18n,sampledAt,199n,3n,`0x${'77'.repeat(32)}`,mode!=='suppressed'];
  vi.spyOn(Date,'now').mockReturnValue(Number(at)*1000);
  const storage=makeCurrentReferenceStorage({sourceGraph:history.graph,chainId:history.chainId,source:history.core,sourceRuntimeHash:core[2],releaseId:history.releaseId,market:market.marketId,canonicalId:market.canonicalId,token0:token0.address,token1:token1.address,decimals0:token0.decimals,decimals1:token1.decimals},values);values[19]=storage.commitment;
  if(mode==='suppressed')values[15]=0n;
  const provider={request:async({method,params=[]}:{method:string;params?:unknown[]}):Promise<unknown>=>{
    if(method==='eth_chainId')return `0x${BigInt(history.chainId).toString(16)}`;
    if(method==='eth_getBlockByNumber'){
      const n=params[0]==='latest'?'0xc8':String(params[0]);
      return{number:n,hash:n==='0x0'?history.genesisHash:`0x${(n==='0xc7'?'77':'88').repeat(32)}`,timestamp:`0x${(n==='0xc7'?sampledAt:at).toString(16)}`};
    }
    if(method==='eth_getCode')return String(params[0]).toLowerCase()===history.core.toLowerCase()?'0x6001':'0x6002';
    if(method==='eth_call')return api.encodeFunctionResult('poolReference',[coder.encode(types,values)]);
    if(method==='eth_getProof')return storage.rpc(method,params);
    throw Error('Unexpected local reference method.');
  }};
  return priceReads.readCurrentDexPublicReference({provider,candidate:history,pair:['HBR','BCN'],finalityLagBlocks:0});
}

// Reuse the adjacent balance hook's state/effect harness for timer-only checks.
const hooks=vi.hoisted(()=>({enabled:false,index:0,slots:[] as {
  value?:unknown;deps?:readonly unknown[];cleanup?:()=>void
}[],effects:[] as (()=>void)[]}));
vi.mock('react',async original=>{
  const actual=await original<typeof import('react')>();
  const memo=(factory:()=>unknown,deps:readonly unknown[])=>{
    const i=hooks.index++,old=hooks.slots[i];
    if(!old||deps.some((dep,index)=>!Object.is(dep,old.deps?.[index])))hooks.slots[i]={value:factory(),deps};
    return hooks.slots[i].value;
  };
  return {...actual,
    useRef:(initial:unknown)=>!hooks.enabled?actual.useRef(initial):
      (hooks.slots[hooks.index++]??={value:{current:initial}}).value,
    useState:(initial:unknown)=>{
      if(!hooks.enabled)return actual.useState(initial);
      const i=hooks.index++;hooks.slots[i]??={value:typeof initial==='function'?initial():initial};
      return[hooks.slots[i].value,(next:unknown)=>{hooks.slots[i].value=typeof next==='function'?next(hooks.slots[i].value):next;}];
    },
    useCallback:(fn:()=>unknown,deps:readonly unknown[])=>!hooks.enabled?actual.useCallback(fn,deps):memo(()=>fn,deps),
    useEffect:(effect:()=>void|(()=>void),deps:readonly unknown[])=>{
      if(!hooks.enabled)return actual.useEffect(effect,deps);
      const i=hooks.index++,old=hooks.slots[i];
      if(!old||deps.some((dep,index)=>!Object.is(dep,old.deps?.[index]))){
        hooks.slots[i]={deps,cleanup:old?.cleanup};
        hooks.effects.push(()=>{hooks.slots[i].cleanup?.();hooks.slots[i].cleanup=effect()||undefined;});
      }
    }
  };
});
const state=vi.hoisted(()=>({view:{status:'unconfigured'}as CurrentDexDailyPriceView,read:vi.fn(),refresh:vi.fn()}));
vi.mock('./useCurrentDexDailyPrice',async original=>({...await original<typeof import('./useCurrentDexDailyPrice')>(),default:(input:unknown)=>{state.read(input);return{view:state.view,refresh:state.refresh};}}));
afterEach(()=>{
  hooks.slots.forEach(slot=>slot.cleanup?.());hooks.enabled=false;hooks.index=0;hooks.slots=[];hooks.effects=[];
  state.view={status:'unconfigured'};vi.restoreAllMocks();vi.clearAllMocks();vi.useRealTimers();vi.unstubAllGlobals();
});
describe('selected candidate market-reference hook',()=>{
  it.each(['error','stale','suppressed'] as const)('retains a verified display during a held poll, expires it, then publishes %s',async mode=>{
    const first=await verifiedPublicSnapshot(),next=mode==='error'?undefined:await verifiedPublicSnapshot(mode);
    expect(priceReads.isVerifiedCurrentDexPublicReference(first)).toBe(true);
    hooks.enabled=true;vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);vi.stubGlobal('window',globalThis);
    let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
    vi.spyOn(priceReads,'getCurrentDexPriceReadProvider').mockReturnValue({request:async()=>null});
    const read=vi.spyOn(priceReads,'readCurrentDexPublicReference').mockResolvedValueOnce(first).mockImplementation(async({assertCurrent})=>{
      await held;await assertCurrent?.();if(!next)throw Error('New reference read failed.');return next;
    });
    const Render=()=>{hooks.index=0;const view=useCurrentDexMarketReference(true,history,['HBR','BCN']);hooks.effects.splice(0).forEach(effect=>effect());return view;};
    expect(Render().status).toBe('loading');await vi.advanceTimersByTimeAsync(0);
    expect(Render()).toMatchObject({status:'available',price:2});
    for(let second=1;second<=121;second++){
      await vi.advanceTimersByTimeAsync(1000);const view=Render();
      if(second===60)expect(view).toMatchObject({status:'available',price:2});
      expect(read).toHaveBeenCalledTimes(second>=60?2:1);
    }
    expect(Render()).toMatchObject({status:'last-known',price:2,pair:['HBR','BCN']});
    release();await vi.advanceTimersByTimeAsync(0);
    expect(Render()).toMatchObject({status:'last-known',price:2});
    expect(hooks.slots.some(slot=>{
      const settled=slot.value as {view?:{snapshot?:unknown;message?:string}}|null;
      return next?settled?.view?.snapshot===next:settled?.view?.message==='New reference read failed.';
    })).toBe(true);
  });
  it('clears a verified display on pair, candidate and route changes',async()=>{
    const snapshot=await verifiedPublicSnapshot();
    hooks.enabled=true;vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);vi.stubGlobal('window',globalThis);
    vi.spyOn(priceReads,'getCurrentDexPriceReadProvider').mockReturnValue({request:async()=>null});
    vi.spyOn(priceReads,'readCurrentDexPublicReference').mockResolvedValueOnce(snapshot).mockImplementation(()=>new Promise(()=>{}));
    const Render=(active=true,candidate=history,pair:readonly[string,string]=['HBR','BCN'])=>{
      hooks.index=0;const view=useCurrentDexMarketReference(active,candidate,pair);hooks.effects.splice(0).forEach(effect=>effect());return view;
    };
    Render();await vi.advanceTimersByTimeAsync(0);expect(Render().status).toBe('available');
    expect(Render(true,history,['BCN','HBR']).status).toBe('loading');
    expect(Render().status).toBe('loading');
    expect(Render(true,{...history}).status).toBe('loading');
    expect(Render(false).status).toBe('unavailable');expect(Render().status).toBe('loading');
  });
  it('keeps both DEX attempts through one-second renders and publishes after a held read',async()=>{
    hooks.enabled=true;vi.useFakeTimers();vi.stubGlobal('window',globalThis);
    const {default:useDailyPrice}=await vi.importActual<typeof import('./useCurrentDexDailyPrice')>('./useCurrentDexDailyPrice');
    const fixture=makeHistoryFixture();
    let release!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;});
    const chartRequests=vi.fn(async(input:Parameters<typeof fixture.provider.request>[0])=>{
      await held;return fixture.provider.request(input);
    });
    const chartProvider={request:chartRequests};
    const chartRead=vi.spyOn(priceReads,'readCurrentDexDailyPrice');
    vi.spyOn(priceReads,'getCurrentDexPriceReadProvider').mockReturnValue(chartProvider);
    const read=vi.spyOn(priceReads,'readCurrentDexPublicReference').mockImplementation(async({assertCurrent})=>{
      await held;await assertCurrent?.();throw Error('Fixture reference unavailable.');
    });
    const Render=()=>{
      hooks.index=0;
      const reference=useCurrentDexMarketReference(true,history,['HBR','BCN']);
      const chart=useDailyPrice({pair:[...fixture.manifest.symbols],config:{...fixture.config}});
      hooks.effects.splice(0).forEach(effect=>effect());return{reference,chart:chart.view};
    };
    expect(Render()).toMatchObject({reference:{status:'loading'},chart:{status:'loading'}});
    for(let second=0;second<61;second++){
      await vi.advanceTimersByTimeAsync(1000);
      expect(Render()).toMatchObject({reference:{status:'loading'},chart:{status:'loading'}});
      expect(read).toHaveBeenCalledTimes(1);expect(chartRead).toHaveBeenCalledTimes(1);
    }
    expect(chartRequests).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][0].provider).toBe(chartProvider);
    release();await vi.advanceTimersByTimeAsync(0);
    const settled=Render();
    expect(settled.reference.status).toBe('unavailable');expect(settled.chart.status).toBe('ready');
    if(settled.chart.status!=='ready')throw Error('Missing verified chart publication.');
    expect(priceReads.isVerifiedCurrentDexDailyPrice(settled.chart.snapshot)).toBe(true);
    expect(chartRead).toHaveBeenCalledTimes(1);
    expect(hooks.slots.some(slot=>(slot.value as {view?:{message?:string}})?.view?.message==='Fixture reference unavailable.')).toBe(true);
    await vi.advanceTimersByTimeAsync(29000);Render();
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('reads only while the user is active and reads again at once when activity returns',async()=>{
    const snapshot=await verifiedPublicSnapshot();
    hooks.enabled=true;vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);
    const target=Object.assign(new EventTarget(),{setInterval:globalThis.setInterval.bind(globalThis),clearInterval:globalThis.clearInterval.bind(globalThis)});
    vi.stubGlobal('window',target);
    vi.spyOn(priceReads,'getCurrentDexPriceReadProvider').mockReturnValue({request:async()=>null});
    const read=vi.spyOn(priceReads,'readCurrentDexPublicReference').mockResolvedValue(snapshot);
    const resume=vi.spyOn(core,'resumeCotiReadsAfterTransientStop').mockReturnValue(false);
    const Render=()=>{hooks.index=0;const view=useCurrentDexMarketReference(true,history,['HBR','BCN']);hooks.effects.splice(0).forEach(effect=>effect());return view;};
    const advance=async(seconds:number)=>{for(let i=0;i<seconds;i++){await vi.advanceTimersByTimeAsync(1000);Render();}};
    Render();await vi.advanceTimersByTimeAsync(0);Render();
    expect(read).toHaveBeenCalledTimes(1);
    await advance(MARKET_POLL_MS/1000);expect(read).toHaveBeenCalledTimes(2);
    // No input for ten minutes: reads stop and the last price stays.
    await advance(MARKET_IDLE_AFTER_MS/1000+120);
    const idleReads=read.mock.calls.length;expect(idleReads).toBe(MARKET_IDLE_AFTER_MS/MARKET_POLL_MS);
    await advance(300);expect(read).toHaveBeenCalledTimes(idleReads);
    expect(Render().status).toBe('last-known');
    target.dispatchEvent(new Event('pointerdown'));Render();
    expect(read).toHaveBeenCalledTimes(idleReads+1);
    // Activity within the minute does not add reads; a stopped reader that resumes reads at once.
    await advance(10);target.dispatchEvent(new Event('keydown'));Render();
    expect(read).toHaveBeenCalledTimes(idleReads+1);
    resume.mockReturnValueOnce(true);target.dispatchEvent(new Event('keydown'));Render();
    expect(read).toHaveBeenCalledTimes(idleReads+2);
  });
  it('retains route, pair and candidate invalidation while the reference is pending',async()=>{
    hooks.enabled=true;vi.useFakeTimers();vi.stubGlobal('window',globalThis);
    const assertions:Array<()=>void|Promise<void>>=[];
    vi.spyOn(priceReads,'getCurrentDexPriceReadProvider').mockReturnValue({request:async()=>null});
    const read=vi.spyOn(priceReads,'readCurrentDexPublicReference').mockImplementation(({assertCurrent})=>{
      assertions.push(assertCurrent!);return new Promise(()=>{});
    });
    const Render=(active=true,candidate=history,pair:readonly[string,string]=['HBR','BCN'])=>{
      hooks.index=0;const view=useCurrentDexMarketReference(active,candidate,pair);hooks.effects.splice(0).forEach(effect=>effect());return view;
    };
    Render();Render(true,history,['BCN','HBR']);
    expect(read).toHaveBeenCalledTimes(2);expect(()=>assertions[0]()).toThrow('superseded');
    Render(true,{...history},['BCN','HBR']);
    expect(read).toHaveBeenCalledTimes(3);expect(()=>assertions[1]()).toThrow('superseded');
    expect(Render(false).status).toBe('unavailable');expect(()=>assertions[2]()).toThrow('superseded');
    await vi.advanceTimersByTimeAsync(61000);expect(read).toHaveBeenCalledTimes(3);
  });
  it('starts the default current candidate Core read without a daily recorder',()=>{
    function View(){return <output>{useCurrentDexMarketReference(true).status}</output>;}
    expect(renderToStaticMarkup(<View/>)).toContain('loading');
    expect(state.read).toHaveBeenLastCalledWith(expect.objectContaining({pair:CURRENT_DEX_DISPLAY_PAIR,count:1,config:{status:'inactive'}}));
  });
  it('uses the current Core for each market and orientation without a recorder fallback',()=>{
    for(const pair of readCurrentDexDisplay(history).pairs){const selected=pair.tokens.map(token=>token.label)as[string,string];
      for(const direction of [selected,[selected[1],selected[0]]as[string,string]]){
      function View(){return <output>{useCurrentDexMarketReference(true,history,direction).status}</output>;}
      expect(renderToStaticMarkup(<View/>)).toContain('loading');
      expect(state.read).toHaveBeenLastCalledWith({pair:direction,count:1,config:{status:'inactive'}});
      }
    }
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
