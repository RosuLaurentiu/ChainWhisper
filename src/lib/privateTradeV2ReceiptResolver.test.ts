import {
  BrowserProvider,
  Interface,
  keccak256,
  toUtf8Bytes,
  type JsonRpcSigner
} from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ decryptPrivateUint256Output: vi.fn() }));
vi.mock('./privateUint256', async (importOriginal) => ({
  ...await importOriginal<typeof import('./privateUint256')>(),
  decryptPrivateUint256Output: mocks.decryptPrivateUint256Output
}));
import { decryptPrivateTradeV2ReceiptAmounts } from './privateTradeV2ReceiptResolver';
import { bindOwnerTradeV2MetaMaskCapability } from './ownerTradeV2Capability';
import { attestTradeHistoryV2Deployment, bindTradeHistoryV2ReadCapability } from './tradeHistoryV2Chain';
import {
  TRADE_HISTORY_V2_EVENT_ABIS,
  parseTradeHistoryV2Log,
  type ParsedTradeHistoryV2PrivateReceipt
} from './tradeHistoryV2Events';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const quantity = (value: bigint): string => `0x${value.toString(16)}`;
const blockHash = (value: bigint): string => `0x${value.toString(16).padStart(64, '0')}`;
const CHAIN_ID = 7_082_400n;
const CONTRACT = address('11');
const OWNER = address('22');
const CODE = '0x6001600055';
const METADATA = new Interface([
  'function contractVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)'
]);
const APP_WALLET = keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR')).toLowerCase();
const PRIVATE_EVENTS = new Interface(TRADE_HISTORY_V2_EVENT_ABIS.private);

class PrivateAttestationProvider {
  async request({ method, params = [] }: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    if (method === 'eth_chainId') return quantity(CHAIN_ID);
    if (method === 'eth_blockNumber') return quantity(130n);
    if (method === 'eth_getBlockByNumber') {
      const number = BigInt(String(params[0]));
      return { number: quantity(number), hash: blockHash(number), transactions: [] };
    }
    if (method === 'eth_getCode') return CODE;
    if (method === 'eth_call') {
      const parsed = METADATA.parseTransaction({ data: (params[0] as { data: string }).data });
      if (!parsed) throw new Error('Unknown getter.');
      return parsed.name === 'contractVersion'
        ? METADATA.encodeFunctionResult(parsed.name, ['ChainWhisperPrivateOTCEscrowV2'])
        : METADATA.encodeFunctionResult(parsed.name, [String(parsed.args[0]).toLowerCase() !== APP_WALLET]);
    }
    throw new Error(`Unexpected RPC ${method}.`);
  }
}

const setup = async () => {
  const readCapability = await bindTradeHistoryV2ReadCapability({
    provider: new PrivateAttestationProvider(), expectedChainId: CHAIN_ID,
    assertCurrent: () => undefined
  });
  const deployment = await attestTradeHistoryV2Deployment({
    capability: readCapability,
    manifest: {
      protocol: 'private-v2', chainId: CHAIN_ID, contractAddress: CONTRACT,
      deploymentBlock: 100n, runtimeBytecodeHash: keccak256(CODE)
    },
    finalityLagBlocks: 5n
  });
  const provider = new BrowserProvider({
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return quantity(CHAIN_ID);
      if (method === 'eth_accounts') return [OWNER];
      return null;
    })
  }, { chainId: Number(CHAIN_ID), name: 'Private OTC receipt test' });
  const decryptValue = vi.fn();
  const signer = {
    provider, decryptValue, getAddress: vi.fn(async () => OWNER),
    sendUncheckedTransaction: vi.fn(), getUserOnboardInfo: vi.fn(() => ({ aesKey: 'test' }))
  } as unknown as JsonRpcSigner;
  const capability = await bindOwnerTradeV2MetaMaskCapability({
    signer, browserProvider: provider, ownerAddress: OWNER, chainId: CHAIN_ID,
    assertCurrent: () => undefined
  });
  return { capability, deployment, decryptValue };
};

describe('privateTradeV2ReceiptResolver', () => {
  it('decrypts both exact participant receipt handles through the bound owner capability', async () => {
    mocks.decryptPrivateUint256Output.mockReset();
    mocks.decryptPrivateUint256Output.mockReturnValueOnce(10n).mockReturnValueOnce(25n);
    const context = await setup();
    const snapshot = PRIVATE_EVENTS.getEvent('PrivateOrderAccountSnapshotUpdated');
    if (!snapshot) throw new Error('Missing private snapshot event.');
    const encoded = PRIVATE_EVENTS.encodeEventLog(snapshot, [
      1n,
      OWNER,
      address('33'),
      1n,
      [[9n, 10n], [90n, 91n]],
      [[11n, 12n], [110n, 111n]],
      [[13n, 14n], [130n, 131n]],
      [[1n, 2n], [101n, 102n]],
      [[3n, 4n], [202n, 203n]]
    ]);
    const receipt = parseTradeHistoryV2Log({
      protocol: 'private-v2',
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      log: {
        address: CONTRACT,
        topics: encoded.topics,
        data: encoded.data,
        blockNumber: quantity(120n),
        blockHash: blockHash(120n),
        transactionHash: blockHash(121n),
        transactionIndex: '0x0',
        logIndex: '0x1',
        removed: false
      }
    }) as ParsedTradeHistoryV2PrivateReceipt;

    await expect(decryptPrivateTradeV2ReceiptAmounts({ ...context, receipt }))
      .resolves.toEqual({ offerAmount: '10', requestAmount: '25' });
    expect(mocks.decryptPrivateUint256Output).toHaveBeenNthCalledWith(
      1, expect.anything(), { ciphertextHigh: '101', ciphertextLow: '102' }
    );
    expect(mocks.decryptPrivateUint256Output).toHaveBeenNthCalledWith(
      2, expect.anything(), { ciphertextHigh: '202', ciphertextLow: '203' }
    );
    expect(context.decryptValue).not.toHaveBeenCalled();
  });

  it('rejects structural capabilities and deployments before decrypting receipt handles', async () => {
    await expect(decryptPrivateTradeV2ReceiptAmounts({
      capability: {} as never,
      deployment: {} as never,
      receipt: {
        kind: 'encrypted-receipt',
        protocol: 'private-v2',
        chainId: '7082400',
        contractAddress: `0x${'11'.repeat(20)}`,
        orderId: '1',
        recipient: `0x${'22'.repeat(20)}`,
        participant: `0x${'33'.repeat(20)}`,
        side: 'fill',
        contractRevision: '1',
        encryptedAmounts: {
          offerAmount: {
            ciphertextHigh: '1', ciphertextLow: '2', userCiphertextHigh: '3', userCiphertextLow: '4'
          },
          requestAmount: {
            ciphertextHigh: '5', ciphertextLow: '6', userCiphertextHigh: '7', userCiphertextLow: '8'
          }
        },
        log: {
          blockNumber: '1', blockHash: `0x${'44'.repeat(32)}`,
          transactionHash: `0x${'55'.repeat(32)}`, transactionIndex: 0, logIndex: 0
        }
      }
    })).rejects.toThrow(/not locally attested/i);
  });
});
