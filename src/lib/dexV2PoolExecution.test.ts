import { Interface, Wallet, solidityPackedKeccak256 } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./dexV2Chain', () => ({
  assertAttestedDexV2Deployment: (deployment: { verified?: boolean }) => {
    if (deployment?.verified !== true) throw new Error('requires exact attestation');
    return deployment;
  }
}));

import { DEX_V2_ACTION_ABI, captureDexV2ActionIntent } from './dexV2Actions';
import {
  DEX_V2_POOL_RECEIPT_ABI,
  DEX_V2_POSITION_GAS_LIMIT,
  submitDexV2PoolPosition
} from './dexV2PoolExecution';

const CORE = '0x0606060606060606060606060606060606060606';
const BASE = '0x2828282828282828282828282828282828282828';
const QUOTE = '0x2929292929292929292929292929292929292929';
const OWNER_WALLET = new Wallet(`0x${'11'.repeat(32)}`);
const OWNER = OWNER_WALLET.address;
const TX_HASH = `0x${'44'.repeat(32)}`;
const deployment = {
  verified: true,
  manifest: {
    chainId: '7082400',
    addresses: { core: CORE },
    pair: { baseToken: BASE, quoteToken: QUOTE }
  }
} as never;

const signerFixture = (chainId = 7_082_400n) => {
  const encryptValue = vi.fn(async (plaintext: bigint, contractAddress: string, functionSelector: string) => {
    const ciphertext = plaintext + 700n;
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
    chainId,
    wait: vi.fn()
  }));
  return {
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

describe('dexV2PoolExecution', () => {
  it('freezes the reviewed position gas policy and exact owner receipt surface', () => {
    expect(DEX_V2_POSITION_GAS_LIMIT).toBe(90_000_000n);
    const abi = DEX_V2_POOL_RECEIPT_ABI.join('\n');
    expect(abi).toContain('DexPoolPositionCreated');
    expect(abi).toContain('DexPoolLiquidityAdded');
    expect(abi).toContain('DexPoolLiquidityWithdrawn');
    expect(abi).toContain('DexPoolPositionClosed');
    expect(abi).toContain('addPoolLiquidity');
    expect(abi).toContain('withdrawPoolLiquidity');
    expect(abi).toContain('withdrawAllPoolLiquidity');
    expect(abi).toContain('getPosition');
    expect(abi).toContain('getPoolOwnerSnapshot');
    expect(abi).toContain('baseClaimOrInventoryLots');
    expect(abi).toContain('quoteClaimOrInventoryLots');
  });

  it('submits the exact private Pool seed through one reviewed browser-wallet call', async () => {
    const fixture = signerFixture();
    const packedMaxima = (39_880n << 32n) | 219_340n;
    const submission = await submitDexV2PoolPosition({
      deployment,
      intent: captureDexV2ActionIntent({
        kind: 'create-pool',
        baseMaximumLots: 39_880n,
        quoteMaximumLots: 219_340n
      }),
      signer: fixture.signer
    });

    expect(fixture.encryptValue).toHaveBeenCalledWith(
      packedMaxima,
      CORE,
      '0xf1572380'
    );
    expect(fixture.sendTransaction).toHaveBeenCalledOnce();
    expect(fixture.sendTransaction.mock.calls[0][0]).toMatchObject({
      to: CORE,
      value: 0n,
      gasLimit: 90_000_000n
    });
    expect(new Interface(DEX_V2_ACTION_ABI).parseTransaction({
      data: fixture.sendTransaction.mock.calls[0][0].data
    })?.name).toBe('createPoolPosition');
    expect(submission.submittedTransactionHash).toBe(TX_HASH);
  });

  it('does not prepare a Pool ciphertext or transaction on the wrong chain', async () => {
    const fixture = signerFixture(1n);
    await expect(submitDexV2PoolPosition({
      deployment,
      intent: captureDexV2ActionIntent({
        kind: 'create-pool',
        baseMaximumLots: 39_880n,
        quoteMaximumLots: 219_340n
      }),
      signer: fixture.signer
    })).rejects.toThrow(/not connected to the activated DEX chain/);
    expect(fixture.encryptValue).not.toHaveBeenCalled();
    expect(fixture.sendTransaction).not.toHaveBeenCalled();
  });
});
