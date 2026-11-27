import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it,vi } from 'vitest';
import { AbiCoder, Interface } from '@coti-io/coti-ethers';
import { clearCurrentDexCompletedDayCacheForTests,readCurrentDexDailyPrice,type CurrentDexDailyPriceView } from '../../../lib/currentDexDailyPrice';
import { makeHistoryFixture } from '../../../../tests/fixtures/history.fixture';
import { currentDexMarketReference } from '../../../lib/currentDexMarketReference';
import DexMarketChart,{CandleMark,SampleTooltip,buildCurrentDexChartLivePoint,buildCurrentDexChartCandles,buildCurrentDexChartCarryPoints,buildCurrentDexChartLiveCandle,wrapExpandedChartFocus} from './DexMarketChart';
describe('DexMarketChart actual daily sample display',()=>{
  it('plots the last verified update on its completed day and keeps the live price separate',async()=>{
    const f=makeHistoryFixture(), event=new Interface(['event PoolReferenceUpdated(bytes32 indexed market, bytes32 indexed pair, bytes32 schema, bytes data)']);
    const fragment=event.getEvent('PoolReferenceUpdated')!, coder=AbiCoder.defaultAbiCoder();
    const price=175377000000000000n;
    const log=(n:bigint,p:bigint,revision:bigint)=>{
      const b=f.header(n), observation=f.observation(p,BigInt(b.timestamp),n,revision);
      return {address:f.manifest.source,blockNumber:b.number,blockHash:b.hash,removed:false,
        ...event.encodeEventLog(fragment,[f.manifest.market,f.manifest.pair,observation[0],coder.encode(f.observationTypes,observation)])};
    };
    const logs=[log(91n,price,3n),log(90n,2n*10n**18n,2n),log(99n,2n*10n**18n,4n)];
    const provider:typeof f.provider={request:args=>args.method==='eth_getLogs'?Promise.resolve(logs):f.provider.request(args)};
    const snapshot=await readCurrentDexDailyPrice({provider,manifest:f.manifest,finalityLagBlocks:0,includeCompletedDays:true});
    const day=BigInt(snapshot.atBlock.timestamp)/86400n-1n;
    expect(snapshot.completedDays).toEqual([{day:String(day),priceE18:String(price),sampledAt:String(BigInt(f.header(91n).timestamp)),sampledBlock:'91'}]);
    expect(snapshot.slots.find(s=>s.day===String(day))?.point?.sampledBlock).toBe('90');
    const reference=currentDexMarketReference({status:'ready',snapshot},f.manifest.symbols,BigInt(snapshot.atBlock.timestamp));
    const markup=renderToStaticMarkup(<DexMarketChart baseSymbol="cwTPA" quoteSymbol="cwTPB" history={{status:'ready',snapshot}} marketReference={reference}/>);
    expect(markup).toContain('Last sample 0.175377 cwTPB/cwTPA');
    expect(markup).toContain('Live 2 cwTPB/cwTPA');
    expect(markup).toContain('last verified observation per completed UTC day');
    // CW-141: when the price is no longer verified, today's candle keeps the last recorded price instead of disappearing.
    const known=currentDexMarketReference({status:'ready',snapshot},f.manifest.symbols,BigInt(snapshot.atBlock.timestamp)+121n);
    expect(known.status).toBe('last-known');
    const kept=renderToStaticMarkup(<DexMarketChart baseSymbol="cwTPA" quoteSymbol="cwTPB" history={{status:'ready',snapshot}} marketReference={known}/>);
    expect(kept).toContain('Last recorded 2 cwTPB/cwTPA');expect(kept).not.toContain('Live 2');
    expect(kept).toContain('current price is not verified');
    expect(buildCurrentDexChartLiveCandle({price:0.17,timestamp:1000},{timestamp:2000,price:0.21,recorded:true},20)).toMatchObject({recorded:true,body:[0.17,0.21]});
    expect(buildCurrentDexChartLiveCandle(undefined,{timestamp:2000,price:0.21,recorded:true},20)).not.toHaveProperty('live');
    logs[0]={...logs[0],blockHash:f.header(90n).hash};
    // CW-153: a tab reuses logs below an unchanged head; a fresh tab reads them again and finds the changed event.
    clearCurrentDexCompletedDayCacheForTests();
    await expect(readCurrentDexDailyPrice({provider,manifest:f.manifest,finalityLagBlocks:0,includeCompletedDays:true})).rejects.toMatchObject({kind:'reorg'});
  });
  it('adds only a verified, fresh, matching live point after the last saved sample',async()=>{
    const f=makeHistoryFixture(),snapshot=await readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0});
    const now=Number(BigInt(f.header(100n).timestamp)),pair=['cwTPA','cwTPB'] as const;
    const reference=currentDexMarketReference({status:'ready',snapshot},pair,BigInt(now));
    const point=buildCurrentDexChartLivePoint(reference,pair,false,now-1000,now);
    expect(point).toEqual({price:2,timestamp:now});
    expect(buildCurrentDexChartLivePoint(reference,pair,true,now-1000,now)?.price).toBe(0.5);
    expect(buildCurrentDexChartLivePoint(reference,['cwTPB','cwTPA'],false,now-1000,now)).toBeNull();
    expect(buildCurrentDexChartLivePoint({...reference},pair,false,now-1000,now)).toBeNull();
    expect(buildCurrentDexChartLivePoint(reference,pair,false,now-1000,now+121)).toBeNull();
    expect(buildCurrentDexChartLivePoint(reference,pair,false,now-1000,now-20)).toBeNull();
    expect(buildCurrentDexChartLivePoint(reference,pair,false,now,now)).toBeNull();
    expect(buildCurrentDexChartLivePoint({status:'stale'},pair,false,now-1000,now)).toBeNull();
    // A last recorded Pool price is a tail point too, marked as recorded and bound to its pair.
    const known={status:'last-known' as const,price:4,sampledAt:String(now-500),revision:'7',pair};
    expect(buildCurrentDexChartLivePoint(known,pair,false,now-1000,now)).toEqual({price:4,timestamp:now-500,recorded:true});
    expect(buildCurrentDexChartLivePoint(known,pair,true,now-1000,now)?.price).toBe(0.25);
    expect(buildCurrentDexChartLivePoint(known,['cwTPB','cwTPA'],false,now-1000,now)).toBeNull();
    expect(buildCurrentDexChartLivePoint({status:'last-known',price:4,sampledAt:String(now-500),revision:'7'},pair,false,now-1000,now)).toBeNull();
    expect(buildCurrentDexChartLivePoint(known,pair,false,now-500,now)).toBeNull();
    expect(buildCurrentDexChartLivePoint({...known,sampledAt:String(now+1)},pair,false,now-1000,now)).toBeNull();
    expect(buildCurrentDexChartLivePoint({...known,price:0},pair,false,now-1000,now)).toBeNull();
  });
  it('labels the live tail separately, preserves daily records and follows only the selected ratio',async()=>{
    const f=makeHistoryFixture(),snapshot=await readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0});
    const now=Number(BigInt(f.header(100n).timestamp)),reference=currentDexMarketReference({status:'ready',snapshot},['cwTPA','cwTPB'],BigInt(now));
    const saved=JSON.stringify(snapshot.slots),clock=vi.spyOn(Date,'now').mockReturnValue(now*1000);
    try{
      const markup=renderToStaticMarkup(<DexMarketChart baseSymbol="cwTPA" quoteSymbol="cwTPB" history={{status:'ready',snapshot}} marketReference={reference}/>);
      expect(markup).toContain('Live 2 cwTPB/cwTPA');expect(markup).toContain('Last sample 2 cwTPB/cwTPA');
      expect(markup).toContain('not a saved daily record');expect(markup).toContain('Gap — no sample');
      const inverse=renderToStaticMarkup(<DexMarketChart baseSymbol="cwTPA" quoteSymbol="cwTPB" history={{status:'ready',snapshot}} marketReference={reference} priceDisplayInverted/>);
      expect(inverse).toContain('Live 0.5 cwTPA/cwTPB');
      const changed=makeHistoryFixture('ready',3n*10n**18n),changedSnapshot=await readCurrentDexDailyPrice({provider:changed.provider,manifest:changed.manifest,finalityLagBlocks:0});
      const changedReference=currentDexMarketReference({status:'ready',snapshot:changedSnapshot},['cwTPA','cwTPB'],BigInt(now));
      const updated=renderToStaticMarkup(<DexMarketChart baseSymbol="cwTPA" quoteSymbol="cwTPB" history={{status:'ready',snapshot}} marketReference={changedReference}/>);
      expect(updated).toContain('Live 3 cwTPB/cwTPA');expect(updated).toContain('Last sample 2 cwTPB/cwTPA');
      const stale=renderToStaticMarkup(<DexMarketChart baseSymbol="cwTPA" quoteSymbol="cwTPB" history={{status:'ready',snapshot}} marketReference={{status:'stale'}}/>);
      expect(stale).not.toContain('Live 2');expect(stale).toContain('Last sample 2');
      // The last recorded Pool price keeps the tail with its own label; it is not called live.
      const recorded=renderToStaticMarkup(<DexMarketChart baseSymbol="cwTPA" quoteSymbol="cwTPB" history={{status:'ready',snapshot}}
        marketReference={{status:'last-known',price:3,sampledAt:String(now-30),revision:'9',pair:['cwTPA','cwTPB']}}/>);
      expect(recorded).toContain('Last recorded 3 cwTPB/cwTPA');expect(recorded).not.toContain('Live 3');expect(recorded).toContain('Last sample 2 cwTPB/cwTPA');
      expect(recorded).toContain('current price is not verified');expect(recorded).not.toContain('updates from the live price');
      const otherPair=renderToStaticMarkup(<DexMarketChart baseSymbol="cwTPA" quoteSymbol="cwTPB" history={{status:'ready',snapshot}}
        marketReference={{status:'last-known',price:3,sampledAt:String(now-30),revision:'9',pair:['cwTPB','cwTPA']}}/>);
      expect(otherPair).not.toContain('Last recorded');
      expect(JSON.stringify(snapshot.slots)).toBe(saved);
    }finally{clock.mockRestore();}
  });
  it('labels both daily samples with their UTC times and leaves block provenance in Price data',()=>{
    const timestamp=Date.parse('2026-11-26T00:00:19Z')/1000;
    const point={day:String(Math.floor(timestamp/86400)),timestamp,price:0.175377,openingPrice:1,openingTimestamp:Date.parse('2026-11-25T00:07:00Z')/1000,sourceBlock:'10080535',recordedAt:String(timestamp+11),recordBlock:'10080538'};
    const markup=renderToStaticMarkup(<SampleTooltip active payload={[{payload:point}]} preview={false} ratioLabel="HBR/BCN"/>);
    expect(markup).toContain('HBR/BCN');expect(markup).toContain('Earlier sample');expect(markup).toContain('Saved sample');
    expect(markup).toContain('00:07:00 UTC');expect(markup).toContain('00:00:19 UTC');
    expect(markup).not.toMatch(/source block|10080535|10080538|Open|Close/);
    const single=renderToStaticMarkup(<SampleTooltip active payload={[{payload:{...point,openingPrice:undefined}}]} preview={false} ratioLabel="HBR/BCN"/>);
    expect(single).toContain('Saved sample');expect(single).not.toContain('Earlier sample');
    expect(renderToStaticMarkup(<SampleTooltip active payload={[{payload:point}]} preview ratioLabel="HBR/BCN"/>)).toContain('Illustrative preview');
    expect(renderToStaticMarkup(<SampleTooltip active={false} payload={[{payload:point}]} preview={false} ratioLabel="HBR/BCN"/>)).toBe('');
  });
  it('uses one live candle/UTC day without bridging gaps or changing saved records',()=>{
    const saved=[{day:'20000',timestamp:20000*86400+60,price:1},{day:'20001',timestamp:20001*86400+60,price:2,openingPrice:1,openingTimestamp:20000*86400+60,body:[1,2] as [number,number]}];
    const before=JSON.stringify(saved);
    expect(buildCurrentDexChartCandles(saved,{timestamp:20001*86400+120,price:1.5})).toEqual([saved[0],{day:'20001',timestamp:20001*86400+120,price:1.5,openingPrice:1,openingTimestamp:saved[0].timestamp,body:[1,1.5],live:true}]);
    expect(buildCurrentDexChartCandles(saved,{timestamp:20002*86400,price:3})[2]).toMatchObject({openingPrice:2,openingTimestamp:saved[1].timestamp,body:[2,3],live:true});
    expect(buildCurrentDexChartCandles(saved,{timestamp:20004*86400,price:3})[2]).not.toHaveProperty('openingPrice');
    expect(buildCurrentDexChartCandles(saved,{timestamp:20002*86400,price:3,recorded:true})[2]).toEqual({day:'20002',timestamp:20002*86400,price:3,openingPrice:2,openingTimestamp:saved[1].timestamp,body:[2,3],recorded:true});
    expect(renderToStaticMarkup(<svg><CandleMark payload={{day:'20002',timestamp:20002*86400,price:3,openingPrice:2,body:[2,3],recorded:true}}/></svg>)).toContain('Last recorded, not saved');
    expect(renderToStaticMarkup(<SampleTooltip active payload={[{payload:{day:'20002',timestamp:20002*86400,price:3,recorded:true}}]} preview={false} ratioLabel="HBR/BCN"/>)).toContain('Last recorded, not saved');
    expect(buildCurrentDexChartCandles(saved,null)).toBe(saved);expect(JSON.stringify(saved)).toBe(before);
  });
  it('draws narrow rising, falling and flat candles without invented wicks or isolated dots',()=>{
    const point={day:'20740',timestamp:1791989427,price:1};
    const flat=renderToStaticMarkup(<CandleMark x={10} y={20} width={14} height={0} payload={{...point,openingPrice:1,body:[1,1]}}/>);
    expect(flat).toContain('<rect');expect(flat).toContain('y="19"');expect(flat).toContain('height="2"');expect(flat).toContain('width="8"');expect(flat).not.toContain('<line');
    const up=renderToStaticMarkup(<CandleMark x={10} y={20} width={14} height={-10} payload={{...point,openingPrice:0.9,body:[0.9,1]}}/>);
    expect(up).toContain('y="10"');expect(up).toContain('#26d6a0');
    const down=renderToStaticMarkup(<CandleMark x={10} y={20} width={14} height={10} payload={{...point,openingPrice:1.1,body:[1.1,1]}}/>);
    expect(down).toContain('y="20"');expect(down).toContain('#ef49c1');
    const single=renderToStaticMarkup(<CandleMark width={14} payload={point}/>);expect(single).toContain('<rect');expect(single).not.toContain('<circle');
    const live=renderToStaticMarkup(<CandleMark width={14} payload={{...point,live:true}}/>);expect(live).toContain('Live, not saved');expect(live).not.toContain('stroke-dasharray');
    expect(live.replace(' · Live, not saved','')).toBe(single);
  });
  it('shows unconfigured history and offers Preview only by explicit choice',()=>{
    const markup=renderToStaticMarkup(<DexMarketChart illustrative/>);expect(markup).toContain('No admitted daily recorder');expect(markup).toContain('Show illustrative preview');expect(markup).not.toContain('Preview points');expect(markup).not.toContain('Saved close');
  });
  it.each(['loading','rpc','reorg','mismatch'] as const)('shows %s without old points or fallback',state=>{
    const history:CurrentDexDailyPriceView=state==='loading'?{status:state}:{status:'error',kind:state,message:'Check failed'};
    const markup=renderToStaticMarkup(<DexMarketChart history={history}/>);expect(markup).not.toContain('<td>');expect(markup).not.toContain('Saved sample');expect(markup).not.toContain('Preview');expect(markup).toContain(state==='loading'?'Loading daily history':state==='rpc'?'History RPC unavailable':state==='reorg'?'History changed during the read':'History source mismatch');
  });
  it('renders exact observed time/source and recording provenance with gaps and reciprocal units',async()=>{
    const f=makeHistoryFixture(),snapshot=await readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0});
    const normal=renderToStaticMarkup(<DexMarketChart baseSymbol="cwTPA" quoteSymbol="cwTPB" history={{status:'ready',snapshot}}/>);
    expect(normal).toContain('DEX daily sampled price history');expect(normal).toContain('Last sample 2 cwTPB/cwTPA');expect(normal).toContain('Gap — no sample');expect(normal).toContain('02:00:00');expect(normal).toContain('02:00:05');expect(normal).toContain('>— / 90</td>');expect(normal).toContain('Earlier sample time UTC');expect(normal).toContain('one saved sample per UTC day');expect(normal).not.toContain('candle preview');expect(normal).not.toContain('Volume');
    const inverse=renderToStaticMarkup(<DexMarketChart baseSymbol="cwTPA" quoteSymbol="cwTPB" priceDisplayInverted history={{status:'ready',snapshot}}/>);expect(inverse).toContain('Last sample 0.5 cwTPA/cwTPB');expect(inverse).toContain('02:00:00');
    const reversed=renderToStaticMarkup(<DexMarketChart baseSymbol="cwTPB" quoteSymbol="cwTPA" history={{status:'ready',snapshot}}/>);
    expect(reversed).toContain('Last sample 0.5 cwTPA/cwTPB');expect(reversed).toContain('02:00:00');
    const reversedInverted=renderToStaticMarkup(<DexMarketChart baseSymbol="cwTPB" quoteSymbol="cwTPA" priceDisplayInverted history={{status:'ready',snapshot}}/>);
    expect(reversedInverted).toContain('Last sample 2 cwTPB/cwTPA');
    expect(snapshot.manifest.symbols).toEqual(['cwTPA','cwTPB']);
    const unverified={...snapshot};expect(renderToStaticMarkup(<DexMarketChart history={{status:'ready',snapshot:unverified}}/>)).toContain('History source mismatch');
    expect(renderToStaticMarkup(<DexMarketChart baseSymbol="WRONG" quoteSymbol="cwTPB" history={{status:'ready',snapshot}}/>)).toContain('History source mismatch');
    expect(Object.isFrozen(snapshot.slots[0])).toBe(true);
  });
  it.each(['suppressed','empty'] as const)('makes %s explicit without altering old samples',async mode=>{
    const f=makeHistoryFixture(mode),snapshot=await readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0});const markup=renderToStaticMarkup(<DexMarketChart baseSymbol="cwTPA" quoteSymbol="cwTPB" history={{status:mode==='empty'?'empty':'ready',snapshot}}/>);expect(markup).toContain(mode==='empty'?'No saved daily samples':'suppressed or source changed');
  });
  it('draws the current day as a candle from the last verified price to the live price',()=>{
    expect(buildCurrentDexChartLiveCandle({price:0.17,timestamp:1000},{timestamp:2000,price:0.21},20)).toEqual({day:'20',timestamp:2000,price:0.21,live:true,
      openingPrice:0.17,openingTimestamp:1000,body:[0.17,0.21]});
    expect(buildCurrentDexChartLiveCandle(undefined,{timestamp:2000,price:0.21},20)).toEqual({day:'20',timestamp:2000,price:0.21,live:true,separateLive:true});
  });
  it('retains separate recurring order levels',()=>{
    const markup=renderToStaticMarkup(<DexMarketChart recurringBuyLabel="Buy cwTPB" recurringBuyPrice={0.95} recurringSellLabel="Sell cwTPB" recurringSellPrice={1.05} showMarketSeries={false}/>);expect(markup).toContain('Buy cwTPB');expect(markup).toContain('Sell cwTPB');expect(markup).not.toContain('Daily samples');
  });
});

describe('Expanded chart keyboard focus (CW-098, WCAG 2.4.3)',()=>{
  const items=['range-7d','range-30d','close','details'] as const;
  it('wraps Tab from the last control to the first and Shift+Tab from the first to the last',()=>{
    expect(wrapExpandedChartFocus(items,'details',false)).toBe('range-7d');
    expect(wrapExpandedChartFocus(items,'range-7d',true)).toBe('details');
  });
  it('leaves Tab to the browser inside the chart and pulls focus back from outside it',()=>{
    expect(wrapExpandedChartFocus(items,'range-30d',false)).toBeNull();
    expect(wrapExpandedChartFocus(items,'close',true)).toBeNull();
    expect(wrapExpandedChartFocus(items,'swap',false)).toBe('range-7d');
    expect(wrapExpandedChartFocus(items,null,true)).toBe('details');
    expect(wrapExpandedChartFocus([],'swap',false)).toBeNull();
  });
  // Owner decision 2026-11-21: dotted candle-wide marks show the last saved price on days without a saved sample.
  it('carries the last saved price only across missing days, up to the next candle or the last visible day',()=>{
    const points=buildCurrentDexChartCarryPoints([{day:'10',price:1},{day:'11',price:1.1},{day:'14',price:1.2},{day:'15',price:1.3}],17);
    expect(points.map(p=>[p.day,p.price,p.carry])).toEqual([['12',1.1,true],['13',1.1,true],['16',1.3,true],['17',1.3,true]]);
    expect(buildCurrentDexChartCarryPoints([{day:'10',price:1},{day:'11',price:1}],11)).toEqual([]);
    expect(buildCurrentDexChartCarryPoints([],5)).toEqual([]);
  });
});
