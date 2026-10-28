import type { JsonRpcSigner } from '@coti-io/coti-ethers';
import {
  ERC20_TOKEN_ABI,
  PRIVATE_ERC20_TOKEN_VNEXT_ABI,
  TIP_NATIVE_TOKEN_SYMBOL,
  formatCotiAmount,
  formatTokenAmount,
  isWalletAddress,
  loadCotiEthersModule,
  type TradeAssetPayload
} from './appShared';
import { encryptPrivateUint256Input } from './privateUint256';
import { waitForPublicTransactionReceipt } from './publicTransactionReceipt';

type TradeSigner = JsonRpcSigner;

export type WalletFundAsset = Pick<TradeAssetPayload, 'kind' | 'tokenAddress' | 'symbol' | 'decimals'> & {
  custom?: boolean;
};

export type CombinedWalletAssetBalance = {
  asset: WalletFundAsset;
  balanceWei: bigint | null;
  combinedBalanceWei: bigint | null;
  shortfallWei: bigint | null;
  privacyRequired: boolean;
  availableLabel: string;
  breakdownLabel: string;
  splitLabel: string;
};

export type WalletFundingRequirement = {
  asset: WalletFundAsset;
  amountWei: bigint;
  reason?: string;
};

const PRIVATE_TOKEN_WRITE_GAS_LIMIT = 6_000_000n;

const assertSuccessfulWalletFundReceipt = (receipt: unknown, label: string): void => {
  const status = (receipt as { status?: number | bigint } | null)?.status;
  if (status !== undefined && Number(status) !== 1) {
    throw new Error(`${label} failed on-chain.`);
  }
};

const normalizeBalance = (balanceWei: bigint | null | undefined): bigint | null =>
  typeof balanceWei === 'bigint' ? balanceWei : null;

export const formatWalletFundAmount = (amountWei: bigint, asset: WalletFundAsset, decimals = 6): string =>
  asset.kind === 'native'
    ? `${formatCotiAmount(amountWei, decimals)} ${TIP_NATIVE_TOKEN_SYMBOL}`
    : `${formatTokenAmount(amountWei, asset.decimals, decimals)} ${asset.symbol}`;

export const buildCombinedWalletAssetBalance = ({
  asset,
  balanceWei,
  privacyRequired = false,
  requiredAmountWei = 0n
}: {
  asset: WalletFundAsset;
  balanceWei: bigint | null | undefined;
  privacyRequired?: boolean;
  requiredAmountWei?: bigint;
}): CombinedWalletAssetBalance => {
  const connectedBalance = normalizeBalance(balanceWei);
  const combinedBalanceWei = connectedBalance;
  const shortfallWei =
    requiredAmountWei > 0n && connectedBalance !== null && requiredAmountWei > connectedBalance
      ? requiredAmountWei - connectedBalance
      : 0n;
  const availableLabel =
    combinedBalanceWei === null
      ? `Available -- ${asset.symbol}`
      : `Available ${formatWalletFundAmount(combinedBalanceWei, asset)}`;
  const connectedWalletLabel = connectedBalance === null
    ? privacyRequired ? 'privacy locked' : `-- ${asset.symbol}`
    : formatWalletFundAmount(connectedBalance, asset);

  return {
    asset,
    balanceWei: connectedBalance,
    combinedBalanceWei,
    shortfallWei,
    privacyRequired,
    availableLabel,
    breakdownLabel: `${connectedWalletLabel} in connected wallet`,
    splitLabel: `${availableLabel} - ${connectedWalletLabel} in connected wallet`
  };
};

export const transferWalletFundAsset = async ({
  amountWei,
  asset,
  signer,
  toAddress
}: {
  amountWei: bigint;
  asset: WalletFundAsset;
  signer: TradeSigner;
  toAddress: string;
}): Promise<string> => {
  if (amountWei <= 0n) {
    throw new Error('Move amount must be greater than zero.');
  }
  if (!isWalletAddress(toAddress)) {
    throw new Error('Destination account address is invalid.');
  }

  if (asset.kind === 'native') {
    const tx = await signer.sendTransaction({ to: toAddress, value: amountWei });
    const receipt = await waitForPublicTransactionReceipt({
      transactionHash: tx.hash,
      label: `${asset.symbol} transfer`
    });
    assertSuccessfulWalletFundReceipt(receipt, `${asset.symbol} transfer`);
    return tx.hash ?? (receipt as { hash?: string; transactionHash?: string } | null)?.transactionHash ?? '';
  }

  const tokenAddress = asset.tokenAddress?.trim() ?? '';
  if (!isWalletAddress(tokenAddress)) {
    throw new Error(`${asset.symbol} token address is invalid.`);
  }

  const cotiEthers = await loadCotiEthersModule();
  if (asset.kind === 'private-erc20') {
    const tokenInterface = new cotiEthers.Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI);
    const transferFunction = tokenInterface.getFunction('transfer(address,((uint256,uint256),bytes))');
    const selector = transferFunction?.selector;
    if (!selector) {
      throw new Error(`Unable to prepare private ${asset.symbol} transfer.`);
    }
    const encryptedAmount = await encryptPrivateUint256Input(signer, amountWei, tokenAddress, selector);
    const tokenContract = new cotiEthers.Contract(tokenAddress, PRIVATE_ERC20_TOKEN_VNEXT_ABI, signer);
    const writeFunction = tokenContract['transfer(address,((uint256,uint256),bytes))'] as (
      recipient: string,
      value: unknown,
      overrides: { gasLimit: bigint }
    ) => Promise<{ hash?: string; wait: () => Promise<unknown> }>;
    const tx = await writeFunction(toAddress, encryptedAmount, { gasLimit: PRIVATE_TOKEN_WRITE_GAS_LIMIT });
    const receipt = await waitForPublicTransactionReceipt({
      transactionHash: tx.hash,
      label: `${asset.symbol} transfer`
    });
    assertSuccessfulWalletFundReceipt(receipt, `${asset.symbol} transfer`);
    return tx.hash ?? (receipt as { hash?: string; transactionHash?: string } | null)?.transactionHash ?? '';
  }

  const tokenContract = new cotiEthers.Contract(tokenAddress, ERC20_TOKEN_ABI, signer);
  const tx = await tokenContract.transfer(toAddress, amountWei);
  const receipt = await waitForPublicTransactionReceipt({
    transactionHash: tx.hash,
    label: `${asset.symbol} transfer`
  });
  assertSuccessfulWalletFundReceipt(receipt, `${asset.symbol} transfer`);
  return tx.hash ?? (receipt as { hash?: string; transactionHash?: string } | null)?.transactionHash ?? '';
};
