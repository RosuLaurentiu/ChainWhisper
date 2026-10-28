import { Interface, ZeroAddress, ZeroHash } from '@coti-io/coti-ethers';
import { expect, type Page } from '@playwright/test';
import * as contracts from '../../../src/lib/appShared/contracts';
// Mainnet-only fixture binding from appHelpers.ts. Keep browser runtime modules
// out of the Playwright runner; their active network comes from Vite.
const PRIVATE_COTI_TOKEN_ADDRESS = '0xD2F2692B83C3ecDF2EAa0f7c2632BBd46Ae1cC91';

const maker = '0xbf01185A70CDfEF1858659836D57BFf085ebed55';
const amount = (value: number) => BigInt(value) * 10n ** 18n;
const publicTokens = new Set([
  contracts.REWARD_TOKEN_ADDRESS,
  '0x7637C7838EC4Ec6b85080F28A678F8E234bB83D1',
  '0x659AD6d1F7353Df13Dec552cc05c9c15AfdD04e8'
].map(address => address.toLowerCase()));
const recurring = new Interface(contracts.RECURRING_OTC_CONTRACT_ABI);
const standard = new Interface(contracts.TRADE_ESCROW_CONTRACT_ABI);
const privateEscrow = new Interface(contracts.PRIVATE_TRADE_ESCROW_CONTRACT_ABI);
const direct = new Interface(contracts.DIRECT_TRADE_ESCROW_CONTRACT_ABI);
const registry = new Interface(contracts.OTC_REGISTRY_CONTRACT_ABI);
const token = new Interface(['function symbol() view returns(string)', 'function decimals() view returns(uint8)', 'function name() view returns(string)', 'function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)']);

// Select the synthetic public pair through the same link form available to a
// user. Returning to Offers clears the pin but keeps its selected pair.
export const openLegacyPublicOffers = async (page: Page, path = '/otc') => {
  await page.goto(path);
  const linkTool = page.locator('.p2p-offers-private-link-tool');
  await linkTool.locator('summary').click();
  await linkTool.getByLabel('Private trade link').fill('/otc/order/recurring/1');
  await linkTool.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.p2p-terminal-shell-recurring')).toBeVisible();
  await expect(page.locator('.p2p-terminal-shell-recurring')).toContainText('WISP');
  await expect(page.locator('.p2p-terminal-shell-recurring')).toContainText('COTI');
  await page.getByRole('navigation', { name: 'P2P trading views' }).getByRole('button', { name: 'Offers', exact: true }).click();
  await page.locator('[role="tab"]:visible').filter({ hasText: /^Buy$/ }).first().click();
  const offers = page.getByRole('region', { name: 'P2P offers', exact: true });
  await expect(offers.locator('.p2p-offer-rate-row').first()).toBeVisible();
  await expect(offers.locator('.p2p-offers-linked-note')).toHaveCount(0);
};

// Synthetic public observations on the named Mainnet UI lane. No transaction
// receipt or encrypted result is fabricated; all writes are refused.
export const installLegacyTradingReads = async (page: Page) => {
  await page.route('https://mainnet.coti.io/**', async route => {
    const payload = route.request().postDataJSON();
    const answer = (request: { id: number; method: string; params?: unknown[] }) => {
      const fail = (message: string) => ({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message } });
      let result: unknown;
      if (request.method === 'eth_chainId') result = '0x282b34';
      else if (request.method === 'eth_blockNumber') result = '0x989680';
      else if (request.method === 'eth_getBalance') result = '0x8ac7230489e80000';
      else if (request.method === 'eth_getLogs') result = [];
      else if (request.method === 'eth_getCode') result = '0x';
      else if (request.method === 'eth_call') {
        const call = request.params?.[0] as { to?: string; data?: string };
        const address = call.to?.toLowerCase();
        const abi = address === contracts.RECURRING_OTC_CONTRACT_ADDRESS.toLowerCase() ? recurring
          : address === contracts.OTC_REGISTRY_CONTRACT_ADDRESS.toLowerCase() ? registry
          : address === contracts.TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase() ? standard
          : address === contracts.PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase() ? privateEscrow
          : address === contracts.DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase() ? direct : token;
        const parsed = abi.parseTransaction({ data: call.data ?? '0x' });
        if (!parsed) return fail('Unbound fixture selector');
        const name = parsed.name;
        let values: unknown[];
        if (name === 'getContracts') values = [[contracts.TRADE_ESCROW_CONTRACT_ADDRESS, contracts.PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS, contracts.DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS, contracts.RECURRING_OTC_CONTRACT_ADDRESS, contracts.OTC_READER_CONTRACT_ADDRESS, contracts.OTC_HISTORY_READER_CONTRACT_ADDRESS]];
        else if (name === 'getOpenPublicOrderIds' || name === 'getOpenPublicOrderIdsByPair') values = [[1n, 4n], 2n];
        else if (name === 'getOrderIdsForMaker') values = [String(parsed.args[0]).toLowerCase() === maker.toLowerCase() ? [1n, 4n] : [], 0n];
        else if (name === 'getOrderIdsForTaker' || name === 'getOrderIdsForFiller') values = [[], 0n];
        else if (name === 'getOrderView') {
          const hidden = parsed.args[0] === 4n;
          const sameUnderlying = parsed.args[0] === 6n;
          const base = parsed.args[0] === 5n ? [1, '0x7637C7838EC4Ec6b85080F28A678F8E234bB83D1'] : hidden || sameUnderlying ? [2, contracts.PRIVATE_REWARD_TOKEN_ADDRESS] : [1, contracts.REWARD_TOKEN_ADDRESS];
          const quote = sameUnderlying ? [1, contracts.REWARD_TOKEN_ADDRESS] : hidden ? [2, PRIVATE_COTI_TOKEN_ADDRESS] : [0, ZeroAddress];
          values = [[[maker, ZeroAddress, 1, hidden || sameUnderlying ? 1 : 0, base, quote, [1000000n, sameUnderlying ? 1000000n : amount(1)], [1000000n, sameUnderlying ? 2000000n : amount(2)], true, ZeroHash, 1780000000, 0, hidden || sameUnderlying ? 0n : 5000000n, hidden || sameUnderlying ? 0n : amount(10)], true, true, hidden || sameUnderlying, hidden]];
        } else if (name === 'getOpenPublicTradeIds') values = [abi === standard ? [1n] : [], 0n];
        else if (name === 'getTradeIdsForMaker') values = [abi === standard && String(parsed.args[0]).toLowerCase() === maker.toLowerCase() ? [2n] : [], 0n];
        else if (/^getTradeIdsFor/.test(name)) values = [[], 0n];
        else if (name === 'nextTradeId') values = [abi === standard ? 2n : 0n];
        else if (name === 'getTradeView') values = [[[maker, ZeroAddress, parsed.args[0] === 2n ? 2 : 1, [1, contracts.REWARD_TOKEN_ADDRESS, 1000000n], [0, ZeroAddress, amount(1)], 1780000000, 0], [true, ZeroHash, 0, 0], parsed.args[0] === 2n ? [0, 0, 1000000n, amount(1)] : [1000000n, amount(1), 0, 0], [true, 0, 0, 0, false], parsed.args[0] === 2n ? 2 : 1, 0, 0, 1]];
        else if (name === 'feeAmount') values = [0n];
        else if (name === 'defaultMinPartialFillBps') values = [0];
        else if (name === 'symbol' || name === 'name') values = [address === contracts.REWARD_TOKEN_ADDRESS.toLowerCase() || address === contracts.PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase() ? 'WISP' : address === PRIVATE_COTI_TOKEN_ADDRESS.toLowerCase() ? 'pCOTI' : address === '0x7637c7838ec4ec6b85080f28a678f8e234bb83d1' ? 'gCOTI' : address === '0x659ad6d1f7353df13dec552cc05c9c15afdd04e8' ? 'Pengo' : 'Fixture token'];
        else if (name === 'decimals') values = [address === contracts.REWARD_TOKEN_ADDRESS.toLowerCase() || address === contracts.PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase() ? 6 : 18];
        else if (name === 'balanceOf' || name === 'allowance') {
          if (!address || !publicTokens.has(address)) return fail('No private balance or allowance is modeled by this fixture');
          values = [amount(10)];
        }
        else if (name === 'counterParentTradeId' || name === 'replacementTradeId' || name === 'replacesTradeId') values = [0];
        else if (name === 'counterParentEscrow') values = [ZeroAddress];
        else return fail(`Read ${name} is not bound by the local fixture`);
        result = abi.encodeFunctionResult(parsed.fragment, values);
      } else return fail(`RPC ${request.method} is not allowed by the local fixture`);
      return { jsonrpc: '2.0', id: request.id, result };
    };
    const safeAnswer = (request: Parameters<typeof answer>[0]) => {
      try {
        const response = answer(request);
        return response;
      }
      catch (error) {
        return { jsonrpc: '2.0', id: request.id, error: { code: -32000,
          message: `Unbound local fixture read: ${error instanceof Error ? error.message : String(error)}` } };
      }
    };
    await route.fulfill({ json: Array.isArray(payload) ? payload.map(safeAnswer) : safeAnswer(payload) });
  });
};



