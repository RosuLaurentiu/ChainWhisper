import { AbiCoder, Interface, toBeHex } from '@coti-io/coti-ethers';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { POOL_EXIT_PREVIEW_ABI, encodePoolExitPreview, encodePreviewedPoolWithdrawal, decodePoolExitPreviewEvent,
  checkPoolExitPreviewValues, computePoolExitPreviewContext } from './currentDexPoolExitPreview';
import type { PoolFundingInput } from './currentDexPoolFunding';

const abi = new Interface(POOL_EXIT_PREVIEW_ABI), coder = AbiCoder.defaultAbiCoder();
const core = toBeHex(123n, 20), ownerContext = toBeHex(456n, 32), previewContext = toBeHex(789n, 32), id = 43n;
const small = 'tuple(uint256 ciphertext,bytes signature)', wide = 'tuple(tuple(uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature)';
const narrow = (n: bigint): PoolFundingInput => ({ ciphertext: n, signature: `0x${'11'.repeat(65)}` });
const large = (n: bigint): PoolFundingInput => ({ ciphertext: { ciphertextHigh: n, ciphertextLow: n + 1n }, signature: `0x${'22'.repeat(65)}` });
const fractions = [narrow(17n), narrow(29n)], minimums = [large(31n), large(37n)];
const preview = () => encodePoolExitPreview(id, ownerContext, fractions);
const event = () => ({ address: core, ...abi.encodeEventLog(abi.getEvent('PoolExitPreviewed')!,
  [id, previewContext, Array.from({ length: 6 }, (_, i) => [BigInt(i), BigInt(i + 1)])]) });
const expected = { ownedShares: 10n, totalShares: 100n, entitlements: [20n, 40n] as const, fraction: [1n, 2n] as const };
const values = [10n, 20n, 5n, 5n, 1n, 2n];
const contextBaseline = () => {
  const words = (n: number) => Array.from({ length: n }, () => toBeHex(0, 32));
  const marketWords = words(71), releaseId = toBeHex(80, 32), marketId = toBeHex(90, 32);
  marketWords[0] = releaseId; marketWords[1] = marketId;
  const anchors = Array.from({ length: 7 }, (_, i) => {
    const a = words(64); a[0] = toBeHex(1, 32); a[62] = toBeHex(i, 32); a[4] = toBeHex(3, 32); a[7] = toBeHex(1, 32);
    for (const k of [8, 9, 10, 11]) a[k] = toBeHex(i * 100 + k, 32);
    marketWords[25 + i * 2] = toBeHex(i * 100 + 12, 32); marketWords[26 + i * 2] = toBeHex(i * 100 + 13, 32);
    return a;
  });
  return { chainId: 7082400n, core, releaseId, marketId, owner: toBeHex(321, 20), marketWords, anchors };
};

describe('private exact Pool exit preview codec', () => {
  it('keeps preview and withdrawal on the same Core selector and exact encrypted fraction', () => {
    const p = abi.decodeFunctionData('managePoolPosition', preview());
    expect([...p.slice(0, 3)]).toEqual([id, ownerContext, 11n]);
    const w = abi.decodeFunctionData('managePoolPosition', encodePreviewedPoolWithdrawal(preview(), previewContext, minimums));
    expect([...w.slice(0, 3)]).toEqual([id, ownerContext, 12n]);
    const decoded = coder.decode(['bytes32', `${small}[2]`, `${wide}[2]`], w[3]);
    expect(decoded[0]).toBe(previewContext);
    expect(coder.encode([`${small}[2]`], [decoded[1]])).toBe(p[3]);
    expect(decoded[2][0].ciphertext.ciphertextHigh).toBe(31n);
    expect(w[0]).toBe(p[0]); expect(w[1]).toBe(p[1]);
  });
  it.each(['id', 'context', 'count', 'width', 'signature', 'integer'] as const)('rejects invalid preview %s', fault => {
    const copy = [...fractions];
    if (fault === 'count') copy.pop(); if (fault === 'width') copy[0] = large(1n);
    if (fault === 'signature') copy[0] = { ...copy[0], signature: '0x11' }; if (fault === 'integer') copy[0] = narrow(-1n);
    expect(() => encodePoolExitPreview(fault === 'id' ? 7n : id, fault === 'context' ? toBeHex(0, 32) : ownerContext, copy)).toThrow();
  });
  it.each(['action', 'outer-suffix', 'inner-suffix', 'inner-signature', 'context', 'minimum-count', 'minimum-width', 'minimum-signature'] as const)(
    'rejects malformed withdrawal %s', fault => {
      const p = [...abi.decodeFunctionData('managePoolPosition', preview())], mins = [...minimums];
      if (fault === 'action') p[2] = 1n;
      if (fault === 'inner-suffix') p[3] += '00';
      if (fault === 'inner-signature') p[3] = coder.encode([`${small}[2]`], [[narrow(1n), { ...narrow(2n), signature: '0x11' }]]);
      if (fault === 'minimum-count') mins.pop(); if (fault === 'minimum-width') mins[0] = narrow(1n);
      if (fault === 'minimum-signature') mins[0] = { ...mins[0], signature: '0x11' };
      const raw = abi.encodeFunctionData('managePoolPosition', p) + (fault === 'outer-suffix' ? '00' : '');
      expect(() => encodePreviewedPoolWithdrawal(raw, fault === 'context' ? toBeHex(0, 32) : previewContext, mins)).toThrow();
    });
  it('decodes only owner ciphertexts from the exact Core event', () => {
    const result = decodePoolExitPreviewEvent([event()], core, id);
    expect(result.context).toBe(previewContext); expect(result.encrypted).toHaveLength(6);
    expect(result.encrypted[5]).toEqual({ ciphertextHigh: 5n, ciphertextLow: 6n });
    expect(Object.isFrozen(result.encrypted[0])).toBe(true);
  });
  it.each(Array.from({ length: 7 }, (_, i) => i).flatMap(i => [4, 7, 8, 9, 10, 11, 25, 26].map(field => [i, field])))(
    'binds class%s reserve/share/revision field%s', (i, field) => {
      const b = contextBaseline(), original = computePoolExitPreviewContext(preview(), b);
      if (field >= 25) b.marketWords[field + i * 2] = toBeHex(BigInt(b.marketWords[field + i * 2]) + 1n, 32);
      else b.anchors[i][field] = toBeHex(BigInt(b.anchors[i][field]) + 1n, 32);
      expect(computePoolExitPreviewContext(preview(), b)).not.toBe(original);
    });
  it('matches the exact compiled derivative ABI and Solidity runtime commitment', () => {
    const folder = '../../../ChainWhisper Contracts V2/validation/candidates/shared-core-exit-preview-2026-10-07/';
    const frozen = createRequire(import.meta.url)(folder + 'candidate.cjs').frozen();
    expect(frozen.manifest.binding.graphSha256).toBe('b2aa0895d7661a43e3a7db85c9ae24daaa641db238a06bec5c64d031dcf382cd');
    const compiled = new Interface(frozen.artifacts.ChainWhisperDexPositionCommands.abi);
    expect(compiled.getEvent('PoolExitPreviewed')!.format('sighash')).toBe(abi.getEvent('PoolExitPreviewed')!.format('sighash'));
    const v = JSON.parse(readFileSync(new URL(folder + 'runtime-context-vector.json', import.meta.url), 'utf8')) as {
      chainId: string; core: string; releaseId: string; marketId: string; owner: string; calldata: string;
      marketWords: string[]; anchors: { words: string[] }[]; eventContext: string;
    };
    expect(computePoolExitPreviewContext(v.calldata, { chainId: BigInt(v.chainId), core: v.core, releaseId: v.releaseId,
      marketId: v.marketId, owner: v.owner, marketWords: v.marketWords, anchors: v.anchors.map(a => a.words) })).toBe(v.eventContext);
  });
  it('uses live encrypted reserves and ignores stale anchor snapshots', () => {
    const b = contextBaseline(), original = computePoolExitPreviewContext(preview(), b);
    for (const a of b.anchors) for (let i = 14; i < 54; i++) a[i] = toBeHex(999, 32);
    expect(computePoolExitPreviewContext(preview(), b)).toBe(original);
  });
  it.each(['chain', 'core', 'release', 'market', 'owner', 'id', 'owner-context', 'fraction'])(
    'binds exit identity %s', field => {
      const b = contextBaseline(), original = computePoolExitPreviewContext(preview(), b);
      if (field === 'chain') b.chainId++;
      if (field === 'core') b.core = toBeHex(456, 20);
      if (field === 'owner') b.owner = toBeHex(654, 20);
      if (field === 'release') { b.releaseId = toBeHex(81, 32); b.marketWords[0] = b.releaseId; }
      if (field === 'market') { b.marketId = toBeHex(91, 32); b.marketWords[1] = b.marketId; }
      const data = encodePoolExitPreview(field === 'id' ? id + 1n : id, field === 'owner-context' ? toBeHex(457, 32) : ownerContext,
        field === 'fraction' ? [narrow(18n), narrow(29n)] : fractions);
      expect(computePoolExitPreviewContext(data, b)).not.toBe(original);
    });
  it.each(['missing-class', 'short-market', 'short-anchor', 'wrong-class', 'wrong-status', 'claim', 'release', 'market', 'word'])(
    'rejects incomplete exit reserve scope: %s', fault => {
      const b = contextBaseline();
      if (fault === 'missing-class') b.anchors.pop();
      if (fault === 'short-market') b.marketWords.pop();
      if (fault === 'short-anchor') b.anchors[0].pop();
      if (fault === 'wrong-class') b.anchors[0][62] = toBeHex(1, 32);
      if (fault === 'wrong-status') b.anchors[0][0] = toBeHex(2, 32);
      if (fault === 'claim') b.anchors[0][59] = toBeHex(1, 32);
      if (fault === 'release') b.releaseId = toBeHex(100, 32);
      if (fault === 'market') b.marketId = toBeHex(101, 32);
      if (fault === 'word') b.anchors[0][8] = '0x1';
      expect(() => computePoolExitPreviewContext(preview(), b)).toThrow('reserve scope');
    });
  it.each(['missing', 'duplicate', 'foreign', 'position', 'data', 'topic'] as const)('rejects %s event proof', fault => {
    const e = event(), rows = fault === 'missing' ? [] : fault === 'duplicate' ? [e, e] : [{ ...e,
      address: fault === 'foreign' ? toBeHex(321n, 20) : e.address,
      data: e.data + (fault === 'data' ? '00' : ''), topics: fault === 'topic' ? [...e.topics, ownerContext] : e.topics }];
    expect(() => decodePoolExitPreviewEvent(rows, core, fault === 'position' ? id + 1n : id)).toThrow();
  });
  it('checks exact burned and remaining shares without deriving reserves', () => {
    expect(checkPoolExitPreviewValues(values, expected)).toEqual({ amount0: 10n, amount1: 20n,
      burnedShares: 5n, remainingShares: 5n, numerator: 1n, denominator: 2n });
    const ambiguous = { ownedShares: 3n, totalShares: 10n, entitlements: [1n, 2n] as const, fraction: [2n, 3n] as const };
    expect(checkPoolExitPreviewValues([0n, 1n, 2n, 1n, 2n, 3n], ambiguous).amount0).toBe(0n);
    expect(checkPoolExitPreviewValues([1n, 1n, 2n, 1n, 2n, 3n], ambiguous).amount0).toBe(1n);
  });
  it.each(['burn', 'remaining', 'numerator', 'denominator', 'payout', 'zero-payout', 'extra', 'overflow', 'share-baseline'] as const)(
    'rejects private preview %s mismatch', fault => {
      const copy = [...values]; if (fault === 'burn') copy[2]++;
      if (fault === 'remaining') copy[3]++; if (fault === 'numerator') copy[4] = 0n; if (fault === 'denominator') copy[5] = 0n;
      if (fault === 'payout') copy[0] = 21n; if (fault === 'zero-payout') { copy[0] = 0n; copy[1] = 0n; }
      if (fault === 'extra') copy.push(0n); if (fault === 'overflow') copy[0] = 1n << 128n;
      expect(() => checkPoolExitPreviewValues(copy, fault === 'share-baseline' ? { ...expected, totalShares: 9n } : expected)).toThrow();
    });
  it('checks maximum supported fraction math with bigint and rejects a zero rounded burn', () => {
    const max = (1n << 128n) - 1n, burned = max * (max - 1n) / max;
    expect(checkPoolExitPreviewValues([burned, 0n, burned, max - burned, max - 1n, max],
      { ownedShares: max, totalShares: max, entitlements: [max, 0n], fraction: [max - 1n, max] }).burnedShares).toBe(burned);
    expect(() => checkPoolExitPreviewValues([0n, 1n, 0n, 1n, 1n, 2n],
      { ownedShares: 1n, totalShares: 2n, entitlements: [1n, 1n], fraction: [1n, 2n] })).toThrow();
  });
});
