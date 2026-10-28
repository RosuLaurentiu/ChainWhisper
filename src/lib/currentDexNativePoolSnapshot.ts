import { AbiCoder, Interface, keccak256, toBeHex } from '@coti-io/coti-ethers';
import { STAGED_NATIVE_DEX_CANDIDATE as native, type CurrentCheapDexCandidate } from './dexV2Deployment';
import { CurrentPoolProofMismatch } from './currentDexPoolProofError';
import { checkCurrentPoolPositionValues } from './currentDexPoolPosition';
import type { PrivateUint256Output } from './privateUint256';

// Derived from the exact compiled Core/PoolOwner layout, graph0f49df36....
// Ciphertexts remain private-session data. No recomputing eth_call fallback.
export const CURRENT_NATIVE_POOL_LAYOUT = Object.freeze({ marketMapping: 1n, marketId: 6n,
  marketWords: 71, positionMapping: 15n, positionWords: 64, context: 13,
  snapshot: 14, stride: 4, user: 2, shares: 60, closeOwner: 12,
  anchorIds: 18, sharedTotals: 25, math: 16, mathRuntime: 17 });
export const currentNativePoolSnapshotAbi = new Interface([
  'function poolSnapshot(uint256)',
  'event PoolSnapshotRefreshed(uint256 indexed positionId,bytes32 context,(uint256 ciphertextHigh,uint256 ciphertextLow)[10] userValues)',
  'event SharedClaimCreated(uint256 indexed positionId)'
]);
export type CurrentPoolBlock = Readonly<{ number: bigint; hash: string }>;
export type CurrentPoolStoredState = Readonly<{ market: readonly string[]; anchors: readonly (readonly string[])[];
  protectedClaim: readonly string[]; protectedOwner:string; protectedStatus:bigint; existingClaims: Readonly<Record<string,readonly string[]>>;
  core: readonly string[]; engine: readonly string[]; limitDirectory:readonly string[];
  ledgers: readonly (readonly string[])[]; escrows:readonly (readonly string[])[];
  claim: readonly string[]; counter: bigint; operation: bigint }>;
export type CurrentPoolSnapshotProducer = Readonly<{ kind: 'fund' | 'snapshot'; positionId: bigint;
  transactionHash: string; context: string; block: CurrentPoolBlock; status: bigint;
  amounts: ReturnType<typeof checkCurrentPoolPositionValues>; readyToSign: false }>;
type Log = Readonly<{ address: string; topics: readonly string[]; data: string }>;
type Canonical = Readonly<{ block: CurrentPoolBlock; logs: readonly Log[]; data: string }>;
const produced = new WeakMap<object, { signer: object; state: CurrentPoolStoredState; canonical: Canonical }>();
const same = (a: unknown, b: unknown) => JSON.stringify(a, (_, v) => typeof v === 'bigint' ? v.toString() : v) ===
  JSON.stringify(b, (_, v) => typeof v === 'bigint' ? v.toString() : v);
export const requireCurrentPoolProof = (ok: boolean, message: string): void => {
  if (!ok) throw new CurrentPoolProofMismatch(message);
};
export const currentPoolPositionStorageBase = (marketBase: bigint, id: bigint) => BigInt(keccak256(
  AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256'], [id, marketBase + CURRENT_NATIVE_POOL_LAYOUT.positionMapping])));
export const currentPoolStoredEnvelopes = (claim: readonly string[]) => {
  requireCurrentPoolProof(claim.length === 64, 'Incomplete native Pool claim storage.');
  return Array.from({ length: 10 }, (_, i) => Object.freeze({
    ciphertextHigh: BigInt(claim[14 + i * 4 + 2]), ciphertextLow: BigInt(claim[14 + i * 4 + 3]) }));
};
export const currentPoolCanonicalTokenMap = (candidate: CurrentCheapDexCandidate, market: readonly string[]) => {
  requireCurrentPoolProof(JSON.stringify(candidate) === JSON.stringify(native), 'Native Pool candidate changed.');
  const addresses = [market[2], market[3]].map(v => `0x${v.slice(-40)}`);
  const map = addresses.map(v => candidate.tokens.findIndex(([at]) => at.toLowerCase() === v));
  requireCurrentPoolProof(map[0] === 1 && map[1] === 0 && BigInt(addresses[0]) < BigInt(addresses[1]),
    'Compiled native Pool canonical token mapping changed.');
  return Object.freeze(map as [1, 0]);
};
export const checkCurrentPoolSnapshotOnlyChange = (before: CurrentPoolStoredState, after: CurrentPoolStoredState, closed=true) => {
  const clean = (s: CurrentPoolStoredState) => ({ ...s, claim: s.claim.map((v, i) =>
    (closed ? i >= 14 && i < 54 && (i - 14) % 4 >= 2 : i>=13&&i<54) ? 'snapshot-field' : v) });
  requireCurrentPoolProof(same(clean(before), clean(after)), 'Native Pool snapshot changed financial state.');
};
// Zero approval cleanup cannot fund, change claims or use selected escrow.
// Other completed Fast trades can change only these source-bound shared fields.
export const checkCurrentPoolUnfundedCleanupState=(before:CurrentPoolStoredState,after:CurrentPoolStoredState)=>{
  if(same(before,after))return;
  const clean=(s:CurrentPoolStoredState)=>({...s,operation:0n,core:s.core.map((v,i)=>i===12?'operation':v),
    anchors:s.anchors.map(a=>a.map((v,i)=>[4,8,9,10,11,14,15,18,19].includes(i)?'shared':v)),
    market:s.market.map((v,i)=>[11,12,13,14,...Array.from({length:14},(_,j)=>25+j)].includes(i)?'shared':v),
    ledgers:s.ledgers.map(a=>a.map((v,i)=>[0,1,6,7,9,10].includes(i)?'shared':v))});
  requireCurrentPoolProof(same(clean(before),clean(after))&&after.operation>=before.operation&&
    after.anchors.every((a,i)=>BigInt(a[4])>=BigInt(before.anchors[i][4])),
    'Unfunded Pool cleanup has changed claims, owner, selected escrow, fixed fields or unsupported state.');
};
export const checkCurrentPoolFinancialTransition = (before:CurrentPoolStoredState,after:CurrentPoolStoredState,action:'fund'|'close') => {
  const clean=(s:CurrentPoolStoredState)=>({...s,counter:0n,claim:[],core:s.core.map((v,i)=>i===11?'counter':v),
    anchors:s.anchors.map((a)=>a.map((v,i)=>[4,8,9,10,11,14,15,18,19].includes(i)?'pool-field':v)),
    market:s.market.map((v,i)=>[11,12,13,14,...Array.from({length:14},(_,i)=>25+i)].includes(i)?'pool-field':v),
    ledgers:s.ledgers.map(a=>a.map((v,i)=>i===9||i===10?'pool-inventory':v))});
  requireCurrentPoolProof(same(clean(before),clean(after)), 'Native Pool action changed a non-allowlisted financial field.');
  requireCurrentPoolProof(after.counter===before.counter+(action==='fund'?1n:0n),'Native Pool position counter changed.');
  before.anchors.forEach((a,i)=>requireCurrentPoolProof(BigInt(after.anchors[i][4])===BigInt(a[4])+1n,'Native Pool anchor revision changed.'));
  if(action==='close'){
    const allowed=[0,4,6,12,13,14,15,18,19,22,23,60,61];
    requireCurrentPoolProof(before.claim.length===64&&after.claim.length===64&&before.claim.every((v,i)=>allowed.includes(i)||v===after.claim[i])&&
      BigInt(after.claim[0])===4n&&BigInt(after.claim[4])===BigInt(before.claim[4])+1n&&BigInt(after.claim[6])===BigInt(before.claim[6])+1n,
      'Native Pool close changed unsupported claim fields.');
  }
};
export const assertCurrentPoolSnapshotProducer = (producer: CurrentPoolSnapshotProducer, signer: object) => {
  requireCurrentPoolProof(produced.get(producer)?.signer === signer, 'Native Pool producer was not issued in this wallet session.');
};
export const createCurrentNativePoolSnapshotReader = ({ signer, owner, candidate, guard, rpc, attest,
  readPublic, readOwner, canonical, decrypt }: {
  signer: object; owner: string; candidate: CurrentCheapDexCandidate; guard: () => Promise<void>;
  rpc: (method: string, params: unknown[]) => Promise<unknown>; attest: (block: CurrentPoolBlock) => Promise<void>;
  readPublic: (id: bigint, block: CurrentPoolBlock) => Promise<{ status: bigint; context: string }>;
  readOwner: (id: bigint, block: CurrentPoolBlock, closed: boolean) => Promise<string>;
  canonical: (hash: string) => Promise<Canonical | null>; decrypt: (cipher: PrivateUint256Output) => bigint;
}) => {
  requireCurrentPoolProof(JSON.stringify(candidate) === JSON.stringify(native), 'Native Pool reader candidate changed.');
  const word = async (slot: bigint, block: CurrentPoolBlock,at=candidate.core) => {
    await guard(); const v = await rpc('eth_getStorageAt', [at, toBeHex(slot), { blockHash: block.hash, requireCanonical: true }]);
    await guard(); requireCurrentPoolProof(typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v), 'Malformed native Pool storage word.');
    return (v as string).toLowerCase();
  };
  const words = async (base: bigint, count: number, block: CurrentPoolBlock,at=candidate.core) => {
    const values: string[] = []; for (let i = 0; i < count; i+=12) values.push(...await Promise.all(
      Array.from({length:Math.min(12,count-i)},(_,j)=>word(base+BigInt(i+j),block,at))));
    return Object.freeze(values);
  };
  const state = async (id: bigint, block: CurrentPoolBlock): Promise<CurrentPoolStoredState> => {
    await guard(); await attest(block);
    const marketId = await word(6n, block), marketBase = BigInt(keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32', 'uint256'], [marketId, 1n])));
    const market = await words(marketBase, 71, block); currentPoolCanonicalTokenMap(candidate, market);
    const math = `0x${market[16].slice(-40)}`, mathAbi = new Interface(['function core() view returns(address)']);
    const code = await rpc('eth_getCode', [math, { blockHash: block.hash, requireCanonical: true }]);
    requireCurrentPoolProof(typeof code === 'string' && code !== '0x' && keccak256(code) === market[17], 'Native Pool math runtime changed.');
    const raw = await rpc('eth_call', [{ from: owner, to: math, data: mathAbi.encodeFunctionData('core') }, { blockHash: block.hash, requireCanonical: true }]);
    const binding = mathAbi.decodeFunctionResult('core', raw as string);
    requireCurrentPoolProof(binding[0].toLowerCase() === candidate.core.toLowerCase() &&
      mathAbi.encodeFunctionResult('core', binding).toLowerCase() === String(raw).toLowerCase(), 'Native Pool math Core binding changed.');
    const anchors: (readonly string[])[] = [];
    for (let i = 0; i < 7; i++) {
      requireCurrentPoolProof(BigInt(market[18 + i]) === BigInt(i + 1), 'Native Pool anchor identity changed.');
      anchors.push(await words(currentPoolPositionStorageBase(marketBase, BigInt(i + 1)), 64, block));
    }
    const counter=BigInt(await word(11n,block));requireCurrentPoolProof(counter>=19n&&counter<=64n,'Native Pool protected claim scope exceeds its finite read bound.');
    const existingClaims:Record<string,readonly string[]>={};for(let existing=8n;existing<=counter;existing++)if(existing!==id){
      existingClaims[existing.toString()]=await words(currentPoolPositionStorageBase(marketBase,existing),64,block);}
    const ledgers: (readonly string[])[]=[],escrows:(readonly string[])[]=[];
    for(const[token]of candidate.tokens){const ledgerBase=BigInt(keccak256(AbiCoder.defaultAbiCoder().encode(['address','uint256'],[token,22n])));
      ledgers.push(await words(ledgerBase,12,block));const escrowBase=BigInt(keccak256(AbiCoder.defaultAbiCoder().encode(['address','uint256'],[owner,ledgerBase+8n])));
      escrows.push(await words(escrowBase,2,block));}
    const engine=candidate.companions.find(([role])=>role==='ChainWhisperFixedEngine')?.[1];
    requireCurrentPoolProof(!!engine,'Native Pool Engine binding is absent.');
    const limitBase=BigInt(keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','uint256'],[0n,5n])));
    const protectedPublic=await readPublic(19n,block),protectedOwner=await readOwner(19n,block,false);
    requireCurrentPoolProof(protectedPublic.status===1n&&BigInt(protectedOwner)!==0n,'Protected NFT19 is not active and owned.');
    const result = Object.freeze({ market, anchors: Object.freeze(anchors),existingClaims:Object.freeze(existingClaims),
      protectedOwner:protectedOwner.toLowerCase(),protectedStatus:protectedPublic.status,
      core:await words(0n,50,block),engine:await words(0n,46,block,engine!),limitDirectory:await words(limitBase,8,block,engine!),
      ledgers:Object.freeze(ledgers),escrows:Object.freeze(escrows),
      protectedClaim: await words(currentPoolPositionStorageBase(marketBase, 19n), 64, block),
      claim: await words(currentPoolPositionStorageBase(marketBase, id), 64, block),
      counter, operation: BigInt(await word(12n, block)) });
    await attest(block); await guard(); return result;
  };
  const issue = async (id: bigint, kind: 'fund' | 'snapshot', hash: string): Promise<CurrentPoolSnapshotProducer> => {
    requireCurrentPoolProof(id > 19n, 'Only the admitted new native Pool claim can issue provenance.');
    await guard(); const observedProof = await canonical(hash); if (!observedProof) throw new Error('Native Pool producer receipt is unavailable.');
    const proof=Object.freeze({...observedProof,block:Object.freeze({...observedProof.block}),logs:Object.freeze(observedProof.logs.map(log=>
      Object.freeze({...log,topics:Object.freeze([...log.topics])})))});
    const pub = await readPublic(id, proof.block), closed = pub.status === 4n;
    requireCurrentPoolProof(pub.status === 1n || closed, 'Native Pool producer has an unsupported claim status.');
    requireCurrentPoolProof((await readOwner(id, proof.block, closed)).toLowerCase() === owner.toLowerCase(), 'Native Pool producer belongs to another owner.');
    const captured = await state(id, proof.block), context = captured.claim[13], envelopes = currentPoolStoredEnvelopes(captured.claim);
    requireCurrentPoolProof(context === pub.context.toLowerCase(), 'Stored native Pool context changed.');
    const coreLogs = proof.logs.filter(v => v.address.toLowerCase() === candidate.core.toLowerCase());
    requireCurrentPoolProof(coreLogs.length === 1, 'Native Pool producer needs one Core event.');
    const event = currentNativePoolSnapshotAbi.parseLog({ ...coreLogs[0], topics: [...coreLogs[0].topics] });
    requireCurrentPoolProof(!!event && event.name === (kind === 'fund' ? 'SharedClaimCreated' : 'PoolSnapshotRefreshed') &&
      event.args.positionId === id, 'Native Pool producer event changed.');
    const encoded = currentNativePoolSnapshotAbi.encodeEventLog(event!.fragment, event!.args);
    requireCurrentPoolProof(encoded.data.toLowerCase() === coreLogs[0].data.toLowerCase() &&
      same(encoded.topics.map(v => v.toLowerCase()), coreLogs[0].topics.map(v => v.toLowerCase())), 'Non-canonical native Pool producer event.');
    if (kind === 'snapshot') {
      requireCurrentPoolProof(proof.data.toLowerCase() === currentNativePoolSnapshotAbi.encodeFunctionData('poolSnapshot', [id]).toLowerCase() &&
        event!.args.context.toLowerCase() === context && same(event!.args.userValues.map((v: PrivateUint256Output) =>
          ({ ciphertextHigh: v.ciphertextHigh, ciphertextLow: v.ciphertextLow })), envelopes), 'Native Pool producer event differs from current owner envelopes.');
    } else requireCurrentPoolProof(!closed && proof.data.slice(0, 10) === '0x' + keccak256(new TextEncoder().encode('createPoolPosition(bytes32,bytes)')).slice(2, 10), 'Native Pool fund producer call changed.');
    const values = envelopes.map(decrypt), amounts = checkCurrentPoolPositionValues(values);
    requireCurrentPoolProof(amounts.classId === 0n && (closed ? amounts.shares === 0n : amounts.shares > 0n && amounts.totalShares >= amounts.shares), 'Native Pool producer shares/class changed.');
    if (closed) requireCurrentPoolProof(captured.claim[22] === captured.claim[60] && captured.claim[23] === captured.claim[61], 'Closed native Pool shares system ciphertext differs.');
    requireCurrentPoolProof(same(await canonical(hash), proof), 'Native Pool producer canonical record changed after private proof.');
    await guard(); const value = Object.freeze({ kind, positionId: id, transactionHash: hash, context,
      block: proof.block, status: pub.status, amounts, readyToSign: false as const });
    produced.set(value, { signer, state: captured, canonical: proof }); return value;
  };
  const current = async (producer: CurrentPoolSnapshotProducer, block: CurrentPoolBlock) => {
    assertCurrentPoolSnapshotProducer(producer, signer); const retained = produced.get(producer)!;
    await guard(); requireCurrentPoolProof(same(await canonical(producer.transactionHash), retained.canonical), 'Native Pool producer canonical record changed.');
    requireCurrentPoolProof(same(await state(producer.positionId, block), retained.state), 'Native Pool producer is stale; sign a new Refresh.');
    requireCurrentPoolProof((await readOwner(producer.positionId, block, producer.status === 4n)).toLowerCase() === owner.toLowerCase(), 'Native Pool owner changed.');
    await guard(); return producer;
  };
  const proveSharedStale = async (producer:CurrentPoolSnapshotProducer,block:CurrentPoolBlock) => {
    assertCurrentPoolSnapshotProducer(producer,signer);const retained=produced.get(producer)!;
    requireCurrentPoolProof(producer.kind==='snapshot'&&producer.status===1n,'Only a verified active producer may be replaced.');
    requireCurrentPoolProof(same(await canonical(producer.transactionHash),retained.canonical),'Original producer canonical proof changed.');
    const observed=await state(producer.positionId,block);
    requireCurrentPoolProof((await readOwner(producer.positionId,block,false)).toLowerCase()===owner.toLowerCase(),'Native Pool owner changed.');
    const clean=(s:CurrentPoolStoredState)=>({...s,operation:0n,core:s.core.map((v,i)=>i===12?'operation':v),
      anchors:s.anchors.map(a=>a.map((v,i)=>[4,8,9,10,11,14,15,18,19].includes(i)?'shared':v)),
      market:s.market.map((v,i)=>[11,12,13,14,...Array.from({length:14},(_,j)=>25+j)].includes(i)?'shared':v),
      ledgers:s.ledgers.map(a=>a.map((v,i)=>[0,1,6,7,9,10].includes(i)?'shared':v))});
    requireCurrentPoolProof(!same(observed,retained.state)&&same(clean(observed),clean(retained.state)),
      'Replacement requires only proved shared-state drift; owner, claim or other state mismatch is held.');
    await guard();return producer.transactionHash;
  };
  return Object.freeze({ state, issue, current, proveSharedStale });
};
