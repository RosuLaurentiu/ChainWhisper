import { describe, expect, it } from 'vitest';
import {
  getProviderErrorMessage,
  isProviderRequestAlreadyPending
} from './appShared/core';

describe('provider error helpers', () => {
  it('treats MetaMask pending request errors as a recoverable wallet prompt state', () => {
    const pendingError = { code: -32002, message: 'Request already pending' };

    expect(isProviderRequestAlreadyPending(pendingError)).toBe(true);
    expect(getProviderErrorMessage(pendingError, 'Failed to connect wallet.')).toBe(
      'A wallet request is already pending. Open your wallet and approve or reject it first.'
    );
  });
});
