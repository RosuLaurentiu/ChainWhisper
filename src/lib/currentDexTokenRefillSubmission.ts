import { getAddress, keccak256 } from '@coti-io/coti-ethers';
import { resolveCurrentCheapDexCandidate, assertCurrentCheapDexNativeAdmission, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { createCurrentAttemptBoundary, type CurrentTransport } from './currentDexSubmission';
import { currentDexPendingStorage, clearCurrentDexPendingAttempt, blockCurrentTokenFundingVerification, recordCurrentDexPendingHash } from './currentDexPendingAttempt';
import { currentTokenFundingAbi, CURRENT_TOKEN_FAUCET_AMOUNT, type CurrentTokenFundingState } from './currentDexTokenFunding';
import { readCurrentTokenRefill, currentTokenRefillAbi, CURRENT_TOKEN_REFILL_AMOUNT, CURRENT_TOKEN_REFILL_COOLDOWN, type CurrentTokenRefillBinding, type CurrentTokenRefillState } from './currentDexTokenRefill';
import type { PrivateUint256Output } from './privateUint256';
import { assertCurrentSwapCandidate, isCurrentNativeSwapCandidate, currentNativeSigningBudget } from './currentDexNativeSwapPolicy';
import { assertCurrentNativeTokenRefillBinding } from './currentDexNativeTokenRefillDeployment';

export const CURRENT_TOKEN_REFILL_GAS_CAP = 5_000_000n;
type Head = Awaited<ReturnType<CurrentTransport['readHead']>>;
type Snapshot = Readonly<{ tokens: readonly [CurrentTokenFundingState, CurrentTokenFundingState]; refills: readonly [CurrentTokenRefillState, CurrentTokenRefillState]; block: Head }>;
export type CurrentTokenRefillPrepared = Readonly<{ tokenIndex: 0 | 1; amount: bigint; data: string; before: Snapshot; graph: string; packageSha256: string; readyToSign: false }>;
const same = (a: string | null, z: string) => typeof a === 'string' && a.toLowerCase() === z.toLowerCase();
const equal = (a: object, z: object, omitted: string[]) => Object.keys(a).filter(k => !omitted.includes(k)).every(k => a[k as keyof typeof a] === z[k as keyof typeof z]);
class RefillVerificationError extends Error {}
const knownProofFailure = (error: unknown) => error instanceof RefillVerificationError || error instanceof Error && [
  'Current DEX mined block changed.', 'Invalid Testnet refill binding.', 'Testnet refill runtime changed.',
  'Testnet refill policy changed.', 'Non-canonical Testnet refill response.',
  'Current DEX canonical transaction inclusion changed. Do not resend.'
].includes(error.message);
const brands = new WeakMap<object, object>();
const zero = '0x0000000000000000000000000000000000000000';
const receiptSnapshot = (r: NonNullable<Awaited<ReturnType<CurrentTransport['waitForReceipt']>>>) => Object.freeze({ ...r,
  logs: r.logs && Object.freeze(r.logs.map(l => Object.freeze({ ...l, topics: Object.freeze([...l.topics]) }))) });

// The caller supplies a receipt-bound vault and the release gate. This module does not admit deployments.
export const createCurrentTokenRefillSubmissionAdapter = ({ signer, ownerAddress, chainId, transport, attest, binding: suppliedBinding,
  assertRefillAdmission, readState, rpc, readReceiptBlock, decrypt, assertResources, candidate = 'cheap-native',
  now = () => BigInt(Math.floor(Date.now() / 1000)) }: {
  signer: object; ownerAddress: string; chainId: bigint; transport: CurrentTransport; attest: (head: Head) => Promise<void>;
  binding: CurrentTokenRefillBinding; assertRefillAdmission: (binding: CurrentTokenRefillBinding) => void | Promise<void>;
  readState: (index: 0 | 1, head: Head) => Promise<CurrentTokenFundingState>;
  rpc: (method: string, params: unknown[]) => Promise<unknown>; readReceiptBlock: (number: number) => Promise<Head>;
  decrypt: (value: PrivateUint256Output) => bigint; assertResources: () => Promise<void>;
  candidate?: CurrentCheapDexCandidateKey; now?: () => bigint;
}) => {
  const c = resolveCurrentCheapDexCandidate(candidate), owner = getAddress(ownerAddress), core = getAddress(c.core);
  const binding = Object.freeze({ ...suppliedBinding }), storage = currentDexPendingStorage(), session = {};
  if (chainId !== 7082400n || chainId !== BigInt(c.chainId) || same(owner, zero)) throw new RefillVerificationError('Wrong refill owner or Testnet chain.');
  const b = createCurrentAttemptBoundary({ storage, c, core, owner, chainId, transport, attest, now, historical: false });
  const used = new WeakSet<object>();
  const metadata = <T extends object>(result: T) => Object.freeze({ ...result, ...(isCurrentNativeSwapCandidate(c) ? { readyToSign: false as const } : {}) });
  const admission = async () => {
    if (isCurrentNativeSwapCandidate(c)) { assertCurrentSwapCandidate(c); assertCurrentNativeTokenRefillBinding(candidate, binding); }
    else assertCurrentCheapDexNativeAdmission(c);
    await assertRefillAdmission(binding);
  };
  const guard = async (resources = false) => { await transport.assertCurrent(); if (resources) await assertResources(); await transport.assertCurrent(); };
  const inspect = async (block?: Head): Promise<Snapshot> => {
    await guard(); const head = block ?? await b.currentHead(undefined, CURRENT_TOKEN_REFILL_GAS_CAP);
    const tokens = await Promise.all(([0, 1] as const).map(async index => {
      const s = await readState(index, head); await transport.assertCurrent();
      if (s.tokenIndex !== index || !same(s.token, c.tokens[index][0]) || !same(s.owner, owner) || s.block.hash !== head.hash ||
        s.block.number !== head.number || s.block.timestamp !== head.timestamp || typeof s.balance !== 'bigint' || typeof s.allowance !== 'bigint' || typeof s.claimed !== 'boolean' || s.balance < 0n || s.allowance < 0n || s.decimals !== 18n ||
        s.publicAmounts || s.faucetAmount !== CURRENT_TOKEN_FAUCET_AMOUNT || ![zero.toLowerCase(), owner.toLowerCase()].includes(s.encryptionAddress.toLowerCase())) throw new RefillVerificationError('Refill token state or privacy changed.');
      return Object.freeze({ ...s, block: Object.freeze({ ...head }) });
    }));
    const refills = await Promise.all(([0, 1] as const).map(tokenIndex => readCurrentTokenRefill({ binding, candidate, tokenIndex, owner,
      initialClaimed: tokens[tokenIndex].claimed, head, rpc, assertCurrent: async () => { await transport.assertCurrent(); } }).catch(error => {
        if (error instanceof Error && ['Invalid Testnet refill binding.', 'Testnet refill runtime changed.', 'Testnet refill policy changed.', 'Non-canonical Testnet refill response.'].includes(error.message)) throw new RefillVerificationError(error.message);
        throw error;
      })));
    if (!same(await transport.readBlockHash(Number(head.number)), head.hash)) throw new RefillVerificationError('Refill state block changed.');
    await transport.assertCurrent();
    return Object.freeze({ tokens: Object.freeze(tokens) as unknown as Snapshot['tokens'], refills: Object.freeze(refills) as unknown as Snapshot['refills'], block: Object.freeze({ ...head }) });
  };
  const equalSnapshot = (a: Snapshot, z: Snapshot) => a.tokens.every((t, i) => equal(t, z.tokens[i], ['block'])) &&
    a.refills.every((r, i) => equal(r, z.refills[i], ['block', 'availability']));
  const validate = async (p: CurrentTokenRefillPrepared, fresh = false) => {
    if (brands.get(p) !== session || !signer || p.graph !== c.graph || p.packageSha256 !== c.packageSha256 || p.readyToSign !== false ||
      p.amount !== CURRENT_TOKEN_REFILL_AMOUNT || (p.tokenIndex !== 0 && p.tokenIndex !== 1) ||
      !same(p.data, currentTokenRefillAbi.encodeFunctionData('claim', [c.tokens[p.tokenIndex][0]]))) throw new RefillVerificationError('Refill preparation or owner session changed.');
    await guard(fresh);
    if (!same(await transport.readBlockHash(Number(p.before.block.number)), p.before.block.hash)) throw new RefillVerificationError('Refill review block changed.');
    if (fresh) {
      await admission();
      const state = await inspect();
      if (!equalSnapshot(p.before, state) || state.refills[p.tokenIndex].availability !== 'ready' || now() >= binding.expiresAt) throw new RefillVerificationError('Refill quota, cooldown or reviewed state changed.');
      const nonce = await transport.readNonce();
      const estimate = await transport.estimateGas({ chainId, from: owner, to: binding.address, value: 0n, data: p.data, nonce });
      await transport.assertCurrent();
      if (typeof estimate !== 'bigint' || estimate <= 0n || estimate > 50_000_000n || estimate * 5n / 4n + 1_000_000n > CURRENT_TOKEN_REFILL_GAS_CAP) throw new RefillVerificationError('Refill strict estimate and headroom exceed gas cap.');
      await admission(); await transport.assertCurrent();
    }
  };
  const eventProof = (logs: NonNullable<Awaited<ReturnType<CurrentTransport['waitForReceipt']>>>['logs'], token: string) => {
    if (!logs || logs.length !== 2) throw new RefillVerificationError('Unexpected refill events.');
    let transfer = 0, claim = 0;
    for (const log of logs) {
      const abi = same(log.address, token) ? currentTokenFundingAbi : same(log.address, binding.address) ? currentTokenRefillAbi : null;
      if (!abi) throw new RefillVerificationError('Wrong refill event address.');
      const event = abi.parseLog({ ...log, topics: [...log.topics] }), encoded = event && abi.encodeEventLog(event.fragment, event.args);
      if (!event || !encoded || !same(encoded.data, log.data) || encoded.topics.length !== log.topics.length || encoded.topics.some((v, i) => !same(v, log.topics[i]))) throw new RefillVerificationError('Non-canonical refill event.');
      if (event.name === 'Transfer' && same(log.address, token) && same(event.args.from, binding.address) && same(event.args.to, owner) && decrypt(event.args.receiverValue) === CURRENT_TOKEN_REFILL_AMOUNT) transfer++;
      else if (event.name === 'Claimed' && same(log.address, binding.address) && same(event.args.token, token) && same(event.args.account, owner)) claim++;
      else throw new RefillVerificationError('Wrong refill event or private credit.');
    }
    if (transfer !== 1 || claim !== 1) throw new RefillVerificationError('Duplicate or missing refill event.');
  };
  const canonicalReceipt = async (request: Parameters<typeof b.verifyMinedCall>[0], transactionHash: string) => {
    await transport.assertCurrent();
    const tx = await transport.readTransaction(transactionHash);
    if (!tx) throw new Error('Refill transaction is not available.');
    if (!same(tx.hash, transactionHash) || tx.chainId !== chainId || !same(tx.from, owner) || !same(tx.to, binding.address) ||
      tx.value !== 0n || !same(tx.data, request.data) || tx.nonce !== request.nonce || tx.gasLimit !== CURRENT_TOKEN_REFILL_GAS_CAP) throw new RefillVerificationError('Known refill transaction differs.');
    const observed = await transport.waitForReceipt(transactionHash);
    if (!observed || observed.status === null) throw new Error('Refill receipt is not available.');
    const receipt = receiptSnapshot(observed);
    if ((receipt.status !== 0 && receipt.status !== 1) || !same(receipt.hash, transactionHash) || !same(receipt.from, owner) || !same(receipt.to, binding.address) ||
      tx.blockNumber !== receipt.blockNumber || !receipt.blockHash || !same(tx.blockHash ?? null, receipt.blockHash)) throw new RefillVerificationError('Known refill receipt differs.');
    const canonical = await b.verifyMinedCall(request, transactionHash, true);
    if (JSON.stringify(canonical) !== JSON.stringify(receipt)) throw new RefillVerificationError('Refill receipt changed during canonical proof.');
    return receiptSnapshot(canonical);
  };
  const finalReceipt = async (request: Parameters<typeof b.verifyMinedCall>[0], hash: string, first: Awaited<ReturnType<typeof b.verifyMinedCall>>, head: Head) => {
    const last = await canonicalReceipt(request, hash);
    if (JSON.stringify(last) !== JSON.stringify(first)) throw new RefillVerificationError('Refill receipt changed after accounting proof.');
    const block = await readReceiptBlock(first.blockNumber!);
    if (block.number !== head.number || !same(block.hash, head.hash) || block.timestamp !== head.timestamp) throw new RefillVerificationError('Refill receipt timestamp changed after proof.');
    await transport.assertCurrent();
  };
  return Object.freeze({
    readCurrentTokenRefillSubmission: inspect,
    prepareCurrentTokenRefill: async ({ tokenIndex, confirm }: { tokenIndex: 0 | 1; confirm: (review: { token: string; amount: bigint; vault: string; cooldown: bigint; expiresAt: bigint }) => Promise<boolean> }) => {
      b.requireEmptyPending(); if (tokenIndex !== 0 && tokenIndex !== 1) throw new RefillVerificationError('Not a current trial token.');
      await guard(true); const before = await inspect(); if (before.refills[tokenIndex].availability !== 'ready' || now() >= binding.expiresAt) throw new RefillVerificationError('Refill is not available.');
      if (!await confirm({ token: c.tokens[tokenIndex][0], amount: CURRENT_TOKEN_REFILL_AMOUNT, vault: binding.address, cooldown: CURRENT_TOKEN_REFILL_COOLDOWN, expiresAt: binding.expiresAt })) return null;
      await guard(true); if (!equalSnapshot(before, await inspect())) throw new RefillVerificationError('Refill state changed during review.');
      const p = Object.freeze({ tokenIndex, amount: CURRENT_TOKEN_REFILL_AMOUNT, data: currentTokenRefillAbi.encodeFunctionData('claim', [c.tokens[tokenIndex][0]]), before, graph: c.graph, packageSha256: c.packageSha256, readyToSign: false as const });
      brands.set(p, session); return p;
    },
    submitCurrentTokenRefill: async (p: CurrentTokenRefillPrepared) => {
      await admission(); b.requireEmptyPending();
      const budget = isCurrentNativeSwapCandidate(c) ? currentNativeSigningBudget(signer, owner, now) : null;
      const budgetKey = `token-refill:${c.tokens[p.tokenIndex]?.[0].toLowerCase()}:${binding.address.toLowerCase()}:${keccak256(p.data).toLowerCase()}`;
      budget?.check('token-funding', budgetKey, CURRENT_TOKEN_REFILL_GAS_CAP);
      await validate(p, true); b.requireEmptyPending();
      if (used.has(p)) throw new RefillVerificationError('Refill already attempted. Reconcile it.'); used.add(p); let signing = false;
      try {
        const sent = await b.sendCurrent('token-refill', { chainId, from: owner, to: binding.address, value: 0n, data: p.data }, binding.expiresAt,
          async () => { await validate(p, true); budget?.check('token-funding', budgetKey, CURRENT_TOKEN_REFILL_GAS_CAP); }, () => { signing = true; }, undefined, CURRENT_TOKEN_REFILL_GAS_CAP, undefined,
          async () => { await admission(); budget?.commit('token-funding', budgetKey, CURRENT_TOKEN_REFILL_GAS_CAP); });
        return Object.freeze({ ...sent, recover: async () => {
          await validate(p); const pending = b.pending();
          if (!pending || pending.phase !== 'token-refill' || pending.callHash !== keccak256(p.data).toLowerCase() || pending.nonce !== sent.request.nonce) throw new RefillVerificationError('Refill pending action changed.');
          if (pending.verificationBlocked) throw new RefillVerificationError('Known refill verification failure. Reconcile manually.');
          b.requireOwnPending(pending, sent.transactionHash);
          try {
            const receipt = await canonicalReceipt(sent.request, sent.transactionHash);
            const head = await readReceiptBlock(receipt.blockNumber!);
            if (head.number !== BigInt(receipt.blockNumber!) || !same(head.hash, receipt.blockHash!) || head.timestamp < p.before.block.timestamp || head.timestamp > now()) throw new RefillVerificationError('Refill receipt timestamp or block changed.');
            await attest(head);
            const after = await inspect(head);
            if (receipt.status === 0) {
              if (!receipt.logs || receipt.logs.length || !equalSnapshot(p.before, after)) throw new RefillVerificationError('Reverted refill did not roll back exactly.');
            } else {
              if (head.timestamp >= binding.expiresAt) throw new RefillVerificationError('Refill mined after expiry.');
              try { eventProof(receipt.logs, c.tokens[p.tokenIndex][0]); } catch { throw new RefillVerificationError('Refill event or private credit proof failed.'); }
              const i = p.tokenIndex, other = i === 0 ? 1 : 0;
              if (!equal(after.tokens[i], { ...p.before.tokens[i], balance: p.before.tokens[i].balance + CURRENT_TOKEN_REFILL_AMOUNT }, ['block']) ||
                !equal(after.tokens[other], p.before.tokens[other], ['block']) || !equal(after.refills[other], p.before.refills[other], ['block', 'availability']) ||
                !equal(after.refills[i], { ...p.before.refills[i], quota: p.before.refills[i].quota - CURRENT_TOKEN_REFILL_AMOUNT, nextClaimAt: head.timestamp + CURRENT_TOKEN_REFILL_COOLDOWN }, ['block', 'availability'])) throw new RefillVerificationError('Refill private accounting, quota, cooldown or allowance differs.');
            }
            await finalReceipt(sent.request, sent.transactionHash, receipt, head);
            clearCurrentDexPendingAttempt(storage, b.requireOwnPending(pending, sent.transactionHash));
            return Object.freeze({ refillOutcome: receipt.status === 0 ? 'reverted' as const : 'verified' as const, privateAccountingVerified: true as const });
          } catch (error) {
            if (knownProofFailure(error)) blockCurrentTokenFundingVerification(storage, b.requireOwnPending(pending, sent.transactionHash));
            throw error;
          }
        } });
      } catch (error) { if (!signing) used.delete(p); throw error; }
    },
    recoverPendingCurrentTokenRefill: async (knownTransactionHash?: string) => {
      await guard(); const p = b.pending(); if (!p) return null;
      if (p.phase !== 'token-refill' || p.chainId !== String(chainId) || !same(p.owner, owner) || !same(p.core, core) || p.graph !== `0x${c.graph}`) throw new RefillVerificationError('Pending refill belongs to another adapter.');
      if (p.verificationBlocked) throw new RefillVerificationError('Known refill verification failure. Reconcile manually.');
      const supplied = knownTransactionHash?.trim().toLowerCase();
      if (supplied && (!/^0x[0-9a-f]{64}$/.test(supplied) || BigInt(supplied) === 0n) || p.txHash && supplied && p.txHash !== supplied) throw new RefillVerificationError('Invalid or changed refill transaction hash.');
      const transactionHash = p.txHash ?? supplied;
      if (!transactionHash) return metadata({ status: 'manual-reconciliation-required' as const, privateAccountingVerified: false as const });
      const tx = await transport.readTransaction(transactionHash), receipt = await transport.waitForReceipt(transactionHash);
      if (!tx || !receipt) return metadata({ status: 'awaiting-chain-confirmation' as const, privateAccountingVerified: false as const });
      try {
        let token: string;
        try { token = currentTokenRefillAbi.decodeFunctionData('claim', tx.data)[0] as string; } catch { throw new RefillVerificationError('Pending refill calldata is invalid.'); }
        if (!same(tx.to, binding.address) || !c.tokens.some(([t]) => same(t, token)) || !same(currentTokenRefillAbi.encodeFunctionData('claim', [token]), tx.data) || keccak256(tx.data).toLowerCase() !== p.callHash) throw new RefillVerificationError('Pending refill calldata changed.');
        const request = { chainId, from: owner, to: binding.address, data: tx.data, value: 0n as const, nonce: p.nonce, gasLimit: CURRENT_TOKEN_REFILL_GAS_CAP };
        const canonical = await canonicalReceipt(request, transactionHash);
        const head = await readReceiptBlock(canonical.blockNumber!);
        if (head.number !== BigInt(canonical.blockNumber!) || !same(head.hash, canonical.blockHash!)) throw new RefillVerificationError('Refill receipt block changed.');
        await attest(head);
        // Metadata recovery has no retained private baseline. Read only the public vault policy here.
        await readCurrentTokenRefill({ binding, candidate, tokenIndex: same(token, c.tokens[0][0]) ? 0 : 1, owner, initialClaimed: true, head, rpc, assertCurrent: async () => { await transport.assertCurrent(); } });
        if (canonical.status === 1) { if (head.timestamp >= binding.expiresAt) throw new RefillVerificationError('Refill mined after expiry.'); try { eventProof(canonical.logs, token); } catch { throw new RefillVerificationError('Refill event or private credit proof failed.'); } }
        else if (!canonical.logs || canonical.logs.length) throw new RefillVerificationError('Reverted refill emitted events.');
        await finalReceipt(request, transactionHash, canonical, head);
        if (!p.txHash) recordCurrentDexPendingHash(storage, p, transactionHash);
        clearCurrentDexPendingAttempt(storage, b.requireOwnPending(p, transactionHash));
        return metadata({ status: canonical.status === 1 ? 'observed-mined' as const : 'observed-reverted' as const, privateAccountingVerified: false as const });
      } catch (error) {
        if (knownProofFailure(error)) blockCurrentTokenFundingVerification(storage, p);
        throw error;
      }
    }
  });
};

