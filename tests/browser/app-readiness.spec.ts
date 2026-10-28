import {expect, test} from '@playwright/test';

// Local service-unavailable fixture. Device/zoom/keyboard sizes are emulated;
// physical-device and assistive-technology acceptance stays in CW-031/CW-035.
const surfaces = [
  ['Home', '/', '.landing-shell'], ['Chat', '/chat', '.app-shell-chat'],
  ['DEX', '/dex', '.app-shell-dex-v2'], ['P2P', '/otc/desk', '.standalone-trades-shell'],
  ['Portal', '/portal', '.swap-page-shell'], ['TVL', '/tvl', '.treasury-shell']
] as const;

test.beforeEach(async ({page, baseURL}) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === new URL(baseURL!).origin ? route.continue() : route.abort();
  });
});

for (const [profile, width, height] of [
  ['desktop', 1440, 1024], ['200 percent reflow', 720, 512],
  ['compact mobile', 360, 800], ['mobile keyboard', 390, 460]
] as const) {
  for (const [name, route, shell] of surfaces) {
    test(`${name} remains usable at ${profile}`, async ({page}) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize({width, height});
      await page.goto(route);
      await expect(page.locator(shell)).toBeVisible();
      await expect(page.getByRole('navigation', {name: 'ChainWhisper apps'})).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(4);
      // Reach the shared app navigation with a real keyboard and use its existing
      // roving-focus rule. A safe route exit must remain available during outages.
      const chat = page.getByRole('navigation', {name: 'ChainWhisper apps'}).getByRole('button', {name: 'Chat', exact: true});
      await chat.focus();
      await page.keyboard.press('End');
      await expect(page.getByRole('navigation', {name: 'ChainWhisper apps'}).getByRole('button', {name:'Private TVL', exact:true})).toBeFocused();
      await page.keyboard.press('Home');
      await expect(chat).toBeFocused();
      if (name !== 'Chat') {
        await chat.press('Enter');
        await expect(page).toHaveURL(/\/chat$/);
        await expect(page.locator('.app-shell-chat')).toBeVisible();
      }
      expect(errors).toEqual([]);
    });
  }
}

for (const [name, route, shell] of surfaces) {
  test(`${name} exposes named local controls`, async ({page}) => {
    await page.goto(route);
    await expect(page.locator(shell)).toBeVisible();
    for (const role of ['button', 'textbox', 'checkbox', 'combobox'] as const) {
      // Read one current role set. A retry button can appear between two counts.
      await expect(page.getByRole(role, {name:/^\s*$/})).toHaveCount(0);
    }
    // Browser accessible-name computation is local semantic evidence. It is
    // not an NVDA/VoiceOver interaction or a physical-device certification.
  });
  test(`${name} has mobile touch targets and reduced route motion`, async ({page}, testInfo) => {
    await page.setViewportSize({width:390,height:844});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto(route);
    await expect(page.locator(shell)).toBeVisible();
    const small = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('button,input,select,textarea,summary,.swap-privacy-portal-link'))
      .map(element => element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type) ? element.labels?.[0] ?? element : element)
      .filter(element => !element.closest('[hidden]') && element.getBoundingClientRect().width && element.getBoundingClientRect().height && getComputedStyle(element).visibility !== 'hidden')
      .map(element => ({label: element.getAttribute('aria-label') || element.textContent?.trim() || element.id, width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height}))
      .filter(target => target.width < 43.5 || target.height < 43.5));
    expect(small).toEqual([]);
    let motion = {name:'',rawDuration:'',connected:false,reduced:false,durations:[] as number[]};
    // The existing global reduced-motion rule retains animation names but
    // limits them to 0.01 ms, below one rendered frame.
    try {
      await expect.poll(async () => {
        // Route updates can replace the shell after the locator resolved.
        // Detached elements have empty computed styles; read the current shell.
        motion = await page.locator(shell).evaluate(element => {
          const style = getComputedStyle(element);
          return {name:style.animationName,rawDuration:style.animationDuration,connected:element.isConnected,
            reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
            durations:style.animationDuration.split(',').map(value=>parseFloat(value))};
        });
        return motion.connected && motion.reduced && (motion.name === 'none' ||
          motion.durations.length > 0 && motion.durations.every(seconds=>seconds<=0.00001));
      }).toBe(true);
    } finally {
      console.info(`${name} computed route motion: ${JSON.stringify(motion)}`);
      await testInfo.attach('computed-route-motion', {body:JSON.stringify(motion),contentType:'application/json'});
    }
  });
}
