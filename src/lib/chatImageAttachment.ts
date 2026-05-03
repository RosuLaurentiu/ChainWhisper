import {
  createEncryptedImageTagFromFile,
  getImageFileValidationError,
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
  sendImageTag: (imageTag: string) => Promise<void>;
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
    const imageTag = await createEncryptedImageTagFromFile(file, kind);
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
    await sendImageTag(imageTag);
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
