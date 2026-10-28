import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Interface } from '@coti-io/coti-ethers';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DAILY_PRICE_CONSUMER_ABI_PATH = resolve(
  APP_ROOT,
  'src',
  'lib',
  'privateLiquidityDailyPriceAbi.json'
);
export const DAILY_PRICE_ARTIFACT_PATH = resolve(
  APP_ROOT,
  '..',
  'ChainWhisper Contracts',
  'artifacts',
  'contracts',
  'editable',
  'ChainWhisperPrivateLiquidityDailyPriceStoreV1.sol',
  'ChainWhisperPrivateLiquidityDailyPriceStoreV1.json'
);

const parseJson = (text, label) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
};

export const verifyPrivateLiquidityDailyPriceConsumerAbi = ({ consumerAbi, artifact }) => {
  if (!Array.isArray(consumerAbi) || consumerAbi.length === 0 ||
      consumerAbi.some((entry) => typeof entry !== 'string' || entry.length === 0 || entry !== entry.trim())) {
    throw new Error('Daily-price browser ABI must be a nonempty array of canonical strings.');
  }
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact) ||
      artifact.contractName !== 'ChainWhisperPrivateLiquidityDailyPriceStoreV1' ||
      artifact.sourceName !== 'contracts/editable/ChainWhisperPrivateLiquidityDailyPriceStoreV1.sol' ||
      !Array.isArray(artifact.abi)) {
    throw new Error('Daily-price compiled artifact identity is invalid.');
  }
  let consumer;
  let compiled;
  try {
    consumer = new Interface(consumerAbi);
    compiled = new Interface(artifact.abi);
  } catch {
    throw new Error('Daily-price ABI could not be parsed.');
  }
  const functions = consumer.fragments.filter((fragment) => fragment.type === 'function');
  if (functions.length !== consumerAbi.length) {
    throw new Error('Daily-price browser ABI may contain only function fragments.');
  }
  const selectors = new Set();
  for (const fragment of functions) {
    if (selectors.has(fragment.selector)) throw new Error('Daily-price browser ABI contains a duplicate selector.');
    selectors.add(fragment.selector);
    const actual = compiled.getFunction(fragment.selector);
    if (!actual || actual.format('minimal') !== fragment.format('minimal')) {
      throw new Error(`Daily-price browser ABI does not match the compiled ${fragment.name} function.`);
    }
  }
  return Object.freeze({
    contract: artifact.contractName,
    source: artifact.sourceName,
    functionCount: functions.length,
    selectors: Object.freeze([...selectors].sort())
  });
};

export const verifyPrivateLiquidityDailyPriceAbiFiles = async () => verifyPrivateLiquidityDailyPriceConsumerAbi({
  consumerAbi: parseJson(await readFile(DAILY_PRICE_CONSUMER_ABI_PATH, 'utf8'), 'Daily-price browser ABI'),
  artifact: parseJson(await readFile(DAILY_PRICE_ARTIFACT_PATH, 'utf8'), 'Daily-price compiled artifact')
});

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  verifyPrivateLiquidityDailyPriceAbiFiles()
    .then((result) => {
      console.log(`PASS: verified ${result.functionCount} Daily Price Store browser functions against the compiled artifact.`);
    })
    .catch(() => {
      console.error('Daily Price Store browser ABI verification failed closed.');
      process.exitCode = 1;
    });
}
