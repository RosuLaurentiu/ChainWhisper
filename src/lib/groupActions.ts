import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import {
  encodeStoredGroupTitle,
  GROUP_ADMIN_BURN_ADDRESS,
  GROUP_CHAT_CONTRACT_ABI,
  GROUP_CHAT_CONTRACT_ADDRESS,
  isWalletAddress,
  loadCotiEthersModule,
  toSafeNumber
} from './appShared';

type GroupSigner = Wallet | JsonRpcSigner;

const createGroupContract = async (runner: GroupSigner) => {
  const cotiEthers = await loadCotiEthersModule();
  return new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, runner);
};

const requireSignerAddress = async (signer: GroupSigner) => {
  const signerAddress = (await signer.getAddress()).trim();
  if (!isWalletAddress(signerAddress)) {
    throw new Error('Signer address is invalid.');
  }

  return signerAddress;
};

export const createGroupOnChain = async ({
  signer,
  title,
  isPrivate,
  initialMembers
}: {
  signer: GroupSigner;
  title: string;
  isPrivate: boolean;
  initialMembers: string[];
}) => {
  await requireSignerAddress(signer);
  const contract = await createGroupContract(signer);
  const encodedTitle = await encodeStoredGroupTitle(title, isPrivate);
  const tx = await contract.createGroup(encodedTitle, initialMembers);
  await tx.wait();
};

export const inviteMembersToGroupOnChain = async ({
  signer,
  groupId,
  accounts,
  ttlSeconds
}: {
  signer: GroupSigner;
  groupId: number;
  accounts: string[];
  ttlSeconds: number;
}) => {
  await requireSignerAddress(signer);
  const contract = await createGroupContract(signer);
  const inviteTtlMaxRaw = await contract.INVITE_TTL_MAX().catch(() => null);
  const inviteTtlMax = toSafeNumber(inviteTtlMaxRaw);
  if (inviteTtlMax > 0 && ttlSeconds > inviteTtlMax) {
    throw new Error(`Invite TTL exceeds on-chain max (${Math.floor(inviteTtlMax / 3600)}h).`);
  }

  const tx = await contract.inviteMembers(groupId, accounts, ttlSeconds);
  await tx.wait();
};

export const removeMemberFromGroupOnChain = async ({
  signer,
  groupId,
  account
}: {
  signer: GroupSigner;
  groupId: number;
  account: string;
}) => {
  const contract = await createGroupContract(signer);
  const tx = await contract.removeMember(groupId, account);
  await tx.wait();
};

export const renameGroupOnChain = async ({
  signer,
  groupId,
  title,
  isPrivate
}: {
  signer: GroupSigner;
  groupId: number;
  title: string;
  isPrivate: boolean;
}) => {
  const contract = await createGroupContract(signer);
  const encodedTitle = await encodeStoredGroupTitle(title, isPrivate);
  const tx = await contract.setGroupTitle(groupId, encodedTitle);
  await tx.wait();
};

export const leaveGroupOnChain = async ({
  signer,
  groupId
}: {
  signer: GroupSigner;
  groupId: number;
}) => {
  const contract = await createGroupContract(signer);
  const tx = await contract.leaveGroup(groupId);
  await tx.wait();
};

export const handoffAdminAndLeaveGroupOnChain = async ({
  signer,
  groupId
}: {
  signer: GroupSigner;
  groupId: number;
}) => {
  const contract = await createGroupContract(signer);
  const burnMember = await contract.isMember(groupId, GROUP_ADMIN_BURN_ADDRESS).catch(() => false);
  if (!burnMember) {
    const addTx = await contract.addMembers(groupId, [GROUP_ADMIN_BURN_ADDRESS]);
    await addTx.wait();
  }

  const transferTx = await contract.setGroupAdmin(groupId, GROUP_ADMIN_BURN_ADDRESS);
  await transferTx.wait();

  const leaveTx = await contract.leaveGroup(groupId);
  await leaveTx.wait();
};

export const disbandGroupOnChain = async ({
  signer,
  groupId
}: {
  signer: GroupSigner;
  groupId: number;
}) => {
  const contract = await createGroupContract(signer);
  const tx = await contract.disbandGroup(groupId);
  await tx.wait();
};

export const acceptGroupInviteOnChain = async ({
  signer,
  groupId
}: {
  signer: GroupSigner;
  groupId: number;
}) => {
  const contract = await createGroupContract(signer);
  const tx = await contract.acceptInvite(groupId);
  await tx.wait();
};

export const declineGroupInviteOnChain = async ({
  signer,
  groupId
}: {
  signer: GroupSigner;
  groupId: number;
}) => {
  const contract = await createGroupContract(signer);
  const tx = await contract.declineInvite(groupId);
  await tx.wait();
};
