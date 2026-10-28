import { afterEach, describe, expect, it, vi } from 'vitest';

const address = (suffix: string) => `0x${suffix.padStart(40, '0')}`;

describe('ChainWhisper testnet trading catalog', () => {
  afterEach(() => {
    vi.doUnmock('./chainWhisperTestnetCandidate');
    vi.doUnmock('./currentP2PBinding');
    vi.resetModules();
  });

  it('uses the four attested candidate tokens before registered P2P activation', async () => {
    vi.resetModules();
    vi.doMock('./currentP2PBinding', () => ({
      CURRENT_P2P_BINDING: Object.freeze({ repairQualification: undefined }),
      isCurrentP2PFinancialScopeQualified: () => false
    }));
    vi.doMock('./chainWhisperTestnetCandidate', () => ({
      CHAINWHISPER_TESTNET_CANDIDATE_CONFIG: Object.freeze({
        status: 'active',
        components: Object.freeze({
          publicTestTokenA: Object.freeze({ address: address('11') }),
          publicTestTokenB: Object.freeze({ address: address('12') }),
          privateTestTokenA: Object.freeze({ address: address('13') }),
          privateTestTokenB: Object.freeze({ address: address('14') })
        })
      })
    }));

    const catalog = await import('./appHelpers');

    expect(catalog.USING_CHAINWHISPER_TESTNET_CANDIDATE_TOKENS).toBe(true);
    expect(catalog.VERIFIED_ECOSYSTEM_TOKENS).toEqual([
      { address: address('11'), kind: 'erc20', symbol: 'cwTUB' },
      { address: address('12'), kind: 'erc20', symbol: 'cwTUQ' },
      { address: address('13'), kind: 'private-erc20', symbol: 'cwTPB' },
      { address: address('14'), kind: 'private-erc20', symbol: 'cwTPQ' }
    ]);
    expect(catalog.TESTNET_CANDIDATE_TRADE_TOKEN_SELECTIONS).toEqual({
      publicBase: address('11'),
      publicQuote: address('12'),
      privateBase: address('13'),
      privateQuote: address('14')
    });
    expect(catalog.buildPublicTradeTokenSymbolOrder('WISP')).toEqual(['cwTUB', 'cwTUQ']);
    expect(catalog.buildPrivateTradeTokenSymbolOrder('p.WISP')).toEqual(['cwTPB', 'cwTPQ']);
  });
});
