import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CurrentLimitSteps, { currentLimitStepsModel, type CurrentLimitStepInput } from './CurrentLimitSteps';

const base: CurrentLimitStepInput = { approvalStep: true, live: null, approved: false, created: false, verified: false };
const states = (input: Partial<CurrentLimitStepInput>) => currentLimitStepsModel({ ...base, ...input }).steps.map(step => `${step.label}:${step.state}`);

describe('Limit step track (CW-140.08)', () => {
  it('follows approval, creation and private verification', () => {
    expect(states({})).toEqual(['Approve:next', 'Create:next', 'Verify:next']);
    expect(states({ live: 'limit-approval' })).toEqual(['Approve:active', 'Create:next', 'Verify:next']);
    expect(states({ approved: true })).toEqual(['Approve:done', 'Create:active', 'Verify:next']);
    expect(states({ live: 'limit-create' })).toEqual(['Approve:done', 'Create:active', 'Verify:next']);
    expect(states({ created: true })).toEqual(['Approve:done', 'Create:done', 'Verify:active']);
    expect(states({ created: true, live: 'limit-snapshot' })).toEqual(['Approve:done', 'Create:done', 'Verify:active']);
    expect(states({ verified: true })).toEqual(['Approve:done', 'Create:done', 'Verify:done']);
    expect(currentLimitStepsModel({ ...base, verified: true }).outcome).toBe('complete');
    expect(currentLimitStepsModel(base).outcome).toBe('idle');
  });
  it('has no approval step for a candidate without the separate allowance', () => {
    expect(states({ approvalStep: false })).toEqual(['Create:next', 'Verify:next']);
    expect(states({ approvalStep: false, approved: true })).toEqual(['Create:next', 'Verify:next']);
    expect(states({ approvalStep: false, live: 'limit-create' })).toEqual(['Create:active', 'Verify:next']);
  });
  it('states the next action in plain words', () => {
    expect(currentLimitStepsModel({ ...base, created: true })).toMatchObject({ title: 'Order created', detail: 'Refresh the private result to verify it.' });
    expect(renderToStaticMarkup(<CurrentLimitSteps {...base} />)).toContain('aria-label="Limit steps"');
  });
});
