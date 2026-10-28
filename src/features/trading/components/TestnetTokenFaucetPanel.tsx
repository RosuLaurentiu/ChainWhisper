import { formatUnits } from '@coti-io/coti-ethers';
import { useCallback, useEffect, useState } from 'react';
import {
  claimChainWhisperTestnetToken,
  inspectChainWhisperTestnetFaucet,
  isChainWhisperTestnetFaucetActive,
  type TestnetFaucetState,
  type TestnetFaucetToken
} from '../../../lib/chainWhisperTestnetFaucet';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { getProviderErrorMessage } from '../../../lib/appShared';
import { COTI_TESTNET_NETWORK } from '../../../lib/chainWhisperNetworks';

const TESTNET_CHAIN_ID = 7_082_400;

type FaucetClaimStage = 'wallet' | 'pending' | 'confirmed' | 'uncertain' | 'failed' | '';

export default function TestnetTokenFaucetPanel({
  onClaimConfirmed,
  session
}: Readonly<{
  onClaimConfirmed?: () => Promise<void> | void;
  session?: SharedWalletSession;
}>) {
  const [state, setState] = useState<TestnetFaucetState | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submittingToken, setSubmittingToken] = useState<TestnetFaucetToken['key'] | null>(null);
  const [claimStage, setClaimStage] = useState<FaucetClaimStage>('');
  const [lastTransactionHash, setLastTransactionHash] = useState('');
  const active = isChainWhisperTestnetFaucetActive();
  const walletScopeKey = session?.walletAddress.trim().toLowerCase() ?? '';
  const walletReady = active && session?.activeSignerSource === 'metamask' &&
    session.chainId === TESTNET_CHAIN_ID && Boolean(walletScopeKey);

  const refresh = useCallback(async () => {
    if (!walletReady || !walletScopeKey) {
      setState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setState(await inspectChainWhisperTestnetFaucet(walletScopeKey));
    } catch {
      setError('The reviewed test-token faucets could not be verified. Try again when the testnet RPC is stable.');
    } finally {
      setLoading(false);
    }
  }, [walletReady, walletScopeKey]);

  useEffect(() => {
    if (!active) return;
    void refresh();
  }, [active, refresh]);

  if (!active || (!loading && state !== null && state.claimed === state.total && !claimStage)) return null;

  const claimToken = async (token: TestnetFaucetToken) => {
    if (token.claimed || !session?.actions?.getOtcV2Capability || !session.actions.runWalletTransactionFlow) return;
    let submittedHash = '';
    setSubmittingToken(token.key);
    setClaimStage('wallet');
    setLastTransactionHash('');
    setError('');
    try {
      const result = await session.actions.runWalletTransactionFlow(async () => {
        const capability = await session.actions?.getOtcV2Capability?.(
          token.kind === 'private',
          BigInt(TESTNET_CHAIN_ID)
        );
        if (!capability) throw new Error('Browser-wallet capability is unavailable.');
        return claimChainWhisperTestnetToken({
          capability,
          expectedTokenKey: token.key,
          onSubmitted: (transactionHash) => {
            submittedHash = transactionHash;
            setLastTransactionHash(transactionHash);
            setClaimStage('pending');
          }
        });
      });
      setState(result.state);
      setLastTransactionHash(result.transactionHash);
      setClaimStage('confirmed');
      await onClaimConfirmed?.();
    } catch (cause) {
      await refresh();
      setClaimStage(submittedHash ? 'uncertain' : 'failed');
      setError(getProviderErrorMessage(
        cause,
        submittedHash
          ? 'The claim was submitted, but confirmation is uncertain. Check the transaction before retrying.'
          : 'That faucet claim was not completed. No other token claim was submitted.'
      ));
    } finally {
      setSubmittingToken(null);
    }
  };

  const claimed = state?.claimed ?? 0;
  const total = state?.total ?? 4;
  const tokens = [...(state?.tokens ?? [])].sort(
    (left, right) => Number(right.kind === 'private') - Number(left.kind === 'private')
  );
  return (
    <section className="testnet-token-faucet" aria-label="COTI Testnet token faucets">
      <div className="testnet-token-faucet-copy">
        <span className="testnet-token-admission-kicker">Test trading funds</span>
        <strong>Claim the four reviewed test tokens</strong>
        <p>Each token can be claimed once per wallet. Every claim opens one value-zero transaction.</p>
      </div>
      <div className="testnet-token-faucet-list" aria-label={`${claimed} of ${total} test tokens claimed`}>
        {tokens.map((token) => (
          <span key={token.key} className={token.claimed ? 'is-complete' : ''}>
            <strong>{token.label}</strong>
            <small>
              {token.claimed
                ? 'Claimed'
                : `${formatUnits(token.faucetAmount, token.decimals)} ${token.kind}`}
            </small>
            {!token.claimed ? (
              <button
                type="button"
                onClick={() => void claimToken(token)}
                disabled={!walletReady || loading || submittingToken !== null}
              >
                {submittingToken === token.key
                  ? claimStage === 'wallet' ? 'Confirm in wallet' : 'Waiting for receipt'
                  : `Claim ${token.label}`}
              </button>
            ) : null}
          </span>
        ))}
        {loading && !state ? <small>Checking faucet status...</small> : null}
      </div>
      <div className="testnet-token-admission-actions">
        {!walletReady ? <small>Connect MetaMask or CipherTrade on COTI Testnet to claim test funds.</small> : null}
        <small>cwTPB and cwTPQ are private COTI tokens and are listed first.</small>
        <button
          type="button"
          className="secondary"
          onClick={() => void refresh()}
          disabled={loading || submittingToken !== null}
        >
          Recheck
        </button>
      </div>
      {claimStage ? (
        <p className={`testnet-token-faucet-status ${claimStage}`} role={claimStage === 'failed' || claimStage === 'uncertain' ? 'alert' : 'status'}>
          {claimStage === 'wallet'
            ? 'Wallet confirmation requested.'
            : claimStage === 'pending'
              ? 'Claim submitted. Waiting for the receipt.'
              : claimStage === 'confirmed'
                ? 'Claim confirmed. Trading balances are refreshing.'
                : claimStage === 'uncertain'
                  ? 'Claim status is uncertain. Do not submit it again until you check the transaction.'
                  : 'Claim failed before a verified submission.'}
          {lastTransactionHash ? (
            <> <a href={`${COTI_TESTNET_NETWORK.blockExplorerUrl}/tx/${lastTransactionHash}`} target="_blank" rel="noreferrer">View transaction</a></>
          ) : null}
        </p>
      ) : null}
      {error ? <p className="testnet-token-admission-error" role="alert">{error}</p> : null}
    </section>
  );
}
