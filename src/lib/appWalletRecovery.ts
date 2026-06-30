import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import {
  CW_PROFILE_REGISTRY_GC_CONTRACT_ABI,
  CW_PROFILE_REGISTRY_CONTRACT_ADDRESS,
  TEXT_ENCODER,
  createBurnerWalletVault,
  extractUserCiphertext,
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiReadProvider,
  parseSubmitMemoPayload,
  type BurnerWalletRecord,
  type BurnerWalletVault
} from './appShared';
import { submitMemoPayloadToTuple } from './chatGc';

export const APP_WALLET_RECOVERY_ESTIMATED_BYTES_PER_PROMPT = 8;
export const APP_WALLET_RECOVERY_NOT_FOUND_MESSAGE =
  'No ChainWhisper account recovery was found for this owner wallet. Generate or import an account first, then save recovery.';

const RECOVERY_COMPACT_PAYLOAD_VERSION = 3;
const RECOVERY_LEGACY_COMPACT_PAYLOAD_VERSION = 2;

export type AppWalletRecoveryProfile = {
  active: boolean;
  defaultProfile?: boolean;
  encryptedPayload: unknown;
  payloadSize?: bigint;
  profileId: number;
  scheme: 'coti-gc';
  version: bigint;
};

export type AppWalletRecoveryProfileSummary = {
  active: boolean;
  defaultProfile?: boolean;
  payloadSize?: bigint;
  profileId: number;
  version: bigint;
};

export type AppWalletRecoveryProfileSummaries = {
  defaultProfileId?: number;
  hasDefault: boolean;
  summaries: AppWalletRecoveryProfileSummary[];
};

export type AppWalletRecoveryPayloadMetadata = {
  activeWalletAddress?: string;
  payloadKind?: string;
  recoveryOwnerAddress?: string;
};

export type AppWalletRecoveryBackupPayload = {
  encryptedPayload: Uint8Array;
  encryptedPayloadHex: string;
  payloadSize: number;
};

export type AppWalletRecoveryDecryptResult = {
  metadata: AppWalletRecoveryPayloadMetadata;
  vault: BurnerWalletVault;
};

export type AppWalletRecoveryPromptEstimate = {
  plaintextBytes: number;
  estimatedEncryptionPrompts: number;
  estimatedTransactionApprovals: number;
  estimatedWalletPrompts: number;
};

type GcRecoveryProfileResult = {
  active?: unknown;
  cellCount?: unknown;
  encryptedPayload?: unknown;
  version?: unknown;
  [key: number]: unknown;
};

type GcRecoverySummaryResult = {
  active?: unknown;
  cellCount?: unknown;
  version?: unknown;
  [key: number]: unknown;
};

type GcRecoverySummariesResult = {
  defaultProfileId?: unknown;
  hasDefault?: unknown;
  summaries?: unknown;
  [key: number]: unknown;
};

export const isAppWalletRecoveryConfigured = (): boolean =>
  isWalletAddress(CW_PROFILE_REGISTRY_CONTRACT_ADDRESS);

const requireAppWalletRecoveryAddress = (): string => {
  if (!isAppWalletRecoveryConfigured()) {
    throw new Error('ChainWhisper account recovery address is invalid in this build.');
  }
  return CW_PROFILE_REGISTRY_CONTRACT_ADDRESS;
};

const isEmptyContractCode = (code: unknown): boolean =>
  typeof code === 'string' && code.replace(/^0x/i, '').length === 0;

const requireGcRecoveryRegistry = async (
  contractAddress: string,
  readProvider: Awaited<ReturnType<typeof loadCotiReadProvider>>,
  cotiEthers: Awaited<ReturnType<typeof loadCotiEthersModule>>
): Promise<void> => {
  const contract = new cotiEthers.Contract(
    contractAddress,
    ['function contractVersion() view returns (string)'],
    readProvider
  );
  const version = String(await contract.contractVersion().catch(() => '')).trim();
  if (version !== 'CWProfileRegistryGCV2') {
    throw new Error(
      'ChainWhisper account recovery expected the optimized COTI GC profile registry at the canonical address.'
    );
  }
};

const getRecoveryContract = async (signerOrProvider?: JsonRpcSigner | Wallet) => {
  const contractAddress = requireAppWalletRecoveryAddress();
  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider();
  const contractCode = await readProvider.getCode(contractAddress);
  if (isEmptyContractCode(contractCode)) {
    throw new Error('ChainWhisper account recovery is not deployed on the connected COTI network.');
  }
  await requireGcRecoveryRegistry(contractAddress, readProvider, cotiEthers);
  return {
    contract: new cotiEthers.Contract(
      contractAddress,
      CW_PROFILE_REGISTRY_GC_CONTRACT_ABI,
      signerOrProvider ?? readProvider
    ),
    contractAddress,
    cotiEthers
  };
};

export const getAppWalletRecoveryReadErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.toLowerCase();
  if (
    normalized.includes('out of result range') ||
    normalized.includes('could not decode result data') ||
    normalized.includes('bad_data') ||
    normalized.includes('missing revert data') ||
    normalized.includes('call revert exception')
  ) {
    return 'ChainWhisper account recovery could not be read on this network. Check that COTI mainnet is selected and the registry is reachable.';
  }
  return message || 'Failed to read ChainWhisper account recovery.';
};

export const isAppWalletRecoveryNotFoundError = (error: unknown): boolean =>
  error instanceof Error && error.message === APP_WALLET_RECOVERY_NOT_FOUND_MESSAGE;

const normalizeProfileBigInt = (value: unknown): bigint => {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return BigInt(Math.max(0, Math.floor(value)));
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return 0n;
};

const normalizeProfileId = (value: unknown): number | undefined => {
  const normalized = normalizeProfileBigInt(value);
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  if (normalized < 0n || normalized > maxSafe) {
    return undefined;
  }
  return Number(normalized);
};

const normalizeRecoveryAddress = (address?: string | null): string => {
  const normalized = address?.trim() ?? '';
  return isWalletAddress(normalized) ? normalized.toLowerCase() : '';
};

const getActiveVaultWalletAddress = (vault: BurnerWalletVault): string => {
  const activeWallet =
    vault.wallets.find((walletRecord) => walletRecord.id === vault.activeWalletId) ?? vault.wallets[0];
  return normalizeRecoveryAddress(activeWallet?.address);
};

const getActiveVaultWalletRecord = (vault: BurnerWalletVault): BurnerWalletRecord | null =>
  vault.wallets.find((walletRecord) => walletRecord.id === vault.activeWalletId) ?? vault.wallets[0] ?? null;

const getActiveVaultRecoveryProfileId = (vault: BurnerWalletVault): number | undefined => {
  const activeWallet = getActiveVaultWalletRecord(vault);
  return typeof activeWallet?.recoveryProfileId === 'number' && Number.isSafeInteger(activeWallet.recoveryProfileId)
    ? activeWallet.recoveryProfileId
    : undefined;
};

export const encodeCompactAppWalletRecoveryPayload = (vault: BurnerWalletVault): string => {
  const activeWalletRecord = getActiveVaultWalletRecord(vault);
  const privateKey = activeWalletRecord?.privateKey?.trim() ?? '';
  if (!privateKey) {
    throw new Error('Connect the ChainWhisper account before saving recovery.');
  }

  const mnemonic = activeWalletRecord?.mnemonic?.trim() ?? '';
  const name = activeWalletRecord?.name?.trim() ?? '';
  const appAesKey = typeof activeWalletRecord?.onboardInfo?.aesKey === 'string'
    ? activeWalletRecord.onboardInfo.aesKey.trim()
    : '';
  return JSON.stringify({
    v: RECOVERY_COMPACT_PAYLOAD_VERSION,
    t: mnemonic ? 'm' : 'p',
    s: mnemonic || privateKey,
    ...(appAesKey ? { a: appAesKey } : {}),
    ...(name ? { n: name } : {})
  });
};

export const estimateAppWalletRecoveryPromptLoad = (
  vault: BurnerWalletVault
): AppWalletRecoveryPromptEstimate => {
  const plaintextBytes = TEXT_ENCODER.encode(encodeCompactAppWalletRecoveryPayload(vault)).byteLength;
  const estimatedEncryptionPrompts = Math.max(
    1,
    Math.ceil(plaintextBytes / APP_WALLET_RECOVERY_ESTIMATED_BYTES_PER_PROMPT)
  );
  const estimatedTransactionApprovals = 1;
  return {
    plaintextBytes,
    estimatedEncryptionPrompts,
    estimatedTransactionApprovals,
    estimatedWalletPrompts: estimatedEncryptionPrompts + estimatedTransactionApprovals
  };
};

export const buildAppWalletRecoveryPromptEstimateMessage = (
  estimate: AppWalletRecoveryPromptEstimate
): string =>
  `Saving recovery should need about ${estimate.estimatedEncryptionPrompts} encryption prompt${
    estimate.estimatedEncryptionPrompts === 1 ? '' : 's'
  } plus 1 transaction approval. This is normally a one-time action.`;

const decodeCompactVaultPayload = async (parsed: Record<string, unknown>): Promise<BurnerWalletVault | null> => {
  if (parsed.v !== RECOVERY_COMPACT_PAYLOAD_VERSION && parsed.v !== RECOVERY_LEGACY_COMPACT_PAYLOAD_VERSION) {
    return null;
  }

  const payloadType = parsed.t;
  const secret = typeof parsed.s === 'string' ? parsed.s.trim() : '';
  const name = typeof parsed.n === 'string' ? parsed.n.trim() : '';
  const appAesKey = typeof parsed.a === 'string' ? parsed.a.trim() : '';
  const onboardInfo = appAesKey ? { aesKey: appAesKey } : undefined;
  if (!secret || (payloadType !== 'm' && payloadType !== 'p')) {
    throw new Error('Invalid compact ChainWhisper account recovery payload.');
  }

  if (payloadType === 'p') {
    return createBurnerWalletVault([{ privateKey: secret, name, onboardInfo }]);
  }

  const cotiEthers = await loadCotiEthersModule();
  try {
    const wallet = cotiEthers.Wallet.fromPhrase(secret);
    return createBurnerWalletVault([
      {
        privateKey: wallet.privateKey,
        mnemonic: secret,
        name,
        onboardInfo
      }
    ]);
  } catch {
    throw new Error('Invalid compact ChainWhisper account recovery mnemonic.');
  }
};

const decodeVaultPayload = async (payloadJson: string): Promise<BurnerWalletVault> => {
  const parsed = JSON.parse(payloadJson) as {
    activeWalletId?: unknown;
    s?: unknown;
    t?: unknown;
    v?: unknown;
    version?: unknown;
    wallets?: unknown;
  } | null;
  if (parsed && typeof parsed === 'object') {
    const compactVault = await decodeCompactVaultPayload(parsed as Record<string, unknown>);
    if (compactVault) {
      return compactVault;
    }
  }
  if (!parsed || !Array.isArray(parsed.wallets)) {
    throw new Error('Invalid ChainWhisper account recovery payload.');
  }
  return createBurnerWalletVault(
    parsed.wallets as BurnerWalletRecord[],
    typeof parsed.activeWalletId === 'string' ? parsed.activeWalletId : undefined
  );
};

const decodeVaultPayloadWithMetadata = async (payloadJson: string): Promise<AppWalletRecoveryDecryptResult> => {
  const parsed = JSON.parse(payloadJson) as {
    activeWalletAddress?: unknown;
    payloadKind?: unknown;
    recoveryOwnerAddress?: unknown;
  } | null;
  const vault = await decodeVaultPayload(payloadJson);
  return {
    metadata: {
      activeWalletAddress:
        typeof parsed?.activeWalletAddress === 'string'
          ? normalizeRecoveryAddress(parsed.activeWalletAddress)
          : undefined,
      payloadKind: typeof parsed?.payloadKind === 'string' ? parsed.payloadKind : undefined,
      recoveryOwnerAddress:
        typeof parsed?.recoveryOwnerAddress === 'string'
          ? normalizeRecoveryAddress(parsed.recoveryOwnerAddress)
          : undefined
    },
    vault
  };
};

const normalizeVaultForComparison = async (vault: BurnerWalletVault): Promise<BurnerWalletVault> =>
  createBurnerWalletVault(vault.wallets, vault.activeWalletId);

const activeVaultWalletsMatch = async (
  expectedVault: BurnerWalletVault,
  recoveredVault: BurnerWalletVault
): Promise<boolean> => {
  const expected = await normalizeVaultForComparison(expectedVault);
  const recovered = await normalizeVaultForComparison(recoveredVault);
  const expectedActiveWallet = getActiveVaultWalletRecord(expected);
  const recoveredActiveWallet = getActiveVaultWalletRecord(recovered);
  const expectedAesKey = expectedActiveWallet?.onboardInfo?.aesKey?.trim() ?? '';
  const recoveredAesKey = recoveredActiveWallet?.onboardInfo?.aesKey?.trim() ?? '';
  return Boolean(
    expectedActiveWallet?.privateKey &&
      recoveredActiveWallet?.privateKey &&
      expectedActiveWallet.privateKey.toLowerCase() === recoveredActiveWallet.privateKey.toLowerCase() &&
      (!expectedAesKey || recoveredAesKey === expectedAesKey)
  );
};

const normalizeAppWalletRecoveryProfileSummary = (
  raw: GcRecoverySummaryResult,
  profileId: number,
  defaultProfileId?: number
): AppWalletRecoveryProfileSummary => {
  const version = normalizeProfileBigInt(raw.version ?? raw[0]);
  const active = Boolean(raw.active ?? raw[1]);
  const payloadSize = normalizeProfileBigInt(raw.cellCount ?? raw[2]);
  return {
    profileId,
    version,
    active,
    payloadSize,
    defaultProfile: defaultProfileId === profileId
  };
};

export const normalizeAppWalletRecoveryGcProfile = (
  raw: GcRecoveryProfileResult,
  profileId = 0,
  defaultProfileId?: number
): AppWalletRecoveryProfile => {
  const encryptedPayload = raw.encryptedPayload ?? raw[0] ?? null;
  const active = Boolean(raw.active ?? raw[1]);
  const version = normalizeProfileBigInt(raw.version ?? raw[2]);
  const payloadSize = normalizeProfileBigInt(raw.cellCount ?? raw[3]);
  return {
    encryptedPayload,
    scheme: 'coti-gc',
    version,
    active,
    payloadSize,
    profileId,
    defaultProfile: defaultProfileId === profileId
  };
};

export const readAppWalletRecoverySummaries = async (
  ownerAddress: string
): Promise<AppWalletRecoveryProfileSummaries> => {
  if (!isWalletAddress(ownerAddress)) {
    throw new Error('Enter a valid owner wallet address.');
  }

  const { contract } = await getRecoveryContract();
  let rawSummaries: unknown;
  try {
    rawSummaries = await contract.getProfileSummaries(ownerAddress);
  } catch (error) {
    throw new Error(getAppWalletRecoveryReadErrorMessage(error));
  }

  const result = rawSummaries as GcRecoverySummariesResult;
  const rawSummaryList = (result.summaries ?? result[0] ?? []) as unknown[];
  const defaultProfileId = normalizeProfileId(result.defaultProfileId ?? result[1]);
  const hasDefault = Boolean(result.hasDefault ?? result[2]);
  return {
    summaries: rawSummaryList.map((summary, index) =>
      normalizeAppWalletRecoveryProfileSummary(summary as GcRecoverySummaryResult, index, defaultProfileId)
    ),
    defaultProfileId: hasDefault ? defaultProfileId : undefined,
    hasDefault
  };
};

export const readAppWalletRecoveryProfile = async (
  ownerAddress: string,
  profileId?: number
): Promise<AppWalletRecoveryProfile | null> => {
  if (!isWalletAddress(ownerAddress)) {
    throw new Error('Enter a valid owner wallet address.');
  }

  const summaries = await readAppWalletRecoverySummaries(ownerAddress);
  const selectedProfileId =
    typeof profileId === 'number' && Number.isSafeInteger(profileId)
      ? profileId
      : summaries.defaultProfileId ?? summaries.summaries.find((summary) => summary.active)?.profileId;
  if (typeof selectedProfileId !== 'number') {
    return null;
  }

  const { contract } = await getRecoveryContract();
  let rawProfile: unknown;
  try {
    rawProfile = await contract.getProfile(ownerAddress, selectedProfileId);
  } catch (error) {
    throw new Error(getAppWalletRecoveryReadErrorMessage(error));
  }
  const profile = normalizeAppWalletRecoveryGcProfile(
    rawProfile as GcRecoveryProfileResult,
    selectedProfileId,
    summaries.defaultProfileId
  );
  return profile.active ? profile : null;
};

export const readAppWalletRecoveryProfiles = async (
  ownerAddress: string
): Promise<AppWalletRecoveryProfile[]> => {
  if (!isWalletAddress(ownerAddress)) {
    throw new Error('Enter a valid owner wallet address.');
  }

  const summaries = await readAppWalletRecoverySummaries(ownerAddress);
  const activeSummaries = summaries.summaries.filter((summary) => summary.active);
  if (activeSummaries.length === 0) {
    return [];
  }
  const { contract } = await getRecoveryContract();
  const profiles = await Promise.all(
    activeSummaries.map(async (summary) => {
      try {
        const rawProfile = await contract.getProfile(ownerAddress, summary.profileId);
        const profile = normalizeAppWalletRecoveryGcProfile(
          rawProfile as GcRecoveryProfileResult,
          summary.profileId,
          summaries.defaultProfileId
        );
        return profile.active ? profile : null;
      } catch (error) {
        throw new Error(getAppWalletRecoveryReadErrorMessage(error));
      }
    })
  );
  return profiles.filter((profile): profile is AppWalletRecoveryProfile => Boolean(profile));
};

export const decryptAppWalletRecoveryGcProfile = async (
  profile: AppWalletRecoveryProfile,
  ownerSigner: JsonRpcSigner | Wallet
): Promise<AppWalletRecoveryDecryptResult> => {
  if (!profile.encryptedPayload) {
    throw new Error('Saved ChainWhisper account recovery profile is empty.');
  }
  const userCiphertext = extractUserCiphertext(profile.encryptedPayload);
  if (!userCiphertext) {
    throw new Error('Saved ChainWhisper account recovery profile is missing owner-readable ciphertext.');
  }
  const decrypted = await ownerSigner.decryptValue(userCiphertext as never);
  const payloadJson = typeof decrypted === 'string' ? decrypted : String(decrypted);
  return decodeVaultPayloadWithMetadata(payloadJson);
};

export const saveAppWalletRecoveryProfile = async ({
  expectedOwnerAddress,
  makeDefault = false,
  ownerAesKey,
  profileId,
  signer,
  vault
}: {
  expectedOwnerAddress?: string;
  makeDefault?: boolean;
  ownerAesKey: string;
  profileId?: number;
  signer: JsonRpcSigner | Wallet;
  vault: BurnerWalletVault;
}) => {
  void ownerAesKey;
  const normalizedVault = await normalizeVaultForComparison(vault);
  const { contract, contractAddress, cotiEthers } = await getRecoveryContract(signer);
  const ownerAddress = await signer.getAddress();
  const expectedOwnerKey = normalizeRecoveryAddress(expectedOwnerAddress);
  const ownerKey = normalizeRecoveryAddress(ownerAddress);
  if (expectedOwnerKey && ownerKey !== expectedOwnerKey) {
    throw new Error('Refusing to save ChainWhisper account recovery from a different owner wallet.');
  }

  const existingProfileId =
    typeof profileId === 'number' && Number.isSafeInteger(profileId) && profileId >= 0
      ? profileId
      : getActiveVaultRecoveryProfileId(normalizedVault);
  const isNewProfile = typeof existingProfileId !== 'number';
  const targetProfileId = isNewProfile
    ? normalizeProfileId(await contract.profileCount(ownerAddress)) ?? 0
    : existingProfileId;

  const plaintext = encodeCompactAppWalletRecoveryPayload(normalizedVault);
  const selectorName = isNewProfile ? 'addProfile' : 'setProfile';
  const selector = new cotiEthers.Interface(CW_PROFILE_REGISTRY_GC_CONTRACT_ABI).getFunction(selectorName)?.selector;
  if (!selector) {
    throw new Error('ChainWhisper account recovery GC selector is unavailable.');
  }
  const encryptedProfile = await signer.encryptValue(plaintext, contractAddress, selector);
  const submitPayload = parseSubmitMemoPayload(encryptedProfile);
  const submitTuple = submitMemoPayloadToTuple(submitPayload);
  const tx = isNewProfile
    ? await contract.addProfile(submitTuple, makeDefault)
    : await contract.setProfile(targetProfileId, submitTuple);
  const receipt = await tx.wait();
  const savedProfile = await readAppWalletRecoveryProfile(ownerAddress, targetProfileId);
  if (!savedProfile) {
    throw new Error('ChainWhisper account recovery transaction confirmed, but no active profile could be read back.');
  }
  const verifiedRecovery = await decryptAppWalletRecoveryGcProfile(savedProfile, signer);
  if (verifiedRecovery.metadata.recoveryOwnerAddress && verifiedRecovery.metadata.recoveryOwnerAddress !== ownerKey) {
    throw new Error('ChainWhisper account recovery was saved with a different owner wallet marker.');
  }
  const expectedActiveWalletAddress = getActiveVaultWalletAddress(normalizedVault);
  if (
    verifiedRecovery.metadata.activeWalletAddress &&
    verifiedRecovery.metadata.activeWalletAddress !== expectedActiveWalletAddress
  ) {
    throw new Error('ChainWhisper account recovery was saved with a different active app wallet marker.');
  }
  const verifiedMatches = await activeVaultWalletsMatch(normalizedVault, verifiedRecovery.vault);
  if (!verifiedMatches) {
    throw new Error('ChainWhisper account recovery was saved, but read-back verification did not match this account.');
  }
  return {
    backup: {
      encryptedPayload: new Uint8Array(),
      encryptedPayloadHex: 'coti-gc',
      payloadSize: Number(savedProfile.payloadSize ?? 0n)
    },
    profileId: targetProfileId,
    receipt,
    verifiedProfile: savedProfile
  };
};

export const setDefaultAppWalletRecoveryProfile = async ({
  profileId,
  signer
}: {
  profileId: number;
  signer: JsonRpcSigner | Wallet;
}) => {
  if (!Number.isSafeInteger(profileId) || profileId < 0) {
    throw new Error('Choose a valid recovery profile.');
  }
  const { contract } = await getRecoveryContract(signer);
  const tx = await contract.setDefaultProfile(profileId);
  return tx.wait();
};

export const clearAppWalletRecoveryProfile = async (
  signer: JsonRpcSigner | Wallet,
  profileId: number
) => {
  if (!Number.isSafeInteger(profileId) || profileId < 0) {
    throw new Error('Choose a valid recovery profile.');
  }
  const { contract } = await getRecoveryContract(signer);
  const tx = await contract.clearProfile(profileId);
  return tx.wait();
};
