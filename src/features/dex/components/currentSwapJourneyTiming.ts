// Session-only public identities and clocks. Never store quote terms or receipt data.
export type SwapJourneyIdentity = { candidate: string; core: string; graph: string; profile: string };
type AcceptAttempt = { requestedAtMs: number | null; confirmedAtMs: number | null; transactionHash: string | null; cancelled: boolean };
const elapsed = (start: number | null, end: number | null) =>
  start === null || end === null || end < start ? null : end - start;

export class CurrentSwapJourneyTiming {
  readonly startedAtMs: number | null;
  private operationId: string | null = null;
  private previewAtMs: number | null = null;
  private deliveryAtMs: number | null = null;
  private quoteTransactionHash: string | null = null;
  private terminalTransactionHash: string | null = null;
  private attempts: AcceptAttempt[] = [];
  private waits: { kind: string; elapsedMs: number | null; confirmed?: boolean }[] = [];

  constructor(readonly scope: object, readonly identity: SwapJourneyIdentity, private now = () => performance.now()) {
    this.startedAtMs = this.readClock();
  }
  private readClock() {
    try { const value = this.now(); return Number.isFinite(value) && value >= 0 ? value : null; }
    catch { return null; } // Missing diagnostics must not stop a swap or its recovery.
  }
  bindOperation(id: string) {
    if (this.operationId !== null && this.operationId !== id) return false;
    this.operationId = id; return true;
  }
  quoteSubmitted(hash: string) { this.quoteTransactionHash ??= hash; }
  previewDisplayed(id: string) {
    if (!this.bindOperation(id) || this.previewAtMs !== null) return false;
    this.previewAtMs = this.readClock(); return this.previewAtMs !== null;
  }
  acceptRequested() {
    const attempt: AcceptAttempt = { requestedAtMs: this.readClock(), confirmedAtMs: null, transactionHash: null, cancelled: false };
    this.attempts.push(attempt); return attempt;
  }
  acceptDecision(attempt: AcceptAttempt, confirmed: boolean) {
    if (!this.attempts.includes(attempt) || attempt.cancelled || attempt.confirmedAtMs !== null) return;
    if (confirmed) attempt.confirmedAtMs = this.readClock(); else attempt.cancelled = true;
  }
  acceptSubmitted(attempt: AcceptAttempt, hash: string) {
    if (this.attempts.includes(attempt) && !attempt.cancelled) attempt.transactionHash ??= hash;
  }
  deliveryDisplayed(id: string, hash: string | null) {
    if (!this.bindOperation(id) || this.deliveryAtMs !== null) return false;
    this.deliveryAtMs = this.readClock(); this.terminalTransactionHash = hash; return this.deliveryAtMs !== null;
  }
  async observeWait<T>(kind: string, action: () => Promise<T>, decision = false): Promise<T> {
    const start = this.readClock();
    try {
      const value = await action();
      this.waits.push({ kind, elapsedMs: elapsed(start, this.readClock()), ...(decision ? { confirmed: value === true } : {}) });
      return value;
    } catch (error) {
      this.waits.push({ kind: `${kind} (failed)`, elapsedMs: elapsed(start, this.readClock()) }); throw error;
    }
  }
  snapshot() {
    const accepted = this.attempts.find(attempt => attempt.transactionHash !== null);
    return { ...this.identity, operationId: this.operationId, quoteTransactionHash: this.quoteTransactionHash,
      acceptTransactionHash: accepted?.transactionHash ?? null, terminalTransactionHash: this.terminalTransactionHash,
      quoteClickToPrivatePreviewDisplayedMs: elapsed(this.startedAtMs, this.previewAtMs),
      acceptRequestToVerifiedResultDisplayedMs: elapsed(accepted?.requestedAtMs ?? null, this.deliveryAtMs),
      acceptConfirmationToVerifiedResultDisplayedMs: elapsed(accepted?.confirmedAtMs ?? null, this.deliveryAtMs),
      quoteClickToVerifiedResultDisplayedMs: elapsed(this.startedAtMs, this.deliveryAtMs),
      waits: this.waits.map(wait => ({ ...wait })),
      acceptAttempts: this.attempts.map(attempt => ({ cancelled: attempt.cancelled, submitted: attempt.transactionHash !== null,
        requestToConfirmationMs: elapsed(attempt.requestedAtMs, attempt.confirmedAtMs) })) };
  }
}

// A React commit in a visible document is observable. Actual browser paint is not.
export function currentSwapTimingVisible(element: HTMLElement | null, documentVisible: boolean, viewVisible: boolean) {
  return Boolean(documentVisible && viewVisible && element?.isConnected && !element.closest('[hidden]'));
}
