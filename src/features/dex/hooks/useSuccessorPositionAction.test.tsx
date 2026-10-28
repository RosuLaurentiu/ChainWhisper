import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useSuccessorPositionAction, {
  successorPositionActionRevision,
  successorPositionTermsScope
} from './useSuccessorPositionAction';

const mocks = vi.hoisted(() => ({
  revealFixed: vi.fn(),
  revealOwner: vi.fn(),
  revealRange: vi.fn(),
  submitAction: vi.fn()
}));

vi.mock('../../../lib/appChain', () => ({
  revealSuccessorAggregateOrRecurringPositionTerms: mocks.revealOwner
}));

vi.mock('../../../lib/successorDexPositionActions', () => ({
  revealSuccessorFixedPositionTerms: mocks.revealFixed,
  revealSuccessorRangePositionTerms: mocks.revealRange,
  submitSuccessorPositionAction: mocks.submitAction,
  submitSuccessorPositionEdit: vi.fn(),
  submitSuccessorPositionTransfer: vi.fn()
}));

const manifest = { releaseIdentityHash: 'release-1' };
const runtime = { manifest, status: 'ready' } as never;
const owner = '0x1111111111111111111111111111111111111111';

const position = (family: 'Aggregate' | 'Recurring') => ({
  actionCount: 4,
  closed: false,
  family,
  initialized: true,
  kind: family === 'Aggregate' ? 1 : 4,
  marketKey: '0xmarket',
  owner,
  ownershipRevision: 3,
  pair: ['EMBR', 'ORBT'],
  paused: false,
  positionId: family === 'Aggregate' ? '41' : '42',
  recurringClass: family === 'Recurring' ? 'LL' : null,
  revision: 0,
  runCount: 2,
  transactionHash: null
} as const);

const renderAction = (walletAddress = owner) => {
  const signer = { id: 'privacy-signer' };
  const actions = {
    connectBrowserWallet: vi.fn(),
    getSigner: vi.fn(async () => signer),
    runWalletTransactionFlow: vi.fn(async (flow: () => Promise<unknown>) => flow())
  };
  let current: ReturnType<typeof useSuccessorPositionAction> | undefined;
  const Probe = () => {
    current = useSuccessorPositionAction({
      refresh: vi.fn(),
      runtime,
      sharedWalletSession: { actions, walletAddress } as never
    });
    return null;
  };
  renderToStaticMarkup(<Probe />);
  return { actions, current: current!, signer };
};

describe('successor owner-private position reveal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes Aggregate and Recurring through the shared owner-only reveal after privacy unlock', async () => {
    const aggregate = position('Aggregate');
    const recurring = position('Recurring');
    const aggregateTerms = { family: 'Aggregate', positionId: aggregate.positionId };
    const recurringTerms = { family: 'Recurring', positionId: recurring.positionId };
    mocks.revealOwner.mockResolvedValueOnce(aggregateTerms).mockResolvedValueOnce(recurringTerms);
    const { actions, current, signer } = renderAction();

    await expect(current.revealTerms(aggregate as never)).resolves.toBe(aggregateTerms);
    await expect(current.revealTerms(recurring as never)).resolves.toBe(recurringTerms);

    expect(actions.getSigner).toHaveBeenNthCalledWith(1, true);
    expect(actions.getSigner).toHaveBeenNthCalledWith(2, true);
    expect(mocks.revealOwner).toHaveBeenNthCalledWith(1, { manifest, position: aggregate, signer });
    expect(mocks.revealOwner).toHaveBeenNthCalledWith(2, { manifest, position: recurring, signer });
    expect(mocks.revealFixed).not.toHaveBeenCalled();
    expect(mocks.revealRange).not.toHaveBeenCalled();
  });

  it('uses the privately revealed revision for Aggregate and Recurring actions', async () => {
    const aggregate = position('Aggregate');
    const recurring = position('Recurring');
    const aggregateTerms = { family: 'Aggregate', positionId: aggregate.positionId, revision: 7 };
    const recurringTerms = { family: 'Recurring', positionId: recurring.positionId, revision: 9 };
    mocks.revealOwner.mockResolvedValueOnce(aggregateTerms).mockResolvedValueOnce(recurringTerms);
    mocks.submitAction
      .mockResolvedValueOnce({ transactionHash: '0xaggregate1234567890' })
      .mockResolvedValueOnce({ transactionHash: '0xrecurring1234567890' });
    const { current, signer } = renderAction();

    await current.revealTerms(aggregate as never);
    await current.execute(aggregate as never, aggregate as never, 'exit');
    await current.revealTerms(recurring as never);
    await current.execute(recurring as never, recurring as never, 'pause');

    expect(mocks.submitAction).toHaveBeenNthCalledWith(1, {
      action: 'exit',
      expectedOwnershipRevision: aggregate.ownershipRevision,
      expectedPositionRevision: aggregateTerms.revision,
      manifest,
      position: aggregate,
      signer
    });
    expect(mocks.submitAction).toHaveBeenNthCalledWith(2, {
      action: 'pause',
      expectedOwnershipRevision: recurring.ownershipRevision,
      expectedPositionRevision: recurringTerms.revision,
      manifest,
      position: recurring,
      signer
    });
  });

  it('does not fall back to public revision data for Aggregate or Recurring actions', async () => {
    const aggregate = { ...position('Aggregate'), revision: 41 };
    const recurring = { ...position('Recurring'), revision: 42 };
    const { actions, current } = renderAction();

    expect(successorPositionActionRevision({ position: aggregate, privateTerms: null, state: aggregate })).toBeNull();
    expect(successorPositionActionRevision({
      position: recurring,
      privateTerms: { family: 'Aggregate', positionId: aggregate.positionId, revision: 7 } as never,
      state: recurring
    })).toBeNull();
    await expect(current.execute(aggregate as never, aggregate as never, 'exit')).resolves.toBeNull();
    expect(actions.getSigner).not.toHaveBeenCalled();
    expect(actions.runWalletTransactionFlow).not.toHaveBeenCalled();
    expect(mocks.submitAction).not.toHaveBeenCalled();
  });

  it('keeps the public lifecycle revision for Fixed and Range actions', () => {
    expect(successorPositionActionRevision({
      position: { family: 'Fixed', positionId: '51' },
      privateTerms: null,
      state: { revision: 11 }
    })).toBe(11);
    expect(successorPositionActionRevision({
      position: { family: 'Range', positionId: '52' },
      privateTerms: null,
      state: { revision: 12 }
    })).toBe(12);
  });

  it('invalidates revealed-term scope when owner or public revision changes', () => {
    const current = { ...position('Aggregate'), revision: 7 };
    expect(successorPositionTermsScope({ ...current, revision: 8 }))
      .not.toBe(successorPositionTermsScope(current));
    expect(successorPositionTermsScope({ ...current, ownershipRevision: 4 }))
      .not.toBe(successorPositionTermsScope(current));
    expect(successorPositionTermsScope({ ...current, owner: '0x2222222222222222222222222222222222222222' }))
      .not.toBe(successorPositionTermsScope(current));
  });

  it('prepares privacy before it tries to reveal from a disconnected session', async () => {
    const { actions, current } = renderAction('');

    await expect(current.revealTerms(position('Aggregate') as never)).resolves.toBeNull();

    expect(actions.connectBrowserWallet).toHaveBeenCalledWith(undefined, { preparePrivacy: true });
    expect(actions.getSigner).not.toHaveBeenCalled();
    expect(actions.runWalletTransactionFlow).not.toHaveBeenCalled();
    expect(mocks.revealOwner).not.toHaveBeenCalled();
  });

  it('keeps private values out of the locked panel and enables all-family reveal', () => {
    const source = readFileSync(fileURLToPath(new URL('../components/SuccessorPositionsWorkspace.tsx', import.meta.url)), 'utf8');
    const lockedStart = source.indexOf('dex-v2-private-terms-locked');
    const lockedEnd = source.indexOf('</section>}', lockedStart);
    const lockedSource = source.slice(lockedStart, lockedEnd);

    expect(source).toContain('Owner-private Aggregate terms');
    expect(source).toContain('Owner-private Recurring {revealedRecurring.recurringClass} terms');
    expect(source).toContain('{!revealedTerms ? <button');
    expect(source.indexOf('revealedAggregate.principal0Lots')).toBeLessThan(lockedStart);
    expect(source.indexOf('revealedRecurring.startPrice0Q')).toBeLessThan(lockedStart);
    expect(lockedSource).toContain('hidden until the current owner unlocks privacy');
    expect(lockedSource).not.toMatch(/revealed(?:Aggregate|Recurring)|principal0Lots|startPrice0Q/u);
    expect(source).not.toContain('term views are not connected yet');
  });
});
