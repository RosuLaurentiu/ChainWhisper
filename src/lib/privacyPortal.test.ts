import { describe, expect, it } from 'vitest';
import { Interface } from '@coti-io/coti-ethers';
import { resolvePrivateTokenAllowanceWritePlan } from './appChain';
import {
  COTI_PRIVACY_PORTAL_CHAIN_ID,
  PRIVACY_ERC20_BRIDGE_ABI,
  PRIVACY_NATIVE_BRIDGE_ABI,
  PRIVACY_PORTAL_REGISTRY_VERSION,
  PRIVACY_TOKEN_PAIRS,
  applyPrivacyPortalGasMargin,
  buildPrivacyPortalQuoteKey,
  buildPrivacyPortalTransactionCall,
  calculatePrivacyPortalGasReserveWei,
  getPrivacyTokenPair,
  normalizePrivacyPortalError,
  parsePrivacyAmountInput,
  resolvePrivacyPortalAllowanceRequirement,
  resolvePrivacyPortalReceiveAmount,
  selectPrivacyPortalNativeGasProbeAmount,
  validatePrivacyPortalAmount
} from './privacyPortal';

describe('Privacy Portal registry', () => {
  it('pins all seven official COTI mainnet pairs with exact bridge and token metadata', () => {
    expect(PRIVACY_PORTAL_REGISTRY_VERSION).toBe('coti-mainnet-2026-07-22');
    expect(PRIVACY_TOKEN_PAIRS).toHaveLength(7);
    expect(
      PRIVACY_TOKEN_PAIRS.map((pair) => ({
        id: pair.id,
        chainId: pair.chainId,
        bridge: pair.bridgeAddress,
        publicToken: pair.publicToken.address,
        privateToken: pair.privateToken.address,
        decimals: pair.publicToken.decimals
      }))
    ).toEqual([
      {
        id: 'coti',
        chainId: COTI_PRIVACY_PORTAL_CHAIN_ID,
        bridge: '0x44D864973392064304dD88E2BDef39fF1ab11b7b',
        publicToken: null,
        privateToken: '0xD2F2692B83C3ecDF2EAa0f7c2632BBd46Ae1cC91',
        decimals: 18
      },
      {
        id: 'weth',
        chainId: COTI_PRIVACY_PORTAL_CHAIN_ID,
        bridge: '0x7286c83300f0C7131b4006f3cf9F8e44BeB45c13',
        publicToken: '0x639aCc80569c5FC83c6FBf2319A6Cc38bBfe26d1',
        privateToken: '0x4727FE8D8450CEBcB142331FAc034Cd8d311f0E5',
        decimals: 18
      },
      {
        id: 'wbtc',
        chainId: COTI_PRIVACY_PORTAL_CHAIN_ID,
        bridge: '0xc3B7EdEe4f1c0A0bA1AcD341e4982371eC869862',
        publicToken: '0x8C39B1fD0e6260fdf20652Fc436d25026832bfEA',
        privateToken: '0x65449561257ba5756631Aa0d34f07f6457a319be',
        decimals: 8
      },
      {
        id: 'usdt',
        chainId: COTI_PRIVACY_PORTAL_CHAIN_ID,
        bridge: '0x7685B473DAF1c6DeD815Ca64C6fa18Da2227440D',
        publicToken: '0xfA6f73446b17A97a56e464256DA54AD43c2Cbc3E',
        privateToken: '0x42107250C3D385ddfABE69ab6de163702040FeB0',
        decimals: 6
      },
      {
        id: 'usdc-e',
        chainId: COTI_PRIVACY_PORTAL_CHAIN_ID,
        bridge: '0x29334fC23ffa2c44AF1b372336C2296591Eadd86',
        publicToken: '0xf1Feebc4376c68B7003450ae66343Ae59AB37D3C',
        privateToken: '0x63C9a1D05471fc8d47C83968725Dcfdcb5410392',
        decimals: 6
      },
      {
        id: 'wada',
        chainId: COTI_PRIVACY_PORTAL_CHAIN_ID,
        bridge: '0xFa2126C07F517013c8d237cc465342da89B96f92',
        publicToken: '0xe757Ca19d2c237AA52eBb1d2E8E4368eeA3eb331',
        privateToken: '0x3a8b49aAC1dAD86aa45a75231FbeC5bEb810e416',
        decimals: 6
      },
      {
        id: 'gcoti',
        chainId: COTI_PRIVACY_PORTAL_CHAIN_ID,
        bridge: '0xD4e0d9AB16b48c68044cB6aeA3A089380d6D8cD4',
        publicToken: '0x7637C7838EC4Ec6b85080F28A678F8E234bB83D1',
        privateToken: '0x394b3c4328160f000763Ca391D07F902926EDaAc',
        decimals: 18
      }
    ]);
    expect(PRIVACY_TOKEN_PAIRS.every((pair) => pair.privateToken.decimals === pair.publicToken.decimals)).toBe(true);
    expect(getPrivacyTokenPair('coti')?.bridgeKind).toBe('native');
    expect(getPrivacyTokenPair('missing')).toBeNull();
  });

  it('keeps native and ERC-20 bridge ABI overloads parseable', () => {
    const native = new Interface(PRIVACY_NATIVE_BRIDGE_ABI);
    const erc20 = new Interface(PRIVACY_ERC20_BRIDGE_ABI);

    expect(native.getFunction('deposit(uint256,uint256)')?.payable).toBe(true);
    expect(native.getFunction('withdraw(uint256,uint256,uint256)')?.payable).toBe(false);
    expect(native.getFunction('estimateDepositFee')?.outputs).toHaveLength(3);
    expect(native.getError('OracleTimestampMismatch')?.selector).toBeTruthy();
    expect(native.getError('AddressBlacklisted')?.selector).toBeTruthy();
    expect(erc20.getFunction('deposit(uint256,uint256,uint256)')?.payable).toBe(true);
    expect(erc20.getFunction('withdraw(uint256,uint256,uint256)')?.payable).toBe(true);
    expect(erc20.getFunction('estimateWithdrawFee')?.outputs).toHaveLength(4);
    expect(erc20.getError('InsufficientBridgeLiquidity')?.selector).toBeTruthy();
    expect(erc20.getError('UnexpectedTransferBalance')?.selector).toBeTruthy();
  });
});

describe('Privacy Portal amount and quote helpers', () => {
  it('parses token decimals without floating point coercion', () => {
    expect(parsePrivacyAmountInput('1.000001', 6)).toBe(1_000_001n);
    expect(parsePrivacyAmountInput('0.00000001', 8)).toBe(1n);
    expect(parsePrivacyAmountInput('123456789.123456789123456789', 18)).toBe(
      123_456_789_123_456_789_123_456_789n
    );
    expect(parsePrivacyAmountInput('1.0000001', 6)).toBeNull();
    expect(parsePrivacyAmountInput('1e6', 18)).toBeNull();
    expect(parsePrivacyAmountInput('-1', 18)).toBeNull();
  });

  it('keys quotes by exact account, pair, direction, and bigint amount', () => {
    expect(
      buildPrivacyPortalQuoteKey({
        chainId: COTI_PRIVACY_PORTAL_CHAIN_ID,
        account: '0xABCDEF0000000000000000000000000000000000',
        pairId: 'usdt',
        direction: 'public-to-private',
        amountWei: 1_000_001n
      })
    ).toBe('2632500:0xabcdef0000000000000000000000000000000000:usdt:public-to-private:1000001');
  });

  it('adds the 30% gas margin with integer-safe ceiling and calculates native reserve', () => {
    expect(applyPrivacyPortalGasMargin(100_000n)).toBe(130_000n);
    expect(applyPrivacyPortalGasMargin(101n)).toBe(132n);
    expect(calculatePrivacyPortalGasReserveWei(130_000n, 2_000_000_000n)).toBe(260_000_000_000_000n);
  });

  it('selects a viable native Max gas probe that leaves balance headroom', () => {
    expect(
      selectPrivacyPortalNativeGasProbeAmount({
        requestedAmountWei: 100n,
        balanceWei: 100n,
        minAmountWei: 0n,
        maxAmountWei: 1_000n,
        quotedFeeWei: 10n,
        headroomWei: 20n
      })
    ).toBe(80n);
    expect(
      selectPrivacyPortalNativeGasProbeAmount({
        requestedAmountWei: 100n,
        balanceWei: 100n,
        minAmountWei: 0n,
        maxAmountWei: 50n,
        quotedFeeWei: 10n,
        headroomWei: 20n
      })
    ).toBe(50n);
    expect(
      selectPrivacyPortalNativeGasProbeAmount({
        requestedAmountWei: 12n,
        balanceWei: 12n,
        minAmountWei: 0n,
        maxAmountWei: 100n,
        quotedFeeWei: 10n,
        headroomWei: 3n
      })
    ).toBeNull();
  });

  it('deducts fees from native output but keeps ERC-20 token output 1:1', () => {
    const nativePair = PRIVACY_TOKEN_PAIRS[0];
    const erc20Pair = PRIVACY_TOKEN_PAIRS[1];
    expect(resolvePrivacyPortalReceiveAmount(nativePair, 'public-to-private', 100n, 7n)).toBe(93n);
    expect(resolvePrivacyPortalReceiveAmount(nativePair, 'private-to-public', 100n, 7n)).toBe(93n);
    expect(resolvePrivacyPortalReceiveAmount(erc20Pair, 'public-to-private', 100n, 7n)).toBe(100n);
    expect(resolvePrivacyPortalReceiveAmount(erc20Pair, 'private-to-public', 100n, 7n)).toBe(100n);
  });

  it('builds the exact native and ERC-20 deposit/withdraw calls', () => {
    const quote = {
      feeWei: 7n,
      cotiOracleTimestamp: 11n,
      tokenOracleTimestamp: 13n
    };
    expect(buildPrivacyPortalTransactionCall(PRIVACY_TOKEN_PAIRS[0], 'public-to-private', 100n, quote)).toEqual({
      functionSignature: 'deposit(uint256,uint256)',
      args: [11n, 13n],
      valueWei: 100n
    });
    expect(buildPrivacyPortalTransactionCall(PRIVACY_TOKEN_PAIRS[0], 'private-to-public', 100n, quote)).toEqual({
      functionSignature: 'withdraw(uint256,uint256,uint256)',
      args: [100n, 11n, 13n],
      valueWei: 0n
    });
    expect(buildPrivacyPortalTransactionCall(PRIVACY_TOKEN_PAIRS[1], 'public-to-private', 100n, quote)).toEqual({
      functionSignature: 'deposit(uint256,uint256,uint256)',
      args: [100n, 11n, 13n],
      valueWei: 7n
    });
    expect(buildPrivacyPortalTransactionCall(PRIVACY_TOKEN_PAIRS[1], 'private-to-public', 100n, quote)).toEqual({
      functionSignature: 'withdraw(uint256,uint256,uint256)',
      args: [100n, 11n, 13n],
      valueWei: 7n
    });
  });

  it('requires the correct allowance before read-only gas simulation', () => {
    expect(
      resolvePrivacyPortalAllowanceRequirement({
        pair: PRIVACY_TOKEN_PAIRS[0],
        direction: 'public-to-private',
        amountWei: 100n,
        publicAllowanceWei: null,
        privateAllowanceWei: null
      })
    ).toBe('none');
    expect(
      resolvePrivacyPortalAllowanceRequirement({
        pair: PRIVACY_TOKEN_PAIRS[1],
        direction: 'public-to-private',
        amountWei: 100n,
        publicAllowanceWei: 99n,
        privateAllowanceWei: null
      })
    ).toBe('public-approval-required');
    expect(
      resolvePrivacyPortalAllowanceRequirement({
        pair: PRIVACY_TOKEN_PAIRS[1],
        direction: 'private-to-public',
        amountWei: 100n,
        publicAllowanceWei: null,
        privateAllowanceWei: null
      })
    ).toBe('private-allowance-unavailable');
    expect(
      resolvePrivacyPortalAllowanceRequirement({
        pair: PRIVACY_TOKEN_PAIRS[1],
        direction: 'private-to-public',
        amountWei: 100n,
        publicAllowanceWei: null,
        privateAllowanceWei: 100n
      })
    ).toBe('none');
  });

  it('validates live limits, balances, fees, and direction-specific liquidity', () => {
    expect(
      validatePrivacyPortalAmount({
        amountWei: 100n,
        minAmountWei: 101n,
        maxAmountWei: 1_000n,
        balanceWei: 99n,
        direction: 'public-to-private',
        feeWei: 11n,
        nativeCotiBalanceWei: 10n,
        bridgeKind: 'erc20'
      })
    ).toEqual(['below-minimum', 'insufficient-balance', 'insufficient-native-fee-balance']);

    expect(
      validatePrivacyPortalAmount({
        amountWei: 100n,
        minAmountWei: 1n,
        maxAmountWei: 1_000n,
        balanceWei: 100n,
        bridgeLiquidityWei: 95n,
        direction: 'private-to-public',
        feeWei: 10n,
        bridgeKind: 'native'
      })
    ).toEqual([]);
    expect(
      validatePrivacyPortalAmount({
        amountWei: 100n,
        minAmountWei: 1n,
        maxAmountWei: 1_000n,
        balanceWei: 100n,
        bridgeLiquidityWei: 89n,
        direction: 'private-to-public',
        feeWei: 10n,
        bridgeKind: 'native'
      })
    ).toEqual(['insufficient-bridge-liquidity']);
  });

  it('maps portal failures without mistaking generic on-chain failures for a network error', () => {
    expect(normalizePrivacyPortalError(new Error('OracleTimestampMismatch')).message).toContain('oracle price updated');
    const decodedRevert = Object.assign(new Error('execution reverted'), {
      revert: { name: 'DepositExceedsMaximum' }
    });
    expect(normalizePrivacyPortalError(decodedRevert).message).toBe('The amount is above the bridge maximum.');
    expect(normalizePrivacyPortalError(new Error('Privacy conversion failed on-chain.')).message).toBe(
      'Privacy conversion failed on-chain.'
    );
    expect(normalizePrivacyPortalError(new Error('wrong network')).message).toContain('COTI Mainnet');
  });
});

describe('exact private allowance planning', () => {
  it('approves from zero, adjusts by encrypted deltas, and preserves the maximum default policy', () => {
    expect(resolvePrivateTokenAllowanceWritePlan(0n, 25n, 'exact')).toMatchObject({
      method: 'approve',
      amountWei: 25n
    });
    expect(resolvePrivateTokenAllowanceWritePlan(10n, 25n, 'exact')).toMatchObject({
      method: 'increaseAllowance',
      amountWei: 15n
    });
    expect(resolvePrivateTokenAllowanceWritePlan(40n, 25n, 'exact')).toMatchObject({
      method: 'decreaseAllowance',
      amountWei: 15n
    });
    expect(resolvePrivateTokenAllowanceWritePlan(10n)).toMatchObject({
      method: 'increaseAllowance'
    });
  });
});
