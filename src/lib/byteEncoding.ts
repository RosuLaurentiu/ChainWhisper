export const TEXT_ENCODER = new TextEncoder();
export const TEXT_DECODER = new TextDecoder();

export const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

export const encodeBase64Url = (value: string): string =>
  btoa(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

export const decodeBase64Url = (value: string): string => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return atob(`${normalized}${padding}`);
};

export const encodeBase64UrlBytes = (value: Uint8Array): string => {
  let binary = '';
  for (let index = 0; index < value.length; index += 1) {
    binary += String.fromCharCode(value[index]);
  }
  return encodeBase64Url(binary);
};

export const decodeBase64UrlBytes = (value: string): Uint8Array => {
  const binary = decodeBase64Url(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const bytesToBase64 = (value: Uint8Array): string => {
  let binary = '';
  for (let index = 0; index < value.length; index += 1) {
    binary += String.fromCharCode(value[index]);
  }
  return btoa(binary);
};

export const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const bytesToHex = (bytes: Uint8Array, prefix = ''): string =>
  `${prefix}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

export const hexToBytes = (value: string, errorMessage = 'Invalid hex data.'): Uint8Array => {
  const normalized = value.trim().replace(/^0x/i, '');
  if (normalized.length % 2 !== 0 || !/^[a-fA-F0-9]*$/.test(normalized)) {
    throw new Error(errorMessage);
  }

  return Uint8Array.from({ length: normalized.length / 2 }, (_value, index) =>
    Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16)
  );
};
