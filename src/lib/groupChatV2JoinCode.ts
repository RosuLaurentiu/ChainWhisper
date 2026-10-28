import { Wallet, getBytes, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import {
  GROUP_JOIN_CODE_LENGTH,
  GROUP_JOIN_CODE_SIGNER_KEY_PREFIX,
  encodeGroupInviteCode,
  generateRandomGroupJoinCode,
  normalizeGroupJoinCode,
  type GroupJoinCodePayload
} from './appShared';

export const GROUP_CHAT_V2_JOIN_CODE_TTL_MAX_SECONDS = 365 * 24 * 60 * 60;
export const GROUP_CHAT_V2_JOIN_CODE_MAX_USES = 1_000_000;

export type GroupChatV2JoinCodeMaterial = Readonly<{
  code: string;
  codeHash: string;
  proofSigner: string;
}>;

const normalizedCode = (value: string): string => {
  const code = normalizeGroupJoinCode(value, { allowLegacy: false });
  if (!code || code.length !== GROUP_JOIN_CODE_LENGTH) {
    throw new Error('Group Chat V2 join code is invalid.');
  }
  return code;
};

const proofWallet = (code: string): Wallet => new Wallet(keccak256(toUtf8Bytes(
  `${GROUP_JOIN_CODE_SIGNER_KEY_PREFIX}${normalizedCode(code)}`
)));

export const createGroupChatV2JoinCodeMaterial = (): GroupChatV2JoinCodeMaterial => {
  const code = normalizedCode(generateRandomGroupJoinCode());
  return Object.freeze({
    code,
    codeHash: keccak256(toUtf8Bytes(code)).toLowerCase(),
    proofSigner: proofWallet(code).address
  });
};

export const readGroupChatV2JoinCodeMaterial = (code: string): GroupChatV2JoinCodeMaterial => {
  const normalized = normalizedCode(code);
  return Object.freeze({
    code: normalized,
    codeHash: keccak256(toUtf8Bytes(normalized)).toLowerCase(),
    proofSigner: proofWallet(normalized).address
  });
};

export const signGroupChatV2JoinProof = (code: string, digest: string): Promise<string> =>
  proofWallet(code).signMessage(getBytes(digest));

export const encodeGroupChatV2JoinInvite = ({
  groupId,
  code,
  expiresAt,
  inviter
}: {
  groupId: number;
  code: string;
  expiresAt: number;
  inviter?: string;
}): string => encodeGroupInviteCode({
  version: 2,
  groupId,
  code: normalizedCode(code),
  expiresAt,
  ...(inviter ? { inviter } : {})
} satisfies GroupJoinCodePayload);

export const parseGroupChatV2JoinCodeUses = (
  mode: 'single' | 'multi',
  input: string
): bigint => {
  if (mode === 'single') return 1n;
  const uses = Number(input);
  if (!Number.isSafeInteger(uses) || uses < 2 || uses > GROUP_CHAT_V2_JOIN_CODE_MAX_USES) {
    throw new Error(`Multi-use codes require 2–${GROUP_CHAT_V2_JOIN_CODE_MAX_USES} uses.`);
  }
  return BigInt(uses);
};
