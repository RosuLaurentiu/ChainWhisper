export function parseImageTag(plaintext: string) {
  const m = /\[img:([0-9a-f-]+)\|([0-9a-f]+):([0-9a-f]+)\|(\d+)\|([a-z/+-]+)\]/i.exec(plaintext);
  if (!m) return null;
  const [, blobId, keyHex, ivHex, sizeBytes, mime] = m;
  return { blobId, keyHex, ivHex, sizeBytes: Number(sizeBytes), mime };
}

function hexToBytes(hex: string): Uint8Array {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) b[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return b;
}

const BASE_URL = 'https://api-ciphertrade.innovunode.io/';

export async function fetchEncryptedBlob(blobId: string): Promise<ArrayBuffer> {
  const resp = await fetch(`${BASE_URL}chat/blob/${encodeURIComponent(blobId)}`);
  if (!resp.ok) throw new Error(`Blob ${resp.status}`);
  return await resp.arrayBuffer();
}

export async function decryptBlobToObjectUrl(encrypted: ArrayBuffer, keyHex: string, ivHex: string, mime?: string): Promise<string> {
  const keyBuf = hexToBytes(keyHex).buffer;
  const ivBuf = hexToBytes(ivHex).buffer;
  const cryptoKey = await crypto.subtle.importKey('raw', keyBuf, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuf }, cryptoKey, encrypted);
  const blob = new Blob([pt], { type: mime ?? 'application/octet-stream' });
  return URL.createObjectURL(blob);
}

export async function fetchAndDecryptToUrl(blobId: string, keyHex: string, ivHex: string, mime?: string): Promise<string> {
  const encrypted = await fetchEncryptedBlob(blobId);
  return await decryptBlobToObjectUrl(encrypted, keyHex, ivHex, mime);
}
