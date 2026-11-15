// Historical compile and rejection-test metadata only; not imported by the App.
import {keccak256,toUtf8Bytes} from '@coti-io/coti-ethers';
import { CURRENT_DEX_DAILY_PRICE_ARTIFACT } from '../../src/lib/currentDexDailyPriceArtifact';
import { CURRENT_NATIVE_DEX_DAILY_PRICE_ARTIFACT } from '../../src/lib/currentDexNativeDailyPriceArtifact';
import { CURRENT_D06_DEX_DAILY_PRICE_ARTIFACT } from '../../src/lib/currentDexD06DailyPriceArtifact';
import { CURRENT_EXIT_DEX_DAILY_PRICE_ARTIFACT } from '../../src/lib/currentDexExitDailyPriceArtifact';
import { CURRENT_HISTORY_DEX_DAILY_PRICE_ARTIFACT } from '../../src/lib/currentDexHistoryDailyPriceArtifact';
import { LOW_RPC_DEX_DAILY_PRICE_ARTIFACT } from '../../src/lib/lowRpcDexDailyPriceArtifact';
import { CROSSED_REFERENCE_DEX_DAILY_PRICE_ARTIFACT } from '../../src/lib/currentDexReferenceDailyPriceArtifact';
export const CURRENT_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: '6d636a45f6c24a08b78a15070241b4ccfa0b63822fdac2ca3a40dd4a5533788e',
  coreArtifact: 'fc71f47b0e5dd9a16dfde32fc33b34507df8d71a52f99098ade1b5a03fd0bff0',
  buildInfo: '16c5c1f80b76182b322d1045c987b6151a45c83607d855ef25dbad625f8ad6a2',
  recorderArtifact: CURRENT_DEX_DAILY_PRICE_ARTIFACT.artifactSha256,
  schema: keccak256(toUtf8Bytes('chainwhisper.dex.pool-reference.observation.v1')),
  policy: '0xed71147c6fb189173e6cb2eddf7efe41524dfc84d7412b1e3d1b11145f8a63ea'
});
// Local current-candidate artifact only. Deployment/sample and active configuration remain required.
export const CURRENT_NATIVE_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: 'fa71b96c6c590a40feed6b234d8bf5a2fe548af0edb0a2a49dbd639f4c15938b',
  recorderArtifact: CURRENT_NATIVE_DEX_DAILY_PRICE_ARTIFACT.artifactSha256,
  schema: CURRENT_DEX_DAILY_PRICE_SOURCE.schema, policy: CURRENT_DEX_DAILY_PRICE_SOURCE.policy
});
export const CURRENT_D06_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: 'd06b6640dad22e5018a5e50d46602fd6d9b534d0b8eb4497cb5b42aee55e5962',
  recorderArtifact: CURRENT_D06_DEX_DAILY_PRICE_ARTIFACT.artifactSha256,
  schema: CURRENT_DEX_DAILY_PRICE_SOURCE.schema, policy: CURRENT_DEX_DAILY_PRICE_SOURCE.policy
});
export const CURRENT_EXIT_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: 'b2aa0895d7661a43e3a7db85c9ae24daaa641db238a06bec5c64d031dcf382cd',
  recorderArtifact: CURRENT_EXIT_DEX_DAILY_PRICE_ARTIFACT.artifactSha256,
  schema: CURRENT_DEX_DAILY_PRICE_SOURCE.schema, policy: CURRENT_DEX_DAILY_PRICE_SOURCE.policy
});
export const CURRENT_HISTORY_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: '958eea2faf9aec536df3318d5b770acec1da36efa1665cfc11a0c788d97f8fdf',
  recorderArtifact: CURRENT_HISTORY_DEX_DAILY_PRICE_ARTIFACT.artifactSha256,
  schema: CURRENT_DEX_DAILY_PRICE_SOURCE.schema, policy: CURRENT_DEX_DAILY_PRICE_SOURCE.policy
});
export const LOW_RPC_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: '7c63020b4eead20603e63c580e3155af8974b4eb5cf0a2b2eb2ea8c796a10eb9',
  recorderArtifact: LOW_RPC_DEX_DAILY_PRICE_ARTIFACT.artifactSha256,
  schema: CURRENT_DEX_DAILY_PRICE_SOURCE.schema, policy: CURRENT_DEX_DAILY_PRICE_SOURCE.policy
});
export const REFERENCE_DEX_DAILY_PRICE_SOURCE = Object.freeze({
  graph: 'cc7eb662c644c10bef875d2a72524095848a236155005a32377b10a7c0c13e44',
  recorderArtifact: CROSSED_REFERENCE_DEX_DAILY_PRICE_ARTIFACT.artifactSha256,
  schema: CURRENT_DEX_DAILY_PRICE_SOURCE.schema,
  policy: '0x74c9b7057b20b742b3f0aa5b9ffe142c6a9b78e5ac94963c005a1cad23ac16b1'
});
