import { ArrowRightLeft, ArrowUpRight, Landmark, MessageCircle, ShieldCheck } from 'lucide-react';
import AppFavicon from '../../assets/favicon.png';
import HomeFooter from './HomeFooter';

type HomePageProps = {
  networkName: string;
  onLaunchChat: () => void;
  onOpenSwap: () => void;
  onOpenPrivateTvl: () => void;
  onPrefetchChat?: () => void;
  onPrefetchSwap?: () => void;
  onPrefetchTrades?: () => void;
  onPrefetchPrivateTvl?: () => void;
  onOpenTrades: () => void;
};

export default function HomePage({
  networkName,
  onLaunchChat,
  onOpenSwap,
  onOpenPrivateTvl,
  onOpenTrades,
  onPrefetchChat,
  onPrefetchSwap,
  onPrefetchTrades,
  onPrefetchPrivateTvl
}: HomePageProps) {
  return (
    <div className="landing-shell">
      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-hero-main">
            <p className="landing-eyebrow">{networkName} privacy hub</p>
            <h1 className="landing-title">ChainWhisper</h1>
            <p className="landing-description">
              Private chat, trading and token tools on COTI.
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
                Open Trading
              </button>
            </div>
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
              <h2 className="landing-section-title">Your apps</h2>
            </div>
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
              <p>Direct and group chats with replies, reactions, tips and invitations.</p>
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
              <h3>DEX & P2P</h3>
              <p>Trade through private DEX strategies or peer-to-peer offers.</p>
              <button
                type="button"
                className="landing-module-cta"
                onClick={onOpenTrades}
                onFocus={onPrefetchTrades}
                onPointerEnter={onPrefetchTrades}
              >
                Open Trading
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
              <p>Convert public and private tokens through official COTI bridges.</p>
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
              <h3>COTI Private TVL</h3>
              <p>Bridge reserves, coverage and verified Band USD values.</p>
              <button
                type="button"
                className="landing-module-cta"
                onClick={onOpenPrivateTvl}
                onFocus={onPrefetchPrivateTvl}
                onPointerEnter={onPrefetchPrivateTvl}
              >
                Open Private TVL
                <ArrowUpRight aria-hidden="true" />
              </button>
            </article>
          </div>
        </section>
      </main>

      <HomeFooter />
    </div>
  );
}
