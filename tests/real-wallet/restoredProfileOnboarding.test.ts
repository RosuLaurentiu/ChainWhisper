import { generateRSAKeyPair } from '@coti-io/coti-sdk-typescript';
import { BrowserProvider, Interface, JsonRpcSigner, zeroPadValue } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_ONBOARD_ADDRESS,
  ACCOUNT_ONBOARD_GAS_HEX,
  ACCOUNT_ONBOARD_GAS_LIMIT,
  ACCOUNT_ONBOARD_RUNTIME_BYTECODE_HASH,
  ACCOUNT_ONBOARD_SELECTOR,
  assertPinnedCotiSnapSetAesKeyOrigin,
  assertPinnedAccountOnboardRuntimeHash,
  attestAccountOnboardRuntimeBytecode,
  recoverAesKeyFromAccountOnboardReceipt,
  RestoredProfileOnboardingPolicyError,
  PINNED_COTI_SNAP_SET_AES_KEY_ORIGINS,
  validateAccountOnboardTransactionRequest,
  validateCotiSnapSetAesKeyRequest,
  validateOnboardingPersonalSignParams,
  validatePinnedCotiSnapInstallRequest
} from './restoredProfileOnboarding';
import {
  COTI_SNAP_ID,
  COTI_TESTNET_CHAIN_ID,
  PINNED_COTI_SNAP_VERSION
} from './metamaskPolicy';

const ONBOARD_INTERFACE = new Interface([
  'function onboardAccount(bytes publicKey, bytes signedEK)',
  'event AccountOnboarded(address indexed _from, bytes userKey1, bytes userKey2)'
]);
const ALICE = '0x1111111111111111111111111111111111111111';
const MALLORY = '0x2222222222222222222222222222222222222222';
const OTHER_CONTRACT = '0x3333333333333333333333333333333333333333';
const TRANSACTION_HASH = `0x${'44'.repeat(32)}`;
const BLOCK_HASH = `0x${'55'.repeat(32)}`;
const BLOCK_NUMBER = '0x123';
const RSA_PUBLIC_KEY = `0x${'a5'.repeat(294)}`;
const PERSONAL_SIGNATURE = `0x${'b6'.repeat(64)}1b`;
const USER_KEY_1 = `0x${'c7'.repeat(256)}`;
const USER_KEY_2 = `0x${'d8'.repeat(256)}`;
const AES_KEY = 'e9'.repeat(16);
const RSA_PRIVATE_KEY = new Uint8Array([1, 3, 5, 7, 9, 11, 13, 15]);

const onboardCalldata = (publicKey = RSA_PUBLIC_KEY, signature = PERSONAL_SIGNATURE): string =>
  ONBOARD_INTERFACE.encodeFunctionData('onboardAccount', [publicKey, signature]);

const onboardTransaction = (
  overrides: Record<string, unknown> = {}
): Array<Record<string, unknown>> => [
  {
    data: onboardCalldata(),
    from: ALICE,
    gas: ACCOUNT_ONBOARD_GAS_HEX,
    to: ACCOUNT_ONBOARD_ADDRESS,
    value: '0x0',
    ...overrides
  }
];

const onboardTransactionWithoutValue = (): Array<Record<string, unknown>> => {
  const transaction = onboardTransaction();
  delete transaction[0].value;
  return transaction;
};

const onboardLog = ({
  account = ALICE,
  blockHash = BLOCK_HASH,
  blockNumber = BLOCK_NUMBER,
  removed = false,
  transactionHash = TRANSACTION_HASH,
  userKey1 = USER_KEY_1,
  userKey2 = USER_KEY_2
}: {
  account?: string;
  blockHash?: string;
  blockNumber?: string;
  removed?: boolean;
  transactionHash?: string;
  userKey1?: string;
  userKey2?: string;
} = {}): Record<string, unknown> => {
  const encoded = ONBOARD_INTERFACE.encodeEventLog(
    ONBOARD_INTERFACE.getEvent('AccountOnboarded')!,
    [account, userKey1, userKey2]
  );
  return {
    address: ACCOUNT_ONBOARD_ADDRESS,
    blockHash,
    blockNumber,
    data: encoded.data,
    removed,
    topics: encoded.topics,
    transactionHash
  };
};

const receipt = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  blockHash: BLOCK_HASH,
  blockNumber: BLOCK_NUMBER,
  from: ALICE,
  logs: [
    { address: OTHER_CONTRACT, data: '0x', topics: [] },
    onboardLog(),
    { address: OTHER_CONTRACT, data: '0x12', topics: [`0x${'99'.repeat(32)}`] }
  ],
  status: '0x1',
  to: ACCOUNT_ONBOARD_ADDRESS,
  transactionHash: TRANSACTION_HASH,
  ...overrides
});

const recoveryContext = () => ({
  expectedAccount: ALICE,
  expectedTransactionHash: TRANSACTION_HASH,
  rsaPrivateKey: RSA_PRIVATE_KEY
});

const captureError = (operation: () => unknown): RestoredProfileOnboardingPolicyError => {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(RestoredProfileOnboardingPolicyError);
    return error as RestoredProfileOnboardingPolicyError;
  }
  throw new Error('Expected operation to fail.');
};

describe('restored-profile COTI onboarding policy', () => {
  it('pins the reviewed public contract, selector, runtime hash, and exact gas request', () => {
    expect(ACCOUNT_ONBOARD_ADDRESS).toBe('0x536A67f0cc46513E7d27a370ed1aF9FDcC7A5095');
    expect(ACCOUNT_ONBOARD_SELECTOR).toBe('0xafaea1bd');
    expect(ACCOUNT_ONBOARD_RUNTIME_BYTECODE_HASH).toBe(
      '0x10b300ac6fba3b03ab87fb4728ed1d7a033a1551c97abc81194aa4c889324718'
    );
    expect(ACCOUNT_ONBOARD_GAS_LIMIT).toBe(12_000_000n);
    expect(ACCOUNT_ONBOARD_GAS_HEX).toBe('0xb71b00');
    expect(ONBOARD_INTERFACE.getFunction('onboardAccount')?.selector).toBe(ACCOUNT_ONBOARD_SELECTOR);

    expect(assertPinnedAccountOnboardRuntimeHash(ACCOUNT_ONBOARD_RUNTIME_BYTECODE_HASH)).toEqual({
      address: ACCOUNT_ONBOARD_ADDRESS,
      runtimeBytecodeHash: ACCOUNT_ONBOARD_RUNTIME_BYTECODE_HASH
    });
    expect(() => assertPinnedAccountOnboardRuntimeHash(`0x${'00'.repeat(32)}`)).toThrow(
      /reviewed bytecode/i
    );
    expect(() => attestAccountOnboardRuntimeBytecode('0x00')).toThrow(/reviewed bytecode/i);
    expect(() => attestAccountOnboardRuntimeBytecode('0x0')).toThrow(/invalid runtime/i);
  });

  it('accepts only ethers-v6 personal_sign parameter order bound to Alice and the in-memory RSA key', () => {
    const attestation = validateOnboardingPersonalSignParams(
      [RSA_PUBLIC_KEY, ALICE.toLowerCase()],
      { expectedAccount: ALICE, rsaPublicKey: RSA_PUBLIC_KEY }
    );
    expect(attestation).toEqual({
      account: ALICE,
      method: 'personal_sign',
      rsaPublicKeyBytes: 294
    });

    const bytes = Uint8Array.from({ length: 294 }, () => 0xa5);
    expect(() =>
      validateOnboardingPersonalSignParams([RSA_PUBLIC_KEY, ALICE], {
        expectedAccount: ALICE,
        rsaPublicKey: bytes
      })
    ).not.toThrow();
    for (const params of [
      [ALICE, RSA_PUBLIC_KEY],
      [RSA_PUBLIC_KEY, ALICE.toUpperCase()],
      [`0x${'a4'.repeat(294)}`, ALICE],
      [RSA_PUBLIC_KEY, MALLORY],
      [RSA_PUBLIC_KEY, ALICE, 'extra']
    ]) {
      expect(() =>
        validateOnboardingPersonalSignParams(params, {
          expectedAccount: ALICE,
          rsaPublicKey: RSA_PUBLIC_KEY
        })
      ).toThrow();
    }
  });

  it('matches the installed COTI SDK RSA and ethers-v6 RPC wire shapes offline', async () => {
    const rsaKeyPair = generateRSAKeyPair();
    const rpcRequests: Array<{ method: string; params?: unknown }> = [];
    const provider = new BrowserProvider(
      {
        request: async ({ method, params }) => {
          rpcRequests.push({ method, params });
          if (method === 'eth_chainId') {
            return `0x${Number(COTI_TESTNET_CHAIN_ID).toString(16)}`;
          }
          if (method === 'personal_sign') return PERSONAL_SIGNATURE;
          throw new Error(`Unexpected offline RPC method: ${method}`);
        }
      },
      { chainId: Number(COTI_TESTNET_CHAIN_ID), name: 'coti-testnet' }
    );

    try {
      expect(rsaKeyPair.publicKey.byteLength).toBe(294);
      expect(rsaKeyPair.privateKey.byteLength).toBeGreaterThan(0);

      const signer = new JsonRpcSigner(provider, ACCOUNT_ONBOARD_ADDRESS);
      await expect(signer.signMessage(rsaKeyPair.publicKey)).resolves.toBe(PERSONAL_SIGNATURE);
      const personalSignRequests = rpcRequests.filter(({ method }) => method === 'personal_sign');
      expect(personalSignRequests).toHaveLength(1);
      if (!Array.isArray(personalSignRequests[0]?.params)) {
        throw new Error('Installed signer emitted malformed personal_sign params.');
      }
      expect(personalSignRequests[0].params[1]).toBe(ACCOUNT_ONBOARD_ADDRESS.toLowerCase());
      expect(
        validateOnboardingPersonalSignParams(personalSignRequests[0].params, {
          expectedAccount: ACCOUNT_ONBOARD_ADDRESS,
          rsaPublicKey: rsaKeyPair.publicKey
        })
      ).toEqual({
        account: ACCOUNT_ONBOARD_ADDRESS.toLowerCase(),
        method: 'personal_sign',
        rsaPublicKeyBytes: 294
      });

      const rpcTransaction = provider.getRpcTransaction({
        data: onboardCalldata(),
        from: ALICE,
        gasLimit: ACCOUNT_ONBOARD_GAS_LIMIT,
        to: ACCOUNT_ONBOARD_ADDRESS
      });
      expect(rpcTransaction).toEqual({
        data: onboardCalldata(),
        from: ALICE,
        gas: ACCOUNT_ONBOARD_GAS_HEX,
        to: ACCOUNT_ONBOARD_ADDRESS.toLowerCase()
      });
      expect(() =>
        validateAccountOnboardTransactionRequest([rpcTransaction], {
          expectedAccount: ALICE,
          personalSignature: PERSONAL_SIGNATURE,
          rsaPublicKey: RSA_PUBLIC_KEY
        })
      ).not.toThrow();
    } finally {
      rpcRequests.length = 0;
      rsaKeyPair.publicKey.fill(0);
      rsaKeyPair.privateKey.fill(0);
      provider.destroy();
    }
  });

  it('decodes and binds AccountOnboard with omitted or canonical-zero value', () => {
    const attestation = validateAccountOnboardTransactionRequest(onboardTransaction(), {
      expectedAccount: ALICE,
      personalSignature: PERSONAL_SIGNATURE,
      rsaPublicKey: RSA_PUBLIC_KEY
    });
    expect(attestation).toEqual({
      account: ALICE,
      gasLimit: '12000000',
      selector: ACCOUNT_ONBOARD_SELECTOR,
      target: ACCOUNT_ONBOARD_ADDRESS.toLowerCase()
    });
    expect(() =>
      validateAccountOnboardTransactionRequest(onboardTransactionWithoutValue(), {
        expectedAccount: ALICE,
        personalSignature: PERSONAL_SIGNATURE,
        rsaPublicKey: RSA_PUBLIC_KEY
      })
    ).not.toThrow();

    for (const overrides of [
      { from: MALLORY },
      { to: OTHER_CONTRACT },
      { value: undefined },
      { value: '0x00' },
      { value: '0x1' },
      { gas: '0xB71B00' },
      { gas: '0xb71aff' },
      { gas: '0xb71b01' },
      { gasPrice: '0x1' },
      { maxFeePerGas: '0x1' },
      { data: `${onboardCalldata()}00` },
      { data: `0xdeadbeef${onboardCalldata().slice(10)}` }
    ]) {
      expect(() =>
        validateAccountOnboardTransactionRequest(onboardTransaction(overrides), {
          expectedAccount: ALICE,
          personalSignature: PERSONAL_SIGNATURE,
          rsaPublicKey: RSA_PUBLIC_KEY
        })
      ).toThrow();
    }
    expect(() =>
      validateAccountOnboardTransactionRequest(onboardTransaction(), {
        expectedAccount: ALICE,
        personalSignature: `0x${'00'.repeat(64)}1b`,
        rsaPublicKey: RSA_PUBLIC_KEY
      })
    ).toThrow(/binding/i);
    expect(() =>
      validateAccountOnboardTransactionRequest(onboardTransaction(), {
        expectedAccount: ALICE,
        personalSignature: PERSONAL_SIGNATURE,
        rsaPublicKey: `0x${'00'.repeat(294)}`
      })
    ).toThrow(/binding/i);
  });

  it('finds one matching event, ignores unrelated logs, and injects recoverUserKey with both shares', () => {
    const recoverUserKey = vi.fn(() => AES_KEY);
    const result = recoverAesKeyFromAccountOnboardReceipt(
      receipt(),
      recoveryContext(),
      recoverUserKey
    );

    expect(recoverUserKey).toHaveBeenCalledOnce();
    expect(recoverUserKey).toHaveBeenCalledWith(
      RSA_PRIVATE_KEY,
      USER_KEY_1.slice(2),
      USER_KEY_2.slice(2)
    );
    expect(result.receipt).toEqual({
      account: ALICE,
      blockHash: BLOCK_HASH,
      blockNumber: '291',
      contractAddress: ACCOUNT_ONBOARD_ADDRESS.toLowerCase(),
      transactionHash: TRANSACTION_HASH
    });
    expect(result.aesKey.byteLength).toBe(16);
    expect(result.aesKey.matches(AES_KEY)).toBe(true);
    expect(result.aesKey.matches('00'.repeat(16))).toBe(false);
    expect(result.aesKey.use((value) => value === AES_KEY)).toBe(true);
    expect(String(result.aesKey)).toBe('[redacted COTI AES key]');
    expect(result.aesKey.isDestroyed()).toBe(false);
    result.aesKey.destroy();
    result.aesKey.destroy();
    expect(result.aesKey.isDestroyed()).toBe(true);
    expect(result.aesKey.matches(AES_KEY)).toBe(false);
    expect(() => result.aesKey.use(() => undefined)).toThrow(/destroyed/i);
    expect(JSON.stringify(result.aesKey)).not.toContain(AES_KEY);
  });

  it('rejects missing or failed receipt status and receipt-level provenance mismatches', () => {
    for (const malformed of [
      receipt({ status: undefined }),
      receipt({ status: '0x0' }),
      receipt({ from: MALLORY }),
      receipt({ to: OTHER_CONTRACT }),
      receipt({ transactionHash: `0x${'66'.repeat(32)}` }),
      receipt({ blockHash: undefined }),
      receipt({ blockNumber: undefined }),
      receipt({ blockNumber: '0x0' }),
      receipt({ blockNumber: '0x0123' }),
      receipt({ logs: undefined })
    ]) {
      expect(() =>
        recoverAesKeyFromAccountOnboardReceipt(malformed, recoveryContext(), () => AES_KEY)
      ).toThrow();
    }
  });

  it('rejects removed, mismatched, duplicate, missing, and malformed AccountOnboarded logs', () => {
    const otherTransaction = `0x${'77'.repeat(32)}`;
    const otherBlock = `0x${'88'.repeat(32)}`;
    const matching = onboardLog();
    const cases: unknown[][] = [
      [onboardLog({ removed: true })],
      [onboardLog({ transactionHash: otherTransaction })],
      [onboardLog({ blockHash: otherBlock })],
      [onboardLog({ blockNumber: '0x124' })],
      [onboardLog({ account: MALLORY })],
      [matching, { ...matching }],
      [{ address: OTHER_CONTRACT, data: '0x', topics: [] }],
      [onboardLog({ userKey1: '0x12' })],
      [onboardLog({ userKey2: '0x34' })]
    ];

    for (const logs of cases) {
      expect(() =>
        recoverAesKeyFromAccountOnboardReceipt(
          receipt({ logs }),
          recoveryContext(),
          () => AES_KEY
        )
      ).toThrow();
    }

    const noncanonical = onboardLog();
    noncanonical.data = `${String(noncanonical.data)}00`;
    expect(() =>
      recoverAesKeyFromAccountOnboardReceipt(
        receipt({ logs: [noncanonical] }),
        recoveryContext(),
        () => AES_KEY
      )
    ).toThrow();
  });

  it('fails closed when recovery throws or returns anything except canonical 16-byte AES hex', () => {
    const secretErrorText = `recovery failed with ${USER_KEY_1}`;
    const thrown = captureError(() =>
      recoverAesKeyFromAccountOnboardReceipt(receipt(), recoveryContext(), () => {
        throw new Error(secretErrorText);
      })
    );
    expect(thrown.code).toBe('AES_RECOVERY_FAILED');
    expect(`${thrown.message}\n${thrown.stack ?? ''}\n${JSON.stringify(thrown)}`).not.toContain(
      secretErrorText
    );

    for (const recovered of [
      '',
      'e9'.repeat(15),
      'e9'.repeat(17),
      `0x${AES_KEY}`,
      AES_KEY.toUpperCase(),
      'zz'.repeat(16)
    ]) {
      expect(() =>
        recoverAesKeyFromAccountOnboardReceipt(
          receipt(),
          recoveryContext(),
          () => recovered
        )
      ).toThrow(/canonical 16-byte/i);
    }
  });

  it('validates only the pinned Snap install request and exact set-aes-key invocation', () => {
    expect(PINNED_COTI_SNAP_SET_AES_KEY_ORIGINS).toEqual([
      'https://metamask.coti.io',
      'https://dev.metamask.coti.io'
    ]);
    expect(assertPinnedCotiSnapSetAesKeyOrigin('https://metamask.coti.io')).toBe(
      'https://metamask.coti.io'
    );
    expect(assertPinnedCotiSnapSetAesKeyOrigin('https://dev.metamask.coti.io')).toBe(
      'https://dev.metamask.coti.io'
    );
    for (const origin of [
      'http://localhost:5173',
      'https://chainwhisper.chat',
      'https://metamask.coti.io/',
      'HTTPS://METAMASK.COTI.IO',
      null
    ]) {
      expect(() => assertPinnedCotiSnapSetAesKeyOrigin(origin)).toThrow(/does not allow/i);
    }

    const installRequest = {
      method: 'wallet_requestSnaps',
      params: { [COTI_SNAP_ID]: { version: PINNED_COTI_SNAP_VERSION } }
    };
    expect(validatePinnedCotiSnapInstallRequest(installRequest)).toEqual({
      method: 'wallet_requestSnaps',
      snapId: COTI_SNAP_ID,
      version: PINNED_COTI_SNAP_VERSION
    });
    for (const request of [
      { ...installRequest, method: 'wallet_invokeSnap' },
      { ...installRequest, extra: true },
      { method: 'wallet_requestSnaps', params: { [COTI_SNAP_ID]: {} } },
      {
        method: 'wallet_requestSnaps',
        params: { [COTI_SNAP_ID]: { version: '1.0.51', extra: true } }
      },
      {
        method: 'wallet_requestSnaps',
        params: { 'npm:mallory-snap': { version: PINNED_COTI_SNAP_VERSION } }
      }
    ]) {
      expect(() => validatePinnedCotiSnapInstallRequest(request)).toThrow();
    }

    const recovery = recoverAesKeyFromAccountOnboardReceipt(
      receipt(),
      recoveryContext(),
      () => AES_KEY
    );
    const exactSetRequest = recovery.aesKey.use((newUserAesKey) => ({
      method: 'wallet_invokeSnap',
      params: {
        request: {
          method: 'set-aes-key',
          params: { chainId: COTI_TESTNET_CHAIN_ID, newUserAesKey }
        },
        snapId: COTI_SNAP_ID
      }
    }));
    expect(validateCotiSnapSetAesKeyRequest(exactSetRequest, recovery.aesKey)).toEqual({
      chainId: COTI_TESTNET_CHAIN_ID,
      method: 'wallet_invokeSnap',
      operation: 'set-aes-key',
      snapId: COTI_SNAP_ID
    });

    const invoke = exactSetRequest.params.request;
    for (const request of [
      { ...exactSetRequest, method: 'wallet_requestSnaps' },
      { ...exactSetRequest, extra: true },
      { ...exactSetRequest, params: { ...exactSetRequest.params, snapId: 'npm:mallory-snap' } },
      {
        ...exactSetRequest,
        params: { ...exactSetRequest.params, request: { ...invoke, method: 'get-aes-key' } }
      },
      {
        ...exactSetRequest,
        params: {
          ...exactSetRequest.params,
          request: { ...invoke, params: { ...invoke.params, chainId: '2632500' } }
        }
      },
      {
        ...exactSetRequest,
        params: {
          ...exactSetRequest.params,
          request: { ...invoke, params: { ...invoke.params, newUserAesKey: '00'.repeat(16) } }
        }
      },
      {
        ...exactSetRequest,
        params: {
          ...exactSetRequest.params,
          request: { ...invoke, params: { ...invoke.params, extra: true } }
        }
      }
    ]) {
      expect(() => validateCotiSnapSetAesKeyRequest(request, recovery.aesKey)).toThrow();
    }
    recovery.aesKey.destroy();
  });

  it('keeps AES, RSA material, shares, and signatures out of attestations and errors', () => {
    const recovery = recoverAesKeyFromAccountOnboardReceipt(
      receipt(),
      recoveryContext(),
      () => AES_KEY
    );
    const publicOutcomes = [
      validateOnboardingPersonalSignParams([RSA_PUBLIC_KEY, ALICE], {
        expectedAccount: ALICE,
        rsaPublicKey: RSA_PUBLIC_KEY
      }),
      validateAccountOnboardTransactionRequest(onboardTransaction(), {
        expectedAccount: ALICE,
        personalSignature: PERSONAL_SIGNATURE,
        rsaPublicKey: RSA_PUBLIC_KEY
      }),
      recovery,
      validatePinnedCotiSnapInstallRequest({
        method: 'wallet_requestSnaps',
        params: { [COTI_SNAP_ID]: { version: PINNED_COTI_SNAP_VERSION } }
      })
    ];
    const serialized = JSON.stringify(publicOutcomes);
    const forbidden = [
      AES_KEY,
      RSA_PUBLIC_KEY.slice(2),
      USER_KEY_1.slice(2),
      USER_KEY_2.slice(2),
      PERSONAL_SIGNATURE.slice(2),
      Buffer.from(RSA_PRIVATE_KEY).toString('hex')
    ];
    for (const secret of forbidden) expect(serialized).not.toContain(secret);
    expect(serialized).toContain('"redacted":true');

    const error = captureError(() =>
      validateAccountOnboardTransactionRequest(
        onboardTransaction({ data: `${onboardCalldata()}00` }),
        {
          expectedAccount: ALICE,
          personalSignature: PERSONAL_SIGNATURE,
          rsaPublicKey: RSA_PUBLIC_KEY
        }
      )
    );
    const serializedError = `${error.message}\n${error.stack ?? ''}\n${JSON.stringify(error)}`;
    for (const secret of forbidden) expect(serializedError).not.toContain(secret);
    recovery.aesKey.destroy();
  });

  it('uses the exact indexed Alice topic in the accepted event', () => {
    const log = onboardLog();
    expect(log.topics).toEqual([
      ONBOARD_INTERFACE.getEvent('AccountOnboarded')?.topicHash,
      zeroPadValue(ALICE, 32)
    ]);
  });
});
