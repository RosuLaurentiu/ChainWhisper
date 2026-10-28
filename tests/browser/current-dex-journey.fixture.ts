// LOCAL fixture only: no extension, network, native GC, or transaction signing.
// Production preparation, brands, graph getters, issue codec, sender and SDK decryption run unchanged.
// This is the maintained cheap-archived ledger. The bounded historical Vite config
// supplies matching default imports and a historical-only mock admission seam.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AbiCoder, Interface, toBeHex } from '@coti-io/coti-ethers';
import { decodeUint, decryptUint, decryptUint256, encodeKey, encrypt } from '@coti-io/coti-sdk-typescript';
import DexPage from '../../src/features/dex/components/DexV2Page';
import { ARCHIVED_CHEAP_DEX_CANDIDATE as c, CURRENT_CHEAP_POOL_TOKENS, currentCheapDexQuoteProtocol } from '../../src/lib/dexV2Deployment';
import { CURRENT_POOL_FUNDING_ABI } from '../../src/lib/currentDexPoolFunding';
import { issueCurrentDexPoolFundingCapability } from '../../src/features/wallet/currentDexPoolFundingCapability';
import { issueCurrentDexPoolPositionCapability } from '../../src/features/wallet/currentDexPoolPositionCapability';
import { CURRENT_POOL_POSITION_ABI, currentPoolPositionAbi, currentPoolNftAbi } from '../../src/lib/currentDexPoolPosition';
import { issueCurrentDexLimitCapability } from '../../src/features/wallet/currentDexLimitCapability';
import { currentLimitAbi,currentLimitTokens,currentLimitMappingSlot,currentLimitAddressSlot,CURRENT_LIMIT_LAYOUT } from '../../src/lib/currentDexLimit';
import { CURRENT_CHEAP_DEX_QUOTE_ABI, CURRENT_SLIPPAGE_DEX_QUOTE_ABI, CURRENT_CHEAP_DEX_OPERATION_ABI, CURRENT_DEX_RECEIPT_ABI,
  CURRENT_FAST_DEX_RECEIPT_ABI } from '../../src/lib/currentDexOperation';
import { CURRENT_DEX_ACCEPT_ABI, CURRENT_SLIPPAGE_DEX_ACCEPT_ABI } from '../../src/lib/currentDexQuoteReview';
import { PRIVATE_ERC20_TOKEN_VNEXT_ABI } from '../../src/lib/appShared/contracts';
import { issueCurrentDexQuoteCapability } from '../../src/features/wallet/currentDexQuoteCapability';
import { issueCurrentDexSubmissionCapability } from '../../src/features/wallet/currentDexSubmissionCapability';
import { issueCurrentDexReceiptCapability } from '../../src/features/wallet/currentDexReceiptCapability';

const owner = `0x${'22'.repeat(20)}`, aes = '000102030405060708090a0b0c0d0e0f';
const slippage = currentCheapDexQuoteProtocol(c);
const opening = new Interface(slippage ? CURRENT_SLIPPAGE_DEX_QUOTE_ABI : CURRENT_CHEAP_DEX_QUOTE_ABI), operation = new Interface(CURRENT_CHEAP_DEX_OPERATION_ABI);
const receipts = new Interface([...CURRENT_DEX_RECEIPT_ABI, ...CURRENT_FAST_DEX_RECEIPT_ABI]);
const accepts = new Interface([...(slippage ? CURRENT_SLIPPAGE_DEX_ACCEPT_ABI : CURRENT_DEX_ACCEPT_ABI), 'function cancelSwap(uint256)', 'function recoverSwap(uint256)']);
const token = new Interface([...PRIVATE_ERC20_TOKEN_VNEXT_ABI,
  'function claimFaucet()', 'function faucetClaimed(address) view returns(bool)', 'function faucetAmount() view returns(uint256)',
  'event FaucetClaimed(address indexed account)',
  'event Approval(address indexed owner,address indexed spender,(uint256 ciphertextHigh,uint256 ciphertextLow) ownerValue,(uint256 ciphertextHigh,uint256 ciphertextLow) spenderValue)']);
const pools = new Interface(CURRENT_POOL_FUNDING_ABI);
const claim = new Interface(['event SharedClaimCreated(uint256 indexed positionId)']);
const mint = new Interface(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
const debit = new Interface(['event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
const small = 'tuple(uint256 ciphertext,bytes signature)', large = 'tuple(tuple(uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature)';
const poolTypes = [small, `${large}[2]`, `${small}[10]`];
const abi = new Interface([
  ...CURRENT_CHEAP_DEX_OPERATION_ABI, ...CURRENT_DEX_RECEIPT_ABI, ...CURRENT_FAST_DEX_RECEIPT_ABI,
  ...CURRENT_POOL_POSITION_ABI,
  ...currentLimitAbi.fragments,
  ...['releaseId', 'marketId', 'tokenAdmissionCommitment', 'inputRuntimeHash', 'outputRuntimeHash',
    'fixedEngineRuntimeHash', 'terminalEvaluatorRuntimeHash', 'terminalEvaluatorBindingCommitment',
    'positionNFTRuntimeHash', 'selectorRuntimeHash', 'bindingCommitment'].map(name => `function ${name}() view returns(bytes32)`),
  ...['inputToken', 'outputToken', 'fixedEngine', 'terminalEvaluator', 'positionNFT', 'fastPoolQuote', 'poolTerms',
    'core', 'selector', 'snapshotOwner', 'recurringOwner', 'ownerLifecycle', 'orderWork', 'workLifecycle',
    'rangeOwner', 'rangeWork', 'matchWork'].map(name => `function ${name}() view returns(address)`),
  'function feePpm() view returns(uint32)', 'function maxWorkLifetime() view returns(uint32)'
]);
const at = (role: string) => [...c.runtimes, ...c.companions].find(([name]) => name === role)![1];
const runtime = (role: string) => [...c.runtimes, ...c.companions].find(([name]) => name === role)![2];
const engine = at('ChainWhisperFixedEngine'), nft = at('ChainWhisperDexPositionNFT');
const codes: Record<string, string> = {}, runtimeHashes: Record<string, string> = {};
[...c.runtimes, ...c.companions, ...c.tokens.map(([address, hash]) => ['token', address, hash])].forEach(([, address, hash], i) => {
  const code = `0xdead${i.toString(16).padStart(2, '0')}`;
  codes[address] = code; runtimeHashes[code] = hash;
});
const common = { releaseId: c.releaseId, marketId: c.marketId, feePpm: c.feePpm, maxWorkLifetime: c.maxWorkLifetime,
  inputToken: c.tokens[0][0], outputToken: c.tokens[1][0], positionNFT: nft };
const values: Record<string, Record<string, string | number>> = {
  [c.core]: { ...common, tokenAdmissionCommitment: c.reviewedTokenSet,
    inputRuntimeHash: c.tokens[0][1], outputRuntimeHash: c.tokens[1][1],
    fixedEngine: engine, fixedEngineRuntimeHash: runtime('ChainWhisperFixedEngine'),
    terminalEvaluator: at('ChainWhisperDexWideTerminalGT'), terminalEvaluatorRuntimeHash: runtime('ChainWhisperDexWideTerminalGT'),
    terminalEvaluatorBindingCommitment: c.evaluatorBinding, positionNFTRuntimeHash: runtime('ChainWhisperDexPositionNFT'),
    fastPoolQuote: at('ChainWhisperDexFastPoolQuote'), poolTerms: c.poolTerms },
  [engine]: { ...common, core: c.core, selector: at('ChainWhisperFixedBoundedSelector'),
    selectorRuntimeHash: runtime('ChainWhisperFixedBoundedSelector'),bindingCommitment:toBeHex(88n,32) },
  [at('ChainWhisperDexWideTerminalGT')]: { bindingCommitment: c.evaluatorBinding },
  [nft]: { core: c.core }, [at('ChainWhisperDexFastPoolQuote')]: { core: c.core },
  [at('ChainWhisperFixedEngineFactory')]: Object.fromEntries([
    ['snapshotOwner', 'ChainWhisperFixedOwner'], ['recurringOwner', 'ChainWhisperRecurringOwnerControls'],
    ['ownerLifecycle', 'ChainWhisperOrderOwnerLifecycle'], ['orderWork', 'ChainWhisperOrderWork'],
    ['workLifecycle', 'ChainWhisperFixedWorkLifecycle'], ['rangeOwner', 'ChainWhisperRangeOwner'],
    ['rangeWork', 'ChainWhisperRangeWork'], ['matchWork', 'ChainWhisperFixedMatchWork']
  ].map(([getter, role]) => [getter, at(role)]))
};
const seal = (value: bigint) => {
  const bytes = new Uint8Array(16);
  for (let i = 15; i >= 0; i--) { bytes[i] = Number(value & 255n); value >>= 8n; }
  const encrypted = encrypt(encodeKey(aes), bytes);
  return decodeUint(new Uint8Array([...encrypted.ciphertext, ...encrypted.r]));
};
const wide = (value: bigint) => [seal(value >> 128n), seal(value & ((1n << 128n) - 1n))];
const zero = toBeHex(0, 32), initialNumber = Number(c.attestationBlock.number) + 100;
let head = initialNumber, stage = 0, deadline = 0n, context = zero, profile = 'fast-pool';
let active = true, gasLimit = 150_000_000n, nonce = 4, operationId = 0n;
let receiptAvailable = true, interrupted = false, refundOnly = false, corruptPayout = false, graphDrift = false;
let adverseDelivery = false;
let signingAttempts = 0, denySignature = false;
let inputSignatureRequests = 0;
let waitReceipt = false;
let nextOperationId = 101n;
let revertNext = false, quoteAmountDrift = false, belowMinimumFill = false;
let poolMode = 0n, poolContext = zero, poolAmounts: bigint[] = [], poolPositionId = 81n, badPoolDebit = false;
let claimStatus=1n,claimRevision=1n,claimOwnership=1n,claimLifecycle=1n,claimOwner=owner,recipientCode='0x',claimContext=toBeHex(999n,32);
let claimValues=[200n,100n,200n,400n,0n,0n,0n,0n,0n,1n];
let limitId=91n,limitDirection=true,limitAmount=0n,limitTerms:bigint[]=[],limitWords=new Map<string,bigint>(),badLimitTerms=false;
let limitProceeds=0n,limitClosed=false,limitBalances=[1000n,1000n],badLimitPayout=false;
const putLimit=(address:string,index:bigint,value:bigint)=>limitWords.set(`${address}:${index}`,value);
const writeLimitSnapshot=()=>[limitAmount,limitProceeds,...limitTerms.slice(0,3),limitAmount,limitDirection?1n:0n,0n].forEach((value,i)=>{
  const words=wide(value+(badLimitTerms&&i===2?1n:0n)),base=currentLimitMappingSlot(limitId,30n)+BigInt(i*4+2);putLimit(engine,base,words[0]);putLimit(engine,base+1n,words[1]);
});
const initializeLimitAuthority=()=>{
  // Independent frozen-state producer: no verifier write-set is consulted.
  putLimit(c.core,currentLimitMappingSlot(limitId,19n),24n);putLimit(engine,currentLimitMappingSlot(limitId,4n),24n);
  for(const [address,root]of [[c.core,20n],[engine,9n]]as const)[1n,0n,1n,limitId,24n,1n,1n,40n,41n,1n,1n,1n].forEach((v,i)=>putLimit(address,currentLimitMappingSlot(24n,root)+BigInt(i),v));
  putLimit(engine,currentLimitMappingSlot(0n,5n),24n);putLimit(engine,currentLimitMappingSlot(0n,6n),1n);putLimit(engine,3n,1n);
  putLimit(nft,currentLimitMappingSlot(limitId,2n),BigInt(owner));putLimit(nft,currentLimitAddressSlot(owner,3n),1n);
};
const sends: Array<{ name: string; operationId: string; nonce: number; gasLimit: string; data: string }> = [];
const txs = new Map<string, Record<string, unknown>>(), mined = new Map<string, Record<string, unknown>>();
const calls: string[] = [];
let tokenAllowances = [1000n, 1000n], tokenClaimed = [false, false], badFundingCredit = false;
let balanceReadFailure = false, balanceReadDelay = 0, privacyUnlocked = true;
let wrongWalletResponseNonce = false;
let missingWalletChainId = false;
let delayedTransactionVisibility = false;
const blockHash = (number: number) => toBeHex(BigInt(number), 32);
const quantity = (number: number | bigint) => `0x${BigInt(number).toString(16)}`;
const assertCurrent = () => { if (!active) throw new Error('Test wallet session revoked.'); };
const send = async (method: string, params: unknown[]) => {
  assertCurrent();
  if (method === 'eth_chainId') return '0x6c11a0';
  if (method === 'eth_gasPrice') return '0x2160ebc';
  if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
  if (method === 'eth_getBlockByNumber') {
    const number = params[0] === 'latest' ? head : Number(BigInt(params[0] as string));
    return { number: quantity(number), hash: number === 0 ? c.genesisHash :
      number === Number(c.attestationBlock.number) ? c.attestationBlock.hash : blockHash(number),
      timestamp: quantity(Math.floor(Date.now() / 1000) - 1), gasLimit: quantity(gasLimit) };
  }
  const selector = params[method === 'eth_getStorageAt' ? 2 : 1] as { blockHash: string; requireCanonical: boolean };
  if (!selector?.requireCanonical || BigInt(selector.blockHash) > BigInt(head) ||
      BigInt(selector.blockHash) < BigInt(initialNumber)) throw new Error('Unpinned fixture RPC.');
  if (method === 'eth_getCode') return graphDrift ? '0x6001' : codes[String(params[0]).toLowerCase()]??recipientCode;
  if (method === 'eth_getStorageAt') {
    if([c.core,engine,nft].includes(String(params[0]).toLowerCase()))return toBeHex(limitWords.get(`${String(params[0]).toLowerCase()}:${BigInt(params[1] as string)}`)??0n,32);
    if (String(params[0]).toLowerCase() !== at('ChainWhisperFixedEngineFactory')) throw new Error('Unexpected storage target.');
    return c.factoryStorage.find(([slot]) => BigInt(slot) === BigInt(params[1] as string))![1];
  }
  if (method === 'eth_call') {
    const call = params[0] as { to: string; data: string; from?: string }, target = call.to.toLowerCase();
    if(target===nft&&call.data.startsWith(currentPoolNftAbi.getFunction('ownerOf')!.selector)) {
      const id=currentPoolNftAbi.decodeFunctionData('ownerOf',call.data)[0];if(id===poolPositionId&&claimStatus===4n||id===limitId&&limitClosed)throw new Error('Position NFT burned');
      return currentPoolNftAbi.encodeFunctionResult('ownerOf',[id===poolPositionId?claimOwner:owner]);
    }
    if (c.tokens.some(([address]) => address === target)) {
      if (call.from?.toLowerCase() !== mountedOwner.toLowerCase()) throw new Error('Funding read has wrong owner.');
      const parsed = token.parseTransaction({ data: call.data })!;
      if (parsed.name === 'balanceOf') {
        if (balanceReadDelay) await new Promise(resolve => setTimeout(resolve, balanceReadDelay));
        if (balanceReadFailure) throw new Error('Test balance read unavailable');
        return token.encodeFunctionResult('balanceOf(address)', [wide(limitBalances[c.tokens.findIndex(([address])=>address===target)])]);
      }
      const index = c.tokens.findIndex(([address]) => address === target);
      if (parsed.name === 'allowance') return token.encodeFunctionResult('allowance(address,address)', [[wide(999n), wide(tokenAllowances[index]), wide(888n)]]);
      if (parsed.name === 'faucetClaimed') return token.encodeFunctionResult('faucetClaimed', [tokenClaimed[index]]);
      if (parsed.name === 'faucetAmount') return token.encodeFunctionResult('faucetAmount', [10_000n * 10n ** 18n]);
      if (parsed.name === 'decimals') return token.encodeFunctionResult('decimals', [18n]);
      if (parsed.name === 'publicAmountsEnabled') return token.encodeFunctionResult('publicAmountsEnabled', [false]);
      if (parsed.name === 'accountEncryptionAddress') return token.encodeFunctionResult('accountEncryptionAddress', [toBeHex(0n, 20)]);
      throw new Error('Unexpected token call.');
    }
    const parsed = abi.parseTransaction({ data: call.data })!, name = parsed.name;
    calls.push(name);
    if(name==='poolPublicState'||name==='poolSnapshot') {
      if(parsed.args[0]!==poolPositionId||name==='poolSnapshot'&&call.from?.toLowerCase()!==claimOwner)throw new Error('Wrong claim or owner');
      return name==='poolPublicState'?abi.encodeFunctionResult(name,[[claimStatus,0n,0n,0n,claimRevision,claimOwnership,claimLifecycle,1n,claimContext]]):
        abi.encodeFunctionResult(name,[claimContext,claimValues.map(v=>[wide(999n),wide(v)])]);
    }
    if (['fastPoolQuotePublic', 'cheapAsyncPublic', 'principalReceipt', 'fastPoolPrincipalReceipt'].includes(name)) {
      if (parsed.args[0] !== operationId || operationId === 0n) throw new Error('Fixture operation ID not mined.');
      if (name === 'fastPoolQuotePublic') return operation.encodeFunctionResult(name, [context, deadline, stage === 4]);
      if (name === 'cheapAsyncPublic') return operation.encodeFunctionResult(name, [stage, context, deadline]);
      if (call.from?.toLowerCase() !== owner) throw new Error('Private receipt has wrong owner.');
      const amounts = refundOnly ? [20n, 0n, 20n, 0n, 0n, 0n] : adverseDelivery && stage >= 5 ? [20n, 15n, 5n, 16n, 1n, 15n] : belowMinimumFill ? [20n, 3n, 17n, 4n, 1n, 3n] :
        quoteAmountDrift ? [20n, 14n, 6n, 17n, 1n, 16n] : [20n, 15n, 5n, 17n, 1n, corruptPayout ? 15n : 16n];
      return receipts.encodeFunctionResult(name, [[[999n, seal(refundOnly ? 0n : 1n)],
        ...amounts.map(value => [wide(999n), wide(value)])]]);
    }
    if (values[target]?.[name] === undefined) throw new Error(`Unexpected getter ${target}:${name}`);
    return abi.encodeFunctionResult(name, [values[target][name]]);
  }
  throw new Error(`Unexpected RPC ${method}`);
};
const newSigner = () => ({ address: owner, getUserOnboardInfo: () => ({ aesKey: aes }),
  signMessage: async () => { inputSignatureRequests++; if (denySignature) throw new Error('Test wallet signature denied.'); return `0x${'44'.repeat(65)}`; },
  encryptValue: async (value: bigint) => { inputSignatureRequests++; return { ciphertext: seal(value), signature: `0x${'44'.repeat(65)}` }; },
  estimateGas: async () => { throw new Error('MPC estimate must not run.'); },
  getNonce: async () => nonce,
  sendTransaction: async (request: { data: string; nonce: number; gasLimit: bigint;to?:string }) => {
    assertCurrent();
    const parsed = opening.parseTransaction({ data: request.data }) ?? accepts.parseTransaction({ data: request.data }) ?? pools.parseTransaction({ data: request.data }) ?? currentPoolPositionAbi.parseTransaction({data:request.data}) ?? currentPoolNftAbi.parseTransaction({data:request.data}) ?? currentLimitAbi.parseTransaction({data:request.data}) ?? token.parseTransaction({ data: request.data });
    if (!parsed) throw new Error('Unknown fixture transaction.');
    const name = parsed.name, quote = name.startsWith('quote'), poolPreview = name === 'previewPoolFunding', poolFund = name === 'createPoolPosition',poolManage=name==='managePoolPosition',poolTransfer=name==='safeTransferFrom',limitCreate=name==='createPrivateOrder',limitSnapshot=name==='privateOrderSnapshot',limitClaim=name==='claimPrivateOrderProceeds',limitClose=name==='closePrivateOrder',limitManage=name==='managePrivateOrderStatus';
    const limitPayouts:bigint[]=[];
    const poolClose=poolManage&&parsed.args[2]===7n,from=mountedOwner,payouts:bigint[]=[],target=request.to??c.core;
    const tokenIndex = c.tokens.findIndex(([address]) => address === target.toLowerCase()), faucet = name === 'claimFaucet', approval = name === 'approve';
    if (request.nonce !== nonce) throw new Error('Nonce changed.');
    signingAttempts++;
    if (interrupted) throw new Error('Test transport interrupted after signing request.');
    const status = revertNext ? 0 : 1;
    revertNext = false;
    if (status === 1 && (faucet || approval)) {
      if (tokenIndex < 0) throw new Error('Not a current funding token');
      if (faucet) { if (tokenClaimed[tokenIndex]) throw new Error('Faucet already claimed'); tokenClaimed[tokenIndex] = true; limitBalances[tokenIndex] += 10_000n * 10n ** 18n - (badFundingCredit ? 1n : 0n); }
      else { if (parsed.args[0].toLowerCase() !== c.core) throw new Error('Wrong Core spender'); tokenAllowances[tokenIndex] = decryptUint256(parsed.args[1].ciphertext, aes); }
    } else if(status===1&&limitCreate){
      limitId++;limitAmount=decryptUint256(parsed.args[0].ciphertext,aes);limitDirection=decryptUint(parsed.args[1].ciphertext,aes)===1n;
      if(decryptUint(parsed.args[2].ciphertext,aes)!==0n)throw new Error('Only plain Limit mode is admitted');
      limitTerms=parsed.args[3].map((x:{ciphertext:bigint})=>decryptUint(x.ciphertext,aes));
      limitWords=new Map();const put=(address:string,index:bigint,value:bigint)=>limitWords.set(`${address}:${index}`,value),l=CURRENT_LIMIT_LAYOUT;
      put(c.core,currentLimitMappingSlot(limitId,l.coreMapping),24n);put(engine,currentLimitMappingSlot(limitId,l.engineMapping),24n);
      for(const [address,root]of [[c.core,l.coreSources],[engine,l.engineSources]]as const)[1n,0n,1n,limitId,24n,1n,1n,40n,41n,1n,1n,1n].forEach((v,i)=>put(address,currentLimitMappingSlot(24n,root)+BigInt(i),v));
      limitProceeds=0n;limitClosed=false;initializeLimitAuthority();
    }else if(status===1&&limitSnapshot){
      if(parsed.args[0]!==limitId)throw new Error('Snapshot ID differs from minted Limit');
      writeLimitSnapshot();
    }else if(status===1&&(limitClaim||limitClose||limitManage)){
      if(parsed.args[0]!==limitId||limitClosed||from!==owner)throw new Error('Wrong Limit owner or ID');
      if(limitManage){const life=limitWords.get(`${engine}:${currentLimitMappingSlot(24n,9n)+11n}`)!,statusIndex=currentLimitMappingSlot(24n,2n),currentStatus=limitWords.get(`${engine}:${statusIndex}`)??0n;
        if(parsed.args[1]!==life||!(parsed.args[2]===0n&&currentStatus===0n||parsed.args[2]===1n&&currentStatus===1n))throw new Error('Wrong Limit lifecycle or Pause/Resume status');putLimit(engine,statusIndex,parsed.args[2]===0n?1n:0n);}
      if(limitManage||limitClose)for(const [address,root]of [[c.core,20n],[engine,9n]]as const){const index=currentLimitMappingSlot(24n,root)+11n;putLimit(address,index,limitWords.get(`${address}:${index}`)!+1n);}
      if(limitClaim||limitClose){c.tokens.forEach((_,i)=>{const payout=i===(limitDirection?1:0)?(limitClose?limitAmount:0n):limitProceeds;limitPayouts.push(payout);limitBalances[i]+=payout;});limitProceeds=0n;putLimit(c.core,currentLimitMappingSlot(24n,20n)+15n,999n);putLimit(engine,currentLimitMappingSlot(24n,9n)+18n,999n);}
      if(limitClose){limitClosed=true;limitAmount=0n;for(const [address,root]of [[c.core,20n],[engine,9n]]as const)putLimit(address,currentLimitMappingSlot(24n,root),257n);putLimit(engine,currentLimitMappingSlot(limitId,0n),BigInt(owner));putLimit(engine,currentLimitMappingSlot(0n,5n),0n);putLimit(engine,3n,0n);putLimit(nft,currentLimitMappingSlot(limitId,2n),0n);putLimit(nft,currentLimitMappingSlot(limitId,4n),0n);putLimit(nft,currentLimitAddressSlot(owner,3n),0n);writeLimitSnapshot();}
    }else if (status === 1 && poolPreview) {
      const decoded = AbiCoder.defaultAbiCoder().decode(poolTypes, parsed.args[1]);
      const budgets = decoded[1].map((input: { ciphertext: { ciphertextHigh: bigint; ciphertextLow: bigint } }) => decryptUint256(input.ciphertext, aes));
      const terms = decoded[2].map((input: { ciphertext: bigint }) => decryptUint(input.ciphertext, aes));
      const n = poolMode === 0n ? terms[0] : 1n, d = poolMode === 0n ? terms[1] : 2n;
      const used0 = budgets[0] < budgets[1] * d / n ? budgets[0] : budgets[1] * d / n, used1 = used0 * n / d;
      poolContext = toBeHex(BigInt(head) + 100_000n, 32);
      const shares = used0;
      poolAmounts = [poolMode, used0, used1, budgets[0] - used0, budgets[1] - used1, shares, shares,
        terms[8], terms[9], decryptUint(decoded[0].ciphertext, aes)];
    } else if (status === 1 && poolFund) {
      if (parsed.args[0] !== poolContext || !poolAmounts.length) throw new Error('Pool funding did not bind its mined preview.');
      poolPositionId++;
      claimStatus=1n;claimRevision=1n;claimOwnership=1n;claimLifecycle=1n;claimOwner=owner;claimContext=toBeHex(BigInt(head)+200_000n,32);
      claimValues=[poolAmounts[1],poolAmounts[2],poolAmounts[5],poolAmounts[5],0n,0n,0n,0n,0n,poolAmounts[9]];
    } else if(status===1&&poolTransfer){
      if(parsed.args[0].toLowerCase()!==claimOwner||parsed.args[2]!==poolPositionId)throw new Error('Wrong NFT transfer owner');
      claimOwner=parsed.args[1].toLowerCase();claimStatus=3n;claimRevision++;claimOwnership++;claimLifecycle++;claimContext=toBeHex(BigInt(head)+300_000n,32);
    } else if(status===1&&poolManage) {
      if(parsed.args[0]!==poolPositionId||parsed.args[1]!==claimContext||from.toLowerCase()!==claimOwner)throw new Error('Wrong Pool claim or context');
      const action=parsed.args[2];
      if(action===1n||action===7n){
        const decoded=AbiCoder.defaultAbiCoder().decode(action===1n?[`${small}[2]`,`${large}[2]`]:[`${large}[2]`],parsed.args[3]);
        const fraction=action===1n?decoded[0].map((input:{ciphertext:bigint})=>decryptUint(input.ciphertext,aes)):[1n,1n];
        const removed=claimValues[2]*fraction[0]/fraction[1];
        payouts.push(...claimValues.slice(0,2).map(value=>value*removed/claimValues[2]));
        const minimums=decoded[action===1n?1:0].map((input:{ciphertext:{ciphertextHigh:bigint;ciphertextLow:bigint}})=>decryptUint256(input.ciphertext,aes));
        if(minimums.some((value:bigint,i:number)=>value>payouts[i]))throw new Error('Private minimum payout rejected');
        claimValues[2]-=removed;claimValues[3]-=removed;
        if(action===7n){claimStatus=4n;claimLifecycle++;}else{claimValues[0]-=payouts[0];claimValues[1]-=payouts[1];}
      }else if(action===6n){if(claimStatus!==3n)throw new Error('Wrong activation status');claimStatus=2n;claimLifecycle++;}
      else if(action===5n){if(claimStatus!==2n)throw new Error('Wrong resume status');claimStatus=1n;claimLifecycle++;}
      else throw new Error('Wrong owner action');
      claimRevision++;claimContext=toBeHex(BigInt(head)+300_000n,32);
    } else if (status === 1 && quote) {
      profile = name === 'quoteFastPoolV1' || name === 'quoteFastPool' ? 'fast-pool' : 'cheap-async';
      const terms = profile === 'cheap-async' ? parsed.args[0] : parsed.args;
      deadline = terms[3]; operationId = nextOperationId++;
      stage = profile === 'fast-pool' ? 4 : 1;
      context = stage === 4 ? toBeHex(operationId + 1000n, 32) : zero;
    } else if (status === 1) {
      if (parsed.args[0] !== operationId || name.startsWith('accept') && parsed.args[1] !== context) throw new Error('Accept did not use mined ID/context.');
      stage = name.startsWith('accept') ? 5 : 7; refundOnly = stage === 7;
    }
    head++;
    const hash = toBeHex(BigInt(head), 32), minedHash = blockHash(head);
    const event = status === 0 ? null : poolPreview ? pools.encodeEventLog(pools.getEvent('PoolFundingPreviewed')!, [0n, poolContext, poolAmounts.map(wide)]) :
      quote && profile === 'fast-pool' ? opening.encodeEventLog(opening.getEvent('FastPoolQuoteIssued')!, [operationId, context, deadline]) :
      profile === 'cheap-async' ? opening.encodeEventLog(opening.getEvent('CheapAsyncAdvanced')!, [operationId, stage, context]) : null;
    const poolLogs = status === 1 && poolFund ? [
      { address: c.core, ...claim.encodeEventLog(claim.getEvent('SharedClaimCreated')!, [poolPositionId]) },
      { address: nft, ...mint.encodeEventLog(mint.getEvent('Transfer')!, [toBeHex(0n, 20), owner, poolPositionId]) },
      ...CURRENT_CHEAP_POOL_TOKENS.map(([address], index) => ({ address,
        ...debit.encodeEventLog(debit.getEvent('Transfer')!, [owner, c.core, wide(poolAmounts[index + 1] + (badPoolDebit ? 1n : 0n)), wide(poolAmounts[index + 1])]) }))
    ] : [];
    const closeLogs=status===1&&(poolManage||poolTransfer)?[
      ...(poolClose||poolTransfer?[{address:nft,...mint.encodeEventLog(mint.getEvent('Transfer')!,[from,poolClose?toBeHex(0n,20):claimOwner,poolPositionId])}]:[]),
      ...payouts.map((value,index)=>({address:CURRENT_CHEAP_POOL_TOKENS[index][0],...debit.encodeEventLog(debit.getEvent('Transfer')!,
        [c.core,from,wide(value),wide(value+(badPoolDebit?1n:0n))])}))
    ]:[];
    const limitLogs=status===1&&limitCreate?[
      {address:c.core,...currentLimitAbi.encodeEventLog(currentLimitAbi.getEvent('FixedPositionCreated')!,[limitId])},
      {address:nft,...mint.encodeEventLog(mint.getEvent('Transfer')!,[toBeHex(0n,20),owner,limitId])},
      ...currentLimitTokens(limitDirection).map((address,i)=>({address,...debit.encodeEventLog(debit.getEvent('Transfer')!,[owner,c.core,wide((i?0n:limitAmount)+(badPoolDebit?1n:0n)),wide(999n)])}))
    ]:status===1&&(limitClaim||limitClose)?[
      {address:c.core,...currentLimitAbi.encodeEventLog(currentLimitAbi.getEvent(limitClaim?'FixedProceedsClaimed':'FixedPositionClosed')!,[limitId])},
      ...(limitClose?[{address:nft,...mint.encodeEventLog(mint.getEvent('Transfer')!,[owner,toBeHex(0n,20),limitId])}]:[]),
      ...c.tokens.map(([address],i)=>({address,...debit.encodeEventLog(debit.getEvent('Transfer')!,[c.core,owner,wide(999n),wide(limitPayouts[i]+(badLimitPayout?1n:0n))])}))
    ]:[];
    const tx = { ...request, hash, chainId: 7082400n, from, to: target, value: 0n, blockNumber: head, blockHash: minedHash };
    const fundingLogs = status !== 1 ? [] : faucet ? [
      { address: target, ...debit.encodeEventLog(debit.getEvent('Transfer')!, [toBeHex(0n, 20), from, wide(999n), wide(10_000n * 10n ** 18n)]) },
      { address: target, ...token.encodeEventLog(token.getEvent('FaucetClaimed')!, [from]) }
    ] : approval ? [{ address: target, ...token.encodeEventLog(token.getEvent('Approval')!, [from, c.core, wide(tokenAllowances[tokenIndex]), wide(999n)]) }] : [];
    txs.set(hash, tx); mined.set(hash, { hash, status, from, to: target, blockNumber: head, blockHash: minedHash,
      logs: faucet||approval?fundingLogs:limitCreate||limitClaim||limitClose?limitLogs:limitSnapshot||limitManage?[]:poolManage||poolTransfer ? closeLogs : poolFund ? poolLogs : event ? [{ address: c.core, ...event }] : [] });
    sends.push({ name, operationId: operationId.toString(), nonce, gasLimit: request.gasLimit.toString(), data: request.data });
    nonce++;
    return wrongWalletResponseNonce ? { ...tx, nonce: nonce + 1 } : missingWalletChainId ? { ...tx, chainId: null } : tx;
  }
});
let signer = newSigner();
const readProvider = { send, getTransaction: async (hash: string) => {
    if (delayedTransactionVisibility) { delayedTransactionVisibility = false; return null; }
    return txs.get(hash) ?? null;
  },
  getTransactionReceipt: async (hash: string) => receiptAvailable ? mined.get(hash) ?? null : null,
  waitForTransaction: async (hash: string) => waitReceipt && receiptAvailable ? mined.get(hash) ?? null : null };
const host = document.getElementById('root')!, root = createRoot(host);
const browserProvider = { request: ({ method, params }: { method: string; params?: unknown[] }) => send(method, params ?? []) };
let mountedOwner = owner, priceDisplayInverted = false;
const render = () => root.render(createElement(DexPage, { priceDisplayInverted, swapCandidate: 'cheap-archived',
  onPriceDisplayInvertedChange: (value: boolean) => { priceDisplayInverted = value; render(); }, sharedWalletSession: {
  walletAddress: mountedOwner, chainId: 7082400, browserProvider,
  sessionOnboardInfo:privacyUnlocked?{[mountedOwner.toLowerCase()]:{aesKey:aes}}:{},walletAesHealthByAddress:{},
  actions: {
    getCurrentDexQuoteCapability: () => issueCurrentDexQuoteCapability({} as never),
    getCurrentDexReceiptCapability: () => issueCurrentDexReceiptCapability({} as never),
    getCurrentDexPoolFundingCapability: () => issueCurrentDexPoolFundingCapability({ candidate: 'cheap-archived' } as never),
    getCurrentDexPoolPositionCapability: () => issueCurrentDexPoolPositionCapability({ candidate: 'cheap-archived' } as never),
    getCurrentDexLimitCapability: () => issueCurrentDexLimitCapability({ candidate: 'cheap-archived' } as never),
    getCurrentDexSubmissionCapability: () => issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-archived' } as never)
  }
} }));
const control = {
  runtimeHashes,
  seedFunding: () => { limitBalances = [0n, 0n]; tokenAllowances = [0n, 0n]; tokenClaimed = [false, false]; },
  seedLimit:(direction=true)=>{if(limitAmount!==0n)throw new Error('Limit fixture already funded');limitId=92n;limitAmount=300n;limitProceeds=7n;limitDirection=direction;limitTerms=[3n,10n,1n,7n,2n];initializeLimitAuthority();writeLimitSnapshot();},
  binding: () => {const captured=mountedOwner;const guard=()=>{assertCurrent();if(mountedOwner!==captured)throw new Error('Wallet or network changed');};return { signer, readProvider, ownerAddress: captured, chainId: 7082400n,
    assertCurrent: async () => guard(), assertSnapshotCurrent: guard };},
  snapshot: () => ({ sends, calls, signingAttempts, inputSignatureRequests, operationId: operationId.toString(), stage,
    limit:{id:limitId.toString(),unspent:limitAmount.toString(),proceeds:limitProceeds.toString(),closed:limitClosed,balances:limitBalances.map(String),status:(limitWords.get(`${engine}:${currentLimitMappingSlot(24n,2n)}`)??0n).toString(),coreLifecycle:(limitWords.get(`${c.core}:${currentLimitMappingSlot(24n,20n)+11n}`)??0n).toString(),engineLifecycle:(limitWords.get(`${engine}:${currentLimitMappingSlot(24n,9n)+11n}`)??0n).toString()},pending: sessionStorage.getItem('chainwhisper:dex:current-pending-attempt:v1') }),
  set: (next: { ready?: boolean; receiptAvailable?: boolean; waitReceipt?: boolean; interrupted?: boolean; corruptPayout?: boolean;
    graphDrift?: boolean; gasLimit?: string; wallet?: string; revoked?: boolean; contextDrift?: boolean;
    nextOperationId?: string; issueLogs?: 'missing' | 'duplicate' | 'forged'; settled?: boolean;
    revertNext?: boolean; quoteAmountDrift?: boolean; belowMinimumFill?: boolean; connected?: boolean; adverseDelivery?: boolean;
    poolMode?: 'initialize' | 'add'; badPoolDebit?: boolean; denySignature?: boolean;badLimitTerms?:boolean;badLimitPayout?:boolean;recipientCode?:string;claimContextDrift?:boolean; badFundingCredit?: boolean;
    balances?: string[]; balanceReadFailure?: boolean; balanceReadDelay?: number; privacyUnlocked?: boolean; wrongWalletResponseNonce?: boolean; missingWalletChainId?: boolean; delayedTransactionVisibility?: boolean }) => {
    if (next.delayedTransactionVisibility !== undefined) delayedTransactionVisibility = next.delayedTransactionVisibility;
    if (next.missingWalletChainId !== undefined) missingWalletChainId = next.missingWalletChainId;
    if (next.wrongWalletResponseNonce !== undefined) wrongWalletResponseNonce = next.wrongWalletResponseNonce;
    if (next.balances) limitBalances = next.balances.map(BigInt);
    if (next.balanceReadFailure !== undefined) balanceReadFailure = next.balanceReadFailure;
    if (next.balanceReadDelay !== undefined) balanceReadDelay = next.balanceReadDelay;
    if (next.privacyUnlocked !== undefined) { privacyUnlocked = next.privacyUnlocked; render(); }
    if (next.badFundingCredit !== undefined) badFundingCredit = next.badFundingCredit;
    if(next.badLimitPayout!==undefined)badLimitPayout=next.badLimitPayout;
    if(next.recipientCode!==undefined)recipientCode=next.recipientCode;
    if(next.claimContextDrift)claimContext=toBeHex(BigInt(head)+999_000n,32);
    if(next.badLimitTerms!==undefined)badLimitTerms=next.badLimitTerms;
    if (next.denySignature !== undefined) denySignature = next.denySignature;
    if (next.poolMode !== undefined) poolMode = next.poolMode === 'initialize' ? 0n : 1n;
    if (next.badPoolDebit !== undefined) badPoolDebit = next.badPoolDebit;
    if (next.ready) { stage = 4; context = toBeHex(operationId + 1000n, 32); }
    if (next.receiptAvailable !== undefined) receiptAvailable = next.receiptAvailable;
    if (next.waitReceipt !== undefined) waitReceipt = next.waitReceipt;
    if (next.interrupted !== undefined) interrupted = next.interrupted;
    if (next.corruptPayout !== undefined) corruptPayout = next.corruptPayout;
    if (next.graphDrift !== undefined) graphDrift = next.graphDrift;
    if (next.contextDrift) context = toBeHex(operationId + 2000n, 32);
    if (next.nextOperationId !== undefined) nextOperationId = BigInt(next.nextOperationId);
    if (next.settled) { if (stage !== 5) throw new Error('Fixture terminal requires funded stage 5.'); stage = 6; }
    if (next.revertNext !== undefined) revertNext = next.revertNext;
    if (next.quoteAmountDrift !== undefined) quoteAmountDrift = next.quoteAmountDrift;
    if (next.belowMinimumFill !== undefined) belowMinimumFill = next.belowMinimumFill;
    if (next.adverseDelivery !== undefined) adverseDelivery = next.adverseDelivery;
    if (next.issueLogs) {
      const receipt = [...mined.values()].at(-1)!;
      const logs = receipt.logs as Array<{ address: string; topics: string[]; data: string }>;
      receipt.logs = next.issueLogs === 'missing' ? [] : next.issueLogs === 'duplicate' ? [...logs, ...logs] :
        logs.map(log => ({ ...log, address: owner }));
    }
    if (next.gasLimit !== undefined) gasLimit = BigInt(next.gasLimit);
    if (next.revoked) active = false;
    if (next.wallet !== undefined) { mountedOwner = next.wallet;signer=newSigner(); render(); }
    if (next.connected !== undefined) { mountedOwner = next.connected ? owner : ''; render(); }
  },
  // Only the fake chain ledger survives an actual page reload; no prepared/issued app objects or signer are transferred.
  exportChain: () => JSON.stringify({ head, stage, deadline, context, profile, nonce, operationId, nextOperationId,
    sends, signingAttempts, tokenAllowances, tokenClaimed, claimStatus,claimRevision,claimOwnership,claimLifecycle,claimOwner,claimContext,claimValues,poolPositionId,limitId,limitDirection,limitAmount,limitTerms,limitProceeds,limitClosed,limitBalances,limitWords:[...limitWords], txs: [...txs], mined: [...mined] }, (_key, value) =>
    typeof value === 'bigint' ? { __testBigInt: value.toString() } : value),
  restoreChain: (raw: string) => {
    const saved = JSON.parse(raw, (_key, value) => value?.__testBigInt !== undefined ? BigInt(value.__testBigInt) : value);
    ({ head, stage, deadline, context, profile, nonce, operationId, nextOperationId, signingAttempts } = saved);
    if(saved.claimValues)({claimStatus,claimRevision,claimOwnership,claimLifecycle,claimOwner,claimContext,claimValues,poolPositionId}=saved);
    if(saved.limitWords){({limitId,limitDirection,limitAmount,limitTerms}=saved);({limitProceeds,limitClosed,limitBalances}=saved);limitWords=new Map(saved.limitWords);}
    if (saved.tokenAllowances) ({ tokenAllowances, tokenClaimed } = saved);
    sends.splice(0, sends.length, ...saved.sends);
    txs.clear(); mined.clear();
    for (const [hash, tx] of saved.txs) txs.set(hash, tx);
    for (const [hash, receipt] of saved.mined) mined.set(hash, receipt);
  },
  remount: () => { signer = newSigner(); root.render(null); setTimeout(render, 0); },
  forgedCopyRejected: async () => {
    const capability = await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-archived' } as never);
    try { await capability.submitCurrentCheapQuote({} as never); return false; } catch { return true; }
  }
};
Object.assign(window, { __currentJourney: control });
render();
