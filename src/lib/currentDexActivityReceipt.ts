import { Interface, getAddress } from '@coti-io/coti-ethers';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { CURRENT_SLIPPAGE_DEX_QUOTE_ABI } from './currentDexOperation';
import { PREPARED_POOL_FUNDING_ABI } from './currentDexPoolFunding';
import { CURRENT_POOL_POSITION_ABI } from './currentDexPoolPosition';
import { preparedLimitAbi } from './currentDexLimit';
import { currentTokenFundingAbi } from './currentDexTokenFunding';
import { currentSharedTokenFundingAbi } from './currentSharedDexTokenFunding';
import { CURRENT_SHARED_TOKEN_DISTRIBUTION } from './currentSharedDexTokenDistribution';
import { currentDexOwnerTransferAbi } from './currentDexOwnerTokenProof';
import type { PrivateUint256Output } from './privateUint256';
import type { CurrentTransport, MinedReceipt } from './currentDexSubmission';
import type { CurrentDexActivityCandidate } from './currentDexActivityDiscovery';

type Transaction = NonNullable<Awaited<ReturnType<CurrentTransport['readTransaction']>>>;
export type CurrentDexActivityMovement = Readonly<{ token: string; paid: bigint; received: bigint }>;
export type CurrentDexActivityRow = Readonly<{
  core: string; hash: string; blockNumber: number; blockHash: string; timestamp: bigint; action: string; status: string;
  kind: 'action' | 'async-quote' | 'fast-quote' | 'async-funding' | 'fast-delivery' | 'async-delivery' | 'cancel' | 'recover';
  operationId?: bigint; positionId?: bigint; inputToken?: string; outputToken?: string;
  currentStatus?: string; // Public state at the History head; not private settlement proof.
  movements: readonly CurrentDexActivityMovement[]; amountsState: 'verified' | 'none';
  readyToSign: false; nativeAdmission: false;
}>;
const ct = '((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature)', small = '(uint256 ciphertext,bytes signature)';
const coreAbi = new Interface([...new Set([
  ...CURRENT_SLIPPAGE_DEX_QUOTE_ABI, ...PREPARED_POOL_FUNDING_ABI, ...CURRENT_POOL_POSITION_ABI,
  ...preparedLimitAbi.fragments.map(f => f.format('full')),
  'function acceptFastPool(uint256 quoteId,bytes32 expectedContext)', 'function acceptPrivateSwapV1(uint256 operationId,bytes32 expectedContext)',
  'function advanceFixedWork(uint256 operationId)', 'function cancelSwap(uint256 operationId)', 'function recoverSwap(uint256 operationId)',
  `function topUpPrivateOrder(uint256 positionId,uint256 expectedTermsRevision,uint256 expectedLifecycleRevision,${ct} encryptedAmount)`,
  `function repricePrivateOrder(uint256 positionId,uint256 expectedTermsRevision,${small}[5] encryptedFixedTerms,${ct}[3] encryptedRangeTerms)`,
  'function c1(uint8 action,bytes data)', 'function c1ForMarket(bytes32 selectedMarket,uint8 action,bytes data)',
  'function matchLimitPage(bytes32 selectedMarket,bytes32 expectedContext)',
  'event SharedClaimCreated(uint256 indexed positionId)'
])]);
const nftAbi = new Interface(['function safeTransferFrom(address,address,uint256)',
  'function safeTransferFrom(address,address,uint256,bytes)', 'function transferFrom(address,address,uint256)',
  'function approve(address,uint256)', 'function setApprovalForAll(address,bool)',
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
const same = (a: string | null | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();

// Historical token movements only. Signing, budget release and execution proof stay in their existing paths.
export const readCurrentDexActivityReceipt = async ({ candidate, owner, transaction: tx, receipt, timestamp,
  verifyCanonical, assertCurrent, decrypt, ownerOperation }: {
  candidate: CurrentDexActivityCandidate; owner: string; transaction: Transaction; receipt: MinedReceipt; timestamp: bigint;
  verifyCanonical: () => Promise<void>; assertCurrent: () => void | Promise<void>;
  decrypt: (value: PrivateUint256Output) => bigint; ownerOperation?: CurrentDexActivityRow;
}): Promise<CurrentDexActivityRow | null> => {
  if (!['cheap-exit', 'cheap-history'].includes(candidate)) throw new Error('DEX activity candidate is unavailable.');
  const c = resolvePreparedDexScope(candidate).candidate, account = getAddress(owner), core = c.core;
  const nft = c.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1];
  if (!same(tx.hash, receipt.hash) || tx.chainId !== BigInt(c.chainId) || tx.value !== 0n ||
      tx.blockNumber !== receipt.blockNumber || !same(tx.blockHash, receipt.blockHash ?? '') ||
      !same(tx.from, receipt.from) || !same(tx.to, receipt.to ?? '') || !Number.isSafeInteger(receipt.blockNumber) ||
      !receipt.blockHash || timestamp < 0n || timestamp > 8_640_000_000_000n || (receipt.status !== 0 && receipt.status !== 1)) throw new Error('DEX history transaction identity changed.');
  const token = c.tokens.find(([address]) => same(tx.to, address))?.[0];
  if (!same(tx.to, core) && !same(tx.to, nft) && !token && !same(tx.to, CURRENT_SHARED_TOKEN_DISTRIBUTION.vault.address)) {
    throw new Error('DEX history target is outside the selected deployment.');
  }
  await assertCurrent(); await verifyCanonical(); await assertCurrent();
  const abi = token ? currentTokenFundingAbi : same(tx.to, nft) ? nftAbi : same(tx.to, core) ? coreAbi : currentSharedTokenFundingAbi;
  const call = abi.parseTransaction({ data: tx.data, value: tx.value });
  if (!call || abi.encodeFunctionData(call.fragment, call.args).toLowerCase() !== tx.data.toLowerCase()) return null;
  const name = call.name, args = call.args;
  let action = '', kind: CurrentDexActivityRow['kind'] = 'action', operationId: bigint | undefined, positionId: bigint | undefined;
  let inputToken: string | undefined, outputToken: string | undefined;
  if (same(tx.to, nft)) {
    const transfer = (receipt.logs ?? []).filter(l => same(l.address, nft) && same(l.topics[0], nftAbi.getEvent('Transfer')!.topicHash))
      .map(l => { const e = nftAbi.parseLog({ topics: [...l.topics], data: l.data })!; const encoded = nftAbi.encodeEventLog(e.fragment, e.args);
        if (encoded.data.toLowerCase() !== l.data.toLowerCase() || encoded.topics.some((t, i) => !same(t, l.topics[i] ?? ''))) throw new Error('NFT history encoding changed.'); return e.args; });
    const related = transfer.filter(e => same(e.from, account) || same(e.to, account));
    if (related.length === 1) { positionId = related[0].tokenId; action = same(related[0].to, account) ? 'Position NFT received' : 'Position NFT transferred'; }
    else if (same(tx.from, account) && ['approve', 'setApprovalForAll'].includes(name)) action = 'Position NFT approval';
    else if (receipt.status === 0 && same(tx.from, account)) action = 'Position NFT transfer';
    else throw new Error('NFT history does not belong to the selected owner.');
  } else {
    const ownedTerminal = ownerOperation?.kind === 'async-quote' && same(ownerOperation.core, core) && same(tx.to, core) &&
      ['advanceFixedWork', 'cancelSwap', 'recoverSwap'].includes(name) && args[0] === ownerOperation.operationId;
    if (!same(tx.from, account) && !ownedTerminal) throw new Error('DEX history owner changed.');
    if (token) {
      if (name === 'claimFaucet') action = 'Token claim';
      else if (name === 'approve' && same(args[0], core)) action = 'Token allowance';
      else return null;
    } else if (!same(tx.to, core)) { if (name !== 'claim' || !c.tokens.some(([a]) => same(args[0], a))) return null; action = 'Token refill'; }
    else if (name === 'quoteCheapAsync' || name === 'quoteFastPool') {
      kind = name === 'quoteCheapAsync' ? 'async-quote' : 'fast-quote'; action = kind === 'async-quote' ? 'Multi-source Quote' : 'Fast Quote';
      const q = kind === 'async-quote' ? args[0] : args; inputToken = String(q[0]).toLowerCase(); outputToken = String(q[1]).toLowerCase();
      const eventName = kind === 'async-quote' ? 'CheapAsyncAdvanced' : 'FastPoolQuoteIssued';
      const events = (receipt.logs ?? []).filter(l => same(l.address, core) && same(l.topics[0], coreAbi.getEvent(eventName)!.topicHash));
      if (receipt.status === 1) { if (events.length !== 1) throw new Error('Quote history event is ambiguous.'); operationId = coreAbi.parseLog({topics:[...events[0].topics],data:events[0].data})!.args.quoteId; }
    } else if (['acceptFastPool', 'acceptPrivateSwapV1', 'advanceFixedWork', 'cancelSwap', 'recoverSwap'].includes(name)) {
      operationId = args[0];
      kind = name === 'acceptFastPool' ? 'fast-delivery' : name === 'acceptPrivateSwapV1' ? 'async-funding' : name === 'advanceFixedWork' ? 'async-delivery' : name === 'cancelSwap' ? 'cancel' : 'recover';
      action = { 'fast-delivery': 'Fast swap', 'async-funding': 'Swap funding', 'async-delivery': 'Swap delivery', cancel: 'Quote cancellation', recover: 'Swap recovery' }[kind];
      if (kind !== 'fast-delivery' && receipt.status === 1) {
        const matches = (receipt.logs ?? []).filter(l => same(l.address, core) && same(l.topics[0], coreAbi.getEvent('CheapAsyncAdvanced')!.topicHash));
        const e = matches.length === 1 ? coreAbi.parseLog({topics:[...matches[0].topics],data:matches[0].data}) : null;
        const expected = kind === 'async-funding' ? 6n : kind === 'async-delivery' ? 7n : 8n;
        if (!e || e.args.quoteId !== operationId || e.args.stage !== expected || kind === 'async-funding' && e.args.context !== args[1]) throw new Error('Swap history operation changed.');
      }
    } else {
      const actions: Record<string, string> = { createPoolPosition:'Pool created',previewPoolFunding:'Pool funding preview',poolSnapshot:'Pool snapshot',
        createPrivateOrder:'Limit created',topUpPrivateOrder:'Limit funded',repricePrivateOrder:'Limit repriced',privateOrderSnapshot:'Limit snapshot',
        claimPrivateOrderProceeds:'Limit proceeds claimed',closePrivateOrder:'Limit closed',matchLimitPage:'Limit matching',c1:'C1 operation',c1ForMarket:'C1 operation' };
      action = actions[name] ?? '';
      if (name === 'managePoolPosition') { positionId = args[0]; action = ({0:'Pool funded',1:'Pool withdrawal',5:'Pool resumed',6:'Pool activated',7:'Pool closed',11:'Pool withdrawal preview',12:'Pool withdrawal'} as Record<number,string>)[Number(args[2])] ?? 'Pool control'; }
      else if (name === 'managePrivateOrderStatus') { positionId = args[0]; action = Number(args[2]) === 0 ? 'Limit paused' : 'Limit resumed'; }
      else if (['topUpPrivateOrder','repricePrivateOrder','privateOrderSnapshot','poolSnapshot','claimPrivateOrderProceeds','closePrivateOrder'].includes(name)) positionId = args[0];
      if (!action) return null;
      if (['createPoolPosition','createPrivateOrder'].includes(name) && receipt.status === 1) {
        const event = name === 'createPoolPosition' ? 'SharedClaimCreated' : 'FixedPositionCreated';
        const matches = (receipt.logs ?? []).filter(l => same(l.address,core) && same(l.topics[0],coreAbi.getEvent(event)!.topicHash));
        if(matches.length!==1)throw new Error('Position history event is ambiguous.');
        positionId=coreAbi.parseLog({topics:[...matches[0].topics],data:matches[0].data})!.args.positionId;
      }
    }
  }
  if (receipt.status === 0 && receipt.logs?.length) throw new Error('Reverted history receipt has logs.');
  const movements = new Map<string, {token:string;paid:bigint;received:bigint}>();
  if (receipt.status === 1) for (const log of receipt.logs ?? []) {
    const token = c.tokens.find(([a]) => same(a, log.address))?.[0];
    if (!token || !same(log.topics[0], currentDexOwnerTransferAbi.getEvent('Transfer')!.topicHash)) continue;
    const e = currentDexOwnerTransferAbi.parseLog({ topics:[...log.topics], data:log.data })!, encoded = currentDexOwnerTransferAbi.encodeEventLog(e.fragment,e.args);
    if (encoded.data.toLowerCase() !== log.data.toLowerCase() || encoded.topics.length !== log.topics.length || encoded.topics.some((t,i)=>!same(t,log.topics[i]??''))) throw new Error('Private history event encoding changed.');
    const row = movements.get(token) ?? {token,paid:0n,received:0n};
    for (const [party,field,side] of [[e.args.from,e.args.senderValue,'paid'],[e.args.to,e.args.receiverValue,'received']] as const) {
      if(!same(party,account))continue;
      await assertCurrent(); const amount = decrypt(field); await assertCurrent();
      if(typeof amount!=='bigint'||amount<0n||amount>=1n<<256n)throw new Error('Invalid private history amount.');
      row[side]+=amount; movements.set(token,row);
    }
  }
  if (receipt.status === 1 && ['Token claim','Token refill'].includes(action)) {
    const initial = action === 'Token claim', expectedToken = initial ? token! : String(args[0]).toLowerCase();
    const credit = movements.get(expectedToken);
    const claims = (receipt.logs ?? []).filter(l => same(l.address,initial ? expectedToken : CURRENT_SHARED_TOKEN_DISTRIBUTION.vault.address) &&
      same(l.topics[0],currentSharedTokenFundingAbi.getEvent(initial?'FaucetClaimed':'Claimed')!.topicHash));
    const claim = claims.length === 1 ? currentSharedTokenFundingAbi.parseLog({topics:[...claims[0].topics],data:claims[0].data}) : null;
    if (!credit || movements.size !== 1 || credit.paid !== 0n || credit.received !== (initial ? CURRENT_SHARED_TOKEN_DISTRIBUTION.initialAmount : CURRENT_SHARED_TOKEN_DISTRIBUTION.refillAmount) ||
        !claim || !same(claim.args.account,account) || !initial && !same(claim.args.token,expectedToken)) throw new Error('Funding history credit is unavailable.');
  }
  await verifyCanonical(); await assertCurrent();
  return Object.freeze({ core,hash:tx.hash.toLowerCase(), blockNumber:receipt.blockNumber!,blockHash:receipt.blockHash,timestamp,action,
    status:receipt.status===0?'Failed':kind==='async-funding'?'Funded; awaiting delivery':kind.endsWith('quote')?'Quote submitted':'Confirmed',
    kind,operationId,positionId,inputToken,outputToken,movements:Object.freeze([...movements.values()].map(r=>Object.freeze(r))),
    amountsState:movements.size?'verified':'none',readyToSign:false,nativeAdmission:false });
};
