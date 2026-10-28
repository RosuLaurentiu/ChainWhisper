import {
  Contract,
  Interface,
  getAddress,
  type JsonRpcSigner,
  type TransactionReceipt,
  type TransactionResponse
} from '@coti-io/coti-ethers';
import {
  assertAttestedDexV2Deployment,
  type AttestedDexV2Deployment
} from './dexV2Chain';
import { DEX_V2_CONFIRMATIONS, DEX_V2_RECEIPT_TIMEOUT_MS } from './dexV2SwapExecution';
import { scaleDexV2LotsToRaw } from './dexV2Terms';
import { decryptPrivateUint256Output, encryptPrivateUint256Input } from './privateUint256';

export const DEX_V2_PRIVATE_APPROVAL_GAS_LIMIT = 10_000_000n;
const UINT256_MAX = (1n << 256n) - 1n;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;

export const DEX_V2_PRIVATE_TOKEN_ABI = Object.freeze([
  'function accountEncryptionAddress(address account) view returns (address)',
  'function setAccountEncryptionAddress(address offBoardAddress) returns (bool)',
  'function publicAmountsEnabled() view returns (bool)',
  'function allowance(address owner,address spender) view returns (((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) ownerCiphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) spenderCiphertext))',
  'function reencryptAllowance(address account,bool isSpender)',
  'function approve(address spender,uint256 amount)',
  'function approve(address spender,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) amount)',
  'function increaseAllowance(address spender,uint256 amount)',
  'function increaseAllowance(address spender,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) amount)'
] as const);

const TOKEN = new Interface(DEX_V2_PRIVATE_TOKEN_ABI);

const address = (value: unknown, label: string, allowZero = false): string => {
  try {
    const normalized = getAddress(String(value)).toLowerCase();
    if (!allowZero && normalized === ZERO_ADDRESS) throw new Error('zero');
    return normalized;
  } catch {
    throw new Error(`${label} is invalid.`);
  }
};

const uint = (value: unknown, label: string): bigint => {
  try {
    const parsed = BigInt(value as bigint | number | string);
    if (parsed < 0n || parsed > UINT256_MAX) throw new Error('range');
    return parsed;
  } catch {
    throw new Error(`${label} is invalid.`);
  }
};

const wait = async (transaction: TransactionResponse, label: string): Promise<string> => {
  let transactionHash = transaction.hash.toLowerCase();
  let receipt: TransactionReceipt | null = null;
  try {
    receipt = await transaction.wait(DEX_V2_CONFIRMATIONS, DEX_V2_RECEIPT_TIMEOUT_MS);
  } catch (error) {
    const replacement = error as {
      code?: unknown;
      cancelled?: unknown;
      reason?: unknown;
      replacement?: TransactionResponse;
      receipt?: TransactionReceipt;
    };
    if (replacement?.code !== 'TRANSACTION_REPLACED') throw error;
    if (replacement.cancelled === true || replacement.reason === 'cancelled' || !replacement.replacement) {
      throw new Error(`${label} replacement was cancelled.`);
    }
    transactionHash = replacement.replacement.hash.toLowerCase();
    receipt = replacement.receipt ?? await replacement.replacement.wait(
      DEX_V2_CONFIRMATIONS,
      DEX_V2_RECEIPT_TIMEOUT_MS
    );
  }
  if (!receipt || receipt.status !== 1 || receipt.hash.toLowerCase() !== transactionHash) {
    throw new Error(`${label} transaction did not succeed.`);
  }
  return transactionHash;
};

const ownerCiphertext = (value: unknown): Readonly<{ ciphertextHigh: bigint; ciphertextLow: bigint }> | null => {
  if (!value || typeof value !== 'object') return null;
  const tuple = value as Record<string | number, unknown>;
  const selected = tuple.ownerCiphertext ?? tuple[1];
  if (!selected || typeof selected !== 'object') return null;
  const ciphertext = selected as Record<string | number, unknown>;
  try {
    return Object.freeze({
      ciphertextHigh: uint(ciphertext.ciphertextHigh ?? ciphertext[0], 'DEX V2 allowance high word'),
      ciphertextLow: uint(ciphertext.ciphertextLow ?? ciphertext[1], 'DEX V2 allowance low word')
    });
  } catch {
    return null;
  }
};

const readAllowance = async (
  contract: Contract,
  signer: JsonRpcSigner,
  owner: string,
  spender: string
): Promise<bigint | null> => {
  const encrypted = ownerCiphertext(await contract.allowance(owner, spender));
  if (!encrypted) return null;
  if (encrypted.ciphertextHigh === 0n && encrypted.ciphertextLow === 0n) return 0n;
  try {
    return decryptPrivateUint256Output(signer, encrypted);
  } catch {
    return null;
  }
};

export class DexV2AllowancePrivacyRefreshRequiredError extends Error {
  constructor() {
    super('Refresh the wallet privacy key before reading this private-token allowance again.');
    this.name = 'DexV2AllowancePrivacyRefreshRequiredError';
  }
}

export const isDexV2AllowancePrivacyRefreshRequired = (
  error: unknown
): error is DexV2AllowancePrivacyRefreshRequiredError =>
  error instanceof DexV2AllowancePrivacyRefreshRequiredError;

export type DexV2AllowanceStage = 'setting-up-token' | 'refreshing-allowance' | 'approving-token';

export const ensureDexV2InputAllowance = async ({
  deployment,
  inputToken,
  maximumInputLots,
  signer,
  onStage
}: {
  deployment: AttestedDexV2Deployment;
  inputToken: string;
  maximumInputLots: bigint;
  signer: JsonRpcSigner;
  onStage?: (stage: DexV2AllowanceStage) => void;
}): Promise<Readonly<{
  requiredRawAmount: bigint;
  accountSetupTransactionHash?: string;
  allowanceRefreshTransactionHash?: string;
  approvalTransactionHash?: string;
}>> => {
  const verified = assertAttestedDexV2Deployment(deployment);
  const owner = address(await signer.getAddress(), 'DEX V2 allowance owner');
  const network = await signer.provider.getNetwork();
  if (network.chainId !== BigInt(verified.manifest.chainId)) {
    throw new Error('The selected wallet is not connected to the activated DEX chain.');
  }
  const token = address(inputToken, 'DEX V2 input token');
  const pair = verified.manifest.pair;
  const isBase = token === pair.baseToken;
  if (!isBase && token !== pair.quoteToken) throw new Error('DEX V2 input token is outside the activated pair.');
  const requiredRawAmount = scaleDexV2LotsToRaw(
    maximumInputLots,
    BigInt(isBase ? pair.baseLotSize : pair.quoteLotSize)
  );
  if (requiredRawAmount === 0n) throw new Error('DEX V2 allowance requirement cannot be zero.');
  const core = verified.manifest.addresses.core;
  const contract = new Contract(token, DEX_V2_PRIVATE_TOKEN_ABI, signer);
  let accountSetupTransactionHash: string | undefined;
  let allowanceRefreshTransactionHash: string | undefined;
  let approvalTransactionHash: string | undefined;

  const configured = address(
    await contract.accountEncryptionAddress(owner),
    'DEX V2 private-token encryption address',
    true
  );
  if (configured !== owner) {
    onStage?.('setting-up-token');
    const transaction = await contract.setAccountEncryptionAddress(owner, {
      gasLimit: DEX_V2_PRIVATE_APPROVAL_GAS_LIMIT
    });
    accountSetupTransactionHash = await wait(transaction, 'DEX V2 private-token account setup');
  }

  let allowance = await readAllowance(contract, signer, owner, core);
  if (allowance === null) {
    onStage?.('refreshing-allowance');
    const refresh = await contract.reencryptAllowance(core, false, {
      gasLimit: DEX_V2_PRIVATE_APPROVAL_GAS_LIMIT
    });
    allowanceRefreshTransactionHash = await wait(refresh, 'DEX V2 allowance refresh');
    allowance = await readAllowance(contract, signer, owner, core);
    if (allowance === null) throw new DexV2AllowancePrivacyRefreshRequiredError();
  }
  if (allowance < requiredRawAmount) {
    onStage?.('approving-token');
    const publicAmounts = await contract.publicAmountsEnabled() === true;
    const increasing = allowance > 0n;
    const functionName = increasing ? 'increaseAllowance' : 'approve';
    const signature = publicAmounts
      ? `${functionName}(address,uint256)`
      : `${functionName}(address,((uint256,uint256),bytes))`;
    const selector = TOKEN.getFunction(signature)?.selector;
    if (!selector) throw new Error('DEX V2 private-token approval selector is unavailable.');
    const missing = requiredRawAmount - allowance;
    const value = publicAmounts
      ? missing
      : await encryptPrivateUint256Input(signer, missing, token, selector);
    const approval = contract[signature];
    if (typeof approval !== 'function') throw new Error('DEX V2 private-token approval is unavailable.');
    const transaction = await approval(core, value, { gasLimit: DEX_V2_PRIVATE_APPROVAL_GAS_LIMIT });
    approvalTransactionHash = await wait(transaction, 'DEX V2 private-token approval');
  }
  return Object.freeze({
    requiredRawAmount,
    ...(accountSetupTransactionHash ? { accountSetupTransactionHash } : {}),
    ...(allowanceRefreshTransactionHash ? { allowanceRefreshTransactionHash } : {}),
    ...(approvalTransactionHash ? { approvalTransactionHash } : {})
  });
};
