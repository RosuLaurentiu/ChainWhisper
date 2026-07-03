import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TradeSnapshot } from '../../../lib/appShared';
import {
  CARBON_PAIR_REFERENCE_CACHE_TTL_MS,
  fetchCarbonPairReference,
  formatCarbonPairReferenceDisplay,
  resolveCarbonPricePair,
  type CarbonPairReference,
  type CarbonPairReferenceDisplay,
  type CarbonPriceAsset
} from '../../../lib/carbonMarketPrice';
import { getTradeDisplayTerms } from '../../../lib/p2pTradeView';
import { resolveTradeOrderSummary } from '../../../lib/tradePerspective';
import type { TradePageView } from './useP2PTradeRoute';
import type { TerminalReturnSurface } from '../components/P2PTradingPage.helpers';

type CarbonPairReferenceState = {
  reference: CarbonPairReference | null;
  updatedAt: number;
};

export type CarbonPairRequest = {
  baseAsset: CarbonPriceAsset;
  quoteAsset: CarbonPriceAsset;
  pairKey: string;
};

type CarbonReferenceContext = {
  label: string | null;
  basisLabel: string | null;
  title: string | null;
  baseSymbol: string;
  quoteSymbol: string;
  price: number | null;
  usedPublicCounterpart: boolean;
  sourcePair: string;
  carbonPair: string;
} | null;

type UseCarbonPairReferencesArgs = {
  routeSurfaceView: TerminalReturnSurface | TradePageView | null;
  routeView: TradePageView;
  swapBuyToken?: CarbonPriceAsset | null;
  swapSellToken?: CarbonPriceAsset | null;
  terminalPanelTrade: TradeSnapshot | null;
  tradeComposerOfferToken?: CarbonPriceAsset | null;
  tradeComposerRequestToken?: CarbonPriceAsset | null;
  walletAddress: string;
};

export const buildActiveCarbonPairRequests = ({
  routeSurfaceView,
  routeView,
  swapBuyToken,
  swapSellToken,
  terminalPanelTrade,
  tradeComposerOfferToken,
  tradeComposerRequestToken,
  walletAddress
}: UseCarbonPairReferencesArgs): CarbonPairRequest[] => {
  const requests: CarbonPairRequest[] = [];
  const seenPairKeys = new Set<string>();
  const addPair = (baseAsset?: CarbonPriceAsset | null, quoteAsset?: CarbonPriceAsset | null) => {
    const pair = resolveCarbonPricePair(baseAsset, quoteAsset);
    if (!pair || seenPairKeys.has(pair.pairKey) || !baseAsset || !quoteAsset) {
      return;
    }
    seenPairKeys.add(pair.pairKey);
    requests.push({
      baseAsset,
      pairKey: pair.pairKey,
      quoteAsset
    });
  };

  if (routeView === 'create' || routeView === 'counter') {
    addPair(tradeComposerOfferToken, tradeComposerRequestToken);
  }
  if (routeSurfaceView === 'swap' || routeSurfaceView === 'agent') {
    addPair(swapBuyToken, swapSellToken);
  }

  if (terminalPanelTrade) {
    const recurring = terminalPanelTrade.recurringOrder;
    if (recurring) {
      addPair(recurring.baseAsset, recurring.quoteAsset);
    } else {
      const displayTerms = getTradeDisplayTerms(terminalPanelTrade);
      const displayTrade = {
        ...terminalPanelTrade,
        offer: displayTerms.offer,
        request: displayTerms.request
      };
      const orderSummary = resolveTradeOrderSummary(displayTrade, walletAddress);
      addPair(orderSummary.primarySide.asset, orderSummary.secondarySide.asset);
    }
  }

  return requests;
};

export default function useCarbonPairReferences({
  routeSurfaceView,
  routeView,
  swapBuyToken,
  swapSellToken,
  terminalPanelTrade,
  tradeComposerOfferToken,
  tradeComposerRequestToken,
  walletAddress
}: UseCarbonPairReferencesArgs) {
  const [carbonPairReferences, setCarbonPairReferences] = useState<Record<string, CarbonPairReferenceState>>({});
  const activeCarbonPairRequests = useMemo(
    () =>
      buildActiveCarbonPairRequests({
        routeSurfaceView,
        routeView,
        swapBuyToken,
        swapSellToken,
        terminalPanelTrade,
        tradeComposerOfferToken,
        tradeComposerRequestToken,
        walletAddress
      }),
    [
      routeSurfaceView,
      routeView,
      swapBuyToken,
      swapSellToken,
      terminalPanelTrade,
      tradeComposerOfferToken,
      tradeComposerRequestToken,
      walletAddress
    ]
  );

  useEffect(() => {
    const now = Date.now();
    const requestsToFetch = activeCarbonPairRequests.filter((request) => {
      const cached = carbonPairReferences[request.pairKey];
      return !cached || now - cached.updatedAt >= CARBON_PAIR_REFERENCE_CACHE_TTL_MS;
    });
    if (!requestsToFetch.length) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    Promise.all(
      requestsToFetch.map(async (request) => {
        const reference = await fetchCarbonPairReference({
          baseAsset: request.baseAsset,
          quoteAsset: request.quoteAsset,
          signal: controller.signal
        });
        return {
          pairKey: request.pairKey,
          reference,
          updatedAt: Date.now()
        };
      })
    )
      .then((results) => {
        if (cancelled) {
          return;
        }
        setCarbonPairReferences((previous) => {
          let next = previous;
          for (const result of results) {
            const current = next[result.pairKey];
            if (current?.reference === result.reference && current.updatedAt === result.updatedAt) {
              continue;
            }
            if (next === previous) {
              next = { ...previous };
            }
            next[result.pairKey] = {
              reference: result.reference,
              updatedAt: result.updatedAt
            };
          }
          return next;
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeCarbonPairRequests, carbonPairReferences, setCarbonPairReferences]);

  const getCarbonReferenceDisplay = useCallback(
    (
      baseAsset?: CarbonPriceAsset | null,
      quoteAsset?: CarbonPriceAsset | null,
      inverted = false
    ): CarbonPairReferenceDisplay | null => {
      const pair = resolveCarbonPricePair(baseAsset, quoteAsset);
      if (!pair) {
        return null;
      }
      return formatCarbonPairReferenceDisplay(carbonPairReferences[pair.pairKey]?.reference, { inverted });
    },
    [carbonPairReferences]
  );

  const getCarbonReferenceContext = useCallback(
    (
      baseAsset?: CarbonPriceAsset | null,
      quoteAsset?: CarbonPriceAsset | null,
      inverted = false,
      referenceOverride?: CarbonPairReference | null
    ): CarbonReferenceContext => {
      const pair = resolveCarbonPricePair(baseAsset, quoteAsset);
      if (!pair) {
        return null;
      }
      const reference =
        referenceOverride === undefined ? carbonPairReferences[pair.pairKey]?.reference ?? null : referenceOverride;
      const display = formatCarbonPairReferenceDisplay(reference, { inverted });
      return display
        ? {
            label: display.label,
            basisLabel: display.basisLabel,
            title: display.title,
            baseSymbol: reference?.baseSymbol ?? pair.base.symbol,
            quoteSymbol: reference?.quoteSymbol ?? pair.quote.symbol,
            price: reference?.price ?? null,
            usedPublicCounterpart: pair.usedPublicCounterpart || Boolean(reference?.usedPublicCounterpart),
            sourcePair: `${pair.base.sourceSymbol}/${pair.quote.sourceSymbol}`,
            carbonPair: `${pair.base.symbol}/${pair.quote.symbol}`
          }
        : {
            label: null,
            basisLabel: null,
            title: null,
            baseSymbol: pair.base.symbol,
            quoteSymbol: pair.quote.symbol,
            price: null,
            usedPublicCounterpart: pair.usedPublicCounterpart,
            sourcePair: `${pair.base.sourceSymbol}/${pair.quote.sourceSymbol}`,
            carbonPair: `${pair.base.symbol}/${pair.quote.symbol}`
          };
    },
    [carbonPairReferences]
  );

  return {
    getCarbonReferenceContext,
    getCarbonReferenceDisplay
  };
}
