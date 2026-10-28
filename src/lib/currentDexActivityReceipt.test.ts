import { Interface, toBeHex } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import { readCurrentDexActivityReceipt } from './currentDexActivityReceipt';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE as c } from './currentDexExitCandidate';
import { currentDexOwnerTransferAbi as transfers } from './currentDexOwnerTokenProof';
import { currentSharedTokenFundingAbi } from './currentSharedDexTokenFunding';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as historyCandidate } from './dexV2Deployment';
import type { CurrentDexActivityCandidate } from './currentDexActivityDiscovery';

const owner = `0x${'22'.repeat(20)}`, hash = toBeHex(3, 32), blockHash = toBeHex(4, 32), zero = toBeHex(0, 20);
function fixture(candidate: CurrentDexActivityCandidate = 'cheap-exit') {
  const token = c.tokens[1][0], event = transfers.encodeEventLog(transfers.getEvent('Transfer')!, [zero, owner, [0n, 0n], [10_000_000_000n, 0n]]);
  const transaction = { hash, chainId: BigInt(c.chainId), from: owner, to: token, value: 0n,
    data: currentSharedTokenFundingAbi.encodeFunctionData('claimFaucet'), blockNumber: 100, blockHash, nonce: 4, gasLimit: 5_000_000n };
  const receipt = { hash, status: 1, from: owner, to: token, blockNumber: 100, blockHash,
    logs: [{ address: token, ...event }, { address: token, ...currentSharedTokenFundingAbi.encodeEventLog(currentSharedTokenFundingAbi.getEvent('FaucetClaimed')!, [owner]) }] };
  const assertCurrent = vi.fn(), verifyCanonical = vi.fn(async () => {}), decrypt = vi.fn(cipher => cipher.ciphertextHigh as bigint);
  const read = () => readCurrentDexActivityReceipt({ candidate, owner, transaction, receipt, timestamp: 1000n, assertCurrent, verifyCanonical, decrypt });
  return { token, transaction, receipt, assertCurrent, verifyCanonical, decrypt, read };
}
describe('canonical owner DEX action history', () => {
  it('binds new History token receipts to the exact new descriptor without admitting signing', async () => {
    const f = fixture('cheap-history');
    expect(await f.read()).toMatchObject({ core: historyCandidate.core, readyToSign: false, nativeAdmission: false,
      movements: [{ token: f.token, paid: 0n, received: 10_000_000_000n }] });
    expect(f.verifyCanonical).toHaveBeenCalledTimes(2);
  });
  it.each(['foreign-target', 'mixed-witness'] as const)('rejects new History %s before private decryption', async fault => {
    const f = fixture('cheap-history'), worker = toBeHex(7, 20);
    const target = fault === 'foreign-target' ? c.core : historyCandidate.core;
    f.transaction.from = worker; f.transaction.to = target as typeof f.transaction.to;
    f.transaction.data = new Interface(['function advanceFixedWork(uint256)']).encodeFunctionData('advanceFixedWork', [53n]);
    Object.assign(f.receipt, { from: worker, to: target, status: 0, logs: [] });
    await expect(readCurrentDexActivityReceipt({ candidate: 'cheap-history', owner, transaction: f.transaction,
      receipt: f.receipt, timestamp: 1000n, assertCurrent: f.assertCurrent, verifyCanonical: f.verifyCanonical, decrypt: f.decrypt,
      ownerOperation: { core: c.core, hash, blockNumber: 90, blockHash, timestamp: 900n, action: 'Quote',
        status: 'Quote submitted', kind: 'async-quote', operationId: 53n, movements: [], amountsState: 'none',
        readyToSign: false, nativeAdmission: false } })).rejects.toThrow(fault === 'foreign-target' ? 'outside' : 'owner changed');
    expect(f.decrypt).not.toHaveBeenCalled();
  });
  it('accepts a keeper receipt only with the new Core owner-operation witness', async () => {
    const f = fixture('cheap-history'), worker = toBeHex(7, 20);
    f.transaction.from = worker; f.transaction.to = historyCandidate.core as typeof f.transaction.to;
    f.transaction.data = new Interface(['function recoverSwap(uint256)']).encodeFunctionData('recoverSwap', [53n]);
    Object.assign(f.receipt, { from: worker, to: historyCandidate.core, status: 0, logs: [] });
    const row = await readCurrentDexActivityReceipt({ candidate: 'cheap-history', owner, transaction: f.transaction,
      receipt: f.receipt, timestamp: 1000n, assertCurrent: f.assertCurrent, verifyCanonical: f.verifyCanonical, decrypt: f.decrypt,
      ownerOperation: { core: historyCandidate.core, hash, blockNumber: 90, blockHash, timestamp: 900n, action: 'Quote',
        status: 'Quote submitted', kind: 'async-quote', operationId: 53n, movements: [], amountsState: 'none',
        readyToSign: false, nativeAdmission: false } });
    expect(row).toMatchObject({ core: historyCandidate.core, kind: 'recover', operationId: 53n, status: 'Failed',
      movements: [], readyToSign: false, nativeAdmission: false });
    expect(f.decrypt).not.toHaveBeenCalled();
  });
  it('does not replace unavailable new private amounts with local History', async () => {
    const f = fixture('cheap-history');
    f.decrypt.mockImplementation(() => { throw new Error('private amount unavailable'); });
    await expect(f.read()).rejects.toThrow('private amount unavailable');
  });
  it('checks canonical inclusion around owner-only decryption, without session storage or signing', async () => {
    const f = fixture(); expect(await f.read()).toMatchObject({ core:c.core,hash, action: 'Token claim', status: 'Confirmed', timestamp: 1000n,
      movements: [{ token: f.token, paid: 0n, received: 10_000_000_000n }], amountsState: 'verified', readyToSign: false, nativeAdmission: false });
    expect(f.verifyCanonical).toHaveBeenCalledTimes(2); expect(f.decrypt).toHaveBeenCalledTimes(1);
  });
  it.each(['owner', 'target', 'chain', 'hash', 'canonical', 'encoding', 'decrypt', 'revoke'] as const)('rejects changed %s evidence', async fault => {
    const f = fixture();
    if (fault === 'owner') f.transaction.from = toBeHex(9, 20);
    if (fault === 'target') f.transaction.to = toBeHex(9, 20) as typeof f.transaction.to;
    if (fault === 'chain') f.transaction.chainId = 1n;
    if (fault === 'hash') f.receipt.hash = toBeHex(9, 32);
    if (fault === 'canonical') f.verifyCanonical.mockRejectedValue(new Error('canonical'));
    if (fault === 'encoding') f.receipt.logs[0].data += '00';
    if (fault === 'decrypt') f.decrypt.mockImplementation(() => { throw new Error('private amount unavailable'); });
    if (fault === 'revoke') f.decrypt.mockImplementation(() => { f.assertCurrent.mockImplementation(() => { throw new Error('revoked'); }); return 10_000_000_000n; });
    await expect(f.read()).rejects.toThrow();
  });
  it('keeps failed actions and requires an empty reverted receipt', async () => {
    const f = fixture(); f.receipt.status = 0; f.receipt.logs = [];
    expect(await f.read()).toMatchObject({ action: 'Token claim', status: 'Failed', movements: [], amountsState: 'none' });
    expect(f.decrypt).not.toHaveBeenCalled();
  });
  it('rejects a keeper terminal witness from another Core before reading private amounts', async () => {
    const f = fixture(), worker = toBeHex(7, 20);
    f.transaction.from = worker; f.transaction.to = c.core as typeof f.transaction.to;
    f.transaction.data = new Interface(['function advanceFixedWork(uint256)']).encodeFunctionData('advanceFixedWork', [53n]);
    Object.assign(f.receipt, { from: worker, to: c.core, status: 0, logs: [] });
    await expect(readCurrentDexActivityReceipt({ candidate: 'cheap-exit', owner, transaction: f.transaction,
      receipt: f.receipt, timestamp: 1000n, assertCurrent: f.assertCurrent, verifyCanonical: f.verifyCanonical, decrypt: f.decrypt,
      ownerOperation: { core: toBeHex(9, 20), hash, blockNumber: 90, blockHash, timestamp: 900n, action: 'Quote',
        status: 'Quote submitted', kind: 'async-quote', operationId: 53n, movements: [], amountsState: 'none',
        readyToSign: false, nativeAdmission: false } })).rejects.toThrow('owner changed');
    expect(f.decrypt).not.toHaveBeenCalled();
  });
  it('reads NFT transfers made by another actor without disclosing token amounts', async () => {
    const f = fixture(), nft = c.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1];
    const abi = new Interface(['function safeTransferFrom(address,address,uint256)', 'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
    f.transaction.from = toBeHex(7, 20); f.transaction.to = nft as typeof f.transaction.to;
    f.transaction.data = abi.encodeFunctionData('safeTransferFrom', [f.transaction.from, owner, 17n]);
    f.receipt.from = f.transaction.from; f.receipt.to = nft as typeof f.receipt.to;
    f.receipt.logs = [{ address: nft as string as typeof f.token, ...abi.encodeEventLog(abi.getEvent('Transfer')!, [f.transaction.from, owner, 17n]) }];
    expect(await f.read()).toMatchObject({ action: 'Position NFT received', positionId: 17n, amountsState: 'none' });
    expect(f.decrypt).not.toHaveBeenCalled();
  });
});
