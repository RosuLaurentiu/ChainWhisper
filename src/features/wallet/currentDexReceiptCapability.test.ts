import { decodeUint, encodeKey, encrypt } from '@coti-io/coti-sdk-typescript';
import { describe, expect, it, vi } from 'vitest';
import { issueCurrentDexReceiptCapability } from './currentDexReceiptCapability';
import { Interface, keccak256 } from '@coti-io/coti-ethers';
import { COTI_NETWORK, loadCotiReadProvider, type InjectedEthereumProvider } from '../../lib/appShared';
import { CURRENT_DEX_OPERATION_ABI, CURRENT_DEX_RECEIPT_ABI } from '../../lib/currentDexOperation';
import { buildCurrentDexQuoteReview, CURRENT_DEX_ACCEPT_ABI, prepareCurrentDexAcceptance } from '../../lib/currentDexQuoteReview';
import type { BrowserWalletSignerLease } from './hooks/useWalletOnboarding';

const mocks = vi.hoisted(() => ({ issue: vi.fn(), read: vi.fn() }));
vi.mock('./ownerCotiMetaMaskCapability', () => ({ issueOwnerCotiMetaMaskCapability: mocks.issue }));
vi.mock('../../lib/appChain', () => ({ readCurrentDexPrincipalReceipt: mocks.read }));

const key = '000102030405060708090a0b0c0d0e0f';
const owner = `0x${'11'.repeat(20)}`;
const encryptWord = (value: bigint) => {
  const bytes = new Uint8Array(16);
  for (let i = 15; i >= 0; i--) { bytes[i] = Number(value & 255n); value >>= 8n; }
  const sealed = encrypt(encodeKey(key), bytes);
  return decodeUint(new Uint8Array([...sealed.ciphertext, ...sealed.r]));
};
const encryptAmount = (value: bigint) => ({
  ciphertextHigh: encryptWord(value >> 128n), ciphertextLow: encryptWord(value & ((1n << 128n) - 1n))
});

describe('current DEX selected-owner receipt decryption', () => {
  it('joins the real owner issuer, block-pinned receipt, SDK decryption and quote review without writes', async () => {
    const issuer = await vi.importActual<typeof import('./ownerCotiMetaMaskCapability')>('./ownerCotiMetaMaskCapability');
    const reader = await vi.importActual<typeof import('../../lib/dexV2Chain')>('../../lib/dexV2Chain');
    mocks.issue.mockImplementation(issuer.issueOwnerCotiMetaMaskCapability);
    mocks.read.mockImplementation(reader.readCurrentDexPrincipalReceipt);
    const chainId = BigInt(COTI_NETWORK.chainIdDecimal), hash = `0x${'22'.repeat(32)}`;
    const core = `0x${'33'.repeat(20)}`;
    const expected = { chainId, core, runtimeHash: keccak256('0x6000'), releaseId: hash, blockNumber: 50n, blockHash: hash };
    const op = new Interface(CURRENT_DEX_OPERATION_ABI), receipts = new Interface(CURRENT_DEX_RECEIPT_ABI);
    const release = new Interface(['function releaseId() view returns(bytes32)']);
    const amount = (n: bigint) => [[111n, 222n], Object.values(encryptAmount(n))];
    const receiptData = receipts.encodeFunctionResult('principalReceipt', [[[11n, encryptWord(1n)],
      ...[500n, 400n, 100n, 303n, 3n, 300n].map(amount)]]);
    let current = true, revokeDuringReceipt = false;
    const assertCurrent = () => { if (!current) throw new Error('Session revoked'); };
    const provider: InjectedEthereumProvider = { isMetaMask: true, request: vi.fn(async () => { throw new Error('Unexpected wallet RPC'); }) };
    const session = { address: owner, chainId: Number(chainId), provider, source: 'injected' as const, walletId: 'metamask', walletLabel: 'MetaMask' };
    const lease: BrowserWalletSignerLease = { epoch: 1, address: owner, chainId: Number(chainId), activeAddress: owner,
      activeChainId: Number(chainId), activeProvider: provider, signingProvider: provider, sessionProvider: provider,
      activeSignerSource: 'metamask', source: 'injected', session };
    const rpc = await loadCotiReadProvider(true);
    const send = vi.spyOn(rpc, 'send').mockImplementation(async (method, params) => {
      if (method === 'eth_chainId') return `0x${chainId.toString(16)}`;
      if (method === 'eth_getBlockByNumber') return { number: '0x32', hash, timestamp: '0x5a' };
      if (method === 'eth_getCode') { expect(params).toEqual([core, { blockHash: hash, requireCanonical: true }]); return '0x6000'; }
      if (method !== 'eth_call' || !Array.isArray(params)) throw new Error('Unexpected RPC');
      const [call, block] = params;
      expect(block).toEqual({ blockHash: hash, requireCanonical: true });
      expect(call.to).toBe(core);
      if (call.data === release.encodeFunctionData('releaseId')) return release.encodeFunctionResult('releaseId', [hash]);
      if (call.data === op.encodeFunctionData('operationPublic', [7n])) return op.encodeFunctionResult('operationPublic', [[true, false, hash, 2, 0, 1n, 100n, 8n, 30n]]);
      expect(call.data).toBe(receipts.encodeFunctionData('principalReceipt', [7n]));
      expect(call.from).toBe(owner);
      if (revokeDuringReceipt) current = false;
      return receiptData;
    });
    try {
      const capability = await issueCurrentDexReceiptCapability({ lease, expectedChainId: chainId, expectedOwnerAddress: owner,
        assertLeaseCurrent: async () => assertCurrent(), assertLeaseSnapshotCurrent: assertCurrent,
        sessionOnboardInfo: { [owner]: { aesKey: key } } });
      const receipt = await capability.read({ expected, operationId: 7n });
      const intent = { ...expected, principal: owner, operationId: 7n, contextHash: hash, deadline: 100n,
        maximumInput: 500n, minimumOutput: 300n, rateNumerator: 3n, rateDenominator: 4n };
      const reviewArgs = { receipt, intent, now: 99n, input: { symbol: 'IN', decimals: 6 }, output: { symbol: 'OUT', decimals: 6 } };
      expect(buildCurrentDexQuoteReview(reviewArgs).summaryRows).toContainEqual({ label: 'You receive', value: '0.0003 OUT' });
      expect(receipt.amounts.refund).toBe(100n);
      expect(() => buildCurrentDexQuoteReview({ ...reviewArgs, now: 100n })).toThrow('acceptance');
      const handoff = { ...reviewArgs, now: () => 99n, readReceipt: () => capability.read({ expected, operationId: 7n }) };
      const unsigned = await prepareCurrentDexAcceptance({ ...handoff, confirm: async () => true });
      expect(unsigned).toMatchObject({ from: owner, to: core, value: 0n, readyToSign: false,
        data: new Interface(CURRENT_DEX_ACCEPT_ABI).encodeFunctionData('acceptPrivateSwapV1', [7n, hash]) });
      await expect(prepareCurrentDexAcceptance({ ...handoff, confirm: async () => { current = false; return true; } })).rejects.toThrow('Session revoked');
      current = true;
      revokeDuringReceipt = true;
      await expect(capability.read({ expected, operationId: 7n })).rejects.toThrow('Session revoked');
      expect(provider.request).not.toHaveBeenCalled();
    } finally {
      issuer.releaseOwnerCotiMetaMaskProviderPool(provider);
      send.mockRestore();
    }
  });

  it('uses real SDK ciphertext, keeps uint256 precision and rejects locked, revoked or inconsistent results', async () => {
    const maximum = (1n << 256n) - 1n;
    for (const fault of ['', 'locked', 'revoked-read', 'revoked-return', 'boolean', 'amounts']) {
      let current = true, checks = 0;
      const assertCurrent = vi.fn(async () => {
        if (++checks === 3 && fault === 'revoked-return') current = false;
        if (!current) throw new Error('Session revoked');
      });
      const send = vi.fn();
      const signer = { getUserOnboardInfo: () => ({ aesKey: fault === 'locked' ? '' : key }) };
      mocks.issue.mockImplementation(async args => {
        expect(args.requirePrivacy).toBe(true);
        return args.bindCapability({ assertCurrent, assertSnapshotCurrent: () => {
          if (!current) throw new Error('Session revoked');
        }, readProvider: { send }, signer, chainId: 7082400n, ownerAddress: owner });
      });
      mocks.read.mockImplementation(async args => {
        expect(args.principal).toBe(owner);
        if (fault === 'revoked-read') current = false;
        return { kind: 'quote', operationId: 7n, principal: owner, encrypted: {
          filled: encryptWord(fault === 'boolean' ? 2n : 1n),
          maximumInput: encryptAmount(maximum), actualInput: encryptAmount(maximum - 1n),
          refund: encryptAmount(1n), grossOutput: encryptAmount(103n), fee: encryptAmount(3n),
          netOutput: encryptAmount(fault === 'amounts' ? 101n : 100n)
        } };
      });
      const capability = await issueCurrentDexReceiptCapability({} as never);
      const pending = capability.read({ operationId: 7n } as never);
      if (fault) await expect(pending).rejects.toThrow();
      else {
        const result = await pending;
        expect(result.kind).toBe('quote');
        expect(result.amounts).toEqual({ filled: true, maximumInput: maximum, actualInput: maximum - 1n,
          refund: 1n, grossOutput: 103n, fee: 3n, netOutput: 100n });
        expect(result).not.toHaveProperty('encrypted');
        expect(capability).not.toHaveProperty('signer');
      }
      expect(send).not.toHaveBeenCalled();
    }
  });

  it('decrypts both current-mode receipts for the selected owner without exposing keys or a signer', async () => {
    const maximum = (1n << 255n) + 7n;
    for (const profile of ['fast-pool', 'cheap-async'] as const) {
      let current = true;
      const assertCurrent = async () => { if (!current) throw new Error('Session revoked'); };
      const send = vi.fn();
      mocks.issue.mockImplementation(async args => args.bindCapability({ assertCurrent,
        assertSnapshotCurrent: () => { if (!current) throw new Error('Session revoked'); },
        readProvider: { send }, signer: { getUserOnboardInfo: () => ({ aesKey: key }) },
        chainId: 7082400n, ownerAddress: owner }));
      mocks.read.mockImplementation(async args => {
        expect(args.profile).toBe(profile); expect(args.principal).toBe(owner);
        return { kind: 'quote', principal: owner, operationId: 7n,
          operation: { profile, ready: true, phase: 'quote-prepared' }, encrypted: {
            filled: encryptWord(1n), maximumInput: encryptAmount(maximum), actualInput: encryptAmount(maximum - 1n),
            refund: encryptAmount(1n), grossOutput: encryptAmount(103n), fee: encryptAmount(3n), netOutput: encryptAmount(100n)
          } };
      });
      const capability = await issueCurrentDexReceiptCapability({} as never);
      const request = { profile, operationId: 7n } as Parameters<typeof capability.readCurrent>[0];
      const receipt = await capability.readCurrent(request);
      expect(receipt.operation).toMatchObject({ profile, ready: true, phase: 'quote-prepared' });
      expect(receipt.amounts).toEqual({ filled: true, maximumInput: maximum, actualInput: maximum - 1n,
        refund: 1n, grossOutput: 103n, fee: 3n, netOutput: 100n });
      expect(receipt).not.toHaveProperty('encrypted'); expect(receipt).not.toHaveProperty('aesKey');
      expect(capability).not.toHaveProperty('signer'); expect(send).not.toHaveBeenCalled();
      current = false;
      await expect(capability.readCurrent(request)).rejects.toThrow('Session revoked');
    }
  });
});
