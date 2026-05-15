import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import {
  ensurePrivateTokenSpendReady,
  ensureTradeTokenAllowance,
  isLegacyPrivateOrderEscrowContractAddress,
  isDirectTradeEscrowConfigured,
  resolveTradeEscrowContractConfig
} from './appChain';
import { resolveTradeAssetTypeValue } from './appHelpers';
import {
  loadCotiEthersModule,
  DIRECT_TRADE_ESCROW_CONTRACT_ABI,
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ABI,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  RECURRING_OTC_CONTRACT_ABI,
  RECURRING_OTC_CONTRACT_ADDRESS,
  toSafeNumber,
  TRADE_ESCROW_CONTRACT_ABI,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload
} from './appShared';
import { buildDirectTradeTerms, encryptDirectTradeTerms } from './directTradeTerms';
import { logMobileWalletDiagnostic } from './mobileWalletDiagnostics';
import { EMPTY_PRIVATE_UINT256_INPUT, encryptPrivateUint256Input } from './privateUint256';
import { PRIVATE_ORDER_COUNTER_UNAVAILABLE_MESSAGE } from './tradeCounterSupport';
import { buildTradeRecoveryPayload, encryptTradeRecoveryPayloadForSigner } from './tradeRecoveryPayload';
import { normalizeAccessHash } from './tradeLinks';

type TradeSigner = Wallet | JsonRpcSigner;

type TradeAssetSelection = Pick<TradeAssetPayload, 'kind' | 'tokenAddress'>;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
const PRIVATE_TRADE_WRITE_GAS_LIMIT = 8_000_000n;

const logTradeContractWrite = (action: string): void => {
  logMobileWalletDiagnostic('contract-write', { action });
};

const createTradeContract = async (runner: TradeSigner, escrowContract?: string) => {
  const cotiEthers = await loadCotiEthersModule();
  const config = resolveTradeEscrowContractConfig(escrowContract);
  return new cotiEthers.Contract(config.address, config.abi, runner);
};

const createRecurringOrderContract = async (runner: TradeSigner) => {
  const cotiEthers = await loadCotiEthersModule();
  return new cotiEthers.Contract(RECURRING_OTC_CONTRACT_ADDRESS, RECURRING_OTC_CONTRACT_ABI, runner);
};

const requireSuccessfulReceipt = <T extends { status?: number | bigint } | null | undefined>(
  receipt: T,
  errorMessage: string
): NonNullable<T> => {
  if (!receipt || Number((receipt as { status?: number | bigint }).status ?? 0) !== 1) {
    throw new Error(errorMessage);
  }

  return receipt as NonNullable<T>;
};

const resolveAcceptedTxHash = (
  tx: { hash?: unknown },
  receipt: { hash?: unknown; transactionHash?: unknown }
): string | undefined => {
  if (typeof receipt.hash === 'string' && receipt.hash) {
    return receipt.hash;
  }
  if (typeof receipt.transactionHash === 'string' && receipt.transactionHash) {
    return receipt.transactionHash;
  }
  if (typeof tx.hash === 'string' && tx.hash) {
    return tx.hash;
  }

  return undefined;
};

export const closeCounterTradeOnChain = async ({
  signer,
  tradeId,
  actorRole
}: {
  signer: TradeSigner;
  tradeId: number;
  actorRole: 'maker' | 'taker';
}): Promise<'cancelled' | 'declined'> => {
  const tradeContract = await createTradeContract(signer);
  logTradeContractWrite(actorRole === 'maker' ? 'cancelTrade' : 'declineTrade');
  const tx =
    actorRole === 'maker' ? await tradeContract.cancelTrade(tradeId) : await tradeContract.declineTrade(tradeId);
  requireSuccessfulReceipt(await tx.wait(), 'Failed to close the original trade.');
  return actorRole === 'maker' ? 'cancelled' : 'declined';
};

const buildTradeAssetTuple = (asset: TradeAssetSelection, amountWei: bigint) =>
  [
    resolveTradeAssetTypeValue(asset.kind),
    asset.tokenAddress ?? ZERO_ADDRESS,
    amountWei
  ] as const;

const buildRecurringAssetTuple = (asset: TradeAssetSelection) =>
  [
    resolveTradeAssetTypeValue(asset.kind),
    asset.tokenAddress ?? ZERO_ADDRESS
  ] as const;

const buildRecurringTermsTuple = (baseAmountWei: bigint, quoteAmountWei: bigint) =>
  [baseAmountWei, quoteAmountWei] as const;

export const shouldRouteTradeThroughDirectEscrow = ({
  isPublic,
  parentTradeId,
  hidePrivateLiquidity
}: {
  isPublic?: boolean;
  parentTradeId?: number;
  hidePrivateLiquidity?: boolean;
}): boolean => Boolean(parentTradeId) || (!hidePrivateLiquidity && !isPublic);

const ensureOfferEscrowReady = async (
  signer: TradeSigner,
  makerAddress: string,
  offerAsset: TradeAssetSelection,
  offerAmountWei: bigint,
  spenderAddress = TRADE_ESCROW_CONTRACT_ADDRESS
): Promise<void> => {
  if (offerAsset.kind !== 'native' && offerAsset.tokenAddress) {
    await ensureTradeTokenAllowance(
      signer,
      makerAddress,
      offerAsset.tokenAddress,
      offerAmountWei,
      offerAsset.kind,
      spenderAddress
    );
  }
};

const ensureRequestPaymentReady = async (
  signer: TradeSigner,
  ownerAddress: string,
  requestAsset: TradeAssetPayload,
  requestAmountWei: bigint,
  spenderAddress = TRADE_ESCROW_CONTRACT_ADDRESS
): Promise<void> => {
  if (requestAsset.kind !== 'native' && requestAsset.tokenAddress) {
    await ensureTradeTokenAllowance(
      signer,
      ownerAddress,
      requestAsset.tokenAddress,
      requestAmountWei,
      requestAsset.kind,
      spenderAddress
    );
  }
};

const resolveDirectOnChainAccessSecret = (
  accessSecret?: string,
  useDirectWalletAuthority?: boolean
): string | undefined => (useDirectWalletAuthority ? undefined : accessSecret);

export const __resolveDirectOnChainAccessSecretForTest = resolveDirectOnChainAccessSecret;

const resolvePrivateOrderFillFunctionName = ({
  requestIsPrivate,
  accessSecret
}: {
  requestIsPrivate: boolean;
  accessSecret?: string;
}): 'fillPrivateOrder' | 'fillPrivateOrderWithEncryptedAccess' | 'fillHybridPrivateOrder' | 'fillHybridPrivateOrderWithEncryptedAccess' => {
  if (requestIsPrivate) {
    return accessSecret ? 'fillPrivateOrderWithEncryptedAccess' : 'fillPrivateOrder';
  }
  return accessSecret ? 'fillHybridPrivateOrderWithEncryptedAccess' : 'fillHybridPrivateOrder';
};

export const __resolvePrivateOrderFillFunctionNameForTest = resolvePrivateOrderFillFunctionName;

const resolveTradeIdFromReceipt = async (
  tradeContract: Awaited<ReturnType<typeof createTradeContract>>,
  receipt: { logs?: unknown[] },
  fallbackErrorMessage: string,
  abi:
    | typeof TRADE_ESCROW_CONTRACT_ABI
    | typeof PRIVATE_TRADE_ESCROW_CONTRACT_ABI
    | typeof DIRECT_TRADE_ESCROW_CONTRACT_ABI
    | typeof RECURRING_OTC_CONTRACT_ABI = TRADE_ESCROW_CONTRACT_ABI
): Promise<number> => {
  const cotiEthers = await loadCotiEthersModule();
  const interfaceInstance = new cotiEthers.Interface(abi);
  let tradeId = 0;

  for (const log of receipt.logs ?? []) {
    try {
      const parsedLog = interfaceInstance.parseLog(log as never);
      if (
        parsedLog?.name === 'TradeOpened' ||
        parsedLog?.name === 'PrivateOrderOpened' ||
        parsedLog?.name === 'DirectTradeOpened' ||
        parsedLog?.name === 'RecurringOrderOpened'
      ) {
        tradeId = toSafeNumber(parsedLog.args?.tradeId ?? parsedLog.args?.orderId ?? parsedLog.args?.[0]);
        break;
      }
    } catch {
    }
  }

  if (tradeId <= 0) {
    const nextTradeIdRaw =
      typeof tradeContract.nextTradeId === 'function' ? await tradeContract.nextTradeId().catch(() => null) : null;
    if (typeof nextTradeIdRaw === 'bigint' && nextTradeIdRaw > 0n) {
      tradeId = Number(nextTradeIdRaw - 1n);
    } else {
      const nextOrderIdRaw =
        typeof tradeContract.nextOrderId === 'function' ? await tradeContract.nextOrderId().catch(() => null) : null;
      if (typeof nextOrderIdRaw === 'bigint' && nextOrderIdRaw > 0n) {
        tradeId = Number(nextOrderIdRaw - 1n);
      }
    }
  }

  if (tradeId <= 0) {
    throw new Error(fallbackErrorMessage);
  }

  return tradeId;
};

const resolveTradeFunctionSelector = async (
  functionName: string,
  abi:
    | typeof TRADE_ESCROW_CONTRACT_ABI
    | typeof PRIVATE_TRADE_ESCROW_CONTRACT_ABI
    | typeof DIRECT_TRADE_ESCROW_CONTRACT_ABI
    | typeof RECURRING_OTC_CONTRACT_ABI = TRADE_ESCROW_CONTRACT_ABI
): Promise<string> => {
  const cotiEthers = await loadCotiEthersModule();
  const interfaceInstance = new cotiEthers.Interface(abi);
  const selector = interfaceInstance.getFunction(functionName)?.selector;
  if (!selector) {
    throw new Error(`Unable to prepare ${functionName}.`);
  }
  return selector;
};

const buildDirectTermsPayload = async ({
  makerAddress,
  takerAddress,
  offerAsset,
  offerAmountWei,
  requestAsset,
  requestAmountWei,
  expiresAt,
  directAccessSecret,
  parentEscrowContract,
  parentTradeId
}: {
  makerAddress: string;
  takerAddress: string;
  offerAsset: TradeAssetSelection;
  offerAmountWei: bigint;
  requestAsset: TradeAssetSelection;
  requestAmountWei: bigint;
  expiresAt: number;
  directAccessSecret?: string;
  parentEscrowContract?: string;
  parentTradeId?: number;
}): Promise<{ accessSecret: string; termsPayload: string }> => {
  const accessSecret = normalizeAccessHash(directAccessSecret);
  if (!accessSecret) {
    throw new Error('Direct OTC trades need a valid encrypted terms key before creation.');
  }
  const terms = buildDirectTradeTerms({
    maker: makerAddress,
    taker: takerAddress,
    offer: { kind: offerAsset.kind, tokenAddress: offerAsset.tokenAddress, amount: offerAmountWei.toString() },
    request: { kind: requestAsset.kind, tokenAddress: requestAsset.tokenAddress, amount: requestAmountWei.toString() },
    expiresAt,
    parentEscrowContract,
    parentTradeId
  });
  return {
    accessSecret,
    termsPayload: await encryptDirectTradeTerms(terms, accessSecret)
  };
};

const encryptAccessSecretInput = async (
  signer: TradeSigner,
  accessSecret: string,
  contractAddress: string,
  functionSelector: string
) => encryptPrivateUint256Input(
  signer,
  BigInt(accessSecret),
  contractAddress,
  functionSelector
);

const resolvePrivateOrderFillResult = async (
  receipt: { logs?: unknown[] },
  fallbackFullyFilled = false
): Promise<boolean> => {
  const cotiEthers = await loadCotiEthersModule();
  const interfaceInstance = new cotiEthers.Interface(PRIVATE_TRADE_ESCROW_CONTRACT_ABI);

  for (const log of receipt.logs ?? []) {
    try {
      const parsedLog = interfaceInstance.parseLog(log as never);
      if (parsedLog?.name === 'PrivateOrderFilled') {
        return Boolean(parsedLog.args?.fullyFilled ?? parsedLog.args?.[2]);
      }
    } catch {
    }
  }

  return fallbackFullyFilled;
};

export const createTradeOnChain = async ({
  signer,
  makerAddress,
  takerAddress,
  offerAsset,
  offerAmountWei,
  requestAsset,
  requestAmountWei,
  expiresAt,
  nativeFeeWei,
  isPublic,
  accessHash,
  accessSecret,
  parentTradeId,
  hidePrivateLiquidity,
  hiddenOfferAmountWei,
  hiddenRequestAmountWei,
  publicOfferAmountWei,
  termsHash,
  makerRecoveryPayload,
  directAccessSecret,
  parentEscrowContract
}: {
  signer: TradeSigner;
  makerAddress: string;
  takerAddress: string;
  offerAsset: TradeAssetSelection;
  offerAmountWei: bigint;
  requestAsset: TradeAssetSelection;
  requestAmountWei: bigint;
  expiresAt: number;
  nativeFeeWei: bigint;
  isPublic?: boolean;
  accessHash?: string;
  accessSecret?: string;
  parentTradeId?: number;
  hidePrivateLiquidity?: boolean;
  hiddenOfferAmountWei?: bigint;
  hiddenRequestAmountWei?: bigint;
  publicOfferAmountWei?: bigint;
  termsHash?: string;
  makerRecoveryPayload?: string;
  directAccessSecret?: string;
  parentEscrowContract?: string;
}): Promise<{ tradeId: number; escrowContract: string; txHash?: string }> => {
  if (hidePrivateLiquidity && !parentTradeId) {
    if (offerAsset.kind !== 'private-erc20') {
      throw new Error('Private liquidity requires the token you sell to be private.');
    }
    if (requestAsset.kind === 'private-erc20' && requestAsset.tokenAddress === offerAsset.tokenAddress) {
      throw new Error('Hidden amount orders need two different token sides.');
    }

    const resolvedHiddenOfferAmountWei = hiddenOfferAmountWei ?? offerAmountWei;
    const resolvedHiddenRequestAmountWei = hiddenRequestAmountWei ?? requestAmountWei;
    const resolvedPublicOfferAmountWei = publicOfferAmountWei ?? offerAmountWei;
    const tradeContract = await createTradeContract(signer, PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS);
    await ensureOfferEscrowReady(
      signer,
      makerAddress,
      offerAsset,
      resolvedHiddenOfferAmountWei,
      PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS
    );

    const resolvedMakerRecoveryPayload =
      makerRecoveryPayload ??
      (await encryptTradeRecoveryPayloadForSigner(
        signer,
        buildTradeRecoveryPayload({
          kind: 'private-order',
          accessSecret,
          maker: makerAddress,
          taker: takerAddress,
          offer: { kind: offerAsset.kind, tokenAddress: offerAsset.tokenAddress, amount: resolvedHiddenOfferAmountWei.toString() },
          request: { kind: requestAsset.kind, tokenAddress: requestAsset.tokenAddress, amount: resolvedHiddenRequestAmountWei.toString() },
          expiresAt
        })
      ));
    const hasEncryptedAccessSecret = Boolean(accessSecret);
    const createFunctionName = 'createPrivateOrderWithRecoveryNote';
    const createSelector = await resolveTradeFunctionSelector(createFunctionName, PRIVATE_TRADE_ESCROW_CONTRACT_ABI);
    const privateLinkTerms = hasEncryptedAccessSecret
      ? await buildDirectTermsPayload({
          makerAddress,
          takerAddress,
          offerAsset,
          offerAmountWei: resolvedHiddenOfferAmountWei,
          requestAsset,
          requestAmountWei: resolvedHiddenRequestAmountWei,
          expiresAt,
          directAccessSecret: accessSecret
        })
      : null;
    const resolvedTermsHash =
      termsHash ??
      (privateLinkTerms
        ? (await loadCotiEthersModule()).keccak256(privateLinkTerms.termsPayload)
        : ZERO_BYTES32);
    const encryptedHiddenOfferAmount = await encryptPrivateUint256Input(
      signer,
      resolvedHiddenOfferAmountWei,
      PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
      createSelector
    );
    const encryptedPrivateOfferAmount = hasEncryptedAccessSecret
      ? await encryptPrivateUint256Input(
          signer,
          resolvedHiddenOfferAmountWei,
          PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
          createSelector
        )
      : EMPTY_PRIVATE_UINT256_INPUT;
    const encryptedPrivateRequestAmount = hasEncryptedAccessSecret
      ? await encryptPrivateUint256Input(
          signer,
          resolvedHiddenRequestAmountWei,
          PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
          createSelector
        )
      : EMPTY_PRIVATE_UINT256_INPUT;
    const encryptedAccessSecret = hasEncryptedAccessSecret
      ? await encryptAccessSecretInput(signer, accessSecret!, PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS, createSelector)
      : EMPTY_PRIVATE_UINT256_INPUT;
    const privateOrderArgs = [
      buildTradeAssetTuple(offerAsset, hasEncryptedAccessSecret ? 0n : resolvedPublicOfferAmountWei),
      buildTradeAssetTuple(requestAsset, hasEncryptedAccessSecret ? 0n : requestAmountWei),
      takerAddress,
      expiresAt,
      Boolean(isPublic),
      accessHash ?? ZERO_BYTES32,
      resolvedTermsHash,
      encryptedHiddenOfferAmount,
      encryptedPrivateOfferAmount,
      encryptedPrivateRequestAmount
    ] as const;
    logTradeContractWrite(createFunctionName);
    const createTx = await tradeContract.createPrivateOrderWithRecoveryNote(
      ...privateOrderArgs,
      resolvedMakerRecoveryPayload,
      encryptedAccessSecret,
      privateLinkTerms?.termsPayload ?? '0x',
      { value: nativeFeeWei, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
    );
    const createReceipt = requireSuccessfulReceipt(await createTx.wait(), 'Trade creation failed on-chain.');
    const tradeId = await resolveTradeIdFromReceipt(
      tradeContract,
      createReceipt as { logs?: unknown[] },
      'Trade was created, but the trade id could not be resolved.',
      PRIVATE_TRADE_ESCROW_CONTRACT_ABI
    );

    return {
      tradeId,
      escrowContract: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
      txHash: resolveAcceptedTxHash(createTx as { hash?: unknown }, createReceipt as { hash?: unknown; transactionHash?: unknown })
    };
  }

  if (parentTradeId && isLegacyPrivateOrderEscrowContractAddress(parentEscrowContract)) {
    throw new Error(PRIVATE_ORDER_COUNTER_UNAVAILABLE_MESSAGE);
  }

  const shouldUseDirectVisibleEscrow = shouldRouteTradeThroughDirectEscrow({ isPublic, parentTradeId, hidePrivateLiquidity });
  if (shouldUseDirectVisibleEscrow) {
    if (!isDirectTradeEscrowConfigured()) {
      throw new Error(
        'Private-link, direct, and counter trades with visible amounts need the V1 Direct OTC escrow before they can be created without public amount leakage.'
      );
    }
    const { accessSecret: resolvedDirectAccessSecret, termsPayload } = await buildDirectTermsPayload({
      makerAddress,
      takerAddress,
      offerAsset,
      offerAmountWei,
      requestAsset,
      requestAmountWei,
      expiresAt,
      directAccessSecret,
      parentEscrowContract,
      parentTradeId
    });

    const tradeContract = await createTradeContract(signer, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS);
    await ensureOfferEscrowReady(signer, makerAddress, offerAsset, offerAmountWei, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS);
    const parentEscrowIsExternal =
      Boolean(parentTradeId && parentEscrowContract) &&
      parentEscrowContract?.toLowerCase() !== DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase();
    const createFunctionName = parentTradeId
      ? parentEscrowIsExternal
        ? 'createDirectCounterTradeForParent'
        : 'createDirectCounterTrade'
      : 'createDirectTrade';
    const createSelector = await resolveTradeFunctionSelector(createFunctionName, DIRECT_TRADE_ESCROW_CONTRACT_ABI);
    const cotiEthers = await loadCotiEthersModule();
    const resolvedTermsHash = termsHash ?? cotiEthers.keccak256(termsPayload);
    const directAccessHash = cotiEthers.keccak256(resolvedDirectAccessSecret);
    const encryptedAccessSecret = await encryptAccessSecretInput(
      signer,
      resolvedDirectAccessSecret,
      DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
      createSelector
    );
    const encryptedOfferAmount =
      offerAsset.kind === 'private-erc20'
        ? await encryptPrivateUint256Input(signer, offerAmountWei, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS, createSelector)
        : EMPTY_PRIVATE_UINT256_INPUT;
    const encryptedRequestAmount =
      requestAsset.kind === 'private-erc20'
        ? await encryptPrivateUint256Input(signer, requestAmountWei, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS, createSelector)
        : EMPTY_PRIVATE_UINT256_INPUT;
    const publicAmounts = {
      offerAmount: offerAsset.kind === 'private-erc20' ? 0n : offerAmountWei,
      requestAmount: requestAsset.kind === 'private-erc20' ? 0n : requestAmountWei
    };
    const valueToSend = (offerAsset.kind === 'native' ? offerAmountWei : 0n) + nativeFeeWei;
    logTradeContractWrite(createFunctionName);
    const createTx = parentTradeId
      ? parentEscrowIsExternal
        ? await tradeContract.createDirectCounterTradeForParent(
            parentEscrowContract ?? ZERO_ADDRESS,
            parentTradeId,
            takerAddress,
            [resolveTradeAssetTypeValue(offerAsset.kind), offerAsset.tokenAddress ?? ZERO_ADDRESS],
            [resolveTradeAssetTypeValue(requestAsset.kind), requestAsset.tokenAddress ?? ZERO_ADDRESS],
            publicAmounts,
            encryptedOfferAmount,
            encryptedRequestAmount,
            expiresAt,
            directAccessHash,
            resolvedTermsHash ?? ZERO_BYTES32,
            encryptedAccessSecret,
            termsPayload,
            { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
          )
        : await tradeContract.createDirectCounterTrade(
          parentTradeId,
          [resolveTradeAssetTypeValue(offerAsset.kind), offerAsset.tokenAddress ?? ZERO_ADDRESS],
          [resolveTradeAssetTypeValue(requestAsset.kind), requestAsset.tokenAddress ?? ZERO_ADDRESS],
          publicAmounts,
          encryptedOfferAmount,
          encryptedRequestAmount,
          expiresAt,
          directAccessHash,
          resolvedTermsHash ?? ZERO_BYTES32,
          encryptedAccessSecret,
          termsPayload,
          { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
        )
      : await tradeContract.createDirectTrade(
          [resolveTradeAssetTypeValue(offerAsset.kind), offerAsset.tokenAddress ?? ZERO_ADDRESS],
          [resolveTradeAssetTypeValue(requestAsset.kind), requestAsset.tokenAddress ?? ZERO_ADDRESS],
          publicAmounts,
          encryptedOfferAmount,
          encryptedRequestAmount,
          takerAddress,
          expiresAt,
          directAccessHash,
          resolvedTermsHash ?? ZERO_BYTES32,
          encryptedAccessSecret,
          termsPayload,
          { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
        );
    const createReceipt = requireSuccessfulReceipt(await createTx.wait(), 'Trade creation failed on-chain.');
    const tradeId = await resolveTradeIdFromReceipt(
      tradeContract,
      createReceipt as { logs?: unknown[] },
      'Trade was created, but the trade id could not be resolved.',
      DIRECT_TRADE_ESCROW_CONTRACT_ABI
    );

    return {
      tradeId,
      escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
      txHash: resolveAcceptedTxHash(createTx as { hash?: unknown }, createReceipt as { hash?: unknown; transactionHash?: unknown })
    };
  }

  const tradeContract = await createTradeContract(signer);
  await ensureOfferEscrowReady(signer, makerAddress, offerAsset, offerAmountWei);

  const offerAssetTuple = buildTradeAssetTuple(offerAsset, offerAmountWei);
  const requestAssetTuple = buildTradeAssetTuple(requestAsset, requestAmountWei);
  const valueToSend = (offerAsset.kind === 'native' ? offerAmountWei : 0n) + nativeFeeWei;
  const shouldUseAdvancedCreate = Boolean(isPublic || accessHash || parentTradeId);
  const createOverrides =
    offerAsset.kind === 'private-erc20'
      ? { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
      : { value: valueToSend };
  logTradeContractWrite(shouldUseAdvancedCreate ? 'createTradeAdvanced' : 'createTrade');
  const createTx = shouldUseAdvancedCreate
    ? await tradeContract.createTradeAdvanced(
        offerAssetTuple,
        requestAssetTuple,
        takerAddress,
        expiresAt,
        Boolean(isPublic),
        accessHash ?? ZERO_BYTES32,
        parentTradeId ?? 0,
        createOverrides
      )
    : await tradeContract.createTrade(
        offerAssetTuple,
        requestAssetTuple,
        takerAddress,
        expiresAt,
        createOverrides
      );
  const createReceipt = requireSuccessfulReceipt(await createTx.wait(), 'Trade creation failed on-chain.');
  const tradeId = await resolveTradeIdFromReceipt(
    tradeContract,
    createReceipt as { logs?: unknown[] },
    'Trade was created, but the trade id could not be resolved.'
  );

  return {
    tradeId,
    escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
    txHash: resolveAcceptedTxHash(createTx as { hash?: unknown }, createReceipt as { hash?: unknown; transactionHash?: unknown })
  };
};

export const createRecurringOrderOnChain = async ({
  signer,
  makerAddress,
  baseAsset,
  quoteAsset,
  buyBaseAmountWei,
  buyQuoteAmountWei,
  sellBaseAmountWei,
  sellQuoteAmountWei,
  initialBaseInventoryWei,
  initialQuoteInventoryWei,
  nativeFeeWei,
  isPublic,
  accessHash,
  accessSecret,
  makerRecoveryPayload,
  hidePrivateAmounts
}: {
  signer: TradeSigner;
  makerAddress: string;
  baseAsset: TradeAssetSelection;
  quoteAsset: TradeAssetSelection;
  buyBaseAmountWei: bigint;
  buyQuoteAmountWei: bigint;
  sellBaseAmountWei: bigint;
  sellQuoteAmountWei: bigint;
  initialBaseInventoryWei: bigint;
  initialQuoteInventoryWei: bigint;
  nativeFeeWei: bigint;
  isPublic?: boolean;
  accessHash?: string;
  accessSecret?: string;
  makerRecoveryPayload?: string;
  hidePrivateAmounts?: boolean;
}): Promise<{ orderId: number; escrowContract: string; txHash?: string }> => {
  if (baseAsset.kind === quoteAsset.kind && (baseAsset.tokenAddress ?? ZERO_ADDRESS).toLowerCase() === (quoteAsset.tokenAddress ?? ZERO_ADDRESS).toLowerCase()) {
    throw new Error('Recurring orders need two different assets.');
  }
  if (buyBaseAmountWei <= 0n || buyQuoteAmountWei <= 0n || sellBaseAmountWei <= 0n || sellQuoteAmountWei <= 0n) {
    throw new Error('Enter buy and sell prices before creating a recurring order.');
  }
  if (initialBaseInventoryWei <= 0n && initialQuoteInventoryWei <= 0n) {
    throw new Error('Fund at least one side of the recurring order.');
  }
  const recurringAccessHash = normalizeAccessHash(accessHash);
  if (accessSecret || (recurringAccessHash && recurringAccessHash !== ZERO_BYTES32)) {
    throw new Error('Recurring private-link orders are no longer supported. Create this as a public recurring order instead.');
  }

  const recurringContract = await createRecurringOrderContract(signer);
  const hasPrivateAsset = baseAsset.kind === 'private-erc20' || quoteAsset.kind === 'private-erc20';
  const isPrivateOrder = Boolean(hidePrivateAmounts && hasPrivateAsset);
  const baseAssetTuple = buildRecurringAssetTuple(baseAsset);
  const quoteAssetTuple = buildRecurringAssetTuple(quoteAsset);
  const buyTermsTuple = buildRecurringTermsTuple(buyBaseAmountWei, buyQuoteAmountWei);
  const sellTermsTuple = buildRecurringTermsTuple(sellBaseAmountWei, sellQuoteAmountWei);
  const recurringAddress = RECURRING_OTC_CONTRACT_ADDRESS;

  if (baseAsset.kind !== 'native' && baseAsset.tokenAddress && initialBaseInventoryWei > 0n) {
    await ensureTradeTokenAllowance(
      signer,
      makerAddress,
      baseAsset.tokenAddress,
      initialBaseInventoryWei,
      baseAsset.kind,
      recurringAddress
    );
  }
  if (quoteAsset.kind !== 'native' && quoteAsset.tokenAddress && initialQuoteInventoryWei > 0n) {
    await ensureTradeTokenAllowance(
      signer,
      makerAddress,
      quoteAsset.tokenAddress,
      initialQuoteInventoryWei,
      quoteAsset.kind,
      recurringAddress
    );
  }

  const nativeInventoryWei =
    (baseAsset.kind === 'native' ? initialBaseInventoryWei : 0n) +
    (quoteAsset.kind === 'native' ? initialQuoteInventoryWei : 0n);
  const valueToSend = nativeInventoryWei + nativeFeeWei;
  const resolvedMakerRecoveryPayload =
    makerRecoveryPayload ??
    (accessSecret || !isPublic || isPrivateOrder
      ? await encryptTradeRecoveryPayloadForSigner(
          signer,
          buildTradeRecoveryPayload({
            kind: 'recurring-order',
            accessSecret,
            maker: makerAddress,
            taker: ZERO_ADDRESS,
            baseAsset: { kind: baseAsset.kind, tokenAddress: baseAsset.tokenAddress, amount: '0' },
            quoteAsset: { kind: quoteAsset.kind, tokenAddress: quoteAsset.tokenAddress, amount: '0' },
            buyTerms: {
              baseAmount: buyBaseAmountWei.toString(),
              quoteAmount: buyQuoteAmountWei.toString()
            },
            sellTerms: {
              baseAmount: sellBaseAmountWei.toString(),
              quoteAmount: sellQuoteAmountWei.toString()
            },
            initialBaseInventory: initialBaseInventoryWei.toString(),
            initialQuoteInventory: initialQuoteInventoryWei.toString()
          })
        )
      : '');
  const hasMakerRecoveryPayload = Boolean(resolvedMakerRecoveryPayload);

  logTradeContractWrite(isPrivateOrder ? 'createPrivateRecurringOrder' : 'createRecurringOrder');
  const createTx = isPrivateOrder
    ? await (async () => {
        const functionName = hasMakerRecoveryPayload
          ? 'createPrivateRecurringOrderWithRecoveryNote'
          : 'createPrivateRecurringOrder';
        const selector = await resolveTradeFunctionSelector(functionName, RECURRING_OTC_CONTRACT_ABI);
        const encryptedBaseInventory = await encryptPrivateUint256Input(
          signer,
          baseAsset.kind === 'private-erc20' ? initialBaseInventoryWei : 0n,
          recurringAddress,
          selector
        );
        const encryptedQuoteInventory = await encryptPrivateUint256Input(
          signer,
          quoteAsset.kind === 'private-erc20' ? initialQuoteInventoryWei : 0n,
          recurringAddress,
          selector
        );
        const privateRecurringArgs = [
          baseAssetTuple,
          quoteAssetTuple,
          buyTermsTuple,
          sellTermsTuple,
          ZERO_ADDRESS,
          Boolean(isPublic),
          accessHash ?? ZERO_BYTES32,
          baseAsset.kind === 'private-erc20' ? 0n : initialBaseInventoryWei,
          quoteAsset.kind === 'private-erc20' ? 0n : initialQuoteInventoryWei,
          encryptedBaseInventory,
          encryptedQuoteInventory
        ] as const;
        return hasMakerRecoveryPayload
          ? recurringContract.createPrivateRecurringOrderWithRecoveryNote(
              ...privateRecurringArgs,
              resolvedMakerRecoveryPayload,
              { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
            )
          : recurringContract.createPrivateRecurringOrder(
              ...privateRecurringArgs,
              { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
            );
      })()
    : await (async () => {
        const publicRecurringArgs = [
          baseAssetTuple,
          quoteAssetTuple,
          buyTermsTuple,
          sellTermsTuple,
          ZERO_ADDRESS,
          Boolean(isPublic),
          accessHash ?? ZERO_BYTES32,
          initialBaseInventoryWei,
          initialQuoteInventoryWei
        ] as const;
        return hasMakerRecoveryPayload
          ? recurringContract.createRecurringOrderWithRecoveryNote(
              ...publicRecurringArgs,
              resolvedMakerRecoveryPayload,
              hasPrivateAsset
                ? { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
                : { value: valueToSend }
            )
          : recurringContract.createRecurringOrder(
              ...publicRecurringArgs,
              hasPrivateAsset
                ? { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
                : { value: valueToSend }
            );
      })();
  const createReceipt = requireSuccessfulReceipt(await createTx.wait(), 'Recurring order creation failed on-chain.');
  const orderId = await resolveTradeIdFromReceipt(
    recurringContract,
    createReceipt as { logs?: unknown[] },
    'Recurring order was created, but the order id could not be resolved.',
    RECURRING_OTC_CONTRACT_ABI
  );

  return {
    orderId,
    escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
    txHash: resolveAcceptedTxHash(createTx as { hash?: unknown }, createReceipt as { hash?: unknown; transactionHash?: unknown })
  };
};

export const editRecurringOrderOnChain = async ({
  signer,
  makerAddress,
  orderId,
  baseAsset,
  quoteAsset,
  buyBaseAmountWei,
  buyQuoteAmountWei,
  sellBaseAmountWei,
  sellQuoteAmountWei,
  addBaseInventoryWei,
  addQuoteInventoryWei,
  removeBaseInventoryWei = 0n,
  removeQuoteInventoryWei = 0n,
  hidePrivateAmounts
}: {
  signer: TradeSigner;
  makerAddress: string;
  orderId: number;
  baseAsset: TradeAssetSelection;
  quoteAsset: TradeAssetSelection;
  buyBaseAmountWei: bigint;
  buyQuoteAmountWei: bigint;
  sellBaseAmountWei: bigint;
  sellQuoteAmountWei: bigint;
  addBaseInventoryWei: bigint;
  addQuoteInventoryWei: bigint;
  removeBaseInventoryWei?: bigint;
  removeQuoteInventoryWei?: bigint;
  hidePrivateAmounts?: boolean;
}): Promise<{ txHash?: string }> => {
  if (orderId <= 0) {
    throw new Error('Select a recurring order to edit.');
  }
  if (buyBaseAmountWei <= 0n || buyQuoteAmountWei <= 0n || sellBaseAmountWei <= 0n || sellQuoteAmountWei <= 0n) {
    throw new Error('Enter buy and sell prices before saving the recurring order.');
  }
  if (addBaseInventoryWei < 0n || addQuoteInventoryWei < 0n) {
    throw new Error('Added inventory cannot be negative.');
  }
  if (removeBaseInventoryWei < 0n || removeQuoteInventoryWei < 0n) {
    throw new Error('Removed liquidity cannot be negative.');
  }

  const recurringContract = await createRecurringOrderContract(signer);
  const recurringAddress = RECURRING_OTC_CONTRACT_ADDRESS;
  const hasPrivateAsset = baseAsset.kind === 'private-erc20' || quoteAsset.kind === 'private-erc20';
  const isPrivateOrder = Boolean(hidePrivateAmounts && hasPrivateAsset);

  if (baseAsset.kind !== 'native' && baseAsset.tokenAddress && addBaseInventoryWei > 0n) {
    await ensureTradeTokenAllowance(
      signer,
      makerAddress,
      baseAsset.tokenAddress,
      addBaseInventoryWei,
      baseAsset.kind,
      recurringAddress
    );
  }
  if (quoteAsset.kind !== 'native' && quoteAsset.tokenAddress && addQuoteInventoryWei > 0n) {
    await ensureTradeTokenAllowance(
      signer,
      makerAddress,
      quoteAsset.tokenAddress,
      addQuoteInventoryWei,
      quoteAsset.kind,
      recurringAddress
    );
  }

  const nativeInventoryWei =
    (baseAsset.kind === 'native' ? addBaseInventoryWei : 0n) +
    (quoteAsset.kind === 'native' ? addQuoteInventoryWei : 0n);
  const selector = await resolveTradeFunctionSelector('editOrder', RECURRING_OTC_CONTRACT_ABI);
  const encryptedAddBaseInventory =
    isPrivateOrder && baseAsset.kind === 'private-erc20'
      ? await encryptPrivateUint256Input(signer, addBaseInventoryWei, recurringAddress, selector)
      : EMPTY_PRIVATE_UINT256_INPUT;
  const encryptedAddQuoteInventory =
    isPrivateOrder && quoteAsset.kind === 'private-erc20'
      ? await encryptPrivateUint256Input(signer, addQuoteInventoryWei, recurringAddress, selector)
      : EMPTY_PRIVATE_UINT256_INPUT;
  const encryptedRemoveBaseInventory =
    isPrivateOrder && baseAsset.kind === 'private-erc20'
      ? await encryptPrivateUint256Input(signer, removeBaseInventoryWei, recurringAddress, selector)
      : EMPTY_PRIVATE_UINT256_INPUT;
  const encryptedRemoveQuoteInventory =
    isPrivateOrder && quoteAsset.kind === 'private-erc20'
      ? await encryptPrivateUint256Input(signer, removeQuoteInventoryWei, recurringAddress, selector)
      : EMPTY_PRIVATE_UINT256_INPUT;
  const publicAddBaseInventory = isPrivateOrder && baseAsset.kind === 'private-erc20' ? 0n : addBaseInventoryWei;
  const publicAddQuoteInventory = isPrivateOrder && quoteAsset.kind === 'private-erc20' ? 0n : addQuoteInventoryWei;
  const publicRemoveBaseInventory = isPrivateOrder && baseAsset.kind === 'private-erc20' ? 0n : removeBaseInventoryWei;
  const publicRemoveQuoteInventory = isPrivateOrder && quoteAsset.kind === 'private-erc20' ? 0n : removeQuoteInventoryWei;

  logTradeContractWrite('editRecurringOrder');
  const editTx = await recurringContract.editOrder(
    orderId,
    buildRecurringTermsTuple(buyBaseAmountWei, buyQuoteAmountWei),
    buildRecurringTermsTuple(sellBaseAmountWei, sellQuoteAmountWei),
    publicAddBaseInventory,
    publicAddQuoteInventory,
    encryptedAddBaseInventory,
    encryptedAddQuoteInventory,
    publicRemoveBaseInventory,
    publicRemoveQuoteInventory,
    encryptedRemoveBaseInventory,
    encryptedRemoveQuoteInventory,
    hasPrivateAsset
      ? { value: nativeInventoryWei, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
      : { value: nativeInventoryWei }
  );
  const editReceipt = requireSuccessfulReceipt(
    (await editTx.wait()) as { status?: number | bigint; hash?: unknown; transactionHash?: unknown },
    'Recurring order edit failed on-chain.'
  );
  return { txHash: resolveAcceptedTxHash(editTx as { hash?: unknown }, editReceipt) };
};

export const fillRecurringOrderSideOnChain = async ({
  signer,
  ownerAddress,
  orderId,
  side,
  inputAsset,
  inputAmountWei,
  hiddenAmounts,
  accessSecret
}: {
  signer: TradeSigner;
  ownerAddress: string;
  orderId: number;
  side: 'buy' | 'sell';
  inputAsset: TradeAssetPayload;
  inputAmountWei: bigint;
  hiddenAmounts?: boolean;
  accessSecret?: string;
}): Promise<{ filledTxHash?: string }> => {
  if (inputAmountWei <= 0n) {
    throw new Error('Enter an amount to fill this recurring order.');
  }

  const recurringContract = await createRecurringOrderContract(signer);
  await ensureRequestPaymentReady(signer, ownerAddress, inputAsset, inputAmountWei, RECURRING_OTC_CONTRACT_ADDRESS);
  if (accessSecret) {
    throw new Error('Recurring private-link orders are no longer supported. Recreate this order as a public or fixed-recipient recurring order.');
  }

  if (hiddenAmounts) {
    const functionName = side === 'buy' ? 'fillPrivateBuySideWithSecret' : 'fillPrivateSellSideWithSecret';
    const selector = await resolveTradeFunctionSelector(functionName, RECURRING_OTC_CONTRACT_ABI);
    const encryptedAmount = await encryptPrivateUint256Input(
      signer,
      inputAsset.kind === 'private-erc20' ? inputAmountWei : 0n,
      RECURRING_OTC_CONTRACT_ADDRESS,
      selector
    );
    const publicAmount = inputAsset.kind === 'private-erc20' ? 0n : inputAmountWei;
    const txOverrides = {
      value: inputAsset.kind === 'native' ? inputAmountWei : 0n,
      gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT
    };
    logTradeContractWrite(functionName);
    const fillTx =
      side === 'buy'
        ? await recurringContract.fillPrivateBuySideWithSecret(orderId, publicAmount, encryptedAmount, 0n, ZERO_BYTES32, txOverrides)
        : await recurringContract.fillPrivateSellSideWithSecret(orderId, publicAmount, encryptedAmount, 0n, ZERO_BYTES32, txOverrides);
    const fillReceipt = requireSuccessfulReceipt(
      (await fillTx.wait()) as { status?: number | bigint; hash?: unknown; transactionHash?: unknown },
      'Recurring order fill failed on-chain.'
    );
    return { filledTxHash: resolveAcceptedTxHash(fillTx as { hash?: unknown }, fillReceipt) };
  }

  const txOverrides =
    inputAsset.kind === 'private-erc20'
      ? { value: 0n, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
      : { value: inputAsset.kind === 'native' ? inputAmountWei : 0n };
  logTradeContractWrite(side === 'buy' ? 'fillBuySideWithSecret' : 'fillSellSideWithSecret');
  const fillTx =
    side === 'buy'
      ? await recurringContract.fillBuySideWithSecret(orderId, inputAmountWei, 0n, ZERO_BYTES32, txOverrides)
      : await recurringContract.fillSellSideWithSecret(orderId, inputAmountWei, 0n, ZERO_BYTES32, txOverrides);
  const fillReceipt = requireSuccessfulReceipt(
    (await fillTx.wait()) as { status?: number | bigint; hash?: unknown; transactionHash?: unknown },
    'Recurring order fill failed on-chain.'
  );
  return { filledTxHash: resolveAcceptedTxHash(fillTx as { hash?: unknown }, fillReceipt) };
};

export const updateRecurringOrderStatusOnChain = async ({
  signer,
  orderId,
  action
}: {
  signer: TradeSigner;
  orderId: number;
  action: 'pause' | 'resume' | 'cancel';
}): Promise<{ txHash?: string }> => {
  const recurringContract = await createRecurringOrderContract(signer);
  logTradeContractWrite(`${action}RecurringOrder`);
  const tx =
    action === 'pause'
      ? await recurringContract.pauseOrder(orderId)
      : action === 'resume'
        ? await recurringContract.resumeOrder(orderId)
        : await recurringContract.cancelOrder(orderId, { gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT });
  const receipt = requireSuccessfulReceipt(
    (await tx.wait()) as { status?: number | bigint; hash?: unknown; transactionHash?: unknown },
    'Recurring order update failed on-chain.'
  );
  return { txHash: resolveAcceptedTxHash(tx as { hash?: unknown }, receipt) };
};

export const acceptTradeOnChain = async ({
  signer,
  ownerAddress,
  tradeId,
  requestAsset,
  requestAmountWei,
  accessSecret
}: {
  signer: TradeSigner;
  ownerAddress: string;
  tradeId: number;
  requestAsset: TradeAssetPayload;
  requestAmountWei?: bigint;
  accessSecret?: string;
}): Promise<{ acceptedTxHash?: string }> => {
  const tradeContract = await createTradeContract(signer);
  const resolvedRequestAmountWei = requestAmountWei ?? BigInt(requestAsset.amount);
  await ensureRequestPaymentReady(signer, ownerAddress, requestAsset, resolvedRequestAmountWei);

  const txOverrides =
    requestAsset.kind === 'private-erc20'
      ? { value: 0n, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
      : { value: requestAsset.kind === 'native' ? resolvedRequestAmountWei : 0n };
  if (accessSecret) {
    throw new Error('This legacy private-link offer should be recreated before it can be accepted without leaking its link secret.');
  }
  logTradeContractWrite('acceptTrade');
  const acceptTx = await tradeContract.acceptTrade(tradeId, txOverrides);
  const acceptReceipt = requireSuccessfulReceipt(
    (await acceptTx.wait()) as { status?: number | bigint; hash?: unknown; transactionHash?: unknown },
    'Trade acceptance failed on-chain.'
  );

  return {
    acceptedTxHash: resolveAcceptedTxHash(acceptTx as { hash?: unknown }, acceptReceipt)
  };
};

export const acceptCounterTradeAndCloseParentOnChain = async ({
  signer,
  ownerAddress,
  tradeId,
  requestAsset,
  requestAmountWei,
  escrowContract,
  accessSecret,
  skipPrivateTokenBalanceCheck
}: {
  signer: TradeSigner;
  ownerAddress: string;
  tradeId: number;
  requestAsset: TradeAssetPayload;
  requestAmountWei?: bigint;
  escrowContract?: string;
  accessSecret?: string;
  useDirectWalletAuthority?: boolean;
  skipPrivateTokenBalanceCheck?: boolean;
}): Promise<{ acceptedTxHash?: string }> => {
  const resolvedEscrowContract = escrowContract ?? TRADE_ESCROW_CONTRACT_ADDRESS;
  const config = resolveTradeEscrowContractConfig(resolvedEscrowContract);
  const tradeContract = await createTradeContract(signer, resolvedEscrowContract);
  const resolvedRequestAmountWei = requestAmountWei ?? BigInt(requestAsset.amount);
  if (requestAsset.kind === 'private-erc20' && requestAsset.tokenAddress) {
    await ensurePrivateTokenSpendReady({
      signer,
      ownerAddress,
      tokenAddress: requestAsset.tokenAddress,
      spenderAddress: resolvedEscrowContract,
      requiredAmount: resolvedRequestAmountWei,
      tokenSymbol: requestAsset.symbol,
      skipBalanceCheck: skipPrivateTokenBalanceCheck
    });
  } else {
    await ensureRequestPaymentReady(signer, ownerAddress, requestAsset, resolvedRequestAmountWei, resolvedEscrowContract);
  }

  const txOverrides =
    requestAsset.kind === 'private-erc20'
      ? { value: 0n, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
      : { value: requestAsset.kind === 'native' ? resolvedRequestAmountWei : 0n };
  let acceptTx: { wait: () => Promise<unknown>; hash?: unknown };
  if (config.directVisible) {
    const functionName = 'acceptCounterTradeAndCloseParent';
    const selector =
      requestAsset.kind === 'private-erc20'
        ? await resolveTradeFunctionSelector(functionName, DIRECT_TRADE_ESCROW_CONTRACT_ABI)
        : '';
    const encryptedRequestAmount =
      requestAsset.kind === 'private-erc20'
        ? await encryptPrivateUint256Input(signer, resolvedRequestAmountWei, resolvedEscrowContract, selector)
        : EMPTY_PRIVATE_UINT256_INPUT;
    logTradeContractWrite(functionName);
    acceptTx = await tradeContract.acceptCounterTradeAndCloseParent(tradeId, encryptedRequestAmount, txOverrides);
  } else {
    if (accessSecret) {
      throw new Error('This legacy counter should be recreated before it can be accepted without leaking its link secret.');
    }
    logTradeContractWrite('acceptCounterTradeAndCloseParent');
    acceptTx = await tradeContract.acceptCounterTradeAndCloseParent(tradeId, txOverrides);
  }
  const acceptReceipt = requireSuccessfulReceipt(
    (await acceptTx.wait()) as { status?: number | bigint; hash?: unknown; transactionHash?: unknown },
    'Counter acceptance failed on-chain.'
  );

  return {
    acceptedTxHash: resolveAcceptedTxHash(acceptTx as { hash?: unknown }, acceptReceipt)
  };
};

export const fillTradeOnChain = async ({
  signer,
  ownerAddress,
  tradeId,
  requestAsset,
  requestAmountWei,
  minOfferAmountOut = 0n,
  accessSecret
}: {
  signer: TradeSigner;
  ownerAddress: string;
  tradeId: number;
  requestAsset: TradeAssetPayload;
  requestAmountWei: bigint;
  minOfferAmountOut?: bigint;
  accessSecret?: string;
}): Promise<{ filledTxHash?: string }> => {
  const tradeContract = await createTradeContract(signer);
  await ensureRequestPaymentReady(signer, ownerAddress, requestAsset, requestAmountWei);

  const txOverrides =
    requestAsset.kind === 'private-erc20'
      ? { value: 0n, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
      : { value: requestAsset.kind === 'native' ? requestAmountWei : 0n };
  if (accessSecret) {
    throw new Error('This legacy private-link offer should be recreated before it can be filled without leaking its link secret.');
  }
  logTradeContractWrite('fillTrade');
  const fillTx = await tradeContract.fillTrade(tradeId, requestAmountWei, minOfferAmountOut, txOverrides);
  const fillReceipt = requireSuccessfulReceipt(
    (await fillTx.wait()) as { status?: number | bigint; hash?: unknown; transactionHash?: unknown },
    'Partial fill failed on-chain.'
  );

  return {
    filledTxHash: resolveAcceptedTxHash(fillTx as { hash?: unknown }, fillReceipt)
  };
};

export const fillPrivateFixedPriceTradeOnChain = async ({
  signer,
  ownerAddress,
  tradeId,
  requestAsset,
  requestAmountWei,
  escrowContract,
  accessSecret,
  useDirectWalletAuthority
}: {
  signer: TradeSigner;
  ownerAddress: string;
  tradeId: number;
  requestAsset: TradeAssetPayload;
  requestAmountWei: bigint;
  escrowContract?: string;
  accessSecret?: string;
  useDirectWalletAuthority?: boolean;
}): Promise<{ filledTxHash?: string; fullyFilled: boolean }> => {
  const resolvedEscrowContract = escrowContract ?? PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS;
  const config = resolveTradeEscrowContractConfig(resolvedEscrowContract);
  const tradeContract = await createTradeContract(signer, resolvedEscrowContract);

  const requestIsPrivate = requestAsset.kind === 'private-erc20';
  if (requestIsPrivate && requestAsset.tokenAddress) {
    await ensurePrivateTokenSpendReady({
      signer,
      ownerAddress,
      tokenAddress: requestAsset.tokenAddress,
      spenderAddress: resolvedEscrowContract,
      requiredAmount: requestAmountWei,
      tokenSymbol: requestAsset.symbol
    });
  } else {
    await ensureRequestPaymentReady(signer, ownerAddress, requestAsset, requestAmountWei, resolvedEscrowContract);
  }

  if (config.directVisible) {
    const onChainAccessSecret = resolveDirectOnChainAccessSecret(accessSecret, useDirectWalletAuthority);
    const functionName = onChainAccessSecret ? 'acceptDirectTradeWithEncryptedAccess' : 'acceptDirectTrade';
    const fillSelector = requestIsPrivate || Boolean(onChainAccessSecret)
      ? await resolveTradeFunctionSelector(functionName, DIRECT_TRADE_ESCROW_CONTRACT_ABI)
      : '';
    const encryptedRequestAmount = requestIsPrivate
      ? await encryptPrivateUint256Input(signer, requestAmountWei, resolvedEscrowContract, fillSelector)
      : EMPTY_PRIVATE_UINT256_INPUT;
    const encryptedAccessSecret = onChainAccessSecret
      ? await encryptAccessSecretInput(signer, onChainAccessSecret, resolvedEscrowContract, fillSelector)
      : EMPTY_PRIVATE_UINT256_INPUT;
    const txOverrides = {
      value: requestAsset.kind === 'native' ? requestAmountWei : 0n,
      gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT
    };
    logTradeContractWrite(functionName);
    const fillTx = onChainAccessSecret
      ? await tradeContract.acceptDirectTradeWithEncryptedAccess(tradeId, encryptedRequestAmount, encryptedAccessSecret, txOverrides)
      : await tradeContract.acceptDirectTrade(tradeId, encryptedRequestAmount, txOverrides);
    const fillReceipt = requireSuccessfulReceipt(
      (await fillTx.wait()) as { status?: number | bigint; hash?: unknown; transactionHash?: unknown },
      'Direct-visible trade fill failed on-chain.'
    );
    return {
      filledTxHash: resolveAcceptedTxHash(fillTx as { hash?: unknown }, fillReceipt),
      fullyFilled: true
    };
  }

  const functionName = resolvePrivateOrderFillFunctionName({ requestIsPrivate, accessSecret });
  const fillSelector = requestIsPrivate || Boolean(accessSecret)
    ? await resolveTradeFunctionSelector(functionName, PRIVATE_TRADE_ESCROW_CONTRACT_ABI)
    : '';
  const encryptedRequestAmount = requestIsPrivate
    ? await encryptPrivateUint256Input(signer, requestAmountWei, resolvedEscrowContract, fillSelector)
    : null;
  const encryptedAccessSecret = accessSecret
    ? await encryptAccessSecretInput(signer, accessSecret, resolvedEscrowContract, fillSelector)
    : EMPTY_PRIVATE_UINT256_INPUT;
  const txOverrides = {
    value: requestAsset.kind === 'native' ? requestAmountWei : 0n,
    gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT
  };
  logTradeContractWrite(functionName);
  const fillTx = requestIsPrivate
    ? accessSecret
      ? await tradeContract.fillPrivateOrderWithEncryptedAccess(tradeId, encryptedRequestAmount, encryptedAccessSecret, txOverrides)
      : await tradeContract.fillPrivateOrder(tradeId, encryptedRequestAmount, txOverrides)
    : accessSecret
      ? await tradeContract.fillHybridPrivateOrderWithEncryptedAccess(tradeId, requestAmountWei, encryptedAccessSecret, txOverrides)
      : await tradeContract.fillHybridPrivateOrder(tradeId, requestAmountWei, txOverrides);
  const fillReceipt = requireSuccessfulReceipt(
    (await fillTx.wait()) as { status?: number | bigint; hash?: unknown; transactionHash?: unknown; logs?: unknown[] },
    requestIsPrivate
      ? 'Private token transfer failed. Check your private balance, approval, and AES unlock.'
      : 'Private order fill failed on-chain.'
  );

  return {
    filledTxHash: resolveAcceptedTxHash(fillTx as { hash?: unknown }, fillReceipt),
    fullyFilled: await resolvePrivateOrderFillResult(fillReceipt)
  };
};

export const acceptDirectVisibleTradeOnChain = async ({
  signer,
  ownerAddress,
  tradeId,
  requestAsset,
  requestAmountWei,
  escrowContract,
  accessSecret,
  useDirectWalletAuthority
}: {
  signer: TradeSigner;
  ownerAddress: string;
  tradeId: number;
  requestAsset: TradeAssetPayload;
  requestAmountWei: bigint;
  escrowContract?: string;
  accessSecret?: string;
  useDirectWalletAuthority?: boolean;
}): Promise<{ acceptedTxHash?: string }> => {
  const resolvedEscrowContract = escrowContract ?? DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS;
  const config = resolveTradeEscrowContractConfig(resolvedEscrowContract);
  if (!config.directVisible) {
    throw new Error('Normal counter fill is available for Direct OTC trades.');
  }
  const result = await fillPrivateFixedPriceTradeOnChain({
    signer,
    ownerAddress,
    tradeId,
    requestAsset,
    requestAmountWei,
    escrowContract: resolvedEscrowContract,
    accessSecret,
    useDirectWalletAuthority
  });
  return { acceptedTxHash: result.filledTxHash };
};

export const replacePrivateFixedPriceTradeOnChain = async ({
  signer,
  makerAddress,
  originalTradeId,
  takerAddress,
  offerAsset,
  offerAmountWei,
  requestAsset,
  requestAmountWei,
  expiresAt,
  nativeFeeWei,
  isPublic,
  accessHash,
  accessSecret,
  hiddenOfferAmountWei,
  hiddenRequestAmountWei,
  publicOfferAmountWei,
  termsHash,
  makerRecoveryPayload
}: {
  signer: TradeSigner;
  makerAddress: string;
  originalTradeId: number;
  takerAddress: string;
  offerAsset: TradeAssetSelection;
  offerAmountWei: bigint;
  requestAsset: TradeAssetSelection;
  requestAmountWei: bigint;
  expiresAt: number;
  nativeFeeWei: bigint;
  isPublic: boolean;
  accessHash?: string;
  accessSecret?: string;
  hiddenOfferAmountWei?: bigint;
  hiddenRequestAmountWei?: bigint;
  publicOfferAmountWei?: bigint;
  termsHash?: string;
  makerRecoveryPayload?: string;
}): Promise<{ tradeId: number; escrowContract: string; txHash?: string }> => {
  if (offerAsset.kind !== 'private-erc20') {
    throw new Error('Private liquidity requires the token you sell to be private.');
  }
  if (requestAsset.kind === 'private-erc20' && requestAsset.tokenAddress === offerAsset.tokenAddress) {
    throw new Error('Hidden amount orders need two different token sides.');
  }

  const resolvedHiddenOfferAmountWei = hiddenOfferAmountWei ?? offerAmountWei;
  const resolvedHiddenRequestAmountWei = hiddenRequestAmountWei ?? requestAmountWei;
  const resolvedPublicOfferAmountWei = publicOfferAmountWei ?? offerAmountWei;
  const tradeContract = await createTradeContract(signer, PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS);
  await ensureOfferEscrowReady(
    signer,
    makerAddress,
    offerAsset,
    resolvedHiddenOfferAmountWei,
    PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS
  );

  const resolvedMakerRecoveryPayload =
    makerRecoveryPayload ??
    (await encryptTradeRecoveryPayloadForSigner(
      signer,
      buildTradeRecoveryPayload({
        kind: 'private-order',
        accessSecret,
        maker: makerAddress,
        taker: takerAddress,
        offer: { kind: offerAsset.kind, tokenAddress: offerAsset.tokenAddress, amount: resolvedHiddenOfferAmountWei.toString() },
        request: { kind: requestAsset.kind, tokenAddress: requestAsset.tokenAddress, amount: resolvedHiddenRequestAmountWei.toString() },
        expiresAt
      })
    ));
  const hasEncryptedAccessSecret = Boolean(accessSecret);
  const editFunctionName = 'cancelAndReplacePrivateOrderWithRecoveryNote';
  const editSelector = await resolveTradeFunctionSelector(editFunctionName, PRIVATE_TRADE_ESCROW_CONTRACT_ABI);
  const privateLinkTerms = hasEncryptedAccessSecret
    ? await buildDirectTermsPayload({
        makerAddress,
        takerAddress,
        offerAsset,
        offerAmountWei: resolvedHiddenOfferAmountWei,
        requestAsset,
        requestAmountWei: resolvedHiddenRequestAmountWei,
        expiresAt,
        directAccessSecret: accessSecret
      })
    : null;
  const resolvedTermsHash =
    termsHash ??
    (privateLinkTerms
      ? (await loadCotiEthersModule()).keccak256(privateLinkTerms.termsPayload)
      : ZERO_BYTES32);
  const encryptedHiddenOfferAmount = await encryptPrivateUint256Input(
    signer,
    resolvedHiddenOfferAmountWei,
    PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
    editSelector
  );
  const encryptedPrivateOfferAmount = hasEncryptedAccessSecret
    ? await encryptPrivateUint256Input(
        signer,
        resolvedHiddenOfferAmountWei,
        PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
        editSelector
      )
    : EMPTY_PRIVATE_UINT256_INPUT;
  const encryptedPrivateRequestAmount = hasEncryptedAccessSecret
    ? await encryptPrivateUint256Input(
        signer,
        resolvedHiddenRequestAmountWei,
        PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
        editSelector
      )
    : EMPTY_PRIVATE_UINT256_INPUT;
  const encryptedAccessSecret = hasEncryptedAccessSecret
    ? await encryptAccessSecretInput(signer, accessSecret!, PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS, editSelector)
    : EMPTY_PRIVATE_UINT256_INPUT;
  const editArgs = [
    originalTradeId,
    buildTradeAssetTuple(offerAsset, hasEncryptedAccessSecret ? 0n : resolvedPublicOfferAmountWei),
    buildTradeAssetTuple(requestAsset, hasEncryptedAccessSecret ? 0n : requestAmountWei),
    takerAddress,
    expiresAt,
    isPublic,
    accessHash ?? ZERO_BYTES32,
    resolvedTermsHash,
    encryptedHiddenOfferAmount,
    encryptedPrivateOfferAmount,
    encryptedPrivateRequestAmount
  ] as const;
  logTradeContractWrite(editFunctionName);
  const editTx = await tradeContract.cancelAndReplacePrivateOrderWithRecoveryNote(
    ...editArgs,
    resolvedMakerRecoveryPayload,
    encryptedAccessSecret,
    privateLinkTerms?.termsPayload ?? '0x',
    { value: nativeFeeWei, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
  );
  const editReceipt = requireSuccessfulReceipt(await editTx.wait(), 'Private trade edit failed on-chain.');
  const tradeId = await resolveTradeIdFromReceipt(
    tradeContract,
    editReceipt as { logs?: unknown[] },
    'Private trade was edited, but the replacement trade id could not be resolved.',
    PRIVATE_TRADE_ESCROW_CONTRACT_ABI
  );

  return {
    tradeId,
    escrowContract: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
    txHash: resolveAcceptedTxHash(editTx as { hash?: unknown }, editReceipt as { hash?: unknown; transactionHash?: unknown })
  };
};

export const editTradeOnChain = async ({
  signer,
  makerAddress,
  originalTradeId,
  takerAddress,
  offerAsset,
  offerAmountWei,
  requestAsset,
  requestAmountWei,
  expiresAt,
  nativeFeeWei,
  isPublic,
  accessHash
}: {
  signer: TradeSigner;
  makerAddress: string;
  originalTradeId: number;
  takerAddress: string;
  offerAsset: TradeAssetSelection;
  offerAmountWei: bigint;
  requestAsset: TradeAssetSelection;
  requestAmountWei: bigint;
  expiresAt: number;
  nativeFeeWei: bigint;
  isPublic: boolean;
  accessHash?: string;
}): Promise<{ tradeId: number; escrowContract: string; txHash?: string }> => {
  const tradeContract = await createTradeContract(signer);
  await ensureOfferEscrowReady(signer, makerAddress, offerAsset, offerAmountWei);

  const valueToSend = (offerAsset.kind === 'native' ? offerAmountWei : 0n) + nativeFeeWei;
  const editOverrides =
    offerAsset.kind === 'private-erc20'
      ? { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
      : { value: valueToSend };
  logTradeContractWrite('editTrade');
  const editTx = await tradeContract.editTrade(
    originalTradeId,
    buildTradeAssetTuple(offerAsset, offerAmountWei),
    buildTradeAssetTuple(requestAsset, requestAmountWei),
    takerAddress,
    expiresAt,
    isPublic,
    accessHash ?? ZERO_BYTES32,
    editOverrides
  );
  const editReceipt = requireSuccessfulReceipt(await editTx.wait(), 'Trade edit failed on-chain.');
  const tradeId = await resolveTradeIdFromReceipt(
    tradeContract,
    editReceipt as { logs?: unknown[] },
    'Trade was edited, but the replacement trade id could not be resolved.'
  );

  return {
    tradeId,
    escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
    txHash: resolveAcceptedTxHash(editTx as { hash?: unknown }, editReceipt as { hash?: unknown; transactionHash?: unknown })
  };
};

export const editDirectTradeOnChain = async ({
  signer,
  makerAddress,
  originalTradeId,
  takerAddress,
  offerAsset,
  offerAmountWei,
  requestAsset,
  requestAmountWei,
  expiresAt,
  nativeFeeWei,
  directAccessSecret,
  parentEscrowContract,
  parentTradeId
}: {
  signer: TradeSigner;
  makerAddress: string;
  originalTradeId: number;
  takerAddress: string;
  offerAsset: TradeAssetSelection;
  offerAmountWei: bigint;
  requestAsset: TradeAssetSelection;
  requestAmountWei: bigint;
  expiresAt: number;
  nativeFeeWei: bigint;
  directAccessSecret?: string;
  parentEscrowContract?: string;
  parentTradeId?: number;
}): Promise<{ tradeId: number; escrowContract: string; txHash?: string }> => {
  if (!isDirectTradeEscrowConfigured()) {
    throw new Error('Direct OTC edits need the V1 Direct OTC escrow.');
  }

  const { accessSecret: resolvedDirectAccessSecret, termsPayload } = await buildDirectTermsPayload({
    makerAddress,
    takerAddress,
    offerAsset,
    offerAmountWei,
    requestAsset,
    requestAmountWei,
    expiresAt,
    directAccessSecret,
    parentEscrowContract,
    parentTradeId
  });

  const directContract = await createTradeContract(signer, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS);
  await ensureOfferEscrowReady(signer, makerAddress, offerAsset, offerAmountWei, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS);
  const editSelector = await resolveTradeFunctionSelector('editDirectTrade', DIRECT_TRADE_ESCROW_CONTRACT_ABI);
  const encryptedOfferAmount =
    offerAsset.kind === 'private-erc20'
      ? await encryptPrivateUint256Input(signer, offerAmountWei, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS, editSelector)
      : EMPTY_PRIVATE_UINT256_INPUT;
  const encryptedRequestAmount =
    requestAsset.kind === 'private-erc20'
      ? await encryptPrivateUint256Input(signer, requestAmountWei, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS, editSelector)
      : EMPTY_PRIVATE_UINT256_INPUT;
  const publicAmounts = {
    offerAmount: offerAsset.kind === 'private-erc20' ? 0n : offerAmountWei,
    requestAmount: requestAsset.kind === 'private-erc20' ? 0n : requestAmountWei
  };
  const valueToSend = (offerAsset.kind === 'native' ? offerAmountWei : 0n) + nativeFeeWei;
  const cotiEthers = await loadCotiEthersModule();
  const termsHash = cotiEthers.keccak256(termsPayload);
  const encryptedAccessSecret = await encryptAccessSecretInput(
    signer,
    resolvedDirectAccessSecret,
    DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
    editSelector
  );
  logTradeContractWrite('editDirectTrade');
  const editTx = await directContract.editDirectTrade(
    originalTradeId,
    [resolveTradeAssetTypeValue(offerAsset.kind), offerAsset.tokenAddress ?? ZERO_ADDRESS],
    [resolveTradeAssetTypeValue(requestAsset.kind), requestAsset.tokenAddress ?? ZERO_ADDRESS],
    publicAmounts,
    encryptedOfferAmount,
    encryptedRequestAmount,
    takerAddress,
    expiresAt,
    cotiEthers.keccak256(resolvedDirectAccessSecret),
    termsHash,
    encryptedAccessSecret,
    termsPayload,
    { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
  );
  const editReceipt = requireSuccessfulReceipt(await editTx.wait(), 'Direct OTC edit failed on-chain.');
  const tradeId = await resolveTradeIdFromReceipt(
    directContract,
    editReceipt as { logs?: unknown[] },
    'Direct OTC trade was edited, but the replacement trade id could not be resolved.',
    DIRECT_TRADE_ESCROW_CONTRACT_ABI
  );

  return {
    tradeId,
    escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
    txHash: resolveAcceptedTxHash(editTx as { hash?: unknown }, editReceipt as { hash?: unknown; transactionHash?: unknown })
  };
};

export const counterTradeAndCloseCounteredTradeOnChain = async ({
  signer,
  makerAddress,
  counteredTradeId,
  offerAsset,
  offerAmountWei,
  requestAsset,
  requestAmountWei,
  expiresAt,
  nativeFeeWei,
  directAccessSecret,
  counterTakerAddress,
  counteredEscrowContract,
  parentEscrowContract,
  parentTradeId
}: {
  signer: TradeSigner;
  makerAddress: string;
  counteredTradeId: number;
  offerAsset: TradeAssetSelection;
  offerAmountWei: bigint;
  requestAsset: TradeAssetSelection;
  requestAmountWei: bigint;
  expiresAt: number;
  nativeFeeWei: bigint;
  directAccessSecret?: string;
  counterTakerAddress?: string;
  counteredEscrowContract?: string;
  parentEscrowContract?: string;
  parentTradeId?: number;
}): Promise<{ tradeId: number; escrowContract: string; txHash?: string }> => {
  if (!isDirectTradeEscrowConfigured()) {
    throw new Error(
      'Counter replacement needs the V1 Direct OTC escrow before it can be created with private on-chain recovery.'
    );
  }
  if (
    isLegacyPrivateOrderEscrowContractAddress(counteredEscrowContract) ||
    isLegacyPrivateOrderEscrowContractAddress(parentEscrowContract)
  ) {
    throw new Error(PRIVATE_ORDER_COUNTER_UNAVAILABLE_MESSAGE);
  }
  if (!counterTakerAddress) {
    throw new Error('Direct-visible counter replacements need the counterparty wallet before creation.');
  }
  const { accessSecret: resolvedDirectAccessSecret, termsPayload } = await buildDirectTermsPayload({
    makerAddress,
    takerAddress: counterTakerAddress,
    offerAsset,
    offerAmountWei,
    requestAsset,
    requestAmountWei,
    expiresAt,
    directAccessSecret,
    parentEscrowContract,
    parentTradeId
  });

  const directContract = await createTradeContract(signer, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS);
  await ensureOfferEscrowReady(signer, makerAddress, offerAsset, offerAmountWei, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS);
  const counterSelector = await resolveTradeFunctionSelector(
    'counterTradeAndCloseCounteredTrade',
    DIRECT_TRADE_ESCROW_CONTRACT_ABI
  );
  const encryptedOfferAmount =
    offerAsset.kind === 'private-erc20'
      ? await encryptPrivateUint256Input(signer, offerAmountWei, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS, counterSelector)
      : EMPTY_PRIVATE_UINT256_INPUT;
  const encryptedRequestAmount =
    requestAsset.kind === 'private-erc20'
      ? await encryptPrivateUint256Input(signer, requestAmountWei, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS, counterSelector)
      : EMPTY_PRIVATE_UINT256_INPUT;
  const valueToSend = (offerAsset.kind === 'native' ? offerAmountWei : 0n) + nativeFeeWei;
  const cotiEthers = await loadCotiEthersModule();
  const termsHash = cotiEthers.keccak256(termsPayload);
  const encryptedAccessSecret = await encryptAccessSecretInput(
    signer,
    resolvedDirectAccessSecret,
    DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
    counterSelector
  );
  const directAssetArgs = [
    [resolveTradeAssetTypeValue(offerAsset.kind), offerAsset.tokenAddress ?? ZERO_ADDRESS],
    [resolveTradeAssetTypeValue(requestAsset.kind), requestAsset.tokenAddress ?? ZERO_ADDRESS],
    {
      offerAmount: offerAsset.kind === 'private-erc20' ? 0n : offerAmountWei,
      requestAmount: requestAsset.kind === 'private-erc20' ? 0n : requestAmountWei
    },
    encryptedOfferAmount,
    encryptedRequestAmount,
    expiresAt,
    cotiEthers.keccak256(resolvedDirectAccessSecret),
    termsHash,
    encryptedAccessSecret,
    termsPayload
  ] as const;
  const counteredEscrowIsDirect =
    !counteredEscrowContract ||
    counteredEscrowContract.toLowerCase() === DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase();
  logTradeContractWrite(counteredEscrowIsDirect ? 'counterTradeAndCloseCounteredTrade' : 'createDirectCounterTradeForParent');
  const counterTx = counteredEscrowIsDirect
    ? await directContract.counterTradeAndCloseCounteredTrade(counteredTradeId, ...directAssetArgs, {
        value: valueToSend,
        gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT
      })
    : parentEscrowContract && parentTradeId && counterTakerAddress
      ? await directContract.createDirectCounterTradeForParent(
          parentEscrowContract,
          parentTradeId,
          counterTakerAddress,
          ...directAssetArgs,
          { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
        )
      : (() => {
          throw new Error('Private-token counter replacement needs the original parent trade context.');
        })();
  const counterReceipt = requireSuccessfulReceipt(await counterTx.wait(), 'Counter replacement failed on-chain.');
  const tradeId = await resolveTradeIdFromReceipt(
    directContract,
    counterReceipt as { logs?: unknown[] },
    'Counter was created, but the trade id could not be resolved.',
    DIRECT_TRADE_ESCROW_CONTRACT_ABI
  );

  return {
    tradeId,
    escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
    txHash: resolveAcceptedTxHash(counterTx as { hash?: unknown }, counterReceipt as { hash?: unknown; transactionHash?: unknown })
  };
};

const runTradeActionOnChain = async ({
  signer,
  tradeId,
  escrowContract,
  action
}: {
  signer: TradeSigner;
  tradeId: number;
  escrowContract?: string;
  action: 'decline' | 'cancel';
}): Promise<{ txHash?: string }> => {
  const config = resolveTradeEscrowContractConfig(escrowContract);
  const tradeContract = await createTradeContract(signer, config.address);
  const overrides = config.hiddenOnly ? { gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT } : undefined;
  logTradeContractWrite(action === 'decline' ? 'declineTrade' : 'cancelTrade');
  const tx =
    action === 'decline'
      ? await tradeContract.declineTrade(tradeId, overrides ?? {})
      : await tradeContract.cancelTrade(tradeId, overrides ?? {});
  const receipt = requireSuccessfulReceipt(
    (await tx.wait()) as { status?: number | bigint; hash?: unknown; transactionHash?: unknown },
    action === 'decline' ? 'Trade refusal failed on-chain.' : 'Trade cancellation failed on-chain.'
  );
  return { txHash: resolveAcceptedTxHash(tx as { hash?: unknown }, receipt) };
};

export const declineTradeOnChain = async ({
  signer,
  tradeId,
  escrowContract
}: {
  signer: TradeSigner;
  tradeId: number;
  escrowContract?: string;
}): Promise<{ txHash?: string }> => {
  return await runTradeActionOnChain({
    signer,
    tradeId,
    escrowContract,
    action: 'decline'
  });
};

export const cancelTradeOnChain = async ({
  signer,
  tradeId,
  escrowContract
}: {
  signer: TradeSigner;
  tradeId: number;
  escrowContract?: string;
}): Promise<{ txHash?: string }> => {
  return await runTradeActionOnChain({
    signer,
    tradeId,
    escrowContract,
    action: 'cancel'
  });
};
