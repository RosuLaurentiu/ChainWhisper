import { describe, expect, it, vi } from 'vitest';
import { readCurrentDexActivityPage, buildCurrentDexActivityEntries } from './currentDexActivity';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as historyCandidate } from './dexV2Deployment';
import type { CurrentDexActivityRow } from './currentDexActivityReceipt';
import type { SharedWalletSession } from './walletSession';

// decision-034: the saved Quote fixture uses the current candidate; the b2aa descriptor was removed.
const candidate = historyCandidate;

const owner = `0x${'22'.repeat(20)}`, hash = `0x${'33'.repeat(32)}`;
const fixture = () => {
  const issued = { operationId: 53n, transactionHash: hash, originBlock: { number: 100n, hash },
    intent: { profile: 'cheap-async', candidate, destination: owner, inputToken: candidate.tokens[1][0],
      outputToken: candidate.tokens[0][0], maximumInput: 1_000_000n }, operation: { stage: 7 } };
  Object.assign(issued, { readCurrent: vi.fn(async () => issued) });
  const receipt = { kind: 'terminal', operation: { stage: 7 }, releaseAction: null as null | 'cancel' | 'recover',
    privateAccountingVerified: true, readyToSign: false, nativeAdmission: false, originalQuoteRateVerification: 'unavailable',
    amounts: { filled: true, actualInput: 1_000_000n, netOutput: 1_355_299n, refund: 0n } };
  const sender = { readCurrentCheapRestoreHint: vi.fn(() => ({ quoteHash: hash } as { quoteHash: string | null } | null)),
    restoreCurrentCheapOperation: vi.fn(), readCurrentCheapDelivery: vi.fn(), readCurrentCheapActivityReceipt: vi.fn(async () => receipt) };
  const quote = { restoreCurrentQuote: vi.fn(async () => issued) };
  const session = { walletAddress: owner, chainId: Number(candidate.chainId), actions: {
    getCurrentDexSubmissionCapability: vi.fn(async () => sender), getCurrentDexQuoteCapability: vi.fn(async () => quote)
  } } as unknown as SharedWalletSession;
  const assertCurrent = vi.fn();
  return { issued, receipt, sender, quote, session, assertCurrent };
};

describe('saved owner-private async activity', () => {
  it('passes caller invalidation into an in-progress Activity reader before its next request', async () => {
    const f = fixture(); let active = true, release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), nextRequest = vi.fn();
    const readPage = vi.fn(async ({ assertCurrent }: { assertCurrent?: () => void }) => {
      await held; assertCurrent?.(); nextRequest(); return { rows: [], complete: true };
    });
    const session = { ...f.session, actions: { getCurrentDexSubmissionCapability: async () => ({ readCurrentDexActivityPage: readPage }) } } as unknown as SharedWalletSession;
    const pending = readCurrentDexActivityPage(session, 'cheap-history', () => { if (!active) throw new Error('caller replaced'); },
      { cursor: { transactions: 1, nfts: 1 } });
    await vi.waitFor(() => expect(readPage).toHaveBeenCalledOnce()); active = false; release();
    await expect(pending).rejects.toThrow('caller replaced'); expect(nextRequest).not.toHaveBeenCalled();
  });
  it('routes chain History to the new candidate without restoring a saved Quote', async () => {
    const f = fixture(), page = { rows: [], complete: true };
    const readPage = vi.fn(async ({ onProgress }) => { onProgress(0, 0, 'validation'); return page; });
    const getSender = vi.fn(async () => ({ readCurrentDexActivityPage: readPage }));
    const session = { ...f.session, chainId: Number(historyCandidate.chainId), actions: {
      ...f.session.actions, getCurrentDexSubmissionCapability: getSender
    } } as unknown as SharedWalletSession;
    const options = { cursor: { transactions: 1, nfts: 1 }, onProgress: vi.fn() };
    expect(await readCurrentDexActivityPage(session, 'cheap-history', f.assertCurrent, options)).toBe(page);
    expect(getSender).toHaveBeenCalledWith(BigInt(historyCandidate.chainId), { candidate: 'cheap-history' });
    expect(readPage).toHaveBeenCalledOnce();
    expect(options.onProgress).toHaveBeenCalledWith(0, 0, 'validation');
    expect(f.quote.restoreCurrentQuote).not.toHaveBeenCalled();
  });
  it('keeps new chain History unavailable when its reader fails', async () => {
    const f = fixture();
    const session = { ...f.session, actions: { getCurrentDexSubmissionCapability: vi.fn(async () => ({
      readCurrentDexActivityPage: vi.fn(async () => { throw new Error('canonical History unavailable'); })
    })) } } as unknown as SharedWalletSession;
    await expect(readCurrentDexActivityPage(session, 'cheap-history', f.assertCurrent,
      { cursor: { transactions: 1, nfts: 1 } })).rejects.toThrow('canonical History unavailable');
  });
  it('merges private maker fills with wallet actions without inventing transactions or double-counting claims', () => {
    const row: CurrentDexActivityRow = { core: candidate.core, hash, blockNumber: 100, blockHash: hash, timestamp: 1000n,
      action: 'Claim proceeds', status: 'Confirmed', kind: 'action', positionId: 7n,
      movements: [{ token: candidate.tokens[0][0], paid: 0n, received: 10n }], amountsState: 'verified', readyToSign: false, nativeAdmission: false };
    const fill = { engine: candidate.pairs[0].engine, record: 2n, positionId: 7n, blockNumber: 95n, blockHash: hash, timestamp: 995n,
      soldToken: candidate.tokens[1][0], receivedToken: candidate.tokens[0][0], sold: 5n, received: 10n, readyToSign: false as const, nativeAdmission: false as const };
    const entries = buildCurrentDexActivityEntries([row], [fill]);
    expect(entries).toHaveLength(2); expect(entries[0]).toMatchObject({ action: 'Claim proceeds', hash });
    expect(entries[1]).toMatchObject({ kind: 'limit-fill', action: 'Limit execution', status: 'Executed', positionId: 7n,
      movements: [{ paid: 5n, received: 0n }, { paid: 0n, received: 10n }] });
    expect(entries[1].hash).toBeUndefined(); expect(entries[1].key).toContain(fill.engine);
  });
  it('joins all canonical async phases without double-counting funding or refund',()=>{
    const base={core:candidate.core,hash,blockNumber:100,blockHash:hash,timestamp:1000n,operationId:53n,status:'Confirmed',movements:[],amountsState:'none',readyToSign:false,nativeAdmission:false} as const;
    const rows:CurrentDexActivityRow[]=[{...base,kind:'async-quote',action:'Multi-source Quote',inputToken:candidate.tokens[1][0],outputToken:candidate.tokens[0][0]},
      {...base,hash:`0x${'44'.repeat(32)}`,kind:'async-funding',action:'Swap funding',movements:[{token:candidate.tokens[1][0],paid:1_000_000n,received:0n}],amountsState:'verified'},
      {...base,hash:`0x${'55'.repeat(32)}`,kind:'async-delivery',action:'Swap delivery',movements:[{token:candidate.tokens[1][0],paid:0n,received:250_000n},{token:candidate.tokens[0][0],paid:0n,received:1_000_000n}],amountsState:'verified'}];
    const entries=buildCurrentDexActivityEntries(rows);
    expect(entries).toHaveLength(1);expect(entries[0]).toMatchObject({action:'Multi-source swap',status:'Partially filled',transactions:expect.any(Array),
      movements:[{token:candidate.tokens[1][0],paid:750_000n,received:250_000n},{token:candidate.tokens[0][0],paid:0n,received:1_000_000n}]});
    rows[2]={...rows[2],movements:[{token:candidate.tokens[1][0],paid:0n,received:1_000_000n},{token:candidate.tokens[0][0],paid:0n,received:0n}]};
    expect(buildCurrentDexActivityEntries(rows)[0]).toMatchObject({status:'No fill; refunded',movements:[{paid:0n,received:1_000_000n},{received:0n}]});
  });
  it('keeps equal operation IDs on different deployments in separate accounting groups', () => {
    const make = (core: string, seed: number, paid: bigint, refund: bigint, output: bigint): CurrentDexActivityRow[] => {
      const base = { core, blockNumber: seed, blockHash: hash, timestamp: 1000n, operationId: 1n,
        status: 'Confirmed', amountsState: 'verified', readyToSign: false, nativeAdmission: false } as const;
      const inputToken = candidate.tokens[1][0], outputToken = candidate.tokens[0][0];
      return [{ ...base, hash: `0x${String(seed).repeat(32)}`, kind: 'async-quote', action: 'Quote', inputToken, outputToken, movements: [] },
        { ...base, hash: `0x${String(seed + 1).repeat(32)}`, kind: 'async-funding', action: 'Funding', movements: [{ token: inputToken, paid, received: 0n }] },
        { ...base, hash: `0x${String(seed + 2).repeat(32)}`, kind: 'async-delivery', action: 'Delivery', movements: [{ token: inputToken, paid: 0n, received: refund }, { token: outputToken, paid: 0n, received: output }] }];
    };
    const rows = [...make(candidate.core, 11, 100n, 10n, 70n), ...make(`0x${'aa'.repeat(20)}`, 22, 200n, 20n, 150n)];
    const entries = buildCurrentDexActivityEntries(rows);
    expect(entries).toHaveLength(2);
    expect(entries.find(row => row.key === rows[2].hash)).toMatchObject({ core: candidate.core,
      transactions: [rows[0], rows[1], rows[2]], movements: [{ paid: 90n, received: 10n }, { received: 70n }] });
    expect(entries.find(row => row.key === rows[5].hash)).toMatchObject({ core: `0x${'aa'.repeat(20)}`,
      transactions: [rows[3], rows[4], rows[5]], movements: [{ paid: 180n, received: 20n }, { received: 150n }] });
  });
  it('uses current public status for unresolved swaps but keeps private terminal evidence authoritative',()=>{
    const inputToken=candidate.tokens[0][0],outputToken=candidate.tokens[1][0],base={core:candidate.core,blockNumber:100,blockHash:hash,timestamp:1000n,operationId:7n,amountsState:'none',readyToSign:false,nativeAdmission:false} as const;
    const quote={...base,hash,kind:'async-quote',action:'Quote',status:'Quote submitted',currentStatus:'Confirmed; private result pending',inputToken,outputToken,movements:[]} as CurrentDexActivityRow;
    const funding:CurrentDexActivityRow={...base,hash:`0x${'44'.repeat(32)}`,kind:'async-funding',action:'Funding',status:'Funded; awaiting delivery',movements:[{token:inputToken,paid:100n,received:0n}],amountsState:'verified'};
    expect(buildCurrentDexActivityEntries([quote,funding])[0].status).toBe('Confirmed; private result pending');
    const terminal:CurrentDexActivityRow={...base,hash:`0x${'55'.repeat(32)}`,kind:'async-delivery',action:'Delivery',status:'Confirmed',movements:[{token:inputToken,paid:0n,received:10n},{token:outputToken,paid:0n,received:70n}],amountsState:'verified'};
    expect(buildCurrentDexActivityEntries([quote,funding,terminal])[0]).toMatchObject({status:'Partially filled',movements:[{paid:90n,received:10n},{received:70n}]});
  });
  it.each(['funding','refund','output','bad-recovery'] as const)('keeps missing %s history accounting unavailable',fault=>{
    const base={core:candidate.core,hash,blockNumber:100,blockHash:hash,timestamp:1000n,operationId:53n,status:'Confirmed',movements:[],amountsState:'none',readyToSign:false,nativeAdmission:false} as const;
    const quote:CurrentDexActivityRow={...base,kind:'async-quote',action:'Quote',inputToken:candidate.tokens[1][0],outputToken:candidate.tokens[0][0]};
    const funding:CurrentDexActivityRow={...base,hash:`0x${'44'.repeat(32)}`,kind:'async-funding',action:'Funding',movements:[{token:quote.inputToken!,paid:100n,received:0n}],amountsState:'verified'};
    let terminal:CurrentDexActivityRow={...base,hash:`0x${'55'.repeat(32)}`,kind:fault==='bad-recovery'?'recover':'async-delivery',action:'Terminal',
      movements:[{token:quote.inputToken!,paid:0n,received:fault==='output'?100n:50n},{token:quote.outputToken!,paid:0n,received:50n}],amountsState:'verified'};
    if(fault==='refund')terminal={...terminal,movements:terminal.movements.slice(1)};if(fault==='output')terminal={...terminal,movements:terminal.movements.slice(0,1)};
    const rows=[quote,...(fault==='funding'?[]:[funding]),terminal];
    expect(buildCurrentDexActivityEntries(rows)[0]).toMatchObject({status:'Amounts unavailable',movements:[],amountsState:'none'});
  });
});
