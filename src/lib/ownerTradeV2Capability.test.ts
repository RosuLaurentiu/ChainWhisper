import { describe, expect, it } from 'vitest';
import {
  getOwnerTradeV2ReadRunner,
  type OwnerTradeV2CapabilityBinding
} from './ownerTradeV2Capability';

describe('owner OTC V2 read runner', () => {
  it('keeps public reads off the browser-wallet signer when a read provider exists', () => {
    const signer = Object.freeze({ label: 'wallet-signer' });
    const readProvider = Object.freeze({ label: 'public-read-provider' });
    const binding = { signer, readProvider } as unknown as OwnerTradeV2CapabilityBinding;

    expect(getOwnerTradeV2ReadRunner(binding)).toBe(readProvider);
  });

  it('retains the signer fallback for isolated legacy test capabilities', () => {
    const signer = Object.freeze({ label: 'wallet-signer' });
    const binding = { signer } as unknown as OwnerTradeV2CapabilityBinding;

    expect(getOwnerTradeV2ReadRunner(binding)).toBe(signer);
  });
});
