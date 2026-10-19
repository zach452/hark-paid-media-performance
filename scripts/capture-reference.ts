/**
 * Captures the visual acceptance target: every tab (and App sub-tab) of the original
 * dashboard, in light and dark, at desktop and mobile widths, into reference/screens/.
 *
 *   npm run reference:screens
 *
 * Default shots keep each card's default Chart/Table choice; on desktop, "--charts" and
 * "--tables" shots flip every card the other way so chart types and table columns are both
 * on record. The clock is frozen at the export time so
 * relative dates and "latest day" presets render the same on every run.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { startReferenceServer } from './serve-reference';

const OUT = join(__dirname, '..', 'reference', 'screens');
const PORT = 4179;
const FROZEN_AT = new Date('2026-10-19T15:19:47.698Z'); // uploads.json generatedAt

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;
const THEMES = ['light', 'dark'] as const;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200); // Recharts entry animations
}

const REPORT_TABS = 'nav[aria-label="Report views"] button[role=tab]';
const APP_TABS = 'nav[aria-label="App views"] button[role=tab]';

/** Top-level tabs, with the App tab expanded into its own sub-tabs. */
async function listViews(page: Page): Promise<string[][]> {
  const views: string[][] = [];
  for (const top of (await page.locator(REPORT_TABS).allTextContents()).map((t) => t.trim())) {
    await page.locator(REPORT_TABS).filter({ hasText: top }).first().click();
    await settle(page);
    const subs = (await page.locator(APP_TABS).allTextContents()).map((t) => t.trim());
    if (subs.length) for (const sub of subs) views.push([top, sub]);
    else views.push([top]);
  }
  return views;
}

async function openView(page: Page, [top, sub]: string[]) {
  await page.locator(REPORT_TABS).filter({ hasText: top! }).first().click();
  await settle(page);
  if (sub) {
    await page.locator(APP_TABS).filter({ hasText: sub }).first().click();
    await settle(page);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = await startReferenceServer(PORT);
  const browser = await chromium.launch();
  const written: string[] = [];
  try {
    for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
      for (const theme of THEMES) {
        const context = await browser.newContext({ viewport, colorScheme: theme, deviceScaleFactor: 1 });
        const page = await context.newPage();
        await page.clock.setFixedTime(FROZEN_AT);
        // tsx compiles with keepNames; give page.evaluate callbacks the helper it expects.
        await page.addInitScript('window.__name = (f) => f');
        await page.goto(`http://127.0.0.1:${PORT}/`);
        await settle(page);

        const views = await listViews(page);
        for (const view of views) {
          await openView(page, view);
          const base = `${view.map(slug).join('-')}--${vpName}--${theme}`;
          await page.screenshot({ path: join(OUT, `${base}.png`), fullPage: true });
          written.push(`${base}.png`);

          if (vpName === 'desktop') {
            // Record the other state of every Chart/Table card: tables carry the column spec,
            // charts carry the chart types. Each variant starts from a fresh load of the view.
            for (const [label, suffix] of [
              ['Chart', 'charts'],
              ['Table', 'tables'],
            ] as const) {
              const toggles = page.locator('button[aria-pressed="false"]', {
                hasText: new RegExp(`^${label}$`),
              });
              const n = await toggles.count();
              if (n === 0) continue;
              for (let i = n - 1; i >= 0; i--) await toggles.nth(i).click();
              await settle(page);
              await page.screenshot({ path: join(OUT, `${base}--${suffix}.png`), fullPage: true });
              written.push(`${base}--${suffix}.png`);
              await page.reload();
              await settle(page);
              await openView(page, view);
            }
          }
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`Wrote ${written.length} screenshots to reference/screens/`);
  for (const f of written) console.log(`  ${f}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
