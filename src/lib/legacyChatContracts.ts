/**
 * Read-only compatibility definitions for the retired ChatGC and Group Chat V1
 * deployments. Production V2 write paths must never import this module.
 */
export const LEGACY_CHAT_CONTRACT_ADDRESS = '0xE5101D33986c91565D2C9f8b49AAF0b8FFeE2243';

export const LEGACY_CHAT_CONTRACT_ABI = [
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
  'event NicknameSet(address indexed user, string nickname)',
  'event MessageSubmitted(uint256 indexed messageId, address indexed recipient, address indexed from, uint256 valueSent, uint256 feeTaken, uint32 chunkCount)'
] as const;

export const LEGACY_GROUP_CHAT_CONTRACT_ADDRESS = '0xE175ec590CE13FB6349f1CAd8b7e9D5d21eaa32b';

export const LEGACY_GROUP_CHAT_CONTRACT_ABI = [
  'function nextGroupId() view returns (uint256)',
  'function getInvite(uint256 groupId, address account) view returns (bool pending, address inviter, uint64 expiresAt, bool expired)',
  'function getGroupInfo(uint256 groupId) view returns (address admin, uint64 createdAt, uint32 memberCount, string title, uint256 lastBlock, uint256 lastTimestamp)',
  'function lastMessageBlockForGroup(uint256 groupId) view returns (uint256)',
  'function getGroupMembers(uint256 groupId) view returns (address[])',
  'function getGroupsForMemberPage(address account, uint256 cursor, uint256 limit) view returns (uint256[] groupIds, uint256 nextCursor)',
  'function isMember(uint256 groupId, address account) view returns (bool)',
  'function feeAmount() view returns (uint256)',
  'function tokenFeeAmount() view returns (uint256)',
  'function publicFeeToken() view returns (address)',
  'function privateFeeToken() view returns (address)',
  'function rewardsContract() view returns (address)',
  'function rewardsPaused() view returns (bool)',
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
