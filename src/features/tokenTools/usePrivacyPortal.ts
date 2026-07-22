import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react';
import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  estimatePrivacyPortalNativeDepositGasReserveWei,
  estimatePrivacyPortalQuoteGas,
  executePrivacyPortalConversion,
  readPrivacyPortalPairMetrics,
  readPrivacyPortalQuote
} from '../../lib/appChain';
import {
  COTI_NETWORK,
  isWalletAddress,
  mergeOnboardInfoByAddress
} from '../../lib/appShared';
import {
  buildPrivacyPortalQuoteKey,
  normalizePrivacyPortalError,
  parsePrivacyAmountInput,
  resolvePrivacyPortalAllowanceRequirement,
  type PrivacyDirection,
  type PrivacyPortalConversionStage,
  type PrivacyPortalPairMetrics,
  type PrivacyPortalQuote,
  type PrivacyTokenPair
} from '../../lib/privacyPortal';

const QUOTE_DEBOUNCE_MS = 320;

export type PrivacyPortalSignerBundle = {
  cacheKey: string;
  signer: Wallet | JsonRpcSigner;
};

type UsePrivacyPortalArgs = {
  amountInput: string;
  direction: PrivacyDirection;
  enabled?: boolean;
  getPrivacySigner: () => Promise<PrivacyPortalSignerBundle>;
  hasAesReady: boolean;
  onCotiNetwork: boolean;
  pair: PrivacyTokenPair;
  runTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  setAmountInput: (value: string) => void;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  walletAddress: string;
};

type PortalContext = {
  account: string;
  amountInput: string;
  direction: PrivacyDirection;
  pairId: string;
};

const normalizeAccount = (value: string): string => {
  const normalized = value.trim();
  return isWalletAddress(normalized) ? normalized.toLowerCase() : '';
};

const contextMatches = (left: PortalContext, right: PortalContext, includeAmount = true): boolean =>
  left.account === right.account &&
  left.pairId === right.pairId &&
  left.direction === right.direction &&
  (!includeAmount || left.amountInput === right.amountInput);

const minBigInt = (left: bigint, right: bigint): bigint => left < right ? left : right;

export const formatPrivacyPortalInputAmount = (amountWei: bigint, decimals: number): string => {
  if (amountWei < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error('Unable to format the privacy amount.');
  }
  if (decimals === 0) {
    return amountWei.toString();
  }
  const scale = 10n ** BigInt(decimals);
  const whole = amountWei / scale;
  const fraction = (amountWei % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
};

export const resolvePrivacyPortalMaxAmount = ({
  balanceWei,
  maxAmountWei,
  gasReserveWei = 0n
}: {
  balanceWei: bigint;
  maxAmountWei: bigint;
  gasReserveWei?: bigint;
}): bigint => {
  const spendableBalanceWei = balanceWei > gasReserveWei ? balanceWei - gasReserveWei : 0n;
  return minBigInt(spendableBalanceWei, maxAmountWei);
};

const isExpectedGasPreviewPrerequisite = (error: unknown): boolean => {
  const message = normalizePrivacyPortalError(error).message.toLowerCase();
  return message.includes('approve') || message.includes('allowance');
};

export default function usePrivacyPortal({
  amountInput,
  direction,
  enabled = true,
  getPrivacySigner,
  hasAesReady,
  onCotiNetwork,
  pair,
  runTransactionFlow,
  setAmountInput,
  setSessionOnboardInfo,
  walletAddress
}: UsePrivacyPortalArgs) {
  const [metrics, setMetrics] = useState<PrivacyPortalPairMetrics | null>(null);
  const [quote, setQuote] = useState<PrivacyPortalQuote | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [loadingMax, setLoadingMax] = useState(false);
  const [actionStage, setActionStage] = useState<PrivacyPortalConversionStage | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [transactionHash, setTransactionHash] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const metricRequestRef = useRef(0);
  const quoteRequestRef = useRef(0);
  const maxRequestRef = useRef(0);
  const actionInFlightRef = useRef(false);
  const actionErrorContextRef = useRef<PortalContext | null>(null);
  const normalizedWalletAddress = normalizeAccount(walletAddress);
  const context: PortalContext = {
    account: normalizedWalletAddress,
    amountInput,
    direction,
    pairId: pair.id
  };
  const contextRef = useRef(context);
  contextRef.current = context;

  const mergeSignerOnboardInfo = useCallback((bundle: PrivacyPortalSignerBundle) => {
    const nextOnboardInfo = bundle.signer.getUserOnboardInfo();
    const cacheKey = (bundle.cacheKey || normalizedWalletAddress).trim().toLowerCase();
    setSessionOnboardInfo((previous) =>
      mergeOnboardInfoByAddress(previous, cacheKey, nextOnboardInfo)
    );
  }, [normalizedWalletAddress, setSessionOnboardInfo]);

  const getReadyPrivacySigner = useCallback(async (): Promise<PrivacyPortalSignerBundle> => {
    const bundle = await getPrivacySigner();
    mergeSignerOnboardInfo(bundle);
    return bundle;
  }, [getPrivacySigner, mergeSignerOnboardInfo]);

  const refresh = useCallback(() => {
    actionErrorContextRef.current = null;
    setError('');
    setRefreshVersion((previous) => previous + 1);
  }, []);

  useEffect(() => {
    if (!actionInFlightRef.current) {
      actionErrorContextRef.current = null;
      setStatusMessage('');
      setTransactionHash('');
      setActionStage(null);
      setError('');
    }
  }, [direction, normalizedWalletAddress, pair.id]);

  useEffect(() => {
    if (!actionInFlightRef.current && actionStage === 'complete' && amountInput) {
      setActionStage(null);
      setStatusMessage('');
      setTransactionHash('');
    }
  }, [actionStage, amountInput]);

  useEffect(() => {
    const requestId = metricRequestRef.current + 1;
    metricRequestRef.current = requestId;
    let cancelled = false;

    if (!enabled) {
      setMetrics(null);
      setLoadingMetrics(false);
      return () => {
        cancelled = true;
      };
    }

    setMetrics((previous) => {
      const previousAccount = previous?.account?.toLowerCase() ?? '';
      return previous?.pairId === pair.id && previousAccount === normalizedWalletAddress ? previous : null;
    });
    setLoadingMetrics(true);

    const loadMetrics = async () => {
      let signerBundle: PrivacyPortalSignerBundle | null = null;
      let signerError: unknown = null;
      if (normalizedWalletAddress && hasAesReady && onCotiNetwork) {
        try {
          signerBundle = await getReadyPrivacySigner();
        } catch (nextSignerError) {
          signerError = nextSignerError;
        }
      }

      try {
        const nextMetrics = await readPrivacyPortalPairMetrics({
          pair,
          ownerAddress: normalizedWalletAddress || null,
          signer: signerBundle?.signer ?? null
        });
        if (cancelled || metricRequestRef.current !== requestId) {
          return;
        }
        const responseAccount = nextMetrics.account?.toLowerCase() ?? '';
        if (nextMetrics.pairId !== pair.id || responseAccount !== normalizedWalletAddress) {
          return;
        }
        setMetrics(nextMetrics);
        if (signerError && hasAesReady) {
          setError(normalizePrivacyPortalError(signerError).message);
        }
      } catch (metricsError) {
        if (!cancelled && metricRequestRef.current === requestId) {
          setMetrics(null);
          setError(normalizePrivacyPortalError(metricsError).message);
        }
      } finally {
        if (!cancelled && metricRequestRef.current === requestId) {
          setLoadingMetrics(false);
        }
      }
    };

    loadMetrics().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    getReadyPrivacySigner,
    hasAesReady,
    normalizedWalletAddress,
    onCotiNetwork,
    pair,
    refreshVersion
  ]);

  useEffect(() => {
    const requestId = quoteRequestRef.current + 1;
    quoteRequestRef.current = requestId;
    let cancelled = false;
    const amountWei = parsePrivacyAmountInput(amountInput, pair.publicToken.decimals);
    const expectedQuoteKey =
      amountWei !== null && amountWei > 0n
        ? buildPrivacyPortalQuoteKey({
            chainId: pair.chainId,
            account: normalizedWalletAddress,
            pairId: pair.id,
            direction,
            amountWei
          })
        : '';

    setQuote(null);
    if (!enabled || amountWei === null || amountWei <= 0n) {
      setLoadingQuote(false);
      return () => {
        cancelled = true;
      };
    }

    const actionErrorContext = actionErrorContextRef.current;
    if (!actionInFlightRef.current && (!actionErrorContext || !contextMatches(actionErrorContext, contextRef.current))) {
      actionErrorContextRef.current = null;
      setError('');
    }
    setLoadingQuote(true);
    const timeout = window.setTimeout(() => {
      const loadQuote = async () => {
        try {
          const nextQuote = await readPrivacyPortalQuote({
            pair,
            direction,
            amountWei,
            ownerAddress: normalizedWalletAddress || null
          });
          if (
            cancelled ||
            quoteRequestRef.current !== requestId ||
            nextQuote.quoteKey !== expectedQuoteKey
          ) {
            return;
          }
          setQuote(nextQuote);

          const matchingMetrics =
            metrics?.pairId === pair.id &&
            (metrics.account?.toLowerCase() ?? '') === normalizedWalletAddress
              ? metrics
              : null;
          const allowanceRequirement = matchingMetrics
            ? resolvePrivacyPortalAllowanceRequirement({
                pair,
                direction,
                amountWei,
                publicAllowanceWei: matchingMetrics.publicAllowanceWei,
                privateAllowanceWei: matchingMetrics.privateAllowanceWei
              })
            : null;
          if (
            normalizedWalletAddress &&
            hasAesReady &&
            onCotiNetwork &&
            allowanceRequirement === 'none'
          ) {
            try {
              const signerBundle = await getReadyPrivacySigner();
              const gasPreview = await estimatePrivacyPortalQuoteGas({
                signer: signerBundle.signer,
                ownerAddress: normalizedWalletAddress,
                pair,
                direction,
                amountWei
              });
              if (
                !cancelled &&
                quoteRequestRef.current === requestId &&
                gasPreview.quote.quoteKey === expectedQuoteKey
              ) {
                setQuote(gasPreview.quote);
              }
            } catch (previewError) {
              if (
                !cancelled &&
                quoteRequestRef.current === requestId &&
                !isExpectedGasPreviewPrerequisite(previewError)
              ) {
                setError(normalizePrivacyPortalError(previewError).message);
              }
            }
          }
        } catch (quoteError) {
          if (!cancelled && quoteRequestRef.current === requestId) {
            setQuote(null);
            setError(normalizePrivacyPortalError(quoteError).message);
          }
        } finally {
          if (!cancelled && quoteRequestRef.current === requestId) {
            setLoadingQuote(false);
          }
        }
      };

      loadQuote().catch(() => {});
    }, QUOTE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    amountInput,
    direction,
    enabled,
    getReadyPrivacySigner,
    hasAesReady,
    metrics,
    normalizedWalletAddress,
    onCotiNetwork,
    pair,
    refreshVersion
  ]);

  const onMaxAmount = useCallback(async () => {
    const requestId = maxRequestRef.current + 1;
    maxRequestRef.current = requestId;
    actionErrorContextRef.current = null;
    setError('');
    setLoadingMax(true);
    const capturedContext = contextRef.current;
    try {
      if (!enabled) {
        throw new Error('The Privacy Portal is not active.');
      }
      if (!capturedContext.account) {
        throw new Error('Connect a wallet before using Max.');
      }
      if (!onCotiNetwork) {
        throw new Error('Switch to COTI Mainnet before using Max.');
      }

      let signerBundle: PrivacyPortalSignerBundle | null = null;
      if (hasAesReady) {
        signerBundle = await getReadyPrivacySigner();
      }
      if (capturedContext.direction === 'private-to-public' && !signerBundle) {
        throw new Error('Unlock privacy before using a private-token balance.');
      }

      const freshMetrics = await readPrivacyPortalPairMetrics({
        pair,
        ownerAddress: capturedContext.account,
        signer: signerBundle?.signer ?? null
      });
      if (
        freshMetrics.pairId !== capturedContext.pairId ||
        (freshMetrics.account?.toLowerCase() ?? '') !== capturedContext.account
      ) {
        return;
      }
      if (maxRequestRef.current !== requestId || !contextMatches(capturedContext, contextRef.current, false)) {
        return;
      }
      setMetrics(freshMetrics);

      const inputBalanceWei = capturedContext.direction === 'public-to-private'
        ? freshMetrics.publicBalanceWei
        : freshMetrics.privateBalanceWei;
      const directionalMaxAmountWei = capturedContext.direction === 'public-to-private'
        ? freshMetrics.limits.maxDepositWei
        : freshMetrics.limits.maxWithdrawWei;
      const maxAmountWei = capturedContext.direction === 'private-to-public'
        ? minBigInt(directionalMaxAmountWei, freshMetrics.bridgeLiquidityWei)
        : directionalMaxAmountWei;
      const minAmountWei = capturedContext.direction === 'public-to-private'
        ? freshMetrics.limits.minDepositWei
        : freshMetrics.limits.minWithdrawWei;
      if (inputBalanceWei === null) {
        throw new Error(`Unable to read the ${capturedContext.direction === 'public-to-private'
          ? pair.publicToken.symbol
          : pair.privateToken.symbol} balance.`);
      }

      let maxWei = resolvePrivacyPortalMaxAmount({ balanceWei: inputBalanceWei, maxAmountWei });
      if (maxWei <= 0n || maxWei < minAmountWei) {
        throw new Error('The available balance cannot cover the bridge minimum and required gas.');
      }
      if (pair.bridgeKind === 'native' && capturedContext.direction === 'public-to-private') {
        if (!signerBundle) {
          throw new Error('Unlock privacy before calculating the native COTI gas reserve.');
        }
        const probeAmountWei = minAmountWei > 0n && maxWei > minAmountWei
          ? minAmountWei
          : maxWei;
        const firstReserveWei = await estimatePrivacyPortalNativeDepositGasReserveWei({
          signer: signerBundle.signer,
          ownerAddress: capturedContext.account,
          pair,
          amountWei: probeAmountWei
        });
        maxWei = resolvePrivacyPortalMaxAmount({
          balanceWei: inputBalanceWei,
          maxAmountWei,
          gasReserveWei: firstReserveWei
        });
        if (maxWei > 0n && maxWei !== probeAmountWei) {
          const refinedReserveWei = await estimatePrivacyPortalNativeDepositGasReserveWei({
            signer: signerBundle.signer,
            ownerAddress: capturedContext.account,
            pair,
            amountWei: maxWei
          });
          maxWei = resolvePrivacyPortalMaxAmount({
            balanceWei: inputBalanceWei,
            maxAmountWei,
            gasReserveWei: refinedReserveWei
          });
        }
      }

      if (maxRequestRef.current !== requestId || !contextMatches(capturedContext, contextRef.current, false)) {
        return;
      }
      if (maxWei <= 0n || maxWei < minAmountWei) {
        throw new Error('The available balance cannot cover the bridge minimum and required gas.');
      }
      setQuote(null);
      setAmountInput(formatPrivacyPortalInputAmount(maxWei, pair.publicToken.decimals));
    } catch (maxError) {
      if (maxRequestRef.current === requestId && contextMatches(capturedContext, contextRef.current, false)) {
        setError(normalizePrivacyPortalError(maxError).message);
      }
    } finally {
      if (maxRequestRef.current === requestId) {
        setLoadingMax(false);
      }
    }
  }, [enabled, getReadyPrivacySigner, hasAesReady, onCotiNetwork, pair, setAmountInput]);

  const convert = useCallback(async () => {
    if (actionInFlightRef.current) {
      return;
    }
    const capturedContext = contextRef.current;
    const amountWei = parsePrivacyAmountInput(capturedContext.amountInput, pair.publicToken.decimals);
    actionErrorContextRef.current = null;
    setError('');
    setStatusMessage('');
    setTransactionHash('');
    if (!enabled) {
      setError('The Privacy Portal is not active.');
      return;
    }
    if (!capturedContext.account) {
      setError('Connect a wallet first.');
      return;
    }
    if (!onCotiNetwork) {
      setError('Switch to COTI Mainnet and try again.');
      return;
    }
    if (!hasAesReady) {
      setError('Unlock privacy for the selected account and try again.');
      return;
    }
    if (amountWei === null || amountWei <= 0n) {
      setError(`Enter a valid ${direction === 'public-to-private'
        ? pair.publicToken.symbol
        : pair.privateToken.symbol} amount.`);
      return;
    }

    actionInFlightRef.current = true;
    setActionStage('validating');
    try {
      const { conversionResult, contextChangedAfterReceipt } = await runTransactionFlow(async () => {
        if (!contextMatches(capturedContext, contextRef.current)) {
          throw new Error('The Privacy Portal selection changed before the transaction started.');
        }
        const signerBundle = await getReadyPrivacySigner();
        const conversionResult = await executePrivacyPortalConversion({
          signer: signerBundle.signer,
          ownerAddress: capturedContext.account,
          pair,
          direction: capturedContext.direction,
          amountWei,
          onProgress: (stage) => {
            if (contextMatches(capturedContext, contextRef.current)) {
              setActionStage(stage);
            }
          }
        });
        const contextChangedAfterReceipt = !contextMatches(capturedContext, contextRef.current);
        mergeSignerOnboardInfo(signerBundle);
        return { conversionResult, contextChangedAfterReceipt };
      });

      if (!contextChangedAfterReceipt) {
        setQuote(conversionResult.quote);
      }
      setTransactionHash(conversionResult.transactionHash);
      setStatusMessage(
        contextChangedAfterReceipt
          ? `${pair.publicToken.symbol} conversion confirmed for the original account. The active selection changed after submission, so refresh its balances before continuing.`
          : `${pair.publicToken.symbol} conversion confirmed through the official COTI bridge.`
      );
      if (!contextChangedAfterReceipt) {
        setAmountInput('');
      }
      setActionStage('complete');
      setRefreshVersion((previous) => previous + 1);
    } catch (conversionError) {
      const normalizedError = normalizePrivacyPortalError(conversionError);
      setActionStage(null);
      actionErrorContextRef.current = capturedContext;
      setError(normalizedError.message);
      if (/oracle/i.test(normalizedError.message)) {
        setRefreshVersion((previous) => previous + 1);
      }
    } finally {
      actionInFlightRef.current = false;
    }
  }, [
    direction,
    enabled,
    getReadyPrivacySigner,
    hasAesReady,
    mergeSignerOnboardInfo,
    onCotiNetwork,
    pair,
    runTransactionFlow,
    setAmountInput
  ]);

  const transactionUrl = useMemo(
    () => transactionHash ? `${COTI_NETWORK.blockExplorerUrl}/tx/${transactionHash}` : '',
    [transactionHash]
  );

  return {
    actionStage,
    convert,
    error,
    loading: loadingMetrics || loadingQuote || loadingMax,
    loadingMax,
    loadingMetrics,
    loadingQuote,
    metrics,
    onMaxAmount,
    quote,
    refresh,
    statusMessage,
    transactionHash,
    transactionUrl
  };
}
