import type { ReactNode } from 'react';

type TradeDeskIdentity = {
  title: string;
  copy: string;
};

type TradeMarketOverviewPanelProps = {
  isComposerRoute: boolean;
  marketOverviewClassView: string;
  tradeViewTabs: ReactNode;
  createDeskIdentity: TradeDeskIdentity;
  tradeDeskIdentity: TradeDeskIdentity;
  openPublicTradeCount: number;
  receivedOpenTradeOfferCount: number;
  myOpenTradeCount: number;
  walletTradeHistoryCount: number;
  walletError: string;
  tradeActionError: string;
};

export default function TradeMarketOverviewPanel({
  isComposerRoute,
  marketOverviewClassView,
  tradeViewTabs,
  createDeskIdentity,
  tradeDeskIdentity,
  walletError,
  tradeActionError
}: TradeMarketOverviewPanelProps) {
  if (isComposerRoute) {
    return (
      <>
        <div className="p2p-secondary-nav p2p-secondary-nav-mobile">{tradeViewTabs}</div>
        <section className="p2p-create-overview" aria-label="Create trade workspace">
          <div className="p2p-create-overview-head">
            <div className="p2p-create-tabs">{tradeViewTabs}</div>
            <div className="p2p-market-identity">
              <strong>{createDeskIdentity.title}</strong>
              <span>{createDeskIdentity.copy}</span>
            </div>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <div className="p2p-secondary-nav p2p-secondary-nav-mobile">{tradeViewTabs}</div>
      <section
        className={`p2p-market-overview p2p-market-overview-${marketOverviewClassView}`}
      >
        <div className="p2p-market-overview-head">
          <div className="p2p-market-tabs">{tradeViewTabs}</div>

          <div className="p2p-market-identity">
            <strong>{tradeDeskIdentity.title}</strong>
            <span>{tradeDeskIdentity.copy}</span>
          </div>

        </div>

        {walletError || tradeActionError ? <p className="error p2p-market-status">{walletError || tradeActionError}</p> : null}
      </section>
    </>
  );
}
