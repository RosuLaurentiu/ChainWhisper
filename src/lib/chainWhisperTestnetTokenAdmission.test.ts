import { describe, expect, it } from 'vitest';
import {
  __CHAINWHISPER_TESTNET_TOKEN_ADMISSION_SUITE_FOR_TEST,
  __inspectChainWhisperTestnetTokenAdmissionsForTest,
  CHAINWHISPER_TESTNET_TOKEN_ADMISSIONS
} from './chainWhisperTestnetTokenAdmission';

const { TARGETS, TOKENS } = __CHAINWHISPER_TESTNET_TOKEN_ADMISSION_SUITE_FOR_TEST;

const reader = (approvedIds: readonly string[] = [], overrides: Partial<{
  chainId: bigint;
  code: string;
  owner: string;
}> = {}) => ({
  getNetwork: async () => ({ chainId: overrides.chainId ?? 7_082_400n }),
  readCodeHash: async (address: string) => {
    if (overrides.code) return overrides.code;
    const target = Object.values(TARGETS).find((item) => item.address === address);
    const token = Object.values(TOKENS).find((item) => item.address === address);
    return target?.runtimeHash ?? token?.runtimeHash ?? `0x${'00'.repeat(32)}`;
  },
  readOwner: async () => overrides.owner ?? '0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d',
  readApproval: async (target: string, _getter: string, token: string) => {
    const operation = CHAINWHISPER_TESTNET_TOKEN_ADMISSIONS.find((item) =>
      item.targetAddress === target && item.tokenAddress === token
    );
    const tokenEntry = Object.values(TOKENS).find((item) => item.address === token);
    return operation && approvedIds.includes(operation.id) ? tokenEntry?.runtimeHash ?? '' : `0x${'00'.repeat(32)}`;
  }
});

describe('chainWhisperTestnetTokenAdmission', () => {
  it('defines the exact deterministic 16-operation approval-only plan', () => {
    expect(CHAINWHISPER_TESTNET_TOKEN_ADMISSIONS).toHaveLength(16);
    expect(new Set(CHAINWHISPER_TESTNET_TOKEN_ADMISSIONS.map(({ id }) => id)).size).toBe(16);
    expect(CHAINWHISPER_TESTNET_TOKEN_ADMISSIONS.some(({ id }) => /encrypt/iu.test(id))).toBe(false);
  });

  it('resumes from canonical on-chain approval state', async () => {
    const firstFive = CHAINWHISPER_TESTNET_TOKEN_ADMISSIONS.slice(0, 5).map(({ id }) => id);
    const state = await __inspectChainWhisperTestnetTokenAdmissionsForTest(reader(firstFive));
    expect(state.complete).toBe(5);
    expect(state.total).toBe(16);
    expect(state.next?.id).toBe(CHAINWHISPER_TESTNET_TOKEN_ADMISSIONS[5].id);
  });

  it('reports completion only when every exact token code hash is admitted', async () => {
    const all = CHAINWHISPER_TESTNET_TOKEN_ADMISSIONS.map(({ id }) => id);
    const state = await __inspectChainWhisperTestnetTokenAdmissionsForTest(reader(all));
    expect(state.complete).toBe(16);
    expect(state.next).toBeNull();
  });

  it('fails closed on the wrong chain, owner, or reviewed runtime', async () => {
    await expect(__inspectChainWhisperTestnetTokenAdmissionsForTest(reader([], { chainId: 1n })))
      .rejects.toThrow(/not COTI Testnet/);
    await expect(__inspectChainWhisperTestnetTokenAdmissionsForTest(reader([], {
      owner: '0x0000000000000000000000000000000000000001'
    }))).rejects.toThrow(/owner/);
    await expect(__inspectChainWhisperTestnetTokenAdmissionsForTest(reader([], {
      code: `0x${'ab'.repeat(32)}`
    })))
      .rejects.toThrow(/runtime/);
  });
});
