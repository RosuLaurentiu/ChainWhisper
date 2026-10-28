import {
  assertCanonicalPrivateLiquidityLogRange,
  type CanonicalPrivateLiquidityLogRange
} from './privateLiquidityChain';
import type { ParsedPrivateLiquidityV1Log } from './privateLiquidityEvents';
import {
  materializePrivateLiquidityHistory,
  type DecryptedPrivateLiquidityPositionReceipt,
  type DecryptedPrivateLiquidityTraderReceipt,
  type PrivateLiquidityHistory,
  type PrivateLiquiditySwapMarker
} from './privateLiquidityHistory';
import {
  decryptPrivateLiquidityReceiptAmount,
  type DecryptPrivateLiquidityUint256
} from './privateLiquidityReceipt';
import { normalizePrivateLiquidityAddress } from './privateLiquidity';

export type PrivateLiquidityHistoryCoverage = Readonly<{
  fromBlock: string;
  toBlock: string;
  safeHead: string;
  completeFromDeploymentThroughSafeHead: boolean;
  hasRangeGaps: boolean;
}>;

export type CanonicalPrivateLiquidityHistorySnapshot = Readonly<{
  history: PrivateLiquidityHistory;
  coverage: PrivateLiquidityHistoryCoverage;
}>;

const rangeNumber = (value: string, label: string): bigint => {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${label} must be canonical decimal.`);
  return BigInt(value);
};

const sameEvent = (left: ParsedPrivateLiquidityV1Log, right: ParsedPrivateLiquidityV1Log): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export const materializeCanonicalPrivateLiquidityHistory = async ({
  pages,
  viewer,
  decrypt
}: {
  pages: readonly CanonicalPrivateLiquidityLogRange[];
  viewer: string;
  decrypt: DecryptPrivateLiquidityUint256;
}): Promise<CanonicalPrivateLiquidityHistorySnapshot> => {
  if (pages.length === 0) throw new Error('Canonical private-liquidity history requires at least one range.');
  const normalizedViewer = normalizePrivateLiquidityAddress(viewer, 'Private-liquidity history viewer');
  if (typeof decrypt !== 'function') throw new Error('Private-liquidity history decryptor is unavailable.');
  pages.forEach(assertCanonicalPrivateLiquidityLogRange);

  const expectedScope = pages[0].scope;
  for (const page of pages) {
    if (
      page.scope.chainId !== expectedScope.chainId ||
      page.scope.contractAddress !== expectedScope.contractAddress ||
      page.scope.deploymentBlock !== expectedScope.deploymentBlock
    ) {
      throw new Error('Canonical private-liquidity history ranges belong to different deployments.');
    }
  }

  const sortedPages = [...pages].sort((left, right) => {
    const leftFrom = BigInt(left.range.fromBlock);
    const rightFrom = BigInt(right.range.fromBlock);
    return leftFrom < rightFrom ? -1 : leftFrom > rightFrom ? 1 : 0;
  });
  let coveredThrough = rangeNumber(sortedPages[0].range.toBlock, 'First history range end');
  let hasRangeGaps = false;
  let safeHead = 0n;
  for (let index = 0; index < sortedPages.length; index += 1) {
    const page = sortedPages[index];
    const from = rangeNumber(page.range.fromBlock, 'History range start');
    const to = rangeNumber(page.range.toBlock, 'History range end');
    if (index > 0 && from > coveredThrough + 1n) hasRangeGaps = true;
    if (to > coveredThrough) coveredThrough = to;
    const pageSafeHead = rangeNumber(page.safeHead.number, 'History range safe head');
    if (pageSafeHead > safeHead) safeHead = pageSafeHead;
  }

  const eventsByKey = new Map<string, ParsedPrivateLiquidityV1Log>();
  for (const page of sortedPages) {
    for (const event of page.events) {
      const previous = eventsByKey.get(event.rawEventKey);
      if (previous && !sameEvent(previous, event)) {
        throw new Error(`Conflicting canonical private-liquidity event ${event.rawEventKey}.`);
      }
      if (!previous) eventsByKey.set(event.rawEventKey, event);
    }
  }

  const markers: PrivateLiquiditySwapMarker[] = [];
  const traderReceipts: DecryptedPrivateLiquidityTraderReceipt[] = [];
  const positionReceipts: DecryptedPrivateLiquidityPositionReceipt[] = [];
  for (const event of eventsByKey.values()) {
    if (event.kind === 'swap-executed') {
      markers.push(Object.freeze({
        provenance: event.provenance,
        swapId: event.swapId,
        trader: event.trader,
        pairKey: event.pairKey,
        direction: event.direction,
        candidateCount: event.candidateCount
      }));
      continue;
    }
    if (event.kind === 'trader-swap-receipt' && event.recipient === normalizedViewer) {
      const [inputAmount, outputAmount, unusedInputAmount] = await Promise.all([
        decryptPrivateLiquidityReceiptAmount({ encrypted: event.inputAmount, decrypt }),
        decryptPrivateLiquidityReceiptAmount({ encrypted: event.outputAmount, decrypt }),
        decryptPrivateLiquidityReceiptAmount({ encrypted: event.unusedInputAmount, decrypt })
      ]);
      traderReceipts.push(Object.freeze({
        provenance: event.provenance,
        swapId: event.swapId,
        recipient: event.recipient,
        pairKey: event.pairKey,
        direction: event.direction,
        inputAmount: inputAmount.toString(),
        outputAmount: outputAmount.toString(),
        unusedInputAmount: unusedInputAmount.toString()
      }));
      continue;
    }
    if (event.kind === 'position-execution-receipt' && event.recipient === normalizedViewer) {
      const [baseAmount, quoteAmount] = await Promise.all([
        decryptPrivateLiquidityReceiptAmount({ encrypted: event.baseAmount, decrypt }),
        decryptPrivateLiquidityReceiptAmount({ encrypted: event.quoteAmount, decrypt })
      ]);
      positionReceipts.push(Object.freeze({
        provenance: event.provenance,
        positionId: event.positionId,
        swapId: event.swapId,
        recipient: event.recipient,
        direction: event.direction,
        baseAmount: baseAmount.toString(),
        quoteAmount: quoteAmount.toString()
      }));
    }
  }

  const fromBlock = rangeNumber(sortedPages[0].range.fromBlock, 'First history range start');
  const deploymentBlock = rangeNumber(expectedScope.deploymentBlock, 'History deployment block');
  return Object.freeze({
    history: materializePrivateLiquidityHistory({
      viewer: normalizedViewer,
      markers,
      traderReceipts,
      positionReceipts
    }),
    coverage: Object.freeze({
      fromBlock: fromBlock.toString(),
      toBlock: coveredThrough.toString(),
      safeHead: safeHead.toString(),
      completeFromDeploymentThroughSafeHead:
        fromBlock === deploymentBlock && !hasRangeGaps && coveredThrough >= safeHead,
      hasRangeGaps
    })
  });
};
