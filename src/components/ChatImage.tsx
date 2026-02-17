import { useEffect, useState, useCallback, memo } from 'react';
import { parseImageTag, fetchAndDecryptToUrl } from '../lib/imagePull';
import type { ParsedImageTag } from '../lib/imagePull';

type Props = { tag: string; parsed?: ParsedImageTag };

function ChatImage({ tag, parsed }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    let revokeUrl: string | null = null;
    const parsedTag = parsed ?? parseImageTag(tag);
    if (!parsedTag) {
      setError('Invalid image tag');
      setUrl(null);
      return;
    }
    setError(null);
    setUrl(null);
    const abortController = new AbortController();

    (async () => {
      try {
        const objUrl = await fetchAndDecryptToUrl(
          parsedTag.blobId,
          parsedTag.keyHex,
          parsedTag.ivHex,
          parsedTag.mime,
          abortController.signal
        );
        if (!mounted) return;
        revokeUrl = objUrl;
        setUrl(objUrl);
      } catch (err: any) {
        if (!mounted || abortController.signal.aborted) return;
        setError('Unable to load image.');
      }
    })();

    return () => {
      mounted = false;
      abortController.abort();
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [tag, parsed]);

  const openLightbox = useCallback(() => setLightboxOpen(true), []);
  const closeLightbox = useCallback(() => setLightboxOpen(false), []);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxOpen, closeLightbox]);

  if (error) return <div className="chat-image-error">{error}</div>;
  if (!url) return <div className="chat-image-loading">Loading image…</div>;

  return (
    <>
      <img src={url} alt="Image" className="chat-image" onClick={openLightbox} />
      {lightboxOpen ? (
        <div className="image-lightbox-backdrop" onClick={closeLightbox} role="dialog" aria-modal="true">
          <div className="image-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={url} alt="Image enlarged" onClick={closeLightbox} />
          </div>
        </div>
      ) : null}
    </>
  );
}

export default memo(ChatImage, (previous, next) => previous.tag === next.tag);
