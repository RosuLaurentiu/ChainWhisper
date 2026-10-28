import { Interface, keccak256 } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import { CURRENT_DEX_OPEN_ABI } from './currentDexOperation';
import { CURRENT_DEX_ACCEPT_ABI, prepareCurrentDexAcceptance } from './currentDexQuoteReview';

const admissionVerifier = vi.hoisted(() => ({ admitted: new WeakSet<object>() }));
const issuedVerifier = vi.hoisted(() => ({ issued: new WeakSet<object>() }));
const sharedVerifier = vi.hoisted(() => ({ issued: new WeakMap<object, object>() }));
vi.mock('../features/wallet/currentDexQuoteCapability', () => ({
  assertCurrentSharedPoolIssuedQuote: (value: unknown, signer: object) => {
    if (!value || typeof value !== 'object' || sharedVerifier.issued.get(value) !== signer) throw new Error('Wrong owner wallet session');
  },
  assertCurrentDexIssuedQuote: (value: unknown) => {
    if (!value || typeof value !== 'object' || !issuedVerifier.issued.has(value)) throw new Error('Unissued quote');
  }
}));
vi.mock('./currentDexSubmissionAdmission', async importOriginal => {
  const actual = await importOriginal<typeof import('./currentDexSubmissionAdmission')>();
  return { ...actual, verifyCurrentDexSubmissionAdmission: (value: unknown) =>
    Boolean(value && typeof value === 'object' && admissionVerifier.admitted.has(value)) };
});

import {
  CURRENT_DEX_SUBMISSION_CANDIDATE_SHA256,
  CURRENT_DEX_SUBMISSION_SOURCES_SHA256,
  CURRENT_DEX_SUBMISSION_VERSION,
  createCurrentDexSubmissionAdapter,
  createCurrentSharedPoolSubmissionAdapter,
  createCurrentCheapDexSubmissionAdapter,
  type CurrentDexIssuedQuote,
  type CurrentDexPreparedAcceptance,
  type CurrentDexPreparedQuote,
  type CurrentDexSubmissionAdmission,
  type CurrentDexSubmissionTransport
} from './currentDexSubmission';
import { CURRENT_CHEAP_DEX_CANDIDATE, CURRENT_SHARED_POOL_CANDIDATE } from './dexV2Deployment';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY } from './currentDexPendingAttempt';

const principal = `0x${'11'.repeat(20)}`, core = `0x${'22'.repeat(20)}`;
const inputToken = `0x${'33'.repeat(20)}`, outputToken = `0x${'44'.repeat(20)}`;
const other = `0x${'99'.repeat(20)}`;
const hash = `0x${'55'.repeat(32)}`, contextHash = `0x${'66'.repeat(32)}`;
const quoteHash = `0x${'77'.repeat(32)}`, acceptHash = `0x${'88'.repeat(32)}`;
const open = new Interface(CURRENT_DEX_OPEN_ABI), accept = new Interface(CURRENT_DEX_ACCEPT_ABI);
const quoteData = open.encodeFunctionData('openSinglePassSwapV2', [inputToken, outputToken, principal, 200n,
  [[1n, 2n], '0x' + '01'.repeat(65)], [[7n, 8n], '0x' + '07'.repeat(65)], [[3n, 4n], '0x' + '02'.repeat(65)],
  [5n, '0x' + '03'.repeat(65)], [6n, '0x' + '04'.repeat(65)]]);
const acceptanceData = (operationId: bigint, currentContextHash: string) =>
  accept.encodeFunctionData('acceptPrivateSwapV1', [operationId, currentContextHash]);
const acceptData = acceptanceData(7n, contextHash);
const trusted = <T extends object>(value: T): T => { issuedVerifier.issued.add(value); return value; };

const issued = (operationId = 7n, currentContextHash = contextHash): CurrentDexIssuedQuote => {
  const snapshot = ({
  operationId, chainId: 7082400n, core, runtimeHash: hash, epochId: 1n, releaseId: hash,
  deadline: 200n, transactionHash: quoteHash,
  block: { number: 50n, hash }, originBlock: { number: 50n, hash }, readyToSign: false,
  operation: { phase: 'quote-prepared', status: 2, releaseReason: 0, quotePrepared: true, funded: false,
    contextHash: currentContextHash, epochId: 1n, deadline: 200n, fixedCursor: 8n, stageRevision: 30n },
  intent: { chainId: 7082400n, principal, core, inputToken, outputToken, destination: principal,
    runtimeHash: hash, releaseId: hash, operationId, contextHash: currentContextHash, deadline: 200n,
    maximumInput: 500n, minimumInput: 250n, minimumOutput: 300n, rateNumerator: 3n, rateDenominator: 4n }
  } as unknown as CurrentDexIssuedQuote);
  return trusted(Object.assign(snapshot, { readCurrent: vi.fn(async () => snapshot) }));
};

const prepared = (readIssue = vi.fn(async () => issued())): CurrentDexPreparedQuote => ({
  chainId: 7082400n, from: principal, to: core, value: 0n, data: quoteData, readyToSign: false,
  graph: {}, manifestHash: hash, block: { number: 40n, hash, timestamp: 90n },
  intent: { chainId: 7082400n, principal, core, inputToken, outputToken, destination: principal,
    runtimeHash: hash, releaseId: hash, deadline: 200n, maximumInput: 500n, minimumInput: 250n, minimumOutput: 300n,
    rateNumerator: 3n, rateDenominator: 4n }, readIssue
} as unknown as CurrentDexPreparedQuote);

const acceptance = (operationId = 7n, currentContextHash = contextHash): CurrentDexPreparedAcceptance => ({
  chainId: 7082400n, from: principal, to: core, value: 0n,
  data: acceptanceData(operationId, currentContextHash), readyToSign: false, operationId, contextHash: currentContextHash
});

const admission = <Phase extends 'quote' | 'accept'>(phase: Phase, data: string) => {
  const value = Object.freeze({ evidence: Object.freeze({
    version: CURRENT_DEX_SUBMISSION_VERSION,
    candidateSha256: CURRENT_DEX_SUBMISSION_CANDIDATE_SHA256,
    sourcesSha256: CURRENT_DEX_SUBMISSION_SOURCES_SHA256,
    chainId: 7082400n, principal, core, manifestHash: hash, runtimeHash: hash, releaseId: hash,
    inputToken, outputToken, tokenPolicyHash: keccak256('0x01'), phase, callHash: keccak256(data),
    authorizationHash: keccak256(phase === 'quote' ? '0x02' : '0x05'),
    native: Object.freeze({ evidenceHash: keccak256(phase === 'quote' ? '0x03' : '0x04'),
      gasUsed: phase === 'quote' ? 100n : 50n, gasLimit: phase === 'quote' ? 150n : 80n })
  }) }) as unknown as CurrentDexSubmissionAdmission<Phase>;
  admissionVerifier.admitted.add(value);
  return value;
};

const transportFixture = () => {
  let nextHash = quoteHash, current = true;
  const assertCurrent = vi.fn(() => { if (!current) throw new Error('Session revoked'); });
  const transport: CurrentDexSubmissionTransport = {
    assertCurrent,
    estimateGas: vi.fn(async request => request.data === quoteData ? 120n : 60n),
    send: vi.fn(async request => ({ ...request, hash: nextHash })),
    waitForReceipt: vi.fn(async transactionHash => ({ hash: transactionHash, status: 1, from: principal, to: core }))
  };
  return { transport, setHash: (value: string) => { nextHash = value; }, revoke: () => { current = false; } };
};

describe('current DEX asynchronous submission adapter', () => {
  it('rejects a copied or fabricated issued quote before review or signing', async () => {
    const fixture = transportFixture(), forged = { ...issued() } as CurrentDexIssuedQuote;
    const prepare = vi.fn(async () => ({ prepared: acceptance(), admission: admission('accept', acceptData) }));
    await expect(createCurrentDexSubmissionAdapter({ quoteAdmission: admission('quote', quoteData),
      transport: fixture.transport, now: () => 100n }).submitAcceptance({ issued: forged, prepare }))
      .rejects.toThrow('Unissued quote');
    expect(prepare).not.toHaveBeenCalled();
    expect(fixture.transport.send).not.toHaveBeenCalled();
  });

  it('waits for a fresh READY operation and rejects stale, released, or changed state', async () => {
    for (const fault of ['ready', 'open', 'released', 'context', 'minimum-input', 'wallet', 'changed-after-estimate']) {
      const fixture = transportFixture(), ready = issued();
      const refresh = vi.fn(async () => {
        if (fault === 'wallet') fixture.revoke();
        if (fault === 'open') return opened;
        if (fault === 'released' || (fault === 'changed-after-estimate' && refresh.mock.calls.length > 2)) {
          return trusted({ ...ready, operation: { ...ready.operation, status: 4, releaseReason: 1, phase: 'released' } } as CurrentDexIssuedQuote);
        }
        if (fault === 'context') return trusted({ ...ready, operation: { ...ready.operation,
          contextHash: `0x${'99'.repeat(32)}` } } as CurrentDexIssuedQuote);
        if (fault === 'minimum-input') return trusted({ ...ready, intent: { ...ready.intent,
          minimumInput: ready.intent.minimumInput + 1n } } as CurrentDexIssuedQuote);
        return ready;
      });
      const opened = trusted({ ...ready, operation: { ...ready.operation, status: 1, quotePrepared: false,
        phase: 'preparing-quote', stageRevision: 0n }, readCurrent: refresh } as CurrentDexIssuedQuote);
      const adapter = createCurrentDexSubmissionAdapter({ quoteAdmission: admission('quote', quoteData),
        transport: fixture.transport, now: () => 100n });
      const prepare = vi.fn(async (current: CurrentDexIssuedQuote) => {
        expect(current.operation.status).toBe(2);
        return { prepared: acceptance(), admission: admission('accept', acceptData) };
      });
      const result = adapter.submitAcceptance({ issued: opened, prepare });
      if (fault === 'ready') await expect(result).resolves.toMatchObject({ operationId: 7n });
      else await expect(result).rejects.toThrow();
      expect(prepare).toHaveBeenCalledTimes(['ready', 'changed-after-estimate'].includes(fault) ? 1 : 0);
      expect(fixture.transport.send).toHaveBeenCalledTimes(fault === 'ready' ? 1 : 0);
    }
  });

  it('discovers different mined identities before each separately authorized acceptance', async () => {
    for (const mined of [issued(), issued(12n, `0x${'12'.repeat(32)}`)]) {
      const fixture = transportFixture(), readIssue = vi.fn(async () => mined);
      const quoteAdmission = admission('quote', quoteData);
      expect(quoteAdmission.evidence).not.toHaveProperty('operationId');
      expect(quoteAdmission.evidence).not.toHaveProperty('contextHash');
      expect(quoteAdmission.evidence.native).not.toHaveProperty('callHash');
      const adapter = createCurrentDexSubmissionAdapter({ quoteAdmission, transport: fixture.transport, now: () => 100n });
      const quote = await adapter.submitQuote(prepared(readIssue));
      expect(quote.request).toMatchObject({ chainId: 7082400n, from: principal, to: core, data: quoteData, gasLimit: 150n });
      const recovered = await quote.recover();
      expect(recovered.operationId).toBe(mined.operationId);
      expect(readIssue).toHaveBeenCalledWith(quoteHash);

      fixture.setHash(acceptHash);
      const reviewed = acceptance(recovered.operationId, recovered.operation.contextHash);
      const accepted = await adapter.submitAcceptance({ issued: recovered, prepare: async () => ({
        prepared: reviewed, admission: admission('accept', reviewed.data)
      }) });
      expect(accepted?.request).toMatchObject({ data: reviewed.data, gasLimit: 80n });
      expect(await accepted?.recover()).toEqual({ operationId: mined.operationId, transactionHash: acceptHash,
        status: 'settlement-pending' });
      expect(fixture.transport.send).toHaveBeenCalledTimes(2);
    }
  });

  it('rejects caller-created evidence and complete Quote or Accept calldata changes', async () => {
    const fixture = transportFixture();
    const fake = { evidence: admission('quote', quoteData).evidence } as unknown as CurrentDexSubmissionAdmission<'quote'>;
    const untrusted = createCurrentDexSubmissionAdapter({ quoteAdmission: fake, transport: fixture.transport, now: () => 100n });
    expect(untrusted.readyToSign).toBe(false);
    await expect(untrusted.submitQuote(prepared())).rejects.toThrow('not admitted');

    const wrongQuote = prepared() as unknown as { data: string } & CurrentDexPreparedQuote;
    wrongQuote.data = open.encodeFunctionData('openSinglePassSwapV2', [inputToken, outputToken, principal, 200n,
      [[9n, 2n], '0x' + '01'.repeat(65)], [[7n, 8n], '0x' + '07'.repeat(65)], [[3n, 4n], '0x' + '02'.repeat(65)],
      [5n, '0x' + '03'.repeat(65)], [6n, '0x' + '04'.repeat(65)] ]);
    const quoteAdapter = createCurrentDexSubmissionAdapter({ quoteAdmission: admission('quote', quoteData), transport: fixture.transport, now: () => 100n });
    await expect(quoteAdapter.submitQuote(wrongQuote)).rejects.toThrow('admitted quote call');

    const wrongMinimumInput = prepared() as unknown as { data: string } & CurrentDexPreparedQuote;
    wrongMinimumInput.data = open.encodeFunctionData('openSinglePassSwapV2', [inputToken, outputToken, principal, 200n,
      [[1n, 2n], '0x' + '01'.repeat(65)], [[9n, 8n], '0x' + '07'.repeat(65)], [[3n, 4n], '0x' + '02'.repeat(65)],
      [5n, '0x' + '03'.repeat(65)], [6n, '0x' + '04'.repeat(65)]]);
    await expect(quoteAdapter.submitQuote(wrongMinimumInput)).rejects.toThrow('admitted quote call');

    const wrongAccept = accept.encodeFunctionData('acceptPrivateSwapV1', [99n, `0x${'99'.repeat(32)}`]);
    const acceptAdapter = createCurrentDexSubmissionAdapter({ quoteAdmission: admission('quote', quoteData), transport: fixture.transport, now: () => 100n });
    await expect(acceptAdapter.submitAcceptance({ issued: issued(), prepare: async () => ({
      prepared: { ...acceptance(), data: wrongAccept }, admission: admission('accept', acceptData)
    }) }))
      .rejects.toThrow('admitted acceptance call');
    expect(fixture.transport.send).not.toHaveBeenCalled();
  });

  it('rejects phase confusion and authority for another mined operation', async () => {
    const quoteFixture = transportFixture();
    const wrongQuotePhase = createCurrentDexSubmissionAdapter({
      quoteAdmission: admission('accept', quoteData) as unknown as CurrentDexSubmissionAdmission<'quote'>,
      transport: quoteFixture.transport, now: () => 100n
    });
    expect(wrongQuotePhase.readyToSign).toBe(false);
    await expect(wrongQuotePhase.submitQuote(prepared())).rejects.toThrow('candidate or phase');

    const acceptFixture = transportFixture();
    const adapter = createCurrentDexSubmissionAdapter({
      quoteAdmission: admission('quote', quoteData), transport: acceptFixture.transport, now: () => 100n
    });
    await expect(adapter.submitAcceptance({ issued: issued(), prepare: async () => ({
      prepared: acceptance(),
      admission: admission('quote', acceptData) as unknown as CurrentDexSubmissionAdmission<'accept'>
    }) })).rejects.toThrow('candidate or phase');

    const otherContext = `0x${'99'.repeat(32)}`;
    const otherCall = acceptanceData(99n, otherContext);
    await expect(adapter.submitAcceptance({ issued: issued(), prepare: async () => ({
      prepared: acceptance(99n, otherContext), admission: admission('accept', otherCall)
    }) })).rejects.toThrow('does not match the mined quote');
    expect(quoteFixture.transport.send).not.toHaveBeenCalled();
    expect(acceptFixture.transport.send).not.toHaveBeenCalled();
  });

  it('reserves the full Accept identity before review so concurrent callers send exactly once', async () => {
    const fixture = transportFixture();
    const adapter = createCurrentDexSubmissionAdapter({ quoteAdmission: admission('quote', quoteData), transport: fixture.transport, now: () => 100n });
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = adapter.submitAcceptance({ issued: issued(), prepare: async () => {
      enter(); await gate; return { prepared: acceptance(), admission: admission('accept', acceptData) };
    } });
    await entered;
    await expect(adapter.submitAcceptance({ issued: issued(), prepare: async () => ({
      prepared: acceptance(), admission: admission('accept', acceptData)
    }) })).rejects.toThrow('already submitted');
    release();
    await expect(first).resolves.toMatchObject({ operationId: 7n });
    expect(fixture.transport.send).toHaveBeenCalledOnce();
  });

  it('rechecks Quote and Accept expiry after review and estimation before any signing request', async () => {
    for (const action of ['quote-estimate', 'accept-review', 'accept-estimate'] as const) {
      let currentTime = 100n;
      const fixture = transportFixture();
      if (action.endsWith('estimate')) {
        (fixture.transport.estimateGas as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
          currentTime = 200n; return 60n;
        });
      }
      const adapter = createCurrentDexSubmissionAdapter({ quoteAdmission: admission('quote', quoteData), transport: fixture.transport, now: () => currentTime });
      if (action === 'quote-estimate') {
        await expect(adapter.submitQuote(prepared())).rejects.toThrow('expired');
      } else {
        await expect(adapter.submitAcceptance({ issued: issued(), prepare: async () => {
          if (action === 'accept-review') currentTime = 200n;
          return { prepared: acceptance(), admission: admission('accept', acceptData) };
        } })).rejects.toThrow('active admitted plan');
      }
      expect(fixture.transport.send, action).not.toHaveBeenCalled();
    }
  });

  it('rechecks the owner lease and immutable request after awaited estimation', async () => {
    const revoked = transportFixture();
    (revoked.transport.estimateGas as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { revoked.revoke(); return 120n; });
    await expect(createCurrentDexSubmissionAdapter({ quoteAdmission: admission('quote', quoteData), transport: revoked.transport, now: () => 100n })
      .submitQuote(prepared())).rejects.toThrow('Session revoked');
    expect(revoked.transport.send).not.toHaveBeenCalled();

    const changed = transportFixture(), source = prepared() as unknown as { data: string } & CurrentDexPreparedQuote;
    (changed.transport.estimateGas as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      source.data = open.encodeFunctionData('openSinglePassSwapV2', [inputToken, outputToken, other, 200n,
        [[1n, 2n], '0x' + '01'.repeat(65)], [[7n, 8n], '0x' + '07'.repeat(65)], [[3n, 4n], '0x' + '02'.repeat(65)],
        [5n, '0x' + '03'.repeat(65)], [6n, '0x' + '04'.repeat(65)]]);
      return 120n;
    });
    await expect(createCurrentDexSubmissionAdapter({ quoteAdmission: admission('quote', quoteData), transport: changed.transport, now: () => 100n })
      .submitQuote(source)).rejects.toThrow('changed before submission');
    expect(changed.transport.send).not.toHaveBeenCalled();

    const reviewRevoked = transportFixture();
    await expect(createCurrentDexSubmissionAdapter({ quoteAdmission: admission('quote', quoteData), transport: reviewRevoked.transport, now: () => 100n })
      .submitAcceptance({ issued: issued(), prepare: async () => {
        reviewRevoked.revoke(); return { prepared: acceptance(), admission: admission('accept', acceptData) };
      } }))
      .rejects.toThrow('Session revoked');
    expect(reviewRevoked.transport.send).not.toHaveBeenCalled();

    const acceptChanged = transportFixture();
    const acceptSource = acceptance() as unknown as { data: string } & CurrentDexPreparedAcceptance;
    (acceptChanged.transport.estimateGas as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      acceptSource.data = accept.encodeFunctionData('acceptPrivateSwapV1', [99n, `0x${'99'.repeat(32)}`]);
      return 60n;
    });
    await expect(createCurrentDexSubmissionAdapter({ quoteAdmission: admission('quote', quoteData), transport: acceptChanged.transport, now: () => 100n })
      .submitAcceptance({ issued: issued(), prepare: async () => ({
        prepared: acceptSource, admission: admission('accept', acceptData)
      }) })).rejects.toThrow('does not match');
    expect(acceptChanged.transport.send).not.toHaveBeenCalled();
  });

  it('releases definite pre-sign failures but keeps uncertain post-sign work reserved for recovery', async () => {
    const cancelled = transportFixture();
    const cancelledAdapter = createCurrentDexSubmissionAdapter({ quoteAdmission: admission('quote', quoteData), transport: cancelled.transport, now: () => 100n });
    await expect(cancelledAdapter.submitAcceptance({ issued: issued(), prepare: async () => null })).resolves.toBeNull();
    await expect(cancelledAdapter.submitAcceptance({ issued: issued(), prepare: async () => ({
      prepared: acceptance(), admission: admission('accept', acceptData)
    }) })).resolves.toMatchObject({ operationId: 7n });
    expect(cancelled.transport.send).toHaveBeenCalledOnce();

    const preflight = transportFixture();
    (preflight.transport.estimateGas as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Estimate unavailable'));
    const preflightAdapter = createCurrentDexSubmissionAdapter({ quoteAdmission: admission('quote', quoteData), transport: preflight.transport, now: () => 100n });
    await expect(preflightAdapter.submitQuote(prepared())).rejects.toThrow('Estimate unavailable');
    await expect(preflightAdapter.submitQuote(prepared())).resolves.toMatchObject({ transactionHash: quoteHash });

    const interrupted = transportFixture();
    (interrupted.transport.send as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Wallet response interrupted'));
    const interruptedAdapter = createCurrentDexSubmissionAdapter({ quoteAdmission: admission('quote', quoteData), transport: interrupted.transport, now: () => 100n });
    const review = async () => ({ prepared: acceptance(), admission: admission('accept', acceptData) });
    await expect(interruptedAdapter.submitAcceptance({ issued: issued(), prepare: review })).rejects.toThrow('interrupted');
    await expect(interruptedAdapter.submitAcceptance({ issued: issued(), prepare: review })).rejects.toThrow('already submitted');
    expect(interrupted.transport.send).toHaveBeenCalledOnce();
  });

  it('rejects invalid plans, gas, receipts, and changed review terms without another spend', async () => {
    const expired = transportFixture();
    await expect(createCurrentDexSubmissionAdapter({ quoteAdmission: admission('quote', quoteData), transport: expired.transport, now: () => 200n })
      .submitQuote(prepared())).rejects.toThrow('expired');

    const gas = transportFixture();
    (gas.transport.estimateGas as ReturnType<typeof vi.fn>).mockResolvedValueOnce(151n);
    await expect(createCurrentDexSubmissionAdapter({ quoteAdmission: admission('quote', quoteData), transport: gas.transport, now: () => 100n })
      .submitQuote(prepared())).rejects.toThrow('gas');

    const receipt = transportFixture();
    (receipt.transport.waitForReceipt as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const quote = await createCurrentDexSubmissionAdapter({ quoteAdmission: admission('quote', quoteData), transport: receipt.transport, now: () => 100n })
      .submitQuote(prepared());
    await expect(quote.recover()).rejects.toThrow('did not confirm');

    expect(expired.transport.send).not.toHaveBeenCalled();
    expect(gas.transport.send).not.toHaveBeenCalled();

    const intent = issued().intent;
    const base = { chainId: intent.chainId, core, principal, runtimeHash: hash, releaseId: hash, operationId: 7n,
      block: { number: 50n, hash, timestamp: 100n }, kind: 'quote' as const, operation: issued().operation,
      amounts: { filled: true, maximumInput: 500n, actualInput: 400n, refund: 100n,
        grossOutput: 303n, fee: 3n, netOutput: 300n } };
    const args = { intent, input: { symbol: 'IN', decimals: 6 }, output: { symbol: 'OUT', decimals: 6 },
      now: () => 101n, confirm: async () => true };
    await expect(prepareCurrentDexAcceptance({ ...args,
      readReceipt: async () => ({ ...base, amounts: { ...base.amounts, filled: false } }) } as never)).rejects.toThrow('Quote accounting does not match');
    await expect(prepareCurrentDexAcceptance({ ...args, readReceipt: async () => base } as never)).resolves.toMatchObject({ operationId: 7n });
    const changed = vi.fn().mockResolvedValueOnce(base).mockResolvedValueOnce({
      ...base, amounts: { ...base.amounts, netOutput: 301n, grossOutput: 304n } });
    await expect(prepareCurrentDexAcceptance({ ...args, readReceipt: changed } as never)).rejects.toThrow('changed during review');
  });
});

describe('current shared-Pool owner release sender', () => {
  const candidate = CURRENT_SHARED_POOL_CANDIDATE;
  const owner = principal;
  const operationContext = `0x${'ab'.repeat(32)}`;
  const txHash = `0x${'cd'.repeat(32)}`;
  const actionInterface = new Interface(['function cancelSwap(uint256)', 'function recoverSwap(uint256)']);
  const fixture = (status = 1, cursor = 0n, time = 100n) => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); } } });
    const signer = {}, lease = { active: true };
    const operation = { status, fixedCursor: cursor, contextHash: operationContext, epochId: 9n,
      deadline: 200n, canonicalMarketId: 7n, marketRevision: 3n, registryRevision: 2n };
    const issued = { operationId: 7n, principal: owner, chainId: 7082400n, core: candidate.core,
      runtimeHash: candidate.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2],
      releaseId: candidate.releaseId, transactionHash: quoteHash,
      originBlock: { number: 20n, hash }, operation, intent: { principal: owner },
      readCurrent: vi.fn() };
    issued.readCurrent.mockImplementation(async () => issued);
    sharedVerifier.issued.set(issued, signer);
    const sent = { current: null as null | { hash: string; chainId: bigint; from: string; to: string;
      value: bigint; data: string; nonce: number; blockNumber: number; blockHash: string } };
    const transport = {
      assertCurrent: vi.fn(() => { if (!lease.active) throw new Error('Session revoked'); }),
      readHead: vi.fn(async () => ({ number: 30n, hash, timestamp: time, gasLimit: 150_000_000n })),
      readNonce: vi.fn(async () => 4), readBlockHash: vi.fn(async () => hash),
      estimateGas: vi.fn(async () => 80_000n),
      send: vi.fn(async request => { sent.current = { ...request, hash: txHash, blockNumber: 30, blockHash: hash };
        return { ...request, hash: txHash }; }),
      readTransaction: vi.fn(async () => sent.current),
      waitForReceipt: vi.fn(async () => ({ hash: txHash, status: 1, from: owner,
        to: candidate.core, blockNumber: 30, blockHash: hash, logs: [] }))
    };
    const readOperation = vi.fn(async () => ({ operation: { ...operation, status: 4 } }));
    const make = (currentSigner = signer) => createCurrentSharedPoolSubmissionAdapter({
      signer: currentSigner, ownerAddress: owner, chainId: 7082400n, transport,
      attest: vi.fn(async () => {}), readOperation, reviewAcceptance: vi.fn(async () => null), now: () => time
    });
    return { issued: issued as unknown as CurrentDexIssuedQuote, signer, lease, transport, readOperation,
      make, values, sent };
  };
  it('requires exact owner, eligible state, consent and lease before a cancel send', async () => {
    const f = fixture(), adapter = f.make();
    await expect(adapter.submitCurrentOwnerAction({ issued: { ...f.issued }, action: 'cancel',
      confirm: async () => true })).rejects.toThrow('Wrong owner wallet session');
    const mutable = f.issued as unknown as { runtimeHash: string };
    const savedRuntime = mutable.runtimeHash;
    mutable.runtimeHash = hash;
    await expect(adapter.submitCurrentOwnerAction({ issued: f.issued, action: 'cancel',
      confirm: async () => true })).rejects.toThrow('owner operation changed');
    mutable.runtimeHash = savedRuntime;
    await expect(adapter.submitCurrentOwnerAction({ issued: f.issued, action: 'cancel',
      confirm: async () => false })).resolves.toBeNull();
    f.transport.estimateGas.mockImplementationOnce(async () => { f.lease.active = false; return 80_000n; });
    await expect(adapter.submitCurrentOwnerAction({ issued: f.issued, action: 'cancel',
      confirm: async () => true })).rejects.toThrow('Session revoked');
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBeUndefined();
    vi.unstubAllGlobals();
    for (const [status, cursor] of [[1, 1n], [3, 0n], [4, 0n]] as const) {
      const bad = fixture(status, cursor);
      await expect(bad.make().submitCurrentOwnerAction({ issued: bad.issued, action: 'cancel',
        confirm: async () => true })).rejects.toThrow('not eligible');
      expect(bad.transport.send).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });
  it.each(['limit-owner', 'token-faucet', 'token-approve'])('preserves %s attempts and refuses both swap recovery readers', async phase => {
    const f = fixture();
    const record = { version: 1, chainId: '7082400', owner: owner.toLowerCase(),
      core: candidate.core.toLowerCase(), graph: `0x${candidate.graph}`.toLowerCase(),
      phase, callHash: hash, nonce: 4, txHash: null };
    f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify(record));
    await expect(f.make().recoverPendingCurrentAttempt()).rejects.toThrow('owner-action pending-attempt reader');
    const cheap = createCurrentCheapDexSubmissionAdapter({ signer: f.signer, ownerAddress: owner,
      chainId: 7082400n, transport: f.transport, attest: async () => {},
      readOperation: async () => { throw new Error('No swap read is permitted'); },
      readReceipt: async () => { throw new Error('No swap read is permitted'); },
      reviewAcceptance: async () => null, requireFunding: async () => {} });
    f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify({ ...record,
      core: CURRENT_CHEAP_DEX_CANDIDATE.core.toLowerCase(),
      graph: `0x${CURRENT_CHEAP_DEX_CANDIDATE.graph}`.toLowerCase() }));
    await expect(cheap.recoverPendingCurrentCheapAttempt()).rejects.toThrow('owner-action pending-attempt reader');
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({ phase, nonce: 4 });
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(f.transport.readTransaction).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('sends one confirmed action, keeps the nonce reserved, and reconciles it after reload', async () => {
    const f = fixture(), adapter = f.make();
    const result = await adapter.submitCurrentOwnerAction({ issued: f.issued, action: 'cancel',
      confirm: async () => true });
    expect(result?.request.data).toBe(actionInterface.encodeFunctionData('cancelSwap', [7n]));
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({
      phase: 'cancel', operationId: '7', nonce: 4, txHash });
    await expect(adapter.submitCurrentOwnerAction({ issued: f.issued, action: 'cancel',
      confirm: async () => true })).rejects.toThrow('pending attempt');
    const afterReload = f.make({});
    await expect(afterReload.recoverPendingCurrentAttempt()).resolves.toMatchObject({
      status: 'observed-mined', phase: 'cancel', operationId: 7n, operation: { status: 4 } });
    expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBeUndefined();
    expect(f.transport.send).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
  it('checks recover eligibility through fresh estimation and reconciles a reverted receipt', async () => {
    const f = fixture(2, 8n, 210n), adapter = f.make();
    const result = await adapter.submitCurrentOwnerAction({ issued: f.issued, action: 'recover',
      confirm: async () => true });
    expect(result?.request.data).toBe(actionInterface.encodeFunctionData('recoverSwap', [7n]));
    f.transport.waitForReceipt.mockResolvedValue({ hash: txHash, status: 0, from: owner,
      to: candidate.core, blockNumber: 30, blockHash: hash, logs: [] });
    await expect(result?.recover()).rejects.toThrow('did not confirm');
    await expect(adapter.recoverPendingCurrentAttempt()).resolves.toMatchObject({
      status: 'observed-reverted', phase: 'recover' });
    expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBeUndefined();
    await expect(adapter.submitCurrentOwnerAction({ issued: f.issued, action: 'recover',
      confirm: async () => true })).resolves.toMatchObject({ status: 'release-pending' });
    expect(f.transport.send).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
    const notStale = fixture(2, 8n, 100n);
    notStale.transport.estimateGas.mockRejectedValueOnce(new Error('InvalidWork'));
    await expect(notStale.make().submitCurrentOwnerAction({ issued: notStale.issued, action: 'recover',
      confirm: async () => true })).rejects.toThrow('InvalidWork');
    expect(notStale.transport.send).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
