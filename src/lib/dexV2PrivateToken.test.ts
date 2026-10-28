import { describe, expect, it } from 'vitest';
import {
  DEX_V2_PRIVATE_APPROVAL_GAS_LIMIT,
  DEX_V2_PRIVATE_TOKEN_ABI,
  DexV2AllowancePrivacyRefreshRequiredError,
  isDexV2AllowancePrivacyRefreshRequired
} from './dexV2PrivateToken';

describe('dexV2PrivateToken', () => {
  it('freezes the activation-tested private-token allowance surface and ceiling', () => {
    const abi = DEX_V2_PRIVATE_TOKEN_ABI.join('\n');
    expect(DEX_V2_PRIVATE_APPROVAL_GAS_LIMIT).toBe(10_000_000n);
    expect(abi).toContain('accountEncryptionAddress');
    expect(abi).toContain('reencryptAllowance');
    expect(abi).toContain('approve(address spender,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) amount)');
    expect(abi).toContain('increaseAllowance');
  });

  it('distinguishes an obsolete allowance ciphertext from ordinary execution failures', () => {
    expect(isDexV2AllowancePrivacyRefreshRequired(
      new DexV2AllowancePrivacyRefreshRequiredError()
    )).toBe(true);
    expect(isDexV2AllowancePrivacyRefreshRequired(new Error('reverted'))).toBe(false);
  });
});
