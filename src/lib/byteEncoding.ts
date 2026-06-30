export const TEXT_ENCODER = new TextEncoder();
export const TEXT_DECODER = new TextDecoder();

export const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

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
