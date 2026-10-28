import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COTI_NETWORK } from './appShared';
import {
  connectCipherTradeWalletConnect,
  discardCipherTradeWalletConnectProvider,
  disconnectCipherTradeWalletConnect,
  forgetCipherTradeWalletConnectProvider,
  isCipherTradeWalletConnectPeer,
  isUsableWalletConnectProjectId,
  resetCipherTradeWalletConnectForTests
} from './walletConnectMobile';

const walletConnectMock = vi.hoisted(() => ({
  providers: [] as unknown[],
  init: vi.fn(async () => {
    const provider = walletConnectMock.providers.shift();
    if (!provider) throw new Error('No WalletConnect provider fixture queued.');
    return provider;
  })
}));

vi.mock('@walletconnect/ethereum-provider', () => ({
  EthereumProvider: {
    init: walletConnectMock.init
  }
}));

const OWNER = '0x1111111111111111111111111111111111111111';

const createProvider = ({
  account = OWNER,
  chainId = COTI_NETWORK.chainIdDecimal,
  connectError,
  peerName = 'CipherTrade Mobile'
}: {
  account?: string;
  chainId?: number | string;
  connectError?: Error;
  peerName?: string;
} = {}) => {
  const provider = {
    accounts: account ? [account] : [],
    chainId,
    connect: vi.fn(async () => {
      if (connectError) throw connectError;
    }),
    disconnect: vi.fn(async () => undefined),
    on: vi.fn(),
    removeListener: vi.fn(),
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') return account ? [account] : [];
      if (method === 'eth_chainId') return chainId;
      return null;
    }),
    session: {
      peer: {
        metadata: {
          name: peerName
        }
      }
    }
  };
  return provider;
};

describe('CipherTrade WalletConnect policy', () => {
  beforeEach(() => {
    resetCipherTradeWalletConnectForTests();
    walletConnectMock.providers.length = 0;
    walletConnectMock.init.mockClear();
    vi.stubEnv('VITE_WALLETCONNECT_PROJECT_ID', 'valid_project_id_1234567890');
  });

  afterEach(() => {
    resetCipherTradeWalletConnectForTests();
    vi.unstubAllEnvs();
  });

  it('accepts current and legacy CipherTrade peer spellings', () => {
    expect(isCipherTradeWalletConnectPeer({ name: 'CipherTrade' })).toBe(true);
    expect(isCipherTradeWalletConnectPeer({ name: 'CypherTrade Mobile' })).toBe(true);
    expect(isCipherTradeWalletConnectPeer({ url: 'https://ciphertrade.org' })).toBe(true);
  });

  it('rejects other WalletConnect peers instead of broadening the wallet allowlist', () => {
    expect(isCipherTradeWalletConnectPeer({ name: 'Other Wallet' })).toBe(false);
    expect(isCipherTradeWalletConnectPeer(undefined)).toBe(false);
  });

  it('fails closed on missing and placeholder project ids', () => {
    expect(isUsableWalletConnectProjectId('')).toBe(false);
    expect(isUsableWalletConnectProjectId('your_walletconnect_project_id_here')).toBe(false);
    expect(isUsableWalletConnectProjectId('valid_project_id_1234567890')).toBe(true);
  });

  it('returns an exact COTI session only after CipherTrade identity, address, and chain validation', async () => {
    const provider = createProvider();
    walletConnectMock.providers.push(provider);

    const session = await connectCipherTradeWalletConnect();

    expect(session).toEqual(expect.objectContaining({
      address: OWNER,
      chainId: COTI_NETWORK.chainIdDecimal,
      provider,
      source: 'walletconnect',
      walletId: 'ciphertrade-walletconnect',
      walletLabel: 'CipherTrade Mobile'
    }));
    expect(Object.isFrozen(session)).toBe(true);
    expect(provider.connect).toHaveBeenCalledWith({
      chains: [COTI_NETWORK.chainIdDecimal],
      rpcMap: { [COTI_NETWORK.chainIdDecimal]: COTI_NETWORK.rpcUrl }
    });
    expect(provider.disconnect).not.toHaveBeenCalled();
  });

  it.each([
    ['a different peer', { peerName: 'Other Wallet' }, 'only accepts CipherTrade Mobile'],
    ['a malformed account', { account: '0x1234' }, 'valid wallet account'],
    ['the wrong chain', { chainId: 1 }, `Select ${COTI_NETWORK.chainName}`]
  ])('disconnects and discards %s before allowing a fresh retry', async (_label, options, message) => {
    const rejectedProvider = createProvider(options);
    const acceptedProvider = createProvider();
    walletConnectMock.providers.push(rejectedProvider, acceptedProvider);

    await expect(connectCipherTradeWalletConnect()).rejects.toThrow(message);
    expect(rejectedProvider.disconnect).toHaveBeenCalledTimes(1);

    await expect(connectCipherTradeWalletConnect()).resolves.toMatchObject({ address: OWNER });
    expect(walletConnectMock.init).toHaveBeenCalledTimes(2);
  });

  it('discards a cancelled or failed connection before retrying with a new provider', async () => {
    const cancelledProvider = createProvider({ connectError: new Error('Connection cancelled') });
    const acceptedProvider = createProvider();
    walletConnectMock.providers.push(cancelledProvider, acceptedProvider);

    await expect(connectCipherTradeWalletConnect()).rejects.toThrow('Connection cancelled');
    expect(cancelledProvider.disconnect).toHaveBeenCalledTimes(1);
    await expect(connectCipherTradeWalletConnect()).resolves.toMatchObject({ address: OWNER });
    expect(walletConnectMock.init).toHaveBeenCalledTimes(2);
  });

  it('clears the cached provider on explicit disconnect so reconnect starts a new QR session', async () => {
    const firstProvider = createProvider();
    const secondProvider = createProvider();
    walletConnectMock.providers.push(firstProvider, secondProvider);

    await connectCipherTradeWalletConnect();
    await disconnectCipherTradeWalletConnect();
    expect(firstProvider.disconnect).toHaveBeenCalledTimes(1);

    const reconnected = await connectCipherTradeWalletConnect();
    expect(reconnected.provider).toBe(secondProvider);
    expect(walletConnectMock.init).toHaveBeenCalledTimes(2);
  });

  it('discards a superseded QR session without disconnecting the next provider', async () => {
    const supersededProvider = createProvider();
    const replacementProvider = createProvider();
    walletConnectMock.providers.push(supersededProvider, replacementProvider);

    const superseded = await connectCipherTradeWalletConnect();
    await discardCipherTradeWalletConnectProvider(superseded.provider);

    expect(supersededProvider.disconnect).toHaveBeenCalledTimes(1);
    const replacement = await connectCipherTradeWalletConnect();
    expect(replacement.provider).toBe(replacementProvider);
    expect(replacementProvider.disconnect).not.toHaveBeenCalled();
  });

  it('forgets a remotely disconnected provider so reconnect creates a fresh QR session', async () => {
    const remoteProvider = createProvider();
    const replacementProvider = createProvider();
    walletConnectMock.providers.push(remoteProvider, replacementProvider);

    const remote = await connectCipherTradeWalletConnect();
    forgetCipherTradeWalletConnectProvider(remote.provider);

    const replacement = await connectCipherTradeWalletConnect();
    expect(replacement.provider).toBe(replacementProvider);
    expect(remoteProvider.disconnect).not.toHaveBeenCalled();
    expect(walletConnectMock.init).toHaveBeenCalledTimes(2);
  });
});
