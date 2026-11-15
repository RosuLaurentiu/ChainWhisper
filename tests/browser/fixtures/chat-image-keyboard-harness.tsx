import { createRoot } from 'react-dom/client';
import ChatImage, { acquireCachedImageUrl } from '../../../src/shared/components/chat/ChatImage';
import '../../../src/styles.css';

const parsed = { blobId: 'keyboard-fixture', keyHex: '00'.repeat(32), ivHex: '00'.repeat(12), sizeBytes: 1, mime: 'image/svg+xml' };
const cacheKey = `${parsed.blobId}|${parsed.keyHex}|${parsed.ivHex}|${parsed.mime}`;
// Use the real component and cache without attachment, wallet or network access.
acquireCachedImageUrl(cacheKey, async () => URL.createObjectURL(new Blob([
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="purple"/></svg>'
], { type: parsed.mime })));

createRoot(document.getElementById('root')!).render(
  <main>
    <ChatImage tag="keyboard-fixture" parsed={parsed} />
    <button type="button">Background action</button>
  </main>
);
