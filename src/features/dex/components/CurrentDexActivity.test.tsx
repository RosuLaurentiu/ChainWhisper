import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type EffectCallback, type MutableRefObject, type ReactElement } from 'react';
import CurrentDexActivity from './CurrentDexActivity';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY } from '../../../lib/currentDexPendingAttempt';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as candidate } from '../../../lib/dexV2Deployment';
import type { CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import { readCurrentDexActivityDiscoveryPage } from '../../../lib/currentDexActivityDiscovery';
import type { CurrentDexActivityRow } from '../../../lib/currentDexActivityReceipt';
import { SUCCESSOR_TESTNET_PAIRS } from '../../../app/components/TradingProductSwitch';

const hooks = vi.hoisted(() => ({ index: 0, refIndex: 0, states: [] as unknown[], refs: [] as MutableRefObject<unknown>[],
  effect: null as EffectCallback | null, effects: [] as EffectCallback[], read: vi.fn() }));
vi.mock('../../../lib/currentDexActivity', async original => ({ ...await original<typeof import('../../../lib/currentDexActivity')>(),readCurrentDexActivityPage: hooks.read }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.states)) hooks.states[i] = initial;
    return [hooks.states[i], (value: unknown) => { hooks.states[i] = typeof value === 'function' ? value(hooks.states[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); },
  useEffect: (effect: EffectCallback) => { hooks.effect = effect; hooks.effects.push(effect); }
}));
const owner = `0x${'22'.repeat(20)}`, hash = `0x${'33'.repeat(32)}`;
function fixture() {
  const values = new Map<string, string>();
  vi.stubGlobal('window', { innerHeight: 800, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: vi.fn(), removeItem: vi.fn() } });
  const session = { walletAddress: owner, chainId: Number(candidate.chainId), browserProvider: {}, browserWalletId: 'metamask', activeSignerSource: 'browser',
    sessionOnboardInfo: { [owner]: { aesKey: 'local-fixture-only' } }, walletAesHealthByAddress: {}, actions: {} } as unknown as SharedWalletSession;
  const props = { sharedWalletSession: session, candidateKey: 'cheap-history' as CurrentCheapDexCandidateKey, visible: true, priceDisplayInverted: false, onInspect: vi.fn() };
  const result = {head:{number:100n,hash},nextCursor:{transactions:null as number|null,nfts:null as number|null},complete:true,unavailable:[] as string[],
    rows:[{core:candidate.core,operationId:53n,hash,blockNumber:100,blockHash:hash,timestamp:1000n,action:'Swap delivery',kind:'async-delivery',status:'Delivered',amountsState:'verified',readyToSign:false,nativeAdmission:false,
      movements:[{token:candidate.tokens[1][0],paid:1_000_000n,received:0n},{token:candidate.tokens[0][0],paid:0n,received:1_355_299n}]}] as CurrentDexActivityRow[]};
  hooks.read.mockResolvedValue(result);
  const tree = () => { hooks.index = 0; hooks.refIndex = 0; hooks.effects = []; return CurrentDexActivity(props); };
  const render = () => renderToStaticMarkup(tree());
  const load = async () => { render(); const cleanup = hooks.effect!(); await vi.waitFor(() => expect(hooks.states[1]).toMatchObject({ state: 'ready' })); return cleanup; };
  return { props, session, values, result, tree, render, load };
}
afterEach(() => { hooks.states = []; hooks.refs = []; hooks.effect = null; vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('gives the unlock action in the locked history instead of a pointer to the header', () => {
  const f = fixture(); f.session.sessionOnboardInfo = {};
  (f.session.actions as unknown as Record<string, unknown>).unlockPrivacy = vi.fn(async () => undefined);
  const html = f.render();
  expect(html).toContain('privacy-locked-notice'); expect(html).toContain('Your trade results are locked.');
  expect(html).toContain('>Unlock privacy</button>'); expect(html).not.toContain('in the header');
});

function completedSwapRows(pair: readonly [string, string], inputIndex: 0 | 1, refund = 0n, fast = false): CurrentDexActivityRow[] {
  const inputToken = candidate.tokenMetadata.find(token => token.symbol === pair[inputIndex])!.address;
  const outputToken = candidate.tokenMetadata.find(token => token.symbol === pair[1 - inputIndex])!.address;
  const base = { core: candidate.core, operationId: 53n, blockNumber: 100, blockHash: hash, timestamp: 1000n,
    status: 'Confirmed', amountsState: 'verified', readyToSign: false, nativeAdmission: false } as const;
  const quote: CurrentDexActivityRow = { ...base, hash, kind: fast ? 'fast-quote' : 'async-quote', action: 'Quote',
    inputToken, outputToken, movements: [], amountsState: 'none' };
  const funding: CurrentDexActivityRow = { ...base, hash: `0x${'44'.repeat(32)}`, kind: 'async-funding', action: 'Funding',
    movements: [{ token: inputToken, paid: 1_000_000n, received: 0n }] };
  const delivery: CurrentDexActivityRow = { ...base, hash: `0x${'55'.repeat(32)}`, kind: fast ? 'fast-delivery' : 'async-delivery', action: 'Delivery',
    movements: [{ token: inputToken, paid: fast ? 1_000_000n : 0n, received: refund }, { token: outputToken, paid: 0n, received: 2_000_000n }] };
  return fast ? [quote, delivery] : [quote, funding, delivery];
}

describe('read-only private Activity view', () => {
  it('places the existing Manage navigation inside My trades', () => {
    const f=fixture();
    const html=renderToStaticMarkup(<CurrentDexActivity {...f.props} managementNavigation={<nav aria-label="Manage views">Orders Positions History</nav>}/>);
    expect(html).toContain('My trades');
    expect(html.indexOf('My trades')).toBeLessThan(html.indexOf('aria-label="Manage views"'));
    expect(hooks.read).not.toHaveBeenCalled();
  });
  it('shows the average execution price from authenticated terminal amounts', async () => {
    const f = fixture(); f.result.rows = completedSwapRows(['BCN', 'HBR'], 0); await f.load();
    expect(candidate.pairs.find(pair => pair.tokens.some(token => token === candidate.tokens[0][0]) && pair.tokens.some(token => token === candidate.tokens[1][0]))!.tokens)
      .toEqual([candidate.tokens[1][0], candidate.tokens[0][0]]);
    expect(f.render()).toContain('<dt>Average execution price</dt><dd>2.0 HBR/BCN (rounded down)</dd>');
    expect(hooks.read).toHaveBeenCalledOnce();
  });
  it.each(SUCCESSOR_TESTNET_PAIRS.flatMap(pair => ([0, 1] as const).flatMap(inputIndex => [false, true].map(inverted => ({ pair, inputIndex, inverted })))))(
    'keeps History units for $pair with input $inputIndex and inverted $inverted', async ({ pair, inputIndex, inverted }) => {
      const f = fixture(); f.result.rows = completedSwapRows(pair, inputIndex); f.props.priceDisplayInverted = inverted; await f.load();
      const baseIndex = inverted ? 1 : 0, rate = inputIndex === baseIndex ? '2.0' : '0.5';
      const html = f.render();
      expect(html).toContain(`<dt>Average execution price</dt><dd>${rate} ${pair[1 - baseIndex]}/${pair[baseIndex]} (rounded down)</dd>`);
      expect(html.match(/<dt>Average execution price<\/dt>/g)).toHaveLength(1);
      f.props.priceDisplayInverted = !inverted;
      expect(f.render()).toContain(`${rate === '2.0' ? '0.5' : '2.0'} ${pair[baseIndex]}/${pair[1 - baseIndex]} (rounded down)`);
      expect(hooks.read).toHaveBeenCalledOnce();
    });
  it.each([false, true])('excludes the exact input refund for a Fast=%s completed swap', async fast => {
    const f = fixture(); f.result.rows = completedSwapRows(['BCN', 'HBR'], 0, 250_000n, fast); await f.load();
    const html = f.render();
    expect(html).toContain('Partially filled'); expect(html).toContain('0.75 BCN'); expect(html).toContain('0.25 BCN');
    expect(html).toContain('<dt>Average execution price</dt><dd>2.66666666 HBR/BCN (rounded down)</dd>');
    f.props.priceDisplayInverted = true;
    expect(f.render()).toContain('0.375 BCN/HBR (rounded down)'); expect(hooks.read).toHaveBeenCalledOnce();
  });
  it.each(['quote-only', 'pending', 'failed', 'unavailable', 'no-fill', 'recovered', 'duplicate-output', 'unverified', 'wrong-core', 'ungrouped'] as const)(
    'does not invent an execution price for %s history', async fault => {
      const f = fixture(), rows = completedSwapRows(['BCN', 'HBR'], 0);
      if (fault === 'quote-only') rows.splice(1);
      if (fault === 'pending') rows.splice(2);
      if (fault === 'failed') rows[2] = { ...rows[2], status: 'Failed' };
      if (fault === 'unavailable') rows[2] = { ...rows[2], movements: rows[2].movements.slice(1) };
      if (fault === 'no-fill') rows[2] = { ...rows[2], movements: [{ ...rows[2].movements[0], received: 1_000_000n }, { ...rows[2].movements[1], received: 0n }] };
      if (fault === 'recovered') rows[2] = { ...rows[2], kind: 'recover', movements: [{ ...rows[2].movements[0], received: 1_000_000n }] };
      if (fault === 'duplicate-output') rows[2] = { ...rows[2], movements: [...rows[2].movements, rows[2].movements[1]] };
      if (fault === 'unverified') rows[2] = { ...rows[2], amountsState: 'none' };
      if (fault === 'wrong-core') for (let i = 0; i < rows.length; i++) rows[i] = { ...rows[i], core: `0x${'ab'.repeat(20)}` };
      if (fault === 'ungrouped') rows.splice(0, 2);
      f.result.rows = rows; await f.load(); expect(f.render()).not.toContain('Average execution price'); expect(hooks.read).toHaveBeenCalledOnce();
    });
  it.each(['lock', 'onboard', 'health'] as const)('hides the executed price immediately after privacy %s', async change => {
    const f = fixture(); f.result.rows = completedSwapRows(['BCN', 'HBR'], 0); await f.load();
    expect(f.render()).toContain('2.0 HBR/BCN (rounded down)');
    if (change === 'lock') f.session.sessionOnboardInfo = {};
    if (change === 'onboard') f.session.sessionOnboardInfo = { ...f.session.sessionOnboardInfo };
    if (change === 'health') f.session.walletAesHealthByAddress = { ...f.session.walletAesHealthByAddress };
    expect(f.render()).not.toContain('Average execution price'); expect(hooks.read).toHaveBeenCalledOnce();
  });
  it('keeps checked rows stale after an older source failure and explicitly retries the same cursor once', async () => {
    const f = fixture(); f.result.complete = false; f.result.nextCursor.transactions = 2; await f.load();
    const click = (label: string) => {
      const button = f.tree().props.children.find((child: unknown) =>
        isValidElement<{ children?: string }>(child) && child.props.children === label) as ReactElement<{ onClick: () => void }>;
      button.props.onClick();
    };
    hooks.read.mockImplementationOnce(async () => readCurrentDexActivityDiscoveryPage({ owner, candidate: 'cheap-history',
      headNumber: 100n, cursor: { transactions: 2, nfts: null }, assertCurrent: () => {},
      fetcher: vi.fn().mockResolvedValue({ ok: false, status: 503 }) }));
    click('Load older activity'); f.render(); hooks.effect!();
    await vi.waitFor(() => expect(hooks.states[1]).not.toMatchObject({ state: 'loading' }));
    const failed = f.render();
    expect(failed).toContain('1.355299 BCN'); expect(failed).toContain('History is stale and incomplete');
    expect(failed).toContain('Retry older activity'); expect(failed).toContain('Last checked');
    hooks.refs[3].current = { getBoundingClientRect: () => ({ top: 500, bottom: 530 }) };
    hooks.effects[0]();
    const listeners = vi.mocked(window.addEventListener).mock.calls;
    for (const [, listener] of listeners) (listener as () => void)();
    expect(hooks.states[2]).toBe(1); expect(hooks.read).toHaveBeenCalledTimes(2);
    f.props.visible = false; f.render(); hooks.effect!();
    f.props.visible = true; f.render(); hooks.effect!();
    expect(hooks.read).toHaveBeenCalledTimes(2); expect(f.render()).toContain('stale and incomplete');
    const old = { ...f.result.rows[0], hash: `0x${'44'.repeat(32)}`, blockNumber: 90, action: 'Token claim' };
    hooks.read.mockResolvedValueOnce({ ...f.result, rows: [f.result.rows[0], old], complete: true,
      nextCursor: { transactions: null, nfts: null } });
    click('Retry older activity'); click('Retry older activity'); expect(hooks.states[2]).toBe(2);
    await f.load();
    expect(hooks.read.mock.calls[2][3]).toMatchObject({ cursor: { transactions: 2, nfts: null }, head: f.result.head });
    const recovered = f.render();
    expect(recovered.match(/Swap delivery/g)).toHaveLength(1); expect(recovered.match(/Token claim/g)).toHaveLength(1);
    expect(recovered).not.toContain('stale and incomplete'); expect(recovered).not.toContain('Retry older activity');
    expect(hooks.read).toHaveBeenCalledTimes(3);
  });
  it('exposes only the current Activity phase and retains the failing phase without extra reads', async () => {
    const f = fixture();
    hooks.read.mockImplementationOnce(async (_session, _key, _guard, options) => {
      options.onProgress(0, 0, 'discovery');
      expect(f.render()).toContain('data-dex-activity-phase="discovery"');
      options.onProgress(0, 0, 'fills');
      throw new Error('RPC stopped');
    });
    f.render(); hooks.effect!();
    await vi.waitFor(() => expect(hooks.states[1]).toMatchObject({ state: 'error' }));
    expect(f.render()).toContain('data-dex-activity-phase="fills"');
    expect(hooks.read).toHaveBeenCalledTimes(1);
    f.session.sessionOnboardInfo = {};
    expect(f.render()).not.toContain('data-dex-activity-phase');
  });
  it.each(['successful page', 'failed page', 'privacy replacement'] as const)('can load older again after %s and a fresh first page', async reason => {
    const f = fixture(); f.result.complete = false; f.result.nextCursor.transactions = 2; await f.load();
    const clickOlder = () => {
      const button = f.tree().props.children.find((child: unknown) =>
        isValidElement<{ children?: string }>(child) && child.props.children === 'Load older activity') as ReactElement<{ onClick: () => void }>;
      button.props.onClick();
    };
    clickOlder(); expect(hooks.states[2]).toBe(1);
    if (reason === 'failed page') {
      hooks.read.mockRejectedValueOnce(new Error('History chain head changed. Refresh history.'));
      f.render(); hooks.effect!();
      await vi.waitFor(() => expect(hooks.states[1]).toMatchObject({ state: 'error', older: 1 }));
      expect(f.render()).not.toContain('Load older activity</button>');
    } else {
      hooks.read.mockResolvedValueOnce({ ...f.result, nextCursor: { transactions: 3, nfts: null } }); await f.load();
    }
    if (reason === 'privacy replacement') f.session.sessionOnboardInfo = { ...f.session.sessionOnboardInfo };
    else f.tree().props.children[0].props.children[1].props.onClick();
    expect(hooks.states[2]).toBe(1);
    await f.load();
    expect(hooks.read.mock.calls[2][3]).toMatchObject({ cursor: { transactions: 1, nfts: 1 }, head: undefined });
    clickOlder(); expect(hooks.states[2]).toBe(2);
    await f.load();
    expect(hooks.read).toHaveBeenCalledTimes(4);
    expect(hooks.read.mock.calls[3][3]).toMatchObject({ cursor: { transactions: 2, nfts: null }, head: f.result.head });
  });
  it('keeps a normal button to load older history without scrolling', async () => {
    const f = fixture(); f.result.complete = false; f.result.nextCursor.transactions = 2; await f.load();
    const button = f.tree().props.children.find((child: unknown) =>
      isValidElement<{ children?: string }>(child) && child.props.children === 'Load older activity') as
      ReactElement<{ type: string; disabled: boolean; onClick: () => void }>;
    expect(button.type).toBe('button'); expect(button.props.type).toBe('button'); expect(button.props.disabled).toBe(false);
    button.props.onClick(); button.props.onClick(); expect(hooks.states[2]).toBe(1);
    hooks.read.mockResolvedValueOnce({ ...f.result, complete: true }); await f.load();
    expect(hooks.read).toHaveBeenCalledTimes(2); expect(f.render()).not.toContain('Load older activity</button>');
  });
  it('loads one older page per scroll near the button without draining on mount or overlapping reads', async () => {
    const f = fixture(); f.result.complete = false; f.result.nextCursor.transactions = 2;
    await f.load(); f.render();
    let top = 1200;
    hooks.refs[3].current = { getBoundingClientRect: () => ({ top, bottom: top + 30 }) };
    const cleanup = hooks.effects[0]();
    const scroll = vi.mocked(window.addEventListener).mock.calls[0][1] as () => void;
    expect(hooks.states[2]).toBe(0); expect(hooks.read).toHaveBeenCalledTimes(1);
    scroll(); expect(hooks.states[2]).toBe(0);
    top = 820; scroll(); scroll(); expect(hooks.states[2]).toBe(1);
    let finish!: (page: typeof f.result) => void;
    hooks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.render(); hooks.effect!(); f.render(); scroll();
    expect(hooks.states[2]).toBe(1); expect(hooks.read).toHaveBeenCalledTimes(2);
    finish({ ...f.result, complete: true, nextCursor: { transactions: null, nfts: null } });
    await vi.waitFor(() => expect(hooks.states[1]).toMatchObject({ state: 'ready' }));
    f.render(); scroll(); expect(hooks.states[2]).toBe(1);
    expect(hooks.read.mock.calls[1][3]).toMatchObject({ head: f.result.head, cursor: { transactions: 2, nfts: null } });
    if (typeof cleanup === 'function') cleanup();
    expect(window.removeEventListener).toHaveBeenCalledWith('scroll', scroll, true);
  });
  it.each(['error', 'hidden', 'privacy'] as const)('does not request older private history on scroll after %s', async reason => {
    const f = fixture(); f.result.complete = false; f.result.nextCursor.transactions = 2;
    await f.load(); f.render();
    hooks.refs[3].current = { getBoundingClientRect: () => ({ top: 500, bottom: 530 }) };
    hooks.effects[0]();
    const scroll = vi.mocked(window.addEventListener).mock.calls[0][1] as () => void;
    if (reason === 'error') hooks.states[1] = { ...(hooks.states[1] as object), state: 'error' };
    if (reason === 'hidden') f.props.visible = false;
    if (reason === 'privacy') f.session.sessionOnboardInfo = {};
    f.render(); hooks.effects[0]();
    const listeners = vi.mocked(window.addEventListener).mock.calls;
    const latest = listeners[listeners.length - 1][1] as () => void;
    scroll(); latest(); expect(hooks.states[2]).toBe(0); expect(hooks.read).toHaveBeenCalledTimes(1);
  });
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
  it('keeps locked current-candidate fill history distinct from unsupported history',()=>{
    const f=fixture();f.session.sessionOnboardInfo={};const html=f.render();
    expect(html).toContain('Unlock privacy');
    expect(html).toContain('Private Limit fills require a verified History read');
    expect(html).not.toContain('Individual Limit fills are not recorded');
    hooks.effect!();expect(hooks.read).not.toHaveBeenCalled();
  });
  it.each(['Quote ready','Expired; recovery required','Confirmed; private result pending'])('renders %s without inventing terminal amounts',async currentStatus=>{
    const f=fixture();Object.assign(f.result.rows[0],{core:candidate.core,kind:'async-quote',action:'Quote',status:'Quote submitted',currentStatus,
      inputToken:candidate.tokens[1][0],outputToken:candidate.tokens[0][0],movements:[],amountsState:'none'});
    await f.load();const html=f.render();expect(html).toContain(currentStatus);expect(html).toContain('Snapshot block 100');
    expect(html).toContain('not a completed trade');expect(html).not.toContain('1.355299 BCN');expect(html).not.toContain('0.0 HBR');
  });
  it('reads and paginates history only for the selected current candidate', async () => {
    const f = fixture();
    const claim = { ...f.result.rows[0], core: candidate.core, kind: 'action', action: 'Token claim' };
    const selected = { ...f.result, rows: [claim], complete: false, nextCursor: { transactions: 2, nfts: null }, fills: [] };
    hooks.read.mockResolvedValue(selected);
    await f.load();
    expect(hooks.read.mock.calls.map(call => call[1])).toEqual(['cheap-history']);
    expect(f.render()).toContain('Token claim'); expect(f.render()).toContain('Load older activity');
    hooks.read.mockResolvedValue({ ...selected, complete: true, rows: [], nextCursor: { transactions: null, nfts: null } });
    hooks.states[2] = 1; await f.load();
    expect(hooks.read.mock.calls[1][3]).toMatchObject({ head: selected.head, cursor: selected.nextCursor });
    expect(f.render()).not.toContain('>Load older activity</button>');
    expect(f.values.size).toBe(0);
  });
  it('shows current-candidate history errors without a previous-deployment fallback', async () => {
    const f = fixture();
    hooks.read.mockRejectedValue(new Error('missing trie node; payload=private-rpc-detail'));
    f.render(); hooks.effect!();
    await vi.waitFor(() => expect(hooks.states[1]).toMatchObject({ state: 'error' }));
    const html = f.render();
    expect(hooks.read).toHaveBeenCalledTimes(1); expect(hooks.read.mock.calls[0][1]).toBe('cheap-history');
    expect(html).toContain('requested state'); expect(html).not.toContain('previous deployment');
    expect(html).not.toContain('private-rpc-detail'); expect(html).not.toContain('1.355299 BCN');
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
    if (reason === 'candidate') f.props.candidateKey = 'cheap-prepared';
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
  it.each(['History chain head changed. Refresh history.', 'History owner privacy changed.', 'Current-mode graph changed.',
    'Unexpected history failure', 'History RPC chain changed.'])('removes earlier private rows after page validation fails: %s', async message => {
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
