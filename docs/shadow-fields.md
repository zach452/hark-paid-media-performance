# Shadow fields (observed, workspace `Hark`)

Recorded on 2026-10-19 by running `query_data` with `workspace: "Hark"` through the Shadow MCP connector. Column lists below are copied from Shadow's own validation errors, which list every exposed column when you pass an unknown one. Treat them as the full list. Nothing here is guessed. Each mapping is checked against `reference/data/uploads.json` for **2026-10-18** unless noted.

Common to every response: `groups[]` holds one object per group, with metric keys named `sum_<column>` (or `max_`, …). `summary.total_<column>` covers the whole window. Other keys: `bind.window.tz` (always `America/New_York` so far), `coverage {min_date, max_date, days_present, days_expected}` and `page {total, returned, truncated}`. Shadow also adds derived ratios (`ctr`, `cpm`, `cpc`, `cpa`, `hook_rate`) to each group. **We don't use them.** Ratios are recomputed from sums (§4 metric rules). The tool text is wrapped as `{"result": "<json>\n\n_Workspace: Hark_"}`.

## Sync and coverage (`list_integrations`)

| Connection                  | Shadow id (internal)                   | Coverage in Shadow      | Sync cadence                                        |
| --------------------------- | -------------------------------------- | ----------------------- | --------------------------------------------------- |
| Google Ads `Hark Labs`      | `daaf41dc-34ea-4cef-bd54-1e1673215ffd` | 2026-10-06 → today      | hourly; each run re-pulls the last 7 days           |
| TikTok Ads `Hark Labs Inc`  | `f30da2ea-60f0-4142-b4fb-d92bfe8e288b` | 2026-10-12 → today      | —                                                   |
| Meta Ads `1120863680422998` | `bcb9cc03-fe51-4190-ad00-5d7a1480ab51` | 2026-10-14 → today      | —                                                   |
| Apple Ads `Hark Labs_ads`   | `d98a5e8b-60ba-4917-8e9c-4e8f44e35dd8` | 2026-09-20 → 2026-10-19 | every 12 hours. **Not queryable** (see Apple below) |

## Time zone

- `bind.window.tz` is `America/New_York` on every call. Shadow uses it to resolve relative windows ("yesterday", "l7_days"). We always send explicit `start_date`/`end_date`, so it doesn't affect us.
- The `date` column is the **platform's own reporting date** (account time zone). Shadow does not re-bucket rows into New York time. Evidence: TikTok TopView on Oct 18 ($393,121.19, 39.6M impressions in one day) ties to the cent with the TikTok export. Google's Oct 18 Masthead ties within $0.25. A one-hour re-bucketing would move thousands of dollars on those days.
- The account time zones themselves aren't exposed through Shadow. The dashboard's "Time zone" note should say: _dates are each platform's account reporting day, as the platform reports them_. **To confirm with Darkroom:** each ad account's time zone setting (Apps Script ran in America/Chicago, but that only affected the upload timestamp).

---

## Google Ads

### `google_ads` / `campaigns` → resolves to `google_ads_daily`

**Groupable:** `google_ads_currency, campaign_id, campaign_name, ad_group_id, ad_group_name, ad_id, ad_name, google_ads_device, google_ads_geo_target_location, google_ads_segment_hour_of_day, google_ads_segment_day_of_week, google_ads_bid_strategy_type, google_ads_brand_vs_non_brand, google_ads_campaign_status, date`

**Metrics:** `updated_at, google_ads_campaign_status, google_ads_spend, google_ads_revenue, google_ads_impressions, google_ads_clicks, google_ads_conversions, google_ads_conversion_value, google_ads_profit, google_ads_view_through_conversions, google_ads_video_views, google_ads_engagements, ncac_google_ads, amer_google_ads`

**Grain:** several records per ad group per day (`record_count` 3–6 per ad-group-day, likely device/segment splits). Always aggregate with `group_by: [date, campaign_id, campaign_name, ad_group_id, ad_group_name]`. Oct 18 = 39 ad-group rows, not truncated.

**Not exposed:** campaign type (`advertising_channel_type`), ad group type, conversions by conversion action, campaign daily budget. `google_ads_campaign_status` came back `null` for every campaign. `google_ads_currency` is `null` (`currency.status: "unknown"`).

**Reconciliation, Oct 18 (Shadow vs dashboard):**

| Campaign (→ channel)                                 | Spend                        | Impr.                  | Clicks           | Conversions                |
| ---------------------------------------------------- | ---------------------------- | ---------------------- | ---------------- | -------------------------- |
| Google App (→ `google`)                              | 24,726.55 vs 24,697.44       | 1,291,997 vs 1,290,959 | 48,395 vs 48,342 | 1,593 vs 1,576 installs    |
| Brand Search Max Clicks Uncapped. (→ `search`)       | 1,638.00 vs 1,632.95         | 1,322 vs 1,322         | 343 vs 342       | 23 vs conv 22 (installs 5) |
| Search_NB_Scale (→ `search`)                         | 28,596.99 vs 28,596.99       | 60,298 vs 60,298       | 6,491 vs 6,491   | 85 vs conv 85 (installs 4) |
| Video - Masthead (reservation) - 2026-10-16 (→ `hi`) | 53,860.91 vs 53,861.16       | 3,376,859 vs 3,376,875 | 562 vs 562       | 79 vs conv 79              |
| **Total**                                            | **108,822.45 vs 108,788.54** |                        |                  |                            |

The small gaps on Google App and Brand Search are late data (Shadow re-synced after the export). Real clicks and impressions exist, so `clicksImplied: false`. The current uploads already had real clicks: `clicksImplied` is `false` on every row of `uploads.json`.

**Proposed mapping → `Row`** (Phase 1, to confirm):

| Row field                                     | Source                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `date`                                        | `date`                                                                                                       |
| `campaignId`, `campaign`                      | `campaign_id`, `campaign_name`                                                                               |
| `adGroup`                                     | `ad_group_name` (Masthead: same as campaign, as in the export)                                               |
| `channel`                                     | `HkCh(campaign_name, adGroupType=null, campaignType)`. See "campaign type" below                             |
| `theme`                                       | `HkTh(ad_group_name, campaign_name, channel)`                                                                |
| `spend`, `impressions`, `clicks`              | `sum_google_ads_spend`, `sum_google_ads_impressions`, `sum_google_ads_clicks`                                |
| `conv`                                        | `sum_google_ads_conversions` (all conversions; matches the export's "Conversions")                           |
| `installsReported`, `installsTap`             | App: `sum_google_ads_conversions`. Search: **blocked**, see below                                            |
| `installsView`                                | `sum_google_ads_view_through_conversions`                                                                    |
| `bidStrategy`                                 | `google_ads_bid_strategy_type` (e.g. `TARGET_CPA`, `TARGET_SPEND`, `FIXED_CPM`). The export left this `null` |
| `status`, `dailyBudget`                       | not available. `null` (export had ad-group status "Enabled"/"Paused")                                        |
| `newDownloads`, `redownloads`, `inAppActions` | `null` (as in the export)                                                                                    |

**Campaign type.** `HkCh` takes the campaign type from the export. Shadow doesn't expose it, so the classifier falls back to campaign names. That works for every campaign with spend today ("Google App" → `google`, `*Search*` → `search`, `*Masthead*` → `hi`). It fails for the `Test` campaign (currently $0), which the export marked Search. Proposed fix: treat a campaign as `Search` when it appears in `google_ads_keywords`. Only Search campaigns have keyword rows; checked over Oct 6–18, the 11 campaigns in that table are all `search`. Flagged in `docs/gaps.md`.

**Search installs (blocker, see phase0.md).** The dashboard's Search "installs" come from the export's **"Installs"** column, not "Conversions". Oct 1–18: 161 installs vs 311 conversions; Oct 18: 9 vs 107. The Exec install total (32,141) and the Paid Search "Conversions" KPI (161) both use the "Installs" figure. Shadow only has `google_ads_conversions` (all conversion actions), so Search installs would roughly double or more. That changes a metric definition, so it needs a decision.

### `google_ads` / `keywords` → `google_ads_keywords`

**Groupable:** `date, keyword_id, keyword_text, match_type, keyword_status, ad_group_id, ad_group_name, campaign_id, campaign_name, customer_id, expected_ctr, ad_relevance, landing_page_experience`

**Metrics:** `updated_at, cost_micros, impressions, clicks, conversions, quality_score`

Search campaigns only. The dashboard has no Google keyword view, so this table is used only as the campaign-type signal above.

### `google_ads` / `ads`

Not probed in detail. The dashboard has no Google ad-level view.

---

## TikTok Ads

### `tiktok_ads` / `campaigns` (also `adgroups`, `ads`) → `tiktok_ads_daily`

**Groupable:** `date, ad_id, advertiser_id, ad_name, campaign_id, campaign_name, adgroup_id, adgroup_name, tiktok_ads_campaign_status, tiktok_ads_call_to_action, tiktok_ads_image_mode, ad_text, tiktok_ads_is_smart_creative, ad_url, ad_profile_image, tiktok_ads_currency`

**Metrics:** `updated_at, tiktok_ads_campaign_status, tiktok_ads_spend, tiktok_ads_billed_cost, tiktok_ads_impressions, tiktok_ads_gross_impressions, tiktok_ads_reach, tiktok_ads_frequency, tiktok_ads_clicks, tiktok_ads_ctr, tiktok_ads_cpc, tiktok_ads_cpm, tiktok_ads_cost_per_1000_reached, tiktok_ads_conversion, tiktok_ads_cost_per_conversion, tiktok_ads_conversion_rate, tiktok_ads_real_time_conversion, tiktok_ads_result, tiktok_ads_cost_per_result, tiktok_ads_result_rate, video_play_actions, video_watched_2s, video_watched_6s, video_views_p25, video_views_p50, video_views_p75, video_views_p100, average_video_play, average_video_play_per_user, engaged_view, paid_engaged_view, engaged_view_15s, onsite_purchases_roas, onsite_total_purchase, onsite_cost_per_purchase, onsite_purchase_rate, onsite_total_purchase_value, onsite_unique_purchase, onsite_value_per_purchase, onsite_cost_per_unique_purchase, onsite_total_purchase_value_day0, onsite_total_purchase_value_day6, onsite_total_purchase_value_day13, onsite_total_purchase_value_calendar_day0, onsite_total_purchase_value_calendar_day6, onsite_total_purchase_value_calendar_day13, onsite_total_purchase_roas_day0, onsite_total_purchase_roas_day6, onsite_total_purchase_roas_day13, onsite_total_purchase_roas_calendar_day0, onsite_total_purchase_roas_calendar_day6, onsite_total_purchase_roas_calendar_day13, paid_engagement_engaged_view, paid_engaged_view_15s, paid_engagement_engaged_view_15s, tiktok_ads_real_time_cost_per_conversion, tiktok_ads_real_time_conversion_rate, tiktok_ads_real_time_conversion_rate_v2, tiktok_ads_conversion_rate_v2, tiktok_ads_real_time_result, tiktok_ads_cost_per_result, tiktok_ads_secondary_goal_result, tiktok_ads_cost_per_secondary_goal_result, tiktok_ads_secondary_goal_result_rate`

All three table names resolve to the same ad-level daily table. **Grain:** one record per ad per day (Evergreen had 6 ads, TopView 1).

**Reconciliation, Oct 18 (dashboard row in brackets):**

| Campaign                                       | Spend                   | Impr.                   | Clicks                | Reach                                 | 6s views              | 100% views        |
| ---------------------------------------------- | ----------------------- | ----------------------- | --------------------- | ------------------------------------- | --------------------- | ----------------- |
| HARK_SOC_TIKTOK_TOPVIEW_102026 (→ `hi`)        | 393,121.19 [393,121.19] | 39,596,464 [39,596,450] | 1,383,312 [1,383,312] | 13,154,418 [13,154,418]               | 1,941,944 [1,941,944] | 393,293 [393,293] |
| HARK_SOC_TIKTOK_TRAFFIC_EVERGREEN (→ `tiktok`) | 7,006.22 [7,006.22]     | 949,665 [949,665]       | 11,312 [11,312]       | **929,972 summed over ads [637,289]** | 62,936 [62,936]       | 25,824 [25,824]   |

Oct 17 TopView $96,312.81 + Oct 18 $393,121.19 = $489,434.00, which equals the dashboard's TopView total. Oct 16 is $0 in both.

**Proposed mapping → `Row`:** `spend` ← `tiktok_ads_spend`; `impressions` ← `tiktok_ads_impressions`; `clicks` ← `tiktok_ads_clicks` (ties to the export's "Clicks (destination)"); `views6s` ← `video_watched_6s`; `v100` ← `video_views_p100`; `vcr` ← `v100 ÷ video_play_actions`, which reproduces the export's "Video Completion Rate" (0.0277 and 0.0103); `channel`/`platform` from `/topview/i` on `campaign_name`, as in the parser. `campaignId` ← `campaign_id` (the export had `null`).

**Can't be sourced as the export had them:**

- `reach` / `freqD` at **campaign** level. Shadow's reach is per ad, and reach isn't additive. Summing ads overstates Evergreen reach by 46% (929,972 vs 637,289). It's correct for TopView only because that campaign has a single ad. `freqD` (campaign frequency, 1.49) can't be rebuilt either.
- `eng` = the export's **"Custom Engagements"** (987 Evergreen, 19,161 TopView). Shadow's `engaged_view` (65,121 / 2,272,273) is a different metric.

---

## Meta Ads

### `meta_ads` / `ads` (also `adsets`, `campaigns`, `creatives`) → `meta_ads_daily`

**Groupable:** `meta_currency, campaign_id, campaign_name, ad_id, adset_id, adset_name, ad_name, attribution_setting, meta_attribution_window_setting, bid_strategy, meta_campaign_status, meta_adset_status, meta_ads_placement, date, optimization_goal, custom_audience_id, special_ad_categories`

**Metrics:** `updated_at, meta_spend, meta_revenue, meta_impressions, meta_outbound_clicks, meta_purchases, meta_add_to_carts, meta_checkouts_initiated, meta_leads, meta_searches, meta_content_views, meta_link_clicks, meta_clicks, meta_results, meta_purchases_count, meta_purchase_value, meta_initiate_checkouts, meta_landing_page_views, meta_unique_link_clicks, meta_unique_outbound_clicks, meta_estimated_reach, meta_frequency, meta_date_reach, meta_date_frequency, meta_date_video_3s_views, meta_date_video_thruplay, meta_campaign_status, meta_adset_status, meta_budget, meta_daily_budget, meta_lifetime_budget, ncac_meta, amer_meta, video_p25_watched_actions, video_p50_watched_actions, video_p75_watched_actions, video_p95_watched_actions, video_p100_watched_actions, video_15_sec_watched_actions, video_30_sec_watched_actions, video_play_actions, video_thruplay_watched_actions, video_avg_time_watched_actions, meta_action_complete_registration, meta_action_subscribe, meta_action_start_trial, meta_action_add_to_wishlist, meta_action_add_payment_info, meta_action_contact, meta_action_schedule, meta_action_submit_application, meta_action_mobile_app_install, meta_action_post_engagement, meta_action_lead, meta_action_value_purchase, meta_action_value_subscribe, meta_action_value_start_trial`

All four table names resolve to the same table. **Grain:** one record per ad per day. Oct 18 had 31 ads with delivery; the export has 40 rows/day because it includes zero-spend ads.

**Reconciliation, Oct 18, both campaigns summed (dashboard in brackets):**

| `meta.*` field                  | Shadow column                       | Shadow                      | Dashboard                                                    | Verdict                          |
| ------------------------------- | ----------------------------------- | --------------------------- | ------------------------------------------------------------ | -------------------------------- |
| spend                           | `meta_spend`                        | 68,942.74                   | 68,512.07                                                    | ✓ (+0.6%, late data on Traffic)  |
| impressions                     | `meta_impressions`                  | 2,984,909                   | 2,970,064                                                    | ✓                                |
| `reach`                         | `meta_estimated_reach` (per ad)     | 2,443,444                   | 2,427,682                                                    | ✓ (per ad-day, as the export)    |
| `link`                          | `meta_link_clicks`                  | 135,800                     | 135,350                                                      | ✓ (`null` on Engagement → 0)     |
| `clicksAll`                     | `meta_clicks`                       | 144,850                     | 144,359                                                      | ✓                                |
| `lpv`                           | `meta_landing_page_views`           | 124,531                     | 124,531                                                      | ✓ exact                          |
| `eng`                           | `meta_action_post_engagement`       | 374,848                     | 372,828                                                      | ✓                                |
| `plays`                         | `video_play_actions`                | 487,708                     | 481,904                                                      | ✓                                |
| `v25` / `v50` / `v95`           | `video_p25/p50/p95_watched_actions` | 122,648 / 50,558 / 19,999   | 121,887 / 50,227 / 19,877                                    | ✓                                |
| **`v3`**                        | `meta_date_video_3s_views`          | 235,110 **on every ad row** | 233,544 total                                                | ✗ **account-level only**         |
| `results`                       | `meta_results`                      | `null`                      | 233,832                                                      | ✗ null, derive from goal (below) |
| `resultType`                    | —                                   | —                           | `actions:omni_landing_page_view` / `actions:post_engagement` | derive from `optimization_goal`  |
| `shares` / `saves` / `comments` | —                                   | —                           | 96 / 290 / 53                                                | ✗ not exposed                    |
| placement                       | `meta_ads_placement`                | `null` on every row         | (not in export)                                              | ✗ column exists but is empty     |

**3-second plays.** `meta_date_video_3s_views` and `meta_date_reach` hold the **account-day total**, repeated on every ad row (235,110 and 2,040,040 on all 31 rows). Summing them multiplies by the ad count. That's why Shadow's own `hook_rate` reads 98.5%. Hook rate and hold rate per campaign, ad set or ad **can't be built** from Shadow today. The account-day total is usable for an account-level hook rate only.

**Objective.** Not a column. Two candidate sources, both observed:

- `optimization_goal`: `POST_ENGAGEMENT` for HARK_SOC_META_ENGAGEMENT_BOOSTED and `LANDING_PAGE_VIEWS` for HARK_SOC_META_TRAFFIC_EVERGREEN.
- The campaign name token: `_ENGAGEMENT_` and `_TRAFFIC_`.

The export's "Objective" values are `Engagement` and `Traffic`. Proposed: a fixed map from optimization goal to objective (`LANDING_PAGE_VIEWS`/`LINK_CLICKS` → Traffic, `POST_ENGAGEMENT`/`THRUPLAY` → Engagement, `APP_INSTALLS` → App promotion), with the campaign-name token as the fallback.

**Results and install rows (port of `noInstall:!inst`).** Shadow doesn't return a result indicator. Proposed rule:

- `resultType`: from `optimization_goal`. `LANDING_PAGE_VIEWS` → `actions:omni_landing_page_view` (results = `lpv`), `POST_ENGAGEMENT` → `actions:post_engagement` (results = `eng`), `APP_INSTALLS` → `actions:mobile_app_install` (results = `meta_action_mobile_app_install`).
- `inst`: true only for `APP_INSTALLS`. Today no Meta campaign optimises for installs, so every Meta row stays `noInstall: true`, same as the export.

**Status.** The export's `status` is the ad's "Ad delivery" (`active`/`inactive`). Shadow has campaign and ad set status, not ad status.

---

## Apple Search Ads

- `query_data`'s `platform` enum is `shopify, meta_ads, google_ads, tiktok_ads, tiktok_shop, klaviyo, google_analytics, amazon_ads, pinterest, triplewhale, blended`. There is **no Apple option**.
- The `apple_ads` connection exists and syncs every 12 hours (data health: 2026-09-20 → 2026-10-19, no gaps). No other Shadow tool returns its rows: `period_summary`, `flight_plan` and `blended` cover Shopify, Meta, Google, TikTok, Klaviyo and GA4 only.
- **Path:** ask Shadow to expose `apple_ads` in `query_data`. Meanwhile, build the `apple` adapter on the Apple Search Ads Campaign Management API v5. Its client-credentials flow uses an ES256-signed JWT and runs headless. Credentials are needed (see phase0.md).
