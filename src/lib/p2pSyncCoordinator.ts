export type P2PSyncReason = 'initial' | 'manual' | 'focus' | 'interval' | 'chain-event' | 'wallet-action';

export type P2PSyncDomain = 'public-trades' | 'wallet-trades' | 'trade-detail' | 'balances';

export type P2PSyncRequest<TSigner = unknown> = {
  domains: Set<P2PSyncDomain>;
  escrowContract?: string;
  reason: P2PSyncReason;
  signer?: TSigner;
  tradeId?: number;
};

export const mergeP2PSyncRequests = <TSigner>(
  previous: P2PSyncRequest<TSigner> | null | undefined,
  next: P2PSyncRequest<TSigner>
): P2PSyncRequest<TSigner> => ({
  domains: new Set([...(previous?.domains ?? []), ...next.domains]),
  escrowContract: next.escrowContract ?? previous?.escrowContract,
  reason: next.reason,
  signer: next.signer ?? previous?.signer,
  tradeId: next.tradeId ?? previous?.tradeId
});

export const shouldUseSilentP2PSync = (reason: P2PSyncReason): boolean => reason !== 'manual';
