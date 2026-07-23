export type TradeAgentReadinessKind =
  | 'prompt-needed'
  | 'account-needed'
  | 'ready'
  | 'loading'
  | 'retryable'
  | 'error';

export type TradeAgentReadiness = {
  kind: TradeAgentReadinessKind;
  message: string;
  canSubmit: boolean;
};

type ResolveTradeAgentReadinessInput = {
  error: string;
  hasAccount: boolean;
  loading: boolean;
  prompt: string;
  retryPaymentTxHash: string;
  status: string;
};

export const resolveTradeAgentReadiness = ({
  error,
  hasAccount,
  loading,
  prompt,
  retryPaymentTxHash,
  status
}: ResolveTradeAgentReadinessInput): TradeAgentReadiness => {
  if (loading) {
    return {
      kind: 'loading',
      message: status || 'Working...',
      canSubmit: false
    };
  }

  if (!hasAccount) {
    return {
      kind: 'account-needed',
      message: 'Connect your ChainWhisper account to use the Trade Agent.',
      canSubmit: false
    };
  }

  if (retryPaymentTxHash) {
    return {
      kind: 'retryable',
      message: error || status || 'You can retry without paying again.',
      canSubmit: true
    };
  }

  if (error) {
    return {
      kind: 'error',
      message: error,
      canSubmit: Boolean(prompt.trim())
    };
  }

  if (!prompt.trim()) {
    return {
      kind: 'prompt-needed',
      message: 'Choose an action or enter a request.',
      canSubmit: false
    };
  }

  return {
    kind: 'ready',
    message: 'Paid from your ChainWhisper account.',
    canSubmit: true
  };
};
