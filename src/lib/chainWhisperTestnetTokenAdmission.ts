import {
  Contract,
  Interface,
  JsonRpcProvider,
  getAddress,
  keccak256,
  type TransactionReceipt,
  type TransactionResponse
} from '@coti-io/coti-ethers';
import {
  assertOwnerTradeV2CapabilityCurrent,
  getOwnerTradeV2CapabilityBinding,
  type OwnerTradeV2CapabilityBinding,
  type OwnerTradeV2MetaMaskCapability
} from './ownerTradeV2Capability';

const CHAIN_ID = 7_082_400n;
const RPC_URL = 'https://testnet.coti.io/rpc';
const OWNER = '0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d';
const ZERO_HASH = `0x${'00'.repeat(32)}`;
const RECEIPT_POLL_INTERVAL_MS = 1_500;
const RECEIPT_TIMEOUT_MS = 300_000;

const TARGETS = Object.freeze({
  direct: Object.freeze({
    label: 'Direct OTC',
    address: '0x322e219b1275a99b556d852f425bfdc7900cafcf',
    runtimeHash: '0x297a5796d584aaa7504a5c934270768cd5ba4f83e2926bbff6e95e7ca97d6ab7'
  }),
  standard: Object.freeze({
    label: 'Standard OTC',
    address: '0x4980cb51e8a58f987fa4635e611c646792ea83f6',
    runtimeHash: '0xb610d2ae2b368287bcca3a9e40e1c3668b2654e87ccae7ecbb8316a1ec84d2df'
  }),
  private: Object.freeze({
    label: 'Private OTC',
    address: '0xf4122d763d148c49956aa3a2704905904bc6900e',
    runtimeHash: '0xe20848f75e59634a16c7d33dd393e91698292a9b29400d456ff57ab0c04ac680'
  }),
  recurring: Object.freeze({
    label: 'Recurring OTC',
    address: '0xb609ae1cba98e036c125f82ca62de0e5990a06d9',
    runtimeHash: '0xaddc616c65b25791865088567005251d752bc02e26f8ce8236fbc067cad99b2f'
  }),
  privateRecurring: Object.freeze({
    label: 'Private recurring OTC',
    address: '0x86b515a2452b81a494aa21d9f3f44606da93868e',
    runtimeHash: '0xa8f4471c5add7e7f1fce55e2d325510e258b6aa1b6e47ee22b4a5a29deccfade'
  }),
  liquidity: Object.freeze({
    label: 'Private liquidity',
    address: '0x034f5c24a4b9c28e861ddd1dd183e0be10d818f9',
    runtimeHash: '0xc33f938f8110a1539a6041bfcace07777b03c8905dcf71e98884eaaf50d33b54'
  })
});

const TOKENS = Object.freeze({
  publicBase: Object.freeze({
    label: 'cwTUB',
    address: '0x5a3faf1f6d53071832ccca03b9ba72c00eccda18',
    runtimeHash: '0xf1167e8574d2cf5fa6ac185066eab5c7fe15fb4f65b6c7204e6adb1584247360'
  }),
  publicQuote: Object.freeze({
    label: 'cwTUQ',
    address: '0x90840acde1357f3c04055167192aaf90304237ba',
    runtimeHash: '0xf1167e8574d2cf5fa6ac185066eab5c7fe15fb4f65b6c7204e6adb1584247360'
  }),
  privateBase: Object.freeze({
    label: 'cwTPB',
    address: '0x222381287eb9f5b3eea825a3ca5b6c22c6c1893d',
    runtimeHash: '0x6418567abdfa4986b3f9607955e8834956014e8d7c9a6f859c4ff97083ef76ce'
  }),
  privateQuote: Object.freeze({
    label: 'cwTPQ',
    address: '0x9467e348a5a4b415ea65e551785273e650ee5ca3',
    runtimeHash: '0x6418567abdfa4986b3f9607955e8834956014e8d7c9a6f859c4ff97083ef76ce'
  })
});

type TargetKey = keyof typeof TARGETS;
type TokenKey = keyof typeof TOKENS;
type Setter = 'setTokenApproval' | 'setPublicTokenApproval' | 'setPrivateTokenApproval';
type Getter = 'approvedTokenCodeHash' | 'approvedPublicTokenCodeHash' | 'approvedPrivateTokenCodeHash';

export type TestnetTokenAdmissionOperation = Readonly<{
  id: string;
  targetKey: TargetKey;
  tokenKey: TokenKey;
  targetLabel: string;
  tokenLabel: string;
  targetAddress: string;
  tokenAddress: string;
  setter: Setter;
  getter: Getter;
}>;

export type TestnetTokenAdmissionState = Readonly<{
  complete: number;
  total: number;
  operations: readonly Readonly<TestnetTokenAdmissionOperation & { approved: boolean }>[];
  next: TestnetTokenAdmissionOperation | null;
}>;

const operation = (
  targetKey: TargetKey,
  tokenKey: TokenKey,
  setter: Setter,
  getter: Getter
): TestnetTokenAdmissionOperation => {
  const target = TARGETS[targetKey];
  const token = TOKENS[tokenKey];
  return Object.freeze({
    id: `${targetKey}:${tokenKey}`,
    targetKey,
    tokenKey,
    targetLabel: target.label,
    tokenLabel: token.label,
    targetAddress: target.address,
    tokenAddress: token.address,
    setter,
    getter
  });
};

export const CHAINWHISPER_TESTNET_TOKEN_ADMISSIONS = Object.freeze([
  operation('direct', 'publicBase', 'setPublicTokenApproval', 'approvedPublicTokenCodeHash'),
  operation('direct', 'publicQuote', 'setPublicTokenApproval', 'approvedPublicTokenCodeHash'),
  operation('direct', 'privateBase', 'setPrivateTokenApproval', 'approvedPrivateTokenCodeHash'),
  operation('direct', 'privateQuote', 'setPrivateTokenApproval', 'approvedPrivateTokenCodeHash'),
  operation('standard', 'publicBase', 'setTokenApproval', 'approvedTokenCodeHash'),
  operation('standard', 'publicQuote', 'setTokenApproval', 'approvedTokenCodeHash'),
  operation('private', 'publicBase', 'setPublicTokenApproval', 'approvedPublicTokenCodeHash'),
  operation('private', 'publicQuote', 'setPublicTokenApproval', 'approvedPublicTokenCodeHash'),
  operation('private', 'privateBase', 'setPrivateTokenApproval', 'approvedPrivateTokenCodeHash'),
  operation('private', 'privateQuote', 'setPrivateTokenApproval', 'approvedPrivateTokenCodeHash'),
  operation('recurring', 'publicBase', 'setTokenApproval', 'approvedTokenCodeHash'),
  operation('recurring', 'publicQuote', 'setTokenApproval', 'approvedTokenCodeHash'),
  operation('privateRecurring', 'privateBase', 'setPrivateTokenApproval', 'approvedPrivateTokenCodeHash'),
  operation('privateRecurring', 'privateQuote', 'setPrivateTokenApproval', 'approvedPrivateTokenCodeHash'),
  operation('liquidity', 'privateBase', 'setPrivateTokenApproval', 'approvedPrivateTokenCodeHash'),
  operation('liquidity', 'privateQuote', 'setPrivateTokenApproval', 'approvedPrivateTokenCodeHash')
]);

const ABI = [
  'function owner() view returns (address)',
  'function approvedTokenCodeHash(address token) view returns (bytes32)',
  'function approvedPublicTokenCodeHash(address token) view returns (bytes32)',
  'function approvedPrivateTokenCodeHash(address token) view returns (bytes32)',
  'function setTokenApproval(address token,bool approved)',
  'function setPublicTokenApproval(address token,bool approved)',
  'function setPrivateTokenApproval(address token,bool approved)'
] as const;
const INTERFACE = new Interface(ABI);

type PublicReader = Readonly<{
  destroy?(): void;
  getNetwork(): Promise<Readonly<{ chainId: bigint }>>;
  readCodeHash(address: string, label: string): Promise<string>;
  readApproval(target: string, getter: Getter, token: string): Promise<string>;
  readOwner(target: string): Promise<string>;
}>;

const createReader = (): PublicReader => {
  const provider = new JsonRpcProvider(
    RPC_URL,
    { chainId: Number(CHAIN_ID), name: 'COTI Testnet' },
    { batchMaxCount: 1, staticNetwork: false }
  );
  return Object.freeze({
    destroy: () => provider.destroy(),
    getNetwork: async () => {
      const network = await provider.getNetwork();
      return Object.freeze({ chainId: network.chainId });
    },
    readApproval: async (target: string, getter: Getter, token: string) => {
      const contract = new Contract(target, ABI, provider);
      return String(await contract[getter](token));
    },
    readCodeHash: async (target: string, label: string) => {
      const code = await provider.getCode(target);
      if (code === '0x') throw new Error(`${label} has no deployed bytecode.`);
      return keccak256(code).toLowerCase();
    },
    readOwner: async (target: string) => {
      const contract = new Contract(target, ABI, provider);
      return String(await contract.owner());
    }
  });
};

const attestStaticSuite = async (reader: PublicReader): Promise<Record<TokenKey, string>> => {
  const network = await reader.getNetwork();
  if (BigInt(network.chainId) !== CHAIN_ID) throw new Error('Token-admission RPC is not COTI Testnet.');
  for (const target of Object.values(TARGETS)) {
    if (await reader.readCodeHash(target.address, target.label) !== target.runtimeHash) {
      throw new Error(`${target.label} runtime does not match the reviewed testnet candidate.`);
    }
    if (getAddress(await reader.readOwner(target.address)).toLowerCase() !== OWNER) {
      throw new Error(`${target.label} owner does not match the reviewed testnet candidate.`);
    }
  }
  const hashes = {} as Record<TokenKey, string>;
  for (const [key, token] of Object.entries(TOKENS) as [TokenKey, (typeof TOKENS)[TokenKey]][]) {
    const runtimeHash = await reader.readCodeHash(token.address, token.label);
    if (runtimeHash !== token.runtimeHash) {
      throw new Error(`${token.label} runtime does not match the reviewed test token.`);
    }
    hashes[key] = runtimeHash;
  }
  return hashes;
};

const inspectWithReader = async (reader: PublicReader): Promise<TestnetTokenAdmissionState> => {
  const tokenHashes = await attestStaticSuite(reader);
  const statuses: Readonly<TestnetTokenAdmissionOperation & { approved: boolean }>[] = [];
  for (const item of CHAINWHISPER_TESTNET_TOKEN_ADMISSIONS) {
    const stored = (await reader.readApproval(item.targetAddress, item.getter, item.tokenAddress)).toLowerCase();
    if (stored !== ZERO_HASH && stored !== tokenHashes[item.tokenKey]) {
      throw new Error(`${item.targetLabel} has a stale approval for ${item.tokenLabel}.`);
    }
    statuses.push(Object.freeze({ ...item, approved: stored === tokenHashes[item.tokenKey] }));
  }
  const complete = statuses.filter(({ approved }) => approved).length;
  return Object.freeze({
    complete,
    total: statuses.length,
    operations: Object.freeze(statuses),
    next: statuses.find(({ approved }) => !approved) ?? null
  });
};

export const inspectChainWhisperTestnetTokenAdmissions = async (): Promise<TestnetTokenAdmissionState> => {
  const reader = createReader();
  try {
    return await inspectWithReader(reader);
  } finally {
    reader.destroy?.();
  }
};

const normalizeTransaction = (
  value: TransactionResponse,
  operation: TestnetTokenAdmissionOperation,
  expectedData: string
): TransactionResponse => {
  if (
    value.from.toLowerCase() !== OWNER ||
    value.to?.toLowerCase() !== operation.targetAddress ||
    value.data.toLowerCase() !== expectedData.toLowerCase() ||
    value.value !== 0n ||
    BigInt(value.chainId) !== CHAIN_ID
  ) {
    throw new Error('The connected wallet returned a transaction that does not match the selected token approval.');
  }
  return value;
};

const waitForReceiptOrCanonicalApproval = async (
  binding: OwnerTradeV2CapabilityBinding,
  transaction: TransactionResponse,
  operation: TestnetTokenAdmissionOperation
): Promise<TransactionReceipt | null> => {
  if (!binding.readProvider) {
    throw new Error('Token admission requires independent public-RPC confirmation.');
  }
  const reader = createReader();
  const expectedCodeHash = TOKENS[operation.tokenKey].runtimeHash;
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      try {
        const receipt = await binding.readProvider.getTransactionReceipt(transaction.hash);
        if (receipt) return receipt;
      } catch {
        // A transient public-RPC failure must not send receipt polling back to MetaMask.
      }
      try {
        const stored = await reader.readApproval(operation.targetAddress, operation.getter, operation.tokenAddress);
        if (stored.toLowerCase() === expectedCodeHash) {
          // A replacement or response-loss case is complete once the exact
          // reviewed code-hash admission is canonical on the intended target.
          return null;
        }
      } catch {
        // Retry the bounded public read until the deadline.
      }
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, RECEIPT_POLL_INTERVAL_MS));
    }
    throw new Error(
      'The token admission was submitted, but COTI confirmation timed out. Recheck canonical progress before retrying.'
    );
  } finally {
    reader.destroy?.();
  }
};

export const approveNextChainWhisperTestnetToken = async ({
  capability,
  expectedOperationId
}: {
  capability: OwnerTradeV2MetaMaskCapability;
  expectedOperationId: string;
}): Promise<Readonly<{ transactionHash: string; state: TestnetTokenAdmissionState }>> => {
  const binding = getOwnerTradeV2CapabilityBinding(capability);
  await assertOwnerTradeV2CapabilityCurrent(binding);
  if (binding.chainId !== CHAIN_ID || binding.ownerAddress !== OWNER) {
    throw new Error('Token admission requires the reviewed deployment owner on COTI Testnet.');
  }
  const before = await inspectChainWhisperTestnetTokenAdmissions();
  if (!before.next) throw new Error('All testnet tokens are already approved.');
  if (before.next.id !== expectedOperationId) {
    throw new Error('Token approval progress changed. Refresh and try again.');
  }
  const data = INTERFACE.encodeFunctionData(before.next.setter, [before.next.tokenAddress, true]);
  await assertOwnerTradeV2CapabilityCurrent(binding);
  const transaction = normalizeTransaction(
    await binding.signer.sendTransaction({ to: before.next.targetAddress, data, value: 0n }),
    before.next,
    data
  );
  const receipt = await waitForReceiptOrCanonicalApproval(binding, transaction, before.next);
  if (receipt && (receipt.status !== 1 || receipt.from.toLowerCase() !== OWNER ||
      receipt.to?.toLowerCase() !== before.next.targetAddress)) {
    throw new Error('Token approval transaction did not succeed on the expected contract.');
  }
  await assertOwnerTradeV2CapabilityCurrent(binding);
  const state = await inspectChainWhisperTestnetTokenAdmissions();
  if (!state.operations.find(({ id }) => id === before.next?.id)?.approved) {
    throw new Error('Token approval was confirmed but could not be verified on-chain.');
  }
  return Object.freeze({ transactionHash: (receipt?.hash ?? transaction.hash).toLowerCase(), state });
};

export const CHAINWHISPER_TESTNET_TOKEN_ADMISSION_OWNER = OWNER;
export const CHAINWHISPER_TESTNET_TOKEN_ADMISSION_CHAIN_ID = CHAIN_ID;

export const __inspectChainWhisperTestnetTokenAdmissionsForTest = inspectWithReader;
export const __CHAINWHISPER_TESTNET_TOKEN_ADMISSION_SUITE_FOR_TEST = Object.freeze({ TARGETS, TOKENS });
