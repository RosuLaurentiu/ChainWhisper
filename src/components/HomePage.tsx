type HomePageProps = {
  onLaunchChat: () => void;
  onOpenSwap: () => void;
  onOpenTreasury: () => void;
  onOpenTrades: () => void;
  isConnected: boolean;
};

const QUICK_START_STEPS = [
  {
    step: '1',
    title: 'Generate a wallet',
    description:
      'Create a wallet inside chat first. It is the fastest and most seamless way to get started.'
  },
  {
    step: '2',
    title: 'Fund your wallet',
    description:
      'Add enough COTI to cover messaging and any optional actions you want to use.'
  },
  {
    step: '3',
    title: 'Start chatting',
    description:
      'Open a direct message or join a group and begin private conversations.'
  }
] as const;

const FUTURE_SLOTS = ['Reserved Slot 01', 'Reserved Slot 02', 'Reserved Slot 03'] as const;

export default function HomePage({ onLaunchChat, onOpenSwap, onOpenTreasury, onOpenTrades, isConnected }: HomePageProps) {
  return (
    <main className="landing-shell">
      <section className="landing-hero">
        <div className="landing-hero-main">
          <p className="landing-eyebrow">Home</p>
          <h1 className="landing-title">Private messaging for the COTI ecosystem.</h1>
          <p className="landing-description">
            ChainWhisper is a private chat app for the COTI ecosystem, built for direct messages, group conversations,
            and wallet setup within the same flow.
          </p>

          <p className="landing-hero-note">
            The recommended flow is to generate a wallet inside chat, fund it, and start messaging from there.
          </p>

          <div className="landing-hero-actions">
            <button
              type="button"
              className="landing-action-btn landing-action-btn-primary landing-action-btn-main"
              onClick={onLaunchChat}
            >
              Launch Chat App
            </button>
          </div>
        </div>

        <aside className="landing-hero-aside">
          <article className="landing-highlight-card landing-highlight-card-primary">
            <span className="landing-highlight-label">Chat App</span>
            <strong>{isConnected ? 'Connected and ready' : 'Private chat, wallet-first'}</strong>
            <p>Direct messages and group conversations, with wallet creation and onboarding handled inside the app.</p>
          </article>

          <article className="landing-highlight-card landing-guide-card">
            <span className="landing-highlight-label">Quick Start</span>
            <div className="landing-guide-list">
              {QUICK_START_STEPS.map((item) => (
                <div key={item.step} className="landing-guide-item">
                  <span className="landing-guide-step">{item.step}</span>
                  <div className="landing-guide-copy">
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </aside>
      </section>

      <section className="landing-section landing-section-secondary">
        <div className="landing-section-heading">
          <div>
            <p className="landing-eyebrow">Available Now</p>
            <h2 className="landing-section-title">Treasury Data</h2>
          </div>
          <p className="landing-section-copy">Live treasury monitoring and historical treasury data.</p>
        </div>

        <div className="landing-module-grid">
          <article className="landing-module-card landing-module-card-primary">
            <span className="landing-module-kicker">Trading</span>
            <h3>P2P Trades</h3>
            <p>Create escrow trades, browse recent onchain offers, and open direct trade links.</p>
            <button type="button" className="landing-module-cta" onClick={onOpenTrades}>
              Open P2P Trades
            </button>
          </article>

          <article className="landing-module-card">
            <span className="landing-module-kicker">Private tokens</span>
            <h3>Whisper Shield</h3>
            <p>Swap reward tokens into private token form.</p>
            <button type="button" className="landing-module-cta" onClick={onOpenSwap}>
              Open Whisper Shield
            </button>
          </article>

          <article className="landing-module-card">
            <span className="landing-module-kicker">Analytics</span>
            <h3>Treasury Data</h3>
            <p>Open the treasury view for live metrics, historical treasury data, and direct onchain references.</p>
            <button type="button" className="landing-module-cta" onClick={onOpenTreasury}>
              Open Treasury Data
            </button>
          </article>
        </div>
      </section>

      <section className="landing-section landing-section-future">
        <div className="landing-section-heading">
          <div>
            <p className="landing-eyebrow">Future Additions</p>
            <h2 className="landing-section-title">Reserved space</h2>
          </div>
          <p className="landing-section-copy">Held for future pages and tools.</p>
        </div>

        <div className="landing-future-grid">
          {FUTURE_SLOTS.map((slot) => (
            <article key={slot} className="landing-future-card">
              <span className="landing-future-badge">Reserved</span>
              <h3>{slot}</h3>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
