import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import {
  buildMessageWithContactNamePayload,
  buildMessageWithConversationStatePayload,
  CHAT_CONTRACT_ABI,
  CHAT_CONTRACT_ADDRESS,
  isWalletAddress,
  MAX_MESSAGE_LENGTH,
  loadCotiEthersModule,
  normalizeContactName,
  normalizeConversationPreferenceState,
  parseSubmitMemoPayload,
  type ConversationPreferenceState
} from './appShared';

type DirectSigner = Wallet | JsonRpcSigner;

type SubmitDirectMemoArgs = {
  signer: DirectSigner;
  contactAddress: string;
  plainText: string;
  selector: string;
  requiredFee: bigint;
  encodeMemo: (plain: string) => string;
};

type SubmitHiddenContactNameArgs = {
  signer: DirectSigner;
  contactAddress: string;
  contactName: string;
  selector: string;
  requiredFee: bigint;
  encodeMemo: (plain: string) => string;
};

type SubmitHiddenConversationStateArgs = {
  signer: DirectSigner;
  contactAddress: string;
  state: ConversationPreferenceState;
  visibleNotice?: string;
  selector: string;
  requiredFee: bigint;
  encodeMemo: (plain: string) => string;
};

export const submitDirectMemo = async ({
  signer,
  contactAddress,
  plainText,
  selector,
  requiredFee,
  encodeMemo
}: SubmitDirectMemoArgs): Promise<{ txHash: string; wait: () => Promise<unknown> }> => {
  const normalizedAddress = contactAddress.trim();
  if (!isWalletAddress(normalizedAddress)) {
    throw new Error('Invalid contact address.');
  }

  const cotiEthers = await loadCotiEthersModule();
  const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, signer);
  const encodedMemo = encodeMemo(plainText);
  const encryptedMemo = await signer.encryptValue(encodedMemo, CHAT_CONTRACT_ADDRESS, selector);
  const submitMemoPayload = parseSubmitMemoPayload(encryptedMemo);
  const memoTuple = [[submitMemoPayload.ciphertextValue], submitMemoPayload.signature] as const;
  const tx = await contract.submit(normalizedAddress, memoTuple, { value: requiredFee });
  const waitableTx = tx as { hash?: unknown; wait?: () => Promise<unknown> };
  const wait =
    typeof waitableTx.wait === 'function'
      ? waitableTx.wait.bind(waitableTx)
      : async () => undefined;

  return {
    txHash: typeof waitableTx.hash === 'string' ? waitableTx.hash : '',
    wait
  };
};

export const submitHiddenContactNameMemo = async ({
  signer,
  contactAddress,
  contactName,
  selector,
  requiredFee,
  encodeMemo
}: SubmitHiddenContactNameArgs): Promise<{ txHash: string; wait: () => Promise<unknown> }> => {
  const normalizedContactName = normalizeContactName(contactName)?.slice(0, 42);
  if (!normalizedContactName) {
    throw new Error('Contact name cannot be empty.');
  }

  return submitDirectMemo({
    signer,
    contactAddress,
    plainText: buildMessageWithContactNamePayload('', normalizedContactName),
    selector,
    requiredFee,
    encodeMemo
  });
};

export const submitHiddenConversationStateMemo = async ({
  signer,
  contactAddress,
  state,
  visibleNotice = '',
  selector,
  requiredFee,
  encodeMemo
}: SubmitHiddenConversationStateArgs): Promise<{ txHash: string; wait: () => Promise<unknown> }> => {
  const normalizedState = normalizeConversationPreferenceState(state);
  if (!normalizedState) {
    throw new Error('Conversation state is empty.');
  }

  const normalizedVisibleNotice = visibleNotice.replace(/\r?\n/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);
  return submitDirectMemo({
    signer,
    contactAddress,
    plainText: buildMessageWithConversationStatePayload(normalizedVisibleNotice, normalizedState),
    selector,
    requiredFee,
    encodeMemo
  });
};
