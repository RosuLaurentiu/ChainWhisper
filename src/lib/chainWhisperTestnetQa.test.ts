import { describe, expect, it } from 'vitest';
import {
  CHAINWHISPER_TESTNET_QA_JOURNEYS,
  buildTestnetQaStorageKey,
  clearTestnetQaProgress,
  parseTestnetQaProgress,
  readTestnetQaProgress,
  toggleTestnetQaJourney,
  writeTestnetQaProgress
} from './chainWhisperTestnetQa';

const manifestHash = `0x${'12'.repeat(32)}`;

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  };
};

describe('chainWhisperTestnetQa', () => {
  it('defines unique, bounded manual journeys for the complete app candidate', () => {
    expect(CHAINWHISPER_TESTNET_QA_JOURNEYS).toHaveLength(17);
    expect(new Set(CHAINWHISPER_TESTNET_QA_JOURNEYS.map(({ id }) => id)).size).toBe(17);
    expect(new Set(CHAINWHISPER_TESTNET_QA_JOURNEYS.map(({ area }) => area))).toEqual(
      new Set(['Wallet', 'Chat', 'Trading', 'Integration', 'Recovery'])
    );
    expect(CHAINWHISPER_TESTNET_QA_JOURNEYS.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        'trade-history',
        'daily-price-demo',
        'daily-price-live',
        'public-api',
        'mcp-agent'
      ])
    );
  });

  it('fails closed on malformed, stale, or unknown persisted progress', () => {
    expect(parseTestnetQaProgress('{', manifestHash).completed).toEqual([]);
    expect(parseTestnetQaProgress(JSON.stringify({
      schemaVersion: 1,
      manifestHash: `0x${'34'.repeat(32)}`,
      completed: ['direct-chat']
    }), manifestHash).completed).toEqual([]);
    expect(parseTestnetQaProgress(JSON.stringify({
      schemaVersion: 1,
      manifestHash,
      completed: ['direct-chat', 'unknown', 'direct-chat']
    }), manifestHash).completed).toEqual(['direct-chat']);
  });

  it('stores only the candidate identity and known completed journey IDs', () => {
    const storage = memoryStorage();
    const progress = toggleTestnetQaJourney(
      toggleTestnetQaJourney(parseTestnetQaProgress(null, manifestHash), 'direct-chat', true),
      'private-swaps',
      true
    );
    writeTestnetQaProgress(storage, { ...progress, completed: [...progress.completed, 'unknown'] });

    const raw = storage.getItem(buildTestnetQaStorageKey(manifestHash));
    expect(raw).toBe(JSON.stringify({
      schemaVersion: 1,
      manifestHash,
      completed: ['direct-chat', 'private-swaps']
    }));
    expect(readTestnetQaProgress(storage, manifestHash).completed).toEqual(['direct-chat', 'private-swaps']);
  });

  it('can unmark and clear local progress without changing the candidate', () => {
    const storage = memoryStorage();
    const completed = toggleTestnetQaJourney(parseTestnetQaProgress(null, manifestHash), 'group-chat', true);
    const unmarked = toggleTestnetQaJourney(completed, 'group-chat', false);
    expect(unmarked).toEqual({ manifestHash, completed: [] });

    writeTestnetQaProgress(storage, completed);
    clearTestnetQaProgress(storage, manifestHash);
    expect(readTestnetQaProgress(storage, manifestHash)).toEqual({ manifestHash, completed: [] });
  });
});
