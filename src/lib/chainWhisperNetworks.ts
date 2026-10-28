export const CHAINWHISPER_NETWORK_STORAGE_KEY = 'chainwhisper:network:v1';

export type ChainWhisperActiveNetworkId = 'coti-mainnet' | 'coti-testnet';
export type ChainWhisperNetworkId =
  | ChainWhisperActiveNetworkId
  | 'ethereum-coming-soon'
  | 'avalanche-coming-soon';

export type ChainWhisperCotiNetwork = Readonly<{
  id: ChainWhisperActiveNetworkId;
  environment: 'mainnet' | 'testnet';
  chainIdHex: string;
  chainIdDecimal: number;
  chainName: string;
  shortName: string;
  rpcUrl: string;
  wsUrl: string;
  nativeCurrency: Readonly<{
    name: string;
    symbol: string;
    decimals: 18;
  }>;
  blockExplorerUrl: string;
}>;

export type ChainWhisperNetworkOption = Readonly<{
  id: ChainWhisperNetworkId;
  name: string;
  shortName: string;
  status: 'available' | 'coming-soon';
  accent: 'coti' | 'ethereum' | 'avalanche';
}>;

export const COTI_MAINNET_NETWORK: ChainWhisperCotiNetwork = Object.freeze({
  id: 'coti-mainnet',
  environment: 'mainnet',
  chainIdHex: '0x282b34',
  chainIdDecimal: 2632500,
  chainName: 'COTI',
  shortName: 'COTI Mainnet',
  rpcUrl: 'https://mainnet.coti.io/rpc',
  wsUrl: 'wss://mainnet.coti.io/ws',
  nativeCurrency: Object.freeze({ name: 'COTI', symbol: 'COTI', decimals: 18 }),
  blockExplorerUrl: 'https://mainnet.cotiscan.io'
});

export const COTI_TESTNET_NETWORK: ChainWhisperCotiNetwork = Object.freeze({
  id: 'coti-testnet',
  environment: 'testnet',
  chainIdHex: '0x6c11a0',
  chainIdDecimal: 7082400,
  chainName: 'COTI Testnet',
  shortName: 'COTI Testnet',
  rpcUrl: 'https://testnet.coti.io/rpc',
  wsUrl: 'wss://testnet.coti.io/ws',
  nativeCurrency: Object.freeze({ name: 'COTI', symbol: 'COTI', decimals: 18 }),
  blockExplorerUrl: 'https://testnet.cotiscan.io'
});

export const CHAINWHISPER_NETWORK_OPTIONS: readonly ChainWhisperNetworkOption[] = Object.freeze([
  Object.freeze({
    id: 'coti-mainnet',
    name: 'COTI Mainnet',
    shortName: 'Mainnet',
    status: 'available',
    accent: 'coti'
  }),
  Object.freeze({
    id: 'coti-testnet',
    name: 'COTI Testnet',
    shortName: 'Testnet',
    status: 'available',
    accent: 'coti'
  }),
  Object.freeze({
    id: 'ethereum-coming-soon',
    name: 'Ethereum',
    shortName: 'Ethereum',
    status: 'coming-soon',
    accent: 'ethereum'
  }),
  Object.freeze({
    id: 'avalanche-coming-soon',
    name: 'Avalanche',
    shortName: 'Avalanche',
    status: 'coming-soon',
    accent: 'avalanche'
  })
]);

export const isChainWhisperActiveNetworkId = (
  value: unknown
): value is ChainWhisperActiveNetworkId =>
  value === 'coti-mainnet' || value === 'coti-testnet';

export const getChainWhisperCotiNetwork = (
  id: ChainWhisperActiveNetworkId
): ChainWhisperCotiNetwork => id === 'coti-testnet' ? COTI_TESTNET_NETWORK : COTI_MAINNET_NETWORK;

export const resolveConfiguredChainWhisperNetworkId = ({
  configuredNetworkId,
  storage
}: {
  configuredNetworkId?: unknown;
  storage?: Pick<Storage, 'getItem'> | null;
}): ChainWhisperActiveNetworkId =>
  isChainWhisperActiveNetworkId(configuredNetworkId)
    ? configuredNetworkId
    : readStoredChainWhisperNetworkId(storage);

export const readStoredChainWhisperNetworkId = (
  storage?: Pick<Storage, 'getItem'> | null
): ChainWhisperActiveNetworkId => {
  try {
    const source = storage ?? (typeof window === 'undefined' ? null : window.localStorage);
    if (!source) return 'coti-mainnet';
    const value = source.getItem(CHAINWHISPER_NETWORK_STORAGE_KEY);
    return isChainWhisperActiveNetworkId(value) ? value : 'coti-mainnet';
  } catch {
    return 'coti-mainnet';
  }
};

export const storeChainWhisperNetworkId = (
  id: ChainWhisperActiveNetworkId,
  storage?: Pick<Storage, 'setItem'> | null
): void => {
  if (!isChainWhisperActiveNetworkId(id)) throw new Error('Unsupported ChainWhisper network.');
  try {
    const target = storage ?? (typeof window === 'undefined' ? null : window.localStorage);
    if (!target) throw new Error('Network preference storage is unavailable.');
    target.setItem(CHAINWHISPER_NETWORK_STORAGE_KEY, id);
  } catch (error) {
    if (error instanceof Error && error.message === 'Network preference storage is unavailable.') throw error;
    throw new Error('Network preference storage is unavailable.');
  }
};

const BUILD_CONFIGURED_NETWORK_ID = import.meta.env.VITE_CHAINWHISPER_NETWORK_ID;

export const CHAINWHISPER_NETWORK_SELECTION_LOCKED =
  isChainWhisperActiveNetworkId(BUILD_CONFIGURED_NETWORK_ID);

export const CONFIGURED_COTI_NETWORK = getChainWhisperCotiNetwork(
  resolveConfiguredChainWhisperNetworkId({ configuredNetworkId: BUILD_CONFIGURED_NETWORK_ID })
);
