# Build brief: Hark Paid Media Dashboard (live, on Vercel, fed by Shadow)

> How to use this: create an empty repo, put `Hark-Paid-Media-Dashboard-export-2026-10-19.zip` in `reference/` and unzip it there, save this file as `CLAUDE.md` (or paste it as your first message in Claude Code), then say "Start Phase 0."

> **Phase 0 notes (added after the spike, see `docs/phase0.md`):** the reference build is React **19.3** (not 18) and Recharts 3, so the app uses React 19 + Next.js 16. The reference has **six** tabs, not four: Executive summary, App (with sub-tabs Google vs Apple / Apple Search Ads / Google App), Paid Search (Google Search), Paid Social, High Impact, Data & methodology. Treat `reference/screens/` and the bundle as the spec where they differ from §4 below.

---

## 1. What we're building and why

Darkroom runs paid media for **Hark** (Hark Pro, US app). Today the client-facing dashboard is a Google Apps Script web app that serves a single-file React build. Its data comes from **manual uploads**: someone exports from Google Ads, Apple Search Ads, Meta Ads Manager and TikTok, drops the files in, and the page parses and merges them into a JSON file in Drive.

The goal is to **rebuild the same dashboard as a Next.js app on Vercel** with these changes:

- **Data refreshes automatically every 2 hours** from **Shadow** (Darkroom's marketing data warehouse, workspace `Hark`), with no manual exports.
- **The Hark client can open it** through a private link, with no Google or Shadow login.
- **The look, views, metric definitions and methodology stay the same as the current dashboard.** This is a port with a new data layer, not a redesign.
- **The code is in GitHub** and deployed on Vercel.

The current dashboard's own footer says: _"Interim reporting view while the Shadow integration is completed."_ This project is that integration.

---

## 2. What's in `reference/`

| Path                      | What it is                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`               | Exporter's notes on the data model. Read it first.                                                                                                                              |
| `app/Index.html`          | The **full current front end**: a minified Vite and React 18 build (~835 KB), using **Recharts** for charts and SheetJS for file parsing. No unminified source exists.            |
| `backend/Code.gs`         | The Apps Script backend: access-key check, loading and saving uploads JSON, `mergeDatasets_`, and writing to a Google Sheet.                                                    |
| `backend/appsscript.json` | Apps Script manifest (timezone `America/Chicago`).                                                                                                                              |
| `data/uploads.json`       | The full current dataset `{generatedAt, rows, keywords, sources, warnings}`. **This is the history seed.**                                                                      |
| `data/campaign_daily.csv` | `rows` flattened, 2,312 rows × 45 columns.                                                                                                                                      |
| `data/keyword_daily.csv`  | Apple Search Ads keyword-day rows, 867 rows.                                                                                                                                    |

### Working with the minified bundle

You can't edit the bundle, but it is the **spec**. Do both of these:

1. **Run the original locally for visual parity.** Write `scripts/serve-reference.ts`. It should read `app/Index.html`, replace `var initial = /*__HARK_UPLOADS__*/null;` with `var initial = <uploads.json>;`, stub `google.script.run` as a no-op, and serve the result on localhost. Screenshot every view, in light and dark mode, into `reference/screens/`. These screenshots are the visual acceptance target.
2. **Mine the bundle for logic and copy.** Search it for function names and strings. Port exactly, don't paraphrase. The key items are listed in section 4.

---

## 3. Design system (copy exactly)

All colors are CSS custom properties on `:root`, with dark values under both `@media (prefers-color-scheme: dark)` (when `data-theme` isn't `light`) and `:root[data-theme=dark]`. The theme toggle persists the choice in `localStorage` key `hark-dashboard-theme`.

**Light theme:**

```
--page:#f6f6f3; --surface:#fcfcfb; --surface-2:#f1f0ec; --ink:#0b0b0b; --ink-2:#52514e; --muted:#6f6d68;
--hairline:#0b0b0b1a; --grid:#e1e0d9; --wash:#0b0b0b0a;
--apple:#2a78d6; --apple-soft:#86b6ef; --google:#eb6834; --search:#0f9d76; --meta:#6a4fd6; --hi:#c2407e; --tiktok:#1a9fb0; --blended:#52514e;
--good:#006300; --bad:#c23434; --status-good:#0ca30c; --status-warning:#fab219; --status-serious:#ec835a; --status-critical:#d03b3b;
--focus:#2a78d6; --shadow:0 1px 2px #0b0b0b0a, 0 4px 16px #0b0b0b0a; --radius:12px;
--font:system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
```

**Dark theme:**

```
--page:#0d0d0d; --surface:#1a1a19; --surface-2:#232322; --ink:#fff; --ink-2:#c3c2b7; --muted:#9a9890;
--hairline:#ffffff1a; --grid:#2c2c2a; --wash:#ffffff0d;
--apple:#3987e5; --apple-soft:#184f95; --google:#d95926; --search:#22b88d; --meta:#9479f2; --hi:#e0609c; --tiktok:#33c3d4; --blended:#c3c2b7;
--good:#0ca30c; --bad:#e66767; --focus:#5598e7; --shadow:none;
```

Base styles: body font size 14px, line-height 1.45, antialiased. Extract the remaining ~13 KB of CSS from the `<style>` block in `Index.html` verbatim into `app/globals.css`, then adapt class names as needed.

**Header copy:**

- Client: `Hark`
- Title: `Paid Media Performance`
- Subtitle: `Apple Search Ads, Google App & Search, Meta, TikTok & YouTube · Hark Pro (US)`
- Prepared by: `Darkroom`
- Replace the old "Interim reporting view…" footer with a freshness line (see section 6).

---

## 4. Product spec (port faithfully)

### Views

1. **Executive summary**
2. **Paid Search**: Apple Search Ads and Google (App and Search). Includes:
   - Apple campaigns and keyword detail, with a "hide keywords with no impressions" toggle
   - Google ad groups and campaigns
   - Brand vs non-brand
   - Apple budget pacing (over- and under-delivery, "Spent more than the daily budget")
   - Install quality (tap- vs view-through, new users vs re-downloads)
   - Head to head (Google vs Apple)
   - CPI and installs by theme
3. **Paid Social**: Meta and TikTok topline, by channel and objective, ad sets, ads (creative), by placement, plus hook rate, hold rate, cost per LPV and the other creative metrics.
4. **Data & methodology**: coverage by day, source health (this replaces "Source files"), and the full "Methodology & definitions" glossary.

The tactic breakdown, "Total spend by channel & tactic", should use the exact `HkTactic` channel and tactic mapping from the bundle.

### Global controls

- **Date presets:** Latest day (1D), Last 7 days (7D), Last 14 days (14D), Last 30 days (30D), Month to date (MTD), Last month, All time. Port the date math functions `Ns` and `Ps` (previous period).
- **Compare to previous period** toggle, with deltas.
- **Install attribution basis:** platform-reported vs click-through only.
- **Theme switch.**
- **Download CSV** on tables.
- **"Download shareable file"** (a self-contained HTML snapshot). Keep it if feasible; otherwise flag it.

### Channels (`channel` field)

| Value    | Meaning                                         |
| -------- | ----------------------------------------------- |
| `apple`  | Apple Search Ads                                |
| `google` | Google App campaigns                            |
| `search` | Google Search                                   |
| `meta`   | Meta                                            |
| `tiktok` | TikTok, excluding TopView                       |
| `hi`     | High Impact: YouTube Masthead and TikTok TopView |

Port this channel classifier verbatim from the bundle and apply it to Google Ads data:

```js
function HkCh(campaign, adGroupType, campaignType) {
  return /masthead/i.test(adGroupType) || /masthead|topview/i.test(campaign) ? 'hi'
    : /search/i.test(campaignType) || /^standard$/i.test(adGroupType) || (/search/i.test(campaign) && !/app/i.test(campaignType)) ? 'search'
    : 'google';
}
```

TikTok campaigns matching `/topview/i` (currently `HARK_SOC_TIKTOK_TOPVIEW_102026`) go to `hi` with `platform: 'TikTok TopView'`. YouTube Masthead rows get `platform: 'YouTube Masthead'`. All `hi` rows have `noInstall: true` and installs forced to 0.

### Themes

Port these verbatim. The Google Search override is `HkTh`; everything else uses `ne`.

```js
const THEME_RULES = [
  [/brand|\bhark\b/i, 'Brand'], [/compet/i, 'Competitors'], [/business|b2b|enterprise/i, 'Business'],
  [/discover|explor/i, 'Discovery'], [/assistant|\bai\b|\bagent/i, 'AI Assistant'],
];
function ne(...names) { for (const n of names) if (n) for (const [re, t] of THEME_RULES) if (re.test(n)) return t; return 'Other'; }
function HkTh(adGroup, campaign, channel) {
  if (channel !== 'search') return ne(adGroup, campaign);
  if (/brand/i.test(campaign) && !/_nb_|_nb\b|non.?brand/i.test(campaign)) return 'Brand';
  const t = /conquest|compet|alternative|grok|chatgpt|gemini|perplexity|claude|copilot/i.test(campaign) ? 'Competitors' : ne(adGroup, campaign);
  return t === 'Brand' ? 'Other' : t;
}
// Theme display order:
const THEMES = ['Brand','AI Assistant','Business','Competitors','Discovery','Other'];
```

### Metric rules (non-negotiable)

- **Ratios are always recomputed from summed totals, never averaged.**
- **CPI** = install-goal spend ÷ installs on the selected basis. Rows with `noInstall: true` (Meta, TikTok, High Impact) add to spend but are excluded from installs and CPI.
- **Installs (platform-reported)**: Apple "Installs (Total)" (tap-through plus view-through); Google "Installs", which excludes view-through.
- **Installs (click-through)**: Apple tap-through installs; Google installs. This is the like-for-like basis across channels.
- **Google Search conversions count as installs** in Executive totals.
- **Judge Apple on non-brand and tap-through CPI**, because Apple Brand installs are mostly view-through plus re-downloads.
- **Meta creative metrics** (port `HkMA`):
  - hook = 3-second plays ÷ impressions
  - hold = 95% plays ÷ 3-second plays
  - CPC (link) = spend ÷ link clicks
  - cost per LPV = spend ÷ LPV
  - engagement rate = engagements ÷ impressions
  - LPV rate = LPV ÷ link clicks
  - cost per 1K engagements, cost per 1K 3-second plays, CPM by reach
- **Meta install rows:** a Meta row counts installs only when its result type is an install result. Otherwise `noInstall: true`. Port the logic around `noInstall:!inst` in the Meta parser.
- **Google clicks:** the old ad-group export had no clicks, so the dashboard implied them as conversions ÷ conv. rate (`clicksImplied: true`). **Shadow has real clicks and impressions.** Use real values, set `clicksImplied: false`, and update the glossary entry to match.

Copy the entire **Methodology & definitions** glossary from the bundle (search for `Methodology & definitions`), then edit only the entries that the data-source change makes untrue: Google clicks, "Refreshing the data", "Source files" and "Import exports".

---

## 5. Architecture

- **Next.js** (App Router), **TypeScript** in strict mode, React 18, **Recharts**, deployed on **Vercel**.
- **Canonical data shape: keep the existing `Dataset` schema exactly** (`{generatedAt, rows, keywords, sources, warnings}`, with row and keyword fields as in `uploads.json`). The UI ports cleanly when the shape doesn't change. Define it in `lib/types.ts` with zod validation.
- **Storage: Vercel Blob** holds `dataset.json` (the merged current dataset) and `dataset.prev.json` (the last good copy). Use Upstash/Vercel KV only if Blob proves awkward.
- **Data flow:**
  1. A Vercel Cron at `0 */2 * * *` calls `GET /api/cron/refresh`, protected by a `CRON_SECRET` bearer token.
  2. The refresh pulls a **rolling 14-day window** from every source, because Shadow re-syncs about 7 days back each hour and late conversions land.
  3. It normalizes data into `rows` and `keywords`.
  4. It merges with the stored dataset using the **same rule as `mergeDatasets_` in `Code.gs`**: new data replaces the same `channel|date` for rows and the same `adGroupId|date` for keywords.
  5. It validates, writes to Blob, and records per-source status in `sources` and `warnings`.
- **Fail safe:** if one source errors, keep that source's existing rows, still write the others, and surface a warning. Never overwrite good data with an empty pull. If a source returns more than 50% less spend than the stored copy for a closed day, refuse that day and warn.
- **Read path:** a server component or `GET /api/dataset` reads the Blob, which is cached with revalidation on refresh. The client gets JSON and does all slicing in memory, as today.
- **Seed:** `scripts/seed.ts` loads `reference/data/uploads.json` into Blob once, so history from Oct 1 (Meta from Sep 19) survives. Shadow currently only covers Apple and Google from Oct 6, TikTok from Oct 12 and Meta from Oct 14.
- **Manual refresh:** `POST /api/admin/refresh` lets Darkroom staff force a pull, gated by an admin key.

### Access for the client

- **Middleware gate:** the first visit with `?k=<ACCESS_KEY>` sets an httpOnly, secure cookie and redirects to a clean URL. Any request without a valid cookie shows the same "Link not valid" page as `Code.gs`. Keys live in an env var as a comma-separated list, so a key can be rotated per audience.
- Add `noindex` and `X-Robots-Tag`.
- No PII is shown. Admin routes need a separate `ADMIN_KEY`.

---

## 6. Shadow integration

Shadow is reached over **MCP (Streamable HTTP) at `https://mcp.shadow.co`**. Use `@modelcontextprotocol/sdk` (`Client` + `StreamableHTTPClientTransport`) server-side only.

### Phase 0: auth spike (blocking)

The cron needs **headless auth**. Determine which of these Shadow supports, in order of preference:

1. **An API key or service token** sent as a bearer header.
2. **OAuth with a long-lived refresh token.** Do a one-time interactive login via a local script, store the refresh token in Vercel env or KV, and refresh access tokens on each run, persisting rotated tokens.
3. **Neither.** Stop and tell me. I'll contact the Shadow team.

Write `scripts/shadow-probe.ts`, which connects, lists tools and runs one `query_data` call. Report back before building anything else. Never commit tokens. Use `.env.local` and Vercel env vars.

### Rules for every Shadow call

- **Always pass `workspace: "Hark"` explicitly.** The default workspace is shared across all chats on a connection and can change under you.
- **Use the `query_data` tool**, which takes `platform`, `table`, `start_date`, `end_date`, `group_by`, `aggregations`, `limit` and `order_by`.
  - Without `aggregations`, it returns only a platform summary with a `no_query` warning. Always pass explicit `group_by` and `aggregations`.
  - Responses include `groups`, `summary`, `bind.window.tz`, `coverage` and `page.truncated`. **Paginate or shrink the window if `truncated` is true.**
- **Never guess field names.** For each platform and table, first run a discovery call and record the real column names in `docs/shadow-fields.md`. Build the mappers from observed responses only. Add a fixture test per mapper from a recorded (anonymized) response.
- **Check the timezone.** Shadow resolved the window in **`America/New_York`**; the old dashboard is `America/Chicago`. Check whether the platforms report in account timezone, document what Shadow does, and make the dashboard's "Time zone" note accurate.

### What's already been verified (Oct 19)

| Source                                     | Shadow platform / table                                                                                        | Status                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Ads (App, Search, YouTube Masthead) | `google_ads` / `campaigns` (resolves to `google_ads_daily`), plus `keywords` and `ads`                         | Syncs **hourly** with a rolling 7-day window. Oct 18 total $108,822.45 vs the dashboard's google + search + Masthead total of $108,789.54, within 0.03%. **Masthead is inside the Google Ads data**, so `HkCh` must route it to `hi`.                                                                                                                                                            |
| TikTok                                     | `tiktok_ads` / `campaigns`, `adgroups`, `ads`                                                                  | **Ties exactly** to the dashboard: Oct 18 TopView $393,121.19 and Evergreen $7,006.22. It exposes `video_watched_6s`, `video_views_p100`, reach and similar fields. Available `group_by` includes `date` and `campaign_name`.                                                                                                                                                                   |
| Meta                                       | `meta_ads` / `ads`, `adsets`, `campaigns`, `creatives`                                                         | Connected; coverage starts Oct 14. **To do:** confirm 3-second plays, 25/50/95% plays, LPV, link clicks, engagements, result type and placement are available, and map them to the `meta.*` fields. If placement isn't available, say so.                                                                                                                                                       |
| **Apple Search Ads**                       | **Not exposed by `query_data`.** Its platform enum has no Apple option, even though Shadow syncs an `apple_ads` connection. | **Gap.** Ask Shadow whether Apple is queryable another way. **Fallback:** call the **Apple Search Ads Campaign Management API (v5)** directly using its OAuth client-credentials flow (a JWT signed with a private key, which works headless). Pull campaign reports and keyword reports with tap-through and view-through installs, new downloads, re-downloads, daily budget and bid. Build it behind the same source interface. |

### Source adapter interface

```ts
interface SourceAdapter {
  id: 'shadow-google' | 'shadow-meta' | 'shadow-tiktok' | 'apple' /* shadow-apple if it becomes available */;
  fetch(range: { from: string; to: string }): Promise<{ rows: Row[]; keywords: Keyword[]; coverage: { from: string; to: string }; warnings: string[] }>;
}
```

Each adapter maps its data into the exact `Row` and `Keyword` fields used in `uploads.json`. That includes `campaignId`, `adGroup`, `adGroupId`, `objective`, `theme`, `status`, `dailyBudget`, `bidStrategy`, `installsReported`, `installsTap`, `installsView`, `newDownloads`, `redownloads`, `inAppActions`, `noInstall`, `platform`, and the `meta` sub-object or TikTok columns (`reach`, `views6s`, `vcr`, `eng`, `v100`, `freqD`).

**Google install mapping:**

- App-campaign installs are conversions from the install conversion action, not all conversions. Confirm whether Shadow exposes conversions by action. If it doesn't, document the assumption and flag it.
- Search conversions count as installs per the rules in section 4.

### Freshness in the UI

The header shows "Data through {max date} · refreshed {relative time}". The Data & methodology view shows each source's last successful pull, its coverage range and any warnings, in place of the old "Source files" and "Import exports" panels. Remove the upload UI entirely.

---

## 7. Phases and acceptance criteria

**Phase 0: setup and spikes.** Initialize the repo with Next.js, TypeScript, ESLint, Prettier and Vitest. Run the reference locally and capture screenshots. Run the Shadow auth probe and do field discovery for Google, TikTok and Meta. Confirm the Apple path.

- **Deliverable:** a short `docs/phase0.md` with findings and any blockers. **Stop and check in with me.**

**Phase 1: data layer.** Build the types, adapters, merge, Blob storage, seed, the refresh route and the cron config in `vercel.json`.

- **Acceptance:** `scripts/reconcile.ts` compares the Shadow-derived spend, impressions, clicks and installs per `channel|date` against `uploads.json` for the overlapping days, and prints a diff table.
  - Spend must be within **±1% per channel-day**. Explain any larger gap: timezone, late data, or Masthead or TopView routing.
  - Commit the output to `docs/reconciliation.md`.

**Phase 2: front end.** Port every view and control to React components.

- **Acceptance:** side-by-side screenshots match `reference/screens/` in layout, colors, chart types and table columns, in both themes and at mobile and desktop widths. With the seed data loaded and Shadow off, numbers match the original exactly.

**Phase 3: access, deploy and hardening.** Build the middleware gate, admin refresh, error states, empty states and `noindex`. Deploy to Vercel preview, then production.

- Document env vars in `README.md`: `SHADOW_*`, `APPLE_*`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, `ACCESS_KEYS`, `ADMIN_KEY`.
- **Acceptance:** the cron runs on schedule in production. A forced source failure keeps the last good data and shows a warning. An invalid key shows "Link not valid".

---

## 8. Ground rules

- **Ask before**: adding paid Vercel features (cron frequency limits depend on plan; confirm the plan supports a 2-hour cron), changing any metric definition, or dropping a view or feature.
- **Never invent data or field names.** If a metric can't be sourced, show "—" with a tooltip and list it in `docs/gaps.md`.
- **No secrets in the repo, logs or client bundle.** Shadow and Apple calls are server-only.
- **Keep commits small and messages clear.** Open a PR per phase.
- At the end of each phase, summarize what's done, what's verified, what's assumed and what's blocked.
