import { AbiCoder, Interface, getAddress, hexlify, keccak256 } from '@coti-io/coti-ethers';
import { CurrentPoolProofMismatch } from './currentDexPoolProofError';
import type { PoolFundingInput } from './currentDexPoolFunding';

// New exit-preview profile only. This byte codec grants no candidate admission,
// signing or private proof. The build-6 deployment does not support these actions.
export const POOL_EXIT_PREVIEW_ACTION = 11n;
export const POOL_PREVIEWED_WITHDRAW_ACTION = 12n;
export const POOL_EXIT_PREVIEW_ABI = [
  'function managePoolPosition(uint256 id,bytes32 expected,uint8 action,bytes data)',
  'event PoolExitPreviewed(uint256 indexed positionId,bytes32 context,(uint256 ciphertextHigh,uint256 ciphertextLow)[6] userValues)'
] as const;
const abi = new Interface(POOL_EXIT_PREVIEW_ABI), coder = AbiCoder.defaultAbiCoder();
const small = 'tuple(uint256 ciphertext,bytes signature)', wide = 'tuple(tuple(uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature)';
const requireProof = (ok: boolean, message: string) => { if (!ok) throw new CurrentPoolProofMismatch(message); };
const uint = (value: bigint, bits = 256) => {
  requireProof(typeof value === 'bigint' && value >= 0n && value < 1n << BigInt(bits), 'Invalid Pool exit integer.'); return value;
};
const context = (value: string) => {
  requireProof(/^0x[0-9a-fA-F]{64}$/.test(value) && BigInt(value) !== 0n, 'Invalid Pool exit context.'); return value;
};
const position = (id: bigint) => { uint(id); requireProof(id >= 8n, 'Pool exit needs an owned claim NFT.'); return id; };
const inputs = (values: readonly PoolFundingInput[], isWide: boolean) => {
  requireProof(values.length === 2, 'Pool exit needs exactly two private inputs.');
  return values.map(value => {
    requireProof(!!value && /^0x[0-9a-fA-F]{130}$/.test(hexlify(value.signature)), 'Invalid Pool exit input signature.');
    if (isWide) {
      requireProof(typeof value.ciphertext === 'object' && value.ciphertext !== null, 'Invalid Pool exit wide ciphertext.');
      const c = value.ciphertext as { ciphertextHigh: bigint; ciphertextLow: bigint };
      return { ciphertext: { ciphertextHigh: uint(c.ciphertextHigh), ciphertextLow: uint(c.ciphertextLow) }, signature: hexlify(value.signature) };
    }
    requireProof(typeof value.ciphertext === 'bigint', 'Invalid Pool exit fraction ciphertext.');
    return { ciphertext: uint(value.ciphertext as bigint), signature: hexlify(value.signature) };
  });
};

export const encodePoolExitPreview = (id: bigint, ownerContext: string, fraction: readonly PoolFundingInput[]) =>
  abi.encodeFunctionData('managePoolPosition', [position(id), context(ownerContext), POOL_EXIT_PREVIEW_ACTION,
    coder.encode([`${small}[2]`], [inputs(fraction, false)])]);

const previewRequest = (previewData: string) => {
  const request = abi.decodeFunctionData('managePoolPosition', previewData);
  requireProof(abi.encodeFunctionData('managePoolPosition', request).toLowerCase() === previewData.toLowerCase() &&
    request[2] === POOL_EXIT_PREVIEW_ACTION, 'Pool withdrawal needs a canonical exit preview.');
  position(request[0]); context(request[1]);
  const decoded = coder.decode([`${small}[2]`], request[3]);
  requireProof(coder.encode([`${small}[2]`], decoded).toLowerCase() === request[3].toLowerCase(), 'Non-canonical Pool exit fraction payload.');
  const fraction = inputs([...decoded[0]], false);
  return { request, fraction };
};

export const encodePreviewedPoolWithdrawal = (previewData: string, previewContext: string, minimums: readonly PoolFundingInput[]) => {
  const { request, fraction } = previewRequest(previewData); context(previewContext);
  // Both calls use the same Core selector. Retain both exact fraction ciphertexts
  // and signatures; callers cannot replace the reviewed fraction here.
  return abi.encodeFunctionData('managePoolPosition', [request[0], request[1], POOL_PREVIEWED_WITHDRAW_ACTION,
    coder.encode(['bytes32', `${small}[2]`, `${wide}[2]`], [previewContext, fraction, inputs(minimums, true)])]);
};

// Exact exitContext ABI. The issuer must supply authenticated, block-pinned
// derivative storage and the reviewed call. This function grants no authority.
// Use inventory fields, not the anchor's rounded or stale snapshot fields.
export const computePoolExitPreviewContext = (previewData: string, baseline: Readonly<{
  chainId: bigint; core: string; releaseId: string; marketId: string; owner: string;
  marketWords: readonly string[]; anchors: readonly (readonly string[])[];
}>) => {
  const { request, fraction } = previewRequest(previewData);
  uint(baseline.chainId); requireProof(baseline.chainId > 0n, 'Invalid Pool exit chain.');
  const core = getAddress(baseline.core), owner = getAddress(baseline.owner);
  requireProof(BigInt(core) !== 0n && BigInt(owner) !== 0n, 'Invalid Pool exit actor.');
  context(baseline.releaseId); context(baseline.marketId);
  const words = baseline.marketWords;
  const canonicalWords = (values: readonly string[]) => values.every(v => /^0x[0-9a-fA-F]{64}$/.test(v));
  requireProof(words.length === 71 && canonicalWords(words) && words[0].toLowerCase() === baseline.releaseId.toLowerCase() &&
    words[1].toLowerCase() === baseline.marketId.toLowerCase() && baseline.anchors.length === 7 &&
    baseline.anchors.every((a, i) => a.length === 64 && canonicalWords(a) && BigInt(a[0]) === 1n &&
      BigInt(a[59]) === 0n && BigInt(a[62]) === BigInt(i)), 'Pool exit reserve scope changed.');
  const commitment = keccak256(coder.encode(['uint256', 'uint256'], fraction.map(f => f.ciphertext)));
  let result = keccak256(coder.encode(['string', 'uint256', 'address', 'bytes32', 'bytes32', 'address', 'uint256', 'bytes32'],
    ['chainwhisper.shared-exit-preview.v1', baseline.chainId, core, baseline.releaseId, baseline.marketId, owner, request[0], commitment]));
  result = keccak256(coder.encode(['bytes32', 'bytes32'], [result, request[1]]));
  const cipher = 'tuple(uint256 ciphertextHigh,uint256 ciphertextLow)';
  baseline.anchors.forEach((a, i) => {
    result = keccak256(coder.encode(['bytes32', cipher, cipher, cipher, 'uint256', 'uint256'],
      [result, [BigInt(a[8]), BigInt(a[9])], [BigInt(a[10]), BigInt(a[11])],
        [BigInt(words[25 + i * 2]), BigInt(words[26 + i * 2])], BigInt(a[4]), BigInt(a[7])]));
  });
  return result;
};

export const decodePoolExitPreviewEvent = (logs: readonly Readonly<{ address: string; topics: readonly string[]; data: string }>[],
  core: string, id: bigint) => {
  position(id); const at = getAddress(core); requireProof(BigInt(at) !== 0n, 'Invalid Pool exit Core.');
  const topic = abi.getEvent('PoolExitPreviewed')!.topicHash;
  const matching = logs.filter(log => getAddress(log.address) === at && log.topics[0]?.toLowerCase() === topic.toLowerCase());
  requireProof(matching.length === 1, 'Pool exit needs one unique Core preview event.');
  const log = matching[0], event = abi.parseLog({ topics: [...log.topics], data: log.data })!;
  const encoded = abi.encodeEventLog(event.fragment, event.args);
  requireProof(event.args.positionId === id && encoded.data.toLowerCase() === log.data.toLowerCase() &&
    encoded.topics.length === log.topics.length && encoded.topics.every((t, i) => t.toLowerCase() === log.topics[i].toLowerCase()),
  'Non-canonical Pool exit preview event.');
  return Object.freeze({ context: context(event.args.context), encrypted: Object.freeze(event.args.userValues.map(
    (c: { ciphertextHigh: bigint; ciphertextLow: bigint }) => Object.freeze({ ciphertextHigh: uint(c.ciphertextHigh), ciphertextLow: uint(c.ciphertextLow) }))) });
};

// Call only with six authenticated owner-decrypted preview fields. Entitlements
// bound the payout; they cannot determine it. Canonical receipt, program identity,
// owner/session and current reserve commitments remain the issuer's responsibility.
export const checkPoolExitPreviewValues = (values: readonly bigint[], expected: Readonly<{
  ownedShares: bigint; totalShares: bigint; entitlements: readonly [bigint, bigint]; fraction: readonly [bigint, bigint];
}>) => {
  requireProof(values.length === 6 && expected.entitlements.length === 2 && expected.fraction.length === 2, 'Invalid Pool exit preview field count.');
  [...values, expected.ownedShares, expected.totalShares, ...expected.entitlements, ...expected.fraction].forEach(v => uint(v, 128));
  const [amount0, amount1, burnedShares, remainingShares, numerator, denominator] = values;
  requireProof(numerator === expected.fraction[0] && denominator === expected.fraction[1] && numerator > 0n && numerator < denominator &&
    expected.ownedShares <= expected.totalShares, 'Pool exit preview fraction or share baseline changed.');
  requireProof(burnedShares === expected.ownedShares * numerator / denominator && burnedShares > 0n && burnedShares < expected.ownedShares &&
    remainingShares === expected.ownedShares - burnedShares, 'Pool exit preview shares changed.');
  requireProof((amount0 > 0n || amount1 > 0n) && amount0 <= expected.entitlements[0] && amount1 <= expected.entitlements[1], 'Pool exit preview payout is outside its owned entitlement.');
  return Object.freeze({ amount0, amount1, burnedShares, remainingShares, numerator, denominator });
};
export type PoolExitPreviewAmounts = ReturnType<typeof checkPoolExitPreviewValues>;
