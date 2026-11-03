import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonRpcSigner } from '@coti-io/coti-ethers';

const mocks = vi.hoisted(() => ({
  allowance: 0n,
  read: vi.fn(),
  write: vi.fn(),
  receipt: vi.fn(),
  encrypt: vi.fn(),
  encryptionAddress: vi.fn(),
  block: vi.fn()
}));

vi.mock('./appShared', async original => ({
  ...await original<typeof import('./appShared')>(),
  loadCotiReadProvider: async () => ({ call: mocks.read, getBlock: mocks.block }),
  loadCotiEthersModule: async () => ({
    Interface: class {
      encodeFunctionData() { return 'allowance'; }
      decodeFunctionResult(_name: string, value: unknown) { return [{ ownerCiphertext: value }]; }
      getFunction() { return { selector: '0x12345678' }; }
    },
    Contract: class {
      allowance = mocks.read;
      accountEncryptionAddress = mocks.encryptionAddress;
      setAccountEncryptionAddress = (address: string) => mocks.write('setup', address, 0n);
      approve = (spender: string, amount: bigint) => mocks.write('public', spender, amount);
      ['approve(address,((uint256,uint256),bytes))'] = Object.assign(
        (spender: string, amount: bigint) => mocks.write('approve', spender, amount),
        { estimateGas: async () => 100_000n }
      );
      ['increaseAllowance(address,((uint256,uint256),bytes))'] = Object.assign(
        (spender: string, amount: bigint) => mocks.write('increase', spender, amount),
        { estimateGas: async () => 100_000n }
      );
      ['decreaseAllowance(address,((uint256,uint256),bytes))'] = Object.assign(
        (spender: string, amount: bigint) => mocks.write('decrease', spender, amount),
        { estimateGas: async () => 100_000n }
      );
    }
  })
}));
vi.mock('./privateUint256', async original => ({
  ...await original<typeof import('./privateUint256')>(),
  encryptPrivateUint256Input: mocks.encrypt
}));
vi.mock('./publicTransactionReceipt', () => ({ waitForPublicTransactionReceipt: mocks.receipt }));

import { ensurePrivateTokenAccountEncryptionAddress, ensureTradeTokenAllowance } from './appChain';

const owner = '0x1111111111111111111111111111111111111111';
const token = '0x2222222222222222222222222222222222222222';
const spender = '0x3333333333333333333333333333333333333333';
const signer = { decryptValue: async (value: unknown) => value } as unknown as JsonRpcSigner;
const ensure = (kind: 'erc20' | 'private-erc20', amount = 10n, tokenAddress = token) =>
  ensureTradeTokenAllowance(signer, owner, tokenAddress, amount, kind, spender);

it('preserves a public postapproval read failure without reporting a numeric mismatch or sending twice', async () => {
  const cause = new Error('Reread failed');
  mocks.read.mockResolvedValueOnce(0n).mockRejectedValueOnce(cause);
  const failure = await ensure('erc20').catch(error => error);
  expect(failure).toMatchObject({
    message: 'Public token allowance could not be read after approval.', cause
  });
  expect(Object.prototype.propertyIsEnumerable.call(failure, 'cause')).toBe(false);
  expect(mocks.write).toHaveBeenCalledOnce();
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowance = 0n;
  mocks.encryptionAddress.mockReset().mockResolvedValue(owner);
  mocks.read.mockReset().mockImplementation(async () => mocks.allowance);
  mocks.encrypt.mockImplementation(async (_signer, amount) => amount);
  mocks.block.mockResolvedValue({ gasLimit: 30_000_000n });
  mocks.receipt.mockResolvedValue({ status: 1 });
  mocks.write.mockImplementation(async (method: string, _spender: string, amount: bigint) => {
    mocks.allowance = method === 'increase' ? mocks.allowance + amount
      : method === 'decrease' ? mocks.allowance - amount : amount;
    return { hash: '0xapproval' };
  });
});

describe('private token setup admission', () => {
  it('keeps setup available after a successful different-address read', async () => {
    mocks.encryptionAddress.mockResolvedValue(spender);
    await expect(ensurePrivateTokenAccountEncryptionAddress({
      signer, tokenAddress: '0x6666666666666666666666666666666666666666', ownerAddress: owner
    })).resolves.toBe(true);
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith('setup', owner, 0n);
  });
  it.each(['rejected', 'invalid'] as const)('stops before a setup write when its read is %s', async state => {
    if (state === 'rejected') mocks.encryptionAddress.mockRejectedValue(new Error('RPC failed'));
    else mocks.encryptionAddress.mockResolvedValue(null);
    const unreadableToken = state === 'rejected'
      ? '0x4444444444444444444444444444444444444444'
      : '0x5555555555555555555555555555555555555555';
    await expect(ensurePrivateTokenAccountEncryptionAddress({ signer, tokenAddress: unreadableToken, ownerAddress: owner }))
      .rejects.toThrow('Private token encryption address could not be read before setup.');
    expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe.each(['erc20', 'private-erc20'] as const)('%s trade allowance through the real helper', kind => {
  it.each([0n, 3n, 20n])('sets allowance %s to the exact required amount', async initial => {
    mocks.allowance = initial;
    await ensure(kind);
    expect(mocks.allowance).toBe(10n);
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.write.mock.calls[0][1]).toBe(spender);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('reuses only an exact allowance without a write', async () => {
    mocks.allowance = 10n;
    await ensure(kind);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each([0n, -1n])('does not send for non-positive amount %s', async amount => {
    await ensure(kind, amount);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('does not send for an invalid token address', async () => {
    await ensure(kind, 10n, 'invalid');
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('stops on an allowance read error before approval', async () => {
    mocks.read.mockRejectedValue(new Error('Allowance RPC failed'));
    await expect(ensure(kind)).rejects.toThrow();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('stops when allowance cannot be read', async () => {
    mocks.read.mockResolvedValue(null);
    await expect(ensure(kind)).rejects.toThrow();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('stops on an allowance reread error without another approval', async () => {
    mocks.read.mockResolvedValueOnce(0n).mockRejectedValueOnce(new Error('Reread failed'));
    await expect(ensure(kind)).rejects.toThrow();
    expect(mocks.write).toHaveBeenCalledOnce();
  });

  it('rejects a confirmed allowance above the requested amount', async () => {
    mocks.read.mockResolvedValueOnce(0n).mockResolvedValueOnce(11n);
    await expect(ensure(kind)).rejects.toThrow();
    expect(mocks.write).toHaveBeenCalledOnce();
  });
});
