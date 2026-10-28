import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import type { CurrentTokenRefillBinding } from './currentDexTokenRefill';

// Receipt-bound Testnet distributor. DEX candidate admission is a separate send gate.
export const CURRENT_NATIVE_TOKEN_REFILL_BINDING: CurrentTokenRefillBinding = Object.freeze({
  address: '0x0eee63cB6C244f56B519a688DA6ff5078212d320',
  runtimeHash: '0x666581f01768a0ddfdbeb769f18e88dc2453b5661c95c8a2484ed333213a4aa9',
  recovery: '0xC737b5850e15d03ed09bfAdc8A33062f6073a850', expiresAt: 1793717741n
});
export const CURRENT_NATIVE_TOKEN_REFILL_DEPLOYMENT = Object.freeze({
  graph: 'fa71b96c6c590a40feed6b234d8bf5a2fe548af0edb0a2a49dbd639f4c15938b',
  transactionHash: '0xfe8810d1ae65acbd629adf0dd23e3318401fd308b7c46abf9ff0418a9365af46',
  blockNumber: 9908029n, blockHash: '0xb560e468db47ebf4d5ca40695d15731d7bc59645d0ab1ee08b7433a45dc906b3'
});
export const assertCurrentNativeTokenRefillBinding = (candidate: CurrentCheapDexCandidateKey, binding: CurrentTokenRefillBinding) => {
  const c = resolveCurrentCheapDexCandidate(candidate), known = CURRENT_NATIVE_TOKEN_REFILL_BINDING;
  if (c.graph !== CURRENT_NATIVE_TOKEN_REFILL_DEPLOYMENT.graph ||
    binding.address.toLowerCase() !== known.address.toLowerCase() || binding.runtimeHash.toLowerCase() !== known.runtimeHash ||
    binding.recovery.toLowerCase() !== known.recovery.toLowerCase() || binding.expiresAt !== known.expiresAt) {
    throw new Error('Refill deployment or candidate has no current native admission.');
  }
};
