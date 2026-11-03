import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import usePrivateLiquidityWorkspaceData, { buildPrivateLiquidityWorkspaceDeploymentScopeKey } from './usePrivateLiquidityWorkspaceData';
import type { PrivateLiquidityV2DeploymentConfig } from '../../../lib/privateLiquidityV2Deployment';
import { getProviderErrorMessage } from '../../../lib/appShared/core';

const hooks = vi.hoisted(() => ({ index: 0, slots: [] as {
  value?: unknown; deps?: readonly unknown[]; cleanup?: () => void
}[], effects: [] as (() => void)[] }));
const reads = vi.hoisted(() => ({
  anchor: vi.fn(), compose: vi.fn(), model: vi.fn(), advance: vi.fn(), create: vi.fn(), scope: vi.fn(),
  adopt: vi.fn(), attest: vi.fn()
}));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  return { ...actual,
    useRef: (initial: unknown) => (hooks.slots[hooks.index++] ??= { value: { current: initial } }).value,
    useState: (initial: unknown) => {
      const i = hooks.index++;
      hooks.slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [hooks.slots[i].value, (value: unknown) => {
        hooks.slots[i].value = typeof value === 'function' ? value(hooks.slots[i].value) : value;
      }];
    },
    useCallback: (callback: unknown) => { hooks.index++; return callback; },
    useEffect: (effect: () => (() => void) | undefined, deps: readonly unknown[]) => {
      const i = hooks.index++, previous = hooks.slots[i];
      if (!previous || deps.some((dep, n) => !Object.is(dep, previous.deps?.[n]))) {
        hooks.slots[i] = { deps, cleanup: previous?.cleanup };
        hooks.effects.push(() => { hooks.slots[i].cleanup?.(); hooks.slots[i].cleanup = effect(); });
      }
    }
  };
});
vi.mock('../../../lib/privateLiquidityChain', () => ({
  adoptAttestedPrivateLiquidityV2Book: reads.adopt,
  bindPrivateLiquidityReadCapability: vi.fn(async () => ({})),
  readCanonicalPrivateLiquidityCatalogAnchor: reads.anchor,
  readCanonicalPrivateLiquidityPositions: vi.fn(),
  composeCompleteCanonicalPrivateLiquidityPositionSnapshot: reads.compose
}));
vi.mock('../../../lib/privateLiquidityV2Chain', () => ({
  attestPrivateLiquidityV2Deployment: reads.attest,
  bindPrivateLiquidityV2ReadCapability: vi.fn(async () => ({}))
}));
vi.mock('../../../lib/privateLiquidityRpc', () => ({ createPrivateLiquidityHttpProvider: vi.fn(() => ({})) }));
vi.mock('../../../lib/privateLiquidityWorkspaceCoordinator', () => ({
  advancePrivateLiquidityWorkspace: reads.advance,
  createPrivateLiquidityWorkspaceCoordinatorState: reads.create
}));
vi.mock('../../../lib/privateLiquidityWorkspaceModel', () => ({ buildPrivateLiquidityWorkspaceModel: reads.model }));
vi.mock('../../../lib/privateLiquiditySync', () => ({ getPrivateLiquidityHistorySyncScope: reads.scope }));

const deployment = Object.freeze({ bookAddress: 'current-book' });
const snapshot = Object.freeze({ positions: [], positionCount: '0' });
const model = Object.freeze({ positions: [] });
const initialCoordinator = Object.freeze({ revision: 0, historySync: {}, positionBatches: [] });
const partialCoordinator = Object.freeze({ ...initialCoordinator, revision: 1 });
const completeHistory = Object.freeze({ checkpoint: '100', pages: [{ fromBlock: '1', toBlock: '100' }] });
const completeCoordinator = Object.freeze({ ...partialCoordinator, revision: 2, historySync: completeHistory,
  model, completeSnapshot: snapshot });
const config = { status: 'active', fingerprint: 'current', rpcUrl: 'http://unused.invalid',
  manifest: { chainId: '7082400' }, finalityLagBlocks: 0 } as unknown as PrivateLiquidityV2DeploymentConfig;
function Render() {
  hooks.index = 0;
  const result = usePrivateLiquidityWorkspaceData({ enabled: true, config });
  hooks.effects.splice(0).forEach(effect => effect());
  return result;
}
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const load = async () => { Render(); await settle(); Render(); await settle(); return Render(); };
beforeEach(() => {
  hooks.index = 0; hooks.slots = []; hooks.effects = [];
  vi.resetAllMocks();
  reads.adopt.mockResolvedValue(deployment); reads.attest.mockResolvedValue({});
  reads.anchor.mockResolvedValue({ positionCount: '0', nextPositionId: '1' });
  reads.compose.mockReturnValue(snapshot); reads.model.mockReturnValue(model);
  reads.create.mockReturnValue(initialCoordinator);
  reads.scope.mockImplementation(({ state }) => ({ pages: [], ...state }));
});
afterEach(() => { hooks.slots.forEach(slot => slot.cleanup?.()); });

describe('private-liquidity history failure', () => {
  it('retains the verified current snapshot, reports a safe history error, and stops loading without retry', async () => {
    const failure = new Error('History read failed.');
    reads.advance.mockRejectedValue(failure);
    const state = await load();
    expect(state.status).toBe('ready');
    expect(state.deploymentReady).toBe(true);
    expect(state.deployment).toBe(deployment);
    expect(state.completeSnapshot).toBe(snapshot);
    expect(state.model).toBe(model);
    expect(state.error).toBe('');
    expect(state.historyError).toBe(getProviderErrorMessage(failure, 'Private-liquidity history loading failed.'));
    expect(state.historyLoading).toBe(false);
    Render(); await settle(); Render();
    expect(reads.advance).toHaveBeenCalledTimes(1);
  });

  it('clears the history error on explicit refresh and resumes the saved coordinator until success', async () => {
    reads.advance.mockResolvedValueOnce({ state: partialCoordinator, phase: 'syncing-events' })
      .mockRejectedValueOnce(new Error('History read failed.'));
    const failed = await load();
    expect(failed.historyError).toBeTruthy();
    let resume!: (value: unknown) => void;
    reads.advance.mockImplementationOnce(() => new Promise(resolve => { resume = resolve; }));
    failed.refresh(); Render(); await settle();
    const retrying = Render();
    expect(retrying.historyError).toBeFalsy();
    expect(retrying.historyLoading).toBe(true);
    expect(retrying.completeSnapshot).toBe(snapshot);
    expect(reads.advance.mock.calls[2][0].previous).toBe(partialCoordinator);
    expect(reads.advance.mock.calls[2][0].expectedRevision).toBe(1);
    resume({ state: completeCoordinator, phase: 'ready', hydratedPositionCount: 0, totalPositionCount: '0' });
    await settle();
    const recovered = Render();
    expect(recovered.historyError).toBeFalsy();
    expect(recovered.error).toBe('');
    expect(recovered.historyLoading).toBe(false);
    expect(recovered.historyPages).toEqual(completeHistory.pages);
    expect(recovered.deployment).toBe(deployment);
    expect(reads.create).toHaveBeenCalledTimes(1);
    expect(reads.attest).toHaveBeenCalledTimes(1);
  });
});

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
