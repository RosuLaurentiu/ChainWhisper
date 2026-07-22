export const CHAT_CONTRACT_ADDRESS = '0xE5101D33986c91565D2C9f8b49AAF0b8FFeE2243';
export const LEGACY_CHAT_BACKUP_CONTRACT_ADDRESS = '0xF4cab1599aafBBB68677682354B7c1760bCF6c48';
export const GROUP_ADMIN_BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD';
export const REWARD_TOKEN_ADDRESS = '0xb70c55bd0823436F44877DC6A9f46E0C55f2C3A8';
export const PRIVATE_REWARD_TOKEN_ADDRESS = '0x682e3142e62a7aDe2a0CA5bdC87b205CaDe4B17a';
export const LEGACY_PRIVATE_REWARD_TOKEN_ADDRESS = '0x922B39AC9FD4ccb5E5a9de0694C8189DC2D214E8';
export const LEGACY_SWAP_VAULT_CONTRACT_ADDRESS = '0x5C35CD3659991051F4Fb04F2C4120643739b7BdE';
export const WHISPER_SHIELD_ENABLED = true;
export const WHISPER_SHIELD_LEGACY_UNSHIELD_ENABLED = true;
export const WISP_PRIVACY_BRIDGE_CONTRACT_ADDRESS = '0x3bCeA2eD4b31107eF877899416dC97213bdc2809';
export const FALLBACK_REWARD_TOKEN_SYMBOL = 'WISP';
export const FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL = 'p.WISP';
export const FALLBACK_REWARD_TOKEN_DECIMALS = 6;
export const MAX_ERC20_APPROVAL = (1n << 256n) - 1n;
export const PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE = MAX_ERC20_APPROVAL;
export const CHAT_CONTRACT_ABI = [
  'function submit(address recipient, ((uint256[] value), bytes[] signature) memo) payable',
  'function submitMultipart(address recipient, ((uint256[] value), bytes[] signature)[] messages) payable',
  'function getMessage(uint256 messageId) view returns (tuple(uint256 id,address from,address to,uint64 blockNumber,uint64 timestamp,uint32 chunkCount,uint256 valueSent,uint256 feeTaken,(tuple(uint256[] value) ciphertext,tuple(uint256[] value) userCiphertext) ciphertext))',
  'function getMessageChunk(uint256 messageId,uint256 chunkIndex) view returns ((tuple(uint256[] value) ciphertext,tuple(uint256[] value) userCiphertext) ciphertext)',
  'function getMessageMetadata(uint256 messageId) view returns (address from,address to,uint64 blockNumber,uint64 timestamp,uint32 chunkCount,uint256 valueSent,uint256 feeTaken)',
  'function inboxCount(address account) view returns (uint256)',
  'function sentCount(address account) view returns (uint256)',
  'function getInboxPage(address account,uint256 offset,uint256 limit) view returns (uint256[])',
  'function getSentPage(address account,uint256 offset,uint256 limit) view returns (uint256[])',
  'function getRecentConversations(address account,uint256 limit) view returns (tuple(address peer,uint256 messageId,uint64 blockNumber,uint64 timestamp)[])',
  'function conversationMessageCount(address me,address peer) view returns (uint256)',
  'function getConversationMessagePage(address me,address peer,uint256 offset,uint256 limit) view returns (uint256[])',
  'function setMyNickname(string name)',
  'function nicknames(address account) view returns (string)',
  'function getConversationBlockRange(address me, address peer) view returns (uint256 firstBlock, uint256 lastBlock)',
  'function getFirstBlockForConversation(address me, address peer) view returns (uint256)',
  'function getLastBlockForConversation(address me, address peer) view returns (uint256)',
  'function getLastMessageTime(address me, address peer) view returns (uint256)',
  'function MAX_CHUNK_CELLS() view returns (uint8)',
  'function MAX_SINGLE_MESSAGE_CELLS() view returns (uint8)',
  'function MAX_CHUNKS_PER_MESSAGE() view returns (uint32)',
  'function MAX_RECENT_CONVERSATIONS() view returns (uint256)',
  'function NICKNAME_MAX_BYTES() view returns (uint256)',
  'function feeAmount() view returns (uint256)',
  'event NicknameSet(address indexed user, string nickname)',
  'event MessageSubmitted(uint256 indexed messageId, address indexed recipient, address indexed from, uint256 valueSent, uint256 feeTaken, uint32 chunkCount)'
] as const;

export const LEGACY_CHAT_BACKUP_CONTRACT_ABI = [
  'function submit(address recipient, ((uint256[] value), bytes[] signature) memo) payable',
  'function getConversationBlockRange(address me, address peer) view returns (uint256 firstBlock, uint256 lastBlock)',
  'function getFirstBlockForConversation(address me, address peer) view returns (uint256)',
  'function getLastBlockForConversation(address me, address peer) view returns (uint256)',
  'function feeAmount() view returns (uint256)',
  'event MessageSubmitted(address indexed recipient, address indexed from, ((uint256[] value) ciphertext, (uint256[] value) userCiphertext) messageForRecipient, ((uint256[] value) ciphertext, (uint256[] value) userCiphertext) messageForSender)'
] as const;

export const GROUP_CHAT_CONTRACT_ADDRESS = '0xE175ec590CE13FB6349f1CAd8b7e9D5d21eaa32b';
export const GROUP_CHAT_CONTRACT_ABI = [
  'error AlreadyGroupMember()',
  'error GroupPaused()',
  'error GroupTooLarge()',
  'error InsufficientFee()',
  'error InvalidAddress()',
  'error InvalidGroup()',
  'error InvalidGroupTitle()',
  'error NotGroupMember()',
  'error OnlyGroupAdmin()',
  'error InvalidJoinCode()',
  'error JoinCodeExhausted()',
  'error JoinCodeExpired()',
  'error JoinCodeNotFound()',
  'error JoinCodeProofExpired()',
  'error InvalidJoinCodeProof()',
  'function feeAmount() view returns (uint256)',
  'function tokenFeeAmount() view returns (uint256)',
  'function publicFeeToken() view returns (address)',
  'function privateFeeToken() view returns (address)',
  'function rewardsContract() view returns (address)',
  'function rewardsPaused() view returns (bool)',
  'function INVITE_TTL_DEFAULT() view returns (uint64)',
  'function INVITE_TTL_MAX() view returns (uint64)',
  'function JOIN_CODE_TTL_MAX() view returns (uint64)',
  'function JOIN_CODE_MAX_USES() view returns (uint32)',
  'function nextGroupId() view returns (uint256)',
  'function createGroup(string title, address[] initialMembers) returns (uint256 groupId)',
  'function addMembers(uint256 groupId, address[] accounts)',
  'function inviteMembers(uint256 groupId, address[] accounts, uint64 inviteTtlSeconds)',
  'function createJoinCode(uint256 groupId, bytes32 codeHash, address codeSigner, uint64 ttlSeconds, uint32 maxUses, ((uint256[] value), bytes[] signature) encryptedCode)',
  'function getJoinCode(uint256 groupId, bytes32 codeHash) view returns (bool active, address creator, address signer, uint64 expiresAt, uint32 usesLeft, bool expired)',
  'function getJoinCodeForAdmin(uint256 groupId, bytes32 codeHash) returns (((uint256[] value) ciphertext, (uint256[] value) userCiphertext) codeForAdmin)',
  'function getActiveJoinCodeHashesPage(uint256 groupId, uint256 offset, uint256 limit) view returns (bytes32[] hashes, uint256 nextOffset)',
  'function joinWithCode(uint256 groupId, bytes32 codeHash, uint64 signatureDeadline, bytes signature)',
  'function revokeJoinCode(uint256 groupId, bytes32 codeHash)',
  'function acceptInvite(uint256 groupId)',
  'function declineInvite(uint256 groupId)',
  'function setGroupAdmin(uint256 groupId, address newAdmin)',
  'function setGroupTitle(uint256 groupId, string nextTitle)',
  'function leaveGroup(uint256 groupId)',
  'function disbandGroup(uint256 groupId)',
  'function removeMember(uint256 groupId, address account)',
  'function getInvite(uint256 groupId, address account) view returns (bool pending, address inviter, uint64 expiresAt, bool expired)',
  'function getGroupInfo(uint256 groupId) view returns (address admin, uint64 createdAt, uint32 memberCount, string title, uint256 lastBlock, uint256 lastTimestamp)',
  'function lastMessageBlockForGroup(uint256 groupId) view returns (uint256)',
  'function getGroupMembers(uint256 groupId) view returns (address[])',
  'function getGroupsForMemberPage(address account, uint256 cursor, uint256 limit) view returns (uint256[] groupIds, uint256 nextCursor)',
  'function isMember(uint256 groupId, address account) view returns (bool)',
  'function submitGroupMessage(uint256 groupId, ((uint256[] value), bytes[] signature) encryptedMessage) payable',
  'function submitGroupMessageWithMode(uint256 groupId, ((uint256[] value), bytes[] signature) encryptedMessage, uint8 paymentMode) payable',
  'event GroupCreated(uint256 indexed groupId, address indexed admin, string title)',
  'event GroupMemberAdded(uint256 indexed groupId, address indexed account)',
  'event GroupMemberRemoved(uint256 indexed groupId, address indexed account)',
  'event GroupMemberLeft(uint256 indexed groupId, address indexed account)',
  'event GroupInviteCreated(uint256 indexed groupId, address indexed account, address indexed inviter, uint64 expiresAt)',
  'event GroupInviteAccepted(uint256 indexed groupId, address indexed account, address indexed inviter)',
  'event GroupInviteDeclined(uint256 indexed groupId, address indexed account, address indexed inviter)',
  'event GroupInviteRevoked(uint256 indexed groupId, address indexed account, address indexed revokedBy)',
  'event GroupJoinCodeCreated(uint256 indexed groupId, bytes32 indexed codeHash, address indexed creator, address signer, uint64 expiresAt, uint32 usesLeft)',
  'event GroupJoinCodeRevoked(uint256 indexed groupId, bytes32 indexed codeHash, address indexed revokedBy)',
  'event GroupJoinedWithCode(uint256 indexed groupId, address indexed account, bytes32 indexed codeHash, address creator)',
  'event GroupMessageSubmitted(uint256 indexed groupId, address indexed from, ((uint256[] value) ciphertext, (uint256[] value) userCiphertext) messageForSender, uint256 valueSent, uint256 feeTaken)',
  'event GroupMessageDelivered(uint256 indexed groupId, address indexed from, address indexed recipient, ((uint256[] value) ciphertext, (uint256[] value) userCiphertext) messageForRecipient)'
] as const;

export const OTC_ESCROW_CONTRACT_ADDRESS = '0x7a232810f250a2C6e90895215aFf826116DFDb06';
export const OTC_READER_CONTRACT_ADDRESS = '0x77889B2f9F9fD812ad65AfF41048426fA1382660';
export const PRIVATE_ORDERS_CONTRACT_ADDRESS = '0xe211c032E4432FdeB9e48f06b69EB98583B2A231';
export const DIRECT_OTC_CONTRACT_ADDRESS = '0x634c6dddda784c29d0435Cc54ca072Af0551914a';
export const RECURRING_OTC_CONTRACT_ADDRESS = '0x7235B18b9CD59fB9853BC3BF3a0A65bc32162cd5';
export const OTC_REGISTRY_CONTRACT_ADDRESS = '0x91e32EdFAb1e74DA07ea3012491a44D983aeBA46';
export const OTC_HISTORY_READER_CONTRACT_ADDRESS = '0x650666328A771d70881c189F3B2BB1F3fBfe0514';
export const CW_PROFILE_REGISTRY_CONTRACT_ADDRESS = '0xf37196Fafe760E92d3542D837a1595B2a625F618';
export const TRADE_ESCROW_CONTRACT_ADDRESS = OTC_ESCROW_CONTRACT_ADDRESS;
export const PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS = PRIVATE_ORDERS_CONTRACT_ADDRESS;
export const DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS = DIRECT_OTC_CONTRACT_ADDRESS;
export const buildTradeSnapshotKey = (tradeId: number, escrowContract?: string): string =>
  `${(escrowContract || TRADE_ESCROW_CONTRACT_ADDRESS).toLowerCase()}:${tradeId}`;

const CT_UINT256_ABI = '(uint256 ciphertextHigh, uint256 ciphertextLow)';
const IT_UINT256_ABI = `(${CT_UINT256_ABI} ciphertext, bytes signature)`;
const UT_UINT256_ABI = `(${CT_UINT256_ABI} ciphertext, ${CT_UINT256_ABI} userCiphertext)`;

export const TRADE_ESCROW_CONTRACT_ABI = [
  'function feeRecipient() view returns (address)',
  'function feeAmount() view returns (uint256)',
  'function chargeFeeOnEdit() view returns (bool)',
  'function defaultMinPartialFillBps() view returns (uint16)',
  'function nextTradeId() view returns (uint256)',
  'function contractVersion() pure returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)',
  'function configurePrivateToken(address token, address encryptionAddress)',
  'function setTrustedDirectCounterEscrow(address escrow, bool trusted)',
  'function closeParentTradeByDirectCounter(uint256 parentTradeId, address counterMaker, address counterTaker, address acceptedBy, address directEscrow, uint256 directCounterTradeId)',
  'function createTrade((uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, address taker, uint64 expiresAt) payable returns (uint256 tradeId)',
  'function createTradeAdvanced((uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, address taker, uint64 expiresAt, bool isPublic, bytes32 accessHash, uint256 parentTradeId) payable returns (uint256 tradeId)',
  'function createTradeWithPolicy((uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, address taker, uint64 expiresAt, bool isPublic, bytes32 accessHash, uint256 parentTradeId, (bool partialFillsAllowed, uint16 minPartialFillBps, uint256 minRequestAmount, uint256 maxRequestAmountPerWallet, bool oneFillPerWallet) policy) payable returns (uint256 tradeId)',
  'function acceptTrade(uint256 tradeId) payable',
  'function fillTrade(uint256 tradeId, uint256 requestAmountIn, uint256 minOfferAmountOut) payable returns (uint256 offerAmountOut)',
  'function acceptCounterTradeAndCloseParent(uint256 counterTradeId) payable',
  'function counterTradeAndCloseCounteredTrade(uint256 counteredTradeId, (uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, uint64 expiresAt) payable returns (uint256 newCounterTradeId)',
  'function cancelTrade(uint256 tradeId)',
  'function declineTrade(uint256 tradeId)',
  'function reclaimExpiredTrade(uint256 tradeId)',
  'function extendTradeExpiry(uint256 tradeId, uint64 nextExpiresAt)',
  'function refreshTrade(uint256 tradeId)',
  'function lastActivityBlock(uint256 tradeId) view returns (uint256)',
  'function editTrade(uint256 originalTradeId, (uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, address taker, uint64 expiresAt, bool isPublic, bytes32 accessHash) payable returns (uint256 tradeId)',
  'function editTradeWithPolicy(uint256 originalTradeId, (uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, address taker, uint64 expiresAt, bool isPublic, bytes32 accessHash, (bool partialFillsAllowed, uint16 minPartialFillBps, uint256 minRequestAmount, uint256 maxRequestAmountPerWallet, bool oneFillPerWallet) policy) payable returns (uint256 tradeId)',
  'function getTradeView(uint256 tradeId) view returns (((address maker, address taker, uint8 status, (uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, uint64 createdAt, uint64 expiresAt) trade, (bool isPublic, bytes32 accessHash, uint256 parentTradeId, uint256 feePaid) metadata, (uint256 remainingOfferAmount, uint256 remainingRequestAmount, uint256 filledOfferAmount, uint256 filledRequestAmount) fillState, (bool partialFillsAllowed, uint16 minPartialFillBps, uint256 minRequestAmount, uint256 maxRequestAmountPerWallet, bool oneFillPerWallet) fillPolicy, uint8 effectiveStatus, uint256 replacementTradeId, uint256 replacesTradeId, uint256 rootTradeId))',
  'function getTradeFillForAccount(uint256 tradeId, address account) view returns (uint256 offerAmountReceived, uint256 requestAmountPaid)',
  'function counterParentTradeId(uint256 tradeId) view returns (uint256)',
  'function replacementTradeId(uint256 tradeId) view returns (uint256)',
  'function replacesTradeId(uint256 tradeId) view returns (uint256)',
  'function rootTradeId(uint256 tradeId) view returns (uint256)',
  'function quoteFill(uint256 tradeId, uint256 requestAmountIn) view returns (uint256 requestAmountIn, uint256 offerAmountOut, bool isFinalFill, uint256 remainingOfferAmountAfter, uint256 remainingRequestAmountAfter)',
  'function getCounterTradeIds(uint256 parentTradeId, uint256 offset, uint256 limit) view returns (uint256[] tradeIds, uint256 nextOffset)',
  'function getOpenPublicTradeIds(uint256 offset, uint256 limit) view returns (uint256[] tradeIds, uint256 nextOffset)',
  'function getOpenPublicTradeIdsByPair(bytes32 pairKey, uint256 offset, uint256 limit) view returns (uint256[] tradeIds, uint256 nextOffset)',
  'function getRecentTradeIds(uint256 offset, uint256 limit) view returns (uint256[] tradeIds, uint256 nextOffset)',
  'function getTradeIdsForMaker(address maker, uint256 offset, uint256 limit) view returns (uint256[] tradeIds, uint256 nextOffset)',
  'function getTradeIdsForTaker(address taker, uint256 offset, uint256 limit) view returns (uint256[] tradeIds, uint256 nextOffset)',
  'function getTradeIdsForFiller(address filler, uint256 offset, uint256 limit) view returns (uint256[] tradeIds, uint256 nextOffset)',
  'event TradeOpened(uint256 indexed tradeId, address indexed maker, address indexed taker, bool isPublic, bytes32 accessHash, uint256 parentTradeId, uint64 createdAt, uint64 expiresAt, uint256 feePaid)',
  'event TradeAccepted(uint256 indexed tradeId, address indexed taker, bool wasOpenPublicTrade)',
  'event TradeCancelled(uint256 indexed tradeId, address indexed maker)',
  'event TradeDeclined(uint256 indexed tradeId, address indexed taker)',
  'event TradeExpired(uint256 indexed tradeId, address indexed maker, address indexed actor)',
  'event TradeRefreshed(uint256 indexed tradeId, address indexed maker, uint256 blockNumber)',
  'event TradeReplaced(uint256 indexed originalTradeId, uint256 indexed replacementTradeId, uint256 indexed rootTradeId)',
  'event TradePartiallyFilled(uint256 indexed tradeId, address indexed filler, uint256 requestAmountIn, uint256 offerAmountOut, uint256 remainingOfferAmount, uint256 remainingRequestAmount)',
  'event TradeFilled(uint256 indexed tradeId)',
  'event CounterTradeAccepted(uint256 indexed counterTradeId, uint256 indexed parentTradeId, address indexed taker)',
  'event CounterTradeRegistered(uint256 indexed parentTradeId, uint256 indexed counterTradeId)',
  'event CounterTradeSuperseded(uint256 indexed parentTradeId, uint256 indexed previousCounterTradeId, uint256 indexed nextCounterTradeId)',
  'event ParentTradeClosedByCounter(uint256 indexed parentTradeId, uint256 indexed counterTradeId, uint8 parentStatus)',
  'event ParentTradeClosedByDirectCounter(uint256 indexed parentTradeId, address indexed directEscrow, uint256 indexed directCounterTradeId, address counterMaker, address counterTaker, address acceptedBy, uint8 parentStatus)',
  'event SiblingCounterClosed(uint256 indexed parentTradeId, uint256 indexed acceptedCounterTradeId, uint256 indexed siblingCounterTradeId, uint8 siblingStatus)'
] as const;

export const PRIVATE_TRADE_ESCROW_CONTRACT_ABI = [
  'function feeRecipient() view returns (address)',
  'function feeAmount() view returns (uint256)',
  'function nextTradeId() view returns (uint256)',
  'function contractVersion() pure returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)',
  'function configurePrivateToken(address token, address encryptionAddress)',
  'function trustedDirectCounterEscrow(address escrow) view returns (bool)',
  'function setTrustedDirectCounterEscrow(address escrow, bool trusted)',
  'function closeParentTradeByDirectCounter(uint256 parentTradeId, address counterMaker, address counterTaker, address acceptedBy, address directEscrow, uint256 directCounterTradeId)',
  `function createPrivateOrderWithRecoveryNote((uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, address taker, uint64 expiresAt, bool isPublic, bytes32 accessHash, bytes32 termsHash, ${IT_UINT256_ABI} hiddenOfferAmount, ${IT_UINT256_ABI} encryptedOfferAmount, ${IT_UINT256_ABI} encryptedRequestAmount, bytes encryptedMakerRecoveryNote, ${IT_UINT256_ABI} encryptedAccessSecret, bytes termsPayload) payable returns (uint256 tradeId)`,
  `function cancelAndReplacePrivateOrderWithRecoveryNote(uint256 originalTradeId, (uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, address taker, uint64 expiresAt, bool isPublic, bytes32 accessHash, bytes32 termsHash, ${IT_UINT256_ABI} hiddenOfferAmount, ${IT_UINT256_ABI} encryptedOfferAmount, ${IT_UINT256_ABI} encryptedRequestAmount, bytes encryptedMakerRecoveryNote, ${IT_UINT256_ABI} encryptedAccessSecret, bytes termsPayload) payable returns (uint256 tradeId)`,
  `function fillPrivateOrder(uint256 tradeId, ${IT_UINT256_ABI} maxRequestAmountIn) returns (bool fullyFilled)`,
  `function fillPrivateOrderWithEncryptedAccess(uint256 tradeId, ${IT_UINT256_ABI} maxRequestAmountIn, ${IT_UINT256_ABI} encryptedAccessSecret) returns (bool fullyFilled)`,
  'function fillHybridPrivateOrder(uint256 tradeId, uint256 requestAmountIn) payable returns (bool fullyFilled)',
  `function fillHybridPrivateOrderWithEncryptedAccess(uint256 tradeId, uint256 requestAmountIn, ${IT_UINT256_ABI} encryptedAccessSecret) payable returns (bool fullyFilled)`,
  'function cancelTrade(uint256 tradeId)',
  'function declineTrade(uint256 tradeId)',
  'function reclaimExpiredTrade(uint256 tradeId)',
  'function refreshTrade(uint256 tradeId)',
  'function lastActivityBlock(uint256 tradeId) view returns (uint256)',
  'function getTrade(uint256 tradeId) view returns (address maker, address taker, uint8 status, (uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, uint64 createdAt, uint64 expiresAt)',
  'function getTradeMetadata(uint256 tradeId) view returns (bool isPublic, bytes32 accessHash, uint256 feePaid, bytes32 termsHash, uint8 mode, bool hasMakerRecoveryNote)',
  'function getTradeFillState(uint256 tradeId) view returns (uint256 remainingOfferAmount, uint256 remainingRequestAmount, uint256 filledOfferAmount, uint256 filledRequestAmount)',
  'function getTradeView(uint256 tradeId) view returns (((address maker, address taker, uint8 status, (uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, uint64 createdAt, uint64 expiresAt) trade, (bool isPublic, bytes32 accessHash, uint256 feePaid, bytes32 termsHash, uint8 mode, bool hasMakerRecoveryNote) metadata, (uint256 remainingOfferAmount, uint256 remainingRequestAmount, uint256 filledOfferAmount, uint256 filledRequestAmount) fillState, uint8 effectiveStatus, uint256 replacementTradeId, uint256 replacesTradeId))',
  'function getTradeViews(uint256[] tradeIds) view returns (((address maker, address taker, uint8 status, (uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, uint64 createdAt, uint64 expiresAt) trade, (bool isPublic, bytes32 accessHash, uint256 feePaid, bytes32 termsHash, uint8 mode, bool hasMakerRecoveryNote) metadata, (uint256 remainingOfferAmount, uint256 remainingRequestAmount, uint256 filledOfferAmount, uint256 filledRequestAmount) fillState, uint8 effectiveStatus, uint256 replacementTradeId, uint256 replacesTradeId)[] views)',
  `function offboardRemainingPrivateOrderForMaker(uint256 tradeId) returns (${UT_UINT256_ABI} remainingOfferAmount)`,
  'function getMakerRecoveryNote(uint256 tradeId) view returns (bytes encryptedPayload)',
  'function getPrivateLinkTermsPayload(uint256 tradeId) view returns (bytes encryptedPayload)',
  'function replacementTradeId(uint256 tradeId) view returns (uint256)',
  'function replacesTradeId(uint256 tradeId) view returns (uint256)',
  'function openPublicTradeCount() view returns (uint256)',
  'function getOpenPublicTradeIds(uint256 offset, uint256 limit) view returns (uint256[] tradeIds, uint256 nextOffset)',
  'function getRecentTradeIds(uint256 offset, uint256 limit) view returns (uint256[] tradeIds, uint256 nextOffset)',
  'function getTradeIdsForMaker(address maker, uint256 offset, uint256 limit) view returns (uint256[] tradeIds, uint256 nextOffset)',
  'function getTradeIdsForTaker(address taker, uint256 offset, uint256 limit) view returns (uint256[] tradeIds, uint256 nextOffset)',
  'function getTradeIdsForFiller(address filler, uint256 offset, uint256 limit) view returns (uint256[] tradeIds, uint256 nextOffset)',
  `function getPrivateOrderAccountSnapshot(uint256 tradeId, address account) view returns ((uint256 sequence, bool initialized, ${UT_UINT256_ABI} remainingOfferAmount) snapshot)`,
  `function getPrivateOrderAccountSummary(uint256 tradeId, address account) view returns ((uint256 sequence, bool initialized, ${UT_UINT256_ABI} remainingOfferAmount, uint256 fillReceiptTotal) summary)`,
  'event PrivateOrderOpened(uint256 indexed tradeId, address indexed maker, address indexed taker, uint8 mode, bool isPublic, bool hasAccessHash, uint64 createdAt, uint64 expiresAt, bytes32 termsHash, uint256 feePaid)',
  'event PrivateOrderAssets(uint256 indexed tradeId, (uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset)',
  'event MakerRecoveryNoteStored(uint256 indexed tradeId, address indexed maker, bytes encryptedPayload)',
  'event PrivateOrderFilled(uint256 indexed tradeId, address indexed filler, bool fullyFilled, uint256 publicRequestAmountIn)',
  `event PrivateOrderFillReceipt(uint256 indexed tradeId, address indexed recipient, address indexed filler, uint256 fillIndex, ${UT_UINT256_ABI} offerAmount, ${UT_UINT256_ABI} requestAmount, ${UT_UINT256_ABI} remainingOfferAmount)`,
  `event PrivateOrderAccountSnapshotUpdated(uint256 indexed tradeId, address indexed recipient, uint256 sequence, ${UT_UINT256_ABI} remainingOfferAmount)`,
  'event TradeAccepted(uint256 indexed tradeId, address indexed taker, bool wasOpenPublicTrade)',
  'event TradeCancelled(uint256 indexed tradeId, address indexed maker)',
  'event TradeDeclined(uint256 indexed tradeId, address indexed taker)',
  'event TradeExpired(uint256 indexed tradeId, address indexed maker, address indexed actor)',
  'event TradeReplaced(uint256 indexed originalTradeId, uint256 indexed replacementTradeId)',
  'event TradeFilled(uint256 indexed tradeId)',
  'event PrivateOrderRefreshed(uint256 indexed tradeId, address indexed maker, uint256 blockNumber)',
  'event TrustedDirectCounterEscrowSet(address indexed escrow, bool trusted)',
  'event ParentTradeClosedByDirectCounter(uint256 indexed parentTradeId, address indexed directEscrow, uint256 indexed directCounterTradeId, address counterMaker, address counterTaker, address acceptedBy, uint8 parentStatus)'
] as const;

export const DIRECT_TRADE_ESCROW_CONTRACT_ABI = [
  'function feeRecipient() view returns (address)',
  'function feeAmount() view returns (uint256)',
  'function nextTradeId() view returns (uint256)',
  'function contractVersion() pure returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)',
  'function configurePrivateToken(address token, address encryptionAddress)',
  `function createDirectTrade((uint8 assetType, address token) offerAsset, (uint8 assetType, address token) requestAsset, (uint256 offerAmount, uint256 requestAmount) publicAmounts, ${IT_UINT256_ABI} encryptedOfferAmount, ${IT_UINT256_ABI} encryptedRequestAmount, address taker, uint64 expiresAt, bytes32 accessHash, bytes32 termsHash, ${IT_UINT256_ABI} encryptedAccessSecret, bytes termsPayload) payable returns (uint256 tradeId)`,
  `function createDirectCounterTrade(uint256 parentTradeId, (uint8 assetType, address token) offerAsset, (uint8 assetType, address token) requestAsset, (uint256 offerAmount, uint256 requestAmount) publicAmounts, ${IT_UINT256_ABI} encryptedOfferAmount, ${IT_UINT256_ABI} encryptedRequestAmount, uint64 expiresAt, bytes32 accessHash, bytes32 termsHash, ${IT_UINT256_ABI} encryptedAccessSecret, bytes termsPayload) payable returns (uint256 tradeId)`,
  `function createDirectCounterTradeForParent(address parentEscrow, uint256 parentTradeId, address counterTaker, (uint8 assetType, address token) offerAsset, (uint8 assetType, address token) requestAsset, (uint256 offerAmount, uint256 requestAmount) publicAmounts, ${IT_UINT256_ABI} encryptedOfferAmount, ${IT_UINT256_ABI} encryptedRequestAmount, uint64 expiresAt, bytes32 accessHash, bytes32 termsHash, ${IT_UINT256_ABI} encryptedAccessSecret, bytes termsPayload) payable returns (uint256 tradeId)`,
  `function counterTradeAndCloseCounteredTrade(uint256 counteredTradeId, (uint8 assetType, address token) offerAsset, (uint8 assetType, address token) requestAsset, (uint256 offerAmount, uint256 requestAmount) publicAmounts, ${IT_UINT256_ABI} encryptedOfferAmount, ${IT_UINT256_ABI} encryptedRequestAmount, uint64 expiresAt, bytes32 accessHash, bytes32 termsHash, ${IT_UINT256_ABI} encryptedAccessSecret, bytes termsPayload) payable returns (uint256 tradeId)`,
  `function editDirectTrade(uint256 originalTradeId, (uint8 assetType, address token) offerAsset, (uint8 assetType, address token) requestAsset, (uint256 offerAmount, uint256 requestAmount) publicAmounts, ${IT_UINT256_ABI} encryptedOfferAmount, ${IT_UINT256_ABI} encryptedRequestAmount, address taker, uint64 expiresAt, bytes32 accessHash, bytes32 termsHash, ${IT_UINT256_ABI} encryptedAccessSecret, bytes termsPayload) payable returns (uint256 tradeId)`,
  `function acceptDirectTrade(uint256 tradeId, ${IT_UINT256_ABI} encryptedRequestAmount) payable`,
  `function acceptDirectTradeWithEncryptedAccess(uint256 tradeId, ${IT_UINT256_ABI} encryptedRequestAmount, ${IT_UINT256_ABI} encryptedAccessSecret) payable`,
  `function acceptCounterTradeAndCloseParent(uint256 counterTradeId, ${IT_UINT256_ABI} encryptedRequestAmount) payable`,
  'function cancelTrade(uint256 tradeId)',
  'function declineTrade(uint256 tradeId)',
  'function reclaimExpiredTrade(uint256 tradeId)',
  'function lastActivityBlock(uint256 tradeId) view returns (uint256)',
  'function counterParentEscrow(uint256 tradeId) view returns (address)',
  'function counterParentTradeId(uint256 tradeId) view returns (uint256)',
  'function replacementTradeId(uint256 tradeId) view returns (uint256)',
  'function replacesTradeId(uint256 tradeId) view returns (uint256)',
  'function rootTradeId(uint256 tradeId) view returns (uint256)',
  'function getTradeView(uint256 tradeId) view returns (((address maker, address taker, uint8 status, (uint8 assetType, address token) offerAsset, (uint8 assetType, address token) requestAsset, uint64 createdAt, uint64 expiresAt) trade, (bytes32 accessHash, uint256 parentTradeId, uint256 feePaid, bytes32 termsHash, bool hasTermsPayload, bool hasMakerAccessSecret, bool hasTakerAccessSecret, bool publicAmountCaveat) metadata, uint8 effectiveStatus, uint256 replacementTradeId, uint256 replacesTradeId, uint256 rootTradeId, bool offerAmountPrivate, bool requestAmountPrivate))',
  'function getDirectTermPayload(uint256 tradeId) view returns (bytes encryptedPayload)',
  `function getDirectAccessSecretForAccount(uint256 tradeId) view returns (${UT_UINT256_ABI} accessSecret)`,
  'function getTradeIdsForMaker(address maker, uint256 offset, uint256 limit) view returns (uint256[] tradeIds, uint256 nextOffset)',
  'function getTradeIdsForTaker(address taker, uint256 offset, uint256 limit) view returns (uint256[] tradeIds, uint256 nextOffset)',
  'function getTradeIdsForFiller(address filler, uint256 offset, uint256 limit) view returns (uint256[] tradeIds, uint256 nextOffset)',
  'function getCounterTradeIdsForParent(address parentEscrow, uint256 parentTradeId, uint256 offset, uint256 limit) view returns (uint256[] tradeIds, uint256 nextOffset)',
  'event DirectTradeOpened(uint256 indexed tradeId, address indexed maker, address indexed taker, bool hasAccessHash, uint256 parentTradeId, uint64 createdAt, uint64 expiresAt, bytes32 termsHash, uint256 feePaid)',
  'event DirectTradeAssets(uint256 indexed tradeId, (uint8 assetType, address token) offerAsset, (uint8 assetType, address token) requestAsset)',
  'event DirectTradeTermsStored(uint256 indexed tradeId, address indexed maker, bool hasTermsPayload, bool hasMakerAccessSecret, bool hasTakerAccessSecret)',
  'event DirectTradeAccepted(uint256 indexed tradeId, address indexed taker)',
  'event DirectTradeFilled(uint256 indexed tradeId)',
  'event DirectTradeCancelled(uint256 indexed tradeId, address indexed maker)',
  'event DirectTradeDeclined(uint256 indexed tradeId, address indexed taker)',
  'event DirectTradeExpired(uint256 indexed tradeId, address indexed maker, address indexed actor)',
  'event DirectTradeReplaced(uint256 indexed originalTradeId, uint256 indexed replacementTradeId, uint256 indexed rootTradeId)',
  'event CounterTradeAccepted(uint256 indexed counterTradeId, uint256 indexed parentTradeId, address indexed taker)',
  'event CounterTradeRegistered(uint256 indexed parentTradeId, uint256 indexed counterTradeId)',
  'event CounterTradeSuperseded(uint256 indexed parentTradeId, uint256 indexed previousCounterTradeId, uint256 indexed nextCounterTradeId)',
  'event ParentTradeClosedByCounter(uint256 indexed parentTradeId, uint256 indexed counterTradeId, uint8 parentStatus)',
  'event SiblingCounterClosed(uint256 indexed parentTradeId, uint256 indexed acceptedCounterTradeId, uint256 indexed siblingCounterTradeId, uint8 siblingStatus)'
] as const;

export const OTC_READER_CONTRACT_ABI = [
  'function contractVersion() pure returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)',
  'function getPublicDeskPage(address standardEscrow, address privateEscrow, address recurringEscrow, uint256 offset, uint256 limit, bytes32 pairKey, uint8 accessFilter) view returns ((address contractAddress, uint256 localId, uint8 kind, address maker, address taker, uint8 status, bool isPublic, bool hiddenAmount, bool hasPrivateInventory, uint256 lastActivityBlock)[] items, uint256 nextOffset)',
  'function getWalletDeskPage(address account, address standardEscrow, address privateEscrow, address recurringEscrow, uint256 offset, uint256 limit) view returns ((address contractAddress, uint256 localId, uint8 kind, address maker, address taker, uint8 status, bool isPublic, bool hiddenAmount, bool hasPrivateInventory, uint256 lastActivityBlock)[] items, uint256 nextOffset)',
  'function getWalletDeskPageV2(address account, address standardEscrow, address privateEscrow, address directEscrow, address recurringEscrow, uint256 offset, uint256 limit) view returns ((address contractAddress, uint256 localId, uint8 kind, address maker, address taker, uint8 status, bool isPublic, bool hiddenAmount, bool hasPrivateInventory, uint256 lastActivityBlock)[] items, uint256 nextOffset)',
  'function getWalletActivityPage(address account, address standardEscrow, address privateEscrow, address directEscrow, address recurringEscrow, uint256 offset, uint256 limit) view returns ((address contractAddress, uint256 localId, uint8 kind, uint8 actionKind, address counterparty, uint256 blockNumber, uint256 sequence)[] items, uint256 nextOffset)',
  'function getTradeViews(address escrow, uint256[] tradeIds) view returns (((address maker, address taker, uint8 status, (uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, uint64 createdAt, uint64 expiresAt) trade, (bool isPublic, bytes32 accessHash, uint256 parentTradeId, uint256 feePaid) metadata, (uint256 remainingOfferAmount, uint256 remainingRequestAmount, uint256 filledOfferAmount, uint256 filledRequestAmount) fillState, (bool partialFillsAllowed, uint16 minPartialFillBps, uint256 minRequestAmount, uint256 maxRequestAmountPerWallet, bool oneFillPerWallet) fillPolicy, uint8 effectiveStatus, uint256 replacementTradeId, uint256 replacesTradeId, uint256 rootTradeId)[] views)',
  'function getOpenPublicTradeViews(address escrow, uint256 offset, uint256 limit) view returns (((address maker, address taker, uint8 status, (uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, uint64 createdAt, uint64 expiresAt) trade, (bool isPublic, bytes32 accessHash, uint256 parentTradeId, uint256 feePaid) metadata, (uint256 remainingOfferAmount, uint256 remainingRequestAmount, uint256 filledOfferAmount, uint256 filledRequestAmount) fillState, (bool partialFillsAllowed, uint16 minPartialFillBps, uint256 minRequestAmount, uint256 maxRequestAmountPerWallet, bool oneFillPerWallet) fillPolicy, uint8 effectiveStatus, uint256 replacementTradeId, uint256 replacesTradeId, uint256 rootTradeId)[] views, uint256 nextOffset)',
  'function getOpenPublicTradeViewsByPair(address escrow, bytes32 pairKey, uint256 offset, uint256 limit) view returns (((address maker, address taker, uint8 status, (uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, uint64 createdAt, uint64 expiresAt) trade, (bool isPublic, bytes32 accessHash, uint256 parentTradeId, uint256 feePaid) metadata, (uint256 remainingOfferAmount, uint256 remainingRequestAmount, uint256 filledOfferAmount, uint256 filledRequestAmount) fillState, (bool partialFillsAllowed, uint16 minPartialFillBps, uint256 minRequestAmount, uint256 maxRequestAmountPerWallet, bool oneFillPerWallet) fillPolicy, uint8 effectiveStatus, uint256 replacementTradeId, uint256 replacesTradeId, uint256 rootTradeId)[] views, uint256 nextOffset)',
  'function getTradeViewsForMaker(address escrow, address maker, uint256 offset, uint256 limit) view returns (((address maker, address taker, uint8 status, (uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, uint64 createdAt, uint64 expiresAt) trade, (bool isPublic, bytes32 accessHash, uint256 parentTradeId, uint256 feePaid) metadata, (uint256 remainingOfferAmount, uint256 remainingRequestAmount, uint256 filledOfferAmount, uint256 filledRequestAmount) fillState, (bool partialFillsAllowed, uint16 minPartialFillBps, uint256 minRequestAmount, uint256 maxRequestAmountPerWallet, bool oneFillPerWallet) fillPolicy, uint8 effectiveStatus, uint256 replacementTradeId, uint256 replacesTradeId, uint256 rootTradeId)[] views, uint256 nextOffset)',
  'function getTradeViewsForTaker(address escrow, address taker, uint256 offset, uint256 limit) view returns (((address maker, address taker, uint8 status, (uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, uint64 createdAt, uint64 expiresAt) trade, (bool isPublic, bytes32 accessHash, uint256 parentTradeId, uint256 feePaid) metadata, (uint256 remainingOfferAmount, uint256 remainingRequestAmount, uint256 filledOfferAmount, uint256 filledRequestAmount) fillState, (bool partialFillsAllowed, uint16 minPartialFillBps, uint256 minRequestAmount, uint256 maxRequestAmountPerWallet, bool oneFillPerWallet) fillPolicy, uint8 effectiveStatus, uint256 replacementTradeId, uint256 replacesTradeId, uint256 rootTradeId)[] views, uint256 nextOffset)',
  'function getTradeViewsForFiller(address escrow, address filler, uint256 offset, uint256 limit) view returns (((address maker, address taker, uint8 status, (uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, uint64 createdAt, uint64 expiresAt) trade, (bool isPublic, bytes32 accessHash, uint256 parentTradeId, uint256 feePaid) metadata, (uint256 remainingOfferAmount, uint256 remainingRequestAmount, uint256 filledOfferAmount, uint256 filledRequestAmount) fillState, (bool partialFillsAllowed, uint16 minPartialFillBps, uint256 minRequestAmount, uint256 maxRequestAmountPerWallet, bool oneFillPerWallet) fillPolicy, uint8 effectiveStatus, uint256 replacementTradeId, uint256 replacesTradeId, uint256 rootTradeId)[] views, uint256 nextOffset)'
] as const;

export const OTC_REGISTRY_CONTRACT_ABI = [
  'function contractVersion() pure returns (string)',
  'function supportsFeature(bytes32 feature) pure returns (bool)',
  'function owner() view returns (address)',
  'function getContracts() view returns ((address standardEscrow, address privateEscrow, address directEscrow, address recurringEscrow, address reader, address historyReader))',
  'function setContracts((address standardEscrow, address privateEscrow, address directEscrow, address recurringEscrow, address reader, address historyReader) nextContracts)',
  'event ContractsUpdated(address indexed updater, address standardEscrow, address privateEscrow, address directEscrow, address recurringEscrow, address reader, address historyReader)'
] as const;

export const CW_PROFILE_REGISTRY_GC_CONTRACT_ABI = [
  'function contractVersion() pure returns (string)',
  'function supportsFeature(bytes32 feature) pure returns (bool)',
  'function MAX_PROFILE_CELLS() view returns (uint256)',
  'function addProfile(((uint256[] value), bytes[] signature) encryptedPayload, bool makeDefault) returns (uint256 profileId)',
  'function setProfile(uint256 profileId, ((uint256[] value), bytes[] signature) encryptedPayload)',
  'function clearProfile(uint256 profileId)',
  'function setDefaultProfile(uint256 profileId)',
  'function getProfile(address owner, uint256 profileId) view returns ((uint256[] value) encryptedPayload, bool active, uint64 version, uint256 cellCount)',
  'function getProfileSummary(address owner, uint256 profileId) view returns (uint64 version, bool active, uint256 cellCount)',
  'function getProfileSummaries(address owner) view returns ((uint64 version, bool active, uint32 cellCount)[] summaries, uint256 defaultProfileId, bool hasDefault)',
  'function getDefaultProfile(address owner) view returns (uint256 profileId, bool exists)',
  'function profileCount(address owner) view returns (uint256)'
] as const;

export const OTC_HISTORY_READER_CONTRACT_ABI = [
  'function contractVersion() pure returns (string)',
  'function supportsFeature(bytes32 feature) pure returns (bool)',
  'function getWalletHistoryPage(address account, address registry, uint256 offset, uint256 limit) view returns ((address contractAddress, uint256 localId, uint8 kind, uint8 role, address counterparty, uint8 status, uint256 lastActivityBlock, uint256 sequence, uint8 amountVisibility)[] items, uint256 nextOffset)',
  'function getWalletHistoryPageFromContracts(address account, address standardEscrow, address privateEscrow, address directEscrow, address recurringEscrow, uint256 offset, uint256 limit) view returns ((address contractAddress, uint256 localId, uint8 kind, uint8 role, address counterparty, uint8 status, uint256 lastActivityBlock, uint256 sequence, uint8 amountVisibility)[] items, uint256 nextOffset)'
] as const;

export const RECURRING_OTC_CONTRACT_ABI = [
  'function feeRecipient() view returns (address)',
  'function feeAmount() view returns (uint256)',
  'function nextOrderId() view returns (uint256)',
  'function contractVersion() pure returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)',
  'function configurePrivateToken(address token, address encryptionAddress)',
  'function createRecurringOrder((uint8 assetType, address token) baseAsset, (uint8 assetType, address token) quoteAsset, (uint256 baseAmount, uint256 quoteAmount) buyTerms, (uint256 baseAmount, uint256 quoteAmount) sellTerms, address taker, bool isPublic, bytes32 accessHash, uint256 initialBaseInventory, uint256 initialQuoteInventory) payable returns (uint256 orderId)',
  'function createRecurringOrderWithRecoveryNote((uint8 assetType, address token) baseAsset, (uint8 assetType, address token) quoteAsset, (uint256 baseAmount, uint256 quoteAmount) buyTerms, (uint256 baseAmount, uint256 quoteAmount) sellTerms, address taker, bool isPublic, bytes32 accessHash, uint256 initialBaseInventory, uint256 initialQuoteInventory, bytes encryptedMakerRecoveryNote) payable returns (uint256 orderId)',
  `function createPrivateRecurringOrder((uint8 assetType, address token) baseAsset, (uint8 assetType, address token) quoteAsset, (uint256 baseAmount, uint256 quoteAmount) buyTerms, (uint256 baseAmount, uint256 quoteAmount) sellTerms, address taker, bool isPublic, bytes32 accessHash, uint256 initialBaseInventory, uint256 initialQuoteInventory, ${IT_UINT256_ABI} encryptedInitialBaseInventory, ${IT_UINT256_ABI} encryptedInitialQuoteInventory) payable returns (uint256 orderId)`,
  `function createPrivateRecurringOrderWithRecoveryNote((uint8 assetType, address token) baseAsset, (uint8 assetType, address token) quoteAsset, (uint256 baseAmount, uint256 quoteAmount) buyTerms, (uint256 baseAmount, uint256 quoteAmount) sellTerms, address taker, bool isPublic, bytes32 accessHash, uint256 initialBaseInventory, uint256 initialQuoteInventory, ${IT_UINT256_ABI} encryptedInitialBaseInventory, ${IT_UINT256_ABI} encryptedInitialQuoteInventory, bytes encryptedMakerRecoveryNote) payable returns (uint256 orderId)`,
  `function editOrder(uint256 orderId, (uint256 baseAmount, uint256 quoteAmount) buyTerms, (uint256 baseAmount, uint256 quoteAmount) sellTerms, uint256 addBaseInventory, uint256 addQuoteInventory, ${IT_UINT256_ABI} encryptedAddBaseInventory, ${IT_UINT256_ABI} encryptedAddQuoteInventory, uint256 removeBaseInventory, uint256 removeQuoteInventory, ${IT_UINT256_ABI} encryptedRemoveBaseInventory, ${IT_UINT256_ABI} encryptedRemoveQuoteInventory) payable`,
  'function fillBuySideWithSecret(uint256 orderId, uint256 baseAmountIn, uint256 minQuoteAmountOut, bytes32 accessSecret) payable returns (uint256 quoteAmountOut)',
  'function fillSellSideWithSecret(uint256 orderId, uint256 quoteAmountIn, uint256 minBaseAmountOut, bytes32 accessSecret) payable returns (uint256 baseAmountOut)',
  `function fillPrivateBuySideWithSecret(uint256 orderId, uint256 publicBaseAmountIn, ${IT_UINT256_ABI} privateBaseAmountIn, uint256 minPublicQuoteAmountOut, bytes32 accessSecret) payable returns (bool executed)`,
  `function fillPrivateSellSideWithSecret(uint256 orderId, uint256 publicQuoteAmountIn, ${IT_UINT256_ABI} privateQuoteAmountIn, uint256 minPublicBaseAmountOut, bytes32 accessSecret) payable returns (bool executed)`,
  'function pauseOrder(uint256 orderId)',
  'function resumeOrder(uint256 orderId)',
  'function cancelOrder(uint256 orderId)',
  'function lastActivityBlock(uint256 orderId) view returns (uint256)',
  'function settleInventory(uint256 orderId)',
  `function offboardPrivateBaseInventoryForMaker(uint256 orderId) returns (${UT_UINT256_ABI} baseInventory)`,
  `function offboardPrivateQuoteInventoryForMaker(uint256 orderId) returns (${UT_UINT256_ABI} quoteInventory)`,
  'function getOrderView(uint256 orderId) view returns (((address maker, address taker, uint8 status, uint8 mode, (uint8 assetType, address token) baseAsset, (uint8 assetType, address token) quoteAsset, (uint256 baseAmount, uint256 quoteAmount) buyTerms, (uint256 baseAmount, uint256 quoteAmount) sellTerms, bool isPublic, bytes32 accessHash, uint64 createdAt, uint32 executionCount, uint256 publicBaseInventory, uint256 publicQuoteInventory) order, bool buySideOpen, bool sellSideOpen, bool hasPrivateBaseInventory, bool hasPrivateQuoteInventory))',
  'function getOpenPublicOrderIds(uint256 offset, uint256 limit) view returns (uint256[] orderIds, uint256 nextOffset)',
  'function getOrderIdsForMaker(address maker, uint256 offset, uint256 limit) view returns (uint256[] orderIds, uint256 nextOffset)',
  'function getOrderIdsForTaker(address taker, uint256 offset, uint256 limit) view returns (uint256[] orderIds, uint256 nextOffset)',
  'function getOrderIdsForFiller(address filler, uint256 offset, uint256 limit) view returns (uint256[] orderIds, uint256 nextOffset)',
  'function getOpenPublicOrderIdsByPair(bytes32 pairKey, uint256 offset, uint256 limit) view returns (uint256[] orderIds, uint256 nextOffset)',
  `function getRecurringAccountSnapshot(uint256 orderId, address account) view returns ((uint256 sequence, bool initialized, ${UT_UINT256_ABI} baseInventory, ${UT_UINT256_ABI} quoteInventory) snapshot)`,
  `function getRecurringAccountSummary(uint256 orderId, address account) view returns ((uint256 sequence, bool initialized, ${UT_UINT256_ABI} baseInventory, ${UT_UINT256_ABI} quoteInventory, uint256 privateFillReceiptTotal) summary)`,
  'function getRecurringRecoveryNote(uint256 orderId) view returns (bytes encryptedPayload)',
  'event RecurringOrderOpened(uint256 indexed orderId, address indexed maker, address indexed taker, uint8 mode, bool isPublic, bool hasAccessHash, uint64 createdAt, uint256 feePaid)',
  'event RecurringOrderAssets(uint256 indexed orderId, (uint8 assetType, address token) baseAsset, (uint8 assetType, address token) quoteAsset)',
  'event RecurringOrderTerms(uint256 indexed orderId, (uint256 baseAmount, uint256 quoteAmount) buyTerms, (uint256 baseAmount, uint256 quoteAmount) sellTerms)',
  'event RecurringOrderInventoryFunded(uint256 indexed orderId, uint256 publicBaseInventory, uint256 publicQuoteInventory, bool hasPrivateBaseInventory, bool hasPrivateQuoteInventory)',
  'event RecurringOrderEdited(uint256 indexed orderId, (uint256 baseAmount, uint256 quoteAmount) buyTerms, (uint256 baseAmount, uint256 quoteAmount) sellTerms, uint256 addedPublicBaseInventory, uint256 addedPublicQuoteInventory, bool addedPrivateBaseInventory, bool addedPrivateQuoteInventory, uint256 removedPublicBaseInventory, uint256 removedPublicQuoteInventory, bool removedPrivateBaseInventory, bool removedPrivateQuoteInventory)',
  'event RecurringOrderExecuted(uint256 indexed orderId, address indexed filler, uint8 side, uint32 executionIndex, uint256 publicBaseAmount, uint256 publicQuoteAmount)',
  'event RecurringOrderPaused(uint256 indexed orderId)',
  'event RecurringOrderResumed(uint256 indexed orderId)',
  'event RecurringOrderCancelled(uint256 indexed orderId)',
  'event RecurringOrderInventorySettled(uint256 indexed orderId, address indexed maker, uint256 publicBaseAmount, uint256 publicQuoteAmount, bool settledPrivateBase, bool settledPrivateQuote)',
  `event PrivateRecurringFillReceipt(uint256 indexed orderId, address indexed recipient, address indexed filler, uint256 fillIndex, uint8 side, ${UT_UINT256_ABI} baseAmount, ${UT_UINT256_ABI} quoteAmount, ${UT_UINT256_ABI} remainingBaseInventory, ${UT_UINT256_ABI} remainingQuoteInventory)`,
  `event PrivateRecurringInventorySnapshot(uint256 indexed orderId, address indexed recipient, ${UT_UINT256_ABI} baseInventory, ${UT_UINT256_ABI} quoteInventory)`,
  `event PrivateRecurringAccountSnapshotUpdated(uint256 indexed orderId, address indexed recipient, uint256 sequence, ${UT_UINT256_ABI} baseInventory, ${UT_UINT256_ABI} quoteInventory)`,
  'event RecurringRecoveryNoteStored(uint256 indexed orderId, address indexed maker, bytes encryptedPayload)'
] as const;

export const ERC20_TOKEN_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)'
] as const;

export const PRIVATE_TOKEN_BALANCE_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  `function balanceOf(address account) view returns (${CT_UINT256_ABI})`,
  'function balanceOf() returns (uint256)'
] as const;

export const PRIVATE_ERC20_TOKEN_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function balanceOf() returns (uint256)',
  'function accountEncryptionAddress(address account) view returns (address)',
  'function setAccountEncryptionAddress(address offBoardAddress) returns (bool)',
  'function allowance(address account, bool isSpender) returns (uint256)',
  'function allowance(address owner, address spender) view returns ((uint256 ciphertext, uint256 ownerCiphertext, uint256 spenderCiphertext))',
  'function approve(address spender, (uint256 ciphertext, bytes signature) value) returns (bool)',
  'function transfer(address to, (uint256 ciphertext, bytes signature) value) returns (uint256)'
] as const;

export const PRIVATE_ERC20_TOKEN_VNEXT_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  `function balanceOf(address account) view returns (${CT_UINT256_ABI})`,
  'function balanceOf() returns (uint256)',
  'function accountEncryptionAddress(address account) view returns (address)',
  'function setAccountEncryptionAddress(address offBoardAddress) returns (bool)',
  'function publicAmountsEnabled() view returns (bool)',
  'function allowance(address account, bool isSpender) returns (uint256)',
  `function allowance(address owner, address spender) view returns ((${CT_UINT256_ABI} ciphertext, ${CT_UINT256_ABI} ownerCiphertext, ${CT_UINT256_ABI} spenderCiphertext))`,
  'function reencryptAllowance(address account, bool isSpender)',
  `function approve(address spender, ${IT_UINT256_ABI} value)`,
  'function approve(address spender, uint256 amount)',
  'function approveGT(address spender, uint256 value)',
  `function increaseAllowance(address spender, ${IT_UINT256_ABI} addedValue)`,
  'function increaseAllowance(address spender, uint256 addedValue)',
  'function increaseAllowanceGT(address spender, uint256 addedValue)',
  `function decreaseAllowance(address spender, ${IT_UINT256_ABI} subtractedValue)`,
  'function decreaseAllowance(address spender, uint256 subtractedValue)',
  'function decreaseAllowanceGT(address spender, uint256 subtractedValue)',
  `function transfer(address to, ${IT_UINT256_ABI} value)`,
  'function transfer(address to, uint256 amount)',
  'function transferGT(address to, uint256 value)',
  `function transferFrom(address from, address to, ${IT_UINT256_ABI} value)`,
  'function transferFrom(address from, address to, uint256 amount)',
  'function transferFromGT(address from, address to, uint256 value)',
  'function transferAndCall(address to, uint256 amount, bytes data)',
  `function transferAndCall(address to, ${IT_UINT256_ABI} amount, bytes data)`
] as const;

export const WISP_PRIVACY_BRIDGE_CONTRACT_ABI = [
  'error InvalidAmount()',
  'error DepositDisabled()',
  'error AddressBlacklisted(address account)',
  'error AmountBelowMinimum(uint256 minimum)',
  'error AmountAboveMaximum(uint256 maximum)',
  'error InsufficientFee(uint256 requiredFee,uint256 providedFee)',
  'error InsufficientReserve(uint256 requested,uint256 available)',
  'error UnexpectedTransferBalance(uint256 expected,uint256 received)',
  'error EnforcedPause()',
  'function deposit(uint256 amount) payable',
  'function deposit(uint256 amount,uint256 cotiOracleTimestamp,uint256 tokenOracleTimestamp) payable',
  'function withdraw(uint256 amount) payable',
  'function withdraw(uint256 amount,uint256 cotiOracleTimestamp,uint256 tokenOracleTimestamp) payable',
  'function nativeCotiFee() view returns (uint256)',
  'function token() view returns (address)',
  'function privateToken() view returns (address)',
  'function paused() view returns (bool)',
  'function isDepositEnabled() view returns (bool)',
  'function minDepositAmount() view returns (uint256)',
  'function maxDepositAmount() view returns (uint256)',
  'function minWithdrawAmount() view returns (uint256)',
  'function maxWithdrawAmount() view returns (uint256)',
  'function blacklisted(address account) view returns (bool)',
  'function estimateDepositFee(uint256 tokenAmount) view returns (uint256 fee,uint256 cotiLastUpdated,uint256 tokenLastUpdated,uint256 blockTimestamp)',
  'function estimateWithdrawFee(uint256 tokenAmount) view returns (uint256 fee,uint256 cotiLastUpdated,uint256 tokenLastUpdated,uint256 blockTimestamp)',
  'function feeRecipient() view returns (address)',
  'function publicReserve() view returns (uint256)'
] as const;

export const LEGACY_SWAP_VAULT_CONTRACT_ABI = [
  'function unshieldWithMode(uint256 amount, uint8 paymentMode) payable',
  'function swapFeeWei() view returns (uint256)',
  'function getTokenFeeAmount() view returns (uint256)',
  'event SwapFeePaid(address indexed payer, address indexed receiver, uint8 indexed method, uint256 amount)'
] as const;

export const WHISPER_REWARDS_ABI = [
  'function rewardInteraction(address user)',
  'function paused() view returns (bool)',
  'function allowedInteractionContracts(address) view returns (bool)',
  'function publicRewardAmount() view returns (uint64)',
  'function privateRewardAmount() view returns (uint64)'
] as const;

export const GROUP_JOIN_ERROR_MESSAGE_BY_SELECTOR: Record<string, string> = {
  '0x569d6b43': 'You are already a member of this group.',
  '0xc377608f': 'Group actions are currently paused on-chain. Try again later.',
  '0x6ebf9e18': 'This group has reached its member limit.',
  '0x5b5c465a': 'The invite or join-code TTL is above the contract limit.',
  '0xcecadadb': 'Join code max uses exceeds the contract limit.',
  '0xdb140e40': 'This group no longer exists.',
  '0x873c1c39': 'Invalid group code format.',
  '0x5c47db1b': 'This group code has no remaining uses.',
  '0x6763c1d5': 'This group code has expired.',
  '0x7fb3f362': 'This group code is no longer active. Ask for a new code.'
};
export const GROUP_CREATE_ERROR_MESSAGE_BY_SELECTOR: Record<string, string> = {
  '0x0e03abe4': 'Group title is too long after encryption. Use a shorter title and try again.'
};
export const GROUP_ACTION_ERROR_MESSAGE_BY_SELECTOR: Record<string, string> = {
  '0x569d6b43': 'That wallet is already a member of this group.',
  '0xc377608f': 'Group actions are currently paused on-chain. Try again later.',
  '0x6ebf9e18': 'This group has reached its member limit.',
  '0x025dbdd4': 'Insufficient group fee. In token mode, ensure you have PWISP or approve WISP.',
  '0x5b5c465a': 'The invite or join-code TTL is above the contract limit.',
  '0xcecadadb': 'Join code max uses exceeds the contract limit.',
  '0xe6c4247b': 'Invalid wallet address.',
  '0x25114f49': 'Only the group admin can perform this action.',
  '0x27ce6509': 'You are not a member of this group.',
  '0xdb140e40': 'This group no longer exists.',
  '0x0e03abe4': 'Group title is too long after encryption. Use a shorter title and try again.'
};
