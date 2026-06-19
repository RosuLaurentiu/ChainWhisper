import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
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

type TradeSigner = JsonRpcSigner | Wallet;

export type WalletFundAsset = Pick<TradeAssetPayload, 'kind' | 'tokenAddress' | 'symbol' | 'decimals'>;

export type CombinedWalletAssetBalance = {
  asset: WalletFundAsset;
  chainwhisperBalanceWei: bigint | null;
  ownerBalanceWei: bigint | null;
  combinedBalanceWei: bigint | null;
  chainwhisperShortfallWei: bigint | null;
  ownerPrivacyRequired: boolean;
  availableLabel: string;
  splitLabel: string;
};

export type WalletFundingRequirement = {
  asset: WalletFundAsset;
  amountWei: bigint;
  reason?: string;
};

export type WalletFundingResolution =
  | {
      status: 'ready';
      shortfallWei: 0n;
    }
  | {
      status: 'needs-owner-transfer';
      shortfallWei: bigint;
    }
  | {
      status: 'owner-privacy-required';
      shortfallWei: bigint;
    }
  | {
      status: 'insufficient';
      shortfallWei: bigint;
    }
  | {
      status: 'unknown';
      shortfallWei: null;
    };

export type WalletCotiFeeReserveResolution =
  | {
      status: 'ready';
      topUpAmountWei: 0n;
    }
  | {
      status: 'top-up';
      topUpAmountWei: bigint;
    }
  | {
      status: 'owner-insufficient';
      topUpAmountWei: bigint;
    }
  | {
      status: 'unknown';
      topUpAmountWei: null;
    };

export const CHAINWHISPER_COTI_FEE_RESERVE_WEI = 250_000_000_000_000_000n;

const PRIVATE_TOKEN_WRITE_GAS_LIMIT = 6_000_000n;

const normalizeBalance = (balanceWei: bigint | null | undefined): bigint | null =>
  typeof balanceWei === 'bigint' ? balanceWei : null;

export const formatWalletFundAmount = (amountWei: bigint, asset: WalletFundAsset, decimals = 6): string =>
  asset.kind === 'native'
    ? `${formatCotiAmount(amountWei, decimals)} ${TIP_NATIVE_TOKEN_SYMBOL}`
    : `${formatTokenAmount(amountWei, asset.decimals, decimals)} ${asset.symbol}`;

export const buildCombinedWalletAssetBalance = ({
  asset,
  chainwhisperBalanceWei,
  ownerBalanceWei,
  ownerPrivacyRequired = false,
  requiredAmountWei = 0n
}: {
  asset: WalletFundAsset;
  chainwhisperBalanceWei: bigint | null | undefined;
  ownerBalanceWei: bigint | null | undefined;
  ownerPrivacyRequired?: boolean;
  requiredAmountWei?: bigint;
}): CombinedWalletAssetBalance => {
  const chainwhisperBalance = normalizeBalance(chainwhisperBalanceWei);
  const ownerBalance = normalizeBalance(ownerBalanceWei);
  const combinedBalanceWei =
    chainwhisperBalance === null && ownerBalance === null
      ? null
      : (chainwhisperBalance ?? 0n) + (ownerBalance ?? 0n);
  const shortfallWei =
    requiredAmountWei > 0n && chainwhisperBalance !== null && requiredAmountWei > chainwhisperBalance
      ? requiredAmountWei - chainwhisperBalance
      : 0n;
  const availableLabel =
    combinedBalanceWei === null
      ? `Available -- ${asset.symbol}`
      : `Available ${formatWalletFundAmount(combinedBalanceWei, asset)}`;
  const chainwhisperLabel =
    chainwhisperBalance === null ? `-- ${asset.symbol}` : formatWalletFundAmount(chainwhisperBalance, asset);
  const ownerLabel =
    ownerBalance === null
      ? ownerPrivacyRequired
        ? 'locked'
        : `-- ${asset.symbol}`
      : formatWalletFundAmount(ownerBalance, asset);

  return {
    asset,
    chainwhisperBalanceWei: chainwhisperBalance,
    ownerBalanceWei: ownerBalance,
    combinedBalanceWei,
    chainwhisperShortfallWei: shortfallWei,
    ownerPrivacyRequired,
    availableLabel,
    splitLabel: `${availableLabel} - ${chainwhisperLabel} in ChainWhisper - ${ownerLabel} in owner wallet`
  };
};

export const resolveWalletFundingRequirement = ({
  chainwhisperBalanceWei,
  ownerBalanceWei,
  ownerPrivacyRequired = false,
  requiredAmountWei
}: {
  chainwhisperBalanceWei: bigint | null | undefined;
  ownerBalanceWei: bigint | null | undefined;
  ownerPrivacyRequired?: boolean;
  requiredAmountWei: bigint;
}): WalletFundingResolution => {
  if (requiredAmountWei <= 0n) {
    return { status: 'ready', shortfallWei: 0n };
  }

  const chainwhisperBalance = normalizeBalance(chainwhisperBalanceWei);
  if (chainwhisperBalance === null) {
    return { status: 'unknown', shortfallWei: null };
  }
  if (chainwhisperBalance >= requiredAmountWei) {
    return { status: 'ready', shortfallWei: 0n };
  }

  const shortfallWei = requiredAmountWei - chainwhisperBalance;
  if (ownerPrivacyRequired) {
    return { status: 'owner-privacy-required', shortfallWei };
  }

  const ownerBalance = normalizeBalance(ownerBalanceWei);
  if (ownerBalance === null) {
    return { status: 'unknown', shortfallWei: null };
  }
  if (ownerBalance >= shortfallWei) {
    return { status: 'needs-owner-transfer', shortfallWei };
  }
  return { status: 'insufficient', shortfallWei };
};

export const isNativeCotiFundAsset = (asset: WalletFundAsset): boolean => asset.kind === 'native';

export const resolveCotiFeeReserveFunding = ({
  chainwhisperBalanceWei,
  nativeRequiredAmountWei = 0n,
  ownerBalanceWei,
  reserveWei = CHAINWHISPER_COTI_FEE_RESERVE_WEI
}: {
  chainwhisperBalanceWei: bigint | null | undefined;
  nativeRequiredAmountWei?: bigint;
  ownerBalanceWei: bigint | null | undefined;
  reserveWei?: bigint;
}): WalletCotiFeeReserveResolution => {
  if (reserveWei <= 0n) {
    return { status: 'ready', topUpAmountWei: 0n };
  }

  const chainwhisperBalance = normalizeBalance(chainwhisperBalanceWei);
  if (chainwhisperBalance === null) {
    return { status: 'unknown', topUpAmountWei: null };
  }

  const desiredBalanceWei = nativeRequiredAmountWei > 0n
    ? nativeRequiredAmountWei + reserveWei
    : reserveWei;
  if (chainwhisperBalance >= desiredBalanceWei) {
    return { status: 'ready', topUpAmountWei: 0n };
  }

  const topUpAmountWei = desiredBalanceWei - chainwhisperBalance;
  const ownerBalance = normalizeBalance(ownerBalanceWei);
  if (ownerBalance === null) {
    return { status: 'unknown', topUpAmountWei: null };
  }
  if (ownerBalance >= topUpAmountWei) {
    return { status: 'top-up', topUpAmountWei };
  }
  return { status: 'owner-insufficient', topUpAmountWei };
};

export const estimateWalletFundingPromptCount = (requirements: WalletFundingRequirement[]): number =>
  requirements.reduce((total, requirement) => {
    if (requirement.amountWei <= 0n) {
      return total;
    }
    return total + (requirement.asset.kind === 'private-erc20' ? 2 : 1);
  }, 0);

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
    const receipt = await tx.wait();
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
    const receipt = await tx.wait();
    return tx.hash ?? (receipt as { hash?: string; transactionHash?: string } | null)?.transactionHash ?? '';
  }

  const tokenContract = new cotiEthers.Contract(tokenAddress, ERC20_TOKEN_ABI, signer);
  const tx = await tokenContract.transfer(toAddress, amountWei);
  const receipt = await tx.wait();
  return tx.hash ?? (receipt as { hash?: string; transactionHash?: string } | null)?.transactionHash ?? '';
};
