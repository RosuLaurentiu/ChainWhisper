import { expect, test, type Page } from '@playwright/test';

const stableRuntimes = ['direct-chat', 'direct-trade', 'reactions'] as const;
const allRuntimes = [...stableRuntimes, 'group-chat', 'otc-history'] as const;

const expectCount = async (page: Page, runtime: string, generations: number, closures: number) => {
  await expect(page.getByTestId(`${runtime}-generations`)).toHaveText(String(generations));
  await expect(page.getByTestId(`${runtime}-closures`)).toHaveText(String(closures));
};

test('keeps verified browser runtimes alive across harmless refreshes and scopes deliberate transitions', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/reactions-runtime-lifecycle-harness.html');
  for (const runtime of allRuntimes) await expectCount(page, runtime, 1, 0);

  await page.getByRole('button', { name: 'Refresh equivalent wallet wrappers' }).click();
  await page.getByRole('button', { name: 'Simulate transient live chain gap' }).click();

  await expect(page.getByTestId('transient-live-chain')).toHaveText('null');
  for (const runtime of allRuntimes) await expectCount(page, runtime, 1, 0);

  await page.getByRole('button', { name: 'Lock privacy', exact: true }).click();
  for (const runtime of stableRuntimes) await expectCount(page, runtime, 1, 0);
  await expectCount(page, 'group-chat', 1, 1);
  await expectCount(page, 'otc-history', 2, 1);

  await page.getByRole('button', { name: 'Unlock privacy', exact: true }).click();
  for (const runtime of stableRuntimes) await expectCount(page, runtime, 1, 0);
  await expectCount(page, 'group-chat', 2, 1);
  await expectCount(page, 'otc-history', 3, 2);

  await page.getByRole('button', { name: 'Commit real chain change' }).click();
  for (const runtime of stableRuntimes) await expectCount(page, runtime, 1, 1);
  await expectCount(page, 'group-chat', 2, 2);
  await expectCount(page, 'otc-history', 3, 3);

  await page.getByRole('button', { name: 'Restore committed chain' }).click();
  for (const runtime of stableRuntimes) await expectCount(page, runtime, 2, 1);
  await expectCount(page, 'group-chat', 3, 2);
  await expectCount(page, 'otc-history', 4, 3);
});
