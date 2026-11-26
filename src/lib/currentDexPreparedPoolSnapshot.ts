import { AbiCoder, Interface, keccak256, toBeHex, type JsonRpcSigner } from '@coti-io/coti-ethers';
import type { CotiReadProvider } from './appShared';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { readPreparedDexMarketRegistry, type DexV2ReadCapability, type PreparedDexMarket } from './dexV2Chain';
import { currentPoolPositionAbi, currentPoolNftAbi } from './currentDexPoolPosition';
import { PREPARED_POOL_FUNDING_ABI, decodeCurrentPoolClaimMint } from './currentDexPoolFunding';
import { currentTokenFundingAbi } from './currentDexTokenFunding';
import { decryptPrivateUint256Output } from './privateUint256';
import { verifyCurrentDexCanonicalInclusion } from './currentDexCanonicalInclusion';
import { CurrentPoolProofMismatch } from './currentDexPoolProofError';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as currentCandidate } from './selectedCurrentDexCandidate';

// Exact accepted prepared storage layout. No historical candidate or NFT19 policy.
export const PREPARED_POOL_LAYOUT = Object.freeze({ marketMapping: 1n, marketWords: 71, positionMapping: 15n,
  positionWords: 64, positionMarket: 18n, tokenLedger: 22n, counter: 11n, operation: 12n,
  snapshot: 14, user: 2, stride: 4, context: 13, anchors: 18, coreWords: 149,
  tokenBalances: 4n, nftOwners: 2n, maximumPositionId: 128n,
  sourceIdForPosition: 19n, coreSources: 20n, coreSourceWords: 36,
  engineWords: 46, engineSourceIdForPosition: 4n, engineSources: 9n, engineSourceWords: 39,
  engineTerms: 12n, termWords: 5, engineOwnerSnapshot: 1n, engineRangeSnapshot: 30n });
export type PreparedPoolBlock = Readonly<{ number: bigint; hash: string }>;
export type PreparedPoolProducerKind = 'fund' | 'snapshot' | 'top-up' | 'close' | 'withdraw' | 'activate' | 'resume';
type Log = Readonly<{ address: string; topics: readonly string[]; data: string }>;
const events = new Interface([
  'event PoolSnapshotRefreshed(uint256 indexed positionId,bytes32 context,(uint256 ciphertextHigh,uint256 ciphertextLow)[10] userValues)',
  'event SharedClaimCreated(uint256 indexed positionId)'
]);
const fundingAbi = new Interface(PREPARED_POOL_FUNDING_ABI), coder = AbiCoder.defaultAbiCoder();
const same = (a: unknown, b: unknown) => JSON.stringify(a, (_, v) => typeof v === 'bigint' ? String(v) : v) ===
  JSON.stringify(b, (_, v) => typeof v === 'bigint' ? String(v) : v);
const requireProof = (value: boolean, message: string): void => { if (!value) throw new CurrentPoolProofMismatch(message); };
const uint = (value: bigint) => {
  requireProof(typeof value === 'bigint' && value >= 0n && value < 1n << 256n, 'Invalid prepared Pool integer.'); return value;
};
const hash = (value: string) => {
  requireProof(/^0x[0-9a-fA-F]{64}$/.test(value) && BigInt(value) !== 0n, 'Invalid prepared Pool hash.'); return value.toLowerCase();
};
const addressAt = (word: string) => `0x${word.slice(-40)}`;
const mapping = (key: bigint | string, slot: bigint, type = 'uint256') => BigInt(keccak256(coder.encode([type, 'uint256'], [key, slot])));
export const preparedPoolPositionStorageBase = (marketId: string, id: bigint) =>
  mapping(uint(id), mapping(hash(marketId), PREPARED_POOL_LAYOUT.marketMapping, 'bytes32') + PREPARED_POOL_LAYOUT.positionMapping);
export const preparedPoolStoredEnvelopes = (claim: readonly string[]) => {
  requireProof(claim.length === 64 && claim.every(word => /^0x[0-9a-fA-F]{64}$/.test(word)), 'Incomplete prepared Pool storage.');
  return Object.freeze(Array.from({ length: 10 }, (_, i) => Object.freeze({
    ciphertextHigh: BigInt(claim[16 + i * 4]), ciphertextLow: BigInt(claim[17 + i * 4]) })));
};
export const checkPreparedPoolPositionValues = (values: readonly bigint[]) => {
  requireProof(values.length === 10, 'Invalid prepared Pool private field count.'); values.forEach(uint);
  requireProof(values.slice(4, 9).every(v => v === 0n) && values[9] < 7n && values[2] <= values[3],
    'Invalid prepared shared-Pool private values.');
  return Object.freeze({ amount0: values[0], amount1: values[1], shares: values[2], totalShares: values[3], classId: values[9] });
};
export type PreparedPoolStoredState = Readonly<{
  graph: string; marketId: string; positionId: bigint; block: PreparedPoolBlock; market: PreparedDexMarket;
  claim: readonly string[]; anchors: readonly (readonly string[])[]; core: readonly string[];
  markets: Readonly<Record<string, readonly string[]>>; claims: Readonly<Record<string, Readonly<{ marketId: string; words: readonly string[] }>>>;
  c1: Readonly<Record<string, readonly string[]>>; ledgers: Readonly<Record<string, readonly string[]>>;
  escrows: Readonly<Record<string, readonly string[]>>; custody: Readonly<Record<string, readonly string[]>>;
  nftOwners: Readonly<Record<string, string>>; nftMinted: Readonly<Record<string, string>>; ownerNftBalance: bigint;
  engines: Readonly<Record<string, readonly string[]>>; directories: Readonly<Record<string, readonly string[]>>;
  fixedSources: Readonly<Record<string, Readonly<{ marketId: string; sourceId: bigint; core: readonly string[]; engine: readonly string[];
    terms: readonly (readonly string[])[]; ownerState: readonly string[] }>>>;
  counter: bigint; operation: bigint;
}>;
export type PreparedPoolSnapshotProducer = Readonly<{
  kind: PreparedPoolProducerKind; positionId: bigint; marketId: string; canonicalId: bigint;
  registryRevision: bigint; marketRevision: bigint; transactionHash: string; context: string;
  block: PreparedPoolBlock; status: bigint; revisions: readonly bigint[];
  amounts: ReturnType<typeof checkPreparedPoolPositionValues>; readyToSign: false;
  amountsTransactionHash?: string;
}>;
export type PreparedPoolSelectedState = Omit<PreparedPoolStoredState, 'c1' | 'engines' | 'directories' | 'fixedSources'> & Readonly<{
  scope: 'selected-pool-accounting'; candidateKey: import('./dexV2Deployment').CurrentCheapDexCandidateKey;
  packageSha256: string; coreAddress: string; owner: string;
  positionMarket: string; sourceIdForPosition: string; everPoolFunded: string;
}>;
export type PreparedPoolAccountingState = PreparedPoolStoredState | PreparedPoolSelectedState;
export const isPreparedPoolSelectedState = (s: PreparedPoolAccountingState): s is PreparedPoolSelectedState => 'scope' in s;
export const checkPreparedPoolSelectedScope = (s: PreparedPoolSelectedState) => {
  const { candidate } = resolvePreparedDexScope(s.candidateKey), pair = candidate.pairs.find(p => p.marketId === s.marketId);
  const keys = (v: object, expected: string[]) => same(Object.keys(v).sort(), expected.sort());
  const validWords = (v: readonly string[], count: number) => v.length === count && v.every(w => /^0x[0-9a-fA-F]{64}$/.test(w));
  requireProof(s.scope === 'selected-pool-accounting' && !!pair && s.graph === candidate.graph && s.packageSha256 === candidate.packageSha256 &&
    s.coreAddress === candidate.core && /^0x[0-9a-f]{40}$/.test(s.owner) && BigInt(s.owner) !== 0n &&
    s.market.marketId === s.marketId && s.market.token0 === pair!.tokens[0] && s.market.token1 === pair!.tokens[1] &&
    s.market.engine === pair!.engine && s.market.poolTerms === pair!.poolTerms && s.market.enabled === true &&
    s.market.canonicalId === BigInt(pair!.canonicalId) &&
    same(s.market.companions, pair!.companions.map(([role, address, runtimeHash]) => ({ role, address, runtimeHash }))), 'Prepared selected Pool candidate scope changed.');
  requireProof(validWords(s.core,149) && validWords(s.claim,64) && s.counter === BigInt(s.core[11]) && s.operation === BigInt(s.core[12]) &&
    s.counter >= 42n && s.positionId > 0n && s.positionId <= s.counter + 1n &&
    keys(s.markets,[s.marketId]) && validWords(s.markets[s.marketId],71), 'Prepared selected Pool storage scope is incomplete.');
  const market = s.markets[s.marketId], anchors = market.slice(18,25).map(v => String(BigInt(v))), id = String(s.positionId);
  requireProof(market[0] === candidate.releaseId && market[1] === s.marketId && addressAt(market[2]) === pair!.tokens[0] &&
    addressAt(market[3]) === pair!.tokens[1] && addressAt(market[4]) === candidate.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1] &&
    addressAt(market[5]) === pair!.poolTerms && new Set(anchors).size === 7 && !anchors.includes(id) && s.anchors.length === 7 &&
    keys(s.claims,[...anchors,...(s.positionId <= s.counter ? [id] : [])]), 'Prepared selected Pool claim scope changed.');
  anchors.forEach((key,i) => requireProof(BigInt(key)>0n && BigInt(key)<=s.counter && s.claims[key]?.marketId === s.marketId &&
    validWords(s.anchors[i],64) && same(s.anchors[i],s.claims[key].words) && BigInt(s.anchors[i][0])===1n &&
    BigInt(s.anchors[i][59])===0n && BigInt(s.anchors[i][62])===BigInt(i), 'Prepared selected Pool anchor scope changed.'));
  requireProof(keys(s.nftOwners,[id]) && keys(s.nftMinted,[id]) && validWords([s.positionMarket,s.sourceIdForPosition,s.everPoolFunded,s.nftOwners[id],s.nftMinted[id]],5) &&
    BigInt(s.sourceIdForPosition)===0n && BigInt(s.everPoolFunded)<=1n, 'Prepared selected Pool position identity changed.');
  if(s.positionId>s.counter) requireProof(s.claim.every(v=>BigInt(v)===0n) && BigInt(s.positionMarket)===0n &&
    BigInt(s.nftOwners[id])===0n && BigInt(s.nftMinted[id])===0n, 'Prepared selected future Pool claim is not empty.');
  else requireProof(s.positionMarket===s.marketId && same(s.claims[id],{marketId:s.marketId,words:s.claim}) &&
    BigInt(s.claim[59])===1n && s.claim.slice(1,4).every(v=>BigInt(v)===0n) && BigInt(s.claim[54])===0n && BigInt(s.claim[7])===1n &&
    [1n,2n,3n,4n].includes(BigInt(s.claim[0])) && BigInt(s.nftMinted[id])===1n &&
    (BigInt(s.claim[0])===4n ? BigInt(s.nftOwners[id])===0n && addressAt(s.claim[12])===s.owner : BigInt(s.nftOwners[id])!==0n),
    'Prepared selected Pool claim or NFT changed.');
  const tokens=candidate.tokens.map(([token])=>token);
  for(const values of [s.ledgers,s.escrows,s.custody]) requireProof(keys(values,[...tokens]),'Prepared selected Pool token scope changed.');
  tokens.forEach(token=>requireProof(validWords(s.ledgers[token],12)&&validWords(s.escrows[token],2)&&validWords(s.custody[token],4),'Prepared selected Pool token state is incomplete.'));
};
type Canonical = Readonly<{ block: PreparedPoolBlock; data: string; logs: readonly Log[] }>;
const produced = new WeakMap<object, { signer: object; state: PreparedPoolSelectedState; canonical: Canonical }>();
export const assertPreparedPoolSnapshotProducer = (producer: PreparedPoolSnapshotProducer, signer: object) =>
  requireProof(produced.get(producer)?.signer === signer, 'Prepared Pool producer is outside this owner session.');

// Read scope: six prepared markets, their seven anchors, and every allocated Pool
// position up to 128. Common fixed sources are preserved as opaque native state;
// their encrypted Limit/Range kind is not inferred. Linked/unknown sources stop.
export const createPreparedOwnerPoolSnapshotReader = ({ signer, owner, candidate, marketId, readCapability, provider, guard, attest }: {
  signer: JsonRpcSigner; owner: string; candidate: import('./dexV2Deployment').CurrentCheapDexCandidate; marketId: string; readCapability: DexV2ReadCapability;
  provider: CotiReadProvider; guard: () => Promise<void>; attest: (block: PreparedPoolBlock) => Promise<void>;
}) => {
  const { candidate: prepared, key: candidateKey } = resolvePreparedDexScope(candidate);
  const selectedPair = prepared.pairs.find(pair => pair.marketId === hash(marketId));
  requireProof(!!selectedPair, 'Prepared Pool selected pair is unknown.');
  const nft = prepared.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1];
  const checkedGuard = async () => { await guard(); requireProof((await signer.getAddress()).toLowerCase() === owner.toLowerCase(), 'Prepared Pool signer owner changed.'); };
  const rpc = async (method: string, params: unknown[]) => { await checkedGuard(); const value = await provider.send(method, params); await checkedGuard(); return value; };
  const tag = (block: PreparedPoolBlock) => ({ blockHash: hash(block.hash), requireCanonical: true });
  const call = async (abi: Interface, to: string, name: string, args: unknown[], block: PreparedPoolBlock) => {
    const raw = await rpc('eth_call', [{ from: owner, to, data: abi.encodeFunctionData(name, args) }, tag(block)]);
    const decoded = abi.decodeFunctionResult(name, raw as string);
    requireProof(abi.encodeFunctionResult(name, decoded).toLowerCase() === String(raw).toLowerCase(), 'Non-canonical prepared Pool call result.');
    return decoded;
  };
  const word = async (at: string, slot: bigint, block: PreparedPoolBlock) => {
    const value = await rpc('eth_getStorageAt', [at, toBeHex(slot), tag(block)]);
    requireProof(typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value), 'Invalid prepared Pool storage word.');
    return (value as string).toLowerCase();
  };
  const words = async (at: string, base: bigint, count: number, block: PreparedPoolBlock) => {
    const result: string[] = [];
    for (let i = 0; i < count; i += 12) result.push(...await Promise.all(Array.from({ length: Math.min(12, count - i) }, (_, j) => word(at, base + BigInt(i + j), block))));
    return Object.freeze(result);
  };
  const canonical = async (transactionHash: string): Promise<Canonical | null> => {
    hash(transactionHash); await checkedGuard();
    const [tx, receipt] = await Promise.all([provider.getTransaction(transactionHash), provider.getTransactionReceipt(transactionHash)]);
    await checkedGuard(); if (!tx || !receipt) return null;
    requireProof(tx.hash.toLowerCase() === transactionHash.toLowerCase() && receipt.hash.toLowerCase() === transactionHash.toLowerCase() &&
      tx.chainId === BigInt(prepared.chainId) && tx.from.toLowerCase() === owner.toLowerCase() && tx.to?.toLowerCase() === prepared.core &&
      tx.value === 0n && receipt.status === 1, 'Prepared Pool producer envelope changed.');
    await verifyCurrentDexCanonicalInclusion({ rpc, assertCurrent: checkedGuard }, tx, receipt);
    return Object.freeze({ block: Object.freeze({ number: BigInt(receipt.blockNumber), hash: receipt.blockHash.toLowerCase() }), data: tx.data,
      logs: Object.freeze(receipt.logs.map(log => Object.freeze({ address: log.address, topics: Object.freeze([...log.topics]), data: log.data }))) });
  };
  const state = async (id: bigint, block: PreparedPoolBlock): Promise<PreparedPoolStoredState> => {
    uint(id); uint(block.number); hash(block.hash); await checkedGuard(); await attest(block);
    const registry = await readPreparedDexMarketRegistry({ capability: readCapability, blockNumber: block.number, blockHash: block.hash, candidate: candidateKey });
    requireProof(registry.graph === prepared.graph && registry.packageSha256 === prepared.packageSha256 && registry.core === prepared.core &&
      same(registry.markets.map(item => item.marketId), prepared.pairs.map(pair => pair.marketId)), 'Prepared Pool registry candidate scope changed.');
    const market = registry.markets.find(item => item.marketId === marketId.toLowerCase())!;
    requireProof(!!market && market.token0 === selectedPair!.tokens[0] && market.token1 === selectedPair!.tokens[1], 'Prepared Pool registry pair changed.');
    const core = await words(prepared.core, 0n, PREPARED_POOL_LAYOUT.coreWords, block), counter = BigInt(core[11]), operation = BigInt(core[12]);
    requireProof(counter >= 42n && counter <= PREPARED_POOL_LAYOUT.maximumPositionId && id <= counter + 1n, 'Prepared Pool allocated scope exceeds its finite bound.');
    const markets: Record<string, readonly string[]> = {}, c1: Record<string, readonly string[]> = {}, claims: Record<string, { marketId: string; words: readonly string[] }> = {};
    const engines: Record<string, readonly string[]> = {}, directories: Record<string, readonly string[]> = {};
    const fixedSources: Record<string, { marketId: string; sourceId: bigint; core: readonly string[]; engine: readonly string[];
      terms: readonly (readonly string[])[]; ownerState: readonly string[] }> = {};
    const anchors: (readonly string[])[] = [], anchorIds = new Map<string, string>();
    for (const pair of prepared.pairs) {
      const base = mapping(pair.marketId, 1n, 'bytes32'), raw = await words(prepared.core, base, 71, block);
      requireProof(raw[0] === prepared.releaseId && raw[1] === pair.marketId && addressAt(raw[2]) === pair.tokens[0] &&
        addressAt(raw[3]) === pair.tokens[1] && addressAt(raw[4]) === nft && addressAt(raw[5]) === pair.poolTerms, 'Prepared Pool stored market identity changed.');
      markets[pair.marketId] = raw;
      const engineRoot = await words(pair.engine, 0n, PREPARED_POOL_LAYOUT.engineWords, block); engines[pair.marketId] = engineRoot;
      const corePages = BigInt(raw[54]), enginePages = BigInt(engineRoot[8]), freeCount = BigInt(raw[53]);
      requireProof(corePages <= 16n && enginePages <= 16n && freeCount <= 128n, 'Prepared fixed directory exceeds its finite bound.');
      const directory: string[] = [];
      for (let page = 0n; page < corePages; page++) for (const slot of [50n, 51n]) directory.push(...await words(prepared.core, mapping(page, base + slot), 8, block));
      for (let page = 0n; page < enginePages; page++) for (const slot of [5n, 6n]) directory.push(...await words(pair.engine, mapping(page, slot), 8, block));
      if (freeCount) directory.push(...await words(prepared.core, BigInt(keccak256(coder.encode(['uint256'], [base + 53n]))), Number(freeCount), block));
      directories[pair.marketId] = Object.freeze(directory);
      c1[pair.marketId] = await words(prepared.core, pair.marketId === prepared.marketId ? 50n : mapping(pair.marketId, 117n, 'bytes32'), 49, block);
      for (let j = 0; j < 7; j++) {
        const anchorId = BigInt(raw[18 + j]);
        requireProof(anchorId > 0n && anchorId <= counter && !anchorIds.has(String(anchorId)), 'Prepared Pool anchor scope changed.');
        anchorIds.set(String(anchorId), pair.marketId);
        const claim = await words(prepared.core, preparedPoolPositionStorageBase(pair.marketId, anchorId), 64, block);
        requireProof(BigInt(claim[0]) === 1n && BigInt(claim[62]) === BigInt(j) && BigInt(claim[59]) === 0n, 'Prepared Pool anchor type changed.');
        claims[String(anchorId)] = Object.freeze({ marketId: pair.marketId, words: claim });
        if (pair.marketId === marketId.toLowerCase()) anchors.push(claim);
      }
    }
    for (let existing = 1n; existing <= counter; existing++) {
      if (anchorIds.has(String(existing))) continue;
      const assigned = await word(prepared.core, mapping(existing, 18n), block);
      requireProof(!!markets[assigned], 'Prepared allocated position is outside the six-market scope.');
      const claim = await words(prepared.core, preparedPoolPositionStorageBase(assigned, existing), 64, block);
      if (BigInt(claim[59]) !== 1n) {
        requireProof(claim.every(v => BigInt(v) === 0n), 'Prepared allocated position is an unsupported non-shared Pool.');
        const sourceId = BigInt(await word(prepared.core, mapping(existing, PREPARED_POOL_LAYOUT.sourceIdForPosition), block));
        requireProof(sourceId > 0n && sourceId <= BigInt(core[16]), 'Prepared allocated position has no native fixed-source identity.');
        const pair = prepared.pairs.find(p => p.marketId === assigned)!;
        const source = await words(prepared.core, mapping(sourceId, PREPARED_POOL_LAYOUT.coreSources), PREPARED_POOL_LAYOUT.coreSourceWords, block);
        const engineSource = await words(pair.engine, mapping(sourceId, PREPARED_POOL_LAYOUT.engineSources), PREPARED_POOL_LAYOUT.engineSourceWords, block);
        requireProof(BigInt(source[0]) % 256n === 1n && BigInt(engineSource[0]) % 256n === 1n &&
          (BigInt(engineSource[0]) >> 16n) === 0n && BigInt(source[0]) === BigInt(engineSource[0]) &&
          BigInt(source[3]) === existing && BigInt(source[4]) === sourceId &&
          source.slice(1, 12).every((v, i) => v === engineSource[1 + i]) &&
          BigInt(await word(pair.engine, mapping(existing, PREPARED_POOL_LAYOUT.engineSourceIdForPosition), block)) === sourceId,
        'Prepared fixed-source Core/Engine identity or product family changed.');
        const revision = BigInt(source[9]); requireProof(revision > 0n && revision <= 16n, 'Prepared fixed terms exceed their finite revision bound.');
        const terms: (readonly string[])[] = [];
        for (let rev = 1n; rev <= revision; rev++) terms.push(await words(pair.engine, mapping(rev, mapping(sourceId, PREPARED_POOL_LAYOUT.engineTerms)), PREPARED_POOL_LAYOUT.termWords, block));
        const ownerState: string[] = [];
        // Native owner status/snapshots are keyed by source ID. Close-owner and
        // snapshot maps also retain both identities without plaintext decryption.
        for (const key of new Set([sourceId, existing])) {
          ownerState.push(await word(pair.engine, mapping(key, 0n), block), await word(pair.engine, mapping(key, 2n), block));
          ownerState.push(...await words(pair.engine, mapping(key, PREPARED_POOL_LAYOUT.engineOwnerSnapshot), 24, block),
            ...await words(pair.engine, mapping(key, PREPARED_POOL_LAYOUT.engineRangeSnapshot), 32, block));
        }
        ownerState.push(await word(pair.engine, mapping(sourceId, 10n), block));
        for (const bucket of [BigInt(source[7]), BigInt(source[8])]) ownerState.push(await word(pair.engine, mapping(bucket, 11n), block));
        fixedSources[String(existing)] = Object.freeze({ marketId: assigned, sourceId, core: source, engine: engineSource,
          terms: Object.freeze(terms), ownerState: Object.freeze(ownerState) });
      }
      claims[String(existing)] = Object.freeze({ marketId: assigned, words: claim });
    }
    const claim = claims[String(id)]?.words ?? await words(prepared.core, preparedPoolPositionStorageBase(marketId, id), 64, block);
    if (id <= counter) requireProof(claims[String(id)]?.marketId === marketId.toLowerCase() && !anchorIds.has(String(id)) && !fixedSources[String(id)], 'Prepared Pool claim belongs to another market/product or is an anchor.');
    const ledgers: Record<string, readonly string[]> = {}, escrows: Record<string, readonly string[]> = {}, custody: Record<string, readonly string[]> = {};
    for (const [token] of prepared.tokens) {
      const base = mapping(token, 22n, 'address'); ledgers[token] = await words(prepared.core, base, 12, block);
      escrows[token] = await words(prepared.core, mapping(owner, base + 8n, 'address'), 2, block);
      custody[token] = await words(token, mapping(prepared.core, 4n, 'address'), 4, block);
    }
    const nftOwners: Record<string, string> = {}, nftMinted: Record<string, string> = {};
    for (const key of [...Object.keys(claims), ...(claims[String(id)] ? [] : [String(id)])]) {
      nftOwners[key] = await word(nft, mapping(BigInt(key), 2n), block);
      nftMinted[key] = await word(nft, mapping(BigInt(key), 6n), block);
    }
    const ownerNftBalance = BigInt(await word(nft, mapping(owner, 3n, 'address'), block));
    await attest(block); await checkedGuard();
    return Object.freeze({ graph: prepared.graph, marketId: marketId.toLowerCase(), positionId: id, block: Object.freeze({ ...block }), market,
      claim, anchors: Object.freeze(anchors), core, markets: Object.freeze(markets), claims: Object.freeze(claims), c1: Object.freeze(c1),
      ledgers: Object.freeze(ledgers), escrows: Object.freeze(escrows), custody: Object.freeze(custody),
      engines: Object.freeze(engines), directories: Object.freeze(directories), fixedSources: Object.freeze(fixedSources),
      nftOwners: Object.freeze(nftOwners), nftMinted: Object.freeze(nftMinted), ownerNftBalance, counter, operation });
  };
  // CW-133: one selected scan is about 810 single storage requests. A repeated check reads only the
  // storage roots of Core, the tokens and the position NFT. An equal root means equal storage, so the
  // earlier words are exact. A changed, refused or malformed root gives a full scan.
  const storageRoots = async (block: PreparedPoolBlock): Promise<string | null> => {
    const roots: string[] = [];
    for (const account of [prepared.core, ...prepared.tokens.map(([token]) => token), nft]) {
      await checkedGuard();
      type RootProof = { address?: unknown; storageHash?: unknown } | null;
      const proof = await (provider.send('eth_getProof', [account, [], tag(block)]) as Promise<RootProof>).catch((): RootProof => null);
      await checkedGuard();
      if (!proof || typeof proof !== 'object' || typeof proof.address !== 'string' || proof.address.toLowerCase() !== account.toLowerCase() ||
          typeof proof.storageHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(proof.storageHash) || BigInt(proof.storageHash) === 0n) return null;
      roots.push(proof.storageHash.toLowerCase());
    }
    return roots.join(':');
  };
  const selectedWords = async (requested: bigint | null, block: PreparedPoolBlock) => {
    const core=await words(prepared.core,0n,149,block),counter=BigInt(core[11]),id=requested??uint(counter+1n);
    requireProof(counter>=42n && id>0n && id<=counter+1n,'Prepared selected Pool allocated scope exceeds its finite bound.');
    const raw=await words(prepared.core,mapping(marketId,1n,'bytes32'),71,block);
    const anchors: (readonly string[])[]=[];
    for(let i=0;i<7;i++) anchors.push(await words(prepared.core,preparedPoolPositionStorageBase(marketId,BigInt(raw[18+i])),64,block));
    const claim=await words(prepared.core,preparedPoolPositionStorageBase(marketId,id),64,block);
    const positionMarket=await word(prepared.core,mapping(id,18n),block),sourceIdForPosition=await word(prepared.core,mapping(id,19n),block),
      everPoolFunded=await word(prepared.core,mapping(marketId,124n,'bytes32'),block);
    const ledgers:Record<string,readonly string[]>={},escrows:Record<string,readonly string[]>={},custody:Record<string,readonly string[]>={};
    for(const [token]of prepared.tokens){const base=mapping(token,22n,'address');
      ledgers[token]=await words(prepared.core,base,12,block);escrows[token]=await words(prepared.core,mapping(owner,base+8n,'address'),2,block);
      custody[token]=await words(token,mapping(prepared.core,4n,'address'),4,block);
    }
    const nftOwner=await word(nft,mapping(id,2n),block),minted=await word(nft,mapping(id,6n),block),ownerNftBalance=BigInt(await word(nft,mapping(owner,3n,'address'),block));
    return Object.freeze({id,core,raw,anchors:Object.freeze(anchors),claim,positionMarket,sourceIdForPosition,everPoolFunded,
      ledgers:Object.freeze(ledgers),escrows:Object.freeze(escrows),custody:Object.freeze(custody),nftOwner,minted,ownerNftBalance});
  };
  const retainedScans = new Map<string, Awaited<ReturnType<typeof selectedWords>>>();
  const selectedState = async (id: bigint | null, block: PreparedPoolBlock): Promise<PreparedPoolSelectedState> => {
    if(id!==null)uint(id);uint(block.number);hash(block.hash);await checkedGuard();await attest(block);
    const registry=await readPreparedDexMarketRegistry({capability:readCapability,blockNumber:block.number,blockHash:block.hash,candidate:candidateKey});
    requireProof(registry.graph===prepared.graph && registry.packageSha256===prepared.packageSha256 && registry.core===prepared.core &&
      same(registry.markets.map(value=>value.marketId),prepared.pairs.map(pair=>pair.marketId)),'Prepared Pool registry candidate scope changed.');
    const market=registry.markets.find(value=>value.marketId===marketId.toLowerCase());
    requireProof(!!market,'Prepared selected Pool registry market is unavailable.');
    // CW-133: the same storage roots at this pinned block prove every word below is unchanged.
    const roots=await storageRoots(block),scanKey=roots===null?null:`${id===null?'next':id}:${roots}`;
    let scan=scanKey===null?undefined:retainedScans.get(scanKey);
    if(!scan){
      scan=await selectedWords(id,block);
      if(scanKey!==null){
        if(retainedScans.size>=4)retainedScans.delete(retainedScans.keys().next().value as string);
        retainedScans.set(scanKey,scan);
      }
    }
    const {core,raw,anchors,claim,positionMarket,sourceIdForPosition,everPoolFunded,ledgers,escrows,custody,nftOwner,minted,ownerNftBalance}=scan;
    const counter=BigInt(core[11]),operation=BigInt(core[12]);id=scan.id;
    const claims:Record<string,{marketId:string;words:readonly string[]}>={};
    anchors.forEach((anchor,i)=>{claims[String(BigInt(raw[18+i]))]=Object.freeze({marketId,words:anchor});});
    if(id<=counter)claims[String(id)]=Object.freeze({marketId,words:claim});
    const result:PreparedPoolSelectedState=Object.freeze({scope:'selected-pool-accounting',candidateKey,packageSha256:prepared.packageSha256,coreAddress:prepared.core,owner:owner.toLowerCase(),
      graph:prepared.graph,marketId,positionId:id,block:Object.freeze({...block}),market:market!,core,counter,operation,claim,anchors:Object.freeze(anchors),
      markets:Object.freeze({[marketId]:raw}),claims:Object.freeze(claims),positionMarket,sourceIdForPosition,everPoolFunded,
      ledgers:Object.freeze(ledgers),escrows:Object.freeze(escrows),custody:Object.freeze(custody),
      nftOwners:Object.freeze({[String(id)]:nftOwner}),nftMinted:Object.freeze({[String(id)]:minted}),ownerNftBalance});
    checkPreparedPoolSelectedScope(result);await attest(block);await checkedGuard();return result;
  };
  const ownerState = async (id: bigint, block: PreparedPoolBlock) => {
    await checkedGuard(); await attest(block);
    const registry = await readPreparedDexMarketRegistry({capability:readCapability,blockNumber:block.number,blockHash:block.hash,candidate:candidateKey});
    requireProof(registry.graph===prepared.graph && registry.packageSha256===prepared.packageSha256 && registry.core===prepared.core,
      'Prepared Pool owner registry changed.');
    const market = registry.markets.find(value=>value.marketId===marketId.toLowerCase());
    requireProof(!!market && market.token0===selectedPair!.tokens[0] && market.token1===selectedPair!.tokens[1], 'Prepared Pool owner market changed.');
    requireProof(await word(prepared.core,mapping(id,18n),block)===marketId.toLowerCase(),'Prepared Pool owner position market changed.');
    const claim=await words(prepared.core,preparedPoolPositionStorageBase(marketId,id),64,block);
    const nftOwner=await word(nft,mapping(id,2n),block);
    await attest(block);await checkedGuard();
    return {marketId:marketId.toLowerCase(),market:market!,claim,nftOwners:{[String(id)]:nftOwner},block};
  };
  const authenticate = async (id: bigint, kind: PreparedPoolProducerKind, transactionHash: string, expectedData?: string, viewOnly=false,
    pinnedStateBlock?: PreparedPoolBlock): Promise<PreparedPoolSnapshotProducer> => {
    uint(id); requireProof(id > 0n, 'Prepared Pool producer needs a position.');
    const lifecycle = kind === 'activate' || kind === 'resume';
    requireProof(kind === 'fund' || kind === 'snapshot' || lifecycle, 'This prepared owner action needs a separate poolSnapshot producer.');
    requireProof(!lifecycle || candidateKey === 'cheap-exit' || candidateKey === 'cheap-history', 'Pool lifecycle producer needs the current exit candidate.');
    const proof = await canonical(transactionHash); requireProof(!!proof, 'Prepared Pool producer receipt is unavailable.');
    const confirmed = proof!;
    if (kind === 'snapshot') requireProof(confirmed.data.toLowerCase() === currentPoolPositionAbi.encodeFunctionData('poolSnapshot', [id]).toLowerCase(), 'Prepared Pool snapshot selector/id changed.');
    else if (lifecycle) {
      const args = currentPoolPositionAbi.decodeFunctionData('managePoolPosition', confirmed.data);
      requireProof(currentPoolPositionAbi.encodeFunctionData('managePoolPosition', args).toLowerCase() === confirmed.data.toLowerCase() &&
        args[0] === id && BigInt(args[1]) !== 0n && args[2] === (kind === 'activate' ? 6n : 5n) && args[3] === '0x' &&
        (expectedData === undefined || confirmed.data.toLowerCase() === expectedData.toLowerCase()), 'Prepared lifecycle producer calldata changed.');
    } else {
      requireProof(typeof expectedData === 'string' && confirmed.data.toLowerCase() === expectedData.toLowerCase(), 'Prepared Pool producer differs from the exact submitted call.');
      const args = fundingAbi.decodeFunctionData('createPoolPosition', confirmed.data);
      requireProof(fundingAbi.encodeFunctionData('createPoolPosition', args).toLowerCase() === confirmed.data.toLowerCase(), 'Non-canonical prepared Pool producer calldata.');
      requireProof(args[0].toLowerCase() === marketId.toLowerCase(), 'Prepared Pool creation market changed.');
    }
    // Snapshot events bind the exact owner envelopes. Authenticate them against
    // current canonical storage; COTI may prune the receipt's historical state.
    const latest = kind === 'snapshot' && !pinnedStateBlock ? await rpc('eth_getBlockByNumber', ['latest', false]) as { number: string; hash: string } : null;
    const stateBlock = pinnedStateBlock ?? (latest ? Object.freeze({ number: BigInt(latest.number), hash: hash(latest.hash) }) : confirmed.block);
    requireProof(stateBlock.number >= confirmed.block.number, 'Prepared Pool state precedes its producer.');
    let retainedState:PreparedPoolSelectedState|undefined;
    const captured = viewOnly ? await ownerState(id,stateBlock) : (retainedState=await selectedState(id,stateBlock));
    const claim = captured.claim, status = BigInt(claim[0]), closed = status === 4n;
    requireProof([1n, 2n, 4n].includes(status) && BigInt(claim[59]) === 1n && BigInt(claim[1]) === 0n && BigInt(claim[2]) === 0n && BigInt(claim[3]) === 0n && BigInt(claim[7]) === 1n, 'Prepared Pool claim type/status changed.');
    const pub = (await call(currentPoolPositionAbi, prepared.core, 'poolPublicState', [id], stateBlock))[0];
    requireProof(pub.status === status && pub.sourceId === BigInt(claim[1]) && pub.bucket0Id === BigInt(claim[2]) && pub.bucket1Id === BigInt(claim[3]) &&
      [pub.positionRevision, pub.ownershipRevision, pub.lifecycleRevision, pub.termsRevision].every((v, i) => v === BigInt(claim[4 + i])) &&
      pub.context.toLowerCase() === claim[13], 'Prepared Pool public revisions/context differ from storage.');
    if (closed) {
      requireProof(addressAt(claim[12]) === owner.toLowerCase() && BigInt(await word(nft, mapping(id, 2n), stateBlock)) === 0n, 'Prepared closed Pool owner/burn storage changed.');
      requireProof(claim[22] === claim[60] && claim[23] === claim[61], 'Prepared closed Pool stored share ciphertext differs.');
    } else requireProof((await call(currentPoolNftAbi, nft, 'ownerOf', [id], stateBlock))[0].toLowerCase() === owner.toLowerCase() &&
      addressAt(captured.nftOwners[String(id)]) === owner.toLowerCase(), 'Prepared Pool NFT belongs to another owner.');
    const envelopes = preparedPoolStoredEnvelopes(claim);
    requireProof(BigInt(claim[13]) !== 0n && envelopes.every(v => v.ciphertextHigh !== 0n || v.ciphertextLow !== 0n), 'Prepared Pool owner envelopes are unavailable.');
    if (lifecycle) requireProof(status === (kind === 'activate' ? 2n : 1n), 'Prepared lifecycle producer status changed.');
    else {
      const name = kind === 'fund' ? 'SharedClaimCreated' : 'PoolSnapshotRefreshed';
      const found = confirmed.logs.filter(log => log.address.toLowerCase() === prepared.core && log.topics[0]?.toLowerCase() === events.getEvent(name)!.topicHash.toLowerCase());
      requireProof(found.length === 1, 'Prepared Pool producer needs one unique Core event.');
      const parsed = events.parseLog({ topics: [...found[0].topics], data: found[0].data })!, encoded = events.encodeEventLog(parsed.fragment, parsed.args);
      requireProof(parsed.args.positionId === id && encoded.data.toLowerCase() === found[0].data.toLowerCase() && same(encoded.topics.map(v => v.toLowerCase()), found[0].topics.map(v => v.toLowerCase())), 'Non-canonical prepared Pool producer event.');
      if (kind === 'snapshot') requireProof(parsed.args.context.toLowerCase() === claim[13] && same(parsed.args.userValues.map((v: { ciphertextHigh: bigint; ciphertextLow: bigint }) => ({ ciphertextHigh: v.ciphertextHigh, ciphertextLow: v.ciphertextLow })), envelopes), 'Prepared Pool snapshot event differs from stored owner envelopes.');
    }
    if (kind === 'fund') requireProof(decodeCurrentPoolClaimMint(confirmed.logs, prepared.core, nft, owner) === id && status === 1n &&
      claim.slice(4,8).every(v=>BigInt(v)===1n), 'Prepared Pool creation claim/mint changed.');
    const amounts = checkPreparedPoolPositionValues(envelopes.map(cipher => decryptPrivateUint256Output(signer, cipher)));
    let amountsTransactionHash = transactionHash;
    if (kind === 'fund') {
      // A later poolSnapshot replaces these envelopes without advancing claim revisions.
      requireProof(confirmed.block.number <= BigInt(Number.MAX_SAFE_INTEGER), 'Prepared Pool receipt block exceeds the snapshot read bound.');
      const logs = await provider.getLogs({ address: prepared.core, fromBlock: Number(confirmed.block.number), toBlock: Number(confirmed.block.number),
        topics: [events.getEvent('PoolSnapshotRefreshed')!.topicHash, toBeHex(id,32)] });
      await checkedGuard();
      requireProof(logs.length <= 256, 'Prepared Pool funding snapshot history exceeds its read bound.');
      if (logs.length) {
        const header = await rpc('eth_getBlockByNumber', [`0x${confirmed.block.number.toString(16)}`, false]) as { number: string; hash: string; transactions: string[] };
        requireProof(BigInt(header.number) === confirmed.block.number && hash(header.hash) === confirmed.block.hash && Array.isArray(header.transactions),
          'Prepared Pool funding snapshot block changed.');
        const transactions = header.transactions.map(hash), fundIndex = transactions.indexOf(transactionHash.toLowerCase()), seen = new Set<string>();
        requireProof(fundIndex >= 0 && new Set(transactions).size === transactions.length, 'Prepared Pool funding transaction ordering changed.');
        const ordered = logs.map(log => {
          const parsed = events.parseLog({ topics: [...log.topics], data: log.data }), snapshotHash = hash(log.transactionHash), index = transactions.indexOf(snapshotHash);
          requireProof(!log.removed && log.address.toLowerCase() === prepared.core && BigInt(log.blockNumber) === confirmed.block.number &&
            hash(log.blockHash) === confirmed.block.hash && Number.isSafeInteger(log.index) && log.index >= 0 &&
            !!parsed && parsed.name === 'PoolSnapshotRefreshed' && parsed.args.positionId === id && index > fundIndex && !seen.has(snapshotHash),
            'Prepared Pool funding snapshot discovery changed.');
          seen.add(snapshotHash); return { index, transactionHash: snapshotHash, log };
        }).sort((a,b) => b.index-a.index);
        const last = ordered[0], snapshotProof = await canonical(last.transactionHash);
        requireProof(!!snapshotProof && same(snapshotProof.block,confirmed.block) && snapshotProof.logs.filter(log => same(log,
          { address:last.log.address,topics:[...last.log.topics],data:last.log.data })).length === 1, 'Prepared Pool funding snapshot receipt changed.');
        const snapshot = await authenticate(id,'snapshot',last.transactionHash,undefined,true,confirmed.block);
        requireProof(same(snapshot.amounts,amounts) && snapshot.context === claim[13] && same(snapshot.revisions,claim.slice(4,8).map(BigInt)),
          'Prepared Pool funding snapshot differs from its owner state.');
        amountsTransactionHash = snapshot.transactionHash;
      }
    }
    requireProof(closed ? amounts.shares === 0n : kind === 'fund' ? amounts.shares > 0n :
      amounts.shares > 0n || amounts.amount0 === 0n && amounts.amount1 === 0n, 'Prepared Pool private share state changed.');
    requireProof(same(await canonical(transactionHash), confirmed), 'Prepared Pool canonical producer changed after decryption.');
    if (latest) requireProof((await rpc('eth_getBlockByNumber', [`0x${stateBlock.number.toString(16)}`, false]) as { hash: string }).hash.toLowerCase() === stateBlock.hash,
      'Prepared Pool current state is no longer canonical.');
    await checkedGuard();
    const value = Object.freeze({ kind, positionId: id, marketId: captured.marketId, canonicalId: captured.market.canonicalId,
      registryRevision: captured.market.registryRevision, marketRevision: captured.market.marketRevision, transactionHash, context: claim[13],
      block: captured.block, status, revisions: Object.freeze(claim.slice(4, 8).map(BigInt)), amounts, readyToSign: false as const,
      ...(kind === 'fund' ? { amountsTransactionHash } : {}) });
    if(retainedState)produced.set(value, { signer, state: retainedState, canonical: confirmed }); return value;
  };
  const issue = (id:bigint,kind:PreparedPoolProducerKind,transactionHash:string,expectedData?:string) => authenticate(id,kind,transactionHash,expectedData);
  // A view snapshot has no producer brand and cannot authorize financial actions.
  const readSnapshot = (id:bigint,transactionHash:string) => authenticate(id,'snapshot',transactionHash,undefined,true);
  const verifySupersededSnapshot = async (id: bigint, originalHash: string, latestSnapshotHash: string) => {
    requireProof(candidateKey === 'cheap-history' && prepared.graph === currentCandidate.graph &&
      prepared.packageSha256 === currentCandidate.packageSha256 && hash(originalHash) !== hash(latestSnapshotHash),
    'Superseded snapshot recovery requires the pinned candidate and a distinct current snapshot.');
    const original = await canonical(originalHash), latest = await canonical(latestSnapshotHash);
    const data = currentPoolPositionAbi.encodeFunctionData('poolSnapshot', [id]).toLowerCase();
    requireProof(!!original && !!latest && original.data.toLowerCase() === data && latest.data.toLowerCase() === data,
      'Superseded snapshot calls are unavailable or changed.');
    const found = original!.logs.filter(log => log.address.toLowerCase() === prepared.core &&
      log.topics[0]?.toLowerCase() === events.getEvent('PoolSnapshotRefreshed')!.topicHash.toLowerCase());
    requireProof(found.length === 1, 'Superseded snapshot needs one unique Core event.');
    const parsed = events.parseLog({ topics: [...found[0].topics], data: found[0].data })!;
    const encoded = events.encodeEventLog(parsed.fragment, parsed.args);
    requireProof(parsed.args.positionId === id && encoded.data.toLowerCase() === found[0].data.toLowerCase() &&
      same(encoded.topics.map(v => v.toLowerCase()), found[0].topics.map(v => v.toLowerCase())), 'Superseded snapshot event changed.');
    let later = latest!.block.number > original!.block.number;
    if (latest!.block.number === original!.block.number) {
      requireProof(same(latest!.block, original!.block), 'Superseded snapshot block identity changed.');
      const header = await rpc('eth_getBlockByNumber', [`0x${original!.block.number.toString(16)}`, false]) as { hash: string; transactions: string[] };
      requireProof(hash(header.hash) === original!.block.hash && Array.isArray(header.transactions), 'Superseded snapshot block ordering is unavailable.');
      const transactions = header.transactions.map(hash), index = transactions.indexOf(hash(originalHash));
      requireProof(index >= 0 && new Set(transactions).size === transactions.length, 'Superseded snapshot transaction ordering changed.');
      later = transactions.indexOf(hash(latestSnapshotHash)) > index;
    }
    requireProof(later, 'Replacement snapshot must follow the saved snapshot.');
    // Only the later event may authenticate current amounts; the old event is recovery evidence only.
    const view = await readSnapshot(id, latestSnapshotHash);
    requireProof(view.status === 1n && view.revisions.length === 4 && view.revisions.every(v => v === 1n),
      'Superseded snapshot has prior owner management. Keep the accounting hold.');
    const raw = await rpc('eth_getBlockByNumber', ['latest', false]) as { number: string; hash: string };
    const current = await ownerState(id, { number: BigInt(raw.number), hash: hash(raw.hash) });
    requireProof(current.block.number >= view.block.number && BigInt(current.claim[0]) === 1n && current.claim.slice(4, 8).every(v => BigInt(v) === 1n) &&
      current.claim[13] === view.context && addressAt(current.nftOwners[String(id)]) === owner.toLowerCase() &&
      (await call(currentPoolNftAbi, nft, 'ownerOf', [id], current.block))[0].toLowerCase() === owner.toLowerCase(),
    'Superseded snapshot current owner or revisions changed.');
    const latestEvent = latest!.logs.filter(log => log.address.toLowerCase() === prepared.core &&
      log.topics[0]?.toLowerCase() === events.getEvent('PoolSnapshotRefreshed')!.topicHash.toLowerCase());
    requireProof(latestEvent.length === 1 && same(events.parseLog({ topics: [...latestEvent[0].topics], data: latestEvent[0].data })!.args.userValues.map(
      (v: { ciphertextHigh: bigint; ciphertextLow: bigint }) => ({ ciphertextHigh: v.ciphertextHigh, ciphertextLow: v.ciphertextLow })),
    preparedPoolStoredEnvelopes(current.claim)), 'Replacement snapshot is no longer current.');
    requireProof(same(await canonical(originalHash), original) && same(await canonical(latestSnapshotHash), latest) &&
      hash((await rpc('eth_getBlockByNumber', [`0x${current.block.number.toString(16)}`, false]) as { hash: string }).hash) === current.block.hash,
    'Superseded snapshot canonical proof changed.');
    await checkedGuard();
    return Object.freeze({ block: current.block, originalBlock: original!.block, latestSnapshotBlock: latest!.block,
      revisions: Object.freeze(current.claim.slice(4, 8).map(BigInt)), claimStatus: 1n });
  };
  const current = async (producer: PreparedPoolSnapshotProducer, block: PreparedPoolBlock, reuseIssuedState = false,
    onVerifiedState?: (state: PreparedPoolSelectedState) => void) => {
    assertPreparedPoolSnapshotProducer(producer, signer); const retained = produced.get(producer)!;
    requireProof(producer.marketId === marketId.toLowerCase() && same(await canonical(producer.transactionHash), retained.canonical), 'Prepared Pool producer identity changed.');
    if (reuseIssuedState) {
      requireProof(block.number === retained.state.block.number && block.hash.toLowerCase() === retained.state.block.hash,
        'Prepared Pool issued block changed.');
      await attest(block);
    }
    const observed = reuseIssuedState ? retained.state : await selectedState(producer.positionId, block);
    requireProof(same({ ...observed, block: null }, { ...retained.state, block: null }), 'Prepared Pool producer is stale; sign a new snapshot.');
    if (producer.status !== 4n) requireProof((await call(currentPoolNftAbi, nft, 'ownerOf', [producer.positionId], block))[0].toLowerCase() === owner.toLowerCase(), 'Prepared Pool owner changed.');
    await checkedGuard(); onVerifiedState?.(observed); return producer;
  };
  const wallets = async (block: PreparedPoolBlock) => {
    await attest(block); const result = [];
    for (const [token] of prepared.tokens) {
      const balance = (await call(currentTokenFundingAbi, token, 'balanceOf', [owner], block))[0];
      const allowance = (await call(currentTokenFundingAbi, token, 'allowance', [owner, prepared.core], block))[0];
      const decode = async (envelope: { ciphertextHigh: bigint; ciphertextLow: bigint }, system: readonly string[]) => {
        if (envelope.ciphertextHigh === 0n && envelope.ciphertextLow === 0n) {
          requireProof(system.every(v => BigInt(v) === 0n), 'Prepared token owner envelope is unavailable.'); return 0n;
        }
        return uint(decryptPrivateUint256Output(signer, envelope));
      };
      const rawBalance = await words(token, mapping(owner, 4n, 'address'), 4, block);
      requireProof(BigInt(rawBalance[2]) === balance.ciphertextHigh && BigInt(rawBalance[3]) === balance.ciphertextLow, 'Prepared wallet balance envelope differs from storage.');
      result.push(Object.freeze({ token, balance: await decode(balance, rawBalance.slice(0, 2)), allowance: await decode(allowance.ownerCiphertext,
        [toBeHex(allowance.ciphertext.ciphertextHigh, 32), toBeHex(allowance.ciphertext.ciphertextLow, 32)]) }));
    }
    await checkedGuard(); return Object.freeze(result);
  };
  return Object.freeze({ state, selectedState, issue, readSnapshot, verifySupersededSnapshot, current, wallets, canonical });
};

export const checkPreparedPoolSnapshotOnlyChange = (before: PreparedPoolAccountingState, after: PreparedPoolAccountingState) => {
  if(isPreparedPoolSelectedState(before))checkPreparedPoolSelectedScope(before);
  if(isPreparedPoolSelectedState(after))checkPreparedPoolSelectedScope(after);
  const closed = BigInt(before.claim[0]) === 4n;
  const cleanClaim = (claim: readonly string[]) => claim.map((v, i) =>
    (closed ? i >= 14 && i < 54 && (i - 14) % 4 >= 2 : i >= 13 && i < 54) ? 'snapshot' : v);
  const clean = (s: PreparedPoolAccountingState) => ({ ...s, block: null, claim: cleanClaim(s.claim), claims: { ...s.claims,
    [String(s.positionId)]: { marketId: s.marketId, words: cleanClaim(s.claim) } } });
  requireProof(same(clean(before), clean(after)), 'Prepared snapshot changed financial state.');
};

// Frozen 7c allocator counters advance across users; C1 active state is separate.
const advancingCoreFields = [11,12,13,14,16,17];
const creationCore = (s:PreparedPoolSelectedState) => s.core.map((v,i)=>advancingCoreFields.includes(i)?'allocator':i>=58&&i<=98?'separate-c1':v);
const checkCreationCore = (before:PreparedPoolSelectedState,after:PreparedPoolSelectedState) => {
  requireProof(advancingCoreFields.every(i=>BigInt(after.core[i])>=BigInt(before.core[i])) && same(creationCore(before),creationCore(after)),
    'Prepared Pool creation Core configuration or monotonic counters changed.');
};
const creationLedgers = (s:PreparedPoolSelectedState) => Object.fromEntries(Object.entries(s.ledgers).map(([token,raw])=>
  [token,raw.map((v,i)=>i===9||i===10?'global-pool-inventory':v)]));
/** The next free row proves allocator admission, not a reserved output ID. */
export const checkPreparedPoolFundingCurrent = (before:PreparedPoolAccountingState,after:PreparedPoolAccountingState) => {
  if(!isPreparedPoolSelectedState(before)||!isPreparedPoolSelectedState(after)) {
    requireProof(!isPreparedPoolSelectedState(before)&&!isPreparedPoolSelectedState(after)&&same({...before,block:null},{...after,block:null}),
      'Prepared Pool financial preview dependencies changed.');return;
  }
  checkPreparedPoolSelectedScope(before);checkPreparedPoolSelectedScope(after);checkCreationCore(before,after);
  requireProof(before.positionId===before.counter+1n && after.positionId===after.counter+1n,'Prepared Pool creation needs a fresh empty allocator row.');
  const clean=(s:PreparedPoolSelectedState)=>({...s,block:null,positionId:0n,counter:0n,operation:0n,core:creationCore(s),
    nftOwners:{},nftMinted:{},ledgers:creationLedgers(s),custody:'global-token-custody'});
  requireProof(same(clean(before),clean(after)),'Prepared Pool financial preview dependencies changed.');
};

// Normal funding uses complete selected accounting; the full six-market state
// remains available for qualification with the same custody/ledger masks.
export const checkPreparedPoolFinancialTransition = (before: PreparedPoolAccountingState, after: PreparedPoolAccountingState, action: 'fund') => {
  requireProof(isPreparedPoolSelectedState(before)===isPreparedPoolSelectedState(after),'Prepared Pool accounting scopes changed.');
  if(isPreparedPoolSelectedState(before))checkPreparedPoolSelectedScope(before);
  if(isPreparedPoolSelectedState(after))checkPreparedPoolSelectedScope(after);
  requireProof(action === 'fund', 'Prepared financial action needs its own proven transition checker.');
  if(isPreparedPoolSelectedState(before)&&isPreparedPoolSelectedState(after)) {
    checkCreationCore(before,after);
    requireProof(before.positionId===before.counter+1n && after.positionId>before.counter && after.positionId<=after.counter &&
      after.positionMarket===before.marketId && BigInt(after.everPoolFunded)===1n &&
      addressAt(after.nftOwners[String(after.positionId)])===before.owner && after.claim.slice(4,8).every(v=>BigInt(v)===1n),
      'Prepared selected Pool funding allocation or identity changed.');
    const poolFields=[4,8,9,10,11,14,15,18,19],marketFields=[11,12,13,14,...Array.from({length:14},(_,i)=>25+i)];
    const clean=(s:PreparedPoolSelectedState)=>({...s,block:null,positionId:0n,counter:0n,operation:0n,core:creationCore(s),claim:[],
      positionMarket:'funded-market',everPoolFunded:'funded',ownerNftBalance:0n,nftOwners:{},nftMinted:{},
      anchors:s.anchors.map(raw=>raw.map((v,i)=>poolFields.includes(i)?'shared-anchor':v)),
      claims:Object.fromEntries(Object.entries(s.claims).filter(([id])=>id!==String(s.positionId)).map(([id,value])=>[id,
        {...value,words:value.words.map((v,i)=>poolFields.includes(i)?'shared-anchor':v)}])),
      markets:{[s.marketId]:s.markets[s.marketId].map((v,i)=>marketFields.includes(i)?'shared-pool':v)},
      ledgers:creationLedgers(s),custody:'global-token-custody'});
    requireProof(same(clean(before),clean(after)),'Prepared funding changed protected selected Pool accounting.');
    // Receipt-block aggregates can include later owners' work; own claim proof stays exact.
    before.anchors.forEach((anchor,i)=>requireProof(BigInt(after.anchors[i][4])>BigInt(anchor[4]) &&
      after.anchors[i][8]===after.anchors[i][14] && after.anchors[i][9]===after.anchors[i][15] &&
      after.anchors[i][10]===after.anchors[i][18] && after.anchors[i][11]===after.anchors[i][19],'Prepared funding anchor revision changed.'));
    requireProof(BigInt(after.claim[0])===1n,'Prepared funding did not create a shared active claim.');
    return;
  }
  requireProof(before.positionId === before.counter + 1n && after.counter === before.counter + 1n && after.positionId === before.positionId && before.operation === after.operation &&
    before.claim.every(v => BigInt(v) === 0n) && after.ownerNftBalance === before.ownerNftBalance + 1n &&
    BigInt(before.nftOwners[String(before.positionId)]) === 0n && BigInt(before.nftMinted[String(before.positionId)]) === 0n &&
    BigInt(after.nftOwners[String(after.positionId)]) !== 0n && BigInt(after.nftMinted[String(after.positionId)]) === 1n, 'Prepared creation counter/baseline changed.');
  const poolFields = [4, 8, 9, 10, 11, 14, 15, 18, 19];
  const clean = (s: PreparedPoolAccountingState) => ({ ...s,
    block: null, counter: 0n, claim: [], anchors: s.anchors.map(raw=>raw.map((v,i)=>poolFields.includes(i)?'shared-anchor':v)), ownerNftBalance: 0n,
    nftOwners: Object.fromEntries(Object.entries(s.nftOwners).filter(([id]) => id !== String(s.positionId))),
    nftMinted: Object.fromEntries(Object.entries(s.nftMinted).filter(([id]) => id !== String(s.positionId))),
    core: s.core.map((v, i) => i === 11 ? 'counter' : v),
    markets: Object.fromEntries(Object.entries(s.markets).map(([id, raw]) => [id, id === s.marketId ? raw.map((v, i) =>
      [11, 12, 13, 14, ...Array.from({ length: 14 }, (_, j) => 25 + j)].includes(i) ? 'shared-pool' : v) : raw])),
    claims: Object.fromEntries(Object.entries(s.claims).filter(([id]) => id !== String(s.positionId)).map(([id, value]) => [id,
      value.marketId === s.marketId && s.markets[s.marketId].slice(18, 25).some(v => BigInt(v) === BigInt(id)) ?
        { ...value, words: value.words.map((v, i) => poolFields.includes(i) ? 'shared-anchor' : v) } : value])),
    ledgers: Object.fromEntries(Object.entries(s.ledgers).map(([token, raw]) => [token, [s.market.token0, s.market.token1].includes(token) ? raw.map((v, i) => i === 9 || i === 10 ? 'pool-inventory' : v) : raw])),
    custody: Object.fromEntries(Object.entries(s.custody).map(([token, raw]) => [token, [s.market.token0, s.market.token1].includes(token) ? 'selected-token-custody' : raw])) });
  requireProof(same(clean(before), clean(after)), 'Prepared funding changed a protected market, claim, ledger, escrow or Core field.');
  before.anchors.forEach((anchor, i) => requireProof(BigInt(after.anchors[i][4]) === BigInt(anchor[4]) + 1n &&
    after.anchors[i][8]===after.anchors[i][14] && after.anchors[i][9]===after.anchors[i][15] &&
    after.anchors[i][10]===after.anchors[i][18] && after.anchors[i][11]===after.anchors[i][19], 'Prepared funding anchor revision changed.'));
  requireProof(BigInt(after.claim[0]) === 1n && BigInt(after.claim[59]) === 1n && after.claim.slice(1, 4).every(v => BigInt(v) === 0n), 'Prepared funding did not create a shared active claim.');
};
