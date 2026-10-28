import { zlibSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { unzlibBounded } from './appShared/boundedCompression';
import {
  VERIFIED_ECOSYSTEM_TOKENS,
  buildChainWhisperTestnetCandidateTradeTokens,
  buildMessageReferenceKeys,
  getOnChainFailureMessage,
  getVerifiedEcosystemToken,
  isVerifiedEcosystemToken,
  messageReferencesMatch,
  privateTokenBalanceStateNeedsPrivacyAction,
  resolvePrivateTokenBalancePrivacyAction,
  sanitizeOutgoingMessagePlainText
} from './appHelpers';
import type { TestnetCandidateConfig } from './chainWhisperTestnetCandidate';
import {
  buildMessageWithReactionPayload,
  buildMessageWithReplyPayload,
  buildMessageWithTradeReferencePayload,
  buildStateBackupText,
  bytesToBase64,
  decodeMemoPlaintextStrict,
  decryptMemoWithCellLimit,
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  encodeCompactMemoPlaintext,
  encodeMemoPlaintext,
  LEGACY_TRADE_REFERENCE_METADATA_PREFIX,
  MAX_CHAT_MEMO_CIPHERTEXT_CELLS,
  MAX_CHAT_MEMO_PLAINTEXT_BYTES,
  MAX_MESSAGE_LENGTH,
  MAX_STATE_BACKUP_PLAINTEXT_BYTES,
  parseChatMessagePayload,
  parseStateBackupText,
  RECURRING_OTC_CONTRACT_ADDRESS,
  STATE_BACKUP_COMPRESSED_PREFIX,
  STATE_BACKUP_PREFIX,
  TRADE_REFERENCE_METADATA_PREFIX
} from './appShared';
import { encodeTradeLink } from './tradeLinks';

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

  it('matches ChatGC scoped message IDs without relying on raw numeric IDs', () => {
    const scopedId = 'chatgc:2632500:0xe5101d33986c91565d2c9f8b49aaf0b8ffee2243:42';

    expect(buildMessageReferenceKeys({ txHash: scopedId })).toEqual([`m:${scopedId}`]);
    expect(messageReferencesMatch({ txHash: scopedId }, { txHash: scopedId.toUpperCase() })).toBe(true);
  });

  it('preserves user-authored message line breaks', () => {
    const plain = 'first line\nsecond line';
    const payload = buildMessageWithReplyPayload(plain);

    expect(sanitizeOutgoingMessagePlainText(plain)).toBe(plain);
    expect(parseChatMessagePayload(payload).cleanText).toBe(plain);
  });

  it('round-trips trade references alongside reply metadata', () => {
    const terminalPath = `/otc/order/link/${encodeTradeLink(42)}?escrow=direct`;
    const replyPayload = buildMessageWithReplyPayload(
      'I can do that size.',
      'Can you fill this?',
      `0x${'12'.repeat(32)}`,
      12345,
      7
    );
    const payload = buildMessageWithTradeReferencePayload(replyPayload, {
      version: 1,
      tradeId: 42,
      escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
      terminalPath
    });
    const parsed = parseChatMessagePayload(payload);

    expect(payload).toContain('16:d');
    expect(payload).toContain(TRADE_REFERENCE_METADATA_PREFIX);
    expect(payload).not.toContain(LEGACY_TRADE_REFERENCE_METADATA_PREFIX);
    expect(payload).not.toContain(terminalPath);
    expect(payload).not.toContain('terminalPath');
    expect(payload).not.toContain('summary');
    expect(parsed.cleanText).toBe('I can do that size.');
    expect(parsed.replyToText).toBe('Can you fill this?');
    expect(parsed.tradeReference).toMatchObject({
      tradeId: 42,
      terminalPath
    });
    expect(decodeMemoPlaintextStrict(encodeCompactMemoPlaintext(payload))).toBe(payload);
  });

  it('does not embed external trade reference paths', () => {
    const payload = buildMessageWithTradeReferencePayload('hello', {
      version: 1,
      tradeId: 42,
      escrowContract: '0x1111111111111111111111111111111111111111',
      terminalPath: 'https://evil.example/otc/order/42'
    });

    expect(payload).not.toContain('evil.example');
    expect(parseChatMessagePayload(payload).tradeReference).toMatchObject({
      tradeId: 42
    });
  });

  it('strips old path-only trade references without showing the path as text', () => {
    const payload = `${LEGACY_TRADE_REFERENCE_METADATA_PREFIX}/otcdesk/terminal/recurring?order=5${LEGACY_TRADE_REFERENCE_METADATA_PREFIX}would you trade at 0.25?`;
    const parsed = parseChatMessagePayload(payload);

    expect(parsed.cleanText).toBe('would you trade at 0.25?');
    expect(parsed.tradeReference).toMatchObject({
      tradeId: 5,
      escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
      terminalPath: '/otc/order/recurring/5'
    });
  });
});

describe('memo plaintext decoding', () => {
  it('enforces the decompressed byte limit exactly and rejects malformed streams', () => {
    const exactPlaintext = new TextEncoder().encode('A'.repeat(4096));
    const compressed = zlibSync(exactPlaintext, { level: 9 });

    expect(unzlibBounded(compressed, exactPlaintext.length)).toEqual(exactPlaintext);
    expect(() => unzlibBounded(compressed, exactPlaintext.length - 1)).toThrow(
      'Compressed payload exceeds the 4095-byte output limit.'
    );
    expect(() => unzlibBounded(new Uint8Array([1, 2, 3, 4]), 4096)).toThrow();
    expect(() => unzlibBounded(compressed.subarray(0, compressed.length - 5), 4096)).toThrow();
  });

  it('accepts encoded ChainWhisper memos', () => {
    const plain = 'hello private chat';

    expect(decodeMemoPlaintextStrict(encodeMemoPlaintext(plain))).toBe(plain);
  });

  it('accepts compact compressed ChainWhisper memos', () => {
    const plain = 'private history '.repeat(80);

    expect(decodeMemoPlaintextStrict(encodeCompactMemoPlaintext(plain))).toBe(plain);
  });

  it('preserves a 2,000-character Unicode message with reply metadata and reactions', () => {
    const plain = '😀'.repeat(MAX_MESSAGE_LENGTH / 2);
    expect(plain.length).toBe(MAX_MESSAGE_LENGTH);

    const replyPayload = buildMessageWithReplyPayload(
      plain,
      '🔐 encrypted reply',
      `0x${'12'.repeat(32)}`,
      12345,
      7,
      true
    );
    const decodedReply = decodeMemoPlaintextStrict(
      encodeCompactMemoPlaintext(replyPayload),
      MAX_CHAT_MEMO_PLAINTEXT_BYTES
    );
    expect(decodedReply).not.toBeNull();
    expect(parseChatMessagePayload(decodedReply ?? '').cleanText).toBe(plain);

    const reactionPayload = buildMessageWithReactionPayload(
      `0x${'34'.repeat(32)}`,
      '👍',
      '',
      12345,
      7,
      true
    );
    expect(
      decodeMemoPlaintextStrict(
        encodeCompactMemoPlaintext(reactionPayload),
        MAX_CHAT_MEMO_PLAINTEXT_BYTES
      )
    ).toBe(reactionPayload);
  });

  it('rejects a compressed expansion beyond the chat plaintext limit', () => {
    const oversizedPlain = 'A'.repeat(MAX_CHAT_MEMO_PLAINTEXT_BYTES * 64);
    const compressedMemo = encodeCompactMemoPlaintext(oversizedPlain);

    expect(compressedMemo).toMatch(/^\[\[coti-memo-z:v1\]\]/);
    expect(compressedMemo.length).toBeLessThan(MAX_CHAT_MEMO_PLAINTEXT_BYTES);
    expect(decodeMemoPlaintextStrict(compressedMemo, MAX_CHAT_MEMO_PLAINTEXT_BYTES)).toBeNull();
  });

  it('rejects oversized ciphertext before invoking the COTI decryptor', async () => {
    const decrypt = vi.fn(async () => 'should not decrypt');
    const oversizedCiphertext = {
      value: Array.from({ length: MAX_CHAT_MEMO_CIPHERTEXT_CELLS + 1 }, () => 1n)
    };

    await expect(
      decryptMemoWithCellLimit(
        oversizedCiphertext,
        MAX_CHAT_MEMO_CIPHERTEXT_CELLS,
        decrypt
      )
    ).rejects.toThrow('Encrypted memo exceeds the supported ciphertext size.');
    expect(decrypt).not.toHaveBeenCalled();

    await expect(
      decryptMemoWithCellLimit({ value: [1n] }, MAX_CHAT_MEMO_CIPHERTEXT_CELLS, decrypt)
    ).resolves.toBe('should not decrypt');
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it('rejects wrong-key decoder output with replacement/control characters', () => {
    expect(decodeMemoPlaintextStrict('2&#\uFFFD~kh\u0004random')).toBeNull();
  });
});

describe('state backup decoding limits', () => {
  it('round-trips current state backups within the compatibility allowance', () => {
    const backupText = buildStateBackupText({
      version: 1,
      updatedAt: 1234,
      lastReadAllTs: 1200
    });

    expect(parseStateBackupText(backupText)).toEqual({
      version: 1,
      updatedAt: 1234,
      lastReadAllTs: 1200
    });
  });

  it('rejects a compressed state-backup expansion beyond its explicit limit', () => {
    const oversizedBackupJson = JSON.stringify({
      version: 1,
      updatedAt: 1234,
      padding: 'A'.repeat(MAX_STATE_BACKUP_PLAINTEXT_BYTES)
    });
    const compressed = zlibSync(new TextEncoder().encode(oversizedBackupJson), { level: 9 });
    const backupText = `${STATE_BACKUP_PREFIX}${STATE_BACKUP_COMPRESSED_PREFIX}${bytesToBase64(compressed)}`;

    expect(backupText.length).toBeLessThan(MAX_CHAT_MEMO_PLAINTEXT_BYTES);
    expect(parseStateBackupText(backupText)).toBeNull();
  });
});

describe('verified ecosystem tokens', () => {
  it('selects only registered Testnet tokens while retaining old candidate metadata and exact private kinds', async () => {
    vi.resetModules();
    const candidate = { status: 'active', components: {
      publicTestTokenA: { address: `0x${'11'.repeat(20)}` }, publicTestTokenB: { address: `0x${'12'.repeat(20)}` },
      privateTestTokenA: { address: `0x${'13'.repeat(20)}` }, privateTestTokenB: { address: `0x${'14'.repeat(20)}` }
    } };
    vi.doMock('./chainWhisperTestnetCandidate', async importOriginal => ({ ...await importOriginal<typeof import('./chainWhisperTestnetCandidate')>(),
      CHAINWHISPER_TESTNET_CANDIDATE_CONFIG: candidate }));
    try {
      const helpers = await import('./appHelpers');
      expect(helpers.SELECTABLE_TRADE_TOKENS.map(token => token.symbol)).toEqual(['cwPTA', 'cwPTB', 'BCN', 'HBR', 'EMBR', 'ORBT']);
      expect(helpers.SELECTABLE_TRADE_TOKENS.filter(token => token.kind === 'private-erc20')).toHaveLength(4);
      const named = (symbol: string) => helpers.SELECTABLE_TRADE_TOKENS.find(token => token.symbol === symbol)!;
      expect(helpers.TESTNET_CANDIDATE_TRADE_TOKEN_SELECTIONS).toEqual({ publicBase: named('cwPTA').address, publicQuote: named('cwPTB').address,
        privateBase: named('BCN').address, privateQuote: named('HBR').address });
      for (const token of helpers.TESTNET_CANDIDATE_TOKENS) {
        expect(helpers.getVerifiedEcosystemToken(token.address)).toMatchObject(token);
        expect(helpers.resolveTradePresetKind(token.address)).toBe(token.kind);
        expect(helpers.SELECTABLE_TRADE_TOKENS.some(selected => selected.address === token.address)).toBe(false);
      }
      for (const token of helpers.SELECTABLE_TRADE_TOKENS) expect(helpers.resolveTradePresetKind(token.address)).toBe(token.kind);
      const composer = await import('./tradeComposer');
      const resolved = composer.resolveSelectedTradeToken({ selection: named('BCN').address, rewardTokenSymbol: 'WISP', rewardTokenDecimals: 18,
        privateRewardTokenSymbol: 'p.WISP', privateRewardTokenDecimals: 18 });
      expect(resolved).toMatchObject({ tokenAddress: named('BCN').address, kind: 'private-erc20', decimals: 6, symbol: 'BCN' });
    } finally { vi.doUnmock('./chainWhisperTestnetCandidate'); vi.resetModules(); }
  });
  it('derives the exact public/private test-token catalog from an active unified candidate', () => {
    const candidate = {
      status: 'active',
      components: {
        publicTestTokenA: { address: '0x0000000000000000000000000000000000000011' },
        publicTestTokenB: { address: '0x0000000000000000000000000000000000000012' },
        privateTestTokenA: { address: '0x0000000000000000000000000000000000000013' },
        privateTestTokenB: { address: '0x0000000000000000000000000000000000000014' }
      }
    } as unknown as TestnetCandidateConfig;

    expect(buildChainWhisperTestnetCandidateTradeTokens(candidate)).toEqual([
      { address: '0x0000000000000000000000000000000000000011', kind: 'erc20', symbol: 'cwTUB' },
      { address: '0x0000000000000000000000000000000000000012', kind: 'erc20', symbol: 'cwTUQ' },
      { address: '0x0000000000000000000000000000000000000013', kind: 'private-erc20', symbol: 'cwTPB' },
      { address: '0x0000000000000000000000000000000000000014', kind: 'private-erc20', symbol: 'cwTPQ' }
    ]);
  });

  it('includes the official COTI Privacy Portal private tokens', () => {
    const officialPrivateTokens = [
      ['0xD2F2692B83C3ecDF2EAa0f7c2632BBd46Ae1cC91', 'p.COTI'],
      ['0x4727FE8D8450CEBcB142331FAc034Cd8d311f0E5', 'p.WETH'],
      ['0x65449561257ba5756631Aa0d34f07f6457a319be', 'p.WBTC'],
      ['0x42107250C3D385ddfABE69ab6de163702040FeB0', 'p.USDT'],
      ['0x63C9a1D05471fc8d47C83968725Dcfdcb5410392', 'p.USDC.e'],
      ['0x3a8b49aAC1dAD86aa45a75231FbeC5bEb810e416', 'p.wADA'],
      ['0x394b3c4328160f000763Ca391D07F902926EDaAc', 'p.gCOTI']
    ] as const;

    for (const [address, symbol] of officialPrivateTokens) {
      expect(isVerifiedEcosystemToken(address)).toBe(true);
      expect(getVerifiedEcosystemToken(address.toUpperCase())).toMatchObject({
        address,
        kind: 'private-erc20',
        symbol
      });
    }
  });

  it('does not contain duplicate verified token addresses', () => {
    const normalizedAddresses = VERIFIED_ECOSYSTEM_TOKENS.map((token) => token.address.toLowerCase());

    expect(new Set(normalizedAddresses).size).toBe(normalizedAddresses.length);
  });

  it('includes the active p.WISP private token', () => {
    const address = '0x682e3142e62a7aDe2a0CA5bdC87b205CaDe4B17a';

    expect(isVerifiedEcosystemToken(address)).toBe(true);
    expect(getVerifiedEcosystemToken(address.toUpperCase())).toMatchObject({
      address,
      kind: 'private-erc20',
      symbol: 'p.WISP'
    });
  });

  it('does not include the retired test private token', () => {
    expect(isVerifiedEcosystemToken('0x23f0AE74466Fd0fc1d32bB947ebB8Cd553BECdA0')).toBe(false);
  });

  it('includes HOTDOG as an approved private ecosystem token', () => {
    const address = '0x5085Ea0611A9C49316972C57390ca25C9CF236AB';

    expect(isVerifiedEcosystemToken(address)).toBe(true);
    expect(getVerifiedEcosystemToken(address.toUpperCase())).toMatchObject({
      address,
      kind: 'private-erc20',
      symbol: 'HOTDOG'
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
