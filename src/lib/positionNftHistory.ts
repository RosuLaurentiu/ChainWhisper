import { getAddress } from '@coti-io/coti-ethers';

export type PositionNftTransfer = Readonly<{
  blockNumber: bigint;
  transactionIndex: bigint;
  logIndex: bigint;
  from: string;
  to: string;
  positionId: bigint;
}>;

const address = (value: unknown, label: string): string => {
  try {
    return getAddress(String(value)).toLowerCase();
  } catch {
    throw new Error(`${label} is invalid.`);
  }
};

export const reconcileOwnedPositionIds = ({
  transfers,
  owner,
  nextPositionId,
  nftBalance
}: {
  transfers: readonly PositionNftTransfer[];
  owner: string;
  nextPositionId: bigint;
  nftBalance: bigint;
}): readonly bigint[] => {
  const normalizedOwner = address(owner, 'Position NFT owner');
  if (nextPositionId <= 0n || nftBalance < 0n || nftBalance >= nextPositionId) {
    throw new Error('Position NFT issuance bounds are invalid.');
  }
  const owned = new Set<bigint>();
  const orderedTransfers = [...transfers].sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1;
    if (left.transactionIndex !== right.transactionIndex) return left.transactionIndex < right.transactionIndex ? -1 : 1;
    if (left.logIndex !== right.logIndex) return left.logIndex < right.logIndex ? -1 : 1;
    return 0;
  });
  for (const transfer of orderedTransfers) {
    if (transfer.positionId <= 0n || transfer.positionId >= nextPositionId) {
      throw new Error('Position NFT history contains an unissued position ID.');
    }
    const from = address(transfer.from, 'Position NFT transfer sender');
    const to = address(transfer.to, 'Position NFT transfer recipient');
    if (from === normalizedOwner) owned.delete(transfer.positionId);
    if (to === normalizedOwner) owned.add(transfer.positionId);
  }
  if (BigInt(owned.size) !== nftBalance) {
    throw new Error('Position NFT history does not reconcile with the finalized owner balance.');
  }
  return Object.freeze([...owned].sort((left, right) => left < right ? -1 : left > right ? 1 : 0));
};
