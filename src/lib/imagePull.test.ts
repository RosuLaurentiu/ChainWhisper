import { describe, expect, it } from 'vitest';
import { parseImageTag } from './imagePull';

describe('parseImageTag', () => {
  it('parses a valid image tag', () => {
    const tag =
      '[img:12345678-abcd-90ef-1234-567890abcdef|0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:0123456789abcdef01234567|1024|image/png]';

    const parsed = parseImageTag(tag);
    expect(parsed).toEqual({
      blobId: '12345678-abcd-90ef-1234-567890abcdef',
      keyHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ivHex: '0123456789abcdef01234567',
      sizeBytes: 1024,
      mime: 'image/png'
    });
  });

  it('rejects unsupported mime types', () => {
    const tag =
      '[img:12345678-abcd-90ef-1234-567890abcdef|0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:0123456789abcdef01234567|1024|image/svg+xml]';

    expect(parseImageTag(tag)).toBeNull();
  });

  it('rejects oversized image size', () => {
    const tag =
      '[img:12345678-abcd-90ef-1234-567890abcdef|0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:0123456789abcdef01234567|99999999|image/jpeg]';

    expect(parseImageTag(tag)).toBeNull();
  });
});
