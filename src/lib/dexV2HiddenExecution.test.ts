import { Interface, Wallet, solidityPackedKeccak256 } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./dexV2Chain', () => ({
  assertAttestedDexV2Deployment: (deployment: { verified?: boolean }) => {
    if (deployment?.verified !== true) throw new Error('requires exact attestation');
    return deployment;
  }
}));

import {
  DEX_V2_ACTION_ABI,
  captureDexV2ActionIntent
} from './dexV2Actions';
import { submitDexV2HiddenAction } from './dexV2HiddenExecution';

const CORE = '0x0606060606060606060606060606060606060606';
const BASE = '0x2828282828282828282828282828282828282828';
const QUOTE = '0x2929292929292929292929292929292929292929';
const OWNER_WALLET = new Wallet(`0x${'11'.repeat(32)}`);
const OWNER = OWNER_WALLET.address;
const TX_HASH = `0x${'33'.repeat(32)}`;
const deployment = {
  verified: true,
  manifest: {
    chainId: '7082400',
    addresses: { core: CORE },
    pair: { baseToken: BASE, quoteToken: QUOTE }
  }
} as never;

const signerFixture = ({ chainId = 7_082_400n, returnedTarget = CORE } = {}) => {
  const encrypted: Array<Readonly<{
    plaintext: bigint;
    contractAddress: string;
    functionSelector: string;
  }>> = [];
  const encryptValue = vi.fn(async (
    plaintext: bigint,
    contractAddress: string,
    functionSelector: string
  ) => {
    encrypted.push(Object.freeze({ plaintext, contractAddress, functionSelector }));
    const ciphertext = plaintext + 500n;
    return {
      ciphertext,
      signature: OWNER_WALLET.signingKey.sign(solidityPackedKeccak256(
        ['address', 'address', 'bytes4', 'uint256'],
        [OWNER, contractAddress, functionSelector, ciphertext]
      )).serialized
    };
  });
  const sendTransaction = vi.fn(async (request: {
    to: string; data: string; value: bigint; gasLimit: bigint;
  }) => ({
    ...request,
    hash: TX_HASH,
    from: OWNER,
    to: returnedTarget,
    chainId,
    wait: vi.fn()
  }));
  return {
    encrypted,
    encryptValue,
    sendTransaction,
    signer: {
      getAddress: vi.fn(async () => OWNER),
      provider: { getNetwork: vi.fn(async () => ({ chainId })) },
      encryptValue,
      sendTransaction
    } as never
  };
};

describe('dexV2HiddenExecution', () => {
  it('keeps the complete Limit and Recurring lifecycle on the reviewed Core ABI', () => {
    const abi = new Interface(DEX_V2_ACTION_ABI);
    for (const functionName of [
      'createLimitPosition',
      'setLimitPositionPaused',
      'closeLimitPosition',
      'createRecurringPosition',
      'updateRecurringRanks',
      'addRecurringLiquidity',
      'setRecurringPositionPaused',
      'closeRecurringPosition'
    ]) {
      expect(abi.getFunction(functionName)?.selector).toMatch(/^0x[0-9a-f]{8}$/);
    }
  });

  it('submits a Limit creation only after domain-bound encryption on the activated chain', async () => {
    const fixture = signerFixture();
    const submission = await submitDexV2HiddenAction({
      deployment,
      intent: captureDexV2ActionIntent({
        kind: 'create-limit', makerSide: 'sell-base', tickRank: 8,
        minimumFillQuanta: 2n, inventoryLots: 9_970n
      }),
      signer: fixture.signer
    });

    expect(fixture.encrypted).toEqual([expect.objectContaining({
      contractAddress: CORE,
      functionSelector: '0xdbeed690',
      plaintext: (9_970n << 32n) | (2n << 5n) | (8n << 1n)
    })]);
    expect(fixture.sendTransaction).toHaveBeenCalledOnce();
    expect(fixture.sendTransaction.mock.calls[0][0]).toMatchObject({
      to: CORE,
      value: 0n,
      gasLimit: 90_000_000n
    });
    expect(new Interface(DEX_V2_ACTION_ABI).parseTransaction({
      data: fixture.sendTransaction.mock.calls[0][0].data
    })?.name).toBe('createLimitPosition');
    expect(submission.submittedTransactionHash).toBe(TX_HASH);
  });

  it('binds both Recurring ciphertexts to one selector before one wallet submission', async () => {
    const fixture = signerFixture();
    await submitDexV2HiddenAction({
      deployment,
      intent: captureDexV2ActionIntent({
        kind: 'create-recurring', buyTickRank: 9, sellTickRank: 6,
        baseInventoryLots: 401n, quoteInventoryLots: 381n
      }),
      signer: fixture.signer
    });

    expect(fixture.encrypted.map(({ plaintext }) => plaintext)).toEqual([
      (6n << 4n) | 9n,
      (401n << 32n) | 381n
    ]);
    expect(fixture.encrypted.every(({ contractAddress, functionSelector }) =>
      contractAddress === CORE && functionSelector === '0x45e45041'
    )).toBe(true);
    expect(fixture.sendTransaction).toHaveBeenCalledOnce();
  });

  it('fails before encryption or wallet submission on the wrong chain', async () => {
    const fixture = signerFixture({ chainId: 1n });
    await expect(submitDexV2HiddenAction({
      deployment,
      intent: captureDexV2ActionIntent({
        kind: 'create-limit', makerSide: 'sell-base', tickRank: 8,
        minimumFillQuanta: 1n, inventoryLots: 997n
      }),
      signer: fixture.signer
    })).rejects.toThrow(/not connected to the activated DEX chain/);
    expect(fixture.encryptValue).not.toHaveBeenCalled();
    expect(fixture.sendTransaction).not.toHaveBeenCalled();
  });

  it('rejects a wallet response that does not match the reviewed Core call', async () => {
    const fixture = signerFixture({
      returnedTarget: '0x2222222222222222222222222222222222222222'
    });
    await expect(submitDexV2HiddenAction({
      deployment,
      intent: captureDexV2ActionIntent({
        kind: 'create-limit', makerSide: 'sell-base', tickRank: 8,
        minimumFillQuanta: 1n, inventoryLots: 997n
      }),
      signer: fixture.signer
    })).rejects.toThrow(/outside the reviewed hidden-position call/);
  });
});
