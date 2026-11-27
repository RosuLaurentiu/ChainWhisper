// Historical compile and rejection-test metadata only; not imported by the App.
import {keccak256,toUtf8Bytes} from '@coti-io/coti-ethers';
// Recorder artifact hashes of removed candidates (CW-147); the full ABIs are in git history before CW-147.
export const CURRENT_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: '6d636a45f6c24a08b78a15070241b4ccfa0b63822fdac2ca3a40dd4a5533788e',
  coreArtifact: 'fc71f47b0e5dd9a16dfde32fc33b34507df8d71a52f99098ade1b5a03fd0bff0',
  buildInfo: '16c5c1f80b76182b322d1045c987b6151a45c83607d855ef25dbad625f8ad6a2',
  recorderArtifact: '1784bdf7f2f7666eb3ff1e74b38d40e40f91ba13492822249bb05059269db6ca',
  schema: keccak256(toUtf8Bytes('chainwhisper.dex.pool-reference.observation.v1')),
  policy: '0xed71147c6fb189173e6cb2eddf7efe41524dfc84d7412b1e3d1b11145f8a63ea'
});
// Local current-candidate artifact only. Deployment/sample and active configuration remain required.
export const CURRENT_NATIVE_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: 'fa71b96c6c590a40feed6b234d8bf5a2fe548af0edb0a2a49dbd639f4c15938b',
  recorderArtifact: '606227789b05ffb320211a3bc62bae2dfdf22fe589485645cfa0aa62ba0196bc',
  schema: CURRENT_DEX_DAILY_PRICE_SOURCE.schema, policy: CURRENT_DEX_DAILY_PRICE_SOURCE.policy
});
export const CURRENT_D06_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: 'd06b6640dad22e5018a5e50d46602fd6d9b534d0b8eb4497cb5b42aee55e5962',
  recorderArtifact: '572b2c81e0be4fd79029f612f86fe69361b880e0997bd83ed4e7552da0f468bb',
  schema: CURRENT_DEX_DAILY_PRICE_SOURCE.schema, policy: CURRENT_DEX_DAILY_PRICE_SOURCE.policy
});
export const CURRENT_EXIT_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: 'b2aa0895d7661a43e3a7db85c9ae24daaa641db238a06bec5c64d031dcf382cd',
  recorderArtifact: '326fcb9b6347c26cdeb974efb327a7802c72245b5af7a1b2aac2a314947fe527',
  schema: CURRENT_DEX_DAILY_PRICE_SOURCE.schema, policy: CURRENT_DEX_DAILY_PRICE_SOURCE.policy
});
export const CURRENT_HISTORY_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: '958eea2faf9aec536df3318d5b770acec1da36efa1665cfc11a0c788d97f8fdf',
  recorderArtifact: '1ee53bbd28dfa61feb62f64ebcf5fac9394f516f858c7df5ca7686d7528b5a00',
  schema: CURRENT_DEX_DAILY_PRICE_SOURCE.schema, policy: CURRENT_DEX_DAILY_PRICE_SOURCE.policy
});
export const LOW_RPC_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: '7c63020b4eead20603e63c580e3155af8974b4eb5cf0a2b2eb2ea8c796a10eb9',
  recorderArtifact: 'c4faa78588adc439d12c60d37e639d97e222e676cdf729cefd67b3eece1f2e73',
  schema: CURRENT_DEX_DAILY_PRICE_SOURCE.schema, policy: CURRENT_DEX_DAILY_PRICE_SOURCE.policy
});
export const REFERENCE_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: 'cc7eb662c644c10bef875d2a72524095848a236155005a32377b10a7c0c13e44',
  recorderArtifact: 'eba50088998058a28025daee6df6f491a18d56ee43397636801cf2957f642be7',
  schema: CURRENT_DEX_DAILY_PRICE_SOURCE.schema,
  policy: '0x74c9b7057b20b742b3f0aa5b9ffe142c6a9b78e5ac94963c005a1cad23ac16b1'
});
