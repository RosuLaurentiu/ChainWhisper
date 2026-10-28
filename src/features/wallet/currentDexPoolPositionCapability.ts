import { AbiCoder, Interface, getAddress, keccak256, toBeHex } from '@coti-io/coti-ethers';
import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../lib/dexV2Deployment';
import { createDexV2ReadCapability, readCurrentSharedPoolDexGraph } from '../../lib/dexV2Chain';
import { currentPoolPositionAbi as abi, currentPoolNftAbi as nftAbi, currentPoolActionId, currentPoolOwnerGasCap, encodeCurrentPoolExit,
  checkCurrentPoolPositionValues, decodeCurrentPoolNftTransfer, type CurrentPoolOwnerAction } from '../../lib/currentDexPoolPosition';
import { decryptPrivateUint256Output, encryptPrivateUint128Input, encryptPrivateUint256Input } from '../../lib/privateUint256';
import { issueOwnerCotiMetaMaskCapability, type IssueOwnerCotiMetaMaskCapabilityArgs } from './ownerCotiMetaMaskCapability';
import { STAGED_NATIVE_DEX_CANDIDATE } from '../../lib/dexV2Deployment';
import { createCurrentOwnerPoolSnapshotReader } from '../../lib/currentDexNativePoolSnapshotReader';
import { currentNativePoolSession, requireCurrentNativePoolSession } from '../../lib/currentDexNativePoolPolicy';
import { currentNativePoolSnapshotAbi, checkCurrentPoolSnapshotOnlyChange, checkCurrentPoolFinancialTransition, requireCurrentPoolProof } from '../../lib/currentDexNativePoolSnapshot';
import { resolvePreparedDexScope } from '../../lib/currentDexPreparedScope';
import { createPreparedOwnerPoolSnapshotReader, checkPreparedPoolSnapshotOnlyChange,
  type PreparedPoolSnapshotProducer, type PreparedPoolStoredState } from '../../lib/currentDexPreparedPoolSnapshot';
import { checkPreparedPoolManagementTransition, checkPreparedPoolManagementSnapshot, checkPreparedPoolOwnershipTransition,
  type PreparedPoolManagementExpectation } from '../../lib/currentDexPreparedPoolManagement';
import { encodePoolExitPreview, encodePreviewedPoolWithdrawal, computePoolExitPreviewContext,
  decodePoolExitPreviewEvent, checkPoolExitPreviewValues, type PoolExitPreviewAmounts } from '../../lib/currentDexPoolExitPreview';
import { readCurrentDexOwnedPositionIds } from '../../lib/currentDexOwnedPositions';
import { verifyCurrentDexCanonicalInclusion } from '../../lib/currentDexCanonicalInclusion';

type IssueArgs = Omit<IssueOwnerCotiMetaMaskCapabilityArgs<unknown>, 'bindCapability' | 'capabilityLabel' | 'requirePrivacy'> & Readonly<{ candidate?: CurrentCheapDexCandidateKey }>;

const zeroAddress = '0x0000000000000000000000000000000000000000';
const snapshotEvents = new Interface(['event PoolSnapshotRefreshed(uint256 indexed positionId,bytes32 context,(uint256 ciphertextHigh,uint256 ciphertextLow)[10] userValues)']);
const preparedSessions = new WeakMap<object, object>();
type PreparedReader = ReturnType<typeof createPreparedOwnerPoolSnapshotReader>;
type ManagedClose = Readonly<{ owner: string; transactionHash: string;
  proof: NonNullable<Awaited<ReturnType<PreparedReader['canonical']>>>;
  state: PreparedPoolStoredState; wallets: Awaited<ReturnType<PreparedReader['wallets']>>;
  expected: PreparedPoolManagementExpectation }>;
// Keep private verification only in the selected signer session. A new issuer in
// that same session must be able to finish the separate paid snapshot.
const preparedCloses = new WeakMap<object, Map<bigint, ManagedClose>>();
type ExitPreview = Readonly<{ graph: string; owner: string; transactionHash: string; data: string; context: string;
  proof: ManagedClose['proof']; state: PreparedPoolStoredState; wallets: ManagedClose['wallets'];
  fraction: readonly [bigint, bigint]; amounts: PoolExitPreviewAmounts }>;
const exitPreviews = new WeakMap<object, Map<string, ExitPreview>>();
export const assertCurrentPoolPositionPrepared = (value: unknown, signer: object) => {
  if (!value || typeof value !== 'object' || preparedSessions.get(value) !== signer) throw new Error('Position action was not prepared in this owner wallet session.');
};
const same = (a: string | null, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
const uint = (v: bigint, bits: number, positive = false) => {
  if (typeof v !== 'bigint' || v < (positive ? 1n : 0n) || v >= 1n << BigInt(bits)) throw new Error('Invalid position action amount.');
};
const transfer = new Interface(['event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
export const issueCurrentDexPoolPositionCapability = ({candidate: candidateKey = 'cheap-current', ...args}: IssueArgs) => issueOwnerCotiMetaMaskCapability({
  ...args, capabilityLabel: 'current Pool position owner', requirePrivacy: true,
  bindCapability: async ({ assertCurrent, assertSnapshotCurrent, readProvider, signer, chainId, ownerAddress }) => {
    const candidate = resolveCurrentCheapDexCandidate(candidateKey), nft = candidate.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1];
    const poolTokens = [...candidate.tokens].sort(([a],[b]) => BigInt(a) < BigInt(b) ? -1 : 1);
    const guard = async () => { await assertCurrent(); assertSnapshotCurrent();
      if (!signer.getUserOnboardInfo()?.aesKey?.trim()) throw new Error('Unlock owner privacy before reading or managing this position.'); };
    const capability = createDexV2ReadCapability({ chainId, assertCurrent,
      provider: { request: ({ method, params }) => readProvider.send(method, params ?? []) } });
    const checkGraph = async (block: {number: bigint;hash:string}) => {
      await guard();
      const graph = await readCurrentSharedPoolDexGraph({ capability, candidate: candidateKey, blockNumber:block.number,blockHash:block.hash });
      await guard();
      if (chainId !== BigInt(candidate.chainId) || graph.chainId !== chainId || graph.graph !== candidate.graph ||
          graph.packageSha256 !== candidate.packageSha256 || !same(graph.core,candidate.core) || graph.genesisHash !== candidate.genesisHash ||
          graph.block.number !== block.number || !same(graph.block.hash,block.hash)) throw new Error('Current position candidate changed.');
    };
    const head = async () => {
      await guard();
      const raw = await readProvider.send('eth_getBlockByNumber',['latest',false]);
      if (!raw || !/^0x[0-9a-fA-F]{64}$/.test(raw.hash)) throw new Error('Current position block is unavailable.');
      const block = Object.freeze({number:BigInt(raw.number),hash:raw.hash as string});
      await checkGraph(block); return block;
    };
    const call = async (host: Interface, to: string, method: string, values: unknown[], block: {hash:string}) => {
      await guard();
      const raw = await readProvider.send('eth_call',[{from:ownerAddress,to,data:host.encodeFunctionData(method,values)},
        {blockHash:block.hash,requireCanonical:true}]);
      await guard();
      const decoded = host.decodeFunctionResult(method,raw);
      if (host.encodeFunctionResult(method,decoded).toLowerCase() !== String(raw).toLowerCase()) throw new Error('Non-canonical position response.');
      return decoded;
    };
    const publicState = async (id:bigint, block:{number:bigint;hash:string}, closed = false) => {
      uint(id,256,true); if (id < 8n) throw new Error('Select a liquidity claim NFT, not a Pool anchor.');
      const state = (await call(abi,candidate.core,'poolPublicState',[id],block))[0];
      if (state.status < 1n || state.status > 4n || state.sourceId !== 0n || state.bucket0Id !== 0n || state.bucket1Id !== 0n ||
          state.positionRevision === 0n || state.ownershipRevision === 0n || state.lifecycleRevision === 0n || state.termsRevision !== 1n ||
          !/^0x[0-9a-fA-F]{64}$/.test(state.context) || BigInt(state.context) === 0n) throw new Error('Position is not a current shared-Pool claim.');
      if (!closed || state.status !== 4n) {
        const owner = (await call(nftAbi,nft,'ownerOf',[id],block))[0];
        if (!same(owner,ownerAddress)) throw new Error('The connected wallet does not own this position NFT.');
      }
      return Object.freeze({status:state.status as bigint,context:state.context as string,positionRevision:state.positionRevision as bigint,
        ownershipRevision:state.ownershipRevision as bigint,lifecycleRevision:state.lifecycleRevision as bigint});
    };
    const nativeReader = candidate.graph === STAGED_NATIVE_DEX_CANDIDATE.graph ? createCurrentOwnerPoolSnapshotReader({
      signer, owner: ownerAddress, candidate, provider: readProvider, guard, attest: checkGraph }) : null;
    const preparedScope = candidateKey === 'cheap-prepared' || candidateKey === 'cheap-exit' || candidateKey === 'cheap-history' ? resolvePreparedDexScope(candidate) : null;
    const isPrepared = !!preparedScope;
    const exitCandidate = preparedScope?.key === 'cheap-exit' || preparedScope?.key === 'cheap-history';
    const preparedReaders = new Map<string, ReturnType<typeof createPreparedOwnerPoolSnapshotReader>>();
    const preparedProducers = new Map<bigint, PreparedPoolSnapshotProducer>();
    const identical = (a: unknown, b: unknown) => JSON.stringify(a, (_, v) => typeof v === 'bigint' ? v.toString() : v) ===
      JSON.stringify(b, (_, v) => typeof v === 'bigint' ? v.toString() : v);
    const financial = (value: object) => ({ ...value, block: null });
    const preparedFor = async (id: bigint, block: { number: bigint; hash: string }) => {
      uint(id, 256, true); await checkGraph(block);
      // Sealed build-6 Core._positionMarket is mapping(uint256 => bytes32), slot18.
      const slot = keccak256(AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256'], [id, 18n]));
      const marketId = await readProvider.send('eth_getStorageAt', [candidate.core, slot, { blockHash: block.hash, requireCanonical: true }]);
      await guard();
      const pair = preparedScope?.candidate.pairs.find(pair => same(marketId, pair.marketId));
      if (!pair) throw new Error('Prepared position has no canonical market.');
      let reader = preparedReaders.get(pair.marketId);
      if (!reader) {
        reader = createPreparedOwnerPoolSnapshotReader({ signer, owner: ownerAddress, candidate, marketId: pair.marketId,
          readCapability: capability, provider: readProvider, guard, attest: checkGraph });
        preparedReaders.set(pair.marketId, reader);
      }
      return { reader, pair };
    };
    const readPreparedAt = async (id: bigint, block: { number: bigint; hash: string }, issued?: PreparedPoolSnapshotProducer) => {
      const { reader, pair } = await preparedFor(id, block), producer = issued ?? preparedProducers.get(id);
      if (!producer) throw new Error('Prepared position needs an authenticated fund or snapshot producer.');
      // issue() already authenticates this exact canonical block and owner envelopes.
      if (issued && (issued.positionId !== id || issued.block.number !== block.number || !same(issued.block.hash, block.hash)))
        throw new Error('Fresh position producer block changed.');
      const fresh = await reader.current(producer, block, !!issued), pub = await publicState(id, block, producer.status === 4n);
      requireCurrentPoolProof(pub.context.toLowerCase() === fresh.context.toLowerCase() && pub.status === fresh.status &&
        [pub.positionRevision, pub.ownershipRevision, pub.lifecycleRevision].every((v, i) => v === fresh.revisions[i]),
      'Prepared position public state differs from its producer.');
      return Object.freeze({ positionId: id, owner: ownerAddress, core: candidate.core, nft, chainId, graph: candidate.graph,
        packageSha256: candidate.packageSha256, block, ...pub, amounts: fresh.amounts, producerKind: fresh.kind,
        marketId: pair.marketId, poolTokens: pair.tokens, producerHash:fresh.transactionHash, readyToSign: false as const });
    };
    const readAt = async (id:bigint, block:{number:bigint;hash:string}, closed=false) => {
      await checkGraph(block);
      const state = await publicState(id,block,closed);
      const amounts = state.status === 3n ? null : await (async () => {
        if (nativeReader) {
          const session = requireCurrentNativePoolSession(signer, ownerAddress, candidate);
          requireCurrentPoolProof(session.positionId === id && !!session.producer && session.producer.status === state.status,
            'Current native Pool claim needs an issued fresh producer.');
          const producer = await nativeReader.current(session.producer!, block);
          return producer.amounts;
        }
        const snapshot = await call(abi,candidate.core,'poolSnapshot',[id],block);
        if (snapshot[0] !== state.context) throw new Error('Private position context differs from its public state.');
        // Only the owner envelope is readable; never decrypt the global ciphertext.
        const values = snapshot[1].map((value: {userCiphertext:{ciphertextHigh:bigint;ciphertextLow:bigint}}) => decryptPrivateUint256Output(signer,value.userCiphertext));
        await guard(); return checkCurrentPoolPositionValues(values);
      })();
      await checkGraph(block);
      return Object.freeze({positionId:id,owner:ownerAddress,core:candidate.core,nft,chainId,graph:candidate.graph,
        packageSha256:candidate.packageSha256,block,...state,amounts,
        marketId:undefined,poolTokens:undefined,
        producerKind:nativeReader?currentNativePoolSession(signer)?.producer?.kind:undefined,readyToSign:false as const});
    };
    const readPosition = async (id:bigint, options?: {producerHash?:string;metadataOnly?:true}) => {
      if (isPrepared) {
        const block = await head(), { reader, pair } = await preparedFor(id, block);
        const pub = await publicState(id, block, true);
        const metadata = () => Object.freeze({positionId:id,owner:ownerAddress,core:candidate.core,nft,chainId,graph:candidate.graph,
          packageSha256:candidate.packageSha256,block,...pub,amounts:null,producerKind:undefined,
          marketId:pair.marketId,poolTokens:pair.tokens,readyToSign:false as const});
        if (pub.status === 3n || options?.metadataOnly) {
          if (pub.status === 3n) preparedProducers.delete(id);
          if (options?.producerHash) throw new Error('Activate this received claim before reading private amounts.');
          return metadata();
        }
        let producerHash = options?.producerHash, discovered=false;
        if (!producerHash && !preparedProducers.has(id)) {
          const logs = await readProvider.getLogs({address:candidate.core,
            fromBlock:Number(preparedScope!.candidate.attestationBlock.number),toBlock:Number(block.number),
            topics:[snapshotEvents.getEvent('PoolSnapshotRefreshed')!.topicHash,toBeHex(id,32)]});
          await guard();
          if (logs.length > 256) throw new Error('Position snapshot history exceeds its read bound. Use private refresh.');
          const latest = [...logs].sort((a,b)=>b.blockNumber-a.blockNumber||b.index-a.index)[0];
          if (!latest) return metadata();
          const event = snapshotEvents.parseLog({topics:[...latest.topics],data:latest.data});
          if (latest.removed || !same(latest.address,candidate.core) || latest.blockNumber>Number(block.number) ||
            !event || event.args.positionId!==id) throw new Error('Position snapshot discovery changed.');
          if (!same(event.args.context,pub.context)) return metadata();
          producerHash=latest.transactionHash;discovered=true;
        }
        if(discovered){
          const view=await reader.readSnapshot(id,producerHash!);
          const current=await publicState(id,view.block,true);
          requireCurrentPoolProof(same(current.context,view.context)&&current.status===view.status&&
            [current.positionRevision,current.ownershipRevision,current.lifecycleRevision].every((v,i)=>v===view.revisions[i])&&view.revisions[3]===1n,
          'Position view differs from its authenticated snapshot.');
          return Object.freeze({positionId:id,owner:ownerAddress,core:candidate.core,nft,chainId,graph:candidate.graph,
            packageSha256:candidate.packageSha256,block:view.block,...current,amounts:view.amounts,producerKind:view.kind,
            marketId:pair.marketId,poolTokens:pair.tokens,producerHash,readyToSign:false as const});
        }
        if (producerHash) {
          const proof = await reader.canonical(producerHash);
          if (!proof) throw new Error('Prepared position producer is unavailable.');
          const snapshotData = abi.encodeFunctionData('poolSnapshot', [id]);
          const managed = abi.parseTransaction({ data: proof.data });
          const kind = proof.data.toLowerCase() === snapshotData.toLowerCase() ? 'snapshot' :
            managed?.name === 'managePoolPosition' && managed.args[2] === 6n ? 'activate' :
              managed?.name === 'managePoolPosition' && managed.args[2] === 5n ? 'resume' : 'fund';
          // This authenticates stored envelopes, not independent funding accounting.
          const issued = await reader.issue(id, kind, producerHash, kind !== 'snapshot' ? proof.data : undefined);
          const snapshot = await readPreparedAt(id, issued.block, issued);
          preparedProducers.set(id, issued); return snapshot;
        }
        return readPreparedAt(id, block);
      }
      if (nativeReader && options?.producerHash && currentNativePoolSession(signer)?.producer?.transactionHash.toLowerCase()!==options.producerHash.toLowerCase()) {
        const session = requireCurrentNativePoolSession(signer, ownerAddress, candidate);
        requireCurrentPoolProof(session.positionId === id && !!session.funded, 'Only the admitted new native Pool claim may be loaded.');
        const proof = await nativeReader.canonical(options.producerHash);
        if (!proof) throw new Error('Native Pool producer is unavailable.');
        const fund = proof.data === session.funded!.data;
        requireCurrentPoolProof(fund || proof.data.toLowerCase() === currentNativePoolSnapshotAbi.encodeFunctionData('poolSnapshot',[id]).toLowerCase(), 'Producer does not belong to the native Pool action.');
        requireCurrentPoolProof(!session.closedPayouts || !fund, 'A closed claim needs a fresh signed CLOSED producer.');
        session.producer = await nativeReader.issue(id, fund ? 'fund' : 'snapshot', options.producerHash);
      }
      return readAt(id,await head(), !!nativeReader && !!currentNativePoolSession(signer)?.closedPayouts);
    };
    const prepareSnapshot = async ({positionId:id,confirm}:{positionId:bigint;
      confirm:(review:{positionId:bigint;closed:boolean;gasCap:bigint})=>Promise<boolean>}) => {
      if (isPrepared) {
        if (typeof confirm !== 'function') throw new Error('Snapshot confirmation is required.');
        const block = await head(), { reader, pair } = await preparedFor(id, block);
        const pub = await publicState(id, block, true), closed = pub.status === 4n;
        requireCurrentPoolProof([1n, 2n, 4n].includes(pub.status), 'Prepared Pool snapshot status is unsupported.');
        const before = await reader.state(id, block), wallets = await reader.wallets(block);
        const managed = preparedCloses.get(signer)?.get(id);
        const replacementFrom = managed?.transactionHash ?? preparedProducers.get(id)?.transactionHash;
        if (managed) requireCurrentPoolProof(same(managed.owner, ownerAddress) && closed === (managed.expected.action === 'close') &&
          identical(financial(before), financial(managed.state)) && identical(wallets, managed.wallets) &&
          identical(await reader.canonical(managed.transactionHash), managed.proof),
        'Prepared close verification dependencies changed.');
        requireCurrentPoolProof(wallets.length === candidate.tokens.length && wallets.every((wallet, i) => same(wallet.token, candidate.tokens[i][0])),
          'Prepared snapshot needs all four canonical wallets.');
        const data = abi.encodeFunctionData('poolSnapshot', [id]);
        const assertBeforeSend = async () => {
          const current = await head(), resolved = await preparedFor(id, current);
          requireCurrentPoolProof(resolved.pair.marketId === pair.marketId &&
            identical(financial(await reader.state(id, current)), financial(before)) && identical(await reader.wallets(current), wallets),
          'Prepared snapshot dependencies changed before signing.');
          if (managed) requireCurrentPoolProof(identical(await reader.canonical(managed.transactionHash), managed.proof),
            'Prepared close receipt changed before snapshot signing.');
        };
        if (!await confirm({ positionId: id, closed, gasCap: 30_000_000n })) { await guard(); return null; }
        await assertBeforeSend();
        const readResult = async (hash: string) => {
          const producer = await reader.issue(id, 'snapshot', hash, data);
          requireCurrentPoolProof(producer.block.number >= before.block.number, 'Prepared snapshot predates review.');
          const proof = await reader.canonical(hash);
          requireCurrentPoolProof(!!proof && proof.data.toLowerCase() === data.toLowerCase() && proof.block.number >= before.block.number, 'Prepared snapshot call changed.');
          const after = await reader.state(id, producer.block);
          checkPreparedPoolSnapshotOnlyChange(before, after);
          const afterWallets = await reader.wallets(producer.block);
          requireCurrentPoolProof(identical(afterWallets, wallets), 'Prepared snapshot changed wallet balances/allowances.');
          if (managed) {
            requireCurrentPoolProof(identical(await reader.canonical(managed.transactionHash), managed.proof),
              'Prepared close canonical receipt changed.');
            const [closeReceipt, snapshotReceipt] = await Promise.all([
              readProvider.getTransactionReceipt(managed.transactionHash), readProvider.getTransactionReceipt(hash)]);
            await guard();
            requireCurrentPoolProof(!!closeReceipt && !!snapshotReceipt &&
              same(closeReceipt.hash, managed.transactionHash) && same(snapshotReceipt.hash, hash) &&
              same(closeReceipt.blockHash, managed.proof.block.hash) && same(snapshotReceipt.blockHash, proof!.block.hash) &&
              (proof!.block.number > managed.proof.block.number ||
                proof!.block.number === managed.proof.block.number &&
                Number.isSafeInteger(closeReceipt.index) && Number.isSafeInteger(snapshotReceipt.index) &&
                closeReceipt.index >= 0 && snapshotReceipt.index > closeReceipt.index),
            'Prepared close snapshot must follow its confirmed management transaction.');
            checkPreparedPoolManagementSnapshot({ candidate, expected: managed.expected, managed: managed.state, snapshot: after,
              observedAmounts: producer.amounts, managedWallets: managed.wallets, snapshotWallets: afterWallets });
          }
          await reader.current(producer, producer.block);
          requireCurrentPoolProof(identical(await reader.canonical(hash), proof), 'Prepared snapshot canonical receipt changed.');
          const snapshot = await readPreparedAt(id, producer.block, producer);
          requireCurrentPoolProof(identical(await reader.canonical(hash), proof), 'Prepared snapshot canonical receipt changed after position reads.');
          if (managed) requireCurrentPoolProof(identical(await reader.canonical(managed.transactionHash), managed.proof),
            'Prepared close canonical receipt changed after snapshot reads.');
          preparedProducers.set(id, producer);
          if (managed) preparedCloses.get(signer)?.delete(id);
          return Object.freeze({ action: 'snapshot' as const, positionId: id, transactionHash: hash, producerHash: hash, producer, snapshot,
            status: closed ? managed ? 'closed-proof-verified' as const : 'closed-snapshot-verified' as const : 'active-snapshot-verified' as const,
            privateAccountingVerified: !!managed, readyToSign: false as const });
        };
        const prepared = Object.freeze({ chainId, from: ownerAddress, to: candidate.core, value: 0n, data, graph: candidate.graph,
          packageSha256: candidate.packageSha256, positionId: id, marketId: pair.marketId, poolTokens: pair.tokens,
          action: 'snapshot' as const, closed, replacementFrom, recipient: null, assertCurrent: guard,
          assertBeforeSend, readResult, readyToSign: false as const });
        preparedSessions.set(prepared, signer); return prepared;
      }
      if (!nativeReader || typeof confirm !== 'function') throw new Error('Signed snapshot requires the current native Pool profile.');
      const session = requireCurrentNativePoolSession(signer,ownerAddress,candidate);
      requireCurrentPoolProof(session.positionId === id && !session.unfundedFailed,'Only the admitted new native Pool claim may Refresh.');
      const block = await head(), closed = !!session.closedPayouts;
      const replacementFrom=!closed&&session.producer?.kind==='snapshot'?
        await nativeReader.proveSharedStale(session.producer,block):undefined;
      const pub = await publicState(id,block,closed);
      requireCurrentPoolProof(pub.status === (closed ? 4n : 1n),'Native Pool Refresh status changed.');
      const before = await nativeReader.state(id,block), wallets = await nativeReader.wallets(block);
      if (!await confirm({positionId:id,closed,gasCap:30_000_000n})) {await guard();return null;}
      const data = currentNativePoolSnapshotAbi.encodeFunctionData('poolSnapshot',[id]);
      const assertBeforeSend = async () => { await guard(); const current = await head();
        if(replacementFrom)requireCurrentPoolProof(await nativeReader.proveSharedStale(session.producer!,current)===replacementFrom,
          'Native Pool replacement producer changed before signing.');
        requireCurrentPoolProof(JSON.stringify(await nativeReader.state(id,current),(_,v)=>typeof v==='bigint'?v.toString():v) ===
          JSON.stringify(before,(_,v)=>typeof v==='bigint'?v.toString():v),'Native Pool Refresh state changed during review.');
      };
      const readResult = async (hash:string) => {
        const producer = await nativeReader.issue(id,'snapshot',hash);
        const after = await nativeReader.state(id,producer.block); checkCurrentPoolSnapshotOnlyChange(before,after,closed);
        const observedWallets = await nativeReader.wallets(producer.block);
        requireCurrentPoolProof(observedWallets.every((v,i)=>v.balance===wallets[i].balance&&v.allowance===wallets[i].allowance), 'Native Pool Refresh changed token balances/allowances.');
        if (closed) requireCurrentPoolProof(producer.amounts.shares===0n&&producer.amounts.amount0===session.closedPayouts![0]&&
          producer.amounts.amount1===session.closedPayouts![1], 'Fresh CLOSED producer differs from exact approved payouts/zero shares.');
        else requireCurrentPoolProof(producer.amounts.shares===session.funded!.amounts.mintedShares,'Native Pool Refresh changed owned shares.');
        session.producer = producer;
        const snapshot = await readAt(id,producer.block,closed);
        return Object.freeze({action:'snapshot' as const,positionId:id,transactionHash:hash,producerHash:hash,producer,snapshot,
          status:closed?'closed-proof-verified' as const:'active-snapshot-verified' as const,readyToSign:false as const});
      };
      const prepared=Object.freeze({chainId,from:ownerAddress,to:candidate.core,value:0n,data,graph:candidate.graph,packageSha256:candidate.packageSha256,
        marketId:undefined,poolTokens:undefined,
        positionId:id,action:'snapshot' as const,closed,replacementFrom,recipient:null,assertCurrent:guard,assertBeforeSend,readResult,readyToSign:false as const});
      preparedSessions.set(prepared,signer); return prepared;
    };
    const requireEoaRecipient = async (recipient:string, block:{hash:string}) => {
      await guard();
      const code=await readProvider.send('eth_getCode',[recipient,{blockHash:block.hash,requireCanonical:true}]);
      await guard();
      if(code!=='0x')throw new Error('Only EOA NFT recipients have current native admission. Contract or malformed recipient code is not admitted.');
    };
    const previewKey = (id: bigint) => `${candidate.graph}:${id}`;
    const previewContext = (data: string, state: PreparedPoolStoredState) => computePoolExitPreviewContext(data, {
      chainId, core: candidate.core, releaseId: preparedScope!.candidate.releaseId, marketId: state.marketId,
      owner: ownerAddress, marketWords: state.markets[state.marketId], anchors: state.anchors });
    const prepareExitPreview = async (request: { positionId: bigint; expectedContext: string; producerHash?: string;
      fraction: readonly [bigint, bigint]; confirm: (review: { snapshot: Awaited<ReturnType<typeof readPosition>>;
        fraction: readonly [bigint, bigint]; gasCap: bigint }) => Promise<boolean> }) => {
      requireCurrentPoolProof(exitCandidate, 'Pool exit preview needs the exact exit candidate.');
      const id = request.positionId, expected = request.expectedContext;
      requireCurrentPoolProof(request.fraction?.length === 2 && typeof request.confirm === 'function', 'Review a private exit fraction.');
      const fraction = Object.freeze([...request.fraction]) as readonly [bigint, bigint]; fraction.forEach(v => uint(v, 128, true));
      requireCurrentPoolProof(fraction[0] < fraction[1], 'Use Close for a full withdrawal.');
      const before = await readPosition(id, request.producerHash ? { producerHash: request.producerHash } : undefined);
      requireCurrentPoolProof(before.context === expected && before.status === 1n && !!before.amounts,
        'Exit preview needs a fresh authenticated owner claim.');
      const amounts = before.amounts!, { reader, pair } = await preparedFor(id, before.block);
      const state = await reader.state(id, before.block), wallets = await reader.wallets(before.block);
      requireCurrentPoolProof(wallets.length === candidate.tokens.length && wallets.every((wallet, i) => same(wallet.token, candidate.tokens[i][0])),
        'Exit preview needs all four canonical wallets.');
      const assertBeforeSend = async () => {
        const block = await head(); await readPreparedAt(id, block);
        requireCurrentPoolProof(identical(financial(await reader.state(id, block)), financial(state)) &&
          identical(await reader.wallets(block), wallets), 'Exit preview dependencies changed before signing.');
      };
      if (await request.confirm(Object.freeze({ snapshot: before, fraction, gasCap: currentPoolOwnerGasCap('withdraw') })) !== true) { await guard(); return null; }
      await assertBeforeSend();
      const encrypted = [];
      for (const value of fraction) { await guard(); encrypted.push(await encryptPrivateUint128Input(signer, value,
        candidate.core, abi.getFunction('managePoolPosition')!.selector)); await guard(); }
      const data = encodePoolExitPreview(id, expected, encrypted), context = previewContext(data, state);
      const readResult = async (hash: string) => {
        const proof = await reader.canonical(hash);
        requireCurrentPoolProof(!!proof && same(proof.data, data) && proof.block.number >= before.block.number,
          'Exit preview differs from its confirmed owner call.');
        const confirmed = proof!, event = decodePoolExitPreviewEvent(confirmed.logs, candidate.core, id);
        requireCurrentPoolProof(same(event.context, context), 'Exit preview reserve commitment changed.');
        const after = await reader.state(id, confirmed.block), afterWallets = await reader.wallets(confirmed.block);
        requireCurrentPoolProof(identical(financial(after), financial(state)) && identical(afterWallets, wallets),
          'Exit preview changed financial state or wallets.');
        await guard();
        const values = event.encrypted.map((value: { ciphertextHigh: bigint; ciphertextLow: bigint }) => decryptPrivateUint256Output(signer, value)); await guard();
        const preview = checkPoolExitPreviewValues(values, { ownedShares: amounts.shares, totalShares: amounts.totalShares,
          entitlements: [amounts.amount0, amounts.amount1], fraction });
        const snapshot = await readPreparedAt(id, confirmed.block);
        requireCurrentPoolProof(identical(await reader.canonical(hash), confirmed), 'Exit preview canonical receipt changed after private checks.');
        let retained = exitPreviews.get(signer); if (!retained) { retained = new Map(); exitPreviews.set(signer, retained); }
        retained.set(previewKey(id), Object.freeze({ graph: candidate.graph, owner: ownerAddress, transactionHash: hash,
          data, context, proof: confirmed, state: after, wallets: afterWallets, fraction, amounts: preview }));
        return Object.freeze({ action: 'withdraw' as const, exitPhase: 'preview' as const, positionId: id, transactionHash: hash,
          block: confirmed.block, snapshot, preview, payouts: null, status: 'exit-preview-verified' as const,
          privateAccountingVerified: false as const, readyToSign: false as const });
      };
      const prepared = Object.freeze({ chainId, from: ownerAddress, to: candidate.core, value: 0n, data, graph: candidate.graph,
        packageSha256: candidate.packageSha256, positionId: id, marketId: pair.marketId, poolTokens: pair.tokens,
        action: 'withdraw' as const, exitPhase: 'preview' as const, recipient: null, assertCurrent: guard, assertBeforeSend, readResult, readyToSign: false as const });
      preparedSessions.set(prepared, signer); return prepared;
    };
    return Object.freeze({readPosition, prepareSnapshot, prepareExitPreview,
      readOwnedPositions: async () => {
        if(candidateKey!=='cheap-exit'&&candidateKey!=='cheap-history')throw new Error('Position discovery requires a supported DEX deployment.');
        const block=await head(), inventory=await readCurrentDexOwnedPositionIds({candidate:candidateKey,owner:ownerAddress,block,
          rpc:(method,params)=>readProvider.send(method,[...params]),assertCurrent:guard});
        const positions:Readonly<{positionId:bigint;status:bigint;context:string}>[]=[];
        for(const positionId of inventory.positionIds){
          const state=(await call(abi,candidate.core,'poolPublicState',[positionId],block))[0];
          if(state.status===0n){
            if([state.sourceId,state.bucket0Id,state.bucket1Id,state.positionRevision,state.ownershipRevision,state.lifecycleRevision,state.termsRevision].some(value=>value!==0n))
              throw new Error('Unsupported owner position state.');
            continue;
          }
          const verified=await publicState(positionId,block);
          positions.push(Object.freeze({positionId,status:verified.status,context:verified.context}));
        }
        await guard();
        const canonical=await readProvider.send('eth_getBlockByNumber',[`0x${block.number.toString(16)}`,false]);await guard();
        if(!canonical||BigInt(canonical.number)!==block.number||!same(canonical.hash,block.hash))throw new Error('Position inventory chain head changed. Refresh positions.');
        await checkGraph(block);
        return Object.freeze({positions:Object.freeze(positions),block,complete:inventory.complete,readyToSign:false as const});
      }, prepareAction: async (request: {
      positionId:bigint;expectedContext:string;action:CurrentPoolOwnerAction;
      producerHash?:string;
      fraction?:readonly [bigint,bigint];minimums?:readonly [bigint,bigint];recipient?:string;
      confirm:(review: {snapshot:Awaited<ReturnType<typeof readPosition>>;action:CurrentPoolOwnerAction;recipient:string|null;
        fraction:readonly [bigint,bigint]|null;minimums:readonly [bigint,bigint]|null})=>Promise<boolean>;
    }) => {
      const action = request.action, id = request.positionId, expected = request.expectedContext;
      if (isPrepared && exitCandidate && (action === 'transfer' || action === 'activate' || action === 'resume')) {
        if (typeof request.confirm !== 'function' || request.minimums !== undefined || request.fraction !== undefined)
          throw new Error('Confirm the Pool ownership action without token inputs.');
        const recipient = action === 'transfer' ? getAddress(request.recipient ?? '') : null;
        if (recipient && (same(recipient, ownerAddress) || recipient === zeroAddress)) throw new Error('Enter another nonzero NFT recipient.');
        if (!recipient && request.recipient !== undefined) throw new Error('Only Transfer has a recipient.');
        const block = await head(), pub = await publicState(id, block), { reader, pair } = await preparedFor(id, block);
        requireCurrentPoolProof(pub.context === expected && (action === 'activate' ? pub.status === 3n :
          action === 'resume' ? pub.status === 2n : [1n, 2n, 3n].includes(pub.status)), 'Pool ownership context or action status changed.');
        const before = action === 'transfer' && pub.status !== 3n ? await readPosition(id, request.producerHash ? { producerHash: request.producerHash } : undefined) :
          Object.freeze({ positionId: id, owner: ownerAddress, core: candidate.core, nft, chainId, graph: candidate.graph,
            packageSha256: candidate.packageSha256, block, ...pub, amounts: null, producerKind: undefined,
            marketId: pair.marketId, poolTokens: pair.tokens, readyToSign: false as const });
        requireCurrentPoolProof(before.context === expected, 'Pool ownership review changed.');
        const state = await reader.state(id, before.block), wallets = await reader.wallets(before.block);
        const recipientBalance = recipient ? (await call(nftAbi, nft, 'balanceOf', [recipient], before.block))[0] as bigint : null;
        const approval = recipient ? (await call(nftAbi, nft, 'getApproved', [id], before.block))[0] as string : null;
        if (recipient) await requireEoaRecipient(recipient, before.block);
        const assertBeforeSend = async () => {
          const currentBlock = await head(), current = await publicState(id, currentBlock);
          requireCurrentPoolProof(current.context === expected && identical(current, pub) &&
            identical(financial(await reader.state(id, currentBlock)), financial(state)) &&
            identical(await reader.wallets(currentBlock), wallets), 'Pool ownership dependencies changed before signing.');
          if (recipient) {
            await requireEoaRecipient(recipient, currentBlock);
            requireCurrentPoolProof((await call(nftAbi, nft, 'balanceOf', [recipient], currentBlock))[0] === recipientBalance &&
              same((await call(nftAbi, nft, 'getApproved', [id], currentBlock))[0], approval!), 'Recipient NFT balance or approval changed.');
          }
        };
        if (await request.confirm(Object.freeze({ snapshot: before, action, recipient, fraction: null, minimums: null })) !== true) { await guard(); return null; }
        await assertBeforeSend();
        const data = recipient ? nftAbi.encodeFunctionData('safeTransferFrom', [ownerAddress, recipient, id]) :
          abi.encodeFunctionData('managePoolPosition', [id, expected, currentPoolActionId(action as 'activate' | 'resume'), '0x']);
        const canonicalTransfer = async (hash: string) => {
          await guard(); const [tx, receipt] = await Promise.all([readProvider.getTransaction(hash), readProvider.getTransactionReceipt(hash)]); await guard();
          requireCurrentPoolProof(!!tx && !!receipt && same(tx.hash, hash) && same(receipt.hash, hash) && tx.chainId === chainId &&
            same(tx.from, ownerAddress) && same(tx.to, nft) && tx.value === 0n && receipt.status === 1 && same(tx.data, data), 'Pool transfer envelope changed.');
          await verifyCurrentDexCanonicalInclusion({ rpc: (method, params) => readProvider.send(method, params), assertCurrent: guard }, tx!, receipt!);
          return Object.freeze({ block: Object.freeze({ number: BigInt(receipt!.blockNumber), hash: receipt!.blockHash.toLowerCase() }), data: tx!.data,
            logs: Object.freeze(receipt!.logs.map(log => Object.freeze({ address: log.address, topics: Object.freeze([...log.topics]), data: log.data }))) });
        };
        const readResult = async (hash: string) => {
          const proof = recipient ? await canonicalTransfer(hash) : await reader.canonical(hash);
          requireCurrentPoolProof(!!proof && same(proof.data, data) && proof.block.number >= before.block.number, 'Pool ownership result call changed.');
          const confirmed = proof!; await checkGraph(confirmed.block);
          requireCurrentPoolProof(!confirmed.logs.some(log => candidate.tokens.some(([token]) => same(log.address, token)) &&
            same(log.topics[0] ?? null, transfer.getEvent('Transfer')!.topicHash)), 'Pool ownership action has token movement.');
          const after = await reader.state(id, confirmed.block), afterWallets = await reader.wallets(confirmed.block);
          checkPreparedPoolOwnershipTransition({ candidate, action, owner: ownerAddress, recipient: recipient ?? undefined,
            before: state, after, beforeWallets: wallets, afterWallets });
          if (recipient) {
            await requireEoaRecipient(recipient, confirmed.block);
            decodeCurrentPoolNftTransfer(confirmed.logs, nft, ownerAddress, recipient, id);
            requireCurrentPoolProof(same((await call(nftAbi, nft, 'ownerOf', [id], confirmed.block))[0], recipient) &&
              (await call(nftAbi, nft, 'balanceOf', [recipient], confirmed.block))[0] === recipientBalance! + 1n &&
              same((await call(nftAbi, nft, 'getApproved', [id], confirmed.block))[0], zeroAddress), 'Transferred NFT owner, recipient balance or approval changed.');
            requireCurrentPoolProof(identical(await canonicalTransfer(hash), confirmed), 'Pool transfer receipt changed after private checks.');
            preparedProducers.delete(id); exitPreviews.get(signer)?.delete(previewKey(id));
            return Object.freeze({ action: 'transfer' as const, positionId: id, recipient, transactionHash: hash, block: confirmed.block,
              status: 'owner-action-verified' as const, privateAccountingVerified: true as const, readyToSign: false as const });
          }
          const issued = await reader.issue(id, action as 'activate' | 'resume', hash, data), snapshot = await readPreparedAt(id, confirmed.block, issued);
          requireCurrentPoolProof(identical(await reader.canonical(hash), confirmed), 'Pool lifecycle receipt changed after private checks.');
          preparedProducers.set(id, issued); exitPreviews.get(signer)?.delete(previewKey(id));
          return Object.freeze({ action, positionId: id, transactionHash: hash, block: confirmed.block, snapshot, payouts: Object.freeze([] as bigint[]),
            status: 'owner-action-verified' as const, privateAccountingVerified: true as const, readyToSign: false as const });
        };
        const prepared = Object.freeze({ chainId, from: ownerAddress, to: recipient ? nft : candidate.core, value: 0n, data,
          graph: candidate.graph, packageSha256: candidate.packageSha256, positionId: id, marketId: pair.marketId, poolTokens: pair.tokens,
          action, recipient, assertCurrent: guard, assertBeforeSend, readResult, readyToSign: false as const });
        preparedSessions.set(prepared, signer); return prepared;
      }
      if (isPrepared) {
        const withdrawing = action === 'withdraw' && exitCandidate;
        const exit = withdrawing ? exitPreviews.get(signer)?.get(previewKey(id)) : undefined;
        if (action !== 'close' && (!withdrawing || !exit)) throw new Error('Prepared Pool action needs its exact management integration; partial withdrawal requires an authenticated exit preview.');
        if (withdrawing) requireCurrentPoolProof(!!exit && same(exit.owner, ownerAddress) && exit.graph === candidate.graph &&
          identical(exit.fraction, request.fraction), 'Withdrawal differs from the reviewed private exit fraction.');
        if (typeof request.confirm !== 'function' || request.minimums?.length !== 2) throw new Error('Enter both minimum payouts and confirm Close.');
        const minimums = Object.freeze([...request.minimums]) as readonly [bigint, bigint]; minimums.forEach(v => uint(v, 256));
        const before = await readPosition(id, request.producerHash ? { producerHash: request.producerHash } : undefined);
        requireCurrentPoolProof(before.context === expected && [1n, 2n].includes(before.status) && !!before.amounts,
          'Prepared close needs a fresh authenticated owner claim.');
        const amounts = before.amounts!;
        requireCurrentPoolProof(amounts.shares > 0n && minimums[0] <= amounts.amount0 && minimums[1] <= amounts.amount1,
          'Prepared close minimum exceeds the current owner entitlement.');
        const { reader, pair } = await preparedFor(id, before.block);
        const state = await reader.state(id, before.block), wallets = await reader.wallets(before.block);
        const checkExit = async () => {
          if (!exit) return;
          requireCurrentPoolProof(identical(financial(state), financial(exit.state)) && identical(wallets, exit.wallets) &&
            same(previewContext(exit.data, state), exit.context) && identical(await reader.canonical(exit.transactionHash), exit.proof) &&
            minimums[0] <= exit.amounts.amount0 && minimums[1] <= exit.amounts.amount1,
          'Authenticated exit preview or minimum payout changed.');
        };
        await checkExit();
        const assertBeforeSend = async () => {
          const block = await head();
          await readPreparedAt(id, block);
          requireCurrentPoolProof(identical(financial(await reader.state(id, block)), financial(state)) &&
            identical(await reader.wallets(block), wallets), 'Prepared close dependencies changed before signing.');
          await checkExit();
        };
        const review = Object.freeze({ snapshot: before, action, recipient: null, fraction: exit?.fraction ?? null, minimums });
        if (await request.confirm(review) !== true) { await guard(); return null; }
        await assertBeforeSend();
        const encrypted = [];
        for (const value of minimums) {
          await guard(); encrypted.push(await encryptPrivateUint256Input(signer, value, candidate.core, abi.getFunction('managePoolPosition')!.selector)); await guard();
        }
        const data = exit ? encodePreviewedPoolWithdrawal(exit.data, exit.context, encrypted) :
          abi.encodeFunctionData('managePoolPosition', [id, expected, 7n, encodeCurrentPoolExit(null, encrypted)]);
        const readResult = async (hash: string) => {
          const proof = await reader.canonical(hash);
          requireCurrentPoolProof(!!proof && proof.data.toLowerCase() === data.toLowerCase() && proof.block.number >= before.block.number,
            'Prepared close differs from its confirmed owner call.');
          const confirmed = proof!, payouts: bigint[] = [];
          for (const token of pair.tokens) {
            const logs = confirmed.logs.filter(log => same(log.address, token) &&
              log.topics[0]?.toLowerCase() === transfer.getEvent('Transfer')!.topicHash.toLowerCase());
            requireCurrentPoolProof(logs.length === 1, 'Prepared close needs exactly one payout per selected token.');
            const log = logs[0], parsed = transfer.parseLog({ topics: [...log.topics], data: log.data })!;
            const encoded = transfer.encodeEventLog(parsed.fragment, parsed.args);
            requireCurrentPoolProof(same(encoded.data, log.data) && identical(encoded.topics.map(v => v.toLowerCase()), log.topics.map(v => v.toLowerCase())) &&
              same(parsed.args.from, candidate.core) && same(parsed.args.to, ownerAddress), 'Prepared close payout event changed.');
            payouts.push(decryptPrivateUint256Output(signer, parsed.args.receiverValue)); await guard();
          }
          if (!exit) decodeCurrentPoolNftTransfer(confirmed.logs, nft, ownerAddress, zeroAddress, id);
          await checkExit();
          const managed = await reader.state(id, confirmed.block), managedWallets = await reader.wallets(confirmed.block);
          const result = checkPreparedPoolManagementTransition({ candidate, owner: ownerAddress,
            request: exit ? { action: 'withdraw-previewed', fraction: exit.fraction, minimums, preview: exit.amounts } :
              { action: 'close', minimums }, receiptStatus: 1, before: state, managed, beforeAmounts: amounts,
            beforeWallets: wallets, managedWallets, tokenFlows: payouts });
          requireCurrentPoolProof(result.status === 'manage-verified-snapshot-required', 'Prepared close result status changed.');
          const pub = await publicState(id, confirmed.block, true);
          requireCurrentPoolProof(pub.status === (exit ? before.status : 4n) && pub.context.toLowerCase() === managed.claim[13] &&
            [pub.positionRevision, pub.ownershipRevision, pub.lifecycleRevision].every((v, i) => v === BigInt(managed.claim[4 + i])),
          'Prepared close public state differs from stored revisions.');
          requireCurrentPoolProof(identical(await reader.canonical(hash), confirmed), 'Prepared close canonical receipt changed after private checks.');
          if (exit) {
            requireCurrentPoolProof(identical(await reader.canonical(exit.transactionHash), exit.proof), 'Exit preview receipt changed after withdrawal checks.');
            const [previewReceipt, withdrawalReceipt] = await Promise.all([
              readProvider.getTransactionReceipt(exit.transactionHash), readProvider.getTransactionReceipt(hash)]); await guard();
            requireCurrentPoolProof(!!previewReceipt && !!withdrawalReceipt && same(previewReceipt.hash, exit.transactionHash) &&
              same(withdrawalReceipt.hash, hash) && same(previewReceipt.blockHash, exit.proof.block.hash) &&
              same(withdrawalReceipt.blockHash, confirmed.block.hash) && (confirmed.block.number > exit.proof.block.number ||
                confirmed.block.number === exit.proof.block.number && Number.isSafeInteger(previewReceipt.index) &&
                Number.isSafeInteger(withdrawalReceipt.index) && previewReceipt.index >= 0 && withdrawalReceipt.index > previewReceipt.index),
            'Withdrawal must follow its authenticated exit preview.');
          }
          let retained = preparedCloses.get(signer); if (!retained) { retained = new Map(); preparedCloses.set(signer, retained); }
          retained.set(id, Object.freeze({ owner: ownerAddress, transactionHash: hash, proof: confirmed, state: managed, wallets: managedWallets,
            expected: result as PreparedPoolManagementExpectation }));
          preparedProducers.delete(id);
          exitPreviews.get(signer)?.delete(previewKey(id));
          return Object.freeze({ action: exit ? 'withdraw' as const : 'close' as const, positionId: id, transactionHash: hash, block: confirmed.block,
            payouts: Object.freeze(payouts), snapshot: Object.freeze({ ...before, ...pub, block: confirmed.block, amounts: null }),
            status: exit ? 'remaining-proof-required' as const : 'closed-proof-required' as const, privateAccountingVerified: false as const, readyToSign: false as const });
        };
        const prepared = Object.freeze({ chainId, from: ownerAddress, to: candidate.core, value: 0n, data,
          graph: candidate.graph, packageSha256: candidate.packageSha256, positionId: id, marketId: pair.marketId, poolTokens: pair.tokens,
          action: exit ? 'withdraw' as const : 'close' as const, exitPhase: exit ? 'withdrawal' as const : undefined,
          recipient: null, assertCurrent: guard, assertBeforeSend, readResult, readyToSign: false as const });
        preparedSessions.set(prepared, signer); return prepared;
      }
      if (nativeReader) {
        const session = requireCurrentNativePoolSession(signer,ownerAddress,candidate);
        requireCurrentPoolProof(action==='close'&&session.positionId===id&&session.producer?.kind==='snapshot'&&
          session.producer.status===1n&&!session.closedPayouts,'Only direct full close of the admitted fresh new claim is available.');
      }
      if (!['withdraw','close','activate','resume','transfer'].includes(action) || typeof request.confirm !== 'function') throw new Error('Invalid position action or confirmation.');
      const fraction = action === 'withdraw' ? Object.freeze([...(request.fraction ?? [])]) : null;
      const minimums = action === 'withdraw' || action === 'close' ? Object.freeze([...(request.minimums ?? [])]) : null;
      if (fraction && (fraction.length !== 2 || fraction.some(v => {uint(v,128,true);return false;}) || fraction[0] >= fraction[1])) throw new Error('Use Close for a full withdrawal; partial withdrawal must be greater than 0% and less than 100%.');
      if (minimums && minimums.length !== 2) throw new Error('Enter both minimum token payouts.');
      minimums?.forEach(v=>uint(v,256));
      const recipient = action === 'transfer' ? getAddress(request.recipient ?? '') : null;
      if (recipient && (recipient === zeroAddress || same(recipient,ownerAddress))) throw new Error('Enter another nonzero NFT recipient.');
      const before = await readPosition(id);
      if(nativeReader)requireCurrentPoolProof(!!before.amounts&&minimums?.[0]===before.amounts.amount0&&minimums?.[1]===before.amounts.amount1,
        'Native full close minimums must equal both fresh owner snapshot entitlements.');
      const beforeWallets = nativeReader && await nativeReader.wallets(before.block);
      const beforeState = nativeReader && await nativeReader.state(id,before.block);
      if(recipient)await requireEoaRecipient(recipient,before.block);
      if (before.context !== expected || before.status === 4n || (action === 'withdraw' && before.status !== 1n) ||
          (action === 'activate' && before.status !== 3n) || (action === 'resume' && before.status !== 2n)) throw new Error('Position context or action status changed. Refresh this position.');
      const review = Object.freeze({snapshot:before,action,recipient,fraction:fraction as readonly [bigint,bigint]|null,minimums:minimums as readonly [bigint,bigint]|null});
      if (await request.confirm(review) !== true) {await guard();return null;}
      await guard();
      const reviewed=await readPosition(id);
      if (reviewed.context !== expected) throw new Error('Position changed during review.');
      if(recipient)await requireEoaRecipient(recipient,reviewed.block);
      let data:string;
      if (recipient) data = nftAbi.encodeFunctionData('safeTransferFrom',[ownerAddress,recipient,id]);
      else {
        const selector = abi.getFunction('managePoolPosition')!.selector;
        const encryptedMinimums = [];
        for (const value of minimums ?? []) { await guard();encryptedMinimums.push(await encryptPrivateUint256Input(signer,value,candidate.core,selector));await guard(); }
        const encryptedFraction = [];
        for (const value of fraction ?? []) { await guard();encryptedFraction.push(await encryptPrivateUint128Input(signer,value,candidate.core,selector));await guard(); }
        data = abi.encodeFunctionData('managePoolPosition',[id,expected,currentPoolActionId(action as Exclude<CurrentPoolOwnerAction,'transfer'>),
          minimums ? encodeCurrentPoolExit(fraction ? encryptedFraction : null,encryptedMinimums) : '0x']);
      }
      const assertBeforeSend = async () => {await guard();const current=await readPosition(id);
        if (current.context !== expected) throw new Error('Position authority or context changed before signing.');
        if(recipient)await requireEoaRecipient(recipient,current.block);};
      const readResult = async (hash:string) => {
        await guard();
        const [tx,receipt] = await Promise.all([readProvider.getTransaction(hash),readProvider.getTransactionReceipt(hash)]);
        await guard(); if (!tx || !receipt) return null;
        if (!same(tx.hash,hash) || !same(receipt.hash,hash) || tx.chainId !== chainId || !same(tx.from,ownerAddress) || !same(receipt.from,ownerAddress) ||
            !same(tx.to,recipient ? nft : candidate.core) || !same(receipt.to,tx.to!) || tx.value !== 0n || tx.data !== data || receipt.status !== 1 ||
            tx.blockNumber !== receipt.blockNumber || !same(tx.blockHash,receipt.blockHash) || BigInt(receipt.blockNumber) < before.block.number) throw new Error('Position result differs from its confirmed transaction.');
        const block = Object.freeze({number:BigInt(receipt.blockNumber),hash:receipt.blockHash});await checkGraph(block);
        if (recipient) {
          await requireEoaRecipient(recipient,block);
          decodeCurrentPoolNftTransfer(receipt.logs,nft,ownerAddress,recipient,id);
          const observedOwner = (await call(nftAbi,nft,'ownerOf',[id],block))[0];
          const state = (await call(abi,candidate.core,'poolPublicState',[id],block))[0];
          if (!same(observedOwner,recipient) || state.status !== 3n || state.ownershipRevision !== before.ownershipRevision+1n ||
              state.positionRevision !== before.positionRevision+1n || state.lifecycleRevision !== before.lifecycleRevision+1n) throw new Error('NFT transfer did not advance the private claim authority.');
          return Object.freeze({action,positionId:id,recipient,transactionHash:hash,block,readyToSign:false as const});
        }
        const nativeClose = !!nativeReader && action==='close';
        const after = nativeClose ? Object.freeze({...before,...await publicState(id,block,true),block,amounts:null}) : await readAt(id,block,action === 'close');
        if (after.positionRevision !== before.positionRevision+1n || after.ownershipRevision !== before.ownershipRevision ||
            after.lifecycleRevision !== before.lifecycleRevision + (action === 'withdraw' ? 0n : 1n) ||
            after.status !== (action === 'close' ? 4n : action === 'activate' ? 2n : 1n)) throw new Error('Position result has incorrect status or revision.');
        const payouts:bigint[]=[];
        if (minimums) {
          for (const [address] of poolTokens) {
            const logs=receipt.logs.filter(log=>same(log.address,address) && log.topics[0]===transfer.getEvent('Transfer')!.topicHash);
            const credits=logs.map(log=>{const parsed=transfer.parseLog({topics:[...log.topics],data:log.data})!;
              const encoded=transfer.encodeEventLog(parsed.fragment,parsed.args);
              if (!same(encoded.data,log.data) || encoded.topics.length!==log.topics.length || encoded.topics.some((topic,i)=>!same(topic,log.topics[i]))) throw new Error('Non-canonical private payout.');
              return parsed.args;}).filter(a=>same(a.from,candidate.core)&&same(a.to,ownerAddress));
            if (credits.length!==1) throw new Error('Position payout event is missing or duplicated.');
            payouts.push(decryptPrivateUint256Output(signer,credits[0].receiverValue));await guard();
          }
          if (payouts.some((v,i)=>v<minimums[i])) throw new Error('Position payout is below its confirmed minimum.');
          if (action === 'close') {
            decodeCurrentPoolNftTransfer(receipt.logs,nft,ownerAddress,zeroAddress,id);
            if (nativeClose) {
              const session=requireCurrentNativePoolSession(signer,ownerAddress,candidate), current=await nativeReader!.state(id,block), wallets=await nativeReader!.wallets(block);
              checkCurrentPoolFinancialTransition(beforeState!,current,'close');
              requireCurrentPoolProof(!!before.amounts&&payouts[0]===before.amounts.amount0&&payouts[1]===before.amounts.amount1&&
                wallets.every((v,i)=>v.allowance===0n&&v.balance===beforeWallets![i].balance+payouts[i])&&
                current.counter===beforeState!.counter&&current.operation===beforeState!.operation&&current.market[40]===beforeState!.market[40]&&
                current.protectedClaim.every((v,i)=>v===beforeState!.protectedClaim[i]),'Native Pool close payout/accounting/protected claim differs.');
              session.closedPayouts=Object.freeze([payouts[0],payouts[1]]);
            } else if (!after.amounts || after.amounts.shares!==0n || after.amounts.amount0!==payouts[0] || after.amounts.amount1!==payouts[1]) throw new Error('Closed claim differs from private payouts.');
          } else if (!before.amounts || !after.amounts || after.amounts.shares!==before.amounts.shares-before.amounts.shares*fraction![0]/fraction![1]) throw new Error('Withdrawal shares differ from the confirmed fraction.');
        }
        await guard();return Object.freeze({action,positionId:id,transactionHash:hash,block,payouts:Object.freeze(payouts),snapshot:after,
          status:nativeClose?'closed-proof-required' as const:'owner-action-verified' as const,readyToSign:false as const});
      };
      const prepared=Object.freeze({chainId,from:ownerAddress,to:recipient?nft:candidate.core,value:0n,data,
        graph:candidate.graph,packageSha256:candidate.packageSha256,positionId:id,action,recipient,
        assertCurrent:guard,assertBeforeSend,readResult,readyToSign:false as const});preparedSessions.set(prepared,signer);return prepared;
    }});
  }
});
export type CurrentPoolPreparedPositionAction = NonNullable<Awaited<ReturnType<Awaited<ReturnType<typeof issueCurrentDexPoolPositionCapability>>['prepareAction']>>>;
export type CurrentPoolPreparedSnapshot = NonNullable<Awaited<ReturnType<Awaited<ReturnType<typeof issueCurrentDexPoolPositionCapability>>['prepareSnapshot']>>>;
export type CurrentPoolPreparedExitPreview = NonNullable<Awaited<ReturnType<Awaited<ReturnType<typeof issueCurrentDexPoolPositionCapability>>['prepareExitPreview']>>>;

