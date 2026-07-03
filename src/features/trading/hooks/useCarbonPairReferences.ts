import { useEffect } from 'react';
import {
  CARBON_PAIR_REFERENCE_CACHE_TTL_MS,
  fetchCarbonPairReference
} from '../../../lib/carbonMarketPrice';
import type {
  CarbonPairReferenceState,
  CarbonPairRequest
} from '../components/P2PTradingPage.helpers';

type UseCarbonPairReferencesArgs = {
  activeCarbonPairRequests: CarbonPairRequest[];
  carbonPairReferences: Record<string, CarbonPairReferenceState>;
  setCarbonPairReferences: (
    next:
      | Record<string, CarbonPairReferenceState>
      | ((previous: Record<string, CarbonPairReferenceState>) => Record<string, CarbonPairReferenceState>)
  ) => void;
};

export default function useCarbonPairReferences({
  activeCarbonPairRequests,
  carbonPairReferences,
  setCarbonPairReferences
}: UseCarbonPairReferencesArgs) {
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
}
