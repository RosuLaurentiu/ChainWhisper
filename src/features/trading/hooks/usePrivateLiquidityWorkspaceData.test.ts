import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPrivateLiquidityWorkspaceDeploymentScopeKey } from './usePrivateLiquidityWorkspaceData';

const active = Object.freeze({
  status: 'active',
  fingerprint: 'candidate:private-liquidity-v2'
} as const);

describe('private-liquidity workspace deployment scope', () => {
  it('is stable across equivalent active configuration wrappers', () => {
    expect(buildPrivateLiquidityWorkspaceDeploymentScopeKey({ ...active })).toBe(
      buildPrivateLiquidityWorkspaceDeploymentScopeKey(active)
    );
  });

  it('changes for a different deployment and preserves invalid configuration identity', () => {
    expect(buildPrivateLiquidityWorkspaceDeploymentScopeKey({
      ...active,
      fingerprint: 'candidate:private-liquidity-v3'
    })).not.toBe(buildPrivateLiquidityWorkspaceDeploymentScopeKey(active));
    expect(buildPrivateLiquidityWorkspaceDeploymentScopeKey({
      status: 'invalid',
      error: 'first failure'
    })).not.toBe(buildPrivateLiquidityWorkspaceDeploymentScopeKey({
      status: 'invalid',
      error: 'second failure'
    }));
  });

  it('keeps market refresh separate from deployment re-attestation', () => {
    const source = readFileSync(new URL('./usePrivateLiquidityWorkspaceData.ts', import.meta.url), 'utf8');
    expect(source).toContain('}, [attestationRetryRevision, deploymentScopeKey, enabled]);');
    expect(source).not.toContain('}, [deploymentScopeKey, enabled, refreshRevision]);');
    expect(source).toContain('refresh, retryDeployment');
    expect(source).toContain('historyLoading');
  });
});
