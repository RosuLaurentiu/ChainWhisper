import { useCallback, useRef } from 'react';
import type { JsonRpcSigner } from '@coti-io/coti-ethers';
import type { WalletSessionActions } from '../../../lib/walletSession';

export type P2PTradeSigner = JsonRpcSigner;
export type P2PTradeSignerOptions = {
  refreshAes?: boolean;
};

type UseP2PTradeSignerArgs = {
  chainId: number | null;
  sharedGetSigner?: WalletSessionActions['getSigner'];
  walletAddress: string;
};

export const acquireSharedP2PTradeSigner = async (
  sharedGetSigner: WalletSessionActions['getSigner'] | undefined,
  requireAes: boolean,
  options: P2PTradeSignerOptions,
  expectedWalletKey: string,
  assertCurrent: () => void | Promise<void>
): Promise<P2PTradeSigner | null> => {
  if (!sharedGetSigner) {
    throw new Error('Trading requires the connected ChainWhisper browser-wallet session. Reconnect the wallet and try again.');
  }
  await assertCurrent();
  const signer = await sharedGetSigner(requireAes, options);
  await assertCurrent();
  if (signer.address.trim().toLowerCase() !== expectedWalletKey) {
    throw new Error('Connected wallet changed while the trade action was pending.');
  }
  return signer;
};

export default function useP2PTradeSigner({
  chainId,
  sharedGetSigner,
  walletAddress
}: UseP2PTradeSignerArgs): (requireAes: boolean, options?: P2PTradeSignerOptions) => Promise<P2PTradeSigner> {
  const activeChainIdRef = useRef(chainId);
  const activeWalletAddressRef = useRef(walletAddress.trim().toLowerCase());
  activeChainIdRef.current = chainId;
  activeWalletAddressRef.current = walletAddress.trim().toLowerCase();

  return useCallback(
    async (requireAes: boolean, options: P2PTradeSignerOptions = {}): Promise<P2PTradeSigner> => {
      const expectedWalletKey = walletAddress.trim().toLowerCase();
      const expectedChainId = chainId;
      const assertSharedTradeSessionCurrent = () => {
        if (
          !expectedWalletKey ||
          activeWalletAddressRef.current !== expectedWalletKey ||
          activeChainIdRef.current !== expectedChainId
        ) {
          throw new Error('ChainWhisper wallet session changed. Reopen the trade action and try again.');
        }
      };
      const sharedSigner = await acquireSharedP2PTradeSigner(
        sharedGetSigner,
        requireAes,
        options,
        expectedWalletKey,
        assertSharedTradeSessionCurrent
      );
      if (sharedSigner) {
        return sharedSigner;
      }
      throw new Error('Trading signer acquisition failed. Reconnect the wallet and try again.');
    },
    [
      chainId,
      sharedGetSigner,
      walletAddress
    ]
  );
}
