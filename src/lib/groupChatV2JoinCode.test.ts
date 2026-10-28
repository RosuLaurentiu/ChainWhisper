import { describe, expect, it } from 'vitest';
import { getBytes, verifyMessage } from '@coti-io/coti-ethers';
import {
  createGroupChatV2JoinCodeMaterial,
  encodeGroupChatV2JoinInvite,
  parseGroupChatV2JoinCodeUses,
  readGroupChatV2JoinCodeMaterial,
  signGroupChatV2JoinProof
} from './groupChatV2JoinCode';
import { parseGroupInviteCode } from './appShared';

describe('groupChatV2JoinCode', () => {
  it('derives a stable code hash and proof signer without another wallet signature', async () => {
    const created = createGroupChatV2JoinCodeMaterial();
    expect(readGroupChatV2JoinCodeMaterial(created.code)).toEqual(created);
    const digest = `0x${'11'.repeat(32)}`;
    expect(verifyMessage(getBytes(digest), await signGroupChatV2JoinProof(created.code, digest)))
      .toBe(created.proofSigner);
  });

  it('encodes the existing share payload and bounds multi-use input', () => {
    const material = createGroupChatV2JoinCodeMaterial();
    expect(parseGroupInviteCode(encodeGroupChatV2JoinInvite({
      groupId: 4,
      code: material.code,
      expiresAt: 2_000
    }))).toMatchObject({ version: 2, groupId: 4, code: material.code });
    expect(parseGroupChatV2JoinCodeUses('single', '')).toBe(1n);
    expect(parseGroupChatV2JoinCodeUses('multi', '10')).toBe(10n);
    expect(() => parseGroupChatV2JoinCodeUses('multi', '1')).toThrow('2–1000000');
  });
});
