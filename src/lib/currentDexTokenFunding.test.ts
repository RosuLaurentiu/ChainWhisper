import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createCurrentTokenFundingAdapter, CURRENT_TOKEN_FUNDING_CAP } from './currentDexTokenFunding';

const owner = `0x${'22'.repeat(20)}`;
describe('current-token finite funding', () => {
  it('refuses the earlier token-funding adapter for the current candidate tokens', () => {
    expect(() => createCurrentTokenFundingAdapter({ candidate: 'cheap-history', signer: {}, ownerAddress: owner, chainId: 7082400n } as never))
      .toThrow('Current-token runtime has no funding evidence.');
  });
  it('binds the native approval profile to the accepted current-candidate recovery journal', () => {
    const raw = readFileSync(new URL('../../../ChainWhisper Contracts V2/validation/candidates/next-dex-funded-recovery-2026-10-04/native-2.jsonl', import.meta.url));
    expect(createHash('sha256').update(raw).digest('hex')).toBe('00bc2c7a58235bb9a12981305fd2ad036e3bdd53ced58cccdf1491802fa15b5e');
    const rows = raw.toString().trim().split(/\r?\n/).map(line => JSON.parse(line)).filter(r => r.name === 'approve');
    expect(rows.map(r => r.kind)).toEqual(['signing-start', 'signed', 'broadcast', 'verified']);
    expect(rows[0]).toMatchObject({gasLimit: '5000000', gasPriceWei: '50000000', manifestHash: 'ebfc7e4dac90d2e4da9d3bd6a5d594b20109b624c4febac985cfb23ae8a381fc'});
    expect(rows[2].hash).toBe('0xe0bd3144f46df2bd789dfaae5ef6ba4c394c6ae7338b33c11428a72e5662ccc3');
  });
  it('uses a sub-block diagnostic cap, not unlimited approval', () => expect(CURRENT_TOKEN_FUNDING_CAP).toBe(5_000_000n));
});
