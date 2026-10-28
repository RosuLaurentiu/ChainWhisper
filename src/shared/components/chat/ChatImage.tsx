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
type LoadImageUrl = (signal: AbortSignal) => Promise<string>;
type CachedImage = {
  abortController: AbortController;
  promise: Promise<string>;
  refs: number;
  url: string | null;
};

export type CachedImageUrlLease = {
  promise: Promise<string>;
  release: () => void;
};

const imageUrlCache = new Map<string, CachedImage>();

export const acquireCachedImageUrl = (cacheKey: string, load: LoadImageUrl): CachedImageUrlLease => {
  let entry = imageUrlCache.get(cacheKey);
  if (!entry) {
    const abortController = new AbortController();
    const nextEntry: CachedImage = {
      abortController,
      promise: Promise.resolve().then(() => load(abortController.signal)),
      refs: 0,
      url: null
    };
    nextEntry.promise = nextEntry.promise
      .then((url) => {
        nextEntry.url = url;
        if (nextEntry.refs <= 0 || imageUrlCache.get(cacheKey) !== nextEntry) {
          nextEntry.url = null;
          URL.revokeObjectURL(url);
          if (imageUrlCache.get(cacheKey) === nextEntry) {
            imageUrlCache.delete(cacheKey);
          }
        }
        return url;
      })
      .catch((loadError: unknown) => {
        if (imageUrlCache.get(cacheKey) === nextEntry) {
          imageUrlCache.delete(cacheKey);
        }
        throw loadError;
      });
    imageUrlCache.set(cacheKey, nextEntry);
    entry = nextEntry;
  }

  const acquiredEntry = entry;
  acquiredEntry.refs += 1;
  let released = false;
  return {
    promise: acquiredEntry.promise,
    release: () => {
      if (released) return;
      released = true;
      acquiredEntry.refs -= 1;
      if (acquiredEntry.refs > 0) return;

      if (imageUrlCache.get(cacheKey) === acquiredEntry) {
        imageUrlCache.delete(cacheKey);
      }
      if (acquiredEntry.url) {
        const ownedUrl = acquiredEntry.url;
        acquiredEntry.url = null;
        URL.revokeObjectURL(ownedUrl);
      } else {
        acquiredEntry.abortController.abort();
      }
    }
  };
};

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
    setError(null);
    setExpired(false);
    setUrl(null);
    const lease = acquireCachedImageUrl(cacheKey, (signal) =>
      fetchAndDecryptToUrl(
        parsedTag.blobId,
        parsedTag.keyHex,
        parsedTag.ivHex,
        parsedTag.mime,
        signal
      )
    );

    (async () => {
      try {
        const objUrl = await lease.promise;
        if (!mounted) return;
        setExpired(false);
        setUrl(objUrl);
      } catch (loadError) {
        if (!mounted) return;
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
      lease.release();
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
