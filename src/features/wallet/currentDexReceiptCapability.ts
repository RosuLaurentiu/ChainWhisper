import { decryptUint } from '@coti-io/coti-sdk-typescript';
import { readCurrentDexGraph, readCurrentDexPrincipalReceipt } from '../../lib/appChain';
import { createDexV2ReadCapability } from '../../lib/dexV2Chain';
import { decryptPrivateUint256Output } from '../../lib/privateUint256';
import type { CurrentCheapDexProfile } from '../../lib/currentDexOperation';
import { issueOwnerCotiMetaMaskCapability, type IssueOwnerCotiMetaMaskCapabilityArgs } from './ownerCotiMetaMaskCapability';

type ReadArgs = Omit<Parameters<typeof readCurrentDexPrincipalReceipt>[0], 'capability' | 'principal'>;
type CurrentReadArgs = Omit<ReadArgs, 'profile'> & { profile: CurrentCheapDexProfile };
type IssueArgs = Omit<IssueOwnerCotiMetaMaskCapabilityArgs<unknown>, 'bindCapability' | 'capabilityLabel' | 'requirePrivacy'>;

// Read/decrypt only. Supplied runtime identity is not full deployment admission or write authority.
export const issueCurrentDexReceiptCapability = (args: IssueArgs) => issueOwnerCotiMetaMaskCapability({
  ...args,
  capabilityLabel: 'current DEX receipts',
  requirePrivacy: true,
  bindCapability: async ({ assertCurrent, assertSnapshotCurrent, readProvider, signer, chainId, ownerAddress }) => {
    const capability = createDexV2ReadCapability({ chainId, assertCurrent,
      provider: { request: ({ method, params }) => readProvider.send(method, params ?? []) } });
    const revealSnapshot = async <T extends { encrypted: Awaited<ReturnType<typeof readCurrentDexPrincipalReceipt>>['encrypted'] }>(snapshot: T) => {
      await assertCurrent();
      assertSnapshotCurrent();
      const aesKey = signer.getUserOnboardInfo()?.aesKey?.trim();
      if (!aesKey) throw new Error('Unlock privacy before revealing DEX receipts.');
      const filled = decryptUint(snapshot.encrypted.filled, aesKey);
      if (filled !== 0n && filled !== 1n) throw new Error('Invalid DEX receipt boolean.');
      const reveal = (value: typeof snapshot.encrypted.netOutput) => decryptPrivateUint256Output(signer, value);
      const amounts = Object.freeze({ filled: filled === 1n,
        maximumInput: reveal(snapshot.encrypted.maximumInput), actualInput: reveal(snapshot.encrypted.actualInput),
        refund: reveal(snapshot.encrypted.refund), grossOutput: reveal(snapshot.encrypted.grossOutput),
        fee: reveal(snapshot.encrypted.fee), netOutput: reveal(snapshot.encrypted.netOutput) });
      if (amounts.actualInput > amounts.maximumInput || amounts.fee + amounts.netOutput !== amounts.grossOutput) {
        throw new Error('Inconsistent DEX receipt amounts. Refresh privacy and read again.');
      }
      await assertCurrent();
      assertSnapshotCurrent();
      const { encrypted: _encrypted, ...identity } = snapshot;
      return Object.freeze({ ...identity, amounts });
    };
    const read = async (request: ReadArgs) => {
      await assertCurrent(); assertSnapshotCurrent();
      return revealSnapshot(await readCurrentDexPrincipalReceipt({ ...request, capability, principal: ownerAddress }));
    };
    const readCurrent = async (request: CurrentReadArgs) => {
      await assertCurrent(); assertSnapshotCurrent();
      return revealSnapshot(await readCurrentDexPrincipalReceipt({ ...request, capability, principal: ownerAddress }));
    };
    return Object.freeze({ read, readCurrent,
      // Same-block full public graph check plus the existing owner-only receipt path. No signer is exposed.
      readFromGraph: async (request: Omit<Parameters<typeof readCurrentDexGraph>[0], 'capability'> & { operationId: bigint }) => {
        const operationId = request.operationId;
        const graph = await readCurrentDexGraph({ ...request, capability });
        const receipt = await read({ expected: graph.operationReadIdentity, operationId });
        return Object.freeze({ ...receipt, graph: graph.graph, manifestHash: graph.manifestHash });
      }
    });
  }
});
