# Portable App test fixtures

These files remove test imports from sibling contract workspaces and ignored local reports. They are test inputs, not new native acceptance evidence.

`history.fixture.ts` is the exact synthetic history fixture. Contract artifacts retain the original ABI, contract/source names, and deployed bytecode only where consumed by the history tests. The production, full-candidate and validation files remain separate identities.

P2P JSON files are public projections: deployment identities, proof hashes, public registration metadata, required status flags and public-leg assertions. Private receipts, signed inputs, credentials and unrelated observations are excluded. `provenance.json` records each original producer path and SHA256, plus the projected fixture SHA256. A source hash identifies retained evidence; it does not reconstruct or independently revalidate that evidence.
