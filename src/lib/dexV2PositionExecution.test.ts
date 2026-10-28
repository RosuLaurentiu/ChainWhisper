import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  core: '0x0606060606060606060606060606060606060606',
  nft: '0x0707070707070707070707070707070707070707',
  getPosition: vi.fn(),
  ownerOf: vi.fn()
}));

vi.mock('./dexV2Chain', () => ({
  assertAttestedDexV2Deployment: (deployment: { verified?: boolean }) => {
    if (deployment?.verified !== true) throw new Error('requires exact attestation');
    return deployment;
  }
}));

vi.mock('@coti-io/coti-ethers', async () => {
  const actual = await vi.importActual<typeof import('@coti-io/coti-ethers')>('@coti-io/coti-ethers');
  return {
    ...actual,
    Contract: class {
      constructor(target: string) {
        if (target.toLowerCase() === mocks.core) {
          return { getPosition: { staticCall: mocks.getPosition } };
        }
        if (target.toLowerCase() === mocks.nft) {
          return { ownerOf: { staticCall: mocks.ownerOf } };
        }
        throw new Error('unexpected contract');
      }
    }
  };
});

import { Interface } from '@coti-io/coti-ethers';
import { DEX_V2_ACTION_ABI, DEX_V2_ACTION_SELECTORS, captureDexV2ActionIntent } from './dexV2Actions';
import { submitDexV2PositionLifecycle } from './dexV2PositionExecution';

const OWNER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const PAIR_KEY = `0x${'55'.repeat(32)}`;
const TX_HASH = `0x${'66'.repeat(32)}`;
const deployment = {
  verified: true,
  manifest: {
    chainId: '7082400',
    addresses: { core: mocks.core, positionToken: mocks.nft },
    pair: { pairKey: PAIR_KEY }
  },
  attestationBlock: { number: '100', hash: `0x${'77'.repeat(32)}` }
} as never;

const signerFixture = (chainId = 7_082_400n) => {
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
    sendTransaction,
    signer: {
      getAddress: vi.fn(async () => OWNER),
      provider: { getNetwork: vi.fn(async () => ({ chainId })) },
      sendTransaction
    } as never
  };
};

describe('dexV2PositionExecution', () => {
  it('freezes owner-authorized transfer and privacy-activation calls', () => {
    const abi = new Interface(DEX_V2_ACTION_ABI);
    expect(DEX_V2_ACTION_SELECTORS.transferPosition).toBe('0x048c7754');
    expect(DEX_V2_ACTION_SELECTORS.activatePositionPrivacy).toBe('0xa0da47d2');
    expect(abi.decodeFunctionData(
      'activatePositionPrivacy',
      abi.encodeFunctionData('activatePositionPrivacy', [9n, 3n])
    ).slice()).toEqual([9n, 3n]);
    expect(abi.decodeFunctionData(
      'transferPosition',
      abi.encodeFunctionData('transferPosition', [RECIPIENT, 9n, 3n])
    ).slice()).toEqual([RECIPIENT, 9n, 3n]);
  });

  it('revalidates the NFT and revision before one exact transfer submission', async () => {
    mocks.getPosition.mockResolvedValueOnce({
      kind: 2n,
      lifecycle: 1n,
      pairKey: PAIR_KEY,
      privacyOwner: OWNER,
      ownerRevision: 3n
    });
    mocks.ownerOf.mockResolvedValueOnce(OWNER);
    const fixture = signerFixture();
    const submission = await submitDexV2PositionLifecycle({
      deployment,
      intent: captureDexV2ActionIntent({
        kind: 'transfer-position',
        recipient: RECIPIENT,
        positionId: 9n,
        expectedOwnerRevision: 3n
      }),
      signer: fixture.signer
    });

    expect(mocks.getPosition).toHaveBeenCalledWith(9n, { blockTag: 100n });
    expect(mocks.ownerOf).toHaveBeenCalledWith(9n, { blockTag: 100n });
    expect(fixture.sendTransaction).toHaveBeenCalledOnce();
    expect(fixture.sendTransaction.mock.calls[0][0]).toMatchObject({
      to: mocks.core,
      value: 0n,
      gasLimit: 90_000_000n
    });
    expect(new Interface(DEX_V2_ACTION_ABI).decodeFunctionData(
      'transferPosition',
      fixture.sendTransaction.mock.calls[0][0].data
    ).slice()).toEqual([RECIPIENT, 9n, 3n]);
    expect(submission.submittedTransactionHash).toBe(TX_HASH);
  });

  it('fails on the wrong chain before reading position state or opening the wallet', async () => {
    mocks.getPosition.mockClear();
    mocks.ownerOf.mockClear();
    const fixture = signerFixture(1n);
    await expect(submitDexV2PositionLifecycle({
      deployment,
      intent: captureDexV2ActionIntent({
        kind: 'transfer-position',
        recipient: RECIPIENT,
        positionId: 9n,
        expectedOwnerRevision: 3n
      }),
      signer: fixture.signer
    })).rejects.toThrow(/not connected to the activated DEX chain/);
    expect(mocks.getPosition).not.toHaveBeenCalled();
    expect(mocks.ownerOf).not.toHaveBeenCalled();
    expect(fixture.sendTransaction).not.toHaveBeenCalled();
  });

  it('fails closed when the attested owner revision has changed', async () => {
    mocks.getPosition.mockResolvedValueOnce({
      kind: 2n,
      lifecycle: 1n,
      pairKey: PAIR_KEY,
      privacyOwner: OWNER,
      ownerRevision: 4n
    });
    const fixture = signerFixture();
    await expect(submitDexV2PositionLifecycle({
      deployment,
      intent: captureDexV2ActionIntent({
        kind: 'transfer-position',
        recipient: RECIPIENT,
        positionId: 9n,
        expectedOwnerRevision: 3n
      }),
      signer: fixture.signer
    })).rejects.toThrow(/changed before its owner action was prepared/);
    expect(fixture.sendTransaction).not.toHaveBeenCalled();
  });
});
