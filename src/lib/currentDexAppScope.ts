import { CURRENT_CHEAP_DEX_CANDIDATE, STAGED_EXIT_PREVIEW_DEX_CANDIDATE, STAGED_SHARED_HISTORY_DEX_CANDIDATE } from './dexV2Deployment';
import { CURRENT_DEX_DISPLAY_PAIR, readCurrentDexDisplay } from './currentDexDisplay';

// This build selection grants no wallet, signing or candidate admission.
// The Testnet build uses the maintained beta candidate. Other builds keep their
// existing candidate; saved actions still recover against their original identity.
export const resolveCurrentDexAppCandidate = (mode: string, selection?: string) => {
  if (selection === undefined || selection === '') {
    if (mode === 'coti-testnet-candidate') {
      return Object.freeze({ key: 'cheap-history' as const, candidate: STAGED_SHARED_HISTORY_DEX_CANDIDATE });
    }
    return Object.freeze({ key: 'cheap-current' as const, candidate: CURRENT_CHEAP_DEX_CANDIDATE });
  }
  if (mode !== 'coti-testnet-candidate' || (selection !== 'cheap-exit' && selection !== 'cheap-history')) {
    throw new Error('Invalid development DEX candidate selection.');
  }
  return selection === 'cheap-history'
    ? Object.freeze({ key: 'cheap-history' as const, candidate: STAGED_SHARED_HISTORY_DEX_CANDIDATE })
    : Object.freeze({ key: 'cheap-exit' as const, candidate: STAGED_EXIT_PREVIEW_DEX_CANDIDATE });
};

export const currentDexAppPair = (
  scope: ReturnType<typeof resolveCurrentDexAppCandidate>, selectedPair: readonly [string, string]
): readonly [string, string] => {
  if (scope.key === 'cheap-current') return CURRENT_DEX_DISPLAY_PAIR;
  const display = readCurrentDexDisplay(scope.candidate);
  if (!display.pairs.some(({ tokens }) =>
    tokens[0].label === selectedPair[0] && tokens[1].label === selectedPair[1] ||
    tokens[1].label === selectedPair[0] && tokens[0].label === selectedPair[1])) {
    throw new Error('Selected pair is outside the development DEX candidate.');
  }
  return selectedPair;
};
