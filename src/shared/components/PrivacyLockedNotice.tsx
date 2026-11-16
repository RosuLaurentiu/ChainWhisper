import { Lock } from 'lucide-react';
import './PrivacyLockedNotice.css';

// One locked state for every private list. It has no hooks, so a list can render it
// in any branch. The wallet shows the request; a rejected request leaves this notice in place.
export default function PrivacyLockedNotice({ message, onUnlock, disabled = false }: {
  message: string;
  onUnlock?: () => unknown;
  disabled?: boolean;
}) {
  return (
    <div className="privacy-locked-notice" role="status">
      <Lock size={16} aria-hidden="true" />
      <p>{message}{onUnlock ? null : ' Unlock privacy in the header.'}</p>
      {onUnlock ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => { try { void Promise.resolve(onUnlock()).catch(() => undefined); } catch { /* shown by the wallet */ } }}
        >
          Unlock privacy
        </button>
      ) : null}
    </div>
  );
}
