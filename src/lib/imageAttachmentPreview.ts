import { formatImageFileSize } from './imagePull';

export type ImageAttachmentPreviewState = {
  detail: string;
  fileName: string;
  previewUrl?: string;
  sizeLabel: string;
  title: string;
  tone: 'pending' | 'error';
};

type ImageAttachmentFileLike = Pick<File, 'name' | 'size'>;

export const buildImageAttachmentStatus = (
  file: ImageAttachmentFileLike,
  tone: ImageAttachmentPreviewState['tone'],
  title: string,
  detail: string,
  previewUrl?: string
): ImageAttachmentPreviewState => ({
  detail,
  fileName: file.name.trim() || 'Pasted image',
  previewUrl,
  sizeLabel: formatImageFileSize(file.size),
  title,
  tone
});
