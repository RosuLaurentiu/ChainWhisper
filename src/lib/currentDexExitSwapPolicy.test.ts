import { describe, expect, it, vi } from 'vitest';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE as current } from './currentDexExitCandidate';
import { STAGED_NATIVE_DEX_CANDIDATE as historical, type CurrentCheapDexIdentity } from './dexV2Deployment';
import { assertCurrentNativeSwapIntent } from './currentDexNativeSwapPolicy';
import type { CurrentCheapDexPreparedQuote } from './currentDexSubmission';
import { createCurrentAttemptBoundary, currentCheapDexGasCaps, CURRENT_NATIVE_FIXED_GAS_PRICE,
  CURRENT_NATIVE_RECOVERY_RESERVE } from './currentDexSubmission';
import { CURRENT_EXIT_SWAP_GAS_CAPS, CURRENT_EXIT_SWAP_FIXED_GAS_PRICE, currentSwapFixedGasPrice } from './currentDexExitSwapPolicy';
import { STAGED_D06_DEX_CANDIDATE } from './currentDexC1Candidate';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as history } from './currentDexHistoryCandidate';
import { encodeCurrentDexQuoteRequest } from './currentDexOperation';
import { CURRENT_SLIPPAGE_DEX_ACCEPT_ABI } from './currentDexQuoteReview';
import { Interface } from '@coti-io/coti-ethers';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Technical intent checks only. The real hold is tested in the native policy
// and sender-resource suites. This isolated mock grants no wallet capability.
vi.mock('./currentDexC1SwapPolicy', async original => ({
  ...await original<typeof import('./currentDexC1SwapPolicy')>(), assertCurrentD06AppAuthority: () => {}
}));
const prepared = (maximumInput = 20_000_000n, candidate: CurrentCheapDexIdentity = current): CurrentCheapDexPreparedQuote => ({ intent: {
  candidate, quoteProtocol: 'quote-slippage', toleranceBps: 50, maximumInput,
  minimumInput: 0n, minimumOutput: 0n, rateNumerator: 0n, rateDenominator: 1n, deadline: 1000n
} } as unknown as CurrentCheapDexPreparedQuote);

describe('b2aa test-token swap intent bounds', () => {
  it('accepts the tested 20M raw-unit ceiling', () => {
    expect(() => assertCurrentNativeSwapIntent(prepared(), 100n)).not.toThrow();
  });
  it.each([0n, 20_000_001n, 20n * 10n ** 18n])('rejects input outside its tested raw-unit scope (%s)', maximum => {
    expect(() => assertCurrentNativeSwapIntent(prepared(maximum), 100n)).toThrow('finite profile');
  });
  it.each(['tolerance', 'lifetime', 'expiry', 'minimum'] as const)('rejects b2aa %s drift', fault => {
    const p = prepared(), intent = { ...p.intent };
    if (fault === 'tolerance') intent.toleranceBps = 51;
    if (fault === 'lifetime') intent.deadline = 1001n;
    if (fault === 'expiry') intent.deadline = 100n;
    if (fault === 'minimum') intent.minimumInput = 20_000_001n;
    expect(() => assertCurrentNativeSwapIntent({ ...p, intent }, 100n)).toThrow('finite profile');
  });
  it('preserves the separate historical input scope', () => {
    expect(() => assertCurrentNativeSwapIntent(prepared(100n * 10n ** 18n, historical), 100n)).not.toThrow();
  });
});

function sender(profile: 'fast-pool' | 'cheap-async', phase: 'quote' | 'accept' | 'cancel' | 'recover') {
  const owner = `0x${'22'.repeat(20)}`, hash = `0x${'33'.repeat(32)}`, context = `0x${'44'.repeat(32)}`;
  const wide = { ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature: `0x${'11'.repeat(65)}` };
  const data = phase === 'quote' ? encodeCurrentDexQuoteRequest({ profile, quoteProtocol: 'quote-slippage', toleranceBps: 50,
    inputToken: current.tokens[0][0], outputToken: current.tokens[1][0], destination: owner, deadline: 200n,
    maximumInput: wide, minimumInput: wide, minimumOutput: wide,
    minimumRateNumerator: { ciphertext: 1n, signature: wide.signature }, minimumRateDenominator: { ciphertext: 1n, signature: wide.signature } })
    : phase === 'accept' ? new Interface(CURRENT_SLIPPAGE_DEX_ACCEPT_ABI).encodeFunctionData(profile === 'fast-pool' ? 'acceptFastPool' : 'acceptPrivateSwapV1', [1n, context])
      : new Interface(['function cancelSwap(uint256)', 'function recoverSwap(uint256)']).encodeFunctionData(phase === 'cancel' ? 'cancelSwap' : 'recoverSwap', [1n]);
  const cap = phase === 'quote' || phase === 'accept' ? CURRENT_EXIT_SWAP_GAS_CAPS[profile][phase] : CURRENT_EXIT_SWAP_GAS_CAPS['cheap-async'][phase];
  const head = { number: 10n, hash, timestamp: 100n, gasLimit: 120_000_000n };
  const records = new Map<string, string>(), storage = { getItem: (key: string) => records.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { records.set(key, value); }), removeItem: vi.fn((key: string) => { records.delete(key); }) };
  const transport = { assertCurrent: vi.fn(), readHead: vi.fn(async () => head), readNonce: vi.fn(async () => 4),
    readNativeResources: vi.fn(async () => ({ owner, chainId: 7082400n, head, latestNonce: 4, pendingNonce: 4,
      baseFeePerGas: 1n, gasPrice: CURRENT_EXIT_SWAP_FIXED_GAS_PRICE, balance: CURRENT_NATIVE_RECOVERY_RESERVE + cap * CURRENT_EXIT_SWAP_FIXED_GAS_PRICE, code: '0x' })),
    estimateGas: vi.fn(async (): Promise<bigint> => phase === 'accept' && profile === 'cheap-async' || phase === 'cancel' || phase === 'recover' ? 12_000_000n : 44_000_000n),
    send: vi.fn(async (request: { chainId: bigint; from: string; to: string; value: 0n; data: string; gasLimit: bigint }) => ({ ...request, hash })),
    waitForReceipt: vi.fn(async () => null), readBlockHash: vi.fn(async () => hash), readTransaction: vi.fn(async () => null) };
  const signing = vi.fn(), boundary = createCurrentAttemptBoundary({ c: current, core: current.core, owner, chainId: 7082400n,
    transport, storage, historical: false, now: () => 100n, attest: vi.fn() });
  return { head, storage, transport, signing, send: (gasCap = cap) => boundary.sendCurrent(phase,
    { chainId: 7082400n, from: owner, to: current.core, value: 0n, data }, 200n, vi.fn(), signing,
    phase === 'cancel' || phase === 'recover' ? 1n : undefined, gasCap) };
}

describe('b2aa technical user sender with the hold mocked only in this suite', () => {
  it('keeps current Fast caps consistent with its shared accounting profile without granting authority', () => {
    expect(currentCheapDexGasCaps(history)['fast-pool']).toEqual(CURRENT_EXIT_SWAP_GAS_CAPS['fast-pool']);
  });
  it('selects 52M only for b2aa and keeps historical fa71/d06 at 50M', () => {
    expect(currentSwapFixedGasPrice(current)).toBe(52_000_000n);
    expect(currentSwapFixedGasPrice(historical)).toBe(CURRENT_NATIVE_FIXED_GAS_PRICE);
    expect(currentSwapFixedGasPrice(STAGED_D06_DEX_CANDIDATE)).toBe(CURRENT_NATIVE_FIXED_GAS_PRICE);
  });
  it('binds user phase caps to the exact accepted producer manifests and journals', () => {
    const base = new URL('../../../ChainWhisper Contracts V2/validation/candidates/shared-core-exit-preview-native-2026-10-07/', import.meta.url);
    const evidence = [
      ['async-eligible-native/partial13/native-1/', 'b40f56f748c0aabea84b8af6a11541582b3afd16042baa2b24837ee9e654554b', '06f643af1cff9cc7cdd59cdb34ceb81899a3fdd2b8192613aa45236a98d4054a', [['async13-issue', 110_000_000n], ['async13-accept', 35_000_000n]]],
      ['async-eligible-native/stale16/native-1/', '6eecf96babb1435283378f4947ebec62618d3bc1985b1ab513a4856eeba6270d', 'd652bbd0d34259c4340225eace92085c5653f07790b2ea8724884f571728c8d9', [['async16-cancel', 30_000_000n]]],
      ['async-funded-recovery-v9/recovery-1/', 'a9f88a0902f38c2d72551fa4397a3e84b0a416b334f0056d3dbf0fd9290c6eb7', 'fbb2271ffcbeeda9cfed7ecf0f73f79cb07b27079e91a8e718acb411b5949447', [['async11-direct-recover', 50_000_000n]]],
      ['c1-service/automatic-native-1/', '7d9878a896673a71c36bf69ab97e8e4575378d6e9726a6015c03ee0e2cb4bc8c', 'b7a038498db9a14dd05b6e052c5ea36e5e987fbe47ade8eb186aeaaecb0b6312', [['auto-0-fast-quote', 110_000_000n], ['auto-0-fast-accept', 110_000_000n], ['auto-1-fast-quote', 110_000_000n], ['auto-1-fast-accept', 110_000_000n]]]
    ] as const;
    for (const [path, manifestHash, journalHash, phases] of evidence) {
      const raw = readFileSync(new URL(`${path}manifest.json`, base));
      expect(createHash('sha256').update(raw).digest('hex')).toBe(manifestHash);
      expect(createHash('sha256').update(readFileSync(new URL(`${path}journal.jsonl`, base))).digest('hex')).toBe(journalHash);
      const manifest = JSON.parse(raw.toString()) as { graph: string; core: string; steps: { name: string; gas: string }[] };
      expect(manifest.graph).toBe(current.graph); expect(manifest.core.toLowerCase()).toBe(current.core);
      for (const [name, cap] of phases) expect(BigInt(manifest.steps.find(step => step.name === name)!.gas)).toBe(cap);
    }
    expect(CURRENT_EXIT_SWAP_GAS_CAPS).toEqual({ 'fast-pool': { quote: 110_000_000n, accept: 110_000_000n },
      'cheap-async': { quote: 110_000_000n, accept: 35_000_000n, cancel: 30_000_000n, recover: 50_000_000n } });
  });
  it('selects exact b2aa caps and rejects candidate identity changes', () => {
    expect(currentCheapDexGasCaps(current)).toBe(CURRENT_EXIT_SWAP_GAS_CAPS);
    expect(() => currentCheapDexGasCaps({ ...current, packageSha256: '00' })).toThrow('identity changed');
  });
  it.each([['fast-pool', 'quote'], ['fast-pool', 'accept'], ['cheap-async', 'quote'], ['cheap-async', 'accept'], ['cheap-async', 'cancel'], ['cheap-async', 'recover']] as const)('uses exact resources and cap for %s %s', async (profile, phase) => {
    const f = sender(profile, phase); await f.send();
    expect(f.transport.readNativeResources).toHaveBeenCalledTimes(2);
    expect(f.transport.readNativeResources.mock.invocationCallOrder[0]).toBeLessThan(f.transport.estimateGas.mock.invocationCallOrder[0]);
    expect(f.transport.estimateGas).toHaveBeenCalledWith(expect.objectContaining({ nonce: 4, gasPrice: 52_000_000n }));
    expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({ nonce: 4, gasPrice: 52_000_000n }), expect.any(Function));
    expect(f.signing).toHaveBeenCalledOnce(); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['fee', 'reserve', 'final-fee', 'final-reserve', 'override'] as const)('rejects b2aa %s drift at its fixed 52M fee', async fault => {
    const f = sender('cheap-async', 'accept'), resources = await f.transport.readNativeResources();
    f.transport.readNativeResources.mockClear();
    const change = () => { if (fault.includes('fee')) resources.baseFeePerGas = CURRENT_EXIT_SWAP_FIXED_GAS_PRICE + 1n; else resources.balance--; return resources; };
    if (fault.startsWith('final-')) f.transport.readNativeResources.mockResolvedValueOnce({ ...resources }).mockImplementation(async () => change());
    else if (fault === 'override') f.transport.send.mockImplementationOnce(async request => ({ ...request, gasPrice: 50_000_000n, hash: `0x${'33'.repeat(32)}` }));
    else f.transport.readNativeResources.mockResolvedValue(change());
    await expect(f.send()).rejects.toThrow(fault === 'override' ? 'gasPrice' : 'resources');
    if (fault !== 'override') { expect(f.storage.setItem).not.toHaveBeenCalled(); expect(f.signing).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled(); }
  });
  it('requires the complete 10M block reserve for a signed 110M user phase', async () => {
    const f = sender('cheap-async', 'quote'); f.head.gasLimit = 119_999_999n;
    await expect(f.send()).rejects.toThrow('gas headroom'); expect(f.storage.setItem).not.toHaveBeenCalled();
  });
  it.each([0n, 50_000_001n, 100_000_000n])('retains strict native estimate admission (%s)', async estimate => {
    const f = sender('fast-pool', 'accept'); f.transport.estimateGas.mockResolvedValue(estimate);
    await expect(f.send()).rejects.toThrow('estimate'); expect(f.storage.setItem).not.toHaveBeenCalled();
  });
  it('rejects a blanket 110M cap for async Accept', async () => {
    const f = sender('cheap-async', 'accept'); await expect(f.send(110_000_000n)).rejects.toThrow('phase gas cap changed');
    expect(f.transport.estimateGas).not.toHaveBeenCalled(); expect(f.storage.setItem).not.toHaveBeenCalled();
  });
  it('retains 25 percent plus 1M estimate padding under the exact async Accept cap', async () => {
    const f = sender('cheap-async', 'accept'); f.transport.estimateGas.mockResolvedValue(28_000_000n);
    await expect(f.send()).rejects.toThrow('estimate'); expect(f.storage.setItem).not.toHaveBeenCalled();
  });
  it('requires fresh exact native resources before estimation', async () => {
    const f = sender('cheap-async', 'quote'); f.transport.readNativeResources.mockRejectedValue(new Error('resources unavailable'));
    await expect(f.send()).rejects.toThrow('resources unavailable');
    expect(f.transport.estimateGas).not.toHaveBeenCalled(); expect(f.storage.setItem).not.toHaveBeenCalled();
  });
});
