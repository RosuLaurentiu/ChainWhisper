import { AbiCoder, Interface, getAddress, keccak256, toUtf8Bytes, type Eip1193Provider } from '@coti-io/coti-ethers';
import { CURRENT_DEX_DAILY_PRICE_ARTIFACT } from './currentDexDailyPriceArtifact';
import { CURRENT_NATIVE_DEX_DAILY_PRICE_ARTIFACT } from './currentDexNativeDailyPriceArtifact';
import { CURRENT_D06_DEX_DAILY_PRICE_ARTIFACT } from './currentDexD06DailyPriceArtifact';
import { CURRENT_EXIT_DEX_DAILY_PRICE_ARTIFACT } from './currentDexExitDailyPriceArtifact';
import { CURRENT_HISTORY_DEX_DAILY_PRICE_ARTIFACT } from './currentDexHistoryDailyPriceArtifact';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { readCurrentDexDisplay } from './currentDexDisplay';
import type { CurrentCheapDexCandidate } from './dexV2Deployment';

export const CURRENT_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: '6d636a45f6c24a08b78a15070241b4ccfa0b63822fdac2ca3a40dd4a5533788e',
  coreArtifact: 'fc71f47b0e5dd9a16dfde32fc33b34507df8d71a52f99098ade1b5a03fd0bff0',
  buildInfo: '16c5c1f80b76182b322d1045c987b6151a45c83607d855ef25dbad625f8ad6a2',
  recorderArtifact: CURRENT_DEX_DAILY_PRICE_ARTIFACT.artifactSha256,
  schema: keccak256(toUtf8Bytes('chainwhisper.dex.pool-reference.observation.v1')),
  policy: '0xed71147c6fb189173e6cb2eddf7efe41524dfc84d7412b1e3d1b11145f8a63ea'
});
// Local current-candidate artifact only. Deployment/sample and active configuration remain required.
export const CURRENT_NATIVE_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: 'fa71b96c6c590a40feed6b234d8bf5a2fe548af0edb0a2a49dbd639f4c15938b',
  recorderArtifact: CURRENT_NATIVE_DEX_DAILY_PRICE_ARTIFACT.artifactSha256,
  schema: CURRENT_DEX_DAILY_PRICE_SOURCE.schema, policy: CURRENT_DEX_DAILY_PRICE_SOURCE.policy
});
export const CURRENT_D06_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: 'd06b6640dad22e5018a5e50d46602fd6d9b534d0b8eb4497cb5b42aee55e5962',
  recorderArtifact: CURRENT_D06_DEX_DAILY_PRICE_ARTIFACT.artifactSha256,
  schema: CURRENT_DEX_DAILY_PRICE_SOURCE.schema, policy: CURRENT_DEX_DAILY_PRICE_SOURCE.policy
});
export const CURRENT_EXIT_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: 'b2aa0895d7661a43e3a7db85c9ae24daaa641db238a06bec5c64d031dcf382cd',
  recorderArtifact: CURRENT_EXIT_DEX_DAILY_PRICE_ARTIFACT.artifactSha256,
  schema: CURRENT_DEX_DAILY_PRICE_SOURCE.schema, policy: CURRENT_DEX_DAILY_PRICE_SOURCE.policy
});
export const CURRENT_HISTORY_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: '7b67bcbb7c5941a24471e62ba5a0d939c0800671b0bf121e81bad14cca737456',
  recorderArtifact: CURRENT_HISTORY_DEX_DAILY_PRICE_ARTIFACT.artifactSha256,
  schema: CURRENT_DEX_DAILY_PRICE_SOURCE.schema, policy: CURRENT_DEX_DAILY_PRICE_SOURCE.policy
});
export type CurrentDexDailyPriceManifest = Readonly<{
  sourceGraph: string; recorderArtifact: string; chainId: string; genesisHash: string;
  address: string; runtimeHash: string; deployer: string; deploymentBlock: string;
  deploymentBlockHash: string; deploymentTransactionHash: string;
  source: string; sourceRuntimeHash: string; releaseId: string; market: string; pair: string;
  canonicalId: string; token0: string; token1: string; decimals0: number; decimals1: number;
  token0RuntimeHash: string; token1RuntimeHash: string; symbols: readonly [string, string];
}>;
export type CurrentDexDailyPriceConfig =
  | Readonly<{ status: 'inactive' }>
  | Readonly<{ status: 'active'; manifest: CurrentDexDailyPriceManifest; rpcUrl: string; finalityLagBlocks: number }>;
// Orientation is display-only. The verified snapshot always retains canonical source values.
export const currentDexDailyPricePairOrientation = (symbols: readonly [string, string], pair: readonly [string, string]): 0 | 1 | -1 =>
  symbols[0] === pair[0] && symbols[1] === pair[1] ? 1 :
    symbols[0] === pair[1] && symbols[1] === pair[0] ? -1 : 0;
// Native producer and recorder admission is open. No invented deployment address.
export const CURRENT_DEX_DAILY_PRICE_CONFIG: CurrentDexDailyPriceConfig = Object.freeze({ status: 'inactive' });
export type CurrentDexDailyPricePoint = Readonly<{
  day: string; priceE18: string; sampledAt: string; sampledBlock: string; sourceRevision: string;
  sourceState: string; registryRevision: string; marketRevision: string;
  recordedAt: string; recordedBlock: string; sourceBlockHash: string; recordBlockHash: string;
}>;
export type CurrentDexDailyPriceSlot = Readonly<{ day: string; point: CurrentDexDailyPricePoint | null }>;
declare const VERIFIED_DAILY_PRICE: unique symbol;
export type CurrentDexDailyPriceSnapshot = Readonly<{
  readonly [VERIFIED_DAILY_PRICE]: true; manifest: CurrentDexDailyPriceManifest;
  slots: readonly CurrentDexDailyPriceSlot[]; atBlock: Readonly<{ number: string; hash: string; timestamp: string }>;
  currentReference: 'available' | 'unobserved' | 'stale' | 'suppressed-or-changed';
  currentObservation?: Readonly<{ priceE18: string; sampledAt: string; sampledBlock: string; revision: string }>;
}>;
const VERIFIED = new WeakSet<object>();
export const isVerifiedCurrentDexDailyPrice = (value: unknown): value is CurrentDexDailyPriceSnapshot =>
  typeof value === 'object' && value !== null && VERIFIED.has(value);
export type CurrentDexPublicReferenceSnapshot = Readonly<{
  symbols: readonly [string,string]; atBlock: CurrentDexDailyPriceSnapshot['atBlock'];
  currentReference: CurrentDexDailyPriceSnapshot['currentReference'];
  currentObservation?: CurrentDexDailyPriceSnapshot['currentObservation'];
}>;
const PUBLIC_REFERENCES = new WeakSet<object>();
export const isVerifiedCurrentDexPublicReference = (value: unknown): value is CurrentDexPublicReferenceSnapshot =>
  typeof value === 'object' && value !== null && PUBLIC_REFERENCES.has(value);
export type CurrentDexPublicReferenceView = Readonly<{status:'reference';snapshot:CurrentDexPublicReferenceSnapshot}>;
export type CurrentDexDailyPriceView =
  | Readonly<{ status: 'unconfigured' | 'loading'; message?: string }>
  | Readonly<{ status: 'error'; kind: 'rpc' | 'reorg' | 'mismatch'; message: string }>
  | Readonly<{ status: 'ready' | 'empty'; snapshot: CurrentDexDailyPriceSnapshot }>;
export class CurrentDexDailyPriceError extends Error {
  constructor(public readonly kind: 'rpc' | 'reorg' | 'mismatch', message: string) { super(message); }
}
const fail = (message: string, kind: CurrentDexDailyPriceError['kind'] = 'mismatch'): never => { throw new CurrentDexDailyPriceError(kind, message); };
const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();
const uint = (v: unknown): bigint => {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]*)$/.test(v)) return fail('Invalid history integer.');
  const n = BigInt(v); if (n >= 1n << 256n) return fail('History integer is out of range.'); return n;
};
const quantity = (v: unknown): bigint => {
  if (typeof v !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(v)) return fail('Invalid history RPC quantity.', 'rpc');
  return BigInt(v);
};
const hash = (v: unknown) => { if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(v) || /^0x0{64}$/i.test(v)) return fail('Missing history hash.'); return v.toLowerCase(); };
const address = (v: string) => { try { const a = getAddress(v); if (/^0x0{40}$/i.test(a)) return fail('Missing history address.'); return a.toLowerCase(); } catch { return fail('Invalid history address.'); } };
const coder = AbiCoder.defaultAbiCoder();
const observationTypes = ['bytes32','bytes32','uint256','address','bytes32','bytes32','bytes32','bytes32','uint256','uint256','uint256','address','address','uint8','uint8','uint256','uint256','uint256','uint256','bytes32','bool'];
type Observation = ReturnType<typeof coder.decode>;
type Block = Readonly<{ number: bigint; hash: string; timestamp: bigint }>;
const block = (raw: unknown): Block => {
  if (!raw || typeof raw !== 'object') return fail('History block unavailable.', 'rpc');
  const r = raw as Record<string, unknown>; return { number: quantity(r.number), hash: hash(r.hash), timestamp: quantity(r.timestamp) };
};
const validateManifest = (m: CurrentDexDailyPriceManifest) => {
  const artifact = m.sourceGraph === CURRENT_DEX_DAILY_PRICE_SOURCE.graph ? CURRENT_DEX_DAILY_PRICE_ARTIFACT :
    m.sourceGraph === CURRENT_NATIVE_DEX_DAILY_PRICE_SOURCE.graph ? CURRENT_NATIVE_DEX_DAILY_PRICE_ARTIFACT :
      m.sourceGraph === CURRENT_D06_DEX_DAILY_PRICE_SOURCE.graph ? CURRENT_D06_DEX_DAILY_PRICE_ARTIFACT :
        m.sourceGraph === CURRENT_EXIT_DEX_DAILY_PRICE_SOURCE.graph ? CURRENT_EXIT_DEX_DAILY_PRICE_ARTIFACT :
          m.sourceGraph === CURRENT_HISTORY_DEX_DAILY_PRICE_SOURCE.graph ? CURRENT_HISTORY_DEX_DAILY_PRICE_ARTIFACT : fail('History candidate does not match.');
  if (m.recorderArtifact !== artifact.artifactSha256) fail('History candidate does not match.');
  for (const k of ['genesisHash','runtimeHash','deploymentBlockHash','deploymentTransactionHash','sourceRuntimeHash','releaseId','market','pair','token0RuntimeHash','token1RuntimeHash'] as const) hash(m[k]);
  for (const k of ['address','deployer','source','token0','token1'] as const) address(m[k]);
  if (uint(m.chainId) === 0n || uint(m.canonicalId) === 0n) fail('History identity is missing.'); uint(m.deploymentBlock);
  if (!Number.isInteger(m.decimals0) || !Number.isInteger(m.decimals1) || Math.min(m.decimals0,m.decimals1) < 0 || Math.max(m.decimals0,m.decimals1) > 18 || BigInt(m.token0) >= BigInt(m.token1)) fail('History token units do not match.');
  if (!same(m.pair, keccak256(coder.encode(['uint256','address','address'], [m.chainId,m.token0,m.token1]))) || m.symbols.length !== 2 || m.symbols.some(v => !v.trim())) fail('History pair does not match.');
  return artifact;
};
type ReferenceIdentity = Pick<CurrentDexDailyPriceManifest,'chainId'|'source'|'sourceRuntimeHash'|'releaseId'|'market'|'pair'|'canonicalId'|'token0'|'token1'|'decimals0'|'decimals1'>;
const validateObservation = (o: Observation, m: ReferenceIdentity) => {
  const expected = [CURRENT_DEX_DAILY_PRICE_SOURCE.schema,CURRENT_DEX_DAILY_PRICE_SOURCE.policy,m.chainId,m.source,m.sourceRuntimeHash,m.releaseId,m.market,m.pair,m.canonicalId];
  expected.forEach((v,i) => { if (!same(o[i],v)) fail('History source identity does not match.'); });
  if (o[9] === 0n || o[10] === 0n || !same(o[11],m.token0) || !same(o[12],m.token1) || o[13] !== BigInt(m.decimals0) || o[14] !== BigInt(m.decimals1)) fail('History source pair or units do not match.');
};
const decodeReference = (raw: unknown, m: ReferenceIdentity): Observation => {
  if (typeof raw !== 'string' || !/^0x[0-9a-f]*$/i.test(raw) || (raw.length-2)/2 !== 21*32) fail('History current reference schema does not match.');
  const current = coder.decode(observationTypes,raw as string);
  if (!same(coder.encode(observationTypes,current),raw)) fail('History current reference encoding does not match.');
  validateObservation(current,m);return current;
};

// The live Core signal has its own provenance; recording chart samples is separate.
export async function readCurrentDexPublicReference({provider,candidate,pair,finalityLagBlocks=2,assertCurrent=()=>{}}:{
  provider:Pick<Eip1193Provider,'request'>;candidate:CurrentCheapDexCandidate;pair:readonly[string,string];
  finalityLagBlocks?:number;assertCurrent?:()=>void|Promise<void>;
}):Promise<CurrentDexPublicReferenceSnapshot>{
  const {candidate:c}=resolvePreparedDexScope(candidate),display=readCurrentDexDisplay(c);
  const selected=display.pairs.find(row=>currentDexDailyPricePairOrientation(row.tokens.map(token=>token.label) as [string,string],pair)!==0);
  if(!selected)fail('Current reference pair is outside the selected candidate.');
  if(!Number.isInteger(finalityLagBlocks)||finalityLagBlocks<0||finalityLagBlocks>128)fail('Current reference finality exceeds its bound.');
  const market=c.pairs.find(row=>row.marketId===selected!.marketId)!,core=c.runtimes.find(([role])=>role==='ChainWhisperDexCore')!;
  const [token0,token1]=selected!.tokens;
  const identity:ReferenceIdentity={chainId:c.chainId,source:c.core,sourceRuntimeHash:core[2],releaseId:c.releaseId,
    market:market.marketId,pair:keccak256(coder.encode(['uint256','address','address'],[c.chainId,token0.address,token1.address])),
    canonicalId:market.canonicalId,token0:token0.address,token1:token1.address,decimals0:token0.decimals,decimals1:token1.decimals};
  const rpc=async(method:string,params:unknown[]=[])=>{await assertCurrent();const value=await provider.request({method,params});await assertCurrent();return value;};
  if(quantity(await rpc('eth_chainId'))!==BigInt(c.chainId)||!same(block(await rpc('eth_getBlockByNumber',['0x0',false])).hash,c.genesisHash))fail('Current reference network does not match.');
  const latest=block(await rpc('eth_getBlockByNumber',['latest',false]));if(latest.number<BigInt(finalityLagBlocks))fail('Current reference head is unavailable.','rpc');
  const head=block(await rpc('eth_getBlockByNumber',[`0x${(latest.number-BigInt(finalityLagBlocks)).toString(16)}`,false]));
  if(head.number!==latest.number-BigInt(finalityLagBlocks)||head.timestamp>8640000000000n)fail('Current reference head does not match.');
  const pin={blockHash:head.hash,requireCanonical:true};
  for(const [target,expected]of [[c.core,core[2]],...[token0,token1].map(token=>[token.address,c.tokens.find(([address])=>same(address,token.address))![1]])]){
    const code=await rpc('eth_getCode',[target,pin]);if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code)||!same(keccak256(code),expected))fail('Current reference runtime does not match.');
  }
  const api=new Interface(['function poolReference(bytes32) view returns(bytes)']);
  const response=await rpc('eth_call',[{to:c.core,data:api.encodeFunctionData('poolReference',[market.marketId])},pin]);
  if(typeof response!=='string')fail('Current reference RPC result does not match.','rpc');
  const decoded=api.decodeFunctionResult('poolReference',response as string);if(!same(api.encodeFunctionResult('poolReference',decoded),response))fail('Current reference RPC encoding does not match.');
  const current=decodeReference(decoded[0],identity),currentReference=current[16]===0n?'unobserved':
    current[16]>head.timestamp||head.timestamp-current[16]>120n||current[17]>head.number?'stale':
      current[20]&&current[15]>0n?'available':'suppressed-or-changed';
  const checked=[head];
  if(currentReference==='available'){
    if(current[18]===0n||current[17]===0n)fail('Current reference source revision does not match.');
    const sample=block(await rpc('eth_getBlockByNumber',[`0x${BigInt(current[17]).toString(16)}`,false]));
    if(sample.number!==current[17]||sample.timestamp!==current[16])fail('Current reference source time does not match.');checked.push(sample);
  }
  for(const expected of checked){const fresh=block(await rpc('eth_getBlockByNumber',[`0x${expected.number.toString(16)}`,false]));if(fresh.number!==expected.number||fresh.timestamp!==expected.timestamp||!same(fresh.hash,expected.hash))fail('Current reference reorganized.','reorg');}
  await assertCurrent();const snapshot:CurrentDexPublicReferenceSnapshot=Object.freeze({symbols:Object.freeze([token0.label,token1.label]) as readonly[string,string],
    atBlock:Object.freeze({number:String(head.number),hash:head.hash,timestamp:String(head.timestamp)}),currentReference,
    ...(currentReference==='available'?{currentObservation:Object.freeze({priceE18:String(current[15]),sampledAt:String(current[16]),sampledBlock:String(current[17]),revision:String(current[18])})}:{})});
  PUBLIC_REFERENCES.add(snapshot);return snapshot;
}
export async function readCurrentDexDailyPrice({ provider, manifest: m, count = 32, finalityLagBlocks = 2, assertCurrent = () => {} }: {
  provider: Pick<Eip1193Provider, 'request'>; manifest: CurrentDexDailyPriceManifest; count?: number;
  finalityLagBlocks?: number; assertCurrent?: () => void | Promise<void>;
}): Promise<CurrentDexDailyPriceSnapshot> {
  const artifact = validateManifest(m), api = new Interface(artifact.abi);
  if (!Number.isInteger(count) || count < 1 || count > 32 || !Number.isInteger(finalityLagBlocks) || finalityLagBlocks < 0 || finalityLagBlocks > 128) fail('History page exceeds its bound.');
  const rpc = async (method: string, params: unknown[] = []) => { await assertCurrent(); try { const v = await provider.request({ method, params }); await assertCurrent(); return v; } catch (e) { if (e instanceof CurrentDexDailyPriceError) throw e; return fail('History RPC failed. No sample was accepted.', 'rpc'); } };
  if (quantity(await rpc('eth_chainId')) !== uint(m.chainId) || !same(block(await rpc('eth_getBlockByNumber',['0x0',false])).hash,m.genesisHash)) fail('History network does not match.');
  const latest = block(await rpc('eth_getBlockByNumber',['latest',false])); if (latest.number < BigInt(finalityLagBlocks)) fail('History head is unavailable.', 'rpc');
  const head = block(await rpc('eth_getBlockByNumber',[`0x${(latest.number-BigInt(finalityLagBlocks)).toString(16)}`,false]));
  if (head.number !== latest.number-BigInt(finalityLagBlocks)) fail('History head number does not match.');
  if (head.timestamp > 8640000000000n) fail('History timestamp cannot be displayed.');
  if (head.number < uint(m.deploymentBlock)) fail('History deployment is not finalized.');
  const pin = { blockHash: head.hash, requireCanonical: true };
  const deployment = block(await rpc('eth_getBlockByNumber',[`0x${uint(m.deploymentBlock).toString(16)}`,false]));
  if (deployment.number !== uint(m.deploymentBlock)) fail('History deployment number does not match.');
  if (!same(deployment.hash,m.deploymentBlockHash)) fail('History deployment reorganized.', 'reorg');
  const receipt = await rpc('eth_getTransactionReceipt',[m.deploymentTransactionHash]) as Record<string,unknown> | null;
  if (!receipt || quantity(receipt.status) !== 1n || quantity(receipt.blockNumber) !== deployment.number || !same(receipt.blockHash,deployment.hash) || !same(receipt.transactionHash,m.deploymentTransactionHash) || !same(receipt.contractAddress,m.address) || !same(receipt.from,m.deployer) || receipt.to !== null) fail('History deployment receipt does not match.');
  let recorderCode = '';
  for (const [a,h] of [[m.address,m.runtimeHash],[m.source,m.sourceRuntimeHash],[m.token0,m.token0RuntimeHash],[m.token1,m.token1RuntimeHash]]) {
    const code = await rpc('eth_getCode',[a,pin]); if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code) || !same(keccak256(code),h)) fail('History runtime does not match.');
    if (a === m.address) recorderCode = code;
  }
  let normalized = recorderCode.slice(2).toLowerCase();
  if (normalized.length !== artifact.deployedBytecode.length-2) fail('History recorder artifact does not match.');
  for (const r of artifact.immutableReferences) normalized = normalized.slice(0,r.start*2)+'0'.repeat(r.length*2)+normalized.slice((r.start+r.length)*2);
  if (!same(`0x${normalized}`,artifact.deployedBytecode)) fail('History recorder code differs from the candidate.');
  const call = async (name: string, args: unknown[] = []) => api.decodeFunctionResult(name, await rpc('eth_call',[{to:m.address,data:api.encodeFunctionData(name,args)},pin]) as string);
  for (const [name,value] of [['SOURCE_GRAPH',`0x${m.sourceGraph}`],['SCHEMA',CURRENT_DEX_DAILY_PRICE_SOURCE.schema],['POLICY',CURRENT_DEX_DAILY_PRICE_SOURCE.policy],['source',m.source],['sourceRuntime',m.sourceRuntimeHash],['sourceChain',m.chainId],['releaseId',m.releaseId],['market',m.market],['pair',m.pair],['canonicalId',m.canonicalId],['token0',m.token0],['token1',m.token1],['decimals0',m.decimals0],['decimals1',m.decimals1],['MAX_PAGE',32]] as const) if (!same((await call(name))[0],value)) fail('History constructor binding does not match.');
  const token = new Interface(['function decimals() view returns(uint8)']);
  for (const [a,d] of [[m.token0,m.decimals0],[m.token1,m.decimals1]] as const) if (token.decodeFunctionResult('decimals',await rpc('eth_call',[{to:a,data:token.encodeFunctionData('decimals')},pin]) as string)[0] !== BigInt(d)) fail('History token decimals changed.');
  const currentDay = head.timestamp/86400n, slotsCount = BigInt(count) > currentDay+1n ? currentDay+1n : BigInt(count), start = currentDay-slotsCount+1n;
  const page = (await call('getDays',[start,slotsCount]))[0]; if (BigInt(page.length) !== slotsCount) fail('History page is incomplete.');
  const blocks = new Map<string,Block>([[String(head.number),head],[String(deployment.number),deployment]]);
  const getBlock = async (n: bigint) => { const k = String(n); if (!blocks.has(k)) { const v = block(await rpc('eth_getBlockByNumber',[`0x${n.toString(16)}`,false])); if (v.number !== n) fail('History provenance block does not match.'); blocks.set(k,v); } return blocks.get(k)!; };
  const slots: CurrentDexDailyPriceSlot[] = []; let priorRevision = 0n; let priorTime = 0n; let priorBlock = 0n;
  for (let i=0;i<page.length;i++) {
    const s = page[i], day = start+BigInt(i), o = s.observation;
    if (s.day !== day) fail('History day order does not match.');
    if (!s.present) { if (s.recordedAt !== 0n || s.recordedBlock !== 0n || o.some((v:unknown)=>typeof v==='bigint'?v!==0n:typeof v==='boolean'?v:typeof v!=='string'||!/^0x0+$/.test(v))) fail('History gap contains a sample.'); slots.push({day:String(day),point:null}); continue; }
    validateObservation(o,m);
    if (!o.available || o.priceE18 === 0n || o.sampledAt === 0n || o.sampledBlock === 0n || o.revision <= priorRevision || o.sampledAt < priorTime || o.sampledBlock < priorBlock || o.sampledAt/86400n !== day || s.recordedAt/86400n !== day || o.sampledAt > s.recordedAt || s.recordedAt-o.sampledAt > 120n || s.recordedAt > head.timestamp || o.sampledBlock > s.recordedBlock || s.recordedBlock > head.number) fail('History sample provenance does not match.'); hash(o.sourceState);
    const sourceBlock = await getBlock(o.sampledBlock), recordBlock = await getBlock(s.recordedBlock);
    if (sourceBlock.timestamp !== o.sampledAt || recordBlock.timestamp !== s.recordedAt) fail('History source or record time does not match.');
    priorRevision=o.revision; priorTime=o.sampledAt; priorBlock=o.sampledBlock;
    slots.push({day:String(day),point:Object.freeze({day:String(day),priceE18:String(o.priceE18),sampledAt:String(o.sampledAt),sampledBlock:String(o.sampledBlock),sourceRevision:String(o.revision),sourceState:hash(o.sourceState),registryRevision:String(o.registryRevision),marketRevision:String(o.marketRevision),recordedAt:String(s.recordedAt),recordedBlock:String(s.recordedBlock),sourceBlockHash:sourceBlock.hash,recordBlockHash:recordBlock.hash})});
  }
  const sourceApi = new Interface(['function poolReference(bytes32) view returns(bytes)']);
  const raw = sourceApi.decodeFunctionResult('poolReference',await rpc('eth_call',[{to:m.source,data:sourceApi.encodeFunctionData('poolReference',[m.market])},pin]) as string)[0];
  const current = decodeReference(raw,m);
  const currentReference = current[16] === 0n ? 'unobserved' : current[16] > head.timestamp || head.timestamp-current[16] > 120n || current[17] > head.number ? 'stale' : current[20] && current[15] > 0n ? 'available' : 'suppressed-or-changed';
  if (currentReference === 'available' && (current[18] === 0n || (await getBlock(current[17])).timestamp !== current[16]))
    fail('Current reference source time or revision does not match.');
  for (const [n,v] of blocks) if (!same(block(await rpc('eth_getBlockByNumber',[`0x${BigInt(n).toString(16)}`,false])).hash,v.hash)) fail('History read reorganized. No sample was accepted.', 'reorg');
  const currentObservation = currentReference === 'available' ? Object.freeze({priceE18:String(current[15]),sampledAt:String(current[16]),sampledBlock:String(current[17]),revision:String(current[18])}) : undefined;
  const snapshot = Object.freeze({manifest:Object.freeze({...m,symbols:Object.freeze([...m.symbols]) as readonly [string,string]}),slots:Object.freeze(slots.map(s=>Object.freeze(s))),atBlock:Object.freeze({number:String(head.number),hash:head.hash,timestamp:String(head.timestamp)}),currentReference,currentObservation}) as CurrentDexDailyPriceSnapshot;
  VERIFIED.add(snapshot); return snapshot;
}
