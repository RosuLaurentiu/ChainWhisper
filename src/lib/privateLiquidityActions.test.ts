import {
  BrowserProvider,
  Interface,
  JsonRpcProvider,
  keccak256,
  toUtf8Bytes,
  type JsonRpcSigner
} from '@coti-io/coti-ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadCotiEthersModule: vi.fn(),
  decryptPrivateUint256Output: vi.fn(),
  encryptPrivateUint256Input: vi.fn()
}));

vi.mock('./appShared/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('./appShared/core')>(),
  loadCotiEthersModule: mocks.loadCotiEthersModule
}));
vi.mock('./privateUint256', async (importOriginal) => ({
  ...await importOriginal<typeof import('./privateUint256')>(),
  decryptPrivateUint256Output: mocks.decryptPrivateUint256Output,
  encryptPrivateUint256Input: mocks.encryptPrivateUint256Input
}));

import {
  attestPrivateLiquidityDeployment,
  bindPrivateLiquidityReadCapability,
  readCanonicalPrivateLiquidityLogRange
} from './privateLiquidityChain';
import {
  PRIVATE_LIQUIDITY_ADD_LIQUIDITY_SELECTOR,
  PRIVATE_LIQUIDITY_ACTION_GAS_LIMIT,
  PRIVATE_LIQUIDITY_CREATE_POSITION_SELECTOR,
  PRIVATE_LIQUIDITY_REMOVE_LIQUIDITY_SELECTOR,
  PRIVATE_LIQUIDITY_SWAP_ABI,
  PRIVATE_LIQUIDITY_SWAP_SELECTOR,
  PRIVATE_LIQUIDITY_TOKEN_WRITE_GAS_LIMIT,
  getPrivateLiquiditySwapGasLimit,
  assertPrivateLiquidityMetaMaskCapabilityCurrent,
  bindPrivateLiquidityMetaMaskCapability,
  confirmPrivateLiquidityPositionAction,
  confirmPrivateLiquiditySwap,
  ensurePrivateLiquidityInputAllowance,
  isPrivateLiquidityAllowancePrivacyRefreshRequired,
  readPrivateLiquidityOwnerPrivateData,
  readPrivateLiquidityPrivateHistory,
  submitPrivateLiquidityPositionAction,
  submitPrivateLiquiditySwap,
  type PrivateLiquidityMetaMaskCapability,
  type PrivateLiquiditySwapSubmission
} from './privateLiquidityActions';
import {
  buildPrivateLiquidityPairKey,
  type PrivateLiquidityPosition
} from './privateLiquidity';
import { preparePrivateLiquidityCandidates } from './privateLiquidityQuote';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;
const quantity = (value: bigint): string => `0x${value.toString(16)}`;
const blockHash = (number: bigint): string => `0x${number.toString(16).padStart(64, '0')}`;

const CHAIN_ID = 7_082_400n;
const CONTRACT = address('11');
const OWNER = address('22');
const RECIPIENT = address('55');
const BASE = address('33');
const QUOTE = address('44');
const PAIR = buildPrivateLiquidityPairKey(BASE, QUOTE);
const UINT128_MAX = (1n << 128n) - 1n;
const packedReceipt = (amount: bigint): bigint => (amount << 128n) + (UINT128_MAX - amount);
const encodedOwnerInventory = ({
  recipient = OWNER,
  baseAmount = packedReceipt(25n),
  quoteAmount = packedReceipt(90n)
}: {
  recipient?: string;
  baseAmount?: bigint;
  quoteAmount?: bigint;
} = {}): string => SWAP.encodeFunctionResult('getOwnerInventorySnapshot', [[
  recipient,
  3n,
  true,
  [[1n, 2n], [baseAmount, 0n]],
  [[3n, 4n], [quoteAmount, 0n]]
]]);
const CODE = '0x6001600055';
const TX_HASH = hash('aa');
const SETUP_TX_HASH = hash('ab');
const SWAP = new Interface(PRIVATE_LIQUIDITY_SWAP_ABI);
const PRIVATE_TOKEN = new Interface([
  'function accountEncryptionAddress(address account) view returns (address)',
  'function setAccountEncryptionAddress(address offBoardAddress) returns (bool)',
  'function publicAmountsEnabled() view returns (bool)',
  'function allowance(address owner,address spender) view returns (((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) ownerCiphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) spenderCiphertext))',
  'function reencryptAllowance(address account,bool isSpender)',
  'function approve(address spender,uint256 amount)',
  'function approve(address spender,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) amount)',
  'function increaseAllowance(address spender,uint256 amount)',
  'function increaseAllowance(address spender,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) amount)'
]);
const METADATA = new Interface([
  'function contractVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)'
]);
const APP_WALLET_FEATURE = keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR')).toLowerCase();

class AttestationProvider {
  async request({ method, params = [] }: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    if (method === 'eth_chainId') return quantity(CHAIN_ID);
    if (method === 'eth_blockNumber') return quantity(130n);
    if (method === 'eth_getBlockByNumber') {
      const number = BigInt(String(params[0]));
      return { number: quantity(number), hash: blockHash(number), transactions: [] };
    }
    if (method === 'eth_getCode') return CODE;
    if (method === 'eth_getLogs') return [];
    if (method === 'eth_call') {
      const parsed = METADATA.parseTransaction({ data: (params[0] as { data: string }).data });
      if (!parsed) throw new Error('Unknown getter.');
      return parsed.name === 'contractVersion'
        ? METADATA.encodeFunctionResult(parsed.name, ['ChainWhisperPrivateLiquidityBookV1'])
        : METADATA.encodeFunctionResult(parsed.name, [
            String(parsed.args[0]).toLowerCase() !== APP_WALLET_FEATURE
          ]);
    }
    throw new Error(`Unexpected RPC ${method}.`);
  }
}

const makeBrowserProvider = (
  fallback?: (method: string, params: readonly unknown[]) => Promise<unknown>
): BrowserProvider => new BrowserProvider({
  request: vi.fn(async ({ method, params = [] }: { method: string; params?: readonly unknown[] }) => {
    if (method === 'eth_chainId') return quantity(CHAIN_ID);
    if (method === 'eth_accounts') return [OWNER];
    if (fallback) return fallback(method, params);
    return null;
  })
}, { chainId: Number(CHAIN_ID), name: 'Private liquidity test' });

const makeSigner = (provider = makeBrowserProvider(), owner = OWNER) => ({
  provider,
  getAddress: vi.fn(async () => owner),
  sendUncheckedTransaction: vi.fn(),
  getUserOnboardInfo: vi.fn(() => ({ aesKey: 'test-aes-key' })),
  encryptValue: vi.fn(),
  decryptValue: vi.fn(async (value: { ciphertextHigh?: bigint }) => value.ciphertextHigh ?? 0n)
}) as unknown as JsonRpcSigner;

const position = (id: number): PrivateLiquidityPosition => ({
  identity: { chainId: CHAIN_ID.toString(), contractAddress: CONTRACT, positionId: id.toString() },
  owner: OWNER,
  pairKey: PAIR,
  baseToken: BASE,
  quoteToken: QUOTE,
  buyTerms: { baseAmount: '1', quoteAmount: id === 1 ? '10' : '9' },
  sellTerms: { baseAmount: '1', quoteAmount: '11' },
  status: 'active',
  revision: '4',
  buySideAvailable: true,
  sellSideAvailable: true,
  privacyOwner: OWNER,
  createdAt: '100',
  lastActivityBlock: '120'
});

const setup = async () => {
  const readCapability = await bindPrivateLiquidityReadCapability({
    provider: new AttestationProvider(),
    expectedChainId: CHAIN_ID,
    assertCurrent: () => undefined
  });
  const deployment = await attestPrivateLiquidityDeployment({
    capability: readCapability,
    manifest: {
      chainId: CHAIN_ID,
      contractAddress: CONTRACT,
      deploymentBlock: 100n,
      runtimeBytecodeHash: keccak256(CODE)
    },
    finalityLagBlocks: 5n
  });
  const browserProvider = makeBrowserProvider();
  const signer = makeSigner(browserProvider);
  const assertCurrent = vi.fn(() => undefined);
  const assertSnapshotCurrent = vi.fn(() => undefined);
  const capability = await bindPrivateLiquidityMetaMaskCapability({
    signer,
    browserProvider,
    ownerAddress: OWNER,
    chainId: CHAIN_ID,
    assertCurrent,
    assertSnapshotCurrent
  });
  const plan = preparePrivateLiquidityCandidates({
    chainId: CHAIN_ID.toString(),
    contractAddress: CONTRACT,
    baseToken: BASE,
    quoteToken: QUOTE,
    direction: 'base-to-quote',
    positions: [position(1), position(2)]
  });
  return { assertCurrent, assertSnapshotCurrent, capability, deployment, plan, signer, readCapability };
};

const installSwapContract = ({ wrongMarker = false } = {}) => {
  const swapBest = vi.fn(async (...args: unknown[]) => {
    const data = SWAP.encodeFunctionData('swapBest', args.slice(0, -1)).toLowerCase();
    const marker = SWAP.getEvent('PrivateLiquiditySwapExecuted');
    if (!marker) throw new Error('Missing swap marker.');
    const encoded = SWAP.encodeEventLog(marker, [
      5n,
      OWNER,
      wrongMarker ? hash('ff') : PAIR,
      0,
      2n
    ]);
    const receiptEvent = SWAP.getEvent('PrivateLiquidityTraderSwapReceiptUpdated');
    if (!receiptEvent) throw new Error('Missing private swap receipt event.');
    const privateReceipt = SWAP.encodeEventLog(receiptEvent, [
      5n,
      OWNER,
      PAIR,
      0,
      [[1n, 2n], [packedReceipt(75n), 0n]],
      [[3n, 4n], [packedReceipt(750n), 0n]],
      [[5n, 6n], [packedReceipt(25n), 0n]]
    ]);
    const privateLog = {
      address: CONTRACT,
      topics: privateReceipt.topics,
      data: privateReceipt.data,
      blockNumber: 120n,
      blockHash: blockHash(120n),
      transactionHash: TX_HASH,
      index: 2,
      removed: false
    };
    const markerLog = {
      address: CONTRACT,
      topics: encoded.topics,
      data: encoded.data,
      blockNumber: 120n,
      blockHash: blockHash(120n),
      transactionHash: TX_HASH,
      index: 3,
      removed: false
    };
    return {
      hash: TX_HASH,
      chainId: CHAIN_ID,
      from: OWNER,
      to: CONTRACT,
      data,
      value: 0n,
      wait: vi.fn(async () => ({
        status: 1n,
        hash: TX_HASH,
        transactionHash: TX_HASH,
        blockNumber: 120n,
        blockHash: blockHash(120n),
        logs: [privateLog, markerLog]
      }))
    };
  });
  const Contract = vi.fn(function MockContract() {
    return { swapBest };
  });
  mocks.loadCotiEthersModule.mockResolvedValue({ Contract });
  return { swapBest };
};

const installPositionContract = ({
  method,
  eventName,
  eventArgs,
  transactionHash = TX_HASH
}: {
  method: string;
  eventName: string;
  eventArgs: readonly unknown[];
  transactionHash?: string;
}) => {
  const call = vi.fn(async (...args: unknown[]) => {
    const data = SWAP.encodeFunctionData(method, args.slice(0, -1)).toLowerCase();
    const event = SWAP.getEvent(eventName);
    if (!event) throw new Error(`Missing ${eventName} event.`);
    const encoded = SWAP.encodeEventLog(event, [...eventArgs]);
    const log = {
      address: CONTRACT,
      topics: encoded.topics,
      data: encoded.data,
      blockNumber: 121n,
      blockHash: blockHash(121n),
      transactionHash,
      index: 4,
      removed: false
    };
    return {
      hash: transactionHash,
      chainId: CHAIN_ID,
      from: OWNER,
      to: CONTRACT,
      data,
      value: 0n,
      wait: vi.fn(async () => ({
        status: 1n,
        hash: transactionHash,
        transactionHash,
        blockNumber: 121n,
        blockHash: blockHash(121n),
        logs: [log]
      }))
    };
  });
  const Contract = vi.fn(function MockContract() {
    return { [method]: call };
  });
  mocks.loadCotiEthersModule.mockResolvedValue({ Contract });
  return call;
};

const installAllowanceContract = ({
  initialAllowance = 0n,
  publicAmountsEnabled = true,
  configuredAddress = OWNER
}: {
  initialAllowance?: bigint;
  publicAmountsEnabled?: boolean;
  configuredAddress?: string;
} = {}) => {
  let allowance = initialAllowance;
  let encryptionAddress = configuredAddress;
  const transaction = (data: string, transactionHash = TX_HASH) => ({
    hash: transactionHash,
    chainId: CHAIN_ID,
    from: OWNER,
    to: BASE,
    data: data.toLowerCase(),
    value: 0n,
    wait: vi.fn(async () => ({
      status: 1n,
      hash: transactionHash,
      transactionHash,
      blockNumber: 122n,
      blockHash: blockHash(122n),
      logs: []
    }))
  });
  const publicApprove = vi.fn(async (spender: string, amount: bigint, _overrides: unknown) => {
    allowance = amount;
    return transaction(PRIVATE_TOKEN.encodeFunctionData('approve(address,uint256)', [spender, amount]));
  });
  const publicIncrease = vi.fn(async (spender: string, amount: bigint, _overrides: unknown) => {
    allowance += amount;
    return transaction(PRIVATE_TOKEN.encodeFunctionData('increaseAllowance(address,uint256)', [spender, amount]));
  });
  const privateApprove = vi.fn(async (spender: string, amount: unknown, _overrides: unknown) => {
    const encryptionCalls = mocks.encryptPrivateUint256Input.mock.calls;
    const encryptedPlaintext = encryptionCalls[encryptionCalls.length - 1]?.[1];
    allowance = typeof encryptedPlaintext === 'bigint' ? encryptedPlaintext : 0n;
    return transaction(PRIVATE_TOKEN.encodeFunctionData(
      'approve(address,((uint256,uint256),bytes))',
      [spender, amount]
    ));
  });
  const privateIncrease = vi.fn(async (spender: string, amount: unknown, _overrides: unknown) => {
    const encryptionCalls = mocks.encryptPrivateUint256Input.mock.calls;
    const encryptedPlaintext = encryptionCalls[encryptionCalls.length - 1]?.[1];
    allowance += typeof encryptedPlaintext === 'bigint' ? encryptedPlaintext : 0n;
    return transaction(PRIVATE_TOKEN.encodeFunctionData(
      'increaseAllowance(address,((uint256,uint256),bytes))',
      [spender, amount]
    ));
  });
  const reencryptAllowance = vi.fn(async (spender: string, isSpender: boolean, _overrides: unknown) =>
    transaction(PRIVATE_TOKEN.encodeFunctionData('reencryptAllowance', [spender, isSpender]))
  );
  const setAccountEncryptionAddress = vi.fn(async (owner: string, _overrides: unknown) => {
    encryptionAddress = owner;
    return transaction(
      PRIVATE_TOKEN.encodeFunctionData('setAccountEncryptionAddress', [owner]),
      SETUP_TX_HASH
    );
  });
  const contract = {
    accountEncryptionAddress: vi.fn(async () => encryptionAddress),
    setAccountEncryptionAddress,
    publicAmountsEnabled: vi.fn(async () => publicAmountsEnabled),
    reencryptAllowance,
    'allowance(address,address)': vi.fn(async () => ({
      ciphertext: { ciphertextHigh: 0n, ciphertextLow: 0n },
      ownerCiphertext: { ciphertextHigh: allowance, ciphertextLow: 0n },
      spenderCiphertext: { ciphertextHigh: 0n, ciphertextLow: 0n }
    })),
    'approve(address,uint256)': publicApprove,
    'approve(address,((uint256,uint256),bytes))': privateApprove,
    'increaseAllowance(address,uint256)': publicIncrease,
    'increaseAllowance(address,((uint256,uint256),bytes))': privateIncrease
  };
  mocks.loadCotiEthersModule.mockResolvedValue({
    Contract: vi.fn(function MockContract() { return contract; })
  });
  return {
    contract,
    privateApprove,
    privateIncrease,
    publicApprove,
    publicIncrease,
    reencryptAllowance,
    setAccountEncryptionAddress
  };
};

describe('privateLiquidityActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decryptPrivateUint256Output.mockImplementation((
      _signer: unknown,
      ciphertext: { ciphertextHigh: bigint }
    ) => ciphertext.ciphertextHigh);
    mocks.encryptPrivateUint256Input.mockResolvedValue({
      ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n },
      signature: '0x1234'
    });
  });

  it('binds only the exact current COTI BrowserProvider owner session', async () => {
    const browserProvider = makeBrowserProvider();
    const signer = makeSigner(browserProvider);
    const assertCurrent = vi.fn(() => undefined);
    const assertSnapshotCurrent = vi.fn(() => undefined);
    const capability = await bindPrivateLiquidityMetaMaskCapability({
      signer,
      browserProvider,
      ownerAddress: OWNER,
      chainId: CHAIN_ID,
      assertCurrent,
      assertSnapshotCurrent
    });
    expect(assertSnapshotCurrent).toHaveBeenCalledTimes(1);
    expect(assertCurrent).not.toHaveBeenCalled();
    await expect(assertPrivateLiquidityMetaMaskCapabilityCurrent({
      capability,
      ownerAddress: OWNER,
      chainId: CHAIN_ID
    })).resolves.toBeUndefined();
    expect(assertCurrent).toHaveBeenCalledTimes(1);
    await expect(assertPrivateLiquidityMetaMaskCapabilityCurrent({
      capability: Object.freeze({}) as PrivateLiquidityMetaMaskCapability,
      ownerAddress: OWNER,
      chainId: CHAIN_ID
    })).rejects.toThrow(/browser-wallet capability/);
    await expect(bindPrivateLiquidityMetaMaskCapability({
      signer,
      browserProvider: new JsonRpcProvider() as unknown as BrowserProvider,
      ownerAddress: OWNER,
      chainId: CHAIN_ID,
      assertCurrent: () => undefined
    })).rejects.toThrow(/exact COTI BrowserProvider/);
  });

  it('reads block-hash-pinned owner inventory and complete canonical history without a transaction', async () => {
    const initial = await setup();
    const page = await readCanonicalPrivateLiquidityLogRange({
      capability: initial.readCapability,
      deployment: initial.deployment,
      fromBlock: 100n,
      toBlock: 125n
    });
    const ownerInventory = encodedOwnerInventory();
    const browserProvider = makeBrowserProvider(async (method, params) => {
      if (method !== 'eth_call') throw new Error(`Unexpected owner RPC ${method}.`);
      expect(params[1]).toEqual({ blockHash: blockHash(125n), requireCanonical: true });
      return ownerInventory;
    });
    const signer = makeSigner(browserProvider);
    const capability = await bindPrivateLiquidityMetaMaskCapability({
      signer,
      browserProvider,
      ownerAddress: OWNER,
      chainId: CHAIN_ID,
      assertCurrent: () => undefined
    });
    const loaded = await readPrivateLiquidityOwnerPrivateData({
      capability,
      deployment: initial.deployment,
      position: position(1),
      atBlock: { number: '125', hash: blockHash(125n) },
      pages: [page]
    });
    expect(loaded.inventory).toMatchObject({
      positionId: '1',
      recipient: OWNER,
      sequence: '3',
      baseAmount: '25',
      quoteAmount: '90',
      atBlock: { number: '125', hash: blockHash(125n) }
    });
    expect(loaded.history.coverage.completeFromDeploymentThroughSafeHead).toBe(true);
    expect(loaded.history.history.positionRows).toEqual([]);
    expect(signer.decryptValue).not.toHaveBeenCalled();
  });

  it('reveals wallet-wide private swap history without an owned position or inventory call', async () => {
    const initial = await setup();
    const page = await readCanonicalPrivateLiquidityLogRange({
      capability: initial.readCapability,
      deployment: initial.deployment,
      fromBlock: 100n,
      toBlock: 125n
    });
    const browserProvider = makeBrowserProvider(async (method) => {
      throw new Error(`Wallet-wide history made unexpected RPC ${method}.`);
    });
    const capability = await bindPrivateLiquidityMetaMaskCapability({
      signer: makeSigner(browserProvider),
      browserProvider,
      ownerAddress: OWNER,
      chainId: CHAIN_ID,
      assertCurrent: () => undefined
    });
    const history = await readPrivateLiquidityPrivateHistory({
      capability,
      deployment: initial.deployment,
      pages: [page]
    });
    expect(history.coverage.completeFromDeploymentThroughSafeHead).toBe(true);
    expect(history.history).toEqual({ traderRows: [], positionRows: [], positionTotals: [] });
  });

  it('rejects owner-private reads for a Position NFT owned by another wallet before RPC', async () => {
    const initial = await setup();
    const otherOwnerPosition = { ...position(1), owner: RECIPIENT };
    await expect(readPrivateLiquidityOwnerPrivateData({
      capability: initial.capability,
      deployment: initial.deployment,
      position: otherOwnerPosition,
      atBlock: { number: '125', hash: blockHash(125n) },
      pages: []
    })).rejects.toThrow(/current Position NFT owner/);
  });

  it('rejects an owner snapshot addressed to another recipient', async () => {
    const initial = await setup();
    const page = await readCanonicalPrivateLiquidityLogRange({
      capability: initial.readCapability,
      deployment: initial.deployment,
      fromBlock: 100n,
      toBlock: 125n
    });
    const browserProvider = makeBrowserProvider(async (method) => {
      if (method !== 'eth_call') throw new Error(`Unexpected owner RPC ${method}.`);
      return encodedOwnerInventory({ recipient: RECIPIENT });
    });
    const capability = await bindPrivateLiquidityMetaMaskCapability({
      signer: makeSigner(browserProvider),
      browserProvider,
      ownerAddress: OWNER,
      chainId: CHAIN_ID,
      assertCurrent: () => undefined
    });
    await expect(readPrivateLiquidityOwnerPrivateData({
      capability,
      deployment: initial.deployment,
      position: position(1),
      atBlock: { number: '125', hash: blockHash(125n) },
      pages: [page]
    })).rejects.toThrow(/not initialized for this connected owner/);
  });

  it('rejects malformed self-checking private inventory and incomplete block coverage', async () => {
    const initial = await setup();
    const page = await readCanonicalPrivateLiquidityLogRange({
      capability: initial.readCapability,
      deployment: initial.deployment,
      fromBlock: 100n,
      toBlock: 125n
    });
    const malformedProvider = makeBrowserProvider(async (method) => {
      if (method !== 'eth_call') throw new Error(`Unexpected owner RPC ${method}.`);
      return encodedOwnerInventory({ baseAmount: (25n << 128n) + 1n });
    });
    const malformedCapability = await bindPrivateLiquidityMetaMaskCapability({
      signer: makeSigner(malformedProvider),
      browserProvider: malformedProvider,
      ownerAddress: OWNER,
      chainId: CHAIN_ID,
      assertCurrent: () => undefined
    });
    await expect(readPrivateLiquidityOwnerPrivateData({
      capability: malformedCapability,
      deployment: initial.deployment,
      position: position(1),
      atBlock: { number: '125', hash: blockHash(125n) },
      pages: [page]
    })).rejects.toThrow(/self-check/);

    const stalePage = await readCanonicalPrivateLiquidityLogRange({
      capability: initial.readCapability,
      deployment: initial.deployment,
      fromBlock: 100n,
      toBlock: 124n
    });
    const staleProvider = makeBrowserProvider(async (method, params) => {
      if (method !== 'eth_call') throw new Error(`Unexpected owner RPC ${method}.`);
      expect(params[1]).toEqual({ blockHash: blockHash(125n), requireCanonical: true });
      return encodedOwnerInventory();
    });
    const staleCapability = await bindPrivateLiquidityMetaMaskCapability({
      signer: makeSigner(staleProvider),
      browserProvider: staleProvider,
      ownerAddress: OWNER,
      chainId: CHAIN_ID,
      assertCurrent: () => undefined
    });
    await expect(readPrivateLiquidityOwnerPrivateData({
      capability: staleCapability,
      deployment: initial.deployment,
      position: position(1),
      atBlock: { number: '125', hash: blockHash(125n) },
      pages: [stalePage]
    })).rejects.toThrow(/does not completely cover its canonical safe head/);
  });

  it('uses one packed COTI input, submits exact public route calldata, and confirms its marker', async () => {
    const context = await setup();
    const contract = installSwapContract();
    const submission = await submitPrivateLiquiditySwap({
      capability: context.capability,
      deployment: context.deployment,
      plan: context.plan,
      inputAmount: '100',
      slippageBps: 1_000,
      minimumFillBps: 2_500,
      deadline: 999n
    });
    expect(PRIVATE_LIQUIDITY_SWAP_SELECTOR).toBe('0x9a1af1cb');
    expect(mocks.encryptPrivateUint256Input).toHaveBeenCalledOnce();
    expect(mocks.encryptPrivateUint256Input).toHaveBeenCalledWith(
      context.signer,
      (100n << 128n) + 25n,
      CONTRACT,
      PRIVATE_LIQUIDITY_SWAP_SELECTOR
    );
    expect(contract.swapBest).toHaveBeenCalledWith(
      BASE,
      QUOTE,
      0,
      [1n, 2n],
      [4n, 4n],
      999n,
      { ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature: '0x1234' },
      { gasLimit: getPrivateLiquiditySwapGasLimit(2) }
    );
    expect(getPrivateLiquiditySwapGasLimit(1)).toBe(24_000_000n);
    expect(getPrivateLiquiditySwapGasLimit(2)).toBe(32_000_000n);
    const liveChecksBeforeConfirmation = context.assertCurrent.mock.calls.length;
    const snapshotChecksBeforeConfirmation = context.assertSnapshotCurrent.mock.calls.length;
    await expect(confirmPrivateLiquiditySwap({
      capability: context.capability,
      deployment: context.deployment,
      submission
    })).resolves.toMatchObject({
      swapId: '5',
      trader: OWNER,
      pairKey: PAIR,
      candidateCount: 2,
      inputAmount: '75',
      outputAmount: '750',
      unusedInputAmount: '25',
      submittedTransactionHash: TX_HASH,
      transactionHash: TX_HASH
    });
    expect(context.assertCurrent).toHaveBeenCalledTimes(liveChecksBeforeConfirmation);
    expect(context.assertSnapshotCurrent).toHaveBeenCalledTimes(snapshotChecksBeforeConfirmation);
  });

  it('skips a sufficient input-token allowance and otherwise approves only the missing amount', async () => {
    const context = await setup();
    const ready = installAllowanceContract({ initialAllowance: 100n });
    await expect(ensurePrivateLiquidityInputAllowance({
      capability: context.capability,
      deployment: context.deployment,
      tokenAddress: BASE,
      requiredAmount: 100n
    })).resolves.toEqual({ usedPrivateApproval: false });
    expect(ready.publicApprove).not.toHaveBeenCalled();

    const approval = installAllowanceContract({ initialAllowance: 99n });
    await expect(ensurePrivateLiquidityInputAllowance({
      capability: context.capability,
      deployment: context.deployment,
      tokenAddress: BASE,
      requiredAmount: 100n
    })).resolves.toEqual({ approvalTransactionHash: TX_HASH, usedPrivateApproval: false });
    expect(approval.publicIncrease).toHaveBeenCalledWith(
      CONTRACT,
      1n,
      { gasLimit: PRIVATE_LIQUIDITY_TOKEN_WRITE_GAS_LIMIT }
    );
    expect(approval.publicApprove).not.toHaveBeenCalled();
    expect(mocks.encryptPrivateUint256Input).not.toHaveBeenCalled();
  });

  it('uses one exact encrypted approval when the private token disables public amounts', async () => {
    const context = await setup();
    const approval = installAllowanceContract({ initialAllowance: 0n, publicAmountsEnabled: false });
    await expect(ensurePrivateLiquidityInputAllowance({
      capability: context.capability,
      deployment: context.deployment,
      tokenAddress: BASE,
      requiredAmount: 100n
    })).resolves.toEqual({ approvalTransactionHash: TX_HASH, usedPrivateApproval: true });
    expect(approval.privateApprove).toHaveBeenCalledWith(CONTRACT, {
      ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n },
      signature: '0x1234'
    }, { gasLimit: PRIVATE_LIQUIDITY_TOKEN_WRITE_GAS_LIMIT });
    expect(mocks.encryptPrivateUint256Input).toHaveBeenCalledWith(
      context.signer,
      100n,
      BASE,
      PRIVATE_TOKEN.getFunction('approve(address,((uint256,uint256),bytes))')?.selector
    );
    expect(mocks.decryptPrivateUint256Output).not.toHaveBeenCalled();
  });

  it('keeps reuse-existing allowance policy strictly read-only when allowance is insufficient', async () => {
    const context = await setup();
    const allowance = installAllowanceContract({ initialAllowance: 99n, publicAmountsEnabled: false });
    await expect(ensurePrivateLiquidityInputAllowance({
      capability: context.capability,
      deployment: context.deployment,
      tokenAddress: BASE,
      requiredAmount: 100n,
      approvalPolicy: 'reuse-existing'
    })).rejects.toThrow('existing private allowance is below the required deposit');
    expect(allowance.setAccountEncryptionAddress).not.toHaveBeenCalled();
    expect(allowance.reencryptAllowance).not.toHaveBeenCalled();
    expect(allowance.publicApprove).not.toHaveBeenCalled();
    expect(allowance.privateApprove).not.toHaveBeenCalled();
    expect(allowance.publicIncrease).not.toHaveBeenCalled();
    expect(allowance.privateIncrease).not.toHaveBeenCalled();
  });

  it('increases a nonzero private allowance without an unsafe approve reset', async () => {
    const context = await setup();
    const approval = installAllowanceContract({ initialAllowance: 40n, publicAmountsEnabled: false });
    await expect(ensurePrivateLiquidityInputAllowance({
      capability: context.capability,
      deployment: context.deployment,
      tokenAddress: BASE,
      requiredAmount: 100n
    })).resolves.toEqual({ approvalTransactionHash: TX_HASH, usedPrivateApproval: true });
    expect(approval.privateApprove).not.toHaveBeenCalled();
    expect(approval.privateIncrease).toHaveBeenCalledWith(CONTRACT, {
      ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n },
      signature: '0x1234'
    }, { gasLimit: PRIVATE_LIQUIDITY_TOKEN_WRITE_GAS_LIMIT });
    expect(mocks.encryptPrivateUint256Input).toHaveBeenCalledWith(
      context.signer,
      60n,
      BASE,
      PRIVATE_TOKEN.getFunction('increaseAllowance(address,((uint256,uint256),bytes))')?.selector
    );
  });

  it('refreshes a private allowance ciphertext that belongs to an older AES key', async () => {
    const context = await setup();
    mocks.decryptPrivateUint256Output
      .mockImplementationOnce(() => UINT128_MAX + 1n)
      .mockImplementation((_signer: unknown, ciphertext: { ciphertextHigh: bigint }) => ciphertext.ciphertextHigh);
    const approval = installAllowanceContract({ initialAllowance: 100n, publicAmountsEnabled: false });
    await expect(ensurePrivateLiquidityInputAllowance({
      capability: context.capability,
      deployment: context.deployment,
      tokenAddress: BASE,
      requiredAmount: 100n
    })).resolves.toEqual({
      allowanceRefreshTransactionHash: TX_HASH,
      usedPrivateApproval: false
    });
    expect(approval.reencryptAllowance).toHaveBeenCalledWith(
      CONTRACT,
      false,
      { gasLimit: PRIVATE_LIQUIDITY_TOKEN_WRITE_GAS_LIMIT }
    );
    expect(approval.privateApprove).not.toHaveBeenCalled();
  });

  it('requests one fresh wallet privacy key instead of looping allowance refresh transactions', async () => {
    const context = await setup();
    mocks.decryptPrivateUint256Output.mockReturnValue(UINT128_MAX + 1n);
    const allowance = installAllowanceContract({ initialAllowance: 100n, publicAmountsEnabled: false });
    const result = ensurePrivateLiquidityInputAllowance({
      capability: context.capability,
      deployment: context.deployment,
      tokenAddress: BASE,
      requiredAmount: 100n
    });

    await expect(result).rejects.toSatisfy(isPrivateLiquidityAllowancePrivacyRefreshRequired);
    expect(allowance.reencryptAllowance).toHaveBeenCalledTimes(1);
    expect(allowance.privateApprove).not.toHaveBeenCalled();
    expect(allowance.privateIncrease).not.toHaveBeenCalled();
  });

  it('performs the one-time token privacy-address setup before reusing an existing allowance', async () => {
    const context = await setup();
    const setupRequired = installAllowanceContract({
      initialAllowance: 100n,
      configuredAddress: address('00')
    });
    await expect(ensurePrivateLiquidityInputAllowance({
      capability: context.capability,
      deployment: context.deployment,
      tokenAddress: BASE,
      requiredAmount: 100n
    })).resolves.toEqual({
      accountSetupTransactionHash: SETUP_TX_HASH,
      usedPrivateApproval: false
    });
    expect(setupRequired.setAccountEncryptionAddress).toHaveBeenCalledWith(
      OWNER,
      { gasLimit: PRIVATE_LIQUIDITY_TOKEN_WRITE_GAS_LIMIT }
    );
    expect(setupRequired.publicApprove).not.toHaveBeenCalled();
  });

  it('rejects a receipt marker for another pair and any forged local submission', async () => {
    const context = await setup();
    installSwapContract({ wrongMarker: true });
    const submission = await submitPrivateLiquiditySwap({
      capability: context.capability,
      deployment: context.deployment,
      plan: context.plan,
      inputAmount: '100',
      slippageBps: 1_000,
      minimumFillBps: 2_500,
      deadline: 999n
    });
    await expect(confirmPrivateLiquiditySwap({
      capability: context.capability,
      deployment: context.deployment,
      submission
    })).rejects.toThrow(/marker is invalid/);
    await expect(confirmPrivateLiquiditySwap({
      capability: context.capability,
      deployment: context.deployment,
      submission: { ...submission } as PrivateLiquiditySwapSubmission
    })).rejects.toThrow(/exact local submission/);
  });

  it('creates an NFT position with one packed private input and confirms the exact position marker', async () => {
    const context = await setup();
    const createPosition = installPositionContract({
      method: 'createPosition',
      eventName: 'PrivateLiquidityPositionCreated',
      eventArgs: [7n, OWNER, PAIR, BASE, QUOTE, [1n, 9n], [1n, 11n], 100n, 1n]
    });
    const submission = await submitPrivateLiquidityPositionAction({
      capability: context.capability,
      deployment: context.deployment,
      action: {
        kind: 'create',
        baseToken: BASE,
        quoteToken: QUOTE,
        buyTerms: { baseAmount: '1', quoteAmount: '9' },
        sellTerms: { baseAmount: '1', quoteAmount: '11' },
        baseInventory: 3n,
        quoteInventory: 4n
      }
    });
    expect(PRIVATE_LIQUIDITY_CREATE_POSITION_SELECTOR).toMatch(/^0x[0-9a-f]{8}$/);
    expect(mocks.encryptPrivateUint256Input).toHaveBeenCalledOnce();
    expect(mocks.encryptPrivateUint256Input).toHaveBeenCalledWith(
      context.signer,
      (3n << 128n) + 4n,
      CONTRACT,
      PRIVATE_LIQUIDITY_CREATE_POSITION_SELECTOR
    );
    expect(createPosition).toHaveBeenCalledWith(
      BASE,
      QUOTE,
      { baseAmount: 1n, quoteAmount: 9n },
      { baseAmount: 1n, quoteAmount: 11n },
      { ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature: '0x1234' },
      { gasLimit: PRIVATE_LIQUIDITY_ACTION_GAS_LIMIT }
    );
    const liveChecksBeforeConfirmation = context.assertCurrent.mock.calls.length;
    context.assertCurrent.mockImplementation(() => {
      throw new Error('Owner wallet session changed after broadcast.');
    });
    await expect(confirmPrivateLiquidityPositionAction({
      capability: context.capability,
      deployment: context.deployment,
      submission
    })).resolves.toMatchObject({
      action: 'create',
      positionId: '7',
      submittedTransactionHash: TX_HASH,
      transactionHash: TX_HASH,
      blockNumber: '121',
      logIndex: 4
    });
    expect(context.assertCurrent).toHaveBeenCalledTimes(liveChecksBeforeConfirmation);
  });

  it.each([
    ['add-liquidity', 'addLiquidity', PRIVATE_LIQUIDITY_ADD_LIQUIDITY_SELECTOR],
    ['remove-liquidity', 'removeLiquidity', PRIVATE_LIQUIDITY_REMOVE_LIQUIDITY_SELECTOR]
  ] as const)('uses one packed private input for %s', async (kind, method, selector) => {
    const context = await setup();
    const call = installPositionContract({
      method,
      eventName: 'PrivateLiquidityPositionLiquidityChanged',
      eventArgs: [7n, OWNER, OWNER, 5n]
    });
    const submission = await submitPrivateLiquidityPositionAction({
      capability: context.capability,
      deployment: context.deployment,
      action: {
        kind,
        positionId: 7n,
        expectedRevision: 4n,
        baseAmount: 12n,
        quoteAmount: 13n
      }
    });
    expect(selector).toMatch(/^0x[0-9a-f]{8}$/);
    expect(mocks.encryptPrivateUint256Input).toHaveBeenCalledOnce();
    expect(mocks.encryptPrivateUint256Input).toHaveBeenCalledWith(
      context.signer,
      (12n << 128n) + 13n,
      CONTRACT,
      selector
    );
    expect(call).toHaveBeenCalledWith(
      7n,
      4n,
      { ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature: '0x1234' },
      { gasLimit: PRIVATE_LIQUIDITY_ACTION_GAS_LIMIT }
    );
    await expect(confirmPrivateLiquidityPositionAction({
      capability: context.capability,
      deployment: context.deployment,
      submission
    })).resolves.toMatchObject({ action: kind, positionId: '7' });
  });

  it.each([
    {
      kind: 'update-terms' as const,
      method: 'updatePositionTerms',
      eventName: 'PrivateLiquidityPositionTermsUpdated',
      eventArgs: [7n, OWNER, [1n, 9n], [1n, 11n], 5n],
      action: {
        kind: 'update-terms' as const,
        positionId: 7n,
        expectedRevision: 4n,
        buyTerms: { baseAmount: '1', quoteAmount: '9' },
        sellTerms: { baseAmount: '1', quoteAmount: '11' }
      }
    },
    {
      kind: 'pause' as const,
      method: 'pausePosition',
      eventName: 'PrivateLiquidityPositionStatusChanged',
      eventArgs: [7n, OWNER, 0, 1, OWNER, 5n],
      action: { kind: 'pause' as const, positionId: 7n, expectedRevision: 4n }
    },
    {
      kind: 'resume' as const,
      method: 'resumePosition',
      eventName: 'PrivateLiquidityPositionStatusChanged',
      eventArgs: [7n, OWNER, 1, 0, OWNER, 5n],
      action: { kind: 'resume' as const, positionId: 7n, expectedRevision: 4n }
    },
    {
      kind: 'activate-privacy' as const,
      method: 'activatePositionPrivacy',
      eventName: 'PrivateLiquidityPositionPrivacyActivated',
      eventArgs: [7n, OWNER, true, 5n],
      action: { kind: 'activate-privacy' as const, positionId: 7n, expectedRevision: 4n, resume: true }
    },
    {
      kind: 'transfer' as const,
      method: 'transferPosition',
      eventName: 'PrivateLiquidityPositionTransferActivationRequired',
      eventArgs: [7n, OWNER, RECIPIENT, 5n],
      action: {
        kind: 'transfer' as const,
        positionId: 7n,
        expectedRevision: 4n,
        recipient: RECIPIENT
      }
    },
    {
      kind: 'close' as const,
      method: 'closePosition',
      eventName: 'PrivateLiquidityPositionClosed',
      eventArgs: [7n, OWNER],
      action: { kind: 'close' as const, positionId: 7n, expectedRevision: 4n }
    }
  ])('submits $kind without a private-input confirmation and reconciles its exact marker', async ({
    kind,
    method,
    eventName,
    eventArgs,
    action
  }) => {
    const context = await setup();
    installPositionContract({ method, eventName, eventArgs });
    const submission = await submitPrivateLiquidityPositionAction({
      capability: context.capability,
      deployment: context.deployment,
      action
    });
    expect(mocks.encryptPrivateUint256Input).not.toHaveBeenCalled();
    await expect(confirmPrivateLiquidityPositionAction({
      capability: context.capability,
      deployment: context.deployment,
      submission
    })).resolves.toMatchObject({ action: kind, positionId: '7' });
  });

  it('fails before prompting for crossed terms, empty amounts, and forged position submissions', async () => {
    const context = await setup();
    await expect(submitPrivateLiquidityPositionAction({
      capability: context.capability,
      deployment: context.deployment,
      action: {
        kind: 'create',
        baseToken: BASE,
        quoteToken: QUOTE,
        buyTerms: { baseAmount: '1', quoteAmount: '12' },
        sellTerms: { baseAmount: '1', quoteAmount: '11' },
        baseInventory: 1n,
        quoteInventory: 1n
      }
    })).rejects.toThrow(/cannot cross/);
    await expect(submitPrivateLiquidityPositionAction({
      capability: context.capability,
      deployment: context.deployment,
      action: {
        kind: 'add-liquidity',
        positionId: 7n,
        expectedRevision: 4n,
        baseAmount: 0n,
        quoteAmount: 0n
      }
    })).rejects.toThrow(/at least one positive/);
    await expect(submitPrivateLiquidityPositionAction({
      capability: context.capability,
      deployment: context.deployment,
      action: {
        kind: 'transfer',
        positionId: 7n,
        expectedRevision: 4n,
        recipient: OWNER
      }
    })).rejects.toThrow(/must differ/);
    expect(mocks.encryptPrivateUint256Input).not.toHaveBeenCalled();
    await expect(confirmPrivateLiquidityPositionAction({
      capability: context.capability,
      deployment: context.deployment,
      submission: Object.freeze({}) as never
    })).rejects.toThrow(/exact local submission/);
  });
});
