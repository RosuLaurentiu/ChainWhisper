import { Wallet, getBytes, solidityPacked, solidityPackedKeccak256 } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import {
  DEX_V2_CONFIRMATIONS,
  DEX_V2_RECEIPT_TIMEOUT_MS,
  DEX_V2_ROUTE_GAS_LIMIT,
  DEX_V2_SWAP_RECEIPT_ABI,
  encryptDexV2Uint64Input
} from './dexV2SwapExecution';

describe('dexV2SwapExecution', () => {
  const wallet = new Wallet(`0x${'11'.repeat(32)}`);
  const contractAddress = '0x0606060606060606060606060606060606060606';
  const functionSelector = '0x34140ae8';

  it('freezes the reviewed live transaction policy and private receipt surface', () => {
    expect(DEX_V2_ROUTE_GAS_LIMIT).toBe(90_000_000n);
    expect(DEX_V2_CONFIRMATIONS).toBe(5);
    expect(DEX_V2_RECEIPT_TIMEOUT_MS).toBe(60_000);
    expect(DEX_V2_SWAP_RECEIPT_ABI.join('\n')).toContain('DexSwapProcessed');
    expect(DEX_V2_SWAP_RECEIPT_ABI.join('\n')).toContain('getMySwapReceipt');
  });

  it('uses the browser signer authenticated-input path and canonicalizes its signature', async () => {
    const ciphertext = 91n;
    const rawSignature = wallet.signingKey.sign(solidityPackedKeccak256(
      ['address', 'address', 'bytes4', 'uint256'],
      [wallet.address, contractAddress, functionSelector, ciphertext]
    )).serialized;
    const encryptValue = vi.fn(async () => ({
      ciphertext,
      signature: getBytes(rawSignature)
    }));
    await expect(encryptDexV2Uint64Input({ encryptValue, getAddress: async () => wallet.address } as never, {
      plaintext: 50n,
      contractAddress,
      functionSelector
    })).resolves.toEqual({ ciphertext, signature: rawSignature.toLowerCase() });
    expect(encryptValue).toHaveBeenCalledWith(
      50n,
      contractAddress,
      functionSelector
    );
  });

  it('accepts the COTI browser personal-sign format for the same authenticated domain', async () => {
    const ciphertext = 91n;
    const validationMessage = getBytes(solidityPacked(
      ['address', 'address', 'bytes4', 'uint256'],
      [wallet.address, contractAddress, functionSelector, ciphertext]
    ));
    const personalSignature = await wallet.signMessage(validationMessage);
    await expect(encryptDexV2Uint64Input({
      encryptValue: vi.fn(async () => ({ ciphertext, signature: personalSignature })),
      getAddress: async () => wallet.address
    } as never, {
      plaintext: 50n,
      contractAddress,
      functionSelector
    })).resolves.toEqual({ ciphertext, signature: personalSignature.toLowerCase() });
  });

  it('rejects a browser signature from another wallet', async () => {
    const ciphertext = 91n;
    const attacker = new Wallet(`0x${'22'.repeat(32)}`);
    const validationMessage = getBytes(solidityPacked(
      ['address', 'address', 'bytes4', 'uint256'],
      [wallet.address, contractAddress, functionSelector, ciphertext]
    ));
    const personalSignature = await attacker.signMessage(validationMessage);
    await expect(encryptDexV2Uint64Input({
      encryptValue: vi.fn(async () => ({ ciphertext, signature: personalSignature })),
      getAddress: async () => wallet.address
    } as never, {
      plaintext: 50n,
      contractAddress,
      functionSelector
    })).rejects.toThrow(/cannot authenticate private inputs/);
  });

  it('rejects malformed or unsigned wallet encryption results', async () => {
    await expect(encryptDexV2Uint64Input({
      encryptValue: vi.fn(async () => ({ ciphertext: 1n, signature: '0x' })),
      getAddress: async () => wallet.address
    } as never, {
      plaintext: 1n,
      contractAddress,
      functionSelector
    })).rejects.toThrow(/signature/);
    await expect(encryptDexV2Uint64Input({} as never, {
      plaintext: 1n,
      contractAddress: '0x0606060606060606060606060606060606060606',
      functionSelector: '0x34140ae8'
    })).rejects.toThrow(/cannot prepare/);
  });
});
