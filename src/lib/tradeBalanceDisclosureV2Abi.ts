// Selected escrow functions and linked P2PDisclosure events; full identity is recorded in CW-013.
export const TRADE_BALANCE_DISCLOSURE_V2_ABI = [
  "function getTradeBalanceAccess(uint256 id, address recipient) view returns ((uint64 generation, bool allowed))",
  "function getTradeBalanceSnapshot(uint256 id) view returns ((bool initialized, uint64 revision, uint64 generation, uint8 status, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, (uint256 ciphertextHigh, uint256 ciphertextLow) userCiphertext) remaining))",
  "function refreshTradeBalanceSnapshot(uint256 id)",
  "function setTradeBalanceAccess(uint256 id, address recipient, bool allowed)",
  "event TradeBalanceConsent(uint256 indexed tradeId, address indexed recipient, bool allowed, uint64 generation)",
  "event TradeBalanceSnapshot(uint256 indexed tradeId, address indexed recipient, uint64 revision, uint64 generation, uint8 status, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, (uint256 ciphertextHigh, uint256 ciphertextLow) userCiphertext) remaining)"
] as const;
