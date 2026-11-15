import type { CurrentCheapDexCandidate } from './dexV2Deployment';
import type { CurrentDexDailyPriceConfig } from './currentDexDailyPrice';
import { currentHistoryDexDailyPriceConfig } from './currentDexHistoryDailyPriceTestnet';

const inactive:CurrentDexDailyPriceConfig=Object.freeze({status:'inactive'});
// Normal App reads bind only to the selected replacement candidate.
export const currentNativeDexDailyPriceConfig=(candidate:CurrentCheapDexCandidate,selectedPair?:readonly[string,string]):CurrentDexDailyPriceConfig=>
  selectedPair?currentHistoryDexDailyPriceConfig(candidate,selectedPair):inactive;
