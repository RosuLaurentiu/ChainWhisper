import { Interface } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./dexV2Chain', () => ({
  assertAttestedDexV2Deployment: (deployment: { verified?: boolean }) => {
    if (deployment?.verified !== true) throw new Error('requires exact attestation');
    return deployment;
  }
}));

import {
  DEX_V2_ACTION_ABI,
  DEX_V2_ACTION_SELECTORS,
  assertPreparedDexV2ActionCall,
  captureDexV2ActionIntent,
  prepareDexV2ActionCall,
  type DexV2Action,
  type DexV2EncryptUint64
} from './dexV2Actions';

const CORE = '0x0606060606060606060606060606060606060606';
const BASE = '0x2828282828282828282828282828282828282828';
const QUOTE = '0x2929292929292929292929292929292929292929';
const deployment = {
  verified: true,
  manifest: {
    addresses: { core: CORE },
    pair: { baseToken: BASE, quoteToken: QUOTE }
  }
} as never;

const ABI = new Interface(DEX_V2_ACTION_ABI);

const encryptor = () => {
  const requests: Array<{ plaintext: bigint; contractAddress: string; functionSelector: string }> = [];
  const encryptUint64: DexV2EncryptUint64 = vi.fn(async (request) => {
    requests.push(request);
    return { ciphertext: request.plaintext + 1_000n, signature: '0x1234' };
  });
  return { requests, encryptUint64 };
};

describe('dexV2Actions', () => {
  it('freezes every reviewed Core fallback selector', () => {
    expect(DEX_V2_ACTION_SELECTORS).toEqual({
      createPoolPosition: '0xf1572380',
      addPoolLiquidity: '0x7dead9f4',
      withdrawPoolLiquidity: '0x5316394b',
      withdrawAllPoolLiquidity: '0x926e4130',
      transferPosition: '0x048c7754',
      activatePositionPrivacy: '0xa0da47d2',
      createLimitPosition: '0xdbeed690',
      setLimitPositionPaused: '0xf7deb6e8',
      closeLimitPosition: '0xf05e0e05',
      createRecurringPosition: '0x45e45041',
      updateRecurringRanks: '0x0e417326',
      addRecurringLiquidity: '0x1e57fdea',
      setRecurringPositionPaused: '0xfe1c0f55',
      closeRecurringPosition: '0x694824f5',
      swapDex: '0x34140ae8'
    });
  });

  it('prepares the frozen Pool creation vector against Core and its exact selector', async () => {
    const { requests, encryptUint64 } = encryptor();
    const call = await prepareDexV2ActionCall({
      deployment,
      intent: captureDexV2ActionIntent({
        kind: 'create-pool', baseMaximumLots: 39_880n, quoteMaximumLots: 219_340n
      }),
      encryptUint64
    });
    expect(call).toMatchObject({
      kind: 'create-pool', to: CORE, selector: '0xf1572380', value: 0n, requiresPrivacy: true
    });
    expect(requests).toEqual([{
      plaintext: (39_880n << 32n) | 219_340n,
      contractAddress: CORE,
      functionSelector: '0xf1572380'
    }]);
    const decoded = ABI.decodeFunctionData('createPoolPosition', call.data);
    expect(decoded[0].toLowerCase()).toBe(BASE);
    expect(decoded[1].toLowerCase()).toBe(QUOTE);
    expect(decoded[2].ciphertext).toBe(((39_880n << 32n) | 219_340n) + 1_000n);
    expect(decoded[2].signature).toBe('0x1234');
    expect(assertPreparedDexV2ActionCall(call)).toBe(call);
  });

  it('domain-binds both Recurring inputs to the same reviewed selector', async () => {
    const { requests, encryptUint64 } = encryptor();
    const call = await prepareDexV2ActionCall({
      deployment,
      intent: captureDexV2ActionIntent({
        kind: 'create-recurring', buyTickRank: 9, sellTickRank: 6,
        baseInventoryLots: 401n, quoteInventoryLots: 381n
      }),
      encryptUint64
    });
    expect(requests.map((request) => request.plaintext)).toEqual([
      (6n << 4n) | 9n,
      (401n << 32n) | 381n
    ]);
    expect(requests.every((request) =>
      request.contractAddress === CORE && request.functionSelector === '0x45e45041'
    )).toBe(true);
    expect(ABI.parseTransaction({ data: call.data })?.name).toBe('createRecurringPosition');
  });

  it('packs the complete private Limit creation vector against its reviewed selector', async () => {
    const { requests, encryptUint64 } = encryptor();
    const call = await prepareDexV2ActionCall({
      deployment,
      intent: captureDexV2ActionIntent({
        kind: 'create-limit',
        makerSide: 'sell-base',
        tickRank: 8,
        minimumFillQuanta: 2n,
        inventoryLots: 9_970n
      }),
      encryptUint64
    });
    const packedTerms = (9_970n << 32n) | (2n << 5n) | (8n << 1n);
    expect(requests).toEqual([{
      plaintext: packedTerms,
      contractAddress: CORE,
      functionSelector: DEX_V2_ACTION_SELECTORS.createLimitPosition
    }]);
    const decoded = ABI.decodeFunctionData('createLimitPosition', call.data);
    expect(decoded[0].toLowerCase()).toBe(BASE);
    expect(decoded[1].toLowerCase()).toBe(QUOTE);
    expect(decoded[2].ciphertext).toBe(packedTerms + 1_000n);
    expect(decoded[2].signature).toBe('0x1234');
  });

  it('prepares every Limit and Recurring owner mutation with exact revisions and privacy policy', async () => {
    const vectors = [
      { kind: 'pause-limit', functionName: 'setLimitPositionPaused', args: [11n, 4n, true], privacy: false },
      { kind: 'resume-limit', functionName: 'setLimitPositionPaused', args: [11n, 4n, false], privacy: false },
      { kind: 'close-limit', functionName: 'closeLimitPosition', args: [11n, 4n], privacy: false },
      { kind: 'pause-recurring', functionName: 'setRecurringPositionPaused', args: [11n, 4n, true], privacy: false },
      { kind: 'resume-recurring', functionName: 'setRecurringPositionPaused', args: [11n, 4n, false], privacy: false },
      { kind: 'close-recurring', functionName: 'closeRecurringPosition', args: [11n, 4n], privacy: false }
    ] as const;
    for (const vector of vectors) {
      const encryptUint64 = vi.fn();
      const call = await prepareDexV2ActionCall({
        deployment,
        intent: captureDexV2ActionIntent({
          kind: vector.kind,
          positionId: 11n,
          expectedOwnerRevision: 4n
        }),
        encryptUint64
      });
      expect(call.requiresPrivacy).toBe(vector.privacy);
      expect(ABI.decodeFunctionData(vector.functionName, call.data).slice()).toEqual(vector.args);
      expect(encryptUint64).not.toHaveBeenCalled();
    }

    const rankEncryption = encryptor();
    const rankCall = await prepareDexV2ActionCall({
      deployment,
      intent: captureDexV2ActionIntent({
        kind: 'update-recurring-ranks', positionId: 11n, expectedOwnerRevision: 4n,
        buyTickRank: 10, sellTickRank: 5
      }),
      encryptUint64: rankEncryption.encryptUint64
    });
    expect(rankEncryption.requests).toEqual([{
      plaintext: (5n << 4n) | 10n,
      contractAddress: CORE,
      functionSelector: DEX_V2_ACTION_SELECTORS.updateRecurringRanks
    }]);
    expect(ABI.decodeFunctionData('updateRecurringRanks', rankCall.data).slice(0, 2)).toEqual([11n, 4n]);

    const liquidityEncryption = encryptor();
    const liquidityCall = await prepareDexV2ActionCall({
      deployment,
      intent: captureDexV2ActionIntent({
        kind: 'add-recurring-liquidity', positionId: 11n, expectedOwnerRevision: 4n,
        baseLots: 401n, quoteLots: 381n
      }),
      encryptUint64: liquidityEncryption.encryptUint64
    });
    expect(liquidityEncryption.requests).toEqual([{
      plaintext: (401n << 32n) | 381n,
      contractAddress: CORE,
      functionSelector: DEX_V2_ACTION_SELECTORS.addRecurringLiquidity
    }]);
    expect(ABI.decodeFunctionData('addRecurringLiquidity', liquidityCall.data).slice(0, 2)).toEqual([11n, 4n]);
  });

  it('packs private minimum-input swap semantics and public routing terms exactly', async () => {
    const { requests, encryptUint64 } = encryptor();
    const call = await prepareDexV2ActionCall({
      deployment,
      intent: captureDexV2ActionIntent({
        kind: 'swap', direction: 'quote-to-base', limitTickRank: 5, deadline: 9_999n,
        maximumInputLots: 900n, minimumInputFilledLots: 25n
      }),
      encryptUint64
    });
    expect(requests[0].plaintext).toBe((900n << 32n) | 25n);
    const decoded = ABI.decodeFunctionData('swapDex', call.data);
    expect(decoded.slice(0, 5)).toEqual([BASE, QUOTE, 1n, 5n, 9_999n]);
  });

  it('prepares lifecycle exits without requesting a privacy signature', async () => {
    const encryptUint64 = vi.fn();
    const call = await prepareDexV2ActionCall({
      deployment,
      intent: captureDexV2ActionIntent({
        kind: 'withdraw-all-pool', positionId: 7n, expectedOwnerRevision: 3n
      }),
      encryptUint64
    });
    expect(call.requiresPrivacy).toBe(false);
    expect(encryptUint64).not.toHaveBeenCalled();
    expect(ABI.decodeFunctionData('withdrawAllPoolLiquidity', call.data).slice()).toEqual([7n, 3n]);
    const activation = await prepareDexV2ActionCall({
      deployment,
      intent: captureDexV2ActionIntent({
        kind: 'activate-position-privacy', positionId: 7n, expectedOwnerRevision: 4n
      }),
      encryptUint64
    });
    expect(activation.requiresPrivacy).toBe(false);
    expect(ABI.decodeFunctionData('activatePositionPrivacy', activation.data).slice()).toEqual([7n, 4n]);
    expect(encryptUint64).not.toHaveBeenCalled();
  });

  it('uses an immutable wallet intent even if the caller mutates its original object', async () => {
    const action: DexV2Action & { deadline: bigint } = {
      kind: 'swap', direction: 'base-to-quote', limitTickRank: 8, deadline: 1_000n,
      maximumInputLots: 50n, minimumInputFilledLots: 0n
    };
    const intent = captureDexV2ActionIntent(action);
    action.deadline = 2_000n;
    const { encryptUint64 } = encryptor();
    const call = await prepareDexV2ActionCall({ deployment, intent, encryptUint64 });
    expect(ABI.decodeFunctionData('swapDex', call.data)[4]).toBe(1_000n);
  });

  it('fails closed for forged authority, forged intent, missing privacy, and invalid terms', async () => {
    const validIntent = captureDexV2ActionIntent({
      kind: 'create-pool', baseMaximumLots: 1n, quoteMaximumLots: 1n
    });
    await expect(prepareDexV2ActionCall({ deployment: {} as never, intent: validIntent }))
      .rejects.toThrow(/exact attestation/);
    await expect(prepareDexV2ActionCall({ deployment, intent: {} as never }))
      .rejects.toThrow(/captured/);
    await expect(prepareDexV2ActionCall({ deployment, intent: validIntent }))
      .rejects.toThrow(/privacy signer/);
    const { encryptUint64 } = encryptor();
    await expect(prepareDexV2ActionCall({
      deployment,
      intent: captureDexV2ActionIntent({
        kind: 'swap', direction: 'base-to-quote', limitTickRank: 16, deadline: 1n,
        maximumInputLots: 1n, minimumInputFilledLots: 0n
      }),
      encryptUint64
    })).rejects.toThrow(/0 through 15/);
    expect(() => assertPreparedDexV2ActionCall({} as never)).toThrow(/exact action preparer/);
  });
});
