import { createRequire } from 'node:module';
import { AbiCoder, Interface, toBeHex } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import { ARCHIVED_CHEAP_DEX_CANDIDATE as CURRENT_CHEAP_DEX_CANDIDATE } from './dexV2Deployment';
import { CURRENT_POOL_FUNDING_ABI, checkCurrentPoolFundingValues, decodeCurrentPoolFundingEvent,
  encodeCurrentPoolCreation, encodeCurrentPoolFundingPreview, PREPARED_POOL_FUNDING_ABI,
  encodePreparedPoolFundingPreview, encodePreparedPoolCreation, encodePreparedPoolTopUp, type PoolFundingInput } from './currentDexPoolFunding';

const core = CURRENT_CHEAP_DEX_CANDIDATE.core, context = toBeHex(123n, 32);
const abi = new Interface(CURRENT_POOL_FUNDING_ABI), signature = `0x${'11'.repeat(65)}`;
const narrow = (n: bigint): PoolFundingInput => ({ ciphertext: n, signature });
const wide = (n: bigint): PoolFundingInput => ({ ciphertext: { ciphertextHigh: n, ciphertextLow: n + 1n }, signature });
const inputs = [narrow(1n), wide(2n), wide(4n), ...Array.from({ length: 10 }, (_, i) => narrow(BigInt(i + 6)))];
const expected = { budgets: [120n, 50n] as const, tolerance: [0n, 1n] as const, classId: 1n };
const values = [1n, 100n, 50n, 20n, 0n, 100n, 100n, 0n, 1n, 1n];
const event = (id = 0n) => ({ address: core, ...abi.encodeEventLog(abi.getEvent('PoolFundingPreviewed')!,
  [id, context, Array.from({ length: 10 }, (_, i) => [BigInt(i), BigInt(i + 1)])]) });

describe('current shared Pool owner funding codec', () => {
  it('matches the frozen deployed candidate Core and event ABI, not the old successor API', () => {
    const frozen = createRequire(import.meta.url)('../../../ChainWhisper Contracts V2/validation/candidates/direct-limit-match-2026-09-30/current-integration/current-pool-case.cjs').frozen();
    expect(frozen.candidate.graphSha256).toBe(CURRENT_CHEAP_DEX_CANDIDATE.graph);
    const actualCore = new Interface(frozen.candidate.compiled('ChainWhisperDexCore').abi);
    const actualEvents = new Interface(frozen.candidate.artifact('ChainWhisperDexPositionCommands').abi);
    for (const name of ['previewPoolFunding', 'createPoolPosition']) {
      expect(abi.getFunction(name)!.format('sighash')).toBe(actualCore.getFunction(name)!.format('sighash'));
      expect(abi.getFunction(name)!.selector).toBe(actualCore.getFunction(name)!.selector);
    }
    expect(event()).toEqual({ address: core, ...actualEvents.encodeEventLog(actualEvents.getEvent('PoolFundingPreviewed')!,
      [0n, context, Array.from({ length: 10 }, (_, i) => [BigInt(i), BigInt(i + 1)])]) });
  });
  it('keeps all thirteen preview ciphertexts while changing only entry-point signatures', () => {
    const preview = encodeCurrentPoolFundingPreview(0n, inputs);
    const resigned = inputs.map(input => ({ ...input, signature: `0x${'22'.repeat(65)}` }));
    const created = abi.decodeFunctionData('createPoolPosition', encodeCurrentPoolCreation(preview, context, resigned));
    expect(created[0]).toBe(context);
    expect(created[1]).toBe(abi.decodeFunctionData('previewPoolFunding', encodeCurrentPoolFundingPreview(0n, resigned))[1]);
    expect(created[1]).not.toBe(abi.decodeFunctionData('previewPoolFunding', preview)[1]);
  });
  it('encodes a top-up preview with two budgets and two tolerance terms, without a new price or class', () => {
    const data = encodeCurrentPoolFundingPreview(27n, [wide(1n), wide(3n), narrow(0n), narrow(1n)]);
    const result = abi.decodeFunctionData('previewPoolFunding', data);
    expect(result[0]).toBe(27n);
    expect(() => encodeCurrentPoolCreation(data, context, inputs)).toThrow('new-position preview');
  });
  it.each(['count', 'width', 'signature', 'integer', 'changed', 'context', 'trailing', 'payload'] as const)('rejects %s input corruption', fault => {
    const copy = [...inputs];
    if (fault === 'count') copy.pop();
    if (fault === 'width') copy[1] = narrow(1n);
    if (fault === 'signature') copy[0] = { ...copy[0], signature: '0x11' };
    if (fault === 'integer') copy[0] = narrow(-1n);
    if (['count', 'width', 'signature', 'integer'].includes(fault)) {
      expect(() => encodeCurrentPoolFundingPreview(0n, copy)).toThrow(); return;
    }
    const preview = encodeCurrentPoolFundingPreview(0n, inputs);
    if (fault === 'changed') copy[0] = narrow(99n);
    const malformedPayload = abi.encodeFunctionData('previewPoolFunding', [0n,
      abi.decodeFunctionData('previewPoolFunding', preview)[1] + '00']);
    expect(() => encodeCurrentPoolCreation(fault === 'trailing' ? preview + '00' : fault === 'payload' ? malformedPayload : preview,
      fault === 'context' ? toBeHex(0n, 32) : context, copy)).toThrow();
  });
  it('decodes one exact private event; class and amounts are not public event fields', () => {
    const decoded = decodeCurrentPoolFundingEvent([event()], core, 0n);
    expect(decoded.context).toBe(context);
    expect(decoded.encrypted).toHaveLength(10);
    expect(decoded.encrypted[9]).toEqual({ ciphertextHigh: 9n, ciphertextLow: 10n });
    expect(Object.isFrozen(decoded.encrypted[9])).toBe(true);
  });
  it.each(['missing', 'duplicate', 'foreign', 'id', 'data', 'topic'] as const)('rejects %s event', fault => {
    const row = event();
    const logs = fault === 'missing' ? [] : fault === 'duplicate' ? [row, row] : [{ ...row,
      address: fault === 'foreign' ? `0x${'22'.repeat(20)}` : row.address,
      data: fault === 'data' ? row.data + '00' : row.data,
      topics: fault === 'topic' ? [...row.topics, context] : row.topics }];
    expect(() => decodeCurrentPoolFundingEvent(logs, core, fault === 'id' ? 1n : 0n)).toThrow();
  });
  it('shows add mode, exact matched debit and unmatched budgets', () => {
    expect(checkCurrentPoolFundingValues(values, expected)).toMatchObject({ operation: 'add', used0: 100n, used1: 50n,
      unused0: 20n, unused1: 0n, mintedShares: 100n, ownedShares: 100n });
    expect(checkCurrentPoolFundingValues([0n, 120n, 50n, 0n, 0n, 120n, 120n, 0n, 1n, 1n], expected).operation).toBe('initialize');
  });
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])('rejects mismatched decrypted preview field %i', index => {
    const copy = [...values];
    copy[index] = index === 0 ? 2n : index === 5 ? 0n : index === 6 ? 1n : values[index] + 1n;
    expect(() => checkCurrentPoolFundingValues(copy, expected)).toThrow();
  });
  it('preserves full uint256 budget arithmetic and rejects overflow or zero usable shares', () => {
    const max = (1n << 256n) - 1n;
    expect(checkCurrentPoolFundingValues([1n, max - 1n, 50n, 1n, 0n, 1n, 1n, 0n, 1n, 1n],
      { ...expected, budgets: [max, 50n] }).used0).toBe(max - 1n);
    expect(() => checkCurrentPoolFundingValues([1n, max + 1n, 50n, 0n, 0n, 1n, 1n, 0n, 1n, 1n], expected)).toThrow();
    expect(() => checkCurrentPoolFundingValues([1n, 0n, 50n, 120n, 0n, 0n, 0n, 0n, 1n, 1n], expected)).toThrow();
  });
  it('rejects unknown classes, extra private fields and zero tolerance denominator', () => {
    expect(() => checkCurrentPoolFundingValues([...values, 0n], expected)).toThrow();
    expect(() => checkCurrentPoolFundingValues(values, { ...expected, classId: 7n })).toThrow();
    expect(() => checkCurrentPoolFundingValues(values, { ...expected, tolerance: [0n, 0n] })).toThrow();
  });
  it('does not allow a non-canonical ABI payload to become funding calldata', () => {
    const data = encodeCurrentPoolFundingPreview(0n, inputs);
    const raw = abi.decodeFunctionData('previewPoolFunding', data)[1];
    const decoded = AbiCoder.defaultAbiCoder().decode(['(uint256,bytes)', '((uint256,uint256),bytes)[2]', '(uint256,bytes)[10]'], raw);
    expect(decoded[2]).toHaveLength(10);
  });
});

describe('prepared build-6 Pool funding ABI profile', () => {
  const prepared = new Interface(PREPARED_POOL_FUNDING_ABI), coder = AbiCoder.defaultAbiCoder();
  const market = toBeHex(456n, 32), ownerContext = toBeHex(789n, 32), id = 27n;
  const added = [wide(1n), wide(3n), narrow(0n), narrow(1n)];
  const resign = (rows: readonly PoolFundingInput[]): PoolFundingInput[] => rows.map(row => ({ ...row, signature: `0x${'22'.repeat(65)}` }));
  it('matches selectors and complete calldata from the sealed build-6 ABI', () => {
    const frozen = createRequire(import.meta.url)('../../../ChainWhisper Contracts V2/validation/candidates/shared-core-prepared-markets-2026-10-07/candidate.cjs').frozen();
    expect(frozen.manifest.binding.graphSha256).toBe('85767f8adefa7323ca97b190b4d959ce8ee08b38be02e568c2415decf028052c');
    const actual = new Interface(frozen.artifacts.ChainWhisperDexCore.abi);
    for (const name of ['previewPoolFunding', 'createPoolPosition', 'managePoolPosition']) {
      expect(prepared.getFunction(name)!.format('sighash')).toBe(actual.getFunction(name)!.format('sighash'));
      expect(prepared.getFunction(name)!.selector).toBe(actual.getFunction(name)!.selector);
    }
    const preview = encodePreparedPoolFundingPreview(market, 0n, inputs);
    expect(actual.encodeFunctionData('previewPoolFunding', prepared.decodeFunctionData('previewPoolFunding', preview))).toBe(preview);
    const creation = encodePreparedPoolCreation(market, preview, context, resign(inputs));
    expect(actual.encodeFunctionData('createPoolPosition', prepared.decodeFunctionData('createPoolPosition', creation))).toBe(creation);
    const topUp = encodePreparedPoolTopUp(market, id, encodePreparedPoolFundingPreview(market, id, added), context, ownerContext, resign(added));
    expect(actual.encodeFunctionData('managePoolPosition', prepared.decodeFunctionData('managePoolPosition', topUp))).toBe(topUp);
  });
  it('retains creation market and all thirteen ciphertexts with fresh signatures', () => {
    const preview = encodePreparedPoolFundingPreview(market, 0n, inputs);
    const result = prepared.decodeFunctionData('createPoolPosition', encodePreparedPoolCreation(market, preview, context, resign(inputs)));
    expect(result[0]).toBe(market); expect(result[1]).toBe(context);
    expect(result[2]).toBe(prepared.decodeFunctionData('previewPoolFunding', encodePreparedPoolFundingPreview(market, 0n, resign(inputs)))[2]);
  });
  it('encodes TOP_UP=0 with separate owner and preview contexts and four retained ciphertexts', () => {
    const preview = encodePreparedPoolFundingPreview(market, id, added);
    const result = prepared.decodeFunctionData('managePoolPosition', encodePreparedPoolTopUp(market, id, preview, context, ownerContext, resign(added)));
    expect([...result.slice(0, 3)]).toEqual([id, ownerContext, 0n]);
    const funding = coder.decode(['bytes32', 'bytes'], result[3]);
    expect(funding[0]).toBe(context);
    expect(funding[1]).toBe(prepared.decodeFunctionData('previewPoolFunding', encodePreparedPoolFundingPreview(market, id, resign(added)))[2]);
  });
  it.each(['market', 'id', 'method', 'trailing', 'payload', 'changed', 'signature', 'preview-signature', 'wide', 'preview-context', 'owner-context'] as const)(
    'rejects %s top-up corruption', fault => {
      const original = fault === 'preview-signature' ? added.map((row, i) => i === 0 ? { ...row, signature: '0x11' } : row) : added;
      const raw = fault === 'preview-signature' ? coder.encode(['((uint256,uint256),bytes)[2]', '(uint256,bytes)[2]'],
        [original.slice(0, 2).map(row => [Object.values(row.ciphertext as object), row.signature]), original.slice(2).map(row => [row.ciphertext, row.signature])]) :
        prepared.decodeFunctionData('previewPoolFunding', encodePreparedPoolFundingPreview(market, id, added))[2];
      let preview = prepared.encodeFunctionData('previewPoolFunding', [market, id, raw + (fault === 'payload' ? '00' : '')]);
      if (fault === 'trailing') preview += '00';
      if (fault === 'method') preview = encodeCurrentPoolFundingPreview(id, added);
      const rows = resign(added);
      if (fault === 'changed') rows[3] = narrow(4n);
      if (fault === 'signature') rows[0] = { ...rows[0], signature: '0x11' };
      if (fault === 'wide') rows[0] = wide(1n << 256n);
      expect(() => encodePreparedPoolTopUp(fault === 'market' ? toBeHex(457n, 32) : market, fault === 'id' ? id + 1n : id,
        preview, fault === 'preview-context' ? toBeHex(0n, 32) : context, fault === 'owner-context' ? '0x11' : ownerContext, rows)).toThrow();
    });
  it('rejects wrong creation market/id, changed ciphertexts, zero ids and invalid selected markets', () => {
    const preview = encodePreparedPoolFundingPreview(market, 0n, inputs);
    expect(() => encodePreparedPoolCreation(toBeHex(1n, 32), preview, context, inputs)).toThrow();
    expect(() => encodePreparedPoolCreation(market, encodePreparedPoolFundingPreview(market, id, added), context, inputs)).toThrow();
    expect(() => encodePreparedPoolCreation(market, preview, context, [narrow(99n), ...inputs.slice(1)])).toThrow();
    expect(() => encodePreparedPoolTopUp(market, 0n, preview, context, ownerContext, added)).toThrow();
    expect(() => encodePreparedPoolFundingPreview(toBeHex(0n, 32), id, added)).toThrow();
    expect(() => encodePreparedPoolFundingPreview(market, id, [wide(-1n), ...added.slice(1)])).toThrow();
    expect(() => encodePreparedPoolFundingPreview(market, id, [wide(1n << 256n), ...added.slice(1)])).toThrow();
  });
});
