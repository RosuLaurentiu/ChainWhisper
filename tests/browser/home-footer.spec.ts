import { expect, test, type Page } from '@playwright/test';

const expectNoHorizontalOverflow = async (page: Page) => {
  await expect
    .poll(() =>
      page.locator('.landing-shell').evaluate((element) => element.scrollWidth - element.clientWidth)
    )
    .toBeLessThanOrEqual(1);
};

test.describe('Home footer', () => {
  test('provides working legal dialogs and project destinations only on Home', async ({ page }) => {
    await page.goto('/');

    const footer = page.getByRole('contentinfo');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeVisible();
    await expect(footer).toContainText(/© \d{4} ChainWhisper/);

    const githubLink = footer.getByRole('link', { name: 'GitHub', exact: true });
    const documentationLink = footer.getByRole('link', { name: 'Documentation', exact: true });
    const contactLink = footer.getByRole('link', { name: 'Contact', exact: true });

    await expect(githubLink).toHaveAttribute('href', 'https://github.com/RosuLaurentiu/ChainWhisper');
    await expect(documentationLink).toHaveAttribute(
      'href',
      'https://github.com/RosuLaurentiu/ChainWhisper#readme'
    );
    await expect(contactLink).toHaveAttribute('href', 'https://github.com/RosuLaurentiu/ChainWhisper/issues');
    for (const link of [githubLink, documentationLink, contactLink]) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }

    const privacyButton = footer.getByRole('button', { name: 'Privacy', exact: true });
    await privacyButton.focus();
    await page.keyboard.press('Enter');

    const privacyDialog = page.getByRole('dialog', { name: 'Privacy notice' });
    await expect(privacyDialog).toBeVisible();
    await expect(privacyDialog).toContainText('Supabase Storage');
    await expect(privacyDialog).toContainText('OpenAI');
    await expect(privacyDialog).toContainText('Last updated August 1, 2026');

    await page.keyboard.press('Escape');
    await expect(privacyDialog).toHaveCount(0);
    await expect(privacyButton).toBeFocused();

    await footer.getByRole('button', { name: 'Terms', exact: true }).click();
    const termsDialog = page.getByRole('dialog', { name: 'Terms of use' });
    await expect(termsDialog).toBeVisible();
    await expect(termsDialog).toContainText('Your wallet and transactions');
    await expect(termsDialog).toContainText('No advice, brokerage, or guarantee');
    await termsDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(termsDialog).toHaveCount(0);

    for (const path of ['/chat', '/otc', '/portal', '/treasury']) {
      await page.goto(path);
      await expect(page.locator('.landing-footer')).toHaveCount(0);
    }
  });

  test('keeps the footer and legal dialog inside a small viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const footer = page.getByRole('contentinfo');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const footerBounds = await footer.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right };
    });
    expect(footerBounds.left).toBeGreaterThanOrEqual(0);
    expect(footerBounds.right).toBeLessThanOrEqual(390);

    await footer.getByRole('button', { name: 'Privacy', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Privacy notice' });
    await expect(dialog).toBeVisible();

    const dialogBounds = await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        bottom: bounds.bottom,
        left: bounds.left,
        right: bounds.right,
        top: bounds.top
      };
    });
    expect(dialogBounds.left).toBeGreaterThanOrEqual(0);
    expect(dialogBounds.right).toBeLessThanOrEqual(390);
    expect(dialogBounds.top).toBeGreaterThanOrEqual(0);
    expect(dialogBounds.bottom).toBeLessThanOrEqual(844);
  });

  test('places the footer at the bottom of a tall Home viewport', async ({ page }) => {
    await page.setViewportSize({ width: 2048, height: 1600 });
    await page.goto('/');

    const footer = page.getByRole('contentinfo');
    await expect(footer).toBeVisible();
    await page.waitForFunction(() =>
      document.querySelector('.landing-shell')?.getAnimations().every((animation) => animation.playState === 'finished')
    );

    const metrics = await page.locator('.landing-shell').evaluate((root) => {
      const main = root.querySelector<HTMLElement>('.landing-main');
      const homeFooter = root.querySelector<HTMLElement>('.landing-footer');
      if (!main || !homeFooter) {
        throw new Error('Home layout landmarks are unavailable.');
      }

      const rootBounds = root.getBoundingClientRect();
      const mainBounds = main.getBoundingClientRect();
      const footerBounds = homeFooter.getBoundingClientRect();
      const rootStyles = window.getComputedStyle(root);
      const paddingBottom = Number.parseFloat(rootStyles.paddingBottom);

      return {
        display: rootStyles.display,
        footerGap: rootBounds.bottom - paddingBottom - footerBounds.bottom,
        mainToFooterGap: footerBounds.top - mainBounds.bottom,
        overflow: root.scrollWidth - root.clientWidth
      };
    });

    expect(metrics.display).toBe('flex');
    expect(Math.abs(metrics.footerGap)).toBeLessThanOrEqual(2);
    expect(metrics.mainToFooterGap).toBeGreaterThanOrEqual(20);
    expect(metrics.overflow).toBeLessThanOrEqual(1);
  });
});
