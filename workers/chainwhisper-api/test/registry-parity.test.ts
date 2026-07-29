import { describe, expect, it } from 'vitest';
import {
  OTC_HISTORY_READER_CONTRACT_ADDRESS,
  OTC_READER_CONTRACT_ADDRESS,
  OTC_REGISTRY_CONTRACT_ADDRESS,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  RECURRING_OTC_CONTRACT_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  WISP_PRIVACY_BRIDGE_CONTRACT_ADDRESS
} from '../../../src/lib/appShared/contracts';
import { VERIFIED_ECOSYSTEM_TOKENS } from '../../../src/lib/appHelpers';
import { PRIVACY_TOKEN_PAIRS } from '../../../src/lib/privacyPortal';
import { CONTRACTS, PRIVACY_ROUTES, VERIFIED_ASSETS } from '../src/registry';

describe('Worker registry parity', () => {
  it('matches the app canonical trading contracts', () => {
    expect(CONTRACTS).toMatchObject({
      registry: OTC_REGISTRY_CONTRACT_ADDRESS,
      standardEscrow: TRADE_ESCROW_CONTRACT_ADDRESS,
      privateEscrow: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
      recurringEscrow: RECURRING_OTC_CONTRACT_ADDRESS,
      reader: OTC_READER_CONTRACT_ADDRESS,
      historyReader: OTC_HISTORY_READER_CONTRACT_ADDRESS
    });
  });

  it('matches every app-verified ERC20/private token plus WISP aliases', () => {
    const workerByAddress = new Map(
      VERIFIED_ASSETS
        .filter((asset) => asset.address)
        .map((asset) => [asset.address!.toLowerCase(), `${asset.kind}:${asset.symbol}`])
    );
    for (const token of VERIFIED_ECOSYSTEM_TOKENS) {
      expect(workerByAddress.get(token.address.toLowerCase())).toBe(`${token.kind}:${token.symbol}`);
    }
    expect(workerByAddress.get(REWARD_TOKEN_ADDRESS.toLowerCase())).toBe('erc20:WISP');
    expect(workerByAddress.get(PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase())).toBe('private-erc20:p.WISP');
  });

  it('matches all seven official bridges and the ChainWhisper WISP bridge', () => {
    const workerByBridge = new Map(
      PRIVACY_ROUTES.map((route) => [route.bridgeAddress.toLowerCase(), route])
    );
    for (const pair of PRIVACY_TOKEN_PAIRS) {
      expect(workerByBridge.get(pair.bridgeAddress.toLowerCase())).toMatchObject({
        id: pair.id,
        provider: 'coti'
      });
    }
    expect(workerByBridge.get(WISP_PRIVACY_BRIDGE_CONTRACT_ADDRESS.toLowerCase())).toMatchObject({
      id: 'wisp',
      provider: 'chainwhisper'
    });
    expect(PRIVACY_ROUTES).toHaveLength(8);
  });
});
