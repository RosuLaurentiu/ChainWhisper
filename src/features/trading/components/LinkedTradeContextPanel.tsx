import {
  formatTradeAssetDisplayText,
  shortenAddress
} from '../../../lib/appShared';
import type { LinkedTradeContext } from '../../../lib/linkedTradeContext';
import { formatTradeContractIdLabel } from '../../../lib/p2pTradeView';
import { resolveTradeOrderSummary, resolveTradePriceRatioDisplay } from '../../../lib/tradePerspective';

type LinkedTradeContextPanelProps = {
  context: LinkedTradeContext;
  currentWalletAddress?: string;
  onCopyShareLink: (value: string) => void;
  onDismiss: () => void;
  onOpenTerminal: (path: string) => void;
  shareCopied?: boolean;
};

export default function LinkedTradeContextPanel({
  context,
  currentWalletAddress,
  onCopyShareLink,
  onDismiss,
  onOpenTerminal,
  shareCopied = false
}: LinkedTradeContextPanelProps) {
  const preview = context.previewOffer;
  const summary =
    preview?.offer && preview.request
      ? resolveTradeOrderSummary(
          {
            maker: preview.maker,
            taker: preview.taker,
            offer: preview.offer,
            request: preview.request
          },
          currentWalletAddress
        )
      : null;
  const primarySide = summary?.primarySide;
  const secondarySide = summary?.secondarySide;
  const ratioDisplay =
    primarySide && secondarySide
      ? resolveTradePriceRatioDisplay({
          baseAsset: primarySide.asset,
          quoteAsset: secondarySide.asset,
          subjectLabel: `linked trade ${context.tradeId}`
        })
      : null;
  const title = preview ? summary?.directionLabel ?? formatTradeContractIdLabel(preview) : `Trade #${context.tradeId}`;
  const meta = preview
    ? `${formatTradeContractIdLabel(preview)} with ${shortenAddress(context.counterpartyAddress ?? preview.maker)}`
    : `Linked order #${context.tradeId}`;

  return (
    <section className="linked-trade-context" aria-label="Linked trade context">
      <div className="linked-trade-context-head">
        <div>
          <span>Linked trade</span>
          <strong>{title}</strong>
        </div>
        <button type="button" onClick={onDismiss} aria-label="Dismiss linked trade">
          Dismiss
        </button>
      </div>
      <div className="linked-trade-context-body">
        <p>{meta}</p>
        {primarySide && secondarySide ? (
          <div className="linked-trade-context-terms" aria-label="Linked trade terms">
            <div className={`linked-trade-context-term linked-trade-context-term-${primarySide.tone}`}>
              <span>{primarySide.label}</span>
              <strong>{formatTradeAssetDisplayText(primarySide.asset)}</strong>
            </div>
            <div className={`linked-trade-context-term linked-trade-context-term-${secondarySide.tone}`}>
              <span>{secondarySide.label}</span>
              <strong>{formatTradeAssetDisplayText(secondarySide.asset)}</strong>
            </div>
          </div>
        ) : null}
        {ratioDisplay ? <small>Price ratio: {ratioDisplay.label}</small> : null}
      </div>
      <div className="linked-trade-context-actions">
        <button type="button" onClick={() => onOpenTerminal(context.terminalPath)}>
          Open order
        </button>
        {context.shareUrl ? (
          <button type="button" onClick={() => onCopyShareLink(context.shareUrl as string)} aria-live="polite">
            {shareCopied ? 'Copied' : 'Copy link'}
          </button>
        ) : null}
      </div>
    </section>
  );
}
