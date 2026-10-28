import { useEffect, useRef, useState } from 'react';
import {
  CHAINWHISPER_NETWORK_OPTIONS,
  getChainWhisperCotiNetwork,
  type ChainWhisperActiveNetworkId
} from '../../lib/chainWhisperNetworks';
import { closeDetailsOnEscape } from '../../shared/components/a11y';

type AppNetworkSwitcherProps = Readonly<{
  activeNetworkId: ChainWhisperActiveNetworkId;
  networkSelectionLocked?: boolean;
  walletChainId?: number | null;
  switching?: boolean;
  onSelectNetwork: (networkId: ChainWhisperActiveNetworkId) => void;
}>;

export default function AppNetworkSwitcher({
  activeNetworkId,
  networkSelectionLocked = false,
  walletChainId = null,
  switching = false,
  onSelectNetwork
}: AppNetworkSwitcherProps) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const [secretRevealed, setSecretRevealed] = useState(false);
  const activeNetwork = getChainWhisperCotiNetwork(activeNetworkId);
  const walletMismatch = walletChainId !== null && walletChainId !== activeNetwork.chainIdDecimal;

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (details?.open && !details.contains(event.target as Node | null)) details.open = false;
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, []);

  return (
    <details
      ref={detailsRef}
      className="app-network-switcher"
      onKeyDown={closeDetailsOnEscape}
    >
      <summary
        aria-label={`Network: ${activeNetwork.shortName}`}
        title={walletMismatch ? `Wallet is not on ${activeNetwork.shortName}` : 'Select network'}
      >
        <span
          className={walletMismatch ? 'app-network-status-dot mismatch' : 'app-network-status-dot'}
          aria-hidden="true"
        />
        <span className="app-network-current-label">
          {switching ? 'Switching…' : activeNetwork.shortName}
        </span>
        <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="m5.7 7.5 4.3 4.3 4.3-4.3 1.4 1.4-5.7 5.7-5.7-5.7 1.4-1.4Z" />
        </svg>
      </summary>

      <div className="app-network-menu" role="group" aria-label="ChainWhisper networks">
        <div className="app-network-menu-heading">
          <strong>Network</strong>
          <span>
            {networkSelectionLocked
              ? `This test candidate is locked to ${activeNetwork.shortName}.`
              : 'Changing COTI environments reloads the app.'}
          </span>
        </div>
        <div className="app-network-options">
          {CHAINWHISPER_NETWORK_OPTIONS.map((option) => {
            const active = option.id === activeNetworkId;
            const available = option.status === 'available';
            return (
              <button
                key={option.id}
                type="button"
                className={`app-network-option accent-${option.accent}${active ? ' active' : ''}`}
                disabled={!available || switching || active || networkSelectionLocked}
                aria-current={active ? 'true' : undefined}
                onClick={() => {
                  if (!available) return;
                  onSelectNetwork(option.id as ChainWhisperActiveNetworkId);
                  if (detailsRef.current) detailsRef.current.open = false;
                }}
              >
                <span className="app-network-option-mark" aria-hidden="true" />
                <span className="app-network-option-copy">
                  <strong>{option.name}</strong>
                  <small>
                    {active ? 'Selected' : available ? 'Available' : `${option.name} — coming soon`}
                  </small>
                </span>
                {active ? <span className="app-network-check" aria-hidden="true">✓</span> : null}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="app-network-easter-egg"
          aria-label="Reveal a tiny ChainWhisper secret"
          title="Psst…"
          onClick={() => setSecretRevealed((revealed) => !revealed)}
        >
          {secretRevealed
            ? 'The liquidity is there. You just cannot see it. 🥚'
            : '···'}
        </button>
      </div>
    </details>
  );
}
