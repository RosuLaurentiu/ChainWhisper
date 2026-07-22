import { describe, expect, it } from 'vitest';
import {
  ChatImageBlobTooLargeError,
  ChatImageDecryptError,
  ChatImageExpiredError,
  MAX_IMAGE_PLAINTEXT_BYTES,
  CHAT_IMAGE_RETENTION_SECONDS,
  formatImageFileSize,
  getChatImageLoadErrorMessage,
  getImageFileValidationError,
  isChatImageExpiredResponse,
  isChatImageExpiredError,
  isPastChatImageRetentionWindow,
  parseImageTag
} from './imagePull';

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

describe('isChatImageExpiredError', () => {
  it('recognizes expired image errors', () => {
    expect(isChatImageExpiredError(new ChatImageExpiredError())).toBe(true);
    expect(isChatImageExpiredError(new Error('Blob 404'))).toBe(false);
  });
});

describe('chat image retention', () => {
  it('detects messages at or beyond the 24-hour retention boundary', () => {
    const now = 2_000_000;
    expect(isPastChatImageRetentionWindow(now - CHAT_IMAGE_RETENTION_SECONDS, now)).toBe(true);
    expect(isPastChatImageRetentionWindow(now - CHAT_IMAGE_RETENTION_SECONDS + 1, now)).toBe(false);
  });

  it('recognizes the legacy Supabase 400 wrapper for a missing object', async () => {
    const response = new Response(
      JSON.stringify({ statusCode: '404', error: 'not_found', message: 'Object not found' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );

    await expect(isChatImageExpiredResponse(response)).resolves.toBe(true);
  });

  it('does not classify unrelated bad requests as expired images', async () => {
    const response = new Response(
      JSON.stringify({ statusCode: '400', error: 'InvalidKey', message: 'Invalid object key' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );

    await expect(isChatImageExpiredResponse(response)).resolves.toBe(false);
  });
});

describe('formatImageFileSize', () => {
  it('formats image sizes for attachment feedback', () => {
    expect(formatImageFileSize(0)).toBe('0 bytes');
    expect(formatImageFileSize(512)).toBe('512 bytes');
    expect(formatImageFileSize(1536)).toBe('1.5 KB');
    expect(formatImageFileSize(20 * 1024)).toBe('20 KB');
    expect(formatImageFileSize(MAX_IMAGE_PLAINTEXT_BYTES)).toBe('8.0 MB');
  });
});

describe('getImageFileValidationError', () => {
  it('accepts supported image files', () => {
    expect(getImageFileValidationError({ size: 1024, type: ' image/PNG ' })).toBeNull();
  });

  it('rejects unsupported, empty, and oversized files with user-facing messages', () => {
    expect(getImageFileValidationError({ size: 1024, type: 'image/svg+xml' })).toBe(
      'Unsupported image format. Use JPEG, PNG, WEBP, GIF, or AVIF.'
    );
    expect(getImageFileValidationError({ size: 0, type: 'image/png' })).toBe('The selected image is empty.');
    expect(getImageFileValidationError({ size: MAX_IMAGE_PLAINTEXT_BYTES + 1, type: 'image/jpeg' })).toContain(
      'The limit is 8.0 MB before encryption.'
    );
  });
});

describe('getChatImageLoadErrorMessage', () => {
  it('maps image load failures to clearer chat messages', () => {
    expect(getChatImageLoadErrorMessage(new ChatImageDecryptError())).toContain('could not be decrypted');
    expect(getChatImageLoadErrorMessage(new ChatImageBlobTooLargeError())).toContain('larger than the app can safely display');
    expect(getChatImageLoadErrorMessage(new Error('Network failed'))).toBe(
      'Unable to download the encrypted image. Check your connection and try again.'
    );
  });
});
