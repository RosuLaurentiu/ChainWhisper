import { Interface, getAddress, hexlify } from '@coti-io/coti-ethers';
import {
  assertAttestedDexV2Deployment,
  type AttestedDexV2Deployment
} from './dexV2Chain';
import {
  dexV2DirectionCode,
  getDexV2TickQuanta,
  packDexV2LimitTerms,
  packDexV2LiquidityAdditionLots,
  packDexV2PoolDepositLots,
  packDexV2RecurringInventories,
  packDexV2RecurringRanks,
  packDexV2SwapLots,
  type DexV2LimitMakerSide,
  type DexV2SwapDirection
} from './dexV2Terms';
import {
  captureWalletActionIntent,
  readWalletActionIntent,
  type WalletActionIntent
} from './walletActionIntent';

const AUTHENTICATED_UINT64 = '(uint256 ciphertext,bytes signature)';
const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;

export const DEX_V2_ACTION_ABI = Object.freeze([
  `function createPoolPosition(address baseToken,address quoteToken,${AUTHENTICATED_UINT64} packedMaximumLots) returns (uint256 positionId)`,
  `function addPoolLiquidity(uint256 positionId,uint64 expectedOwnerRevision,${AUTHENTICATED_UINT64} packedMaximumLots)`,
  `function withdrawPoolLiquidity(uint256 positionId,uint64 expectedOwnerRevision,${AUTHENTICATED_UINT64} encryptedShares)`,
  'function withdrawAllPoolLiquidity(uint256 positionId,uint64 expectedOwnerRevision)',
  'function transferPosition(address recipient,uint256 positionId,uint64 expectedOwnerRevision)',
  'function activatePositionPrivacy(uint256 positionId,uint64 expectedOwnerRevision)',
  `function createLimitPosition(address baseToken,address quoteToken,${AUTHENTICATED_UINT64} packedTerms) returns (uint256 positionId)`,
  'function setLimitPositionPaused(uint256 positionId,uint64 expectedOwnerRevision,bool paused)',
  'function closeLimitPosition(uint256 positionId,uint64 expectedOwnerRevision)',
  `function createRecurringPosition(address baseToken,address quoteToken,${AUTHENTICATED_UINT64} packedRanks,${AUTHENTICATED_UINT64} packedInventories) returns (uint256 positionId)`,
  `function updateRecurringRanks(uint256 positionId,uint64 expectedOwnerRevision,${AUTHENTICATED_UINT64} packedRanks)`,
  `function addRecurringLiquidity(uint256 positionId,uint64 expectedOwnerRevision,${AUTHENTICATED_UINT64} packedAdditions)`,
  'function setRecurringPositionPaused(uint256 positionId,uint64 expectedOwnerRevision,bool paused)',
  'function closeRecurringPosition(uint256 positionId,uint64 expectedOwnerRevision)',
  `function swapDex(address baseToken,address quoteToken,uint8 direction,uint8 limitTickRank,uint64 deadline,${AUTHENTICATED_UINT64} packedLotAmounts) returns (uint256 swapId)`
] as const);

const DEX = new Interface(DEX_V2_ACTION_ABI);

export const DEX_V2_ACTION_SELECTORS = Object.freeze({
  createPoolPosition: DEX.getFunction('createPoolPosition')!.selector,
  addPoolLiquidity: DEX.getFunction('addPoolLiquidity')!.selector,
  withdrawPoolLiquidity: DEX.getFunction('withdrawPoolLiquidity')!.selector,
  withdrawAllPoolLiquidity: DEX.getFunction('withdrawAllPoolLiquidity')!.selector,
  transferPosition: DEX.getFunction('transferPosition')!.selector,
  activatePositionPrivacy: DEX.getFunction('activatePositionPrivacy')!.selector,
  createLimitPosition: DEX.getFunction('createLimitPosition')!.selector,
  setLimitPositionPaused: DEX.getFunction('setLimitPositionPaused')!.selector,
  closeLimitPosition: DEX.getFunction('closeLimitPosition')!.selector,
  createRecurringPosition: DEX.getFunction('createRecurringPosition')!.selector,
  updateRecurringRanks: DEX.getFunction('updateRecurringRanks')!.selector,
  addRecurringLiquidity: DEX.getFunction('addRecurringLiquidity')!.selector,
  setRecurringPositionPaused: DEX.getFunction('setRecurringPositionPaused')!.selector,
  closeRecurringPosition: DEX.getFunction('closeRecurringPosition')!.selector,
  swapDex: DEX.getFunction('swapDex')!.selector
} as const);

type PositionReference = Readonly<{
  positionId: bigint;
  expectedOwnerRevision: bigint;
}>;

export type DexV2Action =
  | Readonly<{ kind: 'create-pool'; baseMaximumLots: bigint; quoteMaximumLots: bigint }>
  | Readonly<PositionReference & {
      kind: 'add-pool'; baseMaximumLots: bigint; quoteMaximumLots: bigint;
    }>
  | Readonly<PositionReference & { kind: 'withdraw-pool'; shares: bigint }>
  | Readonly<PositionReference & { kind: 'withdraw-all-pool' }>
  | Readonly<PositionReference & { kind: 'transfer-position'; recipient: string }>
  | Readonly<PositionReference & { kind: 'activate-position-privacy' }>
  | Readonly<{
      kind: 'create-limit'; makerSide: DexV2LimitMakerSide; tickRank: number;
      minimumFillQuanta: bigint; inventoryLots: bigint;
    }>
  | Readonly<PositionReference & { kind: 'pause-limit' | 'resume-limit' | 'close-limit' }>
  | Readonly<{
      kind: 'create-recurring'; buyTickRank: number; sellTickRank: number;
      baseInventoryLots: bigint; quoteInventoryLots: bigint;
    }>
  | Readonly<PositionReference & {
      kind: 'update-recurring-ranks'; buyTickRank: number; sellTickRank: number;
    }>
  | Readonly<PositionReference & {
      kind: 'add-recurring-liquidity'; baseLots: bigint; quoteLots: bigint;
    }>
  | Readonly<PositionReference & {
      kind: 'pause-recurring' | 'resume-recurring' | 'close-recurring';
    }>
  | Readonly<{
      kind: 'swap'; direction: DexV2SwapDirection; limitTickRank: number; deadline: bigint;
      maximumInputLots: bigint; minimumInputFilledLots: bigint;
    }>;

export type DexV2ActionIntent = WalletActionIntent<DexV2Action>;

export type DexV2AuthenticatedUint64 = Readonly<{
  ciphertext: bigint;
  signature: string | Uint8Array;
}>;

export type DexV2EncryptUint64 = (request: Readonly<{
  plaintext: bigint;
  contractAddress: string;
  functionSelector: string;
}>) => Promise<DexV2AuthenticatedUint64>;

declare const PREPARED_DEX_V2_CALL_BRAND: unique symbol;
export type PreparedDexV2ActionCall = Readonly<{
  kind: DexV2Action['kind'];
  to: string;
  data: string;
  selector: string;
  value: 0n;
  requiresPrivacy: boolean;
  readonly [PREPARED_DEX_V2_CALL_BRAND]: true;
}>;

const PREPARED_CALLS = new WeakSet<object>();

const uint = (value: unknown, label: string, maximum: bigint): bigint => {
  if (typeof value !== 'bigint' || value < 0n || value > maximum) {
    throw new Error(`${label} is out of range.`);
  }
  return value;
};

const position = (action: PositionReference): readonly [bigint, bigint] => [
  uint(action.positionId, 'DEX V2 position ID', UINT256_MAX),
  uint(action.expectedOwnerRevision, 'DEX V2 owner revision', UINT64_MAX)
];

const authenticated = (value: DexV2AuthenticatedUint64): Readonly<{
  ciphertext: bigint;
  signature: string;
}> => {
  if (!value || typeof value !== 'object') throw new Error('DEX V2 authenticated input is invalid.');
  const ciphertext = uint(value.ciphertext, 'DEX V2 authenticated ciphertext', UINT256_MAX);
  let signature: string;
  try {
    signature = hexlify(value.signature).toLowerCase();
  } catch {
    throw new Error('DEX V2 authenticated input signature is invalid.');
  }
  if (signature === '0x') throw new Error('DEX V2 authenticated input signature cannot be empty.');
  return Object.freeze({ ciphertext, signature });
};

export const captureDexV2ActionIntent = (action: DexV2Action): DexV2ActionIntent =>
  captureWalletActionIntent(action);

export const prepareDexV2ActionCall = async ({
  deployment,
  intent,
  encryptUint64
}: {
  deployment: AttestedDexV2Deployment;
  intent: DexV2ActionIntent;
  encryptUint64?: DexV2EncryptUint64;
}): Promise<PreparedDexV2ActionCall> => {
  const verified = assertAttestedDexV2Deployment(deployment);
  const action = readWalletActionIntent(intent);
  const core = getAddress(verified.manifest.addresses.core).toLowerCase();
  const base = verified.manifest.pair.baseToken;
  const quote = verified.manifest.pair.quoteToken;
  let functionName: keyof typeof DEX_V2_ACTION_SELECTORS;
  let args: readonly unknown[];
  let requiresPrivacy = true;

  const encrypt = async (plaintext: bigint, selector: string) => {
    if (typeof encryptUint64 !== 'function') {
      throw new Error('DEX V2 private action requires the current wallet privacy signer.');
    }
    return authenticated(await encryptUint64(Object.freeze({
      plaintext: uint(plaintext, 'DEX V2 private uint64 plaintext', UINT64_MAX),
      contractAddress: core,
      functionSelector: selector
    })));
  };

  switch (action.kind) {
    case 'create-pool': {
      functionName = 'createPoolPosition';
      args = [base, quote, await encrypt(
        packDexV2PoolDepositLots(action.baseMaximumLots, action.quoteMaximumLots),
        DEX_V2_ACTION_SELECTORS[functionName]
      )];
      break;
    }
    case 'add-pool': {
      functionName = 'addPoolLiquidity';
      args = [...position(action), await encrypt(
        packDexV2PoolDepositLots(action.baseMaximumLots, action.quoteMaximumLots),
        DEX_V2_ACTION_SELECTORS[functionName]
      )];
      break;
    }
    case 'withdraw-pool': {
      functionName = 'withdrawPoolLiquidity';
      args = [...position(action), await encrypt(
        uint(action.shares, 'DEX V2 Pool shares', UINT64_MAX),
        DEX_V2_ACTION_SELECTORS[functionName]
      )];
      break;
    }
    case 'withdraw-all-pool':
      functionName = 'withdrawAllPoolLiquidity';
      args = position(action);
      requiresPrivacy = false;
      break;
    case 'transfer-position':
      functionName = 'transferPosition';
      args = [getAddress(action.recipient).toLowerCase(), ...position(action)];
      requiresPrivacy = false;
      break;
    case 'activate-position-privacy':
      functionName = 'activatePositionPrivacy';
      args = position(action);
      requiresPrivacy = false;
      break;
    case 'create-limit': {
      functionName = 'createLimitPosition';
      args = [base, quote, await encrypt(packDexV2LimitTerms(action), DEX_V2_ACTION_SELECTORS[functionName])];
      break;
    }
    case 'pause-limit':
    case 'resume-limit':
      functionName = 'setLimitPositionPaused';
      args = [...position(action), action.kind === 'pause-limit'];
      requiresPrivacy = false;
      break;
    case 'close-limit':
      functionName = 'closeLimitPosition';
      args = position(action);
      requiresPrivacy = false;
      break;
    case 'create-recurring': {
      functionName = 'createRecurringPosition';
      const selector = DEX_V2_ACTION_SELECTORS[functionName];
      args = [
        base,
        quote,
        await encrypt(packDexV2RecurringRanks(action.buyTickRank, action.sellTickRank), selector),
        await encrypt(packDexV2RecurringInventories(action), selector)
      ];
      break;
    }
    case 'update-recurring-ranks': {
      functionName = 'updateRecurringRanks';
      args = [...position(action), await encrypt(
        packDexV2RecurringRanks(action.buyTickRank, action.sellTickRank),
        DEX_V2_ACTION_SELECTORS[functionName]
      )];
      break;
    }
    case 'add-recurring-liquidity': {
      functionName = 'addRecurringLiquidity';
      args = [...position(action), await encrypt(
        packDexV2LiquidityAdditionLots(action.baseLots, action.quoteLots),
        DEX_V2_ACTION_SELECTORS[functionName]
      )];
      break;
    }
    case 'pause-recurring':
    case 'resume-recurring':
      functionName = 'setRecurringPositionPaused';
      args = [...position(action), action.kind === 'pause-recurring'];
      requiresPrivacy = false;
      break;
    case 'close-recurring':
      functionName = 'closeRecurringPosition';
      args = position(action);
      requiresPrivacy = false;
      break;
    case 'swap': {
      functionName = 'swapDex';
      const deadline = uint(action.deadline, 'DEX V2 swap deadline', UINT64_MAX);
      if (deadline === 0n) throw new Error('DEX V2 swap deadline cannot be zero.');
      // Validate the public limit before encryption or wallet interaction. The ABI accepts all
      // uint8 values, while the reviewed DEX table intentionally exposes only ranks 0..15.
      getDexV2TickQuanta(action.limitTickRank, action.direction);
      args = [
        base,
        quote,
        dexV2DirectionCode(action.direction),
        action.limitTickRank,
        deadline,
        await encrypt(
          packDexV2SwapLots(action.maximumInputLots, action.minimumInputFilledLots),
          DEX_V2_ACTION_SELECTORS[functionName]
        )
      ];
      break;
    }
  }

  const call = Object.freeze({
    kind: action.kind,
    to: core,
    data: DEX.encodeFunctionData(functionName, [...args]),
    selector: DEX_V2_ACTION_SELECTORS[functionName],
    value: 0n as const,
    requiresPrivacy
  }) as PreparedDexV2ActionCall;
  PREPARED_CALLS.add(call);
  return call;
};

export const assertPreparedDexV2ActionCall = (
  call: PreparedDexV2ActionCall
): PreparedDexV2ActionCall => {
  if (!call || !PREPARED_CALLS.has(call)) {
    throw new Error('DEX V2 requires a call returned by its exact action preparer.');
  }
  return call;
};
