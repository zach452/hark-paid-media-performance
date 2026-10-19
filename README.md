# Hark · Paid Media Performance

Darkroom's client dashboard for Hark (Hark Pro, US). It's a Next.js port of the Apps Script dashboard in `reference/`. Data refreshes from Shadow every 2 hours instead of manual exports. The full brief is in [`CLAUDE.md`](CLAUDE.md).

**Status: Phase 0 (setup and spikes).** See [`docs/phase0.md`](docs/phase0.md) for findings and open decisions.

## Layout

| Path                           | What                                                                        |
| ------------------------------ | --------------------------------------------------------------------------- |
| `app/`                         | Next.js App Router (React 19). `globals.css` is the reference CSS, verbatim |
| `lib/`                         | Data layer (Phase 1)                                                        |
| `scripts/serve-reference.ts`   | Serves the original build with `uploads.json` injected, for visual parity   |
| `scripts/capture-reference.ts` | Screenshots every view of the original into `reference/screens/`            |
| `scripts/shadow-probe.ts`      | Shadow MCP auth spike: discover, connect, list tools, run one `query_data`  |
| `reference/`                   | The exported original: bundle, Apps Script backend, dataset, screenshots    |
| `docs/`                        | `phase0.md`, `shadow-fields.md` (observed Shadow columns), `gaps.md`        |

## Scripts

```bash
npm install
npm run dev                 # app on http://localhost:3000
npm run reference:serve     # original dashboard on http://localhost:4173
npm run reference:screens   # regenerate reference/screens/ (needs Playwright's Chromium: npx playwright install chromium)
npm run shadow:probe        # Shadow auth discovery; see the modes at the top of the script
npm run lint && npm run typecheck && npm test
```

## Environment variables

Set these in `.env.local` locally and in the Vercel project settings for deployments. Never commit values. `.env.example` lists them all.

| Name                                                                                    | Used by              | Notes                                                                                                                   |
| --------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `SHADOW_MCP_URL`                                                                        | refresh, probe       | Default `https://mcp.shadow.co`                                                                                         |
| `SHADOW_WORKSPACE`                                                                      | refresh, probe       | `Hark`. Passed explicitly on every call                                                                                 |
| `SHADOW_API_KEY`                                                                        | refresh, probe       | Only if Shadow issues API keys (auth option 1)                                                                          |
| `SHADOW_OAUTH_CLIENT_ID`, `SHADOW_OAUTH_CLIENT_SECRET`                                  | refresh, probe       | Client-credentials or registered OAuth client (options 1b/2)                                                            |
| `SHADOW_REFRESH_TOKEN`                                                                  | refresh, probe       | Seed refresh token from the one-time login (option 2). If Shadow rotates it, the live copy is kept in storage, not here |
| `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_ORG_ID` | refresh              | Apple Search Ads API v5 fallback (Shadow can't query Apple yet)                                                         |
| `BLOB_READ_WRITE_TOKEN`                                                                 | refresh, read path   | Vercel Blob store holding `dataset.json` / `dataset.prev.json`                                                          |
| `CRON_SECRET`                                                                           | `/api/cron/refresh`  | Bearer token Vercel Cron sends                                                                                          |
| `ACCESS_KEYS`                                                                           | middleware           | Comma-separated client link keys (`?k=`)                                                                                |
| `ADMIN_KEY`                                                                             | `/api/admin/refresh` | Darkroom staff only                                                                                                     |
