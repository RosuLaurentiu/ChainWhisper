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
  CHAINWHISPER_TESTNET_CANDIDATE_CONFIG,
  type ActiveTestnetCandidateConfig,
  type TestnetCandidateComponentKey
} from './chainWhisperTestnetCandidate';
import {
  assertOwnerTradeV2CapabilitySnapshotCurrent,
  getOwnerTradeV2CapabilityBinding,
  type OwnerTradeV2MetaMaskCapability
} from './ownerTradeV2Capability';

const TOKEN_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'publicTestTokenA', label: 'cwTUB', name: 'Public Base', kind: 'public' }),
  Object.freeze({ key: 'publicTestTokenB', label: 'cwTUQ', name: 'Public Quote', kind: 'public' }),
  Object.freeze({ key: 'privateTestTokenA', label: 'cwTPB', name: 'Private Base', kind: 'private' }),
  Object.freeze({ key: 'privateTestTokenB', label: 'cwTPQ', name: 'Private Quote', kind: 'private' })
] as const satisfies readonly Readonly<{
  key: TestnetCandidateComponentKey;
  kind: 'public' | 'private';
  label: string;
  name: string;
}>[]);

export type TestnetFaucetTokenKey = typeof TOKEN_DEFINITIONS[number]['key'];
export type TestnetFaucetToken = Readonly<{
  address: string;
  claimed: boolean;
  decimals: number;
  faucetAmount: bigint;
  key: TestnetFaucetTokenKey;
  kind: 'public' | 'private';
  label: string;
  name: string;
}>;
export type TestnetFaucetState = Readonly<{
  claimed: number;
  next: TestnetFaucetToken | null;
  tokens: readonly TestnetFaucetToken[];
  total: number;
}>;

const ABI = Object.freeze([
  'function claimFaucet()',
  'function faucetClaimed(address account) view returns (bool)',
  'function faucetAmount() view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function publicAmountsEnabled() view returns (bool)'
]);
const INTERFACE = new Interface(ABI);
const CLAIM_DATA = INTERFACE.encodeFunctionData('claimFaucet');
const PUBLIC_FAUCET_GAS_LIMIT = 500_000n;
const PRIVATE_FAUCET_GAS_LIMIT = 12_000_000n;

export type TestnetFaucetReader = Readonly<{
  destroy?(): void;
  getChainId(): Promise<bigint>;
  getCode(address: string): Promise<string>;
  readToken(address: string, walletAddress: string, isPrivate: boolean): Promise<Readonly<{
    claimed: boolean;
    decimals: bigint;
    faucetAmount: bigint;
    publicAmountsEnabled?: boolean;
    symbol: string;
  }>>;
}>;

export const buildTestnetFaucetTransactionRequest = (
  token: Pick<TestnetFaucetToken, 'address' | 'kind'>
): Readonly<{ to: string; data: string; value: bigint; gasLimit: bigint }> => Object.freeze({
  to: token.address,
  data: CLAIM_DATA,
  value: 0n,
  // Private-token minting executes COTI MPC work. MetaMask's COTI testnet
  // estimator is unreliable for this path, so use the reviewed deployment
  // ceiling and let the receipt charge only the gas actually consumed.
  gasLimit: token.kind === 'private' ? PRIVATE_FAUCET_GAS_LIMIT : PUBLIC_FAUCET_GAS_LIMIT
});

const activeConfig = (): ActiveTestnetCandidateConfig => {
  if (CHAINWHISPER_TESTNET_CANDIDATE_CONFIG.status !== 'active') {
    throw new Error('The unified COTI testnet candidate is not active.');
  }
  return CHAINWHISPER_TESTNET_CANDIDATE_CONFIG;
};

const createReader = (config: ActiveTestnetCandidateConfig): TestnetFaucetReader => {
  const provider = new JsonRpcProvider(
    config.rpcUrl,
    { chainId: Number(config.chainId), name: 'COTI Testnet' },
    { batchMaxCount: 1, staticNetwork: false }
  );
  return Object.freeze({
    destroy: () => provider.destroy(),
    getChainId: async () => (await provider.getNetwork()).chainId,
    getCode: (address: string) => provider.getCode(address),
    readToken: async (address: string, walletAddress: string, isPrivate: boolean) => {
      const token = new Contract(address, ABI, provider);
      const [claimed, faucetAmount, symbol, decimals, publicAmountsEnabled] = await Promise.all([
        token.faucetClaimed(walletAddress),
        token.faucetAmount(),
        token.symbol(),
        token.decimals(),
        isPrivate ? token.publicAmountsEnabled() : Promise.resolve(undefined)
      ]);
      return Object.freeze({
        claimed: claimed === true,
        decimals: BigInt(decimals),
        faucetAmount: BigInt(faucetAmount),
        ...(isPrivate ? { publicAmountsEnabled: publicAmountsEnabled === true } : {}),
        symbol: String(symbol)
      });
    }
  });
};

export const inspectChainWhisperTestnetFaucetWithReader = async ({
  config,
  reader,
  walletAddress
}: {
  config: ActiveTestnetCandidateConfig;
  reader: TestnetFaucetReader;
  walletAddress: string;
}): Promise<TestnetFaucetState> => {
  const wallet = getAddress(walletAddress).toLowerCase();
  if (await reader.getChainId() !== BigInt(config.chainId)) {
    throw new Error('Test-token faucet reader is connected to the wrong chain.');
  }
  const tokens = await Promise.all(TOKEN_DEFINITIONS.map(async (definition): Promise<TestnetFaucetToken> => {
    const component = config.components[definition.key];
    const code = await reader.getCode(component.address);
    if (code === '0x' || keccak256(code).toLowerCase() !== component.runtimeBytecodeHash) {
      throw new Error(`${definition.label} runtime does not match the unified candidate.`);
    }
    const state = await reader.readToken(component.address, wallet, definition.kind === 'private');
    if (state.symbol !== definition.label || state.decimals !== 6n || state.faucetAmount <= 0n ||
        (definition.kind === 'private' && state.publicAmountsEnabled !== false)) {
      throw new Error(`${definition.label} faucet metadata does not match the reviewed test token.`);
    }
    return Object.freeze({
      ...definition,
      address: component.address,
      claimed: state.claimed,
      decimals: Number(state.decimals),
      faucetAmount: state.faucetAmount
    });
  }));
  const claimed = tokens.filter((token) => token.claimed).length;
  return Object.freeze({
    claimed,
    next: tokens.find((token) => !token.claimed) ?? null,
    tokens: Object.freeze(tokens),
    total: tokens.length
  });
};

export const inspectChainWhisperTestnetFaucet = async (
  walletAddress: string
): Promise<TestnetFaucetState> => {
  const config = activeConfig();
  const reader = createReader(config);
  try {
    return await inspectChainWhisperTestnetFaucetWithReader({ config, reader, walletAddress });
  } finally {
    reader.destroy?.();
  }
};

type FaucetTransaction = Readonly<{
  chainId?: bigint | number | string | null;
  data: string;
  from: string;
  to: string | null;
  value: bigint;
}>;

export const validateTestnetFaucetTransaction = ({
  chainId,
  data,
  from,
  to,
  value
}: FaucetTransaction, {
  expectedChainId,
  expectedFrom,
  expectedToken
}: {
  expectedChainId: bigint;
  expectedFrom: string;
  expectedToken: string;
}): void => {
  let returnedChainMatches = chainId === null || chainId === undefined;
  if (chainId !== null && chainId !== undefined) {
    try {
      returnedChainMatches = BigInt(chainId) === expectedChainId;
    } catch {
      returnedChainMatches = false;
    }
  }
  if (!returnedChainMatches || getAddress(from).toLowerCase() !== expectedFrom.toLowerCase() ||
      !to || getAddress(to).toLowerCase() !== expectedToken.toLowerCase() || value !== 0n ||
      data.toLowerCase() !== CLAIM_DATA.toLowerCase()) {
    throw new Error('The connected wallet returned a transaction that does not match the selected faucet claim.');
  }
};

const waitForReceipt = async (
  transaction: TransactionResponse,
  config: ActiveTestnetCandidateConfig
): Promise<TransactionReceipt> => {
  const provider = new JsonRpcProvider(
    config.rpcUrl,
    { chainId: Number(config.chainId), name: 'COTI Testnet' },
    { batchMaxCount: 1, staticNetwork: false }
  );
  try {
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      try {
        const receipt = await provider.getTransactionReceipt(transaction.hash);
        if (receipt) return receipt;
      } catch {
        // A transient public testnet RPC failure must not turn a broadcast
        // wallet transaction into an immediate false failure.
      }
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 2_000));
    }
    throw new Error('The faucet transaction was submitted, but COTI confirmation timed out. Check wallet activity before retrying.');
  } finally {
    provider.destroy();
  }
};

export const claimChainWhisperTestnetToken = async ({
  capability,
  expectedTokenKey,
  onSubmitted
}: {
  capability: OwnerTradeV2MetaMaskCapability;
  expectedTokenKey: TestnetFaucetTokenKey;
  onSubmitted?: (transactionHash: string) => void;
}): Promise<Readonly<{ state: TestnetFaucetState; transactionHash: string }>> => {
  const config = activeConfig();
  const binding = getOwnerTradeV2CapabilityBinding(capability);
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  if (binding.chainId !== BigInt(config.chainId)) throw new Error('Test-token faucet requires COTI Testnet.');
  const before = await inspectChainWhisperTestnetFaucet(binding.ownerAddress);
  const selectedToken = before.tokens.find(({ key }) => key === expectedTokenKey);
  if (!selectedToken) throw new Error('The selected reviewed test token is unavailable.');
  if (selectedToken.claimed) throw new Error(`${selectedToken.label} was already claimed by this wallet.`);
  const expected = {
    expectedChainId: BigInt(config.chainId),
    expectedFrom: binding.ownerAddress,
    expectedToken: selectedToken.address
  };
  await assertOwnerTradeV2CapabilitySnapshotCurrent(binding);
  const transaction = await binding.signer.sendTransaction(
    buildTestnetFaucetTransactionRequest(selectedToken)
  );
  validateTestnetFaucetTransaction(transaction, expected);
  onSubmitted?.(transaction.hash.toLowerCase());
  // Once MetaMask has broadcast the exact transaction, confirmation is read
  // from the independent COTI RPC. Polling the extension here was a major
  // source of service-worker crashes during testnet instability.
  const receipt = await waitForReceipt(transaction, config);
  if (receipt.status !== 1 || receipt.from.toLowerCase() !== binding.ownerAddress.toLowerCase() ||
      receipt.to?.toLowerCase() !== selectedToken.address) {
    throw new Error('Test-token faucet receipt does not match the selected claim.');
  }
  const retryDelays = [0, 250, 750, 1_500] as const;
  let state: TestnetFaucetState | null = null;
  for (const delayMs of retryDelays) {
    if (delayMs > 0) await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
    try {
      state = await inspectChainWhisperTestnetFaucet(binding.ownerAddress);
    } catch {
      continue;
    }
    if (state.tokens.find(({ key }) => key === expectedTokenKey)?.claimed) break;
  }
  if (!state?.tokens.find(({ key }) => key === expectedTokenKey)?.claimed) {
    // The exact successful receipt is authoritative. Reflect the confirmed
    // claim locally and let the panel's normal recheck converge later.
    const tokens = before.tokens.map((token) => token.key === expectedTokenKey
      ? Object.freeze({ ...token, claimed: true })
      : token);
    state = Object.freeze({
      claimed: tokens.filter(({ claimed }) => claimed).length,
      next: tokens.find(({ claimed }) => !claimed) ?? null,
      tokens: Object.freeze(tokens),
      total: tokens.length
    });
  }
  return Object.freeze({ transactionHash: receipt.hash.toLowerCase(), state });
};

export const isChainWhisperTestnetFaucetActive = (): boolean =>
  CHAINWHISPER_TESTNET_CANDIDATE_CONFIG.status === 'active';
