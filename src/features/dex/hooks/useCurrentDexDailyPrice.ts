import { useCallback, useEffect, useRef, useState } from 'react';
import type { Eip1193Provider } from '@coti-io/coti-ethers';
import { readCurrentDexDailyPrice } from '../../../lib/appChain';
import { createPrivateLiquidityHttpProvider } from '../../../lib/privateLiquidityRpc';
import { CURRENT_DEX_DAILY_PRICE_CONFIG, CurrentDexDailyPriceError, currentDexDailyPricePairOrientation,
  type CurrentDexDailyPriceConfig, type CurrentDexDailyPriceView } from '../../../lib/currentDexDailyPrice';

export async function loadCurrentDexDailyPrice({ config, pair, provider, count = 32, assertCurrent = () => {} }: {
  config: CurrentDexDailyPriceConfig; pair: readonly [string,string];
  provider?: Pick<Eip1193Provider, 'request'>; assertCurrent?: () => void | Promise<void>;
  count?: number;
}): Promise<CurrentDexDailyPriceView> {
  if (config.status === 'inactive') return { status: 'unconfigured' };
  if (currentDexDailyPricePairOrientation(config.manifest.symbols, pair) === 0) {
    return { status: 'error', kind: 'mismatch', message: 'No verified daily recorder is bound to this pair.' };
  }
  try {
    const snapshot = await readCurrentDexDailyPrice({
      provider: provider ?? createPrivateLiquidityHttpProvider({ rpcUrl: config.rpcUrl, maxAttempts: 1 }),
      manifest: config.manifest, finalityLagBlocks: config.finalityLagBlocks, count, assertCurrent
    });
    return { status: snapshot.slots.some(s => s.point !== null) ? 'ready' : 'empty', snapshot };
  } catch (error) {
    return { status: 'error', kind: error instanceof CurrentDexDailyPriceError ? error.kind : 'rpc',
      message: error instanceof Error ? error.message : 'Daily history read failed.' };
  }
}
export const currentDexDailyPriceScope = (config: CurrentDexDailyPriceConfig, pair: readonly [string,string]) =>
  JSON.stringify([config,pair]);

export default function useCurrentDexDailyPrice({ pair, config = CURRENT_DEX_DAILY_PRICE_CONFIG, provider, count = 32 }: {
  pair: readonly [string,string]; config?: CurrentDexDailyPriceConfig; provider?: Pick<Eip1193Provider, 'request'>;
  count?: number;
}): Readonly<{ view: CurrentDexDailyPriceView; refresh: () => void }> {
  const [epoch,setEpoch] = useState(0);
  const refresh = useCallback(() => setEpoch(v => v+1),[]);
  const scope = `${currentDexDailyPriceScope(config,pair)}:${count}`;
  const ref = useRef({ config,pair,provider,count }); ref.current = { config,pair,provider,count };
  const [settled,setSettled] = useState<{ key: string; provider: typeof provider; view: CurrentDexDailyPriceView } | null>(null);
  const key = `${scope}:${epoch}`;
  const fallback: CurrentDexDailyPriceView = config.status === 'inactive' ? {status:'unconfigured'} : {status:'loading'};
  useEffect(() => {
    let active = true;
    const captured = ref.current;
    const assertCurrent = () => { if (!active) throw new Error('Daily history request was superseded.'); };
    void loadCurrentDexDailyPrice({...captured,assertCurrent}).then(view => {
      if (active) setSettled({key,provider:captured.provider,view});
    });
    return () => { active = false; };
  },[key,provider]);
  return { view: settled?.key === key && settled.provider === provider ? settled.view : fallback, refresh };
}
