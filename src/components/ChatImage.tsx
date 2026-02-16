import React, { useEffect, useState, useCallback } from 'react';
import { parseImageTag, fetchAndDecryptToUrl } from '../lib/imagePull';

type Props = { tag: string };

export default function ChatImage({ tag }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    let revokeUrl: string | null = null;
    const parsed = parseImageTag(tag);
    if (!parsed) {
      setError('Invalid image tag');
      return;
    }

    (async () => {
      try {
        const objUrl = await fetchAndDecryptToUrl(parsed.blobId, parsed.keyHex, parsed.ivHex, parsed.mime);
        if (!mounted) return;
        revokeUrl = objUrl;
        setUrl(objUrl);
      } catch (err: any) {
        if (!mounted) return;
        setError(String(err?.message ?? err));
      }
    })();

    return () => {
      mounted = false;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [tag]);

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
