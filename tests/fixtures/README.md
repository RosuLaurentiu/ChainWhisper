# Portable App test fixtures

These files remove test imports from sibling contract workspaces and ignored local reports. They are test inputs, not new native acceptance evidence.

`history.fixture.ts` is the exact synthetic history fixture. Contract artifacts retain the original ABI, contract/source names, and deployed bytecode only where consumed by the history tests. The production, full-candidate and validation files remain separate identities.

P2P JSON files are public projections: deployment identities, proof hashes, public registration metadata, required status flags and public-leg assertions. Private receipts, signed inputs, credentials and unrelated observations are excluded. `provenance.json` records each original producer path and SHA256, plus the projected fixture SHA256. A source hash identifies retained evidence; it does not reconstruct or independently revalidate that evidence.

`worker-event-abis.json` contains all event ABI entries from the 13 exact legacy editable artifacts used by the 15 Worker component parity cases. Event signatures, indexed fields, tuple components and anonymity are preserved. Functions, compiler output and deployment data are omitted. Expectations are projected from compiled artifacts, never from Worker event policy. Each `worker-event-abis.json#<contract>` provenance entry records its original artifact hash and the current Solidity source-file hash; the latter does not establish that current source reproduced the artifact.
