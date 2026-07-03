import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  CHAT_CONTRACT_ABI,
  CHAT_CONTRACT_ADDRESS,
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  GROUP_CHAT_CONTRACT_ABI,
  GROUP_CHAT_CONTRACT_ADDRESS,
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiReadProvider
} from '../../lib/appShared';
import { readOtcEscrowFeeAmount } from '../../lib/appChain';

type UseAppFeeResolversArgs = {
  requiredFeeWei: bigint | null;
  setRequiredFeeWei: Dispatch<SetStateAction<bigint | null>>;
  setTradeRequiredFeeWei: Dispatch<SetStateAction<bigint | null>>;
};

export default function useAppFeeResolvers({
  requiredFeeWei,
  setRequiredFeeWei,
  setTradeRequiredFeeWei
}: UseAppFeeResolversArgs) {
  const requiredFeeCacheRef = useRef<bigint | null>(null);
  const requiredFeeRequestRef = useRef<Promise<bigint> | null>(null);
  const groupRequiredFeeCacheRef = useRef<bigint | null>(null);
  const groupRequiredFeeRequestRef = useRef<Promise<bigint> | null>(null);
  const groupTokenFeeCacheRef = useRef<bigint | null>(null);
  const groupTokenFeeRequestRef = useRef<Promise<bigint> | null>(null);
  const tradeRequiredFeeCacheRef = useRef<bigint | null>(null);
  const tradeRequiredFeeRequestRef = useRef<Promise<bigint> | null>(null);
  const submitSelectorRef = useRef<string | null>(null);
  const groupSubmitSelectorRef = useRef<string | null>(null);
  const resolveSubmitSelectorRef = useRef<() => Promise<string>>(async () => {
    throw new Error('Submit selector is not ready yet.');
  });
  const resolveRequiredFeeForSendRef = useRef<() => Promise<bigint>>(async () => {
    throw new Error('Fee resolver is not ready yet.');
  });

  const resolveSubmitSelector = useCallback(async (): Promise<string> => {
    if (submitSelectorRef.current) {
      return submitSelectorRef.current;
    }

    const cotiEthers = await loadCotiEthersModule();
    const selector = new cotiEthers.Interface(CHAT_CONTRACT_ABI).getFunction('submit')?.selector;
    if (!selector) {
      throw new Error('Unable to resolve submit selector.');
    }

    submitSelectorRef.current = selector;
    return selector;
  }, []);
  resolveSubmitSelectorRef.current = resolveSubmitSelector;

  const resolveGroupSubmitSelector = useCallback(async (): Promise<string> => {
    if (groupSubmitSelectorRef.current) {
      return groupSubmitSelectorRef.current;
    }

    const cotiEthers = await loadCotiEthersModule();
    const selector = new cotiEthers.Interface(GROUP_CHAT_CONTRACT_ABI).getFunction('submitGroupMessageWithMode')?.selector;
    if (!selector) {
      throw new Error('Unable to resolve group submit selector for fee mode.');
    }

    groupSubmitSelectorRef.current = selector;
    return selector;
  }, []);

  const resolveRequiredFeeForSend = useCallback(async (): Promise<bigint> => {
    if (requiredFeeCacheRef.current !== null && requiredFeeCacheRef.current > 0n) {
      return requiredFeeCacheRef.current;
    }

    if (requiredFeeWei !== null && requiredFeeWei > 0n) {
      requiredFeeCacheRef.current = requiredFeeWei;
      return requiredFeeWei;
    }

    if (!requiredFeeRequestRef.current) {
      requiredFeeRequestRef.current = (async () => {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const readContract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, readProvider);
        const resolvedFee = (await readContract.feeAmount()) as bigint;
        requiredFeeCacheRef.current = resolvedFee;
        setRequiredFeeWei(resolvedFee);
        return resolvedFee;
      })();
    }

    try {
      return await requiredFeeRequestRef.current;
    } finally {
      requiredFeeRequestRef.current = null;
    }
  }, [requiredFeeWei, setRequiredFeeWei]);
  resolveRequiredFeeForSendRef.current = resolveRequiredFeeForSend;

  const resolveRequiredFeeForGroupSend = useCallback(async (): Promise<bigint> => {
    if (groupRequiredFeeCacheRef.current !== null && groupRequiredFeeCacheRef.current > 0n) {
      return groupRequiredFeeCacheRef.current;
    }

    if (!groupRequiredFeeRequestRef.current) {
      groupRequiredFeeRequestRef.current = (async () => {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const readContract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, readProvider);
        const resolvedFee = (await readContract.feeAmount()) as bigint;
        groupRequiredFeeCacheRef.current = resolvedFee;
        return resolvedFee;
      })();
    }

    try {
      return await groupRequiredFeeRequestRef.current;
    } finally {
      groupRequiredFeeRequestRef.current = null;
    }
  }, []);

  const resolveRequiredTokenFeeForGroupSend = useCallback(async (): Promise<bigint> => {
    if (groupTokenFeeCacheRef.current !== null) {
      return groupTokenFeeCacheRef.current;
    }

    if (!groupTokenFeeRequestRef.current) {
      groupTokenFeeRequestRef.current = (async () => {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const readContract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, readProvider);
        const resolvedFee = (await readContract.tokenFeeAmount()) as bigint;
        groupTokenFeeCacheRef.current = resolvedFee;
        return resolvedFee;
      })();
    }

    try {
      return await groupTokenFeeRequestRef.current;
    } finally {
      groupTokenFeeRequestRef.current = null;
    }
  }, []);

  const resolveRequiredFeeForTradeCreate = useCallback(
    async (escrowContract?: string | null): Promise<bigint> => {
      const resolvedEscrowContract = escrowContract ?? DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS;
      const isDefaultDirectFee = resolvedEscrowContract.toLowerCase() === DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase();
      if (isDefaultDirectFee && tradeRequiredFeeCacheRef.current !== null) {
        setTradeRequiredFeeWei(tradeRequiredFeeCacheRef.current);
        return tradeRequiredFeeCacheRef.current;
      }

      if (!isDefaultDirectFee) {
        return readOtcEscrowFeeAmount(resolvedEscrowContract);
      }

      if (!tradeRequiredFeeRequestRef.current) {
        tradeRequiredFeeRequestRef.current = (async () => {
          const resolvedFee = await readOtcEscrowFeeAmount(DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS);
          tradeRequiredFeeCacheRef.current = resolvedFee;
          setTradeRequiredFeeWei(resolvedFee);
          return resolvedFee;
        })();
      }

      try {
        return await tradeRequiredFeeRequestRef.current;
      } finally {
        tradeRequiredFeeRequestRef.current = null;
      }
    },
    [setTradeRequiredFeeWei]
  );

  const resetGroupFeeCaches = useCallback(() => {
    groupRequiredFeeCacheRef.current = null;
    groupRequiredFeeRequestRef.current = null;
    groupTokenFeeCacheRef.current = null;
    groupTokenFeeRequestRef.current = null;
    groupSubmitSelectorRef.current = null;
  }, []);

  useEffect(() => {
    requiredFeeCacheRef.current = requiredFeeWei;
  }, [requiredFeeWei]);

  useEffect(() => {
    if (!DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS || !isWalletAddress(DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS)) {
      tradeRequiredFeeCacheRef.current = null;
      tradeRequiredFeeRequestRef.current = null;
      setTradeRequiredFeeWei(null);
      return;
    }

    let cancelled = false;

    const loadTradeFees = async () => {
      const nativeFeeRaw = await readOtcEscrowFeeAmount(DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS).catch(() => null);

      if (cancelled) {
        return;
      }

      const nativeFee = typeof nativeFeeRaw === 'bigint' ? nativeFeeRaw : null;
      tradeRequiredFeeCacheRef.current = nativeFee;
      setTradeRequiredFeeWei(nativeFee);
    };

    loadTradeFees().catch(() => {
      if (!cancelled) {
        setTradeRequiredFeeWei(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [setTradeRequiredFeeWei]);

  return {
    groupRequiredFeeCacheRef,
    groupTokenFeeCacheRef,
    resetGroupFeeCaches,
    resolveGroupSubmitSelector,
    resolveRequiredFeeForGroupSend,
    resolveRequiredFeeForSend,
    resolveRequiredFeeForSendRef,
    resolveRequiredFeeForTradeCreate,
    resolveRequiredTokenFeeForGroupSend,
    resolveSubmitSelector,
    resolveSubmitSelectorRef
  };
}
