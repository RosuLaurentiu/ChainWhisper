import { describe, expect, it } from 'vitest';
import {
  buildBrowserOwnerDataScopeKey,
  buildBrowserWalletRuntimeScopeKey
} from './browserWalletRuntimeScope';

const OWNER = '0x1111111111111111111111111111111111111111';
const CHAIN_ID = 7_082_400n;
const session = Object.freeze({
  address: OWNER,
  chainId: Number(CHAIN_ID),
  source: 'injected',
  walletId: 'metamask'
});
const base = Object.freeze({
  activeSignerSource: 'metamask',
  deploymentFingerprint: 'candidate:direct-chat-v2',
  expectedChainId: CHAIN_ID,
  session,
  walletAddress: OWNER
});

describe('browser-wallet runtime scope', () => {
  it('keeps owner data stable across checksum casing and surrounding whitespace', () => {
    const checksummedOwner = '0x5DFcEe20b5a3FDd3577436A32f62d4C0b39e979d';
    const canonical = buildBrowserOwnerDataScopeKey(checksummedOwner);

    expect(canonical).toBe(checksummedOwner.toLowerCase());
    expect(buildBrowserOwnerDataScopeKey(`  ${checksummedOwner.toLowerCase()}  `)).toBe(canonical);
    expect(buildBrowserOwnerDataScopeKey('not-an-address')).toBe('');
  });

  it('is stable across equivalent session wrappers and unrelated live-chain state', () => {
    const first = buildBrowserWalletRuntimeScopeKey(base);
    const equivalent = buildBrowserWalletRuntimeScopeKey({
      ...base,
      session: { ...session }
    });

    expect(equivalent).toBe(first);
  });

  it('changes only for a deliberate runtime variant transition', () => {
    const publicScope = buildBrowserWalletRuntimeScopeKey({ ...base, variant: 'public' });
    const privateScope = buildBrowserWalletRuntimeScopeKey({ ...base, variant: 'private' });

    expect(publicScope).not.toBeNull();
    expect(privateScope).not.toBeNull();
    expect(privateScope).not.toBe(publicScope);
  });

  it('fails closed for a real signer, account, network, deployment, or wallet identity change', () => {
    expect(buildBrowserWalletRuntimeScopeKey({ ...base, activeSignerSource: null })).toBeNull();
    expect(buildBrowserWalletRuntimeScopeKey({
      ...base,
      session: { ...session, address: '0x2222222222222222222222222222222222222222' }
    })).toBeNull();
    expect(buildBrowserWalletRuntimeScopeKey({ ...base, session: { ...session, chainId: 1 } })).toBeNull();
    expect(buildBrowserWalletRuntimeScopeKey({ ...base, deploymentFingerprint: '' })).toBeNull();
    expect(buildBrowserWalletRuntimeScopeKey({ ...base, session: { ...session, walletId: '' } })).toBeNull();
  });

  it('rejects malformed session chain and address values without throwing', () => {
    expect(buildBrowserWalletRuntimeScopeKey({
      ...base,
      session: { ...session, chainId: Number.NaN }
    })).toBeNull();
    expect(buildBrowserWalletRuntimeScopeKey({
      ...base,
      session: { ...session, address: 'not-an-address' }
    })).toBeNull();
  });
});
