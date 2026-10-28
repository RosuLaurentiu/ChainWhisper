// Selected Counter full-artifact ABI; source identity is recorded in CW-013.
export const COUNTER_TRADE_V2_ABI = [
  "function getCounter(uint256 id) view returns ((address maker, address taker, address offerToken, address requestToken, bytes32 offerCodeHash, bytes32 requestCodeHash, bytes32 rootKey, uint256 parentProposal, uint64 expiresAt, uint8 depth, uint8 status, bool privatePair, bool offerLocked) proposal, (uint128 offer, uint128 request) amounts, uint8 effectiveStatus)",
  "function getCounterRoot(bytes32 key) view returns (((uint256 chainId, address escrow, uint256 id, uint64 revision, uint64 credentialEpoch) ref, (address maker, address offerToken, address requestToken, bytes32 offerCodeHash, bytes32 requestCodeHash, bool privatePair, bool open, uint64 revision, uint64 credentialEpoch, uint64 expiresAt) context, bytes32 parentCodeHash))",
  "function getTermsForAccount(uint256 id) view returns ((bool initialized, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, (uint256 ciphertextHigh, uint256 ciphertextLow) userCiphertext) offer, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, (uint256 ciphertextHigh, uint256 ciphertextLow) userCiphertext) request) terms)",
  "function createPublicCounter((uint256 chainId, address escrow, uint256 id, uint64 revision, uint64 credentialEpoch) ref, (uint128 offer, uint128 request) amounts, uint64 expiresAt) returns (uint256 id)",
  "function createPrivateCounter((uint256 chainId, address escrow, uint256 id, uint64 revision, uint64 credentialEpoch) ref, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) offer, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) request, uint64 expiresAt) returns (uint256 id)",
  "function createPublicChild(uint256 parentId, (uint128 offer, uint128 request) amounts, uint64 expiresAt) returns (uint256 id)",
  "function createPrivateChild(uint256 parentId, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) offer, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) request, uint64 expiresAt) returns (uint256 id)",
  "function approvedParentCodeHash(address) view returns (bytes32)",
  "function winner(bytes32) view returns (uint256)",
  "function cancelCounter(uint256 id)",
  "function acceptPublicCounter(uint256 id, (uint128 offer, uint128 request) reviewed)",
  "function acceptPrivateCounter(uint256 id, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) reviewedOffer, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) reviewedRequest)",
  "function declineCounter(uint256 id)",
  "event CounterOpened(uint256 indexed id, address indexed maker, address indexed taker, bytes32 rootKey, uint256 parentProposal, uint8 depth, address offerToken, address requestToken, bool privatePair, uint256 publicOffer, uint256 publicRequest, uint64 expiresAt)",
  "event CounterClosed(uint256 indexed id, uint8 status, address actor)",
  "event CounterPrivateTerms(uint256 indexed id, address indexed recipient, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, (uint256 ciphertextHigh, uint256 ciphertextLow) userCiphertext) offer, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, (uint256 ciphertextHigh, uint256 ciphertextLow) userCiphertext) request)",
  "event CounterRootBound(bytes32 indexed rootKey, uint256 chainId, address indexed parent, uint256 indexed parentId, uint64 revision, uint64 credentialEpoch)"
] as const;
