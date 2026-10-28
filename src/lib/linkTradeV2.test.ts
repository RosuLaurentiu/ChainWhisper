import { Interface } from '@coti-io/coti-ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import artifact from '../../tests/fixtures/full-candidate-ChainWhisperLinkOTCEscrowV2.json';
import { createTradeAccessSecret } from './directTradeTerms';
import { linkTradeV2CredentialDomain, sealLinkTradeV2Terms } from './linkTradeV2Terms';
import { LINK_TRADE_V2_ABI } from './linkTradeV2Abi';
import { readLinkTradeV2Review, readLinkTradeV2CurrentReview, prepareLinkTradeV2Fill, recheckLinkTradeV2Fill, prepareLinkTradeV2Create, prepareLinkTradeV2CreateRecovery, recheckLinkTradeV2Create, parseLinkTradeV2CreationReceipt, bindLinkTradeV2CreationReceipt, prepareLinkTradeV2CounterAuthorization } from './linkTradeV2';
import { parseLinkTradeV2Path } from './linkTradeV2Links';
import { deriveLinkTradeV2Credential, openLinkTradeV2Terms } from './linkTradeV2Terms';

const mocks = vi.hoisted(() => ({ read: vi.fn(), assert: vi.fn(), binding: vi.fn(), current: vi.fn(), encrypt: vi.fn() }));
vi.mock('./tradeHistoryV2Chain', () => ({ assertAttestedTradeHistoryV2Deployment: mocks.assert,
  readAttestedTradeHistoryV2View: mocks.read }));
vi.mock('./ownerTradeV2Capability', () => ({ getOwnerTradeV2CapabilityBinding: mocks.binding,
  assertOwnerTradeV2CapabilityCurrent: mocks.current, assertOwnerTradeV2CapabilitySnapshotCurrent: mocks.current }));
vi.mock('./privateUint256', () => ({ encryptPrivateUint256Input: mocks.encrypt }));
const abi = new Interface(LINK_TRADE_V2_ABI), hash = `0x${'ab'.repeat(32)}`;
const target = `0x${'11'.repeat(20)}`, maker = `0x${'22'.repeat(20)}`, filler = `0x${'33'.repeat(20)}`;
const tokenA = `0x${'44'.repeat(20)}`, tokenB = `0x${'55'.repeat(20)}`;
const context = { chainId: '7082400', escrow: target, maker, makerNonce: hash, credentialEpoch: '1' };
const reference = { chainId: '7082400', escrow: target, id: '9007199254740993', revision: '2', credentialEpoch: '1' };
const deployment = { protocol: 'link-v2', chainId: '7082400', contractAddress: target } as never;
const capability = {} as never;
const terms = { offerToken: tokenA, requestToken: tokenB, privatePair: false,
  priceOffer: '10', priceRequest: '15', expiresAt: '0' };
let tuple: unknown[];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.binding.mockReturnValue({ chainId: 7082400n, ownerAddress: filler, signer: {} });
  mocks.encrypt.mockResolvedValue({ ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature: '0x1234' });
  mocks.read.mockImplementation(async () => abi.encodeFunctionResult('getOrderView', [tuple]));
});
const review = async (privatePair = false) => {
  const secret = createTradeAccessSecret(), input = { ...terms, privatePair };
  const sealed = await sealLinkTradeV2Terms(context, input, secret);
  tuple = [[maker, tokenA, tokenB, hash, hash, hash, 0n, 2n, 1n, 1n, privatePair, true],
    1n, privatePair ? [0n, 0n] : [10n, 15n], privatePair ? 0n : 100n,
    privatePair ? 0n : 80n, sealed, linkTradeV2CredentialDomain(context)];
  return readLinkTradeV2Review({ capability, deployment, reference, secret });
};

describe('Link reader and selected-wallet preparation', () => {
  it('authorizes the proposer directly at the Link selector with no credential forwarded to Counter', async () => {
    const reviewed = await review(true);
    const prepared = await prepareLinkTradeV2CounterAuthorization({ review: reviewed, capability });
    expect(prepared.to).toBe(target);
    const call = abi.parseTransaction({ data: prepared.data })!;
    expect(call.name).toBe('authorizeCounter');
    expect(call.args.ref.id).toBe(BigInt(reference.id));
    expect(mocks.encrypt).toHaveBeenCalledOnce();
    expect(mocks.encrypt.mock.calls[0].slice(2)).toEqual([target, abi.getFunction('authorizeCounter')!.selector]);
    expect(prepared).not.toHaveProperty('secret');
    await expect(prepareLinkTradeV2CounterAuthorization({ review: { ...reviewed }, capability })).rejects.toThrow();
  });
  it('uses the exact full-artifact input and output ABI', () => {
    const current = new Interface(artifact.abi);
    for (const fragment of abi.fragments) {
      const original = fragment.type === 'event' ? current.getEvent(fragment.format('sighash')) : current.getFunction(fragment.format('sighash'));
      expect(original?.format('full')).toBe(fragment.format('full'));
    }
  });
  it('opens canonical authenticated terms with full-width identity and no wallet request', async () => {
    const result = await review();
    expect(result.reference).toEqual(reference);
    expect(result.terms).toEqual(terms);
    expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ capability, deployment,
      data: abi.encodeFunctionData('getOrderView', [BigInt(reference.id)]) }));
    expect(mocks.binding).not.toHaveBeenCalled();
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });
  it.each([false, true])('prepares exact fill calldata through the existing wallet encryption, private=%s', async privatePair => {
    const reviewed = await review(privatePair);
    const result = await prepareLinkTradeV2Fill({ review: reviewed, capability, maximumPayment: '15' });
    expect(result).toMatchObject({ chainId: '7082400', from: filler, to: target, value: 0n, maximumPayment: '15' });
    const parsed = abi.parseTransaction({ data: result.data })!;
    expect(parsed.name).toBe(privatePair ? 'fillPrivateLink' : 'fillPublicLink');
    expect(parsed.args.ref.id).toBe(BigInt(reference.id));
    expect(parsed.args.ref.revision).toBe(2n);
    expect(mocks.encrypt).toHaveBeenCalledTimes(privatePair ? 4 : 1);
    for (const call of mocks.encrypt.mock.calls) {
      expect(call[2]).toBe(target);
      expect(call[3]).toBe(abi.getFunction(parsed.name)!.selector);
    }
    if (privatePair) expect(mocks.encrypt.mock.calls.slice(1).map(call => call[1])).toEqual([15n, 10n, 15n]);
    else expect(parsed.args.maximumPayment).toBe(15n);
    expect('secret' in result).toBe(false);
  });
  it('rejects a changed chain or escrow before a contract read', async () => {
    for (const changed of [{ ...reference, chainId: '1' }, { ...reference, escrow: tokenA }]) {
      await expect(readLinkTradeV2Review({ capability, deployment, reference: changed, secret: createTradeAccessSecret() }))
        .rejects.toThrow();
    }
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('rejects stale, revoked, closed, forged-domain and mismatched terms without wallet requests', async () => {
    const good = await review(), secret = createTradeAccessSecret();
    const original = tuple;
    const order = original[0] as unknown[];
    for (const invalid of [
      [[...order.slice(0, 7), 3n, ...order.slice(8)], ...original.slice(1)],
      [[...order.slice(0, 11), false], ...original.slice(1)],
      [order, 2n, ...original.slice(2)],
      [...original.slice(0, 6), `0x${'cd'.repeat(32)}`],
      [order, 1n, [10n, 16n], ...original.slice(3)]
    ]) {
      tuple = invalid;
      await expect(prepareLinkTradeV2Fill({ review: good, capability, maximumPayment: '15' })).rejects.toThrow();
    }
    tuple = original;
    await expect(readLinkTradeV2Review({ capability, deployment, reference, secret })).rejects.toThrow();
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });
  it('rejects cloned reviews, maker self-fill, foreign wallet chain and invalid maximums before encryption', async () => {
    const good = await review();
    await expect(prepareLinkTradeV2Fill({ review: { ...good }, capability, maximumPayment: '15' })).rejects.toThrow();
    for (const invalid of ['0', '01', (1n << 128n).toString()]) {
      await expect(prepareLinkTradeV2Fill({ review: good, capability, maximumPayment: invalid })).rejects.toThrow();
    }
    mocks.binding.mockReturnValue({ chainId: 7082400n, ownerAddress: maker, signer: {} });
    await expect(prepareLinkTradeV2Fill({ review: good, capability, maximumPayment: '15' })).rejects.toThrow();
    mocks.binding.mockReturnValue({ chainId: 1n, ownerAddress: filler, signer: {} });
    await expect(prepareLinkTradeV2Fill({ review: good, capability, maximumPayment: '15' })).rejects.toThrow();
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });
  it('refreshes an older shared URL before a new review but never widens a signed fill revision', async () => {
    const old = await review(), secret = createTradeAccessSecret();
    tuple[5] = await sealLinkTradeV2Terms(context, terms, secret);
    (tuple[0] as unknown[])[7] = 3n;
    const fresh = await readLinkTradeV2CurrentReview({ capability, deployment, reference, secret });
    expect(fresh.reference.revision).toBe('3');
    await expect(prepareLinkTradeV2Fill({ review: old, capability, maximumPayment: '15' })).rejects.toThrow(/stale/);
    const prepared = await prepareLinkTradeV2Fill({ review: fresh, capability, maximumPayment: '15' });
    (tuple[0] as unknown[])[7] = 4n;
    await expect(recheckLinkTradeV2Fill(prepared)).rejects.toThrow(/stale/);
    (tuple[0] as unknown[])[8] = 2n;
    await expect(readLinkTradeV2CurrentReview({ capability, deployment, reference, secret })).rejects.toThrow(/credential/);
  });
  it('saves unsigned fill terms before any signature and rejects cloned preparations', async () => {
    const original = await review(true), onRecovery = vi.fn(async material => {
      expect(mocks.encrypt).not.toHaveBeenCalled();
      expect(material).toMatchObject({ maker, maximumPayment: '15', terms: { privatePair: true } });
      expect(material).not.toHaveProperty('data');
    });
    const prepared = await prepareLinkTradeV2Fill({ review: original, capability, maximumPayment: '15', onRecovery });
    expect(onRecovery).toHaveBeenCalledOnce();
    await expect(recheckLinkTradeV2Fill({ ...prepared })).rejects.toThrow(/original preparation/);
  });
  it('does not return a prepared fill after session or order changes during wallet signatures', async () => {
    const good = await review(true);
    mocks.encrypt.mockImplementationOnce(async () => {
      const order = tuple[0] as unknown[];
      tuple[0] = [...order.slice(0, 7), 3n, ...order.slice(8)];
      return { ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature: '0x1234' };
    });
    await expect(prepareLinkTradeV2Fill({ review: good, capability, maximumPayment: '15' })).rejects.toThrow();
    await review();
    mocks.current.mockRejectedValueOnce(new Error('Wallet session changed.'));
    await expect(prepareLinkTradeV2Fill({ review: good, capability, maximumPayment: '15' })).rejects.toThrow(/session/);
  });
});

describe('Link creation and receipt-to-link binding', () => {
  const full = new Interface(artifact.abi), txHash = `0x${'66'.repeat(32)}`;
  const create = async (privatePair = false, offerBudget = '100') => {
    mocks.binding.mockReturnValue({ chainId: 7082400n, ownerAddress: maker, signer: {} });
    mocks.read.mockImplementation(async ({ data }: { data: string }) => {
      const call = full.parseTransaction({ data })!;
      return full.encodeFunctionResult(call.name, [call.name === 'usedMakerNonce' ? false : hash]);
    });
    return prepareLinkTradeV2Create({ readCapability: capability, deployment, capability,
      terms: { ...terms, privatePair }, offerBudget });
  };
  const receipt = (prepared: Awaited<ReturnType<typeof prepareLinkTradeV2Create>>, changes: Record<string, unknown> = {}) => {
    const call = full.parseTransaction({ data: prepared.data })!, config = call.args.config;
    const id = '9007199254740993';
    const event = full.encodeEventLog(full.getEvent('LinkOpened')!, [id, maker, prepared.terms.privatePair,
      tokenA, tokenB, prepared.terms.privatePair ? 0n : 100n,
      prepared.terms.privatePair ? [0n, 0n] : [10n, 15n], config.makerNonce, 0n]);
    return { status: 1, hash: txHash, from: maker, to: target, blockNumber: 9, blockHash: hash,
      logs: [{ address: target, ...event, transactionHash: txHash, blockNumber: 9, blockHash: hash, index: 0, removed: false }], ...changes };
  };
  it.each([false, true])('prepares exact creation and recovers only its own Share link, private=%s', async privatePair => {
    const prepared = await create(privatePair);
    const call = full.parseTransaction({ data: prepared.data })!;
    expect(call.name).toBe(privatePair ? 'createPrivateLink' : 'createPublicLink');
    expect(prepared).toMatchObject({ chainId: '7082400', from: maker, to: target, value: 0n, offerBudget: '100' });
    expect(mocks.encrypt).toHaveBeenCalledTimes(privatePair ? 4 : 1);
    for (const value of mocks.encrypt.mock.calls) {
      expect(value[2]).toBe(target); expect(value[3]).toBe(full.getFunction(call.name)!.selector);
    }
    if (privatePair) expect(mocks.encrypt.mock.calls.map(call => call[1]).slice(0, 3)).toEqual([100n, 10n, 15n]);
    else { expect(call.args.budget).toBe(100n); expect([...call.args.price]).toEqual([10n, 15n]); }
    const recovered = parseLinkTradeV2CreationReceipt({ prepared, transactionHash: txHash, receipt: receipt(prepared) });
    const link = parseLinkTradeV2Path(recovered.sharePath)!;
    expect(link.reference).toEqual({ chainId: '7082400', escrow: target, id: '9007199254740993', revision: '1', credentialEpoch: '1' });
    const domain = { ...context, makerNonce: call.args.config.makerNonce };
    expect(await openLinkTradeV2Terms(domain, call.args.sealedTerms, link.secret)).toEqual({ ...terms, privatePair });
    expect(mocks.encrypt.mock.calls[privatePair ? 3 : 0][1]).toBe(await deriveLinkTradeV2Credential(domain, link.secret));
    expect(prepared.data).not.toContain(link.secret.slice(2));
    expect('secret' in prepared).toBe(false);
    expect(new URL(recovered.sharePath, 'https://chainwhisper.invalid').pathname).not.toContain(link.secret);
  });
  it('uses independent fresh nonces and credentials without caller-supplied material', async () => {
    const first = await create(), second = await create();
    const a = full.parseTransaction({ data: first.data })!, b = full.parseTransaction({ data: second.data })!;
    expect(a.args.config.makerNonce).not.toBe(b.args.config.makerNonce);
    const x = parseLinkTradeV2Path(parseLinkTradeV2CreationReceipt({ prepared: first, transactionHash: txHash, receipt: receipt(first) }).sharePath)!;
    const y = parseLinkTradeV2Path(parseLinkTradeV2CreationReceipt({ prepared: second, transactionHash: txHash, receipt: receipt(second) }).sharePath)!;
    expect(x.secret).not.toBe(y.secret); expect(x.secret).not.toBe(a.args.config.makerNonce);
  });
  it('binds an existing receipt from unsigned recovery without recreating signed inputs', async () => {
    await create();
    let material: Parameters<typeof bindLinkTradeV2CreationReceipt>[0]['material'] | undefined;
    const prepared = await prepareLinkTradeV2Create({ readCapability: capability, deployment, capability, offerBudget: '100', terms,
      onRecovery: async value => { material = value; } });
    mocks.encrypt.mockClear();
    const expected = parseLinkTradeV2CreationReceipt({ prepared, transactionHash: txHash, receipt: receipt(prepared) });
    expect(bindLinkTradeV2CreationReceipt({ material: material!, transactionHash: txHash, receipt: receipt(prepared) })).toEqual(expected);
    expect(() => bindLinkTradeV2CreationReceipt({ material: { ...material!, terms: { ...terms, priceRequest: '99' } }, transactionHash: txHash, receipt: receipt(prepared) })).toThrow();
    expect(() => bindLinkTradeV2CreationReceipt({ material: { ...material!, context: { ...material!.context, makerNonce: hash } }, transactionHash: txHash, receipt: receipt(prepared) })).toThrow();
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });
  it.each([false, true])('continues the same domain with fresh COTI inputs after reconnect, private=%s', async privatePair => {
    await create(privatePair);
    let material: Parameters<typeof prepareLinkTradeV2CreateRecovery>[0]['material'] | undefined;
    const first = await prepareLinkTradeV2Create({ readCapability: capability, deployment, capability, offerBudget: '100',
      terms: { ...terms, privatePair }, onRecovery: async value => { material = value; } });
    const firstCall = full.parseTransaction({ data: first.data })!;
    mocks.encrypt.mockClear();
    const restored = await prepareLinkTradeV2CreateRecovery({ readCapability: capability, deployment, capability,
      material: structuredClone(material!) });
    const nextCall = full.parseTransaction({ data: restored.data })!;
    expect(nextCall.args.config.makerNonce).toBe(firstCall.args.config.makerNonce);
    expect(nextCall.args.sealedTerms).not.toBe(firstCall.args.sealedTerms);
    expect(mocks.encrypt).toHaveBeenCalledTimes(privatePair ? 4 : 1);
    const recovered = parseLinkTradeV2CreationReceipt({ prepared: restored, transactionHash: txHash, receipt: receipt(restored) });
    expect(parseLinkTradeV2Path(recovered.sharePath)?.secret).toBe(material!.secret);
    mocks.encrypt.mockClear();
    await expect(prepareLinkTradeV2CreateRecovery({ readCapability: capability, deployment, capability,
      material: { ...material!, context: { ...material!.context, maker: filler } } })).rejects.toThrow(/owner/);
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });
  it('rejects invalid budgets, terms and foreign wallet chains before encrypted-input signatures', async () => {
    for (const budget of ['0', '01', (1n << 128n).toString()]) await expect(create(false, budget)).rejects.toThrow();
    mocks.binding.mockReturnValue({ chainId: 1n, ownerAddress: maker, signer: {} });
    await expect(prepareLinkTradeV2Create({ readCapability: capability, deployment, capability,
      offerBudget: '100', terms })).rejects.toThrow();
    await expect(prepareLinkTradeV2Create({ readCapability: capability, deployment, capability,
      offerBudget: '100', terms: { ...terms, priceOffer: '0' } })).rejects.toThrow();
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });
  it('saves unsigned recovery before encrypted-input signatures and stops if that save fails', async () => {
    await create(); mocks.encrypt.mockClear();
    const onRecovery = vi.fn(async material => {
      expect(mocks.encrypt).not.toHaveBeenCalled();
      expect(material).toMatchObject({ context: { maker, escrow: target }, terms, offerBudget: '100' });
      expect(Object.keys(material).sort()).toEqual(['context', 'offerBudget', 'offerCodeHash', 'secret', 'terms']);
      throw new Error('Recovery storage unavailable.');
    });
    await expect(prepareLinkTradeV2Create({ readCapability: capability, deployment, capability, offerBudget: '100', terms, onRecovery }))
      .rejects.toThrow(/Recovery storage/);
    expect(onRecovery).toHaveBeenCalledOnce(); expect(mocks.encrypt).not.toHaveBeenCalled();
  });
  it('rejects unapproved tokens and used nonces before encryption', async () => {
    await create(); mocks.encrypt.mockClear();
    for (const bad of ['approvedPublicTokenCodeHash', 'usedMakerNonce']) {
      mocks.read.mockImplementation(async ({ data }: { data: string }) => {
        const call = full.parseTransaction({ data })!;
        return full.encodeFunctionResult(call.name, [call.name === 'usedMakerNonce' ? call.name === bad : call.name === bad ? `0x${'00'.repeat(32)}` : hash]);
      });
      await expect(prepareLinkTradeV2Create({ readCapability: capability, deployment, capability, offerBudget: '100', terms })).rejects.toThrow();
    }
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });
  it('keeps reviewed terms immutable and stops if the nonce or session changes during signatures', async () => {
    await create(); mocks.encrypt.mockClear();
    const mutable = { ...terms };
    mocks.encrypt.mockImplementationOnce(async () => { mutable.priceRequest = '99';
      return { ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature: '0x1234' }; });
    const prepared = await prepareLinkTradeV2Create({ readCapability: capability, deployment, capability, offerBudget: '100', terms: mutable });
    expect(prepared.terms.priceRequest).toBe('15');
    await recheckLinkTradeV2Create(prepared);
    await expect(recheckLinkTradeV2Create({ ...prepared })).rejects.toThrow(/original/);
    mocks.encrypt.mockImplementationOnce(async () => {
      mocks.read.mockImplementation(async ({ data }: { data: string }) => {
        const call = full.parseTransaction({ data })!;
        return full.encodeFunctionResult(call.name, [call.name === 'usedMakerNonce' ? true : hash]);
      });
      return { ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature: '0x1234' };
    });
    await expect(prepareLinkTradeV2Create({ readCapability: capability, deployment, capability, offerBudget: '100', terms })).rejects.toThrow();
    await expect(recheckLinkTradeV2Create(prepared)).rejects.toThrow(/nonce/);
    await create(); mocks.current.mockRejectedValueOnce(new Error('Wallet session changed.'));
    await expect(prepareLinkTradeV2Create({ readCapability: capability, deployment, capability, offerBudget: '100', terms })).rejects.toThrow(/session/);
  });
  it('rejects an old approval mode and wallet loss after an encrypted-input signature', async () => {
    await create(true); mocks.encrypt.mockClear();
    mocks.read.mockImplementation(async ({ data }: { data: string }) => {
      const call = full.parseTransaction({ data })!;
      return full.encodeFunctionResult(call.name, [call.name === 'usedMakerNonce' ? false :
        call.name === 'approvedPrivateTokenCodeHash' ? `0x${'00'.repeat(32)}` : hash]);
    });
    await expect(prepareLinkTradeV2Create({ readCapability: capability, deployment, capability, offerBudget: '100',
      terms: { ...terms, privatePair: true } })).rejects.toThrow(/privacy mode/);
    expect(mocks.encrypt).not.toHaveBeenCalled();
    await create();
    mocks.encrypt.mockImplementationOnce(async () => {
      mocks.current.mockRejectedValueOnce(new Error('Wallet session changed.'));
      return { ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature: '0x1234' };
    });
    await expect(prepareLinkTradeV2Create({ readCapability: capability, deployment, capability, offerBudget: '100', terms }))
      .rejects.toThrow(/session/);
  });
  it('rejects cloned preparations, wrong transactions, foreign events and duplicate creation events', async () => {
    const prepared = await create(), good = receipt(prepared);
    expect(() => parseLinkTradeV2CreationReceipt({ prepared: { ...prepared }, transactionHash: txHash, receipt: good })).toThrow();
    for (const change of [{ status: 0 }, { hash }, { from: filler }, { to: filler }, { blockHash: `0x${'00'.repeat(32)}` },
      { logs: [] }, { logs: [good.logs[0], good.logs[0]] }, { logs: [{ ...good.logs[0], address: tokenA }] },
      { logs: [{ ...good.logs[0], removed: true }] }, { logs: [{ ...good.logs[0], transactionHash: hash }] },
      { logs: [{ ...good.logs[0], blockHash: txHash }] }, { logs: [{ ...good.logs[0], blockNumber: 10 }] },
      { logs: [{ ...good.logs[0], index: -1 }] }, { logs: [{ ...good.logs[0], data: good.logs[0].data + '00' }] },
      { logs: [{ ...good.logs[0], topics: [...good.logs[0].topics, hash] }] }]) {
      expect(() => parseLinkTradeV2CreationReceipt({ prepared, transactionHash: txHash, receipt: { ...good, ...change } })).toThrow();
    }
    const other = await create();
    expect(() => parseLinkTradeV2CreationReceipt({ prepared: other, transactionHash: txHash, receipt: good })).toThrow();
  });
});
