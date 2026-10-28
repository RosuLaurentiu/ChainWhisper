import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AbiCoder, keccak256 } from '@coti-io/coti-ethers';
import { ARCHIVED_CHEAP_DEX_CANDIDATE, STAGED_NATIVE_DEX_CANDIDATE as native, type CurrentCheapDexCandidate } from './dexV2Deployment';
import { CURRENT_DEX_DAILY_PRICE_CONFIG, type CurrentDexDailyPriceManifest } from './currentDexDailyPrice';
import { COTI_TESTNET_NETWORK } from './chainWhisperNetworks';
import { currentNativeDexDailyPriceConfig, NATIVE_TESTNET_DEX_DAILY_PRICE_MANIFEST as manifest } from './currentDexNativeDailyPriceTestnet';

describe('current native history read binding', () => {
  it('copies every accepted manifest field except safe canonical display labels', () => {
    const accepted = JSON.parse(readFileSync('reports/next-dex-app-2026-10-04/current-history-native-manifest-1.json', 'utf8')) as CurrentDexDailyPriceManifest;
    expect(manifest).toEqual({ ...accepted, symbols: ['Test token 1', 'Test token 0'] });
    expect(manifest.decimals0).toBe(18); expect(manifest.decimals1).toBe(18);
    expect(Object.isFrozen(manifest)).toBe(true); expect(Object.isFrozen(manifest.symbols)).toBe(true);
  });
  it('returns the exact public read config for the full current candidate without activating the default', () => {
    expect(currentNativeDexDailyPriceConfig(native)).toEqual({ status: 'active', manifest,
      rpcUrl: COTI_TESTNET_NETWORK.rpcUrl, finalityLagBlocks: 2 });
    expect(CURRENT_DEX_DAILY_PRICE_CONFIG).toEqual({ status: 'inactive' });
    expect(currentNativeDexDailyPriceConfig(native)).not.toHaveProperty('readyToSign');
  });
  it('binds an explicit selected pair and keeps other markets outside the historical recorder',()=>{
    expect(currentNativeDexDailyPriceConfig(native,manifest.symbols).status).toBe('active');
    expect(currentNativeDexDailyPriceConfig(native,[manifest.symbols[1],manifest.symbols[0]]).status).toBe('active');
    expect(currentNativeDexDailyPriceConfig(native,['BCN','HBR'])).toEqual({status:'inactive'});
  });
  it.each(['archived', 'graph', 'package', 'chain', 'genesis', 'core', 'release', 'market', 'token', 'duplicate-token',
    'token-runtime', 'runtime', 'runtime-address', 'missing-runtime', 'companion', 'malformed-token',
    'reviewed-tokens', 'fee', 'lifetime', 'attestation', 'attestation-number', 'attestation-hash'])('leaves %s identity inactive', fault => {
    let patch: Partial<CurrentCheapDexCandidate> = {};
    if (fault === 'archived') { expect(currentNativeDexDailyPriceConfig(ARCHIVED_CHEAP_DEX_CANDIDATE).status).toBe('inactive'); return; }
    if (fault === 'graph') patch = { graph: '00'.repeat(32) };
    if (fault === 'package') patch = { packageSha256: '00'.repeat(32) };
    if (fault === 'chain') patch = { chainId: '1' };
    if (fault === 'genesis') patch = { genesisHash: `0x${'44'.repeat(32)}` };
    if (fault === 'core') patch = { core: native.tokens[0][0] };
    if (fault === 'release') patch = { releaseId: `0x${'44'.repeat(32)}` };
    if (fault === 'market') patch = { marketId: `0x${'44'.repeat(32)}` };
    if (fault === 'reviewed-tokens') patch = { reviewedTokenSet: `0x${'44'.repeat(32)}` };
    if (fault === 'fee') patch = { feePpm: native.feePpm + 1 };
    if (fault === 'lifetime') patch = { maxWorkLifetime: native.maxWorkLifetime + 1 };
    if (fault === 'attestation') patch = { attestationSha256: '00'.repeat(32) };
    if (fault === 'attestation-number') patch = { attestationBlock: { ...native.attestationBlock, number: '1' } };
    if (fault === 'attestation-hash') patch = { attestationBlock: { ...native.attestationBlock, hash: `0x${'44'.repeat(32)}` } };
    if (fault === 'token' || fault === 'malformed-token') patch = { tokens: native.tokens.map((row, i) =>
      i ? row : [fault === 'token' ? `0x${'44'.repeat(20)}` : 'invalid', row[1]] as const) as CurrentCheapDexCandidate['tokens'] };
    if (fault === 'duplicate-token') patch = { tokens: [native.tokens[0], native.tokens[0]] };
    if (fault === 'token-runtime') patch = { tokens: native.tokens.map(([address], i) => [address, i ? native.tokens[i][1] : `0x${'44'.repeat(32)}`] as const) as CurrentCheapDexCandidate['tokens'] };
    if (fault === 'runtime' || fault === 'runtime-address') patch = { runtimes: native.runtimes.map(([role, address, hash], i) =>
      [role, i || fault === 'runtime' ? address : native.tokens[0][0], i || fault === 'runtime-address' ? hash : `0x${'44'.repeat(32)}`] as const) as CurrentCheapDexCandidate['runtimes'] };
    if (fault === 'missing-runtime') patch = { runtimes: native.runtimes.slice(1) as CurrentCheapDexCandidate['runtimes'] };
    if (fault === 'companion') patch = { companions: native.companions.map(([role, address, hash], i) =>
      [role, address, i ? hash : `0x${'44'.repeat(32)}`] as const) as CurrentCheapDexCandidate['companions'] };
    expect(currentNativeDexDailyPriceConfig({ ...native, ...patch }).status).toBe('inactive');
  });
  it('retains canonical labels and the accepted ratio when package token order is reversed', () => {
    const config = currentNativeDexDailyPriceConfig({ ...native, tokens: [...native.tokens].reverse() as CurrentCheapDexCandidate['tokens'] });
    expect(config.status).toBe('active'); if (config.status !== 'active') throw new Error('Missing read config');
    const sample = JSON.parse(readFileSync('reports/next-dex-app-2026-10-04/current-history-native-sample-read-1.json', 'utf8')) as { point: { priceE18: string } };
    expect(config.manifest.symbols).toEqual(['Test token 1', 'Test token 0']);
    expect(config.manifest.token0.toLowerCase()).toBe(native.tokens[1][0]);
    expect(config.manifest.token1.toLowerCase()).toBe(native.tokens[0][0]);
    expect(config.manifest.pair).toBe(keccak256(AbiCoder.defaultAbiCoder().encode(['uint256', 'address', 'address'],
      [native.chainId, config.manifest.token0, config.manifest.token1])));
    expect(sample.point.priceE18).toBe('500000000000000000');
    // The config only supplies identity/labels. It has no price transformation.
    expect(config).not.toHaveProperty('priceE18');
  });
});
