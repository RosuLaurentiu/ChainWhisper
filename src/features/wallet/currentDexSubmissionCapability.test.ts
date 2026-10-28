import { afterEach, describe, expect, it, vi } from 'vitest';
import { Interface, JsonRpcSigner, getAddress, toBeHex } from '@coti-io/coti-ethers';
import { issueCurrentDexSubmissionCapability } from './currentDexSubmissionCapability';
import { CURRENT_NATIVE_POOL_PROFILE } from '../../lib/currentDexNativePoolPolicy';
import { ARCHIVED_CHEAP_DEX_CANDIDATE, CURRENT_CHEAP_DEX_CANDIDATE, CURRENT_CHEAP_POOL_TOKENS, CURRENT_SHARED_POOL_CANDIDATE, STAGED_EXIT_PREVIEW_DEX_CANDIDATE, resolveCurrentCheapDexCandidate } from '../../lib/dexV2Deployment';
import { PRIVATE_ERC20_TOKEN_VNEXT_ABI } from '../../lib/appShared/contracts';
import { verifyCurrentDexSubmissionAdmission } from '../../lib/currentDexSubmissionAdmission';
import { currentTokenFundingAbi } from '../../lib/currentDexTokenFunding';
import * as display from '../../lib/currentDexDisplay';
import type { TradeActionConfirmModel } from '../../lib/tradeActionConfirm';
import { currentCheapDexQuoteProtocol, type CurrentCheapDexCandidateKey } from '../../lib/dexV2Deployment';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY } from '../../lib/currentDexPendingAttempt';
import * as tokenProof from '../../lib/currentDexOwnerTokenProof';
import { resolvePreparedDexScope } from '../../lib/currentDexPreparedScope';
import { CURRENT_SLIPPAGE_DEX_QUOTE_ABI, CURRENT_CHEAP_DEX_OPERATION_ABI } from '../../lib/currentDexOperation';

const mocks = vi.hoisted(() => ({ issue: vi.fn(), pool: vi.fn(), limit: vi.fn(), graph: vi.fn(), decrypt: vi.fn(), sharedFunding: vi.fn(), sharedFunds: vi.fn(), cheap: vi.fn(), receipt: vi.fn(), archived: vi.fn(), archivedRecover: vi.fn(), fillGraph: null as string | null, fillRead: vi.fn() }));
vi.mock('../../lib/currentDexLimitFillHistory', async original => {
  const actual = await original<typeof import('../../lib/currentDexLimitFillHistory')>();
  return { ...actual, get CURRENT_LIMIT_FILL_HISTORY_GRAPHS() {
    return mocks.fillGraph ? [...actual.CURRENT_LIMIT_FILL_HISTORY_GRAPHS, mocks.fillGraph] : actual.CURRENT_LIMIT_FILL_HISTORY_GRAPHS;
  }, readCurrentLimitFillHistoryPage: mocks.fillRead };
});
vi.mock('../../lib/currentDexSubmission', async original => {
  const actual = await original<typeof import('../../lib/currentDexSubmission')>();
  return { ...actual, createArchivedCheapDexRecovery: (args: Parameters<typeof actual.createArchivedCheapDexRecovery>[0]) => {
    mocks.archived(args); return mocks.archivedRecover;
  }, createCurrentCheapDexSubmissionAdapter: (args: Parameters<typeof actual.createCurrentCheapDexSubmissionAdapter>[0]) => {
    mocks.cheap(args); return actual.createCurrentCheapDexSubmissionAdapter(args);
  } };
});
vi.mock('./currentDexReceiptCapability', () => ({ issueCurrentDexReceiptCapability: mocks.receipt }));
vi.mock('../../lib/currentSharedDexTokenFunding', async original => {
  const actual = await original<typeof import('../../lib/currentSharedDexTokenFunding')>();
  return { ...actual, createCurrentSharedDexTokenFundingAdapter: (args: Parameters<typeof actual.createCurrentSharedDexTokenFundingAdapter>[0]) => {
    mocks.sharedFunding(args); return actual.createCurrentSharedDexTokenFundingAdapter(args);
  } };
});
vi.mock('../../lib/currentSharedDexTokenFunds', () => ({ readCurrentSharedDexTokenFunds: mocks.sharedFunds }));
afterEach(() => { mocks.fillGraph = null; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
vi.mock('../../lib/currentDexLimitSubmission', async original => {
  const actual = await original<typeof import('../../lib/currentDexLimitSubmission')>();
  return { ...actual, createCurrentLimitSubmissionAdapter: (args: Parameters<typeof actual.createCurrentLimitSubmissionAdapter>[0]) => {
    mocks.limit(args);
    return actual.createCurrentLimitSubmissionAdapter(args);
  } };
});
vi.mock('./ownerCotiMetaMaskCapability', () => ({ issueOwnerCotiMetaMaskCapability: mocks.issue }));
vi.mock('../../lib/currentDexPoolSubmission', async original => {
  const actual = await original<typeof import('../../lib/currentDexPoolSubmission')>();
  return { ...actual, createCurrentPoolSubmissionAdapter: (args: Parameters<typeof actual.createCurrentPoolSubmissionAdapter>[0]) => {
    mocks.pool(args);
    return actual.createCurrentPoolSubmissionAdapter(args);
  } };
});
vi.mock('../../lib/dexV2Chain', async original => ({ ...await original<typeof import('../../lib/dexV2Chain')>(),
  readCurrentSharedPoolDexGraph: mocks.graph }));
vi.mock('../../lib/privateUint256', async original => ({ ...await original<typeof import('../../lib/privateUint256')>(),
  decryptPrivateUint256Output: mocks.decrypt }));

describe('selected candidate acceptance review metadata', () => {
  const fixture = async (key: CurrentCheapDexCandidateKey, inputIndex = 0, outputIndex = 1) => {
    vi.clearAllMocks();
    const c = resolveCurrentCheapDexCandidate(key), owner = `0x${'22'.repeat(20)}`;
    const now = BigInt(Math.floor(Date.now() / 1000)), block = { number: 100n, hash: toBeHex(77n, 32), timestamp: now - 1n };
    const signer = { sendTransaction: vi.fn(), estimateGas: vi.fn(), getNonce: vi.fn() }, send = vi.fn(), getLogs = vi.fn().mockResolvedValue([]);
    const assertCurrent = vi.fn(), assertSnapshotCurrent = vi.fn();
    mocks.issue.mockImplementation(async args => args.bindCapability({ assertCurrent, assertSnapshotCurrent,
      chainId: BigInt(c.chainId), ownerAddress: owner, readProvider: { send, getLogs }, signer }));
    mocks.graph.mockResolvedValue({ graph: c.graph, packageSha256: c.packageSha256, core: c.core });
    const capability = await issueCurrentDexSubmissionCapability({ candidate: key, admission: null } as never);
    const intent = { candidate: c, chainId: BigInt(c.chainId), core: c.core, principal: owner,
      runtimeHash: c.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2], releaseId: c.releaseId,
      operationId: 7n, contextHash: toBeHex(88n, 32), deadline: now + 600n,
      inputToken: c.tokens[inputIndex][0], outputToken: c.tokens[outputIndex][0], profile: 'fast-pool',
      quoteProtocol: currentCheapDexQuoteProtocol(c), toleranceBps: currentCheapDexQuoteProtocol(c) ? 50 : undefined,
      maximumInput: 2_000_000n, minimumInput: 1n, minimumOutput: 1n, rateNumerator: 1n, rateDenominator: 1n };
    const receipt = { ...intent, block, kind: 'quote',
      operation: { profile: intent.profile, phase: 'quote-prepared', ready: true, contextHash: intent.contextHash, deadline: intent.deadline },
      amounts: { filled: true, maximumInput: intent.maximumInput, actualInput: 1_234_567n, refund: 765_433n,
        grossOutput: 2_357_891n, fee: 12_213n, netOutput: 2_345_678n } };
    const readCurrent = vi.fn().mockResolvedValue(receipt);
    mocks.receipt.mockResolvedValue({ readCurrent });
    const options = mocks.cheap.mock.calls[mocks.cheap.mock.calls.length - 1][0] as Parameters<typeof import('../../lib/currentDexSubmission').createCurrentCheapDexSubmissionAdapter>[0];
    const issued = { intent, operationId: intent.operationId, core: intent.core, runtimeHash: intent.runtimeHash,
      releaseId: intent.releaseId, originBlock: block };
    return { c, capability, options, issued, readCurrent, receipt, signer, send, getLogs, assertCurrent };
  };
  it.each([
    ['cheap-async', 1, false, 2000n, 'Preparing Quote', 'none'],
    ['cheap-async', 5, false, 2000n, 'Quote ready', 'none'],
    ['cheap-async', 5, false, 999n, 'Expired', 'none'],
    ['cheap-async', 6, false, 2000n, 'Funded; awaiting delivery', 'none'],
    ['cheap-async', 6, false, 999n, 'Expired; recovery required', 'none'],
    ['cheap-async', 7, false, 2000n, 'Confirmed; private result pending', 'none'],
    ['cheap-async', 8, false, 2000n, 'Release confirmed; amounts unavailable', 'none'],
    ['fast-pool', 0, true, 2000n, 'Quote ready', 'none'],
    ['fast-pool', 0, false, 2000n, 'Quote unavailable; settlement unverified', 'none'],
    ['fast-pool', 0, true, 999n, 'Expired', 'none'],
    ['cheap-async', 5, false, 2000n, 'Quote status unavailable', 'getter'],
    ['cheap-async', 5, false, 2000n, 'Quote ready', 'replacement'],
    ['cheap-async', 5, false, 2000n, '', 'privacy'],
    ['cheap-async', 5, false, 2000n, '', 'reorg']
  ] as const)('reads current History %s state %s at its pinned head without inventing private results', async (profile,stage,ready,deadline,status,fault) => {
    const f=await fixture('cheap-history'),owner=f.issued.intent.principal,hash=toBeHex(211n,32),blockHash=f.receipt.block.hash,abi=new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI),operations=new Interface(CURRENT_CHEAP_DEX_OPERATION_ABI),encrypted=[[0n,0n],'0x'];
    const replacementHash=toBeHex(212n,32),canonicalHash=fault==='replacement'?replacementHash:hash;
    let aesKey='11'.repeat(16);Object.assign(f.signer,{getUserOnboardInfo:()=>({aesKey})});
    vi.spyOn(f.options.transport,'readHead').mockResolvedValue({...f.receipt.block,timestamp:1000n,gasLimit:120_000_000n});
    const readBlockHash=vi.spyOn(f.options.transport,'readBlockHash').mockResolvedValue(blockHash);
    const terms=[f.c.tokens[0][0],f.c.tokens[1][0],owner,deadline,encrypted,encrypted,encrypted,[0n,'0x'],[0n,'0x'],50],method=profile==='cheap-async'?'quoteCheapAsync':'quoteFastPool';
    const transaction={hash:canonicalHash,chainId:BigInt(f.c.chainId),from:owner,to:f.c.core,value:0n,data:abi.encodeFunctionData(method,profile==='cheap-async'?[terms]:terms),nonce:4,gasLimit:110_000_000n,blockNumber:100,blockHash};
    const event=profile==='cheap-async'?abi.encodeEventLog(abi.getEvent('CheapAsyncAdvanced')!,[7n,1,toBeHex(0n,32)]):abi.encodeEventLog(abi.getEvent('FastPoolQuoteIssued')!,[7n,toBeHex(88n,32),deadline]);
    vi.spyOn(f.options.transport,'readTransaction').mockImplementation(async requested=>requested===canonicalHash?transaction:null);
    vi.spyOn(f.options.transport,'waitForReceipt').mockImplementation(async requested=>requested===canonicalHash?{...transaction,status:1,logs:[{address:f.c.core,...event}]}:null);
    const canonical=vi.spyOn(f.options.transport,'verifyCanonicalInclusion').mockResolvedValue(undefined);
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({status:'1',message:'OK',result:[{hash,from:owner,to:f.c.core,blockNumber:'100'},...(fault==='replacement'?[{hash:replacementHash,from:owner,to:f.c.core,blockNumber:'100'}]:[])]})})));
    mocks.fillRead.mockResolvedValue({fills:[],complete:true,nextBefore:0n});
    f.send.mockImplementation(async(method,params)=>{
      if(method!=='eth_call')return{number:params[0],hash:blockHash,timestamp:'0x3e8'};
      if(fault==='getter')throw new Error('current state unavailable');
      if(fault==='privacy')aesKey='22'.repeat(16);
      if(fault==='reorg')readBlockHash.mockResolvedValue(toBeHex(99n,32));
      return operations.encodeFunctionResult(profile==='cheap-async'?'cheapAsyncPublic':'fastPoolQuotePublic',profile==='cheap-async'?[stage,toBeHex(stage<5?0n:88n,32),deadline]:[toBeHex(88n,32),deadline,ready]);
    });
    const pending=f.capability.readCurrentDexActivityPage({cursor:{transactions:1,nfts:null}});
    if(fault==='privacy'||fault==='reorg')await expect(pending).rejects.toThrow(fault==='privacy'?'History owner privacy changed':'History chain head changed');
    else{const page=await pending;expect(page.rows).toMatchObject([{currentStatus:status,movements:[],amountsState:'none',nativeAdmission:false,readyToSign:false}]);
      if(fault==='replacement'){
        expect(page.rows).toHaveLength(1);expect(page.rows[0].hash).toBe(replacementHash);expect(page.unavailable).toEqual([hash]);
        expect(canonical).toHaveBeenCalledWith(expect.objectContaining({hash:replacementHash,nonce:4}),expect.objectContaining({hash:replacementHash}));
      }
    }
    expect(f.send.mock.calls.filter(([method])=>method==='eth_call')).toEqual([['eth_call',[{to:f.c.core,data:operations.encodeFunctionData(profile==='cheap-async'?'cheapAsyncPublic':'fastPoolQuotePublic',[7n])},'0x64']]]);
    expect(mocks.decrypt).not.toHaveBeenCalled();expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each((['cheap-exit', 'cheap-history'] as const).flatMap(key =>
    (['none', 'quote-canonical', 'terminal-canonical', 'privacy'] as const).map(fault => [key, fault] as const)))(
    'resumes %s keeper terminal history safely on %s, without signing', async (key, fault) => {
    const f = await fixture(key), owner = f.issued.intent.principal, quoteHash = toBeHex(111n, 32), terminalHash = toBeHex(112n, 32);
    const blockHash = f.receipt.block.hash, abi = new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI);
    let aesKey = '11'.repeat(16);
    Object.assign(f.signer, { getUserOnboardInfo: () => ({ aesKey }) });
    vi.spyOn(f.options.transport, 'readHead').mockResolvedValue({ ...f.receipt.block, number: 6000n, gasLimit: 120_000_000n });
    vi.spyOn(f.options.transport, 'readBlockHash').mockResolvedValue(blockHash);
    const encrypted = [[0n, 0n], '0x'];
    const quote = { hash: quoteHash, chainId: BigInt(f.c.chainId), from: owner, to: f.c.core, value: 0n,
      data: abi.encodeFunctionData('quoteCheapAsync', [[f.c.tokens[0][0], f.c.tokens[1][0], owner, 9000n,
        encrypted, encrypted, encrypted, [0n, '0x'], [0n, '0x'], 50]]),
      nonce: 4, gasLimit: 5_000_000n, blockNumber: 100, blockHash };
    const worker = toBeHex(7n, 20), terminal = { ...quote, hash: terminalHash, from: worker, blockNumber: 5000,
      data: new Interface(['function cancelSwap(uint256)']).encodeFunctionData('cancelSwap', [7n]) };
    const event = (stage: number) => ({ address: f.c.core,
      ...abi.encodeEventLog(abi.getEvent('CheapAsyncAdvanced')!, [7n, stage, toBeHex(88n, 32)]) });
    const readTransaction = vi.spyOn(f.options.transport, 'readTransaction').mockImplementation(async hash => hash === quoteHash ? quote : terminal);
    vi.spyOn(f.options.transport, 'waitForReceipt').mockImplementation(async hash => {
      const tx = hash === quoteHash ? quote : terminal;
      return { hash, status: 1, from: tx.from, to: tx.to, blockNumber: tx.blockNumber, blockHash,
        logs: [event(hash === quoteHash ? 1 : 8)] };
    });
    const canonical = vi.spyOn(f.options.transport, 'verifyCanonicalInclusion').mockResolvedValue(undefined);
    f.send.mockImplementation(async (_method, params) => ({ number: params[0], hash: blockHash, timestamp: '0x3e8' }));
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ status: '1', message: 'OK', result: [
      { hash: quoteHash, from: owner, to: f.c.core, blockNumber: '100' }
    ] }) }));
    vi.stubGlobal('fetch', fetcher);
    mocks.fillRead.mockResolvedValue({ fills: [], count: 0n, complete: true, nextBefore: 0n });
    f.getLogs.mockImplementation(async ({ fromBlock, toBlock }) => fromBlock <= 5000 && toBlock >= 5000 ? [
      { ...event(8), blockNumber: 5000, transactionHash: terminalHash, removed: false }
    ] : []);
    const page = await f.capability.readCurrentDexActivityPage({ cursor: { transactions: 1, nfts: null } });
    expect(page).toMatchObject({ complete: false, unavailable: [], rows: [{ kind: 'async-quote', operationId: 7n }],
      nextCursor: { transactions: null, nfts: null, asyncTerminals: { [quoteHash]: 4196 } } });
    expect(f.getLogs.mock.calls.every(([range]) => range.toBlock - range.fromBlock < 256)).toBe(true);
    fetcher.mockClear(); readTransaction.mockClear(); canonical.mockClear(); f.getLogs.mockClear();
    if (fault === 'quote-canonical' || fault === 'terminal-canonical') canonical.mockImplementation(async transaction => {
      if (transaction.hash === (fault === 'quote-canonical' ? quoteHash : terminalHash)) throw new Error('canonical receipt changed');
    });
    if (fault === 'privacy') {
      f.getLogs.mockImplementationOnce(async () => { aesKey = '22'.repeat(16); return []; });
      await expect(f.capability.readCurrentDexActivityPage({ cursor: page.nextCursor, head: page.head }))
        .rejects.toThrow('History owner privacy changed');
      expect(readTransaction.mock.calls.map(([hash]) => hash)).toEqual([quoteHash]);
      expect(f.signer.sendTransaction).not.toHaveBeenCalled();
      return;
    }
    const older = await f.capability.readCurrentDexActivityPage({ cursor: page.nextCursor, head: page.head });
    if (fault === 'quote-canonical') {
      expect(older).toMatchObject({ complete: false, rows: [], unavailable: [quoteHash],
        nextCursor: { asyncTerminals: { [quoteHash]: 4196 } } });
      expect(f.getLogs).not.toHaveBeenCalled();
    } else if (fault === 'terminal-canonical') {
      expect(older).toMatchObject({ complete: true, unavailable: [terminalHash], rows: [{ kind: 'async-quote' }] });
    } else {
      expect(older).toMatchObject({ complete: true, unavailable: [], nextCursor: { asyncTerminals: {} },
        rows: [{ kind: 'cancel', operationId: 7n }, { kind: 'async-quote', operationId: 7n }] });
      expect(readTransaction.mock.calls.map(([hash]) => hash)).toEqual([quoteHash, terminalHash]);
      expect(canonical).toHaveBeenCalledTimes(4);
      expect(f.getLogs.mock.calls[0][0].fromBlock).toBe(4196);
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('reads chain funding history without any saved browser reservation or signing',async()=>{
    const f=await fixture('cheap-exit'),owner=f.issued.intent.principal,token=f.c.tokens[1][0],hash=toBeHex(111n,32),blockHash=f.receipt.block.hash;
    Object.assign(f.signer,{getUserOnboardInfo:()=>({aesKey:'11'.repeat(16)})});
    vi.spyOn(f.options.transport,'readHead').mockResolvedValue({...f.receipt.block,gasLimit:120_000_000n});
    vi.spyOn(f.options.transport,'readBlockHash').mockResolvedValue(blockHash);
    const eventAbi=new Interface(['function claimFaucet()','event FaucetClaimed(address indexed account)',
      'event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
    const transaction={hash,chainId:BigInt(f.c.chainId),from:owner,to:token,value:0n,data:eventAbi.encodeFunctionData('claimFaucet'),nonce:4,gasLimit:5_000_000n,blockNumber:100,blockHash};
    const receipt={hash,status:1,from:owner,to:token,blockNumber:100,blockHash,logs:[
      {address:token,...eventAbi.encodeEventLog(eventAbi.getEvent('FaucetClaimed')!,[owner])},
      {address:token,...eventAbi.encodeEventLog(eventAbi.getEvent('Transfer')!,[toBeHex(0,20),owner,[0,0],[1,2]])}]};
    vi.spyOn(f.options.transport,'readTransaction').mockResolvedValue(transaction);
    vi.spyOn(f.options.transport,'waitForReceipt').mockResolvedValue(receipt);
    const canonical=vi.spyOn(f.options.transport,'verifyCanonicalInclusion').mockResolvedValue(undefined);
    f.send.mockResolvedValue({number:'0x64',hash:blockHash,timestamp:`0x${f.receipt.block.timestamp.toString(16)}`});
    const fetcher=vi.fn(async(url:URL)=>({ok:true,json:async()=>({status:'1',message:'OK',result:url.searchParams.get('action')==='txlist'?[{hash,from:owner,to:token,blockNumber:'100'}]:[]})}));
    vi.stubGlobal('fetch',fetcher);const getItem=vi.fn(()=>{throw new Error('History must not read a browser reservation');});
    vi.stubGlobal('window',{sessionStorage:{getItem,setItem:vi.fn(),removeItem:vi.fn()}});mocks.decrypt.mockReturnValue(10_000_000_000n);
    const page=await f.capability.readCurrentDexActivityPage({cursor:{transactions:1,nfts:1}});
    expect(page).toMatchObject({complete:true,unavailable:[],fills:[],limitFillsState:'not-recorded',rows:[{action:'Token claim',movements:[{token,received:10_000_000_000n}]}]});
    expect(mocks.fillRead).not.toHaveBeenCalled();
    expect(canonical).toHaveBeenCalledTimes(2);expect(getItem).not.toHaveBeenCalled();expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(['cheap-exit','cheap-history']as const)('binds %s fill pages to all market engines, privacy and the saved canonical head', async key => {
    const f=await fixture(key); mocks.fillGraph=f.c.graph; // Synthetic support gate; no deployment or native admission.
    const scope=resolvePreparedDexScope(key).candidate,engine=scope.pairs[0].engine.toLowerCase();
    Object.assign(f.signer,{getUserOnboardInfo:()=>({aesKey:'11'.repeat(16)})});
    vi.spyOn(f.options.transport,'readHead').mockResolvedValue({...f.receipt.block,gasLimit:120_000_000n});
    vi.spyOn(f.options.transport,'readBlockHash').mockResolvedValue(f.receipt.block.hash);
    f.send.mockResolvedValue({number:'0x64',hash:f.receipt.block.hash,timestamp:`0x${f.receipt.block.timestamp.toString(16)}`});
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({status:'1',message:'OK',result:[]})})));
    mocks.fillRead.mockImplementation(async args=>{
      await args.assertCurrent();
      return {fills:args.engine===engine?[{engine,record:33n,positionId:7n,blockNumber:95n,blockHash:f.receipt.block.hash,timestamp:f.receipt.block.timestamp-5n,
        soldToken:args.poolTokens[0],receivedToken:args.poolTokens[1],sold:5n,received:10n,readyToSign:false,nativeAdmission:false}]:[],
        count:64n,complete:args.engine!==engine,nextBefore:32n};
    });
    const page=await f.capability.readCurrentDexActivityPage({cursor:{transactions:1,nfts:1}});
    expect(page).toMatchObject({limitFillsState:'available',complete:false,fills:[{record:33n,positionId:7n}],nextCursor:{limitFills:{[engine]:32n}}});
    expect(mocks.fillRead).toHaveBeenCalledTimes(6);
    expect(mocks.fillRead.mock.calls[0][0]).toMatchObject({owner:f.issued.intent.principal,engine,head:f.receipt.block,poolTokens:scope.pairs[0].tokens});
    expect(mocks.fillRead.mock.calls[0][0].decryptBool).toEqual(expect.any(Function));
    mocks.fillRead.mockClear();mocks.fillRead.mockResolvedValue({fills:[],count:64n,complete:true,nextBefore:0n});
    const older=await f.capability.readCurrentDexActivityPage({cursor:page.nextCursor,head:page.head});
    expect(mocks.fillRead).toHaveBeenCalledTimes(1);expect(mocks.fillRead.mock.calls[0][0]).toMatchObject({engine,before:32n});
    expect(older.complete).toBe(true);expect(f.signer.sendTransaction).not.toHaveBeenCalled();
    mocks.fillRead.mockRejectedValueOnce(new Error('RPC unavailable'));
    await expect(f.capability.readCurrentDexActivityPage({cursor:{transactions:null,nfts:null}})).rejects.toThrow('RPC unavailable');
  });
  it.each(['cheap-exit','cheap-history']as const)('checks %s candidate code while retaining canonical terminal token evidence',async candidate=>{
    const f=await fixture(candidate);Object.assign(f.signer,{getUserOnboardInfo:()=>({aesKey:'11'.repeat(16)})});
    const head={number:101n,hash:toBeHex(99n,32),timestamp:f.receipt.block.timestamp,gasLimit:120_000_000n};
    vi.spyOn(f.options.transport,'readHead').mockResolvedValue(head);
    mocks.graph.mockImplementation(async args=>{if(args.blockNumber===100n)throw new Error('missing trie node');return{graph:f.c.graph,packageSha256:f.c.packageSha256,core:f.c.core};});
    const abi=new Interface(['function cancelSwap(uint256 operationId)','event CheapAsyncAdvanced(uint256 indexed quoteId,uint8 stage,bytes32 context)']);
    const event=abi.encodeEventLog(abi.getEvent('CheapAsyncAdvanced')!,[7n,8,f.issued.intent.contextHash]);
    const receipt={hash:toBeHex(111n,32),status:1,blockNumber:100,blockHash:f.receipt.block.hash,
      logs:[{address:f.c.core,...event,index:0,transactionHash:toBeHex(111n,32),blockNumber:100,blockHash:f.receipt.block.hash,removed:false}]};
    const tx={hash:receipt.hash,chainId:BigInt(f.c.chainId),from:f.issued.intent.principal,to:f.c.core,value:0n,
      data:abi.encodeFunctionData('cancelSwap',[7n]),nonce:5,gasLimit:30_000_000n,blockNumber:100,blockHash:receipt.blockHash};
    vi.spyOn(f.options.transport,'readTransaction').mockResolvedValue(tx);
    const canonical=vi.spyOn(f.options.transport,'verifyCanonicalInclusion').mockResolvedValue(undefined);
    vi.spyOn(tokenProof,'verifyCurrentDexOwnerTokenMovements').mockImplementation(async args=>{await args.verifyCanonical(args.binding,args.receipt);return undefined as never;});
    await f.options.verifyOwnerTokens!({issued:f.issued as never,amounts:f.receipt.amounts,phase:'cancel',receipt:receipt as never,contextHash:f.issued.intent.contextHash});
    expect(canonical).toHaveBeenCalledOnce();expect(mocks.graph).toHaveBeenCalledWith(expect.objectContaining({blockNumber:101n,blockHash:head.hash}));
    expect(tokenProof.verifyCurrentDexOwnerTokenMovements).toHaveBeenCalledWith(expect.objectContaining({binding:expect.objectContaining({graph:f.c.graph,packageSha256:f.c.packageSha256,core:f.c.core})}));
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('authenticates only the exact public reload record with the live owner privacy key',async()=>{
    const f=await fixture('cheap-exit');let aesKey='11'.repeat(16);Object.assign(f.signer,{getUserOnboardInfo:()=>({aesKey})});
    const record={version:1 as const,owner:`0x${'22'.repeat(20)}`,candidateGraph:f.c.graph,start:'100',committedWei:'5500000000000000',activeSwap:`quote:0x${'33'.repeat(32)}`,
      charges:[{phase:'quote' as const,key:`quote:0x${'33'.repeat(32)}`,scope:`quote:0x${'33'.repeat(32)}`,gasCap:'110000000',nonce:4,hash:`0x${'44'.repeat(32)}`}]};
    const a=await f.options.authenticateReload!(record);expect(a).toMatch(/^0x[0-9a-f]{64}$/);expect(await f.options.authenticateReload!(record)).toBe(a);
    expect(await f.options.authenticateReload!({...record,start:'101'})).not.toBe(a);aesKey='22'.repeat(16);expect(await f.options.authenticateReload!(record)).not.toBe(a);
    aesKey='';await expect(f.options.authenticateReload!(record)).rejects.toThrow('Unlock owner privacy');expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(['advance', 'reorg'] as const)('checks the captured resource block while latest can %s', async change => {
    const f = await fixture('cheap-exit'), head = { ...f.receipt.block, gasLimit: 150_000_000n };
    const quantity = (value: bigint) => `0x${value.toString(16)}`;
    f.send.mockImplementation(async (method: string, params: unknown[]) => {
      if (method === 'eth_getBlockByNumber') {
        const latest = params[0] === 'latest';
        return { number: quantity(latest ? head.number + 1n : head.number),
          hash: latest || change === 'reorg' ? toBeHex(99n, 32) : head.hash,
          timestamp: quantity(latest ? head.timestamp + 1n : head.timestamp), gasLimit: quantity(head.gasLimit), baseFeePerGas: '0x1' };
      }
      if (method === 'eth_chainId') return quantity(BigInt(f.c.chainId));
      if (method === 'eth_getTransactionCount') return '0x5';
      if (method === 'eth_gasPrice') return quantity(52_000_000n);
      if (method === 'eth_getBalance') return quantity(100_000_000_000_000_000n);
      if (method === 'eth_getCode') return '0x';
      throw new Error('Unexpected resource read');
    });
    const read = f.options.transport.readNativeResources!(head);
    if (change === 'reorg') await expect(read).rejects.toThrow('canonical head changed');
    else {
      await expect(read).resolves.toMatchObject({ head, latestNonce: 5, pendingNonce: 5 });
      expect(f.send.mock.calls.filter(([method]) => method === 'eth_getBlockByNumber').map(([, params]) => params))
        .toEqual([[quantity(head.number), false], [quantity(head.number), false]]);
    }
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('pins the original READY receipt read to its canonical observation block',async()=>{
    const f=await fixture('cheap-exit'),current={...f.issued,block:f.receipt.block,operation:{...f.receipt.operation,stage:5},readCurrent:vi.fn()};current.readCurrent.mockResolvedValue(current);
    await f.options.readOriginalQuoteReceipt!(current as never);
    expect(f.readCurrent).toHaveBeenCalledWith(expect.objectContaining({expected:expect.objectContaining({blockNumber:current.block.number,blockHash:current.block.hash})}));
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  for (const key of ['cheap-exit', 'cheap-prepared','cheap-history'] as const) {
    it.each(STAGED_EXIT_PREVIEW_DEX_CANDIDATE.pairs)(`${key}: shows exact six-decimal amounts in both directions for $canonicalId`, async pair => {
      const c = resolvePreparedDexScope(key).candidate;
      const selected = c.pairs.find(p => p.canonicalId === pair.canonicalId)!;
      for (const reverse of [false, true]) {
        const addresses = reverse ? [...selected.tokens].reverse() : selected.tokens;
        const f = await fixture(key, c.tokens.findIndex(([a]) => a === addresses[0]), c.tokens.findIndex(([a]) => a === addresses[1]));
        const metadata = display.currentDexDisplayPair(c, addresses[0], addresses[1]);
        const confirm = vi.fn(async (value: unknown) => {
          const model = value as TradeActionConfirmModel;
          expect(model.summaryRows?.slice(0, 2)).toEqual([
            { label: 'You pay', value: `1.234567 ${metadata.tokenIn.label}` },
            { label: 'You receive', value: `2.345678 ${metadata.tokenOut.label}` }]);
          return true;
        });
        await expect(f.options.reviewAcceptance!(f.issued as never, confirm)).resolves.toMatchObject({ readyToSign: false });
        expect(f.readCurrent).toHaveBeenCalledTimes(2);
        expect(f.signer.sendTransaction).not.toHaveBeenCalled(); expect(f.signer.estimateGas).not.toHaveBeenCalled();
        expect(f.send).not.toHaveBeenCalled();
      }
    });
  }
  it.each(['cheap-current', 'cheap-archived', 'cheap-slippage', 'cheap-two-pool', 'cheap-reference', 'cheap-native', 'cheap-d06'] as const)('preserves historical two-token formatting for %s', async key => {
    for (const reverse of [false, true]) {
      const f = await fixture(key, reverse ? 1 : 0, reverse ? 0 : 1);
      const confirm = vi.fn(async (value: unknown) => {
        const model = value as TradeActionConfirmModel;
        expect(model.summaryRows?.[0].value).toBe(`0.000000000001234567 Test token ${reverse ? 1 : 0}`);
        expect(model.summaryRows?.[1].value).toBe(`0.000000000002345678 Test token ${reverse ? 0 : 1}`);
        return false;
      });
      await expect(f.options.reviewAcceptance!(f.issued as never, confirm)).resolves.toBeNull();
      expect(f.readCurrent).toHaveBeenCalledTimes(1);
    }
  });
  it.each(['missing', 'other', 'spoof', 'unknown', 'same', 'blank', 'decimals'])('rejects %s before private receipt read or confirmation', async fault => {
    const f = await fixture('cheap-exit'), confirm = vi.fn();
    if (fault === 'missing') Object.assign(f.issued.intent, { candidate: undefined });
    if (fault === 'other') Object.assign(f.issued.intent, { candidate: resolveCurrentCheapDexCandidate('cheap-prepared') });
    if (fault === 'spoof') Object.assign(f.issued.intent, { candidate: { ...f.c, graph: toBeHex(1n, 32) } });
    if (fault === 'unknown') f.issued.intent.inputToken = `0x${'11'.repeat(20)}`;
    if (fault === 'same') f.issued.intent.outputToken = f.issued.intent.inputToken;
    if (fault === 'blank' || fault === 'decimals') {
      const pair = display.currentDexDisplayPair(f.c, f.issued.intent.inputToken, f.issued.intent.outputToken);
      vi.spyOn(display, 'currentDexDisplayPair').mockReturnValue({ ...pair,
        tokenIn: { ...pair.tokenIn, label: fault === 'blank' ? ' ' : pair.tokenIn.label, decimals: fault === 'decimals' ? -1 : pair.tokenIn.decimals } });
    }
    await expect(f.options.reviewAcceptance!(f.issued as never, confirm)).rejects.toThrow();
    expect(mocks.receipt).not.toHaveBeenCalled(); expect(f.readCurrent).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled(); expect(f.signer.getNonce).not.toHaveBeenCalled(); expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(['missing','old']as const)('rejects new-candidate %s identity before private review',async fault=>{
    const f=await fixture('cheap-history'),confirm=vi.fn();Object.assign(f.issued.intent,{candidate:fault==='missing'?undefined:STAGED_EXIT_PREVIEW_DEX_CANDIDATE});
    await expect(f.options.reviewAcceptance!(f.issued as never,confirm)).rejects.toThrow('differs from the selected DEX candidate');
    expect(mocks.receipt).not.toHaveBeenCalled();expect(f.readCurrent).not.toHaveBeenCalled();expect(confirm).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('retains changed-quote and session checks during review', async () => {
    const f = await fixture('cheap-exit');
    const confirm = vi.fn(async () => {
      f.readCurrent.mockResolvedValue({ ...f.receipt, amounts: { ...f.receipt.amounts, actualInput: 1_234_568n, refund: 765_432n } });
      return true;
    });
    await expect(f.options.reviewAcceptance!(f.issued as never, confirm)).rejects.toThrow('changed during review');
    f.assertCurrent.mockRejectedValue(new Error('Lease revoked'));
    await expect(f.options.reviewAcceptance!(f.issued as never, confirm)).rejects.toThrow('Lease revoked');
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(['cheap-exit','cheap-history']as const)('requires the exact selected-Core swap allowance for %s',async candidate=>{
    const f=await fixture(candidate,2,3),abi=new Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI),amount=f.issued.intent.maximumInput,head={...f.receipt.block,gasLimit:120_000_000n};
    Object.assign(f.signer,{getUserOnboardInfo:()=>({aesKey:'test-only'})});let allowance=amount;
    f.send.mockImplementation(async(method:string,params:unknown[])=>{
      expect(method).toBe('eth_call');expect(params[1]).toEqual({blockHash:f.receipt.block.hash,requireCanonical:true});
      const call=params[0]as{to:string;data:string},parsed=abi.parseTransaction({data:call.data})!;expect(call.to).toBe(f.issued.intent.inputToken);
      if(parsed.name==='balanceOf')return abi.encodeFunctionResult(parsed.fragment,[[1n,amount+1n]]);
      expect(parsed.args[1].toLowerCase()).toBe(f.c.core);return abi.encodeFunctionResult(parsed.fragment,[[[99n,999n],[2n,allowance],[999n,999n]]]);
    });
    mocks.decrypt.mockImplementation((_,cipher:{ciphertextHigh:bigint;ciphertextLow:bigint})=>{expect([1n,2n]).toContain(cipher.ciphertextHigh);return cipher.ciphertextLow;});
    await expect(f.options.requireFunding!(f.issued as never,head)).resolves.toBeUndefined();
    allowance=amount+1n;await expect(f.options.requireFunding!(f.issued as never,head)).rejects.toThrow('must equal');
    allowance=0n;await expect(f.options.requireFunding!(f.issued as never,head,true)).resolves.toBeUndefined();
    allowance=1n;await expect(f.options.requireFunding!(f.issued as never,head,true)).rejects.toThrow('must equal');
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();expect(f.signer.estimateGas).not.toHaveBeenCalled();
  });
  it('keeps the real exit submission hold before wallet or RPC work', async () => {
    const f = await fixture('cheap-exit');
    expect(f.capability.readyToSign).toBe(false);
    await expect(f.capability.submitCurrentCheapQuote({} as never)).rejects.toThrow();
    expect(f.send).not.toHaveBeenCalled(); expect(f.signer.getNonce).not.toHaveBeenCalled();
    expect(f.signer.estimateGas).not.toHaveBeenCalled(); expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
});

describe('selected six-market Limit funding',()=>{
  it.each(STAGED_EXIT_PREVIEW_DEX_CANDIDATE.pairs)('checks only the offered token and exact current-Core allowance for pair $canonicalId',async pair=>{
    for(const sellToken0 of [true,false]){
      vi.clearAllMocks();const c=STAGED_EXIT_PREVIEW_DEX_CANDIDATE,owner=`0x${'22'.repeat(20)}`,offered=pair.tokens[sellToken0?0:1],abi=new Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI),head={number:30n,hash:toBeHex(77n,32)};
      let allowance=100n;const send=vi.fn(async(method:string,params:unknown[])=>{expect(method).toBe('eth_call');expect(params[1]).toEqual({blockHash:head.hash,requireCanonical:true});const call=params[0]as{to:string;data:string;from:string};expect(call.to).toBe(offered);expect(call.from).toBe(owner);const parsed=abi.parseTransaction({data:call.data})!;if(parsed.name==='balanceOf')return abi.encodeFunctionResult(parsed.fragment,[[1n,1000n]]);expect(parsed.args[1].toLowerCase()).toBe(c.core);return abi.encodeFunctionResult(parsed.fragment,[[[99n,999n],[2n,allowance],[999n,999n]]]);});
      const signer={getUserOnboardInfo:()=>({aesKey:'test-only'}),sendTransaction:vi.fn()};
      mocks.decrypt.mockImplementation((_,cipher:{ciphertextHigh:bigint;ciphertextLow:bigint})=>{expect([1n,2n]).toContain(cipher.ciphertextHigh);return cipher.ciphertextLow;});mocks.graph.mockResolvedValue({graph:c.graph,packageSha256:c.packageSha256,core:c.core});
      mocks.issue.mockImplementation(async args=>args.bindCapability({assertCurrent:async()=>{},assertSnapshotCurrent:()=>{},chainId:BigInt(c.chainId),ownerAddress:owner,readProvider:{send},signer}));
      const capability=await issueCurrentDexSubmissionCapability({candidate:'cheap-exit',admission:null}as never);
      if(pair.canonicalId==="1"&&sellToken0){await expect(capability.readCurrentTokenFunding(0)).rejects.toThrow('runtime has no funding evidence');expect(send).not.toHaveBeenCalled();}
      const options=mocks.limit.mock.calls[mocks.limit.mock.calls.length-1][0]as Parameters<typeof import('../../lib/currentDexLimitSubmission').createCurrentLimitSubmissionAdapter>[0],prepared={marketId:pair.marketId,poolTokens:pair.tokens,intent:{sellToken0,amount:100n}};
      await expect(options.requireFunding(prepared as never,head)).resolves.toBeUndefined();allowance=101n;await expect(options.requireFunding(prepared as never,head)).rejects.toThrow('must equal');
      expect(()=>options.requireFunding({...prepared,marketId:c.pairs.find(p=>p.marketId!==pair.marketId)!.marketId}as never,head)).toThrow('market changed');expect(signer.sendTransaction).not.toHaveBeenCalled();
    }
  });
});

describe('selected six-market Pool funding', () => {
  it.each(['cheap-exit','cheap-history']as const)('passes %s to shared funding and its exact Core allowance reader', async candidate => {
    vi.clearAllMocks(); const owner = `0x${'22'.repeat(20)}`, send = vi.fn(), signer = { getUserOnboardInfo: () => ({ aesKey: 'test-only' }) };
    mocks.issue.mockImplementation(async args => args.bindCapability({ assertCurrent: async () => {}, assertSnapshotCurrent: () => {},
      chainId: 7082400n, ownerAddress: owner, readProvider: { send }, signer }));
    await issueCurrentDexSubmissionCapability({ candidate, admission: null,
      sessionOnboardInfo: { [owner.toLowerCase()]: { aesKey: 'test-only' } } } as never);
    const options = mocks.sharedFunding.mock.calls[mocks.sharedFunding.mock.calls.length - 1][0] as Parameters<typeof import('../../lib/currentSharedDexTokenFunding').createCurrentSharedDexTokenFundingAdapter>[0];
    expect(options.candidate).toBe(candidate);
    if (candidate === 'cheap-history') expect(options.authorizeInitialClaimSigning).toBeUndefined();
    else expect(options.authorizeInitialClaimSigning).toBeTypeOf('function');
    const head = { number: 30n, hash: toBeHex(77n, 32), timestamp: 1791345000n, gasLimit: 120_000_000n };
    await options.readFunds(head);
    expect(mocks.sharedFunds).toHaveBeenCalledWith(expect.objectContaining({ candidate, owner, head }));
    expect(send).not.toHaveBeenCalled();
  });
  for(const candidate of ['cheap-exit','cheap-history']as const){
  it.each(STAGED_EXIT_PREVIEW_DEX_CANDIDATE.pairs)(`${candidate}: binds pair $canonicalId to both exact current-Core allowances`, async reference => {
    vi.clearAllMocks(); const c = resolvePreparedDexScope(candidate).candidate,pair=c.pairs.find(p=>p.canonicalId===reference.canonicalId)!, owner = `0x${'22'.repeat(20)}`;
    const abi = new Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI), head = { number: 30n, hash: toBeHex(77n, 32), timestamp: 1791345000n, gasLimit: 120_000_000n };
    let extra = 0n;
    const send = vi.fn(async (method: string, params: unknown[]) => {
      expect(method).toBe('eth_call'); expect(params[1]).toEqual({ blockHash: head.hash, requireCanonical: true });
      const call = params[0] as { to: string; data: string; from: string }, parsed = abi.parseTransaction({ data: call.data })!;
      const index = pair.tokens.findIndex(token => token === call.to); expect(index).toBeGreaterThanOrEqual(0); expect(call.from).toBe(owner);
      if (parsed.name === 'balanceOf') return abi.encodeFunctionResult(parsed.fragment, [[1n, 1000n]]);
      expect(parsed.args[1].toLowerCase()).toBe(c.core);
      return abi.encodeFunctionResult(parsed.fragment, [[[99n, 999n], [2n, (index === 0 ? 11n : 13n) + extra], [999n, 999n]]]);
    });
    const signer = { getUserOnboardInfo: () => ({ aesKey: 'test-only' }), sendTransaction: vi.fn() };
    mocks.decrypt.mockImplementation((_, cipher: { ciphertextHigh: bigint; ciphertextLow: bigint }) => {
      expect([1n, 2n]).toContain(cipher.ciphertextHigh); return cipher.ciphertextLow;
    });
    mocks.graph.mockResolvedValue({ graph: c.graph, packageSha256: c.packageSha256, core: c.core });
    mocks.issue.mockImplementation(async args => args.bindCapability({ assertCurrent: async () => {}, assertSnapshotCurrent: () => {},
      chainId: BigInt(c.chainId), ownerAddress: owner, readProvider: { send }, signer }));
    await issueCurrentDexSubmissionCapability({ candidate, admission: null } as never);
    const options = mocks.pool.mock.calls[mocks.pool.mock.calls.length - 1][0] as Parameters<typeof import('../../lib/currentDexPoolSubmission').createCurrentPoolSubmissionAdapter>[0];
    const prepared = { intent: { marketId: pair.marketId, poolTokens: pair.tokens }, amounts: { used0: 11n, used1: 13n } };
    await expect(options.requireFunding(prepared as never, head)).resolves.toBeUndefined();
    expect(send.mock.calls.map(([, params]) => (params[0] as { to: string }).to)).toEqual([pair.tokens[0], pair.tokens[0], pair.tokens[1], pair.tokens[1]]);
    extra = 1n; await expect(options.requireFunding(prepared as never, head)).rejects.toThrow('must equal');
    send.mockClear();
    for (const intent of [{ ...prepared.intent, marketId: c.pairs.find(p => p.marketId !== pair.marketId)!.marketId },
      { ...prepared.intent, poolTokens: [...pair.tokens].reverse() }]) {
      await expect(options.requireFunding({ ...prepared, intent } as never, head)).rejects.toThrow('differs from its prepared market');
    }
    expect(send).not.toHaveBeenCalled(); expect(signer.sendTransaction).not.toHaveBeenCalled();
  });
  }
});

describe('current DEX wallet hash and RPC visibility', () => {
  const setup = async () => {
    vi.clearAllMocks();
    const owner = `0x${'22'.repeat(20)}`, hash = `0x${'77'.repeat(32)}`;
    const request = { chainId: 7082400n, from: owner, to: STAGED_EXIT_PREVIEW_DEX_CANDIDATE.core,
      value: 0n as const, data: '0x1234', nonce: 4, gasLimit: 35_000_000n, gasPrice: 52_000_000n };
    const transaction = { ...request, hash };
    const signer = { sendTransaction: vi.fn(async () => { throw new Error('Unbounded SDK send path used'); }),
      sendUncheckedTransaction: vi.fn(async () => hash) };
    const getTransaction = vi.fn(async () => transaction), waitForTransaction = vi.fn();
    const guard = vi.fn(async () => {});
    mocks.issue.mockImplementation(async args => args.bindCapability({ assertCurrent: guard,
      assertSnapshotCurrent: () => {}, chainId: 7082400n, ownerAddress: owner,
      readProvider: { getTransaction, waitForTransaction, send: vi.fn() }, signer }));
    await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-exit' } as never);
    const transport = mocks.cheap.mock.calls[mocks.cheap.mock.calls.length - 1][0].transport;
    return { request, transaction, hash, signer, getTransaction, waitForTransaction, guard, transport };
  };
  it('reproduces the SDK waiting for wallet RPC visibility after a returned hash', async () => {
    const hash = `0x${'77'.repeat(32)}`, owner = `0x${'22'.repeat(20)}`;
    let visible!: (value: unknown) => void;
    const visibility = new Promise(resolve => { visible = resolve; });
    const provider = { getBlockNumber: vi.fn(async () => 100),
      getRpcTransaction: vi.fn(() => ({})), send: vi.fn(async () => hash),
      getTransaction: vi.fn(() => visibility) };
    const signer = new JsonRpcSigner(provider as never, owner);
    let finished = false;
    const sending = signer.sendTransaction({ from: owner, to: owner, value: 0n, gasLimit: 1n }).then(() => { finished = true; });
    await vi.waitFor(() => expect(provider.getTransaction).toHaveBeenCalledWith(hash));
    expect(provider.send).toHaveBeenCalledWith('eth_sendTransaction', [{}]);
    expect(finished).toBe(false);
    visible({ replaceableTransaction: () => ({ hash }) });
    await sending;
  });
  it('returns the wallet hash before checking the same transaction through the read RPC', async () => {
    const f = await setup(), hashReturned = vi.fn();
    f.getTransaction.mockImplementation(async () => {
      expect(hashReturned).toHaveBeenCalledWith(f.hash);
      return f.transaction;
    });
    await expect(f.transport.send(f.request, hashReturned)).resolves.toMatchObject(f.transaction);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('bounds missing RPC visibility and does not ask the wallet to send again', async () => {
    const f = await setup(), hashReturned = vi.fn();
    f.getTransaction.mockResolvedValue(null as never);
    f.waitForTransaction.mockRejectedValue({ code: 'TIMEOUT' });
    await expect(f.transport.send(f.request, hashReturned)).rejects.toThrow('not yet verified');
    expect(hashReturned).toHaveBeenCalledWith(f.hash);
    expect(f.waitForTransaction).toHaveBeenCalledWith(f.hash, 1, 60000);
    expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
  });
  it.each(['chainId', 'hash', 'from', 'to', 'value', 'data', 'nonce', 'gasLimit', 'gasPrice'] as const)(
    'rejects changed RPC %s while retaining the returned hash', async field => {
      const f = await setup(), hashReturned = vi.fn();
      const value = field === 'nonce' ? 99 : ['chainId', 'value', 'gasLimit', 'gasPrice'].includes(field) ? 1n
        : field === 'data' ? '0x5678' : field === 'hash' ? toBeHex(99n, 32) : `0x${'33'.repeat(20)}`;
      f.getTransaction.mockResolvedValue({ ...f.transaction, [field]: value } as never);
      await expect(f.transport.send(f.request, hashReturned)).rejects.toThrow(`Mismatch: ${field}`);
      expect(hashReturned).toHaveBeenCalledWith(f.hash);
      expect(f.signer.sendUncheckedTransaction).toHaveBeenCalledOnce();
    });
});

describe('current DEX submission owner capability', () => {
  it('exposes four-token funding through the existing transport with the real App hold before all wallet/RPC calls', async () => {
    const sendTransaction = vi.fn(), estimateGas = vi.fn(), getNonce = vi.fn(), send = vi.fn();
    mocks.issue.mockImplementation(async args => args.bindCapability({ assertCurrent: vi.fn(), assertSnapshotCurrent: vi.fn(),
      chainId: 7082400n, ownerAddress: `0x${'22'.repeat(20)}`, readProvider: { send }, signer: { sendTransaction, estimateGas, getNonce } }));
    const capability = await issueCurrentDexSubmissionCapability({ admission: null } as never);
    expect(typeof capability.readSharedTokenFunding).toBe('function'); expect(typeof capability.recoverPendingSharedTokenFunding).toBe('function');
    expect(typeof capability.prepareSharedLimitApproval).toBe('function'); expect(typeof capability.submitSharedLimitApproval).toBe('function');
    expect(typeof capability.recoverPendingSharedLimitApproval).toBe('function');
    await expect(capability.prepareSharedLimitApproval({ funding: {} as never, confirm: async () => true })).rejects.toThrow('held');
    await expect(capability.submitSharedTokenFunding({ action: 'initial', token: '0xe595F63789D1D31B4b7c0Bee69062Daf5BE81ac8' } as never)).rejects.toThrow('held');
    await expect(capability.prepareSharedTokenFunding({ action: 'initial', token: '0xe595F63789D1D31B4b7c0Bee69062Daf5BE81ac8', confirm: async () => true })).rejects.toThrow('held');
    expect(getNonce).not.toHaveBeenCalled(); expect(estimateGas).not.toHaveBeenCalled(); expect(sendTransaction).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it('binds Pool and Limit attestation to the explicitly selected candidate', async () => {
    const selected = resolveCurrentCheapDexCandidate('cheap-native');
    const sendTransaction = vi.fn(), guard = vi.fn();
    mocks.issue.mockImplementation(async args => args.bindCapability({ assertCurrent: guard, assertSnapshotCurrent: guard,
      chainId: 7082400n, ownerAddress: `0x${'22'.repeat(20)}`, readProvider: { send: vi.fn() }, signer: { sendTransaction } }));
    mocks.graph.mockResolvedValue({ graph: selected.graph, packageSha256: selected.packageSha256, core: selected.core });
    await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-native' } as never);
    const head = { number: 30n, hash: toBeHex(77n, 32) };
    const pool = mocks.pool.mock.calls[mocks.pool.mock.calls.length - 1][0], limit = mocks.limit.mock.calls[mocks.limit.mock.calls.length - 1][0];
    expect(pool.candidate).toBe('cheap-native'); expect(limit.candidate).toBe('cheap-native');
    await pool.attest(head); await limit.attest(head);
    expect(mocks.graph.mock.calls[mocks.graph.mock.calls.length - 1][0]).toMatchObject({ candidate: 'cheap-native', blockNumber: head.number, blockHash: head.hash });
    mocks.graph.mockResolvedValue({ graph: ARCHIVED_CHEAP_DEX_CANDIDATE.graph,
      packageSha256: ARCHIVED_CHEAP_DEX_CANDIDATE.packageSha256, core: ARCHIVED_CHEAP_DEX_CANDIDATE.core });
    await expect(pool.attest(head)).rejects.toThrow('graph changed');
    await expect(limit.attest(head)).rejects.toThrow('graph changed');
    expect(sendTransaction).not.toHaveBeenCalled();
  });
  it('exposes native refill recovery but holds submission before nonce, estimate or wallet calls', async () => {
    const sendTransaction = vi.fn(), estimateGas = vi.fn(), getNonce = vi.fn(), send = vi.fn();
    mocks.issue.mockImplementation(async args => args.bindCapability({ assertCurrent: vi.fn(), assertSnapshotCurrent: vi.fn(),
      chainId: 7082400n, ownerAddress: `0x${'22'.repeat(20)}`, readProvider: { send }, signer: { sendTransaction, estimateGas, getNonce } }));
    const capability = await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-native' } as never);
    expect(typeof capability.readCurrentTokenRefillSubmission).toBe('function');
    expect(typeof capability.recoverPendingCurrentTokenRefill).toBe('function');
    await expect(capability.submitCurrentTokenRefill({} as never)).rejects.toThrow();
    expect(getNonce).not.toHaveBeenCalled(); expect(estimateGas).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it('waits for one confirmation without signing and retains session checks on timeout', async () => {
    const waitForTransaction = vi.fn(), sendTransaction = vi.fn(), guard = vi.fn(async () => {});
    mocks.issue.mockImplementation(async args => args.bindCapability({ assertCurrent: guard, assertSnapshotCurrent: guard,
      chainId: 7082400n, ownerAddress: `0x${'22'.repeat(20)}`,
      readProvider: { waitForTransaction }, signer: { sendTransaction } }));
    const capability = await issueCurrentDexSubmissionCapability({ admission: null } as never);
    const hash = `0x${'11'.repeat(32)}`;
    waitForTransaction.mockResolvedValueOnce({ status: 1 });
    expect(await capability.waitForCurrentCheapReceipt(hash)).toBe(true);
    expect(waitForTransaction).toHaveBeenCalledWith(hash, 1, 60_000);
    waitForTransaction.mockRejectedValueOnce({ code: 'TIMEOUT' });
    expect(await capability.waitForCurrentCheapReceipt(hash)).toBe(false);
    waitForTransaction.mockRejectedValueOnce(new Error('RPC failed'));
    await expect(capability.waitForCurrentCheapReceipt(hash)).rejects.toThrow('RPC failed');
    guard.mockRejectedValueOnce(new Error('Session revoked'));
    await expect(capability.waitForCurrentCheapReceipt(hash)).rejects.toThrow('Session revoked');
    expect(sendTransaction).not.toHaveBeenCalled();
  });
  it('does not promote copied current-candidate receipt data into submission authority', async () => {
    const sendTransaction = vi.fn(), estimateGas = vi.fn();
    mocks.issue.mockImplementation(async args => args.bindCapability({ assertCurrent: vi.fn(), assertSnapshotCurrent: vi.fn(),
      chainId: 7082400n, ownerAddress: `0x${'22'.repeat(20)}`,
      readProvider: { getTransactionReceipt: vi.fn(), send: vi.fn() }, signer: { sendTransaction, estimateGas } }));
    const candidate = CURRENT_SHARED_POOL_CANDIDATE;
    const copied = Object.freeze({ evidence: Object.freeze({
      version: 'async-submission-phase-v2', candidateSha256: candidate.packageSha256,
      sourcesSha256: candidate.packageSha256, chainId: 7082400n,
      principal: `0x${'8b749251CF1f712D4e39FD048C53394af03E10bE'}`, core: candidate.core,
      manifestHash: `0x${candidate.packageSha256}`, runtimeHash: candidate.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2],
      releaseId: candidate.releaseId, inputToken: candidate.tokens[0][0], outputToken: candidate.tokens[1][0],
      tokenPolicyHash: candidate.reviewedTokenSet, phase: 'quote',
      callHash: '0x6b3101220bf132d60f879d1d268dd79c88f04fb10e1e4afcdb6d22fbe25688f4',
      authorizationHash: `0x${'11'.repeat(32)}`,
      native: Object.freeze({ evidenceHash: '0x6b4fa7b697c17f54967a6320481a33f6110161c9a244e8beec07ed406d737ea2',
        gasUsed: 43095753n, gasLimit: 108000000n })
    }) });
    expect(verifyCurrentDexSubmissionAdmission(copied)).toBe(false);
    const capability = await issueCurrentDexSubmissionCapability({ admission: copied } as never);
    expect(capability.readyToSign).toBe(false);
    await expect(capability.submitQuote({} as never)).rejects.toThrow('not admitted');
    expect(estimateGas).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
  });
  it('binds the lease-guarded transport but keeps the application unadmitted', async () => {
    const sendTransaction = vi.fn(), estimateGas = vi.fn(), getTransactionReceipt = vi.fn();
    mocks.issue.mockImplementation(async args => {
      expect(args.requirePrivacy).toBe(false);
      return args.bindCapability({
        assertCurrent: vi.fn(), assertSnapshotCurrent: vi.fn(),
        chainId: 7082400n, ownerAddress: `0x${'22'.repeat(20)}`,
        readProvider: { getTransactionReceipt, send: vi.fn() }, signer: { sendTransaction, estimateGas }
      });
    });
    const capability = await issueCurrentDexSubmissionCapability({ admission: null } as never);
    expect(capability).toMatchObject({ version: 'async-submission-phase-v2', readyToSign: false });
    await expect(capability.submitQuote({} as never)).rejects.toThrow('not admitted');
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(estimateGas).not.toHaveBeenCalled();
    expect(getTransactionReceipt).not.toHaveBeenCalled();
  });
});

describe('current Pool private funding wiring', () => {
  const candidate = CURRENT_CHEAP_DEX_CANDIDATE, owner = `0x${'22'.repeat(20)}`;
  const token = new Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI);
  const head = { number: 30n, hash: toBeHex(77n, 32), timestamp: 100n, gasLimit: 120_000_000n };
  const fixture = async (nativePoolProfile?: typeof CURRENT_NATIVE_POOL_PROFILE) => {
    vi.clearAllMocks();
    const store = new Map<string, string>();
    vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) } });
    const state = { active: true, aesKey: '000102030405060708090a0b0c0d0e0f',
      balances: [100n, 50n], allowances: [100n, 50n] };
    const guard = vi.fn(async () => { if (!state.active) throw new Error('Session revoked'); });
    const signer = { sendTransaction: vi.fn(), estimateGas: vi.fn(), getNonce: vi.fn(async (_tag: string) => 4), getUserOnboardInfo: () => ({ aesKey: state.aesKey }) };
    const send = vi.fn(async (method: string, params: unknown[]) => {
      if (method === 'eth_gasPrice') return '0x2160ebc';
      if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
      if (method === 'eth_getBlockByNumber') return { number: '0x1e', hash: head.hash, timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`, gasLimit: '0x7270e00' };
      if (method !== 'eth_call') throw new Error('Unexpected RPC');
      const call = params[0] as { to: string; data: string };
      const index = CURRENT_CHEAP_POOL_TOKENS.findIndex(([at]) => getAddress(at) === getAddress(call.to));
      if (index < 0) throw new Error('Unexpected token');
      const parsed = currentTokenFundingAbi.parseTransaction({ data: call.data })!;
      const configuration: Record<string, unknown> = { faucetClaimed: false, faucetAmount: 10_000n * 10n ** 18n,
        decimals: 18n, publicAmountsEnabled: false, accountEncryptionAddress: `0x${'00'.repeat(20)}` };
      if (parsed.name in configuration) return currentTokenFundingAbi.encodeFunctionResult(parsed.name, [configuration[parsed.name]]);
      return parsed.name === 'balanceOf'
        ? token.encodeFunctionResult('balanceOf(address)', [[BigInt(index + 1), state.balances[index]]])
        : token.encodeFunctionResult('allowance(address,address)', [[
          [99n, 99n], [BigInt(index + 1), state.allowances[index]], [999n, 999n]
        ]]);
    });
    mocks.graph.mockResolvedValue({ graph: candidate.graph, packageSha256: candidate.packageSha256, core: candidate.core });
    mocks.decrypt.mockImplementation((_, ciphertext: { ciphertextHigh: bigint; ciphertextLow: bigint }) => {
      if (ciphertext.ciphertextHigh === 999n || ciphertext.ciphertextHigh === 99n) throw new Error('Wrong allowance ciphertext');
      return ciphertext.ciphertextLow;
    });
    mocks.issue.mockImplementation(async args => args.bindCapability({ assertCurrent: guard, assertSnapshotCurrent: () => {
      if (!state.active) throw new Error('Session revoked');
    }, chainId: BigInt(candidate.chainId), ownerAddress: owner, readProvider: { send }, signer }));
    const capability = await issueCurrentDexSubmissionCapability({ admission: null, nativePoolProfile } as never);
    const options = mocks.pool.mock.calls[mocks.pool.mock.calls.length - 1][0] as Parameters<typeof import('../../lib/currentDexPoolSubmission').createCurrentPoolSubmissionAdapter>[0];
    const prepared = { amounts: { used0: 100n, used1: 50n }, intent: { budgets: [120n, 60n] } };
    const limitOptions = mocks.limit.mock.calls[mocks.limit.mock.calls.length - 1][0] as Parameters<typeof import('../../lib/currentDexLimitSubmission').createCurrentLimitSubmissionAdapter>[0];
    return { state, guard, signer, send, capability, options, requireFunding: () => options.requireFunding(prepared as never, head),
      requireLimitFunding: (sellToken0: boolean) => limitOptions.requireFunding({ intent: { sellToken0, amount: sellToken0 ? 100n : 50n } } as never, head) };
  };

  it('keeps the Pool profile unset by default and forwards only explicit selection', async () => {
    expect((await fixture()).options.nativePoolProfile).toBeUndefined();
    expect((await fixture(CURRENT_NATIVE_POOL_PROFILE)).options.nativePoolProfile).toBe(CURRENT_NATIVE_POOL_PROFILE);
  });
  it.each([0, 1] as const)('rejects over-approval for token %s in the explicitly selected Pool profile', async index => {
    const f = await fixture(CURRENT_NATIVE_POOL_PROFILE);
    await expect(f.requireFunding()).resolves.toBeUndefined();
    f.state.allowances[index] += 1n;
    await expect(f.requireFunding()).rejects.toThrow('must equal');
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });

  it.each([0, 1] as const)('reads all current-token configuration and only owner envelopes at one canonical head, token %s', async index => {
    const f = await fixture(), result = await f.capability.readCurrentTokenFunding(index);
    const poolIndex = CURRENT_CHEAP_POOL_TOKENS.findIndex(([at]) => getAddress(at) === getAddress(candidate.tokens[index][0]));
    expect(result).toMatchObject({ tokenIndex: index, balance: f.state.balances[poolIndex], allowance: f.state.allowances[poolIndex], decimals: 18n, claimed: false });
    const reads = f.send.mock.calls.filter(([method]) => method === 'eth_call'); expect(reads).toHaveLength(7);
    for (const [, params] of reads) { expect(params[1]).toEqual({ blockHash: head.hash, requireCanonical: true });
      expect(getAddress((params[0] as { to: string }).to)).toBe(getAddress(candidate.tokens[index][0])); }
    expect(mocks.decrypt.mock.calls.map(([, cipher]) => cipher.ciphertextHigh)).toEqual([BigInt(poolIndex + 1), BigInt(poolIndex + 1)]);
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(['pending', 'gas', 'reserve', 'privacy'] as const)('blocks current-token %s before approval review or encryption', async fault => {
    const f = await fixture(); f.state.allowances.fill(0n);
    if (fault === 'pending') f.signer.getNonce.mockImplementation(async tag => tag === 'pending' ? 5 : 4);
    if (fault === 'privacy') f.state.aesKey = ' ';
    if (fault === 'gas' || fault === 'reserve') { const original = f.send.getMockImplementation()!;
      f.send.mockImplementation(async (method, params) => method === (fault === 'gas' ? 'eth_gasPrice' : 'eth_getBalance')
        ? (fault === 'gas' ? '0x2faf081' : '0x0') : original(method, params)); }
    const confirm = vi.fn(async () => false);
    await expect(f.capability.prepareCurrentTokenFunding({ tokenIndex: 0, action: 'approve', amount: 20n, confirm })).rejects.toThrow();
    expect(confirm).not.toHaveBeenCalled(); expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('can cancel exact current-token approval through the existing owner issuer without a signer prompt', async () => {
    const f = await fixture(); f.state.allowances.fill(0n); const confirm = vi.fn(async () => false);
    expect(await f.capability.prepareCurrentTokenFunding({ tokenIndex: 0, action: 'approve', amount: 20n, confirm })).toBeNull();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ amount: 20n, previousAllowance: 0n }));
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });

  it.each([true, false])('checks only the offered Limit token and owner allowance at one canonical head, direction=%s', async direction => {
    const f = await fixture();
    await expect(f.requireLimitFunding(direction)).resolves.toBeUndefined();
    expect(f.send).toHaveBeenCalledTimes(2);
    for (const [, params] of f.send.mock.calls) {
      expect(getAddress((params[0] as { to: string }).to)).toBe(getAddress(CURRENT_CHEAP_POOL_TOKENS[direction ? 0 : 1][0]));
      expect(params[1]).toEqual({ blockHash: head.hash, requireCanonical: true });
    }
    expect(mocks.decrypt.mock.calls.map(([, ciphertext]) => ciphertext.ciphertextHigh)).toEqual(direction ? [1n, 1n] : [2n, 2n]);
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });

  it.each([true, false])('rejects insufficient offered Limit funds in either direction=%s', async direction => {
    for (const kind of ['balances', 'allowances'] as const) {
      const f = await fixture(); f.state[kind][direction ? 0 : 1] -= 1n;
      await expect(f.requireLimitFunding(direction)).rejects.toThrow('insufficient');
      expect(f.signer.sendTransaction).not.toHaveBeenCalled();
    }
  });

  it('checks both token balances and owner allowances at the same canonical head for used amounts', async () => {
    const f = await fixture();
    await expect(f.requireFunding()).resolves.toBeUndefined();
    expect(f.send).toHaveBeenCalledTimes(4);
    for (const [index, [method, params]] of f.send.mock.calls.entries()) {
      expect(method).toBe('eth_call');
      const call = params[0] as { from: string; to: string; data: string };
      expect(call.from).toBe(owner);
      expect(getAddress(call.to)).toBe(getAddress(CURRENT_CHEAP_POOL_TOKENS[Math.floor(index / 2)][0]));
      expect(params[1]).toEqual({ blockHash: head.hash, requireCanonical: true });
      const parsed = token.parseTransaction({ data: call.data })!;
      expect(parsed.name).toBe(index % 2 === 0 ? 'balanceOf' : 'allowance');
      expect(parsed.args[0]).toBe(getAddress(owner));
      if (index % 2 === 1) expect(parsed.args[1]).toBe(getAddress(candidate.core));
    }
    expect(mocks.graph).toHaveBeenCalledTimes(2);
    for (const [request] of mocks.graph.mock.calls) expect(request).toMatchObject({ candidate: 'cheap-current', blockNumber: head.number, blockHash: head.hash });
    expect(mocks.decrypt).toHaveBeenCalledTimes(4);
    expect(mocks.decrypt.mock.calls.map(([, ciphertext]) => ciphertext.ciphertextHigh)).toEqual([1n, 1n, 2n, 2n]);
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });

  it.each([[0, 'balance'], [1, 'balance'], [0, 'allowance'], [1, 'allowance']] as const)(
    'rejects insufficient token %s %s', async (index, kind) => {
      const f = await fixture();
      (kind === 'balance' ? f.state.balances : f.state.allowances)[index] -= 1n;
      await expect(f.requireFunding()).rejects.toThrow('insufficient');
      expect(f.signer.sendTransaction).not.toHaveBeenCalled();
    }
  );

  it.each(['locked', 'revoked', 'read-revoked', 'malformed', 'suffix', 'graph'])('rejects %s funding evidence', async fault => {
    const f = await fixture();
    if (fault === 'locked') f.state.aesKey = ' ';
    if (fault === 'revoked') f.state.active = false;
    if (fault === 'read-revoked') f.send.mockImplementationOnce(async () => { f.state.active = false; return '0x'; });
    if (fault === 'malformed') f.send.mockResolvedValueOnce('0x');
    if (fault === 'suffix') f.send.mockResolvedValueOnce(token.encodeFunctionResult('balanceOf(address)', [[1n, 100n]]) + '00');
    if (fault === 'graph') mocks.graph.mockRejectedValueOnce(new Error('Graph changed'));
    await expect(f.requireFunding()).rejects.toThrow();
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
    if (fault === 'locked' || fault === 'revoked') expect(f.send).not.toHaveBeenCalled();
    if (fault === 'read-revoked' || fault === 'malformed' || fault === 'suffix') expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it('treats an unset owner allowance as zero without decrypting its spender ciphertext', async () => {
    const f = await fixture();
    f.send.mockResolvedValueOnce(token.encodeFunctionResult('balanceOf(address)', [[1n, 100n]]))
      .mockResolvedValueOnce(token.encodeFunctionResult('allowance(address,address)', [[[99n, 99n], [0n, 0n], [999n, 999n]]]));
    await expect(f.requireFunding()).rejects.toThrow('insufficient');
    expect(mocks.decrypt).toHaveBeenCalledTimes(1);
    expect(mocks.decrypt.mock.calls[0][1].ciphertextHigh).toBe(1n);
    expect(mocks.decrypt.mock.calls[0][1].ciphertextLow).toBe(100n);
  });
});


describe('saved six-market candidate recovery dispatch', () => {
  it.each([
    ['cheap-exit', 'cheap-d06'], ['cheap-exit', 'cheap-current'],
    ['cheap-prepared', 'cheap-d06'], ['cheap-prepared', 'cheap-current']
  ] as const)('keeps %s recovery on its original candidate after selecting %s', async (savedKey, selectedKey) => {
    vi.clearAllMocks();
    const saved = resolveCurrentCheapDexCandidate(savedKey), owner = `0x${'22'.repeat(20)}`;
    const txHash = toBeHex(91n, 32), pending = { version: 1, chainId: saved.chainId.toString(), owner,
      core: saved.core, graph: `0x${saved.graph}`, phase: 'quote', callHash: toBeHex(92n, 32), nonce: 3, txHash };
    const values = new Map([[CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify(pending)]]);
    vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
    const send = vi.fn(), signer = { sendTransaction: vi.fn(), estimateGas: vi.fn(), getNonce: vi.fn() };
    mocks.issue.mockImplementation(async args => args.bindCapability({ assertCurrent: vi.fn(), assertSnapshotCurrent: vi.fn(),
      chainId: BigInt(saved.chainId), ownerAddress: owner, readProvider: { send }, signer }));
    mocks.archivedRecover.mockResolvedValue({ status: 'quote-confirmed', readyToSign: false, privateAccountingVerified: false });
    const capability = await issueCurrentDexSubmissionCapability({ candidate: selectedKey, admission: null } as never);
    await expect(capability.recoverPendingCurrentCheapAttempt(txHash)).resolves.toMatchObject({ readyToSign: false, privateAccountingVerified: false });
    expect(mocks.archived).toHaveBeenCalledWith(expect.objectContaining({ candidate: savedKey, signer, ownerAddress: owner }));
    expect(mocks.archivedRecover).toHaveBeenCalledWith(txHash);
    expect(values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(JSON.stringify(pending));
    expect(send).not.toHaveBeenCalled(); expect(signer.sendTransaction).not.toHaveBeenCalled();
    expect(signer.estimateGas).not.toHaveBeenCalled(); expect(signer.getNonce).not.toHaveBeenCalled();
  });
  it.each(['unknown-graph', 'wrong-core'])('rejects %s without selecting a fallback', async fault => {
    vi.clearAllMocks();
    const saved = STAGED_EXIT_PREVIEW_DEX_CANDIDATE, owner = `0x${'22'.repeat(20)}`, txHash = toBeHex(91n, 32);
    const pending = { version: 1, chainId: saved.chainId.toString(), owner,
      core: fault === 'wrong-core' ? `0x${'33'.repeat(20)}` : saved.core,
      graph: fault === 'unknown-graph' ? toBeHex(93n, 32) : `0x${saved.graph}`,
      phase: 'quote', callHash: toBeHex(92n, 32), nonce: 3, txHash };
    vi.stubGlobal('window', { sessionStorage: { getItem: () => JSON.stringify(pending) } });
    const send = vi.fn(), signer = { sendTransaction: vi.fn(), estimateGas: vi.fn(), getNonce: vi.fn() };
    mocks.issue.mockImplementation(async args => args.bindCapability({ assertCurrent: vi.fn(), assertSnapshotCurrent: vi.fn(),
      chainId: BigInt(saved.chainId), ownerAddress: owner, readProvider: { send }, signer }));
    const capability = await issueCurrentDexSubmissionCapability({ candidate: 'cheap-d06', admission: null } as never);
    await expect(capability.recoverPendingCurrentCheapAttempt(txHash)).rejects.toThrow('unknown candidate');
    expect(mocks.archived).not.toHaveBeenCalled(); expect(mocks.archivedRecover).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled(); expect(signer.sendTransaction).not.toHaveBeenCalled();
  });
});

describe('native resource RPC issuer wiring', () => {
  it.each(['none','head','chain','code','quantity','lease','missing-base-fee','base-fee-change'])('uses canonical owner-bound raw reads and handles %s', async fault => {
    vi.clearAllMocks();
    const owner=`0x${'22'.repeat(20)}`, head={number:30n,hash:toBeHex(77n,32),timestamp:100n,gasLimit:120_000_000n};
    let active=true,blocks=0;
    const guard=vi.fn(async()=>{if(!active)throw new Error('Lease revoked');});
    const block={number:'0x1e',hash:head.hash,timestamp:'0x64',gasLimit:'0x7270e00',baseFeePerGas:'0x1'};
    const send=vi.fn(async(method:string,_params:unknown[])=>{
      if(method==='eth_getBlockByNumber'){blocks++;return fault==='head'&&blocks===2?{...block,hash:toBeHex(99n,32)}:
        fault==='missing-base-fee'?{...block,baseFeePerGas:undefined}:fault==='base-fee-change'&&blocks===2?{...block,baseFeePerGas:'0x2'}:block;}
      if(method==='eth_chainId')return fault==='chain'?'0x1':'0x6c11a0';
      if(method==='eth_getTransactionCount')return fault==='quantity'?'4':'0x4';
      if(method==='eth_gasPrice'){if(fault==='lease')active=false;return '0x2faf080';}
      if(method==='eth_getBalance')return '0xde0b6b3a7640000';
      if(method==='eth_getCode')return fault==='code'?'0x00':'0x';
      throw new Error('Unexpected RPC');
    });
    const sendTransaction=vi.fn(),estimateGas=vi.fn(),getNonce=vi.fn(async()=>4);
    mocks.issue.mockImplementation(async args=>args.bindCapability({assertCurrent:guard,assertSnapshotCurrent:()=>{if(!active)throw new Error('Lease revoked');},
      chainId:7082400n,ownerAddress:owner,readProvider:{send},signer:{sendTransaction,estimateGas,getNonce}}));
    await issueCurrentDexSubmissionCapability({admission:null,candidate:'cheap-native'} as never);
    const transport=mocks.pool.mock.calls[mocks.pool.mock.calls.length - 1][0].transport;
    if(fault==='none'){
      await expect(transport.readNativeResources(head)).resolves.toMatchObject({owner,chainId:7082400n,head,latestNonce:4,pendingNonce:4,gasPrice:50_000_000n,baseFeePerGas:1n,balance:10n**18n,code:'0x'});
      expect(send.mock.calls).toEqual([
        ['eth_getBlockByNumber',['0x1e',false]],['eth_chainId',[]],
        ['eth_getTransactionCount',[owner,'latest']],['eth_getTransactionCount',[owner,'pending']],['eth_gasPrice',[]],
        ['eth_getBalance',[owner,{blockHash:head.hash,requireCanonical:true}]],['eth_getCode',[owner,{blockHash:head.hash,requireCanonical:true}]],
        ['eth_getBlockByNumber',['0x1e',false]]
      ]);
      expect(guard).toHaveBeenCalledTimes(16);
    }else await expect(transport.readNativeResources(head)).rejects.toThrow();
    expect(sendTransaction).not.toHaveBeenCalled();expect(estimateGas).not.toHaveBeenCalled();expect(getNonce).not.toHaveBeenCalled();
  });
});
