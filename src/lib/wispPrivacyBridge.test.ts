import { Interface } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import { WISP_PRIVACY_BRIDGE_CONTRACT_ABI } from './appShared';
import {
  CHAINWHISPER_WISP_BRIDGE_PAIR,
  buildChainWhisperWispCall,
  buildChainWhisperWispQuoteKey,
  parseChainWhisperWispFeeQuote,
  resolveChainWhisperWispPublicApprovalAmounts,
  submitAndConfirmChainWhisperWispConversion,
  validateChainWhisperWispAmount,
  validateChainWhisperWispStatus,
  type ChainWhisperWispQuote
} from './wispPrivacyBridge';

const quoteFields: Pick<
  ChainWhisperWispQuote,
  'feeWei' | 'cotiOracleTimestamp' | 'tokenOracleTimestamp'
> = {
  feeWei: 7n,
  cotiOracleTimestamp: 11n,
  tokenOracleTimestamp: 13n
};

describe('ChainWhisper WISP bridge registry and ABI', () => {
  it('pins the current mainnet bridge and token pair', () => {
    expect(CHAINWHISPER_WISP_BRIDGE_PAIR).toEqual({
      chainId: 2_632_500,
      bridgeAddress: '0x3bCeA2eD4b31107eF877899416dC97213bdc2809',
      publicTokenAddress: '0xb70c55bd0823436F44877DC6A9f46E0C55f2C3A8',
      privateTokenAddress: '0x682e3142e62a7aDe2a0CA5bdC87b205CaDe4B17a',
      decimals: 6,
      publicSymbol: 'WISP',
      privateSymbol: 'pWISP'
    });
  });

  it('keeps the live quote and three-argument conversion methods parseable', () => {
    const contractInterface = new Interface(WISP_PRIVACY_BRIDGE_CONTRACT_ABI);

    expect(contractInterface.getFunction('estimateDepositFee(uint256)')?.outputs).toHaveLength(4);
    expect(contractInterface.getFunction('estimateWithdrawFee(uint256)')?.outputs).toHaveLength(4);
    expect(contractInterface.getFunction('deposit(uint256,uint256,uint256)')?.payable).toBe(true);
    expect(contractInterface.getFunction('withdraw(uint256,uint256,uint256)')?.payable).toBe(true);
  });
});

describe('ChainWhisper WISP quotes and transaction calls', () => {
  it('parses the exact fee and all returned timestamps without coercion', () => {
    expect(parseChainWhisperWispFeeQuote([7n, 11n, 13n, 17n])).toEqual({
      feeWei: 7n,
      cotiOracleTimestamp: 11n,
      tokenOracleTimestamp: 13n,
      blockTimestamp: 17n
    });
    expect(parseChainWhisperWispFeeQuote([7n, 11n, null, 17n])).toBeNull();
  });

  it('forwards the freshly quoted fee and timestamps for both directions', () => {
    expect(buildChainWhisperWispCall('shield', 101n, quoteFields)).toEqual({
      functionSignature: 'deposit(uint256,uint256,uint256)',
      args: [101n, 11n, 13n],
      valueWei: 7n
    });
    expect(buildChainWhisperWispCall('unshield', 103n, quoteFields)).toEqual({
      functionSignature: 'withdraw(uint256,uint256,uint256)',
      args: [103n, 11n, 13n],
      valueWei: 7n
    });
  });

  it('keys quotes by chain, normalized account, direction, and exact amount', () => {
    expect(
      buildChainWhisperWispQuoteKey({
        account: '0xAAbbCCddEeFf0011223344556677889900AaBbCc',
        direction: 'unshield',
        amountWei: 123_456n
      })
    ).toBe('2632500:0xaabbccddeeff0011223344556677889900aabbcc:unshield:123456');
  });
});

describe('ChainWhisper WISP approval and live amount safeguards', () => {
  it('targets the exact public allowance and zero-resets any differing nonzero allowance', () => {
    expect(resolveChainWhisperWispPublicApprovalAmounts(25n, 25n)).toEqual([]);
    expect(resolveChainWhisperWispPublicApprovalAmounts(0n, 25n)).toEqual([25n]);
    expect(resolveChainWhisperWispPublicApprovalAmounts(10n, 25n)).toEqual([0n, 25n]);
    expect(resolveChainWhisperWispPublicApprovalAmounts(40n, 25n)).toEqual([0n, 25n]);
  });

  it('blocks live minimum, maximum, balance, reserve, and COTI-fee failures', () => {
    expect(
      validateChainWhisperWispAmount({
        direction: 'unshield',
        amountWei: 100n,
        minAmountWei: 101n,
        maxAmountWei: 99n,
        balanceWei: 90n,
        publicReserveWei: 80n,
        nativeBalanceWei: 6n,
        feeWei: 7n
      })
    ).toEqual([
      'below-minimum',
      'above-maximum',
      'insufficient-balance',
      'insufficient-reserve',
      'insufficient-native-fee-balance'
    ]);
  });

  it('fails closed when either selected-token or native balance is unavailable', () => {
    expect(
      validateChainWhisperWispAmount({
        direction: 'shield',
        amountWei: 100n,
        minAmountWei: 1n,
        maxAmountWei: 1_000n,
        balanceWei: null,
        publicReserveWei: 0n,
        nativeBalanceWei: null,
        feeWei: 7n
      })
    ).toEqual(['balance-unavailable', 'native-balance-unavailable']);
  });

  it('blocks live pause, directional enablement, public-amount support, and blacklist states', () => {
    expect(
      validateChainWhisperWispStatus({
        direction: 'shield',
        paused: true,
        depositEnabled: false,
        privatePublicAmountsEnabled: true,
        blacklisted: true
      })
    ).toEqual(['paused', 'deposit-disabled', 'blacklisted']);
    expect(
      validateChainWhisperWispStatus({
        direction: 'unshield',
        paused: false,
        depositEnabled: true,
        privatePublicAmountsEnabled: false,
        blacklisted: false
      })
    ).toEqual(['private-public-amounts-disabled']);
  });
});

describe('ChainWhisper WISP receipt and account-race semantics', () => {
  it('treats a successful receipt as authoritative if the active account changes while waiting', async () => {
    let activeAccount = 'original';
    const assertReady = vi.fn(async () => {
      if (activeAccount !== 'original') {
        throw new Error('account changed');
      }
    });
    const stages: string[] = [];

    const result = await submitAndConfirmChainWhisperWispConversion({
      assertReady,
      submit: async () => ({
        hash: '0xconfirmed',
        wait: async () => {
          activeAccount = 'replacement';
          return { status: 1n };
        }
      }),
      onProgress: (stage) => stages.push(stage)
    });

    expect(result.transaction.hash).toBe('0xconfirmed');
    expect(result.receipt).toEqual({ status: 1n });
    expect(assertReady).toHaveBeenCalledTimes(1);
    expect(activeAccount).toBe('replacement');
    expect(stages).toEqual(['awaiting-conversion', 'confirming', 'complete']);
  });

  it('rejects failed receipts and never emits a completed stage', async () => {
    const stages: string[] = [];

    await expect(
      submitAndConfirmChainWhisperWispConversion({
        assertReady: async () => undefined,
        submit: async () => ({ wait: async () => ({ status: 0 }) }),
        onProgress: (stage) => stages.push(stage)
      })
    ).rejects.toThrow('ChainWhisper WISP conversion failed on-chain.');
    expect(stages).toEqual(['awaiting-conversion', 'confirming']);
  });

  it('revalidates the captured account immediately before submission', async () => {
    const submit = vi.fn(async () => ({ wait: async () => ({ status: 1 }) }));

    await expect(
      submitAndConfirmChainWhisperWispConversion({
        assertReady: async () => {
          throw new Error('The active wallet account changed during the privacy conversion.');
        },
        submit
      })
    ).rejects.toThrow('active wallet account changed');
    expect(submit).not.toHaveBeenCalled();
  });
});
