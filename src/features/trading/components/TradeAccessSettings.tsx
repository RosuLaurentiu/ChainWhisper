import { shortenAddress } from '../../../lib/appShared';
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
    <>
      <div className="standalone-trade-options p2p-trade-access-settings">
        <div className="standalone-trade-visibility" role="group" aria-label="Trade visibility">
          <button
            type="button"
            className={tradeVisibility === 'public' ? 'active' : undefined}
            onClick={() => onTradeVisibilityChange('public')}
            aria-pressed={tradeVisibility === 'public'}
          >
            Public
          </button>
          <button
            type="button"
            className={tradeVisibility === 'unlisted' ? 'active' : undefined}
            onClick={() => onTradeVisibilityChange('unlisted')}
            aria-pressed={tradeVisibility === 'unlisted'}
          >
            Unlisted
          </button>
          <button
            type="button"
            className={tradeVisibility === 'direct' ? 'active' : undefined}
            onClick={() => onTradeVisibilityChange('direct')}
            aria-pressed={tradeVisibility === 'direct'}
          >
            Direct
          </button>
        </div>
        <div className="standalone-trade-access-summary">
          <span>Access</span>
          <strong>
            {tradeVisibility === 'public'
              ? 'Public'
              : tradeVisibility === 'direct'
                ? directTradeRecipientIsValid
                  ? `To ${shortenAddress(directTradeRecipientNormalized)}`
                  : 'Recipient required'
                : 'Unlisted'}
          </strong>
          <p>
            {tradeVisibility === 'direct'
              ? 'Direct offers skip the public desk and appear under the recipient wallet received offers.'
              : tradeVisibility === 'public'
                ? 'Public offers appear on the desk while open. On-chain terms remain public to contract reads.'
                : 'Unlisted offers stay off the public desk. On-chain terms remain public to contract reads.'}
          </p>
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
    </>
  );
}
