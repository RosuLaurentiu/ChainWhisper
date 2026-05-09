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
import {
  CHAT_GC_MAX_CHUNKS_PER_MESSAGE,
  CHAT_GC_MAX_SINGLE_MESSAGE_CELLS,
  encryptedInputToSubmitMemoTuple,
  isLikelySingleSubmitSizeError,
  splitUtf8SafeChunks,
  submitMemoPayloadToTuple
} from './chatGc';

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
  const contractInterface = new cotiEthers.Interface(CHAT_CONTRACT_ABI);
  const multipartSelector = contractInterface.getFunction('submitMultipart')?.selector;
  if (!multipartSelector) {
    throw new Error('Chat multipart selector is unavailable.');
  }

  const sendTransaction = async (): Promise<unknown> => {
    try {
      const encodedMemo = encodeMemo(plainText);
      const encryptedMemo = await signer.encryptValue(encodedMemo, CHAT_CONTRACT_ADDRESS, selector);
      const submitMemoPayload = parseSubmitMemoPayload(encryptedMemo);
      if (submitMemoPayload.ciphertextValue.length <= CHAT_GC_MAX_SINGLE_MESSAGE_CELLS) {
        try {
          return await contract.submit(normalizedAddress, submitMemoPayloadToTuple(submitMemoPayload), { value: requiredFee });
        } catch (submitError) {
          if (!isLikelySingleSubmitSizeError(submitError)) {
            throw submitError;
          }
        }
      }
    } catch (singleSubmitError) {
      if (!isLikelySingleSubmitSizeError(singleSubmitError)) {
        throw singleSubmitError;
      }
    }

    const chunks = splitUtf8SafeChunks(plainText);
    if (chunks.length > CHAT_GC_MAX_CHUNKS_PER_MESSAGE) {
      throw new Error('Message is too long for private chat. Try a shorter message or smaller attachment.');
    }

    const encryptedChunks = await Promise.all(
      chunks.map(async (chunk) => {
        const encryptedChunk = await signer.encryptValue(encodeMemo(chunk), CHAT_CONTRACT_ADDRESS, multipartSelector);
        return encryptedInputToSubmitMemoTuple(encryptedChunk);
      })
    );

    return contract.submitMultipart(normalizedAddress, encryptedChunks, { value: requiredFee });
  };

  const tx = await sendTransaction();
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
