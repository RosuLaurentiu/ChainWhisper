export type EcosystemLink = {
  href: string;
  label: string;
};

export const COTI_ECOSYSTEM_LINKS: readonly EcosystemLink[] = [
  { href: 'https://ciphertrade.org/', label: 'CipherTrade' },
  { href: 'https://pengodefi.app/', label: 'PengoDeFi' },
  { href: 'https://bridge.coti.io/bridge', label: 'COTI Bridge' },
  { href: 'https://coti.carbondefi.xyz/', label: 'CarbonDeFi' },
  { href: 'https://nexus.hyperlane.xyz/', label: 'Hyperlane Bridge' },
  { href: 'https://app.houdiniswap.com/', label: 'Houdini Swap' },
  { href: 'https://app.chainport.io/', label: 'ChainPort' }
];
