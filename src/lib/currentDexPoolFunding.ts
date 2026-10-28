import { CurrentPoolProofMismatch } from './currentDexPoolProofError';
import { AbiCoder, Interface, getAddress, hexlify } from '@coti-io/coti-ethers';

// Codec only. The owner capability must verify the candidate, canonical receipt
// and private decryption. These functions do not sign, send or grant authority.
const small = 'tuple(uint256 ciphertext,bytes signature)';
const wide = 'tuple(tuple(uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature)';
const createTypes = [small, `${wide}[2]`, `${small}[10]`];
const addTypes = [`${wide}[2]`, `${small}[2]`];
export const CURRENT_POOL_FUNDING_ABI = [
  'function previewPoolFunding(uint256 id,bytes data)',
  'function createPoolPosition(bytes32 expectedPreview,bytes data) returns(uint256)',
  'event PoolFundingPreviewed(uint256 indexed positionId,bytes32 context,(uint256 ciphertextHigh,uint256 ciphertextLow)[10] userValues)'
] as const;
// Explicit ABI profile: prepared build-6, graph 85767f8a. Never retry with the
// historical ABI after a failure. Market selection is part of preview/creation.
export const PREPARED_POOL_FUNDING_ABI = [
  'function previewPoolFunding(bytes32 selectedMarket,uint256 id,bytes data)',
  'function createPoolPosition(bytes32 selectedMarket,bytes32 expectedPreview,bytes data) returns(uint256)',
  'function managePoolPosition(uint256 id,bytes32 expected,uint8 action,bytes data)'
] as const;
const preparedAbi = new Interface(PREPARED_POOL_FUNDING_ABI);
const abi = new Interface(CURRENT_POOL_FUNDING_ABI), coder = AbiCoder.defaultAbiCoder();
const claimEvents = new Interface(['event SharedClaimCreated(uint256 indexed positionId)']);
const nftEvents = new Interface(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
export type PoolFundingInput = Readonly<{
  ciphertext: bigint | Readonly<{ ciphertextHigh: bigint; ciphertextLow: bigint }>;
  signature: string | Uint8Array;
}>;
const uint = (value: bigint) => {
  if (typeof value !== 'bigint' || value < 0n || value >= 1n << 256n) throw new Error('Invalid Pool funding integer.');
  return value;
};
const contextHash = (value: string) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || BigInt(value) === 0n) throw new Error('Invalid Pool preview context.');
  return value;
};
const normalize = (inputs: readonly PoolFundingInput[], positionId: bigint) => {
  uint(positionId);
  if (inputs.length !== (positionId === 0n ? 13 : 4)) throw new Error('Invalid Pool funding input count.');
  return inputs.map((input, i) => {
    const isWide = positionId === 0n ? i === 1 || i === 2 : i < 2;
    if (!input || !/^0x[0-9a-fA-F]{130}$/.test(hexlify(input.signature))) throw new Error('Invalid Pool funding signature.');
    const ciphertext = input.ciphertext;
    if (isWide) {
      if (!ciphertext || typeof ciphertext !== 'object') throw new Error('Invalid Pool funding limbs.');
      return { ciphertext: { ciphertextHigh: uint(ciphertext.ciphertextHigh), ciphertextLow: uint(ciphertext.ciphertextLow) }, signature: hexlify(input.signature) };
    }
    if (typeof ciphertext !== 'bigint') throw new Error('Invalid Pool funding ciphertext.');
    return { ciphertext: uint(ciphertext), signature: hexlify(input.signature) };
  });
};
const payload = (positionId: bigint, inputs: readonly PoolFundingInput[]) => {
  const fields = normalize(inputs, positionId);
  return positionId === 0n ? coder.encode(createTypes, [fields[0], fields.slice(1, 3), fields.slice(3)]) :
    coder.encode(addTypes, [fields.slice(0, 2), fields.slice(2)]);
};
const retainCiphertexts = (raw: string, positionId: bigint, resignedInputs: readonly PoolFundingInput[], validatePreview = false) => {
  const types = positionId === 0n ? createTypes : addTypes;
  const decoded = coder.decode(types, raw);
  if (coder.encode(types, decoded).toLowerCase() !== raw.toLowerCase()) throw new Error('Non-canonical Pool funding payload.');
  const before = positionId === 0n ? [decoded[0], ...decoded[1], ...decoded[2]] : [...decoded[0], ...decoded[1]];
  // Validate the original signatures and widths as well as the re-signed inputs.
  if (validatePreview) normalize(before, positionId);
  const after = normalize(resignedInputs, positionId);
  if (before.some((field, i) => typeof after[i].ciphertext === 'bigint' ? field.ciphertext !== after[i].ciphertext :
    field.ciphertext.ciphertextHigh !== (after[i].ciphertext as { ciphertextHigh: bigint }).ciphertextHigh ||
    field.ciphertext.ciphertextLow !== (after[i].ciphertext as { ciphertextLow: bigint }).ciphertextLow)) {
    throw new Error('Pool funding ciphertext differs from its preview.');
  }
  return payload(positionId, after);
};
export const encodeCurrentPoolFundingPreview = (positionId: bigint, inputs: readonly PoolFundingInput[]) =>
  abi.encodeFunctionData('previewPoolFunding', [positionId, payload(positionId, inputs)]);

// Funding must retain the preview ciphertexts. Only entry-point signatures change.
// Signature verification and the final state/context check belong to the wallet
// capability and Core, not this byte codec.
export const encodeCurrentPoolCreation = (previewData: string, context: string, resignedInputs: readonly PoolFundingInput[]) => {
  contextHash(context);
  const request = abi.decodeFunctionData('previewPoolFunding', previewData);
  if (request[0] !== 0n || abi.encodeFunctionData('previewPoolFunding', request).toLowerCase() !== previewData.toLowerCase()) {
    throw new Error('Pool creation needs a canonical new-position preview.');
  }
  return abi.encodeFunctionData('createPoolPosition', [context, retainCiphertexts(request[1], 0n, resignedInputs)]);
};

const selectedMarketHash = (value: string) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || BigInt(value) === 0n) throw new Error('Invalid Pool selected market.');
  return value;
};
export const encodePreparedPoolFundingPreview = (selectedMarket: string, positionId: bigint, inputs: readonly PoolFundingInput[]) =>
  preparedAbi.encodeFunctionData('previewPoolFunding', [selectedMarketHash(selectedMarket), positionId, payload(positionId, inputs)]);

const preparedFunding = (selectedMarket: string, positionId: bigint, previewData: string, resignedInputs: readonly PoolFundingInput[]) => {
  selectedMarketHash(selectedMarket); uint(positionId);
  const request = preparedAbi.decodeFunctionData('previewPoolFunding', previewData);
  if (request[0].toLowerCase() !== selectedMarket.toLowerCase() || request[1] !== positionId ||
    preparedAbi.encodeFunctionData('previewPoolFunding', request).toLowerCase() !== previewData.toLowerCase()) {
    throw new Error('Pool funding needs a canonical preview for the selected market and position.');
  }
  return retainCiphertexts(request[2], positionId, resignedInputs, true);
};
// Context provenance, canonical pair/candidate and owner/session authority must
// be checked by the capability. This codec checks context format only.
export const encodePreparedPoolCreation = (selectedMarket: string, previewData: string, previewContext: string,
  resignedInputs: readonly PoolFundingInput[]) => {
  contextHash(previewContext);
  return preparedAbi.encodeFunctionData('createPoolPosition', [selectedMarket, previewContext,
    preparedFunding(selectedMarket, 0n, previewData, resignedInputs)]);
};
export const encodePreparedPoolTopUp = (selectedMarket: string, positionId: bigint, previewData: string,
  previewContext: string, ownerContext: string, resignedInputs: readonly PoolFundingInput[]) => {
  uint(positionId);
  if (positionId === 0n) throw new Error('Pool top-up needs an existing position.');
  contextHash(previewContext); contextHash(ownerContext);
  const funding = preparedFunding(selectedMarket, positionId, previewData, resignedInputs);
  // Build-6 ChainWhisperPoolOwner.Action.TOP_UP = 0. Core selects the market from id.
  return preparedAbi.encodeFunctionData('managePoolPosition', [positionId, ownerContext, 0,
    coder.encode(['bytes32', 'bytes'], [previewContext, funding])]);
};

export const decodeCurrentPoolFundingEvent = (logs: readonly Readonly<{ address: string; topics: readonly string[]; data: string }>[], core: string, positionId: bigint) => {
  uint(positionId);
  const address = getAddress(core);
  if (BigInt(address) === 0n) throw new Error('Invalid Pool preview Core.');
  const topic = abi.getEvent('PoolFundingPreviewed')!.topicHash;
  const matching = logs.filter(log => getAddress(log.address) === address && log.topics[0]?.toLowerCase() === topic.toLowerCase());
  if (matching.length !== 1) throw new CurrentPoolProofMismatch('Pool preview needs one unique Core event.');
  const event = abi.parseLog({ topics: [...matching[0].topics], data: matching[0].data })!;
  const encoded = abi.encodeEventLog(event.fragment, event.args);
  if (event.args.positionId !== positionId || encoded.data.toLowerCase() !== matching[0].data.toLowerCase() ||
    encoded.topics.length !== matching[0].topics.length || encoded.topics.some((t, i) => t.toLowerCase() !== matching[0].topics[i].toLowerCase())) {
    throw new CurrentPoolProofMismatch('Non-canonical Pool preview event.');
  }
  return Object.freeze({ context: contextHash(event.args.context), encrypted: Object.freeze(event.args.userValues.map(
    (value: { ciphertextHigh: bigint; ciphertextLow: bigint }) => Object.freeze({ ciphertextHigh: uint(value.ciphertextHigh), ciphertextLow: uint(value.ciphertextLow) }))) });
};

export const decodeCurrentPoolClaimMint = (logs: readonly Readonly<{ address: string; topics: readonly string[]; data: string }>[], core: string, nft: string, owner: string) => {
  const unique = (at: string, decoder: Interface, name: string) => {
    const topic = decoder.getEvent(name)!.topicHash;
    const matching = logs.filter(log => getAddress(log.address) === getAddress(at) && log.topics[0]?.toLowerCase() === topic.toLowerCase());
    if (matching.length !== 1) throw new CurrentPoolProofMismatch('Pool funding needs one unique claim and NFT mint.');
    const event = decoder.parseLog({ topics: [...matching[0].topics], data: matching[0].data })!;
    const encoded = decoder.encodeEventLog(event.fragment, event.args);
    if (encoded.data.toLowerCase() !== matching[0].data.toLowerCase() || encoded.topics.length !== matching[0].topics.length ||
        encoded.topics.some((value, i) => value.toLowerCase() !== matching[0].topics[i].toLowerCase())) throw new CurrentPoolProofMismatch('Non-canonical Pool funding mint event.');
    return event.args;
  };
  const created = unique(core, claimEvents, 'SharedClaimCreated'), minted = unique(nft, nftEvents, 'Transfer');
  if (created.positionId < 8n || minted.tokenId !== created.positionId || BigInt(minted.from) !== 0n || getAddress(minted.to) !== getAddress(owner)) {
    throw new CurrentPoolProofMismatch('Pool funding NFT differs from its owner claim.');
  }
  return created.positionId as bigint;
};

// Values are already decrypted by the captured owner capability, never a public
// reserve read. Unmatched budgets remain in the wallet; they are not inactive LP funds.
export const checkCurrentPoolFundingValues = (values: readonly bigint[], expected: Readonly<{
  budgets: readonly [bigint, bigint]; tolerance: readonly [bigint, bigint]; classId: bigint;
}>) => {
  if (values.length !== 10) throw new CurrentPoolProofMismatch('Invalid Pool preview field count.');
  values.forEach(uint); expected.budgets.forEach(uint); expected.tolerance.forEach(uint); uint(expected.classId);
  const [mode, used0, used1, unused0, unused1, mintedShares, ownedShares, toleranceN, toleranceD, classId] = values;
  if (mode > 1n || classId >= 7n || classId !== expected.classId ||
    toleranceD === 0n || toleranceN > toleranceD || toleranceN !== expected.tolerance[0] || toleranceD !== expected.tolerance[1] ||
    used0 + unused0 !== expected.budgets[0] || used1 + unused1 !== expected.budgets[1] ||
    used0 === 0n || used1 === 0n || mintedShares === 0n || ownedShares < mintedShares || (mode === 0n && ownedShares !== mintedShares)) {
    throw new CurrentPoolProofMismatch('Pool preview differs from the captured funding intent.');
  }
  return Object.freeze({ operation: mode === 0n ? 'initialize' as const : 'add' as const,
    used0, used1, unused0, unused1, mintedShares, ownedShares, toleranceN, toleranceD, classId });
};
