import type { ReactNode } from 'react';

type CurrentSwapProgressProps = {
  visible: boolean;
  status: string | null;
  result?: string | null;
  fundingRecovery?: boolean;
  operation?: {
    id: string;
    expiresAt?: string;
    publicState?: string;
    privateAccountingUnverified?: boolean;
  } | null;
  children?: ReactNode;
};

/** Presentation only. The owning workspace keeps every action and safety guard. */
export default function CurrentSwapProgress({ visible, status, result, fundingRecovery, operation, children }: CurrentSwapProgressProps) {
  if (!visible) return null;
  return <section className="dex-v2-current-progress" aria-label="Swap status">
    {status ? <p className="dex-v2-current-status" role="status">{status}</p> : null}
    {result && result !== status ? <p className="dex-v2-current-result">{result}</p> : null}
    {fundingRecovery ? <p role="alert">Check the pending funding transaction before another request.</p> : null}
    {operation ? <>
      <dl className="dex-v2-progress-facts">
        <div><dt>Operation</dt><dd>{operation.id}</dd></div>
        {operation.expiresAt ? <div><dt>Expires</dt><dd>{operation.expiresAt}</dd></div> : null}
        {operation.publicState ? <div><dt>Public state</dt><dd>{operation.publicState}</dd></div> : null}
      </dl>
      {operation.privateAccountingUnverified ? <p>Private accounting is not verified.</p> : null}
    </> : null}
    {children}
  </section>;
}
