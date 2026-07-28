import { expect, test, type Page } from '@playwright/test';

const expectNoHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(4);
};

const mockTreasurySources = async (page: Page) => {
  const snapshot = (day: number, capturedAt: string, cotiInPool: string, activeGcoti: string) => ({
    capturedAt,
    capturedAtUnix: Math.floor(Date.parse(capturedAt) / 1000),
    day,
    normalized: {
      activeGcoti,
      cotiInPool,
      maxApy: '20.5',
      maxBoostApy: '20.5',
      maxTotalApy: '41'
    },
    onchain: null,
    raw: {},
    scaled: {},
    source: 'browser-test'
  });

  await page.route('**/snapshots.json', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        snapshot(20260725, '2026-07-25T00:00:00.000Z', '408000000', '151000000'),
        snapshot(20260726, '2026-07-26T00:00:00.000Z', '409000000', '152000000')
      ])
    });
  });
  await page.route('https://treasury-app.coti.io/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        totalCotiInPool: '410000000',
        totalActiveGCoti: '153000000',
        maxApy: '20.4',
        maxBoostApy: '20.4',
        maxTotalApy: '40.8'
      })
    });
  });
  await page.route('https://mainnet.coti.io/**', (route) => route.abort());
  await page.route('https://mainnet.cotiscan.io/api/v2/**', (route) => route.abort());
};

test.describe('modern effects', () => {
  test('uses semantic motion tokens while keeping the shared header stationary', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 950 });
    await page.goto('/');

    const motion = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const route = document.querySelector<HTMLElement>('.landing-shell');
      const header = document.querySelector<HTMLElement>('.top-header');
      const homeShell = document.querySelector<HTMLElement>('.app-shell-landing');
      const firstSection = route?.firstElementChild as HTMLElement | null;
      return {
        press: root.getPropertyValue('--motion-press').trim(),
        hover: root.getPropertyValue('--motion-hover').trim(),
        enter: root.getPropertyValue('--motion-enter').trim(),
        feedback: root.getPropertyValue('--motion-feedback').trim(),
        scrollbarThumb: root.getPropertyValue('--scrollbar-thumb').trim(),
        scrollbarTrack: root.getPropertyValue('--scrollbar-track').trim(),
        documentCanScroll:
          document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
        homeCanScroll: route ? route.scrollHeight > route.clientHeight + 1 : false,
        homeOverflow: homeShell ? getComputedStyle(homeShell).overflow : '',
        routeOverflow: route ? getComputedStyle(route).overflowY : '',
        routeTop: route ? Math.round(route.getBoundingClientRect().top) : -1,
        routeRight: route ? Math.round(route.getBoundingClientRect().right) : -1,
        viewportWidth: window.innerWidth,
        headerBottom: header ? Math.round(header.getBoundingClientRect().bottom) : -2,
        routeAnimation: route ? getComputedStyle(route).animationName : '',
        sectionAnimation: firstSection ? getComputedStyle(firstSection).animationName : '',
        headerAnimation: header ? getComputedStyle(header).animationName : ''
      };
    });

    expect(motion).toEqual({
      press: '80ms',
      hover: '150ms',
      enter: '180ms',
      feedback: '220ms',
      scrollbarThumb: 'rgba(139, 92, 246, 0.58)',
      scrollbarTrack: 'rgba(10, 10, 18, 0.34)',
      documentCanScroll: false,
      homeCanScroll: true,
      homeOverflow: 'hidden',
      routeOverflow: 'auto',
      routeTop: motion.headerBottom,
      routeRight: motion.viewportWidth,
      viewportWidth: motion.viewportWidth,
      headerBottom: motion.headerBottom,
      routeAnimation: 'cw-route-chrome-enter',
      sectionAnimation: 'cw-route-enter',
      headerAnimation: 'none'
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileScrollBoundary = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>('.top-header');
      const route = document.querySelector<HTMLElement>('.landing-shell');
      return {
        documentCanScroll:
          document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
        routeCanScroll: route ? route.scrollHeight > route.clientHeight + 1 : false,
        routeTop: route ? Math.round(route.getBoundingClientRect().top) : -1,
        routeRight: route ? Math.round(route.getBoundingClientRect().right) : -1,
        headerBottom: header ? Math.round(header.getBoundingClientRect().bottom) : -2,
        viewportWidth: window.innerWidth
      };
    });

    expect(mobileScrollBoundary).toEqual({
      documentCanScroll: false,
      routeCanScroll: true,
      routeTop: mobileScrollBoundary.headerBottom,
      routeRight: mobileScrollBoundary.viewportWidth,
      headerBottom: mobileScrollBoundary.headerBottom,
      viewportWidth: mobileScrollBoundary.viewportWidth
    });
  });

  test('animates mobile token selection and privacy direction feedback without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/portal');

    const picker = page.locator('.privacy-mobile-token-picker > button');
    await expect(picker).toContainText('COTI / p.COTI');
    await picker.click();

    const menu = page.getByRole('menu', { name: 'Select a privacy token pair' });
    await expect(menu).toBeVisible();
    expect(await menu.evaluate((element) => getComputedStyle(element).animationName)).toBe('cw-popover-enter');

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    const swapCard = page.locator('.swap-card');
    await swapCard.getByRole('button', { name: 'To public', exact: true }).click();
    const directionFeedback = await swapCard.evaluate((element) => {
      const icon = element.querySelector<SVGElement>('.swap-route-chip svg');
      const payPanel = element.querySelector<HTMLElement>('.swap-flow > .swap-asset-panel:first-child');
      return {
        iconTransform: icon ? getComputedStyle(icon).transform : '',
        payAnimation: payPanel ? getComputedStyle(payPanel).animationName : ''
      };
    });

    expect(directionFeedback.iconTransform).not.toBe('none');
    expect(directionFeedback.payAnimation).toBe('cw-privacy-pay-emphasis');

    const mobileFit = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('.swap-page-shell');
      const routeButton = document.querySelector<HTMLElement>('.swap-route-chip');
      const outputHead = document.querySelector<HTMLElement>('.swap-asset-panel-output .swap-panel-head');
      const action = document.querySelector<HTMLElement>('.swap-action-btn');
      return {
        shellFits: shell ? shell.scrollHeight <= shell.clientHeight + 1 : false,
        outputClearsDirectionButton:
          routeButton && outputHead
            ? outputHead.getBoundingClientRect().top >= routeButton.getBoundingClientRect().bottom
            : false,
        actionVisible:
          action
            ? action.getBoundingClientRect().bottom <= window.innerHeight
            : false
      };
    });

    expect(mobileFit).toEqual({
      shellFits: true,
      outputClearsDirectionButton: true,
      actionVisible: true
    });
    await expectNoHorizontalOverflow(page);
  });

  test('fits the inline Privacy Portal workspace on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/portal');

    await expect(page.locator('.swap-action-btn')).toBeVisible();
    await expect(page.locator('.privacy-token-list > button.active')).toContainText('COTI / p.COTI');

    const layout = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('.swap-page-shell');
      const heading = document.querySelector<HTMLElement>('.swap-page-title');
      const flow = document.querySelector<HTMLElement>('.swap-flow');
      const pay = document.querySelector<HTMLElement>('.swap-flow > .swap-asset-panel:first-child');
      const receive = document.querySelector<HTMLElement>('.swap-flow > .swap-asset-panel-output');
      const action = document.querySelector<HTMLElement>('.swap-action-btn');
      const headingRect = heading?.getBoundingClientRect();
      const payRect = pay?.getBoundingClientRect();
      const receiveRect = receive?.getBoundingClientRect();
      return {
        shellFits: shell ? shell.scrollHeight <= shell.clientHeight + 1 : false,
        semanticHeadingVisuallyHidden:
          headingRect ? headingRect.width <= 1 && headingRect.height <= 1 : false,
        flowColumns: flow ? getComputedStyle(flow).gridTemplateColumns.split(' ').length : 0,
        panelsAligned:
          payRect && receiveRect
            ? Math.abs(payRect.top - receiveRect.top) <= 1 && Math.abs(payRect.bottom - receiveRect.bottom) <= 1
            : false,
        actionVisible: action ? action.getBoundingClientRect().bottom <= window.innerHeight : false
      };
    });

    expect(layout).toEqual({
      shellFits: true,
      semanticHeadingVisuallyHidden: true,
      flowColumns: 3,
      panelsAligned: true,
      actionVisible: true
    });
    await expectNoHorizontalOverflow(page);
  });

  test('crossfades Treasury controls without animating financial chart paths', async ({ page }) => {
    await mockTreasurySources(page);
    await page.goto('/treasury');

    const chart = page.locator('.treasury-chart-content');
    await expect(chart).toBeVisible();
    await page.getByRole('button', { name: 'Active gCOTI', exact: true }).click();

    expect(await chart.evaluate((element) => getComputedStyle(element).animationName)).toBe(
      'cw-chart-crossfade'
    );
    expect(
      await page.locator('.recharts-line-curve').first().evaluate((element) => getComputedStyle(element).animationName)
    ).toBe('none');
    const scrollBoundary = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>('.top-header');
      const shell = document.querySelector<HTMLElement>('.treasury-shell');
      return {
        documentCanScroll:
          document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
        shellCanScroll: shell ? shell.scrollHeight > shell.clientHeight + 1 : false,
        shellOverflow: shell ? getComputedStyle(shell).overflowY : '',
        shellTop: shell ? Math.round(shell.getBoundingClientRect().top) : -1,
        headerBottom: header ? Math.round(header.getBoundingClientRect().bottom) : -2
      };
    });

    expect(scrollBoundary).toEqual({
      documentCanScroll: false,
      shellCanScroll: true,
      shellOverflow: 'auto',
      shellTop: scrollBoundary.headerBottom,
      headerBottom: scrollBoundary.headerBottom
    });
    await expectNoHorizontalOverflow(page);
  });

  test('resolves nonessential movement immediately for reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const reducedMotion = await page.evaluate(() => {
      const route = document.querySelector<HTMLElement>('.landing-shell');
      const orbit = document.querySelector<HTMLElement>('.landing-brand-orbit-dot');
      return {
        routeDuration: route ? Number.parseFloat(getComputedStyle(route).animationDuration) : 1,
        orbitIterations: orbit ? getComputedStyle(orbit).animationIterationCount : ''
      };
    });

    expect(reducedMotion.routeDuration).toBeLessThanOrEqual(0.001);
    expect(reducedMotion.orbitIterations).toBe('1');
  });
});
