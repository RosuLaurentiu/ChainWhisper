import { useEffect, type Dispatch, type SetStateAction } from 'react';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  isWalletAddress
} from '../../lib/appShared';
import { readOtcEscrowFeeAmount } from '../../lib/appChain';

type UseAppFeeResolversArgs = {
  setTradeRequiredFeeWei: Dispatch<SetStateAction<bigint | null>>;
};

export default function useAppFeeResolvers({
  setTradeRequiredFeeWei
}: UseAppFeeResolversArgs) {
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

}
