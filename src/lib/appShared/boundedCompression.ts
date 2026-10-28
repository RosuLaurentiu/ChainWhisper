import { Unzlib } from 'fflate';

const COMPRESSED_INPUT_CHUNK_BYTES = 32;

export class BoundedDecompressionError extends Error {
  constructor(maxOutputBytes: number) {
    super(`Compressed payload exceeds the ${maxOutputBytes}-byte output limit.`);
    this.name = 'BoundedDecompressionError';
  }
}

export const unzlibBounded = (
  compressedBytes: Uint8Array,
  maxOutputBytes: number
): Uint8Array => {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
    throw new RangeError('The decompression output limit must be a non-negative safe integer.');
  }

  const chunks: Uint8Array[] = [];
  let outputLength = 0;
  const inflater = new Unzlib((chunk) => {
    if (chunk.length > maxOutputBytes - outputLength) {
      throw new BoundedDecompressionError(maxOutputBytes);
    }

    outputLength += chunk.length;
    chunks.push(chunk.slice());
  });

  if (compressedBytes.length === 0) {
    inflater.push(compressedBytes, true);
  } else {
    for (let offset = 0; offset < compressedBytes.length; offset += COMPRESSED_INPUT_CHUNK_BYTES) {
      const end = Math.min(offset + COMPRESSED_INPUT_CHUNK_BYTES, compressedBytes.length);
      inflater.push(compressedBytes.subarray(offset, end), end === compressedBytes.length);
    }
  }

  const output = new Uint8Array(outputLength);
  let outputOffset = 0;
  for (const chunk of chunks) {
    output.set(chunk, outputOffset);
    outputOffset += chunk.length;
  }
  return output;
};
