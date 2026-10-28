import { keccak256 } from '@coti-io/coti-ethers';
import { resolveBoundTransactionChain } from './boundTransactionChain';
import type { getOwnerTradeV2CapabilityBinding } from './ownerTradeV2Capability';
import type { LinkTradeV2CreationRecord, LinkTradeV2CreationRecoveryJournal } from './linkTradeV2CreationFlow';

type Provider = NonNullable<ReturnType<typeof getOwnerTradeV2CapabilityBinding>['readProvider']>;
const lower = (value: unknown) => typeof value === 'string' ? value.toLowerCase() : '';
const hash = (value: unknown) => {
  const result = lower(value);
  if (!/^0x[0-9a-f]{64}$/.test(result) || BigInt(result) === 0n) throw new Error('Invalid recovery transaction hash.');
  return result;
};
const height = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid recovery block number.');
  return value;
};

/** One user-requested read, at most 16 full blocks. Never signs, polls or resends. */
export const findLinkTradeV2Transaction = async (provider: Provider, record: LinkTradeV2CreationRecord,
  journal: Pick<LinkTradeV2CreationRecoveryJournal, 'advanceSearch'>, transactionHash?: string) => {
  const known = transactionHash ? hash(transactionHash) : record.mined?.transactionHash ?? record.transactionHash;
  let receipt = known ? await provider.getTransactionReceipt(known) : null;
  let found = known;
  if (!receipt) {
    if (transactionHash || record.feeWei || record.state === 'confirmed' || record.state === 'failed') return null;
    const nonce = await provider.getTransactionCount(record.owner, 'latest');
    if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error('Invalid recovery account nonce.');
    if (nonce <= record.nonce) return null;
    if (!record.admission) throw new Error('This older request needs its wallet transaction hash for recovery.');
    const anchor = await provider.getBlock(Number(record.admission.number));
    if (!anchor || hash(anchor.hash) !== record.admission.hash) throw new Error('Recovery admission block changed. Keep the request on hold.');
    let previous = anchor;
    if (record.search) {
      const cursor = await provider.getBlock(Number(record.search.throughBlock));
      if (!cursor || hash(cursor.hash) !== record.search.blockHash) throw new Error('Recovery search block changed. Keep the request on hold.');
      previous = cursor;
    }
    const head = await provider.getBlock('latest');
    if (!head) throw new Error('Recovery head is unavailable.');
    // Include the admission block on the first page: its head can race the wallet send.
    const first = record.search ? previous.number + 1 : previous.number;
    const last = Math.min(first + 15, height(head.number));
    if (first > head.number) return null;
    for (let n = first; n <= last; n++) {
      const block = await provider.getBlock(n, true);
      if (!block || height(block.number) !== n || (n !== first || record.search) && hash(block.parentHash) !== hash(previous.hash) ||
          n === first && !record.search && hash(block.hash) !== record.admission.hash) throw new Error('Recovery block chain changed.');
      const transactions = block.prefetchedTransactions;
      if (transactions.length !== block.transactions.length || transactions.some((tx, i) => hash(tx.hash) !== lower(block.transactions[i]))) {
        throw new Error('Full recovery block transactions are unavailable.');
      }
      const candidates = transactions.filter(tx => lower(tx.from) === record.owner && tx.nonce === record.nonce);
      if (candidates.length > 1) throw new Error('Recovery nonce is not unique.');
      previous = block;
      if (candidates.length) {
        found = hash(candidates[0].hash);
        receipt = await provider.getTransactionReceipt(found);
        if (!receipt) return null;
        break;
      }
    }
    if (!receipt) {
      const canonical = await provider.getBlock(previous.number);
      if (!canonical || hash(canonical.hash) !== hash(previous.hash)) throw new Error('Recovery search was reorganized.');
      await journal.advanceSearch(record.nonce, { throughBlock: previous.number.toString(), blockHash: hash(previous.hash), headBlock: head.number.toString() });
      return null;
    }
  }
  const tx = await provider.getTransaction(found!);
  if (!tx || hash(tx.hash) !== found || lower(tx.from) !== record.owner || tx.nonce !== record.nonce ||
      resolveBoundTransactionChain(tx.chainId, BigInt(record.chainId), 'Link recovery') !== BigInt(record.chainId)) {
    throw new Error('Recovery transaction does not match this wallet, chain and nonce.');
  }
  const price = receipt.gasPrice;
  if (price < 0n || tx.gasLimit <= 0n || tx.value < 0n || (tx.maxFeePerGas != null ? price > tx.maxFeePerGas : price !== tx.gasPrice)) {
    throw new Error('Recovery transaction fee is invalid.');
  }
  const sameCall = lower(tx.to) === record.to && keccak256(tx.data) === record.dataHash && tx.value === BigInt(record.value ?? '0');
  if (found === record.transactionHash && !record.mined && (!sameCall || tx.gasLimit.toString() !== record.gasLimit || price.toString() !== record.gasPrice)) {
    throw new Error('The original transaction differs from the saved request. Keep it on hold.');
  }
  if (receipt.status !== 0 && receipt.status !== 1) throw new Error('Recovery receipt status is invalid.');
  const outcome = receipt.status === 0 ? 'reverted' as const : sameCall ? undefined
    : lower(tx.to) === record.owner && tx.value === 0n && tx.data === '0x' ? 'cancelled' as const : 'replaced' as const;
  const mined = Object.freeze({ transactionHash: found!, to: tx.to?.toLowerCase() ?? null, dataHash: keccak256(tx.data), value: tx.value.toString(),
    gasLimit: tx.gasLimit.toString(), gasPrice: price.toString(), ...(outcome ? { outcome } : {}) });
  if (record.mined && JSON.stringify(mined) !== JSON.stringify(record.mined)) throw new Error('Saved recovery transaction changed.');
  return { receipt, record: Object.freeze({ ...record, state: 'submitted' as const,
    transactionHash: record.transactionHash ?? found!, mined }) };
};
