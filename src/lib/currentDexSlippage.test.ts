import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Interface } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import { CURRENT_CHEAP_DEX_QUOTE_ABI, CURRENT_SLIPPAGE_DEX_QUOTE_ABI,
  decodeCurrentDexQuoteIssue, encodeCurrentDexQuoteRequest, type CurrentCheapDexProfile } from './currentDexOperation';
import { buildCurrentDexQuoteReview, CURRENT_DEX_ACCEPT_ABI, CURRENT_SLIPPAGE_DEX_ACCEPT_ABI,
  DEFAULT_CURRENT_DEX_SLIPPAGE_PERCENT, parseCurrentDexSlippagePercent, prepareCurrentDexAcceptance } from './currentDexQuoteReview';
import { CURRENT_CHEAP_DEX_CANDIDATE, STAGED_QUOTE_SLIPPAGE_IDENTITY, currentCheapDexQuoteProtocol, resolveCurrentCheapDexCandidate, assertCurrentCheapDexNativeAdmission } from './dexV2Deployment';

const graph = '../../../ChainWhisper Contracts V2/validation/candidates/quote-slippage-2026-10-03/graph-build-3/';
const artifactBytes = readFileSync(new URL(`${graph}snapshot/contracts/dex/ChainWhisperDexCore.sol/ChainWhisperDexCore.json`, import.meta.url));
const native = new Interface(JSON.parse(artifactBytes.toString()).abi);
const codec = new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI);
const addr = (n: number) => `0x${n.toString(16).repeat(40)}`;
const hash = (n: number) => `0x${n.toString(16).repeat(64)}`;

const issueFixture = (profile: CurrentCheapDexProfile, toleranceBps = 50) => {
  const principal = addr(2), core = addr(1), inputToken = addr(3), outputToken = addr(4);
  const name = profile === 'fast-pool' ? 'quoteFastPool' : 'quoteCheapAsync';
  const wide = [[(1n << 256n) - 1n, 2n], '0x1234'];
  const terms = [inputToken, outputToken, principal, 100n, wide, wide, wide, [0n, '0x12'], [1n, '0x34'], toleranceBps];
  // The compiled contract ABI is the independent encoder, not the client ABI.
  const calldata = native.encodeFunctionData(name, profile === 'fast-pool' ? terms : [terms]);
  const eventName = profile === 'fast-pool' ? 'FastPoolQuoteIssued' : 'CheapAsyncAdvanced';
  const log = { address: core, ...native.encodeEventLog(native.getEvent(eventName)!,
    profile === 'fast-pool' ? [7n, hash(5), 100n] : [7n, 1, hash(0)]) };
  return { profile, quoteProtocol: 'quote-slippage' as const,
    expected: { transactionHash: hash(1), chainId: 7082400n, core, principal, calldata,
      inputToken, outputToken, destination: principal, deadline: 100n, releaseId: hash(3), toleranceBps },
    transaction: { hash: hash(1), chainId: 7082400n, from: principal, to: core as string | null,
      data: calldata, value: 0n, blockNumber: 50 as number | null, blockHash: hash(2) as string | null },
    receipt: { hash: hash(1), from: principal, to: core as string | null, status: 1 as number | null,
      blockNumber: 50, blockHash: hash(2), logs: [log] } };
};

const reviewFixture = (profile: CurrentCheapDexProfile) => {
  const intent = { chainId: 7082400n, core: addr(1), principal: addr(2), runtimeHash: hash(1), releaseId: hash(2),
    operationId: 7n, contextHash: hash(5), deadline: 100n, maximumInput: 500n, minimumInput: 400n, minimumOutput: 300n,
    rateNumerator: 0n, rateDenominator: 1n, profile, quoteProtocol: 'quote-slippage' as const, toleranceBps: 50 };
  const receipt = { chainId: intent.chainId, core: intent.core, principal: intent.principal,
    runtimeHash: intent.runtimeHash, releaseId: intent.releaseId, operationId: intent.operationId,
    block: { number: 50n, hash: hash(2), timestamp: 90n }, kind: 'quote' as const,
    operation: { profile, phase: 'quote-prepared' as const, ready: true, stage: profile === 'cheap-async' ? 4 : undefined,
      contextHash: intent.contextHash, deadline: intent.deadline },
    amounts: { filled: true, maximumInput: 500n, actualInput: 400n, refund: 100n, grossOutput: 303n, fee: 3n, netOutput: 300n } };
  return { intent, receipt, now: 99n, input: { symbol: 'IN', decimals: 6 }, output: { symbol: 'OUT', decimals: 18 } };
};

describe('new quote-slippage unsigned client codec', () => {
  it('selects slippage from exact candidate identity and keeps the archived old trial isolated', () => {
    const archived = resolveCurrentCheapDexCandidate('cheap-archived');
    expect(currentCheapDexQuoteProtocol(archived)).toBeUndefined();
    expect(currentCheapDexQuoteProtocol(STAGED_QUOTE_SLIPPAGE_IDENTITY)).toBe('quote-slippage');
    for (const key of ['graph', 'packageSha256', 'core'] as const) {
      expect(() => currentCheapDexQuoteProtocol({ ...STAGED_QUOTE_SLIPPAGE_IDENTITY, [key]: archived[key] })).toThrow('graph, package and Core');
    }
  });
  it('selects actual current d06 slippage while keeping its real native App admission held', () => {
    expect(CURRENT_CHEAP_DEX_CANDIDATE).toBe(resolveCurrentCheapDexCandidate('cheap-d06'));
    expect(currentCheapDexQuoteProtocol(CURRENT_CHEAP_DEX_CANDIDATE)).toBe('quote-slippage');
    expect(() => assertCurrentCheapDexNativeAdmission(CURRENT_CHEAP_DEX_CANDIDATE)).toThrow('native App submission admission');
    for (const key of ['graph', 'packageSha256', 'core'] as const) {
      expect(() => currentCheapDexQuoteProtocol({ ...CURRENT_CHEAP_DEX_CANDIDATE, [key]: STAGED_QUOTE_SLIPPAGE_IDENTITY[key] })).toThrow('graph, package and Core');
    }
  });
  it.each(['fast-pool', 'cheap-async'] as const)('encodes the complete %s request against the independent contract ABI', profile => {
    const signature = `0x${'44'.repeat(65)}`, max = (1n << 256n) - 1n;
    const values = [0n, 1n, (1n << 64n) - 1n, 1n << 64n, (1n << 128n) - 1n, 1n << 128n, 1n << 255n, max];
    for (const value of values) for (const toleranceBps of [0, 1, 50, 9999, 10000]) {
      const wide = { ciphertext: { ciphertextHigh: value, ciphertextLow: max - value }, signature };
      const rate = { ciphertext: value, signature };
      const request = { profile, quoteProtocol: 'quote-slippage' as const, toleranceBps,
        inputToken: addr(3), outputToken: addr(4), destination: addr(2), deadline: 100n,
        maximumInput: wide, minimumInput: wide, minimumOutput: wide,
        minimumRateNumerator: rate, minimumRateDenominator: rate };
      const terms = [addr(3), addr(4), addr(2), 100n, wide, wide, wide, rate, rate];
      const name = profile === 'fast-pool' ? 'quoteFastPool' : 'quoteCheapAsync';
      const data = encodeCurrentDexQuoteRequest(request);
      expect(data).toBe(native.encodeFunctionData(name, profile === 'fast-pool' ? [...terms, toleranceBps] : [[...terms, toleranceBps]]));
      expect(codec.decodeFunctionData(name, data).toArray()).toEqual(native.decodeFunctionData(name, data).toArray());
      const oldName = profile === 'fast-pool' ? 'quoteFastPoolV1' : 'quoteCheapAsyncV1';
      expect(encodeCurrentDexQuoteRequest({ ...request, quoteProtocol: undefined, toleranceBps: undefined }))
        .toBe(new Interface(CURRENT_CHEAP_DEX_QUOTE_ABI).encodeFunctionData(oldName, profile === 'fast-pool' ? terms : [terms]));
    }
  });

  it('rejects unbound tolerance and invalid complete request fields before encoding', () => {
    const signature = `0x${'44'.repeat(65)}`;
    const request: Parameters<typeof encodeCurrentDexQuoteRequest>[0] = {
      profile: 'fast-pool', quoteProtocol: 'quote-slippage', toleranceBps: 50,
      inputToken: addr(3), outputToken: addr(4), destination: addr(2), deadline: 100n,
      maximumInput: { ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature },
      minimumInput: { ciphertext: { ciphertextHigh: 0n, ciphertextLow: 0n }, signature },
      minimumOutput: { ciphertext: { ciphertextHigh: 0n, ciphertextLow: 1n }, signature },
      minimumRateNumerator: { ciphertext: 0n, signature }, minimumRateDenominator: { ciphertext: 1n, signature }
    };
    const failures = [
      { profile: 'other' }, { quoteProtocol: 'other' }, { quoteProtocol: undefined },
      { toleranceBps: undefined }, ...[-1, 10001, NaN, Infinity, 0.5].map(toleranceBps => ({ toleranceBps })),
      { inputToken: addr(0) }, { outputToken: request.inputToken }, { destination: '0x1234' },
      { deadline: 0n }, { deadline: -1n }, { deadline: 1n << 256n },
      { maximumInput: { ...request.maximumInput, ciphertext: { ciphertextHigh: -1n, ciphertextLow: 0n } } },
      { minimumInput: { ...request.minimumInput, ciphertext: { ciphertextHigh: 0n, ciphertextLow: 1n << 256n } } },
      { minimumOutput: { ...request.minimumOutput, signature: '0x' } },
      { minimumRateNumerator: { ciphertext: -1n, signature } },
      { minimumRateDenominator: { ciphertext: 1n, signature: '0x12' } }
    ];
    for (const fault of failures) expect(() => encodeCurrentDexQuoteRequest(
      { ...request, ...fault } as Parameters<typeof encodeCurrentDexQuoteRequest>[0])).toThrow();
    expect(encodeCurrentDexQuoteRequest(request)).toMatch(/^0x/);
  });

  it('matches the exact graph-build-3 ABI without modifying current selectors', () => {
    expect(createHash('sha256').update(artifactBytes).digest('hex'))
      .toBe('a60a5e2e3d1536a673547fb70a9743093f8204c4cae6d64c032e4eedbb33a911');
    for (const name of ['quoteFastPool', 'quoteCheapAsync']) {
      expect(codec.getFunction(name)?.format('sighash')).toBe(native.getFunction(name)?.format('sighash'));
    }
    const accept = new Interface(CURRENT_SLIPPAGE_DEX_ACCEPT_ABI);
    for (const name of ['acceptFastPool', 'acceptPrivateSwapV1']) {
      expect(accept.getFunction(name)?.format('sighash')).toBe(native.getFunction(name)?.format('sighash'));
    }
    expect(new Interface(CURRENT_CHEAP_DEX_QUOTE_ABI).getFunction('quoteFastPoolV1')).not.toBeNull();
    expect(new Interface(CURRENT_DEX_ACCEPT_ABI).getFunction('acceptFastPool')).toBeNull();
  });

  it.each(['fast-pool', 'cheap-async'] as const)('roundtrips contract-encoded %s terms and binds tolerance', profile => {
    for (const bps of [0, 1, 50, 9999, 10000]) {
      const f = issueFixture(profile, bps);
      expect(decodeCurrentDexQuoteIssue(f)).toMatchObject({ operationId: 7n, quoteProtocol: 'quote-slippage', toleranceBps: bps });
      const name = profile === 'fast-pool' ? 'quoteFastPool' : 'quoteCheapAsync';
      expect(codec.encodeFunctionData(name, codec.decodeFunctionData(name, f.expected.calldata))).toBe(f.expected.calldata);
      const changed = issueFixture(profile, bps); changed.expected.toleranceBps = bps === 10000 ? 0 : bps + 1;
      expect(() => decodeCurrentDexQuoteIssue(changed)).toThrow('submitted terms');
    }
    for (const invalid of [-1, 10001, NaN, Infinity, 0.5]) {
      const f = issueFixture(profile); f.expected.toleranceBps = invalid;
      expect(() => decodeCurrentDexQuoteIssue(f)).toThrow('tolerance');
    }
    const unbound = issueFixture(profile);
    expect(() => decodeCurrentDexQuoteIssue({ ...unbound, expected: { ...unbound.expected, toleranceBps: undefined } })).toThrow('tolerance');
    expect(() => decodeCurrentDexQuoteIssue({ ...unbound, quoteProtocol: undefined })).toThrow('tolerance');
    expect(() => decodeCurrentDexQuoteIssue({ ...unbound, quoteProtocol: undefined,
      expected: { ...unbound.expected, toleranceBps: undefined } })).toThrow();
    for (const change of [
      (f: typeof unbound) => { f.transaction.data += '00'; f.expected.calldata = f.transaction.data; },
      (f: typeof unbound) => { f.expected.deadline++; },
      (f: typeof unbound) => { f.transaction.chainId = 1n; },
      (f: typeof unbound) => { f.receipt.logs.push(f.receipt.logs[0]); },
      (f: typeof unbound) => { f.receipt.status = 0; },
      (f: typeof unbound) => { f.expected.destination = addr(4); }
    ]) { const f = issueFixture(profile); change(f); expect(() => decodeCurrentDexQuoteIssue(f)).toThrow(); }
  });

  it('keeps the exact percentage domain and initial 0.5% without floating-point rounding', () => {
    expect(parseCurrentDexSlippagePercent(DEFAULT_CURRENT_DEX_SLIPPAGE_PERCENT)).toBe(50);
    // Exhaustive finite domain; no new random-test dependency is needed.
    for (let bps = 0; bps <= 10000; bps++) {
      expect(parseCurrentDexSlippagePercent(`${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, '0')}`)).toBe(bps);
    }
    for (const invalid of ['', '-0.5', '+0.5', '.5', '00.5', '0.001', '100.01', '1e-2', 'NaN', 'Infinity', '1,5']) {
      expect(() => parseCurrentDexSlippagePercent(invalid)).toThrow('Slippage');
    }
  });

  it.each(['fast-pool', 'cheap-async'] as const)('reviews %s without a guessed hard price and encodes only unsigned new acceptance', async profile => {
    const f = reviewFixture(profile);
    expect(buildCurrentDexQuoteReview(f).summaryRows.map(row => row.label)).toEqual(['You pay', 'You receive', 'Average price']);
    const result = await prepareCurrentDexAcceptance({ ...f, now: () => 99n,
      readReceipt: async () => structuredClone(f.receipt), confirm: async () => {
        f.intent.toleranceBps = 10000; f.intent.operationId = 9n; return true;
      } });
    expect(result).toMatchObject({ readyToSign: false, operationId: 7n, data: native.encodeFunctionData(
      profile === 'fast-pool' ? 'acceptFastPool' : 'acceptPrivateSwapV1', [7n, hash(5)]) });
    const failures = [
      (f: ReturnType<typeof reviewFixture>) => { f.intent.minimumInput++; },
      (f: ReturnType<typeof reviewFixture>) => { f.intent.minimumOutput++; },
      (f: ReturnType<typeof reviewFixture>) => { f.intent.rateNumerator = 1n; },
      (f: ReturnType<typeof reviewFixture>) => { f.intent.rateDenominator = 0n; },
      (f: ReturnType<typeof reviewFixture>) => { f.receipt.amounts.refund--; },
      (f: ReturnType<typeof reviewFixture>) => { f.receipt.operation.contextHash = hash(6); },
      (f: ReturnType<typeof reviewFixture>) => { f.intent.toleranceBps = 10001; }
    ];
    for (const change of failures) { const v = reviewFixture(profile); change(v); expect(() => buildCurrentDexQuoteReview(v)).toThrow(); }
    const v = reviewFixture(profile);
    expect(() => buildCurrentDexQuoteReview({ ...v, intent: { ...v.intent, quoteProtocol: undefined } })).toThrow('tolerance');
    expect(() => buildCurrentDexQuoteReview({ ...v, intent: { ...v.intent, quoteProtocol: undefined, toleranceBps: undefined } })).toThrow('minimum price');
    await expect(prepareCurrentDexAcceptance({ ...v, now: () => 99n, readReceipt: async () => v.receipt,
      confirm: async () => { v.receipt.amounts.actualInput++; return true; } })).rejects.toThrow();
  });
});
