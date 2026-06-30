import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageAttachmentPreviewState } from '../../../lib/imageAttachmentPreview';

const revokeObjectUrl = (url: string | null): void => {
  if (url) {
    URL.revokeObjectURL(url);
  }
};

export default function useImageAttachmentStatus() {
  const [imageAttachmentStatus, setImageAttachmentStatus] = useState<ImageAttachmentPreviewState | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const clearImageAttachmentStatus = useCallback(() => {
    revokeObjectUrl(previewUrlRef.current);
    previewUrlRef.current = null;
    setImageAttachmentStatus(null);
  }, []);

  const showImageAttachmentStatus = useCallback((status: ImageAttachmentPreviewState) => {
    if (previewUrlRef.current && previewUrlRef.current !== status.previewUrl) {
      revokeObjectUrl(previewUrlRef.current);
      previewUrlRef.current = null;
    }

    previewUrlRef.current = status.previewUrl ?? null;
    setImageAttachmentStatus(status);
  }, []);

  useEffect(
    () => () => {
      revokeObjectUrl(previewUrlRef.current);
      previewUrlRef.current = null;
    },
    []
  );

  return {
    clearImageAttachmentStatus,
    imageAttachmentStatus,
    showImageAttachmentStatus
  };
}
