import { describe, expect, it } from 'vitest';
import {
  GROUP_CHAT_V2_MAX_PLAINTEXT_BYTES,
  decodeGroupChatV2Payload,
  encodeGroupChatV2Payload
} from './groupChatV2Payload';

describe('groupChatV2Payload', () => {
  it('round-trips text and a stable group message reply target', () => {
    const replyToMessageAnchor = `0x${'22'.repeat(32)}`;
    const encoded = encodeGroupChatV2Payload({
      body: 'reply body',
      replyToMessageId: 42n,
      replyToMessageAnchor,
      replyPreview: 'earlier message'
    });
    expect(decodeGroupChatV2Payload(encoded)).toEqual({
      version: 1,
      body: 'reply body',
      replyToMessageId: 42n,
      replyToMessageAnchor,
      replyPreview: 'earlier message'
    });
  });

  it('preserves existing structured chat tags inside the encrypted body', () => {
    const body = '[trade:direct-v2:7:0xabc] hello';
    expect(decodeGroupChatV2Payload(encodeGroupChatV2Payload({ body })).body).toBe(body);
  });

  it('rejects ambiguous reply and extension fields', () => {
    expect(() => encodeGroupChatV2Payload({ body: 'x', replyPreview: 'missing target' }))
      .toThrow('requires a stable reply target');
    expect(() => encodeGroupChatV2Payload({
      body: 'x',
      replyToMessageAnchor: `0x${'22'.repeat(32)}`
    })).toThrow('requires a stable reply target');
    expect(() => decodeGroupChatV2Payload('{"v":1,"b":"x","extra":true}'))
      .toThrow('unsupported fields');
    expect(() => decodeGroupChatV2Payload('{"v":1,"b":"x","r":"01"}'))
      .toThrow('not canonical');
  });

  it('enforces the AES-GCM plaintext byte budget including Unicode', () => {
    expect(() => encodeGroupChatV2Payload({ body: 'x'.repeat(GROUP_CHAT_V2_MAX_PLAINTEXT_BYTES) }))
      .toThrow('encrypted message limit');
    expect(() => encodeGroupChatV2Payload({ body: '🙂'.repeat(GROUP_CHAT_V2_MAX_PLAINTEXT_BYTES) }))
      .toThrow('encrypted message limit');
  });
});
