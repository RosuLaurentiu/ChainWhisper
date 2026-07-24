type RecoveryTransactionStatusProps = {
  profileId: number;
  resolving?: boolean;
  transactionUrl?: string;
};

export default function RecoveryTransactionStatus({
  profileId,
  resolving = false,
  transactionUrl
}: RecoveryTransactionStatusProps) {
  const statusContent = (
    <>
      <span>
        <i aria-hidden="true" />
        Recovery available
      </span>
      <small>
        {transactionUrl
          ? 'View on Blockscout'
          : resolving
            ? 'Finding transaction…'
            : `On-chain profile #${profileId}`}
      </small>
    </>
  );

  return transactionUrl ? (
    <a
      className="p2p-wallet-recovery-status actionable"
      href={transactionUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`Recovery available. View the transaction that saved recovery profile ${profileId} on Blockscout`}
      title={`View the transaction that saved recovery profile ${profileId} on Blockscout`}
    >
      {statusContent}
    </a>
  ) : (
    <div className="p2p-wallet-recovery-status" role="status">
      {statusContent}
    </div>
  );
}
