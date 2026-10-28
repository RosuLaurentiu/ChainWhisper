import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { selectSuccessorSwapLane } from './useSuccessorDexSwapAction';

const source = readFileSync(
  fileURLToPath(new URL('./useSuccessorDexSwapAction.ts', import.meta.url)),
  'utf8'
);

describe('successor Swap execution lanes', () => {
  it('routes only a genuinely sparse pair to P2', () => {
    expect(selectSuccessorSwapLane(0)).toBe('p2');
    expect(selectSuccessorSwapLane(1)).toBe('direct');
    expect(selectSuccessorSwapLane(8)).toBe('direct');
  });

  it('uses the corrected atomic P2 adapter and leaves keeper work outside the owner action', () => {
    expect(source).toContain('planSuccessorP2Intent');
    expect(source).toContain('submitSuccessorP2Intent');
    expect(source).toContain('readSuccessorP2Status');
    expect(source).toContain('nextSuccessorP2Action');
    expect(source).toContain('revealSuccessorP2Receipt');
    expect(source).toContain('withdrawSuccessorP2Credit');
    expect(source).toContain('withdrawSuccessorP2WorkCredit');
    expect(source).toContain('findResumableSuccessorP2');
    expect(source).toContain('reopenSuccessorP2Work');
    expect(source).toContain('recoverExpiredSuccessorP2');
    expect(source).toContain('cancelSuccessorP2Intent');
    expect(source).toContain("if (quote.lane === 'p2')");
    expect(source).toContain('window.setInterval');
    expect(source).toContain('pending.status.workStage === 0 || pending.status.workStage === 7');
    expect(source).toContain('A permissionless keeper is processing its fixed, privacy-padded work schedule.');
    expect(source).not.toContain('processSuccessorP2KeeperFrame');
    expect(source).not.toContain('Process the fixed work frames to settle it.');
    expect(source).not.toContain('owner-open-required');
  });

  it('persists the atomic receipt state before polling and exposes bounded recovery controls', () => {
    const submission = source.slice(
      source.indexOf("if (quote.lane === 'p2')"),
      source.indexOf('const submission = await submitSuccessorSwap')
    );
    expect(submission).toContain('status: submission.status');
    expect(submission).toContain('maximumKnown: true');
    expect(submission).not.toContain('await readSuccessorP2Status');
    expect(source).toContain('consecutiveFailures = Math.min(consecutiveFailures + 1, 3)');
    expect(source).toContain('On-chain status refresh failed three times.');
    expect(source).toContain("pendingAction === 'reopen'");
    expect(source).toContain("pendingAction === 'recover-intent'");
    expect(source).toContain('canCancelP2');
    expect(source).toContain('cancelP2');
  });

  it('discovers and resumes sparse P2 state after a reload', () => {
    const resume = source.slice(
      source.indexOf('const lane = selectSuccessorSwapLane(pair.sourceCount)'),
      source.indexOf('const pendingIdentity')
    );
    expect(resume).toContain("lane === 'p2'");
    expect(resume).toContain('findResumableSuccessorP2');
    expect(resume).toContain("kind: 'p2'");
    expect(resume).toContain('maximumKnown');
  });

  it('offers P2 only from a session-only authenticated exhausted-direct receipt', () => {
    expect(source).toContain("sourceCount === 0 ? 'p2' : 'direct'");
    expect(source).toContain('pending.maximumKnown');
    expect(source).toContain('pending.settled');
    expect(source).toContain('pending.progress.workClosed');
    expect(source).toContain('pending.receipt?.invalid');
    expect(source).toContain('pending.receipt.directUnavailable');
    expect(source).toContain('pending.receipt.refund > 0n');
    expect(source).toContain('!pending.inputCreditWithdrawn');
    expect(source).toContain('planSuccessorP2FallbackFromDirect');
    expect(source).toContain('Open P2 fallback - separate signature');
    expect(source).toContain('Existing direct Swap credit');
    expect(source).toContain('needs no new token allowance, and requires one separate owner signature');
    expect(source).not.toContain("pending.plan.pair.seedProfile === 'p2-exhausted'");
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
  });
});
