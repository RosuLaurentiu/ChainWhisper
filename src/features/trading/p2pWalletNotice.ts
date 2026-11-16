// CW-097. Without a connected wallet session P2P cannot read offers or trades. That is a normal state,
// not a load failure: the pages show it as a neutral note ("Wallet needed"), never in the error colour.
export const P2P_WALLET_REQUIRED_MESSAGE = 'Connect your wallet on COTI Testnet to use P2P.';

export const isP2PWalletRequiredMessage = (message: string | null | undefined): boolean =>
  message === P2P_WALLET_REQUIRED_MESSAGE;
