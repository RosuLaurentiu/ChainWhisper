import { useEffect, useRef, useState } from 'react';

export const CHAINWHISPER_AGENT_TOOLS_PACKAGE =
  '@chainwhisper/agent-tools@0.1.0-beta.0';
export const CHAINWHISPER_AGENT_TOOLS_REPOSITORY =
  'https://github.com/RosuLaurentiu/ChainWhisper-MCP';

export const CHAINWHISPER_AGENT_SETUP_PROMPT = `Set up ChainWhisper MCP for this agent.

Source and security documentation:
${CHAINWHISPER_AGENT_TOOLS_REPOSITORY}

1. If this agent already has an independent, compatible COTI MCP, keep it for generic COTI operations and verify it with only a read-only network or status tool. It is not required for ChainWhisper private negotiation. Do not pass the Agent Wallet private key, AES material, mnemonic, passphrase, or any other secret through an MCP tool or prompt.
2. Install the pinned ChainWhisper package:
   npm install --global ${CHAINWHISPER_AGENT_TOOLS_PACKAGE}
3. Register two local stdio MCP connections:
   - chainwhisper: chainwhisper-mcp
   - chainwhisper-coti-signer: chainwhisper-coti-signer
4. Restart both ChainWhisper MCP connections. Run chainwhisper_open_control_panel. Keep the persistent local Agent Control tab open, then import an existing Agent Wallet or create a new one there. Wallet credentials and private setup values must never be pasted into a prompt or MCP argument.
5. The signer creates pairing and encrypted local storage automatically. Optionally select a wallet .env with CHAINWHISPER_SIGNER_ENV_FILE, and optionally set CHAINWHISPER_COTI_RPC_URL or CHAINWHISPER_STATE_DIRECTORY outside chat.
6. Fund the displayed Agent Wallet. Enable private trading once from Agent Control when a ChainWhisper action first needs privacy. After onboarding, the dashboard refreshes every verified private-token balance it can read; token-specific setup is requested only when the wallet or token mapping actually requires it.
7. Keep chainwhisper-mcp keyless. Only chainwhisper-coti-signer may hold wallet credentials, privacy material, policies, and signing authority. A manual approval confirms one complete ChainWhisper action, even when the signer must submit several exact network transactions.
8. Choose Manual approval, Bounded autonomy, or 24-hour Full autonomy. Full autonomy is intended only for a dedicated, minimally funded Agent Wallet. Agent Control keeps balances, pending progress, and wallet-wide ChainWhisper activity in the same persistent tab.
9. Run the read-only chainwhisper_status, chainwhisper_signer_status, and chainwhisper_autonomy_status checks. Do not sign, broadcast, or send a message during setup.
10. Use an independent COTI companion, when present, for generic COTI operations. Use ChainWhisper for ChainWhisper orders, Privacy Portal actions, and order-linked private negotiation. ChainWhisper never calls the companion or shares credentials with it.
11. Private negotiation is already integrated into chainwhisper-coti-signer through the official COTI SDK. No COTI skill or standalone messaging MCP is required. Do not register the SDK's standalone messaging MCP. For protocol details only, see https://docs.coti.io/coti-documentation/private-messaging/quickstart#mcp-server.

COTI private agent messaging is already included through the official COTI SDK. No separate ChainWhisper skill or messaging MCP is required.`;

type CopyTextOptions = {
  writeText?: (text: string) => Promise<void>;
  fallbackCopy?: (text: string) => boolean;
};

const copyTextWithDocument = (text: string): boolean => {
  if (typeof document === 'undefined') {
    return false;
  }
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  document.body.appendChild(input);
  input.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    input.remove();
  }
};

export const copyAgentSetupPrompt = async ({
  writeText = typeof navigator === 'undefined'
    ? undefined
    : navigator.clipboard?.writeText.bind(navigator.clipboard),
  fallbackCopy = copyTextWithDocument
}: CopyTextOptions = {}): Promise<'clipboard' | 'fallback'> => {
  if (writeText) {
    try {
      await writeText(CHAINWHISPER_AGENT_SETUP_PROMPT);
      return 'clipboard';
    } catch {
      // Some browsers expose Clipboard API but deny it outside a trusted event.
    }
  }
  if (fallbackCopy(CHAINWHISPER_AGENT_SETUP_PROMPT)) {
    return 'fallback';
  }
  throw new Error('The setup prompt could not be copied.');
};

const OPTIONAL_MARKET_LINKS = [
  {
    href: 'https://mcp.carbondefi.xyz/',
    name: 'Carbon MCP',
    description: 'Optional unsigned CarbonDeFi liquidity and transaction planning.'
  }
] as const;

export default function AgentSetupPanel() {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const resetCopyStateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetCopyStateTimeoutRef.current) {
        clearTimeout(resetCopyStateTimeoutRef.current);
      }
    },
    []
  );

  const handleCopySetupPrompt = async () => {
    if (resetCopyStateTimeoutRef.current) {
      clearTimeout(resetCopyStateTimeoutRef.current);
    }
    try {
      await copyAgentSetupPrompt();
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
    resetCopyStateTimeoutRef.current = setTimeout(() => setCopyState('idle'), 4_000);
  };

  return (
    <div
      id="assistant-mode-panel"
      className="p2p-agent-setup-panel"
      role="tabpanel"
      aria-labelledby="assistant-mode-setup"
    >
      <div className="p2p-agent-setup-lead">
        <strong>One package. Two local connections. Private negotiation included.</strong>
        <span>A COTI companion stays separate for generic COTI operations.</span>
      </div>

      <section className="p2p-agent-setup-core" aria-labelledby="agent-setup-package-title">
        <div className="p2p-agent-setup-install">
          <div className="p2p-agent-setup-card-heading">
            <div>
              <span>01 · Install</span>
              <h3 id="agent-setup-package-title">Add ChainWhisper to your agent</h3>
            </div>
            <span className="p2p-agent-setup-status">Configuration required</span>
          </div>
          <p>
            Copy one prompt. Your agent installs the pinned package and registers both
            connections.
          </p>
          <code>npm install --global {CHAINWHISPER_AGENT_TOOLS_PACKAGE}</code>
          <small className="p2p-agent-setup-publication-note">
            Pinned beta package. Installation becomes available with the beta release.
          </small>
          <div className="p2p-agent-setup-install-actions">
            <button
              type="button"
              className="trade-card-action trade-card-action-accept"
              onClick={() => {
                handleCopySetupPrompt().catch(() => {});
              }}
              aria-describedby="agent-setup-copy-result"
            >
              {copyState === 'copied' ? 'Setup prompt copied' : 'Copy setup prompt'}
            </button>
            <a
              href={CHAINWHISPER_AGENT_TOOLS_REPOSITORY}
              target="_blank"
              rel="noreferrer"
            >
              Review source &amp; security
            </a>
          </div>
          <span
            id="agent-setup-copy-result"
            role="status"
            aria-live="polite"
            className={copyState === 'error' ? 'error' : undefined}
          >
            {copyState === 'copied'
              ? 'Paste it into your agent configuration chat.'
              : copyState === 'error'
                ? 'Copy failed. Open the prompt below and copy it manually.'
                : 'Free setup. No wallet connection or WISP payment.'}
          </span>
        </div>

        <div className="p2p-agent-setup-connections">
          <div className="p2p-agent-setup-section-heading">
            <span>02 · Connect</span>
            <h3>Connect the tools</h3>
          </div>
          <div className="p2p-agent-setup-connection-list">
            <article className="p2p-agent-setup-prerequisite">
              <span>Keep</span>
              <div>
                <strong>Compatible COTI companion</strong>
                <code>Independent MCP</code>
                <p>
                  General COTI operations only. It is not needed for ChainWhisper private
                  negotiation.
                </p>
              </div>
            </article>
            <p className="p2p-agent-setup-connection-caption">
              ChainWhisper adds these two local connections
            </p>
            <article>
              <span>Plan</span>
              <div>
                <strong>ChainWhisper planning</strong>
                <code>chainwhisper-mcp</code>
                <p>Reads, validates, compares, and prepares unsigned transactions. No keys.</p>
              </div>
            </article>
            <article>
              <span>Sign</span>
              <div>
                <strong>Local COTI signing</strong>
                <code>chainwhisper-coti-signer</code>
                <p>
                  Wallet, privacy, complete-action approval, signing, and private
                  negotiation.
                </p>
              </div>
            </article>
          </div>
          <aside className="p2p-agent-setup-security" aria-label="Agent wallet safety">
            <strong>Your Agent Wallet stays local.</strong>
            <span>
              Confirm each complete action once, or approve bounded or 24-hour full
              autonomy. Never give an MCP tool a private key, AES key, mnemonic, or
              passphrase.
            </span>
          </aside>
        </div>
      </section>

      <section className="p2p-agent-setup-flow" aria-labelledby="agent-control-flow-title">
        <div className="p2p-agent-setup-flow-heading">
          <span>03 · Control</span>
          <h3 id="agent-control-flow-title">One local dashboard from setup to history</h3>
        </div>
        <div className="p2p-agent-setup-flow-list">
          <article>
            <strong>Wallet &amp; privacy</strong>
            <p>
              Import or create an Agent Wallet, fund it, and enable private trading once.
              Readable verified private balances appear in Agent Control.
            </p>
          </article>
          <article>
            <strong>One order approval</strong>
            <p>
              Review the ChainWhisper order card and confirm the complete action once.
              Network transactions then progress without repeated prompts.
            </p>
          </article>
          <article>
            <strong>Your automation level</strong>
            <p>
              Stay manual, approve explicit bounded limits, or allow the audited economic
              surface for up to 24 hours.
            </p>
          </article>
          <article>
            <strong>Persistent progress</strong>
            <p>
              The same tab shows balances, pending work, results, and merged local plus
              wallet-wide ChainWhisper activity.
            </p>
          </article>
        </div>
      </section>

      <div className="p2p-agent-setup-details">
        <details className="p2p-agent-setup-prompt">
          <summary>
            <span>
              <strong>View setup prompt</strong>
              <small>Review exactly what will be copied to your agent.</small>
            </span>
            <span className="p2p-agent-setup-detail-status">Copyable</span>
          </summary>
          <pre>{CHAINWHISPER_AGENT_SETUP_PROMPT}</pre>
        </details>
        <section
          className="p2p-agent-setup-ecosystem"
          aria-labelledby="agent-setup-optional-title"
        >
          <div className="p2p-agent-setup-ecosystem-heading">
            <div>
              <span>Optional market tools</span>
              <h3 id="agent-setup-optional-title">Add unsigned market context</h3>
              <p>Optional context only. Private negotiation needs no extra messaging tool.</p>
            </div>
            <span className="p2p-agent-setup-detail-status">Not required</span>
          </div>
          <div className="p2p-agent-setup-reference-list">
            {OPTIONAL_MARKET_LINKS.map((item) => (
              <a key={item.name} href={item.href} target="_blank" rel="noreferrer">
                <strong>{item.name}</strong>
                <span>{item.description}</span>
              </a>
            ))}
          </div>
        </section>
      </div>

      <p className="p2p-agent-setup-fees">
        <span>
          MCP actions use normal COTI gas and ChainWhisper contract fees—not the in-app
          Trade Agent WISP fee.
        </span>{' '}
        <a
          href="https://docs.coti.io/coti-documentation/private-messaging/quickstart#mcp-server"
          target="_blank"
          rel="noreferrer"
        >
          COTI messaging details
        </a>
      </p>
    </div>
  );
}
