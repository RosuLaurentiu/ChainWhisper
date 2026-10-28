import { Interface } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import { PRIVATE_TRADE_V2_ACTION_ABI, executePrivateTradeV2Action } from './privateTradeV2Actions';

describe('privateTradeV2Actions', () => {
  it('freezes the one-input selectors for create, replace, and fill', () => {
    const abi = new Interface(PRIVATE_TRADE_V2_ACTION_ABI);
    const createInputs = abi.getFunction('createOrder')?.inputs ?? [];
    const replaceInputs = abi.getFunction('replaceOrder')?.inputs ?? [];
    const fillInputs = abi.getFunction('fillOrder')?.inputs ?? [];
    expect(createInputs[createInputs.length - 1]?.baseType).toBe('tuple');
    expect(replaceInputs[replaceInputs.length - 1]?.baseType).toBe('tuple');
    expect(fillInputs[fillInputs.length - 1]?.baseType).toBe('tuple');
    expect(fillInputs).toHaveLength(4);
  });

  it('rejects structural wallet/deployment authority before any action preparation', async () => {
    await expect(executePrivateTradeV2Action({
      capability: {} as never,
      deployment: {} as never,
      action: { kind: 'cancel', orderId: 1n }
    })).rejects.toThrow(/not locally attested/i);
  });
});
