import { describe, expect, it } from 'vitest';
import {
  decodeGroupChatV2MetadataPayload,
  encodeGroupChatV2MetadataPayload
} from './groupChatV2MetadataPayload';

describe('groupChatV2MetadataPayload', () => {
  it('normalizes and round-trips a private title', () => {
    expect(decodeGroupChatV2MetadataPayload(
      encodeGroupChatV2MetadataPayload('  Private   Desk  ')
    )).toEqual({ version: 1, title: 'Private Desk' });
  });

  it('rejects unknown fields, controls, and oversized titles', () => {
    expect(() => decodeGroupChatV2MetadataPayload('{"v":1,"n":"Desk","x":1}'))
      .toThrow('unsupported schema');
    expect(() => encodeGroupChatV2MetadataPayload('bad\nname')).toThrow('control characters');
    expect(() => encodeGroupChatV2MetadataPayload('x'.repeat(81))).toThrow('too long');
  });
});
