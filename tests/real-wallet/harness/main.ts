import { BrowserProvider, Contract, type JsonRpcSigner } from '@coti-io/coti-ethers';
import { getCotiSnapAesKeyResult } from '../../../src/lib/cotiSnap';
import {
  createDirectChatV2Conversation,
  DIRECT_CHAT_V2_ABI,
  bindDirectChatV2MetaMaskCapability,
  decryptDirectChatV2EventMessage,
  readDirectChatV2Conversation,
  readDirectChatV2EpochKey,
  readDirectChatV2MessageLogPage,
  rotateDirectChatV2ConversationKey,
  sendDirectChatV2Message,
  verifyDirectChatV2Contract,
  type DirectChatV2EpochKey,
  type DirectChatV2MetaMaskCapability,
  type VerifiedDirectChatV2Deployment,
} from '../../../src/lib/directChatV2Chain';
import { createIndexedDbDirectChatV2NonceAttemptRetirer } from '../../../src/lib/directChatV2NonceRetirement';
import {
  sanitizeRpcObservation,
  type ChatV2AuthenticatedRecovery,
  type ChatV2RecoveryAnchor,
  type CotiSnapOperation,
  type RealWalletPhase,
  type RealWalletRole,
  type SanitizedRpcObservation,
  type WalletPromptKind
} from '../promptEvidence';
import {
  assertRpcMethodAllowedInPhase,
  attestPinnedCotiSnapVersion,
  parseCotiSnapOperation
} from '../metamaskPolicy';
import { validateChatTransactionRequest } from '../transactionPolicy';

type HarnessConfig = {
  account: string;
  journey: 'recovery' | 'warm';
  manifest: {
    chainId: string;
    contractAddress: string;
    deploymentBlock: string;
    runtimeBytecodeHash: string;
  };
  peer: string;
  role: RealWalletRole;
};

type InjectedProvider = {
  isMetaMask?: boolean;
  request: (args: { method: string; params?: object | unknown[] }) => Promise<unknown>;
};

declare global {
  interface Window {
    __CHAINWHISPER_REAL_WALLET_TEST_CONFIG__?: HarnessConfig;
    __CHAINWHISPER_REAL_WALLET_HARNESS__?: {
      clearSensitiveState: () => boolean;
      getCotiSnapVersion: () => string | null;
      getAuthenticatedRecovery: () => ChatV2AuthenticatedRecovery | null;
      getObservations: () => SanitizedRpcObservation[];
      getPromptHint: () => WalletPromptKind | null;
      getRecoveryAnchor: () => ChatV2RecoveryAnchor | null;
      sealObservationLedger: (expectedCount: number) => boolean;
    };
  }
}

const config = window.__CHAINWHISPER_REAL_WALLET_TEST_CONFIG__;
delete window.__CHAINWHISPER_REAL_WALLET_TEST_CONFIG__;
if (!config) throw new Error('Missing public real-wallet harness configuration.');
const injected = window.ethereum as InjectedProvider | undefined;
if (!injected?.isMetaMask) throw new Error('Pinned MetaMask provider is unavailable.');

const observations: SanitizedRpcObservation[] = [];
const PROMPT_MEASUREMENT_MESSAGE = 'ChainWhisper Chat V2 prompt measurement';
let currentPhase: RealWalletPhase = 'wallet-connect';
let signer: JsonRpcSigner | null = null;
let capability: DirectChatV2MetaMaskCapability | null = null;
let deployment: VerifiedDirectChatV2Deployment | null = null;
let epochKey: DirectChatV2EpochKey | null = null;
let cotiSnapVersion: string | null = null;
let recoveryAnchor: ChatV2RecoveryAnchor | null = null;
let authenticatedRecovery: ChatV2AuthenticatedRecovery | null = null;
let promptHint: { kind: WalletPromptKind; token: symbol } | null = null;
let phaseRunning = false;
let observationLedgerSealed = false;
const nonceRetirement = createIndexedDbDirectChatV2NonceAttemptRetirer();

const assertHarnessOwnerCurrent = async (): Promise<void> => {
  const [accounts, chainId] = await Promise.all([
    meteredProvider.request({ method: 'eth_accounts' }),
    meteredProvider.request({ method: 'eth_chainId' })
  ]);
  const selectedAccount = Array.isArray(accounts) && typeof accounts[0] === 'string'
    ? accounts[0].toLowerCase()
    : '';
  if (
    selectedAccount !== config.account.toLowerCase() ||
    BigInt(String(chainId)) !== BigInt(config.manifest.chainId)
  ) {
    throw new Error('Real-wallet Chat V2 owner session changed.');
  }
};

const record = (input: Record<string, unknown>): void => {
  observations.push(sanitizeRpcObservation(input));
};

const isChatTransactionPhase = (
  phase: RealWalletPhase
): phase is Extract<RealWalletPhase, 'warm-create' | 'warm-rotate' | 'warm-send'> =>
  phase === 'warm-create' || phase === 'warm-rotate' || phase === 'warm-send';

const promptKindForRequest = (
  method: string,
  operation?: CotiSnapOperation
): WalletPromptKind | null => {
  if (method === 'eth_requestAccounts') return 'wallet-connect';
  if (method === 'eth_sendTransaction') return 'transaction';
  if (operation === 'connect-to-wallet') return 'snap-connect-wallet';
  if (operation === 'get-aes-key') return 'snap-aes-access';
  return null;
};

const meteredProvider: InjectedProvider = {
  isMetaMask: true,
  request: async ({ method, params }) => {
    if (observationLedgerSealed) {
      throw new Error('The real-wallet observation ledger is sealed.');
    }
    const startedAtMs = Date.now();
    const requestPhase = currentPhase;
    const operation = method === 'wallet_invokeSnap' ? parseCotiSnapOperation(params) : undefined;
    assertRpcMethodAllowedInPhase(requestPhase, method, operation);
    let transaction: { selector: string; target: string } | undefined;
    if (method === 'eth_sendTransaction') {
      if (!isChatTransactionPhase(requestPhase)) throw new Error('Blocked wallet transaction phase.');
      transaction = validateChatTransactionRequest(params, {
        account: config.account,
        contractAddress: config.manifest.contractAddress,
        conversation: epochKey ? { epoch: epochKey.epoch, id: epochKey.conversationId } : undefined,
        peer: config.peer,
        phase: requestPhase
      });
    }
    const kind = promptKindForRequest(method, operation);
    const hintToken = Symbol(method);
    if (kind) {
      if (promptHint) throw new Error('Blocked overlapping wallet prompt requests.');
      promptHint = { kind, token: hintToken };
    }
    try {
      if (method === 'eth_sendTransaction') {
        await assertHarnessOwnerCurrent();
      }
      const result = await injected.request({ method, params });
      record({
        durationMs: Date.now() - startedAtMs,
        method,
        operation,
        outcome: 'success',
        phase: requestPhase,
        startedAtMs,
        ...transaction
      });
      return result;
    } catch (error) {
      record({
        durationMs: Date.now() - startedAtMs,
        method,
        operation,
        outcome: 'error',
        phase: requestPhase,
        startedAtMs,
        ...transaction
      });
      throw error;
    } finally {
      if (promptHint?.token === hintToken) promptHint = null;
    }
  }
};

Object.defineProperty(window, '__CHAINWHISPER_REAL_WALLET_HARNESS__', {
  configurable: false,
  enumerable: false,
  value: Object.freeze({
    clearSensitiveState: () => {
      const activeSigner = signer;
      activeSigner?.clearUserOnboardInfo();
      if (activeSigner?.getUserOnboardInfo() !== undefined) {
        throw new Error('COTI signer retained sensitive onboarding state.');
      }
      signer = null;
      capability = null;
      deployment = null;
      epochKey = null;
      cotiSnapVersion = null;
      recoveryAnchor = null;
      authenticatedRecovery = null;
      promptHint = null;
      nonceRetirement.close();
      return (
        signer === null &&
        capability === null &&
        deployment === null &&
        epochKey === null &&
        cotiSnapVersion === null &&
        recoveryAnchor === null &&
        authenticatedRecovery === null &&
        promptHint === null
      );
    },
    getCotiSnapVersion: () => cotiSnapVersion,
    getAuthenticatedRecovery: () =>
      authenticatedRecovery ? { ...authenticatedRecovery } : null,
    getObservations: () => observations.map((entry) => ({ ...entry })),
    getPromptHint: () => promptHint?.kind ?? null,
    getRecoveryAnchor: () => (recoveryAnchor ? { ...recoveryAnchor } : null),
    sealObservationLedger: (expectedCount: number) => {
      if (
        observationLedgerSealed ||
        phaseRunning ||
        promptHint !== null ||
        !Number.isSafeInteger(expectedCount) ||
        expectedCount < 0 ||
        expectedCount !== observations.length
      ) {
        return false;
      }
      observationLedgerSealed = true;
      return true;
    }
  }),
  writable: false
});

const requireSigner = (): JsonRpcSigner => {
  if (!signer) throw new Error('Privacy signer is unavailable.');
  return signer;
};

const requireCapability = (): DirectChatV2MetaMaskCapability => {
  if (!capability) throw new Error('Owner session capability is unavailable.');
  return capability;
};

const requireDeployment = (): VerifiedDirectChatV2Deployment => {
  if (!deployment) throw new Error('Deployment is not attested.');
  return deployment;
};

const captureCanonicalRecoveryAnchor = async (): Promise<ChatV2RecoveryAnchor> => {
  const conversation = await readDirectChatV2Conversation({
    capability: requireCapability(),
    deployment: requireDeployment(),
    peer: config.peer
  });
  if (
    !conversation.exists ||
    conversation.messageCount === 0n ||
    conversation.currentEpoch <= 1n ||
    conversation.lastMessageBlock === 0n
  ) {
    throw new Error('Canonical Chat V2 recovery anchor is unavailable.');
  }
  const messages = await readDirectChatV2MessageLogPage({
    capability: requireCapability(),
    deployment: requireDeployment(),
    peer: config.peer,
    fromBlock: conversation.lastMessageBlock,
    toBlock: conversation.lastMessageBlock
  });
  const message = messages.find(({ messageId }) => messageId === conversation.messageCount);
  if (
    !message ||
    message.removed ||
    message.epoch !== conversation.currentEpoch - 1n ||
    message.sender.toLowerCase() !== config.peer.toLowerCase() ||
    message.recipient.toLowerCase() !== config.account.toLowerCase()
  ) {
    throw new Error('Canonical Chat V2 recovery message does not match the expected participants.');
  }
  return Object.freeze({
    conversationId: conversation.conversationId,
    currentEpoch: conversation.currentEpoch.toString(),
    latestMessageBlock: message.blockNumber.toString(),
    latestMessageBlockHash: message.blockHash,
    latestMessageId: message.messageId.toString(),
    latestRecipient: message.recipient,
    latestSender: message.sender,
    messageCount: conversation.messageCount.toString()
  });
};

const isRecoveryForbiddenAction = (action: string | undefined): boolean =>
  config.journey === 'recovery' &&
  (action === 'create' || action === 'send' || action === 'rotate');

const updateActionControls = (active: boolean): void => {
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-action]')) {
    const forbidden = isRecoveryForbiddenAction(button.dataset.action);
    button.hidden = forbidden;
    button.disabled = active || forbidden;
  }
};

updateActionControls(false);

const run = (phase: RealWalletPhase, action: () => Promise<void>): void => {
  const output = document.querySelector<HTMLOutputElement>(`[data-phase="${phase}"]`);
  if (!output) throw new Error('Harness phase output is unavailable.');
  if (observationLedgerSealed) throw new Error('The real-wallet observation ledger is sealed.');
  if (phaseRunning) throw new Error('Another wallet phase is already running.');
  phaseRunning = true;
  updateActionControls(true);
  output.dataset.status = 'running';
  output.textContent = 'Waiting for manual operator action';
  currentPhase = phase;
  void action()
    .then(
      () => {
        output.dataset.status = 'success';
        output.textContent = 'Complete';
      },
      () => {
        output.dataset.status = 'error';
        output.textContent = 'Stopped safely';
      }
    )
    .finally(() => {
      phaseRunning = false;
      updateActionControls(false);
    });
};

document.querySelector('[data-action="connect-wallet"]')?.addEventListener('click', () =>
  run('wallet-connect', async () => {
    const accounts = await meteredProvider.request({ method: 'eth_requestAccounts' });
    const account = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : '';
    const chainId = await meteredProvider.request({ method: 'eth_chainId' });
    if (
      account.toLowerCase() !== config.account.toLowerCase() ||
      BigInt(String(chainId)) !== BigInt(config.manifest.chainId)
    ) {
      throw new Error('Wallet context mismatch.');
    }
  })
);

document.querySelector('[data-action="unlock-snap"]')?.addEventListener('click', () =>
  run('snap-unlock', async () => {
    cotiSnapVersion = attestPinnedCotiSnapVersion(
      await meteredProvider.request({ method: 'wallet_getSnaps' })
    );
    const result = await getCotiSnapAesKeyResult(meteredProvider, {
      expectedChainId: Number(config.manifest.chainId),
      walletAddress: config.account
    });
    if (result.status !== 'ready') throw new Error('COTI privacy unlock stopped.');
    try {
      const browserProvider = new BrowserProvider(meteredProvider, {
        chainId: Number(config.manifest.chainId),
        name: 'ChainWhisper Chat V2 measurement'
      });
      const rawSigner: JsonRpcSigner = await browserProvider.getSigner(config.account, {
        aesKey: result.aesKey
      });
      rawSigner.disableAutoOnboard();
      capability = await bindDirectChatV2MetaMaskCapability({
        signer: rawSigner,
        browserProvider,
        ownerAddress: config.account,
        chainId: BigInt(config.manifest.chainId),
        assertCurrent: assertHarnessOwnerCurrent
      });
      signer = rawSigner;
    } finally {
      if (result.status === 'ready') result.aesKey = '';
    }
  })
);

document.querySelector('[data-action="attest"]')?.addEventListener('click', () =>
  run('deployment-attestation', async () => {
    deployment = await verifyDirectChatV2Contract({
      capability: requireCapability(),
      manifest: {
        chainId: BigInt(config.manifest.chainId),
        contractAddress: config.manifest.contractAddress,
        deploymentBlock: BigInt(config.manifest.deploymentBlock),
        runtimeBytecodeHash: config.manifest.runtimeBytecodeHash
      }
    });
    const contract = new Contract(deployment.contractAddress, DIRECT_CHAT_V2_ABI, requireSigner());
    if (BigInt(await contract.messageFee()) !== 0n) {
      deployment = null;
      throw new Error('Prompt measurement requires a zero-fee Chat V2 candidate.');
    }
    const conversation = await readDirectChatV2Conversation({
      capability: requireCapability(),
      deployment,
      peer: config.peer
    });
    if (config.journey === 'warm') {
      if (config.role === 'alice' && conversation.exists) {
        deployment = null;
        throw new Error('Prompt measurement requires a fresh Alice/Bob conversation pair.');
      }
      if (config.role === 'bob' && !conversation.exists) {
        deployment = null;
        throw new Error('Bob cannot measure recovery before Alice creates the conversation.');
      }
    } else if (!conversation.exists || conversation.messageCount === 0n) {
      deployment = null;
      throw new Error('Recovery requires the completed warm Chat V2 conversation.');
    } else {
      recoveryAnchor = await captureCanonicalRecoveryAnchor();
    }
  })
);

document.querySelector('[data-action="create"]')?.addEventListener('click', () =>
  run('warm-create', async () => {
    if (config.journey !== 'warm') throw new Error('Warm writes are disabled in recovery mode.');
    const created = await createDirectChatV2Conversation({
      capability: requireCapability(),
      deployment: requireDeployment(),
      peer: config.peer
    });
    await created.transaction.wait();
  })
);

document.querySelector('[data-action="recover"]')?.addEventListener('click', () =>
  run('envelope-recovery', async () => {
    authenticatedRecovery = null;
    const conversation = await readDirectChatV2Conversation({
      capability: requireCapability(),
      deployment: requireDeployment(),
      peer: config.peer
    });
    if (!conversation.exists) throw new Error('Conversation is unavailable for envelope recovery.');
    epochKey = await readDirectChatV2EpochKey({
      capability: requireCapability(),
      deployment: requireDeployment(),
      peer: config.peer,
      epoch: conversation.currentEpoch
    });
    if (conversation.messageCount === 0n) return;
    if (conversation.currentEpoch <= 1n || conversation.lastMessageBlock === 0n) {
      throw new Error('Counterparty message recovery requires a completed key rotation.');
    }
    const messageKey = await readDirectChatV2EpochKey({
      capability: requireCapability(),
      deployment: requireDeployment(),
      peer: config.peer,
      epoch: conversation.currentEpoch - 1n
    });
    const messages = await readDirectChatV2MessageLogPage({
      capability: requireCapability(),
      deployment: requireDeployment(),
      peer: config.peer,
      fromBlock: conversation.lastMessageBlock,
      toBlock: conversation.lastMessageBlock
    });
    const message = messages.find((candidate) =>
      candidate.messageId === conversation.messageCount
    );
    if (
      !message ||
      message.epoch !== messageKey.epoch ||
      message.sender.toLowerCase() !== config.peer.toLowerCase() ||
      message.recipient.toLowerCase() !== config.account.toLowerCase()
    ) {
      throw new Error('Latest counterparty Chat V2 message does not match the recovered epoch.');
    }
    const plaintext = await decryptDirectChatV2EventMessage({
      encrypted: message.encrypted,
      key: messageKey,
      context: message.context
    });
    if (plaintext !== PROMPT_MEASUREMENT_MESSAGE) {
      throw new Error('Latest counterparty Chat V2 message failed authenticated decryption.');
    }
    authenticatedRecovery = Object.freeze({
      conversationId: conversation.conversationId,
      epoch: message.epoch.toString(),
      messageBlock: message.blockNumber.toString(),
      messageBlockHash: message.blockHash,
      messageId: message.messageId.toString(),
      recipient: message.recipient,
      sender: message.sender
    });
    recoveryAnchor = Object.freeze({
      conversationId: conversation.conversationId,
      currentEpoch: conversation.currentEpoch.toString(),
      latestMessageBlock: message.blockNumber.toString(),
      latestMessageBlockHash: message.blockHash,
      latestMessageId: message.messageId.toString(),
      latestRecipient: message.recipient,
      latestSender: message.sender,
      messageCount: conversation.messageCount.toString()
    });
  })
);

document.querySelector('[data-action="send"]')?.addEventListener('click', () =>
  run('warm-send', async () => {
    if (config.journey !== 'warm') throw new Error('Warm writes are disabled in recovery mode.');
    if (!epochKey) throw new Error('Conversation key is unavailable.');
    const sent = await sendDirectChatV2Message({
      capability: requireCapability(),
      deployment: requireDeployment(),
      peer: config.peer,
      key: epochKey,
      plaintext: PROMPT_MEASUREMENT_MESSAGE,
      retireNonceAttempt: nonceRetirement.retire,
      tip: 0n
    });
    await sent.transaction.wait();
  })
);

document.querySelector('[data-action="rotate"]')?.addEventListener('click', () =>
  run('warm-rotate', async () => {
    if (config.journey !== 'warm') throw new Error('Warm writes are disabled in recovery mode.');
    const rotated = await rotateDirectChatV2ConversationKey({
      capability: requireCapability(),
      deployment: requireDeployment(),
      peer: config.peer
    });
    await rotated.transaction.wait();
    epochKey = null;
  })
);
