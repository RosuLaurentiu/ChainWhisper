import { formatImageFileSize } from './imagePull';

export type ImageAttachmentPreviewState = {
  detail: string;
  fileName: string;
  previewUrl?: string;
  retryFile?: File;
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
  previewUrl?: string,
  retryFile?: File
): ImageAttachmentPreviewState => ({
  detail,
  fileName: file.name.trim() || 'Pasted image',
  ...(previewUrl ? { previewUrl } : {}),
  ...(retryFile ? { retryFile } : {}),
  sizeLabel: formatImageFileSize(file.size),
  title,
  tone
});
