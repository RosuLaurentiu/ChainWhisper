import { ArrowRightLeft, ArrowUpRight, Landmark, MessageCircle, ShieldCheck } from 'lucide-react';
import AppFavicon from '../../assets/favicon.png';

type HomePageProps = {
  onLaunchChat: () => void;
  onOpenSwap: () => void;
  onOpenTreasury: () => void;
  onPrefetchChat?: () => void;
  onPrefetchSwap?: () => void;
  onPrefetchTrades?: () => void;
  onPrefetchTreasury?: () => void;
  onOpenTrades: () => void;
  isConnected: boolean;
};

export default function HomePage({
  onLaunchChat,
  onOpenSwap,
  onOpenTreasury,
  onOpenTrades,
  onPrefetchChat,
  onPrefetchSwap,
  onPrefetchTrades,
  onPrefetchTreasury,
  isConnected
}: HomePageProps) {
  return (
    <main className="landing-shell">
      <section className="landing-hero">
        <div className="landing-hero-main">
          <p className="landing-eyebrow">COTI Mainnet privacy hub</p>
          <h1 className="landing-title">ChainWhisper</h1>
          <p className="landing-description">
            Private messaging, the OTC Desk, the Privacy Portal, and treasury data in one COTI-native workspace.
          </p>

          <div className="landing-hero-actions">
            <button
              type="button"
              className="landing-action-btn landing-action-btn-primary landing-action-btn-main"
              onClick={onLaunchChat}
              onFocus={onPrefetchChat}
              onPointerEnter={onPrefetchChat}
            >
              Open Chat
            </button>
            <button
              type="button"
              className="landing-action-btn landing-action-btn-secondary"
              onClick={onOpenTrades}
              onFocus={onPrefetchTrades}
              onPointerEnter={onPrefetchTrades}
            >
              Open OTC Desk
            </button>
          </div>

          <p className="landing-hero-note">
            {isConnected
              ? 'Wallet session is already available for app navigation.'
              : 'Home stays wallet-light. Open chat when you are ready to create or reconnect an app wallet.'}
          </p>
        </div>

        <aside className="landing-hero-aside landing-brand-panel" aria-hidden="true">
          <div className="landing-brand-orbit">
            <span className="landing-brand-orbit-ring landing-brand-orbit-ring-outer" />
            <span className="landing-brand-orbit-ring landing-brand-orbit-ring-inner" />
            <span className="landing-brand-orbit-dot landing-brand-orbit-dot-one" />
            <span className="landing-brand-orbit-dot landing-brand-orbit-dot-two" />
            <div className="landing-brand-mark">
              <img src={AppFavicon} alt="" />
            </div>
          </div>
        </aside>
      </section>

      <section className="landing-section landing-section-secondary">
        <div className="landing-section-heading">
          <div>
            <p className="landing-eyebrow">Available apps</p>
            <h2 className="landing-section-title">Built around private coordination</h2>
          </div>
          <p className="landing-section-copy">Each page behaves like its own app while sharing the same COTI context.</p>
        </div>

        <div className="landing-module-grid">
          <article className="landing-module-card landing-module-card-primary">
            <div className="landing-module-card-header">
              <span className="landing-module-icon" aria-hidden="true">
                <MessageCircle />
              </span>
              <span className="landing-module-kicker">Messaging</span>
            </div>
            <h3>Encrypted Chat</h3>
            <p>Direct messages, group chat, reactions, replies, tips, invites, and private coordination.</p>
            <button
              type="button"
              className="landing-module-cta"
              onClick={onLaunchChat}
              onFocus={onPrefetchChat}
              onPointerEnter={onPrefetchChat}
            >
              Open Chat
              <ArrowUpRight aria-hidden="true" />
            </button>
          </article>

          <article className="landing-module-card">
            <div className="landing-module-card-header">
              <span className="landing-module-icon" aria-hidden="true">
                <ArrowRightLeft />
              </span>
              <span className="landing-module-kicker">Trading</span>
            </div>
            <h3>OTC Desk</h3>
            <p>Browse peer offers, create escrow orders, share direct links, and manage private orders.</p>
            <button
              type="button"
              className="landing-module-cta"
              onClick={onOpenTrades}
              onFocus={onPrefetchTrades}
              onPointerEnter={onPrefetchTrades}
            >
              Open OTC Desk
              <ArrowUpRight aria-hidden="true" />
            </button>
          </article>

          <article className="landing-module-card">
            <div className="landing-module-card-header">
              <span className="landing-module-icon" aria-hidden="true">
                <ShieldCheck />
              </span>
              <span className="landing-module-kicker">Private tokens</span>
            </div>
            <h3>Privacy Portal</h3>
            <p>Convert supported COTI tokens between public and private form through official bridges.</p>
            <button
              type="button"
              className="landing-module-cta"
              onClick={onOpenSwap}
              onFocus={onPrefetchSwap}
              onPointerEnter={onPrefetchSwap}
            >
              Open Privacy Portal
              <ArrowUpRight aria-hidden="true" />
            </button>
          </article>

          <article className="landing-module-card">
            <div className="landing-module-card-header">
              <span className="landing-module-icon" aria-hidden="true">
                <Landmark />
              </span>
              <span className="landing-module-kicker">Analytics</span>
            </div>
            <h3>Treasury Data</h3>
            <p>Read live treasury metrics, historical snapshots, COTI pool data, and gCOTI context.</p>
            <button
              type="button"
              className="landing-module-cta"
              onClick={onOpenTreasury}
              onFocus={onPrefetchTreasury}
              onPointerEnter={onPrefetchTreasury}
            >
              Open Treasury
              <ArrowUpRight aria-hidden="true" />
            </button>
          </article>
        </div>
      </section>
    </main>
  );
}
