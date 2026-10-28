import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it } from 'vitest';
import { readCurrentDexDailyPrice,type CurrentDexDailyPriceView } from '../../../lib/currentDexDailyPrice';
import { makeHistoryFixture } from '../../../../tests/fixtures/history.fixture';
import DexMarketChart,{CandleMark,SampleTooltip} from './DexMarketChart';
describe('DexMarketChart actual daily sample display',()=>{
  it('keeps the tooltip compact and leaves provenance in Price data',()=>{
    const point={day:'20740',timestamp:1791989427,price:1,openingPrice:1.1,sourceBlock:'10080535',recordedAt:'1791989433',recordBlock:'10080538'};
    const markup=renderToStaticMarkup(<SampleTooltip active payload={[{payload:point}]} preview={false} ratioLabel="HBR per BCN"/>);
    expect(markup).toContain('UTC');expect(markup).toContain('HBR per BCN');expect(markup).toContain('Open');expect(markup).toContain('Close');
    expect(markup).not.toMatch(/source block|10080535|10080538|Recorded|intraday|Latest record|Previous record/);
    const single=renderToStaticMarkup(<SampleTooltip active payload={[{payload:{...point,openingPrice:undefined}}]} preview={false} ratioLabel="HBR per BCN"/>);
    expect(single).toContain('Price');expect(single).not.toMatch(/Open|Close/);
    expect(renderToStaticMarkup(<SampleTooltip active payload={[{payload:point}]} preview ratioLabel="HBR per BCN"/>)).toContain('Illustrative preview');
    expect(renderToStaticMarkup(<SampleTooltip active={false} payload={[{payload:point}]} preview={false} ratioLabel="HBR per BCN"/>)).toBe('');
  });
  it('draws rising, falling and flat bodies without wicks, and keeps isolated samples as points',()=>{
    const point={day:'20740',timestamp:1791989427,price:1};
    const flat=renderToStaticMarkup(<CandleMark x={10} y={20} width={14} height={0} payload={{...point,openingPrice:1,body:[1,1]}}/>);
    expect(flat).toContain('<rect');expect(flat).toContain('y="18.5"');expect(flat).toContain('height="3"');expect(flat).not.toContain('<line');
    const up=renderToStaticMarkup(<CandleMark x={10} y={20} width={14} height={-10} payload={{...point,openingPrice:0.9,body:[0.9,1]}}/>);
    expect(up).toContain('y="10"');expect(up).toContain('#26d6a0');
    const down=renderToStaticMarkup(<CandleMark x={10} y={20} width={14} height={10} payload={{...point,openingPrice:1.1,body:[1.1,1]}}/>);
    expect(down).toContain('y="20"');expect(down).toContain('#ef49c1');
    expect(renderToStaticMarkup(<CandleMark payload={point}/>)).toContain('<circle');
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
    expect(normal).toContain('DEX daily sampled price history');expect(normal).toContain('Last sample 2 cwTPB per cwTPA');expect(normal).toContain('Gap — no sample');expect(normal).toContain('02:00:00');expect(normal).toContain('02:00:05');expect(normal).toContain('>— / 90</td>');expect(normal).toContain('Open uses the previous-day record');expect(normal).toContain('No intraday high/low or final day close');expect(normal).not.toContain('candle preview');expect(normal).not.toContain('Volume');
    const inverse=renderToStaticMarkup(<DexMarketChart baseSymbol="cwTPA" quoteSymbol="cwTPB" priceDisplayInverted history={{status:'ready',snapshot}}/>);expect(inverse).toContain('Last sample 0.5 cwTPA per cwTPB');expect(inverse).toContain('02:00:00');
    const reversed=renderToStaticMarkup(<DexMarketChart baseSymbol="cwTPB" quoteSymbol="cwTPA" history={{status:'ready',snapshot}}/>);
    expect(reversed).toContain('Last sample 0.5 cwTPA per cwTPB');expect(reversed).toContain('02:00:00');
    const reversedInverted=renderToStaticMarkup(<DexMarketChart baseSymbol="cwTPB" quoteSymbol="cwTPA" priceDisplayInverted history={{status:'ready',snapshot}}/>);
    expect(reversedInverted).toContain('Last sample 2 cwTPB per cwTPA');
    expect(snapshot.manifest.symbols).toEqual(['cwTPA','cwTPB']);
    const unverified={...snapshot};expect(renderToStaticMarkup(<DexMarketChart history={{status:'ready',snapshot:unverified}}/>)).toContain('History source mismatch');
    expect(renderToStaticMarkup(<DexMarketChart baseSymbol="WRONG" quoteSymbol="cwTPB" history={{status:'ready',snapshot}}/>)).toContain('History source mismatch');
    expect(Object.isFrozen(snapshot.slots[0])).toBe(true);
  });
  it.each(['stale','suppressed','empty'] as const)('makes %s explicit without altering old samples',async mode=>{
    const f=makeHistoryFixture(mode),snapshot=await readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0});const markup=renderToStaticMarkup(<DexMarketChart baseSymbol="cwTPA" quoteSymbol="cwTPB" history={{status:mode==='empty'?'empty':'ready',snapshot}}/>);expect(markup).toContain(mode==='empty'?'No saved daily samples':mode==='stale'?'Current reference is stale':'suppressed or source changed');
  });
  it('retains separate recurring order levels',()=>{
    const markup=renderToStaticMarkup(<DexMarketChart recurringBuyLabel="Buy cwTPB" recurringBuyPrice={0.95} recurringSellLabel="Sell cwTPB" recurringSellPrice={1.05} showMarketSeries={false}/>);expect(markup).toContain('Buy cwTPB');expect(markup).toContain('Sell cwTPB');expect(markup).not.toContain('Daily samples');
  });
});
