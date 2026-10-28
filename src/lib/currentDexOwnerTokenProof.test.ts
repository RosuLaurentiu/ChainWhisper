import { Interface } from '@coti-io/coti-ethers';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { PrivateUint256Output } from './privateUint256';
import { describe, expect, it, vi } from 'vitest';
import {
  currentDexOwnerTransferAbi,
  verifyCurrentDexOwnerTokenMovements,
  type CurrentDexOwnerTokenAmounts,
  type CurrentDexOwnerTokenBinding,
  type CurrentDexOwnerTokenLog,
  type CurrentDexOwnerTokenPhase,
  type CurrentDexOwnerTokenReceipt
} from './currentDexOwnerTokenProof';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE as candidate } from './currentDexExitCandidate';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as historyCandidate } from './currentDexHistoryCandidate';

const tokenAddresses = candidate.tokens.map(([token]) => token);
const core = candidate.core;
const owner = '0x00000000000000000000000000000000000000a1';
const other = '0x00000000000000000000000000000000000000b2';
const txHash = `0x${'11'.repeat(32)}`;
const blockHash = `0x${'22'.repeat(32)}`;
const contextHash = `0x${'33'.repeat(32)}`;
const baseAmounts: CurrentDexOwnerTokenAmounts = {
  filled: true, maximumInput: 100n, actualInput: 80n, refund: 20n,
  grossOutput: 50n, fee: 2n, netOutput: 48n
};

type Leg = { token: string; from: string; to: string; envelope: 'senderValue' | 'receiverValue'; amount: bigint };
type RequestOverrides = {
  binding?: Partial<CurrentDexOwnerTokenBinding>;
  receipt?: Partial<CurrentDexOwnerTokenReceipt>;
  amounts?: Partial<CurrentDexOwnerTokenAmounts>;
  phase?: CurrentDexOwnerTokenPhase;
  legs?: Leg[];
  selectedEnvelope?: 'senderValue' | 'receiverValue';
  decrypt?: (value: PrivateUint256Output) => bigint | Promise<bigint>;
  assertCurrent?: () => void | Promise<void>;
  verifyCanonical?: (binding: CurrentDexOwnerTokenBinding, receipt: CurrentDexOwnerTokenReceipt) => Promise<void>;
};

const bindingFor = (inputToken = tokenAddresses[0], outputToken = tokenAddresses[1]): CurrentDexOwnerTokenBinding => ({
  graph: candidate.graph,
  packageSha256: candidate.packageSha256,
  chainId: BigInt(candidate.chainId),
  core,
  owner,
  destination: owner,
  inputToken,
  outputToken,
  operationId: 7n,
  contextHash,
  transactionHash: txHash,
  blockNumber: 9_965_909,
  blockHash
});

const encodeLog = (
  token: string,
  from: string,
  to: string,
  senderAmount: bigint,
  receiverAmount: bigint,
  index: number,
  overrides: Partial<CurrentDexOwnerTokenLog> = {}
): CurrentDexOwnerTokenLog => {
  const encoded = currentDexOwnerTransferAbi.encodeEventLog(
    currentDexOwnerTransferAbi.getEvent('Transfer')!,
    [from, to,
      { ciphertextHigh: 1n, ciphertextLow: senderAmount },
      { ciphertextHigh: 2n, ciphertextLow: receiverAmount }]
  );
  return {
    address: token,
    topics: encoded.topics,
    data: encoded.data,
    index,
    transactionHash: txHash,
    blockNumber: 9_965_909,
    blockHash,
    removed: false,
    ...overrides
  };
};

const legsFor = (
  phase: CurrentDexOwnerTokenPhase,
  binding: CurrentDexOwnerTokenBinding,
  amounts: CurrentDexOwnerTokenAmounts
): Leg[] => {
  const legs: Leg[] = [];
  if (phase === 'accept' || phase === 'fast-settle')
    legs.push({ token: binding.inputToken, from: owner, to: binding.core, envelope: 'senderValue', amount: amounts.maximumInput });
  if (phase === 'terminal' || phase === 'fast-settle') {
    legs.push({ token: binding.outputToken, from: binding.core, to: owner, envelope: 'receiverValue', amount: amounts.netOutput });
    legs.push({ token: binding.inputToken, from: binding.core, to: owner, envelope: 'receiverValue', amount: amounts.refund });
  }
  if (phase === 'recover')
    legs.push({ token: binding.inputToken, from: binding.core, to: owner, envelope: 'receiverValue', amount: amounts.maximumInput });
  return legs;
};

const requestFor = (overrides: RequestOverrides = {}) => {
  const phase = overrides.phase ?? 'fast-settle';
  const binding = { ...bindingFor(), ...overrides.binding } as CurrentDexOwnerTokenBinding;
  const amounts = { ...baseAmounts, ...overrides.amounts } as CurrentDexOwnerTokenAmounts;
  const legs = overrides.legs ?? legsFor(phase, binding, amounts);
  const selected = overrides.selectedEnvelope;
  const logs = legs.map((leg, index) => {
    const selectedSide = selected ?? leg.envelope;
    // The two envelopes always decrypt to different values. A wrong field choice fails.
    const alternate = leg.amount === (1n << 256n) - 1n ? leg.amount - 1n : leg.amount + 1n;
    const senderAmount = selectedSide === 'senderValue' ? leg.amount : alternate;
    const receiverAmount = selectedSide === 'receiverValue' ? leg.amount : alternate;
    return encodeLog(leg.token, leg.from, leg.to, senderAmount, receiverAmount, index);
  });
  const receipt: CurrentDexOwnerTokenReceipt = {
    hash: txHash, status: 1, blockNumber: 9_965_909, blockHash, logs
  };
  const decrypt = overrides.decrypt ?? vi.fn((value: PrivateUint256Output) => BigInt(value.ciphertextLow));
  return {
    binding,
    receipt: { ...receipt, ...overrides.receipt } as CurrentDexOwnerTokenReceipt,
    amounts,
    phase,
    decrypt,
    assertCurrent: overrides.assertCurrent ?? vi.fn(),
    verifyCanonical: overrides.verifyCanonical ?? vi.fn(async () => undefined)
  };
};

const expectRejected = async (request: ReturnType<typeof requestFor>, code?: string) => {
  await expect(verifyCurrentDexOwnerTokenMovements(request)).rejects.toThrow(
    code ? `Owner token proof: ${code}` : 'Owner token proof:'
  );
};

describe('verifyCurrentDexOwnerTokenMovements', () => {
  const newBinding = { graph: historyCandidate.graph, packageSha256: historyCandidate.packageSha256,
    core: historyCandidate.core, chainId: BigInt(historyCandidate.chainId),
    inputToken: historyCandidate.tokens[1][0], outputToken: historyCandidate.tokens[0][0] };
  it.each(['accept', 'terminal', 'fast-settle', 'recover', 'cancel'] as const)('verifies exact new-descriptor %s movements without admission', async phase => {
    const amounts = phase === 'recover' || phase === 'cancel' ?
      { filled: false, actualInput: 0n, refund: 100n, grossOutput: 0n, fee: 0n, netOutput: 0n } : {};
    const request = requestFor({ binding: newBinding, phase, amounts });
    expect(await verifyCurrentDexOwnerTokenMovements(request)).toMatchObject({ phase, operationId: 7n,
      ownerTokenMovementsVerified: true, readyToSign: false, nativeAdmission: false });
    expect(request.verifyCanonical).toHaveBeenCalledTimes(2);
    expect(request.verifyCanonical).toHaveBeenCalledWith(expect.objectContaining(newBinding), expect.anything());
  });
  it.each(['core', 'package', 'graph', 'chain', 'token'] as const)('rejects new-descriptor mixed %s before canonical reads or decryption', async fault => {
    let binding: Partial<CurrentDexOwnerTokenBinding> = { ...newBinding };
    if (fault === 'core') binding = { ...binding, core: candidate.core };
    if (fault === 'package') binding = { ...binding, packageSha256: candidate.packageSha256 };
    if (fault === 'graph') binding = { ...binding, graph: candidate.graph };
    if (fault === 'chain') binding = { ...binding, chainId: 1n };
    if (fault === 'token') binding = { ...binding, inputToken: other };
    const request = requestFor({ binding });
    await expectRejected(request, fault === 'token' ? 'PARTIES' : 'CANDIDATE');
    expect(request.verifyCanonical).not.toHaveBeenCalled();expect(request.decrypt).not.toHaveBeenCalled();
  });
  it('does not cross equal operation IDs between Core receipts', async () => {
    const old = requestFor({ phase: 'terminal' });
    const next = requestFor({ binding: newBinding, phase: 'terminal', receipt: old.receipt });
    expect(next.binding.operationId).toBe(old.binding.operationId);
    await expectRejected(next, 'TRANSFER_SET');
    expect(next.verifyCanonical).not.toHaveBeenCalled();expect(next.decrypt).not.toHaveBeenCalled();
  });
  it.each(['context', 'canonical', 'lease'] as const)('rejects new-candidate %s drift at the trusted boundary', async fault => {
    let canonicalCalls = 0, revoked = false;
    const request = requestFor({ binding: newBinding, phase: 'accept',
      assertCurrent: () => { if (revoked) throw new Error('revoked'); },
      decrypt: async value => { if (fault === 'lease') revoked = true; return BigInt(value.ciphertextLow); },
      verifyCanonical: async b => {
        canonicalCalls++;
        if (fault === 'context' && b.contextHash !== `0x${'44'.repeat(32)}` || fault === 'canonical' && canonicalCalls === 2)
          throw new Error('changed operation or inclusion');
      } });
    await expectRejected(request, fault === 'lease' ? 'SESSION' : 'CANONICAL');
  });
  it('uses the Transfer ABI from the pinned reviewed token artifact', () => {
    const bytes = readFileSync(new URL('../../../ChainWhisper Contracts V2/validation/reports/reviewed-token-admission-2026-09-15/fixed-token-build-1/token.json', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('c3d2ac8d662e549d66c8334e11aeab56338c727f57ce3e36a0a4046919a041e7');
    const actual = new Interface(JSON.parse(bytes.toString()).abi);
    expect(currentDexOwnerTransferAbi.getEvent('Transfer')!.format('full'))
      .toBe(actual.getEvent('Transfer')!.format('full'));
  });
  it('accepts the exact maximum uint256 debit and checks both canonical boundaries', async () => {
    const maximum = (1n << 256n) - 1n;
    const request = requestFor({
      phase: 'accept',
      amounts: { maximumInput: maximum, actualInput: maximum - 4n, refund: 4n }
    });
    const result = await verifyCurrentDexOwnerTokenMovements(request);
    expect(result.ownerTokenMovementsVerified).toBe(true);
    expect(request.verifyCanonical).toHaveBeenCalledTimes(2);
    expect(request.decrypt).toHaveBeenCalledTimes(1);
  });

  it('requires terminal net output and refund transfers, including zero-valued payouts', async () => {
    const zeroRefund = await verifyCurrentDexOwnerTokenMovements(requestFor({
      phase: 'terminal', amounts: { actualInput: 100n, refund: 0n }
    }));
    const zeroOutput = await verifyCurrentDexOwnerTokenMovements(requestFor({
      phase: 'terminal', amounts: { filled: false, actualInput: 0n, refund: 100n, grossOutput: 0n, fee: 0n, netOutput: 0n }
    }));
    expect(zeroRefund.phase).toBe('terminal');
    expect(zeroOutput.phase).toBe('terminal');
    const request = requestFor({ phase: 'terminal' });
    (request.receipt.logs as CurrentDexOwnerTokenLog[]).splice(0, 1);
    await expectRejected(request, 'TRANSFER_SET');
  });

  it('checks all three fast-settle movements', async () => {
    const result = await verifyCurrentDexOwnerTokenMovements(requestFor({ phase: 'fast-settle' }));
    expect(result.phase).toBe('fast-settle');
  });

  it('accepts exact maximum recovery credit and requires cancellation to have no Transfer logs', async () => {
    const maximum = (1n << 256n) - 1n;
    const recovery = await verifyCurrentDexOwnerTokenMovements(requestFor({
      phase: 'recover',
      amounts: { filled: false, maximumInput: maximum, actualInput: 0n, refund: maximum,
        grossOutput: 0n, fee: 0n, netOutput: 0n }
    }));
    expect(recovery.phase).toBe('recover');
    const cancellation = await verifyCurrentDexOwnerTokenMovements(requestFor({
      phase: 'cancel',
      amounts: { filled: false, actualInput: 0n, refund: 100n, grossOutput: 0n, fee: 0n, netOutput: 0n }
    }));
    expect(cancellation.phase).toBe('cancel');
    await expectRejected(requestFor({ phase: 'cancel', amounts: { filled: false, actualInput: 0n,
      refund: 100n, grossOutput: 0n, fee: 0n, netOutput: 0n }, legs: [
      { token: tokenAddresses[0], from: core, to: owner, envelope: 'receiverValue', amount: 100n }
    ] }), 'TRANSFER_SET');
  });

  it('accepts both directions for every distinct pair in the reviewed four-token set', async () => {
    const pairs: [string, string][] = [];
    for (let i = 0; i < tokenAddresses.length; i += 1)
      for (let j = i + 1; j < tokenAddresses.length; j += 1) pairs.push([tokenAddresses[i], tokenAddresses[j]]);
    expect(pairs).toHaveLength(6);
    for (const [left, right] of pairs) {
      for (const [inputToken, outputToken] of [[left, right], [right, left]]) {
        await expect(verifyCurrentDexOwnerTokenMovements(requestFor({
          phase: 'fast-settle', binding: { inputToken, outputToken }
        }))).resolves.toMatchObject({ ownerTokenMovementsVerified: true });
      }
    }
  });

  it('rejects another graph, package, chain, core, principal, token, or destination', async () => {
    const badBindings: Partial<CurrentDexOwnerTokenBinding>[] = [
      { graph: `0x${'44'.repeat(32)}` },
      { packageSha256: `0x${'44'.repeat(32)}` },
      { chainId: 1n },
      { core: other },
      { owner: other },
      { inputToken: other },
      { outputToken: other },
      { destination: other }
    ];
    for (const binding of badBindings) await expectRejected(requestFor({ binding }));
  });

  it('rejects receipt hash, status, block number, and block hash drift', async () => {
    const badReceipts: Partial<CurrentDexOwnerTokenReceipt>[] = [
      { hash: `0x${'44'.repeat(32)}` }, { status: 0 }, { blockNumber: 9_965_910 },
      { blockHash: `0x${'44'.repeat(32)}` }
    ];
    for (const receipt of badReceipts) await expectRejected(requestFor({ receipt }), 'RECEIPT');
  });

  it('rejects removed, foreign, duplicate-index, and malformed logs', async () => {
    const cases: Partial<CurrentDexOwnerTokenLog>[] = [
      { removed: true },
      { transactionHash: `0x${'44'.repeat(32)}` },
      { blockHash: `0x${'44'.repeat(32)}` },
      { blockNumber: 9_965_910 },
      { index: -1 },
      { topics: ['0x12'] },
      { data: '0x123' },
      { address: 'not-an-address' }
    ];
    for (const override of cases) {
      const request = requestFor({ phase: 'accept' });
      (request.receipt.logs as CurrentDexOwnerTokenLog[])[0] = { ...request.receipt.logs[0], ...override };
      await expectRejected(request);
    }
    const duplicate = requestFor({ phase: 'accept' });
    (duplicate.receipt.logs as CurrentDexOwnerTokenLog[]).push({ ...duplicate.receipt.logs[0] });
    await expectRejected(duplicate, 'LOG_ORIGIN');
  });

  it('rejects trailing ABI bytes and malformed Transfer topics', async () => {
    const trailing = requestFor({ phase: 'accept' });
    (trailing.receipt.logs as CurrentDexOwnerTokenLog[])[0] = { ...trailing.receipt.logs[0], data: `${trailing.receipt.logs[0].data}00` };
    await expectRejected(trailing, 'TRANSFER_ABI');
    const malformed = requestFor({ phase: 'accept' });
    (malformed.receipt.logs as CurrentDexOwnerTokenLog[])[0] = { ...malformed.receipt.logs[0], topics: [malformed.receipt.logs[0].topics[0], '0x12'] };
    await expectRejected(malformed);
  });

  it('rejects missing, duplicate, additional, and wrong-party or wrong-token transfers', async () => {
    const missing = requestFor({ phase: 'accept', legs: [] });
    await expectRejected(missing, 'TRANSFER_SET');
    const duplicate = requestFor({ phase: 'accept' });
    (duplicate.receipt.logs as CurrentDexOwnerTokenLog[]).push({ ...duplicate.receipt.logs[0], index: 1 });
    await expectRejected(duplicate, 'TRANSFER_SET');
    const additional = requestFor({ phase: 'accept', legs: [
      ...legsFor('accept', bindingFor(), baseAmounts),
      { token: tokenAddresses[1], from: core, to: other, envelope: 'receiverValue', amount: 2n }
    ] });
    await expectRejected(additional, 'TRANSFER_SET');
    for (const leg of [
      { token: tokenAddresses[0], from: other, to: core, envelope: 'senderValue' as const, amount: 100n },
      { token: tokenAddresses[0], from: owner, to: other, envelope: 'senderValue' as const, amount: 100n },
      { token: tokenAddresses[1], from: owner, to: core, envelope: 'senderValue' as const, amount: 100n }
    ]) await expectRejected(requestFor({ phase: 'accept', legs: [leg] }), 'TRANSFER_SET');
  });

  it('checks the contract-selected envelope and rejects a wrong private amount', async () => {
    await expectRejected(requestFor({ phase: 'accept', selectedEnvelope: 'receiverValue' }), 'TOKEN_AMOUNT');
    await expectRejected(requestFor({ phase: 'terminal', selectedEnvelope: 'senderValue' }), 'TOKEN_AMOUNT');
  });

  it('rejects broken conservation, zero-input fills, and non-uint decrypted values', async () => {
    for (const amounts of [
      { refund: 19n }, { netOutput: 49n }, { maximumInput: 0n }, { actualInput: 0n },
      { fee: 51n }, { grossOutput: 0n }, { filled: false }
    ]) await expectRejected(requestFor({ amounts }), 'CONSERVATION');
    for (const value of [-1n, 1n << 256n, 100]) {
      await expectRejected(requestFor({ phase: 'accept', decrypt: () => value as bigint }), 'TOKEN_AMOUNT');
    }
  });

  it('sanitizes private decryption errors', async () => {
    await expect(verifyCurrentDexOwnerTokenMovements(requestFor({
      phase: 'accept', decrypt: async () => { throw new Error('secret detail'); }
    }))).rejects.toEqual(new Error('Owner token proof: PRIVATE_ENVELOPE'));
  });

  it('rejects session drift during decryption and canonical drift after decryption', async () => {
    let currentCalls = 0;
    await expectRejected(requestFor({
      phase: 'accept',
      assertCurrent: () => { currentCalls += 1; if (currentCalls === 4) throw new Error('stale session'); }
    }), 'SESSION');
    let canonicalCalls = 0;
    await expectRejected(requestFor({
      phase: 'accept',
      verifyCanonical: async () => { canonicalCalls += 1; if (canonicalCalls === 2) throw new Error('changed head'); }
    }), 'CANONICAL');
  });

  it('uses copied proof inputs when callers mutate them during an async canonical check', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const binding = bindingFor();
    const request = requestFor({ phase: 'accept', verifyCanonical: async () => gate });
    request.binding = binding;
    const pending = verifyCurrentDexOwnerTokenMovements(request);
    Object.assign(binding, { owner: other, inputToken: other });
    Object.assign(request.receipt.logs[0], { data: '0x' });
    Object.assign(request.amounts, { maximumInput: 1n });
    release();
    await expect(pending).resolves.toMatchObject({ ownerTokenMovementsVerified: true, phase: 'accept' });
  });

  it('returns no private amounts or envelopes and keeps all admission flags false', async () => {
    const result = await verifyCurrentDexOwnerTokenMovements(requestFor());
    expect(result).toMatchObject({
      ownerTokenMovementsVerified: true,
      fullFixtureAccountingVerified: false,
      nativeAdmission: false,
      readyToSign: false
    });
    expect(JSON.stringify(result, (_key, value) => typeof value === 'bigint' ? value.toString() : value))
      .not.toMatch(/maximumInput|actualInput|refund|grossOutput|netOutput|ciphertextHigh|ciphertextLow|senderValue|receiverValue/);
  });
});
