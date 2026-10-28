import {
  Interface,
  getAddress,
  type Eip1193Provider
} from '@coti-io/coti-ethers';
import {
  assertAttestedDexV2Deployment,
  type AttestedDexV2Deployment
} from './dexV2Chain';
import {
  reconcileOwnedPositionIds,
  type PositionNftTransfer
} from './positionNftHistory';

const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const LOG_RANGE = 10_000n;

const POSITION_TOKEN = new Interface([
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
  'function balanceOf(address owner) view returns (uint256 balance)',
  'function ownerOf(uint256 tokenId) view returns (address owner)'
]);

const CORE = new Interface([
  'function nextPositionId() view returns (uint256)',
  'function getPosition(uint256 positionId) view returns ((uint8 kind,uint8 lifecycle,bytes32 pairKey,address privacyOwner,uint64 createdAt,uint64 ownerRevision,uint56 priorityId,uint8 hiddenSlot) position)'
]);

const transferFragment = POSITION_TOKEN.getEvent('Transfer');
if (!transferFragment) throw new Error('DEX V2 Position NFT Transfer ABI is unavailable.');
const TRANSFER_TOPIC = transferFragment.topicHash.toLowerCase();

type ReadProvider = Pick<Eip1193Provider, 'request'>;

export type DexV2PositionKind = 'pool' | 'limit' | 'recurring';
export type DexV2PositionLifecycle = 'active' | 'paused';

export type DexV2OwnedPosition = Readonly<{
  positionId: string;
  kind: DexV2PositionKind;
  lifecycle: DexV2PositionLifecycle;
  pairKey: string;
  privacyOwner: string | null;
  needsPrivacyActivation: boolean;
  createdAt: string;
  ownerRevision: string;
  priorityId: string;
  hiddenSlot: number;
}>;

export type DexV2PositionDiscovery = Readonly<{
  owner: string;
  blockNumber: string;
  blockHash: string;
  nftBalance: string;
  nextPositionId: string;
  positions: readonly DexV2OwnedPosition[];
}>;

type NormalizedTransfer = Readonly<{
  key: string;
  blockNumber: bigint;
  transactionIndex: bigint;
  logIndex: bigint;
  from: string;
  to: string;
  positionId: bigint;
}>;

export type DexV2PositionTransfer = PositionNftTransfer;

const quantity = (value: unknown, label: string, maximum = UINT256_MAX): bigint => {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new Error(`${label} must be a canonical JSON-RPC quantity.`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed;
};

const uint = (value: unknown, label: string, maximum = UINT256_MAX): bigint => {
  try {
    const parsed = BigInt(value as bigint | number | string);
    if (parsed < 0n || parsed > maximum) throw new Error('out of range');
    return parsed;
  } catch {
    throw new Error(`${label} is invalid.`);
  }
};

const bytes = (value: unknown, label: string, length?: number): string => {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`${label} must be canonical bytes.`);
  }
  const normalized = value.toLowerCase();
  if (length !== undefined && normalized.length !== 2 + length * 2) {
    throw new Error(`${label} has the wrong width.`);
  }
  return normalized;
};

const address = (value: unknown, label: string): string => {
  try {
    return getAddress(String(value)).toLowerCase();
  } catch {
    throw new Error(`${label} is invalid.`);
  }
};

const tupleField = (value: unknown, name: string, index: number, label: string): unknown => {
  if (!value || typeof value !== 'object') throw new Error(`${label} is malformed.`);
  const tuple = value as Record<string | number, unknown>;
  return tuple[name] ?? tuple[index];
};

const hexQuantity = (value: bigint): string => `0x${value.toString(16)}`;
const ownerTopic = (owner: string): string => `0x${owner.slice(2).padStart(64, '0')}`;
const blockSelector = (blockHash: string) => Object.freeze({ blockHash, requireCanonical: true });

const decodeTopicAddress = (value: unknown, label: string): string => {
  const topic = bytes(value, label, 32);
  if (topic.slice(2, 26) !== '0'.repeat(24)) throw new Error(`${label} is not an indexed address.`);
  return address(`0x${topic.slice(26)}`, label);
};

const parseTransfer = (
  value: unknown,
  positionToken: string,
  startBlock: bigint,
  endBlock: bigint
): NormalizedTransfer => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('DEX V2 Position NFT log is malformed.');
  }
  const log = value as Record<string, unknown>;
  if (log.removed === true) throw new Error('DEX V2 Position NFT history contains a removed log.');
  if (address(log.address, 'DEX V2 Position NFT log address') !== positionToken) {
    throw new Error('DEX V2 Position NFT history returned another contract.');
  }
  if (!Array.isArray(log.topics) || log.topics.length !== 4) {
    throw new Error('DEX V2 Position NFT Transfer topics are malformed.');
  }
  const topics = log.topics.map((topic, index) => bytes(topic, `DEX V2 Transfer topic ${index}`, 32));
  if (topics[0] !== TRANSFER_TOPIC || bytes(log.data, 'DEX V2 Transfer data') !== '0x') {
    throw new Error('DEX V2 Position NFT history contains a non-Transfer log.');
  }
  const blockNumber = quantity(log.blockNumber, 'DEX V2 Transfer block number', UINT64_MAX);
  if (blockNumber < startBlock || blockNumber > endBlock) {
    throw new Error('DEX V2 Position NFT log is outside the requested range.');
  }
  const transactionIndex = quantity(log.transactionIndex, 'DEX V2 Transfer transaction index', UINT64_MAX);
  const logIndex = quantity(log.logIndex, 'DEX V2 Transfer log index', UINT64_MAX);
  const blockHash = bytes(log.blockHash, 'DEX V2 Transfer block hash', 32);
  const transactionHash = bytes(log.transactionHash, 'DEX V2 Transfer transaction hash', 32);
  const positionId = BigInt(topics[3]);
  if (positionId === 0n) throw new Error('DEX V2 Position NFT ID cannot be zero.');
  return Object.freeze({
    key: `${blockHash}:${transactionHash}:${logIndex.toString()}`,
    blockNumber,
    transactionIndex,
    logIndex,
    from: decodeTopicAddress(topics[1], 'DEX V2 Transfer sender'),
    to: decodeTopicAddress(topics[2], 'DEX V2 Transfer recipient'),
    positionId
  });
};

const assertSameTransfer = (left: NormalizedTransfer, right: NormalizedTransfer): void => {
  if (
    left.blockNumber !== right.blockNumber ||
    left.transactionIndex !== right.transactionIndex ||
    left.logIndex !== right.logIndex ||
    left.from !== right.from ||
    left.to !== right.to ||
    left.positionId !== right.positionId
  ) {
    throw new Error('DEX V2 Position NFT history returned conflicting duplicate logs.');
  }
};

const kindName = (value: bigint): DexV2PositionKind => {
  if (value === 1n) return 'pool';
  if (value === 2n) return 'limit';
  if (value === 3n) return 'recurring';
  throw new Error('DEX V2 owned NFT points to an invalid position kind.');
};

const lifecycleName = (value: bigint): DexV2PositionLifecycle => {
  if (value === 1n) return 'active';
  if (value === 2n) return 'paused';
  throw new Error('DEX V2 owned NFT points to a closed or invalid position.');
};

export const reconcileDexV2OwnedPositionIds = reconcileOwnedPositionIds;

export const discoverDexV2OwnedPositions = async ({
  deployment,
  owner,
  provider,
  assertCurrent = () => undefined
}: {
  deployment: AttestedDexV2Deployment;
  owner: string;
  provider: ReadProvider;
  assertCurrent?: () => void | Promise<void>;
}): Promise<DexV2PositionDiscovery> => {
  const verified = assertAttestedDexV2Deployment(deployment);
  if (!provider || typeof provider.request !== 'function') {
    throw new Error('DEX V2 position discovery requires the connected wallet provider.');
  }
  const normalizedOwner = address(owner, 'DEX V2 position owner');
  if (normalizedOwner === ZERO_ADDRESS) throw new Error('DEX V2 position owner cannot be zero.');
  const positionToken = address(verified.manifest.addresses.positionToken, 'DEX V2 Position NFT');
  const core = address(verified.manifest.addresses.core, 'DEX V2 Core');
  const startBlock = BigInt(verified.manifest.deploymentAnchors.economicSuite.number);
  const endBlock = BigInt(verified.attestationBlock.number);
  if (startBlock > endBlock) throw new Error('DEX V2 position discovery block range is invalid.');
  const expectedBlockHash = bytes(verified.attestationBlock.hash, 'DEX V2 position discovery block hash', 32);

  const rpc = async (method: string, params: readonly unknown[] = []): Promise<unknown> => {
    await assertCurrent();
    return provider.request({ method, params: [...params] });
  };
  const ethCall = async (
    contractAddress: string,
    abi: Interface,
    functionName: string,
    args: readonly unknown[]
  ): Promise<readonly unknown[]> => {
    const result = bytes(await rpc('eth_call', [
      { to: contractAddress, data: abi.encodeFunctionData(functionName, [...args]) },
      blockSelector(expectedBlockHash)
    ]), `DEX V2 ${functionName} result`);
    return abi.decodeFunctionResult(functionName, result) as unknown as readonly unknown[];
  };
  const scalar = async (
    contractAddress: string,
    abi: Interface,
    functionName: string,
    args: readonly unknown[] = []
  ): Promise<unknown> => (await ethCall(contractAddress, abi, functionName, args))[0];

  const chainId = quantity(await rpc('eth_chainId'), 'DEX V2 position discovery chain ID');
  if (chainId !== BigInt(verified.manifest.chainId)) {
    throw new Error('DEX V2 wallet changed networks during position discovery.');
  }
  const endBlockRecord = await rpc('eth_getBlockByNumber', [hexQuantity(endBlock), false]);
  if (!endBlockRecord || typeof endBlockRecord !== 'object' || Array.isArray(endBlockRecord)) {
    throw new Error('DEX V2 position discovery block is unavailable.');
  }
  const block = endBlockRecord as Record<string, unknown>;
  if (
    quantity(block.number, 'DEX V2 position discovery returned block number', UINT64_MAX) !== endBlock ||
    bytes(block.hash, 'DEX V2 position discovery returned block hash', 32) !== expectedBlockHash
  ) {
    throw new Error('DEX V2 position discovery block is no longer canonical.');
  }

  const nextPositionId = uint(await scalar(core, CORE, 'nextPositionId'), 'DEX V2 next position ID');
  if (nextPositionId === 0n) throw new Error('DEX V2 next position ID is invalid.');
  const nftBalance = uint(
    await scalar(positionToken, POSITION_TOKEN, 'balanceOf', [normalizedOwner]),
    'DEX V2 Position NFT balance'
  );
  if (nftBalance >= nextPositionId) throw new Error('DEX V2 Position NFT balance exceeds the issued position range.');

  const transfers = new Map<string, NormalizedTransfer>();
  const indexedOwner = ownerTopic(normalizedOwner);
  for (let fromBlock = startBlock; fromBlock <= endBlock; fromBlock += LOG_RANGE) {
    const toBlock = fromBlock + LOG_RANGE - 1n < endBlock ? fromBlock + LOG_RANGE - 1n : endBlock;
    const filters = [
      [TRANSFER_TOPIC, indexedOwner],
      [TRANSFER_TOPIC, null, indexedOwner]
    ] as const;
    for (const topics of filters) {
      const rawLogs = await rpc('eth_getLogs', [{
        address: positionToken,
        fromBlock: hexQuantity(fromBlock),
        toBlock: hexQuantity(toBlock),
        topics
      }]);
      if (!Array.isArray(rawLogs)) throw new Error('DEX V2 Position NFT logs response is invalid.');
      for (const rawLog of rawLogs) {
        const transfer = parseTransfer(rawLog, positionToken, fromBlock, toBlock);
        const duplicate = transfers.get(transfer.key);
        if (duplicate) assertSameTransfer(duplicate, transfer);
        else transfers.set(transfer.key, transfer);
      }
    }
  }

  const owned = reconcileDexV2OwnedPositionIds({
    transfers: [...transfers.values()],
    owner: normalizedOwner,
    nextPositionId,
    nftBalance
  });

  const positions: DexV2OwnedPosition[] = [];
  for (const positionId of owned) {
    const nftOwner = address(
      await scalar(positionToken, POSITION_TOKEN, 'ownerOf', [positionId]),
      'DEX V2 Position NFT current owner'
    );
    if (nftOwner !== normalizedOwner) {
      throw new Error('DEX V2 Position NFT history disagrees with finalized ownership.');
    }
    const position = await scalar(core, CORE, 'getPosition', [positionId]);
    const kind = kindName(uint(tupleField(position, 'kind', 0, 'DEX V2 position'), 'DEX V2 position kind'));
    const lifecycle = lifecycleName(uint(
      tupleField(position, 'lifecycle', 1, 'DEX V2 position'),
      'DEX V2 position lifecycle'
    ));
    const pairKey = bytes(tupleField(position, 'pairKey', 2, 'DEX V2 position'), 'DEX V2 position pair', 32);
    const privacyOwnerValue = address(tupleField(position, 'privacyOwner', 3, 'DEX V2 position'), 'DEX V2 privacy owner');
    if (privacyOwnerValue !== ZERO_ADDRESS && privacyOwnerValue !== normalizedOwner) {
      throw new Error('DEX V2 position privacy owner disagrees with NFT ownership.');
    }
    const createdAt = uint(tupleField(position, 'createdAt', 4, 'DEX V2 position'), 'DEX V2 position creation time');
    const ownerRevision = uint(tupleField(position, 'ownerRevision', 5, 'DEX V2 position'), 'DEX V2 owner revision');
    const priorityId = uint(tupleField(position, 'priorityId', 6, 'DEX V2 position'), 'DEX V2 priority ID');
    const hiddenSlot = Number(uint(tupleField(position, 'hiddenSlot', 7, 'DEX V2 position'), 'DEX V2 hidden slot'));
    if (createdAt === 0n || createdAt > UINT64_MAX || ownerRevision > UINT64_MAX) {
      throw new Error('DEX V2 position metadata is out of range.');
    }
    if (kind === 'pool') {
      if (lifecycle !== 'active' || priorityId !== 0n || hiddenSlot !== 0) {
        throw new Error('DEX V2 Pool position metadata is invalid.');
      }
    } else if (priorityId < 5n || priorityId >= (1n << 56n) || hiddenSlot < 0 || hiddenSlot > 3) {
      throw new Error('DEX V2 hidden position metadata is invalid.');
    }
    positions.push(Object.freeze({
      positionId: positionId.toString(),
      kind,
      lifecycle,
      pairKey,
      privacyOwner: privacyOwnerValue === ZERO_ADDRESS ? null : privacyOwnerValue,
      needsPrivacyActivation: privacyOwnerValue === ZERO_ADDRESS,
      createdAt: createdAt.toString(),
      ownerRevision: ownerRevision.toString(),
      priorityId: priorityId.toString(),
      hiddenSlot
    }));
  }

  await assertCurrent();
  const finalBlockRecord = await provider.request({
    method: 'eth_getBlockByNumber',
    params: [hexQuantity(endBlock), false]
  });
  if (!finalBlockRecord || typeof finalBlockRecord !== 'object' || Array.isArray(finalBlockRecord)) {
    throw new Error('DEX V2 position discovery final block is unavailable.');
  }
  const finalBlock = finalBlockRecord as Record<string, unknown>;
  if (
    quantity(finalBlock.number, 'DEX V2 final position block number', UINT64_MAX) !== endBlock ||
    bytes(finalBlock.hash, 'DEX V2 final position block hash', 32) !== expectedBlockHash
  ) {
    throw new Error('DEX V2 position discovery block changed during the scan.');
  }
  return Object.freeze({
    owner: normalizedOwner,
    blockNumber: endBlock.toString(),
    blockHash: expectedBlockHash,
    nftBalance: nftBalance.toString(),
    nextPositionId: nextPositionId.toString(),
    positions: Object.freeze(positions)
  });
};
