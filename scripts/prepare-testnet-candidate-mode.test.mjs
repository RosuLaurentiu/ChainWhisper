import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import {
  buildDexV2Env,
  buildSuccessorDexEnv,
  buildTestnetCandidateModeEnv,
  prepareTestnetCandidateMode
} from './prepare-testnet-candidate-mode.mjs';
import {
  buildNpmInvocation,
  waitForCandidateFinality
} from './run-testnet-readonly-suite.mjs';

const bytes32 = (byte) => `0x${byte.repeat(64)}`;
const successorL8SemanticId =
  '0xebba94e30af59ae06a74e9ac84f84e9836a1a78f101f32d8b38b438fe3df50da';
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
};
const sealManifest = (body) => ({
  ...body,
  manifestHash: keccak256(toUtf8Bytes(JSON.stringify(canonicalize(body))))
});
const manifest = () => ({
  schemaVersion: 1,
  status: 'attested-testnet-candidate-not-app-active',
  network: 'cotiTestnet',
  chainId: '7082400',
  owner: '0x0000000000000000000000000000000000000001',
  attestationBlock: { number: '200', hash: bytes32('a') },
  components: Array.from({ length: 15 }, (_, index) => ({
    key: `component-${index}`,
    contract: `Contract${index}`,
    address: `0x${(index + 1).toString(16).padStart(40, '0')}`,
    runtimeBytecodeHash: bytes32(((index % 9) + 1).toString()),
    deploymentBlock: String(100 + index)
  })),
  relationships: {
    chatReactionsV1: {
      directChatV2: '0x0000000000000000000000000000000000000001',
      groupChatV2: '0x0000000000000000000000000000000000000002'
    },
    tokenAdmissionOperations: 16,
    appActivated: false
  },
  manifestHash: bytes32('f')
});
const readySuccessorManifest = (source) => {
  const candidate = JSON.parse(source);
  candidate.appReady = true;
  candidate.status = 'deployed-seeded-app-ready';
  candidate.tokens = candidate.tokens.map((token) => ({
    ...token,
    lotSizeRaw: token.lotSizeRaw ?? '1000000'
  }));
  candidate.privateBookWorkProfile = {
    inputLatticeCells: 8,
    maximumInputLots: '7',
    semanticId: successorL8SemanticId
  };
  candidate.pairs = candidate.pairs.map((pair) => ({
    ...pair,
    coordinatorSemanticId: pair.coordinator === null
      ? null
      : successorL8SemanticId
  }));
  for (const pair of candidate.pairs.filter(({ sourceCount }) =>
    sourceCount > 0)) {
    const label = pair.displayPair.split('/').join('-').toLowerCase();
    candidate.contracts[`spb-${label}-coordinator`].semanticId =
      successorL8SemanticId;
  }
  return candidate;
};

const dexManifest = (unified) => {
  const base = unified.components.find(({ key }) => key === 'privateTestTokenA');
  const quote = unified.components.find(({ key }) => key === 'privateTestTokenB');
  return sealManifest({
    schemaVersion: 1,
    status: 'activated-testnet',
    network: 'cotiTestnet',
    chainId: '7082400',
    productionActivationEvidence: false,
    operator: '0x00000000000000000000000000000000000000f1',
    owner: '0x00000000000000000000000000000000000000f1',
    deploymentPlanHash: bytes32('1'),
    deploymentCandidateHash: bytes32('2'),
    activationPlanHash: bytes32('3'),
    activationReportHash: bytes32('4'),
    addresses: Object.fromEntries([
      'factory', 'pool', 'limit', 'recurring', 'swap', 'core', 'positionToken'
    ].map((key, index) => [key, `0x${(0x100 + index).toString(16).padStart(40, '0')}`])),
    runtimeHashes: Object.fromEntries([
      'factory', 'pool', 'limit', 'recurring', 'swap', 'core', 'positionToken'
    ].map((key, index) => [key, bytes32(String(index + 1))])),
    deploymentAnchors: {
      factory: { number: '200', hash: bytes32('5') },
      economicSuite: { number: '201', hash: bytes32('6') },
      pairRegistration: { number: '202', hash: bytes32('7') }
    },
    pair: {
      pairKey: bytes32('8'),
      baseToken: base.address,
      quoteToken: quote.address,
      baseTokenRuntimeHash: base.runtimeBytecodeHash,
      quoteTokenRuntimeHash: quote.runtimeBytecodeHash,
      privateTokenRuntimeManifestHash: bytes32('9'),
      privateTokenRuntimeManifestLength: 1,
      baseDecimals: 6,
      quoteDecimals: 6,
      baseLotSize: '100',
      quoteLotSize: '100',
      maximumAggregateLots: '2000000',
      tickTableHash: bytes32('a')
    },
    activation: {
      result: 'pass',
      transactionCount: 16,
      measuredRouteCount: 4,
      finalBlock: { number: '210', hash: bytes32('b') },
      allProofsPassed: true,
      routeGasP95Passed: true,
      routeGasMaximumPassed: true,
      routeLatencyP95Passed: true
    }
  });
};

test('builds one deterministic Vite mode file without activating any other network', () => {
  const output = buildTestnetCandidateModeEnv(JSON.stringify(manifest()));
  assert.match(output, /^VITE_CHAINWHISPER_TESTNET_CANDIDATE_ENABLED=true/m);
  assert.match(output, /^VITE_CHAINWHISPER_NETWORK_ID=coti-testnet/m);
  assert.match(output, /VITE_CHAINWHISPER_TESTNET_FINALITY_LAG_BLOCKS=5/);
  assert.match(output, /VITE_CHAINWHISPER_TESTNET_RPC_URL=https:\/\/testnet\.coti\.io\/rpc/);
  assert.equal(output.includes('PRIVATE_KEY'), false);
});

test('activates DEX V2 only from the exact pass manifest and admitted private-token pair', () => {
  const unified = manifest();
  unified.components[0] = {
    key: 'privateTestTokenA',
    contract: 'ChainWhisperTestPrivateTokenV1',
    address: '0x00000000000000000000000000000000000000a1',
    runtimeBytecodeHash: bytes32('c'),
    deploymentBlock: '150'
  };
  unified.components[1] = {
    key: 'privateTestTokenB',
    contract: 'ChainWhisperTestPrivateTokenV1',
    address: '0x00000000000000000000000000000000000000a2',
    runtimeBytecodeHash: bytes32('c'),
    deploymentBlock: '151'
  };
  const dex = dexManifest(unified);
  const lines = buildDexV2Env(JSON.stringify(dex), unified);
  assert.deepEqual(lines.slice(0, 1), ['VITE_CHAINWHISPER_DEX_V2_ENABLED=true']);
  assert.match(lines[1], /^VITE_CHAINWHISPER_DEX_V2_MANIFEST='/);
  assert.equal(lines[2], 'VITE_CHAINWHISPER_DEX_V2_FINALITY_LAG_BLOCKS=5');
  assert.equal(lines[3], 'VITE_CHAINWHISPER_DEX_V2_RPC_URL=https://testnet.coti.io/rpc');

  dex.activation.result = 'fail';
  assert.throws(() => buildDexV2Env(JSON.stringify(dex), unified), /DEX V2 activated app manifest identity/);
  const wrongToken = dexManifest(unified);
  wrongToken.pair.baseToken = '0x00000000000000000000000000000000000000ff';
  wrongToken.manifestHash = keccak256(toUtf8Bytes(JSON.stringify(canonicalize(
    Object.fromEntries(Object.entries(wrongToken).filter(([key]) => key !== 'manifestHash'))
  ))));
  assert.throws(() => buildDexV2Env(JSON.stringify(wrongToken), unified), /DEX V2 activated app manifest identity/);
});

test('activates the read-only successor DEX from the exact deployed manifest', async () => {
  const source = await readFile(new URL(
    '../../ChainWhisper Contracts/deployments/coti-testnet-successor-app-manifest-v2.json',
    import.meta.url
  ), 'utf8');
  assert.deepEqual(buildSuccessorDexEnv(source), []);
  const ready = readySuccessorManifest(source);
  const lines = buildSuccessorDexEnv(JSON.stringify(ready));
  assert.deepEqual(lines, [
    'VITE_CHAINWHISPER_SUCCESSOR_DEX_ENABLED=true',
    'VITE_CHAINWHISPER_SUCCESSOR_DEX_MANIFEST_URL=/deployments/coti-testnet-successor-app-manifest.json',
    'VITE_CHAINWHISPER_SUCCESSOR_DEX_RELEASE_IDENTITY_HASH=0xacdcc37fe33d519345b5eca149408b414e48fe38de10ef098de9a62fc939b381',
    'VITE_CHAINWHISPER_SUCCESSOR_DEX_FINALITY_LAG_BLOCKS=5'
  ]);
  const removable = Object.keys(ready.contracts).find((key) =>
    !key.startsWith('token-') &&
    !['global-core', 'position-nft', 'work-authority'].includes(key) &&
    !/-coordinator$|-epoch$/.test(key));
  assert.ok(removable);
  delete ready.contracts[removable];
  assert.equal(buildSuccessorDexEnv(JSON.stringify(ready)).length, 4);

  const tampered = readySuccessorManifest(source);
  tampered.privateBookWorkProfile.semanticId = bytes32('1');
  assert.throws(() => buildSuccessorDexEnv(JSON.stringify(tampered)), /manifest identity is invalid/);
});

test('binds Private Liquidity V2 to exact deployment blocks and creation transactions', () => {
  const unified = manifest();
  const book = {
    key: 'privateLiquidityBookV2',
    contract: 'ChainWhisperPrivateLiquidityBookV2',
    address: '0x00000000000000000000000000000000000000a1',
    runtimeBytecodeHash: bytes32('1'),
    deploymentBlock: '125'
  };
  const module = {
    key: 'privateLiquidityHiddenIntentV2',
    contract: 'ChainWhisperPrivateLiquidityHiddenIntentModuleV2',
    address: '0x00000000000000000000000000000000000000a2',
    runtimeBytecodeHash: bytes32('2'),
    deploymentBlock: '123'
  };
  const position = {
    key: 'privateLiquidityPositionNftV2',
    contract: 'ChainWhisperPrivateLiquidityPositionNFTV2',
    address: '0x00000000000000000000000000000000000000a3',
    runtimeBytecodeHash: bytes32('3'),
    deploymentBlock: '125'
  };
  unified.components.splice(0, 3, book, module, position);
  const trading = {
    schemaVersion: 1,
    status: 'attested-candidates-not-app-active',
    network: 'cotiTestnet',
    chainId: unified.chainId,
    owner: unified.owner,
    contracts: {
      privateLiquidityBookV2: {
        ...book,
        deploymentBlockHash: bytes32('4'),
        transactionHash: bytes32('5')
      },
      privateLiquidityHiddenIntentModuleV2: {
        ...module,
        deploymentBlockHash: bytes32('6'),
        transactionHash: bytes32('7')
      },
      privateLiquidityPositionNftV2: {
        ...position,
        deploymentBlockHash: bytes32('4')
      }
    }
  };
  const output = buildTestnetCandidateModeEnv(
    JSON.stringify(unified),
    undefined,
    JSON.stringify(trading)
  );
  assert.match(output, new RegExp(`BOOK_DEPLOYMENT_BLOCK_HASH=${bytes32('4')}`));
  assert.match(output, new RegExp(`BOOK_CREATION_TRANSACTION_HASH=${bytes32('5')}`));
  assert.match(output, new RegExp(`POSITION_TOKEN_CREATION_TRANSACTION_HASH=${bytes32('5')}`));
  trading.contracts.privateLiquidityPositionNftV2.deploymentBlockHash = bytes32('8');
  assert.throws(
    () => buildTestnetCandidateModeEnv(JSON.stringify(unified), undefined, JSON.stringify(trading)),
    /private-liquidity provenance/
  );
});

test('adds the separate analytics store only when its exact Book-bound manifest is supplied', () => {
  const unified = manifest();
  unified.components[0] = {
    key: 'privateLiquidityBookV2',
    contract: 'ChainWhisperPrivateLiquidityBookV2',
    address: '0x00000000000000000000000000000000000000aa',
    runtimeBytecodeHash: bytes32('a'),
    deploymentBlock: '100'
  };
  const analytics = sealManifest({
    schemaVersion: 1,
    status: 'attested-analytics-candidate-not-app-active',
    network: 'cotiTestnet',
    analyticsKind: 'private-liquidity-daily-marginal-price-v1',
    contract: 'ChainWhisperPrivateLiquidityDailyPriceStoreV1',
    chainId: '7082400',
    address: '0x00000000000000000000000000000000000000bb',
    runtimeBytecodeHash: bytes32('b'),
    deploymentBlock: '120',
    deploymentBlockHash: bytes32('c'),
    deploymentTransactionHash: bytes32('d'),
    sourceBook: unified.components[0].address,
    sourceBookRuntimeHash: unified.components[0].runtimeBytecodeHash,
    owner: unified.owner,
    recorder: '0x00000000000000000000000000000000000000cc',
    attestationBlock: { number: '130', hash: bytes32('e') },
    appActivated: false
  });
  const output = buildTestnetCandidateModeEnv(JSON.stringify(unified), JSON.stringify(analytics));
  assert.match(output, /^VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_ENABLED=true/m);
  assert.match(output, new RegExp(`^VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_ADDRESS=${analytics.address}$`, 'm'));
  assert.match(output, new RegExp(`^VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_OWNER=${analytics.owner}$`, 'm'));
  assert.match(output, new RegExp(`^VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_RECORDER=${analytics.recorder}$`, 'm'));
  analytics.sourceBookRuntimeHash = bytes32('9');
  assert.throws(
    () => buildTestnetCandidateModeEnv(JSON.stringify(unified), JSON.stringify(analytics)),
    /analytics candidate manifest identity/
  );
});

test('rejects an analytics store with an unreviewed owner or aliased recorder', () => {
  const unified = manifest();
  unified.components[0] = {
    key: 'privateLiquidityBookV2',
    contract: 'ChainWhisperPrivateLiquidityBookV2',
    address: '0x00000000000000000000000000000000000000aa',
    runtimeBytecodeHash: bytes32('a'),
    deploymentBlock: '100'
  };
  const body = {
    schemaVersion: 1,
    status: 'attested-analytics-candidate-not-app-active',
    network: 'cotiTestnet',
    analyticsKind: 'private-liquidity-daily-marginal-price-v1',
    contract: 'ChainWhisperPrivateLiquidityDailyPriceStoreV1',
    chainId: '7082400',
    address: '0x00000000000000000000000000000000000000bb',
    runtimeBytecodeHash: bytes32('b'),
    deploymentBlock: '120',
    deploymentBlockHash: bytes32('c'),
    deploymentTransactionHash: bytes32('d'),
    sourceBook: unified.components[0].address,
    sourceBookRuntimeHash: unified.components[0].runtimeBytecodeHash,
    owner: '0x00000000000000000000000000000000000000dd',
    recorder: '0x00000000000000000000000000000000000000cc',
    attestationBlock: { number: '130', hash: bytes32('e') },
    appActivated: false
  };
  assert.throws(
    () => buildTestnetCandidateModeEnv(JSON.stringify(unified), JSON.stringify(sealManifest(body))),
    /analytics candidate manifest identity/
  );
  body.owner = unified.owner;
  body.recorder = body.address;
  assert.throws(
    () => buildTestnetCandidateModeEnv(JSON.stringify(unified), JSON.stringify(sealManifest(body))),
    /analytics candidate manifest identity/
  );
  body.recorder = body.sourceBook;
  assert.throws(
    () => buildTestnetCandidateModeEnv(JSON.stringify(unified), JSON.stringify(sealManifest(body))),
    /analytics candidate manifest identity/
  );
});

test('rejects an analytics artifact whose body no longer matches its generated hash', () => {
  const unified = manifest();
  unified.components[0] = {
    key: 'privateLiquidityBookV2',
    contract: 'ChainWhisperPrivateLiquidityBookV2',
    address: '0x00000000000000000000000000000000000000aa',
    runtimeBytecodeHash: bytes32('a'),
    deploymentBlock: '100'
  };
  const analytics = sealManifest({
    schemaVersion: 1,
    status: 'attested-analytics-candidate-not-app-active',
    network: 'cotiTestnet',
    analyticsKind: 'private-liquidity-daily-marginal-price-v1',
    contract: 'ChainWhisperPrivateLiquidityDailyPriceStoreV1',
    chainId: '7082400',
    address: '0x00000000000000000000000000000000000000bb',
    runtimeBytecodeHash: bytes32('b'),
    deploymentBlock: '120',
    deploymentBlockHash: bytes32('c'),
    deploymentTransactionHash: bytes32('d'),
    sourceBook: unified.components[0].address,
    sourceBookRuntimeHash: unified.components[0].runtimeBytecodeHash,
    owner: unified.owner,
    recorder: '0x00000000000000000000000000000000000000cc',
    attestationBlock: { number: '130', hash: bytes32('e') },
    appActivated: false
  });
  analytics.recorder = '0x00000000000000000000000000000000000000dd';
  assert.throws(
    () => buildTestnetCandidateModeEnv(JSON.stringify(unified), JSON.stringify(analytics)),
    /analytics candidate manifest identity/
  );
});

test('rejects incomplete, wrong-chain, and already-activated artifacts', () => {
  const incomplete = manifest();
  incomplete.components.pop();
  assert.throws(() => buildTestnetCandidateModeEnv(JSON.stringify(incomplete)), /identity/);
  const wrongChain = manifest();
  wrongChain.chainId = '1';
  assert.throws(() => buildTestnetCandidateModeEnv(JSON.stringify(wrongChain)), /identity/);
  const alreadyActive = manifest();
  alreadyActive.relationships.appActivated = true;
  assert.throws(() => buildTestnetCandidateModeEnv(JSON.stringify(alreadyActive)), /identity/);
});

test('disables the obsolete successor deployment while its replacement is pending', async () => {
  const outputPath = await prepareTestnetCandidateMode();
  const output = await readFile(outputPath, 'utf8');
  assert.equal(output.includes('VITE_CHAINWHISPER_SUCCESSOR_DEX_ENABLED=true'), false);
  assert.match(output, /^VITE_CHAINWHISPER_DEX_V2_ENABLED=false$/m);
});

test('refreshes Contracts and MCP before replacing the APP candidate mode', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const command = packageJson.scripts['refresh:testnet-suite'];
  const contracts = command.indexOf('generate:testnet-candidate');
  const mcp = command.indexOf('generate:testnet-runtime-catalog');
  const abi = command.indexOf('verify:daily-price-abi');
  const app = command.indexOf('prepare-testnet-candidate-mode.mjs');
  assert.ok(contracts >= 0 && mcp > contracts && abi > mcp && app > abi);
  assert.equal(command.includes('deploy'), false);
  assert.equal(command.includes('wrangler'), false);
});

test('verifies the compiled daily-price ABI before every candidate-mode preparation', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const command = packageJson.scripts['prepare:testnet-candidate'];
  assert.ok(command.indexOf('verify:daily-price-abi') >= 0);
  assert.ok(command.indexOf('prepare-testnet-candidate-mode.mjs') > command.indexOf('verify:daily-price-abi'));
});

test('runs the MCP and API read-only gates only after the fail-closed suite refresh', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(
    packageJson.scripts['smoke:testnet-suite:readonly'],
    'npm run refresh:testnet-suite && node scripts/run-testnet-readonly-suite.mjs'
  );
  const suite = await readFile(new URL('./run-testnet-readonly-suite.mjs', import.meta.url), 'utf8');
  const mcp = suite.indexOf("['run', 'smoke:live:testnet:readonly']");
  const api = suite.indexOf("['run', 'smoke:api:testnet:readonly']");
  assert.ok(mcp >= 0 && api > mcp);
  assert.equal(/\bdeploy\b|wrangler|sendTransaction|eth_send/iu.test(suite), false);
});

test('waits for the exact candidate block to become canonical and five-block finalized', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'chainwhisper-finality-'));
  const path = resolve(directory, 'candidate.json');
  const attestationHash = bytes32('f');
  await writeFile(path, JSON.stringify({
    attestationBlock: { number: '100', hash: attestationHash }
  }));
  const methods = [];
  let blockReads = 0;
  const fetcher = async (_input, init) => {
    const request = JSON.parse(String(init.body));
    methods.push(request.method);
    let result;
    if (request.method === 'eth_chainId') result = `0x${BigInt(7_082_400).toString(16)}`;
    else if (request.method === 'eth_blockNumber') {
      blockReads += 1;
      result = blockReads === 1 ? '0x68' : '0x69';
    } else if (request.method === 'eth_getBlockByNumber') {
      result = { number: '0x64', hash: attestationHash };
    } else throw new Error('unexpected test RPC method');
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  };
  try {
    assert.deepEqual(await waitForCandidateFinality({
      manifestPath: path,
      rpcUrl: 'https://rpc.example',
      fetcher,
      pollIntervalMs: 0,
      timeoutMs: 1_000
    }), {
      attestationNumber: '100',
      attestationHash,
      finalizedAtBlock: '105',
      finalityLag: '5'
    });
    assert.deepEqual(methods, [
      'eth_chainId',
      'eth_blockNumber',
      'eth_blockNumber',
      'eth_getBlockByNumber',
      'eth_chainId'
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('launches npm through the Windows command interpreter without changing the reviewed arguments', () => {
  assert.deepEqual(
    buildNpmInvocation(['run', 'smoke:live:testnet:readonly'], 'win32', 'C:\\Windows\\System32\\cmd.exe'),
    {
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'npm', 'run', 'smoke:live:testnet:readonly']
    }
  );
  assert.deepEqual(
    buildNpmInvocation(['run', 'smoke:api:testnet:readonly'], 'linux'),
    { command: 'npm', args: ['run', 'smoke:api:testnet:readonly'] }
  );
});
