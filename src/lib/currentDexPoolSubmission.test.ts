import * as deployment from './dexV2Deployment';
import { readFileSync } from 'node:fs';
import { AbiCoder, Interface, getAddress, keccak256, toBeHex } from '@coti-io/coti-ethers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertCurrentPoolFundingNativeAdmission, createCurrentPoolSubmissionAdapter } from './currentDexPoolSubmission';
import { ARCHIVED_CHEAP_DEX_CANDIDATE as candidate, resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { CURRENT_POOL_FUNDING_ABI, PREPARED_POOL_FUNDING_ABI, encodeCurrentPoolCreation, encodeCurrentPoolFundingPreview, encodePreparedPoolCreation, encodePreparedPoolFundingPreview, encodePreparedPoolTopUp } from './currentDexPoolFunding';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { CurrentPoolProofMismatch } from './currentDexPoolProofError';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY } from './currentDexPendingAttempt';
import { blockCurrentPoolVerification, readCurrentDexPendingAttempt } from './currentDexPendingAttempt';
import * as currentDexC1SwapPolicy from './currentDexC1SwapPolicy';

// Adapter unit tests mock only the issuer brand. Genuine owner issuance is tested separately.
const brands = vi.hoisted(() => new WeakMap<object, object>());
vi.mock('../features/wallet/currentDexPoolFundingCapability', () => ({
  assertCurrentPoolFundingPrepared: (prepared: object, signer: object) => {
    if (brands.get(prepared) !== signer) throw new Error('Wrong owner wallet session');
  }
}));
const owner = `0x${'22'.repeat(20)}`, blockHash = toBeHex(31n, 32), txHash = toBeHex(32n, 32), context = toBeHex(33n, 32);
const chainId = BigInt(candidate.chainId), abi = new Interface(CURRENT_POOL_FUNDING_ABI);
const signature = `0x${'11'.repeat(65)}`;
const inputs = Array.from({ length: 13 }, (_, i) => ({
  ciphertext: i === 1 || i === 2 ? { ciphertextHigh: 1n, ciphertextLow: BigInt(i) } : BigInt(i), signature
}));
const previewData = encodeCurrentPoolFundingPreview(0n, inputs);
const fundingData = encodeCurrentPoolCreation(previewData, context, inputs);
const claimAbi = new Interface(['event SharedClaimCreated(uint256 indexed positionId)']);
const nftAbi = new Interface(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
const localTechnicalSuccessGraphs = new Set<string>();
const assertRealD06AppAuthority = currentDexC1SwapPolicy.assertCurrentD06AppAuthority;
const assertRealPoolAppAuthority = currentDexC1SwapPolicy.assertCurrentAppPoolAuthority;
const mintLogs = (mintedOwner = owner, tokenId = 8n) => [
  { address: candidate.core, ...claimAbi.encodeEventLog(claimAbi.getEvent('SharedClaimCreated')!, [8n]) },
  { address: candidate.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1],
    ...nftAbi.encodeEventLog(nftAbi.getEvent('Transfer')!, [`0x${'00'.repeat(20)}`, mintedOwner, tokenId]) }
];
const fixture = (selectedOwner = owner) => {
  const owner = selectedOwner;
  const values = new Map<string, string>();
  vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } });
  const signer = {}, lease = { active: true };
  const guard = vi.fn(async () => { if (!lease.active) throw new Error('Session revoked'); });
  const preview = { transactionHash: txHash, context, amounts: { used0: 100n, used1: 50n } };
  const funded = { transactionHash: txHash, positionId: 8n, used0: 100n, used1: 50n };
  const base = { chainId, from: owner, to: candidate.core as string, value: 0n as const, graph: candidate.graph as string,
    packageSha256: candidate.packageSha256 as string, readyToSign: false as const, assertCurrent: guard,
    intent: { principal: owner, core: candidate.core as string, chainId } };
  const prepared = { ...base, data: previewData, readPreview: vi.fn(async () => preview) };
  const funding = { ...base, data: fundingData, amounts: preview.amounts, previewTransactionHash: toBeHex(40n, 32),
    previewContext: context, readFunding: vi.fn(async () => funded) };
  brands.set(prepared, signer); brands.set(funding, signer);
  let sent: null | { chainId: bigint; from: string; to: string; value: bigint; data: string; gasLimit: bigint;
    nonce: number; hash: string; blockNumber: number; blockHash: string } = null;
  const log = { address: candidate.core, ...abi.encodeEventLog(abi.getEvent('PoolFundingPreviewed')!, [0n, context,
    Array.from({ length: 10 }, (_, i) => [BigInt(i), BigInt(i + 1)])]) };
  const receipt = { hash: txHash, status: 1, from: owner, to: candidate.core as string, blockNumber: 30, blockHash,
    logs: [log] as Array<{ address: string; topics: string[]; data: string }> };
  const transport = { verifyCanonicalInclusion: vi.fn(async () => {}), assertCurrent: guard, estimateGas: vi.fn(async () => 1n),
    readHead: vi.fn(async () => ({ number: 30n, hash: blockHash, timestamp: 100n, gasLimit: 120_000_000n })),
    readNonce: vi.fn(async () => 4), readBlockHash: vi.fn(async () => blockHash),
    readNativeResources: vi.fn(async (head: { number: bigint; hash: string; timestamp: bigint; gasLimit: bigint }) => ({
      owner, chainId, head, latestNonce: 4, pendingNonce: 4, baseFeePerGas: 1n, gasPrice: 50_000_000n,
      balance: 10n ** 18n, code: '0x'
    })),
    send: vi.fn(async request => { sent = { ...request, hash: txHash, blockNumber: 30, blockHash }; return { ...request, hash: txHash }; }),
    readTransaction: vi.fn(async () => sent), waitForReceipt: vi.fn(async () => receipt) };
  const attest = vi.fn(async () => {}), requireFunding = vi.fn(async () => {});
  const make = (currentSigner = signer, candidateKey: CurrentCheapDexCandidateKey = 'cheap-archived', clock = 100n) => createCurrentPoolSubmissionAdapter({ signer: currentSigner, ownerAddress: owner,
    candidate: candidateKey, chainId, transport, attest, requireFunding, now: () => clock });
  return { prepared, funding, preview, funded, transport, attest, requireFunding, values, make, lease, receipt,
    transaction: () => sent!, brand: (value: object) => { brands.set(value, signer); } };
};
beforeEach(() => {
  const original = deployment.assertCurrentCheapDexNativeAdmission;
  vi.spyOn(deployment, 'assertCurrentCheapDexNativeAdmission').mockImplementation(value => {
    if (JSON.stringify(value) !== JSON.stringify(candidate)) original(value);
  });
  vi.spyOn(currentDexC1SwapPolicy, 'assertCurrentD06AppAuthority').mockImplementation(graph => {
    if (!localTechnicalSuccessGraphs.has(graph)) assertRealD06AppAuthority(graph);
  });
  vi.spyOn(currentDexC1SwapPolicy, 'assertCurrentAppPoolAuthority').mockImplementation((graph, scope) => {
    if (!localTechnicalSuccessGraphs.has(graph)) assertRealPoolAppAuthority(graph, scope);
  });
});

describe('native Pool metadata has no new-send or private-accounting authority', () => {
  it.each(['pool-preview', 'pool-fund'] as const)('persists known verification failure for %s without a native gate mock', async phase => {
    const f = fixture(), c = resolveCurrentCheapDexCandidate('cheap-native');
    const storage = { getItem: (key: string) => f.values.get(key) ?? null,
      setItem: (key: string, value: string) => { f.values.set(key, value); }, removeItem: (key: string) => { f.values.delete(key); } };
    f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify({ version: 1, chainId: chainId.toString(), owner,
      core: c.core.toLowerCase(), graph: `0x${c.graph}`, phase, callHash: keccak256(phase === 'pool-preview' ? previewData : fundingData), nonce: 4, txHash }));
    blockCurrentPoolVerification(storage, readCurrentDexPendingAttempt(storage)!);
    expect(readCurrentDexPendingAttempt(storage)?.verificationBlocked).toBe(true);
    await expect(f.make(undefined, 'cheap-native', 5000n).recoverPendingPoolAttempt()).resolves.toMatchObject({
      status: 'manual-reconciliation-required', verificationBlocked: true, readyToSign: false, privateAccountingVerified: false });
    expect(f.transport.readTransaction).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled(); expect(f.values.size).toBe(1);
  });
  it('reconciles a known native hash after normal expiry without resetting or sending', async () => {
    const f = fixture(), c = resolveCurrentCheapDexCandidate('cheap-native');
    await f.make().submitPoolPreview(f.prepared as never);
    const pending = JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!);
    f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify({ ...pending, core: c.core.toLowerCase(), graph: `0x${c.graph}` }));
    f.transaction().to = c.core; f.receipt.to = c.core; f.receipt.logs[0].address = c.core;
    await expect(f.make(undefined, 'cheap-native', 5000n).recoverPendingPoolAttempt()).resolves.toMatchObject({
      status: 'observed-mined', readyToSign: false, privateAccountingVerified: false });
    expect(f.transport.send).toHaveBeenCalledOnce(); expect(f.prepared.readPreview).not.toHaveBeenCalled();
  });
  it.each(['receipt', 'calldata'])('locks known %s failure during native metadata verification', async fault => {
    const f = fixture(), c = resolveCurrentCheapDexCandidate('cheap-native');
    await f.make().submitPoolPreview(f.prepared as never);
    const pending = JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!);
    f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify({ ...pending, core: c.core.toLowerCase(), graph: `0x${c.graph}` }));
    f.transaction().to = c.core; f.receipt.to = c.core; f.receipt.logs[0].address = c.core;
    f.transport.verifyCanonicalInclusion.mockImplementationOnce(async () => { f.receipt.logs.push({ address: c.core, topics: [], data: '0x' }); });
    if (fault === 'calldata') f.transaction().data += '00';
    const adapter = f.make(undefined, 'cheap-native');
    await expect(adapter.recoverPendingPoolAttempt()).rejects.toThrow(fault === 'receipt' ? 'changed during canonical' : 'pending calldata changed');
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!).verificationBlocked).toBe(true);
    await expect(adapter.recoverPendingPoolAttempt()).resolves.toMatchObject({ status: 'manual-reconciliation-required', verificationBlocked: true });
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['rpc', 'lease'])('keeps %s failure after a known receipt retryable by reads only', async fault => {
    const f = fixture(), c = resolveCurrentCheapDexCandidate('cheap-native');
    await f.make().submitPoolPreview(f.prepared as never);
    const pending = JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!);
    f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify({ ...pending, core: c.core.toLowerCase(), graph: `0x${c.graph}` }));
    f.transaction().to = c.core; f.receipt.to = c.core; f.receipt.logs[0].address = c.core;
    f.transport.verifyCanonicalInclusion.mockImplementationOnce(async () => {
      if (fault === 'rpc') throw new Error('Temporary RPC outage');
      f.lease.active = false;
    });
    const adapter = f.make(undefined, 'cheap-native', 5000n);
    await expect(adapter.recoverPendingPoolAttempt()).rejects.toThrow(fault === 'rpc' ? 'RPC outage' : 'revoked');
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!).verificationBlocked).toBeUndefined();
    f.lease.active = true;
    await expect(adapter.recoverPendingPoolAttempt()).resolves.toMatchObject({ status: 'observed-mined', readyToSign: false, privateAccountingVerified: false });
    expect(f.transport.send).toHaveBeenCalledOnce(); expect(f.prepared.readPreview).not.toHaveBeenCalled();
  });
});
afterEach(() => { localTechnicalSuccessGraphs.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('current Pool submission adapter', () => {
  it('sends one exact preview with fixed gas and returns only the authenticated private result', async () => {
    const f = fixture(), adapter = f.make(), submission = await adapter.submitPoolPreview(f.prepared as never);
    expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({ chainId, from: owner, to: getAddress(candidate.core),
      data: previewData, value: 0n, nonce: 4, gasLimit: 100_000_000n }), expect.any(Function));
    expect(f.transport.estimateGas).not.toHaveBeenCalled();
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({ phase: 'pool-preview', nonce: 4, txHash });
    await expect(submission.recover()).resolves.toBe(f.preview);
    expect(f.prepared.readPreview).toHaveBeenCalledWith(txHash);
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    await expect(adapter.submitPoolPreview(f.prepared as never)).rejects.toThrow();
    expect(f.transport.send).toHaveBeenCalledOnce();
  });

  it('checks funding admission twice and clears its journal only after private funding verification', async () => {
    const f = fixture(); f.receipt.logs = mintLogs();
    const submission = await f.make().submitPoolFunding(f.funding as never);
    expect(f.requireFunding).toHaveBeenCalledTimes(2);
    expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({ data: fundingData, gasLimit: 100_000_000n }), expect.any(Function));
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({ phase: 'pool-fund' });
    await expect(submission.recover()).resolves.toBe(f.funded);
    expect(f.funding.readFunding).toHaveBeenCalledWith(txHash);
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
  });

  it.each(['forged', 'session', 'graph', 'package', 'owner', 'chain', 'value', 'method', 'suffix'])('rejects %s preparation before send', async fault => {
    const f = fixture(), prepared = { ...f.prepared };
    if (fault !== 'forged') f.brand(prepared);
    if (fault === 'graph') prepared.graph = '00'.repeat(32);
    if (fault === 'package') prepared.packageSha256 = '00'.repeat(32);
    if (fault === 'owner') prepared.from = candidate.core;
    if (fault === 'chain') prepared.chainId = 1n;
    if (fault === 'value') (prepared as { value: bigint }).value = 1n;
    if (fault === 'method') prepared.data = fundingData;
    if (fault === 'suffix') prepared.data += '00';
    await expect(f.make(fault === 'session' ? {} : undefined).submitPoolPreview(prepared as never)).rejects.toThrow();
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
  });

  it.each(['headroom', 'nonce', 'lease', 'mutated', 'funding'])('blocks %s changes before a wallet send', async fault => {
    const f = fixture();
    if (fault === 'headroom') f.transport.readHead.mockResolvedValue({ number: 30n, hash: blockHash, timestamp: 100n, gasLimit: 111_111_111n });
    if (fault === 'nonce') f.transport.readNonce.mockResolvedValueOnce(4).mockResolvedValueOnce(5);
    if (fault === 'lease' || fault === 'mutated') f.attest.mockImplementationOnce(async () => {
      if (fault === 'lease') f.lease.active = false; else f.prepared.data += '00';
    });
    if (fault === 'funding') f.requireFunding.mockRejectedValueOnce(new Error('Funding not admitted'));
    await expect(fault === 'funding' ? f.make().submitPoolFunding(f.funding as never) :
      f.make().submitPoolPreview(f.prepared as never)).rejects.toThrow();
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
  });

  it('keeps uncertain wallet sends reserved for manual reconciliation', async () => {
    const f = fixture(), adapter = f.make();
    f.transport.send.mockRejectedValueOnce(new Error('Wallet response interrupted'));
    await expect(adapter.submitPoolPreview(f.prepared as never)).rejects.toThrow('interrupted');
    await expect(adapter.recoverPendingPoolAttempt()).resolves.toMatchObject({ status: 'manual-reconciliation-required' });
    await expect(adapter.submitPoolPreview(f.prepared as never)).rejects.toThrow();
    expect(f.transport.send).toHaveBeenCalledOnce();
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);
  });

  it('rechecks funding admission after the first successful check', async () => {
    const f = fixture();
    f.requireFunding.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Funding changed'));
    await expect(f.make().submitPoolFunding(f.funding as never)).rejects.toThrow('Funding changed');
    expect(f.requireFunding).toHaveBeenCalledTimes(2);
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
  });

  it.each(['nonce', 'gas', 'owner', 'data'])('keeps a wallet-mutated %s transaction reserved', async fault => {
    const f = fixture();
    f.transport.send.mockImplementationOnce(async request => ({ ...request, hash: txHash,
      ...(fault === 'nonce' ? { nonce: 5 } : fault === 'gas' ? { gasLimit: 99_000_000n } :
        fault === 'owner' ? { from: candidate.core } : { data: fundingData }) }));
    await expect(f.make().submitPoolPreview(f.prepared as never)).rejects.toThrow();
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);
  });

  it('retains pending state when a successful receipt cannot pass private verification', async () => {
    const f = fixture(), submission = await f.make().submitPoolPreview(f.prepared as never);
    f.prepared.readPreview.mockRejectedValueOnce(new Error('Private amounts differ'));
    await expect(submission.recover()).rejects.toThrow('Private amounts differ');
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);
    await expect(submission.recover()).resolves.toBe(f.preview);
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
  });

  it.each([[0, 'nonce'], [0, 'gas'], [0, 'reorg'], [1, 'nonce'], [1, 'gas'], [1, 'reorg'], [2, 'unknown']] as const)(
    'does not clear status %s with %s recovery evidence', async (status, fault) => {
    const f = fixture(), adapter = f.make();
    await adapter.submitPoolPreview(f.prepared as never);
    f.receipt.status = status;
    if (fault === 'nonce') f.transaction().nonce = 5;
    if (fault === 'gas') f.transaction().gasLimit = 99_000_000n;
    if (fault === 'reorg') f.transport.readBlockHash.mockResolvedValue(toBeHex(99n, 32));
    await expect(adapter.recoverPendingPoolAttempt()).rejects.toThrow();
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);
    expect(f.prepared.readPreview).not.toHaveBeenCalled();
  });

  it('keeps a pending receipt without returning private results or unlocking a resend', async () => {
    const f = fixture(), adapter = f.make();
    await adapter.submitPoolPreview(f.prepared as never);
    f.transport.waitForReceipt.mockResolvedValueOnce(null as never);
    await expect(adapter.recoverPendingPoolAttempt()).resolves.toMatchObject({ status: 'awaiting-chain-confirmation' });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);
    expect(f.prepared.readPreview).not.toHaveBeenCalled();
    await expect(adapter.submitPoolPreview(f.prepared as never)).rejects.toThrow();
    expect(f.transport.send).toHaveBeenCalledOnce();
  });

  it('unlocks only the exact canonically reverted attempt', async () => {
    const f = fixture(), adapter = f.make();
    await adapter.submitPoolPreview(f.prepared as never);
    f.receipt.status = 0;
    await expect(adapter.recoverPendingPoolAttempt()).resolves.toMatchObject({ status: 'observed-reverted', phase: 'pool-preview' });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    await adapter.submitPoolPreview(f.prepared as never);
    expect(f.transport.send).toHaveBeenCalledTimes(2);
  });

  it('returns public preview metadata without granting private preview authority', async () => {
    const f = fixture(), adapter = f.make();
    await adapter.submitPoolPreview(f.prepared as never);
    const observed = await adapter.recoverPendingPoolAttempt();
    expect(observed).toMatchObject({ status: 'observed-mined', phase: 'pool-preview', transactionHash: txHash });
    expect(observed).not.toHaveProperty('amounts');
    expect(observed).not.toHaveProperty('prepareFunding');
    expect(f.prepared.readPreview).not.toHaveBeenCalled();
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
  });

  it.each(['valid', 'missing', 'owner', 'id', 'duplicate'])('checks %s claim and NFT evidence during public funding recovery', async fault => {
    const f = fixture(), adapter = f.make();
    f.receipt.logs = mintLogs(fault === 'owner' ? candidate.core : owner, fault === 'id' ? 9n : 8n);
    if (fault === 'missing') f.receipt.logs.pop();
    if (fault === 'duplicate') f.receipt.logs.push(f.receipt.logs[0]);
    await adapter.submitPoolFunding(f.funding as never);
    if (fault === 'valid') {
      const observed = await adapter.recoverPendingPoolAttempt();
      expect(observed).toMatchObject({ status: 'observed-mined', phase: 'pool-fund', transactionHash: txHash });
      expect(observed).not.toHaveProperty('amounts');
      expect(observed).not.toHaveProperty('used0');
      expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    } else {
      await expect(adapter.recoverPendingPoolAttempt()).rejects.toThrow();
      expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);
    }
    expect(f.funding.readFunding).not.toHaveBeenCalled();
  });

  it('blocks Pool sends behind the shared swap journal', async () => {
    const f = fixture();
    f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify({ version: 1, chainId: chainId.toString(), owner,
      core: candidate.core.toLowerCase(), graph: `0x${candidate.graph}`, phase: 'quote', callHash: keccak256(previewData), nonce: 4, txHash }));
    await expect(f.make().submitPoolPreview(f.prepared as never)).rejects.toThrow('pending attempt');
    expect(f.transport.send).not.toHaveBeenCalled();
  });
});


describe('shared-history Pool funding phase admission', () => {
  it('admits the exact registered creation path', () => {
    expect(() => assertCurrentPoolFundingNativeAdmission(resolveCurrentCheapDexCandidate('cheap-history'))).not.toThrow();
  });
  it('admits the exact registered same-position top-up path', () => {
    expect(() => assertCurrentPoolFundingNativeAdmission(resolveCurrentCheapDexCandidate('cheap-history'), 'top-up')).not.toThrow();
  });
  it.each(['creation', 'top-up'] as const)('rejects changed metadata for %s', mode => {
    for (const field of ['core', 'packageSha256', 'chainId', 'genesisHash'] as const) {
      const changed = { ...resolveCurrentCheapDexCandidate('cheap-history'), [field]: field==='chainId'?1:'changed' };
      expect(() => assertCurrentPoolFundingNativeAdmission(changed as never, mode)).toThrow();
    }
  });
  it('rejects an unknown funding phase', () => {
    expect(() => assertCurrentPoolFundingNativeAdmission(resolveCurrentCheapDexCandidate('cheap-history'), 'other' as never)).toThrow();
  });
});

describe('selected Pool submission candidate', () => {
  it('rejects archived preparation in a native-candidate adapter', async () => { const f=fixture(); await expect(f.make(undefined,'cheap-native').submitPoolPreview(f.prepared as never)).rejects.toThrow('owner candidate'); expect(f.transport.send).not.toHaveBeenCalled(); });
  it.each(['preview','fund'])('holds selected native %s before nonce, estimate or send', async phase => {
    const f=fixture(), selected=resolveCurrentCheapDexCandidate('cheap-native'), p=phase==='preview'?f.prepared:f.funding;
    Object.assign(p,{to:selected.core,graph:selected.graph,packageSha256:selected.packageSha256});
    const adapter=f.make(undefined,'cheap-native'); await expect(phase==='preview'?adapter.submitPoolPreview(p as never):adapter.submitPoolFunding(p as never)).rejects.toThrow('Native Pool profile');
    expect(f.transport.readNonce).not.toHaveBeenCalled(); expect(f.transport.estimateGas).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled(); expect(f.values.size).toBe(0);
  });
  it('keeps archived reload recovery and rejects its pending record in another candidate', async () => {
    const f=fixture(); await f.make().submitPoolPreview(f.prepared as never);
    await expect(f.make(undefined,'cheap-native').recoverPendingPoolAttempt()).rejects.toThrow('another owner, candidate'); expect(f.values.size).toBe(1);
    expect(await f.make(undefined,'cheap-archived').recoverPendingPoolAttempt()).toMatchObject({status:'observed-mined'});
  });
  it('reconciles a selected native revert without granting writes or private authority', async () => {
    const f=fixture(), selected=resolveCurrentCheapDexCandidate('cheap-native'); await f.make().submitPoolPreview(f.prepared as never);
    const p=JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!); f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify({...p,core:selected.core.toLowerCase(),graph:`0x${selected.graph}`}));
    f.transaction().to=selected.core; f.receipt.to=selected.core; f.receipt.status=0;
    expect(await f.make(undefined,'cheap-native').recoverPendingPoolAttempt()).toMatchObject({status:'observed-reverted'}); expect(f.values.size).toBe(0);
  });
});

describe.each(['cheap-prepared', 'cheap-exit', 'cheap-history'] as const)('%s local technical-path Pool submission', candidateKey => {
  const frozenCore = new Interface(JSON.parse(readFileSync(new URL('../../../ChainWhisper Contracts V2/validation/candidates/shared-core-exit-preview-2026-10-07/build-1/core-output.json', import.meta.url), 'utf8'))
    .contracts['contracts/dex/ChainWhisperDexCore.sol'].ChainWhisperDexCore.abi);
  function preparedFixture(index = 0, allow = false, selectedOwner = owner) {
    const f = fixture(selectedOwner), c = resolvePreparedDexScope(candidateKey).candidate, pair = c.pairs[index];
    const data = encodePreparedPoolFundingPreview(pair.marketId, 0n, inputs);
    const intent = { principal: selectedOwner, core: c.core as string, chainId, marketId: pair.marketId as string, poolTokens: pair.tokens as readonly string[],
      classId: 0n, budgets: [1_000_000n,1_000_000n] as const, terms: [1n,1n,1n,1n,1n,1n,1n,1n,1n,200n] as const };
    Object.assign(f.prepared, { to: c.core, graph: c.graph, packageSha256: c.packageSha256, data, intent });
    const funding = Object.assign(f.funding, { to: c.core, graph: c.graph, packageSha256: c.packageSha256, intent,
      data: encodePreparedPoolCreation(pair.marketId, data, context, inputs), assertBeforeFunding: vi.fn(async () => {}) });
    f.receipt.to = c.core; f.receipt.logs[0].address = c.core;
    if (allow) {
      localTechnicalSuccessGraphs.add(c.graph);
      vi.mocked(deployment.assertCurrentCheapDexNativeAdmission).mockImplementation(value => {
        expect(value).toEqual(c); // Local fake-transport path only; this does not grant App submission.
      });
    }
    return { ...f, funding, c, pair, adapter: f.make(undefined, candidateKey) };
  }
  function topUpFixture(index = 0, allow = false) {
    const f = preparedFixture(index, allow), id = 43n, ownerContext = toBeHex(77n, 32);
    const topInputs = [{ ciphertext: { ciphertextHigh: 1n, ciphertextLow: 10n }, signature },
      { ciphertext: { ciphertextHigh: 1n, ciphertextLow: 20n }, signature }, { ciphertext: 1n, signature }, { ciphertext: 200n, signature }];
    const data = encodePreparedPoolFundingPreview(f.pair.marketId, id, topInputs);
    const prepared = Object.assign(f.prepared, { positionId: id, ownerContext, data });
    const funding = Object.assign(f.funding, { positionId: id, ownerContext, previewData: data,
      data: encodePreparedPoolTopUp(f.pair.marketId, id, data, context, ownerContext, topInputs) });
    f.receipt.logs = [{ address: f.c.core, ...abi.encodeEventLog(abi.getEvent('PoolFundingPreviewed')!, [id, context,
      Array.from({ length: 10 }, (_, i) => [BigInt(i), BigInt(i + 1)])]) }];
    return { ...f, prepared, funding, id, ownerContext, topInputs };
  }
  it.each(['creation', 'top-up'] as const)('rejects cross-candidate %s submission and recovery', async mode => {
    const f = mode === 'creation' ? preparedFixture(4, true) : topUpFixture(4, true);
    const otherKey = candidateKey === 'cheap-exit' ? 'cheap-prepared' : 'cheap-exit';
    const other = f.make(undefined, otherKey);
    await expect(mode === 'creation' ? other.submitPoolFunding(f.funding as never) : other.submitPoolTopUpFunding(f.funding as never))
      .rejects.toThrow('owner candidate');
    expect(f.transport.send).not.toHaveBeenCalled();
    if (mode === 'creation') await f.adapter.submitPoolFunding(f.funding as never);
    else await f.adapter.submitPoolTopUpFunding(f.funding as never);
    await expect(other.recoverCurrentPreparedPoolFundingResult()).resolves.toBeNull();
    await expect(other.recoverPendingPoolAttempt()).rejects.toThrow('another owner, candidate or adapter');
    expect(f.funding.readFunding).not.toHaveBeenCalled(); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['preview', 'fund'] as const)('holds real top-up %s before nonce, estimate or send', async phase => {
    const f = topUpFixture();
    await expect(phase === 'preview' ? f.adapter.submitPoolTopUpPreview(f.prepared as never) : f.adapter.submitPoolTopUpFunding(f.funding as never))
      .rejects.toThrow(candidateKey === 'cheap-history' ? 'App signing hold remains active' : 'native App submission admission is absent');
    for (const mock of [f.transport.readNonce, f.transport.estimateGas, f.transport.send]) expect(mock).not.toHaveBeenCalled();
    expect(f.values.size).toBe(0);
  });
  it.skipIf(candidateKey !== 'cheap-exit')('keeps the real b2aa App hold at the early sender boundary', async () => {
    const f = preparedFixture();
    vi.mocked(deployment.assertCurrentCheapDexNativeAdmission).mockImplementation(value => { expect(value).toEqual(f.c); });
    await expect(f.adapter.submitPoolPreview(f.prepared as never)).rejects.toThrow('connected App-wallet hold remains active');
    expect(f.transport.readNonce).not.toHaveBeenCalled(); expect(f.transport.estimateGas).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled(); expect(f.values.size).toBe(0);
  });
  it.skipIf(candidateKey !== 'cheap-history')('keeps the real shared-history App hold before nonce, estimate or send', async () => {
    const f = preparedFixture();
    vi.mocked(deployment.assertCurrentCheapDexNativeAdmission).mockImplementation(value => { expect(value).toEqual(f.c); });
    await expect(f.adapter.submitPoolPreview(f.prepared as never)).rejects.toThrow('Shared-history DEX App signing hold remains active');
    expect(f.transport.readNonce).not.toHaveBeenCalled(); expect(f.transport.estimateGas).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled(); expect(f.values.size).toBe(0);
  });
  it.skipIf(candidateKey !== 'cheap-history')('reaches the real engineering Pool send with exact issuer terms', async () => {
    const f = preparedFixture(0, false, '0x8b749251cf1f712d4e39fd048c53394af03e10be');
    const sent = await f.adapter.submitPoolPreview(f.prepared as never);
    expect(sent.transactionHash).toBe(txHash);
    expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({ from: getAddress(f.prepared.from), to: getAddress(f.c.core), data: f.prepared.data, gasLimit:100_000_000n }),expect.any(Function));
    expect(f.transport.estimateGas).toHaveBeenCalled();
  });
  it.skipIf(candidateKey !== 'cheap-exit')('rechecks the real b2aa App hold at the final sender boundary after fresh reads', async () => {
    const f = preparedFixture(0, true);
    let checks = 0;
    vi.mocked(currentDexC1SwapPolicy.assertCurrentD06AppAuthority).mockImplementation(graph => {
      checks += 1;
      if (checks === 2) assertRealD06AppAuthority(graph);
    });
    await expect(f.adapter.submitPoolPreview(f.prepared as never)).rejects.toThrow('connected App-wallet hold remains active');
    expect(checks).toBe(2); expect(f.transport.readNonce).toHaveBeenCalled();
    expect(f.transport.estimateGas).toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
    expect(f.values.size).toBe(0);
  });
  it.each([0, 1, 2, 3, 4, 5])('retains exact top-up call and pre-funding proof for pair%i', async index => {
    const f = topUpFixture(index, true), sent = await f.adapter.submitPoolTopUpFunding(f.funding as never);
    expect(frozenCore.encodeFunctionData('managePoolPosition', frozenCore.decodeFunctionData('managePoolPosition', f.funding.data))).toBe(f.funding.data);
    expect(frozenCore.encodeFunctionData('previewPoolFunding', frozenCore.decodeFunctionData('previewPoolFunding', f.prepared.data))).toBe(f.prepared.data);
    expect(f.transport.estimateGas).toHaveBeenCalledTimes(candidateKey === 'cheap-exit' || candidateKey === 'cheap-history' ? 2 : 1);
    expect(f.transport.estimateGas).toHaveBeenCalledWith(expect.objectContaining({ data: f.funding.data, nonce: 4, gasLimit: 100_000_000n }));
    expect(f.funding.assertBeforeFunding).toHaveBeenCalledTimes(3); expect(f.requireFunding).toHaveBeenCalledTimes(3);
    await expect(sent.recover()).resolves.toBe(f.funded);
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalledTimes(2); expect(f.values.size).toBe(0);
  });
  it.each(['preview', 'fund'] as const)('retains same-session top-up %s recovery without resending', async phase => {
    const f = topUpFixture(3, true);
    if (phase === 'preview') await f.adapter.submitPoolTopUpPreview(f.prepared as never);
    else await f.adapter.submitPoolTopUpFunding(f.funding as never);
    await expect(f.make(undefined, candidateKey).recoverCurrentPreparedPoolFundingResult()).resolves.toBe(phase === 'preview' ? f.preview : f.funded);
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['preview', 'fund'] as const)('reloads top-up %s as metadata only, without creation mint proof', async phase => {
    const f = topUpFixture(2, true);
    if (phase === 'preview') await f.adapter.submitPoolTopUpPreview(f.prepared as never);
    else { await f.adapter.submitPoolTopUpFunding(f.funding as never); f.receipt.logs = []; }
    await expect(f.make({}, candidateKey).recoverPendingPoolAttempt()).resolves.toMatchObject({ status: 'observed-mined',
      action: 'top-up', positionId: 43n, privateAccountingVerified: false, readyToSign: false });
    expect(f.prepared.readPreview).not.toHaveBeenCalled(); expect(f.funding.readFunding).not.toHaveBeenCalled(); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['id', 'zero-id', 'owner-context', 'preview-context', 'action', 'inner-suffix', 'outer-suffix', 'ciphertext', 'preview-id', 'creation-method'] as const)('rejects top-up %s mutation before any send', async fault => {
      const f = topUpFixture(0, true), host = new Interface(PREPARED_POOL_FUNDING_ABI), coder = AbiCoder.defaultAbiCoder();
      const args = [...host.decodeFunctionData('managePoolPosition', f.funding.data)];
      if (fault === 'id') args[0] = 44n;
      if (fault === 'zero-id') args[0] = 0n;
      if (fault === 'owner-context') args[1] = blockHash;
      if (fault === 'action') args[2] = 4;
      if (fault === 'inner-suffix') args[3] += '00';
      if (fault === 'preview-context') { const inner = [...coder.decode(['bytes32', 'bytes'], args[3])]; inner[0] = blockHash;
        args[3] = coder.encode(['bytes32', 'bytes'], inner); }
      f.funding.data = host.encodeFunctionData('managePoolPosition', args);
      if (fault === 'outer-suffix') f.funding.data += '00';
      if (fault === 'ciphertext') { const changed = [...f.topInputs]; changed[0] = { ...changed[0], ciphertext: { ciphertextHigh: 99n, ciphertextLow: 10n } };
        const changedPreview = encodePreparedPoolFundingPreview(f.pair.marketId, f.id, changed);
        f.funding.data = encodePreparedPoolTopUp(f.pair.marketId, f.id, changedPreview, context, f.ownerContext, changed); }
      if (fault === 'preview-id') f.funding.previewData = encodePreparedPoolFundingPreview(f.pair.marketId, 44n, f.topInputs);
      await expect(fault === 'creation-method' ? f.adapter.submitPoolFunding(f.funding as never) : f.adapter.submitPoolTopUpFunding(f.funding as never)).rejects.toThrow();
      expect(f.transport.send).not.toHaveBeenCalled(); expect(f.values.size).toBe(0);
    });
  it.each(['id', 'creation', 'market', 'suffix', 'inner-suffix'] as const)('rejects top-up preview %s mutation', async fault => {
    const f = topUpFixture(1, true);
    if (fault === 'id') f.prepared.data = encodePreparedPoolFundingPreview(f.pair.marketId, 44n, f.topInputs);
    if (fault === 'creation') f.prepared.data = encodePreparedPoolFundingPreview(f.pair.marketId, 0n, inputs);
    if (fault === 'market') f.prepared.data = encodePreparedPoolFundingPreview(resolvePreparedDexScope(candidateKey).candidate.pairs[0].marketId, f.id, f.topInputs);
    if (fault === 'suffix') f.prepared.data += '00';
    if (fault === 'inner-suffix') { const host = new Interface(PREPARED_POOL_FUNDING_ABI), args = [...host.decodeFunctionData('previewPoolFunding', f.prepared.data)];
      args[2] += '00'; f.prepared.data = host.encodeFunctionData('previewPoolFunding', args); }
    await expect(f.adapter.submitPoolTopUpPreview(f.prepared as never)).rejects.toThrow(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each([0n, 79_200_001n, 100_000_001n])('rejects top-up estimate %s before signing or journal reservation', async estimate => {
    const f = topUpFixture(0, true); f.transport.estimateGas.mockResolvedValue(estimate);
    await expect(f.adapter.submitPoolTopUpFunding(f.funding as never)).rejects.toThrow('estimate');
    expect(f.transport.send).not.toHaveBeenCalled(); expect(f.values.size).toBe(0);
  });
  it('holds a top-up whose canonical transaction-index proof fails', async () => {
    const f = topUpFixture(0, true), sent = await f.adapter.submitPoolTopUpFunding(f.funding as never);
    f.transport.verifyCanonicalInclusion.mockRejectedValue(new CurrentPoolProofMismatch('Canonical transaction index changed'));
    await expect(sent.recover()).rejects.toThrow('index');
    expect(f.funding.readFunding).not.toHaveBeenCalled(); expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!).verificationBlocked).toBe(true);
  });
  it.each(['action', 'zero-context', 'inner-suffix', 'short-signature'] as const)('rejects malformed top-up %s on metadata reload', async fault => {
    const f = topUpFixture(0, true); await f.adapter.submitPoolTopUpFunding(f.funding as never);
    const host = new Interface(PREPARED_POOL_FUNDING_ABI), coder = AbiCoder.defaultAbiCoder();
    const args = [...host.decodeFunctionData('managePoolPosition', f.transaction().data)];
    if (fault === 'action') args[2] = 1;
    if (fault === 'zero-context') args[1] = toBeHex(0n, 32);
    if (fault === 'inner-suffix') args[3] += '00';
    if (fault === 'short-signature') { const inner = [...coder.decode(['bytes32', 'bytes'], args[3])];
      inner[1] = coder.encode(['tuple(tuple(uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature)[2]', 'tuple(uint256 ciphertext,bytes signature)[2]'],
        [[{ ...f.topInputs[0], signature: '0x11' }, f.topInputs[1]], f.topInputs.slice(2)]);
      args[3] = coder.encode(['bytes32', 'bytes'], inner); }
    f.transaction().data = host.encodeFunctionData('managePoolPosition', args);
    const pending = JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!);
    f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify({ ...pending, callHash: keccak256(f.transaction().data) }));
    await expect(f.make({}, candidateKey).recoverPendingPoolAttempt()).rejects.toThrow();
    expect(JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!).verificationBlocked).toBe(true);
    expect(f.funding.readFunding).not.toHaveBeenCalled(); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['preview', 'fund'])('keeps real prepared %s admission held before nonce or send', async phase => {
    const f = preparedFixture();
    await expect(phase === 'preview' ? f.adapter.submitPoolPreview(f.prepared as never) : f.adapter.submitPoolFunding(f.funding as never)).rejects.toThrow(candidateKey==='cheap-history'?'App signing hold remains active':'native App submission admission is absent');
    expect(f.transport.readNonce).not.toHaveBeenCalled(); expect(f.transport.estimateGas).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled(); expect(f.values.size).toBe(0);
  });
  it.each([0, 1, 2, 3, 4, 5])('keeps exact prepared calldata and live pre-funding checks for market%i', async index => {
    const f = preparedFixture(index, true), sent = await f.adapter.submitPoolFunding(f.funding as never);
    expect(frozenCore.encodeFunctionData('createPoolPosition', frozenCore.decodeFunctionData('createPoolPosition', f.funding.data))).toBe(f.funding.data);
    expect(frozenCore.encodeFunctionData('previewPoolFunding', frozenCore.decodeFunctionData('previewPoolFunding', f.prepared.data))).toBe(f.prepared.data);
    expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({ to: getAddress(f.c.core), data: f.funding.data }), expect.any(Function));
    expect(f.funding.assertBeforeFunding).toHaveBeenCalledTimes(3); expect(f.requireFunding).toHaveBeenCalledTimes(3);
    await expect(sent.recover()).resolves.toBe(f.funded);
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
  });
  it.each(['market', 'tokens', 'old-ABI', 'context', 'before-fund'])('rejects %s mismatch before signing', async fault => {
    const f = preparedFixture(3, true);
    if (fault === 'market') f.funding.intent.marketId = resolvePreparedDexScope(candidateKey).candidate.pairs[0].marketId;
    if (fault === 'tokens') f.funding.intent.poolTokens = resolvePreparedDexScope(candidateKey).candidate.pairs[0].tokens;
    if (fault === 'old-ABI') f.funding.data = fundingData;
    if (fault === 'context') f.funding.previewContext = blockHash;
    if (fault === 'before-fund') f.funding.assertBeforeFunding.mockRejectedValue(new CurrentPoolProofMismatch('Financial state changed'));
    await expect(f.adapter.submitPoolFunding(f.funding as never)).rejects.toThrow();
    expect(f.transport.send).not.toHaveBeenCalled(); expect(f.values.size).toBe(0);
  });
  it('retains the exact private recovery closure for the same live owner session', async () => {
    const f = preparedFixture(1, true); await f.adapter.submitPoolFunding(f.funding as never);
    await expect(f.make(undefined, candidateKey).recoverCurrentPreparedPoolFundingResult()).resolves.toBe(f.funded);
    expect(f.funding.readFunding).toHaveBeenCalledOnce(); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['private', 'canonical'])('blocks known %s proof failure across adapter recovery', async fault => {
    const f = preparedFixture(2, true), sent = await f.adapter.submitPoolFunding(f.funding as never);
    f.funding.readFunding.mockImplementationOnce(async () => {
      if (fault === 'private') throw new CurrentPoolProofMismatch('Protected Limit changed');
      f.receipt.logs.push({ address: f.c.core, topics: [], data: '0x' }); return f.funded;
    });
    await expect(sent.recover()).rejects.toThrow();
    const record = JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!); expect(record.verificationBlocked).toBe(true);
    await expect(f.make(undefined, candidateKey).recoverPendingPoolAttempt()).resolves.toMatchObject({ verificationBlocked: true, privateAccountingVerified: false });
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
});

it('rejects changed candidate metadata in the retained Pool recovery closure',async()=>{const f=fixture(),sent=await f.make().submitPoolPreview(f.prepared as never),p=JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!);f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify({...p,graph:`0x${resolveCurrentCheapDexCandidate('cheap-native').graph}`}));await expect(sent.recover()).rejects.toThrow('pending attempt changed');expect(f.prepared.readPreview).not.toHaveBeenCalled();expect(f.values.size).toBe(1);});


describe('retained archived owner canonical completion boundary',()=>{
  it.each(['none','private'])('retained closure handles %s after private proof',async fault=>{
    const f=fixture(), native=resolveCurrentCheapDexCandidate('cheap-archived');
    Object.assign(f.prepared,{to:native.core,graph:native.graph,packageSha256:native.packageSha256});
    f.receipt.to=native.core; f.receipt.logs[0].address=native.core;
    f.transport.estimateGas.mockResolvedValue(1n);
    const inclusion=vi.fn(async()=>{});Object.assign(f.transport,{verifyCanonicalInclusion:inclusion});
    Object.assign(f.transport,{readNativeResources:async(head:{number:bigint;hash:string;timestamp:bigint;gasLimit:bigint})=>({owner,chainId,head,latestNonce:4,pendingNonce:4,baseFeePerGas:1n,gasPrice:50_000_000n,balance:10n**18n,code:'0x'})});
    const adapter=f.make(undefined,'cheap-archived');
    const sent=await adapter.submitPoolPreview(f.prepared as never);
    f.prepared.readPreview.mockImplementationOnce(async()=>{
      if(fault==='private')throw new Error('Private proof failed');
      if(fault==='block')f.receipt.blockHash=toBeHex(999n,32);
      if(fault==='status')f.receipt.status=0;
      if(fault==='logs')f.receipt.logs.push({address:native.core,topics:[],data:'0x'});
      if(fault==='topics'){if(f.receipt.logs.length)f.receipt.logs[0].topics.push(toBeHex(999n,32));else f.receipt.logs.push({address:native.core,topics:[toBeHex(999n,32)],data:'0x'});}
      if(fault==='transaction')f.transaction().nonce=999;
      if(fault==='missing')inclusion.mockRejectedValue(new Error('Canonical inclusion unavailable'));
      return f.preview;
    });
    if(fault==='none'){await expect(sent.recover()).resolves.toEqual(f.preview);expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);}
    else{await expect(sent.recover()).rejects.toThrow();expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);}
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each([0,1].flatMap(status=>['none','logs','block','status','transaction','missing'].map(fault=>[status,fault] as const)))('metadata status %s handles %s at final read',async(status,fault)=>{
    const f=fixture(), native=resolveCurrentCheapDexCandidate('cheap-native');
    await f.make().submitPoolPreview(f.prepared as never);
    const pending=JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!);
    f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify({...pending,core:native.core.toLowerCase(),graph:'0x'+native.graph}));
    f.transaction().to=native.core; f.receipt.to=native.core; f.receipt.logs[0].address=native.core; f.receipt.status=status;
    const inclusion=vi.fn(async()=>{});Object.assign(f.transport,{verifyCanonicalInclusion:inclusion});
    const adapter=f.make(undefined,'cheap-native');
    let reads=0;f.transport.waitForReceipt.mockImplementation(async()=>{if(++reads===3){
      if(fault==='logs')f.receipt.logs.push({address:native.core,topics:[],data:'0x'});
      if(fault==='block')f.receipt.blockHash=toBeHex(999n,32);
      if(fault==='status')f.receipt.status=status===0?1:0;
      if(fault==='transaction')f.receipt.from=native.core;
      if(fault==='missing')inclusion.mockRejectedValue(new Error('Canonical inclusion unavailable'));
    }return f.receipt;});
    if(fault==='none'){await expect(adapter.recoverPendingPoolAttempt()).resolves.toMatchObject({status:status===0?'observed-reverted':'observed-mined'});expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);}else{await expect(adapter.recoverPendingPoolAttempt()).rejects.toThrow();expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);}expect(f.transport.send).toHaveBeenCalledOnce();
  });
});
