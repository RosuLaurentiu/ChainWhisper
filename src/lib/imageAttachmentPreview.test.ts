import { describe, expect, it } from 'vitest';
import { buildImageAttachmentStatus } from './imageAttachmentPreview';

describe('buildImageAttachmentStatus', () => {
  it('builds user-facing image attachment preview state', () => {
    expect(
      buildImageAttachmentStatus(
        { name: ' receipt.png ', size: 1536 },
        'pending',
        'Encrypting image',
        'Encrypting locally.',
        'blob:preview'
      )
    ).toEqual({
      detail: 'Encrypting locally.',
      fileName: 'receipt.png',
      previewUrl: 'blob:preview',
      sizeLabel: '1.5 KB',
      title: 'Encrypting image',
      tone: 'pending'
    });
  });

  it('uses a pasted-image fallback when the file has no display name', () => {
    expect(buildImageAttachmentStatus({ name: ' ', size: 0 }, 'error', 'Image was not attached', 'Empty file.')).toMatchObject({
      fileName: 'Pasted image',
      sizeLabel: '0 bytes',
      tone: 'error'
    });
  });

  it('keeps a retry file only when one is provided', () => {
    const retryFile = { name: 'chart.webp', size: 2048 } as File;

    expect(
      buildImageAttachmentStatus(retryFile, 'error', 'Image was not sent', 'Try again.', 'blob:retry', retryFile)
    ).toMatchObject({
      retryFile
    });
    expect(buildImageAttachmentStatus(retryFile, 'error', 'Image was not attached', 'Unsupported file.')).not.toHaveProperty(
      'retryFile'
    );
  });
});
