import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { CURRENT_NATIVE_TOKEN_REFILL_BINDING as binding, CURRENT_NATIVE_TOKEN_REFILL_DEPLOYMENT as deployment,
  assertCurrentNativeTokenRefillBinding } from './currentDexNativeTokenRefillDeployment';
import { resolveCurrentCheapDexCandidate } from './dexV2Deployment';

it('binds the actual accepted native vault without releasing the DEX candidate', () => {
  const proof = JSON.parse(readFileSync('reports/next-dex-app-2026-10-04/current-refill-native-binding-3.json', 'utf8'));
  expect(proof.status).toBe('DEVELOPMENT_PRIVATE_REFILL_NATIVE_ACCEPTED');
  expect(binding).toEqual({ address: proof.vault, runtimeHash: proof.runtimeHash, recovery: proof.recovery, expiresAt: BigInt(proof.expiresAt) });
  expect(deployment.graph).toBe(proof.candidate.graph);
  expect(deployment.transactionHash).toBe(proof.transactions[0].hash);
  expect(deployment.blockNumber).toBe(BigInt(proof.transactions[0].blockNumber));
  expect(deployment.blockHash).toBe(proof.transactions[0].blockHash);
  expect(() => assertCurrentNativeTokenRefillBinding('cheap-native', binding)).not.toThrow();
  expect(resolveCurrentCheapDexCandidate('cheap-native').readyToSign).toBe(false);
});
it.each(['address', 'runtimeHash', 'recovery', 'expiresAt'] as const)('rejects changed native refill %s', key => {
  const changed = { ...binding, [key]: key === 'expiresAt' ? binding.expiresAt + 1n : key === 'runtimeHash' ? `0x${'11'.repeat(32)}` : `0x${'11'.repeat(20)}` };
  expect(() => assertCurrentNativeTokenRefillBinding('cheap-native', changed)).toThrow('no current native admission');
});
it('does not transfer native refill admission to the archived candidate', () => {
  expect(() => assertCurrentNativeTokenRefillBinding('cheap-current', binding)).toThrow('no current native admission');
});
