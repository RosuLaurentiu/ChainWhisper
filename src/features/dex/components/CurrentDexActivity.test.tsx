import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EffectCallback, MutableRefObject } from 'react';
import CurrentDexActivity from './CurrentDexActivity';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE as candidate } from '../../../lib/currentDexExitCandidate';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY } from '../../../lib/currentDexPendingAttempt';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as historyCandidate } from '../../../lib/dexV2Deployment';

const hooks = vi.hoisted(() => ({ index: 0, refIndex: 0, states: [] as unknown[], refs: [] as MutableRefObject<unknown>[],
  effect: null as EffectCallback | null, read: vi.fn() }));
vi.mock('../../../lib/currentDexActivity', async original => ({ ...await original<typeof import('../../../lib/currentDexActivity')>(),readCurrentDexActivityPage: hooks.read }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.states)) hooks.states[i] = initial;
    return [hooks.states[i], (value: unknown) => { hooks.states[i] = typeof value === 'function' ? value(hooks.states[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); },
  useEffect: (effect: EffectCallback) => { hooks.effect = effect; }
}));
const owner = `0x${'22'.repeat(20)}`, hash = `0x${'33'.repeat(32)}`;
function fixture() {
  const values = new Map<string, string>();
  vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: vi.fn(), removeItem: vi.fn() } });
  const session = { walletAddress: owner, chainId: Number(candidate.chainId), browserProvider: {}, browserWalletId: 'metamask', activeSignerSource: 'browser',
    sessionOnboardInfo: { [owner]: { aesKey: 'local-fixture-only' } }, walletAesHealthByAddress: {}, actions: {} } as unknown as SharedWalletSession;
  const props = { sharedWalletSession: session, candidateKey: 'cheap-exit' as const, visible: true, onInspect: vi.fn() };
  const result = {head:{number:100n,hash},nextCursor:{transactions:null as number|null,nfts:null as number|null},complete:true,unavailable:[] as string[],
    rows:[{operationId:53n,hash,blockNumber:100,blockHash:hash,timestamp:1000n,action:'Swap delivery',kind:'async-delivery',status:'Delivered',amountsState:'verified',
      movements:[{token:candidate.tokens[1][0],paid:1_000_000n,received:0n},{token:candidate.tokens[0][0],paid:0n,received:1_355_299n}]}]};
  hooks.read.mockResolvedValue(result);
  const render = () => { hooks.index = 0; hooks.refIndex = 0; return renderToStaticMarkup(CurrentDexActivity(props)); };
  const load = async () => { render(); const cleanup = hooks.effect!(); await vi.waitFor(() => expect(hooks.states[1]).toMatchObject({ state: 'ready' })); return cleanup; };
  return { props, session, values, result, render, load };
}
afterEach(() => { hooks.states = []; hooks.refs = []; hooks.effect = null; vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('read-only private Activity view', () => {
  it('keeps zero movements and transaction evidence in details without cluttering the row summary', async () => {
    const f = fixture(); await f.load(); const html=f.render();
    const summary=html.match(/class="dex-history-row"[\s\S]*?<summary>([\s\S]*?)<\/summary>/)?.[1];
    expect(summary).toContain('1.355299 BCN'); expect(summary).not.toContain('0.0 HBR'); expect(summary).not.toContain('0.0 BCN');
    expect(html).toContain('0.0 HBR'); expect(html).toContain('View transaction');
    hooks.states[3]='Liquidity'; expect(f.render()).toContain('No liquidity in this page of history');
    expect(hooks.read).toHaveBeenCalledTimes(1);
  });
  it('keeps checked history on tab return without another chain read, but explicit refresh reads again', async () => {
    const f = fixture(); const cleanup = await f.load();
    if (typeof cleanup === 'function') cleanup();
    f.props.visible = false; f.render(); hooks.effect!();
    expect(f.render()).not.toContain('1.355299 BCN');
    f.props.visible = true; f.render(); hooks.effect!();
    await Promise.resolve(); await Promise.resolve();
    expect(hooks.read).toHaveBeenCalledTimes(1);
    expect(f.render()).toContain('1.355299 BCN');
    hooks.states[0] = 1; await f.load();
    expect(hooks.read).toHaveBeenCalledTimes(2);
  });
  it('does not reuse checked history after a privacy session change while hidden', async () => {
    const f = fixture(); const cleanup = await f.load();
    if (typeof cleanup === 'function') cleanup();
    f.props.visible = false; f.session.sessionOnboardInfo = {}; f.render(); hooks.effect!();
    f.props.visible = true; expect(f.render()).not.toContain('1.355299 BCN');
    hooks.effect!(); expect(hooks.read).toHaveBeenCalledTimes(1);
  });
  it('refreshes an older page on tab return while keeping checked rows visible during the read', async () => {
    const f = fixture(); const cleanup = await f.load();
    if (typeof cleanup === 'function') cleanup();
    const ready=hooks.states[1] as { checkedAt: number }; ready.checkedAt=Date.now()-31_000;
    f.props.visible=false; f.render(); hooks.effect!();
    let finish!: (value:typeof f.result)=>void;
    hooks.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    f.props.visible=true; f.render(); hooks.effect!();
    expect(hooks.read).toHaveBeenCalledTimes(2); expect(f.render()).toContain('1.355299 BCN');
    finish(f.result); await vi.waitFor(()=>expect(hooks.states[1]).toMatchObject({state:'ready'}));
  });
  it.each(['cheap-history','cheap-exit'] as const)('keeps locked %s fill history distinct from unsupported history',key=>{
    const f=fixture();f.props.candidateKey=key as 'cheap-exit';f.session.sessionOnboardInfo={};const html=f.render();
    expect(html).toContain('Unlock privacy');
    if(key==='cheap-history'){expect(html).toContain('Private Limit fills require a verified History read');expect(html).not.toContain('Individual Limit fills are not recorded');}
    else expect(html).toContain('Individual Limit fills are not recorded');
    hooks.effect!();expect(hooks.read).not.toHaveBeenCalled();
  });
  it.each(['Quote ready','Expired; recovery required','Confirmed; private result pending'])('renders %s without inventing terminal amounts',async currentStatus=>{
    const f=fixture();Object.assign(f.result.rows[0],{core:candidate.core,kind:'async-quote',action:'Quote',status:'Quote submitted',currentStatus,
      inputToken:candidate.tokens[1][0],outputToken:candidate.tokens[0][0],movements:[],amountsState:'none'});
    await f.load();const html=f.render();expect(html).toContain(currentStatus);expect(html).toContain('Snapshot block 100');
    expect(html).toContain('not a completed trade');expect(html).not.toContain('1.355299 BCN');expect(html).not.toContain('0.0 HBR');
  });
  it('composes both deployments at one head with separate pagination and deduplicated token claims', async () => {
    const f = fixture(); f.props.candidateKey = 'cheap-history' as 'cheap-exit';
    const claim = { ...f.result.rows[0], core: historyCandidate.core, kind: 'action', action: 'Token claim' };
    const selected = { ...f.result, rows: [claim], complete: false, nextCursor: { transactions: 2, nfts: null }, fills: [] };
    const legacy = { ...f.result, rows: [{ ...claim, core: candidate.core }], complete: false, nextCursor: { transactions: 4, nfts: 3 }, fills: [] };
    hooks.read.mockImplementation(async (_session, key) => key === 'cheap-history' ? selected : legacy);
    await f.load();
    expect(hooks.read.mock.calls.map(call => call[1])).toEqual(['cheap-history', 'cheap-exit']);
    expect(hooks.read.mock.calls[1][3]).toMatchObject({ head: selected.head, cursor: { transactions: 1, nfts: 1 } });
    expect(f.render().match(/Token claim/g)).toHaveLength(1);
    hooks.read.mockImplementation(async (_session, key) => ({ ...(key === 'cheap-history' ? selected : legacy),
      complete: true, rows: [], nextCursor: { transactions: null, nfts: null } }));
    hooks.states[2] = 1; await f.load();
    expect(hooks.read.mock.calls[2][3]).toMatchObject({ head: selected.head, cursor: selected.nextCursor });
    expect(hooks.read.mock.calls[3][3]).toMatchObject({ head: selected.head, cursor: legacy.nextCursor });
    expect(f.render()).not.toContain('>Load older activity</button>');
    expect(f.values.size).toBe(0);
  });
  it('keeps equal operation IDs in the two Cores separate', async () => {
    const f = fixture(); f.props.candidateKey = 'cheap-history' as 'cheap-exit';
    const rows = (core: string, seed: string) => [
      { ...f.result.rows[0], core, hash: `0x${seed.repeat(64)}`, kind: 'async-quote', action: 'Quote', movements: [],
        inputToken: candidate.tokens[1][0], outputToken: candidate.tokens[0][0] },
      { ...f.result.rows[0], core, hash: `0x${(seed === 'a' ? 'b' : 'd').repeat(64)}`, kind: 'cancel', action: 'Cancel', movements: [] }
    ];
    hooks.read.mockImplementation(async (_session, key) => ({ ...f.result,
      rows: rows(key === 'cheap-history' ? historyCandidate.core : candidate.core, key === 'cheap-history' ? 'a' : 'c') }));
    await f.load(); expect(f.render().match(/Operation 53/g)).toHaveLength(2);
  });
  it.each(['cheap-exit', 'cheap-history'])('preserves the successful deployment when %s is unavailable', async failedKey => {
    const f = fixture(); f.props.candidateKey = 'cheap-history' as 'cheap-exit';
    hooks.read.mockImplementation(async (_session, key) => {
      if (key === failedKey) throw new Error('missing trie node; payload=private-rpc-detail');
      return f.result;
    });
    await f.load(); const html = f.render();
    expect(html).toContain('1.355299 BCN'); expect(html).toContain('History is incomplete');
    expect(html).not.toContain('No recorded DEX activity'); expect(html).not.toContain('private-rpc-detail');
    expect(html).toContain('Load older activity');
  });
  it('rejects a second deployment page from a different head without showing it', async () => {
    const f = fixture(); f.props.candidateKey = 'cheap-history' as 'cheap-exit';
    hooks.read.mockResolvedValueOnce(f.result).mockResolvedValueOnce({ ...f.result,
      head: { number: 101n, hash: `0x${'44'.repeat(32)}` }, rows: [{ ...f.result.rows[0], action: 'Wrong head row' }] });
    await f.load(); const html = f.render();
    expect(html).toContain('History is incomplete'); expect(html).toContain('chain head changed');
    expect(html).toContain('1.355299 BCN'); expect(html).not.toContain('Wrong head row');
  });
  it('shows order custody executions separately from wallet receipts and hides them on privacy change', async () => {
    const f = fixture();
    Object.assign(f.result, { limitFillsState: 'available', fills: [{ engine: candidate.pairs[0].engine, record: 2n, positionId: 7n,
      blockNumber: 95n, blockHash: hash, timestamp: 995n, soldToken: candidate.tokens[1][0], receivedToken: candidate.tokens[0][0],
      sold: 5_000_000n, received: 10_000_000n, readyToSign: false, nativeAdmission: false }] });
    await f.load(); const html = f.render();
    expect(html).toContain('Limit execution'); expect(html).toContain('Sold from order'); expect(html).toContain('Added to proceeds');
    expect(html).toContain('5.0 HBR'); expect(html).toContain('10.0 BCN'); expect(html).toContain('Executed');
    expect(html.match(/\/tx\//g)).toHaveLength(1);
    f.session.sessionOnboardInfo = {}; expect(f.render()).not.toContain('10.0 BCN');
  });
  it('shows verified amounts with token decimals and explains its retrieval limit', async () => {
    const f = fixture(); await f.load(); const html = f.render();
    expect(html).toContain('Delivered'); expect(html).toContain('1.0 HBR'); expect(html).toContain('1.355299 BCN');
    expect(html).toContain('0.0 HBR'); expect(html).toContain('Operation'); expect(html).toContain('on another device');
    expect(html).not.toContain('Private trade history is not connected');
    expect(html).toContain('canonical owner token receipts'); expect(html).toContain('Original Quote-rate reconstruction is unavailable');
    expect(html).not.toContain('Latest saved async operation'); expect(html).toContain('dateTime=');
  });
  it.each(['wallet', 'privacy', 'candidate', 'hidden'] as const)('revokes visible amounts immediately on %s change', async reason => {
    const f = fixture(); await f.load();
    if (reason === 'wallet') f.session.walletAddress = `0x${'44'.repeat(20)}`;
    if (reason === 'privacy') f.session.sessionOnboardInfo = {};
    if (reason === 'candidate') f.props.candidateKey = 'cheap-prepared' as 'cheap-exit';
    if (reason === 'hidden') f.props.visible = false;
    expect(f.render()).not.toContain('1.355299 BCN');
  });
  it('does not start a reader while privacy is locked', () => {
    const f = fixture(); f.session.sessionOnboardInfo = {}; expect(f.render()).toContain('Unlock privacy');
    hooks.effect!(); expect(hooks.read).not.toHaveBeenCalled();
  });
  it('keeps unknown terminal amounts unavailable', async () => {
    const f = fixture(); Object.assign(f.result.rows[0], { movements: [], kind:'async-quote',status: 'Quote submitted' });
    await f.load(); const html = f.render(); expect(html).toContain('not a completed trade');
    expect(html).not.toContain('0.0 HBR'); expect(html).not.toContain('1.355299 BCN');
  });
  it('shows unavailable archive state without dumping RPC payload or inventing amounts', async () => {
    const f = fixture(); hooks.read.mockRejectedValue(new Error('could not coalesce error: missing trie node; payload=internal-rpc-details'));
    f.render(); hooks.effect!();
    await vi.waitFor(() => expect(hooks.states[1]).toMatchObject({ state: 'error' }));
    const html = f.render(); expect(html).toContain('requested state');
    expect(html).not.toContain('internal-rpc-details'); expect(html).not.toContain('1.355299 BCN');
    expect(html).not.toContain('No DEX activity');
  });
  it('loads earlier pages from chain with an empty browser session and deduplicates rows',async()=>{
    const f=fixture();f.result.complete=false;f.result.nextCursor.transactions=2;await f.load();
    expect(f.render()).toContain('Load older activity');expect(f.values.size).toBe(0);
    const old={...f.result.rows[0],hash:`0x${'44'.repeat(32)}`,blockNumber:90,action:'Token claim'};
    hooks.read.mockResolvedValue({...f.result,rows:[f.result.rows[0],old],complete:true,nextCursor:{transactions:null,nfts:null}});
    hooks.states[2]=1;await f.load();const html=f.render();
    expect(html.match(/Swap delivery/g)).toHaveLength(1);expect(html).toContain('Token claim');expect(html).not.toContain('>Load older activity</button>');
    expect(hooks.read.mock.calls[1][3]).toMatchObject({cursor:{transactions:2,nfts:null},head:f.result.head});
  });
  it.each(['History chain head changed. Refresh history.', 'History owner privacy changed.'])('removes earlier private rows after page validation fails: %s', async message => {
    const f = fixture(); f.result.complete = false; f.result.nextCursor.transactions = 2; await f.load();
    expect(f.render()).toContain('1.355299 BCN');
    hooks.read.mockRejectedValueOnce(new Error(message)); hooks.states[2] = 1;
    f.render(); hooks.effect!();
    await vi.waitFor(() => expect(hooks.states[1]).toMatchObject({ state: 'error' }));
    const failed = f.render();
    expect(failed).toContain(message); expect(failed).not.toContain('1.355299 BCN');
    expect(failed).not.toContain('>Load older activity</button>'); expect(failed).not.toContain('No DEX activity');
    hooks.states[0] = 1; hooks.read.mockResolvedValue(f.result); await f.load();
    expect(hooks.read.mock.calls[2][3]).toMatchObject({ cursor: { transactions: 1, nfts: 1 }, head: undefined });
    expect(f.render()).toContain('1.355299 BCN');
  });
  it('uses the selected candidate for pending recovery and hides another owner', () => {
    const f = fixture(); f.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify({ version: 1,
      chainId: candidate.chainId, owner, core: candidate.core.toLowerCase(), graph: `0x${candidate.graph}`,
      phase: 'accept', callHash: hash, nonce: 147, txHash: hash }));
    expect(f.render()).toContain('Action needs a status check');
    f.session.walletAddress = `0x${'44'.repeat(20)}`;
    expect(f.render()).not.toContain('Action needs a status check');
  });
  it('does not commit a late private result after scope change', async () => {
    const f = fixture(); let finish!: (value: typeof f.result) => void;
    hooks.read.mockImplementation(async (_session, _candidate, assertCurrent: () => void) => {
      const result = await new Promise<typeof f.result>(resolve => { finish = resolve; }); assertCurrent(); return result;
    });
    f.render(); hooks.effect!(); f.session.walletAddress = `0x${'44'.repeat(20)}`; f.render(); finish(f.result);
    await Promise.resolve(); await Promise.resolve();
    expect(f.render()).not.toContain('1.355299 BCN');
  });
});
