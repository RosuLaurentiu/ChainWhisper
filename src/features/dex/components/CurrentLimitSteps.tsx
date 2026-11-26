import TransactionSteps, { type StepState, type StepsOutcome, type TransactionStepsModel } from './TransactionSteps';

/** CW-140.08: the Limit create flow on the shared step track. Presentation only; the workspace owns every action. */
export type CurrentLimitStepInput = Readonly<{
  /** The candidate offers the separate exact-allowance step. */
  approvalStep: boolean;
  /** Phase of the submitted Limit transaction of this scope, if any. */
  live: 'limit-approval' | 'limit-create' | 'limit-snapshot' | null;
  approved: boolean;
  created: boolean;
  verified: boolean;
}>;

export function currentLimitStepsModel({ approvalStep, live, approved, created, verified }: CurrentLimitStepInput): TransactionStepsModel {
  const labels = approvalStep ? ['Approve', 'Create', 'Verify'] : ['Create', 'Verify'];
  const last = labels.length - 1;
  const done = verified ? labels.length : live === 'limit-snapshot' || created ? last :
    live === 'limit-create' ? last - 1 : live === 'limit-approval' ? 0 : approved && approvalStep ? 1 : 0;
  const started = verified || created || live !== null || approved && approvalStep;
  const outcome: StepsOutcome = verified ? 'complete' : started ? 'running' : 'idle';
  const steps = labels.map((label, index) => ({ label,
    state: (index < done ? 'done' : index === done && outcome === 'running' ? 'active' : 'next') as StepState }));
  const title = verified ? 'Order placed' : live === 'limit-snapshot' ? 'Verifying order' : created ? 'Order created' :
    live === 'limit-create' ? 'Creating order' : live === 'limit-approval' ? 'Approving amount' : approved && approvalStep ? 'Amount approved' :
      approvalStep ? 'Approve the amount, then create the order' : 'Create the order';
  const detail = live !== null ? 'Waiting for confirmation.' : created && !verified ? 'Refresh the private result to verify it.' :
    approved && approvalStep && !verified ? 'Review the order to create it.' : '';
  return { title, detail, outcome, steps };
}

export default function CurrentLimitSteps(props: CurrentLimitStepInput) {
  return <TransactionSteps label="Limit steps" className="current-limit-steps" model={currentLimitStepsModel(props)} />;
}
