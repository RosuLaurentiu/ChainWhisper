import { Interface } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import { DIRECT_CHAT_V2_ABI } from '../../src/lib/directChatV2Chain';
import { validateChatTransactionRequest } from './transactionPolicy';

const CHAT_INTERFACE = new Interface(DIRECT_CHAT_V2_ABI);
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const PEER = '0x2222222222222222222222222222222222222222';
const CONTRACT = '0x3333333333333333333333333333333333333333';
const CONVERSATION = `0x${'44'.repeat(32)}`;

const transaction = (data: string, extra: Record<string, unknown> = {}) => [
  { data, from: ACCOUNT, to: CONTRACT, value: '0x0', ...extra }
];

describe('real-wallet transaction policy', () => {
  it('accepts only canonical zero-value creation for the configured peer', () => {
    const data = CHAT_INTERFACE.encodeFunctionData('createConversation', [PEER]);
    expect(
      validateChatTransactionRequest(transaction(data), {
        account: ACCOUNT,
        contractAddress: CONTRACT,
        peer: PEER,
        phase: 'warm-create'
      })
    ).toMatchObject({ target: CONTRACT.toLowerCase() });

    const wrongPeer = CHAT_INTERFACE.encodeFunctionData('createConversation', [ACCOUNT]);
    expect(() =>
      validateChatTransactionRequest(transaction(wrongPeer), {
        account: ACCOUNT,
        contractAddress: CONTRACT,
        peer: PEER,
        phase: 'warm-create'
      })
    ).toThrow(/peer/i);
  });

  it('rejects noncanonical values and unsafe gas or fee fields', () => {
    const data = CHAT_INTERFACE.encodeFunctionData('createConversation', [PEER]);
    const context = {
      account: ACCOUNT,
      contractAddress: CONTRACT,
      peer: PEER,
      phase: 'warm-create' as const
    };
    for (const extra of [
      { value: 0 },
      { value: '0x00' },
      { value: '0x1' },
      { gas: '0x00' },
      { gas: '0xBEEF' },
      { gas: '0xb71b01' },
      { gasPrice: '0x1' },
      { maxFeePerGas: '0x1' }
    ]) {
      expect(() => validateChatTransactionRequest(transaction(data, extra), context)).toThrow();
    }
    expect(() =>
      validateChatTransactionRequest(transaction(data, { gas: '0xb71b00' }), context)
    ).not.toThrow();
  });

  it('binds rotation to the recovered conversation and current epoch', () => {
    const data = CHAT_INTERFACE.encodeFunctionData('rotateConversationKey', [CONVERSATION, 2n]);
    const context = {
      account: ACCOUNT,
      contractAddress: CONTRACT,
      conversation: { epoch: 2n, id: CONVERSATION },
      peer: PEER,
      phase: 'warm-rotate' as const
    };
    expect(() => validateChatTransactionRequest(transaction(data), context)).not.toThrow();

    const stale = CHAT_INTERFACE.encodeFunctionData('rotateConversationKey', [CONVERSATION, 1n]);
    expect(() => validateChatTransactionRequest(transaction(stale), context)).toThrow(/epoch/i);
  });

  it('binds messages to the conversation, epoch, bounds, and zero expected fee', () => {
    const context = {
      account: ACCOUNT,
      contractAddress: CONTRACT,
      conversation: { epoch: 2n, id: CONVERSATION },
      peer: PEER,
      phase: 'warm-send' as const
    };
    const encode = ({
      ciphertext = `0x${'ab'.repeat(16)}`,
      conversation = CONVERSATION,
      epoch = 2n,
      fee = 0n,
      sequence = 1n
    }: {
      ciphertext?: string;
      conversation?: string;
      epoch?: bigint;
      fee?: bigint;
      sequence?: bigint;
    } = {}) =>
      CHAT_INTERFACE.encodeFunctionData('sendMessage', [
        conversation,
        epoch,
        sequence,
        `0x${'12'.repeat(12)}`,
        ciphertext,
        fee
      ]);

    expect(() => validateChatTransactionRequest(transaction(encode()), context)).not.toThrow();
    expect(() => validateChatTransactionRequest(transaction(encode({ epoch: 3n })), context)).toThrow();
    expect(() => validateChatTransactionRequest(transaction(encode({ sequence: 0n })), context)).toThrow();
    expect(() => validateChatTransactionRequest(transaction(encode({ fee: 1n })), context)).toThrow();
    expect(() =>
      validateChatTransactionRequest(transaction(`${encode()}00`), context)
    ).toThrow(/noncanonical/i);
    expect(() =>
      validateChatTransactionRequest(
        transaction(encode({ ciphertext: `0x${'ab'.repeat(4_097)}` })),
        context
      )
    ).toThrow(/bounds/i);
  });
});
