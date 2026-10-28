import { describe, expect, it } from 'vitest';
import {
  assertRpcMethodAllowedInPhase,
  assertPromptAllowedInPhase,
  attestPinnedCotiSnapVersion,
  classifyMetaMaskSurface,
  findForbiddenRealWalletEnvironmentKeys,
  parseCotiSnapOperation,
  parseRealWalletScenario,
  PINNED_COTI_SNAP_VERSION
} from './metamaskPolicy';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const scenario = {
  schemaVersion: 1,
  manifest: {
    chainId: '7082400',
    contractAddress: '0x1111111111111111111111111111111111111111',
    deploymentBlock: '123',
    runtimeBytecodeHash: `0x${'ab'.repeat(32)}`
  },
  maxTransactionValueWei: '0',
  participants: {
    alice: '0x2222222222222222222222222222222222222222',
    bob: '0x3333333333333333333333333333333333333333'
  }
};

describe('real-wallet fail-closed policy', () => {
  it('accepts only the exact public scenario manifest', () => {
    expect(parseRealWalletScenario(scenario)).toEqual(scenario);
    expect(() => parseRealWalletScenario({ ...scenario, rpcUrl: 'https://example.invalid' })).toThrow(
      /exact public measurement schema/i
    );
    expect(() =>
      parseRealWalletScenario({
        ...scenario,
        participants: { ...scenario.participants, alice: scenario.participants.bob }
      })
    ).toThrow(/distinct/i);
    expect(() =>
      parseRealWalletScenario({
        ...scenario,
        manifest: { ...scenario.manifest, chainId: '2632500' }
      })
    ).toThrow(/testnet/i);
    expect(() =>
      parseRealWalletScenario({ ...scenario, maxTransactionValueWei: '1' })
    ).toThrow(/zero/i);
  });

  it('rejects secret-shaped real-wallet environment variables', () => {
    expect(
      findForbiddenRealWalletEnvironmentKeys({
        CW_REAL_WALLET_ALICE_PROFILE_DIR: 'public-path',
        CW_REAL_WALLET_PASSWORD: 'do-not-use',
        CW_REAL_WALLET_SEED: 'do-not-use'
      })
    ).toEqual(['CW_REAL_WALLET_PASSWORD', 'CW_REAL_WALLET_SEED']);
  });

  it('classifies only allowlisted MetaMask prompt surfaces', () => {
    expect(
      classifyMetaMaskSurface({
        extensionId: EXTENSION_ID,
        phase: 'warm-send',
        promptHint: 'transaction',
        url: `chrome-extension://${EXTENSION_ID}/notification.html#confirm-transaction/123`
      })
    ).toMatchObject({ state: 'prompt', kind: 'transaction', requiresExplicitDecision: false });
    expect(() =>
      classifyMetaMaskSurface({
        extensionId: EXTENSION_ID,
        phase: 'warm-send',
        promptHint: 'transaction',
        url: `chrome-extension://${EXTENSION_ID}/notification.html#confirm-transaction`
      })
    ).toThrow(/identity/i);
    expect(() =>
      classifyMetaMaskSurface({
        extensionId: EXTENSION_ID,
        phase: 'warm-send',
        promptHint: 'transaction',
        url: `chrome-extension://${EXTENSION_ID}/notification.html#unexpected-route`
      })
    ).toThrow(/unknown/i);
    expect(() =>
      classifyMetaMaskSurface({
        extensionId: EXTENSION_ID,
        phase: 'warm-send',
        promptHint: 'transaction',
        url: `chrome-extension://${EXTENSION_ID}/notification.html#/confirm-signature/123`
      })
    ).toThrow(/unknown/i);
    expect(() =>
      classifyMetaMaskSurface({
        extensionId: EXTENSION_ID,
        phase: 'warm-send',
        promptHint: null,
        url: `chrome-extension://${EXTENSION_ID}/notification.html#/confirmation`
      })
    ).toThrow(/uncorrelated/i);
    expect(
      classifyMetaMaskSurface({
        extensionId: EXTENSION_ID,
        phase: 'snap-unlock',
        promptHint: 'snap-connect-wallet',
        url: `chrome-extension://${EXTENSION_ID}/notification.html#/confirmation`
      })
    ).toMatchObject({
      state: 'prompt',
      kind: 'snap-connect-wallet',
      requiresExplicitDecision: true
    });

    const first = classifyMetaMaskSurface({
      extensionId: EXTENSION_ID,
      phase: 'warm-send',
      promptHint: 'transaction',
      url: `chrome-extension://${EXTENSION_ID}/notification.html#/confirm-transaction/first`
    });
    const second = classifyMetaMaskSurface({
      extensionId: EXTENSION_ID,
      phase: 'warm-send',
      promptHint: 'transaction',
      url: `chrome-extension://${EXTENSION_ID}/notification.html#/confirm-transaction/second`
    });
    expect(first?.identity).not.toBe(second?.identity);
  });

  it('does not permit unlock or Snap prompts in warm phases', () => {
    expect(() => assertPromptAllowedInPhase('warm-send', 'transaction')).not.toThrow();
    expect(() => assertPromptAllowedInPhase('warm-send', 'wallet-unlock')).toThrow();
    expect(() => assertPromptAllowedInPhase('envelope-recovery', 'snap-aes-access')).toThrow();
  });

  it('allows only the reviewed COTI testnet Snap operations', () => {
    expect(
      parseCotiSnapOperation({
        snapId: 'npm:@coti-io/coti-snap',
        request: { method: 'connect-to-wallet' }
      })
    ).toBe('connect-to-wallet');
    expect(
      parseCotiSnapOperation({
        snapId: 'npm:@coti-io/coti-snap',
        request: { method: 'has-aes-key', params: { chainId: '7082400' } }
      })
    ).toBe('has-aes-key');
    expect(() =>
      parseCotiSnapOperation({
        snapId: 'npm:@coti-io/coti-snap',
        request: { method: 'get-aes-key', params: { chainId: '2632500' } }
      })
    ).toThrow(/non-testnet/i);
    expect(() =>
      parseCotiSnapOperation({
        snapId: 'npm:unreviewed-snap',
        request: { method: 'get-aes-key', params: { chainId: '7082400' } }
      })
    ).toThrow(/non-COTI/i);
    expect(
      parseCotiSnapOperation({
        snapId: 'npm:@coti-io/coti-snap',
        request: {
          method: 'set-aes-key',
          params: { chainId: '7082400', newUserAesKey: '11'.repeat(16) }
        }
      })
    ).toBe('set-aes-key');
    expect(() =>
      parseCotiSnapOperation({
        snapId: 'npm:@coti-io/coti-snap',
        request: {
          method: 'set-aes-key',
          params: { chainId: '7082400', newUserAesKey: 'not-a-key' }
        }
      })
    ).toThrow(/key-store/i);
  });

  it('accepts only the reviewed installed COTI Snap version', () => {
    expect(
      attestPinnedCotiSnapVersion({
        'npm:@coti-io/coti-snap': { version: PINNED_COTI_SNAP_VERSION },
        'npm:unrelated-snap': { version: '9.9.9' }
      })
    ).toBe(PINNED_COTI_SNAP_VERSION);
    expect(() => attestPinnedCotiSnapVersion({})).toThrow(/release pin/i);
    expect(() =>
      attestPinnedCotiSnapVersion({
        'npm:@coti-io/coti-snap': { version: '1.0.51' }
      })
    ).toThrow(/release pin/i);
    expect(() =>
      attestPinnedCotiSnapVersion({
        'npm:@coti-io/coti-snap': PINNED_COTI_SNAP_VERSION
      })
    ).toThrow(/release pin/i);
  });

  it('uses phase-specific RPC allowlists and excludes cold Snap installation', () => {
    expect(() => assertRpcMethodAllowedInPhase('warm-send', 'eth_call')).not.toThrow();
    expect(() =>
      assertRpcMethodAllowedInPhase('deployment-attestation', 'eth_accounts')
    ).not.toThrow();
    expect(() => assertRpcMethodAllowedInPhase('envelope-recovery', 'eth_getLogs')).not.toThrow();
    expect(() => assertRpcMethodAllowedInPhase('warm-send', 'eth_sendTransaction')).not.toThrow();
    expect(() => assertRpcMethodAllowedInPhase('warm-send', 'personal_sign')).toThrow();
    expect(() =>
      assertRpcMethodAllowedInPhase('warm-send', 'eth_getEncryptionPublicKey')
    ).toThrow();
    expect(() => assertRpcMethodAllowedInPhase('snap-unlock', 'wallet_requestSnaps')).toThrow();
    expect(() =>
      assertRpcMethodAllowedInPhase('snap-unlock', 'wallet_invokeSnap', 'get-aes-key')
    ).not.toThrow();
    expect(() => assertRpcMethodAllowedInPhase('snap-install', 'wallet_requestSnaps')).not.toThrow();
    expect(() => assertRpcMethodAllowedInPhase('privacy-onboarding', 'personal_sign')).not.toThrow();
    expect(() => assertRpcMethodAllowedInPhase('privacy-onboarding', 'eth_accounts')).not.toThrow();
    expect(() =>
      assertRpcMethodAllowedInPhase('snap-key-store', 'wallet_invokeSnap', 'set-aes-key')
    ).not.toThrow();
    expect(() =>
      assertRpcMethodAllowedInPhase('snap-unlock', 'wallet_invokeSnap', 'set-aes-key')
    ).toThrow();
  });
});
