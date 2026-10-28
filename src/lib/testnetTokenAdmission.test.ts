import { describe, expect, it } from 'vitest';
import { Interface, getAddress } from 'ethers';
import {
  TESTNET_TOKEN_ADMISSION_OPERATION_COUNT,
  TESTNET_TOKEN_ADMISSION_OWNER,
  TESTNET_TOKEN_ADMISSION_PLAN,
  TESTNET_TOKEN_ADMISSION_TARGETS,
  TESTNET_TOKEN_ADMISSION_TOKENS,
  getNextTestnetTokenAdmission,
  type TestnetTokenAdmissionSnapshot
} from './testnetTokenAdmission';

describe('COTI testnet token-admission plan', () => {
  it('pins one owner, six distinct contracts, and four distinct tokens', () => {
    expect(getAddress(TESTNET_TOKEN_ADMISSION_OWNER)).toBe(TESTNET_TOKEN_ADMISSION_OWNER);
    expect(new Set(TESTNET_TOKEN_ADMISSION_TARGETS.map((target) => target.address.toLowerCase()))).toHaveLength(6);
    expect(new Set(TESTNET_TOKEN_ADMISSION_TOKENS.map((token) => token.address.toLowerCase()))).toHaveLength(4);
    for (const item of [...TESTNET_TOKEN_ADMISSION_TARGETS, ...TESTNET_TOKEN_ADMISSION_TOKENS]) {
      expect(item.runtimeBytecodeHash).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it('matches the reviewed 16-operation contract plan exactly', () => {
    expect(TESTNET_TOKEN_ADMISSION_PLAN).toHaveLength(TESTNET_TOKEN_ADMISSION_OPERATION_COUNT);
    expect(TESTNET_TOKEN_ADMISSION_PLAN.map((operation) => operation.id)).toEqual([
      'direct.publicA.public-approval',
      'direct.publicB.public-approval',
      'direct.privateA.private-approval',
      'direct.privateB.private-approval',
      'standard.publicA.public-approval',
      'standard.publicB.public-approval',
      'private.publicA.public-approval',
      'private.publicB.public-approval',
      'private.privateA.private-approval',
      'private.privateB.private-approval',
      'recurring.publicA.public-approval',
      'recurring.publicB.public-approval',
      'privateRecurring.privateA.private-approval',
      'privateRecurring.privateB.private-approval',
      'liquidity.privateA.private-approval',
      'liquidity.privateB.private-approval'
    ]);
    expect(new Set(TESTNET_TOKEN_ADMISSION_PLAN.map((operation) => operation.id))).toHaveLength(16);
  });

  it('encodes only the three reviewed approval selectors with enabled=true', () => {
    const selectors = new Set([
      new Interface(['function setPublicTokenApproval(address,bool)']).getFunction('setPublicTokenApproval')!.selector,
      new Interface(['function setTokenApproval(address,bool)']).getFunction('setTokenApproval')!.selector,
      new Interface(['function setPrivateTokenApproval(address,bool)']).getFunction('setPrivateTokenApproval')!.selector
    ]);
    for (const operation of TESTNET_TOKEN_ADMISSION_PLAN) {
      expect(selectors.has(operation.selector)).toBe(true);
      expect(operation.data).toMatch(/^0x[0-9a-f]+$/);
      expect(operation.data.endsWith('1'.padStart(64, '0'))).toBe(true);
    }
  });

  it('selects only the first unapplied operation and stops when complete', () => {
    const snapshot = (appliedCount: number): TestnetTokenAdmissionSnapshot => ({
      blockNumber: 1,
      blockHash: `0x${'11'.repeat(32)}`,
      states: TESTNET_TOKEN_ADMISSION_PLAN.map((operation, index) => ({ operation, applied: index < appliedCount })),
      appliedCount,
      complete: appliedCount === TESTNET_TOKEN_ADMISSION_OPERATION_COUNT
    });
    expect(getNextTestnetTokenAdmission(snapshot(0))?.index).toBe(0);
    expect(getNextTestnetTokenAdmission(snapshot(9))?.index).toBe(9);
    expect(getNextTestnetTokenAdmission(snapshot(16))).toBeNull();
  });
});
