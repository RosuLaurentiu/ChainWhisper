import { useCallback, useEffect, useRef, useState } from 'react';
import { getProviderErrorMessage } from '../../../lib/appShared/core';
import {
  revealSuccessorAggregateOrRecurringPositionTerms,
  type SuccessorAggregateOrRecurringOwnerTerms,
  type SuccessorDexPositionState
} from '../../../lib/appChain';
import {
  revealSuccessorFixedPositionTerms,
  revealSuccessorRangePositionTerms,
  submitSuccessorPositionEdit,
  submitSuccessorPositionAction,
  submitSuccessorPositionTransfer,
  type SuccessorPrivatePositionTerms,
  type SuccessorPositionEdit,
  type SuccessorPositionAction
} from '../../../lib/successorDexPositionActions';
import type { SharedWalletSession } from '../../../lib/walletSession';
import type { SuccessorDexRuntimeState } from './useSuccessorDexDeployment';

export type SuccessorRevealedPositionTerms =
  | SuccessorAggregateOrRecurringOwnerTerms
  | SuccessorPrivatePositionTerms;

export const successorPositionActionRevision = ({
  position,
  privateTerms,
  state
}: {
  position: Pick<SuccessorDexPositionState, 'family' | 'positionId'>;
  privateTerms: SuccessorRevealedPositionTerms | null;
  state: Pick<SuccessorDexPositionState, 'revision'>;
}) => {
  if (position.family !== 'Aggregate' && position.family !== 'Recurring') {
    return state.revision;
  }
  if (privateTerms?.family !== position.family || privateTerms.positionId !== position.positionId) {
    return null;
  }
  return privateTerms.revision;
};

export const successorPositionTermsScope = (
  position: Pick<SuccessorDexPositionState,
    'family' | 'owner' | 'ownershipRevision' | 'positionId' | 'revision'>
) => [
  position.family,
  position.positionId,
  position.owner.toLowerCase(),
  position.ownershipRevision,
  position.revision
].join(':');

export default function useSuccessorPositionAction({
  refresh,
  runtime,
  sharedWalletSession
}: {
  refresh: () => void;
  runtime: SuccessorDexRuntimeState;
  sharedWalletSession?: SharedWalletSession;
}) {
  const active = useRef(false);
  const privateTermsRef = useRef<SuccessorRevealedPositionTerms | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [privateTerms, setPrivateTerms] = useState<SuccessorRevealedPositionTerms | null>(null);
  const [privateTermsScope, setPrivateTermsScope] = useState('');
  const privacyScope = runtime.status === 'ready'
    ? `${runtime.manifest.releaseIdentityHash}:${sharedWalletSession?.walletAddress.trim().toLowerCase() ?? ''}`
    : '';

  useEffect(() => {
    privateTermsRef.current = null;
    setPrivateTerms(null);
    setPrivateTermsScope('');
    setMessage('');
  }, [privacyScope]);

  const execute = useCallback(async (
    position: SuccessorDexPositionState,
    state: SuccessorDexPositionState,
    action: SuccessorPositionAction
  ) => {
    const actions = sharedWalletSession?.actions;
    if (!actions || runtime.status !== 'ready' || active.current) return null;
    if (!sharedWalletSession.walletAddress.trim()) {
      await actions.connectBrowserWallet();
      return null;
    }
    const expectedPositionRevision = successorPositionActionRevision({
      position,
      privateTerms: privateTermsRef.current,
      state
    });
    if (expectedPositionRevision === null) {
      setMessage(`Unlock your private ${position.family} terms before this action.`);
      return null;
    }
    active.current = true;
    setBusy(true);
    setMessage(`Confirm ${action} in your wallet…`);
    try {
      const result = await actions.runWalletTransactionFlow(async () => {
        const signer = await actions.getSigner(false);
        return submitSuccessorPositionAction({
          action,
          expectedOwnershipRevision: state.ownershipRevision,
          expectedPositionRevision,
          manifest: runtime.manifest,
          position,
          signer
        });
      });
      setMessage(`${action[0].toUpperCase()}${action.slice(1)} confirmed. ${result.transactionHash.slice(0, 10)}…`);
      privateTermsRef.current = null;
      setPrivateTerms(null);
      setPrivateTermsScope('');
      refresh();
      return result;
    } catch (error) {
      setMessage(getProviderErrorMessage(error, `Position ${action} failed.`));
      return null;
    } finally {
      active.current = false;
      setBusy(false);
    }
  }, [refresh, runtime, sharedWalletSession]);

  const revealTerms = useCallback(async (position: SuccessorDexPositionState) => {
    const actions = sharedWalletSession?.actions;
    if (!actions || runtime.status !== 'ready' || active.current) return null;
    if (!sharedWalletSession.walletAddress.trim()) {
      await actions.connectBrowserWallet(undefined, { preparePrivacy: true });
      return null;
    }
    active.current = true;
    setBusy(true);
    setMessage(`Unlocking your private ${position.family} terms…`);
    try {
      const terms = await actions.runWalletTransactionFlow(async () => {
        const signer = await actions.getSigner(true);
        if (position.family === 'Aggregate' || position.family === 'Recurring') {
          return revealSuccessorAggregateOrRecurringPositionTerms({
            manifest: runtime.manifest,
            position,
            signer
          });
        }
        const reveal = position.family === 'Fixed'
          ? revealSuccessorFixedPositionTerms
          : revealSuccessorRangePositionTerms;
        return reveal({
          expectedOwner: position.owner,
          expectedOwnershipRevision: position.ownershipRevision,
          manifest: runtime.manifest,
          positionId: position.positionId,
          signer
        });
      });
      privateTermsRef.current = terms;
      setPrivateTerms(terms);
      setPrivateTermsScope(successorPositionTermsScope(position));
      setMessage('');
      return terms;
    } catch (error) {
      privateTermsRef.current = null;
      setPrivateTerms(null);
      setPrivateTermsScope('');
      setMessage(getProviderErrorMessage(error, `The private ${position.family} terms could not be revealed.`));
      return null;
    } finally {
      active.current = false;
      setBusy(false);
    }
  }, [runtime, sharedWalletSession]);

  const edit = useCallback(async (
    position: SuccessorDexPositionState,
    terms: SuccessorPrivatePositionTerms,
    update: SuccessorPositionEdit
  ) => {
    const actions = sharedWalletSession?.actions;
    if (!actions || runtime.status !== 'ready' || active.current) return null;
    if (!sharedWalletSession.walletAddress.trim()) {
      await actions.connectBrowserWallet(undefined, { preparePrivacy: true });
      return null;
    }
    active.current = true;
    setBusy(true);
    setMessage(`Confirm ${update.kind} in your wallet…`);
    try {
      const result = await actions.runWalletTransactionFlow(async () => submitSuccessorPositionEdit({
        edit: update,
        manifest: runtime.manifest,
        position,
        privateTerms: terms,
        signer: await actions.getSigner(true)
      }));
      privateTermsRef.current = null;
      setPrivateTerms(null);
      setPrivateTermsScope('');
      const label = update.kind.includes('top-up')
        ? 'Top-up'
        : update.kind.includes('reprice')
          ? 'Reprice'
          : update.kind.includes('partial-exit')
            ? 'Partial exit'
            : 'Withdrawal';
      setMessage(`${label} confirmed. ${result.transactionHash.slice(0, 10)}… Reveal the refreshed terms.`);
      refresh();
      return result;
    } catch (error) {
      setMessage(getProviderErrorMessage(error, `Position ${update.kind} failed.`));
      return null;
    } finally {
      active.current = false;
      setBusy(false);
    }
  }, [refresh, runtime, sharedWalletSession]);

  const transfer = useCallback(async (
    position: SuccessorDexPositionState,
    recipient: string
  ) => {
    const actions = sharedWalletSession?.actions;
    if (!actions || runtime.status !== 'ready' || active.current) return null;
    if (!sharedWalletSession.walletAddress.trim()) {
      await actions.connectBrowserWallet();
      return null;
    }
    active.current = true;
    setBusy(true);
    setMessage('Confirm the Position NFT transfer in your wallet…');
    try {
      const result = await actions.runWalletTransactionFlow(async () => submitSuccessorPositionTransfer({
        manifest: runtime.manifest,
        position,
        recipient,
        signer: await actions.getSigner(false)
      }));
      privateTermsRef.current = null;
      setPrivateTerms(null);
      setPrivateTermsScope('');
      setMessage(`Position transferred. ${result.transactionHash.slice(0, 10)}…`);
      refresh();
      return result;
    } catch (error) {
      setMessage(getProviderErrorMessage(error, 'Position transfer failed.'));
      return null;
    } finally {
      active.current = false;
      setBusy(false);
    }
  }, [refresh, runtime, sharedWalletSession]);

  return Object.freeze({ busy, edit, execute, message, privateTerms, privateTermsScope, revealTerms, transfer });
}
