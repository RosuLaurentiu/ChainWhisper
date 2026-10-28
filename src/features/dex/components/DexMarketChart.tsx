import { Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buildPrivateLiquidityDailyPriceDemoSeries } from '../../../lib/privateLiquidityDailyPrice';
import { isVerifiedCurrentDexDailyPrice, currentDexDailyPricePairOrientation, type CurrentDexDailyPriceView } from '../../../lib/currentDexDailyPrice';

const DAY = 86_400;
const PREVIEW_ENDING_DAY = BigInt(Math.floor(Date.now()/86_400_000)-1);
const RANGES = [{label:'7D',days:7},{label:'30D',days:30},{label:'All',days:32}] as const;
const formatTime = (timestamp: number) => new Intl.DateTimeFormat('en',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'UTC'}).format(new Date(timestamp*1000));
const formatDay = (timestamp: number) => new Intl.DateTimeFormat('en',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(timestamp*1000));
const formatPrice = (price: number) => price.toLocaleString('en',{maximumSignificantDigits:6});
type Sample = Readonly<{day:string;timestamp:number;price:number;recordedAt?:string;sourceBlock?:string;recordBlock?:string;
  openingPrice?:number;openingTimestamp?:number;openingSourceBlock?:string;body?:[number,number]}>;
export function CandleMark({x=0,y=0,width=0,height=0,payload}:{x?:number;y?:number;width?:number;height?:number;payload?:Sample}){
  if(!payload)return null;
  const label=`${formatDay(payload.timestamp)}: ${payload.openingPrice===undefined?'single recorded price':`open ${formatPrice(payload.openingPrice)}, close`} ${formatPrice(payload.price)}`;
  if(!payload.body)return <circle cx={x+width/2} cy={y} r={3.2} fill="#26d6a0" role="img" aria-label={label}/>;
  const rising=payload.price>=payload.body[0];
  const bodyHeight=Math.max(Math.abs(height),3);
  return <rect x={x} y={(height<0?y+height:y)-(bodyHeight-Math.abs(height))/2} width={width} height={bodyHeight} fill={rising?'#26d6a0':'#ef49c1'} role="img" aria-label={label}/>;
}
const stateMessage = (history: CurrentDexDailyPriceView) => {
  if(history.status==='loading') return ['Loading daily history','Checking the recorder and canonical source blocks.'];
  if(history.status==='unconfigured') return ['Market history unavailable','No admitted daily recorder is configured for this pair.'];
  if(history.status==='error') return [history.kind==='reorg'?'History changed during the read':history.kind==='mismatch'?'History source mismatch':'History RPC unavailable',history.message];
  if(history.status==='empty') return ['No saved daily samples','Missing days stay as gaps. No closing price is invented.'];
  return ['Saved daily samples','Display history only. Quote and settlement use their own checks.'];
};
export function SampleTooltip({active,payload,preview,ratioLabel}:{active?:boolean;payload?:readonly {payload:Sample}[];preview:boolean;ratioLabel:string}){
  const point=payload?.[0]?.payload;if(!active||!point)return null;
  return <div className="dex-market-chart-tooltip"><strong>{formatDay(Number(point.day)*DAY)} UTC</strong>
    <small>{ratioLabel}{preview?' · Illustrative preview':''}</small>
    {point.openingPrice===undefined?null:<div>Open <b>{formatPrice(point.openingPrice)}</b></div>}
    <div>{point.openingPrice===undefined?'Price':'Close'} <b>{formatPrice(point.price)}</b></div></div>;
}
export type DexMarketChartProps=Readonly<{
  baseSymbol?:string;quoteSymbol?:string;history?:CurrentDexDailyPriceView;onHistoryRefresh?:()=>void;
  illustrative?:boolean;priceDisplayInverted?:boolean;showMarketSeries?:boolean;
  limitPrice?:number;limitLabel?:string;rangeLower?:number;rangeUpper?:number;
  recurringBuyLabel?:string;recurringBuyPrice?:number;recurringBuySide?:'buy'|'sell';
  recurringSellLabel?:string;recurringSellPrice?:number;recurringSellSide?:'buy'|'sell';
}>;
export default function DexMarketChart({baseSymbol='BCN',quoteSymbol='HBR',history={status:'unconfigured'},onHistoryRefresh,
  illustrative=false,priceDisplayInverted=false,showMarketSeries=true,limitPrice,limitLabel,rangeLower,rangeUpper,
  recurringBuyLabel,recurringBuyPrice,recurringBuySide='buy',recurringSellLabel,recurringSellPrice,recurringSellSide='sell'}:DexMarketChartProps={}){
  const [range,setRange]=useState<(typeof RANGES)[number]['label']>('30D');
  const [expanded,setExpanded]=useState(false);
  const [previewSelected,setPreviewSelected]=useState(false);
  const orientation=(history.status==='ready'||history.status==='empty')
    ?currentDexDailyPricePairOrientation(history.snapshot.manifest.symbols,[baseSymbol,quoteSymbol]):0;
  const accepted=(history.status==='ready'||history.status==='empty')&&isVerifiedCurrentDexDailyPrice(history.snapshot)
    && orientation!==0;
  const snapshot=accepted&&(history.status==='ready'||history.status==='empty')?history.snapshot:null;
  const view:CurrentDexDailyPriceView=(history.status==='ready'||history.status==='empty')&&!accepted
    ?{status:'error',kind:'mismatch',message:'The daily page has not passed its source checks.'}:history;
  const preview=illustrative&&previewSelected&&!snapshot;
  const points=useMemo<readonly Sample[]>(()=>{
    const source:Sample[]=preview?buildPrivateLiquidityDailyPriceDemoSeries({endingDay:PREVIEW_ENDING_DAY}).slice(-32).filter(p=>BigInt(p.day)>=PREVIEW_ENDING_DAY-31n).map(p=>({day:p.day,timestamp:p.timestamp,price:p.price}))
      :snapshot?.slots.flatMap(s=>s.point?[{day:s.day,timestamp:Number(s.point.sampledAt),price:Number(s.point.priceE18)/1e18,recordedAt:s.point.recordedAt,sourceBlock:s.point.sampledBlock,recordBlock:s.point.recordedBlock}]:[])??[];
    const invert=preview?priceDisplayInverted:priceDisplayInverted!==(orientation===-1);
    const displayed=source.map(p=>({...p,price:invert?1/p.price:p.price}));
    return displayed.map((point,index)=>{
      const previous=displayed[index-1];
      if(!previous||BigInt(point.day)!==BigInt(previous.day)+1n)return point;
      return {...point,openingPrice:previous.price,openingTimestamp:previous.timestamp,openingSourceBlock:previous.sourceBlock,body:[previous.price,point.price] as [number,number]};
    });
  },[snapshot,preview,priceDisplayInverted,orientation]);
  const slots=preview?Array.from({length:32},(_,index)=>{
    const day=(PREVIEW_ENDING_DAY-31n+BigInt(index)).toString();
    return {day,present:points.some(point=>point.day===day)};
  }):snapshot?.slots.map(s=>({day:s.day,present:s.point!==null}))??[];
  const endingDay=slots.length?Number(slots[slots.length-1].day):0;
  const days=RANGES.find(r=>r.label===range)!.days;
  const visible=points.filter(p=>Number(p.day)>=endingDay-days+1);
  const visibleSlots=slots.filter(s=>Number(s.day)>=endingDay-days+1);
  const gaps=visibleSlots.filter(s=>!s.present);
  const timeTicks=visibleSlots.filter((_,index)=>index%Math.ceil(visibleSlots.length/6)===0).map(slot=>Number(slot.day)*DAY);
  const latest=visible[visible.length-1];
  const prices=[...visible.flatMap(p=>[p.price,p.openingPrice]),limitPrice,rangeLower,rangeUpper,recurringBuyPrice,recurringSellPrice].filter((n):n is number=>n!==undefined);
  const minimum=prices.length?Math.min(...prices):0.99,maximum=prices.length?Math.max(...prices):1.01;
  const padding=Math.max((maximum-minimum)*0.1,Math.abs(maximum)*0.005,0.000001);
  const ratioLabel=priceDisplayInverted?`${baseSymbol} per ${quoteSymbol}`:`${quoteSymbol} per ${baseSymbol}`;
  const message=stateMessage(view);
  const currentNotice=snapshot?.currentReference==='stale'?'Current reference is stale. Saved samples keep their original times.'
    :snapshot?.currentReference==='suppressed-or-changed'?'Current reference is unavailable: suppressed or source changed.'
      :snapshot?.currentReference==='unobserved'?'No current reference has been sampled.':null;
  return <section className={`dex-market-chart${showMarketSeries?' dex-market-chart-samples':''}${expanded?' is-expanded':''}`}
    aria-label={showMarketSeries?preview?'Illustrative DEX daily price preview':'DEX daily sampled price history':'Recurring order prices'}
    onKeyDown={event=>{if(event.key==='Escape')setExpanded(false);}}>
    <header><div className="dex-market-chart-legend" aria-label="Chart legend">
      {showMarketSeries?<span className="candle-up">{preview?'Preview candles':'Daily prices'}</span>:null}
      {limitPrice===undefined?null:<span className="limit"><i />{limitLabel??`Your limit / ${formatPrice(limitPrice)}`}</span>}
      {rangeLower===undefined||rangeUpper===undefined?null:<span className="range"><i />Active range</span>}
      {recurringBuyPrice===undefined?null:<span className={`recurring-${recurringBuySide}`}><i />{recurringBuyLabel??'Buy order'}</span>}
      {recurringSellPrice===undefined?null:<span className={`recurring-${recurringSellSide}`}><i />{recurringSellLabel??'Sell order'}</span>}
      {latest?<small>{`${preview?'Preview':'Last sample'} ${formatPrice(latest.price)} ${ratioLabel}`}</small>:!showMarketSeries?<small>Two exact prices</small>:null}
    </div><div className="dex-market-chart-actions"><div role="group" aria-label="Chart period">
      {RANGES.map(option=><button key={option.label} type="button" aria-pressed={range===option.label} className={range===option.label?'active':undefined} onClick={()=>setRange(option.label)}>{option.label}</button>)}
    </div>{showMarketSeries&&onHistoryRefresh&&view.status!=='unconfigured'?<button type="button" aria-label="Refresh daily history" title="Refresh daily history" disabled={view.status==='loading'} onClick={onHistoryRefresh}><RefreshCw size={18} aria-hidden="true"/></button>:null}<button type="button" className="dex-market-chart-expand" aria-label={expanded?'Close expanded chart':'Expand chart'} aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>
      {expanded?<Minimize2 size={18} aria-hidden="true"/>:<Maximize2 size={18} aria-hidden="true"/>}</button></div></header>
    <div className="dex-market-chart-plot">
      {showMarketSeries&&visible.length===0?<div className="dex-market-chart-empty"><strong>{message[0]}</strong></div>
      :<ResponsiveContainer width="100%" height="100%"><ComposedChart data={[...visible]} margin={{top:28,right:18,bottom:8,left:0}}>
        <CartesianGrid stroke="rgba(140,145,175,0.14)" strokeDasharray="5 6" vertical={false}/>
        <XAxis type="number" dataKey="timestamp" scale="time" ticks={timeTicks} domain={visibleSlots.length?[(Number(visibleSlots[0].day)-0.5)*DAY,(endingDay+1)*DAY]:['dataMin','dataMax']} hide={!showMarketSeries} tickFormatter={v=>formatDay(Number(v))} tick={{fill:'#918da5',fontSize:11}} tickLine={false} axisLine={false} minTickGap={48} dy={12}/>
        <YAxis domain={[minimum-padding,maximum+padding]} orientation="right" tickFormatter={v=>formatPrice(Number(v))} tick={{fill:'#918da5',fontSize:11}} tickLine={false} axisLine={false} width={64}/>
        {showMarketSeries?<Tooltip content={<SampleTooltip preview={preview} ratioLabel={ratioLabel}/>}/>:null}
        {gaps.map(g=><ReferenceLine key={g.day} x={(Number(g.day)+0.5)*DAY} stroke="rgba(145,141,165,0.25)" strokeDasharray="3 6"/>)}
        {rangeLower===undefined||rangeUpper===undefined?null:<ReferenceArea y1={rangeLower} y2={rangeUpper} fill="#8b5cf6" fillOpacity={0.07} strokeOpacity={0}/>}
        {rangeLower===undefined?null:<ReferenceLine y={rangeLower} stroke="#8b5cf6" strokeWidth={1.6}/>}
        {rangeUpper===undefined?null:<ReferenceLine y={rangeUpper} stroke="#8b5cf6" strokeWidth={1.6}/>}
        {limitPrice===undefined?null:<ReferenceLine y={limitPrice} stroke="#a76bff" strokeWidth={2} label={{value:limitLabel??`Your limit / ${formatPrice(limitPrice)}`,position:'insideTopRight',fill:'#d9c4ff',fontSize:12}}/>}
        {recurringBuyPrice===undefined?null:<ReferenceLine y={recurringBuyPrice} stroke={recurringBuySide==='buy'?'#23d399':'#ef49c1'} strokeWidth={2} label={{value:`${recurringBuyLabel??'Buy order'} / ${formatPrice(recurringBuyPrice)}`,position:'insideTopRight',fill:'#71e7bd',fontSize:11}}/>}
        {recurringSellPrice===undefined?null:<ReferenceLine y={recurringSellPrice} stroke={recurringSellSide==='buy'?'#23d399':'#ef49c1'} strokeWidth={2} label={{value:`${recurringSellLabel??'Sell order'} / ${formatPrice(recurringSellPrice)}`,position:'insideBottomRight',fill:'#f58bdd',fontSize:11}}/>}
        {showMarketSeries?<Bar name={ratioLabel} dataKey={(point:Sample)=>point.body??[point.price,point.price]} barSize={14} shape={<CandleMark/>} activeBar={false} isAnimationActive={false}/>:null}
      </ComposedChart></ResponsiveContainer>}
    </div>
    {showMarketSeries?<div className="dex-market-history-state" role="status">
      {preview?<strong>Illustrative preview · not market data</strong>:null}
      {illustrative&&!snapshot?<button type="button" aria-pressed={preview} onClick={()=>setPreviewSelected(v=>!v)}>{preview?'Hide illustrative preview':'Show illustrative preview'}</button>:null}
      <details><summary>Details</summary>{currentNotice?<p>{currentNotice}</p>:null}<p>{preview?'Preview never supplies Quote or settlement.':message[1]}</p>
        {visible.length?<p>Body: previous recorded close → latest recorded price. No intraday high/low or final day close.</p>:null}
        {snapshot?<p>{visible.length} saved samples · {gaps.length} gaps · at canonical block {snapshot.atBlock.number}. At most 32 days per read.</p>:null}
      </details>
    </div>:null}
    {showMarketSeries&&visibleSlots.length?<details className="dex-market-history-data"><summary>{preview?'Preview data':'Price data'}</summary><table>
      <caption>{ratioLabel} · {preview?'illustrative preview':'actual daily observations; missing days are gaps'}. Open uses the previous-day record; close uses the latest record. No intraday high/low or final day close.</caption>
      <thead><tr><th scope="col">UTC day</th><th scope="col">Open · previous record</th><th scope="col">Opening time UTC</th><th scope="col">Close · latest record</th><th scope="col">Closing time UTC</th>{preview?null:<><th scope="col">Source blocks · open / close</th><th scope="col">Record time UTC / block</th></>}</tr></thead>
      <tbody>{visibleSlots.map(slot=>{const point=visible.find(p=>p.day===slot.day);return <tr key={slot.day}><td>{formatDay(Number(slot.day)*DAY)}</td><td>{point?.openingPrice===undefined?'—':formatPrice(point.openingPrice)}</td><td>{point?.openingTimestamp===undefined?'—':formatTime(point.openingTimestamp)}</td><td>{point?formatPrice(point.price):'Gap — no sample'}</td><td>{point?formatTime(point.timestamp):'—'}</td>{preview?null:<><td>{point?`${point.openingSourceBlock??'—'} / ${point.sourceBlock}`:'—'}</td><td>{point?.recordedAt?`${formatTime(Number(point.recordedAt))} / ${point.recordBlock}`:'—'}</td></>}</tr>;})}</tbody>
    </table></details>:null}
  </section>;
}
