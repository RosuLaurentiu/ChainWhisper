import { Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buildPrivateLiquidityDailyPriceDemoSeries } from '../../../lib/privateLiquidityDailyPrice';
import { isVerifiedCurrentDexDailyPrice, currentDexDailyPricePairOrientation, type CurrentDexDailyPriceView } from '../../../lib/currentDexDailyPrice';
import { isVerifiedCurrentDexMarketReference, type CurrentDexMarketReference } from '../../../lib/currentDexMarketReference';

const DAY = 86_400;
const PREVIEW_ENDING_DAY = BigInt(Math.floor(Date.now()/86_400_000)-1);
const RANGES = [{label:'7D',days:7},{label:'30D',days:30},{label:'All',days:32}] as const;
const formatTime = (timestamp: number) => new Intl.DateTimeFormat('en',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'UTC'}).format(new Date(timestamp*1000));
const formatDay = (timestamp: number) => new Intl.DateTimeFormat('en',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(timestamp*1000));
const formatPrice = (price: number) => price.toLocaleString('en',{maximumSignificantDigits:6});

export function buildCurrentDexChartLivePoint(reference:CurrentDexMarketReference|undefined,pair:readonly[string,string],inverted:boolean,lastTimestamp:number|undefined,now=Math.floor(Date.now()/1000)):{timestamp:number;price:number;recorded?:true}|null{
  // The last recorded Pool price keeps the tail when the current price is not verified. It is marked as recorded, not live.
  if(reference?.status==='last-known'){
    const timestamp=Number(reference.sampledAt);
    if(lastTimestamp===undefined||reference.pair?.[0]!==pair[0]||reference.pair?.[1]!==pair[1]||!Number.isFinite(reference.price)||reference.price<=0||
      !Number.isSafeInteger(timestamp)||timestamp<=lastTimestamp||timestamp>now)return null;
    return {timestamp,price:inverted?1/reference.price:reference.price,recorded:true};
  }
  if(!reference||reference.status!=='available'||!isVerifiedCurrentDexMarketReference(reference)||lastTimestamp===undefined||
    reference.pair[0]!==pair[0]||reference.pair[1]!==pair[1])return null;
  const timestamp=Number(reference.checkedAt??reference.sampledAt);
  if(timestamp<=lastTimestamp||timestamp>now||now-timestamp>120)return null;
  return {timestamp,price:inverted?1/reference.price:reference.price};
}
type Sample = Readonly<{day:string;timestamp:number;price:number;recordedAt?:string;sourceBlock?:string;recordBlock?:string;
  openingPrice?:number;openingTimestamp?:number;openingSourceBlock?:string;body?:[number,number];live?:boolean;recorded?:boolean;carry?:boolean;
  completed?:boolean; separateLive?:boolean}>;
const tailNote=(point:Pick<Sample,'live'|'recorded'>)=>point.live?' · Live, not saved':point.recorded?' · Last recorded, not saved':'';
export function buildCurrentDexChartCandles(saved:readonly Sample[],live:{timestamp:number;price:number;recorded?:boolean}|null):readonly Sample[]{
  const latest=saved[saved.length-1];
  if(!live||!latest)return saved;
  const day=String(Math.floor(live.timestamp/DAY)),sameDay=day===latest.day;
  const openingPrice=sameDay?latest.openingPrice??latest.price:BigInt(day)===BigInt(latest.day)+1n?latest.price:undefined;
  const openingTimestamp=sameDay&&latest.openingPrice!==undefined?latest.openingTimestamp:latest.timestamp;
  const current:Sample={day,timestamp:live.timestamp,price:live.price,...(live.recorded?{recorded:true}:{live:true}),...(openingPrice===undefined?{}:{openingPrice,openingTimestamp,body:[openingPrice,live.price]})};
  return [...saved.filter(point=>point.day!==day),current];
}
/** Owner request 2026-11-26: the current UTC day is a normal candle. It opens at the last verified price and closes at
 * the live price. It stays marked "Live, not saved". With no earlier candle it is a single mark. */
export function buildCurrentDexChartLiveCandle(latest:Pick<Sample,'price'|'timestamp'>|undefined,live:{timestamp:number;price:number},endingDay:number):Sample{
  const base={day:String(endingDay),timestamp:live.timestamp,price:live.price,live:true};
  return latest?{...base,openingPrice:latest.price,openingTimestamp:latest.timestamp,body:[latest.price,live.price]}:{...base,separateLive:true};
}
/** Owner decision 2026-11-21: each day with no saved sample after a candle shows a dotted mark, candle-wide, at the last
 * saved price, up to the next candle (or the last visible day). It marks "no saved sample", not a record or a verified
 * unchanged price. */
export function buildCurrentDexChartCarryPoints(candles:readonly Pick<Sample,'day'|'price'>[],endingDay:number):readonly Sample[]{
  const points:Sample[]=[];
  candles.forEach((point,index)=>{
    const day=Number(point.day),next=candles[index+1],toDay=next?Number(next.day):endingDay+1;
    for(let missing=day+1;missing<toDay;missing++)points.push({day:String(missing),timestamp:missing*DAY,price:point.price,carry:true});
  });
  return points;
}
export function CandleMark({x=0,y=0,width=0,height=0,payload}:{x?:number;y?:number;width?:number;height?:number;payload?:Sample}){
  if(!payload)return null;
  if(payload.carry){
    const markWidth=Math.min(width,8),mid=height<0?y+height/2:y+height/2;
    return <g role="img" aria-label={`${formatDay(payload.timestamp)}: no saved sample, last saved price ${formatPrice(payload.price)}`}>
      <line x1={x+(width-markWidth)/2} x2={x+(width+markWidth)/2} y1={mid} y2={mid} stroke="rgba(190,195,215,0.85)" strokeWidth={2} strokeDasharray="1.5 1.5"/>
    </g>;
  }
  const label=`${formatDay(payload.timestamp)}${tailNote(payload)}: ${payload.openingPrice===undefined?'sample':`earlier sample ${formatPrice(payload.openingPrice)}, displayed sample`} ${formatPrice(payload.price)}`;
  if(payload.separateLive)return <g role="img" aria-label={label}><circle cx={x+width/2} cy={y+height/2} r={4} fill="#a76bff"/></g>;
  const color=payload.price>=(payload.openingPrice??payload.price)?'#26d6a0':'#ef49c1';
  const bodyHeight=payload.body?Math.max(Math.abs(height),2):2,bodyWidth=Math.min(width,8);
  const top=(height<0?y+height:y)-(bodyHeight-Math.abs(height))/2;
  return <g role="img" aria-label={label}>
    <rect x={x+(width-bodyWidth)/2} y={top} width={bodyWidth} height={bodyHeight} fill={color} stroke={color} opacity={payload.recorded?0.55:undefined}/>
  </g>;
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
    <small>{ratioLabel}{preview?' · Illustrative preview':''}{point.carry?' · No saved sample':tailNote(point)}</small>
    {point.openingPrice===undefined?null:<>
      <div>{point.live?'Opened at last verified price':'Earlier sample'} <b>{formatPrice(point.openingPrice)}</b></div>
      {point.openingTimestamp===undefined?null:<small>{formatTime(point.openingTimestamp)} UTC</small>}
    </>}
    <div>{point.carry?'Last verified price':point.live?'Live price':point.recorded?'Last observed price':point.completed?'Last verified price':preview?'Preview sample':'Saved sample'} <b>{formatPrice(point.price)}</b></div>
    {point.carry?null:<small>{formatTime(point.timestamp)} UTC</small>}</div>;
}
/** CW-098: while the chart covers the page, Tab must not reach the hidden controls behind it. Returns the control to focus, or null to let the browser move focus. */
export function wrapExpandedChartFocus<T>(items:readonly T[],active:T|null,backward:boolean):T|null{
  if(!items.length)return null;
  const first=items[0],last=items[items.length-1];
  if(active===null||!items.includes(active))return backward?last:first;
  if(backward)return active===first?last:null;
  return active===last?first:null;
}
const FOCUSABLE='button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])';
export type DexMarketChartProps=Readonly<{
  baseSymbol?:string;quoteSymbol?:string;history?:CurrentDexDailyPriceView;onHistoryRefresh?:()=>void;marketReference?:CurrentDexMarketReference;
  illustrative?:boolean;priceDisplayInverted?:boolean;showMarketSeries?:boolean;
  limitPrice?:number;limitLabel?:string;rangeLower?:number;rangeUpper?:number;
  recurringBuyLabel?:string;recurringBuyPrice?:number;recurringBuySide?:'buy'|'sell';
  recurringSellLabel?:string;recurringSellPrice?:number;recurringSellSide?:'buy'|'sell';
}>;
export default function DexMarketChart({baseSymbol='BCN',quoteSymbol='HBR',history={status:'unconfigured'},onHistoryRefresh,marketReference,
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
  const completedMode=snapshot?.completedDays!==undefined;
  const points=useMemo<readonly Sample[]>(()=>{
    const source:Sample[]=preview?buildPrivateLiquidityDailyPriceDemoSeries({endingDay:PREVIEW_ENDING_DAY}).slice(-32).filter(p=>BigInt(p.day)>=PREVIEW_ENDING_DAY-31n).map(p=>({day:p.day,timestamp:p.timestamp,price:p.price}))
      :snapshot?.completedDays?snapshot.completedDays.map(p=>({day:p.day,timestamp:Number(p.sampledAt),price:Number(p.priceE18)/1e18,sourceBlock:p.sampledBlock,completed:true}))
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
  }):snapshot?.slots.map(s=>({day:s.day,present:completedMode?points.some(point=>point.day===s.day):s.point!==null}))??[];
  const endingDay=slots.length?Number(slots[slots.length-1].day):0;
  const days=RANGES.find(r=>r.label===range)!.days;
  const visible=points.filter(p=>Number(p.day)>=endingDay-days+1);
  const visibleSlots=slots.filter(s=>Number(s.day)>=endingDay-days+1);
  const historySlots=completedMode?visibleSlots.filter(s=>Number(s.day)<endingDay):visibleSlots;
  const gaps=historySlots.filter(s=>!s.present);
  const timeTicks=visibleSlots.filter((_,index)=>index%Math.ceil(visibleSlots.length/6)===0).map(slot=>Number(slot.day)*DAY);
  const latest=visible[visible.length-1];
  const candidateLive=showMarketSeries&&!preview&&snapshot?buildCurrentDexChartLivePoint(marketReference,[baseSymbol,quoteSymbol],priceDisplayInverted,latest?.timestamp??(completedMode?0:undefined)):null;
  const live=completedMode&&candidateLive&&(candidateLive.recorded||Math.floor(candidateLive.timestamp/DAY)!==endingDay)?null:candidateLive;
  const candles=completedMode?visible:buildCurrentDexChartCandles(visible,live);
  const carryPoints=showMarketSeries?buildCurrentDexChartCarryPoints(candles,completedMode?endingDay-1:endingDay):[];
  const livePoint=completedMode&&live?buildCurrentDexChartLiveCandle(latest,live,endingDay):null;
  const chartData=[...candles,...carryPoints,...(livePoint?[livePoint]:[])].sort((a,b)=>Number(a.day)-Number(b.day));
  const prices=[...visible.flatMap(p=>[p.price,p.openingPrice]),live?.price,limitPrice,rangeLower,rangeUpper,recurringBuyPrice,recurringSellPrice].filter((n):n is number=>n!==undefined&&n!==null);
  const minimum=prices.length?Math.min(...prices):0.99,maximum=prices.length?Math.max(...prices):1.01;
  const padding=Math.max((maximum-minimum)*0.1,Math.abs(maximum)*0.005,0.000001);
  const ratioLabel=priceDisplayInverted?`${baseSymbol}/${quoteSymbol}`:`${quoteSymbol}/${baseSymbol}`;
  const message=stateMessage(view);
  const currentNotice=live&&!live.recorded?null:snapshot?.currentReference==='stale'?'Current reference is stale. Saved samples keep their original times.'
    :snapshot?.currentReference==='suppressed-or-changed'?'Current reference is unavailable: suppressed or source changed.'
      :snapshot?.currentReference==='unobserved'?'No current reference has been sampled.':null;
  return <section className={`dex-market-chart${showMarketSeries?' dex-market-chart-samples':''}${expanded?' is-expanded':''}`}
    aria-label={showMarketSeries?preview?'Illustrative DEX daily price preview':'DEX daily sampled price history':'Recurring order prices'}
    onKeyDown={event=>{
      if(event.key==='Escape'){setExpanded(false);return;}
      if(!expanded||event.key!=='Tab')return;
      const items=[...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(item=>item.getClientRects().length>0);
      const next=wrapExpandedChartFocus(items,document.activeElement instanceof HTMLElement?document.activeElement:null,event.shiftKey);
      if(next){event.preventDefault();next.focus();}
    }}>
    <header><div className="dex-market-chart-legend" aria-label="Chart legend">
      {showMarketSeries?<span className="candle-up">{preview?'Preview candles':completedMode?'Completed days':'Daily prices'}</span>:null}
      {limitPrice===undefined?null:<span className="limit"><i />{limitLabel??`Your limit / ${formatPrice(limitPrice)}`}</span>}
      {rangeLower===undefined||rangeUpper===undefined?null:<span className="range"><i />Active range</span>}
      {recurringBuyPrice===undefined?null:<span className={`recurring-${recurringBuySide}`}><i />{recurringBuyLabel??'Buy order'}</span>}
      {recurringSellPrice===undefined?null:<span className={`recurring-${recurringSellSide}`}><i />{recurringSellLabel??'Sell order'}</span>}
      {latest?<small>{`${preview?'Preview':'Last sample'} ${formatPrice(latest.price)} ${ratioLabel}`}</small>:!showMarketSeries?<small>Two exact prices</small>:null}
      {live?<small title={live.recorded?`${formatTime(live.timestamp)} UTC · last recorded Pool price · the current price is not verified · not a saved daily record`
        :`${formatTime(live.timestamp)} UTC · not a saved daily record`}>{`${live.recorded?'Last recorded':'Live'} ${formatPrice(live.price)} ${ratioLabel}`}</small>:null}
    </div><div className="dex-market-chart-actions"><div role="group" aria-label="Chart period">
      {RANGES.map(option=><button key={option.label} type="button" aria-pressed={range===option.label} className={range===option.label?'active':undefined} onClick={()=>setRange(option.label)}>{option.label}</button>)}
    </div>{showMarketSeries&&onHistoryRefresh&&view.status!=='unconfigured'?<button type="button" aria-label="Refresh daily history" title="Refresh daily history" disabled={view.status==='loading'} onClick={onHistoryRefresh}><RefreshCw size={18} aria-hidden="true"/></button>:null}<button type="button" className="dex-market-chart-expand" aria-label={expanded?'Close expanded chart':'Expand chart'} aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>
      {expanded?<Minimize2 size={18} aria-hidden="true"/>:<Maximize2 size={18} aria-hidden="true"/>}</button></div></header>
    <div className="dex-market-chart-plot">
      {showMarketSeries&&chartData.length===0?<div className="dex-market-chart-empty"><strong>{message[0]}</strong></div>
      :<ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} margin={{top:28,right:18,bottom:8,left:0}}>
        <CartesianGrid stroke="rgba(140,145,175,0.14)" strokeDasharray="5 6" vertical={false}/>
        <XAxis type="number" dataKey={(point:Sample)=>(Number(point.day)+0.5)*DAY} scale="time" ticks={timeTicks} domain={visibleSlots.length?[(Number(visibleSlots[0].day)-0.5)*DAY,Math.max((endingDay+1)*DAY,live?(Math.floor(live.timestamp/DAY)+1)*DAY:0)]:['dataMin','dataMax']} hide={!showMarketSeries} tickFormatter={v=>formatDay(Number(v))} tick={{fill:'#918da5',fontSize:11}} tickLine={false} axisLine={false} minTickGap={48} dy={12}/>
        <YAxis domain={[Math.max(0,minimum-padding),maximum+padding]} orientation="right" tickFormatter={v=>formatPrice(Number(v))} tick={{fill:'#918da5',fontSize:11}} tickLine={false} axisLine={false} width={64}/>
        {showMarketSeries?<Tooltip content={<SampleTooltip preview={preview} ratioLabel={ratioLabel}/>}/>:null}
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
        {visible.length?<p>{completedMode?'Each completed UTC day uses its last verified price. Hover to see the actual observation times.':'Each bar connects two samples. Hover to see their UTC times.'}</p>:null}
        {live?<p>{live.recorded?'The current UTC day shows the last recorded Pool price; the current price is not verified. It is not a saved daily record.'
          :'The current UTC day updates from the live price; it is not a saved daily record.'} A single observation is a flat mark.</p>:null}
        {carryPoints.length?<p>Dotted marks carry the previous price across missing days. They do not prove the price was unchanged.</p>:null}
        {snapshot?<p>{visible.length} {completedMode?'verified':'saved'} days · {gaps.length} days without data · block {snapshot.atBlock.number}. The chart shows at most 32 days.</p>:null}
      </details>
    </div>:null}
    {showMarketSeries&&historySlots.length?<details className="dex-market-history-data"><summary>{preview?'Preview data':'Price data'}</summary><table>
      <caption>{ratioLabel} · {preview?'illustrative preview':completedMode?'last verified observation per completed UTC day':'one saved sample per UTC day; missing days are gaps'}.</caption>
      <thead><tr><th scope="col">UTC day</th><th scope="col">Earlier sample</th><th scope="col">Earlier sample time UTC</th><th scope="col">{preview?'Displayed sample':completedMode?'Last verified price':'Saved sample'}</th><th scope="col">Sample time UTC</th>{preview?null:<th scope="col">Source blocks</th>}{preview||completedMode?null:<th scope="col">Record time UTC / block</th>}</tr></thead>
      <tbody>{historySlots.map(slot=>{const point=visible.find(p=>p.day===slot.day);return <tr key={slot.day}><td>{formatDay(Number(slot.day)*DAY)}</td><td>{point?.openingPrice===undefined?'—':formatPrice(point.openingPrice)}</td><td>{point?.openingTimestamp===undefined?'—':formatTime(point.openingTimestamp)}</td><td>{point?formatPrice(point.price):'Gap — no sample'}</td><td>{point?formatTime(point.timestamp):'—'}</td>{preview?null:<td>{point?`${point.openingSourceBlock??'—'} / ${point.sourceBlock}`:'—'}</td>}{preview||completedMode?null:<td>{point?.recordedAt?`${formatTime(Number(point.recordedAt))} / ${point.recordBlock}`:'—'}</td>}</tr>;})}</tbody>
    </table></details>:null}
  </section>;
}
