import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendChatImageAttachment } from './chatImageAttachment';
import {
  confirmChatImageUpload,
  createEncryptedImageTagFromFile,
  getImageFileValidationError
} from './imagePull';

vi.mock('./imagePull', () => ({
  confirmChatImageUpload: vi.fn(),
  createEncryptedImageTagFromFile: vi.fn(),
  formatImageFileSize: (bytes: number) => `${bytes} bytes`,
  getImageFileValidationError: vi.fn(),
  parseImageTag: (text: string) => {
    const match = /^\[img:([^|]+)\|/.exec(text);
    return match ? { blobId: match[1] } : null;
  }
}));

const imageTag =
  '[img:12345678-abcd-40ef-9234-567890abcdef|0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:0123456789abcdef01234567|12|image/png]';
const ownerAddress = '0x1111111111111111111111111111111111111111';
const txHash = `0x${'a'.repeat(64)}`;

const makeFile = () => new File(['hello'], 'hello.png', { type: 'image/png' });

const makeOptions = (overrides: Partial<Parameters<typeof sendChatImageAttachment>[0]> = {}) => ({
  clearImageAttachmentStatus: vi.fn(),
  failureFallbackMessage: 'Failed to send image.',
  file: makeFile(),
  isTargetCurrent: () => true,
  kind: 'direct' as const,
  missingTargetMessage: 'Select a contact first.',
  sendImageTag: vi.fn(async () => txHash),
  senderAddress: ownerAddress,
  setError: vi.fn(),
  setUploadingImage: vi.fn(),
  showImageAttachmentStatus: vi.fn(),
  targetChangedMessage: 'Conversation changed.',
  targetMissing: false,
  uploadingImage: false,
  ...overrides
});

describe('sendChatImageAttachment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getImageFileValidationError).mockReturnValue(null);
    vi.mocked(createEncryptedImageTagFromFile).mockResolvedValue(imageTag);
    vi.mocked(confirmChatImageUpload).mockResolvedValue(undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('confirms image retention with the on-chain message tx hash', async () => {
    const options = makeOptions();

    await sendChatImageAttachment(options);

    expect(createEncryptedImageTagFromFile).toHaveBeenCalledWith(options.file, 'direct', ownerAddress);
    expect(options.sendImageTag).toHaveBeenCalledWith(imageTag);
    expect(confirmChatImageUpload).toHaveBeenCalledWith('12345678-abcd-40ef-9234-567890abcdef', txHash);
    expect(options.clearImageAttachmentStatus).toHaveBeenCalled();
  });

  it('does not offer retry when only retention confirmation fails', async () => {
    vi.mocked(confirmChatImageUpload).mockRejectedValue(new Error('Image was sent, but retention failed.'));
    const options = makeOptions();

    await sendChatImageAttachment(options);

    expect(options.clearImageAttachmentStatus).not.toHaveBeenCalled();
    expect(options.setError).toHaveBeenLastCalledWith('Image was sent, but retention failed.');
    expect(options.showImageAttachmentStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Image was sent',
        tone: 'error'
      })
    );
    expect(vi.mocked(options.showImageAttachmentStatus).mock.lastCall?.[0]).not.toHaveProperty('retryFile');
  });
});
