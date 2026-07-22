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

const CORE_APPS = [
  { label: 'Chat', description: 'Private direct and group messaging' },
  { label: 'OTC Desk', description: 'Peer offers, escrow settlement, and private orders' },
  { label: 'Privacy Portal', description: 'Official COTI public and private token bridges' },
  { label: 'Treasury', description: 'Read-only COTI and gCOTI analytics' }
] as const;

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

        <aside className="landing-hero-aside landing-core-panel">
          <span className="landing-highlight-label">Core apps</span>
          <div className="landing-core-list">
            {CORE_APPS.map((app) => (
              <div key={app.label} className="landing-core-row">
                <strong>{app.label}</strong>
                <span>{app.description}</span>
              </div>
            ))}
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
            <span className="landing-module-kicker">Messaging</span>
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
            </button>
          </article>

          <article className="landing-module-card">
            <span className="landing-module-kicker">Trading</span>
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
            </button>
          </article>

          <article className="landing-module-card">
            <span className="landing-module-kicker">Private tokens</span>
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
            </button>
          </article>

          <article className="landing-module-card">
            <span className="landing-module-kicker">Analytics</span>
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
            </button>
          </article>
        </div>
      </section>
    </main>
  );
}
