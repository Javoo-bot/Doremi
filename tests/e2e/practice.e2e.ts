import { expect, test } from '@playwright/test';

import { flatTakeWav } from './make-take';

// Bass line sung 40 cents flat in bar 2, made by code.
const take = { name: 'take.wav', mimeType: 'audio/wav', buffer: flatTakeWav(2, -40) };

test('upload a take, click the graph, play A and B, no console errors', async ({ page }, info) => {
  const problems: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  await page.goto('/');
  await expect(page.locator('#result')).toBeHidden();
  await page.locator('#upload').setInputFiles(take);
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#status')).toContainText('Fet');

  // The graph is drawn: pixels on the canvas are not all blank.
  const painted = await page.locator('#graph').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  expect(painted).toBeGreaterThan(2000);

  // Tips are in Catalan and each names a bar that links to it.
  const tips = page.locator('#tips li');
  expect(await tips.count()).toBeGreaterThan(0);
  const link = page.locator('#tips a[data-bar]').first();
  const bar = await link.getAttribute('data-bar');
  expect(bar).toBe('2');
  await link.click();
  await expect(page.locator('#cursor')).toContainText(`compàs ${bar}`);

  // Click the graph: the cursor moves to that time.
  const box = (await page.locator('#graph').boundingBox())!;
  await page.locator('#graph').click({ position: { x: box.width * 0.5, y: box.height / 2 } });
  const at = Number((await page.locator('#cursor').textContent())!.split(' s')[0]);
  expect(at).toBeGreaterThan(1);

  // A: the take plays from there and moves on.
  await page.locator('#play-a').click();
  await expect.poll(() => page.evaluate(() => (window as any).doremi.playing)).toBe('take');
  await expect.poll(() => page.locator('#take-audio').evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(at + 0.2);
  expect(await page.locator('#take-audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(false);

  // B: stop A, click the same point again, and the score's notes play from there.
  await page.locator('#stop').click();
  await page.locator('#graph').click({ position: { x: box.width * 0.5, y: box.height / 2 } });
  await page.locator('#play-b').click();
  await expect.poll(() => page.evaluate(() => (window as any).doremi)).toMatchObject({ playing: 'score' });
  expect(Math.abs((await page.evaluate(() => (window as any).doremi.from)) - at)).toBeLessThan(0.01);
  await expect.poll(async () => Number((await page.locator('#cursor').textContent())!.split(' s')[0])).toBeGreaterThan(at + 0.2);
  expect(await page.locator('#take-audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);

  // Clicking while B plays restarts B from the new point.
  await page.locator('#graph').click({ position: { x: box.width * 0.3, y: box.height / 2 } });
  await expect.poll(() => page.evaluate(() => (window as any).doremi.playing)).toBe('score');
  await page.locator('#stop').click();

  await page.locator('#graph').screenshot({ path: info.outputPath('pitch-graph.png') });
  await info.attach('pitch-graph', { path: info.outputPath('pitch-graph.png'), contentType: 'image/png' });
  expect(problems).toEqual([]);
});

test('a file that is not audio gives a message, not a crash', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto('/');
  await page.locator('#upload').setInputFiles('package.json');
  await expect(page.locator('#status')).toHaveClass(/error/);
  await expect(page.locator('#result')).toBeHidden();
  expect(problems).toEqual([]);
});
