import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { AbiCoder, Interface, keccak256 } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import { CURRENT_SHARED_DEX_TOKENS as definitions, CURRENT_SHARED_TOKEN_DISTRIBUTION as policy,
  readCurrentSharedDexTokenDistribution, resolveCurrentSharedTokenDistribution } from './currentSharedDexTokenDistribution';
import { STAGED_PREPARED_DEX_CANDIDATE as prepared } from './currentDexPreparedCandidate';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE as exit } from './currentDexExitCandidate';
import type { CurrentCheapDexCandidateKey } from './dexV2Deployment';

const base = '../../../ChainWhisper Contracts V2/validation/candidates/';
const json = (file: string) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const artifact = json(`${base}shared-core-markets-2026-10-07/refill/artifacts.json`).production;
const vaultAbi = new Interface(artifact.abi);
const tokenAbi = new Interface(['function decimals() view returns(uint8)', 'function publicAmountsEnabled() view returns(bool)',
  'function faucetAmount() view returns(uint256)', 'function faucetClaimed(address) view returns(bool)']);
const coreAbi = new Interface(['function releaseId() view returns(bytes32)', 'function tokenAdmissionCommitment() view returns(bytes32)']);
const runtimeFixture = json('../../reports/prepared-candidate-2026-10-07/funding-binding/runtime-fixture.json');
const runtime = runtimeFixture.codes;
const owner = '0x1111111111111111111111111111111111111111';
const head = { number: 9953486n, hash: `0x${'44'.repeat(32)}`, timestamp: 1791340000n };
const hex = (x: bigint) => `0x${x.toString(16)}`;
const lower = (x: string) => x.toLowerCase();
function fixture(candidate: CurrentCheapDexCandidateKey = 'cheap-prepared') {
  const policy = resolveCurrentSharedTokenDistribution(candidate);
  const d = policy.vaultDeployment;
  const deploymentInput = `0x${artifact.evm.bytecode.object}${AbiCoder.defaultAbiCoder().encode(['address'], [policy.vault.recovery]).slice(2)}`;
  const tx: Record<string, unknown> = { hash: d.transactionHash, from: d.from, to: null, nonce: hex(d.nonce), chainId: hex(policy.chainId),
    value: '0x0', input: deploymentInput, blockHash: d.blockHash, blockNumber: hex(d.blockNumber), transactionIndex: '0x0' };
  const receipt: Record<string, unknown> = { transactionHash: d.transactionHash, from: d.from, to: null, contractAddress: policy.vault.address,
    status: '0x1', blockHash: d.blockHash, blockNumber: hex(d.blockNumber), transactionIndex: '0x0' };
  const deploymentBlock: Record<string, unknown> = { number: hex(d.blockNumber), hash: d.blockHash, transactions: [d.transactionHash] };
  const vault: Record<string, unknown> = { CHAIN_ID: 7082400n, TOKEN_A: definitions[0].address, TOKEN_B: definitions[1].address,
    TOKEN_C: definitions[2].address, TOKEN_D: definitions[3].address, TOKEN_RUNTIME: policy.tokenRuntimeHash,
    CLAIM_AMOUNT: 1000_000000n, INITIAL_QUOTA: 1000000_000000n, COOLDOWN: 86400n,
    expiresAt: 1793930246n, recovery: policy.vault.recovery };
  const tokens = definitions.map(() => ({ decimals: 6n, publicAmountsEnabled: false, faucetAmount: 10000_000000n,
    faucetClaimed: true, remainingQuota: 999000_000000n, nextClaimAt: 0n }));
  const core: Record<string, unknown> = { releaseId: policy.releaseId, tokenAdmissionCommitment: policy.tokenAdmissionCommitment };
  const codes: Record<string, string> = { [lower(policy.core)]: runtime.core.code, [lower(policy.vault.address)]: runtime.vault.code,
    ...Object.fromEntries(definitions.map(token => [lower(token.address), runtime.token.code])) };
  if (candidate === 'cheap-exit') {
    const capture = json('../../reports/exit-candidate-2026-10-07/public-capture-2.json');
    codes[lower(policy.core)] = capture.reads.find((r: { method: string; params: string[] }) =>
      r.method === 'eth_getCode' && lower(r.params[0]) === lower(policy.core)).result;
  }
  let chain = hex(policy.chainId), active = true, headReads = 0, suffix = '', reorg = false;
  let genesis: string = policy.genesisHash;
  const assertCurrent = vi.fn(async () => { if (!active) throw new Error('Session changed'); });
  const args = { owner, head: { ...head }, candidate, assertCurrent, rpc: vi.fn(async (method: string, params: unknown[]): Promise<unknown> => {
    if (method === 'eth_chainId') return chain;
    if (method === 'eth_getBlockByNumber') {
      if (params[0] === '0x0') return { hash: genesis };
      if (params[0] === hex(d.blockNumber)) return deploymentBlock;
      expect(params).toEqual([hex(head.number), false]); headReads++;
      return { hash: reorg && headReads > 1 ? `0x${'55'.repeat(32)}` : args.head.hash,
        number: hex(args.head.number), timestamp: hex(args.head.timestamp) };
    }
    if (method === 'eth_getTransactionByHash') { expect(params).toEqual([d.transactionHash]); return tx; }
    if (method === 'eth_getTransactionReceipt') { expect(params).toEqual([d.transactionHash]); return receipt; }
    expect(params[1]).toEqual({ blockHash: args.head.hash, requireCanonical: true });
    if (method === 'eth_getCode') return codes[lower(params[0] as string)];
    expect(method).toBe('eth_call');
    const request = params[0] as { from: string; to: string; data: string };
    expect(request.from).toBe(owner);
    const isVault = lower(request.to) === lower(policy.vault.address), isCore = lower(request.to) === lower(policy.core);
    const abi = isVault ? vaultAbi : isCore ? coreAbi : tokenAbi;
    const parsed = abi.parseTransaction({ data: request.data })!;
    let value: unknown;
    if (isVault && ['remainingQuota', 'nextClaimAt'].includes(parsed.name)) {
      const index = definitions.findIndex(t => lower(t.address) === lower(parsed.args[0]));
      if (parsed.name === 'nextClaimAt') expect(parsed.args[1]).toBe(owner);
      value = tokens[index][parsed.name as 'remainingQuota' | 'nextClaimAt'];
    } else if (isVault) value = vault[parsed.name];
    else if (isCore) value = core[parsed.name];
    else {
      const index = definitions.findIndex(t => lower(t.address) === lower(request.to));
      if (parsed.name === 'faucetClaimed') expect(parsed.args[0]).toBe(owner);
      value = tokens[index][parsed.name as keyof typeof tokens[number]];
    }
    return abi.encodeFunctionResult(parsed.name, [value]) + suffix;
  }) };
  return { args, tokens, vault, core, codes, tx, receipt, deploymentBlock,
    wrongChain: () => { chain = '0x1'; }, wrongGenesis: () => { genesis = head.hash; },
    revoke: () => { active = false; }, reorg: () => { reorg = true; }, corrupt: () => { suffix = '00'.repeat(32); } };
}

describe('current shared DEX public token distribution', () => {
  it('binds the exit Core while retaining the independently deployed distributor', async () => {
    const p = resolveCurrentSharedTokenDistribution('cheap-exit');
    expect(p.core.toLowerCase()).toBe(exit.core); expect(p.graph).toBe(exit.graph);
    expect(p.packageSha256).toBe(exit.packageSha256); expect(p.vault).toBe(policy.vault);
    const f = fixture('cheap-exit'), result = await readCurrentSharedDexTokenDistribution(f.args);
    expect(result).toMatchObject({ core: p.core, graph: exit.graph, packageSha256: exit.packageSha256, readyToSign: false });
    f.core.releaseId = `0x${'11'.repeat(32)}`;
    await expect(readCurrentSharedDexTokenDistribution(f.args)).rejects.toThrow('Core identity changed');
    expect(() => resolveCurrentSharedTokenDistribution('cheap-current')).toThrow();
  });
  it('binds the successor package and independent vault native receipts', () => {
    const pkg = json(`${base}shared-core-prepared-markets-2026-10-07/native-deployment-1/package.json`);
    const result = json(`${base}shared-core-prepared-markets-2026-10-07/native-deployment-1/RESULT.json`);
    expect(pkg.expectedCore).toBe(policy.core); expect(result.graph).toBe(policy.graph);
    expect(createHash('sha256').update(JSON.stringify(pkg)).digest('hex')).toBe(policy.packageSha256);
    expect(pkg.release).toBe(policy.releaseId); expect(pkg.tokenAdmissionCommitment).toBe(policy.tokenAdmissionCommitment);
    const rows = readFileSync(new URL(`${base}shared-core-prepared-markets-2026-10-07/native-deployment-1/journal.jsonl`, import.meta.url), 'utf8').trim().split('\n').map(x => JSON.parse(x));
    expect(rows.filter(row => row.kind === 'verified')).toHaveLength(44);
    expect(rows.find(x => x.kind === 'verified' && x.index === 43)).toMatchObject({ runtimeHash: policy.coreRuntimeHash, packageSha256: policy.packageSha256 });
    expect(keccak256(runtime.core.code)).toBe(policy.coreRuntimeHash); expect(keccak256(runtime.vault.code)).toBe(policy.vault.runtimeHash);
    expect(keccak256(runtime.token.code)).toBe(policy.tokenRuntimeHash);
    const native = json(`${base}shared-core-markets-2026-10-07/refill/NATIVE_READ_RESULT.json`);
    expect(native.binding.address).toBe(policy.vault.address); expect(native.tokens).toEqual(definitions.map(t => t.address));
  });
  it('derives the prepared policy and preserves the independent vault and four-token rules', () => {
    expect(policy.core.toLowerCase()).toBe(prepared.core);
    expect(policy.graph).toBe(prepared.graph); expect(policy.packageSha256).toBe(prepared.packageSha256);
    expect(policy.coreRuntimeHash).toBe(prepared.runtimes.find(([name]) => name === 'ChainWhisperDexCore')![2]);
    expect(policy.attestationSha256).toBe(prepared.attestationSha256); expect(policy.attestationBlock).toBe(prepared.attestationBlock);
    expect(policy.tokenAdmissionCommitment).toBe(prepared.tokenAdmissionCommitment);
    expect(definitions.map(token => token.address.toLowerCase())).toEqual(prepared.tokens.map(([address]) => address));
    expect(prepared.tokens.every(([, hash]) => hash === policy.tokenRuntimeHash)).toBe(true);
    expect(policy).toMatchObject({ initialAmount: 10_000_000000n, refillAmount: 1_000_000000n, initialQuota: 1_000_000_000000n,
      cooldown: 86_400n, vault: { address: '0xB509dCfaa8a0AB7b976B84f091875246e0FDD8Cf', expiresAt: 1793930246n } });
    const helper = createRequire(import.meta.url)('../../reports/prepared-candidate-2026-10-07/funding-binding/prepare-runtime-fixture.cjs');
    expect(helper.collect()).toEqual(runtimeFixture);
    expect(runtimeFixture.captureSha256).toBe(prepared.attestationSha256);
    expect(runtimeFixture.codes.tokens.map((row: { runtimeHash: string }) => row.runtimeHash)).toEqual(prepared.tokens.map(([, hash]) => hash));
  });
  it('rejects the retired Core runtime at the prepared Core address', async () => {
    const old = json('../../reports/shared-token-distribution-2026-10-07/reader/runtime-fixture.json');
    const f = fixture(); f.codes[lower(policy.core)] = old.codes.core.code;
    await expect(readCurrentSharedDexTokenDistribution(f.args)).rejects.toThrow('runtime');
  });
  it('reads all four assets at one canonical block with immutable public results', async () => {
    const f = fixture(), result = await readCurrentSharedDexTokenDistribution(f.args);
    expect(result.tokens.map(t => t.symbol)).toEqual(['BCN', 'HBR', 'EMBR', 'ORBT']);
    expect(result.tokens.every(t => t.decimals === 6 && t.refillAvailability === 'ready' && t.initialClaimAvailability === 'claimed')).toBe(true);
    expect(result.readyToSign).toBe(false); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.head)).toBe(true);
    expect(Object.isFrozen(result.tokens)).toBe(true); expect(result.tokens.every(Object.isFrozen)).toBe(true);
    expect(f.args.rpc.mock.calls.filter(([method]) => method === 'eth_getTransactionReceipt')).toHaveLength(1);
    expect(f.args.rpc.mock.calls.every(([method]) => ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getTransactionByHash', 'eth_getTransactionReceipt'].includes(method))).toBe(true);
  });
  it.each([0, 1, 2, 3])('keeps initial claim separate from expiry and quota for asset %s', async index => {
    const f = fixture(); f.tokens[index].faucetClaimed = false; f.tokens[index].remainingQuota = 0n;
    let result = await readCurrentSharedDexTokenDistribution(f.args);
    expect(result.tokens[index]).toMatchObject({ initialClaimAvailability: 'ready', refillAvailability: 'initial-claim-required' });
    f.args.head.timestamp = policy.vault.expiresAt;
    result = await readCurrentSharedDexTokenDistribution(f.args);
    expect(result.tokens[index]).toMatchObject({ initialClaimAvailability: 'ready', refillAvailability: 'expired' });
  });
  it.each([0, 1, 2, 3])('checks quota and cooldown independently for asset %s', async index => {
    const f = fixture(); f.tokens[index].remainingQuota = 0n;
    expect((await readCurrentSharedDexTokenDistribution(f.args)).tokens[index].refillAvailability).toBe('exhausted');
    f.tokens[index].remainingQuota = 1000_000000n; f.tokens[index].nextClaimAt = head.timestamp + 1n;
    expect((await readCurrentSharedDexTokenDistribution(f.args)).tokens[index].refillAvailability).toBe('cooldown');
    f.tokens[index].nextClaimAt = head.timestamp;
    expect((await readCurrentSharedDexTokenDistribution(f.args)).tokens[index].refillAvailability).toBe('ready');
  });
  it.each(['chain', 'genesis'] as const)('rejects wrong %s', async kind => {
    const f = fixture(); if (kind === 'chain') f.wrongChain(); else f.wrongGenesis();
    await expect(readCurrentSharedDexTokenDistribution(f.args)).rejects.toThrow('chain or genesis');
  });
  it.each([policy.core, policy.vault.address, ...definitions.map(t => t.address)])('rejects changed runtime %s', async address => {
    const f = fixture(); f.codes[lower(address)] = '0x123456';
    await expect(readCurrentSharedDexTokenDistribution(f.args)).rejects.toThrow('runtime');
  });
  it.each(['releaseId', 'tokenAdmissionCommitment'])('rejects changed Core %s', async key => {
    const f = fixture(); f.core[key] = head.hash; await expect(readCurrentSharedDexTokenDistribution(f.args)).rejects.toThrow('Core identity');
  });
  it.each(['CHAIN_ID', 'TOKEN_A', 'TOKEN_B', 'TOKEN_C', 'TOKEN_D', 'TOKEN_RUNTIME', 'CLAIM_AMOUNT', 'INITIAL_QUOTA', 'COOLDOWN', 'expiresAt', 'recovery'])('rejects changed vault %s', async key => {
    const f = fixture(), value = f.vault[key]; f.vault[key] = typeof value === 'bigint' ? value + 1n : key === 'TOKEN_RUNTIME' ? head.hash : owner;
    await expect(readCurrentSharedDexTokenDistribution(f.args)).rejects.toThrow('vault policy');
  });
  it.each([0, 1, 2, 3])('rejects all token policy drift for asset %s', async index => {
    for (const [key, value] of [['decimals', 18n], ['publicAmountsEnabled', true], ['faucetAmount', 1n], ['remainingQuota', 1n],
      ['remainingQuota', policy.initialQuota + policy.refillAmount], ['nextClaimAt', policy.vault.expiresAt + policy.cooldown + 1n]] as const) {
      const f = fixture(); Object.assign(f.tokens[index], { [key]: value });
      await expect(readCurrentSharedDexTokenDistribution(f.args)).rejects.toThrow('token policy');
    }
  });
  it.each(['input', 'from', 'nonce', 'chainId', 'to', 'blockHash', 'transactionIndex'])('rejects changed deployment transaction %s', async key => {
    const f = fixture(); f.tx[key] = key === 'input' ? '0x1234' : ['nonce', 'chainId', 'transactionIndex'].includes(key) ? '0x1' : owner;
    await expect(readCurrentSharedDexTokenDistribution(f.args)).rejects.toThrow('deployment proof');
  });
  it.each(['status', 'contractAddress', 'blockHash', 'transactionHash', 'transactionIndex'])('rejects changed deployment receipt %s', async key => {
    const f = fixture(); f.receipt[key] = ['status', 'transactionIndex'].includes(key) ? '0x0' : owner;
    if (key === 'transactionIndex') f.receipt[key] = '0x1';
    await expect(readCurrentSharedDexTokenDistribution(f.args)).rejects.toThrow('deployment proof');
  });
  it('rejects changed canonical deployment inclusion', async () => {
    const f = fixture(); f.deploymentBlock.transactions = [head.hash];
    await expect(readCurrentSharedDexTokenDistribution(f.args)).rejects.toThrow('deployment proof');
  });
  it('rejects canonical head drift, session loss, RPC loss and non-canonical ABI data', async () => {
    const f = fixture(); f.reorg(); await expect(readCurrentSharedDexTokenDistribution(f.args)).rejects.toThrow('canonical head');
    const g = fixture(); g.revoke(); await expect(readCurrentSharedDexTokenDistribution(g.args)).rejects.toThrow('Session'); expect(g.args.rpc).not.toHaveBeenCalled();
    const h = fixture(); h.args.rpc.mockImplementationOnce(async () => { h.revoke(); return '0x6c11a0'; });
    await expect(readCurrentSharedDexTokenDistribution(h.args)).rejects.toThrow('Session');
    const i = fixture(); i.args.rpc.mockRejectedValueOnce(new Error('RPC unavailable'));
    await expect(readCurrentSharedDexTokenDistribution(i.args)).rejects.toThrow('RPC unavailable');
    const j = fixture(); j.corrupt(); await expect(readCurrentSharedDexTokenDistribution(j.args)).rejects.toThrow('Non-canonical');
  });
  it('rejects invalid owners and heads before RPC', async () => {
    const f = fixture(); f.args.owner = `0x${'00'.repeat(20)}`;
    await expect(readCurrentSharedDexTokenDistribution(f.args)).rejects.toThrow('owner or head'); expect(f.args.rpc).not.toHaveBeenCalled();
    const g = fixture(); g.args.head.number = 1n;
    await expect(readCurrentSharedDexTokenDistribution(g.args)).rejects.toThrow('owner or head'); expect(g.args.rpc).not.toHaveBeenCalled();
  });
});
