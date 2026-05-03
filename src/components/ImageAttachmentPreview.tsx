import type { ImageAttachmentPreviewState } from '../lib/imageAttachmentPreview';

type ImageAttachmentPreviewProps = {
  onDismiss?: () => void;
  status: ImageAttachmentPreviewState;
};

export default function ImageAttachmentPreview({ onDismiss, status }: ImageAttachmentPreviewProps) {
  const isError = status.tone === 'error';

  return (
    <div
      className={`chat-image-attachment-preview chat-image-attachment-preview-${status.tone}`}
      role="status"
      aria-live="polite"
    >
      {status.previewUrl ? (
        <img src={status.previewUrl} alt="" className="chat-image-attachment-thumb" aria-hidden="true" />
      ) : (
        <div className="chat-image-attachment-thumb chat-image-attachment-thumb-empty" aria-hidden="true">
          IMG
        </div>
      )}
      <div className="chat-image-attachment-copy">
        <div className="chat-image-attachment-title-row">
          <strong>{status.title}</strong>
          <span>{status.sizeLabel}</span>
        </div>
        <p>{status.fileName}</p>
        <small>{status.detail}</small>
      </div>
      {isError && onDismiss ? (
        <button type="button" className="chat-image-attachment-dismiss" onClick={onDismiss} aria-label="Dismiss image error">
          Clear
        </button>
      ) : null}
    </div>
  );
}
