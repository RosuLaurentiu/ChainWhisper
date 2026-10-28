export type ObservationLedgerCursor = Readonly<{
  nextIndex: number;
  sealed: boolean;
}>;

export const createObservationLedgerCursor = (): ObservationLedgerCursor =>
  Object.freeze({ nextIndex: 0, sealed: false });

export const consumeObservationLedger = <T>({
  beforeCount,
  cursor,
  observations
}: {
  beforeCount: number;
  cursor: ObservationLedgerCursor;
  observations: readonly T[];
}): { cursor: ObservationLedgerCursor; entries: T[] } => {
  if (cursor.sealed) throw new Error('The real-wallet observation ledger is already sealed.');
  if (!Number.isSafeInteger(beforeCount) || beforeCount < 0) {
    throw new Error('The real-wallet observation ledger count is invalid.');
  }
  if (beforeCount !== cursor.nextIndex) {
    throw new Error('Unmeasured real-wallet observations occurred between phases.');
  }
  if (observations.length < beforeCount) {
    throw new Error('The real-wallet observation ledger regressed.');
  }
  return {
    cursor: Object.freeze({ nextIndex: observations.length, sealed: false }),
    entries: observations.slice(beforeCount)
  };
};

export const sealObservationLedgerCursor = ({
  currentCount,
  cursor
}: {
  currentCount: number;
  cursor: ObservationLedgerCursor;
}): ObservationLedgerCursor => {
  if (cursor.sealed) throw new Error('The real-wallet observation ledger is already sealed.');
  if (!Number.isSafeInteger(currentCount) || currentCount < 0) {
    throw new Error('The real-wallet observation ledger count is invalid.');
  }
  if (currentCount !== cursor.nextIndex) {
    throw new Error('The real-wallet observation ledger contains unmeasured final entries.');
  }
  return Object.freeze({ nextIndex: currentCount, sealed: true });
};
