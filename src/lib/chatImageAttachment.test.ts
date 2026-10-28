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
const confirmationToken = 'b'.repeat(64);
const ownerAddress = '0x1111111111111111111111111111111111111111';
const txHash = `0x${'a'.repeat(64)}`;
const preparedUpload = { blobId: '12345678-abcd-40ef-9234-567890abcdef', confirmationToken, imageTag };

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
};

const makeFile = () => new File(['hello'], 'hello.png', { type: 'image/png' });

const makeOptions = (overrides: Partial<Parameters<typeof sendChatImageAttachment>[0]> = {}) => ({
  clearImageAttachmentStatus: vi.fn(),
  failureFallbackMessage: 'Failed to send image.',
  file: makeFile(),
  isTargetCurrent: () => true,
  kind: 'direct' as const,
  conversationTarget: '0x2222222222222222222222222222222222222222',
  missingTargetMessage: 'Select a contact first.',
  sendImageTag: vi.fn(async () => txHash),
  senderAddress: ownerAddress,
  uploadAuthorization: {
    mode: 'signature' as const,
    sign: vi.fn(async () => `0x${'c'.repeat(130)}`)
  },
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
    vi.mocked(createEncryptedImageTagFromFile).mockResolvedValue({
      blobId: '12345678-abcd-40ef-9234-567890abcdef',
      confirmationToken,
      imageTag
    });
    vi.mocked(confirmChatImageUpload).mockResolvedValue(undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('confirms image retention with the on-chain message tx hash', async () => {
    const options = makeOptions();

    await sendChatImageAttachment(options);

    expect(createEncryptedImageTagFromFile).toHaveBeenCalledWith(
      options.file,
      'direct',
      ownerAddress,
      options.conversationTarget,
      options.uploadAuthorization
    );
    expect(options.sendImageTag).toHaveBeenCalledWith(imageTag);
    expect(confirmChatImageUpload).toHaveBeenCalledWith(
      '12345678-abcd-40ef-9234-567890abcdef',
      txHash,
      confirmationToken
    );
    expect(options.clearImageAttachmentStatus).toHaveBeenCalled();
  });

  it('does not send or confirm when wallet authorization fails', async () => {
    vi.mocked(createEncryptedImageTagFromFile).mockRejectedValue(new Error('Image upload authorization was rejected.'));
    const options = makeOptions();

    await sendChatImageAttachment(options);

    expect(options.sendImageTag).not.toHaveBeenCalled();
    expect(confirmChatImageUpload).not.toHaveBeenCalled();
    expect(options.setError).toHaveBeenLastCalledWith('Image upload authorization was rejected.');
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

  it.each(['resolve', 'reject'] as const)('ignores a stale retention %s after changing the target', async (outcome) => {
    const confirmation = deferred<void>();
    vi.mocked(confirmChatImageUpload).mockReturnValue(confirmation.promise);
    let current = true;
    const options = makeOptions({ isTargetCurrent: () => current });
    const pending = sendChatImageAttachment(options);
    await vi.waitFor(() => expect(confirmChatImageUpload).toHaveBeenCalledTimes(1));
    current = false;
    vi.mocked(options.clearImageAttachmentStatus).mockClear();
    vi.mocked(options.showImageAttachmentStatus).mockClear();
    vi.mocked(options.setError).mockClear();
    if (outcome === 'resolve') confirmation.resolve();
    else confirmation.reject(new Error('Old image retention failed.'));
    await pending;
    expect(options.clearImageAttachmentStatus).not.toHaveBeenCalled();
    expect(options.showImageAttachmentStatus).not.toHaveBeenCalled();
    expect(options.setError).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('does not clear a newer upload when the old target finishes preparation', async () => {
    const oldUpload = deferred<typeof preparedUpload>();
    const newUpload = deferred<typeof preparedUpload>();
    vi.mocked(createEncryptedImageTagFromFile).mockReturnValueOnce(oldUpload.promise).mockReturnValueOnce(newUpload.promise);
    vi.mocked(URL.createObjectURL).mockReturnValueOnce('blob:old').mockReturnValueOnce('blob:new');
    let current = true;
    const oldOptions = makeOptions({ isTargetCurrent: () => current });
    const oldPending = sendChatImageAttachment(oldOptions);
    current = false;
    const newOptions = { ...oldOptions, isTargetCurrent: () => true, sendImageTag: vi.fn(async () => txHash) };
    const newPending = sendChatImageAttachment(newOptions);
    oldUpload.resolve(preparedUpload);
    await oldPending;
    expect(oldOptions.setUploadingImage).toHaveBeenLastCalledWith(true);
    expect(oldOptions.clearImageAttachmentStatus).not.toHaveBeenCalled();
    expect(oldOptions.sendImageTag).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:old');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:new');
    newUpload.resolve(preparedUpload);
    await newPending;
    expect(newOptions.sendImageTag).toHaveBeenCalledTimes(1);
    expect(newOptions.setUploadingImage).toHaveBeenLastCalledWith(false);
  });

  it('retains an already sent image without changing the new target status', async () => {
    const sent = deferred<string>();
    let current = true;
    const options = makeOptions({ isTargetCurrent: () => current, sendImageTag: vi.fn(() => sent.promise) });
    const pending = sendChatImageAttachment(options);
    await vi.waitFor(() => expect(options.sendImageTag).toHaveBeenCalledTimes(1));
    current = false;
    vi.mocked(options.clearImageAttachmentStatus).mockClear();
    vi.mocked(options.showImageAttachmentStatus).mockClear();
    vi.mocked(options.setError).mockClear();
    sent.resolve(txHash);
    await pending;
    expect(confirmChatImageUpload).toHaveBeenCalledWith(preparedUpload.blobId, txHash, confirmationToken);
    expect(options.clearImageAttachmentStatus).not.toHaveBeenCalled();
    expect(options.showImageAttachmentStatus).not.toHaveBeenCalled();
    expect(options.setError).not.toHaveBeenCalled();
  });

  it('does not start an upload from a stale target callback', async () => {
    const options = makeOptions({ isTargetCurrent: () => false });
    await sendChatImageAttachment(options);
    expect(createEncryptedImageTagFromFile).not.toHaveBeenCalled();
    expect(options.setError).not.toHaveBeenCalled();
    expect(options.showImageAttachmentStatus).not.toHaveBeenCalled();
    expect(options.setUploadingImage).not.toHaveBeenCalled();
  });
});
