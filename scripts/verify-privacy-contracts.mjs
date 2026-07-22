import { createPublicClient, getAddress, http, parseAbi } from 'viem';
import process from 'node:process';

const CHAIN_ID = 2_632_500;
const RPC_URL = process.env.COTI_MAINNET_RPC_URL ?? 'https://mainnet.coti.io/rpc';

const TOKEN_ABI = parseAbi(['function decimals() view returns (uint8)']);
const ERC20_BRIDGE_ABI = parseAbi([
  'function token() view returns (address)',
  'function privateToken() view returns (address)'
]);
const NATIVE_BRIDGE_ABI = parseAbi(['function privateCoti() view returns (address)']);

const pairs = [
  {
    id: 'coti',
    decimals: 18,
    kind: 'native',
    publicToken: null,
    privateToken: '0xD2F2692B83C3ecDF2EAa0f7c2632BBd46Ae1cC91',
    bridge: '0x44D864973392064304dD88E2BDef39fF1ab11b7b'
  },
  {
    id: 'weth',
    decimals: 18,
    kind: 'erc20',
    publicToken: '0x639aCc80569c5FC83c6FBf2319A6Cc38bBfe26d1',
    privateToken: '0x4727FE8D8450CEBcB142331FAc034Cd8d311f0E5',
    bridge: '0x7286c83300f0C7131b4006f3cf9F8e44BeB45c13'
  },
  {
    id: 'wbtc',
    decimals: 8,
    kind: 'erc20',
    publicToken: '0x8C39B1fD0e6260fdf20652Fc436d25026832bfEA',
    privateToken: '0x65449561257ba5756631Aa0d34f07f6457a319be',
    bridge: '0xc3B7EdEe4f1c0A0bA1AcD341e4982371eC869862'
  },
  {
    id: 'usdt',
    decimals: 6,
    kind: 'erc20',
    publicToken: '0xfA6f73446b17A97a56e464256DA54AD43c2Cbc3E',
    privateToken: '0x42107250C3D385ddfABE69ab6de163702040FeB0',
    bridge: '0x7685B473DAF1c6DeD815Ca64C6fa18Da2227440D'
  },
  {
    id: 'usdc-e',
    decimals: 6,
    kind: 'erc20',
    publicToken: '0xf1Feebc4376c68B7003450ae66343Ae59AB37D3C',
    privateToken: '0x63C9a1D05471fc8d47C83968725Dcfdcb5410392',
    bridge: '0x29334fC23ffa2c44AF1b372336C2296591Eadd86'
  },
  {
    id: 'wada',
    decimals: 6,
    kind: 'erc20',
    publicToken: '0xe757Ca19d2c237AA52eBb1d2E8E4368eeA3eb331',
    privateToken: '0x3a8b49aAC1dAD86aa45a75231FbeC5bEb810e416',
    bridge: '0xFa2126C07F517013c8d237cc465342da89B96f92'
  },
  {
    id: 'gcoti',
    decimals: 18,
    kind: 'erc20',
    publicToken: '0x7637C7838EC4Ec6b85080F28A678F8E234bB83D1',
    privateToken: '0x394b3c4328160f000763Ca391D07F902926EDaAc',
    bridge: '0xD4e0d9AB16b48c68044cB6aeA3A089380d6D8cD4'
  }
].map((pair) => ({
  ...pair,
  bridge: getAddress(pair.bridge),
  publicToken: pair.publicToken ? getAddress(pair.publicToken) : null,
  privateToken: getAddress(pair.privateToken)
}));

const client = createPublicClient({ transport: http(RPC_URL) });

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertHasCode = async (address, label) => {
  const bytecode = await client.getBytecode({ address });
  assert(bytecode && bytecode !== '0x', `${label} has no deployed bytecode at ${address}`);
};

const sameAddress = (left, right) => getAddress(left) === getAddress(right);

const verifyPair = async (pair) => {
  await Promise.all([
    assertHasCode(pair.bridge, `${pair.id} bridge`),
    assertHasCode(pair.privateToken, `${pair.id} private token`),
    pair.publicToken ? assertHasCode(pair.publicToken, `${pair.id} public token`) : Promise.resolve()
  ]);

  const privateDecimals = Number(
    await client.readContract({ address: pair.privateToken, abi: TOKEN_ABI, functionName: 'decimals' })
  );
  assert(privateDecimals === pair.decimals, `${pair.id} private decimals: expected ${pair.decimals}, got ${privateDecimals}`);

  if (pair.kind === 'native') {
    const configuredPrivate = await client.readContract({
      address: pair.bridge,
      abi: NATIVE_BRIDGE_ABI,
      functionName: 'privateCoti'
    });
    assert(sameAddress(configuredPrivate, pair.privateToken), `${pair.id} native bridge privateCoti() mismatch`);
  } else {
    const [configuredPublic, configuredPrivate, publicDecimals] = await Promise.all([
      client.readContract({ address: pair.bridge, abi: ERC20_BRIDGE_ABI, functionName: 'token' }),
      client.readContract({ address: pair.bridge, abi: ERC20_BRIDGE_ABI, functionName: 'privateToken' }),
      client.readContract({ address: pair.publicToken, abi: TOKEN_ABI, functionName: 'decimals' })
    ]);
    assert(sameAddress(configuredPublic, pair.publicToken), `${pair.id} bridge token() mismatch`);
    assert(sameAddress(configuredPrivate, pair.privateToken), `${pair.id} bridge privateToken() mismatch`);
    assert(Number(publicDecimals) === pair.decimals, `${pair.id} public decimals: expected ${pair.decimals}, got ${publicDecimals}`);
  }

  return `${pair.id}: verified`;
};

try {
  const chainId = await client.getChainId();
  assert(chainId === CHAIN_ID, `Expected COTI mainnet chain ${CHAIN_ID}, RPC returned ${chainId}`);
  const results = await Promise.all(pairs.map(verifyPair));
  for (const result of results) {
    process.stdout.write(`${result}\n`);
  }
  process.stdout.write(`Verified ${results.length} Privacy Portal pairs on COTI mainnet (${CHAIN_ID}).\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
