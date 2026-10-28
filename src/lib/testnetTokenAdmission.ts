import {
  Contract,
  Interface,
  JsonRpcProvider,
  ZeroAddress,
  getAddress,
  isAddress,
  keccak256,
  type TransactionReceipt
} from 'ethers';
import { COTI_TESTNET_NETWORK } from './chainWhisperNetworks';
import type { Eip1193Provider } from './appShared';

export const TESTNET_TOKEN_ADMISSION_OWNER = '0x5DFcEe20b5a3FDd3577436A32f62d4C0b39e979d';
export const TESTNET_TOKEN_ADMISSION_OPERATION_COUNT = 16;

type TargetKey =
  | 'direct'
  | 'standard'
  | 'private'
  | 'recurring'
  | 'privateRecurring'
  | 'liquidity';
type TokenKey = 'publicA' | 'publicB' | 'privateA' | 'privateB';
type AdmissionKind = 'public-approval' | 'private-approval';

export type TestnetTokenAdmissionTarget = Readonly<{
  key: TargetKey;
  name: string;
  address: string;
  runtimeBytecodeHash: string;
  publicPolicy: 'public' | 'token' | null;
  privatePolicy: boolean;
}>;

export type TestnetTokenAdmissionToken = Readonly<{
  key: TokenKey;
  label: string;
  address: string;
  runtimeBytecodeHash: string;
  privateOnly: boolean;
}>;

export type TestnetTokenAdmissionOperation = Readonly<{
  index: number;
  id: string;
  targetKey: TargetKey;
  targetName: string;
  target: string;
  tokenKey: TokenKey;
  tokenLabel: string;
  token: string;
  kind: AdmissionKind;
  data: string;
  selector: string;
}>;

export type TestnetTokenAdmissionState = Readonly<{
  operation: TestnetTokenAdmissionOperation;
  applied: boolean;
}>;

export type TestnetTokenAdmissionSnapshot = Readonly<{
  blockNumber: number;
  blockHash: string;
  states: readonly TestnetTokenAdmissionState[];
  appliedCount: number;
  complete: boolean;
}>;

const PUBLIC_POLICY_ABI = [
  'function approvedPublicTokenCodeHash(address) view returns (bytes32)',
  'function setPublicTokenApproval(address,bool)'
] as const;
const TOKEN_POLICY_ABI = [
  'function approvedTokenCodeHash(address) view returns (bytes32)',
  'function setTokenApproval(address,bool)'
] as const;
const PRIVATE_POLICY_ABI = [
  'function approvedPrivateTokenCodeHash(address) view returns (bytes32)',
  'function setPrivateTokenApproval(address,bool)'
] as const;
const OWNER_VERSION_ABI = [
  'function owner() view returns (address)',
  'function contractVersion() view returns (string)'
] as const;
const PRIVATE_TOKEN_ABI = ['function publicAmountsEnabled() view returns (bool)'] as const;

export const TESTNET_TOKEN_ADMISSION_TARGETS: readonly TestnetTokenAdmissionTarget[] = Object.freeze([
  Object.freeze({
    key: 'direct',
    name: 'ChainWhisperDirectOTCEscrowV2',
    address: '0x322e219B1275a99b556d852f425BFdc7900cAFCF',
    runtimeBytecodeHash: '0x297a5796d584aaa7504a5c934270768cd5ba4f83e2926bbff6e95e7ca97d6ab7',
    publicPolicy: 'public',
    privatePolicy: true
  }),
  Object.freeze({
    key: 'standard',
    name: 'ChainWhisperStandardOTCEscrowV2',
    address: '0x4980cb51E8A58F987FA4635E611c646792EA83f6',
    runtimeBytecodeHash: '0xb610d2ae2b368287bcca3a9e40e1c3668b2654e87ccae7ecbb8316a1ec84d2df',
    publicPolicy: 'token',
    privatePolicy: false
  }),
  Object.freeze({
    key: 'private',
    name: 'ChainWhisperPrivateOTCEscrowV2',
    address: '0xf4122D763d148C49956aA3A2704905904BC6900e',
    runtimeBytecodeHash: '0xe20848f75e59634a16c7d33dd393e91698292a9b29400d456ff57ab0c04ac680',
    publicPolicy: 'public',
    privatePolicy: true
  }),
  Object.freeze({
    key: 'recurring',
    name: 'ChainWhisperRecurringOTCEscrowV2',
    address: '0xB609AE1cBA98E036c125f82ca62DE0E5990A06d9',
    runtimeBytecodeHash: '0xaddc616c65b25791865088567005251d752bc02e26f8ce8236fbc067cad99b2f',
    publicPolicy: 'token',
    privatePolicy: false
  }),
  Object.freeze({
    key: 'privateRecurring',
    name: 'ChainWhisperPrivateRecurringOTCEscrowV2',
    address: '0x86b515a2452B81A494AA21D9f3f44606DA93868e',
    runtimeBytecodeHash: '0xa8f4471c5add7e7f1fce55e2d325510e258b6aa1b6e47ee22b4a5a29deccfade',
    publicPolicy: null,
    privatePolicy: true
  }),
  Object.freeze({
    key: 'liquidity',
    name: 'ChainWhisperPrivateLiquidityBookV2',
    address: '0x034f5c24a4B9C28E861dDd1DD183E0BE10d818F9',
    runtimeBytecodeHash: '0xc33f938f8110a1539a6041bfcace07777b03c8905dcf71e98884eaaf50d33b54',
    publicPolicy: null,
    privatePolicy: true
  })
]);

export const TESTNET_TOKEN_ADMISSION_TOKENS: readonly TestnetTokenAdmissionToken[] = Object.freeze([
  Object.freeze({
    key: 'publicA',
    label: 'Public Base',
    address: '0x5A3FAF1F6D53071832CccA03b9Ba72c00ecCDA18',
    runtimeBytecodeHash: '0xf1167e8574d2cf5fa6ac185066eab5c7fe15fb4f65b6c7204e6adb1584247360',
    privateOnly: false
  }),
  Object.freeze({
    key: 'publicB',
    label: 'Public Quote',
    address: '0x90840aCDe1357F3C04055167192AaF90304237Ba',
    runtimeBytecodeHash: '0xf1167e8574d2cf5fa6ac185066eab5c7fe15fb4f65b6c7204e6adb1584247360',
    privateOnly: false
  }),
  Object.freeze({
    key: 'privateA',
    label: 'Private Base',
    address: '0x222381287eB9f5b3eEa825A3ca5B6c22c6C1893d',
    runtimeBytecodeHash: '0x6418567abdfa4986b3f9607955e8834956014e8d7c9a6f859c4ff97083ef76ce',
    privateOnly: true
  }),
  Object.freeze({
    key: 'privateB',
    label: 'Private Quote',
    address: '0x9467E348a5a4B415eA65e551785273E650ee5CA3',
    runtimeBytecodeHash: '0x6418567abdfa4986b3f9607955e8834956014e8d7c9a6f859c4ff97083ef76ce',
    privateOnly: true
  })
]);

const targetByKey = new Map(TESTNET_TOKEN_ADMISSION_TARGETS.map((target) => [target.key, target]));
const tokenByKey = new Map(TESTNET_TOKEN_ADMISSION_TOKENS.map((token) => [token.key, token]));

const encode = (abi: readonly string[], fn: string, token: string): string =>
  new Interface(abi).encodeFunctionData(fn, [token, true]);

export const buildTestnetTokenAdmissionPlan = (): readonly TestnetTokenAdmissionOperation[] => {
  const operations: Array<Omit<TestnetTokenAdmissionOperation, 'index' | 'targetName' | 'tokenLabel' | 'selector'>> = [];
  const add = (
    targetKey: TargetKey,
    tokenKey: TokenKey,
    kind: AdmissionKind,
    abi: readonly string[],
    fn: string
  ) => {
    const target = targetByKey.get(targetKey);
    const token = tokenByKey.get(tokenKey);
    if (!target || !token) throw new Error('Testnet token admission plan is internally inconsistent.');
    operations.push({
      id: `${targetKey}.${tokenKey}.${kind}`,
      targetKey,
      target: target.address,
      tokenKey,
      token: token.address,
      kind,
      data: encode(abi, fn, token.address)
    });
  };
  for (const tokenKey of ['publicA', 'publicB'] as const) {
    add('direct', tokenKey, 'public-approval', PUBLIC_POLICY_ABI, 'setPublicTokenApproval');
  }
  for (const tokenKey of ['privateA', 'privateB'] as const) {
    add('direct', tokenKey, 'private-approval', PRIVATE_POLICY_ABI, 'setPrivateTokenApproval');
  }
  for (const tokenKey of ['publicA', 'publicB'] as const) {
    add('standard', tokenKey, 'public-approval', TOKEN_POLICY_ABI, 'setTokenApproval');
  }
  for (const tokenKey of ['publicA', 'publicB'] as const) {
    add('private', tokenKey, 'public-approval', PUBLIC_POLICY_ABI, 'setPublicTokenApproval');
  }
  for (const tokenKey of ['privateA', 'privateB'] as const) {
    add('private', tokenKey, 'private-approval', PRIVATE_POLICY_ABI, 'setPrivateTokenApproval');
  }
  for (const tokenKey of ['publicA', 'publicB'] as const) {
    add('recurring', tokenKey, 'public-approval', TOKEN_POLICY_ABI, 'setTokenApproval');
  }
  for (const targetKey of ['privateRecurring', 'liquidity'] as const) {
    for (const tokenKey of ['privateA', 'privateB'] as const) {
      add(targetKey, tokenKey, 'private-approval', PRIVATE_POLICY_ABI, 'setPrivateTokenApproval');
    }
  }
  if (operations.length !== TESTNET_TOKEN_ADMISSION_OPERATION_COUNT) {
    throw new Error('Testnet token admission plan must contain exactly 16 operations.');
  }
  return Object.freeze(operations.map((operation, index) => {
    const target = targetByKey.get(operation.targetKey);
    const token = tokenByKey.get(operation.tokenKey);
    if (!target || !token) throw new Error('Testnet token admission plan is internally inconsistent.');
    return Object.freeze({
      index,
      ...operation,
      targetName: target.name,
      tokenLabel: token.label,
      selector: operation.data.slice(0, 10)
    });
  }));
};

export const TESTNET_TOKEN_ADMISSION_PLAN = buildTestnetTokenAdmissionPlan();

const policyAbiFor = (operation: TestnetTokenAdmissionOperation): readonly string[] => {
  if (operation.kind === 'private-approval') return PRIVATE_POLICY_ABI;
  const target = targetByKey.get(operation.targetKey);
  return target?.publicPolicy === 'token' ? TOKEN_POLICY_ABI : PUBLIC_POLICY_ABI;
};

const policyGetterFor = (operation: TestnetTokenAdmissionOperation): string => {
  if (operation.kind === 'private-approval') return 'approvedPrivateTokenCodeHash';
  const target = targetByKey.get(operation.targetKey);
  return target?.publicPolicy === 'token' ? 'approvedTokenCodeHash' : 'approvedPublicTokenCodeHash';
};

const assertPinnedAddress = (value: string, label: string): string => {
  if (!isAddress(value) || getAddress(value) === ZeroAddress) throw new Error(`${label} address is invalid.`);
  return getAddress(value);
};

const requireRuntime = async (
  provider: JsonRpcProvider,
  address: string,
  expectedHash: string,
  blockNumber: number,
  label: string
): Promise<void> => {
  const code = await provider.getCode(assertPinnedAddress(address, label), blockNumber);
  if (code === '0x' || keccak256(code).toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error(`${label} runtime does not match the reviewed testnet candidate.`);
  }
};

const readApplied = async (
  provider: JsonRpcProvider,
  operation: TestnetTokenAdmissionOperation,
  expectedTokenHash: string,
  blockNumber: number
): Promise<boolean> => {
  const contract = new Contract(operation.target, policyAbiFor(operation), provider);
  const recorded = await contract[policyGetterFor(operation)](operation.token, { blockTag: blockNumber });
  return String(recorded).toLowerCase() === expectedTokenHash.toLowerCase();
};

export const createTestnetTokenAdmissionReadProvider = (): JsonRpcProvider =>
  new JsonRpcProvider(COTI_TESTNET_NETWORK.rpcUrl, {
    chainId: COTI_TESTNET_NETWORK.chainIdDecimal,
    name: 'coti-testnet'
  }, { staticNetwork: false });

export const inspectTestnetTokenAdmissions = async (
  provider: JsonRpcProvider
): Promise<TestnetTokenAdmissionSnapshot> => {
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(COTI_TESTNET_NETWORK.chainIdDecimal)) {
    throw new Error('The read provider is not connected to canonical COTI testnet.');
  }
  const blockNumber = await provider.getBlockNumber();
  const boundary = await provider.getBlock(blockNumber);
  if (!boundary?.hash) throw new Error('Could not bind the testnet admission read to a canonical block.');

  for (const token of TESTNET_TOKEN_ADMISSION_TOKENS) {
    await requireRuntime(provider, token.address, token.runtimeBytecodeHash, blockNumber, token.label);
    if (token.privateOnly) {
      const contract = new Contract(token.address, PRIVATE_TOKEN_ABI, provider);
      if (await contract.publicAmountsEnabled({ blockTag: blockNumber }) !== false) {
        throw new Error(`${token.label} is not configured as a private-only token.`);
      }
    }
  }
  for (const target of TESTNET_TOKEN_ADMISSION_TARGETS) {
    await requireRuntime(provider, target.address, target.runtimeBytecodeHash, blockNumber, target.name);
    const contract = new Contract(target.address, OWNER_VERSION_ABI, provider);
    const [owner, version] = await Promise.all([
      contract.owner({ blockTag: blockNumber }),
      contract.contractVersion({ blockTag: blockNumber })
    ]);
    if (getAddress(String(owner)) !== getAddress(TESTNET_TOKEN_ADMISSION_OWNER) || version !== target.name) {
      throw new Error(`${target.name} owner or version does not match the reviewed testnet candidate.`);
    }
  }

  const states: TestnetTokenAdmissionState[] = [];
  for (const operation of TESTNET_TOKEN_ADMISSION_PLAN) {
    const token = tokenByKey.get(operation.tokenKey);
    if (!token) throw new Error('Testnet token admission plan is internally inconsistent.');
    states.push(Object.freeze({
      operation,
      applied: await readApplied(provider, operation, token.runtimeBytecodeHash, blockNumber)
    }));
  }
  const boundaryAfter = await provider.getBlock(blockNumber);
  if (!boundaryAfter?.hash || boundaryAfter.hash.toLowerCase() !== boundary.hash.toLowerCase()) {
    throw new Error('COTI testnet changed during token-admission inspection; refresh and try again.');
  }
  const appliedCount = states.filter((state) => state.applied).length;
  return Object.freeze({
    blockNumber,
    blockHash: boundary.hash,
    states: Object.freeze(states),
    appliedCount,
    complete: appliedCount === TESTNET_TOKEN_ADMISSION_OPERATION_COUNT
  });
};

export const getNextTestnetTokenAdmission = (
  snapshot: TestnetTokenAdmissionSnapshot
): TestnetTokenAdmissionOperation | null =>
  snapshot.states.find((state) => !state.applied)?.operation ?? null;

const walletAccounts = async (provider: Eip1193Provider, request: boolean): Promise<string[]> => {
  const response = await provider.request({ method: request ? 'eth_requestAccounts' : 'eth_accounts' });
  return Array.isArray(response)
    ? response.filter((account): account is string => typeof account === 'string' && isAddress(account))
    : [];
};

export const assertTestnetTokenAdmissionWallet = async (
  provider: Eip1193Provider,
  requestAccounts = false
): Promise<string> => {
  const chainId = await provider.request({ method: 'eth_chainId' });
  if (BigInt(String(chainId)) !== BigInt(COTI_TESTNET_NETWORK.chainIdDecimal)) {
    throw new Error('Switch the selected wallet to COTI Testnet before continuing.');
  }
  const accounts = await walletAccounts(provider, requestAccounts);
  if (accounts.length === 0) throw new Error('Connect the reviewed testnet owner wallet first.');
  const owner = getAddress(accounts[0]);
  if (owner !== getAddress(TESTNET_TOKEN_ADMISSION_OWNER)) {
    throw new Error(`This setup requires the deployed owner ${TESTNET_TOKEN_ADMISSION_OWNER}.`);
  }
  return owner;
};

const waitForReceipt = async (
  provider: JsonRpcProvider,
  transactionHash: string,
  timeoutMs = 300_000
): Promise<TransactionReceipt> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await provider.getTransactionReceipt(transactionHash);
    if (receipt) return receipt;
    await new Promise((resolve) => window.setTimeout(resolve, 1_500));
  }
  throw new Error('The transaction is still unconfirmed. Refresh before attempting another admission.');
};

export const applyNextTestnetTokenAdmission = async ({
  walletProvider,
  readProvider,
  snapshot
}: {
  walletProvider: Eip1193Provider;
  readProvider: JsonRpcProvider;
  snapshot: TestnetTokenAdmissionSnapshot;
}): Promise<Readonly<{ transactionHash: string; receipt: TransactionReceipt; snapshot: TestnetTokenAdmissionSnapshot }>> => {
  const operation = getNextTestnetTokenAdmission(snapshot);
  if (!operation) throw new Error('All 16 testnet token admissions are already complete.');
  const owner = await assertTestnetTokenAdmissionWallet(walletProvider, false);
  const latest = await inspectTestnetTokenAdmissions(readProvider);
  const latestOperation = getNextTestnetTokenAdmission(latest);
  if (!latestOperation || latestOperation.id !== operation.id) {
    throw new Error('Token-admission state changed. Refresh before approving a transaction.');
  }
  await assertTestnetTokenAdmissionWallet(walletProvider, false);
  const transactionHash = await walletProvider.request({
    method: 'eth_sendTransaction',
    params: [{
      from: owner,
      to: operation.target,
      data: operation.data,
      value: '0x0'
    }]
  });
  if (typeof transactionHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
    throw new Error('The wallet returned an invalid transaction hash.');
  }
  const receipt = await waitForReceipt(readProvider, transactionHash);
  if (receipt.status !== 1 || getAddress(receipt.from) !== owner || getAddress(receipt.to ?? ZeroAddress) !== getAddress(operation.target)) {
    throw new Error('The token-admission transaction did not confirm with the expected owner and target.');
  }
  const canonicalBlock = await readProvider.getBlock(receipt.blockNumber);
  if (!canonicalBlock?.hash || canonicalBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
    throw new Error('The token-admission receipt is not in the canonical COTI testnet chain.');
  }
  const nextSnapshot = await inspectTestnetTokenAdmissions(readProvider);
  const applied = nextSnapshot.states.find((state) => state.operation.id === operation.id)?.applied;
  if (!applied) throw new Error('The confirmed transaction did not apply the expected token policy.');
  return Object.freeze({ transactionHash, receipt, snapshot: nextSnapshot });
};

export const switchTestnetTokenAdmissionWalletNetwork = async (provider: Eip1193Provider): Promise<void> => {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: COTI_TESTNET_NETWORK.chainIdHex }]
    });
  } catch (error) {
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    if (code !== 4902) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: COTI_TESTNET_NETWORK.chainIdHex,
        chainName: COTI_TESTNET_NETWORK.chainName,
        nativeCurrency: COTI_TESTNET_NETWORK.nativeCurrency,
        rpcUrls: [COTI_TESTNET_NETWORK.rpcUrl],
        blockExplorerUrls: [COTI_TESTNET_NETWORK.blockExplorerUrl]
      }]
    });
  }
};
