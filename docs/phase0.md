# Phase 0: findings and blockers (2026-10-19)

## Summary

|                     |                                                                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Done**            | Repo scaffold (Next.js 16, React 19, TS strict, ESLint, Prettier, Vitest). Reference server and 46 screenshots. Shadow probe script. Field discovery for Google, TikTok and Meta. Apple path checked.                                    |
| **Verified**        | Google, TikTok and Meta tie to `uploads.json` on Oct 18 for spend, impressions, clicks and most video metrics (tables in `shadow-fields.md`). Shadow dates are the platforms' own reporting days. Apple is not queryable through Shadow. |
| **Blocked**         | **Shadow headless auth is unanswered.** This cloud session's network policy denies `mcp.shadow.co`, and Shadow publishes no auth docs I could find. The probe is ready to run.                                                           |
| **Needs your call** | Search install definition, Apple API credentials, Vercel plan, and how to show 3 metric gaps (below).                                                                                                                                    |

## Decisions and blockers

1. **Shadow auth (blocking Phase 1).**
   - **Why it's unanswered:** this session can't reach Shadow. The gateway answers 403 to `CONNECT mcp.shadow.co:443`. I used Shadow's MCP connector here for field discovery, but that connection runs through Claude's own MCP proxy, so it tells us nothing about server-to-server auth.
   - **Next step:** run `npm run shadow:probe` on a machine with network access and send me the output. It's unauthenticated and prints the OAuth metadata: grant types, dynamic client registration, and whether `refresh_token` / `client_credentials` are advertised. It ends with a verdict for options 1, 2 or 3.
     - **If refresh tokens are offered (option 2):** run `--mode=login` once, then `--mode=refresh` to prove a browserless renewal.
     - **If neither is offered:** that's option 3, and you contact the Shadow team.
     - **Alternative:** add `mcp.shadow.co` to this environment's allowed domains and I'll run the probe from here (the browser login step still needs you).
   - **Design note:** if Shadow **rotates** refresh tokens, the cron has to persist the new token every run. Vercel env vars are read-only at runtime, so the token would live in storage (a private Blob object or KV), seeded from `SHADOW_REFRESH_TOKEN`.

2. **Google Search installs: metric definition (needs your call).**
   - **What the dashboard uses today:** the export's install-specific **"Installs"** column for Search, not "Conversions". Oct 1–18 that's 161 installs vs 311 conversions; Oct 18 it's 9 vs 107. The Exec total (32,141) and the Paid Search "Conversions" KPI both use it.
   - **What Shadow has:** only `google_ads_conversions`, which covers all conversion actions. Shadow doesn't break conversions out by action.
   - **Options:**
     - (a) Ask Shadow to expose conversions by action.
     - (b) Pull Search conversions by action from the Google Ads API directly, as a small extra adapter.
     - (c) Count all conversions. Search CPA would drop 2–10×.
   - **Recommendation:** (a), with (b) as the fallback. (c) changes a metric definition.
   - **Google App:** all conversions equal installs today (1,593 vs 1,576 on Oct 18, with the difference being late data). I'll use them and note the assumption.

3. **Apple Search Ads (needs credentials).**
   - **What's there:** Shadow syncs `apple_ads` every 12 hours, with data from Sep 20 and no gaps. But `query_data` has no Apple platform, and no other tool returns its rows.
   - **What I need:**
     - Ask Shadow whether they'll expose it.
     - Meanwhile, Apple Search Ads API v5 credentials for the Hark org: client ID, team ID, key ID, the ES256 private key, and org ID. They're created under the Apple Ads account's API settings by a user with API access.
   - **Fallback:** the `apple` adapter uses the client-credentials JWT flow and runs headless.

4. **Vercel plan (paid feature, asking first).**
   - **The limit:** Hobby runs cron jobs at most **once a day**, and a `0 */2 * * *` schedule fails to deploy on Hobby. A 2-hour cron needs **Pro**, which allows per-minute schedules.
   - **The question:** which plan is the Darkroom team on, or should the project go on one that is?

5. **Metrics Shadow can't source as defined** (full list in `gaps.md`). Seeded history keeps its values either way. The question is how Shadow-era days display:
   - **Meta 3-second plays per ad:** Shadow only has the account-day total, repeated on every ad row. That breaks **hook rate, hold rate and cost per 1K 3-second plays** by ad, ad set and campaign. Shares, saves and comments are missing too.
   - **TikTok campaign reach and frequency:** ad-level reach summed overstates Evergreen by 46%. TikTok "Custom Engagements" is missing.
   - **Proposal:** show "—" with a tooltip and ask Shadow for per-ad 3-second views, campaign-level TikTok reach, and Meta action breakdowns.

## Where the reference differs from the brief

| Brief says                                    | Reference actually has                                                                                                                                                                 | What I did / plan                                                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React 18                                      | **React 19.3.0** and Recharts 3 (redux-based)                                                                                                                                          | Next.js 16.4 + React 19.3 + Recharts 3.10 to match. Staying on React 18 would have pinned us to Next 14.2                                                 |
| 4 views                                       | **6 tabs**: Executive summary · App (sub-tabs _Google vs Apple_, _Apple Search Ads_, _Google App_) · Paid Search (Google Search only) · Paid Social · High Impact · Data & methodology | Port all six as they are. Nothing dropped. Apple keywords, the no-impressions toggle, budget pacing and install quality live under App → Apple Search Ads |
| Paid Social "by placement"                    | "By placement" is the **High Impact** view (YouTube Masthead vs TikTok TopView). Meta has no placement view                                                                            | Port as is. Meta placement is empty in Shadow anyway                                                                                                      |
| Date presets 1D…All                           | Also a **Custom** range                                                                                                                                                                | Port it                                                                                                                                                   |
| Google clicks implied (`clicksImplied: true`) | Every row in `uploads.json` already has real clicks (`clicksImplied: false`)                                                                                                           | No data change. Glossary still gets the edit                                                                                                              |
| "Search conversions count as installs"        | Uses the export's "Installs" column (see decision 2)                                                                                                                                   | Pending decision                                                                                                                                          |
| Oct 18 dashboard Google total $108,789.54     | $108,788.54                                                                                                                                                                            | —                                                                                                                                                         |

## Time zone

Shadow reports `bind.window.tz = America/New_York`, but that's only used to resolve relative windows. Row dates are the platforms' own reporting days: TopView ties to the cent on a $393K day, which rules out re-bucketing. The refresh always sends explicit dates. The dashboard's "Time zone" note will say dates are each ad account's reporting day.

**Still to confirm:** the accounts' configured time zones, which aren't exposed. I'll also need them to decide which "today" counts as a partial day to leave out.

## What's in the repo

- `CLAUDE.md`: the brief, with a short Phase 0 note at the top.
- Scaffold: `app/` (placeholder page, `globals.css` extracted verbatim, theme pre-paint script, `noindex` + `X-Robots-Tag`), strict `tsconfig.json`, `eslint.config.mjs`, Prettier, `vitest.config.ts`, `.env.example`, `.gitignore` (tokens, `.env*.local`, `.probe/`).
- `scripts/serve-reference.ts`: injects `uploads.json` (escaped like `Code.gs`) and stubs `google.script.run` as a chainable no-op. Has a test.
- `scripts/capture-reference.ts`: clock frozen at the export's `generatedAt`. Covers 8 views (6 tabs, App expanded into 3 sub-tabs) × light/dark × desktop 1440 / mobile 390. Desktop also gets a `--charts` or `--tables` variant that flips every Chart/Table card. That's 46 PNGs in `reference/screens/` (21 MB).
- `scripts/shadow-probe.ts`: modes `discover` · `api-key` · `client-credentials` · `login` (PKCE + dynamic registration, local callback on :8976) · `refresh` (headless). It always passes `workspace: "Hark"`. Tokens go to the gitignored `.shadow-tokens.json` and are never printed. Typechecks, but **hasn't run against Shadow** (see blocker 1).
- `docs/shadow-fields.md` (observed columns, grain, reconciliation and proposed mappings) and `docs/gaps.md`.

**Housekeeping:**

- Playwright is pinned to 1.56.1 to match the Chromium build in this environment. Run `npx playwright install chromium` locally.
- `npm audit` reports a `braces` advisory in ESLint's dev-only dependency tree, with no fixed version upstream. It isn't shipped.

## Not done in Phase 0 (by design)

- **No adapters or mapper fixtures yet:** fixtures will be recorded by the probe once auth works.
- **No data layer, Blob, cron or middleware:** those are Phase 1 and Phase 3.
- **No Phase 0 PR:** the GitHub repo had no commits and no `main` branch, so there's no base to open a PR against. The branch is pushed. Should I create `main` from it, or will you?
