// Frozen reference-source layouts; checked against both pinned compiler outputs in tests.
export const CURRENT_DEX_REFERENCE_SOURCE_LAYOUT = {
  "graph": "cc7eb662c644c10bef875d2a72524095848a236155005a32377b10a7c0c13e44",
  "buildInfoSha256": "7b9711477041032b5ef8871514143bf5a103b30bcce1aee17c921e19ba136d42",
  "coreArtifactSha256": "71721c553f2e8780b74b5e762f454f3adfc480c6c965f0b7d1bb856f0be069bf",
  "marketSlot": "1",
  "poolSlot": "0",
  "anchorsSlot": "18",
  "positionsSlot": "15",
  "poolFields": {
    "releaseId": {
      "slot": "0",
      "offset": 0,
      "bytes": 32,
      "kind": "bytes32"
    },
    "marketId": {
      "slot": "1",
      "offset": 0,
      "bytes": 32,
      "kind": "bytes32"
    },
    "token0": {
      "slot": "2",
      "offset": 0,
      "bytes": 20,
      "kind": "address"
    },
    "token1": {
      "slot": "3",
      "offset": 0,
      "bytes": 20,
      "kind": "address"
    },
    "nft": {
      "slot": "4",
      "offset": 0,
      "bytes": 20,
      "kind": "address"
    },
    "terms": {
      "slot": "5",
      "offset": 0,
      "bytes": 20,
      "kind": "address"
    },
    "token0Runtime": {
      "slot": "6",
      "offset": 0,
      "bytes": 32,
      "kind": "bytes32"
    },
    "token1Runtime": {
      "slot": "7",
      "offset": 0,
      "bytes": 32,
      "kind": "bytes32"
    },
    "nftRuntime": {
      "slot": "8",
      "offset": 0,
      "bytes": 32,
      "kind": "bytes32"
    },
    "termsRuntime": {
      "slot": "9",
      "offset": 0,
      "bytes": 32,
      "kind": "bytes32"
    },
    "termsBinding": {
      "slot": "10",
      "offset": 0,
      "bytes": 32,
      "kind": "bytes32"
    },
    "sharedMath": {
      "slot": "16",
      "offset": 0,
      "bytes": 20,
      "kind": "address"
    },
    "sharedMathRuntime": {
      "slot": "17",
      "offset": 0,
      "bytes": 32,
      "kind": "bytes32"
    }
  },
  "anchorFields": {
    "status": {
      "slot": "0",
      "offset": 0,
      "bytes": 1,
      "kind": "uint"
    },
    "sourceId": {
      "slot": "1",
      "offset": 0,
      "bytes": 32,
      "kind": "uint"
    },
    "bucket0Id": {
      "slot": "2",
      "offset": 0,
      "bytes": 32,
      "kind": "uint"
    },
    "bucket1Id": {
      "slot": "3",
      "offset": 0,
      "bytes": 32,
      "kind": "uint"
    },
    "positionRevision": {
      "slot": "4",
      "offset": 0,
      "bytes": 32,
      "kind": "uint"
    },
    "ownershipRevision": {
      "slot": "5",
      "offset": 0,
      "bytes": 32,
      "kind": "uint"
    },
    "lifecycleRevision": {
      "slot": "6",
      "offset": 0,
      "bytes": 32,
      "kind": "uint"
    },
    "termsRevision": {
      "slot": "7",
      "offset": 0,
      "bytes": 32,
      "kind": "uint"
    },
    "mode": {
      "slot": "54",
      "offset": 0,
      "bytes": 1,
      "kind": "uint"
    },
    "sharedClaim": {
      "slot": "59",
      "offset": 0,
      "bytes": 1,
      "kind": "bool"
    },
    "sharedClassId": {
      "slot": "62",
      "offset": 0,
      "bytes": 1,
      "kind": "uint"
    },
    "inventory0": {
      "slot": "8",
      "offset": 0,
      "bytes": 64,
      "kind": "ciphertext"
    },
    "inventory1": {
      "slot": "10",
      "offset": 0,
      "bytes": 64,
      "kind": "ciphertext"
    }
  }
} as const;

export const PACKED_DEX_REFERENCE_SOURCE_IDENTITY = {
  graph: '5045070b8faad2caab781e2981ad3300b7d916016b7a1d354fe59b12a1d1c239',
  buildInfoSha256: '3e1352c040cb6b4a822f2d5b1ee26ca9e8de5ba01cb5d30ee8a35226e6d03abe',
  coreArtifactSha256: '959e65766905e59c651c80798bb5d8696987b3235f394acdcd5fbe16abd3e15b'
} as const;

export const hasCurrentReferenceSourceLayout = (graph: string): boolean =>
  graph === PACKED_DEX_REFERENCE_SOURCE_IDENTITY.graph;
