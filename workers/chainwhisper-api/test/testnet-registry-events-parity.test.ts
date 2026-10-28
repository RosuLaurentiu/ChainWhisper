import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TESTNET_COMPONENT_EVENT_POLICIES } from '../src/testnetRegistryV2';

const artifacts = {
  chatReactionsV1: 'ChatReactionsV1.sol/ChatReactionsV1.json',
  directChatV2: 'ChainWhisperChatV2.sol/ChainWhisperChatV2.json',
  directOtcV2: 'ChainWhisperDirectOTCEscrowV2.sol/ChainWhisperDirectOTCEscrowV2.json',
  groupChatV2: 'ChainWhisperGroupChatV2.sol/ChainWhisperGroupChatV2.json',
  'private-recurringOtcV2':
    'ChainWhisperPrivateRecurringOTCEscrowV2.sol/ChainWhisperPrivateRecurringOTCEscrowV2.json',
  privateLiquidityBookV2:
    'ChainWhisperPrivateLiquidityBookV2.sol/ChainWhisperPrivateLiquidityBookV2.json',
  privateLiquidityHiddenIntentV2:
    'ChainWhisperPrivateLiquidityHiddenIntentModuleV2.sol/ChainWhisperPrivateLiquidityHiddenIntentModuleV2.json',
  privateLiquidityPositionNftV2:
    'ChainWhisperPrivateLiquidityPositionNFTV2.sol/ChainWhisperPrivateLiquidityPositionNFTV2.json',
  privateOtcV2: 'ChainWhisperPrivateOTCEscrowV2.sol/ChainWhisperPrivateOTCEscrowV2.json',
  privateTestTokenA: 'ChainWhisperTestPrivateTokenV1.sol/ChainWhisperTestPrivateTokenV1.json',
  privateTestTokenB: 'ChainWhisperTestPrivateTokenV1.sol/ChainWhisperTestPrivateTokenV1.json',
  publicTestTokenA: 'ChainWhisperTestPublicTokenV1.sol/ChainWhisperTestPublicTokenV1.json',
  publicTestTokenB: 'ChainWhisperTestPublicTokenV1.sol/ChainWhisperTestPublicTokenV1.json',
  recurringOtcV2: 'ChainWhisperRecurringOTCEscrowV2.sol/ChainWhisperRecurringOTCEscrowV2.json',
  standardOtcV2: 'ChainWhisperStandardOTCEscrowV2.sol/ChainWhisperStandardOTCEscrowV2.json'
} as const satisfies Record<keyof typeof TESTNET_COMPONENT_EVENT_POLICIES, string>;

const artifactRoot = resolve(
  process.cwd(),
  '..',
  'ChainWhisper Contracts',
  'artifacts',
  'contracts',
  'editable'
);

describe('V2 Worker event-classification parity', () => {
  it.each(Object.entries(artifacts))(
    'classifies every compiled %s event exactly once',
    (componentKey, artifactPath) => {
      const artifact = JSON.parse(readFileSync(resolve(artifactRoot, artifactPath), 'utf8')) as {
        abi: Array<{ type: string; name?: string }>;
      };
      const compiled = artifact.abi
        .filter(({ type }) => type === 'event')
        .map(({ name }) => name!)
        .sort();
      const policy = TESTNET_COMPONENT_EVENT_POLICIES[
        componentKey as keyof typeof TESTNET_COMPONENT_EVENT_POLICIES
      ].events;
      const classified = [
        ...policy.publicIndexable,
        ...policy.encryptedContentNotReturned,
        ...policy.participantEncryptedNotReturned,
        ...policy.catalogOnlyNotReturned
      ].sort();

      expect(classified).toEqual(compiled);
      expect(new Set(classified).size).toBe(classified.length);
    }
  );
});
