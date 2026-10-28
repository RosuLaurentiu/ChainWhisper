import { getAddress } from '@coti-io/coti-ethers';
import type { ParsedTradeHistoryV2PrivateReceipt } from './tradeHistoryV2Events';
import { decryptPrivateUint256Output } from './privateUint256';
import type { TradeHistoryV2Amounts } from './tradeHistoryV2Ledger';
import {
  assertAttestedTradeHistoryV2Deployment,
  type AttestedTradeHistoryV2Deployment
} from './tradeHistoryV2Chain';
import {
  assertOwnerTradeV2CapabilityCurrent,
  getOwnerTradeV2CapabilityBinding,
  type OwnerTradeV2MetaMaskCapability
} from './ownerTradeV2Capability';

const UINT256_MAX = (1n << 256n) - 1n;

const decryptedAmount = (value: unknown, label: string): string => {
  let parsed: bigint;
  try {
    parsed = BigInt(value as bigint);
  } catch {
    throw new Error(`${label} is not an unsigned integer.`);
  }
  if (parsed < 0n || parsed > UINT256_MAX) throw new Error(`${label} is out of range.`);
  return parsed.toString();
};

/**
 * Decrypts only the exact recipient-bound receipt produced by the attested private OTC deployment.
 * Canonical marker/receipt joining remains the responsibility of the branded history materializer.
 */
export const decryptPrivateTradeV2ReceiptAmounts = async ({
  capability,
  deployment,
  receipt
}: {
  capability: OwnerTradeV2MetaMaskCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  receipt: ParsedTradeHistoryV2PrivateReceipt;
}): Promise<TradeHistoryV2Amounts> => {
  assertAttestedTradeHistoryV2Deployment(deployment, receipt.protocol);
  const binding = getOwnerTradeV2CapabilityBinding(capability);
  await assertOwnerTradeV2CapabilityCurrent(binding);
  if (
    binding.chainId.toString() !== receipt.chainId ||
    deployment.chainId !== receipt.chainId ||
    deployment.contractAddress !== getAddress(receipt.contractAddress).toLowerCase() ||
    binding.ownerAddress !== getAddress(receipt.recipient).toLowerCase()
  ) {
    throw new Error('Private OTC receipt belongs to another chain, deployment, or recipient.');
  }

  if (receipt.protocol === 'private-v2') {
    if (
      receipt.encryptedAmounts.offerAmount === undefined ||
      receipt.encryptedAmounts.requestAmount === undefined ||
      receipt.encryptedAmounts.baseAmount !== undefined ||
      receipt.encryptedAmounts.quoteAmount !== undefined
    ) {
      throw new Error('Private OTC receipt has the wrong encrypted amount shape.');
    }
    const offerAmount = decryptPrivateUint256Output(binding.signer, {
      ciphertextHigh: receipt.encryptedAmounts.offerAmount.userCiphertextHigh,
      ciphertextLow: receipt.encryptedAmounts.offerAmount.userCiphertextLow
    });
    const requestAmount = decryptPrivateUint256Output(binding.signer, {
      ciphertextHigh: receipt.encryptedAmounts.requestAmount.userCiphertextHigh,
      ciphertextLow: receipt.encryptedAmounts.requestAmount.userCiphertextLow
    });
    await assertOwnerTradeV2CapabilityCurrent(binding);
    return Object.freeze({
      offerAmount: decryptedAmount(offerAmount, 'Decrypted Private OTC offer amount'),
      requestAmount: decryptedAmount(requestAmount, 'Decrypted Private OTC request amount')
    });
  }

  if (
    receipt.encryptedAmounts.baseAmount === undefined ||
    receipt.encryptedAmounts.quoteAmount === undefined ||
    receipt.encryptedAmounts.offerAmount !== undefined ||
    receipt.encryptedAmounts.requestAmount !== undefined
  ) {
    throw new Error('Private recurring receipt has the wrong encrypted amount shape.');
  }
  const baseAmount = decryptPrivateUint256Output(binding.signer, {
    ciphertextHigh: receipt.encryptedAmounts.baseAmount.userCiphertextHigh,
    ciphertextLow: receipt.encryptedAmounts.baseAmount.userCiphertextLow
  });
  const quoteAmount = decryptPrivateUint256Output(binding.signer, {
    ciphertextHigh: receipt.encryptedAmounts.quoteAmount.userCiphertextHigh,
    ciphertextLow: receipt.encryptedAmounts.quoteAmount.userCiphertextLow
  });
  await assertOwnerTradeV2CapabilityCurrent(binding);
  return Object.freeze({
    baseAmount: decryptedAmount(baseAmount, 'Decrypted private recurring base amount'),
    quoteAmount: decryptedAmount(quoteAmount, 'Decrypted private recurring quote amount')
  });
};
