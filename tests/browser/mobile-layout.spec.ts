import { expect, test, type Page } from '@playwright/test';

const mobileViewport = { width: 390, height: 844 };

const expectNoHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(4);
};

const scrollTradeShellToBottom = async (page: Page) => {
  await page.locator('.standalone-trades-shell').evaluate((shell) => {
    shell.scrollTop = shell.scrollHeight;
  });
};

const expectAboveTradeTabs = async (page: Page, selector: string) => {
  const targetBox = await page.locator(selector).boundingBox();
  const tabsBox = await page.getByRole('navigation', { name: 'P2P trade views' }).boundingBox();
  expect(targetBox).not.toBeNull();
  expect(tabsBox).not.toBeNull();
  expect(targetBox!.y + targetBox!.height).toBeLessThanOrEqual(tabsBox!.y - 4);
};

const parseLeadingPrice = (value: string | null) => {
  const match = value?.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
};

test.describe('mobile layout polish', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(mobileViewport);
  });

  test('keeps the chat wallet header compact on mobile', async ({ page }) => {
    await page.goto('/chat');

    await expect(page.locator('.top-header-mobile-wallet .wallet-header-panel')).toBeVisible();
    await expect(page.getByRole('button', { name: /Generate app wallet|Connect app wallet|Wallet unavailable/i })).toBeVisible();
    await page.locator('.top-header-mobile-wallet').getByRole('button', { name: /^Open Wallet menu$/ }).click();
    await expect(page.getByRole('menuitem', { name: /^Open MetaMask Mobile$/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /MetaMask or CipherTrade not detected/i })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /^No saved app wallet$/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /^Generate wallet$/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('keeps P2P tabs and wallet controls usable on mobile', async ({ page }) => {
    await page.goto('/trades');

    await expect(page.locator('.top-header-mobile-wallet .wallet-header-panel')).toBeVisible();
    await expect(page.locator('.top-header-mobile-wallet').getByRole('button', { name: /^Open MetaMask$/ })).toBeVisible();
    await page.locator('.top-header-mobile-wallet').getByRole('button', { name: /^Open Wallet menu$/ }).click();
    await expect(page.getByRole('menuitem', { name: /^Open MetaMask Mobile$/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /MetaMask or CipherTrade not detected/i })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /^No saved app wallet$/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /^Generate wallet$/ })).toBeVisible();
    await page.locator('.top-header-mobile-wallet').getByRole('button', { name: /^Close Wallet menu$/ }).click();
    const appMenu = page.getByRole('navigation', { name: 'ChainWhisper apps' });
    await expect(appMenu).toBeHidden();
    await page.getByRole('button', { name: 'Show app menu' }).click();
    await expect(appMenu).toBeVisible();
    await page.getByRole('button', { name: 'Hide app menu' }).click();
    await expect(appMenu).toBeHidden();

    const tradeTabs = page.getByRole('navigation', { name: 'P2P trade views' });
    await expect(tradeTabs).toBeVisible();
    await expect(tradeTabs.getByRole('button', { name: 'Desk' })).toBeVisible();
    await expect(tradeTabs.getByRole('button', { name: 'Create' })).toBeVisible();
    await expect(tradeTabs.getByRole('button', { name: 'Terminal', exact: true })).toBeVisible();
    await expect(tradeTabs.getByRole('button', { name: 'My Trades', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('opens the mobile trading terminal as focused page content', async ({ page }) => {
    await page.goto('/trades/open');

    const terminal = page.locator('.standalone-trade-detail-section');
    await expect(terminal).toBeVisible();
    await expect(terminal.locator('.landing-eyebrow', { hasText: /^Trading Terminal$/ })).toBeVisible();
    await expect(page.locator('.p2p-market-overview')).toBeHidden();
    await expect(page.locator('.p2p-public-trades-section')).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'P2P trade views' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('keeps mobile trade creation actions reachable without eager field errors', async ({ page }) => {
    await page.goto('/trades/create');

    const sendAmountError = page.getByText(/Enter a valid .+ amount to send\./);
    await expect(sendAmountError).toHaveCount(0);
    await page.getByRole('button', { name: 'Create Offer' }).click({ force: true });
    await expect(sendAmountError).toBeVisible();

    await scrollTradeShellToBottom(page);
    await expect(page.getByRole('button', { name: 'Create Offer' })).toBeVisible();
    await expectAboveTradeTabs(page, '.trade-compose-footer');
    await expectNoHorizontalOverflow(page);
  });

  test('keeps recurring order submit controls reachable on mobile', async ({ page }) => {
    await page.goto('/trades/create');
    await page.getByRole('button', { name: /Recurring/ }).click();

    await scrollTradeShellToBottom(page);
    await expect(page.getByRole('button', { name: 'Create Recurring Order' })).toBeVisible();
    await expectAboveTradeTabs(page, '.p2p-recurring-actions');
    await expectNoHorizontalOverflow(page);
  });

  test('opens mobile terminal history as a closeable sheet', async ({ page }) => {
    await page.goto('/trades/recurring?order=1');

    const terminal = page.locator('.p2p-terminal-shell-recurring');
    await expect(terminal).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.p2p-terminal-history-window')).toBeHidden();
    await terminal.locator('.p2p-terminal-mobile-history-trigger').click();
    const sheet = page.locator('.p2p-terminal-history-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.p2p-terminal-history-sheet-head')).toContainText('Your history');
    await expect(sheet.getByRole('button', { name: 'Close' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
  });

  test('keeps mobile trade controls usable across token, access, and terminal states', async ({ page }) => {
    await page.goto('/trades/create');

    await page.locator('.trade-token-select-trigger').first().click();
    await expect(page.locator('.trade-token-select-dropdown')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.mouse.click(5, 5);
    await page.getByRole('button', { name: /^Direct$/ }).click();
    await expect(page.locator('.p2p-direct-recipient')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: /^Private Link$/ }).click();
    await expect(page.getByText('Shared link required to accept')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto('/trades/open');
    await expect(page.getByPlaceholder('Paste offer link, compact code, or id')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Terminal' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('keeps Treasury controls reachable on mobile', async ({ page }) => {
    await page.goto('/treasury');

    await expect(page.locator('.top-header-brand-subtitle', { hasText: /^Treasury$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'COTI in pool', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Active gCOTI', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '90D' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('trading responsive layout', () => {
  for (const route of ['/trades', '/trades/create', '/trades/open', '/trades/mine']) {
    test(`keeps ${route} free of horizontal overflow on desktop and mobile`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 950 });
      await page.goto(route);
      await expectNoHorizontalOverflow(page);

      await page.setViewportSize(mobileViewport);
      await page.goto(route);
      await expectNoHorizontalOverflow(page);
    });
  }

  test('keeps desk order cards symmetrical and action-ready across order types', async ({ page }) => {
    await page.setViewportSize({ width: 2016, height: 980 });
    await page.goto('/trades');

    const desk = page.locator('.p2p-public-trade-grid');
    const oneOffCard = desk.locator('.p2p-offer-card').first();
    const recurringCard = desk.locator('.p2p-recurring-order-card').first();

    await expect(oneOffCard).toBeVisible();
    await expect(recurringCard).toBeVisible();
    for (const card of [oneOffCard, recurringCard]) {
      await expect(card.locator('.p2p-order-market-panel')).toBeVisible();
      await expect(card.locator('.p2p-order-detail-band')).toBeVisible();
      await expect(card.locator('.p2p-order-title-row .p2p-order-id')).toHaveCount(0);
      await expect(card.locator('.p2p-order-title-row .p2p-offer-status')).toHaveCount(0);
      await expect(card.locator('.p2p-order-subline .p2p-order-id')).toBeVisible();
      await expect(card.locator('.p2p-order-subline .p2p-offer-status')).toBeVisible();
      await expect(card.locator('.p2p-order-subline').first()).toBeVisible();
      await expect(card.locator('.p2p-order-tag-stack .p2p-order-subline')).toHaveCount(2);
      await expect(card.locator('.p2p-order-token-actions')).toBeVisible();
      await expect(card.locator('.p2p-order-card-footer')).toBeVisible();
      await expect(card.locator('.p2p-order-card-footer').getByRole('button').first()).toBeVisible();
    }

    await expect(desk.locator('.p2p-order-muted-slot').filter({ hasText: /Private amount|Private|None/ }).first()).toBeVisible();
    await expect(oneOffCard.locator('.p2p-order-subline .p2p-order-id')).toContainText(/^Offer #\d+$/);
    await expect(recurringCard.locator('.p2p-order-subline .p2p-order-id')).toContainText(/^Order #\d+$/);
    await expect(desk.getByRole('button', { name: /Share/ }).first()).toBeVisible();
    await expect(desk.getByText('Public offer')).toHaveCount(0);
    await expect(recurringCard.locator('h3')).not.toContainText('buy/sell desk');
    await expect(page.locator('.p2p-public-trade-grid')).not.toContainText('buy/sell desk');
    await expect(recurringCard.getByText('Both sides live')).toHaveCount(0);
    await expect(desk.getByRole('button', { name: /Reveal history/ })).toHaveCount(0);
    await expect(oneOffCard.locator('.p2p-expiry-chip')).toBeVisible();
    const expiryTitle = await oneOffCard.locator('.p2p-expiry-chip').getAttribute('title');
    expect(expiryTitle?.length ?? 0).toBeGreaterThan(8);
    await expect(recurringCard.locator('.p2p-order-chip', { hasText: 'Private liquidity' })).toHaveCount(1);
    await expect(oneOffCard.locator('.p2p-order-chip', { hasText: 'Private liquidity' })).toHaveCount(1);
    const makerCard = desk.locator('.p2p-order-card').filter({ has: page.locator('.p2p-offer-manage-btn') }).first();
    if (await makerCard.count()) {
      const makerChip = makerCard.locator('.p2p-order-subline .p2p-order-chip-owner').first();
      await expect(makerChip).toHaveText('Maker');
      await expect(makerChip).toHaveAttribute('title', 'Created by you');
      await expect(makerCard.locator('.p2p-order-card-footer > span', { hasText: /Created by you|Maker/ })).toHaveCount(0);
    }
    await expect(desk.locator('.p2p-offer-term span', { hasText: 'Buyer pays' })).toHaveCount(0);
    const publicLiquidityOneOff = desk
      .locator('.p2p-offer-card')
      .filter({ has: page.locator('.p2p-order-liquidity-summary') })
      .first();
    await expect(publicLiquidityOneOff.locator('.p2p-order-liquidity-summary')).toBeVisible();
    await expect(publicLiquidityOneOff.locator('.p2p-order-liquidity-summary')).toContainText(/You buy|You sell/);
    await expect(publicLiquidityOneOff.locator('.p2p-order-liquidity-summary')).not.toContainText(/Seller sells|Buyer pays/);
    await expect(publicLiquidityOneOff.locator('.p2p-order-liquidity-summary')).toContainText(/total|available|order value/);
    await expect(publicLiquidityOneOff.locator('.p2p-order-liquidity-summary')).toContainText(/sold|bought|No fills yet/);
    await expect(publicLiquidityOneOff.locator('.p2p-order-liquidity-summary')).toContainText(/available|remaining|Open liquidity|No fill recorded/);
    await expect(publicLiquidityOneOff.locator('.p2p-offer-terms')).toHaveCount(0);
    await expect(desk.locator('.p2p-order-market-panel').getByText('Price desk')).toHaveCount(0);
    await expect(recurringCard.locator('.p2p-recurring-price-card-head')).toContainText('Price ratio');
    await expect(recurringCard.locator('.p2p-recurring-price-basis')).toHaveCount(0);
    await expect(oneOffCard.locator('.p2p-order-market-panel small')).toHaveCount(0);
    await expect(oneOffCard.locator('.p2p-order-market-panel')).not.toContainText(/Private amounts|Visible terms|Remaining terms/);
    const priceRatioLabelStyles = await Promise.all([
      oneOffCard.locator('.p2p-order-market-panel > span').first().evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          color: style.color,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          letterSpacing: style.letterSpacing,
          textTransform: style.textTransform
        };
      }),
      recurringCard.locator('.p2p-recurring-price-card-head > span').first().evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          color: style.color,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          letterSpacing: style.letterSpacing,
          textTransform: style.textTransform
        };
      })
    ]);
    expect(priceRatioLabelStyles[1]).toEqual(priceRatioLabelStyles[0]);
    const tagLineSpread = await oneOffCard.locator('.p2p-order-subline').first().evaluate((line) => {
      const itemTops = Array.from(line.children).map((child) => Math.round(child.getBoundingClientRect().top));
      return Math.max(...itemTops) - Math.min(...itemTops);
    });
    expect(tagLineSpread).toBeLessThanOrEqual(2);
    const recurringWithExecutions = desk.locator('.p2p-recurring-order-card').filter({ hasText: /executions/i }).first();
    if (await recurringWithExecutions.count()) {
      await expect(recurringWithExecutions.locator('.p2p-order-chip', { hasText: /executions/i })).toHaveCount(0);
      await expect(recurringWithExecutions.locator('.p2p-recurring-inventory-strip').getByText(/Executions/i)).toBeVisible();
    }

    const firstCardTopGap = await page.locator('.p2p-public-trades-section').evaluate((section) => {
      const header = section.querySelector('.standalone-trades-section-head');
      const firstCard = section.querySelector('.p2p-order-card');
      const headerBox = header?.getBoundingClientRect();
      const cardBox = firstCard?.getBoundingClientRect();
      return headerBox && cardBox ? cardBox.top - headerBox.bottom : 0;
    });
    expect(firstCardTopGap).toBeLessThanOrEqual(28);

    const primaryButtonMetrics = await oneOffCard.locator('.p2p-offer-open-btn').evaluate((button) => {
      const buttonBox = button.getBoundingClientRect();
      const assetWidths = Array.from(button.querySelectorAll('.p2p-action-asset')).map((asset) =>
        asset.getBoundingClientRect().width
      );
      return {
        buttonWidth: buttonBox.width,
        minAssetWidth: Math.min(...assetWidths),
        text: button.textContent?.trim() ?? ''
      };
    });
    expect(primaryButtonMetrics.text.length).toBeGreaterThan(4);
    expect(primaryButtonMetrics.buttonWidth).toBeGreaterThan(120);
    expect(primaryButtonMetrics.minAssetWidth).toBeGreaterThan(30);

    const largestTokenFooterGap = await desk.locator('.p2p-order-card').evaluateAll((cards) =>
      Math.max(
        ...cards.map((card) => {
          const token = card.querySelector('.p2p-order-token-actions');
          const footer = card.querySelector('.p2p-order-card-footer');
          const tokenBox = token?.getBoundingClientRect();
          const footerBox = footer?.getBoundingClientRect();
          return tokenBox && footerBox ? footerBox.top - tokenBox.bottom : 0;
        })
      )
    );
    expect(largestTokenFooterGap).toBeLessThanOrEqual(24);

    const rowAlignment = await desk.locator('.p2p-order-card').evaluateAll((cards) => {
      const firstRowCards = cards
        .map((card) => {
          const cardTop = card.getBoundingClientRect().top;
          const marketTop = card.querySelector('.p2p-order-market-panel')?.getBoundingClientRect().top ?? 0;
          const detailTop = card.querySelector('.p2p-order-detail-band')?.getBoundingClientRect().top ?? 0;
          const tokenTop = card.querySelector('.p2p-order-token-actions')?.getBoundingClientRect().top ?? 0;
          return { cardTop, marketTop, detailTop, tokenTop };
        })
        .filter((entry) => entry.marketTop > 0);
      const top = Math.min(...firstRowCards.map((entry) => entry.cardTop));
      const rowCards = firstRowCards.filter((entry) => Math.abs(entry.cardTop - top) <= 4);
      const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
      return {
        market: spread(rowCards.map((entry) => entry.marketTop)),
        detail: spread(rowCards.map((entry) => entry.detailTop)),
        token: spread(rowCards.map((entry) => entry.tokenTop))
      };
    });
    expect(rowAlignment.market).toBeLessThanOrEqual(2);
    expect(rowAlignment.detail).toBeLessThanOrEqual(2);
    expect(rowAlignment.token).toBeLessThanOrEqual(2);

    const manageButton = desk.getByRole('button', { name: /Manage/ }).first();
    if (await manageButton.count()) {
      await expect(manageButton).toBeVisible();
      await manageButton.click();
      await expect(page.locator('.p2p-terminal-shell')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.p2p-public-trade-grid .p2p-maker-inline-actions')).toHaveCount(0);
    }

    const oneOffPriceBefore = await oneOffCard.locator('.p2p-order-market-panel strong').textContent();
    await oneOffCard.locator('.p2p-order-market-panel').click();
    await expect(oneOffCard.locator('.p2p-order-market-panel strong')).not.toHaveText(oneOffPriceBefore ?? '');

    const buyLabelBefore = await recurringCard.locator('.p2p-recurring-price-buy span').textContent();
    const sellLabelBefore = await recurringCard.locator('.p2p-recurring-price-sell span').textContent();
    const buyPriceBefore = await recurringCard.locator('.p2p-recurring-price-buy strong').textContent();
    const sellPriceBefore = await recurringCard.locator('.p2p-recurring-price-sell strong').textContent();
    expect(parseLeadingPrice(buyPriceBefore)).toBeLessThanOrEqual(parseLeadingPrice(sellPriceBefore));
    await recurringCard.locator('.p2p-recurring-price-card').click();
    await expect(recurringCard.locator('.p2p-recurring-price-buy span')).not.toHaveText(buyLabelBefore ?? '');
    await expect(recurringCard.locator('.p2p-recurring-price-sell span')).not.toHaveText(sellLabelBefore ?? '');
    await expect(recurringCard.locator('.p2p-recurring-price-buy strong')).not.toHaveText(buyPriceBefore ?? '');
    await expect(recurringCard.locator('.p2p-recurring-price-sell strong')).not.toHaveText(sellPriceBefore ?? '');
    const buyPriceAfter = await recurringCard.locator('.p2p-recurring-price-buy strong').textContent();
    const sellPriceAfter = await recurringCard.locator('.p2p-recurring-price-sell strong').textContent();
    expect(parseLeadingPrice(buyPriceAfter)).toBeLessThanOrEqual(parseLeadingPrice(sellPriceAfter));

    const footerSpread = await desk.locator('.p2p-order-card').evaluateAll((cards) => {
      const firstRowCards = cards
        .map((card) => {
          const cardBox = card.getBoundingClientRect();
          const footer = card.querySelector('.p2p-order-card-footer');
          const footerBox = footer?.getBoundingClientRect();
          return footerBox ? { cardTop: cardBox.top, footerTop: footerBox.top } : null;
        })
        .filter((entry): entry is { cardTop: number; footerTop: number } => Boolean(entry));
      const top = Math.min(...firstRowCards.map((entry) => entry.cardTop));
      const rowFooterTops = firstRowCards
        .filter((entry) => Math.abs(entry.cardTop - top) <= 4)
        .map((entry) => entry.footerTop);
      return Math.max(...rowFooterTops) - Math.min(...rowFooterTops);
    });
    expect(footerSpread).toBeLessThanOrEqual(18);
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize(mobileViewport);
    await page.goto('/trades');
    await expect(page.locator('.p2p-public-trade-grid .p2p-order-card').first()).toBeVisible();
    await expect(page.locator('.p2p-public-trade-grid .p2p-order-token-actions').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('renders unified terminal shell with separate history window on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto('/trades');

    const oneOffOpenButton = page
      .locator('.p2p-public-trade-grid .p2p-order-card:not(.p2p-recurring-order-card) .p2p-offer-open-btn')
      .first();
    await expect(oneOffOpenButton).toBeVisible();
    await oneOffOpenButton.click();

    const terminal = page.locator('.p2p-terminal-shell-standard');
    const history = page.locator('.p2p-terminal-history-window');
    await expect(terminal).toBeVisible({ timeout: 30_000 });
    await expect(terminal.locator('.p2p-terminal-main')).toBeVisible();
    await expect(terminal.locator('.p2p-terminal-history-desktop')).toHaveCount(0);
    const standardHeaderTags = terminal.locator('.p2p-terminal-head .p2p-terminal-tag-row');
    await expect(standardHeaderTags).toContainText(/Offer #\d+/);
    await expect(standardHeaderTags.locator('.p2p-offer-status')).toBeVisible();
    await expect(terminal.locator('.p2p-terminal-head p')).toHaveCount(0);
    await expect(terminal.locator('.p2p-terminal-stat-grid')).not.toContainText('Remaining');
    await expect(terminal.locator('.p2p-terminal-stat-grid')).not.toContainText('Expires');
    await expect(terminal.locator('.p2p-terminal-flow')).toContainText('You sell');
    await expect(terminal.locator('.p2p-terminal-flow')).toContainText('You buy');
    await expect(terminal.locator('.p2p-terminal-flow')).not.toContainText(/Seller sells|Buyer pays/);
    await expect(history).toBeVisible();
    await expect(history.locator('.p2p-terminal-history-head')).toContainText('Your history');
    await expect(history).toContainText('Created');
    await expect(history).toContainText(/Offer #\d+ opened/);
    const historyRows = history.locator('.p2p-terminal-history-row');
    const historyCount = Number((await history.locator('.p2p-terminal-history-head > span').last().textContent()) ?? '0');
    expect(historyCount).toBe(await historyRows.count());
    const historyHeadStyle = await history.locator('.p2p-terminal-history-head').evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        backgroundImage: style.backgroundImage,
        boxShadow: style.boxShadow,
        marginTop: style.marginTop,
        position: style.position
      };
    });
    expect(historyHeadStyle.position).toBe('sticky');
    expect(historyHeadStyle.backgroundImage).not.toBe('none');
    expect(historyHeadStyle.boxShadow).not.toBe('none');
    expect(historyHeadStyle.marginTop).toBe('0px');
    const historyHeadMetrics = await history.locator('.p2p-terminal-history-head').evaluate((head) => {
      const box = head.getBoundingClientRect();
      const titleBlock = head.querySelector('div');
      const titleStyle = titleBlock ? window.getComputedStyle(titleBlock) : null;
      return {
        display: titleStyle?.display,
        height: box.height
      };
    });
    expect(historyHeadMetrics.display).toBe('flex');
    expect(historyHeadMetrics.height).toBeLessThanOrEqual(36);
    if (await historyRows.count()) {
      const rowMetrics = await historyRows.first().evaluate((row) => {
        const box = row.getBoundingClientRect();
        const firstCell = row.querySelector('div');
        const firstCellStyle = firstCell ? window.getComputedStyle(firstCell) : null;
        return {
          borderTopWidth: firstCellStyle?.borderTopWidth,
          height: box.height
        };
      });
      expect(rowMetrics.height).toBeLessThanOrEqual(54);
      expect(rowMetrics.borderTopWidth).toBe('0px');
    }
    const sellAmountInput = terminal.locator('.p2p-terminal-input-field', { hasText: /You sell/i }).locator('input');
    const buyAmountInput = terminal.locator('.p2p-terminal-input-field', { hasText: /You buy/i }).locator('input');
    await expect(sellAmountInput).toBeVisible();
    await expect(buyAmountInput).toBeVisible();
    await expect(terminal.getByText('Order limit')).toHaveCount(0);
    await expect(terminal.locator('.p2p-terminal-primary-action')).toBeVisible();
    await sellAmountInput.fill('1');
    await expect(buyAmountInput).not.toHaveValue('');
    await buyAmountInput.fill('1');
    await expect(sellAmountInput).not.toHaveValue('');

    const marketBox = await terminal.locator('.p2p-terminal-market').boundingBox();
    const ticketBox = await terminal.locator('.p2p-terminal-ticket').boundingBox();
    const terminalPaneBox = await page.locator('.standalone-trade-detail-section').boundingBox();
    const deskBox = await page.locator('.p2p-public-trades-section').boundingBox();
    const shellBox = await page.locator('.p2p-trading-shell-drawer-open').boundingBox();
    const historyBox = await history.boundingBox();
    const viewport = page.viewportSize();
    expect(marketBox).not.toBeNull();
    expect(ticketBox).not.toBeNull();
    expect(terminalPaneBox).not.toBeNull();
    expect(deskBox).not.toBeNull();
    expect(shellBox).not.toBeNull();
    expect(historyBox).not.toBeNull();
    expect(ticketBox!.y).toBeGreaterThan(marketBox!.y + marketBox!.height - 2);
    expect(historyBox!.y).toBeGreaterThanOrEqual(deskBox!.y + deskBox!.height - 2);
    expect(historyBox!.y).toBeGreaterThanOrEqual(terminalPaneBox!.y + terminalPaneBox!.height - 2);
    expect(historyBox!.x).toBeLessThanOrEqual(shellBox!.x + 20);
    expect(historyBox!.width).toBeGreaterThan(shellBox!.width - 40);
    expect(deskBox!.y + deskBox!.height).toBeLessThanOrEqual(historyBox!.y + 2);
    expect(terminalPaneBox!.y + terminalPaneBox!.height).toBeLessThanOrEqual(historyBox!.y + 2);
    expect(historyBox!.y + historyBox!.height).toBeLessThanOrEqual((viewport?.height ?? 950) + 1);

    const scrollState = await page.evaluate(() => {
      const read = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) {
          return null;
        }
        const style = window.getComputedStyle(element);
        return {
          overflowY: style.overflowY,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        };
      };

      return {
        shell: read('.p2p-trading-shell-drawer-open'),
        desk: read('.p2p-public-trades-section'),
        terminal: read('.standalone-trade-detail-section'),
        history: read('.p2p-terminal-history-window'),
      };
    });
    expect(scrollState.shell?.overflowY).toBe('hidden');
    expect(['auto', 'scroll']).toContain(scrollState.desk?.overflowY);
    expect(['auto', 'scroll']).toContain(scrollState.terminal?.overflowY);
    expect(['auto', 'scroll']).toContain(scrollState.history?.overflowY);
    expect(scrollState.desk!.clientHeight).toBeLessThanOrEqual(scrollState.desk!.scrollHeight);
    expect(scrollState.terminal!.clientHeight).toBeLessThanOrEqual(scrollState.terminal!.scrollHeight);
    expect(scrollState.history!.clientHeight).toBeLessThanOrEqual(scrollState.history!.scrollHeight);
    await expectNoHorizontalOverflow(page);
  });

  test('shows private history reveal from the terminal history window', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto('/trades');

    const privateCard = page
      .locator('.p2p-public-trade-grid .p2p-order-card')
      .filter({ hasText: 'Private liquidity' })
      .first();
    test.skip((await privateCard.count()) === 0, 'No private-liquidity sample card available.');

    const openControl = privateCard.locator('.p2p-offer-open-btn, .p2p-offer-manage-btn').first();
    test.skip((await openControl.count()) === 0, 'Private-liquidity sample card has no terminal action.');
    await openControl.click();

    const history = page.locator('.p2p-terminal-history-window');
    await expect(history).toBeVisible({ timeout: 30_000 });
    await expect(history.locator('.p2p-terminal-history-head').getByRole('button', { name: /Reveal.*history/i })).toBeVisible();
    await expect(history.locator('.p2p-terminal-history-empty').getByRole('button', { name: /Reveal.*history/i })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test('keeps trading filters compact and recurring terminal liquidity status scannable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto('/trades');

    const overviewBox = await page.locator('.p2p-market-overview').boundingBox();
    expect(overviewBox).not.toBeNull();
    expect(overviewBox!.height).toBeLessThanOrEqual(112);

    const scrollStyle = await page.locator('.p2p-public-trades-section').evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        scrollbarColor: style.scrollbarColor,
        scrollbarWidth: style.scrollbarWidth,
      };
    });
    expect(scrollStyle.scrollbarWidth).toBe('thin');
    expect(scrollStyle.scrollbarColor).toContain('139');

    await page.goto('/trades/mine');
    const mineOverviewBox = await page.locator('.p2p-market-overview').boundingBox();
    expect(mineOverviewBox).not.toBeNull();
    expect(mineOverviewBox!.height).toBeLessThanOrEqual(120);

    await page.goto('/trades/recurring?order=1');
    const terminal = page.locator('.p2p-terminal-shell-recurring');
    await expect(terminal).toBeVisible({ timeout: 30_000 });
    const recurringHeaderTags = terminal.locator('.p2p-terminal-head .p2p-terminal-tag-row');
    await expect(recurringHeaderTags).toContainText(/Order #\d+/);
    await expect(recurringHeaderTags.locator('.p2p-offer-status')).toBeVisible();
    await expect(recurringHeaderTags).toContainText(/liquidity/i);
    await expect(terminal.locator('.p2p-terminal-market > .p2p-terminal-tag-row')).toHaveCount(0);
    await expect(terminal.locator('.p2p-terminal-price-desk .p2p-recurring-price-card-head')).toContainText('Price ratio');
    await expect(terminal.locator('.p2p-terminal-price-desk .p2p-recurring-price-basis')).toHaveCount(0);
    await expect(terminal.locator('.p2p-terminal-liquidity-head .p2p-recurring-liquidity-dot')).toHaveCount(2);
    await expect(terminal.locator('.p2p-terminal-liquidity-grid')).not.toContainText(/Live|Order history/);
    await expect(terminal.getByText('Both sides live')).toHaveCount(0);
    await expect(terminal.locator('.p2p-terminal-ticket').getByText('You receive')).toHaveCount(0);
    await expect(terminal.locator('.p2p-terminal-ticket').getByText('Live capacity')).toHaveCount(0);
    const recurringHistory = page.locator('.p2p-terminal-history-window');
    await expect(recurringHistory).toContainText('Your history');
    const recurringHistoryRows = recurringHistory.locator('.p2p-terminal-history-row');
    const recurringHistoryCount = Number(
      (await recurringHistory.locator('.p2p-terminal-history-head > span').last().textContent()) ?? '0'
    );
    expect(recurringHistoryCount).toBeGreaterThanOrEqual(1);
    await expect(recurringHistoryRows).toHaveCount(recurringHistoryCount);
    await expect(recurringHistory).toContainText(/Order #\d+ opened/);
    await expect(recurringHistory).not.toContainText(/Execution #\d+/);
    const terminalManage = terminal.getByRole('button', { name: /Manage order|Manage offer/ });
    if (await terminalManage.count()) {
      await terminalManage.first().click();
      await expect(page.locator('.p2p-public-trade-grid .p2p-maker-inline-actions')).toHaveCount(0);
    }
    await expect(terminal.getByRole('button', { name: /Reveal history|Refresh history/ })).toHaveCount(0);
  });

  test('renders My Trades with desk cards and opens the desk-style terminal drawer', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto('/trades/mine');

    const tabs = page.getByRole('tab');
    test.skip((await tabs.count()) === 0, 'No connected wallet sample data available for My Trades.');
    await expect(page.locator('.p2p-history-ledger-card')).toHaveCount(0);

    let openedTerminalDrawer = false;
    for (let index = 0; index < await tabs.count(); index += 1) {
      await tabs.nth(index).click();
      const cards = page.locator('.p2p-wallet-trade-grid .p2p-order-card');
      if ((await cards.count()) === 0) {
        continue;
      }

      await expect(cards.first()).toBeVisible();
      const openControl = cards.first().locator('.p2p-offer-open-btn, .p2p-offer-manage-btn').first();
      if ((await openControl.count()) === 0) {
        continue;
      }

      await openControl.click();
      openedTerminalDrawer = true;
      await expect(page).toHaveURL(/\/trades\/mine/);
      await expect(cards.first()).toHaveClass(/p2p-order-card-selected/);
      await expect(page.locator('.p2p-trading-shell-drawer-open')).toBeVisible();
      await expect(page.locator('.standalone-trade-detail-section .p2p-terminal-shell')).toBeVisible();
      await expect(page.locator('.p2p-terminal-history-window')).toBeVisible();
      await expect(page.locator('.p2p-my-trades-section')).toBeVisible();

      const terminalManage = page.locator('.standalone-trade-detail-section .p2p-terminal-manage-toggle').first();
      if ((await terminalManage.count()) > 0) {
        await terminalManage.click();
        await expect(page.locator('.p2p-wallet-trade-grid .p2p-maker-inline-actions')).toHaveCount(0);
      }
      break;
    }

    test.skip(!openedTerminalDrawer, 'No eligible My Trades card can open the terminal drawer in this sample state.');
    await expectNoHorizontalOverflow(page);
  });

  test('opens My Trades terminal drawer and mobile history sheet from desk cards', async ({ page }) => {
    await page.setViewportSize(mobileViewport);
    await page.goto('/trades/mine');

    const tabs = page.getByRole('tab');
    test.skip((await tabs.count()) === 0, 'No connected wallet sample data available for My Trades.');
    await expect(page.locator('.p2p-history-ledger-card')).toHaveCount(0);

    let openedTerminalDrawer = false;
    for (let index = 0; index < await tabs.count(); index += 1) {
      await tabs.nth(index).click();
      const cards = page.locator('.p2p-wallet-trade-grid .p2p-order-card');
      if ((await cards.count()) === 0) {
        continue;
      }

      const openControl = cards.first().locator('.p2p-offer-open-btn, .p2p-offer-manage-btn').first();
      if ((await openControl.count()) === 0) {
        continue;
      }

      await openControl.click();
      openedTerminalDrawer = true;
      break;
    }

    test.skip(!openedTerminalDrawer, 'No eligible My Trades card can open the terminal drawer in this sample state.');
    await expect(page.locator('.p2p-trading-shell-drawer-open')).toBeVisible();
    await expect(page.locator('.standalone-trade-detail-section .p2p-terminal-shell')).toBeVisible();
    await expect(page.locator('.p2p-my-trades-section')).toBeHidden();
    await expect(page.locator('.p2p-terminal-history-window')).toBeHidden();
    await page.locator('.standalone-trade-detail-section .p2p-terminal-mobile-history-trigger').click();
    const sheet = page.locator('.p2p-terminal-history-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.p2p-terminal-history-sheet-head')).toContainText('Your history');
    await expect(sheet.getByRole('button', { name: 'Close' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
  });
});
