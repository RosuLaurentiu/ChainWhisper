import { Interface } from '@coti-io/coti-ethers';
import { type CurrentTransport } from './currentDexSendBoundary';

// Private test-token calls and events. decision-034 (CW-140.13): the earlier token funding adapter,
// which only the removed fa71 candidate could use, was deleted; current claims use currentSharedDexTokenFunding.
const ct = '(uint256 ciphertextHigh,uint256 ciphertextLow)';
export const currentTokenFundingAbi = new Interface([
  `function balanceOf(address account) view returns(${ct})`,
  `function allowance(address owner,address spender) view returns((${ct} ciphertext,${ct} ownerCiphertext,${ct} spenderCiphertext))`,
  `function approve(address spender,(${ct} ciphertext,bytes signature) value)`,
  `function increaseAllowance(address spender,(${ct} ciphertext,bytes signature) value)`,
  'function claimFaucet()', 'function faucetClaimed(address account) view returns(bool)',
  'function faucetAmount() view returns(uint256)', 'function decimals() view returns(uint8)',
  'function publicAmountsEnabled() view returns(bool)', 'function accountEncryptionAddress(address account) view returns(address)',
  `event Approval(address indexed owner,address indexed spender,${ct} ownerValue,${ct} spenderValue)`,
  `event Transfer(address indexed from,address indexed to,${ct} senderValue,${ct} receiverValue)`,
  'event FaucetClaimed(address indexed account)'
]);
export const CURRENT_TOKEN_FAUCET_AMOUNT = 10_000n * 10n ** 18n;
type Head = Awaited<ReturnType<CurrentTransport['readHead']>>;
export type CurrentTokenFundingState = Readonly<{ tokenIndex: 0 | 1; token: string; owner: string;
  balance: bigint; allowance: bigint; claimed: boolean; faucetAmount: bigint; decimals: bigint;
  publicAmounts: boolean; encryptionAddress: string; block: Head }>;
export type CurrentTokenFundingResult = CurrentTokenFundingState & Readonly<{ fundingOutcome: 'verified' | 'reverted' }>;
