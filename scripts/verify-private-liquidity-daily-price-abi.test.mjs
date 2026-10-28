import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  DAILY_PRICE_ARTIFACT_PATH,
  DAILY_PRICE_CONSUMER_ABI_PATH,
  verifyPrivateLiquidityDailyPriceAbiFiles,
  verifyPrivateLiquidityDailyPriceConsumerAbi
} from './verify-private-liquidity-daily-price-abi.mjs';

const load = async (path) => JSON.parse(await readFile(path, 'utf8'));

test('matches every browser read fragment to the exact compiled Store function', async () => {
  const result = await verifyPrivateLiquidityDailyPriceAbiFiles();
  assert.equal(result.contract, 'ChainWhisperPrivateLiquidityDailyPriceStoreV1');
  assert.equal(result.functionCount, 8);
  assert.equal(result.selectors.length, 8);
});

test('rejects output drift even when a function selector is unchanged', async () => {
  const consumerAbi = await load(DAILY_PRICE_CONSUMER_ABI_PATH);
  const artifact = await load(DAILY_PRICE_ARTIFACT_PATH);
  const recorder = artifact.abi.find((entry) => entry.type === 'function' && entry.name === 'recorder');
  assert.ok(recorder);
  recorder.outputs[0].type = 'bytes32';
  assert.throws(
    () => verifyPrivateLiquidityDailyPriceConsumerAbi({ consumerAbi, artifact }),
    /recorder function/
  );
});

test('rejects the wrong artifact source and non-function consumer fragments', async () => {
  const consumerAbi = await load(DAILY_PRICE_CONSUMER_ABI_PATH);
  const artifact = await load(DAILY_PRICE_ARTIFACT_PATH);
  assert.throws(
    () => verifyPrivateLiquidityDailyPriceConsumerAbi({
      consumerAbi,
      artifact: { ...artifact, sourceName: 'contracts/editable/Other.sol' }
    }),
    /artifact identity/
  );
  assert.throws(
    () => verifyPrivateLiquidityDailyPriceConsumerAbi({
      consumerAbi: [...consumerAbi, 'event Unexpected()'],
      artifact
    }),
    /only function fragments/
  );
});
