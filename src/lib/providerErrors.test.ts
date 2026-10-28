import { describe, expect, it } from 'vitest';
import {
  getProviderErrorMessage,
  isBrowserWalletSessionChangedError,
  isProviderRpcTransportUnavailable,
  isProviderRequestAlreadyPending,
  PROVIDER_RELOADED_MESSAGE,
  PROVIDER_RPC_UNAVAILABLE_MESSAGE
} from './appShared/core';

describe('provider error helpers', () => {
  it('treats MetaMask pending request errors as a recoverable wallet prompt state', () => {
    const pendingError = { code: -32002, message: 'Request already pending' };

    expect(isProviderRequestAlreadyPending(pendingError)).toBe(true);
    expect(getProviderErrorMessage(pendingError, 'Failed to connect wallet.')).toBe(
      'A wallet request is already pending. Open your wallet and approve or reject it first.'
    );
  });

  it('turns nested MetaMask RPC fetch failures into a short recoverable message', () => {
    const transportError = {
      code: -32603,
      data: {
        cause: { message: 'Failed to fetch' },
        message: 'Failed to fetch'
      },
      message: 'could not coalesce error'
    };

    expect(isProviderRpcTransportUnavailable(transportError)).toBe(true);
    expect(getProviderErrorMessage(transportError, 'Failed.')).toBe(PROVIDER_RPC_UNAVAILABLE_MESSAGE);
  });

  it('turns a nested lease mismatch into a concise non-sensitive wallet diagnostic', () => {
    const leaseError = {
      code: 'UNKNOWN_ERROR',
      error: {
        message: 'Owner wallet session changed. Reconnect the owner wallet and try again. [live-chain]'
      },
      message: 'could not coalesce error'
    };

    expect(getProviderErrorMessage(leaseError, 'Failed.')).toBe(
      'The selected wallet network changed while this action was being prepared. No transaction was sent. Select COTI Testnet and retry. (diagnostic: live-chain)'
    );
  });

  it('keeps legacy unsuffixed lease failures useful without exposing provider payloads', () => {
    expect(getProviderErrorMessage(
      new Error('Owner wallet session changed. Reconnect the owner wallet and try again.'),
      'Failed.'
    )).toBe(
      'The selected wallet session could not be verified before submission. No transaction was sent. Reconnect and retry. (diagnostic: unclassified)'
    );
  });

  it('recognizes nested owner-lease failures for a bounded pre-broadcast retry', () => {
    expect(isBrowserWalletSessionChangedError({
      code: 'UNKNOWN_ERROR',
      error: { message: 'Owner wallet session changed. Reconnect the owner wallet and try again. [lifecycle-epoch]' },
      message: 'could not coalesce error'
    })).toBe(true);
    expect(isBrowserWalletSessionChangedError(new Error('execution reverted'))).toBe(false);
  });

  it('never exposes a coalesced JSON-RPC payload or calldata', () => {
    const calldata = `0x${'ab'.repeat(96)}`;
    const coalescedError = new Error(
      `could not coalesce error (error={ "code": -32603 }, payload={ "jsonrpc": "2.0", "method": "eth_sendTransaction", "params": [{ "data": "${calldata}" }] })`
    );

    const message = getProviderErrorMessage(coalescedError, coalescedError.message);

    expect(message).toBe('The wallet request failed. Check the wallet Activity before retrying.');
    expect(message).not.toContain(calldata);
    expect(message).not.toContain('eth_sendTransaction');
  });

  it('selects a concise nested domain failure from a coalesced wrapper', () => {
    const coalescedError = {
      code: 'UNKNOWN_ERROR',
      error: { message: 'Direct Trade V2 transaction did not succeed.' },
      message: 'could not coalesce error (payload={ "jsonrpc": "2.0" })'
    };

    expect(getProviderErrorMessage(coalescedError, 'Failed to create trade.')).toBe(
      'Direct Trade V2 transaction did not succeed.'
    );
  });

  it('turns a destroyed provider request into an actionable non-sensitive message', () => {
    const destroyedError = new Error(
      'provider destroyed; cancelled request (operation="personal_sign", code=UNSUPPORTED_OPERATION, version=6.17.0)'
    );

    expect(getProviderErrorMessage(destroyedError, 'Failed to unlock privacy.')).toBe(
      PROVIDER_RELOADED_MESSAGE
    );
  });

  it('preserves concise application errors', () => {
    expect(getProviderErrorMessage(
      new Error('Direct Chat V2 history could not be verified. Retrying securely.'),
      'Failed to sync history.'
    )).toBe('Direct Chat V2 history could not be verified. Retrying securely.');
  });
});
