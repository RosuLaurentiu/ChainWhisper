import { describe, expect, it } from 'vitest';
import { getGeneratedGroupJoinCodeForContext, type GeneratedGroupJoinCode } from './groupUiStore';

const generatedCode: GeneratedGroupJoinCode = {
  groupId: 7,
  walletKey: '0xabc',
  inviteCode: `7:${'A'.repeat(26)}`,
  codeHash: `0x${'1'.repeat(64)}`
};

describe('generated group join-code scoping', () => {
  it('exposes a generated capability only in its originating group and wallet context', () => {
    expect(getGeneratedGroupJoinCodeForContext(generatedCode, 7, '0xAbC')).toBe(generatedCode);
    expect(getGeneratedGroupJoinCodeForContext(generatedCode, 8, '0xabc')).toBeNull();
    expect(getGeneratedGroupJoinCodeForContext(generatedCode, 7, '0xdef')).toBeNull();
    expect(getGeneratedGroupJoinCodeForContext(null, 7, '0xabc')).toBeNull();
  });
});
