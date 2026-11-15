import {currentCheapDexQuoteProtocol,resolveCurrentCheapDexCandidate,type CurrentCheapDexCandidateKey} from './dexV2Deployment';
// Each selected browser helper signs one input. Restored calldata needs no new input signatures.
export const currentDexQuoteInputPlan = (candidate:CurrentCheapDexCandidateKey,restored=false):readonly string[] => Object.freeze(restored?[]:
 ['maximumInput','minimumInput','minimumOutput',...(currentCheapDexQuoteProtocol(resolveCurrentCheapDexCandidate(candidate))?['minimumRate']:['rateNumerator','rateDenominator'])]);
