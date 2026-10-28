// Selected Link full-artifact ABI; source identity is recorded in CW-013.
export const LINK_TRADE_V2_ABI = [
  "function authorizeCounter((uint256 chainId, address escrow, uint256 id, uint64 revision, uint64 credentialEpoch) ref, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) credential)",
  "function counterEscrow() view returns (address)",
  "function counterEscrowCodeHash() view returns (bytes32)",
  "function getCounterContext(uint256 id) view returns ((address maker, address offerToken, address requestToken, bytes32 offerCodeHash, bytes32 requestCodeHash, bool privatePair, bool open, uint64 revision, uint64 credentialEpoch, uint64 expiresAt) context)",
  "function admitCounter((uint256 chainId, address escrow, uint256 id, uint64 revision, uint64 credentialEpoch) ref, address proposer) view returns ((address maker, address offerToken, address requestToken, bytes32 offerCodeHash, bytes32 requestCodeHash, bool privatePair, bool open, uint64 revision, uint64 credentialEpoch, uint64 expiresAt) context)",
  "event CounterAuthorized(uint256 indexed id, address indexed proposer, uint64 revision, uint64 epoch)",
  "event LinkCredentialChanged(uint256 indexed id, uint64 revision, uint64 epoch, bool enabled)",
  "event CounterParentSettled(uint256 indexed id, uint256 indexed selectedCounter)",
  "event LinkFilled(uint256 indexed id, address indexed filler, uint64 revision, uint256 publicOffer, uint256 publicPayment, uint256 publicRefund)",
  "event PrivateLinkReceipt(uint256 indexed id, address indexed recipient, uint64 revision, ((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) offer, ((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) payment, ((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) refund)",
  "function cancelOrder(uint256 id)",
  "event LinkClosed(uint256 indexed id, uint8 status, uint64 revision)",
  "function createPublicLink((address offerToken, address requestToken, uint64 expiresAt, bytes32 makerNonce) config, uint128 budget, (uint128 offer, uint128 request) price, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) credential, bytes sealedTerms) returns (uint256 id)",
  "function createPrivateLink((address offerToken, address requestToken, uint64 expiresAt, bytes32 makerNonce) config, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) budget, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) priceOffer, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) priceRequest, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) credential, bytes sealedTerms) returns (uint256 id)",
  "function usedMakerNonce(address, bytes32) view returns (bool)",
  "function approvedPublicTokenCodeHash(address) view returns (bytes32)",
  "function approvedPrivateTokenCodeHash(address) view returns (bytes32)",
  "event LinkOpened(uint256 indexed id, address indexed maker, bool privatePair, address offerToken, address requestToken, uint256 publicBudget, (uint128 offer, uint128 request) publicPrice, bytes32 makerNonce, uint64 expiresAt)",
  "function getOrderView(uint256 id) view returns (((address maker, address offerToken, address requestToken, bytes32 offerCodeHash, bytes32 requestCodeHash, bytes32 makerNonce, uint64 expiresAt, uint64 revision, uint64 credentialEpoch, uint8 status, bool privatePair, bool linkEnabled) order, uint8 effectiveStatus, (uint128 offer, uint128 request) publicPrice, uint256 publicBudget, uint256 publicRemaining, bytes sealedTerms, bytes32 credentialDomain) result)",
  "function fillPublicLink((uint256 chainId, address escrow, uint256 id, uint64 revision, uint64 credentialEpoch) ref, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) credential, uint128 maximumPayment, (uint128 offer, uint128 request) reviewedPrice)",
  "function fillPrivateLink((uint256 chainId, address escrow, uint256 id, uint64 revision, uint64 credentialEpoch) ref, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) credential, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) maximumPayment, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) reviewedOffer, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) reviewedRequest)"
] as const;
