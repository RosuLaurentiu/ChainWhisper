import { useEffect, useState, useCallback, memo } from 'react';
import { parseImageTag, fetchAndDecryptToUrl, isChatImageExpiredError } from '../lib/imagePull';
import type { ParsedImageTag } from '../lib/imagePull';

type Props = { tag: string; parsed?: ParsedImageTag; messageTimestamp?: number };
type CachedImage = { url: string; refs: number };

const imageUrlCache = new Map<string, CachedImage>();
const CHAT_IMAGE_TTL_SECONDS = 24 * 60 * 60;

const createImageCacheKey = (parsed: ParsedImageTag): string =>
  `${parsed.blobId}|${parsed.keyHex}|${parsed.ivHex}|${parsed.mime}`;

const isPastImageRetentionWindow = (timestamp?: number): boolean =>
  typeof timestamp === 'number' &&
  Number.isFinite(timestamp) &&
  timestamp > 0 &&
  Math.floor(Date.now() / 1000) - timestamp >= CHAT_IMAGE_TTL_SECONDS;

function ChatImage({ tag, parsed, messageTimestamp }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

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
        if (isChatImageExpiredError(loadError) || isPastImageRetentionWindow(messageTimestamp)) {
          setExpired(true);
          setError(null);
          return;
        }
        setError('Unable to load image.');
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
  }, [tag, parsed, messageTimestamp]);

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

  if (expired) return <div className="chat-image-expired">This image expired after 24 hours.</div>;
  if (error) return <div className="chat-image-error">{error}</div>;
  if (!url) {
    return (
      <div className="chat-image-loading" role="status" aria-label="Decrypting image">
        <span>Decrypting image...</span>
      </div>
    );
  }

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

export default memo(
  ChatImage,
  (previous, next) => previous.tag === next.tag && previous.messageTimestamp === next.messageTimestamp
);
