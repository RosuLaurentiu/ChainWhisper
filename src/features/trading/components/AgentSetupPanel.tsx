import { useEffect, useRef, useState } from 'react';

export const CHAINWHISPER_AGENT_TOOLS_PACKAGE =
  '@chainwhisper/agent-tools@0.1.0-beta.0';
export const CHAINWHISPER_AGENT_TOOLS_REPOSITORY =
  'https://github.com/RosuLaurentiu/ChainWhisper-MCP';

export const CHAINWHISPER_AGENT_SETUP_PROMPT = `Set up ChainWhisper MCP for this agent.

Source and security documentation:
${CHAINWHISPER_AGENT_TOOLS_REPOSITORY}

1. Verify that this agent has an independent, compatible COTI MCP by calling only its read-only network or status tool. Do not pass the Agent Wallet private key, AES material, mnemonic, passphrase, or any other secret through an MCP tool or prompt. If the installed COTI MCP requires secrets for account setup, keep it read-only or use a different wallet.
2. Install the pinned ChainWhisper package:
   npm install --global ${CHAINWHISPER_AGENT_TOOLS_PACKAGE}
3. Register two local stdio MCP connections:
   - chainwhisper: chainwhisper-mcp
   - chainwhisper-coti-signer: chainwhisper-coti-signer
4. Restart both ChainWhisper MCP connections. Run chainwhisper_open_control_panel, then use the local ChainWhisper Agent Control page to import an existing Agent Wallet or create a new one. Wallet credentials and private setup values must never be pasted into a prompt or MCP argument.
5. The signer creates pairing and encrypted local storage automatically. Optionally select a wallet .env with CHAINWHISPER_SIGNER_ENV_FILE, and optionally set CHAINWHISPER_COTI_RPC_URL or CHAINWHISPER_STATE_DIRECTORY outside chat.
6. Fund the displayed Agent Wallet. When a ChainWhisper action first needs privacy, enable private trading and prepare only the required private token from Agent Control. Choose Manual, Bounded autonomy, or 24-hour Full autonomy. Full autonomy is intended only for a dedicated, minimally funded Agent Wallet.
7. Keep chainwhisper-mcp keyless. Only chainwhisper-coti-signer may hold wallet credentials, privacy material, policies, and signing authority. ChainWhisper never calls the COTI companion or shares credentials with it.
8. Run the read-only chainwhisper_status, chainwhisper_signer_status, and chainwhisper_autonomy_status checks. Do not sign, broadcast, or send a message during setup.
9. Use the COTI companion for generic COTI operations and ChainWhisper for ChainWhisper orders, Privacy Portal actions, and order-linked private negotiation.
10. Private negotiation is already integrated into chainwhisper-coti-signer through the official COTI SDK. Do not register the SDK's standalone messaging MCP. For protocol details only, see https://docs.coti.io/coti-documentation/private-messaging/quickstart#mcp-server.

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
      <p className="p2p-agent-setup-lead">
        Keep your COTI companion. Add one ChainWhisper package with two local connections.
      </p>

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
          <a
            href={CHAINWHISPER_AGENT_TOOLS_REPOSITORY}
            target="_blank"
            rel="noreferrer"
          >
            Review source and security documentation
          </a>
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
            <h3>What your agent uses</h3>
          </div>
          <div className="p2p-agent-setup-connection-list">
          <article>
              <span>Check</span>
              <div>
                <strong>Compatible COTI companion</strong>
                <code>Independent MCP</code>
                <p>Required for generic COTI operations. Verify it with a read-only network or status call.</p>
              </div>
          </article>
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
                <p>Confirms and signs locally. Encrypted private messaging is included.</p>
              </div>
          </article>
          </div>
          <p className="p2p-agent-setup-security">
            Your Agent Wallet stays local. Choose manual approval, bounded autonomy, or
            24-hour full autonomy in Agent Control. Never give an MCP tool a private key,
            AES key, mnemonic, or passphrase.
          </p>
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
              <p>These are separate from the required COTI companion.</p>
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
        MCP actions use normal COTI gas and ChainWhisper contract fees—not the in-app
        Trade Agent WISP fee.{' '}
        <a
          href="https://docs.coti.io/coti-documentation/private-messaging/quickstart#mcp-server"
          target="_blank"
          rel="noreferrer"
        >
          COTI messaging details
        </a>
        .
      </p>
    </div>
  );
}
