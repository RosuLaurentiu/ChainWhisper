import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, X } from 'lucide-react';
import { useModalA11y } from '../../shared/hooks/useModalA11y';

type LegalDocumentKey = 'privacy' | 'terms';

type LegalSection = {
  title: string;
  paragraphs?: readonly string[];
  items?: readonly string[];
};

type LegalDocument = {
  title: string;
  summary: string;
  sections: readonly LegalSection[];
};

const PROJECT_URL = 'https://github.com/RosuLaurentiu/ChainWhisper';
const DOCUMENTATION_URL = `${PROJECT_URL}#readme`;
const CONTACT_URL = `${PROJECT_URL}/issues`;
const COPYRIGHT_YEAR = new Date().getFullYear();

const LEGAL_DOCUMENTS: Record<LegalDocumentKey, LegalDocument> = {
  privacy: {
    title: 'Privacy notice',
    summary:
      'This notice describes how the current ChainWhisper browser app handles information when you use its messaging, trading, privacy, treasury, and agent features.',
    sections: [
      {
        title: 'The information the app handles',
        items: [
          'The current app does not use a traditional hosted user account or Supabase Auth. A connected public wallet address acts as the interactive identity.',
          'Wallet addresses, network identifiers, transaction hashes, contract events, order data, sender and recipient details, timestamps, fees, tips, public nicknames, group membership and administration events, and other blockchain metadata needed to read from or write to COTI Mainnet.',
          'Encrypted direct and group messages, encrypted image attachments, group state, and the metadata needed to deliver and display those features.',
          'Browser-stored settings and working data, including interface preferences, cached decrypted timelines, read state, wallet preferences, trade access details, paid-agent retry data, and encrypted ChainWhisper account vaults.',
          'Questions, prompts, and the limited app context you choose to send through App Help or the Trade Agent.'
        ]
      },
      {
        title: 'Where information goes',
        items: [
          'Blockchain actions and records are submitted to COTI Mainnet through wallet, RPC, contract, and explorer services. On-chain records may be permanent and cannot be deleted by ChainWhisper.',
          'Encrypted image blobs are uploaded to Supabase Storage. The bucket can serve those encrypted blobs publicly, while decryption material is carried inside the encrypted message. Upload records also include the owner wallet, conversation kind, file type and size, timestamps, and a confirmed transaction hash when available.',
          'App Help and Trade Agent requests pass through Supabase Edge Functions and may be processed by OpenAI. API storage is disabled for those requests. Raw prompts and contexts are not stored in the payment table, although rate-limit and payment-status records may be retained.',
          'Market, token, treasury, wallet, and explorer features can request data from COTI infrastructure and the third-party services identified in the relevant app surface. Hosting, remote font, wallet-integration, RPC, and API providers may receive ordinary request data such as your network address and browser information.'
        ]
      },
      {
        title: 'Local storage, cookies, and retention',
        items: [
          'Most preferences, decrypted caches, access details, and encrypted wallet material remain in your browser until you clear site data or the app removes them.',
          'Pending encrypted image uploads are scheduled for cleanup after approximately 30 minutes and confirmed uploads after approximately 24 hours. Cleanup runs periodically, so deletion may not occur at the exact cutoff.',
          'A paid-agent retry record can keep its prompt, context, payer, signature, and payment transaction in browser storage for up to seven days. A validated paid response can be cached by the service for seven days.',
          'The current application code does not install advertising or cross-site analytics trackers. It uses browser storage for functional app state.',
          'AI-assisted App Help uses a keyed hash of the requesting network address for daily abuse-prevention counters. The raw address is not written to that counter table. The current repository does not define a deletion schedule for those counters or paid-request metadata.',
          'Retention by wallet providers, RPC services, Supabase, OpenAI, hosting providers, or linked sites is governed by those services and may differ from ChainWhisper.'
        ]
      },
      {
        title: 'Your choices and security',
        items: [
          'You can browse Home and Treasury Data without connecting a wallet, decline optional AI features, disconnect your wallet, and clear ChainWhisper site data in your browser.',
          'Never share a private key, recovery phrase, wallet password, AES key, trade secret, or other credential with ChainWhisper, an MCP tool, App Help, the Trade Agent, or a public support issue.',
          'Encryption reduces exposure of message content, but no wallet, browser, smart contract, network, or storage system can be guaranteed completely secure.'
        ]
      },
      {
        title: 'Updates and contact',
        paragraphs: [
          'This notice may change as the app and its providers change. Material updates should be reflected here with a new update date. For questions or requests, use the project contact link below without posting sensitive information.'
        ]
      }
    ]
  },
  terms: {
    title: 'Terms of use',
    summary:
      'These terms apply to the current ChainWhisper web app. By using the app, you agree to use it lawfully and to take responsibility for the wallet and blockchain actions you approve.',
    sections: [
      {
        title: 'Service and eligibility',
        items: [
          'ChainWhisper is a browser interface for COTI messaging, self-custodial wallet activity, OTC smart contracts, token privacy tools, treasury data, and optional agent assistance.',
          'You are responsible for determining whether your use is lawful and for complying with applicable obligations and third-party terms.',
          'Some features, integrations, contracts, and data sources may be experimental, incomplete, paused, changed, or withdrawn.'
        ]
      },
      {
        title: 'Your wallet and transactions',
        items: [
          'You control your wallets, credentials, approvals, and assets. ChainWhisper does not take custody of them and cannot recover a lost key, phrase, password, access secret, or incorrectly sent asset.',
          'Review the selected account, network, token, recipient, amount, price, privacy mode, contract, approvals, gas, and protocol fees before signing. A prepared or agent-assisted action is not executed until you approve it in the relevant wallet or local agent control.',
          'Blockchain transactions and contract actions may be irreversible. Confirmation time, finality, fees, liquidity, privacy availability, and execution depend on networks, contracts, markets, and providers outside the interface.'
        ]
      },
      {
        title: 'No advice, brokerage, or guarantee',
        items: [
          'ChainWhisper provides software and information, not financial, investment, legal, tax, or security advice. It is not a broker, exchange, fiduciary, or custodian.',
          'Quotes, prices, balances, simulations, treasury figures, and agent responses may be delayed, incomplete, or wrong. Independently verify information before acting.',
          'Private or encrypted features do not guarantee anonymity. Public addresses, timing, transaction metadata, group membership and administration events, contract activity, counterparties, or compromised devices may reveal information.'
        ]
      },
      {
        title: 'Third-party and smart-contract risk',
        items: [
          'Wallets, RPC endpoints, COTI services, Supabase, OpenAI, explorers, token contracts, bridges, price sources, and linked sites are third-party services. Their availability, security, and terms are outside ChainWhisper control.',
          'Smart contracts and privacy systems may contain bugs, fail, be upgraded, be paused, or behave unexpectedly. Tokens can lose value or liquidity, and transactions may be front-run, rejected, or permanently stuck.'
        ]
      },
      {
        title: 'Acceptable use',
        items: [
          'Do not use ChainWhisper to break the law, infringe rights, deceive or harm others, distribute malicious content, evade applicable restrictions, probe other users, or disrupt the app, its contracts, or its providers.',
          'Do not submit secrets or unnecessary personal information to chat support, AI features, public repositories, or public issue trackers.'
        ]
      },
      {
        title: 'Availability and responsibility',
        paragraphs: [
          'The app is provided on an “as available” basis without a promise that it will be uninterrupted, error-free, secure, or suitable for a particular purpose. To the fullest extent permitted by law, ChainWhisper contributors are not responsible for indirect or consequential loss, lost opportunity, lost data, or lost digital assets arising from use of the app or third-party services. Nothing here excludes responsibility that cannot legally be excluded.'
        ]
      },
      {
        title: 'Updates and contact',
        paragraphs: [
          'These terms may change as the app changes. Continued use after an update means the revised terms apply from their displayed update date. Use the project contact link below for questions, and never include wallet secrets or sensitive personal information in a public issue.'
        ]
      }
    ]
  }
};

type HomeLegalDialogProps = {
  activeDocument: LegalDocumentKey | null;
  onClose: () => void;
};

function HomeLegalDialog({ activeDocument, onClose }: HomeLegalDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const isOpen = activeDocument !== null;

  useModalA11y({ dialogRef, isOpen, onClose });

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!activeDocument || typeof document === 'undefined') {
    return null;
  }

  const legalDocument = LEGAL_DOCUMENTS[activeDocument];
  const titleId = `home-${activeDocument}-title`;
  const summaryId = `home-${activeDocument}-summary`;

  return createPortal(
    <div className="modal-backdrop home-legal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-card home-legal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="home-legal-dialog-head">
          <div>
            <p className="home-legal-dialog-kicker">ChainWhisper web app</p>
            <h2 id={titleId}>{legalDocument.title}</h2>
            <p className="home-legal-dialog-date">Last updated August 1, 2026</p>
          </div>
          <button
            type="button"
            className="home-legal-dialog-close"
            aria-label={`Close ${legalDocument.title}`}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="home-legal-dialog-body">
          <p className="home-legal-dialog-summary" id={summaryId}>
            {legalDocument.summary}
          </p>

          {legalDocument.sections.map((section) => (
            <section className="home-legal-section" key={section.title}>
              <h3>{section.title}</h3>
              {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.items ? (
                <ul>
                  {section.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
            </section>
          ))}

          <div className="home-legal-contact">
            <span>Questions or project support?</span>
            <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer">
              Contact through GitHub Issues
              <ExternalLink aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className="home-legal-dialog-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function HomeFooter() {
  const [activeDocument, setActiveDocument] = useState<LegalDocumentKey | null>(null);

  return (
    <>
      <footer className="landing-footer">
        <p>© {COPYRIGHT_YEAR} ChainWhisper</p>
        <nav className="landing-footer-nav" aria-label="ChainWhisper legal and project links">
          <button type="button" aria-haspopup="dialog" onClick={() => setActiveDocument('privacy')}>
            Privacy
          </button>
          <span aria-hidden="true">·</span>
          <button type="button" aria-haspopup="dialog" onClick={() => setActiveDocument('terms')}>
            Terms
          </button>
          <span aria-hidden="true">·</span>
          <a href={PROJECT_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <span aria-hidden="true">·</span>
          <a href={DOCUMENTATION_URL} target="_blank" rel="noopener noreferrer">
            Documentation
          </a>
          <span aria-hidden="true">·</span>
          <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer">
            Contact
          </a>
        </nav>
      </footer>

      <HomeLegalDialog activeDocument={activeDocument} onClose={() => setActiveDocument(null)} />
    </>
  );
}
