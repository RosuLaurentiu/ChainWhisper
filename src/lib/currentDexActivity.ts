import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import type { SharedWalletSession } from './walletSession';
import type { CurrentDexActivityCursor } from './currentDexActivityDiscovery';
import type { CurrentDexActivityRow } from './currentDexActivityReceipt';
import type { CurrentDexLimitFill } from './currentDexLimitFillHistory';

export const buildCurrentDexActivityEntries = (rows: readonly CurrentDexActivityRow[], fills: readonly CurrentDexLimitFill[] = []) => {
  type Entry = Omit<CurrentDexActivityRow, 'hash' | 'kind' | 'core'> & { key: string; hash?: string; core?: string;
    kind: CurrentDexActivityRow['kind'] | 'limit-fill'; transactions?: readonly CurrentDexActivityRow[] };
  const entries: Entry[] = [], used = new Set<string>();
  for(const quote of rows.filter(row=>row.kind==='async-quote'||row.kind==='fast-quote')) {
    if(quote.operationId===undefined||quote.status==='Failed'||!quote.inputToken||!quote.outputToken)continue;
    const fast=quote.kind==='fast-quote', group=rows.filter(row=>row.core.toLowerCase()===quote.core.toLowerCase()&&row.operationId===quote.operationId&&row.status!=='Failed'&&
      (fast?['fast-quote','fast-delivery']:['async-quote','async-funding','async-delivery','cancel','recover']).includes(row.kind));
    const terminal=group.find(row=>['fast-delivery','async-delivery','cancel','recover'].includes(row.kind));
    const funding=fast?terminal:group.find(row=>row.kind==='async-funding');
    const anchor=terminal??funding??quote;
    let movements=anchor.movements,status=!terminal&&quote.currentStatus?quote.currentStatus:anchor.status;
    if(terminal?.kind==='cancel'){status='Quote cancelled';movements=[];}
    else if(terminal&&funding){
      const debit=funding.movements.find(m=>m.token===quote.inputToken), refundLeg=terminal.movements.find(m=>m.token===quote.inputToken),outputLeg=terminal.movements.find(m=>m.token===quote.outputToken);
      const recovery=terminal.kind==='recover',paid=debit?.paid,refund=refundLeg?.received,output=recovery?0n:outputLeg?.received;
      if(paid===undefined||paid<=0n||refund===undefined||output===undefined||terminal.movements.length!==(recovery?1:2)||
          !fast&&(funding.movements.length!==1||debit!.received!==0n||terminal.movements.some(m=>m.paid!==0n))||
          refund>paid||(paid===refund)!==(output===0n)||recovery&&refund!==paid||outputLeg&&outputLeg.paid!==0n) {
        status='Amounts unavailable';movements=[];
      } else {
        movements=[{token:quote.inputToken,paid:paid-refund,received:refund},{token:quote.outputToken,paid:0n,received:output}];
        status=terminal.kind==='recover'?'Recovered; refunded':output===0n?'No fill; refunded':refund>0n?'Partially filled':'Delivered';
      }
    } else if(terminal){status='Amounts unavailable';movements=[];}
    group.forEach(row=>used.add(row.hash));
    entries.push({...anchor,key:anchor.hash,action:terminal?.kind==='cancel'?(fast?'Fast Quote':'Multi-source Quote'):(fast?'Fast swap':'Multi-source swap'),
      status,movements,amountsState:movements.length?'verified':'none',inputToken:quote.inputToken,outputToken:quote.outputToken,transactions:group});
  }
  entries.push(...rows.filter(row=>!used.has(row.hash)).map(row=>({...row,key:row.hash})));
  entries.push(...fills.map(fill => ({ key: `limit:${fill.engine}:${fill.record}`, kind: 'limit-fill' as const,
    blockNumber: Number(fill.blockNumber), blockHash: fill.blockHash, timestamp: fill.timestamp, positionId: fill.positionId,
    action: 'Limit execution', status: 'Executed', amountsState: 'verified' as const, readyToSign: false as const, nativeAdmission: false as const,
    movements: [{ token: fill.soldToken, paid: fill.sold, received: 0n }, { token: fill.receivedToken, paid: 0n, received: fill.received }] })));
  return entries.sort((a,b)=>b.blockNumber-a.blockNumber||a.key.localeCompare(b.key));
};

export const readCurrentDexActivityPage = async (session: SharedWalletSession, candidateKey: CurrentCheapDexCandidateKey,
  assertCurrent: () => void, options: { cursor: CurrentDexActivityCursor; head?: { number: bigint; hash: string };
    onProgress?: (checked: number, total: number) => void }) => {
  assertCurrent();
  const candidate = resolveCurrentCheapDexCandidate(candidateKey), getSender = session.actions?.getCurrentDexSubmissionCapability;
  if (!['cheap-exit', 'cheap-history'].includes(candidateKey) || session.chainId !== Number(candidate.chainId) || !getSender) throw new Error('Connect the owner wallet on COTI Testnet to read activity.');
  const sender = await getSender(BigInt(candidate.chainId), { candidate: candidateKey }); assertCurrent();
  const page = await sender.readCurrentDexActivityPage({ ...options, onProgress: (checked,total) => { assertCurrent(); options.onProgress?.(checked,total); } });
  assertCurrent(); return page;
};

type Sender = Awaited<ReturnType<NonNullable<NonNullable<SharedWalletSession['actions']>['getCurrentDexSubmissionCapability']>>>;
type Amounts = Awaited<ReturnType<Sender['readCurrentCheapActivityReceipt']>>['amounts'];
export type CurrentDexActivitySwap = Readonly<{
  operationId: bigint; quoteHash: string; inputToken: string; outputToken: string;
  mode: 'cheap-async'; status: string; quoteBlock: bigint; unusedInput: boolean;
  originalQuoteRateVerification: 'unavailable';
  amounts: Pick<Amounts, 'filled' | 'actualInput' | 'netOutput' | 'refund'> | null;
}>;

// Read accounting without restoring signing state; never seed history from reports.
export const readCurrentDexActivitySwap = async (
  session: SharedWalletSession, candidateKey: CurrentCheapDexCandidateKey, assertCurrent: () => void
): Promise<CurrentDexActivitySwap | null> => {
  assertCurrent();
  if (candidateKey !== 'cheap-exit') throw new Error('Saved private history is unavailable for this candidate.');
  const candidate = resolveCurrentCheapDexCandidate(candidateKey), actions = session.actions;
  if (session.chainId !== Number(candidate.chainId) || !actions?.getCurrentDexSubmissionCapability || !actions.getCurrentDexQuoteCapability) {
    throw new Error('Connect the owner wallet on COTI Testnet to read private activity.');
  }
  const sender = await actions.getCurrentDexSubmissionCapability(BigInt(candidate.chainId), { candidate: candidateKey });
  assertCurrent();
  const hint = sender.readCurrentCheapRestoreHint();
  if (!hint) return null;
  if (!hint.quoteHash) throw new Error('The saved signing request has no known Quote hash. Check its status first.');
  const reader = await actions.getCurrentDexQuoteCapability(BigInt(candidate.chainId));
  assertCurrent();
  const issued = await reader.restoreCurrentQuote({ quoteHash: hint.quoteHash });
  assertCurrent();
  const current = await issued.readCurrent();
  assertCurrent();
  let exact = false;
  try { exact = resolvePreparedDexScope(current.intent.candidate).key === candidateKey; } catch { /* Reject changed identity. */ }
  if (!exact || current.intent.profile !== 'cheap-async' || current.transactionHash.toLowerCase() !== hint.quoteHash.toLowerCase() ||
      current.intent.destination.toLowerCase() !== session.walletAddress.toLowerCase()) throw new Error('Saved activity identity changed.');
  const base = { operationId: current.operationId, quoteHash: current.transactionHash, inputToken: current.intent.inputToken,
    outputToken: current.intent.outputToken, mode: 'cheap-async' as const, quoteBlock: current.originBlock.number,
    originalQuoteRateVerification: 'unavailable' as const };
  if (![7, 8].includes(current.operation.stage ?? 0)) return Object.freeze({ ...base, amounts: null, unusedInput: false,
    status: current.operation.stage === 5 ? 'Quote ready; not a completed trade' : current.operation.stage === 6 ? 'Confirmed; private result pending' : 'Preparing Quote' });
  const receipt = await sender.readCurrentCheapActivityReceipt(current);
  assertCurrent();
  if (!receipt.privateAccountingVerified || receipt.readyToSign !== false || receipt.nativeAdmission !== false ||
      receipt.originalQuoteRateVerification !== 'unavailable' || receipt.kind !== 'terminal' || ![7, 8].includes(receipt.operation.stage ?? 0) ||
      receipt.operation.stage === 8 && !receipt.releaseAction) throw new Error('Private activity result is not terminal.');
  const a = receipt.amounts, unusedInput = receipt.releaseAction === 'cancel';
  const status = unusedInput ? 'Quote cancelled' : receipt.releaseAction === 'recover' ? 'Recovered; refunded' :
    !a.filled ? 'No fill; refunded' : a.actualInput < current.intent.maximumInput ? 'Partially filled' : 'Delivered';
  return Object.freeze({ ...base, status, unusedInput,
    amounts: Object.freeze({ filled: a.filled, actualInput: a.actualInput, netOutput: a.netOutput, refund: a.refund }) });
};
