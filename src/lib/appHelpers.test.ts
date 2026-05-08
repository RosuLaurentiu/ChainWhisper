import { describe, expect, it } from 'vitest';
import {
  buildMessageReferenceKeys,
  getOnChainFailureMessage,
  getVerifiedEcosystemToken,
  isVerifiedEcosystemToken,
  messageReferencesMatch,
  privateTokenBalanceStateNeedsPrivacyAction,
  resolvePrivateTokenBalancePrivacyAction,
  sanitizeOutgoingMessagePlainText
} from './appHelpers';
import {
  buildMessageWithReactionPayload,
  buildMessageWithReplyPayload,
  decodeMemoPlaintextStrict,
  encodeCompactMemoPlaintext,
  encodeMemoPlaintext,
  parseChatMessagePayload
} from './appShared';

describe('message reference helpers', () => {
  it('matches shared tx references with case-sensitive base64url prefixes', () => {
    const txHash = `0x12345678${'0'.repeat(56)}`;
    const blockNumber = 12345;
    const logIndex = 7;

    const targetKeys = buildMessageReferenceKeys({ txHash, blockNumber, logIndex });
    expect(targetKeys).toContain('s:x9ix-EjRWeA');

    expect(
      messageReferencesMatch(
        { txHash: 'x9ix-EjRWeA', blockNumber },
        { txHash, blockNumber, logIndex }
      )
    ).toBe(true);
  });

  it('round-trips group reaction targets using shared tx references', () => {
    const txHash = `0x12345678${'0'.repeat(56)}`;
    const blockNumber = 12345;
    const logIndex = 7;
    const payload = buildMessageWithReactionPayload(txHash, '👍', '', blockNumber, logIndex, true);
    const parsed = parseChatMessagePayload(payload);

    expect(parsed.cleanText).toBe('');
    expect(parsed.embeddedReaction?.emoji).toBe('👍');
    expect(
      messageReferencesMatch(
        {
          txHash: parsed.embeddedReaction?.targetTxHash,
          blockNumber: parsed.embeddedReaction?.targetBlockNumber,
          logIndex: parsed.embeddedReaction?.targetLogIndex
        },
        { txHash, blockNumber, logIndex }
      )
    ).toBe(true);
  });

  it('preserves user-authored message line breaks', () => {
    const plain = 'first line\nsecond line';
    const payload = buildMessageWithReplyPayload(plain);

    expect(sanitizeOutgoingMessagePlainText(plain)).toBe(plain);
    expect(parseChatMessagePayload(payload).cleanText).toBe(plain);
  });
});

describe('memo plaintext decoding', () => {
  it('accepts encoded ChainWhisper memos', () => {
    const plain = 'hello private chat';

    expect(decodeMemoPlaintextStrict(encodeMemoPlaintext(plain))).toBe(plain);
  });

  it('accepts compact compressed ChainWhisper memos', () => {
    const plain = 'private history '.repeat(80);

    expect(decodeMemoPlaintextStrict(encodeCompactMemoPlaintext(plain))).toBe(plain);
  });

  it('rejects wrong-key decoder output with replacement/control characters', () => {
    expect(decodeMemoPlaintextStrict('2&#\uFFFD~kh\u0004random')).toBeNull();
  });
});

describe('verified ecosystem tokens', () => {
  it('includes the active pWISP private token', () => {
    const address = '0x682e3142e62a7aDe2a0CA5bdC87b205CaDe4B17a';

    expect(isVerifiedEcosystemToken(address)).toBe(true);
    expect(getVerifiedEcosystemToken(address.toUpperCase())).toEqual({
      address,
      kind: 'private-erc20'
    });
  });

  it('does not include the retired test private token', () => {
    expect(isVerifiedEcosystemToken('0x23f0AE74466Fd0fc1d32bB947ebB8Cd553BECdA0')).toBe(false);
  });

  it('includes HOTDOG as an approved private ecosystem token', () => {
    const address = '0x5085Ea0611A9C49316972C57390ca25C9CF236AB';

    expect(isVerifiedEcosystemToken(address)).toBe(true);
    expect(getVerifiedEcosystemToken(address.toUpperCase())).toEqual({
      address,
      kind: 'private-erc20'
    });
  });
});

describe('trade on-chain error messages', () => {
  it('maps recurring private-token transfer failures to a useful message', () => {
    expect(getOnChainFailureMessage({ data: '0x90b8ec18' }, 'fallback')).toBe(
      'Private token transfer failed. Check balance, privacy unlock, and approval.'
    );
  });
});

describe('privateTokenBalanceStateNeedsPrivacyAction', () => {
  it('only asks for an explicit privacy action when current private-token balances need setup or repair', () => {
    expect(privateTokenBalanceStateNeedsPrivacyAction({ status: 'setup-needed' })).toBe(true);
    expect(privateTokenBalanceStateNeedsPrivacyAction({ status: 'decrypt-failed' })).toBe(true);
    expect(privateTokenBalanceStateNeedsPrivacyAction({ status: 'snap-stale' })).toBe(true);
    expect(privateTokenBalanceStateNeedsPrivacyAction({ status: 'ready', balanceWei: 1n })).toBe(false);
    expect(privateTokenBalanceStateNeedsPrivacyAction({ status: 'locked' })).toBe(false);
    expect(privateTokenBalanceStateNeedsPrivacyAction({ status: 'unsupported' })).toBe(false);
  });

  it('distinguishes token setup from privacy-key repair', () => {
    expect(resolvePrivateTokenBalancePrivacyAction({ status: 'setup-needed' })).toBe('setup');
    expect(resolvePrivateTokenBalancePrivacyAction({ status: 'decrypt-failed' })).toBe('repair');
    expect(resolvePrivateTokenBalancePrivacyAction({ status: 'snap-stale' })).toBe('repair');
    expect(resolvePrivateTokenBalancePrivacyAction({ status: 'ready', balanceWei: 1n })).toBe('none');
  });
});
