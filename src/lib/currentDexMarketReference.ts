import { formatUnits } from '@coti-io/coti-ethers';
import { currentDexDailyPricePairOrientation, isVerifiedCurrentDexDailyPrice, isVerifiedCurrentDexPublicReference,
  type CurrentDexDailyPriceView, type CurrentDexPublicReferenceView } from './currentDexDailyPrice';

export type CurrentDexMarketReference = Readonly<{ status: 'available'; price: number; sampledAt: string; revision: string }> |
  Readonly<{ status: 'loading' | 'stale' | 'unavailable' }>;
type VerifiedCurrentDexMarketReference = Extract<CurrentDexMarketReference, { status: 'available' }> &
  Readonly<{ pair: readonly [string,string]; rateNumerator: bigint; rateDenominator: bigint }>;
const issuedReferences = new WeakSet<object>();
export const isVerifiedCurrentDexMarketReference = (value: CurrentDexMarketReference): value is VerifiedCurrentDexMarketReference => issuedReferences.has(value);

// Display only: the initial marginal rate does not include fees, depth or a guaranteed fill.
export function currentDexEstimatedReceive({reference,pair,inputIndex,input,inputDecimals,outputDecimals,now}:{
  reference?:CurrentDexMarketReference;pair:readonly[string,string];inputIndex:0|1;input:bigint;
  inputDecimals:number;outputDecimals:number;now:bigint;
}):string|null{
  if(!reference||reference.status!=='available'||!isVerifiedCurrentDexMarketReference(reference)||
    reference.pair[0]!==pair[0]||reference.pair[1]!==pair[1]||input<=0n||input>=1n<<256n)return null;
  const at=BigInt(reference.sampledAt);
  if(now<at||now-at>120n)return null;
  const numerator=inputIndex===0?reference.rateNumerator:reference.rateDenominator;
  const denominator=inputIndex===0?reference.rateDenominator:reference.rateNumerator;
  const output=input*numerator*10n**BigInt(outputDecimals)/(denominator*10n**BigInt(inputDecimals));
  if(output>=1n<<256n)return null;
  return output===0n?`<${formatUnits(1n,outputDecimals)}`:formatUnits(output,outputDecimals);
}

// Public display signal only. Quote rate and exact settlement protections remain independent.
export const currentDexMarketReference = (view: CurrentDexDailyPriceView|CurrentDexPublicReferenceView, pair: readonly [string,string], now: bigint): CurrentDexMarketReference => {
  if (view.status === 'loading') return { status: 'loading' };
  if (view.status !== 'ready' && view.status !== 'empty' && view.status !== 'reference') return { status: 'unavailable' };
  const s = view.snapshot, o = s.currentObservation;
  if (view.status==='reference'?!isVerifiedCurrentDexPublicReference(s):!isVerifiedCurrentDexDailyPrice(s)) return { status: 'unavailable' };
  const symbols=view.status==='reference'?view.snapshot.symbols:view.snapshot.manifest.symbols;
  const direction = currentDexDailyPricePairOrientation(symbols,pair);
  if (!direction) return { status: 'unavailable' };
  if (s.currentReference === 'stale') return { status: 'stale' };
  if (s.currentReference !== 'available' || !o) return { status: 'unavailable' };
  const at = BigInt(o.sampledAt);
  if (now < at || now-at > 120n) return { status: 'stale' };
  const canonical = Number(o.priceE18)/1e18;
  const price = direction === 1 ? canonical : 1/canonical;
  if (!Number.isFinite(price) || price <= 0) return { status: 'unavailable' };
  const raw = BigInt(o.priceE18), scale = 10n ** 18n;
  const reference: VerifiedCurrentDexMarketReference = Object.freeze({ status: 'available', price, sampledAt: o.sampledAt, revision: o.revision,
    pair: Object.freeze([pair[0], pair[1]]) as readonly [string,string],
    rateNumerator: direction === 1 ? raw : scale, rateDenominator: direction === 1 ? scale : raw });
  issuedReferences.add(reference);
  return reference;
};
