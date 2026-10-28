import { AbiCoder, Interface, keccak256, toBeHex } from '@coti-io/coti-ethers';
import { CURRENT_CHEAP_DEX_CANDIDATE as candidate, currentCheapDexCandidateKey, resolveCurrentCheapDexCandidate, assertCurrentCheapDexNativeAdmission, type CurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { currentPoolNftAbi, decodeCurrentPoolNftTransfer } from './currentDexPoolPosition';

export class CurrentLimitProofMismatch extends Error { override name='CurrentLimitProofMismatch'; }
export const isKnownCurrentLimitProofMismatch=(error:unknown)=>error instanceof CurrentLimitProofMismatch||error instanceof Error&&[
  'Limit wallet credit or allowance differs from the exact payout.',
  'Current DEX mined transaction changed.','Current-mode mined gas cap changed.','Current DEX mined block changed.',
  'Current DEX canonical transaction inclusion changed. Do not resend.','Current native receipt changed after private verification.'
].includes(error.message);

const small='(uint256 ciphertext,bytes signature)',wide='((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature)';
export const currentLimitAbi=new Interface([
  `function createPrivateOrder(${wide} encryptedFunding,${small} encryptedSellToken0,${small} encryptedRangeKind,${small}[5] encryptedFixedTerms,${wide}[3] encryptedRangeTerms) returns(uint256 positionId)`,
  'function privateOrderSnapshot(uint256 id) returns(bytes32,(uint256 ciphertextHigh,uint256 ciphertextLow)[8])',
  'function claimPrivateOrderProceeds(uint256 positionId)',
  'function closePrivateOrder(uint256 positionId)',
  'function managePrivateOrderStatus(uint256 positionId,uint256 expectedLifecycleRevision,uint8 action)',
  'event FixedPositionCreated(uint256 indexed positionId)',
  'event FixedProceedsClaimed(uint256 indexed positionId)',
  'event FixedPositionClosed(uint256 indexed positionId)'
]);
export const preparedLimitAbi=new Interface([
  `function createPrivateOrder(bytes32 selectedMarket,${wide} encryptedFunding,${small} encryptedSellToken0,${small} encryptedRangeKind,${small}[5] encryptedFixedTerms,${wide}[3] encryptedRangeTerms) returns(uint256 positionId)`,
  ...currentLimitAbi.fragments.filter(fragment=>fragment.type!=='function'||fragment.format('sighash').split('(')[0]!=='createPrivateOrder').map(fragment=>fragment.format('full'))
]);
export const exitLimitAbi=new Interface([
  ...preparedLimitAbi.fragments.map(fragment=>fragment.format('full')),
  `function topUpPrivateOrder(uint256 id,uint256 expectedTermsRevision,uint256 expectedLifecycleRevision,${wide} encryptedAmount)`,
  `function repricePrivateOrder(uint256 id,uint256 expectedTermsRevision,${small}[5] encryptedFixedTerms,${wide}[3] encryptedRangeTerms)`,
  'event FixedPositionToppedUp(uint256 indexed positionId)',
  'event FixedPositionRepriced(uint256 indexed positionId,uint256 termsRevisionAfter)'
]);
export const currentLimitAbiForCandidate=(key:CurrentCheapDexCandidateKey='cheap-current')=>key==='cheap-exit'||key==='cheap-history'?exitLimitAbi:key==='cheap-prepared'?preparedLimitAbi:currentLimitAbi;
/** Public pair scope only. This does not grant signing or amount authority. */
export const resolveCurrentLimitScope=(key:CurrentCheapDexCandidateKey='cheap-current',selectedPair?:readonly[string,string])=>{
  const c=resolveCurrentCheapDexCandidate(key);
  if(key==='cheap-prepared'||key==='cheap-exit'||key==='cheap-history'){
    const {candidate:prepared}=resolvePreparedDexScope(key);
    const pair=selectedPair&&prepared.pairs.find(pair=>selectedPair.length===2&&pair.tokens.every(token=>selectedPair.some(address=>typeof address==='string'&&address.toLowerCase()===token)));
    if(!pair)throw new Error('Select an exact Limit market pair.');
    return Object.freeze({candidate:c,key,marketId:pair.marketId,poolTokens:pair.tokens,engine:pair.engine,prepared:true});
  }
  const tokens=[...c.tokens].sort(([a],[b])=>BigInt(a)<BigInt(b)?-1:1),poolTokens=Object.freeze([tokens[0][0],tokens[1][0]])as readonly[string,string];
  if(selectedPair&&(selectedPair.length!==2||!poolTokens.every(token=>selectedPair.some(address=>typeof address==='string'&&address.toLowerCase()===token))))throw new Error('Select the historical Limit market pair.');
  return Object.freeze({candidate:c,key,marketId:undefined,poolTokens,engine:c.companions.find(([role])=>role==='ChainWhisperFixedEngine')![1],prepared:false});
};
export const currentLimitBindingAbi=new Interface(['function bindingCommitment() view returns(bytes32)']);
export const CURRENT_LIMIT_CREATE_GAS_CAP=30_000_000n;
export const CURRENT_LIMIT_SNAPSHOT_GAS_CAP=10_000_000n;
export type CurrentLimitOwnerAction='refresh'|'claim'|'pause'|'resume'|'close'|'topup'|'reprice';
// Every action still requires a fresh native estimate within its cap.
export const CURRENT_LIMIT_OWNER_GAS_CAPS=Object.freeze({refresh:10_000_000n,claim:30_000_000n,pause:10_000_000n,resume:10_000_000n,close:30_000_000n,topup:30_000_000n,reprice:30_000_000n});
// Current graph04ea: native Limit30 Pause/Resume/snapshot proof, 2026-10-02.
// Evidence: validation/current-integration/app-limit-owner-proof/ROOT_NATIVE_CHECKPOINT.md.
export const CURRENT_LIMIT_OWNER_NATIVE_ADMISSION=Object.freeze({refresh:true,claim:true,pause:true,resume:true,close:true,topup:false,reprice:false});
const heldOwnerAdmission=Object.freeze({refresh:false,claim:false,pause:false,resume:false,close:false,topup:false,reprice:false});
// b2aa Limits51/52/53: native owner exits and exact top-up/reprice, 2026-10-13.
// Evidence: reports/owned-limit-2026-10-13/{POSITIVE_REFUND_RESULT,EDIT_NATIVE_RESULT}.json.
// Technical phase proof does not lift connected-wallet authority holds.
const exitOwnerAdmission=Object.freeze({refresh:true,claim:true,pause:true,resume:true,close:true,topup:true,reprice:true});
// 7b67: all 15 native controls and exact refund, reports/shared-history-controls-2026-10-13/RESULT.json.
export const currentLimitOwnerNativeAdmission=(key:CurrentCheapDexCandidateKey='cheap-current')=>key==='cheap-exit'||key==='cheap-history'?exitOwnerAdmission:key==='cheap-prepared'?heldOwnerAdmission:CURRENT_LIMIT_OWNER_NATIVE_ADMISSION;
/** Technical phase proof only; the shared send boundary retains wallet holds. */
export const assertCurrentLimitNativeAdmission=(key:CurrentCheapDexCandidateKey,phase:'limit-create'|'limit-snapshot'|'limit-owner',action?:CurrentLimitOwnerAction)=>{
  if(key==='cheap-history'&&(phase==='limit-create'||phase==='limit-snapshot'))return;
  if((key==='cheap-exit'||key==='cheap-history')&&phase==='limit-owner'&&action&&currentLimitOwnerNativeAdmission(key)[action])return;
  assertCurrentCheapDexNativeAdmission(resolveCurrentCheapDexCandidate(key));
};
export const currentLimitOwnerMethod=(action:CurrentLimitOwnerAction)=>action==='topup'?'topUpPrivateOrder':action==='reprice'?'repricePrivateOrder':action==='refresh'?'privateOrderSnapshot':action==='claim'?'claimPrivateOrderProceeds':action==='close'?'closePrivateOrder':'managePrivateOrderStatus';
export const currentLimitTokens=(sellToken0:boolean,selected:CurrentCheapDexCandidate=candidate,pair?:readonly[string,string])=>{const {poolTokens}=resolveCurrentLimitScope(currentCheapDexCandidateKey(selected),pair);return[poolTokens[sellToken0?0:1],poolTokens[sellToken0?1:0]]as const;};
const coder=AbiCoder.defaultAbiCoder();
export const currentLimitMappingSlot=(id:bigint,root:bigint)=>BigInt(keccak256(coder.encode(['uint256','uint256'],[id,root])));
// These public-field offsets are bound to the frozen 04ea compiler layout by tests.
export const CURRENT_LIMIT_LAYOUT=Object.freeze({coreMapping:19n,coreSources:20n,engineMapping:4n,engineSources:9n,engineStatus:2n,engineSnapshots:30n});
export const CURRENT_LIMIT_MARKET_FOR_POSITION=18n;
/** Public identity only. The caller must attest the selected registry at this block.
 * This result grants no owner, amount or signing authority. */
export const readCurrentLimitPositionBinding=async({candidate,selectedPair,positionId,block,rpc,assertCurrent}:{
  candidate:CurrentCheapDexCandidateKey;selectedPair:readonly[string,string];positionId:bigint;block:{number:bigint;hash:string};
  rpc:(method:string,params:unknown[])=>Promise<unknown>;assertCurrent:()=>void|Promise<void>
})=>{
  const scope=resolveCurrentLimitScope(candidate,selectedPair);
  if(!scope.prepared||typeof positionId!=='bigint'||positionId<8n||positionId>=1n<<256n||typeof block.number!=='bigint'||block.number<0n||!/^0x[0-9a-fA-F]{64}$/.test(block.hash))throw new Error('Invalid selected Limit position binding.');
  const word=async(host:string,root:bigint)=>{await assertCurrent();const index=currentLimitMappingSlot(positionId,root),raw=await rpc('eth_getStorageAt',[host,`0x${index.toString(16)}`,{blockHash:block.hash,requireCanonical:true}]);await assertCurrent();if(typeof raw!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(raw))throw new Error('Malformed Limit position binding.');return BigInt(raw);};
  const [market,coreSource,engineSource]=await Promise.all([word(scope.candidate.core,CURRENT_LIMIT_MARKET_FOR_POSITION),word(scope.candidate.core,CURRENT_LIMIT_LAYOUT.coreMapping),word(scope.engine,CURRENT_LIMIT_LAYOUT.engineMapping)]);
  if(market!==BigInt(scope.marketId!))throw new Error('Limit NFT belongs to another selected market.');
  if(coreSource===0n||coreSource!==engineSource)throw new Error('Limit source mapping changed.');
  return Object.freeze({marketId:scope.marketId!,poolTokens:scope.poolTokens,core:scope.candidate.core,engine:scope.engine,positionId,sourceId:coreSource,block:Object.freeze({...block}),readyToSign:false as const});
};
export const CURRENT_LIMIT_OWNER_LAYOUT=Object.freeze({engineCloseOwner:0n,engineDirectory:5n,engineEpochs:6n,nftOwners:2n,nftBalances:3n,nftApprovals:4n});
/** Exact owner state only. This does not issue a prepared action or signing authority. */
export const readCurrentLimitOwnerState=async({candidate,selectedPair,owner,positionId:id,block,closed=false,rpc,assertCurrent,attest}:{
  candidate:CurrentCheapDexCandidateKey;selectedPair?:readonly[string,string];owner:string;positionId:bigint;block:{number:bigint;hash:string};closed?:boolean;
  rpc:(method:string,params:unknown[])=>Promise<unknown>;assertCurrent:()=>void|Promise<void>;
  attest:(block:{number:bigint;hash:string})=>Promise<{registryRevision?:bigint;marketRevision?:bigint}>;
})=>{
  if(typeof id!=='bigint'||id<8n||id>=1n<<256n||!/^0x[0-9a-f]{40}$/i.test(owner)||BigInt(owner)===0n||typeof block.number!=='bigint'||block.number<0n||!/^0x[0-9a-f]{64}$/i.test(block.hash)||BigInt(block.hash)===0n)throw Error('Invalid Limit owner-state scope.');
  const scope=resolveCurrentLimitScope(candidate,selectedPair),c=scope.candidate,engine=scope.engine,nft=c.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];
  const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase(),slot=currentLimitMappingSlot,layout=CURRENT_LIMIT_LAYOUT,ol=CURRENT_LIMIT_OWNER_LAYOUT;
  const word=async(host:string,index:bigint)=>{await assertCurrent();const raw=await rpc('eth_getStorageAt',[host,toBeHex(index),{blockHash:block.hash,requireCanonical:true}]);await assertCurrent();if(typeof raw!=='string'||!/^0x[0-9a-f]{64}$/i.test(raw))throw Error('Malformed Limit authority storage.');return BigInt(raw);};
  const words=(host:string,base:bigint,length:number)=>Promise.all(Array.from({length},(_,i)=>word(host,base+BigInt(i))));
  const call=async(api:Interface,host:string,method:string,params:unknown[])=>{await assertCurrent();const raw=await rpc('eth_call',[{from:owner,to:host,data:api.encodeFunctionData(method,params)},{blockHash:block.hash,requireCanonical:true}]);await assertCurrent();if(typeof raw!=='string')throw Error('Limit call is unavailable.');const decoded=api.decodeFunctionResult(method,raw);if(!same(api.encodeFunctionResult(method,decoded),raw))throw Error('Non-canonical Limit read.');return decoded;};
  await assertCurrent();const market=await attest(block);
  if(scope.prepared)await readCurrentLimitPositionBinding({candidate,selectedPair:scope.poolTokens,positionId:id,block,rpc,assertCurrent});
  const [source,coreSource]=await Promise.all([word(engine,slot(id,layout.engineMapping)),word(c.core,slot(id,layout.coreMapping))]);
  if(source===0n||source!==coreSource)throw Error('Limit source mapping changed.');
  const [coreWords,engineWords,status,binding,ownerWord,approval,nftBalance]=await Promise.all([words(c.core,slot(source,layout.coreSources),36),words(engine,slot(source,layout.engineSources),39),word(engine,slot(source,layout.engineStatus)),call(currentLimitBindingAbi,engine,'bindingCommitment',[]),word(nft,slot(id,ol.nftOwners)),word(nft,slot(id,ol.nftApprovals)),word(nft,currentLimitAddressSlot(owner,ol.nftBalances))]);
  const flag=closed?257n:1n;
  if(coreWords.slice(0,12).some((v,i)=>v!==engineWords[i])||coreWords[0]!==flag||coreWords[2]===0n||coreWords[3]!==id||coreWords[4]!==source||coreWords[5]===0n||coreWords[6]===0n||coreWords[7]===0n||coreWords[8]===0n||coreWords[7]===coreWords[8]||coreWords.slice(9,12).some(v=>v===0n)||status>2n)throw Error('Limit public authority or lifecycle changed.');
  if(closed){const closeOwner=await word(engine,slot(id,ol.engineCloseOwner));if(closeOwner!==BigInt(owner)||ownerWord!==0n||approval!==0n)throw Error('Limit closed owner tombstone or NFT burn changed.');}
  else{const actualOwner=await call(currentPoolNftAbi,nft,'ownerOf',[id]);if(!same(actualOwner[0],owner)||ownerWord!==BigInt(owner))throw Error('The connected wallet does not own this Limit NFT.');}
  const page=coreWords[1]/8n,index=coreWords[1]%8n,[directory,epochs,snapshot,registeredCount]=await Promise.all([words(engine,slot(page,ol.engineDirectory),8),words(engine,slot(page,ol.engineEpochs),8),words(engine,slot(id,layout.engineSnapshots),32),word(engine,3n)]);
  const currentSource=directory[Number(index)],currentEpoch=epochs[Number(index)];
  // A retired slot can hold a new source only after its epoch advances; the closed source stays immutable.
  if(closed?currentEpoch<coreWords[2]||currentSource===source||currentEpoch===coreWords[2]&&currentSource!==0n:currentSource!==source||currentEpoch!==coreWords[2])throw Error('Limit source directory or epoch changed.');
  const revisions={terms:coreWords[9],ownership:coreWords[10],lifecycle:coreWords[11],closed},context=currentLimitContext(engine,binding[0],id,source,owner,revisions,c);
  await attest(block);await assertCurrent();return{marketId:scope.marketId,poolTokens:scope.poolTokens,...market,positionId:id,sourceId:source,status,context,...revisions,coreWords,engineWords,directory,epochs,snapshot,registeredCount,nftBalance,approval};
};
export type CurrentLimitOwnerState=Awaited<ReturnType<typeof readCurrentLimitOwnerState>>;
/** Validate the existing public-source transition after one owner action.
 * This pure check grants no prepared action, owner, amount or signing authority. */
export const checkCurrentLimitOwnerTransition=({action,before,after}:{action:CurrentLimitOwnerAction;before:CurrentLimitOwnerState;after:CurrentLimitOwnerState})=>{
  const equal=(a:unknown,b:unknown)=>JSON.stringify(a,(_k,v)=>typeof v==='bigint'?v.toString():v)===JSON.stringify(b,(_k,v)=>typeof v==='bigint'?v.toString():v);
  const closing=action==='close',lifeChange=closing||action==='pause'||action==='resume',expectedStatus=action==='pause'?1n:action==='resume'?0n:before.status;
  if(after.status!==expectedStatus||after.sourceId!==before.sourceId||after.terms!==before.terms+(action==='reprice'?1n:0n)||after.ownership!==before.ownership||after.lifecycle!==before.lifecycle+(lifeChange?1n:0n)||after.marketRevision!==before.marketRevision||after.registryRevision!==before.registryRevision)throw new CurrentLimitProofMismatch('Limit result lifecycle or terms changed.');
  if((action==='topup'||action==='reprice')&&(before.closed||after.closed||after.positionId!==before.positionId||before.status===2n||before.coreWords.length!==36||after.coreWords.length!==36||before.engineWords.length!==39||after.engineWords.length!==39||!equal(before.snapshot,after.snapshot)))throw new CurrentLimitProofMismatch('Limit edit source or snapshot changed.');
  const mutableCore=new Set(action==='reprice'?[9]:action==='claim'||closing||action==='topup'?[13,14,15,16]:[]),mutableEngine=new Set(action==='reprice'?[9,13,14,15,21,22,23,24,25,26,27,28]:action==='topup'?[16,17,18,19,21,22]:action==='claim'||closing?[16,17,18,19]:[]);if(lifeChange){mutableCore.add(11);mutableEngine.add(11);}if(closing){mutableCore.add(0);mutableEngine.add(0);}
  if(before.coreWords.some((v,i)=>!mutableCore.has(i)&&after.coreWords[i]!==v)||before.engineWords.some((v,i)=>!mutableEngine.has(i)&&after.engineWords[i]!==v)||!equal(before.epochs,after.epochs))throw new CurrentLimitProofMismatch('Unrelated Limit source fields changed.');
  const expectedDirectory=[...before.directory];if(closing)expectedDirectory[Number(before.coreWords[1]%8n)]=0n;
  if(!equal(expectedDirectory,after.directory)||after.registeredCount!==before.registeredCount-(closing?1n:0n)||after.nftBalance!==before.nftBalance-(closing?1n:0n)||!closing&&after.approval!==before.approval)throw new CurrentLimitProofMismatch('Limit directory or NFT accounting changed.');
};
export const currentLimitAddressSlot=(address:string,root:bigint)=>BigInt(keccak256(coder.encode(['address','uint256'],[address,root])));
export const currentLimitContext=(engine:string,binding:string,id:bigint,source:bigint,owner:string,revisions={terms:1n,ownership:1n,lifecycle:1n,closed:false},selected:CurrentCheapDexCandidate=candidate)=>keccak256(coder.encode(
  ['uint256','address','bytes32','uint256','uint256','uint256','uint256','uint256','bool','address'],
  [selected.chainId,engine,binding,id,source,revisions.terms,revisions.ownership,revisions.lifecycle,revisions.closed,owner]));
export const checkCurrentLimitOwnerValues=(values:readonly bigint[])=>{
  if(values.length!==8||values.some(v=>typeof v!=='bigint'||v<0n||v>=1n<<256n)||values[2]===0n||values[3]===0n||values.slice(2,5).some(v=>v>=1n<<128n)||values[5]!==values[0]||(values[6]!==0n&&values[6]!==1n)||values[7]!==0n)throw new CurrentLimitProofMismatch('Invalid current plain Limit owner snapshot.');
  return Object.freeze({unspent:values[0],proceeds:values[1],priceNumerator:values[2],priceDenominator:values[3],makerMinimum:values[4],sellToken0:values[6]===1n});
};
export const decodeCurrentLimitOwnerEvent=(logs:readonly {address:string;topics:readonly string[];data:string}[],action:CurrentLimitOwnerAction,id:bigint,selected:CurrentCheapDexCandidate=candidate,expectedTermsRevision?:bigint)=>{
  const rows=logs.filter(x=>x.address.toLowerCase()===selected.core.toLowerCase()),name=action==='claim'?'FixedProceedsClaimed':action==='close'?'FixedPositionClosed':action==='topup'?'FixedPositionToppedUp':action==='reprice'?'FixedPositionRepriced':null;
  if(!name){if(rows.length)throw new CurrentLimitProofMismatch('Unexpected Limit owner event.');return;}
  if(rows.length!==1)throw new CurrentLimitProofMismatch('Limit owner event is missing or duplicated.');const row=rows[0],api=currentLimitAbiForCandidate(currentCheapDexCandidateKey(selected)),parsed=api.parseLog({topics:[...row.topics],data:row.data});
  if(!parsed||parsed.name!==name||parsed.args[0]!==id)throw new CurrentLimitProofMismatch('Limit owner event has another action or ID.');if(action==='reprice'&&(expectedTermsRevision===undefined||parsed.args[1]!==expectedTermsRevision+1n))throw new CurrentLimitProofMismatch('Limit repricing event terms revision changed.');const encoded=api.encodeEventLog(parsed.fragment,parsed.args);
  if(encoded.data.toLowerCase()!==row.data.toLowerCase()||encoded.topics.length!==row.topics.length||encoded.topics.some((v,i)=>v.toLowerCase()!==row.topics[i].toLowerCase()))throw new CurrentLimitProofMismatch('Non-canonical Limit owner event.');
};
export const decodeCurrentLimitMint=(logs:readonly {address:string;topics:readonly string[];data:string}[],owner:string,selected:CurrentCheapDexCandidate=candidate)=>{
  const rows=logs.filter(x=>x.address.toLowerCase()===selected.core.toLowerCase()&&x.topics[0]?.toLowerCase()===currentLimitAbi.getEvent('FixedPositionCreated')!.topicHash.toLowerCase());
  if(rows.length!==1)throw new CurrentLimitProofMismatch('Limit creation event is missing or duplicated.');
  const row=rows[0],args=currentLimitAbi.decodeEventLog('FixedPositionCreated',row.data,[...row.topics]);
  const encoded=currentLimitAbi.encodeEventLog(currentLimitAbi.getEvent('FixedPositionCreated')!,args);
  if(encoded.data.toLowerCase()!==row.data.toLowerCase()||encoded.topics.length!==row.topics.length||encoded.topics.some((x,i)=>x.toLowerCase()!==row.topics[i].toLowerCase())||args[0]<8n)throw new CurrentLimitProofMismatch('Non-canonical Limit creation event.');
  const nft=selected.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];
  decodeCurrentPoolNftTransfer(logs,nft,'0x0000000000000000000000000000000000000000',owner,args[0]);return args[0] as bigint;
};
export { currentPoolNftAbi as currentLimitNftAbi };



