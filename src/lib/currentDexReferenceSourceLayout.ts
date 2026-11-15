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
  graph: '9c2cb36f958dc21ef11bf7d91ebf0373904a3d741edd6bf9eeae25752960631e',
  buildInfoSha256: 'b93a6b411db1bd018b8593aafa67e4f91b8f8c6d13caf313c3927c356b991b0f',
  coreArtifactSha256: '18aa3ca956aa3537f6edc71d3411e3965ee0b24311ebf9796363e670e1b1e398'
} as const;

export const hasCurrentReferenceSourceLayout = (graph: string): boolean =>
  graph === PACKED_DEX_REFERENCE_SOURCE_IDENTITY.graph;
