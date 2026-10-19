// Tab-by-tab text diff: the reference page vs the built artifact with no connector.
// Only intended copy changes should differ; any number that differs is a regression.
//   npm run artifact:parity
import { chromium, type Page } from 'playwright';
import { createServer } from 'node:http';
import { buildArtifact } from './build-artifact';
import { startReferenceServer } from './serve-reference';

async function texts(page: Page) {
  const out: Record<string, string[]> = {};
  const tabs = (await page.locator('nav[aria-label="Report views"] button[role=tab]').allTextContents()).map(
    (t) => t.trim(),
  );
  for (const t of tabs) {
    await page.locator('nav[aria-label="Report views"] button[role=tab]', { hasText: t }).first().click();
    await page.waitForTimeout(500);
    const subs = (await page.locator('nav[aria-label="App views"] button[role=tab]').allTextContents()).map(
      (s) => s.trim(),
    );
    for (const s of subs.length ? subs : ['']) {
      if (s) {
        await page.locator('nav[aria-label="App views"] button[role=tab]', { hasText: s }).first().click();
        await page.waitForTimeout(500);
      }
      // Tables default to Chart on most cards; flip to Table so numbers are in the text.
      const tg = page.locator('button[aria-pressed="false"]', { hasText: /^Table$/ });
      for (let i = (await tg.count()) - 1; i >= 0; i--) await tg.nth(i).click();
      await page.waitForTimeout(300);
      out[t + (s ? ' / ' + s : '')] = (await page.locator('#root').innerText())
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    }
  }
  return out;
}

(async () => {
  const ref = await startReferenceServer(4192);
  const body =
    '<!doctype html><html><head><meta charset=utf8></head><body>' + buildArtifact() + '</body></html>';
  const art = createServer((_, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(body)).listen(
    4193,
  );
  const browser = await chromium.launch();
  const get = async (url: string) => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await p.clock.setFixedTime(new Date('2026-10-19T15:19:47Z'));
    await p.addInitScript(
      'window.__name = (f) => f; window.claude = { use: function () { return Promise.resolve(null); } };',
    );
    await p.goto(url);
    await p.waitForTimeout(1500);
    const t = await texts(p);
    await p.close();
    return t;
  };
  const a = await get('http://127.0.0.1:4192/');
  const b = await get('http://127.0.0.1:4193/');
  let total = 0;
  for (const k of Object.keys(a)) {
    const A = a[k]!,
      B = b[k] ?? [];
    const onlyA = A.filter((l) => !B.includes(l)),
      onlyB = B.filter((l) => !A.includes(l));
    total += onlyA.length + onlyB.length;
    console.log(
      `\n## ${k}: ${A.length} lines; ${onlyA.length} only in reference, ${onlyB.length} only in artifact`,
    );
    onlyA.slice(0, 12).forEach((l) => console.log('  - ' + l.slice(0, 160)));
    onlyB.slice(0, 12).forEach((l) => console.log('  + ' + l.slice(0, 160)));
  }
  console.log('\nTOTAL differing lines:', total);
  await browser.close();
  ref.close();
  art.close();
})();
