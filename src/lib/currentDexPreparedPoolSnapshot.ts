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
}>;
type Canonical = Readonly<{ block: PreparedPoolBlock; data: string; logs: readonly Log[] }>;
const produced = new WeakMap<object, { signer: object; state: PreparedPoolStoredState; canonical: Canonical }>();
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
  const authenticate = async (id: bigint, kind: PreparedPoolProducerKind, transactionHash: string, expectedData?: string, viewOnly=false): Promise<PreparedPoolSnapshotProducer> => {
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
    const latest = kind === 'snapshot' ? await rpc('eth_getBlockByNumber', ['latest', false]) as { number: string; hash: string } : null;
    const stateBlock = latest ? Object.freeze({ number: BigInt(latest.number), hash: hash(latest.hash) }) : confirmed.block;
    requireProof(stateBlock.number >= confirmed.block.number, 'Prepared Pool state precedes its producer.');
    let retainedState:PreparedPoolStoredState|undefined;
    const captured = viewOnly ? await ownerState(id,stateBlock) : (retainedState=await state(id,stateBlock));
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
    if (kind === 'fund') requireProof(decodeCurrentPoolClaimMint(confirmed.logs, prepared.core, nft, owner) === id && status === 1n, 'Prepared Pool creation claim/mint changed.');
    const amounts = checkPreparedPoolPositionValues(envelopes.map(cipher => decryptPrivateUint256Output(signer, cipher)));
    requireProof(closed ? amounts.shares === 0n : kind === 'fund' ? amounts.shares > 0n :
      amounts.shares > 0n || amounts.amount0 === 0n && amounts.amount1 === 0n, 'Prepared Pool private share state changed.');
    requireProof(same(await canonical(transactionHash), confirmed), 'Prepared Pool canonical producer changed after decryption.');
    if (latest) requireProof((await rpc('eth_getBlockByNumber', [`0x${stateBlock.number.toString(16)}`, false]) as { hash: string }).hash.toLowerCase() === stateBlock.hash,
      'Prepared Pool current state is no longer canonical.');
    await checkedGuard();
    const value = Object.freeze({ kind, positionId: id, marketId: captured.marketId, canonicalId: captured.market.canonicalId,
      registryRevision: captured.market.registryRevision, marketRevision: captured.market.marketRevision, transactionHash, context: claim[13],
      block: captured.block, status, revisions: Object.freeze(claim.slice(4, 8).map(BigInt)), amounts, readyToSign: false as const });
    if(retainedState)produced.set(value, { signer, state: retainedState, canonical: confirmed }); return value;
  };
  const issue = (id:bigint,kind:PreparedPoolProducerKind,transactionHash:string,expectedData?:string) => authenticate(id,kind,transactionHash,expectedData);
  // A view snapshot has no producer brand and cannot authorize financial actions.
  const readSnapshot = (id:bigint,transactionHash:string) => authenticate(id,'snapshot',transactionHash,undefined,true);
  const current = async (producer: PreparedPoolSnapshotProducer, block: PreparedPoolBlock, reuseIssuedState = false) => {
    assertPreparedPoolSnapshotProducer(producer, signer); const retained = produced.get(producer)!;
    requireProof(producer.marketId === marketId.toLowerCase() && same(await canonical(producer.transactionHash), retained.canonical), 'Prepared Pool producer identity changed.');
    if (reuseIssuedState) {
      requireProof(block.number === retained.state.block.number && block.hash.toLowerCase() === retained.state.block.hash,
        'Prepared Pool issued block changed.');
      await attest(block);
    }
    const observed = reuseIssuedState ? retained.state : await state(producer.positionId, block);
    requireProof(same({ ...observed, block: null }, { ...retained.state, block: null }), 'Prepared Pool producer is stale; sign a new snapshot.');
    if (producer.status !== 4n) requireProof((await call(currentPoolNftAbi, nft, 'ownerOf', [producer.positionId], block))[0].toLowerCase() === owner.toLowerCase(), 'Prepared Pool owner changed.');
    await checkedGuard(); return producer;
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
  return Object.freeze({ state, issue, readSnapshot, current, wallets, canonical });
};

export const checkPreparedPoolSnapshotOnlyChange = (before: PreparedPoolStoredState, after: PreparedPoolStoredState) => {
  const closed = BigInt(before.claim[0]) === 4n;
  const cleanClaim = (claim: readonly string[]) => claim.map((v, i) =>
    (closed ? i >= 14 && i < 54 && (i - 14) % 4 >= 2 : i >= 13 && i < 54) ? 'snapshot' : v);
  const clean = (s: PreparedPoolStoredState) => ({ ...s, block: null, claim: cleanClaim(s.claim), claims: { ...s.claims,
    [String(s.positionId)]: { marketId: s.marketId, words: cleanClaim(s.claim) } } });
  requireProof(same(clean(before), clean(after)), 'Prepared snapshot changed financial state.');
};

// Funding rules retain the compiled native Pool allowlist and prepared fixtures'
// token custody/ledger rules. This is bounded to the declared six-market scope.
export const checkPreparedPoolFinancialTransition = (before: PreparedPoolStoredState, after: PreparedPoolStoredState, action: 'fund') => {
  requireProof(action === 'fund', 'Prepared financial action needs its own proven transition checker.');
  requireProof(before.positionId === before.counter + 1n && after.counter === before.counter + 1n && after.positionId === before.positionId && before.operation === after.operation &&
    before.claim.every(v => BigInt(v) === 0n) && after.ownerNftBalance === before.ownerNftBalance + 1n &&
    BigInt(before.nftOwners[String(before.positionId)]) === 0n && BigInt(before.nftMinted[String(before.positionId)]) === 0n &&
    BigInt(after.nftOwners[String(after.positionId)]) !== 0n && BigInt(after.nftMinted[String(after.positionId)]) === 1n, 'Prepared creation counter/baseline changed.');
  const poolFields = [4, 8, 9, 10, 11, 14, 15, 18, 19];
  const clean = (s: PreparedPoolStoredState) => ({ ...s, block: null, counter: 0n, claim: [], anchors: [], ownerNftBalance: 0n,
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
  before.anchors.forEach((anchor, i) => requireProof(BigInt(after.anchors[i][4]) === BigInt(anchor[4]) + 1n, 'Prepared funding anchor revision changed.'));
  requireProof(BigInt(after.claim[0]) === 1n && BigInt(after.claim[59]) === 1n && after.claim.slice(1, 4).every(v => BigInt(v) === 0n), 'Prepared funding did not create a shared active claim.');
};
