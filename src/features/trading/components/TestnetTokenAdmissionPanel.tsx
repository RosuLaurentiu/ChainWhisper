import { useCallback, useEffect, useState } from 'react';
import {
  approveNextChainWhisperTestnetToken,
  CHAINWHISPER_TESTNET_TOKEN_ADMISSION_CHAIN_ID,
  CHAINWHISPER_TESTNET_TOKEN_ADMISSION_OWNER,
  inspectChainWhisperTestnetTokenAdmissions,
  type TestnetTokenAdmissionState
} from '../../../lib/chainWhisperTestnetTokenAdmission';
import {
  COTI_NETWORK,
  getProviderErrorMessage,
  isProviderActionRejected,
  shortenAddress
} from '../../../lib/appShared';
import type { SharedWalletSession } from '../../../lib/walletSession';

type TestnetTokenAdmissionPanelProps = Readonly<{
  session?: SharedWalletSession;
}>;

const isOwnerSession = (session?: SharedWalletSession): boolean => Boolean(
  session?.activeSignerSource === 'metamask' &&
  session.chainId === Number(CHAINWHISPER_TESTNET_TOKEN_ADMISSION_CHAIN_ID) &&
  session.walletAddress.trim().toLowerCase() === CHAINWHISPER_TESTNET_TOKEN_ADMISSION_OWNER
);

export const isTestnetTokenAuthorizationApplied = (
  state: TestnetTokenAdmissionState | null,
  operationId: string
): boolean => Boolean(state?.operations.some(({ approved, id }) => approved && id === operationId));

export const getTestnetTokenAuthorizationFailureMessage = (error: unknown): string => {
  const reason = isProviderActionRejected(error)
    ? 'The wallet request was rejected.'
    : getProviderErrorMessage(error, 'The contract authorization was not completed.');
  return `${reason} No order or token transfer was submitted; you can safely retry this step.`;
};

export default function TestnetTokenAdmissionPanel({ session }: TestnetTokenAdmissionPanelProps) {
  const [state, setState] = useState<TestnetTokenAdmissionState | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const onTestnet = COTI_NETWORK.chainIdDecimal === Number(CHAINWHISPER_TESTNET_TOKEN_ADMISSION_CHAIN_ID);
  const ownerSession = isOwnerSession(session);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      setState(await inspectChainWhisperTestnetTokenAdmissions());
    } catch {
      setError('The reviewed testnet token setup could not be verified. Try again when the COTI testnet RPC is stable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!onTestnet) return;
    void refresh();
  }, [onTestnet, refresh]);

  if (!onTestnet) return null;
  if (!loading && state?.complete === state?.total) return null;

  const approveNext = async () => {
    if (!state?.next || !session?.actions?.getOtcV2Capability || !session.actions.runWalletTransactionFlow) return;
    const operation = state.next;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const result = await session.actions.runWalletTransactionFlow(async () => {
        const capability = await session.actions?.getOtcV2Capability?.(
          false,
          CHAINWHISPER_TESTNET_TOKEN_ADMISSION_CHAIN_ID
        );
        if (!capability) throw new Error('Owner browser-wallet capability is unavailable.');
        return approveNextChainWhisperTestnetToken({
          capability,
          expectedOperationId: operation.id
        });
      });
      setState(result.state);
      setNotice(`${operation.targetLabel} now accepts the reviewed ${operation.tokenLabel} test token.`);
    } catch (authorizationError) {
      let refreshedState: TestnetTokenAdmissionState | null = null;
      try {
        refreshedState = await inspectChainWhisperTestnetTokenAdmissions();
        setState(refreshedState);
      } catch {
        // Keep the last verified progress; the original wallet error remains the useful retry reason.
      }
      if (isTestnetTokenAuthorizationApplied(refreshedState, operation.id)) {
        setNotice(
          `${operation.targetLabel} accepted ${operation.tokenLabel} on-chain. ` +
          'The final status read recovered after the wallet error.'
        );
      } else {
        setError(getTestnetTokenAuthorizationFailureMessage(authorizationError));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const completed = state?.complete ?? 0;
  const total = state?.total ?? 16;
  const progress = Math.round((completed / total) * 100);
  return (
    <section className="testnet-token-admission" aria-label="Testnet trading setup">
      <div className="testnet-token-admission-copy">
        <span className="testnet-token-admission-kicker">COTI Testnet setup</span>
        <strong>Authorize reviewed tokens in the trading contracts</strong>
        <p>
          This owner-only allowlist records each reviewed token&apos;s deployed bytecode hash. It does not transfer
          tokens or grant spending allowance. Each click authorizes one contract-token pairing on-chain.
        </p>
      </div>
      <div className="testnet-token-admission-progress" aria-label={`${completed} of ${total} approvals complete`}>
        <div className="testnet-token-admission-progress-row">
          <span>{loading ? 'Checking approvals…' : `${completed} of ${total} complete`}</span>
          <span>{progress}%</span>
        </div>
        <div className="testnet-token-admission-track" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        {!loading && state?.next ? (
          <small>Next: {state.next.targetLabel} · {state.next.tokenLabel}</small>
        ) : null}
      </div>
      <div className="testnet-token-admission-actions">
        {!ownerSession ? (
          <small>
            Connect the deployment owner {shortenAddress(CHAINWHISPER_TESTNET_TOKEN_ADMISSION_OWNER)} to continue.
          </small>
        ) : null}
        <button
          type="button"
          onClick={() => void approveNext()}
          disabled={loading || submitting || !state?.next || !ownerSession}
        >
          {submitting ? 'Confirming authorization…' : 'Authorize next pairing'}
        </button>
        <button type="button" className="secondary" onClick={() => void refresh()} disabled={loading || submitting}>
          Recheck
        </button>
      </div>
      {notice ? <p className="testnet-token-admission-notice" role="status">{notice}</p> : null}
      {error ? <p className="testnet-token-admission-error" role="alert">{error}</p> : null}
    </section>
  );
}
