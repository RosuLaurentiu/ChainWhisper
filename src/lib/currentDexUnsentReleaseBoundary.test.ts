// CW-086, decision-033: the send boundary releases a wallet-rejected action that was never sent.
// A token claim is the vehicle here because its authority check is the smallest one.
const browserContexts = vi.hoisted(() => new WeakMap<object, { owner: string }>());
import { describe, expect, it, vi } from 'vitest';
vi.mock('../features/wallet/ownerCotiMetaMaskCapability', () => ({
  hasCurrentDexBrowserSigner: (signer: object | undefined, owner: string) =>
    !!signer && browserContexts.get(signer)?.owner === owner.toLowerCase()
}));
import { Interface } from '@coti-io/coti-ethers';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as candidate } from './selectedCurrentDexCandidate';
import { CURRENT_APP_SWAP_OWNER } from './currentDexC1SwapPolicy';
import { currentDexNormalUseReloadKey } from './currentDexNativeReload';
import { readCurrentDexPendingAttempt, type CurrentDexPendingAttempt } from './currentDexPendingAttempt';
import { wasCurrentDexUnsentReleased } from './currentDexSendBoundary';
import { createCurrentAttemptBoundary } from './currentDexSendBoundary';

const chainId = 7082400n;
const hash = (byte: string) => `0x${byte.repeat(32)}`;
const token = candidate.tokenMetadata[0].address;
const claim = new Interface(['function claimFaucet()']).encodeFunctionData('claimFaucet');
const rejected = () => Object.assign(new Error('User rejected the request.'), { code: 4001 });

const fixture = ({ owner = `0x${'a1'.repeat(20)}`, browser = true, hook = true }: { owner?: string; browser?: boolean; hook?: boolean } = {}) => {
  const rows = new Map<string, string>();
  const storage = { getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
  const signer = {};
  if (browser) {
    browserContexts.set(signer, { owner: owner.toLowerCase() });
    rows.set(currentDexNormalUseReloadKey({ owner, graph: candidate.graph, chainId }), JSON.stringify({
      budget: { version: 2, owner: owner.toLowerCase(), candidateGraph: candidate.graph, start: '1800000000', committedWei: '0', activeSwap: null, charges: [] },
      authentication: hash('ab') }));
  }
  const head = { number: 100n, hash: hash('aa'), timestamp: 1_800_000_000n, gasLimit: 300_000_000n };
  const chain = { latestNonce: 9, pendingNonce: 9 };
  const transport = {
    assertCurrent: vi.fn(async () => {}),
    readHead: vi.fn(async () => head),
    readNonce: vi.fn(async () => 9),
    estimateGas: vi.fn(async () => 100_000n),
    send: vi.fn(async (_request: unknown, _onHash?: (transactionHash: string) => void): Promise<never> => { throw rejected(); }),
    admitOwnerRecord: vi.fn(async () => {}),
    readNativeResources: vi.fn(async () => ({ owner, chainId, head, latestNonce: chain.latestNonce, pendingNonce: chain.pendingNonce,
      gasPrice: 50_000_000n, baseFeePerGas: 0n, balance: 10n ** 20n, code: '0x' })),
    readBlockHash: vi.fn(async () => head.hash),
    readTransaction: vi.fn(async () => null),
    waitForReceipt: vi.fn(async () => null)
  };
  const releaseReservation = vi.fn(async (_attempt: CurrentDexPendingAttempt) => {});
  const boundary = createCurrentAttemptBoundary({ storage, c: candidate, core: candidate.core, owner, chainId,
    transport: transport as never, attest: async () => {}, now: () => 1_800_000_010n, bindTarget: true,
    ...(hook ? { releaseReservation } : {}) });
  const send = () => boundary.sendCurrent('token-faucet', { chainId, from: owner, to: token, value: 0n, data: claim } as never,
    undefined, () => {}, () => {}, undefined, 5_000_000n, undefined, undefined, undefined, undefined, undefined,
    { action: 'initial', token, signer });
  return { storage, signer, transport, chain, boundary, releaseReservation, send, owner,
    pending: () => readCurrentDexPendingAttempt(storage) };
};

describe('send boundary: release of a wallet-rejected action', () => {
  it('releases after rejection by code when the reserved nonce is unused', async () => {
    const f = fixture();
    const error = await f.send().catch(e => e);
    expect(error).toMatchObject({ code: 4001 });
    expect(wasCurrentDexUnsentReleased(error)).toBe(true);
    expect(f.pending()).toBeNull();
    expect(f.transport.send).toHaveBeenCalledOnce();
    expect(f.releaseReservation).toHaveBeenCalledOnce();
    expect(f.releaseReservation.mock.calls[0][0]).toMatchObject({ phase: 'token-faucet', nonce: 9, txHash: null, walletRejected: true });
    // The same action can be reserved and sent again; nothing was sent by the release itself.
    await f.send().catch(() => {});
    expect(f.transport.send).toHaveBeenCalledTimes(2);
  });
  it('accepts the SDK rejection error only when it carries wallet code 4001', async () => {
    const f = fixture();
    f.transport.send.mockRejectedValueOnce(Object.assign(new Error('user rejected action'), { code: 'ACTION_REJECTED', info: { error: { code: 4001 } } }));
    expect(wasCurrentDexUnsentReleased(await f.send().catch(e => e))).toBe(true);
    expect(f.pending()).toBeNull();
    f.transport.send.mockRejectedValueOnce(Object.assign(new Error('user rejected action'), { code: 'ACTION_REJECTED' }));
    expect(wasCurrentDexUnsentReleased(await f.send().catch(e => e))).toBe(false);
    expect(f.pending()).toMatchObject({ txHash: null });
    expect(f.pending()).not.toHaveProperty('walletRejected');
  });
  it.each([
    ['an unknown wallet result', new Error('Unknown wallet result')],
    ['a message that only says denied', new Error('MetaMask Tx Signature: User denied transaction signature.')],
    ['another wallet code', Object.assign(new Error('Internal error'), { code: -32603 })]
  ])('keeps the lock for %s', async (_name, failure) => {
    const f = fixture();
    f.transport.send.mockRejectedValueOnce(failure);
    const error = await f.send().catch(e => e);
    expect(error).toBe(failure);
    expect(wasCurrentDexUnsentReleased(error)).toBe(false);
    expect(f.pending()).toMatchObject({ phase: 'token-faucet', nonce: 9, txHash: null });
    expect(f.pending()).not.toHaveProperty('walletRejected');
    expect(f.releaseReservation).not.toHaveBeenCalled();
    await expect(f.send()).rejects.toThrow('pending');
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('keeps the lock and the hash when the wallet returned a hash before the error', async () => {
    const f = fixture();
    f.transport.send.mockImplementationOnce(async (_request, onHash) => { onHash?.(hash('cd')); throw rejected(); });
    expect(wasCurrentDexUnsentReleased(await f.send().catch(e => e))).toBe(false);
    expect(f.pending()).toMatchObject({ txHash: hash('cd') });
    expect(f.pending()).not.toHaveProperty('walletRejected');
    expect(f.releaseReservation).not.toHaveBeenCalled();
  });
  it('keeps the rejection fact when the nonce is pending and releases on a later check', async () => {
    const f = fixture();
    f.transport.send.mockImplementationOnce(async () => { f.chain.pendingNonce = 10; throw rejected(); });
    expect(wasCurrentDexUnsentReleased(await f.send().catch(e => e))).toBe(false);
    expect(f.pending()).toMatchObject({ txHash: null, walletRejected: true });
    expect(f.releaseReservation).not.toHaveBeenCalled();
    await expect(f.send()).rejects.toThrow('pending');
    await expect(f.boundary.releaseUnsent(f.signer)).rejects.toThrow('nonce');
    f.chain.pendingNonce = 9;
    await expect(f.boundary.releaseUnsent(f.signer)).resolves.toBe(true);
    expect(f.pending()).toBeNull();
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('never releases when the latest nonce is above the reserved nonce', async () => {
    const f = fixture();
    f.transport.send.mockImplementationOnce(async () => { f.chain.latestNonce = 10; f.chain.pendingNonce = 10; throw rejected(); });
    await f.send().catch(() => {});
    expect(f.pending()).toMatchObject({ txHash: null, walletRejected: true });
    await expect(f.boundary.releaseUnsent(f.signer)).rejects.toThrow('nonce');
    expect(f.pending()).toMatchObject({ txHash: null, walletRejected: true });
  });
  it('keeps the lock when the head or RPC check fails, and when the ledger step fails', async () => {
    const rpc = fixture();
    rpc.transport.send.mockImplementationOnce(async () => { rpc.transport.readNativeResources.mockRejectedValueOnce(new Error('RPC unavailable')); throw rejected(); });
    expect(wasCurrentDexUnsentReleased(await rpc.send().catch(e => e))).toBe(false);
    expect(rpc.pending()).toMatchObject({ walletRejected: true });
    const ledger = fixture();
    ledger.releaseReservation.mockRejectedValueOnce(new Error('Unlock owner privacy before saving or restoring the native budget.'));
    const error = await ledger.send().catch(e => e);
    expect(error).toMatchObject({ code: 4001 });
    expect(wasCurrentDexUnsentReleased(error)).toBe(false);
    expect(ledger.pending()).toMatchObject({ walletRejected: true });
    await expect(ledger.boundary.releaseUnsent(ledger.signer)).resolves.toBe(true);
    expect(ledger.pending()).toBeNull();
  });
  it('does not release without the browser wallet session, for another wallet, or for an adapter with no release step', async () => {
    const engineering = fixture({ owner: CURRENT_APP_SWAP_OWNER, browser: false });
    expect(wasCurrentDexUnsentReleased(await engineering.send().catch(e => e))).toBe(false);
    expect(engineering.pending()).toMatchObject({ txHash: null });
    expect(engineering.pending()).not.toHaveProperty('walletRejected');
    const noHook = fixture({ hook: false });
    expect(wasCurrentDexUnsentReleased(await noHook.send().catch(e => e))).toBe(false);
    expect(noHook.pending()).toMatchObject({ txHash: null });
    expect(noHook.pending()).not.toHaveProperty('walletRejected');
    const first = fixture();
    first.transport.send.mockImplementationOnce(async () => { first.chain.pendingNonce = 10; throw rejected(); });
    await first.send().catch(() => {});
    first.chain.pendingNonce = 9;
    const otherOwner = `0x${'b2'.repeat(20)}`, otherSigner = {};
    browserContexts.set(otherSigner, { owner: otherOwner });
    const other = createCurrentAttemptBoundary({ storage: first.storage, c: candidate, core: candidate.core, owner: otherOwner, chainId,
      transport: first.transport as never, attest: async () => {}, now: () => 1_800_000_010n, bindTarget: true, releaseReservation: first.releaseReservation });
    await expect(other.releaseUnsent(otherSigner)).rejects.toThrow('another wallet');
    await expect(first.boundary.releaseUnsent({})).rejects.toThrow('browser wallet session');
    expect(first.pending()).toMatchObject({ walletRejected: true, owner: first.owner });
  });
  it('does not release a record of another chain, contract or candidate', async () => {
    const f = fixture();
    f.transport.send.mockImplementationOnce(async () => { f.chain.pendingNonce = 10; throw rejected(); });
    await f.send().catch(() => {});
    f.chain.pendingNonce = 9;
    const base = { storage: f.storage, c: candidate, core: candidate.core, owner: f.owner, chainId, transport: f.transport as never,
      attest: async () => {}, now: () => 1_800_000_010n, bindTarget: true, releaseReservation: f.releaseReservation };
    for (const change of [{ chainId: 1n }, { core: `0x${'ee'.repeat(20)}` }, { c: { ...candidate, graph: 'f'.repeat(64) } }]) {
      await expect(createCurrentAttemptBoundary({ ...base, ...change }).releaseUnsent(f.signer)).rejects.toThrow('another wallet, network or contract');
    }
    expect(f.pending()).toMatchObject({ walletRejected: true, txHash: null });
    expect(f.releaseReservation).not.toHaveBeenCalled();
    await expect(f.boundary.releaseUnsent(f.signer)).resolves.toBe(true);
  });
  it('reports no release when there is no rejected record', async () => {
    const f = fixture();
    await expect(f.boundary.releaseUnsent(f.signer)).resolves.toBe(false);
    expect(f.transport.readNativeResources).not.toHaveBeenCalled();
  });
});
