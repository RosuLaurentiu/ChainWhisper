import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import {
  ensurePrivateTokenSpendReady,
  ensureTradeTokenAllowance,
  isPartyTradeEscrowConfigured,
  resolveTradeEscrowContractConfig
} from './appChain';
import { resolveTradeAssetTypeValue } from './appHelpers';
import {
  loadCotiEthersModule,
  PARTY_TRADE_ESCROW_CONTRACT_ABI,
  PARTY_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ABI,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  RECURRING_OTC_CONTRACT_ABI,
  RECURRING_OTC_CONTRACT_ADDRESS,
  toSafeNumber,
  TRADE_ESCROW_CONTRACT_ABI,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload
} from './appShared';
import { buildPartyTradeTerms, encryptPartyTradeTerms } from './partyTradeTerms';
import { EMPTY_PRIVATE_UINT256_INPUT, encryptPrivateUint256Input } from './privateUint256';

type TradeSigner = Wallet | JsonRpcSigner;

type TradeAssetSelection = Pick<TradeAssetPayload, 'kind' | 'tokenAddress'>;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
const PRIVATE_TRADE_WRITE_GAS_LIMIT = 8_000_000n;

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

const tradeUsesPrivateToken = (offerAsset: TradeAssetSelection, requestAsset: TradeAssetSelection): boolean =>
  offerAsset.kind === 'private-erc20' || requestAsset.kind === 'private-erc20';

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

const resolveTradeIdFromReceipt = async (
  tradeContract: Awaited<ReturnType<typeof createTradeContract>>,
  receipt: { logs?: unknown[] },
  fallbackErrorMessage: string,
  abi:
    | typeof TRADE_ESCROW_CONTRACT_ABI
    | typeof PRIVATE_TRADE_ESCROW_CONTRACT_ABI
    | typeof PARTY_TRADE_ESCROW_CONTRACT_ABI
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
        parsedLog?.name === 'PartyTradeOpened' ||
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
    | typeof PARTY_TRADE_ESCROW_CONTRACT_ABI
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
  parentTradeId,
  hidePrivateLiquidity,
  hiddenOfferAmountWei,
  publicOfferAmountWei,
  termsHash,
  makerTermsPayload,
  counterpartyTermsPayload,
  partyAccessSecret,
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
  parentTradeId?: number;
  hidePrivateLiquidity?: boolean;
  hiddenOfferAmountWei?: bigint;
  publicOfferAmountWei?: bigint;
  termsHash?: string;
  makerTermsPayload?: string;
  counterpartyTermsPayload?: string;
  partyAccessSecret?: string;
  parentEscrowContract?: string;
}): Promise<{ tradeId: number; escrowContract: string }> => {
  if (hidePrivateLiquidity) {
    if (parentTradeId) {
      throw new Error('Hidden amount orders cannot be linked as counter offers yet.');
    }
    if (offerAsset.kind !== 'private-erc20') {
      throw new Error('Hide amount requires the token you sell to be private.');
    }
    if (requestAsset.kind === 'private-erc20' && requestAsset.tokenAddress === offerAsset.tokenAddress) {
      throw new Error('Hidden amount orders need two different token sides.');
    }

    const resolvedHiddenOfferAmountWei = hiddenOfferAmountWei ?? offerAmountWei;
    const resolvedPublicOfferAmountWei = publicOfferAmountWei ?? offerAmountWei;
    const tradeContract = await createTradeContract(signer, PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS);
    await ensureOfferEscrowReady(
      signer,
      makerAddress,
      offerAsset,
      resolvedHiddenOfferAmountWei,
      PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS
    );

    const createSelector = await resolveTradeFunctionSelector(
      'createPrivateOrder',
      PRIVATE_TRADE_ESCROW_CONTRACT_ABI
    );
    const encryptedHiddenOfferAmount = await encryptPrivateUint256Input(
      signer,
      resolvedHiddenOfferAmountWei,
      PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
      createSelector
    );
    const createTx = await tradeContract.createPrivateOrder(
      buildTradeAssetTuple(offerAsset, resolvedPublicOfferAmountWei),
      buildTradeAssetTuple(requestAsset, requestAmountWei),
      takerAddress,
      expiresAt,
      Boolean(isPublic),
      accessHash ?? ZERO_BYTES32,
      termsHash ?? ZERO_BYTES32,
      encryptedHiddenOfferAmount,
      { value: nativeFeeWei, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
    );
    const createReceipt = requireSuccessfulReceipt(await createTx.wait(), 'Trade creation failed on-chain.');
    const tradeId = await resolveTradeIdFromReceipt(
      tradeContract,
      createReceipt as { logs?: unknown[] },
      'Trade was created, but the trade id could not be resolved.',
      PRIVATE_TRADE_ESCROW_CONTRACT_ABI
    );

    return { tradeId, escrowContract: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS };
  }

  const shouldUsePartyVisibleEscrow = (!isPublic || Boolean(parentTradeId)) && tradeUsesPrivateToken(offerAsset, requestAsset);
  if (shouldUsePartyVisibleEscrow) {
    if (!isPartyTradeEscrowConfigured()) {
      throw new Error(
        'Private-link, direct, and counter trades with visible amounts need the V1 party OTC escrow before they can be created without public amount leakage.'
      );
    }
    let resolvedMakerTermsPayload = makerTermsPayload;
    let resolvedCounterpartyTermsPayload = counterpartyTermsPayload;
    let resolvedTermsHash = termsHash;
    if ((!resolvedMakerTermsPayload || !resolvedCounterpartyTermsPayload) && partyAccessSecret) {
      const encryptedTerms = await encryptPartyTradeTerms(
        buildPartyTradeTerms({
          maker: makerAddress,
          taker: takerAddress,
          offer: { kind: offerAsset.kind, tokenAddress: offerAsset.tokenAddress, amount: offerAmountWei.toString() },
          request: { kind: requestAsset.kind, tokenAddress: requestAsset.tokenAddress, amount: requestAmountWei.toString() },
          expiresAt,
          parentEscrowContract,
          parentTradeId
        }),
        partyAccessSecret
      );
      resolvedMakerTermsPayload = encryptedTerms;
      resolvedCounterpartyTermsPayload = encryptedTerms;
    }
    if (!resolvedMakerTermsPayload || !resolvedCounterpartyTermsPayload) {
      throw new Error('Party-visible trades need encrypted on-chain term payloads before creation.');
    }

    const tradeContract = await createTradeContract(signer, PARTY_TRADE_ESCROW_CONTRACT_ADDRESS);
    await ensureOfferEscrowReady(signer, makerAddress, offerAsset, offerAmountWei, PARTY_TRADE_ESCROW_CONTRACT_ADDRESS);
    const parentEscrowIsExternal =
      Boolean(parentTradeId && parentEscrowContract) &&
      parentEscrowContract?.toLowerCase() !== PARTY_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase();
    const createFunctionName = parentTradeId
      ? parentEscrowIsExternal
        ? 'createPartyCounterTradeForParent'
        : 'createPartyCounterTrade'
      : 'createPartyTrade';
    const createSelector = await resolveTradeFunctionSelector(createFunctionName, PARTY_TRADE_ESCROW_CONTRACT_ABI);
    if (!resolvedTermsHash) {
      const cotiEthers = await loadCotiEthersModule();
      resolvedTermsHash = cotiEthers.keccak256(resolvedMakerTermsPayload);
    }
    const encryptedOfferAmount =
      offerAsset.kind === 'private-erc20'
        ? await encryptPrivateUint256Input(signer, offerAmountWei, PARTY_TRADE_ESCROW_CONTRACT_ADDRESS, createSelector)
        : EMPTY_PRIVATE_UINT256_INPUT;
    const encryptedRequestAmount =
      requestAsset.kind === 'private-erc20'
        ? await encryptPrivateUint256Input(signer, requestAmountWei, PARTY_TRADE_ESCROW_CONTRACT_ADDRESS, createSelector)
        : EMPTY_PRIVATE_UINT256_INPUT;
    const publicAmounts = {
      offerAmount: offerAsset.kind === 'private-erc20' ? 0n : offerAmountWei,
      requestAmount: requestAsset.kind === 'private-erc20' ? 0n : requestAmountWei
    };
    const valueToSend = (offerAsset.kind === 'native' ? offerAmountWei : 0n) + nativeFeeWei;
    const createTx = parentTradeId
      ? parentEscrowIsExternal
        ? await tradeContract.createPartyCounterTradeForParent(
            parentEscrowContract ?? ZERO_ADDRESS,
            parentTradeId,
            takerAddress,
            [resolveTradeAssetTypeValue(offerAsset.kind), offerAsset.tokenAddress ?? ZERO_ADDRESS],
            [resolveTradeAssetTypeValue(requestAsset.kind), requestAsset.tokenAddress ?? ZERO_ADDRESS],
            publicAmounts,
            encryptedOfferAmount,
            encryptedRequestAmount,
            expiresAt,
            resolvedTermsHash ?? ZERO_BYTES32,
            resolvedMakerTermsPayload,
            resolvedCounterpartyTermsPayload,
            { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
          )
        : await tradeContract.createPartyCounterTrade(
          parentTradeId,
          [resolveTradeAssetTypeValue(offerAsset.kind), offerAsset.tokenAddress ?? ZERO_ADDRESS],
          [resolveTradeAssetTypeValue(requestAsset.kind), requestAsset.tokenAddress ?? ZERO_ADDRESS],
          publicAmounts,
          encryptedOfferAmount,
          encryptedRequestAmount,
          expiresAt,
          resolvedTermsHash ?? ZERO_BYTES32,
          resolvedMakerTermsPayload,
          resolvedCounterpartyTermsPayload,
          { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
        )
      : await tradeContract.createPartyTrade(
          [resolveTradeAssetTypeValue(offerAsset.kind), offerAsset.tokenAddress ?? ZERO_ADDRESS],
          [resolveTradeAssetTypeValue(requestAsset.kind), requestAsset.tokenAddress ?? ZERO_ADDRESS],
          publicAmounts,
          encryptedOfferAmount,
          encryptedRequestAmount,
          takerAddress,
          expiresAt,
          accessHash ?? ZERO_BYTES32,
          resolvedTermsHash ?? ZERO_BYTES32,
          resolvedMakerTermsPayload,
          resolvedCounterpartyTermsPayload,
          { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
        );
    const createReceipt = requireSuccessfulReceipt(await createTx.wait(), 'Trade creation failed on-chain.');
    const tradeId = await resolveTradeIdFromReceipt(
      tradeContract,
      createReceipt as { logs?: unknown[] },
      'Trade was created, but the trade id could not be resolved.',
      PARTY_TRADE_ESCROW_CONTRACT_ABI
    );

    return { tradeId, escrowContract: PARTY_TRADE_ESCROW_CONTRACT_ADDRESS };
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

  return { tradeId, escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS };
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
  hidePrivateAmounts?: boolean;
}): Promise<{ orderId: number; escrowContract: string }> => {
  if (baseAsset.kind === quoteAsset.kind && (baseAsset.tokenAddress ?? ZERO_ADDRESS).toLowerCase() === (quoteAsset.tokenAddress ?? ZERO_ADDRESS).toLowerCase()) {
    throw new Error('Recurring orders need two different assets.');
  }
  if (buyBaseAmountWei <= 0n || buyQuoteAmountWei <= 0n || sellBaseAmountWei <= 0n || sellQuoteAmountWei <= 0n) {
    throw new Error('Enter buy and sell prices before creating a recurring order.');
  }
  if (initialBaseInventoryWei <= 0n && initialQuoteInventoryWei <= 0n) {
    throw new Error('Fund at least one side of the recurring order.');
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

  const createTx = isPrivateOrder
    ? await (async () => {
        const selector = await resolveTradeFunctionSelector('createPrivateRecurringOrder', RECURRING_OTC_CONTRACT_ABI);
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
        return recurringContract.createPrivateRecurringOrder(
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
          encryptedQuoteInventory,
          { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
        );
      })()
    : await recurringContract.createRecurringOrder(
        baseAssetTuple,
        quoteAssetTuple,
        buyTermsTuple,
        sellTermsTuple,
        ZERO_ADDRESS,
        Boolean(isPublic),
        accessHash ?? ZERO_BYTES32,
        initialBaseInventoryWei,
        initialQuoteInventoryWei,
        hasPrivateAsset
          ? { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
          : { value: valueToSend }
      );
  const createReceipt = requireSuccessfulReceipt(await createTx.wait(), 'Recurring order creation failed on-chain.');
  const orderId = await resolveTradeIdFromReceipt(
    recurringContract,
    createReceipt as { logs?: unknown[] },
    'Recurring order was created, but the order id could not be resolved.',
    RECURRING_OTC_CONTRACT_ABI
  );

  return { orderId, escrowContract: RECURRING_OTC_CONTRACT_ADDRESS };
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
}): Promise<void> => {
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
  requireSuccessfulReceipt(await editTx.wait(), 'Recurring order edit failed on-chain.');
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
    const fillAccessSecret = accessSecret ?? ZERO_BYTES32;
    const fillTx =
      side === 'buy'
        ? await recurringContract.fillPrivateBuySideWithSecret(orderId, publicAmount, encryptedAmount, 0n, fillAccessSecret, txOverrides)
        : await recurringContract.fillPrivateSellSideWithSecret(orderId, publicAmount, encryptedAmount, 0n, fillAccessSecret, txOverrides);
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
  const fillAccessSecret = accessSecret ?? ZERO_BYTES32;
  const fillTx =
    side === 'buy'
      ? await recurringContract.fillBuySideWithSecret(orderId, inputAmountWei, 0n, fillAccessSecret, txOverrides)
      : await recurringContract.fillSellSideWithSecret(orderId, inputAmountWei, 0n, fillAccessSecret, txOverrides);
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
}): Promise<void> => {
  const recurringContract = await createRecurringOrderContract(signer);
  const tx =
    action === 'pause'
      ? await recurringContract.pauseOrder(orderId)
      : action === 'resume'
        ? await recurringContract.resumeOrder(orderId)
        : await recurringContract.cancelOrder(orderId);
  requireSuccessfulReceipt(await tx.wait(), 'Recurring order update failed on-chain.');
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
  const acceptTx = accessSecret
    ? await tradeContract.acceptTradeWithSecret(tradeId, accessSecret, txOverrides)
    : await tradeContract.acceptTrade(tradeId, txOverrides);
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
  accessSecret
}: {
  signer: TradeSigner;
  ownerAddress: string;
  tradeId: number;
  requestAsset: TradeAssetPayload;
  requestAmountWei?: bigint;
  escrowContract?: string;
  accessSecret?: string;
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
      tokenSymbol: requestAsset.symbol
    });
  } else {
    await ensureRequestPaymentReady(signer, ownerAddress, requestAsset, resolvedRequestAmountWei, resolvedEscrowContract);
  }

  const txOverrides =
    requestAsset.kind === 'private-erc20'
      ? { value: 0n, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
      : { value: requestAsset.kind === 'native' ? resolvedRequestAmountWei : 0n };
  let acceptTx: { wait: () => Promise<unknown>; hash?: unknown };
  if (config.partyVisible) {
    const functionName = accessSecret ? 'acceptCounterTradeAdvancedAndCloseParent' : 'acceptCounterTradeAndCloseParent';
    const selector =
      requestAsset.kind === 'private-erc20'
        ? await resolveTradeFunctionSelector(functionName, PARTY_TRADE_ESCROW_CONTRACT_ABI)
        : '';
    const encryptedRequestAmount =
      requestAsset.kind === 'private-erc20'
        ? await encryptPrivateUint256Input(signer, resolvedRequestAmountWei, resolvedEscrowContract, selector)
        : EMPTY_PRIVATE_UINT256_INPUT;
    acceptTx = accessSecret
      ? await tradeContract.acceptCounterTradeAdvancedAndCloseParent(tradeId, encryptedRequestAmount, accessSecret, txOverrides)
      : await tradeContract.acceptCounterTradeAndCloseParent(tradeId, encryptedRequestAmount, txOverrides);
  } else {
    acceptTx = accessSecret
      ? await tradeContract.acceptCounterTradeAdvancedAndCloseParent(tradeId, accessSecret, txOverrides)
      : await tradeContract.acceptCounterTradeAndCloseParent(tradeId, txOverrides);
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
  const fillTx = accessSecret
    ? await tradeContract.fillTradeAdvanced(tradeId, requestAmountWei, minOfferAmountOut, accessSecret, txOverrides)
    : await tradeContract.fillTrade(tradeId, requestAmountWei, minOfferAmountOut, txOverrides);
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
  accessSecret
}: {
  signer: TradeSigner;
  ownerAddress: string;
  tradeId: number;
  requestAsset: TradeAssetPayload;
  requestAmountWei: bigint;
  escrowContract?: string;
  accessSecret?: string;
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

  if (config.partyVisible) {
    const functionName = accessSecret ? 'acceptPartyTradeWithSecret' : 'acceptPartyTrade';
    const fillSelector = requestIsPrivate
      ? await resolveTradeFunctionSelector(functionName, PARTY_TRADE_ESCROW_CONTRACT_ABI)
      : '';
    const encryptedRequestAmount = requestIsPrivate
      ? await encryptPrivateUint256Input(signer, requestAmountWei, resolvedEscrowContract, fillSelector)
      : EMPTY_PRIVATE_UINT256_INPUT;
    const txOverrides = {
      value: requestAsset.kind === 'native' ? requestAmountWei : 0n,
      gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT
    };
    const fillTx = accessSecret
      ? await tradeContract.acceptPartyTradeWithSecret(tradeId, encryptedRequestAmount, accessSecret, txOverrides)
      : await tradeContract.acceptPartyTrade(tradeId, encryptedRequestAmount, txOverrides);
    const fillReceipt = requireSuccessfulReceipt(
      (await fillTx.wait()) as { status?: number | bigint; hash?: unknown; transactionHash?: unknown },
      'Party-visible trade fill failed on-chain.'
    );
    return {
      filledTxHash: resolveAcceptedTxHash(fillTx as { hash?: unknown }, fillReceipt),
      fullyFilled: true
    };
  }

  const functionName = requestIsPrivate
    ? accessSecret
      ? 'fillPrivateOrderWithSecret'
      : 'fillPrivateOrder'
    : accessSecret
      ? 'fillHybridPrivateOrderWithSecret'
      : 'fillHybridPrivateOrder';
  const fillSelector = requestIsPrivate
    ? await resolveTradeFunctionSelector(functionName, PRIVATE_TRADE_ESCROW_CONTRACT_ABI)
    : '';
  const encryptedRequestAmount = requestIsPrivate
    ? await encryptPrivateUint256Input(signer, requestAmountWei, resolvedEscrowContract, fillSelector)
    : null;
  const txOverrides = {
    value: requestAsset.kind === 'native' ? requestAmountWei : 0n,
    gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT
  };
  const fillTx = requestIsPrivate
    ? accessSecret
      ? await tradeContract.fillPrivateOrderWithSecret(tradeId, encryptedRequestAmount, accessSecret, txOverrides)
      : await tradeContract.fillPrivateOrder(tradeId, encryptedRequestAmount, txOverrides)
    : accessSecret
      ? await tradeContract.fillHybridPrivateOrderWithSecret(tradeId, requestAmountWei, accessSecret, txOverrides)
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
  hiddenOfferAmountWei,
  publicOfferAmountWei,
  termsHash
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
  hiddenOfferAmountWei?: bigint;
  publicOfferAmountWei?: bigint;
  termsHash?: string;
}): Promise<{ tradeId: number; escrowContract: string }> => {
  if (offerAsset.kind !== 'private-erc20') {
    throw new Error('Hide amount requires the token you sell to be private.');
  }
  if (requestAsset.kind === 'private-erc20' && requestAsset.tokenAddress === offerAsset.tokenAddress) {
    throw new Error('Hidden amount orders need two different token sides.');
  }

  const resolvedHiddenOfferAmountWei = hiddenOfferAmountWei ?? offerAmountWei;
  const resolvedPublicOfferAmountWei = publicOfferAmountWei ?? offerAmountWei;
  const tradeContract = await createTradeContract(signer, PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS);
  await ensureOfferEscrowReady(
    signer,
    makerAddress,
    offerAsset,
    resolvedHiddenOfferAmountWei,
    PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS
  );

  const editSelector = await resolveTradeFunctionSelector(
    'cancelAndReplacePrivateOrder',
    PRIVATE_TRADE_ESCROW_CONTRACT_ABI
  );
  const encryptedHiddenOfferAmount = await encryptPrivateUint256Input(
    signer,
    resolvedHiddenOfferAmountWei,
    PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
    editSelector
  );
  const editTx = await tradeContract.cancelAndReplacePrivateOrder(
    originalTradeId,
    buildTradeAssetTuple(offerAsset, resolvedPublicOfferAmountWei),
    buildTradeAssetTuple(requestAsset, requestAmountWei),
    takerAddress,
    expiresAt,
    isPublic,
    accessHash ?? ZERO_BYTES32,
    termsHash ?? ZERO_BYTES32,
    encryptedHiddenOfferAmount,
    { value: nativeFeeWei, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
  );
  const editReceipt = requireSuccessfulReceipt(await editTx.wait(), 'Private trade edit failed on-chain.');
  const tradeId = await resolveTradeIdFromReceipt(
    tradeContract,
    editReceipt as { logs?: unknown[] },
    'Private trade was edited, but the replacement trade id could not be resolved.',
    PRIVATE_TRADE_ESCROW_CONTRACT_ABI
  );

  return { tradeId, escrowContract: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS };
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
}): Promise<{ tradeId: number; escrowContract: string }> => {
  const tradeContract = await createTradeContract(signer);
  await ensureOfferEscrowReady(signer, makerAddress, offerAsset, offerAmountWei);

  const valueToSend = (offerAsset.kind === 'native' ? offerAmountWei : 0n) + nativeFeeWei;
  const editOverrides =
    offerAsset.kind === 'private-erc20'
      ? { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
      : { value: valueToSend };
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

  return { tradeId, escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS };
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
  makerTermsPayload,
  counterpartyTermsPayload,
  partyAccessSecret,
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
  makerTermsPayload?: string;
  counterpartyTermsPayload?: string;
  partyAccessSecret?: string;
  counterTakerAddress?: string;
  counteredEscrowContract?: string;
  parentEscrowContract?: string;
  parentTradeId?: number;
}): Promise<{ tradeId: number; escrowContract: string }> => {
  if (!tradeUsesPrivateToken(offerAsset, requestAsset)) {
    const tradeContract = await createTradeContract(signer);
    await ensureOfferEscrowReady(signer, makerAddress, offerAsset, offerAmountWei);
    const valueToSend = (offerAsset.kind === 'native' ? offerAmountWei : 0n) + nativeFeeWei;
    const counterOverrides =
      offerAsset.kind === 'private-erc20'
        ? { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
        : { value: valueToSend };
    const counterTx = await tradeContract.counterTradeAndCloseCounteredTrade(
      counteredTradeId,
      buildTradeAssetTuple(offerAsset, offerAmountWei),
      buildTradeAssetTuple(requestAsset, requestAmountWei),
      expiresAt,
      counterOverrides
    );
    const counterReceipt = requireSuccessfulReceipt(await counterTx.wait(), 'Counter replacement failed on-chain.');
    const tradeId = await resolveTradeIdFromReceipt(
      tradeContract,
      counterReceipt as { logs?: unknown[] },
      'Counter was created, but the trade id could not be resolved.'
    );
    return { tradeId, escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS };
  }

  if (!isPartyTradeEscrowConfigured()) {
    throw new Error(
      'Counter replacement needs the V1 party OTC escrow before it can be created without public amount leakage.'
    );
  }
  let resolvedMakerTermsPayload = makerTermsPayload;
  let resolvedCounterpartyTermsPayload = counterpartyTermsPayload;
  if ((!resolvedMakerTermsPayload || !resolvedCounterpartyTermsPayload) && partyAccessSecret && counterTakerAddress) {
    const encryptedTerms = await encryptPartyTradeTerms(
      buildPartyTradeTerms({
        maker: makerAddress,
        taker: counterTakerAddress,
        offer: { kind: offerAsset.kind, tokenAddress: offerAsset.tokenAddress, amount: offerAmountWei.toString() },
        request: { kind: requestAsset.kind, tokenAddress: requestAsset.tokenAddress, amount: requestAmountWei.toString() },
        expiresAt,
        parentEscrowContract,
        parentTradeId
      }),
      partyAccessSecret
    );
    resolvedMakerTermsPayload = encryptedTerms;
    resolvedCounterpartyTermsPayload = encryptedTerms;
  }
  if (!resolvedMakerTermsPayload || !resolvedCounterpartyTermsPayload) {
    throw new Error('Party-visible counter replacements need encrypted on-chain term payloads before creation.');
  }

  const partyContract = await createTradeContract(signer, PARTY_TRADE_ESCROW_CONTRACT_ADDRESS);
  await ensureOfferEscrowReady(signer, makerAddress, offerAsset, offerAmountWei, PARTY_TRADE_ESCROW_CONTRACT_ADDRESS);
  const counterSelector = await resolveTradeFunctionSelector(
    'counterTradeAndCloseCounteredTrade',
    PARTY_TRADE_ESCROW_CONTRACT_ABI
  );
  const encryptedOfferAmount =
    offerAsset.kind === 'private-erc20'
      ? await encryptPrivateUint256Input(signer, offerAmountWei, PARTY_TRADE_ESCROW_CONTRACT_ADDRESS, counterSelector)
      : EMPTY_PRIVATE_UINT256_INPUT;
  const encryptedRequestAmount =
    requestAsset.kind === 'private-erc20'
      ? await encryptPrivateUint256Input(signer, requestAmountWei, PARTY_TRADE_ESCROW_CONTRACT_ADDRESS, counterSelector)
      : EMPTY_PRIVATE_UINT256_INPUT;
  const valueToSend = (offerAsset.kind === 'native' ? offerAmountWei : 0n) + nativeFeeWei;
  const cotiEthers = await loadCotiEthersModule();
  const termsHash = cotiEthers.keccak256(resolvedMakerTermsPayload);
  const partyAssetArgs = [
    [resolveTradeAssetTypeValue(offerAsset.kind), offerAsset.tokenAddress ?? ZERO_ADDRESS],
    [resolveTradeAssetTypeValue(requestAsset.kind), requestAsset.tokenAddress ?? ZERO_ADDRESS],
    {
      offerAmount: offerAsset.kind === 'private-erc20' ? 0n : offerAmountWei,
      requestAmount: requestAsset.kind === 'private-erc20' ? 0n : requestAmountWei
    },
    encryptedOfferAmount,
    encryptedRequestAmount,
    expiresAt,
    termsHash,
    resolvedMakerTermsPayload,
    resolvedCounterpartyTermsPayload
  ] as const;
  const counteredEscrowIsParty =
    !counteredEscrowContract ||
    counteredEscrowContract.toLowerCase() === PARTY_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase();
  const counterTx = counteredEscrowIsParty
    ? await partyContract.counterTradeAndCloseCounteredTrade(counteredTradeId, ...partyAssetArgs, {
        value: valueToSend,
        gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT
      })
    : parentEscrowContract && parentTradeId && counterTakerAddress
      ? await partyContract.createPartyCounterTradeForParent(
          parentEscrowContract,
          parentTradeId,
          counterTakerAddress,
          ...partyAssetArgs,
          { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
        )
      : (() => {
          throw new Error('Private-token counter replacement needs the original parent trade context.');
        })();
  const counterReceipt = requireSuccessfulReceipt(await counterTx.wait(), 'Counter replacement failed on-chain.');
  const tradeId = await resolveTradeIdFromReceipt(
    partyContract,
    counterReceipt as { logs?: unknown[] },
    'Counter was created, but the trade id could not be resolved.',
    PARTY_TRADE_ESCROW_CONTRACT_ABI
  );

  return { tradeId, escrowContract: PARTY_TRADE_ESCROW_CONTRACT_ADDRESS };
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
}) => {
  const config = resolveTradeEscrowContractConfig(escrowContract);
  const tradeContract = await createTradeContract(signer, config.address);
  const overrides = config.hiddenOnly ? { gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT } : undefined;
  const tx =
    action === 'decline'
      ? await tradeContract.declineTrade(tradeId, overrides ?? {})
      : await tradeContract.cancelTrade(tradeId, overrides ?? {});
  requireSuccessfulReceipt(
    await tx.wait(),
    action === 'decline' ? 'Trade refusal failed on-chain.' : 'Trade cancellation failed on-chain.'
  );
};

export const declineTradeOnChain = async ({
  signer,
  tradeId,
  escrowContract
}: {
  signer: TradeSigner;
  tradeId: number;
  escrowContract?: string;
}) => {
  await runTradeActionOnChain({
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
}) => {
  await runTradeActionOnChain({
    signer,
    tradeId,
    escrowContract,
    action: 'cancel'
  });
};
