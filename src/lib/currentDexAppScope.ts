import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from './dexV2Deployment';
import { readCurrentDexDisplay } from './currentDexDisplay';

// Build selection grants no wallet, signing or candidate admission.
export const resolveCurrentDexAppCandidate = (mode: string, selection?: string) => {
  if (selection && (mode !== 'coti-testnet-candidate' || selection !== 'cheap-history')) {
    throw new Error('Invalid development DEX candidate selection.');
  }
  return Object.freeze({ key: 'cheap-history' as const, candidate: STAGED_SHARED_HISTORY_DEX_CANDIDATE });
};

export const currentDexAppPair = (
  scope: ReturnType<typeof resolveCurrentDexAppCandidate>, selectedPair: readonly [string, string]
): readonly [string, string] => {
  const display = readCurrentDexDisplay(scope.candidate);
  if (!display.pairs.some(({ tokens }) =>
    tokens[0].label === selectedPair[0] && tokens[1].label === selectedPair[1] ||
    tokens[1].label === selectedPair[0] && tokens[0].label === selectedPair[1])) {
    throw new Error('Selected pair is outside the development DEX candidate.');
  }
  return selectedPair;
};
