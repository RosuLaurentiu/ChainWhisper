import { Globe2, Link2, Send } from 'lucide-react';
import type { TradeVisibility } from './P2PTradingPage.helpers';

type TradeAccessSettingsProps = {
  disabled: boolean;
  directTradeRecipient: string;
  directTradeRecipientIsValid: boolean;
  directTradeRecipientNormalized: string;
  onDirectTradeRecipientChange: (value: string) => void;
  onTradeVisibilityChange: (value: TradeVisibility) => void;
  tradeVisibility: TradeVisibility;
};

export default function TradeAccessSettings({
  disabled,
  directTradeRecipient,
  directTradeRecipientIsValid,
  directTradeRecipientNormalized,
  onDirectTradeRecipientChange,
  onTradeVisibilityChange,
  tradeVisibility
}: TradeAccessSettingsProps) {
  if (disabled) {
    return null;
  }

  return (
    <section className="p2p-trade-access-workspace" aria-labelledby="p2p-trade-audience-title">
      <div className="p2p-trade-access-heading">
        <strong id="p2p-trade-audience-title">Access</strong>
      </div>
      <div className="standalone-trade-options p2p-trade-access-settings">
        <div className="standalone-trade-visibility" role="group" aria-label="Offer audience">
          <button
            type="button"
            className={tradeVisibility === 'public' ? 'active' : undefined}
            onClick={() => onTradeVisibilityChange('public')}
            aria-pressed={tradeVisibility === 'public'}
          >
            <Globe2 size={16} aria-hidden="true" />
            <span>
              <strong>Public offer</strong>
              <small>Listed in Offers</small>
            </span>
          </button>
          <button
            type="button"
            className={tradeVisibility === 'unlisted' ? 'active' : undefined}
            onClick={() => onTradeVisibilityChange('unlisted')}
            aria-pressed={tradeVisibility === 'unlisted'}
          >
            <Link2 size={16} aria-hidden="true" />
            <span>
              <strong>Private link</strong>
              <small>Shareable link</small>
            </span>
          </button>
          <button
            type="button"
            className={tradeVisibility === 'direct' ? 'active' : undefined}
            onClick={() => onTradeVisibilityChange('direct')}
            aria-pressed={tradeVisibility === 'direct'}
          >
            <Send size={16} aria-hidden="true" />
            <span>
              <strong>Direct proposal</strong>
              <small>One wallet</small>
            </span>
          </button>
        </div>
      </div>
      {tradeVisibility === 'direct' ? (
        <label className="standalone-trade-recipient p2p-direct-recipient">
          <span>Recipient wallet</span>
          <input
            type="text"
            value={directTradeRecipient}
            onChange={(event) => onDirectTradeRecipientChange(event.target.value)}
            placeholder="0x..."
            aria-invalid={directTradeRecipientNormalized && !directTradeRecipientIsValid ? 'true' : 'false'}
          />
        </label>
      ) : null}
    </section>
  );
}
