import AnimatedOwlSecurityOverlay from '../../../assets/chainwhisper-owl-security-background-animated.svg?raw';
import EnhancedOwlSecurityBackground from '../../../assets/chainwhisper-owl-security-background-enhanced-4k.webp';

type ChatReadinessStateProps = {
  error?: string;
  onOpenHelp: () => void;
};

export default function ChatReadinessState({ error = '', onOpenHelp }: ChatReadinessStateProps) {
  return (
    <section className="chat-readiness-state" aria-labelledby="chat-readiness-title">
      <div className="chat-readiness-visual" aria-hidden="true">
        <img
          className="chat-readiness-art chat-readiness-art-base"
          src={EnhancedOwlSecurityBackground}
          alt=""
        />
        <div
          className="chat-readiness-art chat-readiness-art-motion"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: AnimatedOwlSecurityOverlay }}
        />
      </div>
      <div className="chat-readiness-copy">
        <h2 id="chat-readiness-title">Wallet needed</h2>
        <p>Connect a wallet in the header, then unlock privacy.</p>
      </div>
      {error ? <p className="chat-readiness-error" role="alert">{error}</p> : null}
      <button type="button" className="app-help-context-link chat-readiness-action" onClick={onOpenHelp}>
        Get help
      </button>
    </section>
  );
}
