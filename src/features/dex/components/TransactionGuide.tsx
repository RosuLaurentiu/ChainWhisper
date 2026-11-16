import './TransactionGuide.css';
import { useState, type RefObject } from 'react';
import { Check, ChevronUp, ListChecks, Wallet, X } from 'lucide-react';

/**
 * Presentation only. The guide shows step state that the owning workspace already computes.
 * It sends nothing, owns no action and changes no wallet, journal or recovery behavior.
 */
export type GuideStepState = 'done' | 'active' | 'wallet' | 'next' | 'stopped';
export type GuideOutcome = 'idle' | 'running' | 'complete' | 'stopped';
export type TransactionGuideStep = Readonly<{ label: string; detail: string; state: GuideStepState }>;
export type TransactionGuideModel = Readonly<{ title: string; detail: string; outcome: GuideOutcome; steps: readonly TransactionGuideStep[] }>;

/** Opens the guide once when a flow starts; after that the user's choice holds until the next run. */
export const nextGuideOpen = (previous: GuideOutcome, outcome: GuideOutcome, open: boolean): boolean =>
  outcome === 'idle' ? false : previous === 'idle' && outcome === 'running' ? true : open;

/** State only, no effect: the outcome change is applied during render (React's previous-value pattern). */
export function useTransactionGuide(outcome: GuideOutcome) {
  const [open, setOpen] = useState(false);
  const [previous, setPrevious] = useState(outcome);
  if (previous !== outcome) {
    setPrevious(outcome);
    const next = nextGuideOpen(previous, outcome, open);
    if (next !== open) setOpen(next);
  }
  return [open, setOpen] as const;
}

const guideId = (flow: string) => `tx-guide-${flow.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

export type CurrentPoolGuideInput = Readonly<{
  step: number; approvalCount: number; ready: boolean; stopped: boolean; blocked: boolean;
  pendingPhase: 'preview' | 'fund' | 'approval-0' | 'approval-1' | 'clear-0' | 'clear-1' | null;
  tokenLabels: readonly [string, string];
}>;

const WALLET_WAIT = 'Confirm in your wallet if asked, then wait for confirmation.';

/** Maps the existing Add liquidity step index and pending phase to the guide. */
export function currentPoolGuideModel({ step, approvalCount, ready, stopped, blocked, pendingPhase, tokenLabels }: CurrentPoolGuideInput): TransactionGuideModel {
  const pending = pendingPhase !== null;
  const outcome: GuideOutcome = ready ? 'complete' : stopped || blocked ? 'stopped' : step <= 0 && !pending ? 'idle' : 'running';
  const current = outcome === 'idle' ? -1 : outcome === 'complete' ? 4 : Math.max(step, 0);
  const approvalToken = pendingPhase === 'approval-1' || pendingPhase === 'clear-1' ? tokenLabels[1] : tokenLabels[0];
  const rows: readonly (readonly [string, string, string, string])[] = [
    ['Preview', 'Preview verified', 'Review your deposit, then press Preview deposit.', 'Costs gas. No tokens move.'],
    [current === 1 ? `Approve (${approvalCount}/2)` : 'Approve', 'Both approvals verified', `Approve the exact ${tokenLabels[approvalCount === 1 ? 1 : 0]} amount.`, 'Exact amount of each token.'],
    ['Deposit', 'Deposit verified', 'Press Review and fund Pool to continue.', 'Moves your tokens into the Pool.'],
    ['Done', 'Position created', 'Position created.', 'The position appears in Your Positions.'],
  ];
  const steps = rows.map(([label, done, now, later], index): TransactionGuideStep => {
    if (outcome === 'complete' || index < current) return { label, detail: done, state: 'done' };
    if (index > current || outcome === 'idle') return { label, detail: later, state: 'next' };
    if (outcome === 'stopped') return { label, detail: stopped ? 'Deposit stopped' : 'Needs a status check', state: 'stopped' };
    return pending ? { label, detail: WALLET_WAIT, state: 'wallet' } : { label, detail: now, state: 'active' };
  });
  const active = steps[current];
  const title = outcome === 'complete' ? 'Position created' : stopped ? 'Deposit stopped' : blocked ? 'Check Pool status' : outcome === 'idle' ? 'Preview, approve, deposit' :
    current === 0 ? 'Preview deposit' : current === 1 ? (pending ? `Approve ${approvalToken}` : 'Approve tokens') : current === 2 ? 'Fund Pool' : 'Add liquidity';
  const detail = outcome === 'complete' ? 'Your liquidity position is ready.' : stopped ? 'Unused approvals are cleared.' : blocked ? 'Check Pool status before you continue. Do not resend.' :
    outcome === 'idle' ? 'Up to 4 transactions. The preview moves no tokens.' : active?.detail ?? '';
  return { title, detail, outcome, steps };
}

const position = (model: TransactionGuideModel) => model.steps.findIndex(step => step.state === 'active' || step.state === 'wallet');
const summary = (model: TransactionGuideModel) => {
  const index = position(model);
  return model.outcome === 'complete' ? 'All steps complete' : model.outcome === 'stopped' ? 'Stopped' : index >= 0 ? `Step ${index + 1} of ${model.steps.length}` : `${model.steps.length} steps`;
};

const StepNode = ({ state, index }: { state: GuideStepState; index: number }) => <span className="tx-guide-node" aria-hidden="true">
  {state === 'done' ? <Check size={13} strokeWidth={3} /> : state === 'wallet' ? <Wallet size={13} /> : state === 'stopped' ? <X size={13} strokeWidth={3} /> : index + 1}
</span>;

const STATE_TEXT: Record<GuideStepState, string> = { done: 'Complete', active: 'Current step', wallet: 'Waiting for your wallet', next: 'Not started', stopped: 'Stopped' };

export default function TransactionGuide({ flow, model, open, onClose, status, returnFocus }: {
  flow: string; model: TransactionGuideModel; open: boolean; onClose: () => void; status?: string | null;
  returnFocus?: RefObject<HTMLElement>;
}) {
  // No hooks here: owners render this inside workspaces whose tests call components directly.
  if (!open) return null;
  const titleId = `${guideId(flow)}-title`;
  const close = () => { onClose(); returnFocus?.current?.focus(); };
  return <aside className="tx-guide" role="dialog" aria-modal="false" aria-labelledby={titleId} data-outcome={model.outcome}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
    <header className="tx-guide-head">
      <span className="tx-guide-flow">{flow}</span>
      <span className="tx-guide-count">{summary(model)}</span>
      <button type="button" className="tx-guide-close" aria-label={`Close ${flow.toLowerCase()} steps`} onClick={close}><X size={16} aria-hidden="true" /></button>
    </header>
    <h2 id={titleId} tabIndex={-1} className="tx-guide-title">{model.title}</h2>
    {model.detail ? <p className="tx-guide-detail">{model.detail}</p> : null}
    <ol className="tx-guide-rail">
      {model.steps.map((step, index) => <li key={step.label.replace(/ \(.*\)$/, '')} data-state={step.state}
        aria-current={step.state === 'active' || step.state === 'wallet' ? 'step' : undefined}>
        <StepNode state={step.state} index={index} />
        <span className="tx-guide-step"><strong>{step.label}</strong><small>{step.detail}</small></span>
        <span className="sr-only">{STATE_TEXT[step.state]}</span>
      </li>)}
    </ol>
    {status ? <p className="tx-guide-status" role="status">{status}</p> : null}
    <p className="tx-guide-note">Closing this window stops nothing. Open it again from the form.</p>
  </aside>;
}

/** Compact step track for the form row; the guide window keeps the full step text. */
const StepTrack = ({ model }: { model: TransactionGuideModel }) => <span className="tx-guide-track" aria-hidden="true">
  {model.steps.map((step, index) => <span key={step.label.replace(/ \(.*\)$/, '')} className="tx-guide-track-step" data-state={step.state}>
    <span className="tx-guide-track-node">{step.state === 'done' ? <Check size={10} strokeWidth={3.5} /> : step.state === 'wallet' ? <Wallet size={10} strokeWidth={2.5} />
      : step.state === 'stopped' ? <X size={10} strokeWidth={3.5} /> : index + 1}</span>
    <span className="tx-guide-track-label">{step.label.replace(/ \(.*\)$/, '')}</span>
  </span>)}
</span>;

export function TransactionGuideLauncher({ flow, model, open, onToggle, buttonRef, track = true }: {
  flow: string; model: TransactionGuideModel; open: boolean; onToggle: () => void; buttonRef?: RefObject<HTMLButtonElement>;
  /** False where the form already shows its own stepper next to the launcher. */
  track?: boolean;
}) {
  const current = position(model);
  const progress = model.outcome === 'running' && current >= 0 ? `Step ${current + 1} of ${model.steps.length}: ${model.steps[current].label}. ` : '';
  return <button type="button" ref={buttonRef} className="tx-guide-launcher" data-outcome={model.outcome} data-track={track || undefined} aria-haspopup="dialog" aria-expanded={open}
    onClick={() => {
      // Focus moves into the guide only when the user opens it; an automatic open never takes focus from a wallet prompt.
      if (!open && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => document.getElementById(`${guideId(flow)}-title`)?.focus());
      onToggle();
    }}>
    <span className="tx-guide-launcher-text"><strong aria-live="polite">{model.title}</strong>{model.detail ? <small>{model.detail}</small> : null}</span>
    <span className="tx-guide-launcher-icon">{open ? <ChevronUp size={16} aria-hidden="true" /> : <ListChecks size={16} aria-hidden="true" />}
      <span className="sr-only">{progress}{open ? `Hide ${flow.toLowerCase()} steps` : `Show ${flow.toLowerCase()} steps`}</span></span>
    {track ? <StepTrack model={model} /> : null}
  </button>;
}
