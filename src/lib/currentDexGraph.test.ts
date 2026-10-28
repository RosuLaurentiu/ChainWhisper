import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { id, Interface, keccak256, toBeHex, toUtf8Bytes } from '@coti-io/coti-ethers';
import { decodeUint, encodeKey, encrypt } from '@coti-io/coti-sdk-typescript';
import { describe, expect, it, vi } from 'vitest';
import { createDexV2ReadCapability, readCurrentDexGraph } from './dexV2Chain';
import { issueCurrentDexReceiptCapability } from '../features/wallet/currentDexReceiptCapability';
import { CURRENT_DEX_OPERATION_ABI, CURRENT_DEX_RECEIPT_ABI } from './currentDexOperation';
import { CURRENT_DEX_ACCEPT_ABI, prepareCurrentDexAcceptance } from './currentDexQuoteReview';

const mockIssuer = vi.hoisted(() => vi.fn());
vi.mock('../features/wallet/ownerCotiMetaMaskCapability', () => ({ issueOwnerCotiMetaMaskCapability: mockIssuer }));

// Derive from retained compiler artifacts, not a hand-written approximation of the graph.
const native = createRequire(resolve('../ChainWhisper Contracts V2/validation/package.json'));
const { PIN: graph, ROLES, expectedBindings, expectedFactory, collectGraphState } =
  native('./candidates/recurring-linked-limits/client-bindings.js');
const roles = Object.keys(ROLES);
const configuration = { graph, chainId: '7082400', releaseId: id('local-release'), marketId: id('local-market'),
  feePpm: '1000', maxWorkLifetime: '2000', inputToken: toBeHex(100, 20), outputToken: toBeHex(101, 20),
  inputRuntimeHash: keccak256('0x6001'), outputRuntimeHash: keccak256('0x6002'),
  addresses: Object.fromEntries(roles.map((role, i) => [role, toBeHex(i + 1, 20)])) };
const chunks = { first: toBeHex(200, 20), second: toBeHex(201, 20) };
const bindings = expectedBindings(configuration), factory = expectedFactory({ graph,
  factory: configuration.addresses.factory, owner: configuration.addresses.fixedOwner,
  recurringOwner: configuration.addresses.recurringOwner, ...chunks });
const network = { chainId: '7082400', genesisHash: id('local-genesis'), blockNumber: 42, blockHash: id('local-block') };
const owner = toBeHex(300, 20), aesKey = '000102030405060708090a0b0c0d0e0f';
const op = new Interface(CURRENT_DEX_OPERATION_ABI), receiptAbi = new Interface(CURRENT_DEX_RECEIPT_ABI);
const releaseAbi = new Interface(['function releaseId() view returns(bytes32)']);
const seal = (value: bigint) => {
  const bytes = new Uint8Array(16);
  for (let i = 15; i >= 0; i--) { bytes[i] = Number(value & 255n); value >>= 8n; }
  const result = encrypt(encodeKey(aesKey), bytes);
  return decodeUint(new Uint8Array([...result.ciphertext, ...result.r]));
};
const receiptData = receiptAbi.encodeFunctionResult('principalReceipt', [[[11n, seal(1n)],
  ...[500n, 400n, 100n, 303n, 3n, 300n].map(n => [[111n, 222n], [seal(0n), seal(n)]])]]);
const manifestJson = JSON.stringify({ chainId: network.chainId, genesisHash: network.genesisHash, bindings, factory,
  tokens: [{ address: configuration.inputToken, runtimeHash: configuration.inputRuntimeHash },
    { address: configuration.outputToken, runtimeHash: configuration.outputRuntimeHash }] }, (_, value) => typeof value === 'bigint' ? value.toString() : value);
type Manifest = { bindings: { runtimes: Record<string, { address: string; code: string; fields: Array<{ slot: string; mask: string; expected: string }> }> };
  factory: { address: string; storage: Record<string, string>; chunks: Array<{ address: string; code: string }> } };
const m: Manifest = JSON.parse(manifestJson);
const codes = Object.fromEntries([...Object.values(m.bindings.runtimes), ...m.factory.chunks].map(r => [r.address.toLowerCase(), r.code]));
codes[configuration.inputToken] = '0x6001'; codes[configuration.outputToken] = '0x6002';
const words: Record<string, bigint> = {};
const fields: Array<{ address: string; slot: string; mask: bigint }> = [];
for (const r of Object.values(m.bindings.runtimes)) for (const f of r.fields) {
  const key = `${r.address.toLowerCase()}:${BigInt(f.slot)}`;
  words[key] = (words[key] ?? 0n) | BigInt(f.expected);
  fields.push({ address: r.address.toLowerCase(), slot: f.slot, mask: BigInt(f.mask) });
}
for (const [slot, value] of Object.entries(m.factory.storage)) {
  words[`${m.factory.address.toLowerCase()}:${BigInt(slot)}`] = BigInt(value);
  fields.push({ address: m.factory.address.toLowerCase(), slot, mask: (1n << 256n) - 1n });
}

const request = (fault: { runtime?: string; field?: typeof fields[number]; guard?: string } = {}) => {
  let chains = 0, blocks = 0, current = true;
  const assertCurrent = () => { if (!current) throw new Error('Session revoked'); };
  const send = vi.fn(async ({ method, params }: { method: string; params?: readonly unknown[] | object }) => {
    const p = params as unknown[];
    if (method === 'eth_chainId') return fault.guard === 'chain' && ++chains > 1 ? '0x1' : '0x6c11a0';
    if (method === 'eth_getBlockByNumber') {
      const number = BigInt(p[0] as string);
      expect([0n, 42n]).toContain(number);
      if (!number) return { number: '0x0', hash: fault.guard === 'genesis' ? id('wrong') : network.genesisHash };
      return { number: '0x2a', timestamp: '0x63', hash: fault.guard === 'reorg' && ++blocks > 1 ? id('reorg') : network.blockHash };
    }
    expect(p[p.length - 1]).toEqual({ blockHash: network.blockHash, requireCanonical: true });
    if (method === 'eth_call') {
      const call = p[0] as { to: string; from?: string; data: string };
      expect(call.to).toBe(configuration.addresses.core);
      if (call.data === releaseAbi.encodeFunctionData('releaseId')) return releaseAbi.encodeFunctionResult('releaseId', [configuration.releaseId]);
      if (call.data === op.encodeFunctionData('operationPublic', [7n])) return op.encodeFunctionResult('operationPublic', [[true, false, id('intent'), 2, 0, 1n, 100n, 8n, 30n]]);
      expect(call.data).toBe(receiptAbi.encodeFunctionData('principalReceipt', [7n]));
      expect(call.from).toBe(owner);
      if (fault.guard === 'receipt-session') current = false;
      return receiptData;
    }
    const at = p[0] as string;
    if (method === 'eth_getCode') {
      expect(codes).toHaveProperty(at);
      if (fault.guard === 'session') current = false;
      return at === fault.runtime ? '0x00' : codes[at];
    }
    if (method === 'eth_getStorageAt') {
      const slot = BigInt(p[1] as string).toString(), key = `${at}:${slot}`;
      expect(words).toHaveProperty(key);
      const bit = fault.field?.mask ?? 0n;
      return fault.guard === 'malformed-storage' ? '0x0' : toBeHex(words[key] ^
        (at === fault.field?.address && slot === fault.field.slot ? bit & -bit : 0n), 32);
    }
    throw new Error(`Unexpected RPC ${method}`);
  });
  return { send, assertCurrent, revoke: () => { current = false; },
    capability: createDexV2ReadCapability({ provider: { request: send }, chainId: 7082400n, assertCurrent }) };
};
const args = { manifestJson, expectedManifestHash: keccak256(toUtf8Bytes(manifestJson)), blockNumber: 42n, blockHash: network.blockHash };

describe('current DEX public graph identity', () => {
  it('joins graph-bound owner decryption, review and unsigned Accept; rejects invalid graph or revoked session', async () => {
    for (const fault of ['', 'runtime', 'receipt-session', 'review-session']) {
      const p = request({ runtime: fault === 'runtime' ? configuration.addresses.engine : undefined,
        guard: fault === 'receipt-session' ? fault : undefined });
      // Extension/session issuance is mocked here; graph/receipt readers and SDK decryption are real.
      mockIssuer.mockImplementation(async args => args.bindCapability({ assertCurrent: p.assertCurrent,
        assertSnapshotCurrent: p.assertCurrent, readProvider: { send: (method: string, params: unknown[]) => p.send({ method, params }) },
        signer: { getUserOnboardInfo: () => ({ aesKey }) }, chainId: 7082400n, ownerAddress: owner }));
      const capability = await issueCurrentDexReceiptCapability({} as never);
      const intent = { chainId: 7082400n, core: configuration.addresses.core, runtimeHash: bindings.runtimes.core.hash,
        releaseId: configuration.releaseId, principal: owner, operationId: 7n, contextHash: id('intent'), deadline: 100n,
        maximumInput: 500n, minimumOutput: 300n, rateNumerator: 3n, rateDenominator: 4n };
      const confirm = vi.fn(async () => { if (fault === 'review-session') p.revoke(); return true; });
      const result = prepareCurrentDexAcceptance({ intent, input: { symbol: 'IN', decimals: 6 }, output: { symbol: 'OUT', decimals: 6 },
        now: () => 99n, confirm, readReceipt: () => capability.readFromGraph({ ...args, operationId: 7n }) });
      if (fault) await expect(result).rejects.toThrow();
      else {
        expect(await result).toMatchObject({ from: owner, to: configuration.addresses.core, value: 0n, readyToSign: false,
          data: new Interface(CURRENT_DEX_ACCEPT_ABI).encodeFunctionData('acceptPrivateSwapV1', [7n, id('intent')]) });
        const submitted = { ...args, operationId: 7n };
        const reading = capability.readFromGraph(submitted);
        submitted.operationId = 8n;
        expect((await reading).operationId).toBe(7n);
      }
      expect(confirm).toHaveBeenCalledTimes(!fault || fault === 'review-session' ? 1 : 0);
      if (fault === 'runtime') expect(p.send.mock.calls.some(([r]) => r.method === 'eth_call')).toBe(false);
    }
  });

  it('matches native graph expectations and checks every runtime and public storage slot without writes', async () => {
    const p = request(), result = await readCurrentDexGraph({ ...args, capability: p.capability });
    expect(result).toMatchObject({ graph, runtimeCount: 21, publicFieldCount: 36, factoryFieldCount: 4, readyToSign: false,
      inputToken: configuration.inputToken, outputToken: configuration.outputToken,
      maxWorkLifetime: 2000n, block: { number: 42n, hash: network.blockHash, timestamp: 99n } });
    const codeReads = p.send.mock.calls.filter(([r]) => r.method === 'eth_getCode');
    expect(codeReads).toHaveLength(21);
    expect(fields).toHaveLength(40);
    expect(p.send.mock.calls.filter(([r]) => r.method === 'eth_getStorageAt')).toHaveLength(Object.keys(words).length);
    // The retained verifier sees the same generated graph and Factory observations.
    const retained = await collectGraphState({ getNetwork: async () => ({ chainId: 7082400n }),
      getBlock: async (number: number) => ({ number, hash: number === 0 ? network.genesisHash : network.blockHash }),
      getCode: async (at: string) => codes[at.toLowerCase()],
      getStorage: async (at: string, slot: string) => toBeHex(words[`${at.toLowerCase()}:${BigInt(slot)}`], 32)
    }, configuration, chunks, network);
    expect(retained.exactPublicBindings).toBe(true);
    expect(retained.records.reduce((n: number, r: { fieldCount: number }) => n + r.fieldCount, 0)).toBe(result.publicFieldCount);
  }, 60_000); // Retained verifier reloads and hash-checks the compiler closure; no network wait.

  it.each(Object.keys(codes))('rejects changed runtime %s', async runtime => {
    await expect(readCurrentDexGraph({ ...args, capability: request({ runtime }).capability })).rejects.toThrow('runtime hash');
  });

  it.each(fields)('rejects changed public field at $address slot $slot', async field => {
    await expect(readCurrentDexGraph({ ...args, capability: request({ field }).capability })).rejects.toThrow('storage differs');
  });

  it.each(['chain', 'genesis', 'reorg', 'session', 'malformed-storage'])('rejects graph guard failure %s', async guard => {
    await expect(readCurrentDexGraph({ ...args, capability: request({ guard }).capability })).rejects.toThrow();
  });

  it('rejects changed or incomplete manifests before RPC', async () => {
    const malformed: Array<(manifest: any) => void> = [
      manifest => { delete manifest.bindings.quoteVersion; },
      manifest => { manifest.bindings.quoteVersion = 1; },
      manifest => { delete manifest.bindings.runtimes.swapAdmission; },
      manifest => { manifest.bindings.runtimes.core.fields.push({ ...manifest.bindings.runtimes.core.fields[0] }); },
      manifest => { manifest.tokens[1] = { ...manifest.tokens[0] }; },
      manifest => { [manifest.tokens[0], manifest.tokens[1]] = [manifest.tokens[1], manifest.tokens[0]]; },
      manifest => { manifest.factory.chunks[1] = { ...manifest.factory.chunks[0] }; },
      manifest => { delete manifest.factory.storage['3']; }
    ];
    for (const mutate of malformed) {
      const p = request(), parsed = JSON.parse(manifestJson);
      mutate(parsed);
      const raw = JSON.stringify(parsed);
      await expect(readCurrentDexGraph({ ...args, capability: p.capability, manifestJson: raw,
        expectedManifestHash: keccak256(toUtf8Bytes(raw)) })).rejects.toThrow();
      expect(p.send).not.toHaveBeenCalled();
    }
    const p = request();
    await expect(readCurrentDexGraph({ ...args, capability: p.capability, manifestJson: `${manifestJson} ` })).rejects.toThrow('manifest hash');
    expect(p.send).not.toHaveBeenCalled();
  });
});
