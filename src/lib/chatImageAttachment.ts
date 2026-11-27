import {
  confirmChatImageUpload,
  createEncryptedImageTagFromFile,
  getImageFileValidationError,
  type ChatImageConversationKind,
  type ChatImageUploadAuthorization
} from './imagePull';
import { buildImageAttachmentStatus, type ImageAttachmentPreviewState } from './imageAttachmentPreview';

type SendChatImageAttachmentOptions = {
  clearImageAttachmentStatus: () => void;
  conversationTarget: string;
  failureFallbackMessage: string;
  file: File;
  isTargetCurrent: () => boolean;
  kind: ChatImageConversationKind;
  missingTargetMessage: string;
  sendImageTag: (imageTag: string) => Promise<string | undefined>;
  senderAddress: string;
  uploadAuthorization: ChatImageUploadAuthorization;
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

/**
 * Waits between retention-confirm checks, about 2 minutes in total. The server
 * deletes an unconfirmed upload after 30 minutes, so this stays well inside it.
 */
export const CHAT_IMAGE_CONFIRM_RETRY_DELAYS_MS: readonly number[] = Object.freeze([
  2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000
]);

// Direct and Group share this preview controller; only its latest upload owns cleanup.
const activeImageUploads = new WeakMap<() => void, symbol>();

export async function sendChatImageAttachment({
  clearImageAttachmentStatus,
  conversationTarget,
  failureFallbackMessage,
  file,
  isTargetCurrent,
  kind,
  missingTargetMessage,
  sendImageTag,
  senderAddress,
  uploadAuthorization,
  setError,
  setUploadingImage,
  showImageAttachmentStatus,
  targetChangedMessage,
  targetMissing,
  uploadingImage
}: SendChatImageAttachmentOptions): Promise<void> {
  if (uploadingImage || !isTargetCurrent()) {
    return;
  }
  setError('');

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
  const upload = Symbol();
  activeImageUploads.set(clearImageAttachmentStatus, upload);
  const ownsUpload = () => activeImageUploads.get(clearImageAttachmentStatus) === upload;
  const canUpdateStatus = () => ownsUpload() && isTargetCurrent();

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
    const preparedImage = await createEncryptedImageTagFromFile(
      file,
      kind,
      senderAddress,
      conversationTarget,
      uploadAuthorization
    );
    if (!canUpdateStatus()) {
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
    const txHash = await sendImageTag(preparedImage.imageTag);
    if (!txHash) {
      if (canUpdateStatus()) {
        const message = 'Image message was sent, but the server could not confirm image retention.';
        setError(message);
        showImageAttachmentStatus(buildImageAttachmentStatus(file, 'error', 'Image was sent', message, previewUrl));
      }
      return;
    }

    if (canUpdateStatus()) {
      showImageAttachmentStatus(
        buildImageAttachmentStatus(
          file,
          'pending',
          'Confirming image storage',
          'Message transaction sent on COTI. Marking the encrypted upload as retained.',
          previewUrl
        )
      );
    }
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await confirmChatImageUpload(
            preparedImage.blobId,
            txHash,
            preparedImage.confirmationToken
          );
          break;
        } catch (confirmError) {
          // Retry only answers that can change: receipt not yet visible to the server, busy, or network.
          const retryable = (confirmError as { retryable?: unknown } | null)?.retryable === true;
          const delayMs = CHAT_IMAGE_CONFIRM_RETRY_DELAYS_MS[attempt];
          if (!retryable || delayMs === undefined) throw confirmError;
          if (canUpdateStatus()) {
            showImageAttachmentStatus(
              buildImageAttachmentStatus(
                file,
                'pending',
                'Confirming image storage',
                `The image server has not seen the COTI confirmation yet. Checking again in ${Math.round(delayMs / 1000)} s (check ${attempt + 2} of ${CHAT_IMAGE_CONFIRM_RETRY_DELAYS_MS.length + 1}).`,
                previewUrl
              )
            );
          }
          await new Promise<void>((resolve) => {
            globalThis.setTimeout(resolve, delayMs);
          });
        }
      }
    } catch (confirmError) {
      if (!canUpdateStatus()) return;
      const message = confirmError instanceof Error ? confirmError.message : 'Image retention confirmation failed.';
      setError(message);
      showImageAttachmentStatus(
        buildImageAttachmentStatus(file, 'error', 'Image was sent', message, previewUrl)
      );
      return;
    }
    if (canUpdateStatus()) clearImageAttachmentStatus();
  } catch (imageError) {
    const message = imageError instanceof Error ? imageError.message : failureFallbackMessage;
    if (!canUpdateStatus()) return;
    setError(message);
    showImageAttachmentStatus(
      buildImageAttachmentStatus(file, 'error', 'Image was not sent', message, previewUrl, file)
    );
  } finally {
    if (!canUpdateStatus() && previewUrl) URL.revokeObjectURL(previewUrl);
    if (ownsUpload()) {
      activeImageUploads.delete(clearImageAttachmentStatus);
      setUploadingImage(false);
    }
  }
}
