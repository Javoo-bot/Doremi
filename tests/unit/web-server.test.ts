import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Analysis } from '../../src/web/analysis.ts';
import { createApp } from '../../src/web/server.ts';
import { flatTakeWav } from '../e2e/make-take.ts';

const server = createApp({ reference: JSON.parse(readFileSync('tests/fixtures/scores/satb-bass.reference.json', 'utf8')) });
let base = '';
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

describe('practice page server', () => {
  it('serves the page and its script', async () => {
    const page = await fetch(base);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('id="graph"');
    expect((await fetch(`${base}/app.js`)).headers.get('content-type')).toContain('javascript');
  });

  it('flags the flat bar and tips name only that bar', async () => {
    const res = await fetch(`${base}/api/analyze`, { method: 'POST', body: flatTakeWav(2, -40) });
    expect(res.status).toBe(200);
    const a = (await res.json()) as Analysis;
    expect(a.bars.filter((b) => b.flagged).map((b) => b.bar)).toEqual([2]);
    expect(a.tips.every((t) => t.bars.length === 1 && t.bars[0] === 2)).toBe(true);
    expect(a.tipSource).toBe('fallback');
  });

  it('says all is well for a clean take', async () => {
    const a = (await (await fetch(`${base}/api/analyze`, { method: 'POST', body: readFileSync('tests/fixtures/takes/satb-bass.wav') })).json()) as Analysis;
    expect(a.tipSource).toBe('none');
    expect(a.bars.every((b) => !b.flagged)).toBe(true);
  });

  it('answers 422 with a Catalan message for a file that is not audio, 400 for no file', async () => {
    const bad = await fetch(`${base}/api/analyze`, { method: 'POST', body: readFileSync('package.json') });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: string }).error).toContain('àudio');
    expect((await fetch(`${base}/api/analyze`, { method: 'POST' })).status).toBe(400);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
