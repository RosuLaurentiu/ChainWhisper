import { AbiCoder, Interface, keccak256 } from '@coti-io/coti-ethers';
import type { JsonRpcSigner } from '@coti-io/coti-ethers';
import type { CotiReadProvider } from './appShared';
import type { CurrentCheapDexCandidate } from './dexV2Deployment';
import { currentPoolPositionAbi, currentPoolNftAbi } from './currentDexPoolPosition';
import { currentTokenFundingAbi } from './currentDexTokenFunding';
import { decryptPrivateUint256Output } from './privateUint256';
import { createCurrentNativePoolSnapshotReader, requireCurrentPoolProof, type CurrentPoolBlock } from './currentDexNativePoolSnapshot';
import { verifyCurrentDexCanonicalInclusion } from './currentDexCanonicalInclusion';

// The wallet issuers supply the exact leased signer and their graph attestation.
// This binds real provider reads; no caller ready flag or private CLI packet.
export const createCurrentOwnerPoolSnapshotReader = ({ signer, owner, candidate, guard, provider, attest }: {
  signer: JsonRpcSigner; owner: string; candidate: CurrentCheapDexCandidate; guard: () => Promise<void>;
  provider: CotiReadProvider; attest: (block: CurrentPoolBlock) => Promise<void>;
}) => {
  const rpc = async (method: string, params: unknown[]) => { await guard(); const value = await provider.send(method, params); await guard(); return value; };
  const nft = candidate.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1];
  const call = async (abi: Interface, to: string, name: string, values: unknown[], block: CurrentPoolBlock) => {
    const raw = await rpc('eth_call', [{ from: owner, to, data: abi.encodeFunctionData(name, values) }, { blockHash: block.hash, requireCanonical: true }]);
    const value = abi.decodeFunctionResult(name, raw);
    requireCurrentPoolProof(abi.encodeFunctionResult(name, value).toLowerCase() === String(raw).toLowerCase(), 'Native Pool response is non-canonical.');
    return value;
  };
  const canonical = async (hash: string) => {
    requireCurrentPoolProof(/^0x[0-9a-fA-F]{64}$/.test(hash) && BigInt(hash) !== 0n, 'Native Pool producer hash is invalid.');
    await guard(); const [tx, receipt] = await Promise.all([provider.getTransaction(hash), provider.getTransactionReceipt(hash)]); await guard();
    if (!tx || !receipt) return null;
    requireCurrentPoolProof(tx.hash.toLowerCase() === hash.toLowerCase() && receipt.hash.toLowerCase() === hash.toLowerCase() &&
      tx.chainId === BigInt(candidate.chainId) && tx.from.toLowerCase() === owner.toLowerCase() &&
      tx.to?.toLowerCase() === candidate.core.toLowerCase() && tx.value === 0n && receipt.status === 1 &&
      (tx.gasLimit === 30_000_000n || tx.gasLimit === 100_000_000n) && tx.gasPrice === 50_000_000n,
    'Native Pool producer canonical envelope changed.');
    await verifyCurrentDexCanonicalInclusion({ rpc, assertCurrent: guard }, tx, receipt);
    return Object.freeze({ block: Object.freeze({ number: BigInt(receipt.blockNumber), hash: receipt.blockHash }),
      data: tx.data, logs: Object.freeze(receipt.logs.map(v => Object.freeze({ address: v.address,
        topics: Object.freeze([...v.topics]), data: v.data }))) });
  };
  const reader = createCurrentNativePoolSnapshotReader({ signer, owner, candidate, guard, rpc, attest, canonical,
    readPublic: async (id, block) => { const pub = (await call(currentPoolPositionAbi, candidate.core, 'poolPublicState', [id], block))[0];
      requireCurrentPoolProof(pub.sourceId === 0n && pub.bucket0Id === 0n && pub.bucket1Id === 0n && pub.termsRevision === 1n,
        'Native Pool public claim type changed.'); return { status: pub.status, context: pub.context }; },
    readOwner: async (id, block, closed) => {
      if (!closed) return (await call(currentPoolNftAbi, nft, 'ownerOf', [id], block))[0] as string;
      const ownerSlot=keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','uint256'],[id,2n]));
      const ownerWord=await rpc('eth_getStorageAt',[nft,ownerSlot,{blockHash:block.hash,requireCanonical:true}]);
      requireCurrentPoolProof(typeof ownerWord==='string'&&/^0x[0-9a-fA-F]{64}$/.test(ownerWord)&&BigInt(ownerWord)===0n,
        'Closed native Pool NFT is not absent in compiled ownership storage.');
      // The caller must first prove the close receipt/NFT burn. Stored closeOwner
      // binds access to the fresh CLOSED producer, never a cached envelope.
      const state = await reader.state(id, block); return `0x${state.claim[12].slice(-40)}`;
    }, decrypt: cipher => decryptPrivateUint256Output(signer, cipher) });
  const wallets = async (block: CurrentPoolBlock) => {
    const states = [];
    for (const [token] of [...candidate.tokens].sort(([a], [b]) => BigInt(a) < BigInt(b) ? -1 : 1)) {
      const balance = decryptPrivateUint256Output(signer, (await call(currentTokenFundingAbi, token, 'balanceOf', [owner], block))[0]);
      const allowance = decryptPrivateUint256Output(signer, (await call(currentTokenFundingAbi, token, 'allowance', [owner, candidate.core], block))[0].ownerCiphertext);
      states.push(Object.freeze({ token, balance, allowance })); await guard();
    }
    return Object.freeze(states);
  };
  return Object.freeze({ ...reader, wallets, canonical, callHash: (data: string) => keccak256(data) });
};
