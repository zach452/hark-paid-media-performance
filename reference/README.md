# Hark Paid Media Dashboard: code + data export (snapshot Oct 19, 2026)

Snapshot of the live dashboard. Data covers Oct 1–18, 2026 (Meta goes back to Sep 19). Nothing in the live dashboard was changed to make this.

## Files
- app/Index.html: the full dashboard front end (React, single file). Everything is in it: UI, file parsers (Google Ads ad-group xlsx, Apple Ads campaign/keyword xlsx, Meta Ads Manager CSV, TikTok campaign xlsx), merge/dedup logic, and metric math.
- backend/Code.gs: Google Apps Script web app. It serves Index.html from Drive, checks the ?k= access key (redacted here), and loads/saves the uploads JSON plus the "Hark Paid Media Data" Sheet.
- backend/appsscript.json: the Apps Script manifest.
- data/uploads.json: the full dataset the dashboard loads ({rows: campaign-day rows, keywords: Apple keyword-day rows, sources, warnings}).
- data/campaign_daily.csv: `rows`, flattened. Meta fields are prefixed meta_, TikTok/High Impact fields are columns.
- data/keyword_daily.csv: Apple Search Ads keyword-day rows.

## Data model (campaign_daily)
- channel: apple | google (Google App) | search (Google Search) | meta | tiktok (TikTok non-TopView) | hi (High Impact: YouTube Masthead + TikTok TopView, via platform)
- spend, impressions, clicks, installsReported / installsTap / installsView
- noInstall=true means the row adds to spend but is excluded from installs/CPI (Meta, TikTok, High Impact).
- CPI = install-goal spend ÷ installs. Google daily exports have no impressions; Google clicks = installs ÷ conv. rate (clicksImplied=true).
- Search conversions count as installs in Exec totals.
- Apple Brand installs are mostly view-through + redownloads, so judge Apple on non-brand / tap-through CPI.
- The TikTok TopView in hi uses its real daily split (Oct 17–18). Partial same-day rows were left out.

## Using it in Claude
Upload data/campaign_daily.csv (and keyword_daily.csv) for analysis, or app/Index.html to edit the UI. Outside Apps Script the page has no google.script.run backend, so ask Claude to stub that and load uploads.json locally.
