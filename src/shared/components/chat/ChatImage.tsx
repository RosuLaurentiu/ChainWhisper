import { useEffect, useState, useCallback, memo, useRef } from 'react';
import {
  parseImageTag,
  fetchAndDecryptToUrl,
  getChatImageLoadErrorMessage,
  isChatImageExpiredError,
  isPastChatImageRetentionWindow
} from '../../../lib/imagePull';
import type { ParsedImageTag } from '../../../lib/imagePull';

type Props = { tag: string; parsed?: ParsedImageTag; messageTimestamp?: number };
type CachedImage = { url: string; refs: number };

const imageUrlCache = new Map<string, CachedImage>();

const createImageCacheKey = (parsed: ParsedImageTag): string =>
  `${parsed.blobId}|${parsed.keyHex}|${parsed.ivHex}|${parsed.mime}`;

function ChatImage({ tag, parsed, messageTimestamp }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const imageTriggerRef = useRef<HTMLButtonElement | null>(null);
  const lightboxCloseRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let mounted = true;
    let activeCacheKey: string | null = null;
    const parsedTag = parsed ?? parseImageTag(tag);
    if (!parsedTag) {
      setError('Invalid image tag');
      setExpired(false);
      setUrl(null);
      return;
    }

    if (isPastChatImageRetentionWindow(messageTimestamp)) {
      setError(null);
      setExpired(true);
      setUrl(null);
      return;
    }

    const cacheKey = createImageCacheKey(parsedTag);
    const cached = imageUrlCache.get(cacheKey);
    if (cached) {
      cached.refs += 1;
      activeCacheKey = cacheKey;
      setError(null);
      setExpired(false);
      setUrl(cached.url);
      return () => {
        mounted = false;
        if (!activeCacheKey) return;
        const active = imageUrlCache.get(activeCacheKey);
        if (!active) return;
        active.refs -= 1;
        if (active.refs <= 0) {
          URL.revokeObjectURL(active.url);
          imageUrlCache.delete(activeCacheKey);
        }
      };
    }

    setError(null);
    setExpired(false);
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
        imageUrlCache.set(cacheKey, { url: objUrl, refs: 1 });
        activeCacheKey = cacheKey;
        setExpired(false);
        setUrl(objUrl);
      } catch (loadError) {
        if (!mounted || abortController.signal.aborted) return;
        if (isChatImageExpiredError(loadError) || isPastChatImageRetentionWindow(messageTimestamp)) {
          setExpired(true);
          setError(null);
          return;
        }
        setError(getChatImageLoadErrorMessage(loadError));
      }
    })();

    return () => {
      mounted = false;
      abortController.abort();
      if (!activeCacheKey) return;
      const active = imageUrlCache.get(activeCacheKey);
      if (!active) return;
      active.refs -= 1;
      if (active.refs <= 0) {
        URL.revokeObjectURL(active.url);
        imageUrlCache.delete(activeCacheKey);
      }
    };
  }, [tag, parsed, messageTimestamp, retryNonce]);

  const openLightbox = useCallback(() => setLightboxOpen(true), []);
  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    window.requestAnimationFrame(() => imageTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!lightboxOpen) return;
    window.requestAnimationFrame(() => lightboxCloseRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxOpen, closeLightbox]);

  if (expired) return <div className="chat-image-expired">This image expired after 24 hours.</div>;
  if (error) {
    return (
      <div className="chat-image-error">
        <span>{error}</span>
        <button type="button" onClick={() => setRetryNonce((current) => current + 1)}>
          Retry
        </button>
      </div>
    );
  }
  if (!url) {
    return (
      <div className="chat-image-loading" role="status" aria-label="Decrypting image">
        <span>Decrypting image...</span>
      </div>
    );
  }

  return (
    <>
      <button
        ref={imageTriggerRef}
        type="button"
        className="chat-image-button"
        onClick={openLightbox}
        aria-label="Open image preview"
      >
        <img src={url} alt="Image" className="chat-image" />
      </button>
      {lightboxOpen ? (
        <div
          className="image-lightbox-backdrop"
          onClick={closeLightbox}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          <div className="image-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button
              ref={lightboxCloseRef}
              type="button"
              className="image-lightbox-close"
              onClick={closeLightbox}
              aria-label="Close image preview"
            >
              Close
            </button>
            <img src={url} alt="Image enlarged" />
          </div>
        </div>
      ) : null}
    </>
  );
}

export default memo(
  ChatImage,
  (previous, next) => previous.tag === next.tag && previous.messageTimestamp === next.messageTimestamp
);
