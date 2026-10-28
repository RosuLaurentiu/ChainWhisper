import {
  getAddress,
  getBytes,
  hexlify,
  recoverAddress,
  solidityPacked,
  solidityPackedKeccak256,
  verifyMessage,
  type JsonRpcSigner
} from '@coti-io/coti-ethers';

export type AuthenticatedUint64Input = Readonly<{
  ciphertext: bigint;
  signature: string;
}>;

export type AuthenticatedUint64Request = Readonly<{
  plaintext: bigint;
  contractAddress: string;
  functionSelector: string;
}>;

const uint = (value: unknown, label: string): bigint => {
  try {
    const parsed = BigInt(value as bigint | number | string);
    if (parsed < 0n) throw new Error('negative');
    return parsed;
  } catch {
    throw new Error(`${label} is invalid.`);
  }
};

const signature = (value: unknown): string => {
  try {
    const normalized = hexlify(value as string | Uint8Array).toLowerCase();
    if (!/^0x[0-9a-f]{130}$/u.test(normalized)) throw new Error('length');
    return normalized;
  } catch {
    throw new Error('COTI returned an invalid authenticated-input signature.');
  }
};

export const encryptAuthenticatedUint64Input = async (
  signer: Pick<JsonRpcSigner, 'encryptValue' | 'getAddress'>,
  request: AuthenticatedUint64Request
): Promise<AuthenticatedUint64Input> => {
  if (!signer || typeof signer.encryptValue !== 'function' || typeof signer.getAddress !== 'function') {
    throw new Error('The selected wallet cannot prepare COTI private inputs.');
  }
  const encrypted = await signer.encryptValue(
    request.plaintext,
    request.contractAddress,
    request.functionSelector
  );
  if (!encrypted || typeof encrypted !== 'object' || !('ciphertext' in encrypted) || !('signature' in encrypted)) {
    throw new Error('COTI returned a malformed authenticated private input.');
  }
  const ciphertext = uint(encrypted.ciphertext, 'COTI authenticated ciphertext');
  const normalizedSignature = signature(encrypted.signature);
  const sender = getAddress(await signer.getAddress());
  const digest = solidityPackedKeccak256(
    ['address', 'address', 'bytes4', 'uint256'],
    [sender, request.contractAddress, request.functionSelector, ciphertext]
  );
  let recovered = '';
  try {
    recovered = getAddress(recoverAddress(digest, normalizedSignature));
  } catch {
  }
  if (recovered !== sender) {
    try {
      recovered = getAddress(verifyMessage(getBytes(solidityPacked(
        ['address', 'address', 'bytes4', 'uint256'],
        [sender, request.contractAddress, request.functionSelector, ciphertext]
      )), normalizedSignature));
    } catch {
      recovered = '';
    }
    if (recovered !== sender) {
      throw new Error(
        'This browser wallet cannot authenticate private inputs for the selected contract. No transaction was sent.'
      );
    }
  }
  return Object.freeze({ ciphertext, signature: normalizedSignature });
};
