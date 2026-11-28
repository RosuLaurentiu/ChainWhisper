// LOCAL fixture only: no extension, network, native GC, or transaction signing.
// Production preparation, brands, graph getters, issue codec, sender and SDK decryption run unchanged.
// It mocks the current build 13 candidate (cheap-history, decision-034); old candidates are not selectable.
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { AbiCoder, Interface, keccak256, toBeHex } from '@coti-io/coti-ethers';
import { decodeUint, decryptUint, decryptUint256, encodeKey, encrypt } from '@coti-io/coti-sdk-typescript';
import DexPage from '../../src/features/dex/components/DexV2Page';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as c, currentCheapDexQuoteProtocol } from '../../src/lib/dexV2Deployment';
const CURRENT_CHEAP_POOL_TOKENS = [c.tokens[1], c.tokens[0]] as const;
import { CURRENT_POOL_FUNDING_ABI, PREPARED_POOL_FUNDING_ABI } from '../../src/lib/currentDexPoolFunding';
import { issueCurrentDexPoolFundingCapability } from '../../src/features/wallet/currentDexPoolFundingCapability';
import { issueCurrentDexPoolPositionCapability } from '../../src/features/wallet/currentDexPoolPositionCapability';
import { CURRENT_POOL_POSITION_ABI, currentPoolPositionAbi, currentPoolNftAbi, currentPoolSnapshotAbi } from '../../src/lib/currentDexPoolPosition';
import { POOL_EXIT_PREVIEW_ABI, computePoolExitPreviewContext } from '../../src/lib/currentDexPoolExitPreview';
import { issueCurrentDexLimitCapability } from '../../src/features/wallet/currentDexLimitCapability';
import { currentLimitAbi,currentLimitTokens,currentLimitMappingSlot,currentLimitAddressSlot,CURRENT_LIMIT_LAYOUT } from '../../src/lib/currentDexLimit';
import { CURRENT_CHEAP_DEX_QUOTE_ABI, CURRENT_SLIPPAGE_DEX_QUOTE_ABI, CURRENT_CHEAP_DEX_OPERATION_ABI, CURRENT_DEX_RECEIPT_ABI,
  CURRENT_FAST_DEX_RECEIPT_ABI } from '../../src/lib/currentDexOperation';
import { CURRENT_DEX_ACCEPT_ABI, CURRENT_SLIPPAGE_DEX_ACCEPT_ABI } from '../../src/lib/currentDexQuoteReview';
import { PRIVATE_ERC20_TOKEN_VNEXT_ABI } from '../../src/lib/appShared/contracts';
import { issueCurrentDexQuoteCapability } from '../../src/features/wallet/currentDexQuoteCapability';
import { issueCurrentDexSubmissionCapability } from '../../src/features/wallet/currentDexSubmissionCapability';
import { issueCurrentDexReceiptCapability } from '../../src/features/wallet/currentDexReceiptCapability';
import { readCurrentSharedDexTokenFunds, readCurrentSharedDexSwapFunds } from '../../src/lib/currentSharedDexTokenFunds';
import { decryptPrivateUint256Output } from '../../src/lib/privateUint256';
import { currentDexPendingStorage } from '../../src/lib/currentDexPendingAttempt';
import { CURRENT_SHARED_TOKEN_DISTRIBUTION as distribution, currentSharedDistributionVaultAbi as vaultAbi } from '../../src/lib/currentSharedDexTokenDistribution';
import { currentTokenFundingAbi } from '../../src/lib/currentDexTokenFunding';

const owner = `0x${'22'.repeat(20)}`, aes = '000102030405060708090a0b0c0d0e0f';
const slippage = currentCheapDexQuoteProtocol(c);
const opening = new Interface(slippage ? CURRENT_SLIPPAGE_DEX_QUOTE_ABI : CURRENT_CHEAP_DEX_QUOTE_ABI), operation = new Interface(CURRENT_CHEAP_DEX_OPERATION_ABI);
const receipts = new Interface([...CURRENT_DEX_RECEIPT_ABI, ...CURRENT_FAST_DEX_RECEIPT_ABI]);
const accepts = new Interface([...(slippage ? CURRENT_SLIPPAGE_DEX_ACCEPT_ABI : CURRENT_DEX_ACCEPT_ABI), 'function cancelSwap(uint256)', 'function recoverSwap(uint256)']);
const token = new Interface([...PRIVATE_ERC20_TOKEN_VNEXT_ABI,
  'function claimFaucet()', 'function faucetClaimed(address) view returns(bool)', 'function faucetAmount() view returns(uint256)',
  'event FaucetClaimed(address indexed account)',
  'event Approval(address indexed owner,address indexed spender,(uint256 ciphertextHigh,uint256 ciphertextLow) ownerValue,(uint256 ciphertextHigh,uint256 ciphertextLow) spenderValue)']);
// Build 13 Pool calls select the market; the preview event keeps its shape.
const pools = new Interface([...PREPARED_POOL_FUNDING_ABI, CURRENT_POOL_FUNDING_ABI[2]]);
const claim = new Interface(['event SharedClaimCreated(uint256 indexed positionId)']);
const snapshotEvents = currentPoolSnapshotAbi, exitEvents = new Interface(POOL_EXIT_PREVIEW_ABI);
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
// Build 13 registry: every listed pair has its own Engine, PoolTerms and math companions.
const registry = new Interface([
  'function marketForTokens(address input,address output) view returns(bytes32 selectedMarket,uint256 canonicalId,uint256 registryRevision,uint256 marketRevision,bool enabled,address engine,address terms)',
  ...['token0', 'token1', 'sharedMath'].map(name => `function ${name}() view returns(address)`)
]);
c.pairs.forEach((pair, p) => pair.companions.forEach(([, address, hash], i) => {
  if (codes[address]) return;
  const code = `0xbeef${p.toString(16).padStart(2, '0')}${i.toString(16).padStart(2, '0')}`;
  codes[address] = code; runtimeHashes[code] = hash;
}));
// The refill vault: synthetic runtime and deployment calldata preimages, checked through the same seam as the runtimes.
const vault = distribution.vault.address.toLowerCase(), vaultDeployment = distribution.vaultDeployment, vaultInput = '0xfeed01';
codes[vault] = '0xfeed00'; runtimeHashes[codes[vault]] = distribution.vault.runtimeHash; runtimeHashes[vaultInput] = vaultDeployment.calldataHash;
const FAUCET_AMOUNT = distribution.initialAmount;
const vaultValues = (): Record<string, unknown> => ({ CHAIN_ID: distribution.chainId, TOKEN_A: c.tokens[0][0], TOKEN_B: c.tokens[1][0], TOKEN_C: c.tokens[2][0], TOKEN_D: c.tokens[3][0],
  TOKEN_RUNTIME: distribution.tokenRuntimeHash, CLAIM_AMOUNT: distribution.refillAmount, INITIAL_QUOTA: distribution.initialQuota, COOLDOWN: distribution.cooldown,
  expiresAt: distribution.vault.expiresAt, recovery: distribution.vault.recovery, remainingQuota: distribution.initialQuota, nextClaimAt: 0n });
const pairGetters: Record<string, Record<string, string>> = {};
for (const pair of c.pairs) {
  const math = pair.companions.find(([role]) => role === 'ChainWhisperSharedPoolMath')![1];
  pairGetters[pair.engine] = { core: c.core, releaseId: c.releaseId, marketId: pair.marketId };
  pairGetters[pair.poolTerms] = { core: c.core, releaseId: c.releaseId, marketId: pair.marketId,
    token0: pair.tokens[0], token1: pair.tokens[1], sharedMath: math };
  pairGetters[math] = { core: c.core };
}
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
// Build 13 storage model. Each word keeps its history by block, so that a read pinned to an earlier block
// returns the earlier value. The layout is PREPARED_POOL_LAYOUT of the production snapshot reader.
const coder = AbiCoder.defaultAbiCoder(), mask128 = (1n << 128n) - 1n;
const slotOf = (key: bigint | string, slot: bigint, type = 'uint256') => BigInt(keccak256(coder.encode([type, 'uint256'], [key, slot])));
let storage = new Map<string, Array<[number, bigint]>>(), accountWrites = new Map<string, number[]>(), writeBlock = initialNumber, contextSequence = 0n;
const putWord = (address: string, slot: bigint, value: bigint) => {
  const key = `${address.toLowerCase()}:${slot}`, rows = storage.get(key) ?? [], writes = accountWrites.get(address.toLowerCase()) ?? [];
  if (rows.at(-1)?.[0] === writeBlock) rows.at(-1)![1] = value; else rows.push([writeBlock, value]);
  if (writes.at(-1) !== writeBlock) writes.push(writeBlock);
  storage.set(key, rows); accountWrites.set(address.toLowerCase(), writes);
};
const wordAt = (address: string, slot: bigint, block = Number.MAX_SAFE_INTEGER) => {
  const rows = storage.get(`${address.toLowerCase()}:${slot}`);
  if (!rows) return undefined;
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i][0] <= block) return rows[i][1];
  return 0n;
};
// The storage root of an account changes with each block that writes one of its words.
const storageRoot = (address: string, block: number) => toBeHex((accountWrites.get(address.toLowerCase()) ?? []).filter(value => value <= block).length + 1, 32);
const newContext = () => (BigInt(writeBlock) << 32n) + ++contextSequence;
const defaultPair = c.pairs.find(pair => [c.tokens[0][0], c.tokens[1][0]].every(token => (pair.tokens as readonly string[]).includes(token)))!;
const claimBase = (market: string, id: bigint) => slotOf(id, slotOf(market, 1n, 'bytes32') + 15n);
const marketOf = (id: bigint, block?: number) => toBeHex(wordAt(c.core, slotOf(id, 18n), block) ?? 0n, 32);
const claimWord = (id: bigint, index: number, block?: number) => wordAt(c.core, claimBase(marketOf(id, block), id) + BigInt(index), block) ?? 0n;
const setClaim = (id: bigint, index: number, value: bigint) => putWord(c.core, claimBase(marketOf(id), id) + BigInt(index), value);
// The plain values of each private claim. Storage holds only their owner envelopes.
let claimPlain = new Map<string, bigint[]>();
// Writes the ten owner envelopes of a claim and a new context, as poolSnapshot and each owner write do.
const sealClaim = (id: bigint, values: bigint[]) => {
  setClaim(id, 13, newContext());
  values.forEach((value, i) => { const words = wide(value); [5n, 6n, ...words].forEach((word, j) => setClaim(id, 14 + i * 4 + j, word)); });
};
const clearClaimEnvelopes = (id: bigint) => { setClaim(id, 13, 0n); for (let i = 0; i < 10; i++) { setClaim(id, 16 + i * 4, 0n); setClaim(id, 17 + i * 4, 0n); } };
const claimEnvelopes = (id: bigint) => Array.from({ length: 10 }, (_, i) => [claimWord(id, 16 + i * 4), claimWord(id, 17 + i * 4)]);
const nftOwnerOf = (id: bigint, block?: number) => toBeHex(wordAt(nft, slotOf(id, 2n), block) ?? 0n, 20);
const setNftOwner = (id: bigint, to: string) => {
  const from = nftOwnerOf(id);
  if (BigInt(from) !== 0n) putWord(nft, slotOf(from, 3n, 'address'), (wordAt(nft, slotOf(from, 3n, 'address')) ?? 1n) - 1n);
  if (BigInt(to) !== 0n) putWord(nft, slotOf(to, 3n, 'address'), (wordAt(nft, slotOf(to, 3n, 'address')) ?? 0n) + 1n);
  putWord(nft, slotOf(id, 2n), BigInt(to)); putWord(nft, slotOf(id, 6n), 1n);
};
const createClaim = (market: string, id: bigint, to: string, values: bigint[]) => {
  putWord(c.core, slotOf(id, 18n), BigInt(market)); putWord(c.core, slotOf(market, 124n, 'bytes32'), 1n);
  [[0, 1n], [4, 1n], [5, 1n], [6, 1n], [7, 1n], [59, 1n], [62, values[9]]].forEach(([index, value]) => setClaim(id, Number(index), BigInt(value)));
  sealClaim(id, values); claimPlain.set(id.toString(), [...values]); setNftOwner(id, to);
};
// Before privacy activation a claim has no stored context; its public context then follows its revision.
const publicContext = (id: bigint, block?: number) => claimWord(id, 13, block) || BigInt(keccak256(coder.encode(['uint256', 'uint256'], [id, claimWord(id, 4, block)])));
let exitPreview: { id: string; values: bigint[]; context: string } | null = null, badClaimSnapshot = false;
// Each Pool write advances the revision of the seven spread anchors of its market.
const touchAnchors = (market: string) => { for (let j = 0n; j < 7n; j++) {
  const id = wordAt(c.core, slotOf(market, 1n, 'bytes32') + 18n + j)!; setClaim(id, 4, claimWord(id, 4) + 1n); } };
const seedStorage = () => {
  // IDs 1 to 42 are the anchors (six markets, seven spreads). The fixture owner holds claim 81; the next ID is 82.
  putWord(c.core, 11n, 81n); putWord(c.core, 12n, 3n);
  c.pairs.forEach((pair, p) => {
    const base = slotOf(pair.marketId, 1n, 'bytes32');
    [c.releaseId, pair.marketId, pair.tokens[0], pair.tokens[1], nft, pair.poolTerms].forEach((value, i) => putWord(c.core, base + BigInt(i), BigInt(value)));
    for (let j = 0; j < 7; j++) {
      const id = BigInt(p * 7 + j + 1);
      putWord(c.core, base + 18n + BigInt(j), id); putWord(c.core, slotOf(id, 18n), BigInt(pair.marketId));
      setClaim(id, 0, 1n); setClaim(id, 4, 1n); setClaim(id, 62, BigInt(j));
    }
  });
};
seedStorage(); createClaim(defaultPair.marketId, 81n, owner, [200n, 100n, 200n, 400n, 0n, 0n, 0n, 0n, 0n, 1n]);
// Build 13 async stages: 1 opened, 2 to 4 work, then READY, FUNDED, SETTLED and RELEASED. A Fast Quote is READY when it is issued.
const { ready: READY, funded: FUNDED, settled: SETTLED, released: RELEASED } = c.protocol.stages;
let head = initialNumber, stage = 0, deadline = 0n, context = zero, profile = 'fast-pool';
// The private terms of the last Quote send, decrypted with the test key. Tests use them to prove what was signed.
let quoteTerms: Record<string, string> | null = null;
let operationTokens = [c.tokens[1][0], c.tokens[0][0]] as string[], fundedBlock = 0, operationMaximum = 20n;
const keeper = `0x${'55'.repeat(20)}`, work = new Interface(['function advanceFixedWork(uint256 operationId)']);
let active = true, gasLimit = 150_000_000n, nonce = 4, operationId = 0n;
// hideNewReceipts hides only the receipts of later transactions, as a slow chain does; receiptAvailable hides all.
let hiddenFromBlock = Number.MAX_SAFE_INTEGER;
const receiptVisible = (receipt?: Record<string, unknown>) => receiptAvailable && !!receipt && (receipt.blockNumber as number) < hiddenFromBlock;
let receiptAvailable = true, interrupted = false, refundOnly = false, corruptPayout = false, graphDrift = false;
let adverseDelivery = false;
let signingAttempts = 0, denySignature = false;
let inputSignatureRequests = 0;
let waitReceipt = false;
let nextOperationId = 101n;
let revertNext = false, quoteAmountDrift = false, belowMinimumFill = false;
let poolMarket = '', poolMode = 0n, poolContext = zero, poolAmounts: bigint[] = [], poolPositionId = 81n, badPoolDebit = false;
let claimStatus=1n,claimRevision=1n,claimOwnership=1n,claimLifecycle=1n,claimOwner=owner,recipientCode='0x',claimContext=toBeHex(999n,32);
let claimValues=[200n,100n,200n,400n,0n,0n,0n,0n,0n,1n];
let limitId=91n,limitDirection=true,limitAmount=0n,limitTerms:bigint[]=[],limitWords=new Map<string,bigint>(),badLimitTerms=false;
let limitProceeds=0n,limitClosed=false,limitBalances=[1000n,1000n,1000n,1000n],badLimitPayout=false;
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
// Private receipt amounts: maximum input, actual input, refund, gross output, fee and net output.
// The base case is a maximum input of 20 raw units; a larger maximum input scales each amount.
const receiptAmounts = (block = Number.MAX_SAFE_INTEGER) => (refundOnly ? [20n, 0n, 20n, 0n, 0n, 0n] :
  adverseDelivery && stage >= FUNDED && block >= fundedBlock ? [20n, 15n, 5n, 16n, 1n, 15n] : belowMinimumFill ? [20n, 3n, 17n, 4n, 1n, 3n] :
  quoteAmountDrift ? [20n, 14n, 6n, 17n, 1n, 16n] : [20n, 15n, 5n, 17n, 1n, corruptPayout ? 15n : 16n]).map(value => value * (operationMaximum / 20n));
const transferLog = (token: string, from: string, to: string, senderValue: bigint, receiverValue: bigint) =>
  ({ address: token, ...debit.encodeEventLog(debit.getEvent('Transfer')!, [from, to, wide(senderValue), wide(receiverValue)]) });
const advancedLog = () => ({ address: c.core, ...opening.encodeEventLog(opening.getEvent('CheapAsyncAdvanced')!, [operationId, stage, context]) });
// The frozen contract sends the output and the refund to the owner in this order, also for zero amounts.
const deliveryLogs = () => [transferLog(operationTokens[1], c.core, owner, 999n, receiptAmounts()[5]), transferLog(operationTokens[0], c.core, owner, 999n, receiptAmounts()[2])];
// A keeper work transaction: the public trigger that moves an async operation to READY or SETTLED.
const keeperWork = (logs: Array<{ address: string; topics: string[]; data: string }>) => {
  head = latestHead() + 1; blockTimes.set(head, seconds() - 1); writeBlock = head;
  const hash = toBeHex(BigInt(head), 32), minedHash = blockHash(head); blockTransactions.set(head, hash);
  txs.set(hash, { hash, chainId: 7082400n, from: keeper, to: c.core, value: 0n, data: work.encodeFunctionData('advanceFixedWork', [operationId]),
    nonce: head, gasLimit: 50_000_000n, gasPrice: FIXED_GAS_PRICE, blockNumber: head, blockHash: minedHash });
  mined.set(hash, { hash, status: 1, from: keeper, to: c.core, blockNumber: head, blockHash: minedHash, logs });
};
const sends: Array<{ name: string; operationId: string; nonce: number; gasLimit: string; data: string }> = [];
const txs = new Map<string, Record<string, unknown>>(), mined = new Map<string, Record<string, unknown>>();
const calls: string[] = [];
let tokenAllowances = [1000n, 1000n, 1000n, 1000n], tokenClaimed = [false, false, false, false], badFundingCredit = false;
// A token keeps one balance envelope until the balance changes; storage and balanceOf return the same words.
const balanceCiphers = new Map<number, { value: bigint; words: bigint[] }>();
const balanceCipher = (index: number) => {
  const saved = balanceCiphers.get(index);
  if (saved?.value === limitBalances[index]) return saved.words;
  const words = wide(limitBalances[index]); balanceCiphers.set(index, { value: limitBalances[index], words }); return words;
};
// One storage read at a pinned block: token balance words, the versioned model, then the earlier Limit words.
const readWord = (address: string, slot: bigint, block: number) => {
  const target = address.toLowerCase(), index = c.tokens.findIndex(([token]) => token === target);
  if (index >= 0 && mountedOwner) { const offset = slot - slotOf(mountedOwner, 4n, 'address'); if (offset >= 0n && offset < 4n) return [1n, 1n, ...balanceCipher(index)][Number(offset)]; }
  return wordAt(target, slot, block) ?? limitWords.get(`${target}:${slot}`) ?? 0n;
};
let balanceReadFailure = false, balanceReadDelay = 0, privacyUnlocked = true;
let wrongWalletResponseNonce = false;
// Kept for the Control type of older callers; the wallet returns only a hash now, so this flag changes nothing.
let missingWalletChainId = false;
let delayedTransactionVisibility = false;
const blockHash = (number: number) => toBeHex(BigInt(number), 32);
// Each block keeps one timestamp. An idle chain makes an empty block after 5 s, as a live chain does.
const blockTimes = new Map<number, number>(), blockTransactions = new Map<number, string>();
const seconds = () => Math.floor(Date.now() / 1000);
const blockTime = (number: number) => { if (!blockTimes.has(number)) blockTimes.set(number, seconds() - 1); return blockTimes.get(number)!; };
const latestHead = () => { if (seconds() - blockTime(head) >= 5) { head++; blockTimes.set(head, seconds() - 1); } return head; };
const FIXED_GAS_PRICE = 50_000_000n;
// History: the owner's last poolSnapshot of claim 81, mined in the first fixture block. The App finds it by its event.
{ const hash = toBeHex((1n << 200n) + 81n, 32), minedHash = blockHash(initialNumber); blockTransactions.set(initialNumber, hash);
  txs.set(hash, { hash, chainId: 7082400n, from: owner, to: c.core, value: 0n, data: currentPoolPositionAbi.encodeFunctionData('poolSnapshot', [81n]),
    nonce: 3, gasLimit: 30_000_000n, gasPrice: FIXED_GAS_PRICE, blockNumber: initialNumber, blockHash: minedHash });
  mined.set(hash, { hash, status: 1, from: owner, to: c.core, blockNumber: initialNumber, blockHash: minedHash,
    logs: [{ address: c.core, ...snapshotEvents.encodeEventLog(snapshotEvents.getEvent('PoolSnapshotRefreshed')!, [81n, toBeHex(claimWord(81n, 13), 32), claimEnvelopes(81n)]) }] }); }
const quantity = (number: number | bigint) => `0x${BigInt(number).toString(16)}`;
const assertCurrent = () => { if (!active) throw new Error('Test wallet session revoked.'); };
const send = async (method: string, params: unknown[]) => {
  assertCurrent();
  if (method === 'eth_chainId') return '0x6c11a0';
  if (method === 'eth_gasPrice') return quantity(FIXED_GAS_PRICE);
  if (method === 'eth_accounts') return mountedOwner ? [mountedOwner] : [];
  if (method === 'eth_getTransactionCount') return quantity(nonce);
  if (method === 'eth_getTransactionByHash' && String(params[0]).toLowerCase() === vaultDeployment.transactionHash) return { hash: vaultDeployment.transactionHash,
    from: vaultDeployment.from, to: null, nonce: quantity(vaultDeployment.nonce), chainId: quantity(7082400), value: '0x0', input: vaultInput,
    blockHash: vaultDeployment.blockHash, blockNumber: quantity(vaultDeployment.blockNumber), transactionIndex: '0x0' };
  if (method === 'eth_getTransactionReceipt' && String(params[0]).toLowerCase() === vaultDeployment.transactionHash) return { transactionHash: vaultDeployment.transactionHash,
    from: vaultDeployment.from, to: null, contractAddress: distribution.vault.address, status: '0x1', blockHash: vaultDeployment.blockHash,
    blockNumber: quantity(vaultDeployment.blockNumber), transactionIndex: '0x0', logs: [] };
  if (method === 'eth_getTransactionByHash') {
    const tx = txs.get(String(params[0]).toLowerCase()) as Record<string, unknown> | undefined;
    return tx ? { hash: tx.hash, chainId: quantity(7082400), from: tx.from, to: tx.to, value: '0x0', input: tx.data, nonce: quantity(tx.nonce as number),
      gas: quantity(tx.gasLimit as bigint), gasPrice: quantity(FIXED_GAS_PRICE), blockNumber: quantity(tx.blockNumber as number), blockHash: tx.blockHash, transactionIndex: '0x0' } : null;
  }
  if (method === 'eth_getTransactionReceipt') {
    const found = mined.get(String(params[0]).toLowerCase()) as Record<string, unknown> | undefined, receipt = receiptVisible(found) ? found : undefined;
    return receipt ? { transactionHash: receipt.hash, status: quantity(receipt.status as number), from: receipt.from, to: receipt.to,
      blockNumber: quantity(receipt.blockNumber as number), blockHash: receipt.blockHash, transactionIndex: '0x0',
      logs: (receipt.logs as Array<Record<string, unknown>>).map((log, index) => ({ ...log, logIndex: quantity(index), transactionHash: receipt.hash,
        blockNumber: quantity(receipt.blockNumber as number), blockHash: receipt.blockHash, removed: false })) } : null;
  }
  if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
  if (method === 'eth_getBlockByNumber') {
    const number = params[0] === 'latest' ? latestHead() : Number(BigInt(params[0] as string));
    if (BigInt(number) === vaultDeployment.blockNumber) return { number: quantity(number), hash: vaultDeployment.blockHash, timestamp: '0x1', gasLimit: quantity(gasLimit),
      baseFeePerGas: '0x0', transactions: [vaultDeployment.transactionHash] };
    return { number: quantity(number), hash: number === 0 ? c.genesisHash :
      number === Number(c.attestationBlock.number) ? c.attestationBlock.hash : blockHash(number),
      timestamp: quantity(blockTime(number)), gasLimit: quantity(gasLimit), baseFeePerGas: '0x0',
      transactions: blockTransactions.has(number) ? [blockTransactions.get(number)!] : [] };
  }
  const selector = params[method === 'eth_getStorageAt' || method === 'eth_getProof' ? 2 : 1] as { blockHash: string; requireCanonical: boolean };
  if (!selector?.requireCanonical || BigInt(selector.blockHash) > BigInt(head) ||
      BigInt(selector.blockHash) < BigInt(initialNumber)) throw new Error('Unpinned fixture RPC.');
  if (method === 'eth_getCode') return String(params[0]).toLowerCase() === mountedOwner.toLowerCase() ? '0x' : graphDrift ? '0x6001' : codes[String(params[0]).toLowerCase()]??recipientCode;
  if (method === 'eth_getProof') {
    const account = String(params[0]).toLowerCase(), pinned = Number(BigInt(selector.blockHash));
    return { address: account, storageHash: storageRoot(account, pinned), storageProof: (params[1] as string[]).map(key => ({ key, value: quantity(readWord(account, BigInt(key), pinned)) })) };
  }
  if (method === 'eth_getStorageAt') {
    if (String(params[0]).toLowerCase() !== at('ChainWhisperFixedEngineFactory')) return toBeHex(readWord(String(params[0]), BigInt(params[1] as string), Number(BigInt(selector.blockHash))), 32);
    return c.factoryStorage.find(([slot]) => BigInt(slot) === BigInt(params[1] as string))![1];
  }
  if (method === 'eth_call') {
    const call = params[0] as { to: string; data: string; from?: string }, target = call.to.toLowerCase();
    if(target===nft&&call.data.startsWith(currentPoolNftAbi.getFunction('ownerOf')!.selector)) {
      const id=currentPoolNftAbi.decodeFunctionData('ownerOf',call.data)[0],pinned=Number(BigInt(selector.blockHash));
      if(claimPlain.has(id.toString())){if(BigInt(nftOwnerOf(id,pinned))===0n)throw new Error('Position NFT burned');return currentPoolNftAbi.encodeFunctionResult('ownerOf',[nftOwnerOf(id,pinned)]);}
      if(id===limitId&&limitClosed)throw new Error('Position NFT burned');
      return currentPoolNftAbi.encodeFunctionResult('ownerOf',[owner]);
    }
    if (target === nft) {
      const read = currentPoolNftAbi.parseTransaction({ data: call.data }), pinned = Number(BigInt(selector.blockHash));
      if (read?.name === 'balanceOf') return currentPoolNftAbi.encodeFunctionResult('balanceOf', [wordAt(nft, slotOf(String(read.args[0]).toLowerCase(), 3n, 'address'), pinned) ?? 0n]);
      if (read?.name === 'getApproved') return currentPoolNftAbi.encodeFunctionResult('getApproved', [toBeHex(0n, 20)]);
    }
    if (c.tokens.some(([address]) => address === target)) {
      if (call.from?.toLowerCase() !== mountedOwner.toLowerCase()) throw new Error('Funding read has wrong owner.');
      const parsed = token.parseTransaction({ data: call.data });
      if (!parsed) throw new Error(`Unknown fixture token call ${target}:${call.data.slice(0, 10)}`);
      if (parsed.name === 'balanceOf') {
        if (balanceReadDelay) await new Promise(resolve => setTimeout(resolve, balanceReadDelay));
        if (balanceReadFailure) throw new Error('Test balance read unavailable');
        return token.encodeFunctionResult('balanceOf(address)', [balanceCipher(c.tokens.findIndex(([address])=>address===target))]);
      }
      const index = c.tokens.findIndex(([address]) => address === target);
      if (parsed.name === 'allowance') return token.encodeFunctionResult('allowance(address,address)', [[wide(999n), wide(tokenAllowances[index]), wide(888n)]]);
      if (parsed.name === 'faucetClaimed') return token.encodeFunctionResult('faucetClaimed', [tokenClaimed[index]]);
      if (parsed.name === 'faucetAmount') return token.encodeFunctionResult('faucetAmount', [FAUCET_AMOUNT]);
      if (parsed.name === 'decimals') return token.encodeFunctionResult('decimals', [6n]);
      if (parsed.name === 'publicAmountsEnabled') return token.encodeFunctionResult('publicAmountsEnabled', [false]);
      if (parsed.name === 'accountEncryptionAddress') return token.encodeFunctionResult('accountEncryptionAddress', [toBeHex(0n, 20)]);
      throw new Error('Unexpected token call.');
    }
    if (target === vault) {
      const read = vaultAbi.parseTransaction({ data: call.data });
      if (!read || vaultValues()[read.name] === undefined) throw new Error(`Unknown fixture vault call ${call.data.slice(0, 10)}`);
      return vaultAbi.encodeFunctionResult(read.name, [vaultValues()[read.name]]);
    }
    if (call.data.startsWith(registry.getFunction('marketForTokens')!.selector)) {
      const [input, output] = registry.decodeFunctionData('marketForTokens', call.data).map(value => String(value).toLowerCase());
      const pair = target === c.core ? c.pairs.find(row => row.tokens.includes(input) && row.tokens.includes(output) && input !== output) : undefined;
      if (!pair) throw new Error('Unlisted fixture market.');
      return registry.encodeFunctionResult('marketForTokens', [pair.marketId, BigInt(pair.canonicalId), 1n, 1n, true, pair.engine, pair.poolTerms]);
    }
    const pairGetter = registry.parseTransaction({ data: call.data }) ?? abi.parseTransaction({ data: call.data });
    if (pairGetter && values[target]?.[pairGetter.name] === undefined && pairGetters[target]?.[pairGetter.name] !== undefined) {
      return (registry.getFunction(pairGetter.name) ? registry : abi).encodeFunctionResult(pairGetter.name, [pairGetters[target][pairGetter.name]]);
    }
    const parsed = abi.parseTransaction({ data: call.data });
    if (!parsed) throw new Error(`Unknown fixture call ${target}:${call.data.slice(0, 10)}`);
    const name = parsed.name;
    calls.push(name);
    if(name==='poolPublicState') {
      const id=parsed.args[0] as bigint,pinned=Number(BigInt(selector.blockHash));
      if(!claimPlain.has(id.toString()))throw new Error('Unknown fixture claim');
      return abi.encodeFunctionResult(name,[[claimWord(id,0,pinned),0n,0n,0n,...[4,5,6,7].map(i=>claimWord(id,i,pinned)),toBeHex(publicContext(id,pinned),32)]]);
    }
    if (['fastPoolQuotePublic', 'cheapAsyncPublic', 'principalReceipt', 'fastPoolPrincipalReceipt'].includes(name)) {
      if (parsed.args[0] !== operationId || operationId === 0n) throw new Error('Fixture operation ID not mined.');
      if (name === 'fastPoolQuotePublic') return operation.encodeFunctionResult(name, [context, deadline, stage === READY]);
      if (name === 'cheapAsyncPublic') return operation.encodeFunctionResult(name, [stage, context, deadline]);
      if (call.from?.toLowerCase() !== owner) throw new Error('Private receipt has wrong owner.');
      // A read pinned before the funding block returns the Quote that the owner reviewed.
      const amounts = receiptAmounts(Number(BigInt(selector.blockHash)));
      return receipts.encodeFunctionResult(name, [[[999n, seal(refundOnly ? 0n : 1n)],
        ...amounts.map(value => [wide(999n), wide(value)])]]);
    }
    if (values[target]?.[name] === undefined) throw new Error(`Unexpected getter ${target}:${name}`);
    return abi.encodeFunctionResult(name, [values[target][name]]);
  }
  throw new Error(`Unexpected RPC ${method}`);
};
const newSigner = () => { const wallet = ({ address: owner, getAddress: async () => mountedOwner || owner, getUserOnboardInfo: () => ({ aesKey: aes }),
  signMessage: async () => { inputSignatureRequests++; if (denySignature) throw new Error('Test wallet signature denied.'); return `0x${'44'.repeat(65)}`; },
  encryptValue: async (value: bigint) => { inputSignatureRequests++; return { ciphertext: seal(value), signature: `0x${'44'.repeat(65)}` }; },
  estimateGas: async () => 1_000_000n,
  getNonce: async () => nonce,
  sendTransaction: async (request: { data: string; nonce: number; gasLimit: bigint;to?:string }) => {
    assertCurrent();
    const parsed = opening.parseTransaction({ data: request.data }) ?? accepts.parseTransaction({ data: request.data }) ?? pools.parseTransaction({ data: request.data }) ?? currentPoolPositionAbi.parseTransaction({data:request.data}) ?? currentPoolNftAbi.parseTransaction({data:request.data}) ?? currentLimitAbi.parseTransaction({data:request.data}) ?? token.parseTransaction({ data: request.data }) ?? currentTokenFundingAbi.parseTransaction({ data: request.data });
    if (!parsed) throw new Error('Unknown fixture transaction.');
    const name = parsed.name, quote = name.startsWith('quote'), poolPreview = name === 'previewPoolFunding', poolFund = name === 'createPoolPosition',poolManage=name==='managePoolPosition',poolSnapshot=name==='poolSnapshot',poolTransfer=name==='safeTransferFrom',limitCreate=name==='createPrivateOrder',limitSnapshot=name==='privateOrderSnapshot',limitClaim=name==='claimPrivateOrderProceeds',limitClose=name==='closePrivateOrder',limitManage=name==='managePrivateOrderStatus';
    const limitPayouts:bigint[]=[], swapLogs: Array<{ address: string; topics: string[]; data: string }> = [];
    const from=mountedOwner,target=request.to??c.core,positionLogs:Array<{ address: string; topics: string[]; data: string }>=[];
    const tokenIndex = c.tokens.findIndex(([address]) => address === target.toLowerCase()), faucet = name === 'claimFaucet', approval = name === 'approve' || name === 'increaseAllowance';
    if (request.nonce !== nonce) throw new Error('Nonce changed.');
    const minedBlock = latestHead() + 1;
    if (!revertNext && !interrupted) writeBlock = minedBlock;
    signingAttempts++;
    if (interrupted) throw new Error('Test transport interrupted after signing request.');
    const status = revertNext ? 0 : 1;
    revertNext = false;
    if (status === 1 && (faucet || approval)) {
      if (tokenIndex < 0) throw new Error('Not a current funding token');
      if (faucet) { if (tokenClaimed[tokenIndex]) throw new Error('Faucet already claimed'); tokenClaimed[tokenIndex] = true; limitBalances[tokenIndex] += FAUCET_AMOUNT - (badFundingCredit ? 1n : 0n); }
      else { if (parsed.args[0].toLowerCase() !== c.core) throw new Error('Wrong Core spender');
        const value = decryptUint256(parsed.args[1].ciphertext, aes);
        if (name === 'approve' && value !== 0n && tokenAllowances[tokenIndex] !== 0n) throw new Error('Approve needs a zero allowance.');
        tokenAllowances[tokenIndex] = name === 'approve' ? value : tokenAllowances[tokenIndex] + value; }
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
      // Packed build 13 inputs: the spread class, two budgets and five pairs (price, price witness, spread, spread witness, tolerance).
      if (parsed.args[1] !== 0n) throw new Error('Fixture Pool preview supports a new position only.');
      const decoded = coder.decode([small, `${large}[2]`, `${large}[5]`], parsed.args[2]);
      const budgets = decoded[1].map((input: { ciphertext: { ciphertextHigh: bigint; ciphertextLow: bigint } }) => decryptUint256(input.ciphertext, aes));
      const terms = decoded[2].flatMap((input: { ciphertext: { ciphertextHigh: bigint; ciphertextLow: bigint } }) => {
        const value = decryptUint256(input.ciphertext, aes); return [value >> 128n, value & mask128]; });
      // The price is canonical token1 for each token0. An existing Pool uses its reserve ratio (1 for 2 here).
      const n = poolMode === 0n ? terms[0] : 1n, d = poolMode === 0n ? terms[1] : 2n;
      const used0 = budgets[0] < budgets[1] * d / n ? budgets[0] : budgets[1] * d / n, used1 = used0 * n / d;
      poolContext = toBeHex(newContext(), 32); poolMarket = String(parsed.args[0]).toLowerCase();
      const shares = used0;
      poolAmounts = [poolMode, used0, used1, budgets[0] - used0, budgets[1] - used1, shares, shares,
        terms[8], terms[9], decryptUint(decoded[0].ciphertext, aes)];
    } else if (status === 1 && poolFund) {
      if (String(parsed.args[0]).toLowerCase() !== poolMarket || parsed.args[1] !== poolContext || !poolAmounts.length) throw new Error('Pool funding did not bind its mined preview.');
      const pair = c.pairs.find(row => row.marketId === poolMarket)!, indexes = pair.tokens.map(address => c.tokens.findIndex(([token]) => token === address));
      if (indexes.some((index, i) => tokenAllowances[index] < poolAmounts[i + 1] || limitBalances[index] < poolAmounts[i + 1])) throw new Error('Pool funding exceeds a balance or allowance.');
      poolPositionId = wordAt(c.core, 11n)! + 1n; putWord(c.core, 11n, poolPositionId);
      createClaim(poolMarket, poolPositionId, from, [poolAmounts[1], poolAmounts[2], poolAmounts[5], poolAmounts[5] + (poolMode === 0n ? 0n : 200n), 0n, 0n, 0n, 0n, 0n, poolAmounts[9]]);
      touchAnchors(poolMarket);
      indexes.forEach((index, i) => { limitBalances[index] -= poolAmounts[i + 1]; tokenAllowances[index] -= poolAmounts[i + 1]; });
    } else if (status === 1 && poolSnapshot) {
      const id = parsed.args[0] as bigint, plain = claimPlain.get(id.toString()), closed = claimWord(id, 0) === 4n;
      if (!plain || claimWord(id, 0) === 3n || (closed ? toBeHex(claimWord(id, 12), 20) : nftOwnerOf(id)) !== from.toLowerCase()) throw new Error('Wrong claim or owner');
      // A closed claim keeps its context and system words; only the owner envelopes are written again.
      if (closed) plain.forEach((value, i) => wide(value + (badClaimSnapshot && i === 0 ? 1n : 0n)).forEach((word, j) => setClaim(id, 16 + i * 4 + j, word)));
      else sealClaim(id, plain);
      positionLogs.push({ address: c.core, ...snapshotEvents.encodeEventLog(snapshotEvents.getEvent('PoolSnapshotRefreshed')!, [id, toBeHex(claimWord(id, 13), 32), claimEnvelopes(id)]) });
    } else if (status === 1 && poolTransfer) {
      const id = parsed.args[2] as bigint;
      if (!claimPlain.has(id.toString()) || parsed.args[0].toLowerCase() !== from.toLowerCase() || nftOwnerOf(id) !== from.toLowerCase()) throw new Error('Wrong NFT transfer owner');
      // A transfer keeps the economic state; the recipient has no owner envelopes until privacy activation.
      setNftOwner(id, parsed.args[1].toLowerCase()); setClaim(id, 0, 3n); [4, 5, 6].forEach(index => setClaim(id, index, claimWord(id, index) + 1n)); clearClaimEnvelopes(id);
      positionLogs.push({ address: nft, ...mint.encodeEventLog(mint.getEvent('Transfer')!, [from, parsed.args[1], id]) });
    } else if (status === 1 && poolManage) {
      const id = parsed.args[0] as bigint, action = parsed.args[2] as bigint, plain = claimPlain.get(id.toString());
      if (!plain || nftOwnerOf(id) !== from.toLowerCase() || BigInt(parsed.args[1]) !== publicContext(id)) throw new Error('Wrong Pool claim or context');
      const market = marketOf(id), pair = c.pairs.find(row => row.marketId === market)!, bump = (index: number) => setClaim(id, index, claimWord(id, index) + 1n);
      const minimumsOf = (inputs: Array<{ ciphertext: { ciphertextHigh: bigint; ciphertextLow: bigint } }>) => inputs.map(input => decryptUint256(input.ciphertext, aes));
      const pay = (amounts: bigint[], minimums: bigint[]) => {
        if (minimums.some((value, i) => value > amounts[i])) throw new Error('Private minimum payout rejected');
        pair.tokens.forEach((address, i) => { limitBalances[c.tokens.findIndex(([token]) => token === address)] += amounts[i];
          positionLogs.push(transferLog(address, c.core, from, 999n, amounts[i] + (badPoolDebit ? 1n : 0n))); });
        touchAnchors(market);
      };
      if (action === 11n) {
        // Exit preview: no storage write. Its context commits to the reserve words that the production codec reads.
        const fraction = decryptUint256(coder.decode([large], parsed.args[3])[0].ciphertext, aes), n = fraction >> 128n, d = fraction & mask128, burned = plain[2] * n / d;
        const base = slotOf(market, 1n, 'bytes32'), words = (start: bigint, count: number) => Array.from({ length: count }, (_, i) => toBeHex(wordAt(c.core, start + BigInt(i)) ?? 0n, 32));
        const marketWords = words(base, 71), anchors = Array.from({ length: 7 }, (_, j) => words(claimBase(market, BigInt(marketWords[18 + j])), 64));
        exitPreview = { id: id.toString(), values: [plain[0] * n / d, plain[1] * n / d, burned, plain[2] - burned, n, d],
          context: computePoolExitPreviewContext(request.data, { chainId: 7082400n, core: c.core, releaseId: c.releaseId, marketId: market, owner: from, marketWords, anchors }, true) };
        positionLogs.push({ address: c.core, ...exitEvents.encodeEventLog(exitEvents.getEvent('PoolExitPreviewed')!, [id, exitPreview.context, exitPreview.values.map(wide)]) });
      } else if (action === 12n) {
        const decoded = coder.decode(['bytes32', large, `${large}[2]`], parsed.args[3]);
        if (claimWord(id, 0) !== 1n || !exitPreview || exitPreview.id !== id.toString() || decoded[0] !== exitPreview.context) throw new Error('Withdrawal differs from its exit preview');
        const [amount0, amount1, burned, remaining] = exitPreview.values;
        pay([amount0, amount1], minimumsOf(decoded[2]));
        claimPlain.set(id.toString(), [plain[0] - amount0, plain[1] - amount1, remaining, plain[3] - burned, 0n, 0n, 0n, 0n, 0n, plain[9]]);
        bump(4); setClaim(id, 13, newContext()); exitPreview = null;
      } else if (action === 7n) {
        if (![1n, 2n].includes(claimWord(id, 0))) throw new Error('Wrong close status');
        pay([plain[0], plain[1]], minimumsOf(coder.decode([`${large}[2]`], parsed.args[3])[0]));
        // A closed claim keeps its last total shares and holds the exact payouts.
        claimPlain.set(id.toString(), [plain[0], plain[1], 0n, plain[3], 0n, 0n, 0n, 0n, 0n, plain[9]]);
        setClaim(id, 0, 4n); bump(4); bump(6); setClaim(id, 12, BigInt(from)); setClaim(id, 60, claimWord(id, 22)); setClaim(id, 61, claimWord(id, 23));
        setNftOwner(id, toBeHex(0n, 20));
        positionLogs.push({ address: nft, ...mint.encodeEventLog(mint.getEvent('Transfer')!, [from, toBeHex(0n, 20), id]) });
      } else if (action === 6n) {
        if (claimWord(id, 0) !== 3n) throw new Error('Wrong activation status');
        setClaim(id, 0, 2n); bump(4); bump(6); sealClaim(id, plain);
      } else if (action === 5n) {
        if (claimWord(id, 0) !== 2n) throw new Error('Wrong resume status');
        setClaim(id, 0, 1n); bump(4); bump(6);
      } else throw new Error('Wrong owner action');
    } else if (status === 1 && quote) {
      profile = name === 'quoteFastPoolV1' || name === 'quoteFastPool' ? 'fast-pool' : 'cheap-async';
      const terms = profile === 'cheap-async' ? parsed.args[0] : parsed.args;
      deadline = terms[3]; operationId = nextOperationId++; operationTokens = [String(terms[0]).toLowerCase(), String(terms[1]).toLowerCase()];
      operationMaximum = decryptUint256(terms[4].ciphertext, aes);
      const rate = decryptUint256(terms[7].ciphertext, aes);
      quoteTerms = { maximumInput: operationMaximum.toString(), minimumInput: decryptUint256(terms[5].ciphertext, aes).toString(),
        minimumOutput: decryptUint256(terms[6].ciphertext, aes).toString(), rateNumerator: (rate >> 128n).toString(),
        rateDenominator: (rate & ((1n << 128n) - 1n)).toString(), toleranceBps: String(terms[8]) };
      if (operationMaximum % 20n !== 0n) throw new Error('Fixture swaps use a maximum input that is a multiple of 20 raw units.');
      stage = profile === 'fast-pool' ? READY : 1; refundOnly = false; fundedBlock = 0;
      context = stage === READY ? toBeHex(operationId + 1000n, 32) : zero;
    } else if (status === 1) {
      if (parsed.args[0] !== operationId || name.startsWith('accept') && parsed.args[1] !== context) throw new Error('Accept did not use mined ID/context.');
      if (name.startsWith('accept') ? stage !== READY : name === 'recoverSwap' ? stage !== FUNDED : stage < 1 || stage > READY) throw new Error('Wrong operation stage.');
      swapLogs.push(...(name.startsWith('accept') ? [transferLog(operationTokens[0], from, c.core, receiptAmounts()[0], 999n),
        ...(profile === 'fast-pool' ? deliveryLogs() : [])] : name === 'recoverSwap' ? [transferLog(operationTokens[0], c.core, from, 999n, operationMaximum)] : []));
      stage = name.startsWith('accept') ? FUNDED : RELEASED; refundOnly = stage === RELEASED;
      if (stage === FUNDED) fundedBlock = latestHead() + 1;
      if (profile === 'cheap-async') swapLogs.push(advancedLog());
    }
    head = minedBlock; blockTimes.set(head, seconds() - 1); writeBlock = head;
    const hash = toBeHex(BigInt(head), 32), minedHash = blockHash(head);
    blockTransactions.set(head, hash);
    const event = status === 0 ? null : poolPreview ? pools.encodeEventLog(pools.getEvent('PoolFundingPreviewed')!, [0n, poolContext, poolAmounts.map(wide)]) :
      quote && profile === 'fast-pool' ? opening.encodeEventLog(opening.getEvent('FastPoolQuoteIssued')!, [operationId, context, deadline]) :
      quote ? opening.encodeEventLog(opening.getEvent('CheapAsyncAdvanced')!, [operationId, stage, context]) : null;
    const poolLogs = status === 1 && poolFund ? [
      { address: c.core, ...claim.encodeEventLog(claim.getEvent('SharedClaimCreated')!, [poolPositionId]) },
      { address: nft, ...mint.encodeEventLog(mint.getEvent('Transfer')!, [toBeHex(0n, 20), owner, poolPositionId]) },
      ...c.pairs.find(row => row.marketId === poolMarket)!.tokens.map((address, index) => ({ address,
        ...debit.encodeEventLog(debit.getEvent('Transfer')!, [owner, c.core, wide(poolAmounts[index + 1] + (badPoolDebit ? 1n : 0n)), wide(poolAmounts[index + 1])]) }))
    ] : [];
    const limitLogs=status===1&&limitCreate?[
      {address:c.core,...currentLimitAbi.encodeEventLog(currentLimitAbi.getEvent('FixedPositionCreated')!,[limitId])},
      {address:nft,...mint.encodeEventLog(mint.getEvent('Transfer')!,[toBeHex(0n,20),owner,limitId])},
      ...currentLimitTokens(limitDirection).map((address,i)=>({address,...debit.encodeEventLog(debit.getEvent('Transfer')!,[owner,c.core,wide((i?0n:limitAmount)+(badPoolDebit?1n:0n)),wide(999n)])}))
    ]:status===1&&(limitClaim||limitClose)?[
      {address:c.core,...currentLimitAbi.encodeEventLog(currentLimitAbi.getEvent(limitClaim?'FixedProceedsClaimed':'FixedPositionClosed')!,[limitId])},
      ...(limitClose?[{address:nft,...mint.encodeEventLog(mint.getEvent('Transfer')!,[owner,toBeHex(0n,20),limitId])}]:[]),
      ...c.tokens.map(([address],i)=>({address,...debit.encodeEventLog(debit.getEvent('Transfer')!,[c.core,owner,wide(999n),wide(limitPayouts[i]+(badLimitPayout?1n:0n))])}))
    ]:[];
    const tx = { ...request, gasPrice: FIXED_GAS_PRICE, hash, chainId: 7082400n, from, to: target, value: 0n, blockNumber: head, blockHash: minedHash };
    const fundingLogs = status !== 1 ? [] : faucet ? [
      { address: target, ...debit.encodeEventLog(debit.getEvent('Transfer')!, [toBeHex(0n, 20), from, wide(999n), wide(FAUCET_AMOUNT)]) },
      { address: target, ...token.encodeEventLog(token.getEvent('FaucetClaimed')!, [from]) }
    ] : approval ? [{ address: target, ...token.encodeEventLog(token.getEvent('Approval')!, [from, c.core, wide(tokenAllowances[tokenIndex]), wide(999n)]) }] : [];
    txs.set(hash, tx); mined.set(hash, { hash, status, from, to: target, blockNumber: head, blockHash: minedHash,
      logs: faucet||approval?fundingLogs:limitCreate||limitClaim||limitClose?limitLogs:limitSnapshot||limitManage?[]:poolManage||poolTransfer||poolSnapshot ? positionLogs : poolFund ? poolLogs : event ? [{ address: c.core, ...event }] : swapLogs });
    sends.push({ name, operationId: operationId.toString(), nonce, gasLimit: request.gasLimit.toString(), data: request.data });
    nonce++;
    return tx;
  }
});
  // The App asks the wallet for the hash only, then reads the transaction from the read provider.
  return { ...wallet, sendUncheckedTransaction: async (request: Parameters<typeof wallet.sendTransaction>[0]) => (await wallet.sendTransaction(request)).hash };
};
let signer = newSigner();
// Mined logs carry their origin, as the SDK provider returns them.
const providerReceipt = (hash: string) => {
  const receipt = mined.get(hash);
  return receipt ? { ...receipt, logs: (receipt.logs as Array<Record<string, unknown>>).map((log, index) => ({ ...log, index, transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, removed: false })) } : null;
};
const readProvider = { send, getTransaction: async (hash: string) => {
    if (delayedTransactionVisibility) { delayedTransactionVisibility = false; return null; }
    const tx = txs.get(hash) ?? null;
    return tx && wrongWalletResponseNonce ? { ...tx, nonce: (tx.nonce as number) + 1 } : tx;
  },
  getLogs: async (filter: { address?: string; fromBlock: bigint | number; toBlock: bigint | number; topics?: Array<string | null> }) =>
    [...mined.values()].filter(receipt => receiptVisible(receipt) && BigInt(receipt.blockNumber as number) >= BigInt(filter.fromBlock) && BigInt(receipt.blockNumber as number) <= BigInt(filter.toBlock))
      .flatMap(receipt => (receipt.logs as Array<{ address: string; topics: string[]; data: string }>).map((log, index) => ({ ...log, index, removed: false,
        transactionHash: receipt.hash as string, blockNumber: receipt.blockNumber as number, blockHash: receipt.blockHash as string })))
      .filter(log => (!filter.address || log.address.toLowerCase() === filter.address.toLowerCase()) &&
        (filter.topics ?? []).every((topic, index) => topic === null || log.topics[index]?.toLowerCase() === topic.toLowerCase())),
  getTransactionReceipt: async (hash: string) => receiptVisible(mined.get(hash)) ? providerReceipt(hash) : null,
  waitForTransaction: async (hash: string) => waitReceipt && receiptVisible(mined.get(hash)) ? providerReceipt(hash) : null };
const host = document.getElementById('root')!, root = createRoot(host);
const browserProvider = { request: ({ method, params }: { method: string; params?: unknown[] }) => send(method, params ?? []) };
let mountedOwner = owner, priceDisplayInverted = false;
// The production funds capability reads only through the admitted shared HTTP provider. This local binding
// runs the same production readers over the mock chain, with the same wallet-session and privacy guards.
const fundsCapability = () => {
  const binding = control.binding();
  if (!privacyUnlocked) throw new Error('Unlock the selected Testnet owner privacy before reading beta funds.');
  type FundsArgs = Parameters<typeof readCurrentSharedDexTokenFunds>[0];
  const read = async <T>(reader: (args: FundsArgs) => Promise<T>, assertCallerCurrent: () => void = () => {}) => {
    const check = async () => { assertCallerCurrent(); binding.assertSnapshotCurrent(); if (!privacyUnlocked) throw new Error('Owner privacy is unavailable.'); };
    const rpc = async (method: string, params: unknown[]) => { await check(); const value = await send(method, params); await check(); return value; };
    const raw = await rpc('eth_getBlockByNumber', ['latest', false]) as Record<string, string>;
    return reader({ owner: binding.ownerAddress, candidate: 'cheap-history', head: { number: BigInt(raw.number), hash: raw.hash, timestamp: BigInt(raw.timestamp) },
      rpc, assertCurrent: check, decrypt: cipher => decryptPrivateUint256Output(binding.signer as never, cipher) });
  };
  return Object.freeze({ read: (assertCallerCurrent?: () => void) => read(readCurrentSharedDexTokenFunds, assertCallerCurrent),
    readSwap: (tokens: readonly [string, string], assertCallerCurrent?: () => void) => read(args => readCurrentSharedDexSwapFunds({ ...args, tokens }), assertCallerCurrent) });
};
const onboard = () => privacyUnlocked ? { [mountedOwner.toLowerCase()]: { aesKey: aes } } : {};
const render = () => root.render(createElement(DexPage, { priceDisplayInverted, swapCandidate: 'cheap-history',
  onPriceDisplayInvertedChange: (value: boolean) => { priceDisplayInverted = value; render(); }, sharedWalletSession: {
  walletAddress: mountedOwner, chainId: 7082400, browserProvider,
  sessionOnboardInfo:onboard(),walletAesHealthByAddress:{},
  actions: {
    // The App shows "Connect wallet" only when the session can connect one.
    connectBrowserWallet: async () => { mountedOwner = owner; signer = newSigner(); render(); },
    getCurrentDexQuoteCapability: () => issueCurrentDexQuoteCapability({} as never),
    getCurrentDexReceiptCapability: () => issueCurrentDexReceiptCapability({} as never),
    getCurrentSharedDexTokenFundsCapability: async () => fundsCapability(),
    getCurrentDexPoolFundingCapability: () => issueCurrentDexPoolFundingCapability({ candidate: 'cheap-history' } as never),
    getCurrentDexPoolPositionCapability: () => issueCurrentDexPoolPositionCapability({ candidate: 'cheap-history' } as never),
    getCurrentDexLimitCapability: () => issueCurrentDexLimitCapability({ candidate: 'cheap-history' } as never),
    getCurrentDexSubmissionCapability: () => issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-history', sessionOnboardInfo: onboard() } as never)
  }
} as never }));
// The App keeps the pending action of each chain, candidate and wallet in shared browser storage.
const PENDING_KEY = 'chainwhisper:dex:current-pending-attempt:v1';
const pendingRecords = () => currentDexPendingStorage({ chainId: c.chainId, graph: c.graph, owner });
const control = {
  runtimeHashes,
  seedFunding: () => { limitBalances = [0n, 0n, 0n, 0n]; tokenAllowances = [0n, 0n, 0n, 0n]; tokenClaimed = [false, false, false, false]; },
  seedLimit:(direction=true)=>{if(limitAmount!==0n)throw new Error('Limit fixture already funded');limitId=92n;limitAmount=300n;limitProceeds=7n;limitDirection=direction;limitTerms=[3n,10n,1n,7n,2n];initializeLimitAuthority();writeLimitSnapshot();},
  binding: () => {const captured=mountedOwner;const guard=()=>{assertCurrent();if(mountedOwner!==captured)throw new Error('Wallet or network changed');};return { signer, readProvider, ownerAddress: captured, chainId: 7082400n,
    assertCurrent: async () => guard(), assertSnapshotCurrent: guard };},
  snapshot: () => ({ sends, calls, signingAttempts, inputSignatureRequests, operationId: operationId.toString(), stage, quoteTerms,
    allowances: tokenAllowances.map(String),
    limit:{id:limitId.toString(),unspent:limitAmount.toString(),proceeds:limitProceeds.toString(),closed:limitClosed,balances:limitBalances.map(String),status:(limitWords.get(`${engine}:${currentLimitMappingSlot(24n,2n)}`)??0n).toString(),coreLifecycle:(limitWords.get(`${c.core}:${currentLimitMappingSlot(24n,20n)+11n}`)??0n).toString(),engineLifecycle:(limitWords.get(`${engine}:${currentLimitMappingSlot(24n,9n)+11n}`)??0n).toString()},pending: pendingRecords()?.getItem(PENDING_KEY) ?? null }),
  // Changes the saved pending action through the production record storage and returns the record as it was.
  editPending: (patch: Record<string, unknown>) => {
    const saved = JSON.parse(pendingRecords()!.getItem(PENDING_KEY)!);
    pendingRecords()!.setItem(PENDING_KEY, JSON.stringify({ ...saved, ...patch }));
    return saved as Record<string, unknown>;
  },
  set: (next: { ready?: boolean; receiptAvailable?: boolean; hideNewReceipts?: boolean; waitReceipt?: boolean; interrupted?: boolean; corruptPayout?: boolean;
    graphDrift?: boolean; gasLimit?: string; wallet?: string; revoked?: boolean; contextDrift?: boolean;
    nextOperationId?: string; issueLogs?: 'missing' | 'duplicate' | 'forged'; settled?: boolean;
    revertNext?: boolean; quoteAmountDrift?: boolean; belowMinimumFill?: boolean; connected?: boolean; adverseDelivery?: boolean;
    poolMode?: 'initialize' | 'add'; badPoolDebit?: boolean; denySignature?: boolean;badLimitTerms?:boolean;badLimitPayout?:boolean;recipientCode?:string;claimContextDrift?:boolean;badClaimSnapshot?:boolean; badFundingCredit?: boolean;
    priceDisplayInverted?: boolean; balances?: string[]; balanceReadFailure?: boolean; balanceReadDelay?: number; privacyUnlocked?: boolean; wrongWalletResponseNonce?: boolean; missingWalletChainId?: boolean; delayedTransactionVisibility?: boolean }) => {
    if (next.priceDisplayInverted !== undefined) { priceDisplayInverted = next.priceDisplayInverted; render(); }
    if (next.delayedTransactionVisibility !== undefined) delayedTransactionVisibility = next.delayedTransactionVisibility;
    if (next.missingWalletChainId !== undefined) missingWalletChainId = next.missingWalletChainId;
    if (next.wrongWalletResponseNonce !== undefined) wrongWalletResponseNonce = next.wrongWalletResponseNonce;
    if (next.balances) limitBalances = limitBalances.map((value, index) => next.balances![index] === undefined ? value : BigInt(next.balances![index]));
    if (next.balanceReadFailure !== undefined) balanceReadFailure = next.balanceReadFailure;
    if (next.balanceReadDelay !== undefined) balanceReadDelay = next.balanceReadDelay;
    if (next.privacyUnlocked !== undefined) { privacyUnlocked = next.privacyUnlocked; render(); }
    if (next.badFundingCredit !== undefined) badFundingCredit = next.badFundingCredit;
    if(next.badLimitPayout!==undefined)badLimitPayout=next.badLimitPayout;
    if(next.recipientCode!==undefined)recipientCode=next.recipientCode;
    if(next.claimContextDrift){writeBlock=latestHead();setClaim(81n,13,newContext());}
    if(next.badClaimSnapshot!==undefined)badClaimSnapshot=next.badClaimSnapshot;
    if(next.badLimitTerms!==undefined)badLimitTerms=next.badLimitTerms;
    if (next.denySignature !== undefined) denySignature = next.denySignature;
    if (next.poolMode !== undefined) poolMode = next.poolMode === 'initialize' ? 0n : 1n;
    if (next.badPoolDebit !== undefined) badPoolDebit = next.badPoolDebit;
    if (next.receiptAvailable !== undefined) receiptAvailable = next.receiptAvailable;
    if (next.hideNewReceipts !== undefined) hiddenFromBlock = next.hideNewReceipts ? latestHead() + 1 : Number.MAX_SAFE_INTEGER;
    if (next.waitReceipt !== undefined) waitReceipt = next.waitReceipt;
    if (next.interrupted !== undefined) interrupted = next.interrupted;
    if (next.corruptPayout !== undefined) corruptPayout = next.corruptPayout;
    if (next.graphDrift !== undefined) graphDrift = next.graphDrift;
    if (next.contextDrift) context = toBeHex(operationId + 2000n, 32);
    if (next.nextOperationId !== undefined) nextOperationId = BigInt(next.nextOperationId);
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
    // Keeper steps run last: their logs use the amounts that the other flags of this call select.
    if (next.ready) { stage = READY; context = toBeHex(operationId + 1000n, 32); keeperWork([advancedLog()]); }
    if (next.settled) { if (stage !== FUNDED) throw new Error('Fixture terminal requires the funded stage.'); stage = SETTLED; keeperWork([...deliveryLogs(), advancedLog()]); }
  },
  // Only the fake chain ledger survives an actual page reload; no prepared/issued app objects or signer are transferred.
  exportChain: () => JSON.stringify({ blockTimes: [...blockTimes], blockTransactions: [...blockTransactions], head, stage, deadline, context, profile, nonce, operationId, nextOperationId, operationTokens, fundedBlock, refundOnly, operationMaximum,
    sends, signingAttempts, tokenAllowances, tokenClaimed, claimStatus,claimRevision,claimOwnership,claimLifecycle,claimOwner,claimContext,claimValues,poolPositionId,limitId,limitDirection,limitAmount,limitTerms,limitProceeds,limitClosed,limitBalances,limitWords:[...limitWords], storage: [...storage], accountWrites: [...accountWrites], claimPlain: [...claimPlain], exitPreview, writeBlock, contextSequence, poolMarket, poolContext, poolAmounts, txs: [...txs], mined: [...mined] }, (_key, value) =>
    typeof value === 'bigint' ? { __testBigInt: value.toString() } : value),
  restoreChain: (raw: string) => {
    const saved = JSON.parse(raw, (_key, value) => value?.__testBigInt !== undefined ? BigInt(value.__testBigInt) : value);
    ({ head, stage, deadline, context, profile, nonce, operationId, nextOperationId, signingAttempts } = saved);
    if (saved.operationTokens) ({ operationTokens, fundedBlock, refundOnly, operationMaximum } = saved);
    if(saved.claimValues)({claimStatus,claimRevision,claimOwnership,claimLifecycle,claimOwner,claimContext,claimValues,poolPositionId}=saved);
    if(saved.limitWords){({limitId,limitDirection,limitAmount,limitTerms}=saved);({limitProceeds,limitClosed,limitBalances}=saved);limitWords=new Map(saved.limitWords);}
    if (saved.tokenAllowances) ({ tokenAllowances, tokenClaimed } = saved);
    if (saved.storage) { storage = new Map(saved.storage); accountWrites = new Map(saved.accountWrites); claimPlain = new Map(saved.claimPlain);
      ({ writeBlock, contextSequence, poolMarket, poolContext, poolAmounts, exitPreview } = saved); }
    blockTimes.clear(); blockTransactions.clear();
    for (const [number, time] of saved.blockTimes ?? []) blockTimes.set(number, time);
    for (const [number, hash] of saved.blockTransactions ?? []) blockTransactions.set(number, hash);
    sends.splice(0, sends.length, ...saved.sends);
    txs.clear(); mined.clear();
    for (const [hash, tx] of saved.txs) txs.set(hash, tx);
    for (const [hash, receipt] of saved.mined) mined.set(hash, receipt);
  },
  // The unmount is committed before the new mount, so that no component state survives.
  remount: () => { signer = newSigner(); flushSync(() => root.render(null)); render(); },
  forgedCopyRejected: async () => {
    const capability = await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-history' } as never);
    try { await capability.submitCurrentCheapQuote({} as never); return false; } catch { return true; }
  }
};
Object.assign(window, { __currentJourney: control });
render();
