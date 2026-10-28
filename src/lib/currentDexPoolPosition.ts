import { AbiCoder, Interface, getAddress } from '@coti-io/coti-ethers';
import { CurrentPoolProofMismatch } from './currentDexPoolProofError';
export const CURRENT_POOL_POSITION_ABI = [
  'function poolPublicState(uint256) view returns ((uint8 status,uint256 sourceId,uint256 bucket0Id,uint256 bucket1Id,uint256 positionRevision,uint256 ownershipRevision,uint256 lifecycleRevision,uint256 termsRevision,bytes32 context))',
  'function poolSnapshot(uint256) returns (bytes32,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext)[10])',
  'function managePoolPosition(uint256,bytes32,uint8,bytes)',
  'event PoolPositionChanged(uint256 indexed positionId,uint8 action,uint256 positionRevision)'
] as const;
export const CURRENT_POOL_NFT_ABI = ['function ownerOf(uint256) view returns(address)',
  'function balanceOf(address) view returns(uint256)', 'function getApproved(uint256) view returns(address)',
  'function safeTransferFrom(address,address,uint256)', 'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)'] as const;
export const currentPoolPositionAbi = new Interface(CURRENT_POOL_POSITION_ABI);
export const currentPoolNftAbi = new Interface(CURRENT_POOL_NFT_ABI);
export const CURRENT_POOL_OWNER_GAS_CAP = 30_000_000n;
const small = 'tuple(uint256 ciphertext,bytes signature)', wide = 'tuple(tuple(uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature)';
export const encodeCurrentPoolExit = (fraction: unknown[] | null, minimums: unknown[]) => AbiCoder.defaultAbiCoder().encode(
  fraction ? [`${small}[2]`, `${wide}[2]`] : [`${wide}[2]`], fraction ? [fraction, minimums] : [minimums]);
export const checkCurrentPoolPositionValues = (values: bigint[]) => {
  if (values.length !== 10 || values.some(value => typeof value !== 'bigint' || value < 0n || value >= 1n << 128n) ||
      values.slice(4, 9).some(value => value !== 0n) || values[9] >= 7n || values[2] > values[3]) {
    throw new CurrentPoolProofMismatch('Invalid private shared-Pool claim.');
  }
  return Object.freeze({ amount0: values[0], amount1: values[1], shares: values[2], totalShares: values[3], classId: values[9] });
};
export type CurrentPoolClaimAmounts = ReturnType<typeof checkCurrentPoolPositionValues>;
export type CurrentPoolOwnerAction = 'withdraw' | 'close' | 'activate' | 'resume' | 'transfer';
// Frozen 04ea/c7a EOA trial: app-owner-proof/ROOT_NATIVE_CHECKPOINT.md.
// These diagnostic limits are not measured gas or production certification.
export const currentPoolOwnerGasCap = (action: CurrentPoolOwnerAction) => {
  const limits = { withdraw: 100_000_000n, transfer: 10_000_000n,
    activate: CURRENT_POOL_OWNER_GAS_CAP, resume: CURRENT_POOL_OWNER_GAS_CAP, close: CURRENT_POOL_OWNER_GAS_CAP };
  if (!Object.prototype.hasOwnProperty.call(limits, action)) throw new Error('Unknown Pool owner action.');
  return limits[action];
};
export const currentPoolActionId = (action: Exclude<CurrentPoolOwnerAction, 'transfer'>) => ({ withdraw: 1n, close: 7n, activate: 6n, resume: 5n })[action];
export const decodeCurrentPoolNftTransfer = (logs: readonly {address:string;topics:readonly string[];data:string}[],
  nft: string, from: string, to: string, id: bigint) => {
  const matches = logs.filter(log => log.address.toLowerCase() === nft.toLowerCase() &&
    log.topics[0]?.toLowerCase() === currentPoolNftAbi.getEvent('Transfer')!.topicHash.toLowerCase()).map(log => {
    const parsed = currentPoolNftAbi.parseLog({topics:[...log.topics],data:log.data})!;
    const encoded = currentPoolNftAbi.encodeEventLog(parsed.fragment,parsed.args);
    if (encoded.data.toLowerCase() !== log.data.toLowerCase() || encoded.topics.length !== log.topics.length ||
        encoded.topics.some((topic,i)=>topic.toLowerCase() !== log.topics[i].toLowerCase())) throw new Error('Non-canonical position NFT event.');
    return parsed.args;
  });
  if (matches.length !== 1 || getAddress(matches[0].from) !== getAddress(from) || getAddress(matches[0].to) !== getAddress(to) || matches[0].tokenId !== id) {
    throw new Error('Position NFT transfer differs from the confirmed action.');
  }
};
