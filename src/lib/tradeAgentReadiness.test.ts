import { describe, expect, it } from 'vitest';
import { resolveTradeAgentReadiness } from './tradeAgentReadiness';

const resolve = (
  input: Partial<Parameters<typeof resolveTradeAgentReadiness>[0]> = {}
) =>
  resolveTradeAgentReadiness({
    error: '',
    hasAccount: true,
    loading: false,
    prompt: '',
    retryPaymentTxHash: '',
    status: '',
    ...input
  });

describe('resolveTradeAgentReadiness', () => {
  it('asks for a prompt before enabling payment', () => {
    expect(resolve()).toEqual({
      kind: 'prompt-needed',
      message: 'Choose an action or enter a request.',
      canSubmit: false
    });
  });

  it('requires a ChainWhisper account even when a prompt is present', () => {
    expect(resolve({ hasAccount: false, prompt: 'Compare prices.' })).toEqual({
      kind: 'account-needed',
      message: 'Connect your ChainWhisper account to use the Trade Agent.',
      canSubmit: false
    });
  });

  it('enables a ready request only when the prompt and account are available', () => {
    expect(resolve({ prompt: 'Compare prices.' })).toEqual({
      kind: 'ready',
      message: 'Paid from your ChainWhisper account.',
      canSubmit: true
    });
  });

  it('keeps the active payment status visible while loading', () => {
    expect(resolve({ loading: true, prompt: 'Compare prices.', status: 'Getting the final WISP quote...' })).toEqual({
      kind: 'loading',
      message: 'Getting the final WISP quote...',
      canSubmit: false
    });
  });

  it('enables exact-request recovery without another payment', () => {
    expect(resolve({
      error: 'The provider timed out.',
      prompt: 'Compare prices.',
      retryPaymentTxHash: '0xpaid',
      status: 'You can retry without paying again.'
    })).toEqual({
      kind: 'retryable',
      message: 'The provider timed out.',
      canSubmit: true
    });
  });

  it('keeps a correctable pre-payment error visible and allows resubmission', () => {
    expect(resolve({ error: 'Trade Agent payment quote is invalid.', prompt: 'Compare prices.' })).toEqual({
      kind: 'error',
      message: 'Trade Agent payment quote is invalid.',
      canSubmit: true
    });
  });
});
