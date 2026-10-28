import type {
  CotiSnapOperation,
  RealWalletPhase,
  WalletPromptKind
} from './promptEvidence';

export const COTI_TESTNET_CHAIN_ID = '7082400';
export const COTI_SNAP_ID = 'npm:@coti-io/coti-snap';
export const PINNED_COTI_SNAP_VERSION = '1.0.52-eeccdb';
export const PINNED_METAMASK_VERSION = '13.41.0.0';
export const PINNED_METAMASK_OFFICIAL_ARCHIVE_SHA256 =
  '4d651e5e1b63d24202e3004f82925be4449161d06045526d7a37c026b7ef2afc';
export const PINNED_METAMASK_DIRECTORY_SHA256 =
  '76e3dd8101e2c4700c131345d6a0018677e48418d5a0e3f9c753bedbd2a5cf43';

export type RealWalletScenario = {
  schemaVersion: 1;
  manifest: {
    chainId: typeof COTI_TESTNET_CHAIN_ID;
    contractAddress: string;
    deploymentBlock: string;
    runtimeBytecodeHash: string;
  };
  maxTransactionValueWei: '0';
  participants: {
    alice: string;
    bob: string;
  };
};

export type MetaMaskSurface =
  | { state: 'idle'; identity: string }
  | {
      state: 'prompt';
      identity: string;
      kind: WalletPromptKind;
      requiresExplicitDecision: boolean;
    };

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const FORBIDDEN_ENV_NAME_PATTERN =
  /(?:AES_?KEY|CREDENTIAL|MNEMONIC|PASSPHRASE|PASSWORD|PRIVATE_?KEY|RECOVERY_?PHRASE|SEED|SECRET)/i;
const SAFE_READ_RPC_METHODS = [
  'eth_accounts',
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getLogs',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas'
] as const;

const RPC_METHODS_BY_PHASE: Record<RealWalletPhase, ReadonlySet<string>> = {
  'wallet-connect': new Set(['eth_chainId', 'eth_requestAccounts']),
  'snap-unlock': new Set(['eth_accounts', 'eth_chainId', 'wallet_getSnaps', 'wallet_invokeSnap']),
  'deployment-attestation': new Set(SAFE_READ_RPC_METHODS),
  'warm-create': new Set([...SAFE_READ_RPC_METHODS, 'eth_sendTransaction']),
  'envelope-recovery': new Set(SAFE_READ_RPC_METHODS),
  'warm-send': new Set([...SAFE_READ_RPC_METHODS, 'eth_sendTransaction']),
  'warm-rotate': new Set([...SAFE_READ_RPC_METHODS, 'eth_sendTransaction']),
  'snap-install': new Set(['wallet_getSnaps', 'wallet_requestSnaps']),
  'privacy-onboarding': new Set([
    ...SAFE_READ_RPC_METHODS,
    'eth_accounts',
    'personal_sign',
    'eth_sendTransaction'
  ]),
  'snap-key-store': new Set(['eth_accounts', 'eth_chainId', 'wallet_invokeSnap'])
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const attestPinnedCotiSnapVersion = (
  installedSnaps: unknown
): typeof PINNED_COTI_SNAP_VERSION => {
  if (!isRecord(installedSnaps)) {
    throw new Error('COTI Snap discovery returned an invalid manifest map.');
  }
  const installed = installedSnaps[COTI_SNAP_ID];
  if (!isRecord(installed) || installed.version !== PINNED_COTI_SNAP_VERSION) {
    throw new Error('COTI Snap does not match the reviewed release pin.');
  }
  return PINNED_COTI_SNAP_VERSION;
};

const assertExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must use the exact public measurement schema.`);
  }
};

const normalizeAddress = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !ADDRESS_PATTERN.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${label} must be a non-zero address.`);
  }
  return value.toLowerCase();
};

const normalizeDecimal = (value: unknown, label: string, allowZero: boolean): string => {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical decimal integer string.`);
  }
  const normalized = BigInt(value).toString();
  if (!allowZero && normalized === '0') {
    throw new Error(`${label} must be positive.`);
  }
  return normalized;
};

export const parseRealWalletScenario = (input: unknown): RealWalletScenario => {
  if (!isRecord(input)) {
    throw new Error('Real-wallet scenario must be a JSON object.');
  }
  assertExactKeys(
    input,
    ['manifest', 'maxTransactionValueWei', 'participants', 'schemaVersion'],
    'Real-wallet scenario'
  );
  if (input.schemaVersion !== 1 || !isRecord(input.manifest) || !isRecord(input.participants)) {
    throw new Error('Real-wallet scenario schema version or nested objects are invalid.');
  }
  assertExactKeys(
    input.manifest,
    ['chainId', 'contractAddress', 'deploymentBlock', 'runtimeBytecodeHash'],
    'Deployment manifest'
  );
  assertExactKeys(input.participants, ['alice', 'bob'], 'Scenario participants');

  const chainId = normalizeDecimal(input.manifest.chainId, 'Chain ID', false);
  if (chainId !== COTI_TESTNET_CHAIN_ID) {
    throw new Error('The real-wallet lane is hard-locked to COTI testnet chain 7082400.');
  }
  const maxTransactionValueWei = normalizeDecimal(
    input.maxTransactionValueWei,
    'Maximum transaction value',
    true
  );
  if (maxTransactionValueWei !== '0') {
    throw new Error('The real-wallet lane requires a zero transaction-value ceiling.');
  }

  const contractAddress = normalizeAddress(input.manifest.contractAddress, 'Contract address');
  const alice = normalizeAddress(input.participants.alice, 'Alice address');
  const bob = normalizeAddress(input.participants.bob, 'Bob address');
  if (alice === bob || alice === contractAddress || bob === contractAddress) {
    throw new Error('Scenario participant and contract addresses must be distinct.');
  }
  if (
    typeof input.manifest.runtimeBytecodeHash !== 'string' ||
    !BYTES32_PATTERN.test(input.manifest.runtimeBytecodeHash)
  ) {
    throw new Error('Runtime bytecode hash must be bytes32.');
  }

  return {
    schemaVersion: 1,
    manifest: {
      chainId: COTI_TESTNET_CHAIN_ID,
      contractAddress,
      deploymentBlock: normalizeDecimal(input.manifest.deploymentBlock, 'Deployment block', false),
      runtimeBytecodeHash: input.manifest.runtimeBytecodeHash.toLowerCase()
    },
    maxTransactionValueWei: '0',
    participants: { alice, bob }
  };
};

export const findForbiddenRealWalletEnvironmentKeys = (
  environment: Record<string, string | undefined>
): string[] =>
  Object.keys(environment)
    .filter(
      (key) => key.startsWith('CW_REAL_WALLET_') && FORBIDDEN_ENV_NAME_PATTERN.test(key)
    )
    .sort();

const normalizeRoute = (hash: string): string => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(hash);
  } catch {
    throw new Error('Unknown MetaMask surface.');
  }
  const withoutHash = decoded.replace(/^#/, '');
  const path = withoutHash.split(/[?&]/, 1)[0]?.replace(/^\/+/, '').replace(/\/+$/, '') ?? '';
  return path ? `/${path.toLowerCase()}` : '/';
};

const promptSurface = (
  identity: string,
  kind: WalletPromptKind,
  requiresExplicitDecision = false
): MetaMaskSurface => ({
  state: 'prompt',
  identity,
  kind,
  requiresExplicitDecision
});

const isCorrelatableConfirmationHint = (
  hint: WalletPromptKind | null | undefined
): hint is WalletPromptKind =>
  hint === 'snap-aes-access' ||
  hint === 'snap-connect-wallet' ||
  hint === 'snap-install' ||
  hint === 'snap-key-store' ||
  hint === 'signature' ||
  hint === 'transaction' ||
  hint === 'wallet-connect';

export const classifyMetaMaskSurface = ({
  extensionId,
  promptHint,
  url
}: {
  extensionId: string;
  phase: RealWalletPhase;
  promptHint?: WalletPromptKind | null;
  url: string;
}): MetaMaskSurface | null => {
  if (!EXTENSION_ID_PATTERN.test(extensionId)) {
    throw new Error('Pinned MetaMask extension ID is invalid.');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Unknown MetaMask surface.');
  }
  if (parsed.protocol !== 'chrome-extension:' || parsed.hostname !== extensionId) {
    return null;
  }

  const page = parsed.pathname.toLowerCase();
  if (!/(?:home|notification)\.html$/.test(page)) {
    throw new Error('Unknown MetaMask surface.');
  }
  const route = normalizeRoute(parsed.hash);
  const identity = `${page}${parsed.search.toLowerCase()}${parsed.hash.toLowerCase() || '#'}`;

  if (/home\.html$/.test(page) && (route === '/' || route === '/home')) {
    return { state: 'idle', identity };
  }
  if (/^\/unlock(?:\/[^/]+)?$/.test(route)) {
    return promptSurface(identity, 'wallet-unlock');
  }
  if (/^\/(?:connect-with-site|permissions-connect|choose-account|connect\/account)(?:\/[^/]+)?$/.test(route)) {
    return promptSurface(identity, 'wallet-connect');
  }
  if (/^\/(?:snap-install|install-snap|snaps\/install|snap-update)(?:\/[^/]+)?$/.test(route)) {
    return promptSurface(identity, 'snap-install');
  }
  if (/^\/(?:confirm-signature-request|signature-request)\/[^/]+$/.test(route)) {
    if (promptHint !== 'signature') throw new Error('Uncorrelated MetaMask signature surface.');
    return promptSurface(identity, 'signature');
  }
  if (route === '/confirm-signature-request' || route === '/signature-request') {
    throw new Error('MetaMask signature surface is missing its request identity.');
  }
  if (/^\/confirm-transaction\/[^/]+$/.test(route)) {
    if (promptHint !== 'transaction') throw new Error('Uncorrelated MetaMask transaction surface.');
    return promptSurface(identity, 'transaction');
  }
  if (route === '/confirm-transaction') {
    throw new Error('MetaMask transaction surface is missing its request identity.');
  }
  if (route === '/confirmation') {
    if (!isCorrelatableConfirmationHint(promptHint)) {
      throw new Error('Uncorrelated MetaMask confirmation surface.');
    }
    return promptSurface(identity, promptHint, true);
  }
  if (/^\/(?:snap-dialog|invoke-snap|snaps\/dialog)(?:\/[^/]+)?$/.test(route)) {
    if (
      promptHint !== 'snap-connect-wallet' &&
      promptHint !== 'snap-aes-access' &&
      promptHint !== 'snap-key-store'
    ) {
      throw new Error('Uncorrelated MetaMask Snap surface.');
    }
    return promptSurface(identity, promptHint);
  }
  throw new Error('Unknown MetaMask surface.');
};

export const assertPromptAllowedInPhase = (
  phase: RealWalletPhase,
  kind: WalletPromptKind
): void => {
  const allowed: Partial<Record<RealWalletPhase, readonly WalletPromptKind[]>> = {
    'snap-unlock': ['snap-connect-wallet', 'snap-aes-access'],
    'snap-install': ['snap-install'],
    'privacy-onboarding': ['signature', 'transaction'],
    'snap-key-store': ['snap-connect-wallet', 'snap-key-store'],
    'wallet-connect': ['wallet-unlock', 'wallet-connect'],
    'warm-create': ['transaction'],
    'warm-rotate': ['transaction'],
    'warm-send': ['transaction']
  };
  if (!allowed[phase]?.includes(kind)) {
    throw new Error(`Unexpected MetaMask prompt category during ${phase}.`);
  }
};

export const parseCotiSnapOperation = (
  params: object | unknown[] | undefined
): CotiSnapOperation => {
  if (!isRecord(params)) throw new Error('Blocked malformed COTI Snap request.');
  assertExactKeys(params, ['request', 'snapId'], 'COTI Snap invocation');
  if (params.snapId !== COTI_SNAP_ID || !isRecord(params.request)) {
    throw new Error('Blocked non-COTI Snap request.');
  }
  const method = params.request.method;
  if (method === 'connect-to-wallet') {
    assertExactKeys(params.request, ['method'], 'COTI connect-to-wallet request');
    return 'connect-to-wallet';
  }
  if (method === 'has-aes-key' || method === 'get-aes-key') {
    assertExactKeys(params.request, ['method', 'params'], `COTI ${method} request`);
    if (!isRecord(params.request.params)) throw new Error('Blocked malformed COTI chain parameters.');
    assertExactKeys(params.request.params, ['chainId'], 'COTI Snap chain parameters');
    if (params.request.params.chainId !== COTI_TESTNET_CHAIN_ID) {
      throw new Error('Blocked COTI Snap request for a non-testnet chain.');
    }
    return method;
  }
  if (method === 'set-aes-key') {
    assertExactKeys(params.request, ['method', 'params'], 'COTI set-aes-key request');
    if (!isRecord(params.request.params)) throw new Error('Blocked malformed COTI key-store parameters.');
    assertExactKeys(
      params.request.params,
      ['chainId', 'newUserAesKey'],
      'COTI Snap key-store parameters'
    );
    if (
      params.request.params.chainId !== COTI_TESTNET_CHAIN_ID ||
      typeof params.request.params.newUserAesKey !== 'string' ||
      !/^(?:0x)?[0-9a-fA-F]{32}$/.test(params.request.params.newUserAesKey)
    ) {
      throw new Error('Blocked malformed or non-testnet COTI key-store request.');
    }
    return 'set-aes-key';
  }
  throw new Error('Blocked unapproved COTI Snap operation.');
};

export const assertRpcMethodAllowedInPhase = (
  phase: RealWalletPhase,
  method: string,
  operation?: CotiSnapOperation
): void => {
  if (!RPC_METHODS_BY_PHASE[phase].has(method)) {
    throw new Error(`Blocked unapproved wallet RPC during ${phase}.`);
  }
  if (method === 'wallet_invokeSnap') {
    const allowed =
      (phase === 'snap-unlock' &&
        (operation === 'connect-to-wallet' ||
          operation === 'has-aes-key' ||
          operation === 'get-aes-key')) ||
      (phase === 'snap-key-store' &&
        (operation === 'connect-to-wallet' || operation === 'set-aes-key'));
    if (!allowed) {
      throw new Error('Blocked unapproved COTI Snap invocation.');
    }
  } else if (operation !== undefined) {
    throw new Error('Unexpected COTI Snap operation metadata.');
  }
};
