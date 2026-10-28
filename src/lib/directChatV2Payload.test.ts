import { describe, expect, it } from 'vitest';
import {
  DIRECT_CHAT_V2_MAX_PLAINTEXT_BYTES,
  decodeDirectChatV2Payload,
  encodeDirectChatV2Payload
} from './directChatV2Payload';

describe('directChatV2Payload', () => {
  it('round-trips the encrypted body and stable reply identity deterministically', () => {
    const replyToMessageAnchor = `0x${'11'.repeat(32)}`;
    const encoded = encodeDirectChatV2Payload({
      body: 'hello 👋 [[trade:v2:encrypted-metadata]]',
      replyToMessageId: 42n,
      replyToMessageAnchor,
      replyPreview: 'earlier private message'
    });

    expect(encoded).toContain(`"r":"42","a":"${replyToMessageAnchor}","p":"earlier private message"`);
    expect(decodeDirectChatV2Payload(encoded)).toEqual({
      version: 1,
      body: 'hello 👋 [[trade:v2:encrypted-metadata]]',
      replyToMessageId: 42n,
      replyToMessageAnchor,
      replyPreview: 'earlier private message'
    });
  });

  it('supports a normal message without fabricating a reply target', () => {
    expect(decodeDirectChatV2Payload(encodeDirectChatV2Payload({ body: 'plain message' }))).toEqual({
      version: 1,
      body: 'plain message'
    });
  });

  it('fails closed on ambiguous, unknown, or oversized payloads', () => {
    expect(() => decodeDirectChatV2Payload('plain legacy text')).toThrow('versioned JSON');
    expect(() => decodeDirectChatV2Payload('{"v":1,"b":"hello","r":"01"}')).toThrow('canonical');
    expect(() => decodeDirectChatV2Payload('{"v":1,"b":"hello","r":"18446744073709551616"}')).toThrow('uint64');
    expect(() => decodeDirectChatV2Payload('{"v":1,"b":"hello","x":true}')).toThrow('unsupported');
    expect(() => encodeDirectChatV2Payload({ body: 'hello', replyPreview: 'orphan preview' })).toThrow('stable');
    expect(() => encodeDirectChatV2Payload({
      body: 'hello',
      replyToMessageAnchor: `0x${'11'.repeat(32)}`
    })).toThrow('stable');
    expect(() => decodeDirectChatV2Payload('{"v":1,"b":"hello","r":"1","a":"0x01"}'))
      .toThrow('non-zero bytes32');
    expect(() => encodeDirectChatV2Payload({ body: 'x'.repeat(DIRECT_CHAT_V2_MAX_PLAINTEXT_BYTES) })).toThrow('limit');
  });
});
