import { useCallback, useRef, useState } from 'react';
import {
  COTI_NETWORK,
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  OTC_HISTORY_READER_CONTRACT_ADDRESS,
  OTC_READER_CONTRACT_ADDRESS,
  OTC_REGISTRY_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  RECURRING_OTC_CONTRACT_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS
} from '../lib/appShared';
import { useModalA11y } from '../hooks/useModalA11y';

type TradingContractSourceItem = {
  id: string;
  name: string;
  role: string;
  address: string;
};

const TRADING_CONTRACT_SOURCE_ITEMS: TradingContractSourceItem[] = [
  {
    id: 'standard',
    name: 'ChainWhisperOTCEscrowV1',
    role: 'Standard OTC',
    address: TRADE_ESCROW_CONTRACT_ADDRESS
  },
  {
    id: 'private',
    name: 'ChainWhisperPrivateOTCEscrowV1',
    role: 'Private OTC',
    address: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS
  },
  {
    id: 'direct',
    name: 'ChainWhisperDirectOTCEscrowV1',
    role: 'Direct OTC',
    address: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS
  },
  {
    id: 'recurring',
    name: 'ChainWhisperRecurringOTCEscrowV1',
    role: 'Recurring OTC',
    address: RECURRING_OTC_CONTRACT_ADDRESS
  },
  {
    id: 'reader',
    name: 'ChainWhisperOTCReaderV1',
    role: 'Desk reader',
    address: OTC_READER_CONTRACT_ADDRESS
  },
  {
    id: 'history-reader',
    name: 'ChainWhisperOTCHistoryReaderV1',
    role: 'History reader',
    address: OTC_HISTORY_READER_CONTRACT_ADDRESS
  },
  {
    id: 'registry',
    name: 'ChainWhisperOTCRegistryV1',
    role: 'Registry',
    address: OTC_REGISTRY_CONTRACT_ADDRESS
  }
];

type TradingContractsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const buildContractExplorerUrl = (address: string): string => `${COTI_NETWORK.blockExplorerUrl}/address/${address}#code`;

export default function TradingContractsModal({ isOpen, onClose }: TradingContractsModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [copiedContractId, setCopiedContractId] = useState('');

  useModalA11y({ dialogRef, isOpen, onClose });

  const copyAddress = useCallback(async (item: TradingContractSourceItem) => {
    await navigator.clipboard.writeText(item.address);
    setCopiedContractId(item.id);
    window.setTimeout(() => {
      setCopiedContractId((current) => (current === item.id ? '' : current));
    }, 1400);
  }, []);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop p2p-contracts-modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-card p2p-contracts-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="p2p-contracts-modal-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p2p-contracts-modal-head">
          <div>
            <span>COTI Mainnet</span>
            <h3 id="p2p-contracts-modal-title">Trading contracts</h3>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="p2p-contracts-modal-list">
          {TRADING_CONTRACT_SOURCE_ITEMS.map((item) => {
            const explorerUrl = buildContractExplorerUrl(item.address);
            const copied = copiedContractId === item.id;
            return (
              <article className="p2p-contracts-modal-row" key={item.id}>
                <div className="p2p-contracts-modal-row-main">
                  <div className="p2p-contracts-modal-row-title">
                    <strong>{item.role}</strong>
                    <span title={item.name}>{item.name}</span>
                  </div>
                </div>
                <div className="p2p-contracts-modal-row-actions">
                  <button type="button" onClick={() => copyAddress(item).catch(() => {})}>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <a href={explorerUrl} target="_blank" rel="noreferrer">
                    CotiScan
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
