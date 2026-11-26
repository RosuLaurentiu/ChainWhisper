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
});
it('does not transfer native refill admission to the current candidate', () => {
  expect(resolveCurrentCheapDexCandidate('cheap-history').graph).not.toBe(deployment.graph);
  expect(() => assertCurrentNativeTokenRefillBinding('cheap-history', binding)).toThrow('no current native admission');
});
