import './TransactionSteps.css';
import { Check, Wallet, X } from 'lucide-react';

/**
 * Presentation only. The track shows step state that the owning workspace already computes.
 * It sends nothing, owns no action and changes no wallet, journal or recovery behavior.
 */
export type StepState = 'done' | 'active' | 'wallet' | 'next' | 'stopped';
export type StepsOutcome = 'idle' | 'running' | 'complete' | 'stopped';
export type TransactionStepsModel = Readonly<{
  title: string;
  /** Short current-step text. Empty before the flow starts. */
  detail: string;
  outcome: StepsOutcome;
  steps: readonly Readonly<{ label: string; state: StepState }>[];
}>;

const STATE_TEXT: Record<StepState, string> = { done: 'Complete', active: 'Current step', wallet: 'Waiting for your wallet', next: 'Not started', stopped: 'Stopped' };

/** Inline step track for multi-step flows: one status line and one node per step. No window, no control. */
export default function TransactionSteps({ label, model, className }: { label: string; model: TransactionStepsModel; className?: string }) {
  return <section className={className ? `tx-steps ${className}` : 'tx-steps'} aria-label={label} data-outcome={model.outcome}>
    <p className="tx-steps-summary" aria-live="polite"><strong>{model.title}</strong>{model.detail ? <span>{model.detail}</span> : null}</p>
    <ol className="tx-steps-track">
      {model.steps.map((step, index) => <li key={step.label} data-state={step.state}
        aria-current={step.state === 'active' || step.state === 'wallet' ? 'step' : undefined}>
        <span className="tx-steps-node" aria-hidden="true">{step.state === 'done' ? <Check size={10} strokeWidth={3.5} />
          : step.state === 'wallet' ? <Wallet size={10} strokeWidth={2.5} /> : step.state === 'stopped' ? <X size={10} strokeWidth={3.5} /> : index + 1}</span>
        <span className="tx-steps-label">{step.label}</span>
        <span className="sr-only">: {STATE_TEXT[step.state]}</span>
      </li>)}
    </ol>
  </section>;
}
