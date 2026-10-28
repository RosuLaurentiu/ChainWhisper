import { BrowserProvider, getAddress, type JsonRpcSigner } from '@coti-io/coti-ethers';
import type { CotiReadProvider } from './appShared/core';

const UINT256_MAX = (1n << 256n) - 1n;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;

declare const OWNER_TRADE_V2_CAPABILITY_BRAND: unique symbol;
export type OwnerTradeV2MetaMaskCapability = Readonly<{
  readonly [OWNER_TRADE_V2_CAPABILITY_BRAND]: true;
}>;

export type OwnerTradeV2CapabilityBinding = Readonly<{
  assertCurrent: () => void | Promise<void>;
  assertSnapshotCurrent: () => void | Promise<void>;
  browserProvider: BrowserProvider;
  readProvider?: CotiReadProvider;
  chainId: bigint;
  ownerAddress: string;
  signer: JsonRpcSigner;
}>;

const CAPABILITIES = new WeakMap<object, OwnerTradeV2CapabilityBinding>();
const RECEIPT_POLL_INTERVAL_MS = 2_000;
const RECEIPT_TIMEOUT_MS = 300_000;

const uint = (value: unknown, label: string): bigint => {
  let parsed: bigint;
  try {
    parsed = BigInt(value as bigint);
  } catch {
    throw new Error(`${label} must be an unsigned integer.`);
  }
  if (parsed < 0n || parsed > UINT256_MAX) throw new Error(`${label} is out of range.`);
  return parsed;
};

const address = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  let normalized: string;
  try {
    normalized = getAddress(value.trim()).toLowerCase();
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (normalized === ZERO_ADDRESS) throw new Error(`${label} cannot be zero.`);
  return normalized;
};

export const getOwnerTradeV2CapabilityBinding = (
  capability: OwnerTradeV2MetaMaskCapability
): OwnerTradeV2CapabilityBinding => {
  const binding = capability && CAPABILITIES.get(capability);
  if (!binding) throw new Error('OTC V2 requires a current owner browser-wallet capability.');
  return binding;
};

/**
 * Uses the independent COTI provider for ordinary view calls whenever the
 * production wallet capability has one. Keeping public reads off the injected
 * wallet avoids extension request pressure; the signer remains the fallback
 * for isolated tests and older explicitly constructed capabilities.
 */
export const getOwnerTradeV2ReadRunner = (
  bindingOrCapability: OwnerTradeV2CapabilityBinding | OwnerTradeV2MetaMaskCapability
): CotiReadProvider | JsonRpcSigner => {
  const binding = CAPABILITIES.has(bindingOrCapability as object)
    ? getOwnerTradeV2CapabilityBinding(bindingOrCapability as OwnerTradeV2MetaMaskCapability)
    : bindingOrCapability as OwnerTradeV2CapabilityBinding;
  return binding.readProvider ?? binding.signer;
};

export const assertOwnerTradeV2CapabilityCurrent = async (
  bindingOrCapability: OwnerTradeV2CapabilityBinding | OwnerTradeV2MetaMaskCapability
): Promise<void> => {
  const binding = CAPABILITIES.has(bindingOrCapability as object)
    ? getOwnerTradeV2CapabilityBinding(bindingOrCapability as OwnerTradeV2MetaMaskCapability)
    : bindingOrCapability as OwnerTradeV2CapabilityBinding;
  if (!(binding.browserProvider instanceof BrowserProvider) || binding.signer.provider !== binding.browserProvider) {
    throw new Error('OTC V2 capability is not bound to its exact COTI BrowserProvider.');
  }
  await binding.assertCurrent();
};

export const assertOwnerTradeV2CapabilitySnapshotCurrent = async (
  bindingOrCapability: OwnerTradeV2CapabilityBinding | OwnerTradeV2MetaMaskCapability
): Promise<void> => {
  const binding = CAPABILITIES.has(bindingOrCapability as object)
    ? getOwnerTradeV2CapabilityBinding(bindingOrCapability as OwnerTradeV2MetaMaskCapability)
    : bindingOrCapability as OwnerTradeV2CapabilityBinding;
  if (!(binding.browserProvider instanceof BrowserProvider) || binding.signer.provider !== binding.browserProvider) {
    throw new Error('OTC V2 capability is not bound to its exact COTI BrowserProvider.');
  }
  await binding.assertSnapshotCurrent();
};

/** Confirms a submitted owner transaction without polling through the browser-wallet provider. */
export const waitForOwnerTradeV2Receipt = async (
  bindingOrCapability: OwnerTradeV2CapabilityBinding | OwnerTradeV2MetaMaskCapability,
  transactionHash: string,
  options: Readonly<{ pollIntervalMs?: number; timeoutMs?: number }> = {}
): Promise<unknown> => {
  const binding = CAPABILITIES.has(bindingOrCapability as object)
    ? getOwnerTradeV2CapabilityBinding(bindingOrCapability as OwnerTradeV2MetaMaskCapability)
    : bindingOrCapability as OwnerTradeV2CapabilityBinding;
  const hash = /^0x[0-9a-fA-F]{64}$/.test(transactionHash) ? transactionHash.toLowerCase() : '';
  if (!hash) throw new Error('OTC V2 transaction hash is invalid.');
  if (!binding.readProvider) throw new Error('OTC V2 independent receipt confirmation is unavailable.');
  const pollIntervalMs = options.pollIntervalMs ?? RECEIPT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? RECEIPT_TIMEOUT_MS;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('OTC V2 receipt polling configuration is invalid.');
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await binding.readProvider.getTransactionReceipt(hash);
    if (receipt) return receipt;
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error('The transaction was submitted, but COTI confirmation timed out. Check wallet activity before retrying.');
};

const attestOwnerTradeV2CapabilityScope = async (
  binding: OwnerTradeV2CapabilityBinding,
  assertSnapshotCurrent?: () => void
): Promise<void> => {
  const [owner, network] = await Promise.all([
    binding.signer.getAddress(),
    binding.browserProvider.getNetwork()
  ]);
  if (assertSnapshotCurrent) assertSnapshotCurrent();
  else await binding.assertCurrent();
  if (address(owner, 'Connected OTC V2 owner') !== binding.ownerAddress ||
      uint(network.chainId, 'Connected OTC V2 chain') !== binding.chainId) {
    throw new Error('OTC V2 capability account or chain changed.');
  }
};

export const bindOwnerTradeV2MetaMaskCapability = async ({
  signer,
  browserProvider,
  readProvider,
  ownerAddress,
  chainId,
  assertCurrent,
  assertSnapshotCurrent
}: {
  signer: JsonRpcSigner;
  browserProvider: BrowserProvider;
  readProvider?: CotiReadProvider;
  ownerAddress: string;
  chainId: bigint;
  assertCurrent: () => void | Promise<void>;
  assertSnapshotCurrent?: () => void;
}): Promise<OwnerTradeV2MetaMaskCapability> => {
  const candidate = signer as JsonRpcSigner & { privateKey?: unknown; sendUncheckedTransaction?: unknown };
  if (!(browserProvider instanceof BrowserProvider) || !candidate || candidate.provider !== browserProvider ||
      typeof candidate.getAddress !== 'function' || typeof candidate.sendUncheckedTransaction !== 'function' ||
      typeof candidate.getUserOnboardInfo !== 'function' || typeof assertCurrent !== 'function' ||
      (assertSnapshotCurrent !== undefined && typeof assertSnapshotCurrent !== 'function') ||
      'privateKey' in candidate) {
    throw new Error('OTC V2 requires the owner signer from the exact COTI BrowserProvider session.');
  }
  if (readProvider && (typeof readProvider.getNetwork !== 'function' ||
      typeof readProvider.getTransactionReceipt !== 'function')) {
    throw new Error('OTC V2 requires an independent COTI read provider.');
  }
  const binding = Object.freeze({
    assertCurrent,
    assertSnapshotCurrent: assertSnapshotCurrent ?? assertCurrent,
    browserProvider,
    readProvider,
    chainId: uint(chainId, 'Expected OTC V2 chain'),
    ownerAddress: address(ownerAddress, 'Expected OTC V2 owner'),
    signer: candidate
  });
  if (binding.chainId === 0n) throw new Error('Expected OTC V2 chain cannot be zero.');
  if (binding.readProvider) {
    const readNetwork = await binding.readProvider.getNetwork();
    if (uint(readNetwork.chainId, 'Connected OTC V2 read chain') !== binding.chainId) {
      throw new Error('OTC V2 read provider is connected to another chain.');
    }
  }
  await attestOwnerTradeV2CapabilityScope(binding, assertSnapshotCurrent);
  const capability = Object.freeze({}) as OwnerTradeV2MetaMaskCapability;
  CAPABILITIES.set(capability, binding);
  return capability;
};
