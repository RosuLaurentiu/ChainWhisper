import type { ReactNode } from 'react';
import type { TradeAssetPayload, TradeSnapshot } from '../../../lib/appShared';
import type { CarbonPairReferenceDisplay } from '../../../lib/carbonMarketPrice';
import type { P2PActionNoticeSurface } from '../../../lib/p2pActionNotice';
import {
  getSnapshotKey,
  type RecurringTerminalActionSide
} from '../../../lib/p2pTradeView';
import {
  buildMakerControlsKey,
  type TerminalFillInputSide
} from './P2PTradingPage.helpers';
import TradeRecurringTerminal from './TradeRecurringTerminal';
import TradeStandardTerminal from './TradeStandardTerminal';
import {
  TradeTerminalHistoryWindowForTrade,
  buildTerminalHistoryConfig,
  buildRecurringTerminalHistoryConfig,
  buildStandardTerminalHistoryConfig,
  type TerminalHistoryConfigParams
} from './tradeTerminalHistoryConfig';
import { TradeTerminalHistoryContent } from './TradeTerminalHistoryPanel';

type CounterAcceptMode = 'close-related' | 'fill';
type RecurringStatusAction = 'pause' | 'resume' | 'cancel';

export type TradeTerminalRendererProps = {
  snapshot: TradeSnapshot;
  routeView: string;
  walletAddress: string;
  walletKey: string;
  onCotiNetwork: boolean;
  lastCopiedKey: string;
  reversedRateTradeIds: Record<string, boolean>;
  expandedMakerControls: Record<string, boolean>;
  terminalFillInputSide: TerminalFillInputSide;
  terminalPayInput: string;
  terminalBuyInput: string;
  processingTradeActionId: string;
  terminalHistorySheetKey: string;
  setTerminalFillInputSide: (side: TerminalFillInputSide) => void;
  setTerminalPayInput: (value: string) => void;
  setTerminalBuyInput: (value: string) => void;
  setTerminalHistorySheetKey: (key: string) => void;
  acceptTrade: (snapshot: TradeSnapshot, counterAcceptMode?: CounterAcceptMode) => Promise<void>;
  askAgentAboutOrder: (snapshot: TradeSnapshot) => void;
  beginCounterTrade: (snapshot: TradeSnapshot) => void;
  beginEditTrade: (snapshot: TradeSnapshot) => void;
  buildTradeShareUrl: (tradeId: number, accessSecret?: string, escrowContract?: string) => string;
  cancelTrade: (snapshot: TradeSnapshot) => Promise<void>;
  changePrivateBookBudgetVisibility: (snapshot: TradeSnapshot, visible: boolean) => Promise<void>;
  renderTradeBalanceDisclosure?: (snapshot: TradeSnapshot) => ReactNode;
  copyWithFeedback: (value: string, feedbackKey: string) => Promise<void>;
  declineTrade: (snapshot: TradeSnapshot) => Promise<void>;
  fillRecurringOrderSide: (snapshot: TradeSnapshot, side: RecurringTerminalActionSide) => Promise<void>;
  getCarbonReferenceDisplay: (
    baseAsset?: TradeAssetPayload | null,
    quoteAsset?: TradeAssetPayload | null,
    inverted?: boolean
  ) => CarbonPairReferenceDisplay | null;
  partialFillTrade: (snapshot: TradeSnapshot, amountInput: string) => Promise<void>;
  renderActionNotice: (surface: P2PActionNoticeSurface, tradeKey?: string) => ReactNode;
  renderTradeConversationButton: (snapshot: TradeSnapshot, shareUrl?: string, accessSecret?: string) => ReactNode;
  resolveKnownTradeAccessSecret: (tradeId: number, escrowContract?: string) => string;
  resolveTerminalAssetBalanceLabel: (asset: TradeAssetPayload, maximumFractionDigits?: number) => string;
  toggleMakerControls: (surface: 'terminal', tradeKey: string) => void;
  toggleTradeRateDirection: (tradeId: number, escrowContract?: string) => void;
  recurringTerminalSide: RecurringTerminalActionSide;
  recurringBuyFillInput: string;
  recurringSellFillInput: string;
  processingRecurringAction: string;
  setRecurringTerminalSide: (side: RecurringTerminalActionSide) => void;
  setRecurringBuyFillInput: (value: string) => void;
  setRecurringSellFillInput: (value: string) => void;
  beginEditRecurringOrder: (snapshot: TradeSnapshot) => void;
  updateRecurringOrderStatus: (snapshot: TradeSnapshot, action: RecurringStatusAction) => Promise<void>;
  terminalHistoryConfigParams: TerminalHistoryConfigParams;
  showHistoryControl?: boolean;
};

export function TradeTerminalRenderer({
  snapshot,
  routeView,
  walletAddress,
  walletKey,
  onCotiNetwork,
  lastCopiedKey,
  reversedRateTradeIds,
  expandedMakerControls,
  terminalFillInputSide,
  terminalPayInput,
  terminalBuyInput,
  processingTradeActionId,
  terminalHistorySheetKey,
  setTerminalFillInputSide,
  setTerminalPayInput,
  setTerminalBuyInput,
  setTerminalHistorySheetKey,
  acceptTrade,
  askAgentAboutOrder,
  beginCounterTrade,
  beginEditTrade,
  buildTradeShareUrl,
  cancelTrade,
  changePrivateBookBudgetVisibility,
  renderTradeBalanceDisclosure,
  copyWithFeedback,
  declineTrade,
  fillRecurringOrderSide,
  getCarbonReferenceDisplay,
  partialFillTrade,
  renderActionNotice,
  renderTradeConversationButton,
  resolveKnownTradeAccessSecret,
  resolveTerminalAssetBalanceLabel,
  toggleMakerControls,
  toggleTradeRateDirection,
  recurringTerminalSide,
  recurringBuyFillInput,
  recurringSellFillInput,
  processingRecurringAction,
  setRecurringTerminalSide,
  setRecurringBuyFillInput,
  setRecurringSellFillInput,
  beginEditRecurringOrder,
  updateRecurringOrderStatus,
  terminalHistoryConfigParams,
  showHistoryControl = true
}: TradeTerminalRendererProps) {
  if (snapshot.recurringOrder) {
    return (
      <TradeRecurringTerminal
        snapshot={snapshot}
        walletKey={walletKey}
        onCotiNetwork={onCotiNetwork}
        lastCopiedKey={lastCopiedKey}
        reversedRateTradeIds={reversedRateTradeIds}
        recurringTerminalSide={recurringTerminalSide}
        recurringBuyFillInput={recurringBuyFillInput}
        recurringSellFillInput={recurringSellFillInput}
        processingRecurringAction={processingRecurringAction}
        makerControlsExpanded={Boolean(expandedMakerControls[buildMakerControlsKey('terminal', getSnapshotKey(snapshot))])}
        terminalHistorySheetKey={terminalHistorySheetKey}
        setRecurringTerminalSide={setRecurringTerminalSide}
        setRecurringBuyFillInput={setRecurringBuyFillInput}
        setRecurringSellFillInput={setRecurringSellFillInput}
        setTerminalHistorySheetKey={setTerminalHistorySheetKey}
        askAgentAboutOrder={askAgentAboutOrder}
        beginEditRecurringOrder={beginEditRecurringOrder}
        buildTradeShareUrl={buildTradeShareUrl}
        copyWithFeedback={copyWithFeedback}
        fillRecurringOrderSide={fillRecurringOrderSide}
        getCarbonReferenceDisplay={getCarbonReferenceDisplay}
        getRecurringTerminalHistoryConfig={(trade) =>
          buildRecurringTerminalHistoryConfig(trade, terminalHistoryConfigParams)}
        renderActionNotice={renderActionNotice}
        renderTradeConversationButton={renderTradeConversationButton}
        resolveTerminalAssetBalanceLabel={resolveTerminalAssetBalanceLabel}
        toggleMakerControls={toggleMakerControls}
        toggleTradeRateDirection={toggleTradeRateDirection}
        updateRecurringOrderStatus={updateRecurringOrderStatus}
        showHistoryControl={showHistoryControl}
      />
    );
  }

  return (
    <TradeStandardTerminal
      snapshot={snapshot}
      routeView={routeView}
      walletAddress={walletAddress}
      walletKey={walletKey}
      onCotiNetwork={onCotiNetwork}
      lastCopiedKey={lastCopiedKey}
      reversedRateTradeIds={reversedRateTradeIds}
      expandedMakerControls={expandedMakerControls}
      terminalFillInputSide={terminalFillInputSide}
      terminalPayInput={terminalPayInput}
      terminalBuyInput={terminalBuyInput}
      processingTradeActionId={processingTradeActionId}
      terminalHistorySheetKey={terminalHistorySheetKey}
      setTerminalFillInputSide={setTerminalFillInputSide}
      setTerminalPayInput={setTerminalPayInput}
      setTerminalBuyInput={setTerminalBuyInput}
      setTerminalHistorySheetKey={setTerminalHistorySheetKey}
      acceptTrade={acceptTrade}
      askAgentAboutOrder={askAgentAboutOrder}
      beginCounterTrade={beginCounterTrade}
      beginEditTrade={beginEditTrade}
      buildTradeShareUrl={buildTradeShareUrl}
      cancelTrade={cancelTrade}
      changePrivateBookBudgetVisibility={changePrivateBookBudgetVisibility}
      renderTradeBalanceDisclosure={renderTradeBalanceDisclosure}
      copyWithFeedback={copyWithFeedback}
      declineTrade={declineTrade}
      getCarbonReferenceDisplay={getCarbonReferenceDisplay}
      getStandardTerminalHistoryConfig={(trade) =>
        buildStandardTerminalHistoryConfig(trade, terminalHistoryConfigParams)}
      partialFillTrade={partialFillTrade}
      renderActionNotice={renderActionNotice}
      renderTradeConversationButton={renderTradeConversationButton}
      resolveKnownTradeAccessSecret={resolveKnownTradeAccessSecret}
      resolveTerminalAssetBalanceLabel={resolveTerminalAssetBalanceLabel}
      toggleMakerControls={toggleMakerControls}
      toggleTradeRateDirection={toggleTradeRateDirection}
      canonicalV2Rows={terminalHistoryConfigParams.canonicalV2Rows}
      showHistoryControl={showHistoryControl}
    />
  );
}

type TradeTerminalHistoryRendererProps = {
  snapshot: TradeSnapshot;
  terminalHistoryConfigParams: TerminalHistoryConfigParams;
  renderActionNotice: (surface: P2PActionNoticeSurface, tradeKey?: string) => ReactNode;
  embedded?: boolean;
};

export function TradeTerminalHistoryRenderer({
  snapshot,
  terminalHistoryConfigParams,
  renderActionNotice,
  embedded = false
}: TradeTerminalHistoryRendererProps) {
  if (embedded) {
    const config = buildTerminalHistoryConfig(snapshot, terminalHistoryConfigParams);
    return config ? (
      <section className="p2p-terminal-activity-panel" aria-live="polite">
        <TradeTerminalHistoryContent config={config} renderActionNotice={renderActionNotice} />
      </section>
    ) : null;
  }
  return (
    <TradeTerminalHistoryWindowForTrade
      snapshot={snapshot}
      params={terminalHistoryConfigParams}
      renderActionNotice={renderActionNotice}
    />
  );
}
