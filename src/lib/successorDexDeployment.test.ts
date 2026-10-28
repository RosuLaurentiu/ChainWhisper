import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  loadSuccessorDexManifest,
  parseSuccessorDexManifest
} from './successorDexDeployment';

const L8_SEMANTIC_ID = '0xebba94e30af59ae06a74e9ac84f84e9836a1a78f101f32d8b38b438fe3df50da';

const manifest = () => {
  const candidate = JSON.parse(readFileSync(
    new URL('../../public/deployments/coti-testnet-successor-app-manifest.json', import.meta.url),
    'utf8'
  )) as Record<string, any>;
  candidate.tokens = candidate.tokens.map((token: Record<string, unknown>) => ({ ...token, lotSizeRaw: '10000000' }));
  candidate.appReady = true;
  candidate.status = 'deployed-seeded-app-ready';
  candidate.privateBookWorkProfile = {
    inputLatticeCells: 8,
    maximumInputLots: '7',
    semanticId: L8_SEMANTIC_ID
  };
  candidate.pairs = candidate.pairs.map((pair: Record<string, any>) => ({
    ...pair,
    coordinatorSemanticId: pair.coordinator === null ? null : L8_SEMANTIC_ID,
    admissionAdapters: Object.fromEntries((pair.strategies as string[]).map((strategy, index) => {
      const family = strategy.replace('Tiny', '');
      const label = String(pair.displayPair).split('/').join('-').toLowerCase();
      const suffix = strategy === 'AggregateTiny' ? 'aggregate-tiny' : family.toLowerCase();
      const base = `spb-${label}-${suffix}`;
      return [family, {
        adapterRoleKey: `${base}-adapter`,
        bridgeRoleKey: `${base}-bridge`,
        sourceId: index + 1,
        capacityModel: family === 'Aggregate' ? 'multi-position-count' : 'reusable-single-active-slot'
      }];
    }))
  }));
  for (const pair of candidate.pairs.filter(({ coordinator }: Record<string, any>) => coordinator !== null)) {
    const label = String(pair.displayPair).split('/').join('-').toLowerCase();
    candidate.contracts[`spb-${label}-coordinator`].semanticId = L8_SEMANTIC_ID;
  }
  return candidate as Record<string, unknown>;
};

describe('successor DEX deployment manifest', () => {
  it('accepts the ready four-token, six-pair, seven-position deployment profile', () => {
    const parsed = parseSuccessorDexManifest(manifest());
    expect(Object.keys(parsed.contracts).length).toBeGreaterThan(0);
    expect(parsed.appReady).toBe(true);
    expect(parsed.status).toBe('deployed-seeded-app-ready');
    expect(parsed.tokens.map(({ symbol }) => symbol)).toEqual(['BCN', 'HBR', 'EMBR', 'ORBT']);
    expect(parsed.pairs).toHaveLength(6);
    expect(parsed.strategies).toHaveLength(7);
    expect(parsed.p2SuccessfulRouteLiquiditySupported).toBe(false);
    expect(parsed.tokens.every(({ lotSizeRaw }) => lotSizeRaw === '10000000')).toBe(true);
    expect(parsed.privateBookWorkProfile).toMatchObject({ inputLatticeCells: 8, maximumInputLots: '7' });
  });

  it('accepts reviewed graph and receipt cardinality changes under the release identity', () => {
    const candidate = manifest();
    const contracts = candidate.contracts as Record<string, unknown>;
    const initialContractCount = Object.keys(contracts).length;
    const protectedKeys = new Set([
      'global-core',
      'position-nft',
      'work-authority',
      ...((candidate.pairs as Record<string, any>[]).flatMap((pair) => {
        if (pair.sourceCount === 0) return [];
        const label = String(pair.displayPair).split('/').join('-').toLowerCase();
        return [
          `spb-${label}-coordinator`,
          `spb-${label}-epoch`,
          ...Object.values(pair.admissionAdapters as Record<string, any>).flatMap((binding) => [
            binding.adapterRoleKey,
            binding.bridgeRoleKey
          ])
        ];
      }))
    ]);
    const removable = Object.keys(contracts).find((key) =>
      !key.startsWith('token-') && !protectedKeys.has(key))!;
    delete contracts[removable];
    (candidate.receipts as unknown[]).pop();
    const parsed = parseSuccessorDexManifest(candidate);
    expect(Object.keys(parsed.contracts)).toHaveLength(initialContractCount - 1);
  });

  it('rejects integration-pending state and any non-mined receipt', () => {
    const pending = manifest();
    pending.appReady = false;
    pending.status = 'deployed-seeded-app-integration-pending';
    expect(() => parseSuccessorDexManifest(pending)).toThrow(/reviewed testnet candidate/);

    const reverted = manifest();
    (reverted.receipts as Record<string, unknown>[])[0].status = 'REVERTED';
    expect(() => parseSuccessorDexManifest(reverted)).toThrow(/receipt or spend evidence/);
  });

  it('rejects manifests without reviewed token lots or the bound private-book work profile', () => {
    const missingLot = manifest();
    delete (missingLot.tokens as Record<string, unknown>[])[0].lotSizeRaw;
    expect(() => parseSuccessorDexManifest(missingLot)).toThrow(/lot size/);

    const missingProfile = manifest();
    delete missingProfile.privateBookWorkProfile;
    expect(() => parseSuccessorDexManifest(missingProfile)).toThrow(/work profile is missing/);

    const mismatchedProfile = manifest();
    (mismatchedProfile.privateBookWorkProfile as Record<string, unknown>).maximumInputLots = '8';
    expect(() => parseSuccessorDexManifest(mismatchedProfile)).toThrow(/work profile is invalid/);

    const wrongSemantic = manifest();
    (wrongSemantic.privateBookWorkProfile as Record<string, unknown>).semanticId = `0x${'12'.repeat(32)}`;
    expect(() => parseSuccessorDexManifest(wrongSemantic)).toThrow(/work profile is invalid/);
  });

  it('rejects missing or swapped corrected graph roles', () => {
    const missing = manifest();
    delete (missing.contracts as Record<string, unknown>)['work-authority'];
    expect(() => parseSuccessorDexManifest(missing)).toThrow(/work-authority.*corrected successor graph role/);

    const swapped = manifest();
    const contracts = swapped.contracts as Record<string, unknown>;
    [contracts['global-core'], contracts['position-nft']] =
      [contracts['position-nft'], contracts['global-core']];
    expect(() => parseSuccessorDexManifest(swapped)).toThrow(/global-core.*corrected successor graph role/);

    const pairSwap = manifest();
    const pair = (pairSwap.pairs as Record<string, any>[]).find(({ sourceCount }) => sourceCount > 0)!;
    const label = String(pair.displayPair).split('/').join('-').toLowerCase();
    const coordinatorKey = `spb-${label}-coordinator`;
    const epochKey = `spb-${label}-epoch`;
    const pairContracts = pairSwap.contracts as Record<string, unknown>;
    [pairContracts[coordinatorKey], pairContracts[epochKey]] =
      [pairContracts[epochKey], pairContracts[coordinatorKey]];
    expect(() => parseSuccessorDexManifest(pairSwap)).toThrow(/corrected successor graph role/);
  });

  it('rejects incomplete pair coverage and a changed strategy owner', () => {
    const missingPair = manifest();
    missingPair.pairs = (missingPair.pairs as unknown[]).slice(0, 5);
    expect(() => parseSuccessorDexManifest(missingPair)).toThrow(/six canonical pairs/);

    const wrongOwner = manifest();
    wrongOwner.strategyOwner = '0x0000000000000000000000000000000000000001';
    expect(() => parseSuccessorDexManifest(wrongOwner)).toThrow(/approved test wallet/);
  });

  it('requires exact family adapter roles and capacity models', () => {
    const parsed = parseSuccessorDexManifest(manifest());
    expect(parsed.pairs.find(({ displayPair }) => displayPair === 'BCN/HBR')
      ?.admissionAdapters.Aggregate).toEqual({
        adapterRoleKey: 'spb-bcn-hbr-aggregate-adapter',
        bridgeRoleKey: 'spb-bcn-hbr-aggregate-bridge',
        sourceId: 1,
        capacityModel: 'multi-position-count'
      });
    expect(parsed.pairs.find(({ displayPair }) => displayPair === 'BCN/EMBR')
      ?.admissionAdapters.Fixed?.capacityModel).toBe('reusable-single-active-slot');

    const missing = manifest();
    delete ((missing.pairs as Record<string, any>[]).find(({ displayPair }) =>
      displayPair === 'BCN/HBR')!.admissionAdapters as Record<string, unknown>).Aggregate;
    expect(() => parseSuccessorDexManifest(missing)).toThrow(/adapter count is invalid/);

    const swapped = manifest();
    const fixed = ((swapped.pairs as Record<string, any>[]).find(({ displayPair }) =>
      displayPair === 'BCN/EMBR')!.admissionAdapters as Record<string, any>).Fixed;
    fixed.adapterRoleKey = fixed.bridgeRoleKey;
    expect(() => parseSuccessorDexManifest(swapped)).toThrow(/Fixed admission binding is invalid/);

    const wrongCapacity = manifest();
    ((wrongCapacity.pairs as Record<string, any>[]).find(({ displayPair }) =>
      displayPair === 'BCN/ORBT')!.admissionAdapters as Record<string, any>)
      .Range.capacityModel = 'multi-position-count';
    expect(() => parseSuccessorDexManifest(wrongCapacity)).toThrow(/Range admission binding is invalid/);
  });

  it('binds the fetched manifest to the configured release identity', async () => {
    const candidate = manifest();
    const fetcher = vi.fn(async () => Response.json(candidate));
    await expect(loadSuccessorDexManifest({
      config: {
        status: 'active',
        expectedReleaseIdentityHash: String(candidate.releaseIdentityHash),
        finalityLagBlocks: 5,
        manifestUrl: '/deployments/coti-testnet-successor-app-manifest.json'
      },
      fetcher
    })).resolves.toMatchObject({ releaseIdentityHash: candidate.releaseIdentityHash });
    await expect(loadSuccessorDexManifest({
      config: {
        status: 'active',
        expectedReleaseIdentityHash: `0x${'0'.repeat(64)}`,
        finalityLagBlocks: 5,
        manifestUrl: '/deployments/coti-testnet-successor-app-manifest.json'
      },
      fetcher
    })).rejects.toThrow(/release identity is stale/);
  });
});
