import {
  confirmChatImageUpload,
  createEncryptedImageTagFromFile,
  getImageFileValidationError,
  parseImageTag,
  type ChatImageConversationKind
} from './imagePull';
import { buildImageAttachmentStatus, type ImageAttachmentPreviewState } from './imageAttachmentPreview';

type SendChatImageAttachmentOptions = {
  clearImageAttachmentStatus: () => void;
  failureFallbackMessage: string;
  file: File;
  isTargetCurrent: () => boolean;
  kind: ChatImageConversationKind;
  missingTargetMessage: string;
  sendImageTag: (imageTag: string) => Promise<string | undefined>;
  senderAddress: string;
  setError: (message: string) => void;
  setUploadingImage: (uploading: boolean) => void;
  showImageAttachmentStatus: (status: ImageAttachmentPreviewState) => void;
  targetChangedMessage: string;
  targetMissing: boolean;
  uploadingImage: boolean;
};

const createImagePreviewUrl = (file: File): string | undefined => {
  try {
    return URL.createObjectURL(file);
  } catch {
    return undefined;
  }
};

export async function sendChatImageAttachment({
  clearImageAttachmentStatus,
  failureFallbackMessage,
  file,
  isTargetCurrent,
  kind,
  missingTargetMessage,
  sendImageTag,
  senderAddress,
  setError,
  setUploadingImage,
  showImageAttachmentStatus,
  targetChangedMessage,
  targetMissing,
  uploadingImage
}: SendChatImageAttachmentOptions): Promise<void> {
  setError('');
  if (uploadingImage) {
    return;
  }

  if (targetMissing) {
    setError(missingTargetMessage);
    return;
  }

  const validationError = getImageFileValidationError(file);
  if (validationError) {
    setError(validationError);
    showImageAttachmentStatus(
      buildImageAttachmentStatus(file, 'error', 'Image was not attached', validationError)
    );
    return;
  }

  const previewUrl = createImagePreviewUrl(file);

  try {
    showImageAttachmentStatus(
      buildImageAttachmentStatus(
        file,
        'pending',
        'Encrypting image',
        'Encrypting locally before upload to Supabase Storage.',
        previewUrl
      )
    );
    setUploadingImage(true);
    const imageTag = await createEncryptedImageTagFromFile(file, kind, senderAddress);
    const parsedImageTag = parseImageTag(imageTag);
    if (!isTargetCurrent()) {
      throw new Error(targetChangedMessage);
    }

    showImageAttachmentStatus(
      buildImageAttachmentStatus(
        file,
        'pending',
        'Sending image message',
        'Encrypted upload finished. Confirming the message on COTI.',
        previewUrl
      )
    );
    const txHash = await sendImageTag(imageTag);
    if (!parsedImageTag || !txHash) {
      const message = 'Image message was sent, but the server could not confirm image retention.';
      setError(message);
      showImageAttachmentStatus(buildImageAttachmentStatus(file, 'error', 'Image was sent', message, previewUrl));
      return;
    }

    showImageAttachmentStatus(
      buildImageAttachmentStatus(
        file,
        'pending',
        'Confirming image storage',
        'Message confirmed on COTI. Marking the encrypted upload as retained.',
        previewUrl
      )
    );
    try {
      await confirmChatImageUpload(parsedImageTag.blobId, txHash);
    } catch (confirmError) {
      const message = confirmError instanceof Error ? confirmError.message : 'Image retention confirmation failed.';
      setError(message);
      showImageAttachmentStatus(
        buildImageAttachmentStatus(file, 'error', 'Image was sent', message, previewUrl)
      );
      return;
    }
    clearImageAttachmentStatus();
  } catch (imageError) {
    const message = imageError instanceof Error ? imageError.message : failureFallbackMessage;
    if (!isTargetCurrent()) {
      clearImageAttachmentStatus();
      return;
    }
    setError(message);
    showImageAttachmentStatus(
      buildImageAttachmentStatus(file, 'error', 'Image was not sent', message, previewUrl, file)
    );
  } finally {
    setUploadingImage(false);
  }
}
