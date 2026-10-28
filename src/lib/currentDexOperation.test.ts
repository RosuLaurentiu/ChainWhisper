import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Interface, keccak256, type Eip1193Provider } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import { CURRENT_DEX_OPERATION_ABI, CURRENT_SHARED_POOL_OPERATION_ABI, CURRENT_DEX_RECEIPT_ABI, decodeCurrentDexOperation, encodeCurrentDexOperationRead, encodeCurrentDexReceiptRead } from './currentDexOperation';
import { createDexV2ReadCapability, readCurrentDexPrincipalReceipt, readCurrentDexIssuedQuote } from './dexV2Chain';
import { CURRENT_DEX_ACCEPT_ABI } from './currentDexQuoteReview';
import { CURRENT_DEX_OPEN_ABI, decodeCurrentDexQuoteIssue } from './currentDexOperation';
import { CURRENT_CHEAP_DEX_QUOTE_ABI, CURRENT_CHEAP_DEX_OPERATION_ABI, CURRENT_FAST_DEX_RECEIPT_ABI,
  decodeCurrentCheapDexOperation, type CurrentCheapDexProfile } from './currentDexOperation';
import { ARCHIVED_CHEAP_DEX_CANDIDATE } from './dexV2Deployment';

const frozen = createRequire(import.meta.url)('../../../ChainWhisper Contracts V2/validation/candidates/direct-limit-match-2026-09-30/current-integration/current-async-adverse/native-accept-boundary.cjs').frozen();

const iface = new Interface(CURRENT_DEX_OPERATION_ABI);
const receipts = new Interface(CURRENT_DEX_RECEIPT_ABI);
const encryptedAmount = [[111n, 222n], [333n, 444n]];
const receiptData = receipts.encodeFunctionResult('principalReceipt', [[[11n, 22n], ...Array(6).fill(encryptedAmount)]]);
const context = `0x${'12'.repeat(32)}`;
const data = (status: number, quote = false, funded = false, reason = 0) =>
  iface.encodeFunctionResult('operationPublic', [[quote, funded, context, status, reason, 1n, 100n, 2n, 3n]]);

describe('current DEX public operation codec', () => {
  it('binds both cheap profiles to the frozen 04ea ABI and actual storage paths', () => {
    expect(frozen.identity).toMatchObject({ graph: '04ea108dd247d39d1158a0c441ddd9119efe05de5c9217b38c2a3d048944c1fc',
      package: 'c7a2afd6c6dcd9b72129dfc62fb5285965e83cf547ac1ca972ed8b6d56a3a7ad',
      core: '0xa2b718d9F3F086e9eecEe9015Dcb037F7a10B0E7', runtime: '0xd6e128469ccd62aae45ada2cbf86f9e4aeb9916011b489623f756689b6bfed73' });
    for (const [abi, names] of [[CURRENT_CHEAP_DEX_QUOTE_ABI, ['quoteFastPoolV1', 'quoteCheapAsyncV1']],
      [CURRENT_CHEAP_DEX_OPERATION_ABI, ['fastPoolQuotePublic', 'cheapAsyncPublic']],
      [CURRENT_FAST_DEX_RECEIPT_ABI, ['fastPoolPrincipalReceipt']]] as const) {
      const codec = new Interface(abi);
      for (const name of names) {
        const actual = codec.getFunction(name)!, native = frozen.core.getFunction(name);
        expect(actual.format('sighash')).toBe(native.format('sighash'));
        expect(actual.outputs.map(x => x.format('sighash'))).toEqual(native.outputs.map((x: { format: (format: string) => string }) => x.format('sighash')));
      }
    }
    const opening = new Interface(CURRENT_CHEAP_DEX_QUOTE_ABI);
    for (const name of ['FastPoolQuoteIssued', 'CheapAsyncAdvanced']) expect(opening.getEvent(name)?.format('full')).toBe(frozen.core.getEvent(name).format('full'));
    const lifecycle = frozen.c.info.input.sources['contracts/dex/ChainWhisperDexOperationLifecycle.sol'].content;
    expect(lifecycle).toContain('emit FastPoolQuoteIssued(quoteId,context,request.deadline)');
    expect(lifecycle).toContain('emit CheapAsyncAdvanced(operationId,uint8(plan.stage),bytes32(0))');
  });

  it.each(['fast-pool', 'cheap-async'] as const)('authenticates exact %s issue terms and its own event', profile => {
    const core = frozen.identity.core, principal = `0x${'22'.repeat(20)}`;
    const inputToken = `0x${'33'.repeat(20)}`, outputToken = `0x${'44'.repeat(20)}`;
    const h = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
    const opening = new Interface(CURRENT_CHEAP_DEX_QUOTE_ABI);
    const terms = [inputToken, outputToken, principal, 100n, [[1n, 2n], '0x12'], [[7n, 8n], '0x9a'], [[3n, 4n], '0x34'], [5n, '0x56'], [6n, '0x78']];
    const encode = (mode: CurrentCheapDexProfile) => opening.encodeFunctionData(mode === 'fast-pool' ? 'quoteFastPoolV1' : 'quoteCheapAsyncV1', mode === 'fast-pool' ? terms : [terms]);
    const eventName = profile === 'fast-pool' ? 'FastPoolQuoteIssued' : 'CheapAsyncAdvanced';
    const event = () => ({ address: core, ...opening.encodeEventLog(opening.getEvent(eventName)!, profile === 'fast-pool' ? [7n, context, 100n] : [7n, 1, h(0)]) });
    const fixture = () => ({ profile,
      expected: { transactionHash: h(1), chainId: 7082400n, core, principal, calldata: encode(profile), inputToken, outputToken, destination: principal, deadline: 100n, releaseId: h(3) },
      transaction: { hash: h(1), chainId: 7082400n, from: principal, to: core as string | null, data: encode(profile), value: 0n, blockNumber: 50 as number | null, blockHash: h(2) as string | null },
      receipt: { hash: h(1), from: principal, to: core as string | null, status: 1 as number | null, blockNumber: 50, blockHash: h(2), logs: [event()] }
    });
    expect(decodeCurrentDexQuoteIssue(fixture())).toMatchObject({ operationId: 7n, deadline: 100n });
    expect(decodeCurrentDexQuoteIssue(fixture())).not.toHaveProperty('epochId');
    const mutations: Array<(f: ReturnType<typeof fixture>) => void> = [
      f => { f.transaction.hash = h(8); }, f => { f.receipt.hash = h(8); }, f => { f.transaction.chainId = 1n; },
      f => { f.transaction.from = core; }, f => { f.receipt.from = core; }, f => { f.transaction.to = principal; }, f => { f.receipt.to = null; },
      f => { f.transaction.value = 1n; }, f => { f.receipt.status = 0; }, f => { f.receipt.status = null; },
      f => { f.transaction.blockNumber = null; }, f => { f.transaction.blockHash = h(8); },
      f => { f.transaction.data += '00'; f.expected.calldata = f.transaction.data; },
      f => { f.expected.inputToken = outputToken; }, f => { f.expected.outputToken = inputToken; },
      f => { f.expected.destination = core; }, f => { f.expected.deadline++; },
      f => { f.receipt.logs = []; }, f => { f.receipt.logs.push(event()); },
      f => { f.receipt.logs[0].address = principal; }, f => { f.receipt.logs[0].data += '00'; },
      f => { f.receipt.logs[0].topics.push(h(8)); },
      f => { f.transaction.data = f.expected.calldata = encode(profile === 'fast-pool' ? 'cheap-async' : 'fast-pool'); },
      f => { f.receipt.logs = [{ address: core, ...opening.encodeEventLog(opening.getEvent(eventName)!, profile === 'fast-pool' ? [0n, context, 100n] : [0n, 1, h(0)]) }]; },
      f => { f.receipt.logs = [{ address: core, ...opening.encodeEventLog(opening.getEvent(eventName)!, profile === 'fast-pool' ? [7n, h(0), 100n] : [7n, 4, context]) }]; }
    ];
    for (const mutate of mutations) { const f = fixture(); mutate(f); expect(() => decodeCurrentDexQuoteIssue(f)).toThrow(); }
    const old = fixture(); delete (old as { profile?: string }).profile;
    expect(() => decodeCurrentDexQuoteIssue(old)).toThrow();
  });

  it('uses the frozen 04ea stages and preserves the Fast consumed-state limit', () => {
    const abi = new Interface(CURRENT_CHEAP_DEX_OPERATION_ABI), zero = `0x${'00'.repeat(32)}`;
    const asyncData = (stage: number, ctx = stage >= 4 ? context : zero) => abi.encodeFunctionResult('cheapAsyncPublic', [stage, ctx, stage === 0 ? 0n : 100n]);
    const phases = ['not-found', 'preparing-quote', 'preparing-quote', 'preparing-quote', 'quote-prepared', 'settling', 'settled', 'released'];
    phases.forEach((phase, stage) => expect(decodeCurrentCheapDexOperation(asyncData(stage), 99n, 'cheap-async', ARCHIVED_CHEAP_DEX_CANDIDATE).phase).toBe(phase));
    expect(decodeCurrentCheapDexOperation(asyncData(7, zero), 99n, 'cheap-async', ARCHIVED_CHEAP_DEX_CANDIDATE).phase).toBe('released');
    for (const stage of [1, 4, 5]) expect(decodeCurrentCheapDexOperation(asyncData(stage), 100n, 'cheap-async', ARCHIVED_CHEAP_DEX_CANDIDATE).phase).toBe('expired-unrecovered');
    for (const raw of [asyncData(8), asyncData(1, context), asyncData(4, zero), asyncData(4) + '00']) expect(() => decodeCurrentCheapDexOperation(raw, 99n, 'cheap-async', ARCHIVED_CHEAP_DEX_CANDIDATE)).toThrow();
    const fast = (ready: boolean) => abi.encodeFunctionResult('fastPoolQuotePublic', [context, 100n, ready]);
    expect(decodeCurrentCheapDexOperation(fast(true), 99n, 'fast-pool').phase).toBe('quote-prepared');
    expect(decodeCurrentCheapDexOperation(fast(true), 100n, 'fast-pool').phase).toBe('expired-unrecovered');
    expect(decodeCurrentCheapDexOperation(fast(false), 101n, 'fast-pool').phase).toBe('consumed-unverified');
    expect(decodeCurrentCheapDexOperation(fast(false), 101n, 'fast-pool')).not.toHaveProperty('funded');
  });
  it('matches the deployed shared-Pool Core operation and private receipt ABI', () => {
    const native = new Interface(frozen.artifacts.ChainWhisperDexCore.abi), shared = new Interface(CURRENT_SHARED_POOL_OPERATION_ABI);
    expect(shared.getFunction('operationPublic')?.format('full')).toBe(native.getFunction('operationPublic')?.format('full'));
    expect(receipts.getFunction('principalReceipt')?.outputs.map(x => x.format('sighash')))
      .toEqual(native.getFunction('principalReceipt')?.outputs.map(x => x.format('sighash')));
    const raw = shared.encodeFunctionResult('operationPublic', [[true, false, context, 2, 0, 9n, 100n, 8n, 30n, 7n, 3n, 2n]]);
    expect(decodeCurrentDexOperation(raw, 99n, 'shared-pool')).toMatchObject({ phase: 'quote-prepared',
      canonicalMarketId: 7n, marketRevision: 3n, registryRevision: 2n });
    for (const index of [9, 10, 11]) {
      const fields = [true, false, context, 2, 0, 9n, 100n, 8n, 30n, 7n, 3n, 2n];
      fields[index] = 0n;
      expect(() => decodeCurrentDexOperation(shared.encodeFunctionResult('operationPublic', [fields]), 99n, 'shared-pool')).toThrow();
    }
    expect(() => decodeCurrentDexOperation(data(2, true), 99n, 'shared-pool')).toThrow();
  });
  it('reuses guarded reads and rejects identity, reorg and session changes', async () => {
    const core = `0x${'11'.repeat(20)}`, blockHash = `0x${'22'.repeat(32)}`, releaseId = `0x${'33'.repeat(32)}`;
    const release = new Interface(['function releaseId() view returns(bytes32)']);
    const expected = { core, blockHash, releaseId, chainId: 7082400n, blockNumber: 50n, runtimeHash: keccak256('0x6000') };
    for (const fault of ['', 'chain', 'runtime', 'release', 'reorg', 'session', 'malformed', 'receipt-session', 'receipt-malformed', 'receipt-reorg', 'not-ready']) {
      let blockReads = 0, chainReads = 0, current = true;
      const requests: string[] = [];
      const provider: Pick<Eip1193Provider, 'request'> = { request: async ({ method, params }) => {
        requests.push(method);
        if (method === 'eth_chainId') return fault === 'chain' && ++chainReads > 1 ? '0x1' : '0x6c11a0';
        if (method === 'eth_getBlockByNumber') {
          expect(params).toEqual(['0x32', false]);
          blockReads++;
          return { number: '0x32', timestamp: '0x63', hash: (fault === 'reorg' && blockReads > 1) || (fault === 'receipt-reorg' && blockReads > 2) ? releaseId : blockHash };
        }
        if (method === 'eth_getCode') {
          expect(params).toEqual([core, { blockHash, requireCanonical: true }]);
          return fault === 'runtime' ? '0x6001' : '0x6000';
        }
        if (method === 'eth_call') {
          const [call, selector] = params as [{ to: string; data: string }, unknown];
          expect(call.to).toBe(core);
          expect(selector).toEqual({ blockHash, requireCanonical: true });
          if (call.data === release.encodeFunctionData('releaseId')) return release.encodeFunctionResult('releaseId', [fault === 'release' ? blockHash : releaseId]);
          if (call.data === encodeCurrentDexReceiptRead(7n)) {
            expect(call).toMatchObject({ from: core });
            if (fault === 'receipt-session') current = false;
            return fault === 'receipt-malformed' ? '0x' : receiptData;
          }
          expect(call.data).toBe(encodeCurrentDexOperationRead(7n));
          if (fault === 'session') current = false;
          return fault === 'malformed' ? '0x' : data(fault === 'not-ready' ? 1 : 2, fault !== 'not-ready');
        }
        throw new Error('Unexpected RPC method');
      } };
      const capability = createDexV2ReadCapability({ provider, chainId: 7082400n, assertCurrent: () => {
        if (!current) throw new Error('Session revoked');
      } });
      const pending = readCurrentDexPrincipalReceipt({ capability, expected, operationId: 7n, principal: core });
      if (fault) await expect(pending).rejects.toThrow();
      else {
        const snapshot = await pending;
        expect(snapshot.operation.phase).toBe('quote-prepared');
        expect(snapshot.block).toEqual({ number: 50n, hash: blockHash, timestamp: 99n });
        expect(snapshot.operationId).toBe(7n);
        expect(snapshot.kind).toBe('quote');
        expect(snapshot.encrypted.filled).toBe(22n);
        expect(snapshot.encrypted.netOutput).toEqual({ ciphertextHigh: 333n, ciphertextLow: 444n });
      }
      expect(requests.every(method => ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'].includes(method))).toBe(true);
    }
  });

  it('keeps retained reads but uses the new minimum-input Open ABI', () => {
    const root = '../ChainWhisper Contracts V2/validation/candidates/recurring-linked-limits/2026-09-12T14-52-23-720Z-owner-policy/';
    const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    const resultBytes = readFileSync(root + 'result.json');
    expect(sha(resultBytes)).toBe('8f629796995885e09983c6e502b2a7e96d93ce61b542da55362777147057f4c8');
    const bytes = readFileSync(root + 'artifacts.json');
    expect(sha(bytes)).toBe(JSON.parse(resultBytes.toString()).files['artifacts.json']);
    const native = new Interface(JSON.parse(bytes.toString()).ChainWhisperDexCore.abi);
    const opening = new Interface(CURRENT_DEX_OPEN_ABI);
    expect(opening.getFunction('openSinglePassSwapV2')?.format('full')).not.toBe(native.getFunction('openSinglePassSwapV2')?.format('full'));
    expect(opening.getFunction('openSinglePassSwapV2')?.inputs.map(input => input.name)).toEqual([
      'inputToken', 'outputToken', 'destination', 'deadline', 'encryptedMaximumInput',
      'encryptedMinimumInput', 'encryptedMinimumOutput', 'encryptedMinimumRateNumerator',
      'encryptedMinimumRateDenominator']);
    expect(opening.getEvent('WorkIssued')?.format('full')).toBe(native.getEvent('WorkIssued')?.format('full'));
    expect(new Interface(CURRENT_DEX_ACCEPT_ABI).getFunction('acceptPrivateSwapV1')?.format('full')).toBe(native.getFunction('acceptPrivateSwapV1')?.format('full'));
    expect(iface.getFunction('operationPublic')?.format('full')).toBe(native.getFunction('operationPublic')?.format('full'));
    expect(receipts.getFunction('principalReceipt')?.format('sighash')).toBe(native.getFunction('principalReceipt')?.format('sighash'));
    expect(receipts.getFunction('principalReceipt')?.outputs.map(x => x.format('sighash'))).toEqual(native.getFunction('principalReceipt')?.outputs.map(x => x.format('sighash')));
    expect(encodeCurrentDexOperationRead((1n << 256n) - 1n)).toBe(native.encodeFunctionData('operationPublic', [(1n << 256n) - 1n]));
  });

  it('distinguishes quote, funding, expiry and terminal states without claiming a fill', () => {
    expect(decodeCurrentDexOperation(data(0), 99n).phase).toBe('not-found');
    for (const status of [1, 2]) expect(decodeCurrentDexOperation(data(status), 99n).phase).toBe('preparing-quote');
    expect(decodeCurrentDexOperation(data(2, true), 99n).phase).toBe('quote-prepared');
    expect(decodeCurrentDexOperation(data(2, true, true), 99n).phase).toBe('settling');
    for (const funded of [false, true]) expect(decodeCurrentDexOperation(data(2, true, funded), 100n).phase).toBe('expired-unrecovered');
    expect(decodeCurrentDexOperation(data(3, true, true), 101n).phase).toBe('settled');
    for (const reason of [1, 2, 3]) expect(decodeCurrentDexOperation(data(4, true, true, reason), 101n).releaseReason).toBe(reason);
    expect(decodeCurrentDexOperation(data(2, true), 99n).contextHash).toBe(context);
  });

  it('takes the quote ID only from the exact submitted Core transaction and event', async () => {
    const opening = new Interface(CURRENT_DEX_OPEN_ABI), h = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
    const core = `0x${'11'.repeat(20)}`, principal = `0x${'22'.repeat(20)}`;
    const inputToken = `0x${'33'.repeat(20)}`, outputToken = `0x${'44'.repeat(20)}`;
    const calldata = opening.encodeFunctionData('openSinglePassSwapV2', [inputToken, outputToken, principal, 100n,
      [[1n, 2n], '0x12'], [[7n, 8n], '0x9a'], [[3n, 4n], '0x34'], [5n, '0x56'], [6n, '0x78']]);
    const event = (id = 7n, epoch = 9n, release = h(3), deadline = 100n) => ({ address: core,
      ...opening.encodeEventLog(opening.getEvent('WorkIssued')!, [id, epoch, release, deadline]) });
    const fixture = () => ({
      expected: { transactionHash: h(1), chainId: 7082400n, core, principal, calldata, inputToken, outputToken,
        destination: principal, deadline: 100n, releaseId: h(3) },
      transaction: { hash: h(1), chainId: 7082400n, from: principal, to: core as string | null,
        data: calldata, value: 0n, blockNumber: 50 as number | null, blockHash: h(2) as string | null },
      receipt: { hash: h(1), from: principal, to: core as string | null, status: 1 as number | null,
        blockNumber: 50, blockHash: h(2), logs: [event()] }
    });
    const valid = fixture();
    valid.receipt.logs.unshift({ ...event(99n), address: principal });
    const issued = decodeCurrentDexQuoteIssue(valid);
    expect(issued).toEqual({ operationId: 7n, epochId: 9n, deadline: 100n, releaseId: h(3),
      transactionHash: h(1), block: { number: 50n, hash: h(2) } });
    expect(Object.isFrozen(issued)).toBe(true);
    expect(issued).not.toHaveProperty('contextHash');
    expect(encodeCurrentDexOperationRead(issued.operationId)).toBe(iface.encodeFunctionData('operationPublic', [7n]));
    const mutations: Array<(f: ReturnType<typeof fixture>) => void> = [
      f => { f.transaction.hash = h(8); }, f => { f.receipt.hash = h(8); },
      f => { f.transaction.chainId = 1n; }, f => { f.transaction.from = core; },
      f => { f.receipt.from = core; }, f => { f.transaction.to = principal; },
      f => { f.receipt.to = null; }, f => { f.transaction.value = 1n; },
      f => { f.receipt.status = 0; }, f => { f.receipt.status = null; },
      f => { f.transaction.blockNumber = null; }, f => { f.transaction.blockHash = h(8); },
      f => { f.receipt.blockNumber = Number.MAX_SAFE_INTEGER + 1; },
      f => { f.transaction.data = '0x12345678'; },
      f => { f.transaction.data += '00'; f.expected.calldata = f.transaction.data; },
      f => { f.expected.inputToken = outputToken; }, f => { f.expected.outputToken = inputToken; },
      f => { f.expected.destination = core; }, f => { f.expected.deadline++; },
      f => { f.expected.releaseId = h(8); }, f => { f.receipt.logs = []; },
      f => { f.receipt.logs.push(event()); }, f => { f.receipt.logs = [event(0n)]; },
      f => { f.receipt.logs = [event(7n, 0n)]; }, f => { f.receipt.logs = [event(7n, 9n, h(8))]; },
      f => { f.receipt.logs = [event(7n, 9n, h(3), 101n)]; },
      f => { f.receipt.logs[0].data += '00'; }, f => { f.receipt.logs[0].topics.push(h(8)); }
    ];
    for (const mutate of mutations) {
      const f = fixture(); mutate(f);
      expect(() => decodeCurrentDexQuoteIssue(f)).toThrow();
    }
    const legacy = fixture();
    const legacyOpening = new Interface([
      'function openSinglePassSwapV1(address destination,uint256 deadline,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedMaximumInput,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedMinimumOutput,(uint256 ciphertext,bytes signature) encryptedMinimumRateNumerator,(uint256 ciphertext,bytes signature) encryptedMinimumRateDenominator)'
    ]);
    legacy.transaction.data = legacyOpening.encodeFunctionData('openSinglePassSwapV1', [principal, 100n,
      [[1n, 2n], '0x12'], [[3n, 4n], '0x34'], [5n, '0x56'], [6n, '0x78']]);
    legacy.expected.calldata = legacy.transaction.data;
    expect(() => decodeCurrentDexQuoteIssue(legacy)).toThrow();
    const wide = fixture(); wide.receipt.logs = [event((1n << 256n) - 1n)];
    expect(decodeCurrentDexQuoteIssue(wide).operationId).toBe((1n << 256n) - 1n);
    const release = new Interface(['function releaseId() view returns(bytes32)']);
    for (const fault of ['', 'epoch', 'deadline', 'context', 'reorg']) {
      const issue = fixture();
      const provider = { request: async ({ method, params }: { method: string; params?: readonly unknown[] | object }) => {
        if (method === 'eth_chainId') return '0x6c11a0';
        if (method === 'eth_getBlockByNumber') return { number: '0x32', timestamp: '0x63', hash: fault === 'reorg' ? h(8) : h(2) };
        if (method === 'eth_getCode') return '0x6000';
        if (method === 'eth_call') {
          const [call, block] = params as [{ data: string }, unknown];
          expect(block).toEqual({ blockHash: h(2), requireCanonical: true });
          if (call.data === release.encodeFunctionData('releaseId')) return release.encodeFunctionResult('releaseId', [h(3)]);
          expect(call.data).toBe(encodeCurrentDexOperationRead(7n));
          return iface.encodeFunctionResult('operationPublic', [[false, false, fault === 'context' ? h(0) : context,
            1, 0, fault === 'epoch' ? 8n : 9n, fault === 'deadline' ? 101n : 100n, 0n, 0n]]);
        }
        throw new Error('Unexpected RPC');
      } };
      const capability = createDexV2ReadCapability({ chainId: 7082400n, provider, assertCurrent: () => undefined });
      const read = readCurrentDexIssuedQuote({ capability, runtimeHash: keccak256('0x6000'), issue });
      if (fault) await expect(read).rejects.toThrow();
      else {
        const snapshot = await read;
        expect(snapshot.operationId).toBe(7n);
        expect(snapshot.operation.contextHash).toBe(context);
        expect(snapshot.operation.phase).toBe('preparing-quote');
        expect(snapshot.principal).toBe(principal);
      }
    }
  });

  it('rejects invalid IDs, timestamps, status values and flag combinations', () => {
    for (const id of [0n, -1n, 1n << 256n]) expect(() => encodeCurrentDexOperationRead(id)).toThrow();
    expect(() => decodeCurrentDexOperation(data(1), -1n)).toThrow();
    for (const invalid of [data(5), data(2, false, true), data(1, true), data(3), data(4), data(2, true, false, 1), data(4, true, true, 4), '0x']) {
      expect(() => decodeCurrentDexOperation(invalid, 99n)).toThrow();
    }
  });
});
