import { toBeHex, Interface } from '@coti-io/coti-ethers';
import { type CurrentCheapDexCandidateKey } from '../../lib/dexV2Deployment';
import { createDexV2ReadCapability, readCurrentSharedPoolDexGraph, readPreparedDexMarketRegistry } from '../../lib/dexV2Chain';
import { currentLimitAbiForCandidate,resolveCurrentLimitScope,readCurrentLimitPositionBinding,currentLimitBindingAbi,currentLimitNftAbi,currentLimitTokens,currentLimitMappingSlot as slot,CURRENT_LIMIT_LAYOUT as layout,currentLimitContext,decodeCurrentLimitMint,
  CurrentLimitProofMismatch,readCurrentLimitOwnerState,checkCurrentLimitOwnerTransition,checkCurrentLimitOwnerValues,currentLimitOwnerMethod,decodeCurrentLimitOwnerEvent,type CurrentLimitOwnerAction } from '../../lib/currentDexLimit';
import { decodeCurrentPoolNftTransfer } from '../../lib/currentDexPoolPosition';
import { PRIVATE_ERC20_TOKEN_VNEXT_ABI } from '../../lib/appShared/contracts';
import { encryptPrivateUint128Input,encryptPrivateUint256Input,decryptPrivateUint256Output } from '../../lib/privateUint256';
import { readCurrentSharedDexTokenFunds } from '../../lib/currentSharedDexTokenFunds';
import { verifyCurrentDexCanonicalInclusion } from '../../lib/currentDexCanonicalInclusion';
import { readCurrentDexOwnedLimits } from '../../lib/currentDexOwnedLimits';
import { isCurrentAppLimitTopUpRepair } from '../../lib/currentDexC1SwapPolicy';
import { issueOwnerCotiMetaMaskCapability,type IssueOwnerCotiMetaMaskCapabilityArgs } from './ownerCotiMetaMaskCapability';
type IssueArgs=Omit<IssueOwnerCotiMetaMaskCapabilityArgs<unknown>,'bindCapability'|'capabilityLabel'|'requirePrivacy'> & Readonly<{candidate?:CurrentCheapDexCandidateKey;selectedPair?:readonly[string,string]}>;
export type CurrentLimitIntent=Readonly<{sellToken0:boolean;amount:bigint;terms:readonly [bigint,bigint,bigint,bigint,bigint]}>;
type Block=Readonly<{number:bigint;hash:string}>;
type MarketScope=Readonly<{marketId?:string;poolTokens?:readonly[string,string]}>;
export type CurrentLimitOwnerResult=MarketScope & Readonly<{positionId:bigint;sourceId:bigint;owner:string;context:string;status:bigint;closed:boolean;
  termsRevision:bigint;ownershipRevision:bigint;lifecycleRevision:bigint;transactionHash:string|null;block:Block;
  values:readonly bigint[]|null;amounts:ReturnType<typeof checkCurrentLimitOwnerValues>|null;refreshRequired:boolean;readyToSign:false}>;
export type CurrentLimitPreparedOwner=MarketScope & Readonly<{from:string;to:string;chainId:bigint;value:0n;data:string;graph:string;packageSha256:string;
  phase:'limit-owner';action:CurrentLimitOwnerAction;positionId:bigint;expectedLifecycleRevision:bigint;expectedTermsRevision:bigint;topUpAmount?:bigint;fundingToken?:string;newTerms?:CurrentLimitIntent['terms'];readyToSign:false;
  assertCurrent:()=>Promise<void>;assertAuthority:(head:Block)=>Promise<void>;readResult:(hash:string)=>Promise<CurrentLimitOwnerResult|null>}>;
export type CurrentLimitReconciledTopUp=Readonly<{phase:'limit-topup-reconciliation';from:string;to:string;chainId:bigint;graph:string;packageSha256:string;
  data:string;nonce:number;transactionHash:string;positionId:bigint;topUpAmount:bigint;receiptBlock:Block;privateWalletDeltaVerified:boolean;privateReceiptDebitsVerified:true;result:CurrentLimitOwnerResult;assertCurrent:()=>Promise<void>;readyToSign:false}>;
export type CurrentLimitFundingReview=MarketScope & Readonly<{phase:'limit-funding-review';kind:'create'|'topup';from:string;to:string;chainId:bigint;graph:string;packageSha256:string;fundingToken:string;amount:bigint;readyToSign:false;assertCurrent:()=>Promise<void>;assertAuthority:(head:Block)=>Promise<void>}>;
export type CurrentLimitFundingRequest=Readonly<{kind:'create';sellToken0:boolean;amount:bigint}>|Readonly<{kind:'topup';positionId:bigint;snapshot:CurrentLimitOwnerResult;expectedContext:string;amount:bigint}>;
const sessions=new WeakMap<object,object>();
export const assertCurrentLimitPrepared=(value:unknown,signer:object)=>{if(!value||typeof value!=='object'||sessions.get(value)!==signer)throw new Error('Limit was not prepared in this owner session.');};
const same=(a:string|null,b:string)=>typeof a==='string'&&a.toLowerCase()===b.toLowerCase();
const transfer=new Interface(['event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
const approvalEvent=new Interface(['event Approval(address indexed owner,address indexed spender,(uint256 ciphertextHigh,uint256 ciphertextLow) ownerValue,(uint256 ciphertextHigh,uint256 ciphertextLow) spenderValue)']);
const uint=(v:bigint,bits:number,positive=false)=>{if(typeof v!=='bigint'||v<(positive?1n:0n)||v>=1n<<BigInt(bits))throw new Error('Invalid exact Limit amount or terms.');};
export const issueCurrentDexLimitCapability=({candidate='cheap-current',selectedPair,...args}:IssueArgs)=>issueOwnerCotiMetaMaskCapability({...args,capabilityLabel:'current plain Limit preparation',requirePrivacy:true,
  bindCapability:async({signer,readProvider,ownerAddress,chainId,assertCurrent,assertSnapshotCurrent})=>{
    const scope=resolveCurrentLimitScope(candidate,selectedPair),c=scope.candidate,abi=currentLimitAbiForCandidate(candidate);
    const poolTokens=[...c.tokens].sort(([a],[b])=>BigInt(a)<BigInt(b)?-1:1),marketFields=Object.freeze({marketId:scope.marketId,poolTokens:scope.poolTokens});
    const initialAes=signer.getUserOnboardInfo()?.aesKey;
    const readCapability=createDexV2ReadCapability({chainId,assertCurrent,provider:{request:({method,params})=>readProvider.send(method,params??[])}});
    const guard=async()=>{await assertCurrent();assertSnapshotCurrent();if(!initialAes?.trim()||signer.getUserOnboardInfo()?.aesKey!==initialAes)throw new Error('Unlock the same owner privacy session for Limit preparation.');};
    const graph=async(block:{number:bigint;hash:string})=>{
      await guard();
      if(scope.prepared){
        const g=await readPreparedDexMarketRegistry({capability:readCapability,candidate,blockNumber:block.number,blockHash:block.hash});await guard();
        const market=g.markets.find(m=>m.marketId===scope.marketId);
        if(g.chainId!==chainId||g.graph!==c.graph||g.packageSha256!==c.packageSha256||!same(g.core,c.core)||g.releaseId!==c.releaseId||g.block.number!==block.number||!same(g.block.hash,block.hash)||!market||!same(market.engine,scope.engine)||market.token0!==scope.poolTokens[0]||market.token1!==scope.poolTokens[1]||!market.enabled||market.registryRevision!==g.registryRevision||market.registryRevision<=0n||market.marketRevision<=0n)throw new Error('Limit selected market registry changed.');
        return Object.freeze({registryRevision:market.registryRevision,marketRevision:market.marketRevision});
      }
      const g=await readCurrentSharedPoolDexGraph({capability:readCapability,candidate,blockNumber:block.number,blockHash:block.hash});await guard();
      if(g.chainId!==chainId||g.graph!==c.graph||g.packageSha256!==c.packageSha256||!same(g.core,c.core)||g.genesisHash!==c.genesisHash||g.block.number!==block.number||!same(g.block.hash,block.hash)||g.operationReadIdentity.runtimeHash!==c.runtimes.find(([role])=>role==='ChainWhisperDexCore')![2]||g.operationReadIdentity.releaseId!==c.releaseId)throw new Error('Limit candidate changed.');
      return Object.freeze({registryRevision:undefined,marketRevision:undefined});
    };
    const call=async(host:Interface,to:string,method:string,params:unknown[],block:{hash:string})=>{await guard();const raw=await readProvider.send('eth_call',[{from:ownerAddress,to,data:host.encodeFunctionData(method,params)},{blockHash:block.hash,requireCanonical:true}]);await guard();const decoded=host.decodeFunctionResult(method,raw);if(!same(host.encodeFunctionResult(method,decoded),raw))throw new Error('Non-canonical Limit read.');return decoded;};
    const word=async(to:string,index:bigint,block:{hash:string})=>{await guard();const raw=await readProvider.send('eth_getStorageAt',[to,toBeHex(index),{blockHash:block.hash,requireCanonical:true}]);await guard();if(!/^0x[0-9a-fA-F]{64}$/.test(raw))throw new Error('Malformed Limit authority storage.');return BigInt(raw);};
    const engine=scope.engine,nft=c.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1],token=new Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI);
    const positionMarket=async(id:bigint,block:Block)=>{if(scope.prepared)await readCurrentLimitPositionBinding({candidate,selectedPair:scope.poolTokens,positionId:id,block,rpc:(method,params)=>readProvider.send(method,params),assertCurrent:guard});};
    const canonical=async(tx:Parameters<typeof verifyCurrentDexCanonicalInclusion>[1],receipt:Parameters<typeof verifyCurrentDexCanonicalInclusion>[2])=>{if(scope.prepared)await verifyCurrentDexCanonicalInclusion({rpc:(method,params)=>readProvider.send(method,params),assertCurrent:guard},tx,receipt);};
    const head=async()=>{await guard();const raw=await readProvider.send('eth_getBlockByNumber',['latest',false]);if(!raw||!/^0x[0-9a-fA-F]{64}$/.test(raw.hash))throw new Error('Limit head is unavailable.');const block=Object.freeze({number:BigInt(raw.number),hash:raw.hash as string});await graph(block);return block;};
    const ownerState=(id:bigint,block:Block,closed=false)=>readCurrentLimitOwnerState({candidate,selectedPair:scope.poolTokens,owner:ownerAddress,positionId:id,block,closed,rpc:(method,params)=>readProvider.send(method,params),assertCurrent:guard,attest:graph});
    type State=Awaited<ReturnType<typeof ownerState>>;
    const authenticated=new WeakMap<object,State>();
    const equal=(a:unknown,b:unknown)=>JSON.stringify(a,(_k,v)=>typeof v==='bigint'?v.toString():v)===JSON.stringify(b,(_k,v)=>typeof v==='bigint'?v.toString():v);
    const wallet=async(block:Block)=>{
      if(scope.prepared){
        const raw=await readProvider.send('eth_getBlockByNumber',[`0x${block.number.toString(16)}`,false]);await guard();
        if(!raw||!same(raw.hash,block.hash)||BigInt(raw.number)!==block.number)throw new Error('Limit private funds block changed.');
        const funds=await readCurrentSharedDexTokenFunds({candidate,owner:ownerAddress,head:{number:block.number,hash:block.hash,timestamp:BigInt(raw.timestamp)},rpc:(method,params)=>readProvider.send(method,params),assertCurrent:guard,decrypt:cipher=>decryptPrivateUint256Output(signer,cipher)});
        return poolTokens.map(([address])=>{const token=funds.tokens.find(t=>same(t.address,address));if(!token)throw new Error('Limit private funds token changed.');return{balance:token.balance,allowance:token.allowance};});
      }
      return Promise.all(poolTokens.map(async([address])=>{
        const [balance,allowance]=await Promise.all([call(token,address,'balanceOf(address)',[ownerAddress],block),call(token,address,'allowance(address,address)',[ownerAddress,c.core],block)]);
        const decrypt=(value:{ciphertextHigh:bigint;ciphertextLow:bigint})=>value.ciphertextHigh===0n&&value.ciphertextLow===0n?0n:decryptPrivateUint256Output(signer,value);
        await guard();return{balance:decrypt(balance[0]),allowance:decrypt(allowance[0].ownerCiphertext)};
      }));
    };
    const ownerValues=(state:State)=>{const values=Array.from({length:8},(_,i)=>{const ciphertextHigh=state.snapshot[i*4+2],ciphertextLow=state.snapshot[i*4+3];if(ciphertextHigh===0n&&ciphertextLow===0n)throw new Error('Limit owner envelope is unavailable.');return decryptPrivateUint256Output(signer,{ciphertextHigh,ciphertextLow});});checkCurrentLimitOwnerValues(values);return Object.freeze(values);};
    const verifyTopUpTokenReceipt=(rows:readonly{topics:readonly string[];data:string}[],debit:bigint,remainingAllowance:bigint)=>{
            // transferFrom emits an allowance update for both fixed-shape token legs.
            const debits=rows.filter(row=>same(row.topics[0],transfer.getEvent('Transfer')!.topicHash)),approvals=rows.filter(row=>same(row.topics[0],approvalEvent.getEvent('Approval')!.topicHash));
            if(rows.length!==2||debits.length!==1||approvals.length!==1)throw new CurrentLimitProofMismatch('Limit top-up debit or approval is missing or duplicated.');
            const row=debits[0],parsed=transfer.parseLog({topics:[...row.topics],data:row.data});if(!parsed||parsed.name!=='Transfer'||!same(parsed.args.from,ownerAddress)||!same(parsed.args.to,c.core))throw new CurrentLimitProofMismatch('Limit top-up debit has another sender or Core.');
            const encoded=transfer.encodeEventLog(parsed.fragment,parsed.args);
            if(!same(encoded.data,row.data)||encoded.topics.length!==row.topics.length||encoded.topics.some((v,i)=>!same(v,row.topics[i]))||decryptPrivateUint256Output(signer,parsed.args.senderValue)!==debit)throw new CurrentLimitProofMismatch('Limit top-up debit differs from exact offered inventory.');
            const approval=approvals[0],updated=approvalEvent.parseLog({topics:[...approval.topics],data:approval.data});
            if(!updated||updated.name!=='Approval'||!same(updated.args.owner,ownerAddress)||!same(updated.args.spender,c.core))throw new CurrentLimitProofMismatch('Limit top-up approval has another owner or Core.');
            const approvalEncoding=approvalEvent.encodeEventLog(updated.fragment,updated.args);
            if(!same(approvalEncoding.data,approval.data)||approvalEncoding.topics.length!==approval.topics.length||approvalEncoding.topics.some((v,i)=>!same(v,approval.topics[i]))||decryptPrivateUint256Output(signer,updated.args.ownerValue)!==remainingAllowance)throw new CurrentLimitProofMismatch('Limit top-up approval differs from the exact remaining allowance.');
    };
    const ownerResultReader=({id,action,origin,before,prior,balances,data,topUpAmount,fundingToken}:{id:bigint;action:CurrentLimitOwnerAction;origin:Block;before:State;prior:Pick<CurrentLimitOwnerResult,'values'|'amounts'>|null;balances:Awaited<ReturnType<typeof wallet>>;data:string;topUpAmount?:bigint;fundingToken?:string})=>async(hash:string):Promise<CurrentLimitOwnerResult|null>=>{
        await guard();const [tx,receipt]=await Promise.all([readProvider.getTransaction(hash),readProvider.getTransactionReceipt(hash)]);await guard();if(!tx||!receipt)return null;
        if(!same(tx.hash,hash)||!same(receipt.hash,hash)||tx.chainId!==chainId||!same(tx.from,ownerAddress)||!same(receipt.from,ownerAddress)||!same(tx.to,c.core)||!same(receipt.to,c.core)||tx.value!==0n||!same(tx.data,data)||receipt.status!==1||tx.blockNumber!==receipt.blockNumber||!same(tx.blockHash,receipt.blockHash)||BigInt(receipt.blockNumber)<origin.number)throw new CurrentLimitProofMismatch('Limit owner receipt differs from its reviewed call.');
        await canonical(tx,receipt);const block=Object.freeze({number:BigInt(receipt.blockNumber),hash:receipt.blockHash});await graph(block);decodeCurrentLimitOwnerEvent(receipt.logs,action,id,c,before.terms);
        const closing=action==='close',after=await ownerState(id,block,closing),nextWallet=await wallet(block);
        checkCurrentLimitOwnerTransition({action,before,after});
        const nftRows=receipt.logs.filter(x=>same(x.address,nft));if(closing){if(nftRows.length!==1)throw new CurrentLimitProofMismatch('Unexpected Limit NFT burn events.');decodeCurrentPoolNftTransfer(nftRows,nft,ownerAddress,'0x0000000000000000000000000000000000000000',id);}else if(nftRows.length)throw new CurrentLimitProofMismatch('Unexpected Limit NFT movement.');
        const payout=action==='claim'||closing;
        for(const [index,[address]]of poolTokens.entries()){
          const rows=receipt.logs.filter(x=>same(x.address,address));const offered=scope.poolTokens[prior?.amounts?.sellToken0?0:1],received=scope.poolTokens[prior?.amounts?.sellToken0?1:0],selected=scope.poolTokens.some(token=>same(token,address)),amount=payout?(same(address,offered)?(closing?prior!.amounts!.unspent:0n):same(address,received)?prior!.amounts!.proceeds:0n):0n;
          if(payout&&selected){if(rows.length!==1)throw new CurrentLimitProofMismatch('Limit payout is missing or duplicated.');const parsed=transfer.parseLog({topics:[...rows[0].topics],data:rows[0].data});if(!parsed||parsed.name!=='Transfer'||!same(parsed.args.from,c.core)||!same(parsed.args.to,ownerAddress))throw new CurrentLimitProofMismatch('Limit payout has another sender or owner.');const encoded=transfer.encodeEventLog(parsed.fragment,parsed.args);if(!same(encoded.data,rows[0].data)||encoded.topics.length!==rows[0].topics.length||encoded.topics.some((v,i)=>!same(v,rows[0].topics[i]))||decryptPrivateUint256Output(signer,parsed.args.receiverValue)!==amount)throw new CurrentLimitProofMismatch('Limit payout differs from exact proceeds or unspent inventory.');}
          else if(action==='topup'&&selected){
            verifyTopUpTokenReceipt(rows,same(address,fundingToken!)?topUpAmount!:0n,balances[index].allowance-(same(address,fundingToken!)?topUpAmount!:0n));
          }
          else if(rows.length)throw new CurrentLimitProofMismatch('Unexpected Limit token movement.');
          const debit=action==='topup'&&same(address,fundingToken!)?topUpAmount!:0n;
          if(nextWallet[index].balance!==balances[index].balance+amount-debit||nextWallet[index].allowance!==balances[index].allowance-debit)throw new CurrentLimitProofMismatch('Limit wallet credit or allowance differs from the exact payout.');
        }
        if(action!=='refresh'&&!closing&&!equal(before.snapshot,after.snapshot))throw new CurrentLimitProofMismatch('Limit action unexpectedly rewrote its owner snapshot.');
        // Claim/pause/resume do not refresh eight stored envelopes. Revoke amount authority.
        const values=action==='refresh'||closing?ownerValues(after):null;
        if(closing&&(!prior?.values||values!.some((v,i)=>v!==([0,1,5].includes(i)?0n:prior.values![i]))))throw new CurrentLimitProofMismatch('Limit Close snapshot is not zeroed with preserved maker terms.');
        await graph(block);await guard();const result=Object.freeze({...marketFields,positionId:id,sourceId:after.sourceId,owner:ownerAddress,context:after.context,status:after.status,closed:closing,termsRevision:after.terms,ownershipRevision:after.ownership,lifecycleRevision:after.lifecycle,transactionHash:hash,block,values,amounts:values?checkCurrentLimitOwnerValues(values):null,refreshRequired:action!=='refresh'&&!closing,readyToSign:false as const});authenticated.set(result,after);return result;
      };
    const prepareOwnerAction=async(request:{positionId:bigint;action:CurrentLimitOwnerAction;snapshot?:CurrentLimitOwnerResult;expectedContext?:string;topUpAmount?:bigint;newTerms?:CurrentLimitIntent['terms'];confirm:(review:{positionId:bigint;action:CurrentLimitOwnerAction;snapshot:CurrentLimitOwnerResult|null;context:string;status:bigint;topUpAmount?:bigint;fundingToken?:string;newTerms?:CurrentLimitIntent['terms']})=>Promise<boolean>}):Promise<CurrentLimitPreparedOwner|null>=>{
      request=Object.freeze({...request,...(request.newTerms?{newTerms:Object.freeze([...request.newTerms])as CurrentLimitIntent['terms']}:{})});
      const {positionId:id,action,topUpAmount,newTerms}=request;if(!['refresh','claim','pause','resume','close','topup','reprice'].includes(action)||typeof request.confirm!=='function')throw new Error('Invalid Limit owner action or confirmation.');
      if(Object.keys(request).some(k=>!['positionId','action','snapshot','expectedContext','topUpAmount','newTerms','confirm'].includes(k))||action!=='topup'&&topUpAmount!==undefined||action!=='reprice'&&newTerms!==undefined)throw new Error('Unexpected Limit owner intent fields.');
      if(action==='topup'||action==='reprice'){if(candidate!=='cheap-exit'&&candidate!=='cheap-history')throw new Error('Limit edits require the current deployment.');if(action==='topup')uint(topUpAmount!,256,true);else{if(!newTerms||newTerms.length!==5)throw new Error('Invalid exact Limit price witness.');newTerms.forEach(v=>uint(v,128));const [n,d,,u,v]=newTerms;if(n===0n||d===0n||n*u-d*v!==1n)throw new Error('Invalid exact Limit price witness.');}}
      const origin=await head(),before=await ownerState(id,origin);if(before.status===2n)throw new Error('Pending Limit requires recipient activation, outside this owner scope.');
      let prior:CurrentLimitOwnerResult|null=null;
      if(action!=='refresh'){
        prior=request.snapshot??null;const saved=prior&&authenticated.get(prior);
        if(!prior||!saved||prior.closed||prior.refreshRequired||prior.positionId!==id||!equal(saved,before)||request.expectedContext!==before.context)throw new Error('Refresh this Limit privately before managing it. Its source, terms or context changed.');
      }
      if(action==='pause'&&before.status!==0n||action==='resume'&&before.status!==1n)throw new Error('Limit status differs from this lifecycle action.');
      const fundingToken=action==='topup'?scope.poolTokens[prior!.amounts!.sellToken0?0:1]:undefined;
      if(action==='topup'&&prior!.amounts!.unspent+topUpAmount!>=1n<<256n)throw new Error('Limit top-up exceeds uint256 inventory.');
      const balances=await wallet(origin);
      if(action==='topup'){const funds=balances[poolTokens.findIndex(([address])=>same(address,fundingToken!))];if(funds.balance<topUpAmount!||funds.allowance<topUpAmount!)throw new Error('Limit top-up needs sufficient exact private balance and allowance.');}
      if(await request.confirm({positionId:id,action,snapshot:prior,context:before.context,status:before.status,topUpAmount,fundingToken,newTerms})!==true){await guard();return null;}
      await guard();if(!equal(before,await ownerState(id,await head())))throw new Error('Limit state changed during owner review.');
      const method=currentLimitOwnerMethod(action),selector=abi.getFunction(method)!.selector;
      const small=async(v:bigint)=>{await guard();const x=await encryptPrivateUint128Input(signer,v,c.core,selector);await guard();return x;};
      const wide=async(v:bigint)=>{await guard();const x=await encryptPrivateUint256Input(signer,v,c.core,selector);await guard();return x;};
      let params:unknown[]=action==='pause'||action==='resume'?[id,before.lifecycle,action==='pause'?0:1]:[id];
      if(action==='topup')params=[id,before.terms,before.lifecycle,await wide(topUpAmount!)];
      if(action==='reprice'){const terms=[],range=[];for(const v of newTerms!)terms.push(await small(v));for(let i=0;i<3;i++)range.push(await wide(0n));params=[id,before.terms,terms,range];}
      const data=abi.encodeFunctionData(method,params);
      const assertAuthority=async(block:Block)=>{if(!equal(before,await ownerState(id,block))||!equal(balances,await wallet(block)))throw new Error('Limit source, private balance, allowance or lifecycle changed before signing.');};
      const readResult=ownerResultReader({id,action,origin,before,prior,balances,data,topUpAmount,fundingToken});
      const prepared=Object.freeze({...marketFields,from:ownerAddress,to:c.core,chainId,value:0n as const,data,graph:c.graph,packageSha256:c.packageSha256,phase:'limit-owner' as const,action,positionId:id,expectedLifecycleRevision:before.lifecycle,expectedTermsRevision:before.terms,...(action==='topup'?{topUpAmount,fundingToken}:{}),...(action==='reprice'?{newTerms}:{}),assertCurrent:guard,assertAuthority,readResult,readyToSign:false as const});sessions.set(prepared,signer);return prepared;
    };
    const verifyMinedTopUp=async({transactionHash,positionId:id,expectedAmount}:Readonly<{transactionHash:string;positionId:bigint;expectedAmount:bigint}>):Promise<CurrentLimitReconciledTopUp>=>{
      if(candidate!=='cheap-exit'&&candidate!=='cheap-history')throw new Error('Limit top-up reconciliation requires the current deployment.');
      uint(expectedAmount,256,true);uint(id,256,true);
      if(id<8n||!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)||BigInt(transactionHash)===0n)throw new Error('Invalid mined Limit top-up identity.');
      await guard();const [tx,receipt]=await Promise.all([readProvider.getTransaction(transactionHash),readProvider.getTransactionReceipt(transactionHash)]);await guard();
      if(!tx||!receipt||receipt.blockNumber<1||!Number.isSafeInteger(tx.nonce)||tx.nonce<0)throw new Error('Mined Limit top-up is unavailable.');
      if(!same(tx.hash,transactionHash)||!same(receipt.hash,transactionHash)||tx.chainId!==chainId||!same(tx.from,ownerAddress)||!same(receipt.from,ownerAddress)||!same(tx.to,c.core)||!same(receipt.to,c.core)||tx.value!==0n||receipt.status!==1||tx.blockNumber!==receipt.blockNumber||!same(tx.blockHash,receipt.blockHash))throw new CurrentLimitProofMismatch('Mined Limit top-up receipt identity changed.');
      await canonical(tx,receipt);
      const decoded=abi.decodeFunctionData('topUpPrivateOrder',tx.data);
      if(decoded[0]!==id||!same(abi.encodeFunctionData('topUpPrivateOrder',decoded),tx.data))throw new CurrentLimitProofMismatch('Mined Limit top-up calldata changed.');
      const mined=await readProvider.send('eth_getBlockByNumber',[`0x${receipt.blockNumber.toString(16)}`,false]);await guard();
      if(!mined||BigInt(mined.number)!==BigInt(receipt.blockNumber)||!same(mined.hash,receipt.blockHash))throw new CurrentLimitProofMismatch('Mined Limit top-up block changed.');
      const receiptBlock=Object.freeze({number:BigInt(receipt.blockNumber),hash:receipt.blockHash});
      if(isCurrentAppLimitTopUpRepair({graph:c.graph,owner:ownerAddress,core:c.core,hash:transactionHash,nonce:tx.nonce,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,positionId:id,amount:expectedAmount})){
        if(decoded[1]!==1n||decoded[2]!==2n||tx.gasLimit!==30000000n||tx.gasPrice!==50000000n||receipt.gasPrice!==50000000n)throw new CurrentLimitProofMismatch('Approved Limit top-up call revisions or fees changed.');
        decodeCurrentLimitOwnerEvent(receipt.logs,'topup',id,c);
        if(receipt.logs.some(row=>!same(row.address,c.core)&&!scope.poolTokens.some(token=>same(token,row.address))))throw new CurrentLimitProofMismatch('Approved Limit top-up has foreign token or NFT events.');
        const block=await head(),after=await ownerState(id,block),funds=await wallet(block);
        if(after.closed||after.status!==1n||after.terms!==1n||after.ownership!==1n||after.lifecycle!==2n||!equal(ownerValues(after),[250000n,0n,2n,1n,1000n,250000n,0n,0n]))throw new CurrentLimitProofMismatch('Approved Limit top-up retained owner state changed.');
        for(const [index,[address]]of poolTokens.entries()){
          const selected=scope.poolTokens.some(token=>same(token,address)),rows=receipt.logs.filter(row=>same(row.address,address));
          if(selected){verifyTopUpTokenReceipt(rows,same(address,scope.poolTokens[1])?expectedAmount:0n,0n);if(funds[index].allowance!==0n)throw new CurrentLimitProofMismatch('Approved Limit top-up remaining allowance changed.');}
          else if(rows.length)throw new CurrentLimitProofMismatch('Approved Limit top-up moved another token.');
        }
        await canonical(tx,receipt);const current=await readProvider.send('eth_getBlockByNumber',[`0x${block.number.toString(16)}`,false]);await guard();
        if(!current||BigInt(current.number)!==block.number||!same(current.hash,block.hash))throw new CurrentLimitProofMismatch('Approved Limit top-up current block changed.');
        await graph(block);await guard();
        // The retained snapshot is a baseline, not the current funded inventory.
        const result:CurrentLimitOwnerResult=Object.freeze({...marketFields,positionId:id,sourceId:after.sourceId,owner:ownerAddress,context:after.context,status:after.status,closed:false,termsRevision:after.terms,ownershipRevision:after.ownership,lifecycleRevision:after.lifecycle,transactionHash,block,values:null,amounts:null,refreshRequired:true,readyToSign:false});authenticated.set(result,after);sessions.set(result,signer);
        const proof:CurrentLimitReconciledTopUp=Object.freeze({phase:'limit-topup-reconciliation',from:ownerAddress,to:c.core,chainId,graph:c.graph,packageSha256:c.packageSha256,data:tx.data,nonce:tx.nonce,transactionHash,positionId:id,topUpAmount:expectedAmount,receiptBlock,privateWalletDeltaVerified:false,privateReceiptDebitsVerified:true,result,assertCurrent:guard,readyToSign:false});sessions.set(proof,signer);return proof;
      }
      const parent=await readProvider.send('eth_getBlockByNumber',[`0x${(receipt.blockNumber-1).toString(16)}`,false]);await guard();
      if(!parent||BigInt(parent.number)!==BigInt(receipt.blockNumber-1)||!same(parent.hash,mined.parentHash))throw new CurrentLimitProofMismatch('Mined Limit top-up parent changed.');
      const origin=Object.freeze({number:BigInt(parent.number),hash:parent.hash as string}),before=await ownerState(id,origin),balances=await wallet(origin);
      if(before.closed||before.status===2n||decoded[1]!==before.terms||decoded[2]!==before.lifecycle)throw new CurrentLimitProofMismatch('Mined Limit top-up baseline revisions changed.');
      const values=ownerValues(before),prior={values,amounts:checkCurrentLimitOwnerValues(values)},fundingToken=scope.poolTokens[prior.amounts.sellToken0?0:1],funds=balances[poolTokens.findIndex(([address])=>same(address,fundingToken))];
      if(prior.amounts.unspent+expectedAmount>=1n<<256n||funds.balance<expectedAmount||funds.allowance<expectedAmount)throw new CurrentLimitProofMismatch('Mined Limit top-up baseline funding differs.');
      const result=await ownerResultReader({id,action:'topup',origin,before,prior,balances,data:tx.data,topUpAmount:expectedAmount,fundingToken})(transactionHash);
      if(!result)throw new Error('Mined Limit top-up result is unavailable.');
      await canonical(tx,receipt);await guard();
      sessions.set(result,signer);const proof:CurrentLimitReconciledTopUp=Object.freeze({phase:'limit-topup-reconciliation',from:ownerAddress,to:c.core,chainId,graph:c.graph,packageSha256:c.packageSha256,data:tx.data,nonce:tx.nonce,transactionHash,positionId:id,topUpAmount:expectedAmount,receiptBlock,privateWalletDeltaVerified:true,privateReceiptDebitsVerified:true,result,assertCurrent:guard,readyToSign:false});sessions.set(proof,signer);return proof;
    };
    const prepareFundingReview=async(input:CurrentLimitFundingRequest):Promise<CurrentLimitFundingReview>=>{
      const request=Object.freeze({...input});uint(request.amount,256,true);
      if(candidate!=='cheap-exit'&&candidate!=='cheap-history'||!['create','topup'].includes(request.kind)||Object.keys(request).some(k=>!(request.kind==='create'?['kind','sellToken0','amount']:['kind','positionId','snapshot','expectedContext','amount']).includes(k)))throw new Error('Invalid current Limit funding review.');
      const origin=await head(),originMarket=await graph(origin);let before:State|undefined,sellToken0:boolean;
      if(request.kind==='topup'){
        before=await ownerState(request.positionId,origin);const saved=authenticated.get(request.snapshot);
        if(!saved||request.snapshot.closed||request.snapshot.refreshRequired||!request.snapshot.amounts||request.snapshot.positionId!==request.positionId||before.status===2n||!equal(saved,before)||request.expectedContext!==before.context)throw new Error('Refresh this Limit privately before funding it.');
        if(request.snapshot.amounts.unspent+request.amount>=1n<<256n)throw new Error('Limit top-up exceeds uint256 inventory.');sellToken0=request.snapshot.amounts.sellToken0;
      }else{if(typeof request.sellToken0!=='boolean')throw new Error('Plain Limit direction is required.');sellToken0=request.sellToken0;}
      const fundingToken=scope.poolTokens[sellToken0?0:1],balances=await wallet(origin),funds=balances[poolTokens.findIndex(([address])=>same(address,fundingToken))];
      if(funds.balance<request.amount)throw new Error('Limit funding needs sufficient exact private balance.');
      const assertAuthority=async(block:Block)=>{await guard();if(!equal(originMarket,await graph(block))||!equal(balances,await wallet(block))||before&&request.kind==='topup'&&!equal(before,await ownerState(request.positionId,block)))throw new Error('Limit funding source or private wallet changed before signing.');};
      const review=Object.freeze({...marketFields,phase:'limit-funding-review' as const,kind:request.kind,from:ownerAddress,to:c.core,chainId,graph:c.graph,packageSha256:c.packageSha256,fundingToken,amount:request.amount,readyToSign:false as const,assertCurrent:guard,assertAuthority});sessions.set(review,signer);return review;
    };
    const readClosedOrder=async({positionId:id,expectedContext}:{positionId:bigint;expectedContext?:string}):Promise<CurrentLimitOwnerResult>=>{
      if(candidate!=='cheap-exit'&&candidate!=='cheap-history')throw new Error('Closed order restoration requires a supported DEX deployment.');
      const block=await head(),state=await ownerState(id,block,true);
      if(expectedContext!==undefined&&expectedContext!==state.context)throw new Error('Closed Limit context changed. Refresh orders.');
      const values=ownerValues(state),amounts=checkCurrentLimitOwnerValues(values);
      if(amounts.unspent!==0n||amounts.proceeds!==0n)throw new Error('Closed Limit owner funds are not zero.');
      const canonical=await readProvider.send('eth_getBlockByNumber',[`0x${block.number.toString(16)}`,false]);await guard();
      if(!canonical||BigInt(canonical.number)!==block.number||!same(canonical.hash,block.hash))throw new Error('Closed Limit chain head changed. Refresh orders.');
      await graph(block);await guard();
      return Object.freeze({...marketFields,positionId:id,sourceId:state.sourceId,owner:ownerAddress,context:state.context,status:state.status,closed:true,termsRevision:state.terms,ownershipRevision:state.ownership,lifecycleRevision:state.lifecycle,transactionHash:null,block,values,amounts,refreshRequired:false,readyToSign:false as const});
    };
    return Object.freeze({prepareOwnerAction,verifyMinedTopUp,prepareFundingReview,readClosedOrder,readOwnedOrders:async()=>{
      if(candidate!=='cheap-exit'&&candidate!=='cheap-history')throw new Error('Order discovery requires a supported DEX deployment.');
      const block=await head(),inventory=await readCurrentDexOwnedLimits({candidate,owner:ownerAddress,block,rpc:(method,params)=>readProvider.send(method,[...params]),assertCurrent:guard});
      const canonical=await readProvider.send('eth_getBlockByNumber',[`0x${block.number.toString(16)}`,false]);await guard();
      if(!canonical||BigInt(canonical.number)!==block.number||!same(canonical.hash,block.hash))throw new Error('Order inventory chain head changed. Refresh orders.');
      await graph(block);return inventory;
    },prepareLimit:async(request:{graph:{number:bigint;hash:string;expectedGraph:string;expectedPackageSha256:string};intent:CurrentLimitIntent;confirm:(intent:CurrentLimitIntent)=>Promise<boolean>})=>{
      const intent=Object.freeze({...request.intent,terms:Object.freeze([...request.intent.terms]) as CurrentLimitIntent['terms']});
      if(typeof intent.sellToken0!=='boolean'||intent.terms.length!==5||typeof request.confirm!=='function')throw new Error('Plain Limit direction and confirmation are required.');
      uint(intent.amount,256,true);intent.terms.forEach(v=>uint(v,128));const [n,d,,u,v]=intent.terms;
      if(n===0n||d===0n||n*u-d*v!==1n)throw new Error('Invalid exact Limit price witness.');
      const origin=Object.freeze({...request.graph});if(origin.expectedGraph!==c.graph||origin.expectedPackageSha256!==c.packageSha256)throw new Error('Wrong Limit candidate.');const originMarket=await graph(origin),creationBalances=scope.prepared?await wallet(origin):null;
      if(creationBalances){
        const offered=creationBalances[poolTokens.findIndex(([address])=>same(address,scope.poolTokens[intent.sellToken0?0:1]))];
        if(!offered||offered.balance<intent.amount)throw new Error('The offered token balance is insufficient for this Limit.');
        if(offered.allowance!==intent.amount)throw new Error('Approve the exact offered-token allowance before creating this Limit.');
      }
      if(await request.confirm(intent)!==true){await guard();return null;}await guard();await graph(origin);
      const selector=abi.getFunction('createPrivateOrder')!.selector;
      const small=async(v:bigint)=>{await guard();const x=await encryptPrivateUint128Input(signer,v,c.core,selector);await guard();return x;};
      const wide=async(v:bigint)=>{await guard();const x=await encryptPrivateUint256Input(signer,v,c.core,selector);await guard();return x;};
      const funding=await wide(intent.amount),direction=await small(intent.sellToken0?1n:0n),mode=await small(0n),terms=[];
      for(const value of intent.terms)terms.push(await small(value));const range=[];for(let i=0;i<3;i++)range.push(await wide(0n));
      const data=abi.encodeFunctionData('createPrivateOrder',[...(scope.prepared?[scope.marketId]:[]),funding,direction,mode,terms,range]);
      const assertAuthority=async(block:Block)=>{if(!equal(originMarket,await graph(block))||creationBalances&&!equal(creationBalances,await wallet(block)))throw new Error('Limit selected market or private funding changed before signing.');};
      const readResult=async(hash:string,snapshotId?:bigint)=>{
        await guard();const [tx,receipt]=await Promise.all([readProvider.getTransaction(hash),readProvider.getTransactionReceipt(hash)]);await guard();if(!tx||!receipt)return null;
        const expectedData=snapshotId?abi.encodeFunctionData('privateOrderSnapshot',[snapshotId]):data;
        if(!same(tx.hash,hash)||!same(receipt.hash,hash)||tx.chainId!==chainId||!same(tx.from,ownerAddress)||!same(receipt.from,ownerAddress)||!same(tx.to,c.core)||!same(receipt.to,c.core)||tx.value!==0n||!same(tx.data,expectedData)||receipt.status!==1||tx.blockNumber!==receipt.blockNumber||!same(tx.blockHash,receipt.blockHash)||BigInt(receipt.blockNumber)<origin.number)throw new CurrentLimitProofMismatch('Limit result differs from confirmed creation.');
        await canonical(tx,receipt);const block={number:BigInt(receipt.blockNumber),hash:receipt.blockHash};if(!equal(originMarket,await graph(block)))throw new CurrentLimitProofMismatch('Limit market revisions changed after review.');const id=snapshotId??decodeCurrentLimitMint(receipt.logs,ownerAddress,c);
        await positionMarket(id,block);
        const [owner,coreSource,engineSource,binding]=await Promise.all([call(currentLimitNftAbi,nft,'ownerOf',[id],block),word(c.core,slot(id,layout.coreMapping),block),word(engine,slot(id,layout.engineMapping),block),call(currentLimitBindingAbi,engine,'bindingCommitment',[],block)]);
        if(!same(owner[0],ownerAddress)||coreSource===0n||coreSource!==engineSource)throw new CurrentLimitProofMismatch('Limit NFT or source identity changed.');
        const [coreWords,engineWords,status]=await Promise.all([Promise.all(Array.from({length:12},(_,i)=>word(c.core,slot(coreSource,layout.coreSources)+BigInt(i),block))),Promise.all(Array.from({length:12},(_,i)=>word(engine,slot(coreSource,layout.engineSources)+BigInt(i),block))),word(engine,slot(coreSource,layout.engineStatus),block)]);
        if(coreWords.some((x,i)=>x!==engineWords[i])||coreWords[0]!==1n||coreWords[2]===0n||coreWords[3]!==id||coreWords[4]!==coreSource||coreWords[5]!==1n||coreWords[6]!==1n||coreWords[7]===0n||coreWords[8]===0n||coreWords[7]===coreWords[8]||coreWords.slice(9).some(x=>x!==1n)||status!==0n)throw new CurrentLimitProofMismatch('Limit initial authority or revision changed.');
        const context=currentLimitContext(engine,binding[0],id,coreSource,ownerAddress,undefined,c);
        const expected=[intent.amount,0n,n,d,intent.terms[2],intent.amount,intent.sellToken0?1n:0n,0n];
        if(snapshotId){
          // Only stored EOA envelopes from the admitted snapshot transaction.
          // Do not simulate MPC through eth_call or decrypt protocol ciphertext.
          const envelopes=await Promise.all(Array.from({length:8},async(_,i)=>{
            const base=slot(id,layout.engineSnapshots)+BigInt(i*4+2);
            const [ciphertextHigh,ciphertextLow]=await Promise.all([word(engine,base,block),word(engine,base+1n,block)]);
            if(ciphertextHigh===0n&&ciphertextLow===0n)throw new Error('Limit owner snapshot is unavailable.');return{ciphertextHigh,ciphertextLow};
          }));
          const values=envelopes.map(value=>decryptPrivateUint256Output(signer,value));await guard();if(values.some((x,i)=>x!==expected[i]))throw new CurrentLimitProofMismatch('Limit private inventory, price, minimum, direction or mode differs from review.');
        }
        for(const [index,address] of snapshotId?[]:currentLimitTokens(intent.sellToken0,c,scope.poolTokens).entries()){
          const logs=receipt.logs.filter(log=>same(log.address,address)&&same(log.topics[0],transfer.getEvent('Transfer')!.topicHash));
          const debits=logs.map(log=>{const parsed=transfer.parseLog({topics:[...log.topics],data:log.data})!;const encoded=transfer.encodeEventLog(parsed.fragment,parsed.args);if(!same(encoded.data,log.data)||encoded.topics.length!==log.topics.length||encoded.topics.some((x,i)=>!same(x,log.topics[i])))throw new CurrentLimitProofMismatch('Non-canonical Limit debit.');return parsed.args;}).filter(x=>same(x.from,ownerAddress)&&same(x.to,c.core));
          if(debits.length!==1||decryptPrivateUint256Output(signer,debits[0].senderValue)!==(index===0?intent.amount:0n))throw new CurrentLimitProofMismatch('Limit creation debit differs from offered budget.');await guard();
        }
        if(scope.prepared){
          const otherTokens=poolTokens.filter(([address])=>!scope.poolTokens.some(token=>same(token,address)));
          if(receipt.logs.some(log=>otherTokens.some(([address])=>same(log.address,address))))throw new CurrentLimitProofMismatch('Limit moved a token outside its selected pair.');
          if(!snapshotId){
            const afterBalances=await wallet(block),offered=scope.poolTokens[intent.sellToken0?0:1];
            for(const [index,[address]]of poolTokens.entries()){
              const amount=same(address,offered)?intent.amount:0n;
              if(afterBalances[index].balance!==creationBalances![index].balance-amount||afterBalances[index].allowance!==creationBalances![index].allowance-amount)throw new CurrentLimitProofMismatch('Limit creation wallet debit or allowance differs from its exact budget.');
            }
          }
        }
        await graph(block);
        if(snapshotId)return Object.freeze({...marketFields,positionId:id,sourceId:coreSource,context,intent,transactionHash:hash,block:Object.freeze(block),readyToSign:false as const});
        const prepareSnapshot=async(confirm:()=>Promise<boolean>)=>{await guard();if(typeof confirm!=='function')throw new Error('Confirm the owner snapshot.');if(await confirm()!==true){await guard();return null;}await guard();
          if(!await readResult(hash))throw new Error('Limit creation is unavailable.');
          const assertAuthority=async(head:{number:bigint;hash:string})=>{if(!equal(originMarket,await graph(head)))throw new Error('Limit market revisions changed before snapshot.');await positionMarket(id,head);
            const [currentOwner,source,status,revision,ownership,lifecycle]=await Promise.all([call(currentLimitNftAbi,nft,'ownerOf',[id],head),word(engine,slot(id,layout.engineMapping),head),word(engine,slot(coreSource,layout.engineStatus),head),word(engine,slot(coreSource,layout.engineSources)+9n,head),word(engine,slot(coreSource,layout.engineSources)+10n,head),word(engine,slot(coreSource,layout.engineSources)+11n,head)]);
            if(!same(currentOwner[0],ownerAddress)||source!==coreSource||status!==0n||revision!==1n||ownership!==1n||lifecycle!==1n)throw new Error('Limit owner or initial authority changed before snapshot.');};
          const prepared=Object.freeze({...marketFields,from:ownerAddress,to:c.core,chainId,value:0n,data:abi.encodeFunctionData('privateOrderSnapshot',[id]),intent,positionId:id,graph:c.graph,packageSha256:c.packageSha256,phase:'limit-snapshot' as const,assertCurrent:guard,assertAuthority,readResult:(hash:string)=>readResult(hash,id),readyToSign:false as const});sessions.set(prepared,signer);return prepared;};
        return Object.freeze({...marketFields,positionId:id,sourceId:coreSource,context,intent,transactionHash:hash,block:Object.freeze(block),prepareSnapshot,readyToSign:false as const});
      };
      const prepared=Object.freeze({...marketFields,from:ownerAddress,to:c.core,chainId,value:0n,data,intent,graph:c.graph,packageSha256:c.packageSha256,phase:'limit-create' as const,assertCurrent:guard,assertAuthority,readResult:(hash:string)=>readResult(hash) as Promise<CurrentLimitCreationResult|null>,readyToSign:false as const});sessions.set(prepared,signer);return prepared;
    }});
  }});
export type CurrentLimitPrepared=NonNullable<Awaited<ReturnType<Awaited<ReturnType<typeof issueCurrentDexLimitCapability>>['prepareLimit']>>>;
export type CurrentLimitVerifiedResult=MarketScope & Readonly<{positionId:bigint;sourceId:bigint;context:string;intent:CurrentLimitIntent;transactionHash:string}>;
export type CurrentLimitPreparedSnapshot=Omit<CurrentLimitPrepared,'phase'|'readResult'> & Readonly<{phase:'limit-snapshot';positionId:bigint;assertAuthority:(head:{number:bigint;hash:string})=>Promise<void>;readResult:(hash:string)=>Promise<CurrentLimitVerifiedResult|null>}>;
export type CurrentLimitCreationResult=CurrentLimitVerifiedResult & Readonly<{
  prepareSnapshot:(confirm:()=>Promise<boolean>)=>Promise<CurrentLimitPreparedSnapshot|null>}>;


