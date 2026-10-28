import { AbiCoder, Contract, Interface, getAddress, type JsonRpcSigner } from '@coti-io/coti-ethers';
import { decryptUint } from '@coti-io/coti-sdk-typescript';
import {
  ensureTradeTokenAllowance,
  type SuccessorAggregateOwnerTerms,
  type SuccessorDexPositionState,
  type SuccessorRecurringOwnerTerms
} from './appChain';
import { encryptAuthenticatedUint64Input } from './authenticatedUint64';
import { parseDexV2TokenAmountToLots, scaleDexV2LotsToRaw } from './dexV2Terms';
import type { SuccessorDexManifest, SuccessorDexPair } from './successorDexDeployment';
import { buildAggregatePolicy, successorStrategyDisplayedPriceToPriceQ } from './successorDexStrategies';
import { SUCCESSOR_DEX_GAS_LIMIT } from './successorDexSwap';

const ABI = Object.freeze([
  'function reencryptMyPositionTerms(uint256 positionId,uint64 expectedOwnershipRevision) returns(bytes)',
  'function topUpFixedLimit(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature) amount)',
  'function repriceFixedLimit(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature) privateTerms,(uint256 ciphertext,bytes signature) minimumOutput)',
  'function topUpRange(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature) amount)',
  'function repriceRange(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature) privateTerms,(uint256 ciphertext,bytes signature) endPriceQ,(uint256 ciphertext,bytes signature) minimumOutput)',
  'function claimFixedLimitProceeds(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision)',
  'function claimRangeProceeds(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision)',
  'function partialExitFixedLimit(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature) requestedPrincipal)',
  'function partialExitRange(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature) requestedPrincipal,(uint256 ciphertext,bytes signature) privateTerms,(uint256 ciphertext,bytes signature) endPriceQ,(uint256 ciphertext,bytes signature) minimumOutput)',
  'function topUpPosition(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature) maximum0,(uint256 ciphertext,bytes signature) maximum1)',
  'function repricePosition(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature) hiddenLaneMode,(uint256 ciphertext,bytes signature) hiddenTarget,(uint256 ciphertext,bytes signature)[7] hiddenPolicy)',
  'function partialExitPosition(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature) requestedShares)',
  'function withdrawCountersPosition(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature)[4] requestedCounters)',
  'function topUpRecurring(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature)[2] amounts)',
  'function repriceRecurringLl(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature) legMask,(uint256 ciphertext,bytes signature) policyTerms,(uint256 ciphertext,bytes signature) minimumOutput,(uint256 ciphertext,bytes signature) threshold,(uint256 ciphertext,bytes signature) nextMinimum)',
  'function repriceRecurringRr(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature) legMask,(uint256 ciphertext,bytes signature) policyTerms,(uint256 ciphertext,bytes signature) endPrice,(uint256 ciphertext,bytes signature) minimumOutput,(uint256 ciphertext,bytes signature) threshold,(uint256 ciphertext,bytes signature) nextMinimum)',
  'function withdrawRecurring(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature)[2] requested)',
  'function setRecurringPaused(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision,bool paused)',
  'function finalExitPosition(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision)',
  'function finalExitFixedLimit(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision)',
  'function finalExitRange(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision)',
  'function finalExitRecurring(uint256 positionId,uint64 expectedOwnershipRevision,uint64 expectedPositionRevision)'
] as const);

const HOST_ABI = Object.freeze([
  'function topUpFixedLimit(uint256 positionId,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature) amount)',
  'function repriceFixedLimit(uint256 positionId,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature) privateTerms,(uint256 ciphertext,bytes signature) minimumOutput)',
  'function partialExitFixedLimit(uint256 positionId,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature) requestedPrincipal)',
  'function topUpRange(uint256 positionId,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature) amount)',
  'function repriceRange(uint256 positionId,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature) privateTerms,(uint256 ciphertext,bytes signature) endPriceQ,(uint256 ciphertext,bytes signature) minimumOutput)',
  'function partialExitRange(uint256 positionId,uint64 expectedPositionRevision,(uint256 ciphertext,bytes signature) requestedPrincipal,(uint256 ciphertext,bytes signature) privateTerms,(uint256 ciphertext,bytes signature) endPriceQ,(uint256 ciphertext,bytes signature) minimumOutput)'
] as const);

const AGGREGATE_HOST_ABI = Object.freeze([
  'function topUpAggregatePositionModule(uint256 positionId,(uint256 ciphertext,bytes signature) maximum0,(uint256 ciphertext,bytes signature) maximum1)',
  'function repriceAggregatePositionModule(uint256 positionId,(uint256 ciphertext,bytes signature) hiddenLaneMode,(uint256 ciphertext,bytes signature) hiddenTarget,(uint256 ciphertext,bytes signature)[7] hiddenPolicy)',
  'function partialExitAggregatePositionModule(uint256 positionId,(uint256 ciphertext,bytes signature) requestedShares)',
  'function withdrawAggregateCountersModule(uint256 positionId,(uint256 ciphertext,bytes signature)[4] requestedCounters)'
] as const);

const RECURRING_HOST_ABI = Object.freeze([
  'function topUp(uint256 positionId,uint64 expectedRevision,(uint256 ciphertext,bytes signature)[2] amounts)',
  'function repriceLl(uint256 positionId,uint64 expectedRevision,(uint256 ciphertext,bytes signature) legMask,(uint256 ciphertext,bytes signature) policyTerms,(uint256 ciphertext,bytes signature) minimumOutput,(uint256 ciphertext,bytes signature) threshold,(uint256 ciphertext,bytes signature) nextMinimum)',
  'function repriceRr(uint256 positionId,uint64 expectedRevision,(uint256 ciphertext,bytes signature) legMask,(uint256 ciphertext,bytes signature) policyTerms,(uint256 ciphertext,bytes signature) endPrice,(uint256 ciphertext,bytes signature) minimumOutput,(uint256 ciphertext,bytes signature) threshold,(uint256 ciphertext,bytes signature) nextMinimum)',
  'function withdraw(uint256 positionId,uint64 expectedRevision,(uint256 ciphertext,bytes signature)[2] requested)'
] as const);

const POSITION_NFT_ABI = Object.freeze([
  'function safeTransferFrom(address from,address to,uint256 tokenId)'
] as const);

const TERMS = AbiCoder.defaultAbiCoder();
const HOST = new Interface(HOST_ABI);
const AGGREGATE_HOST = new Interface(AGGREGATE_HOST_ABI);
const RECURRING_HOST = new Interface(RECURRING_HOST_ABI);
const MAX_LOTS = (1n << 20n) - 1n;
const MAX_PRICE_Q = 100_000_000_000n;
const UINT64_MAX = (1n << 64n) - 1n;

export type SuccessorFixedPositionTerms = Readonly<{
  actionCount: number;
  family: 'Fixed';
  inventory0Lots: bigint;
  inventory1Lots: bigint;
  minimumOutputLots: bigint;
  positionId: string;
  priceQ: bigint;
  revision: number;
  side: 0 | 1;
}>;

export type SuccessorRangePositionTerms = Readonly<{
  actionCount: number;
  endPriceQ: bigint;
  family: 'Range';
  initialOutputLots: bigint;
  inventory0Lots: bigint;
  inventory1Lots: bigint;
  minimumOutputLots: bigint;
  positionId: string;
  revision: number;
  side: 0 | 1;
  startPriceQ: bigint;
}>;

export type SuccessorPrivatePositionTerms =
  | SuccessorAggregateOwnerTerms
  | SuccessorFixedPositionTerms
  | SuccessorRangePositionTerms
  | SuccessorRecurringOwnerTerms;

export type SuccessorPositionEdit =
  | Readonly<{ kind: 'top-up'; amount: string }>
  | Readonly<{ kind: 'partial-exit-fixed'; amount: string }>
  | Readonly<{
      kind: 'partial-exit-range';
      amount: string;
      displayedStartPrice: string;
      displayedEndPrice: string;
      minimumOutput: string;
    }>
  | Readonly<{ kind: 'reprice-fixed'; displayedPrice: string; minimumOutput: string }>
  | Readonly<{ kind: 'reprice-range'; displayedStartPrice: string; displayedEndPrice: string; minimumOutput: string }>
  | Readonly<{ kind: 'top-up-aggregate'; amount0: string; amount1: string }>
  | Readonly<{ kind: 'reprice-aggregate'; displayedMidpoint: string; totalSpreadPercent: string }>
  | Readonly<{ kind: 'partial-exit-aggregate'; shares: string }>
  | Readonly<{ kind: 'withdraw-aggregate-counters'; amounts: readonly [string, string, string, string] }>
  | Readonly<{ kind: 'top-up-recurring'; amount0: string; amount1: string }>
  | Readonly<{
      kind: 'reprice-recurring';
      leg: 0 | 1;
      displayedStartPrice: string;
      displayedEndPrice: string;
      minimumOutput: string;
      threshold: string;
      nextMinimum: string;
    }>
  | Readonly<{ kind: 'withdraw-recurring'; amount0: string; amount1: string }>;

const positionPair = (
  manifest: SuccessorDexManifest,
  position: Pick<SuccessorDexPositionState, 'marketKey'>
): SuccessorDexPair => {
  const pair = manifest.pairs.find(({ marketKey }) => marketKey.toLowerCase() === position.marketKey.toLowerCase());
  if (!pair) throw new Error('Position canonical market is missing from the successor manifest.');
  return pair;
};

const positionHost = (
  manifest: SuccessorDexManifest,
  pair: SuccessorDexPair,
  family: SuccessorDexPositionState['family']
) => {
  const binding = pair.admissionAdapters[family];
  const hostRoleKey = binding?.adapterRoleKey.replace(/-adapter$/u, '-host');
  const host = hostRoleKey ? manifest.contracts[hostRoleKey] : null;
  if (!binding || !host) throw new Error(`${family} position host is missing from the successor manifest.`);
  return host.address;
};

const tokenAt = (manifest: SuccessorDexManifest, address: string) => {
  const selected = manifest.tokens.find((token) => token.address.toLowerCase() === address.toLowerCase());
  if (!selected) throw new Error('Position token is missing from the successor manifest.');
  return selected;
};

const amountLots = (
  value: string,
  token: SuccessorDexManifest['tokens'][number],
  allowZero = false
) => {
  if (allowZero && value === '0') return 0n;
  const parsed = parseDexV2TokenAmountToLots(value, token.decimals, BigInt(token.lotSizeRaw));
  if (parsed > MAX_LOTS) throw new Error('Position amount exceeds the private-lot limit.');
  return parsed;
};

const uint64Input = (value: string, label: string, allowZero = false) => {
  if (value !== value.trim() || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  const parsed = BigInt(value);
  if ((!allowZero && parsed === 0n) || parsed > UINT64_MAX) throw new Error(`${label} is invalid.`);
  return parsed;
};

const percentage = (value: string, label: string) => {
  if (value !== value.trim() || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid.`);
  return parsed;
};

const validCommonTerms = (
  values: readonly bigint[],
  revision: number,
  actionCount: number
) =>
  values.every((value) => value >= 0n && value <= MAX_LOTS) &&
  Number.isSafeInteger(revision) && revision >= 1 &&
  Number.isSafeInteger(actionCount) && actionCount >= 1;

export const decodeSuccessorFixedPositionTerms = ({
  decrypt,
  encoded,
  positionId
}: {
  decrypt: (userCiphertext: bigint) => bigint;
  encoded: string;
  positionId: string;
}): SuccessorFixedPositionTerms => {
  const [decoded] = TERMS.decode([
    'tuple(uint256[5] userCiphertexts,uint64 revision,uint64 actionCount)'
  ], encoded);
  const ciphertexts = Array.from(decoded.userCiphertexts ?? decoded[0], (value) => BigInt(value as bigint));
  if (ciphertexts.length !== 5) throw new Error('Fixed position terms are incomplete.');
  const [side, priceQ, inventory0Lots, inventory1Lots, minimumOutputLots] = ciphertexts.map(decrypt);
  const revision = Number(decoded.revision ?? decoded[1]);
  const actionCount = Number(decoded.actionCount ?? decoded[2]);
  if ((side !== 0n && side !== 1n) || priceQ === 0n || priceQ > MAX_PRICE_Q ||
      [inventory0Lots, inventory1Lots, minimumOutputLots].some((value) => value < 0n || value > MAX_LOTS) ||
      !Number.isSafeInteger(revision) || revision < 1 ||
      !Number.isSafeInteger(actionCount) || actionCount < 1) {
    throw new Error('Fixed position terms failed validation.');
  }
  return Object.freeze({
    actionCount,
    family: 'Fixed',
    inventory0Lots,
    inventory1Lots,
    minimumOutputLots,
    positionId,
    priceQ,
    revision,
    side: Number(side) as 0 | 1
  });
};

export const decodeSuccessorRangePositionTerms = ({
  decrypt,
  encoded,
  positionId
}: {
  decrypt: (userCiphertext: bigint) => bigint;
  encoded: string;
  positionId: string;
}): SuccessorRangePositionTerms => {
  const [decoded] = TERMS.decode([
    'tuple(uint256[7] userCiphertexts,uint64 revision,uint64 actionCount)'
  ], encoded);
  const ciphertexts = Array.from(decoded.userCiphertexts ?? decoded[0], (value) => BigInt(value as bigint));
  if (ciphertexts.length !== 7) throw new Error('Range position terms are incomplete.');
  const [
    side,
    startPriceQ,
    endPriceQ,
    initialOutputLots,
    inventory0Lots,
    inventory1Lots,
    minimumOutputLots
  ] = ciphertexts.map(decrypt);
  const revision = Number(decoded.revision ?? decoded[1]);
  const actionCount = Number(decoded.actionCount ?? decoded[2]);
  const offeredInventoryLots = side === 0n ? inventory0Lots : inventory1Lots;
  if ((side !== 0n && side !== 1n) ||
      startPriceQ === 0n || startPriceQ > MAX_PRICE_Q ||
      endPriceQ === 0n || endPriceQ > MAX_PRICE_Q ||
      (side === 0n ? endPriceQ > startPriceQ : endPriceQ < startPriceQ) ||
      offeredInventoryLots > initialOutputLots ||
      !validCommonTerms(
        [initialOutputLots, inventory0Lots, inventory1Lots, minimumOutputLots],
        revision,
        actionCount
      )) {
    throw new Error('Range position terms failed validation.');
  }
  return Object.freeze({
    actionCount,
    endPriceQ,
    family: 'Range',
    initialOutputLots,
    inventory0Lots,
    inventory1Lots,
    minimumOutputLots,
    positionId,
    revision,
    side: Number(side) as 0 | 1,
    startPriceQ
  });
};

const reencryptSuccessorPositionTerms = async ({
  expectedOwner,
  expectedOwnershipRevision,
  manifest,
  positionId,
  signer
}: {
  expectedOwner: string;
  expectedOwnershipRevision: number;
  manifest: SuccessorDexManifest;
  positionId: string;
  signer: JsonRpcSigner;
}) => {
  const authorityAddress = manifest.contracts['work-authority']?.address;
  if (!authorityAddress) throw new Error('Successor work authority is missing.');
  if (!Number.isSafeInteger(expectedOwnershipRevision) || expectedOwnershipRevision < 1) {
    throw new Error('Position ownership revision is unavailable. Refresh the position.');
  }
  if (getAddress(await signer.getAddress()) !== getAddress(expectedOwner)) {
    throw new Error('Only the current Position NFT owner can reveal these terms.');
  }
  const aesKey = signer.getUserOnboardInfo()?.aesKey?.trim();
  if (!aesKey) throw new Error('Unlock privacy before revealing position terms.');
  const authority = new Contract(authorityAddress, ABI, signer);
  const reencrypt = authority.getFunction('reencryptMyPositionTerms');
  const encoded = await reencrypt.staticCall(
    BigInt(positionId),
    BigInt(expectedOwnershipRevision)
  );
  return Object.freeze({ aesKey, encoded: String(encoded) });
};

export const revealSuccessorFixedPositionTerms = async ({
  expectedOwner,
  expectedOwnershipRevision,
  manifest,
  positionId,
  signer
}: {
  expectedOwner: string;
  expectedOwnershipRevision: number;
  manifest: SuccessorDexManifest;
  positionId: string;
  signer: JsonRpcSigner;
}): Promise<SuccessorFixedPositionTerms> => {
  const { aesKey, encoded } = await reencryptSuccessorPositionTerms({
    expectedOwner,
    expectedOwnershipRevision,
    manifest,
    positionId,
    signer
  });
  return decodeSuccessorFixedPositionTerms({
    encoded,
    positionId,
    decrypt: (userCiphertext) => BigInt(decryptUint(userCiphertext, aesKey))
  });
};

export const revealSuccessorRangePositionTerms = async ({
  expectedOwner,
  expectedOwnershipRevision,
  manifest,
  positionId,
  signer
}: {
  expectedOwner: string;
  expectedOwnershipRevision: number;
  manifest: SuccessorDexManifest;
  positionId: string;
  signer: JsonRpcSigner;
}): Promise<SuccessorRangePositionTerms> => {
  const { aesKey, encoded } = await reencryptSuccessorPositionTerms({
    expectedOwner,
    expectedOwnershipRevision,
    manifest,
    positionId,
    signer
  });
  return decodeSuccessorRangePositionTerms({
    encoded,
    positionId,
    decrypt: (userCiphertext) => BigInt(decryptUint(userCiphertext, aesKey))
  });
};

const displayedPrice = (value: string, label: string) => {
  if (value !== value.trim() || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} is invalid.`);
  return parsed;
};

const encryptInputs = async (
  signer: JsonRpcSigner,
  contractAddress: string,
  functionSelector: string,
  plaintexts: readonly bigint[]
) => {
  const encrypted = [];
  for (const plaintext of plaintexts) encrypted.push(await encryptAuthenticatedUint64Input(signer, {
    plaintext,
    contractAddress,
    functionSelector
  }));
  return encrypted;
};

export const submitSuccessorPositionEdit = async ({
  edit,
  manifest,
  position,
  privateTerms,
  signer
}: {
  edit: SuccessorPositionEdit;
  manifest: SuccessorDexManifest;
  position: Pick<SuccessorDexPositionState, 'family' | 'marketKey' | 'owner' | 'ownershipRevision' | 'positionId'>;
  privateTerms: SuccessorPrivatePositionTerms;
  signer: JsonRpcSigner;
}): Promise<Readonly<{ transactionHash: string }>> => {
  if (privateTerms.family !== position.family || privateTerms.positionId !== position.positionId) {
    throw new Error('The revealed terms do not match this editable position. Reveal them again.');
  }
  if (!Number.isSafeInteger(position.ownershipRevision) || position.ownershipRevision < 1 ||
      !Number.isSafeInteger(privateTerms.revision) || privateTerms.revision < 1) {
    throw new Error('Position revisions are unavailable. Refresh and reveal the position again.');
  }
  const owner = getAddress(await signer.getAddress());
  if (owner !== getAddress(position.owner)) throw new Error('Only the current Position NFT owner can edit these terms.');
  const authorityAddress = manifest.contracts['work-authority']?.address;
  if (!authorityAddress) throw new Error('Successor work authority is missing.');
  const pair = positionPair(manifest, position);
  const hostAddress = positionHost(manifest, pair, position.family);
  const token0 = tokenAt(manifest, pair.token0);
  const token1 = tokenAt(manifest, pair.token1);
  const authority = new Contract(authorityAddress, ABI, signer);

  if (privateTerms.family === 'Aggregate') {
    let method: 'topUpPosition' | 'repricePosition' | 'partialExitPosition' | 'withdrawCountersPosition';
    let args: unknown[];
    if (edit.kind === 'top-up-aggregate') {
      const amount0 = amountLots(edit.amount0, token0, true);
      const amount1 = amountLots(edit.amount1, token1, true);
      if (amount0 === 0n && amount1 === 0n) throw new Error('Enter at least one Aggregate top-up amount.');
      if (privateTerms.principal0Lots + amount0 > MAX_LOTS || privateTerms.principal1Lots + amount1 > MAX_LOTS) {
        throw new Error('Aggregate top-up exceeds the position inventory limit.');
      }
      method = 'topUpPosition';
      const selector = AGGREGATE_HOST.getFunction('topUpAggregatePositionModule')!.selector;
      const encrypted = await encryptInputs(signer, hostAddress, selector, [amount0, amount1]);
      if (amount0 > 0n) await ensureTradeTokenAllowance(
        signer, owner, token0.address, scaleDexV2LotsToRaw(amount0, BigInt(token0.lotSizeRaw)),
        'private-erc20', manifest.globalCore
      );
      if (amount1 > 0n) await ensureTradeTokenAllowance(
        signer, owner, token1.address, scaleDexV2LotsToRaw(amount1, BigInt(token1.lotSizeRaw)),
        'private-erc20', manifest.globalCore
      );
      args = [...encrypted];
    } else if (edit.kind === 'reprice-aggregate') {
      const policy = buildAggregatePolicy({
        manifest,
        pair,
        amount0: privateTerms.principal0Lots,
        amount1: privateTerms.principal1Lots,
        startingPrice: displayedPrice(edit.displayedMidpoint, 'Aggregate midpoint'),
        totalSpreadPercent: percentage(edit.totalSpreadPercent, 'Aggregate spread')
      });
      method = 'repricePosition';
      const selector = AGGREGATE_HOST.getFunction('repriceAggregatePositionModule')!.selector;
      const encrypted = await encryptInputs(
        signer,
        hostAddress,
        selector,
        [BigInt(privateTerms.laneMode), privateTerms.targetLots, ...policy.policy]
      );
      args = [encrypted[0], encrypted[1], encrypted.slice(2)];
    } else if (edit.kind === 'partial-exit-aggregate') {
      const shares = uint64Input(edit.shares, 'Aggregate exit shares');
      if (shares >= privateTerms.totalMemberShares) {
        throw new Error('Partial exit shares must be below the current member shares. Use Exit position for a full exit.');
      }
      method = 'partialExitPosition';
      const selector = AGGREGATE_HOST.getFunction('partialExitAggregatePositionModule')!.selector;
      args = await encryptInputs(signer, hostAddress, selector, [shares]);
    } else if (edit.kind === 'withdraw-aggregate-counters') {
      const accrued = [privateTerms.accrued0, privateTerms.accrued1, privateTerms.accrued2, privateTerms.accrued3];
      const amounts = edit.amounts.map((value, index) => uint64Input(value, `Aggregate flow counter ${index + 1}`, true));
      if (amounts.every((value) => value === 0n)) throw new Error('Enter at least one Aggregate flow-counter amount.');
      if (amounts.some((value, index) => value > accrued[index])) {
        throw new Error('Aggregate flow-counter amount exceeds the current accrued value.');
      }
      method = 'withdrawCountersPosition';
      const selector = AGGREGATE_HOST.getFunction('withdrawAggregateCountersModule')!.selector;
      args = [await encryptInputs(signer, hostAddress, selector, amounts)];
    } else {
      throw new Error(`The ${edit.kind} edit does not match this Aggregate position.`);
    }
    const transaction = await authority.getFunction(method)(
      BigInt(position.positionId), BigInt(position.ownershipRevision), BigInt(privateTerms.revision),
      ...args, { gasLimit: SUCCESSOR_DEX_GAS_LIMIT }
    );
    const receipt = await transaction.wait(1);
    if (!receipt || receipt.status !== 1) throw new Error(`Position ${edit.kind} failed.`);
    return Object.freeze({ transactionHash: transaction.hash });
  }

  if (privateTerms.family === 'Recurring') {
    let method: 'topUpRecurring' | 'repriceRecurringLl' | 'repriceRecurringRr' | 'withdrawRecurring';
    let args: unknown[];
    if (edit.kind === 'top-up-recurring' || edit.kind === 'withdraw-recurring') {
      const amount0 = amountLots(edit.amount0, token0, true);
      const amount1 = amountLots(edit.amount1, token1, true);
      if (amount0 === 0n && amount1 === 0n) throw new Error(`Enter at least one Recurring ${edit.kind === 'top-up-recurring' ? 'top-up' : 'withdrawal'} amount.`);
      if (edit.kind === 'top-up-recurring' &&
          (privateTerms.inventory0Lots + amount0 > MAX_LOTS || privateTerms.inventory1Lots + amount1 > MAX_LOTS)) {
        throw new Error('Recurring top-up exceeds the position inventory limit.');
      }
      if (edit.kind === 'withdraw-recurring' &&
          (amount0 > privateTerms.inventory0Lots || amount1 > privateTerms.inventory1Lots)) {
        throw new Error('Recurring withdrawal exceeds the current inventory.');
      }
      const hostMethod = edit.kind === 'top-up-recurring' ? 'topUp' : 'withdraw';
      method = edit.kind === 'top-up-recurring' ? 'topUpRecurring' : 'withdrawRecurring';
      const selector = RECURRING_HOST.getFunction(hostMethod)!.selector;
      const encrypted = await encryptInputs(signer, hostAddress, selector, [amount0, amount1]);
      args = [encrypted];
      if (edit.kind === 'top-up-recurring') {
        if (amount0 > 0n) await ensureTradeTokenAllowance(
          signer, owner, token0.address, scaleDexV2LotsToRaw(amount0, BigInt(token0.lotSizeRaw)),
          'private-erc20', manifest.globalCore
        );
        if (amount1 > 0n) await ensureTradeTokenAllowance(
          signer, owner, token1.address, scaleDexV2LotsToRaw(amount1, BigInt(token1.lotSizeRaw)),
          'private-erc20', manifest.globalCore
        );
      }
    } else if (edit.kind === 'reprice-recurring') {
      const side = edit.leg === 0 ? privateTerms.side0 : privateTerms.side1;
      const soldToken = side === 0 ? token0 : token1;
      const boughtToken = side === 0 ? token1 : token0;
      const baseSymbol = pair.displayPair.split('/')[0];
      const startPriceQ = successorStrategyDisplayedPriceToPriceQ(
        manifest, pair, baseSymbol, displayedPrice(edit.displayedStartPrice, 'Recurring start price')
      );
      const minimumOutput = amountLots(edit.minimumOutput, soldToken, true);
      const threshold = amountLots(edit.threshold, soldToken, true);
      const nextMinimum = amountLots(edit.nextMinimum, boughtToken, true);
      const plaintexts = [BigInt(edit.leg), startPriceQ * 2n + BigInt(side)];
      if (privateTerms.recurringClass === 'RR') {
        const endPriceQ = successorStrategyDisplayedPriceToPriceQ(
          manifest, pair, baseSymbol, displayedPrice(edit.displayedEndPrice, 'Recurring end price')
        );
        if (side === 1 && endPriceQ < startPriceQ || side === 0 && endPriceQ > startPriceQ) {
          throw new Error('Recurring Range end price moves in the wrong direction for the funded side.');
        }
        plaintexts.push(endPriceQ);
      }
      plaintexts.push(minimumOutput, threshold, nextMinimum);
      const hostMethod = privateTerms.recurringClass === 'RR' ? 'repriceRr' : 'repriceLl';
      method = privateTerms.recurringClass === 'RR' ? 'repriceRecurringRr' : 'repriceRecurringLl';
      const selector = RECURRING_HOST.getFunction(hostMethod)!.selector;
      args = await encryptInputs(signer, hostAddress, selector, plaintexts);
    } else {
      throw new Error(`The ${edit.kind} edit does not match this Recurring position.`);
    }
    const transaction = await authority.getFunction(method)(
      BigInt(position.positionId), BigInt(position.ownershipRevision), BigInt(privateTerms.revision),
      ...args, { gasLimit: SUCCESSOR_DEX_GAS_LIMIT }
    );
    const receipt = await transaction.wait(1);
    if (!receipt || receipt.status !== 1) throw new Error(`Position ${edit.kind} failed.`);
    return Object.freeze({ transactionHash: transaction.hash });
  }

  if (position.family !== 'Fixed' && position.family !== 'Range') {
    throw new Error(`Position edits are not available for this ${position.family} position.`);
  }
  if (edit.kind !== 'top-up' && edit.kind !== 'partial-exit-fixed' &&
      edit.kind !== 'partial-exit-range' && edit.kind !== 'reprice-fixed' &&
      edit.kind !== 'reprice-range') {
    throw new Error(`The ${edit.kind} edit does not match this ${position.family} position.`);
  }
  const soldToken = privateTerms.side === 0 ? token0 : token1;
  const currentInventory = privateTerms.side === 0 ? privateTerms.inventory0Lots : privateTerms.inventory1Lots;
  let method: 'topUpFixedLimit' | 'topUpRange' | 'repriceFixedLimit' | 'repriceRange' |
    'partialExitFixedLimit' | 'partialExitRange';
  let encrypted: readonly Awaited<ReturnType<typeof encryptAuthenticatedUint64Input>>[];

  if (edit.kind === 'top-up') {
    const amount = amountLots(edit.amount, soldToken);
    if (currentInventory + amount > MAX_LOTS) throw new Error('Top-up exceeds the position inventory limit.');
    method = position.family === 'Fixed' ? 'topUpFixedLimit' : 'topUpRange';
    const selector = HOST.getFunction(method)!.selector;
    encrypted = [await encryptAuthenticatedUint64Input(signer, {
      plaintext: amount,
      contractAddress: hostAddress,
      functionSelector: selector
    })];
    await ensureTradeTokenAllowance(
      signer,
      owner,
      soldToken.address,
      scaleDexV2LotsToRaw(amount, BigInt(soldToken.lotSizeRaw)),
      'private-erc20',
      manifest.globalCore
    );
  } else if (edit.kind === 'partial-exit-fixed' || edit.kind === 'partial-exit-range') {
    if (position.family === 'Fixed' && edit.kind !== 'partial-exit-fixed' ||
        position.family === 'Range' && edit.kind !== 'partial-exit-range') {
      throw new Error(`The ${edit.kind} edit does not match this ${position.family} position.`);
    }
    const requested = amountLots(edit.amount, soldToken);
    if (requested >= currentInventory) {
      throw new Error('Partial exit must be below the current offered inventory. Use Exit position for a full exit.');
    }
    method = position.family === 'Fixed' ? 'partialExitFixedLimit' : 'partialExitRange';
    const plaintexts = [requested];
    if (edit.kind === 'partial-exit-range') {
      const baseSymbol = pair.displayPair.split('/')[0];
      const startPriceQ = successorStrategyDisplayedPriceToPriceQ(
        manifest, pair, baseSymbol, displayedPrice(edit.displayedStartPrice, 'Range start price')
      );
      const endPriceQ = successorStrategyDisplayedPriceToPriceQ(
        manifest, pair, baseSymbol, displayedPrice(edit.displayedEndPrice, 'Range end price')
      );
      if (privateTerms.side === 1 && endPriceQ < startPriceQ ||
          privateTerms.side === 0 && endPriceQ > startPriceQ) {
        throw new Error('Range end price moves in the wrong direction for the funded side.');
      }
      const minimumOutput = amountLots(edit.minimumOutput, soldToken, true);
      if (minimumOutput > currentInventory - requested) {
        throw new Error('Range minimum fill exceeds the remaining offered inventory.');
      }
      plaintexts.push(startPriceQ * 2n + BigInt(privateTerms.side), endPriceQ, minimumOutput);
    }
    const selector = HOST.getFunction(method)!.selector;
    encrypted = await encryptInputs(signer, hostAddress, selector, plaintexts);
  } else {
    if (position.family === 'Fixed' && edit.kind !== 'reprice-fixed' ||
        position.family === 'Range' && edit.kind !== 'reprice-range') {
      throw new Error(`The ${edit.kind} edit does not match this ${position.family} position.`);
    }
    const baseSymbol = pair.displayPair.split('/')[0];
    const minimumOutput = amountLots(edit.minimumOutput, soldToken, true);
    const startPriceQ = successorStrategyDisplayedPriceToPriceQ(
      manifest,
      pair,
      baseSymbol,
      displayedPrice(edit.kind === 'reprice-fixed' ? edit.displayedPrice : edit.displayedStartPrice, 'Position price')
    );
    const plaintexts = [startPriceQ * 2n + BigInt(privateTerms.side)];
    method = position.family === 'Fixed' ? 'repriceFixedLimit' : 'repriceRange';
    if (edit.kind === 'reprice-range') {
      const endPriceQ = successorStrategyDisplayedPriceToPriceQ(
        manifest,
        pair,
        baseSymbol,
        displayedPrice(edit.displayedEndPrice, 'Range end price')
      );
      if (privateTerms.side === 1 && endPriceQ < startPriceQ ||
          privateTerms.side === 0 && endPriceQ > startPriceQ) {
        throw new Error('Range end price moves in the wrong direction for the funded side.');
      }
      plaintexts.push(endPriceQ);
    }
    plaintexts.push(minimumOutput);
    const selector = HOST.getFunction(method)!.selector;
    const values = [];
    for (const plaintext of plaintexts) values.push(await encryptAuthenticatedUint64Input(signer, {
      plaintext,
      contractAddress: hostAddress,
      functionSelector: selector
    }));
    encrypted = values;
  }

  const transaction = await authority.getFunction(method)(
    BigInt(position.positionId),
    BigInt(position.ownershipRevision),
    BigInt(privateTerms.revision),
    ...encrypted,
    { gasLimit: SUCCESSOR_DEX_GAS_LIMIT }
  );
  const receipt = await transaction.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error(`Position ${edit.kind} failed.`);
  return Object.freeze({ transactionHash: transaction.hash });
};

export type SuccessorPositionAction = 'claim' | 'pause' | 'resume' | 'exit';

export const submitSuccessorPositionTransfer = async ({
  manifest,
  position,
  recipient,
  signer
}: {
  manifest: SuccessorDexManifest;
  position: Pick<SuccessorDexPositionState, 'owner' | 'positionId'>;
  recipient: string;
  signer: JsonRpcSigner;
}): Promise<Readonly<{ transactionHash: string }>> => {
  const owner = getAddress(await signer.getAddress());
  if (owner !== getAddress(position.owner)) {
    throw new Error('Only the current Position NFT owner can transfer this position.');
  }
  let nextOwner: string;
  try {
    nextOwner = getAddress(recipient.trim());
  } catch {
    throw new Error('Enter a valid recipient wallet address.');
  }
  if (nextOwner === owner) throw new Error('The recipient already owns this position.');
  const contract = new Contract(manifest.positionNFT, POSITION_NFT_ABI, signer);
  const transaction = await contract.getFunction('safeTransferFrom(address,address,uint256)')(
    owner,
    nextOwner,
    BigInt(position.positionId),
    { gasLimit: SUCCESSOR_DEX_GAS_LIMIT }
  );
  const receipt = await transaction.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error('Position transfer failed.');
  return Object.freeze({ transactionHash: transaction.hash });
};

export const submitSuccessorPositionAction = async ({
  action,
  expectedOwnershipRevision,
  expectedPositionRevision,
  manifest,
  position,
  signer
}: {
  action: SuccessorPositionAction;
  expectedOwnershipRevision: number;
  expectedPositionRevision: number;
  manifest: SuccessorDexManifest;
  position: Pick<SuccessorDexPositionState, 'family' | 'positionId'>;
  signer: JsonRpcSigner;
}): Promise<Readonly<{ transactionHash: string }>> => {
  const authorityAddress = manifest.contracts['work-authority']?.address;
  if (!authorityAddress) throw new Error('Successor work authority is missing.');
  if (!Number.isSafeInteger(expectedOwnershipRevision) || expectedOwnershipRevision < 1 ||
      !Number.isSafeInteger(expectedPositionRevision) || expectedPositionRevision < 1) {
    throw new Error('Position revisions are unavailable. Refresh the position before this action.');
  }
  const family = position.family;
  const method = action === 'claim'
    ? family === 'Fixed' ? 'claimFixedLimitProceeds' : family === 'Range' ? 'claimRangeProceeds' : ''
    : action === 'pause' || action === 'resume'
      ? family === 'Recurring' ? 'setRecurringPaused' : ''
      : family === 'Aggregate' ? 'finalExitPosition'
        : family === 'Fixed' ? 'finalExitFixedLimit'
          : family === 'Range' ? 'finalExitRange'
            : family === 'Recurring' ? 'finalExitRecurring' : '';
  if (!method) throw new Error(`${action} is not available for this ${family} position.`);
  const contract = new Contract(authorityAddress, ABI, signer);
  const args: unknown[] = [BigInt(position.positionId), BigInt(expectedOwnershipRevision), BigInt(expectedPositionRevision)];
  if (action === 'pause' || action === 'resume') args.push(action === 'pause');
  const transaction = await contract.getFunction(method)(...args, { gasLimit: SUCCESSOR_DEX_GAS_LIMIT });
  const receipt = await transaction.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error(`Position ${action} failed.`);
  return Object.freeze({ transactionHash: transaction.hash });
};
