import AnimatedOwlSecurityOverlay from '../../../assets/chainwhisper-owl-security-background-animated.svg?raw';
import EnhancedOwlSecurityBackground from '../../../assets/chainwhisper-owl-security-background-enhanced-4k.webp';

type ChatReadinessStateProps = {
  onOpenHelp: () => void;
};

export default function ChatReadinessState({ onOpenHelp }: ChatReadinessStateProps) {
  return (
    <section className="chat-readiness-state" role="status" aria-live="polite">
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
        <strong>Wallet needed</strong>
        <p>Use the header wallet control to connect or unlock your ChainWhisper account.</p>
      </div>
      <button type="button" className="app-help-context-link chat-readiness-action" onClick={onOpenHelp}>
        Get help
      </button>
    </section>
  );
}
