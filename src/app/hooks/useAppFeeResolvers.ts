import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  isWalletAddress
} from '../../lib/appShared';
import { readOtcEscrowFeeAmount } from '../../lib/appChain';

type UseAppFeeResolversArgs = {
  setTradeRequiredFeeWei: Dispatch<SetStateAction<bigint | null>>;
};

/**
 * Holds the read-only fee caches still consumed by legacy reward metrics and
 * loads only the active Direct OTC fee. Chat V2 and Group V2 resolve their own
 * deployment-bound fees and must not fall back to V1 contracts.
 */
export default function useAppFeeResolvers({
  setTradeRequiredFeeWei
}: UseAppFeeResolversArgs) {
  const groupRequiredFeeCacheRef = useRef<bigint | null>(null);
  const groupTokenFeeCacheRef = useRef<bigint | null>(null);

  const resetGroupFeeCaches = useCallback(() => {
    groupRequiredFeeCacheRef.current = null;
    groupTokenFeeCacheRef.current = null;
  }, []);

  useEffect(() => {
    if (!isWalletAddress(DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS)) {
      setTradeRequiredFeeWei(null);
      return;
    }

    let cancelled = false;
    readOtcEscrowFeeAmount(DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS)
      .then((fee) => {
        if (!cancelled) setTradeRequiredFeeWei(fee);
      })
      .catch(() => {
        if (!cancelled) setTradeRequiredFeeWei(null);
      });

    return () => {
      cancelled = true;
    };
  }, [setTradeRequiredFeeWei]);

  return {
    groupRequiredFeeCacheRef,
    groupTokenFeeCacheRef,
    resetGroupFeeCaches
  };
}
