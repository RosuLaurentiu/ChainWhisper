import { Interface, getAddress, keccak256 } from '@coti-io/coti-ethers';
import { resolveCurrentCheapDexCandidate, rejectUnprovenNativeAdmission, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { type CurrentTransport } from './currentDexSendBoundary';
import { createCurrentAttemptBoundary } from './currentDexSendBoundary';
import { clearCurrentDexPendingAttempt, currentDexPendingStorage, recordCurrentDexPendingHash } from './currentDexPendingAttempt';
import type { PrivateUint256Input } from './privateUint256';

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
export const CURRENT_TOKEN_FUNDING_CAP = 5_000_000n;
// Native token A faucet: 24c5b96f..., 713863 gas. Both current token runtimes are
// 50ec5254...6d63b. Encrypted approvals B/A: 060e2b76.../02801794..., 460748/459140.
// Exact native hashes and source/receipt pins are checked by the companion test.
export const CURRENT_TOKEN_FUNDING_NATIVE = Object.freeze({
  faucet: '0x24c5b96f133d2f588d646545849180f1f21d15699d696f92a76285a73451e4f9',
  approve: ['0x060e2b7609d2ed003a4a8339f92dec20129a4d427d26d9b0a7f906fa7731c4cf',
    '0x0280179428146f223bb760fd96a82c78640e97c72ef190173e4cd782e2e5c93d'],
  tokenRuntime: '0x50ec5254aca88a9819cc819b1167c86bb8cba36916332c1c5a829b720da6d63b'
});
type Head = Awaited<ReturnType<CurrentTransport['readHead']>>;
export type CurrentTokenFundingState = Readonly<{ tokenIndex: 0 | 1; token: string; owner: string;
  balance: bigint; allowance: bigint; claimed: boolean; faucetAmount: bigint; decimals: bigint;
  publicAmounts: boolean; encryptionAddress: string; block: Head }>;
type Action = 'faucet' | 'approve';
export type CurrentTokenFundingPrepared = Readonly<{ action: Action; before: CurrentTokenFundingState;
  amount: bigint; data: string; graph: string; packageSha256: string; readyToSign: false }>;
export type CurrentTokenFundingResult = CurrentTokenFundingState & Readonly<{ fundingOutcome: 'verified' | 'reverted' }>;
const same = (a: string | null, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
const zero = '0x0000000000000000000000000000000000000000';
const receiptSnapshot = (r: NonNullable<Awaited<ReturnType<CurrentTransport['waitForReceipt']>>>) => Object.freeze({ ...r,
  logs: r.logs && Object.freeze(r.logs.map(l => Object.freeze({ ...l, topics: Object.freeze([...l.topics]) }))) });
// decision-034 (CW-140.12): the fa71 native trial path was removed. No candidate admits a send here, and the
// build 13 token runtimes have no funding evidence, so this earlier adapter cannot be constructed for build 13.
export const createCurrentTokenFundingAdapter = ({ ownerAddress, chainId, transport, attest, readState, encrypt, assertResources, candidate = 'cheap-history',
  now = () => BigInt(Math.floor(Date.now() / 1000)) }: {
  ownerAddress: string; chainId: bigint; transport: CurrentTransport; attest: (head: Head) => Promise<void>;
  readState: (index: 0 | 1, head: Head) => Promise<CurrentTokenFundingState>;
  encrypt: (amount: bigint, token: string, selector: string) => Promise<PrivateUint256Input>;
  assertResources: () => Promise<void>; now?: () => bigint;
  candidate?: CurrentCheapDexCandidateKey;
}) => {
  const c = resolveCurrentCheapDexCandidate(candidate);
  if (c.tokens.some(([, runtime]) => runtime !== CURRENT_TOKEN_FUNDING_NATIVE.tokenRuntime)) throw new Error('Current-token runtime has no funding evidence.');
  const owner = getAddress(ownerAddress), core = getAddress(c.core), storage = currentDexPendingStorage({ chainId, graph: c.graph, owner });
  if (chainId !== BigInt(c.chainId) || same(owner, zero)) throw new Error('Wrong current-token owner or chain.');
  const b = createCurrentAttemptBoundary({ storage, c, core, owner, chainId, transport, attest, now, historical: false });
  const metadata = <T extends object>(result: T) => Object.freeze({ ...result });
  const indexOf = (token: string) => {
    const index = c.tokens.findIndex(([at]) => same(at, token));
    if (index !== 0 && index !== 1) throw new Error('Not a current trial token.'); return index;
  };
  const inspect = async (index: 0 | 1, head?: Head) => {
    if (index !== 0 && index !== 1) throw new Error('Not a current trial token.');
    const block = head ?? await b.currentHead(undefined, CURRENT_TOKEN_FUNDING_CAP);
    const s = await readState(index, block); await transport.assertCurrent();
    if (!same(s.token, c.tokens[index][0]) || !same(s.owner, owner) || s.tokenIndex !== index ||
      s.block.hash !== block.hash || s.block.number !== block.number || s.decimals !== 18n || s.publicAmounts ||
      s.faucetAmount !== CURRENT_TOKEN_FAUCET_AMOUNT || s.balance < 0n || s.allowance < 0n ||
      ![zero.toLowerCase(), owner.toLowerCase()].includes(s.encryptionAddress.toLowerCase())) {
      throw new Error('Current-token state, privacy or configuration changed.');
    }
    return Object.freeze({ ...s, block: Object.freeze({ ...block }) });
  };
  const equalState = (a: CurrentTokenFundingState, z: CurrentTokenFundingState) =>
    ['token', 'owner', 'tokenIndex', 'balance', 'allowance', 'claimed', 'faucetAmount', 'decimals', 'publicAmounts', 'encryptionAddress']
      .every(k => a[k as keyof typeof a] === z[k as keyof typeof z]);
  const shape = (action: Action, data: string) => {
    const method = action === 'faucet' ? 'claimFaucet' : 'approve', values = currentTokenFundingAbi.decodeFunctionData(method, data);
    if (!same(currentTokenFundingAbi.encodeFunctionData(method, values), data) || action === 'approve' && !same(values[0], core)) {
      throw new Error('Current-token call or Core spender changed.');
    }
    return values;
  };
  const eventProof = (logs: NonNullable<Awaited<ReturnType<CurrentTransport['waitForReceipt']>>>['logs'], action: Action, token: string) => {
    if (!logs || logs.length !== (action === 'faucet' ? 2 : 1) || logs.some(l => !same(l.address, token))) throw new Error('Unexpected current-token events.');
    const events = logs.map(l => {
      const e = currentTokenFundingAbi.parseLog({ ...l, topics: [...l.topics] });
      const encoded = e && currentTokenFundingAbi.encodeEventLog(e.fragment, e.args);
      if (!e || encoded?.data.toLowerCase() !== l.data.toLowerCase() || encoded.topics.length !== l.topics.length ||
        encoded.topics.some((t, i) => !same(t, l.topics[i]))) throw new Error('Non-canonical current-token event.'); return e;
    });
    if (action === 'approve') {
      const e = events[0]; if (e.name !== 'Approval' || !same(e.args.owner, owner) || !same(e.args.spender, core)) throw new Error('Wrong private approval event.');
    } else {
      const claim = events.filter(e => e.name === 'FaucetClaimed'), mint = events.filter(e => e.name === 'Transfer');
      if (claim.length !== 1 || mint.length !== 1 || !same(claim[0].args.account, owner) ||
        !same(mint[0].args.from, zero) || !same(mint[0].args.to, owner)) throw new Error('Wrong fixed faucet event.');
    }
  };
  return Object.freeze({
    readCurrentTokenFunding: inspect,
    prepareCurrentTokenFunding: async ({ tokenIndex, action, amount, confirm }: { tokenIndex: 0 | 1; action: Action; amount: bigint;
      confirm: (review: { action: Action; tokenIndex: 0 | 1; amount: bigint; previousAllowance: bigint; spender: string }) => Promise<boolean> }) => {
      b.requireEmptyPending();
      await assertResources();
      if (typeof amount !== 'bigint' || amount <= 0n || amount > CURRENT_TOKEN_FAUCET_AMOUNT || !['faucet', 'approve'].includes(action)) throw new Error('Use a finite positive current-token amount, at most 10000 test tokens.');
      const before = await inspect(tokenIndex);
      if (action === 'faucet' ? before.claimed || before.balance >= amount : before.balance < amount || before.allowance >= amount) throw new Error('Current-token funding action is not required or eligible.');
      if (!await confirm({ action, tokenIndex, amount: action === 'faucet' ? CURRENT_TOKEN_FAUCET_AMOUNT : amount, previousAllowance: before.allowance, spender: core })) return null;
      await transport.assertCurrent();
      if (!equalState(before, await inspect(tokenIndex))) throw new Error('Current-token funding state changed during review.');
      const data = action === 'faucet' ? currentTokenFundingAbi.encodeFunctionData('claimFaucet') :
        currentTokenFundingAbi.encodeFunctionData('approve', [core, await encrypt(amount, before.token, currentTokenFundingAbi.getFunction('approve')!.selector)]);
      await transport.assertCurrent();
      const p: CurrentTokenFundingPrepared = Object.freeze({ action, before, amount: action === 'faucet' ? CURRENT_TOKEN_FAUCET_AMOUNT : amount, data, graph: c.graph, packageSha256: c.packageSha256, readyToSign: false as const });
      return p;
    },
    // Only the removed fa71 candidate admitted this send.
    submitCurrentTokenFunding: async (_p: CurrentTokenFundingPrepared): Promise<never> => rejectUnprovenNativeAdmission(),
    recoverPendingCurrentTokenFunding: async (knownTransactionHash?: string) => {
      await transport.assertCurrent(); const p = b.pending(); if (!p) return null;
      if (!['token-faucet', 'token-approve'].includes(p.phase) || p.chainId !== String(chainId) || !same(p.owner, owner) || !same(p.core, core) || p.graph !== `0x${c.graph}`) throw new Error('Pending action belongs to another current adapter.');
      if (p.verificationBlocked) throw new Error('Known current-token verification failure. Manual reconciliation is required.');
      const supplied = knownTransactionHash?.trim().toLowerCase();
      if (supplied && (!/^0x[0-9a-f]{64}$/.test(supplied) || BigInt(supplied) === 0n)) throw new Error('Enter a valid funding transaction hash.');
      if (p.txHash && supplied && supplied !== p.txHash) throw new Error('Funding transaction hash differs from the saved attempt.');
      const transactionHash = p.txHash ?? supplied;
      if (!transactionHash) return metadata({ status: 'manual-reconciliation-required' as const, privateAccountingVerified: false as const });
      const tx = await transport.readTransaction(transactionHash), r = await transport.waitForReceipt(transactionHash);
      if (!tx || !r) return metadata({ status: 'awaiting-chain-confirmation' as const, privateAccountingVerified: false as const });
      const action = p.phase === 'token-faucet' ? 'faucet' : 'approve'; indexOf(tx.to ?? ''); shape(action, tx.data);
      if (keccak256(tx.data).toLowerCase() !== p.callHash) throw new Error('Pending current-token calldata changed.');
      const request = { chainId, from: owner, to: tx.to!, data: tx.data, value: 0n as const, nonce: p.nonce, gasLimit: CURRENT_TOKEN_FUNDING_CAP };
      const canonical = receiptSnapshot(await b.verifyMinedCall(request, transactionHash, true));
      // Metadata recovery proves canonical inclusion, not receipt-block private accounting.
      // Admit the current graph without requiring the RPC to retain historical state.
      await b.currentHead(undefined, CURRENT_TOKEN_FUNDING_CAP);
      if (canonical.status === 1) eventProof(canonical.logs, action, tx.to!);
      else if (!canonical.logs || canonical.logs.length !== 0) throw new Error('Reverted current-token call emitted events.');
      await b.recheckMinedCall(request, transactionHash, canonical, true);
      await transport.assertCurrent();
      // Bind an uncertain wallet response only after the exact canonical call is proved.
      if (!p.txHash) recordCurrentDexPendingHash(storage, p, transactionHash);
      clearCurrentDexPendingAttempt(storage, b.requireOwnPending(p, transactionHash));
      return metadata({ status: canonical.status === 1 ? 'observed-mined' as const : 'observed-reverted' as const, privateAccountingVerified: false as const });
    }
  });
};
