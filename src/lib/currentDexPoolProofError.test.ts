import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CurrentPoolProofMismatch, currentPoolVerificationFailure, currentPoolVerificationFailures,
  isReviewableTopUpFailure } from './currentDexPoolProofError';

// CW-140.02: hold reasons are stored as fixed codes. A code comes from the error, or from the exact message.
const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return sourceFiles(path);
  return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== 'currentDexPoolProofError.ts' ? [path] : [];
});

describe('current Pool verification failure codes (CW-140.02)', () => {
  it('every mapped message is still raised somewhere in the App source', () => {
    const source = sourceFiles(join(__dirname, '..')).map(file => readFileSync(file, 'utf8')).join('\n');
    const missing = Object.entries(currentPoolVerificationFailures)
      .filter(([code, message]) => code !== 'pool-proof' && !source.includes(message)).map(([code]) => code);
    expect(missing).toEqual([]);
  });
  it('prefers a fixed code on the error and maps exact messages', () => {
    const coded = Object.assign(new CurrentPoolProofMismatch('Reworded check text.'), { poolVerificationCode: 'snapshot-shares' });
    expect(currentPoolVerificationFailure(coded)).toBe('snapshot-shares');
    expect(currentPoolVerificationFailure(new Error(currentPoolVerificationFailures['top-up-accounting']))).toBe('top-up-accounting');
    expect(currentPoolVerificationFailure(new Error('Unknown text.'))).toBe('pool-proof');
    expect(currentPoolVerificationFailure(Object.assign(new Error('x'), { poolVerificationCode: 'not-a-code' }))).toBe('pool-proof');
  });
  it('allows the reviewed top-up release only for its two reasons', () => {
    expect(isReviewableTopUpFailure('pool-proof')).toBe(true);
    expect(isReviewableTopUpFailure('snapshot-financial-state')).toBe(true);
    for (const code of Object.keys(currentPoolVerificationFailures).filter(c => !['pool-proof', 'snapshot-financial-state'].includes(c)))
      expect(isReviewableTopUpFailure(code)).toBe(false);
    expect(isReviewableTopUpFailure(undefined)).toBe(false);
  });
});
