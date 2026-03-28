import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import {
  COTI_NETWORK,
  DEFAULT_GROUP_JOIN_CODE_MAX_USES,
  GROUP_CHAT_CONTRACT_ABI,
  GROUP_CHAT_CONTRACT_ADDRESS,
  GROUP_JOIN_CODE_ALPHABET,
  GROUP_JOIN_CODE_PROOF_DOMAIN,
  GROUP_JOIN_CODE_SIGNATURE_WINDOW_SECONDS,
  GROUP_JOIN_CODE_SIGNER_KEY_PREFIX,
  encodeGroupInviteCode,
  extractUserCiphertext,
  generateRandomGroupJoinCode,
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiReadProvider,
  parseGroupJoinCodeState,
  parseSubmitMemoPayload,
  toSafeNumber,
  type ActiveGroupJoinCode,
  type GroupJoinCodePayload
} from './appShared';

type GroupSigner = Wallet | JsonRpcSigner;

type CreateGroupJoinCodeArgs = {
  groupId: number;
  signer: GroupSigner;
  requestedWalletAddress: string;
  ttlSeconds: number;
  groupJoinCodeMode: 'single' | 'multi';
  groupJoinCodeMaxUsesInput: string;
};

type JoinWithGroupCodeArgs = {
  signer: GroupSigner;
  parsedJoinCode: GroupJoinCodePayload;
  chainId: number | null;
  nowTs: number;
};

const createGroupContract = async (runner: GroupSigner) => {
  const cotiEthers = await loadCotiEthersModule();
  return new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, runner);
};

const createJoinCodeHash = async (normalizedCode: string) => {
  const cotiEthers = await loadCotiEthersModule();
  return cotiEthers.keccak256(cotiEthers.toUtf8Bytes(normalizedCode));
};

const createJoinCodeProofWallet = async (normalizedCode: string) => {
  const cotiEthers = await loadCotiEthersModule();
  const codeSignerPrivateKey = cotiEthers.keccak256(
    cotiEthers.toUtf8Bytes(`${GROUP_JOIN_CODE_SIGNER_KEY_PREFIX}${normalizedCode}`)
  );
  return new cotiEthers.Wallet(codeSignerPrivateKey);
};

export const fetchActiveJoinCodesForAdmin = async ({
  groupId,
  signer,
  requestedWalletAddress
}: {
  groupId: number;
  signer: GroupSigner;
  requestedWalletAddress: string;
}): Promise<ActiveGroupJoinCode[]> => {
  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true).catch(() => null);
  const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);

  const activeJoinCodeHashesRaw: unknown[] = [];
  let activeJoinCodeOffset = 0;
  const activeJoinCodePageLimit = 128;
  const activeJoinCodePageMax = 256;

  for (let page = 0; page < activeJoinCodePageMax; page += 1) {
    const pageRaw = await contract
      .getActiveJoinCodeHashesPage(groupId, activeJoinCodeOffset, activeJoinCodePageLimit)
      .catch(() => null);
    if (!pageRaw) {
      break;
    }

    const pageHashesRaw =
      pageRaw && typeof pageRaw === 'object'
        ? ((pageRaw as { hashes?: unknown }).hashes ?? (pageRaw as { 0?: unknown })[0])
        : null;
    const nextOffsetRaw =
      pageRaw && typeof pageRaw === 'object'
        ? ((pageRaw as { nextOffset?: unknown }).nextOffset ?? (pageRaw as { 1?: unknown })[1])
        : null;

    if (Array.isArray(pageHashesRaw)) {
      activeJoinCodeHashesRaw.push(...pageHashesRaw);
    }

    const nextOffset = toSafeNumber(nextOffsetRaw);
    if (nextOffset <= activeJoinCodeOffset) {
      break;
    }
    activeJoinCodeOffset = nextOffset;
  }

  const activeCodeHashes: string[] = [];
  for (const codeHashRaw of activeJoinCodeHashesRaw) {
    const normalizedCodeHash = String(codeHashRaw ?? '').trim().toLowerCase();
    if (!/^0x[a-f0-9]{64}$/.test(normalizedCodeHash)) {
      continue;
    }
    activeCodeHashes.push(normalizedCodeHash);
  }

  const nowTs = Math.floor(Date.now() / 1000);
  const nextActiveCodes: ActiveGroupJoinCode[] = [];
  const getJoinCodeForAdminFunction = contract.getFunction('getJoinCodeForAdmin');
  const groupContractInterface = new cotiEthers.Interface(GROUP_CHAT_CONTRACT_ABI);
  const signerProvider = (signer as { provider?: { call?: (tx: Record<string, unknown>) => Promise<string> } }).provider;
  const joinCodePattern = new RegExp(`^[${GROUP_JOIN_CODE_ALPHABET}]{4,12}$`);
  const normalizeDecryptedJoinCode = (value: unknown): string => {
    const normalized = String(value ?? '').replace(/\0/g, '').trim().toUpperCase();
    if (!normalized) {
      return '';
    }
    if (joinCodePattern.test(normalized)) {
      return normalized;
    }

    const separatorIndex = normalized.indexOf(':');
    if (separatorIndex > 0 && separatorIndex < normalized.length - 1) {
      const suffix = normalized.slice(separatorIndex + 1).trim();
      if (joinCodePattern.test(suffix)) {
        return suffix;
      }
    }

    return '';
  };

  const joinCodeCipherFromCreateTxCache = new Map<string, { value: bigint[] } | null>();
  const readJoinCodeCiphertextFromCreateTx = async (codeHash: string): Promise<{ value: bigint[] } | null> => {
    if (!readProvider?.getTransaction || joinCodeCipherFromCreateTxCache.has(codeHash)) {
      return joinCodeCipherFromCreateTxCache.get(codeHash) ?? null;
    }

    try {
      const createdLogs = await contract
        .queryFilter(contract.filters.GroupJoinCodeCreated(groupId, codeHash, null), 0, 'latest')
        .catch(() => []);
      if (!Array.isArray(createdLogs) || createdLogs.length === 0) {
        joinCodeCipherFromCreateTxCache.set(codeHash, null);
        return null;
      }

      let latestCreatedLog = createdLogs[0];
      for (const log of createdLogs) {
        if (
          log.blockNumber > latestCreatedLog.blockNumber ||
          (log.blockNumber === latestCreatedLog.blockNumber && log.index > latestCreatedLog.index)
        ) {
          latestCreatedLog = log;
        }
      }

      const creationTx = await readProvider.getTransaction(latestCreatedLog.transactionHash).catch(() => null);
      if (!creationTx?.data) {
        joinCodeCipherFromCreateTxCache.set(codeHash, null);
        return null;
      }

      const parsedCreationTx = groupContractInterface.parseTransaction({
        data: creationTx.data,
        value: creationTx.value ?? 0n
      });
      if (!parsedCreationTx || parsedCreationTx.name !== 'createJoinCode' || parsedCreationTx.args.length < 6) {
        joinCodeCipherFromCreateTxCache.set(codeHash, null);
        return null;
      }

      const encryptedCodeArg = parsedCreationTx.args[5] as unknown;
      const encryptedCiphertext =
        encryptedCodeArg && typeof encryptedCodeArg === 'object'
          ? ((encryptedCodeArg as { ciphertext?: unknown }).ciphertext ?? (encryptedCodeArg as { 0?: unknown })[0])
          : null;
      const encryptedCiphertextValuesRaw =
        encryptedCiphertext && typeof encryptedCiphertext === 'object'
          ? ((encryptedCiphertext as { value?: unknown }).value ?? (encryptedCiphertext as { 0?: unknown })[0])
          : null;
      if (!Array.isArray(encryptedCiphertextValuesRaw) || encryptedCiphertextValuesRaw.length === 0) {
        joinCodeCipherFromCreateTxCache.set(codeHash, null);
        return null;
      }

      const encryptedCiphertextValues = encryptedCiphertextValuesRaw.map((item) => BigInt(item));
      const nextCiphertext = { value: encryptedCiphertextValues };
      joinCodeCipherFromCreateTxCache.set(codeHash, nextCiphertext);
      return nextCiphertext;
    } catch {
      joinCodeCipherFromCreateTxCache.set(codeHash, null);
      return null;
    }
  };

  await Promise.all(
    activeCodeHashes.map(async (codeHash) => {
      const [joinCodeRaw, encryptedCodeRaw] = await Promise.all([
        contract.getJoinCode(groupId, codeHash).catch(() => null),
        (async () => {
          const directStaticCall = (contract as {
            getJoinCodeForAdmin?: {
              staticCall?: (targetGroupId: number, targetCodeHash: string) => Promise<unknown>;
            };
          }).getJoinCodeForAdmin?.staticCall;
          if (directStaticCall) {
            const directResult = await directStaticCall(groupId, codeHash).catch(() => null);
            if (directResult) {
              return directResult;
            }
          }
          const fallbackResult = await getJoinCodeForAdminFunction.staticCall(groupId, codeHash).catch(() => null);
          if (fallbackResult) {
            return fallbackResult;
          }

          if (!signerProvider?.call) {
            return null;
          }
          const encodedCall = groupContractInterface.encodeFunctionData('getJoinCodeForAdmin', [groupId, codeHash]);
          const lowLevelRaw = await signerProvider
            .call({
              to: GROUP_CHAT_CONTRACT_ADDRESS,
              from: requestedWalletAddress,
              data: encodedCall
            })
            .catch(() => null);
          if (!lowLevelRaw || lowLevelRaw === '0x') {
            return null;
          }
          const decoded = groupContractInterface.decodeFunctionResult('getJoinCodeForAdmin', lowLevelRaw);
          return decoded?.[0] ?? decoded;
        })()
      ]);
      const joinCodeState = parseGroupJoinCodeState(joinCodeRaw);
      if (!joinCodeState || !joinCodeState.active) {
        return;
      }

      const expiresAt = toSafeNumber(joinCodeState.expiresAt);
      const isExpired = joinCodeState.expired || (expiresAt > 0 && expiresAt <= nowTs);
      const usesLeft = Math.max(0, toSafeNumber(joinCodeState.usesLeft));
      if (isExpired || usesLeft <= 0) {
        return;
      }

      let decryptedCode = '';
      const codeCiphertext = extractUserCiphertext(encryptedCodeRaw);
      if (codeCiphertext) {
        try {
          const decrypted = await signer.decryptValue(codeCiphertext as never);
          decryptedCode = normalizeDecryptedJoinCode(decrypted);
        } catch {
        }
      }
      if (!decryptedCode) {
        const fallbackCiphertext = await readJoinCodeCiphertextFromCreateTx(codeHash);
        if (fallbackCiphertext) {
          try {
            const decrypted = await signer.decryptValue(fallbackCiphertext as never);
            decryptedCode = normalizeDecryptedJoinCode(decrypted);
          } catch {
          }
        }
      }

      const creator = isWalletAddress(joinCodeState.creator) ? joinCodeState.creator : '';
      nextActiveCodes.push({
        groupId,
        codeHash,
        code: decryptedCode || undefined,
        creator,
        expiresAt,
        usesLeft
      });
    })
  );

  nextActiveCodes.sort((left, right) => {
    const leftExpiry = left.expiresAt > 0 ? left.expiresAt : Number.MAX_SAFE_INTEGER;
    const rightExpiry = right.expiresAt > 0 ? right.expiresAt : Number.MAX_SAFE_INTEGER;
    if (leftExpiry !== rightExpiry) {
      return leftExpiry - rightExpiry;
    }
    if (left.usesLeft !== right.usesLeft) {
      return right.usesLeft - left.usesLeft;
    }
    return left.codeHash.localeCompare(right.codeHash);
  });

  return nextActiveCodes;
};

export const revokeGroupJoinCode = async ({
  signer,
  groupId,
  codeHash
}: {
  signer: GroupSigner;
  groupId: number;
  codeHash: string;
}): Promise<void> => {
  const contract = await createGroupContract(signer);
  const tx = await contract.revokeJoinCode(groupId, codeHash);
  await tx.wait();
};

export const createGroupJoinCode = async ({
  groupId,
  signer,
  requestedWalletAddress,
  ttlSeconds,
  groupJoinCodeMode,
  groupJoinCodeMaxUsesInput
}: CreateGroupJoinCodeArgs): Promise<{ generatedGroupInviteCode: string; codeHash: string }> => {
  const signerAddress = (await signer.getAddress()).trim();
  if (!isWalletAddress(signerAddress)) {
    throw new Error('Signer address is invalid.');
  }

  const cotiEthers = await loadCotiEthersModule();
  const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
  const code = generateRandomGroupJoinCode();
  const normalizedCode = code.trim().toUpperCase();
  const codeHash = await createJoinCodeHash(normalizedCode);
  const codeSigner = (await createJoinCodeProofWallet(normalizedCode)).address;
  const joinCodeTtlMaxRaw = await contract.JOIN_CODE_TTL_MAX().catch(() => null);
  const joinCodeTtlMax = toSafeNumber(joinCodeTtlMaxRaw);
  if (joinCodeTtlMax > 0 && ttlSeconds > joinCodeTtlMax) {
    throw new Error(`Join-code TTL exceeds on-chain max (${Math.floor(joinCodeTtlMax / 3600)}h).`);
  }

  let maxUses = DEFAULT_GROUP_JOIN_CODE_MAX_USES;
  if (groupJoinCodeMode === 'multi') {
    const requestedMultiUses = Math.floor(Number(groupJoinCodeMaxUsesInput));
    if (!Number.isFinite(requestedMultiUses) || requestedMultiUses < 2) {
      throw new Error('Multi-use codes require a max uses value of at least 2.');
    }
    const contractMaxUsesRaw = await contract.JOIN_CODE_MAX_USES().catch(() => null);
    const contractMaxUses = toSafeNumber(contractMaxUsesRaw);
    if (contractMaxUses <= 1) {
      throw new Error('Multi-use join codes are not available on this contract.');
    }
    if (requestedMultiUses > contractMaxUses) {
      throw new Error(`Max uses exceeds the on-chain limit (${contractMaxUses}).`);
    }
    maxUses = requestedMultiUses;
  }

  const createJoinCodeSelector = new cotiEthers.Interface(GROUP_CHAT_CONTRACT_ABI).getFunction('createJoinCode')?.selector;
  if (!createJoinCodeSelector) {
    throw new Error('Unable to resolve createJoinCode selector.');
  }
  const encryptedCodeMemo = await signer.encryptValue(normalizedCode, GROUP_CHAT_CONTRACT_ADDRESS, createJoinCodeSelector);
  const encryptedCodePayload = parseSubmitMemoPayload(encryptedCodeMemo);
  const encryptedCodeTuple = [[encryptedCodePayload.ciphertextValue], encryptedCodePayload.signature] as const;

  const tx = await contract.createJoinCode(groupId, codeHash, codeSigner, ttlSeconds, maxUses, encryptedCodeTuple);
  await tx.wait();

  let expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const joinCodeRaw = await contract.getJoinCode(groupId, codeHash).catch(() => null);
  const joinCodeState = parseGroupJoinCodeState(joinCodeRaw);
  if (joinCodeState && joinCodeState.expiresAt > 0) {
    expiresAt = joinCodeState.expiresAt;
  }

  const payload: GroupJoinCodePayload = {
    version: 2,
    groupId,
    code: normalizedCode,
    expiresAt,
    inviter: isWalletAddress(requestedWalletAddress) ? requestedWalletAddress : undefined
  };

  return {
    generatedGroupInviteCode: encodeGroupInviteCode(payload),
    codeHash
  };
};

export const hasActiveLegacyGroupInvite = async ({
  groupId,
  walletAddress,
  nowTs
}: {
  groupId: number;
  walletAddress: string;
  nowTs: number;
}): Promise<boolean> => {
  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, readProvider);
  const inviteRaw = await contract.getInvite(groupId, walletAddress).catch(() => null);

  const pending =
    Boolean(inviteRaw && typeof inviteRaw === 'object' ? (inviteRaw as { pending?: unknown }).pending : null) ||
    (Array.isArray(inviteRaw) ? Boolean(inviteRaw[0]) : false);
  const inviteExpiresAt =
    inviteRaw && typeof inviteRaw === 'object'
      ? toSafeNumber((inviteRaw as { expiresAt?: unknown }).expiresAt)
      : Array.isArray(inviteRaw)
        ? toSafeNumber(inviteRaw[2])
        : 0;
  const inviteExpired =
    inviteRaw && typeof inviteRaw === 'object'
      ? Boolean((inviteRaw as { expired?: unknown }).expired)
      : Array.isArray(inviteRaw)
        ? Boolean(inviteRaw[3])
        : inviteExpiresAt > 0 && inviteExpiresAt <= nowTs;

  return pending && !inviteExpired;
};

export const joinWithGroupCode = async ({
  signer,
  parsedJoinCode,
  chainId,
  nowTs
}: JoinWithGroupCodeArgs): Promise<void> => {
  const cotiEthers = await loadCotiEthersModule();
  const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
  const signerAddress = (await signer.getAddress()).trim();
  if (!isWalletAddress(signerAddress)) {
    throw new Error('Signer address is invalid.');
  }

  const normalizedCode = parsedJoinCode.code.trim().toUpperCase();
  if (!normalizedCode) {
    throw new Error('Invalid group code.');
  }

  const codeHash = await createJoinCodeHash(normalizedCode);
  const codeProofSigner = await createJoinCodeProofWallet(normalizedCode);
  const derivedCodeSigner = codeProofSigner.address.toLowerCase();
  const [isAlreadyMemberRaw, joinCodeRaw] = await Promise.all([
    contract.isMember(parsedJoinCode.groupId, signerAddress).catch(() => false),
    contract.getJoinCode(parsedJoinCode.groupId, codeHash).catch(() => null)
  ]);

  if (isAlreadyMemberRaw) {
    throw new Error('You are already a member of this group.');
  }

  const joinCodeState = parseGroupJoinCodeState(joinCodeRaw);
  if (!joinCodeState || !joinCodeState.active) {
    throw new Error('This group code is no longer active. Ask for a new code.');
  }
  if (joinCodeState.expired || (joinCodeState.expiresAt > 0 && joinCodeState.expiresAt <= nowTs)) {
    throw new Error('This group code has expired.');
  }
  if (joinCodeState.usesLeft <= 0) {
    throw new Error('This group code has no remaining uses.');
  }
  if (joinCodeState.signer && joinCodeState.signer.toLowerCase() !== derivedCodeSigner) {
    throw new Error('This group code is invalid. Ask for a fresh code from the admin.');
  }

  const signatureDeadline = nowTs + GROUP_JOIN_CODE_SIGNATURE_WINDOW_SECONDS;
  const proofDomainHash = cotiEthers.keccak256(cotiEthers.toUtf8Bytes(GROUP_JOIN_CODE_PROOF_DOMAIN));
  const proofDigest = cotiEthers.keccak256(
    cotiEthers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint256', 'address', 'uint256', 'bytes32', 'address', 'uint64'],
      [
        proofDomainHash,
        BigInt(chainId ?? COTI_NETWORK.chainIdDecimal),
        GROUP_CHAT_CONTRACT_ADDRESS,
        BigInt(parsedJoinCode.groupId),
        codeHash,
        signerAddress,
        BigInt(signatureDeadline)
      ]
    )
  );
  const proofSignature = await codeProofSigner.signMessage(cotiEthers.getBytes(proofDigest));

  const tx = await contract.joinWithCode(parsedJoinCode.groupId, codeHash, signatureDeadline, proofSignature);
  await tx.wait();
};
