import { useEffect, useRef, useState } from 'react';

export const CHAINWHISPER_AGENT_TOOLS_PACKAGE =
  '@chainwhisper/agent-tools@0.1.0-beta.0';

export const CHAINWHISPER_AGENT_SETUP_PROMPT = `Set up ChainWhisper MCP for this agent.

1. Install the pinned package:
   npm install --global ${CHAINWHISPER_AGENT_TOOLS_PACKAGE}
2. Register two local stdio MCP connections:
   - chainwhisper: chainwhisper-mcp
   - chainwhisper-coti-signer: chainwhisper-coti-signer
3. Let the package create its local pairing secret. Configure these signer environment variables outside this chat:
   - CHAINWHISPER_SIGNER_PRIVATE_KEY
   - CHAINWHISPER_SIGNER_AES_KEY
   - CHAINWHISPER_SIGNER_VAULT_PASSPHRASE (at least 16 characters)
   Optionally set CHAINWHISPER_COTI_RPC_URL and CHAINWHISPER_STATE_DIRECTORY.
   Never paste private keys, AES keys, mnemonics, passphrases, or access secrets into a prompt.
4. Keep the planning MCP keyless. The signer adapter is the only process allowed to hold wallet and AES credentials.
5. Run the read-only chainwhisper_status and chainwhisper_signer_status checks. Do not sign, broadcast, or send a message during setup.
6. Private negotiation is already integrated into chainwhisper-coti-signer through the official COTI SDK. Do not register the SDK's standalone messaging MCP. For protocol details only, see https://docs.coti.io/coti-documentation/private-messaging/quickstart#mcp-server. Do not run its init or send smoke commands unless the user separately authorizes wallet setup and on-chain writes.

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

const OPTIONAL_ECOSYSTEM_LINKS = [
  {
    href: 'https://github.com/davibauer/coti-mcp',
    name: 'General COTI MCP',
    description: 'Optional broader COTI tools. Keep it read-only or use a different signing wallet.'
  },
  {
    href: 'https://github.com/coti-io/coti-sdk-private-messaging/tree/main/skills',
    name: 'COTI skills',
    description: 'Optional workflow guidance from the official private-messaging SDK.'
  },
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
        One package. Two MCP connections. No separate skill required.
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
            <h3>What your agent gets</h3>
          </div>
          <div className="p2p-agent-setup-connection-list">
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
            Wallet and AES secrets stay local. Every write requires confirmation.
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
              <span>Optional ecosystem tools</span>
              <h3 id="agent-setup-optional-title">Add broader COTI and market tools</h3>
              <p>ChainWhisper works without these connections.</p>
            </div>
            <span className="p2p-agent-setup-detail-status">Not required</span>
          </div>
          <div className="p2p-agent-setup-reference-list">
            {OPTIONAL_ECOSYSTEM_LINKS.map((item) => (
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
