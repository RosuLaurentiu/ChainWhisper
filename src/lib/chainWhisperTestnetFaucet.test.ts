import { getAddress, Interface, keccak256 } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import {
  buildTestnetFaucetTransactionRequest,
  inspectChainWhisperTestnetFaucetWithReader,
  validateTestnetFaucetTransaction,
  type TestnetFaucetReader
} from './chainWhisperTestnetFaucet';
import {
  TESTNET_CANDIDATE_COMPONENTS,
  type ActiveTestnetCandidateConfig,
  type TestnetCandidateComponentKey
} from './chainWhisperTestnetCandidate';

const wallet = '0x00000000000000000000000000000000000000a1';
const code = '0x01';
const runtimeHash = keccak256(code).toLowerCase();
const tokenSymbols: Partial<Record<TestnetCandidateComponentKey, string>> = {
  publicTestTokenA: 'cwTUB',
  publicTestTokenB: 'cwTUQ',
  privateTestTokenA: 'cwTPB',
  privateTestTokenB: 'cwTPQ'
};

const config = (): ActiveTestnetCandidateConfig => {
  const entries = Object.entries(TESTNET_CANDIDATE_COMPONENTS).map(([key, contract], index) => [
    key,
    Object.freeze({
      key,
      contract,
      address: getAddress(`0x${(index + 1).toString(16).padStart(40, '0')}`).toLowerCase(),
      runtimeBytecodeHash: runtimeHash,
      deploymentBlock: String(index + 1)
    })
  ]);
  return Object.freeze({
    status: 'active',
    manifestHash: `0x${'11'.repeat(32)}`,
    chainId: '7082400',
    owner: wallet,
    attestationBlock: Object.freeze({ number: '100', hash: `0x${'22'.repeat(32)}` }),
    components: Object.freeze(Object.fromEntries(entries)) as ActiveTestnetCandidateConfig['components'],
    finalityLagBlocks: 5n,
    rpcUrl: 'https://testnet.coti.io/rpc',
    fingerprint: 'fixture'
  });
};

const reader = (candidate: ActiveTestnetCandidateConfig, claimed = new Set<string>()): TestnetFaucetReader => {
  const symbolByAddress = new Map(
    Object.entries(tokenSymbols).map(([key, symbol]) => [candidate.components[key as TestnetCandidateComponentKey].address, symbol])
  );
  return Object.freeze({
    getChainId: async () => 7_082_400n,
    getCode: async () => code,
    readToken: async (address, _walletAddress, isPrivate) => Object.freeze({
      claimed: claimed.has(address),
      decimals: 6n,
      faucetAmount: 100_000_000_000n,
      ...(isPrivate ? { publicAmountsEnabled: false } : {}),
      symbol: symbolByAddress.get(address) ?? ''
    })
  });
};

describe('chainWhisperTestnetFaucet', () => {
  it('attests all four exact faucet tokens and resumes at the first unclaimed token', async () => {
    const candidate = config();
    const claimed = new Set([candidate.components.publicTestTokenA.address]);
    const state = await inspectChainWhisperTestnetFaucetWithReader({
      config: candidate,
      reader: reader(candidate, claimed),
      walletAddress: wallet
    });
    expect(state.claimed).toBe(1);
    expect(state.total).toBe(4);
    expect(state.next?.key).toBe('publicTestTokenB');
    expect(state.tokens.map(({ label }) => label)).toEqual(['cwTUB', 'cwTUQ', 'cwTPB', 'cwTPQ']);
  });

  it('fails closed on runtime, metadata, and private-visibility drift', async () => {
    const candidate = config();
    await expect(inspectChainWhisperTestnetFaucetWithReader({
      config: candidate,
      reader: { ...reader(candidate), getCode: async () => '0x02' },
      walletAddress: wallet
    })).rejects.toThrow(/runtime/);
    await expect(inspectChainWhisperTestnetFaucetWithReader({
      config: candidate,
      reader: {
        ...reader(candidate),
        readToken: async (address, walletAddress, isPrivate) => ({
          ...await reader(candidate).readToken(address, walletAddress, isPrivate),
          ...(isPrivate ? { publicAmountsEnabled: true } : {})
        })
      },
      walletAddress: wallet
    })).rejects.toThrow(/metadata/);
  });

  it('accepts only the exact value-zero claimFaucet transaction', () => {
    const candidate = config();
    const token = candidate.components.publicTestTokenA.address;
    const exact = {
      chainId: 7_082_400n,
      data: new Interface(['function claimFaucet()']).encodeFunctionData('claimFaucet'),
      from: wallet,
      to: token,
      value: 0n
    };
    const expected = { expectedChainId: 7_082_400n, expectedFrom: wallet, expectedToken: token };
    expect(() => validateTestnetFaucetTransaction(exact, expected)).not.toThrow();
    expect(() => validateTestnetFaucetTransaction({ ...exact, chainId: null }, expected)).not.toThrow();
    expect(() => validateTestnetFaucetTransaction({ ...exact, chainId: 'not-a-chain' }, expected)).toThrow(/does not match/);
    expect(() => validateTestnetFaucetTransaction({ ...exact, value: 1n }, expected)).toThrow(/does not match/);
    expect(() => validateTestnetFaucetTransaction({ ...exact, to: candidate.components.publicTestTokenB.address }, expected))
      .toThrow(/does not match/);
  });

  it('uses an explicit MPC gas ceiling for private claims instead of wallet estimation', () => {
    const candidate = config();
    expect(buildTestnetFaucetTransactionRequest({
      address: candidate.components.privateTestTokenA.address,
      kind: 'private'
    })).toMatchObject({
      to: candidate.components.privateTestTokenA.address,
      value: 0n,
      gasLimit: 12_000_000n
    });
    expect(buildTestnetFaucetTransactionRequest({
      address: candidate.components.publicTestTokenA.address,
      kind: 'public'
    }).gasLimit).toBe(500_000n);
  });
});
