import { getAddress, Interface } from '@coti-io/coti-ethers';
import {
  DIRECT_CHAT_V2_ABI,
  DIRECT_CHAT_V2_CREATE_SELECTOR,
  DIRECT_CHAT_V2_ROTATE_SELECTOR
} from '../../src/lib/directChatV2Chain';
import type { RealWalletPhase } from './promptEvidence';

const CHAT_INTERFACE = new Interface(DIRECT_CHAT_V2_ABI);
const SEND_SELECTOR = CHAT_INTERFACE.getFunction('sendMessage')?.selector.toLowerCase() ?? '';
const UINT64_MAX = (1n << 64n) - 1n;
const MAX_CHAT_TRANSACTION_GAS = 12_000_000n;
const TRANSACTION_KEYS = new Set(['data', 'from', 'gas', 'to', 'value']);

export type ChatTransactionPolicyContext = {
  account: string;
  contractAddress: string;
  conversation?: {
    epoch: bigint;
    id: string;
  };
  peer: string;
  phase: Extract<RealWalletPhase, 'warm-create' | 'warm-rotate' | 'warm-send'>;
};

const normalizeAddress = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Blocked wallet request with a missing address.');
  try {
    return getAddress(value).toLowerCase();
  } catch {
    throw new Error('Blocked wallet request with an invalid address.');
  }
};

const requireUint64 = (value: unknown, label: string): bigint => {
  let parsed: bigint;
  try {
    parsed = BigInt(value as bigint);
  } catch {
    throw new Error(`Blocked wallet request with an invalid ${label}.`);
  }
  if (parsed === 0n || parsed > UINT64_MAX) {
    throw new Error(`Blocked wallet request with an out-of-range ${label}.`);
  }
  return parsed;
};

const requireConversation = (
  context: ChatTransactionPolicyContext
): { epoch: bigint; id: string } => {
  const conversation = context.conversation;
  if (
    !conversation ||
    !/^0x[0-9a-fA-F]{64}$/.test(conversation.id) ||
    conversation.epoch <= 0n ||
    conversation.epoch > UINT64_MAX
  ) {
    throw new Error('Blocked wallet request without an attested conversation epoch.');
  }
  return { epoch: conversation.epoch, id: conversation.id.toLowerCase() };
};

const expectedSelectorForPhase = (
  phase: ChatTransactionPolicyContext['phase']
): string => {
  if (phase === 'warm-create') return DIRECT_CHAT_V2_CREATE_SELECTOR.toLowerCase();
  if (phase === 'warm-rotate') return DIRECT_CHAT_V2_ROTATE_SELECTOR.toLowerCase();
  return SEND_SELECTOR;
};

export const validateChatTransactionRequest = (
  params: object | unknown[] | undefined,
  context: ChatTransactionPolicyContext
): { selector: string; target: string } => {
  if (!Array.isArray(params) || params.length !== 1) {
    throw new Error('Blocked wallet request with malformed transaction parameters.');
  }
  const transaction = params[0];
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) {
    throw new Error('Blocked wallet request with malformed transaction data.');
  }
  const value = transaction as Record<string, unknown>;
  if (Object.keys(value).some((key) => !TRANSACTION_KEYS.has(key))) {
    throw new Error('Blocked wallet request containing unsafe transaction fields.');
  }
  if (normalizeAddress(value.from) !== normalizeAddress(context.account)) {
    throw new Error('Blocked wallet request from an unexpected account.');
  }
  const target = normalizeAddress(value.to);
  if (target !== normalizeAddress(context.contractAddress)) {
    throw new Error('Blocked wallet request to an unexpected contract.');
  }
  if (value.value !== undefined && value.value !== '0x0') {
    throw new Error('Blocked noncanonical or nonzero transaction value.');
  }
  if (value.gas !== undefined) {
    if (
      typeof value.gas !== 'string' ||
      !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value.gas) ||
      BigInt(value.gas) === 0n ||
      BigInt(value.gas) > MAX_CHAT_TRANSACTION_GAS
    ) {
      throw new Error('Blocked noncanonical or unsafe transaction gas limit.');
    }
  }
  if (typeof value.data !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value.data)) {
    throw new Error('Blocked wallet request with malformed calldata.');
  }

  const data = value.data.toLowerCase();
  const selector = data.slice(0, 10);
  if (selector !== expectedSelectorForPhase(context.phase)) {
    throw new Error('Blocked wallet request with an unexpected selector.');
  }
  const parsed = CHAT_INTERFACE.parseTransaction({ data });
  if (!parsed) throw new Error('Blocked wallet request with undecodable calldata.');
  const canonical = CHAT_INTERFACE.encodeFunctionData(parsed.fragment, parsed.args).toLowerCase();
  if (canonical !== data) {
    throw new Error('Blocked wallet request with noncanonical calldata.');
  }

  if (context.phase === 'warm-create') {
    if (
      parsed.name !== 'createConversation' ||
      normalizeAddress(parsed.args[0]) !== normalizeAddress(context.peer)
    ) {
      throw new Error('Blocked conversation creation for an unexpected peer.');
    }
  } else if (context.phase === 'warm-rotate') {
    const conversation = requireConversation(context);
    if (
      parsed.name !== 'rotateConversationKey' ||
      String(parsed.args[0]).toLowerCase() !== conversation.id ||
      requireUint64(parsed.args[1], 'rotation epoch') !== conversation.epoch
    ) {
      throw new Error('Blocked key rotation for an unexpected conversation or epoch.');
    }
  } else {
    const conversation = requireConversation(context);
    const epoch = requireUint64(parsed.args[1], 'message epoch');
    const senderSequence = requireUint64(parsed.args[2], 'sender sequence');
    const nonce = String(parsed.args[3]);
    const ciphertext = String(parsed.args[4]);
    let expectedFee: bigint;
    try {
      expectedFee = BigInt(parsed.args[5]);
    } catch {
      throw new Error('Blocked message with an invalid expected fee.');
    }
    const ciphertextBytes = /^0x(?:[0-9a-fA-F]{2})*$/.test(ciphertext)
      ? (ciphertext.length - 2) / 2
      : -1;
    if (
      parsed.name !== 'sendMessage' ||
      String(parsed.args[0]).toLowerCase() !== conversation.id ||
      epoch !== conversation.epoch ||
      senderSequence <= 0n ||
      !/^0x[0-9a-fA-F]{24}$/.test(nonce) ||
      ciphertextBytes < 16 ||
      ciphertextBytes > 4_096 ||
      expectedFee !== 0n
    ) {
      throw new Error('Blocked message transaction outside the attested zero-fee bounds.');
    }
  }

  return { selector, target };
};

export const DIRECT_CHAT_V2_SEND_SELECTOR = SEND_SELECTOR;
