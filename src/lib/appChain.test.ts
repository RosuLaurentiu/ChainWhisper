import { describe, expect, it } from 'vitest';
import {
  OTC_READER_CONTRACT_ABI,
  OTC_HISTORY_READER_CONTRACT_ABI,
  OTC_HISTORY_READER_CONTRACT_ADDRESS,
  OTC_REGISTRY_CONTRACT_ABI,
  OTC_REGISTRY_CONTRACT_ADDRESS,
  PARTY_TRADE_ESCROW_CONTRACT_ABI,
  PARTY_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_ERC20_TOKEN_ABI,
  PRIVATE_ERC20_TOKEN_VNEXT_ABI,
  PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ABI,
  RECURRING_OTC_CONTRACT_ABI,
  RECURRING_OTC_CONTRACT_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  TRADE_ESCROW_CONTRACT_ABI,
  TRADE_ESCROW_CONTRACT_ADDRESS
} from './appShared/core';
import { loadCotiEthersModule } from './appShared';
import {
  __buildRecurringOrderSnapshotFromViewForTest,
  __resolveRecurringIdsFromPagedResultForTest,
  DEFAULT_TRADING_CONTRACT_ADDRESSES,
  isActiveTradeEscrowContractAddress,
  isOtcHistoryReaderConfigured,
  isOtcRegistryConfigured,
  isPartyTradeEscrowConfigured,
  resolvePrivateTokenAllowanceWritePlan,
  resolvePrivateTokenSpendReadiness,
  resolveTradingContractAddressesFromRegistryValue,
  resolveTradeEscrowContractConfig
} from './appChain';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;

describe('trade escrow contract resolution', () => {
  it('keeps the current V1 OTC and hidden-size private-order contracts active', () => {
    expect(resolveTradeEscrowContractConfig(TRADE_ESCROW_CONTRACT_ADDRESS)).toMatchObject({
      address: TRADE_ESCROW_CONTRACT_ADDRESS,
      hiddenOnly: false
    });
    expect(resolveTradeEscrowContractConfig(PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS)).toMatchObject({
      address: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
      hiddenOnly: true
    });
    expect(isActiveTradeEscrowContractAddress(TRADE_ESCROW_CONTRACT_ADDRESS)).toBe(true);
    expect(isActiveTradeEscrowContractAddress(PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS)).toBe(true);
    expect(isPartyTradeEscrowConfigured()).toBe(true);
    expect(isOtcRegistryConfigured()).toBe(true);
    expect(isOtcHistoryReaderConfigured()).toBe(true);
    expect(PARTY_TRADE_ESCROW_CONTRACT_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(OTC_REGISTRY_CONTRACT_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(OTC_HISTORY_READER_CONTRACT_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(DEFAULT_TRADING_CONTRACT_ADDRESSES.reader).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(isActiveTradeEscrowContractAddress(PARTY_TRADE_ESCROW_CONTRACT_ADDRESS)).toBe(true);
    expect(isActiveTradeEscrowContractAddress(RECURRING_OTC_CONTRACT_ADDRESS)).toBe(true);
  });

  it('resolves optional registry contract addresses over current app fallbacks', () => {
    const registryValue = {
      standardEscrow: '0x1000000000000000000000000000000000000001',
      privateEscrow: '0x1000000000000000000000000000000000000002',
      partyEscrow: '0x1000000000000000000000000000000000000003',
      recurringEscrow: '0x1000000000000000000000000000000000000004',
      reader: '0x1000000000000000000000000000000000000005',
      historyReader: '0x1000000000000000000000000000000000000006'
    };

    expect(resolveTradingContractAddressesFromRegistryValue(registryValue)).toEqual(registryValue);
    expect(
      resolveTradingContractAddressesFromRegistryValue({
        ...registryValue,
        partyEscrow: '',
        historyReader: ''
      })
    ).toMatchObject({
      ...registryValue,
      partyEscrow: DEFAULT_TRADING_CONTRACT_ADDRESSES.partyEscrow,
      historyReader: DEFAULT_TRADING_CONTRACT_ADDRESSES.historyReader
    });
  });

  it('rejects retired trading contract addresses instead of fetching them', () => {
    const retiredAddresses = [
      '0xe5CcCAB65059428BA42e9c595D95Fe51A1E2aFb0',
      '0xD46a62950572F0538A73DB0AD80B06C8f721D7A3',
      '0x6aE0650CFe1d83b9fE790F0c4C340bd26e1E7384',
      '0xbbE9c502299ef8081C04bE1b13469d288a0c2FED',
      '0xFeF8381440812FA1640e725B35e8fa718FBB97bC',
      '0x241bA885D399BFc2d64a688785B5466B813E5938',
      '0xB338D463F4929A15EC45406f7A5f9C655b5e8F88',
      '0xDF3E74B6CF0757fbCAC5bb7BE471F5C4b89717b9',
      '0x475AC7A9f2695847bDD668a4DDBB62e0A32Cbcf5',
      '0xa1E10077884116C1898465085cd97Bd33404BF83',
      '0x0d4A1083ca9C4adBcae02119Ad3b5190e5528e0a',
      '0x8dABEf29Bb7913561C643d80a8cA1b3bdf35A8E2',
      '0xa0514E6477082c0096830b7DBe4E39087b546183',
      '0xbF108a15E424351B5Fad9Dc99f8BeAbC1a53B584',
      '0x4539B020F40d8822d9C05778379530D4041cB5E9',
      '0x5B11D2e7333591Dce898776bDD2Bb92745B8dD58',
      '0xb8E895a5164878f1613df8659a3ee675CBF44D40',
      '0x93E2268285399204Cf8077aC78E27cFBfBd65caF',
      '0xAB9543CE3b98dB474b97794C165e0A4a225b9F4D'
    ];

    for (const retiredAddress of retiredAddresses) {
      expect(isActiveTradeEscrowContractAddress(retiredAddress)).toBe(false);
      expect(() => resolveTradeEscrowContractConfig(retiredAddress)).toThrow(
        'This trade link uses a retired contract and is not supported by the current app.'
      );
    }
  });

  it('keeps recurring V1 read fragments parseable by coti-ethers', async () => {
    const cotiEthers = await loadCotiEthersModule();
    const interfaceInstance = new cotiEthers.Interface(RECURRING_OTC_CONTRACT_ABI);

    expect(interfaceInstance.getFunction('getOrderView')?.selector).toBeTruthy();
    expect(interfaceInstance.getFunction('editOrder')?.selector).toBeTruthy();
    expect(interfaceInstance.getFunction('createRecurringOrderWithRecoveryNote')?.selector).toBeTruthy();
    expect(interfaceInstance.getFunction('createPrivateRecurringOrderWithRecoveryNote')?.selector).toBeTruthy();
    expect(interfaceInstance.getFunction('fillBuySideWithSecret')?.selector).toBeTruthy();
    expect(interfaceInstance.getFunction('fillSellSideWithSecret')?.selector).toBeTruthy();
    expect(interfaceInstance.getFunction('fillPrivateBuySideWithSecret')?.selector).toBeTruthy();
    expect(interfaceInstance.getFunction('fillPrivateSellSideWithSecret')?.selector).toBeTruthy();
    expect(interfaceInstance.getFunction('getOpenPublicOrderIds')?.selector).toBeTruthy();
    expect(interfaceInstance.getFunction('getOrderIdsForMaker')?.selector).toBeTruthy();
    expect(interfaceInstance.getFunction('getOrderIdsForTaker')?.selector).toBeTruthy();
    expect(interfaceInstance.getFunction('getOrderIdsForFiller')?.selector).toBeTruthy();
    expect(interfaceInstance.getFunction('getOpenPublicOrderIdsByPair')?.selector).toBeTruthy();
    expect(interfaceInstance.getFunction('getRecurringAccountSummary')?.selector).toBeTruthy();
    expect(interfaceInstance.getFunction('getRecurringRecoveryNote')?.selector).toBeTruthy();
    expect(interfaceInstance.getFunction('getRecurringAccountSnapshot')?.selector).toBeTruthy();
    expect(interfaceInstance.getFunction('offboardPrivateBaseInventoryForMaker')?.selector).toBeTruthy();
    expect(interfaceInstance.getFunction('offboardPrivateQuoteInventoryForMaker')?.selector).toBeTruthy();
    const recurringFunctionNames = new Set(
      interfaceInstance.fragments
        .filter((fragment) => fragment.type === 'function')
        .map((fragment) => ('name' in fragment ? String(fragment.name) : ''))
    );
    expect(recurringFunctionNames.has('fillBuySide')).toBe(false);
    expect(recurringFunctionNames.has('getOrderViews')).toBe(false);
    expect(recurringFunctionNames.has('refreshOrder')).toBe(false);
    expect(interfaceInstance.getEvent('PrivateRecurringFillReceipt')?.topicHash).toBe(
      '0xd4113a855e75fad2d85a4e6045b4dae6b4dc9a490be575c92fda5e0f6b39f8de'
    );
    expect(interfaceInstance.getEvent('PrivateRecurringInventorySnapshot')?.topicHash).toBe(
      '0xffd5606e6302b6683ef841983766644439aff043d1a49f4934eee3d9f166d050'
    );
    expect(interfaceInstance.getEvent('RecurringRecoveryNoteStored')?.topicHash).toBeTruthy();
  });

  it('keeps one-off V1 read fragments parseable by coti-ethers', async () => {
    const cotiEthers = await loadCotiEthersModule();
    const otcInterface = new cotiEthers.Interface(TRADE_ESCROW_CONTRACT_ABI);
    const privateOrdersInterface = new cotiEthers.Interface(PRIVATE_TRADE_ESCROW_CONTRACT_ABI);
    const partyInterface = new cotiEthers.Interface(PARTY_TRADE_ESCROW_CONTRACT_ABI);
    const readerInterface = new cotiEthers.Interface(OTC_READER_CONTRACT_ABI);
    const registryInterface = new cotiEthers.Interface(OTC_REGISTRY_CONTRACT_ABI);
    const historyReaderInterface = new cotiEthers.Interface(OTC_HISTORY_READER_CONTRACT_ABI);

    expect(otcInterface.getFunction('getTradeView')?.selector).toBeTruthy();
    expect(otcInterface.getFunction('getOpenPublicTradeIds')?.selector).toBeTruthy();
    expect(otcInterface.getFunction('getTradeIdsForMaker')?.selector).toBeTruthy();
    expect(otcInterface.getFunction('setTrustedPartyCounterEscrow')?.selector).toBeTruthy();
    expect(otcInterface.getFunction('closeParentTradeByPartyCounter')?.selector).toBeTruthy();
    expect(privateOrdersInterface.getFunction('getTradeView')?.selector).toBeTruthy();
    expect(privateOrdersInterface.getFunction('getTradeViews')?.selector).toBeTruthy();
    expect(privateOrdersInterface.getFunction('getOpenPublicTradeIds')?.selector).toBeTruthy();
    expect(privateOrdersInterface.getFunction('getPrivateOrderAccountSnapshot')?.selector).toBeTruthy();
    expect(privateOrdersInterface.getFunction('getPrivateOrderAccountSummary')?.selector).toBeTruthy();
    expect(privateOrdersInterface.getFunction('refreshTrade')?.selector).toBeTruthy();
    expect(privateOrdersInterface.getFunction('getMakerRecoveryNote')?.selector).toBeTruthy();
    expect(privateOrdersInterface.getEvent('MakerRecoveryNoteStored')?.topicHash).toBe(
      '0xcb0045cbf12c92e8cecabe18d67d46f6064e29445a9339cfc8cb22987deff433'
    );
    expect(privateOrdersInterface.getEvent('PrivateOrderFillReceipt')?.topicHash).toBe(
      '0xc542164fb3e3cfa7f44a4a32bb4648613c865891873e1c749d55c6f9a0c7d1e7'
    );
    expect(partyInterface.getFunction('createPartyTrade')?.selector).toBeTruthy();
    expect(partyInterface.getFunction('createPartyCounterTrade')?.selector).toBeTruthy();
    expect(partyInterface.getFunction('createPartyCounterTradeForParent')?.selector).toBeTruthy();
    expect(partyInterface.getFunction('getCounterTradeIdsForParent')?.selector).toBeTruthy();
    expect(partyInterface.getFunction('counterParentEscrow')?.selector).toBeTruthy();
    expect(partyInterface.getFunction('getPartyTermPayload')?.selector).toBeTruthy();
    expect(partyInterface.getFunction('acceptCounterTradeAndCloseParent')?.selector).toBeTruthy();
    expect(partyInterface.getEvent('PartyTradeOpened')?.topicHash).toBeTruthy();
    expect(readerInterface.getFunction('getPublicDeskPage')?.selector).toBeTruthy();
    expect(readerInterface.getFunction('getWalletDeskPage')?.selector).toBeTruthy();
    expect(readerInterface.getFunction('getWalletDeskPageV2')?.selector).toBeTruthy();
    expect(readerInterface.getFunction('getWalletActivityPage')?.selector).toBeTruthy();
    expect(readerInterface.getFunction('getTradeViews')?.selector).toBeTruthy();
    expect(readerInterface.getFunction('getOpenPublicTradeViews')?.selector).toBeTruthy();
    expect(readerInterface.getFunction('getOpenPublicTradeViewsByPair')?.selector).toBeTruthy();
    expect(readerInterface.getFunction('getTradeViewsForMaker')?.selector).toBeTruthy();
    expect(readerInterface.getFunction('getTradeViewsForTaker')?.selector).toBeTruthy();
    expect(readerInterface.getFunction('getTradeViewsForFiller')?.selector).toBeTruthy();
    expect(registryInterface.getFunction('getContracts')?.selector).toBeTruthy();
    expect(registryInterface.getFunction('setContracts')?.selector).toBeTruthy();
    expect(registryInterface.getEvent('ContractsUpdated')?.topicHash).toBeTruthy();
    expect(historyReaderInterface.getFunction('getWalletHistoryPage')?.selector).toBeTruthy();
    expect(historyReaderInterface.getFunction('getWalletHistoryPageFromContracts')?.selector).toBeTruthy();
  });

  it('keeps private ERC-20 approval and allowance fragments parseable by coti-ethers', async () => {
    const cotiEthers = await loadCotiEthersModule();
    const privateTokenInterface = new cotiEthers.Interface(PRIVATE_ERC20_TOKEN_ABI);

    expect(privateTokenInterface.getFunction('allowance(address,address)')?.selector).toBeTruthy();
    expect(privateTokenInterface.getFunction('accountEncryptionAddress')?.selector).toBeTruthy();
    expect(privateTokenInterface.getFunction('setAccountEncryptionAddress')?.selector).toBeTruthy();
    expect(privateTokenInterface.getFunction('approve')?.selector).toBeTruthy();
    expect(privateTokenInterface.getFunction('transfer')?.selector).toBeTruthy();
  });

  it('keeps latest PrivateERC20 uint256 fragments parseable for OTC Desk V1 cutover', async () => {
    const cotiEthers = await loadCotiEthersModule();
    const privateTokenInterface = new cotiEthers.Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI);

    expect(privateTokenInterface.getFunction('allowance(address,address)')?.selector).toBeTruthy();
    expect(privateTokenInterface.getFunction('reencryptAllowance')?.selector).toBeTruthy();
    expect(privateTokenInterface.getFunction('approve(address,uint256)')?.selector).toBeTruthy();
    expect(privateTokenInterface.getFunction('approveGT')?.selector).toBeTruthy();
    expect(privateTokenInterface.getFunction('transfer(address,uint256)')?.selector).toBeTruthy();
    expect(privateTokenInterface.getFunction('transferGT')?.selector).toBeTruthy();
    expect(privateTokenInterface.getFunction('transferFromGT')?.selector).toBeTruthy();
    expect(privateTokenInterface.getFunction('transferAndCall(address,uint256,bytes)')?.selector).toBeTruthy();
  });

  it('blocks private token fills when the wallet balance cannot be decrypted', () => {
    const readiness = resolvePrivateTokenSpendReadiness({
      requiredAmountWei: 5_000_000n,
      balanceWei: null,
      allowanceWei: 10_000_000n,
      tokenSymbol: 'Hotdog'
    });

    expect(readiness).toMatchObject({
      status: 'blocked',
      reason: 'balance-unavailable'
    });
    expect(readiness.status === 'blocked' ? readiness.message : '').toContain("this wallet's private Hotdog balance");
  });

  it('blocks private token fills when the decrypted balance is too low', () => {
    expect(
      resolvePrivateTokenSpendReadiness({
        requiredAmountWei: 5_000_000n,
        balanceWei: 4_999_999n,
        allowanceWei: 10_000_000n,
        tokenSymbol: 'Hotdog'
      })
    ).toMatchObject({
      status: 'blocked',
      reason: 'insufficient-balance'
    });
  });

  it('requires private token approval when allowance is missing or too low', () => {
    expect(
      resolvePrivateTokenSpendReadiness({
        requiredAmountWei: 5_000_000n,
        balanceWei: 10_000_000n,
        allowanceWei: null,
        tokenSymbol: 'Hotdog'
      })
    ).toMatchObject({
      status: 'needs-approval'
    });

    expect(
      resolvePrivateTokenSpendReadiness({
        requiredAmountWei: 5_000_000n,
        balanceWei: 10_000_000n,
        allowanceWei: 1_000_000n,
        tokenSymbol: 'Hotdog'
      })
    ).toMatchObject({
      status: 'needs-approval'
    });
  });

  it('plans safe private token allowance writes without approve-over-nonzero', () => {
    expect(resolvePrivateTokenAllowanceWritePlan(null)).toMatchObject({
      method: 'approve',
      amountWei: PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE,
      selectorSignature: 'approve(address,((uint256,uint256),bytes))'
    });
    expect(resolvePrivateTokenAllowanceWritePlan(0n)).toMatchObject({
      method: 'approve'
    });
    expect(resolvePrivateTokenAllowanceWritePlan(1_000_000n)).toMatchObject({
      method: 'increaseAllowance',
      amountWei: PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE - 1_000_000n,
      selectorSignature: 'increaseAllowance(address,((uint256,uint256),bytes))'
    });
  });

  it('blocks private token fills when approval cannot be confirmed after approval', () => {
    expect(
      resolvePrivateTokenSpendReadiness({
        requiredAmountWei: 5_000_000n,
        balanceWei: 10_000_000n,
        allowanceWei: null,
        tokenSymbol: 'Hotdog',
        afterApproval: true
      })
    ).toMatchObject({
      status: 'blocked',
      reason: 'allowance-unavailable-after-approval'
    });

    expect(
      resolvePrivateTokenSpendReadiness({
        requiredAmountWei: 5_000_000n,
        balanceWei: 10_000_000n,
        allowanceWei: 4_000_000n,
        tokenSymbol: 'Hotdog',
        afterApproval: true
      })
    ).toMatchObject({
      status: 'blocked',
      reason: 'insufficient-allowance-after-approval'
    });
  });

  it('normalizes recurring V1 order views into recurring trade snapshots', async () => {
    const snapshot = await __buildRecurringOrderSnapshotFromViewForTest(
      1,
      {
        order: {
          maker: '0xbf01185A70CDfEF1858659836D57BFf085ebed55',
          taker: ZERO_ADDRESS,
          status: 1,
          mode: 0,
          baseAsset: { assetType: 0, token: ZERO_ADDRESS },
          quoteAsset: { assetType: 1, token: REWARD_TOKEN_ADDRESS },
          buyTerms: { baseAmount: '1000000000000000000', quoteAmount: '2000000' },
          sellTerms: { baseAmount: '1000000000000000000', quoteAmount: '2500000' },
          isPublic: true,
          accessHash: ZERO_BYTES32,
          createdAt: 1_714_000_000,
          executionCount: 2,
          publicBaseInventory: '3000000000000000000',
          publicQuoteInventory: '4000000'
        },
        buySideOpen: true,
        sellSideOpen: true,
        hasPrivateBaseInventory: false,
        hasPrivateQuoteInventory: false
      },
      {
        rewardTokenSymbol: 'WISP',
        rewardTokenDecimals: 6,
        privateRewardTokenSymbol: 'pWISP',
        privateRewardTokenDecimals: 6
      }
    );

    expect(snapshot.escrowContract).toBe(RECURRING_OTC_CONTRACT_ADDRESS);
    expect(snapshot.status).toBe('open');
    expect(snapshot.isPublic).toBe(true);
    expect(snapshot.recurringOrder).toMatchObject({
      orderId: 1,
      mode: 'public',
      recurringStatus: 'active',
      buySideOpen: true,
      sellSideOpen: true,
      publicBaseInventory: '3000000000000000000',
      publicQuoteInventory: '4000000',
      executionCount: 2
    });
    expect(snapshot.recurringOrder?.baseAsset.symbol).toBe('COTI');
    expect(snapshot.recurringOrder?.quoteAsset.symbol).toBe('WISP');
  });

  it('normalizes recurring paged id reads from contract indexes', () => {
    expect(__resolveRecurringIdsFromPagedResultForTest([[1n, 2n, 0n], 0n])).toEqual([1, 2]);
    expect(__resolveRecurringIdsFromPagedResultForTest([[], 0n])).toEqual([]);
    expect(__resolveRecurringIdsFromPagedResultForTest(null)).toEqual([]);
  });
});
