import { useRef, useState } from 'react';
import { COTI_ECOSYSTEM_LINKS } from '../../lib/ecosystemLinks';
import { CONFIGURED_COTI_NETWORK } from '../../lib/chainWhisperNetworks';
import type { AppPage } from '../../shell/routing';
import useMobileHeaderLinks from '../hooks/useMobileHeaderLinks';
import {
  preloadChatPage,
  preloadPrivateTvlPage,
  preloadSwapPage,
  preloadTradesPage
} from '../lazyRoutes';
import AppHeader from './AppHeader';
import { AppHeaderNavigation } from './AppHeaderNavigation';
import HomePage from './HomePage';

type InitialHomeAppProps = {
  onNavigate: (page: AppPage) => void;
  onOpenHelp: () => void;
};

export default function InitialHomeApp({ onNavigate, onOpenHelp }: InitialHomeAppProps) {
  const [mobileLinksOpen, setMobileLinksOpen] = useState(false);
  const topHeaderRef = useRef<HTMLElement | null>(null);
  const isMobileNav = useMobileHeaderLinks({
    mobileLinksOpen,
    setMobileLinksOpen,
    topHeaderRef
  });
  const navigate = (page: AppPage) => {
    setMobileLinksOpen(false);
    onNavigate(page);
  };

  return (
    <div className="app-shell app-shell-landing app-shell-home">
      <AppHeader
        headerRef={topHeaderRef}
        mobileLinksOpen={mobileLinksOpen}
        isMobileNav={isMobileNav}
        onToggleMobileLinksOpen={() => setMobileLinksOpen((open) => !open)}
        onOpenHelp={() => {
          setMobileLinksOpen(false);
          onOpenHelp();
        }}
        onCloseMobileLinks={() => setMobileLinksOpen(false)}
        links={COTI_ECOSYSTEM_LINKS}
        appNavigationControl={<AppHeaderNavigation activePage="home" onNavigate={navigate} />}
      />
      <HomePage
        networkName={CONFIGURED_COTI_NETWORK.shortName}
        onLaunchChat={() => navigate('chat')}
        onOpenSwap={() => navigate('swap')}
        onOpenPrivateTvl={() => navigate('treasury')}
        onOpenTrades={() => navigate('trades')}
        onPrefetchChat={preloadChatPage}
        onPrefetchSwap={preloadSwapPage}
        onPrefetchTrades={preloadTradesPage}
        onPrefetchPrivateTvl={preloadPrivateTvlPage}
      />
    </div>
  );
}
