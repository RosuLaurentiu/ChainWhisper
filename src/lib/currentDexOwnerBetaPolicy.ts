// Owner decision, 2026-10-21: normal Testnet App use has no trial quotas.
export const CURRENT_OWNER_BETA: Readonly<{
  graph: string; core: string; owner: string;
  legacyStarts: number; activation: Readonly<{ activatedAt: bigint; startingNonce: number; legacyReservationHash: string }> | null;
}> = Object.freeze({
  graph: '7b67bcbb7c5941a24471e62ba5a0d939c0800671b0bf121e81bad14cca737456',
  core: '0xab5374daddea783c3e58de19db497b54c79fd4cc', owner: '0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d',
  legacyStarts: 14, activation: Object.freeze({ activatedAt: 1792452366n, startingNonce: 220, legacyReservationHash: '0x8fc3d42c0f418a860455579df8cb8fde8bafc069e6065a35046713bedb5e4567' })
});

export const isCurrentOwnerBeta = (graph: string, owner: string) =>
  CURRENT_OWNER_BETA.activation !== null && graph === CURRENT_OWNER_BETA.graph && owner.toLowerCase() === CURRENT_OWNER_BETA.owner;

// Pure arithmetic for the fixed policy below. This does not grant send authority.
export const checkCurrentOwnerBetaWindow = (
  activation: Readonly<{ activatedAt: bigint; startingNonce: number }>, now: bigint, nonce: number,
  _recovery: boolean, gasCap: bigint, gasPrice: bigint
) => {
  if (!Number.isSafeInteger(activation.startingNonce) || activation.startingNonce < 220 || activation.activatedAt <= 0n ||
      !Number.isSafeInteger(nonce) || nonce < activation.startingNonce || now < activation.activatedAt ||
      gasCap <= 0n || gasCap > 110_000_000n || gasPrice !== 50_000_000n) {
    throw new Error('Owner App nonce, activation or transaction fee check failed.');
  }
};

export const assertCurrentOwnerBetaWindow = (graph: string, owner: string, core: string, chainId: bigint,
  now: bigint, nonce: number, recovery: boolean, gasCap: bigint, gasPrice: bigint) => {
  if (!isCurrentOwnerBeta(graph, owner) || core.toLowerCase() !== CURRENT_OWNER_BETA.core || chainId !== 7082400n) {
    throw new Error('Owner beta admission is inactive or its identity changed.');
  }
  checkCurrentOwnerBetaWindow(CURRENT_OWNER_BETA.activation!, now, nonce, recovery, gasCap, gasPrice);
};

export const isCurrentOwnerBetaRecovery = (kind: 'swap' | 'pool' | 'limit' | 'funding', action: string) =>
  kind === 'swap' ? action === 'cancel' || action === 'recover' :
    kind === 'pool' ? ['snapshot', 'withdraw', 'close', 'clear-create', 'clear-top-up', 'allowance-cleanup'].includes(action) :
      kind === 'limit' && ['snapshot', 'refresh', 'claim', 'close'].includes(action);
