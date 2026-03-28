import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import { ensureGroupTokenFeeAllowance, resolveGroupSubmitGasLimit } from './appChain';
import {
  GROUP_CHAT_CONTRACT_ABI,
  GROUP_CHAT_CONTRACT_ADDRESS,
  loadCotiEthersModule,
  parseSubmitMemoPayload
} from './appShared';

type GroupSigner = Wallet | JsonRpcSigner;

type SubmitGroupMemoArgs = {
  signer: GroupSigner;
  groupId: number;
  plainText: string;
  selector: string;
  paymentMode: number;
  requestedWalletAddress: string;
  requiredFee: bigint;
  requiredTokenFee?: bigint;
  privateRewardTokenBalanceWei: bigint | null;
  encodeMemo: (plain: string) => string;
};

export const submitGroupMemo = async ({
  signer,
  groupId,
  plainText,
  selector,
  paymentMode,
  requestedWalletAddress,
  requiredFee,
  requiredTokenFee = 0n,
  privateRewardTokenBalanceWei,
  encodeMemo
}: SubmitGroupMemoArgs): Promise<{ txHash: string; wait: () => Promise<unknown> }> => {
  const cotiEthers = await loadCotiEthersModule();
  const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);

  if (paymentMode === 1) {
    await ensureGroupTokenFeeAllowance(
      signer,
      requestedWalletAddress,
      requiredTokenFee,
      privateRewardTokenBalanceWei
    );
  }

  const encodedMemo = encodeMemo(plainText);
  const encryptedMemo = await signer.encryptValue(encodedMemo, GROUP_CHAT_CONTRACT_ADDRESS, selector);
  const submitMemoPayload = parseSubmitMemoPayload(encryptedMemo);
  const memoTuple = [[submitMemoPayload.ciphertextValue], submitMemoPayload.signature] as const;
  const gasLimitOverride = await resolveGroupSubmitGasLimit(
    contract,
    groupId,
    memoTuple,
    paymentMode,
    requiredFee
  );
  const tx = await contract.submitGroupMessageWithMode(
    groupId,
    memoTuple,
    paymentMode,
    gasLimitOverride !== null
      ? {
          value: requiredFee,
          gasLimit: gasLimitOverride
        }
      : { value: requiredFee }
  );
  const waitableTx = tx as { hash?: unknown; wait?: () => Promise<unknown> };
  const wait =
    typeof waitableTx.wait === 'function'
      ? waitableTx.wait.bind(waitableTx)
      : async () => undefined;

  return {
    txHash: typeof waitableTx.hash === 'string' ? waitableTx.hash : '',
    wait
  };
};
