import type { Address, PrivacyRoute, VerifiedAsset } from './types';

export const API_VERSION = 'v1' as const;
export const CHAIN_ID = 2_632_500 as const;
export const CHAIN_ID_HEX = '0x282b34';
export const NETWORK_NAME = 'COTI Mainnet' as const;
export const DEFAULT_COTI_RPC_URL = 'https://mainnet.coti.io/rpc';
export const DEFAULT_CARBON_API_URL = 'https://api.carbondefi.xyz/v1/coti';
export const EXPLORER_URL = 'https://mainnet.cotiscan.io';
export const APP_ORIGIN = 'https://chainwhisper.chat';
export const REGISTRY_VERSION = 'coti-mainnet-2026-07-27';

export const CONTRACTS = {
  registry: '0x91e32EdFAb1e74DA07ea3012491a44D983aeBA46',
  standardEscrow: '0x7a232810f250a2C6e90895215aFf826116DFDb06',
  privateEscrow: '0xe211c032E4432FdeB9e48f06b69EB98583B2A231',
  directEscrow: '0x634c6dddda784c29d0435Cc54ca072Af0551914a',
  recurringEscrow: '0x7235B18b9CD59fB9853BC3BF3a0A65bc32162cd5',
  reader: '0x77889B2f9F9fD812ad65AfF41048426fA1382660',
  historyReader: '0x650666328A771d70881c189F3B2BB1F3fBfe0514'
} as const satisfies Record<string, Address>;

const rawAssets: Array<Omit<VerifiedAsset, 'id' | 'publicCounterpartId'> & {
  publicCounterpartSymbol?: string;
}> = [
  { symbol: 'COTI', kind: 'native', address: null, decimals: 18 },
  { symbol: 'WISP', kind: 'erc20', address: '0xb70c55bd0823436F44877DC6A9f46E0C55f2C3A8', decimals: 6 },
  { symbol: 'gCOTI', kind: 'erc20', address: '0x7637C7838EC4Ec6b85080F28A678F8E234bB83D1', decimals: 18 },
  { symbol: 'Pengo', kind: 'erc20', address: '0x659AD6d1F7353Df13Dec552cc05c9c15AfdD04e8', decimals: 18 },
  { symbol: 'WBBT', kind: 'erc20', address: '0x256353f5B4b515f488876dD1CAc2300c6C6f98B7', decimals: 18 },
  { symbol: 'WBTC', kind: 'erc20', address: '0x8C39B1fD0e6260fdf20652Fc436d25026832bfEA', decimals: 8 },
  { symbol: 'USDC.e', kind: 'erc20', address: '0xf1Feebc4376c68B7003450ae66343Ae59AB37D3C', decimals: 6 },
  { symbol: 'USDT', kind: 'erc20', address: '0xfA6f73446b17A97a56e464256DA54AD43c2Cbc3E', decimals: 6 },
  { symbol: 'wADA', kind: 'erc20', address: '0xe757Ca19d2c237AA52eBb1d2E8E4368eeA3eb331', decimals: 6 },
  { symbol: 'NIGHT', kind: 'erc20', address: '0xFc075Bd3e22d337C19b7Ca25635282ad8e24941a', decimals: 6 },
  { symbol: 'WETH', kind: 'erc20', address: '0x639aCc80569c5FC83c6FBf2319A6Cc38bBfe26d1', decimals: 18 },
  {
    symbol: 'p.COTI',
    kind: 'private-erc20',
    address: '0xD2F2692B83C3ecDF2EAa0f7c2632BBd46Ae1cC91',
    decimals: 18,
    publicCounterpartSymbol: 'COTI'
  },
  {
    symbol: 'p.WETH',
    kind: 'private-erc20',
    address: '0x4727FE8D8450CEBcB142331FAc034Cd8d311f0E5',
    decimals: 18,
    publicCounterpartSymbol: 'WETH'
  },
  {
    symbol: 'p.WBTC',
    kind: 'private-erc20',
    address: '0x65449561257ba5756631Aa0d34f07f6457a319be',
    decimals: 8,
    publicCounterpartSymbol: 'WBTC'
  },
  {
    symbol: 'p.USDT',
    kind: 'private-erc20',
    address: '0x42107250C3D385ddfABE69ab6de163702040FeB0',
    decimals: 6,
    publicCounterpartSymbol: 'USDT'
  },
  {
    symbol: 'p.USDC.e',
    kind: 'private-erc20',
    address: '0x63C9a1D05471fc8d47C83968725Dcfdcb5410392',
    decimals: 6,
    publicCounterpartSymbol: 'USDC.e'
  },
  {
    symbol: 'p.wADA',
    kind: 'private-erc20',
    address: '0x3a8b49aAC1dAD86aa45a75231FbeC5bEb810e416',
    decimals: 6,
    publicCounterpartSymbol: 'wADA'
  },
  {
    symbol: 'p.gCOTI',
    kind: 'private-erc20',
    address: '0x394b3c4328160f000763Ca391D07F902926EDaAc',
    decimals: 18,
    publicCounterpartSymbol: 'gCOTI'
  },
  {
    symbol: 'p.WISP',
    kind: 'private-erc20',
    address: '0x682e3142e62a7aDe2a0CA5bdC87b205CaDe4B17a',
    decimals: 6,
    publicCounterpartSymbol: 'WISP'
  },
  {
    symbol: 'p.PENGO',
    kind: 'private-erc20',
    address: '0xefe07cbd73538b2f7b3dd8cbc3a435fd4ee16213',
    decimals: 6,
    publicCounterpartSymbol: 'Pengo'
  },
  {
    symbol: 'HOTDOG',
    kind: 'private-erc20',
    address: '0x5085Ea0611A9C49316972C57390ca25C9CF236AB',
    decimals: 18
  }
];

const makeAssetId = (asset: Pick<VerifiedAsset, 'kind' | 'address' | 'symbol'>): string =>
  asset.kind === 'native'
    ? 'native:coti'
    : `${asset.kind}:${asset.address!.toLowerCase()}`;

const rawBySymbol = new Map(rawAssets.map((asset) => [asset.symbol.toLowerCase(), asset]));

export const VERIFIED_ASSETS: readonly VerifiedAsset[] = rawAssets.map((asset) => ({
  id: makeAssetId(asset),
  symbol: asset.symbol,
  kind: asset.kind,
  address: asset.address,
  decimals: asset.decimals,
  publicCounterpartId: asset.publicCounterpartSymbol
    ? makeAssetId(rawBySymbol.get(asset.publicCounterpartSymbol.toLowerCase())!)
    : null
}));

const assetById = new Map(VERIFIED_ASSETS.map((asset) => [asset.id.toLowerCase(), asset]));
const assetBySymbol = new Map(VERIFIED_ASSETS.map((asset) => [asset.symbol.toLowerCase(), asset]));
const assetByAddress = new Map(
  VERIFIED_ASSETS
    .filter((asset) => asset.address)
    .map((asset) => [asset.address!.toLowerCase(), asset])
);

export const resolveVerifiedAsset = (input: string): VerifiedAsset | null => {
  const key = input.trim().toLowerCase();
  if (!key || key.length > 96) return null;
  return assetById.get(key) ?? assetBySymbol.get(key) ?? assetByAddress.get(key) ?? null;
};

export const resolveVerifiedAssetByContract = (
  assetType: number,
  tokenAddress: string
): VerifiedAsset | null => {
  if (assetType === 0) return assetBySymbol.get('coti') ?? null;
  const asset = assetByAddress.get(tokenAddress.trim().toLowerCase()) ?? null;
  if (!asset) return null;
  if (assetType === 1 && asset.kind !== 'erc20') return null;
  if (assetType === 2 && asset.kind !== 'private-erc20') return null;
  return asset;
};

export const getPublicCounterpart = (asset: VerifiedAsset): VerifiedAsset | null =>
  asset.kind === 'private-erc20'
    ? (asset.publicCounterpartId ? assetById.get(asset.publicCounterpartId) ?? null : null)
    : asset;

const privacyRoute = (
  id: string,
  bridgeAddress: Address,
  publicSymbol: string,
  privateSymbol: string,
  provider: PrivacyRoute['provider']
): PrivacyRoute => ({
  id,
  bridgeAddress,
  publicAssetId: assetBySymbol.get(publicSymbol.toLowerCase())!.id,
  privateAssetId: assetBySymbol.get(privateSymbol.toLowerCase())!.id,
  directions: ['public-to-private', 'private-to-public'],
  provider
});

export const PRIVACY_ROUTES: readonly PrivacyRoute[] = [
  privacyRoute('coti', '0x44D864973392064304dD88E2BDef39fF1ab11b7b', 'COTI', 'p.COTI', 'coti'),
  privacyRoute('weth', '0x7286c83300f0C7131b4006f3cf9F8e44BeB45c13', 'WETH', 'p.WETH', 'coti'),
  privacyRoute('wbtc', '0xc3B7EdEe4f1c0A0bA1AcD341e4982371eC869862', 'WBTC', 'p.WBTC', 'coti'),
  privacyRoute('usdt', '0x7685B473DAF1c6DeD815Ca64C6fa18Da2227440D', 'USDT', 'p.USDT', 'coti'),
  privacyRoute('usdc-e', '0x29334fC23ffa2c44AF1b372336C2296591Eadd86', 'USDC.e', 'p.USDC.e', 'coti'),
  privacyRoute('wada', '0xFa2126C07F517013c8d237cc465342da89B96f92', 'wADA', 'p.wADA', 'coti'),
  privacyRoute('gcoti', '0xD4e0d9AB16b48c68044cB6aeA3A089380d6D8cD4', 'gCOTI', 'p.gCOTI', 'coti'),
  privacyRoute('wisp', '0x3bCeA2eD4b31107eF877899416dC97213bdc2809', 'WISP', 'p.WISP', 'chainwhisper')
];

export const PUBLIC_ORDER_CONTRACTS = new Map<string, Address>([
  ['standard', CONTRACTS.standardEscrow],
  ['private', CONTRACTS.privateEscrow],
  ['recurring', CONTRACTS.recurringEscrow],
  [CONTRACTS.standardEscrow.toLowerCase(), CONTRACTS.standardEscrow],
  [CONTRACTS.privateEscrow.toLowerCase(), CONTRACTS.privateEscrow],
  [CONTRACTS.recurringEscrow.toLowerCase(), CONTRACTS.recurringEscrow]
]);

export const publicAsset = (asset: VerifiedAsset) => ({
  id: asset.id,
  symbol: asset.symbol,
  kind: asset.kind,
  address: asset.address,
  decimals: asset.decimals
});
