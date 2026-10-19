/*
 * Data layer for the Hark dashboard artifact: everything comes from Shadow.
 *
 * The page carries no exported data. It pulls Google Ads, Meta and TikTok from the viewer's
 * Shadow connector (query_data), maps the rows into the dashboard's own Dataset shape, and
 * hands the result to the app through window.__harkSet. History is fetched from HISTORY_START
 * in calendar-month chunks; the chunk that holds the last 14 days refreshes every 2 hours,
 * because Shadow re-syncs about 7 days back each hour and late conversions land.
 *
 * Field names below are the ones observed in Shadow responses (docs/shadow-fields.md).
 * The pure helpers are exposed as HarkLive for the tests; boot() runs only in a viewer.
 */
(function (root) {
  'use strict';

  var SERVER = 'Shadow';
  var TOOL = 'query_data';
  var WORKSPACE = 'Hark';
  // The program's first day; the dashboard never shows a range before it.
  var HISTORY_START = '2026-10-01';
  var RECENT_DAYS = 14; // Shadow re-syncs about 7 days back; late conversions land
  var REFRESH_MS = 2 * 60 * 60 * 1000;
  // A day counts as closed once it has ended in the westernmost US time zone.
  var CLOSE_TZ = 'America/Los_Angeles';

  // ---- Ported verbatim from the reference bundle (te / ne / HkTh / HkCh / C) ----------------

  var THEME_RULES = [
    [/brand|\bhark\b/i, 'Brand'],
    [/compet/i, 'Competitors'],
    [/business|b2b|enterprise/i, 'Business'],
    [/discover|explor/i, 'Discovery'],
    [/assistant|\bai\b|\bagent/i, 'AI Assistant'],
  ];

  function ne() {
    for (var i = 0; i < arguments.length; i++) {
      var t = arguments[i];
      if (t)
        for (var j = 0; j < THEME_RULES.length; j++) if (THEME_RULES[j][0].test(t)) return THEME_RULES[j][1];
    }
    return 'Other';
  }

  function HkTh(u, l, h) {
    if (h !== 'search') return ne(u, l);
    if (/brand/i.test(l) && !/_nb_|_nb\b|non.?brand/i.test(l)) return 'Brand';
    var t = /conquest|compet|alternative|grok|chatgpt|gemini|perplexity|claude|copilot/i.test(l)
      ? 'Competitors'
      : ne(u, l);
    return t === 'Brand' ? 'Other' : t;
  }

  function C(e) {
    return e == null || (typeof e === 'string' && e.trim() === '') ? '' : String(e).trim();
  }

  function HkCh(l, t, c) {
    var x = C(t);
    var y = C(c);
    return /masthead/i.test(x) || /masthead|topview/i.test(l)
      ? 'hi'
      : /search/i.test(y) || /^standard$/i.test(x) || (/search/i.test(l) && !/app/i.test(y))
        ? 'search'
        : 'google';
  }

  // ---- Small helpers --------------------------------------------------------------------------

  function num(v) {
    var n = Number(v);
    return v == null || !isFinite(n) ? 0 : n;
  }
  function round(v, dp) {
    var f = Math.pow(10, dp);
    return Math.round(v * f) / f;
  }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function todayIn(tz, now) {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now || new Date());
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDay(iso) {
    return MONTHS[Number(iso.slice(5, 7)) - 1] + ' ' + Number(iso.slice(8, 10));
  }

  /** query_data answers {"result": "<json>\n\n_Workspace: Hark_"}; accept that or bare JSON. */
  function parsePayload(result) {
    var isEnvelope = result && typeof result === 'object' && ('payload' in result || 'content' in result);
    var p = isEnvelope ? result.payload : result;
    if (p == null && isEnvelope && Array.isArray(result.content)) {
      var block = result.content.find(function (b) {
        return b && b.type === 'text';
      });
      p = block ? block.text : null;
    }
    // Unwrap up to twice: a text block holding {"result": "<json>…"} needs both steps.
    for (var pass = 0; pass < 2; pass++) {
      if (p && typeof p === 'object' && typeof p.result === 'string') p = p.result;
      if (typeof p !== 'string') break;
      var start = p.indexOf('{');
      var end = p.lastIndexOf('}');
      if (start < 0 || end < start) throw new Error('Shadow sent an answer the page could not read');
      p = JSON.parse(p.slice(start, end + 1));
    }
    if (!p || typeof p !== 'object') throw new Error('Shadow sent an empty answer');
    if (p.found === false && p.error) throw new Error(String(p.error));
    return p;
  }

  // ---- Queries ----------------------------------------------------------------------------------

  function sums(cols) {
    var a = {};
    cols.forEach(function (c) {
      a[c] = ['sum'];
    });
    return a;
  }

  var QUERIES = {
    google: function (from, to) {
      return {
        workspace: WORKSPACE,
        platform: 'google_ads',
        table: 'campaigns',
        start_date: from,
        end_date: to,
        group_by: ['date', 'campaign_id', 'campaign_name', 'ad_group_id', 'ad_group_name'],
        aggregations: sums([
          'google_ads_spend',
          'google_ads_impressions',
          'google_ads_clicks',
          'google_ads_conversions',
          'google_ads_view_through_conversions',
        ]),
        order_by: [{ column: 'date', direction: 'ASC' }],
        limit: 5000,
      };
    },
    // Only Search campaigns have keyword rows; Shadow exposes no campaign type.
    searchCampaigns: function (from, to) {
      return {
        workspace: WORKSPACE,
        platform: 'google_ads',
        table: 'keywords',
        start_date: from,
        end_date: to,
        group_by: ['campaign_id'],
        aggregations: sums(['impressions']),
        limit: 1000,
      };
    },
    meta: function (from, to) {
      return {
        workspace: WORKSPACE,
        platform: 'meta_ads',
        table: 'ads',
        start_date: from,
        end_date: to,
        group_by: [
          'date',
          'campaign_id',
          'campaign_name',
          'adset_name',
          'ad_id',
          'ad_name',
          'optimization_goal',
        ],
        aggregations: sums([
          'meta_spend',
          'meta_impressions',
          'meta_estimated_reach',
          'meta_link_clicks',
          'meta_clicks',
          'meta_landing_page_views',
          'meta_action_post_engagement',
          'meta_action_mobile_app_install',
          'video_play_actions',
          'video_p25_watched_actions',
          'video_p50_watched_actions',
          'video_p95_watched_actions',
        ]),
        order_by: [{ column: 'date', direction: 'ASC' }],
        limit: 5000,
      };
    },
    // Shadow has 3-second plays only as a daily account total (the same value on every ad row),
    // so ask for it once per day.
    metaDaily: function (from, to) {
      return {
        workspace: WORKSPACE,
        platform: 'meta_ads',
        table: 'ads',
        start_date: from,
        end_date: to,
        group_by: ['date'],
        aggregations: { meta_date_video_3s_views: ['max'] },
        order_by: [{ column: 'date', direction: 'ASC' }],
        limit: 400,
      };
    },
    tiktok: function (from, to) {
      return {
        workspace: WORKSPACE,
        platform: 'tiktok_ads',
        table: 'campaigns',
        start_date: from,
        end_date: to,
        group_by: ['date', 'campaign_id', 'campaign_name'],
        aggregations: sums([
          'tiktok_ads_spend',
          'tiktok_ads_impressions',
          'tiktok_ads_clicks',
          'tiktok_ads_reach',
          'video_watched_6s',
          'video_views_p100',
          'video_play_actions',
        ]),
        order_by: [{ column: 'date', direction: 'ASC' }],
        limit: 2000,
      };
    },
  };

  // ---- Mappers: Shadow groups → dashboard rows -------------------------------------------------

  function searchIdSet(body) {
    var ids = new Set();
    (body && body.groups ? body.groups : []).forEach(function (g) {
      if (g.campaign_id != null) ids.add(String(g.campaign_id));
    });
    return ids;
  }

  function mapGoogle(body, searchIds) {
    return (body.groups || []).map(function (g) {
      var campaign = C(g.campaign_name);
      var adGroup = C(g.ad_group_name) || null;
      var campaignId = g.campaign_id == null ? null : String(g.campaign_id);
      var channel = HkCh(campaign, '', campaignId && searchIds.has(campaignId) ? 'Search' : '');
      var conv = num(g.sum_google_ads_conversions);
      var row = {
        date: g.date,
        channel: channel,
        campaignId: campaignId,
        campaign: campaign,
        adGroup: adGroup,
        theme: HkTh(adGroup, campaign, channel),
        status: null,
        dailyBudget: null,
        bidStrategy: null,
        spend: round(num(g.sum_google_ads_spend), 2),
        impressions: num(g.sum_google_ads_impressions),
        clicks: num(g.sum_google_ads_clicks),
        clicksImplied: false,
        // App campaigns: all conversions are the install action today (docs/gaps.md #2).
        installsReported: conv,
        installsTap: conv,
        installsView: num(g.sum_google_ads_view_through_conversions),
        newDownloads: null,
        redownloads: null,
        inAppActions: null,
        conv: conv,
      };
      // Search installs are all conversions too: the original parser's rule when an export had
      // no "Installs" column (Installs ?? Conversions). Shadow has no install-only split.
      if (channel === 'hi') {
        row.noInstall = true;
        row.platform = 'YouTube Masthead';
        row.installsReported = 0;
        row.installsTap = 0;
        row.installsView = 0;
      }
      return row;
    });
  }

  // Shadow has no result-indicator column, so the result type follows the ad set's
  // optimisation goal (gaps.md #5, #6).
  var META_GOALS = {
    LANDING_PAGE_VIEWS: { objective: 'Traffic', resultType: 'actions:omni_landing_page_view', field: 'lpv' },
    LINK_CLICKS: { objective: 'Traffic', resultType: 'actions:link_click', field: 'link' },
    POST_ENGAGEMENT: { objective: 'Engagement', resultType: 'actions:post_engagement', field: 'eng' },
    APP_INSTALLS: {
      objective: 'App promotion',
      resultType: 'actions:mobile_app_install',
      field: 'appInstalls',
    },
  };
  var META_NAME_OBJECTIVES = [
    [/_TRAFFIC_/i, 'Traffic'],
    [/_ENGAGEMENT_/i, 'Engagement'],
    [/_APP_?INSTALL|_APP_/i, 'App promotion'],
    [/_AWARENESS_|_REACH_/i, 'Awareness'],
  ];

  function mapMeta(body) {
    return (body.groups || []).map(function (g) {
      var campaign = C(g.campaign_name) || '(no campaign)';
      var goal = META_GOALS[C(g.optimization_goal).toUpperCase()] || null;
      var objective = goal ? goal.objective : null;
      if (!objective)
        for (var i = 0; i < META_NAME_OBJECTIVES.length; i++)
          if (META_NAME_OBJECTIVES[i][0].test(campaign)) {
            objective = META_NAME_OBJECTIVES[i][1];
            break;
          }
      var vals = {
        lpv: num(g.sum_meta_landing_page_views),
        link: num(g.sum_meta_link_clicks),
        eng: num(g.sum_meta_action_post_engagement),
        appInstalls: num(g.sum_meta_action_mobile_app_install),
      };
      var rt = goal ? goal.resultType : null;
      var res = goal ? vals[goal.field] : 0;
      // Port of the parser rule: installs only when the result is an install result.
      var inst = !!rt && /app_install|mobile_app_install/i.test(rt);
      return {
        date: g.date,
        channel: 'meta',
        campaignId: g.campaign_id == null ? null : String(g.campaign_id),
        campaign: campaign,
        adGroup: C(g.adset_name) || null,
        ad: C(g.ad_name),
        objective: objective,
        theme: 'Other',
        status: null,
        dailyBudget: null,
        bidStrategy: null,
        spend: round(num(g.sum_meta_spend), 2),
        impressions: num(g.sum_meta_impressions),
        clicks: null,
        clicksImplied: false,
        installsReported: inst ? res : 0,
        installsTap: inst ? res : 0,
        installsView: 0,
        newDownloads: null,
        redownloads: null,
        inAppActions: null,
        noInstall: !inst,
        meta: {
          reach: num(g.sum_meta_estimated_reach),
          link: vals.link,
          clicksAll: num(g.sum_meta_clicks),
          results: res,
          resultType: rt,
          lpv: vals.lpv,
          eng: vals.eng,
          plays: num(g.sum_video_play_actions),
          // Shadow's 3-second plays are an account-day total repeated on every ad (gaps.md #3).
          v3: null,
          v25: num(g.sum_video_p25_watched_actions),
          v50: num(g.sum_video_p50_watched_actions),
          v95: num(g.sum_video_p95_watched_actions),
          shares: null,
          saves: null,
          comments: null,
        },
      };
    });
  }

  function mapTikTok(body) {
    return (body.groups || []).map(function (g) {
      var campaign = C(g.campaign_name);
      var tv = /topview/i.test(campaign);
      var impressions = num(g.sum_tiktok_ads_impressions);
      var plays = num(g.sum_video_play_actions);
      var v100 = num(g.sum_video_views_p100);
      // Reach is per ad and not additive; it is exact only for a single-ad campaign (gaps.md #9).
      var reach = num(g.record_count) === 1 ? num(g.sum_tiktok_ads_reach) : null;
      return {
        date: g.date,
        channel: tv ? 'hi' : 'tiktok',
        platform: tv ? 'TikTok TopView' : 'TikTok',
        campaignId: g.campaign_id == null ? null : String(g.campaign_id),
        campaign: campaign,
        adGroup: null,
        theme: 'Other',
        status: null,
        dailyBudget: null,
        bidStrategy: null,
        spend: round(num(g.sum_tiktok_ads_spend), 2),
        impressions: impressions,
        clicks: num(g.sum_tiktok_ads_clicks),
        clicksImplied: false,
        installsReported: 0,
        installsTap: 0,
        installsView: 0,
        newDownloads: null,
        redownloads: null,
        inAppActions: null,
        noInstall: true,
        reach: reach,
        views6s: num(g.sum_video_watched_6s),
        vcr: plays > 0 ? round(v100 / plays, 4) : null,
        eng: null,
        v100: v100,
        freqD: reach ? round(impressions / reach, 2) : null,
      };
    });
  }

  /**
   * Split each day's account total of 3-second plays across that day's ads, in proportion to
   * each ad's early retention projected back from its 25% and 50% views (2 × p25 − p50; plays,
   * then impressions, when a day has none). Largest-remainder rounding keeps whole numbers that
   * add back to the exact daily total, so any figure over all of Meta stays exact; per-ad and
   * per-objective figures are estimates (meta.v3Est). Backtested against Ads Manager 3-second
   * plays for Oct 14–18: per-ad hook rate within 7.6% spend-weighted (9.5% median), per
   * objective within 10%. Returns whether anything was estimated.
   */
  function allocate3s(rows, dailyBodies) {
    var daily = {};
    (dailyBodies || []).forEach(function (body) {
      ((body && body.groups) || []).forEach(function (g) {
        if (g.date && g.max_meta_date_video_3s_views != null)
          daily[g.date] = num(g.max_meta_date_video_3s_views);
      });
    });
    var byDay = {};
    rows.forEach(function (r) {
      (byDay[r.date] = byDay[r.date] || []).push(r);
    });
    var estimated = false;
    Object.keys(byDay).forEach(function (date) {
      if (!(date in daily)) return; // stays null: hook and hold show — for that day
      var list = byDay[date];
      var total = Math.round(daily[date]);
      var weights = [
        function (r) {
          return 2 * (r.meta.v25 || 0) - (r.meta.v50 || 0);
        },
        function (r) {
          return r.meta.plays;
        },
        function (r) {
          return r.impressions;
        },
      ];
      var w = null;
      var sum = 0;
      for (var i = 0; i < weights.length && !sum; i++) {
        w = weights[i];
        sum = list.reduce(function (t, r) {
          return t + (w(r) || 0);
        }, 0);
      }
      var parts = list.map(function (r) {
        var x = sum ? (total * (w(r) || 0)) / sum : 0;
        return { r: r, n: Math.floor(x), rem: x - Math.floor(x) };
      });
      var left = sum
        ? total -
          parts.reduce(function (t, p) {
            return t + p.n;
          }, 0)
        : 0;
      parts
        .slice()
        .sort(function (a, b) {
          return b.rem - a.rem;
        })
        .slice(0, left)
        .forEach(function (p) {
          p.n++;
        });
      parts.forEach(function (p) {
        p.r.meta.v3 = p.n;
        p.r.meta.v3Est = list.length > 1;
      });
      if (list.length > 1) estimated = true;
    });
    return estimated;
  }

  // ---- Dataset ---------------------------------------------------------------------------------

  function byDate(x, y) {
    return x.date < y.date ? -1 : x.date > y.date ? 1 : 0;
  }

  /** Closed days to ask for: HISTORY_START → yesterday (Los Angeles), in calendar months. */
  function historyChunks(now) {
    var to = addDays(todayIn(CLOSE_TZ, now), -1);
    var chunks = [];
    if (to < HISTORY_START) return { from: HISTORY_START, to: to, chunks: chunks };
    var recentFrom = addDays(to, -(RECENT_DAYS - 1));
    for (var s = HISTORY_START; s <= to;) {
      var next = addDays(s.slice(0, 7) + '-28', 4).slice(0, 7) + '-01'; // first of next month
      var end = addDays(next, -1);
      if (end > to) end = to;
      chunks.push({ from: s, to: end, recent: end >= recentFrom });
      s = next;
    }
    return { from: HISTORY_START, to: to, chunks: chunks };
  }

  var SOURCE_INFO = {
    google: { file: 'Google Ads', sheet: 'google_ads · campaigns', kind: 'google-adgroups' },
    meta: { file: 'Meta', sheet: 'meta_ads · ads', kind: 'meta-ads' },
    tiktok: { file: 'TikTok', sheet: 'tiktok_ads · campaigns', kind: 'tiktok' },
  };

  /**
   * live: {google, meta, tiktok}, each {rows, truncated?} once loaded, {error} when it failed,
   * or undefined while loading. Returns the Dataset the app renders, from Shadow alone.
   */
  function buildDataset(live, pulledAt) {
    var rows = [];
    var sources = [];
    var warnings = [];
    var when = pulledAt ? ' Pulled ' + timeLabel(pulledAt) + '.' : '';
    var firsts = [];

    Object.keys(SOURCE_INFO).forEach(function (id) {
      var info = SOURCE_INFO[id];
      var src = live[id];
      var sheet = { sheet: info.sheet, kind: info.kind, dates: [], rows: 0, reconciled: null, note: null };
      if (src && Array.isArray(src.rows)) {
        rows = rows.concat(src.rows);
        sheet.dates = Array.from(
          new Set(
            src.rows.map(function (r) {
              return r.date;
            }),
          ),
        ).sort();
        sheet.rows = src.rows.length;
        sheet.note = (src.truncated ? 'Partial answer: some rows may be missing.' : 'Up to date.') + when;
        if (sheet.dates.length) firsts.push(info.file + ' from ' + fmtDay(sheet.dates[0]));
        if (src.truncated)
          warnings.push(info.file + ': Shadow sent a partial answer, so some rows may be missing.');
      } else if (src && src.error) {
        sheet.note = 'Could not load: ' + src.error;
        warnings.push(
          info.file + ' could not load from Shadow (' + src.error + '). Its views are empty until it does.',
        );
      } else {
        sheet.note = 'Loading…';
      }
      sources.push({ file: info.file, origin: 'shadow', sheets: [sheet] });
    });

    warnings.unshift(
      'Apple Search Ads is not available: Shadow syncs it, but its data tool does not serve Apple yet, so the Apple views are empty.',
    );
    if (
      rows.some(function (r) {
        return r.channel === 'search';
      })
    )
      warnings.push(
        'Google Search installs are all Google Ads conversions, as the original dashboard counted them when an export had no Installs column. Shadow has no install-only split.',
      );
    if (
      rows.some(function (r) {
        return r.channel === 'meta' && r.meta && r.meta.v3Est;
      })
    )
      warnings.push(
        'Meta 3-second plays come from Shadow as a daily account total, so totals for all of Meta are exact. Per-ad and per-objective 3-second plays, hook rate, hold rate and cost per 3-second play (marked *) split that total across ads by their early video retention (2 × 25% views − 50% views).',
      );
    if (
      rows.some(function (r) {
        return r.channel === 'meta' && (!r.meta || r.meta.v3 == null);
      })
    )
      warnings.push(
        'Some Meta days have no 3-second plays from Shadow yet, so hook and hold rate leave them out.',
      );
    if (
      rows.some(function (r) {
        return r.channel === 'meta';
      })
    )
      warnings.push('Meta shares, saves and comments are not in Shadow, so those columns read 0.');
    if (
      rows.some(function (r) {
        return (r.channel === 'tiktok' || r.platform === 'TikTok TopView') && r.reach == null;
      })
    )
      warnings.push(
        'TikTok reach and frequency for campaigns with more than one ad, and custom engagements, are not in Shadow.',
      );
    if (firsts.length) warnings.push('Shadow history starts: ' + firsts.join(', ') + '.');

    return {
      generatedAt: new Date(pulledAt || Date.now()).toISOString(),
      rows: rows.sort(byDate),
      keywords: [],
      sources: sources,
      warnings: warnings,
    };
  }

  function timeLabel(ms) {
    try {
      return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  var api = {
    HkCh: HkCh,
    HkTh: HkTh,
    ne: ne,
    parsePayload: parsePayload,
    QUERIES: QUERIES,
    searchIdSet: searchIdSet,
    mapGoogle: mapGoogle,
    mapMeta: mapMeta,
    mapTikTok: mapTikTok,
    allocate3s: allocate3s,
    historyChunks: historyChunks,
    buildDataset: buildDataset,
    addDays: addDays,
  };
  root.HarkLive = api;

  // ---- Viewer boot ------------------------------------------------------------------------------

  if (typeof window === 'undefined' || !window.claude || typeof window.claude.use !== 'function') return;

  var state = { status: 'starting', pulledAt: null, bodies: {}, errors: {} };
  var win = null;
  var mcp = null;
  var unsubs = [];

  /** The empty-state message, header pill and footer line the patched bundle reads. */
  function setText(empty, pill, footer) {
    window.__harkEmpty = empty;
    window.__harkPill = pill;
    window.__harkFooter = footer;
  }

  var pushTimer = null;
  function push() {
    if (pushTimer) return;
    pushTimer = setTimeout(function () {
      pushTimer = null;
      if (typeof window.__harkSet !== 'function') return push();
      window.__harkSet(currentDataset());
    }, 30);
  }

  var EMPTY = { generatedAt: null, rows: [], keywords: [], sources: [], warnings: [] };

  function sourceOf(key) {
    var q = key.split('|')[0];
    return q === 'searchCampaigns' ? 'google' : q; // metaDaily stays its own: Meta loads without it
  }

  function liveFromBodies() {
    var out = {};
    var b = state.bodies;
    var keysFor = function (q) {
      return q === 'searchCampaigns'
        ? ['searchCampaigns|all']
        : win.chunks.map(function (c) {
            return q + '|' + c.from;
          });
    };
    var have = function (q) {
      return keysFor(q).every(function (k) {
        return b[k];
      });
    };
    ['google', 'meta', 'tiktok'].forEach(function (id) {
      if (state.errors[id]) return void (out[id] = { error: state.errors[id] });
      if (!have(id) || (id === 'google' && !have('searchCampaigns'))) return;
      // Wait for the daily 3-second totals too, unless they failed (then hook and hold show —).
      if (id === 'meta' && !have('metaDaily') && !state.errors.metaDaily) return;
      var ids = id === 'google' ? searchIdSet(b['searchCampaigns|all']) : null;
      var rows = [];
      var truncated = false;
      keysFor(id).forEach(function (k) {
        var body = b[k];
        if (body.page && body.page.truncated) truncated = true;
        rows = rows.concat(
          id === 'google' ? mapGoogle(body, ids) : id === 'meta' ? mapMeta(body) : mapTikTok(body),
        );
      });
      if (id === 'meta')
        window.__harkV3Est = allocate3s(
          rows,
          keysFor('metaDaily').map(function (k) {
            return b[k];
          }),
        );
      out[id] = { rows: rows, truncated: truncated };
    });
    return out;
  }

  function currentDataset() {
    if (state.status !== 'live') return Object.assign({}, EMPTY);
    var live = liveFromBodies();
    var loading = Object.keys(SOURCE_INFO).filter(function (id) {
      return !live[id];
    });
    var failed = Object.keys(SOURCE_INFO).filter(function (id) {
      return live[id] && live[id].error;
    });
    var t = timeLabel(state.pulledAt);
    var names = function (ids) {
      return ids
        .map(function (id) {
          return SOURCE_INFO[id].file;
        })
        .join(', ');
    };
    setText(
      loading.length ? 'Loading data from Shadow…' : 'Shadow has no data for this dashboard yet.',
      ' · refreshed ' + t,
      'Live from Shadow' +
        (loading.length ? '. Still loading: ' + names(loading) : ', refreshed ' + t) +
        (failed.length ? '. Could not load: ' + names(failed) : '') +
        '. Apple Search Ads is not available from Shadow yet.',
    );
    return buildDataset(live, state.pulledAt);
  }

  function showNotice(text, button) {
    var el = document.getElementById('hark-live');
    if (!el) return;
    el.querySelector('[data-text]').textContent = text;
    var btn = el.querySelector('button');
    btn.hidden = !button;
    if (button) {
      btn.textContent = button.label;
      btn.onclick = button.onClick;
    }
    el.hidden = false;
  }
  function hideNotice() {
    var el = document.getElementById('hark-live');
    if (el) el.hidden = true;
  }

  var DENIALS = {
    needs_reauth: 'Reconnect Shadow in claude.ai Settings → Connectors to load this dashboard.',
    server_not_connected:
      'This dashboard loads from Shadow. Add the Shadow connector in claude.ai Settings → Connectors.',
    selection_required: 'Choose which Shadow connection this page should use.',
    blocked_by_policy: "Your organization's policy blocks Shadow for this page.",
    not_in_manifest:
      'Shadow is turned off for this page. Turn it on in the page’s Permissions to load the data.',
    consent_required: 'Allow Shadow for this page to load the data.',
  };

  function onError(key, err) {
    var code = (err && err.code) || 'upstream_error';
    if (code === 'approval_required') {
      if (state.status === 'live') return;
      state.status = 'approval';
      setText('This dashboard loads from Shadow and needs your OK.', '', '');
      showNotice('This dashboard loads from Shadow and needs your OK.', {
        label: 'Load data',
        onClick: loadOnce,
      });
    } else if (DENIALS[code]) {
      // Authorization problems retract what was shown.
      state.status = 'denied';
      state.bodies = {};
      setText(DENIALS[code], '', '');
    } else if (code === 'bad_request' && !state.fellBack) {
      // A viewer without watch support: fall back to one-off calls on a timer.
      state.fellBack = true;
      unsubs.forEach(function (u) {
        u();
      });
      unsubs = [];
      loadOnce();
      setInterval(loadOnce, REFRESH_MS);
      return;
    } else if (!state.bodies[key]) {
      // Transient failure with nothing shown yet for this part; keep the rest of the page.
      state.errors[sourceOf(key)] = (err && err.message) || code;
      state.status = 'live';
      if (!state.pulledAt) state.pulledAt = Date.now();
    }
    push();
  }

  function onData(key, result) {
    var body;
    try {
      body = parsePayload(result);
    } catch (e) {
      onError(key, { code: 'tool_error', message: e.message });
      return;
    }
    state.bodies[key] = body;
    delete state.errors[sourceOf(key)];
    state.status = 'live';
    var stamp = result && result.cache && result.cache.storedAt ? result.cache.storedAt : Date.now();
    state.pulledAt = state.pulledAt ? Math.max(state.pulledAt, stamp) : stamp;
    hideNotice();
    push();
  }

  /** Every call the page makes: four per month of history plus one list of Search campaigns. */
  function eachQuery(fn) {
    fn('searchCampaigns|all', QUERIES.searchCampaigns(win.from, win.to), true);
    ['google', 'meta', 'metaDaily', 'tiktok'].forEach(function (name) {
      win.chunks.forEach(function (c) {
        fn(name + '|' + c.from, QUERIES[name](c.from, c.to), c.recent);
      });
    });
  }

  var CACHE = { staleTime: 5 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000 };

  function loadOnce() {
    eachQuery(function (key, input) {
      mcp.callTool(SERVER, TOOL, input, { cache: CACHE }).then(
        function (r) {
          onData(key, r);
        },
        function (e) {
          onError(key, e);
        },
      );
    });
  }

  function boot() {
    window.claude
      .use('downloads')
      .then(function (d) {
        if (d)
          window.__harkSaveFile = function (filename, blob) {
            d.save({ filename: filename, data: blob }).catch(function () {});
          };
      })
      .catch(function () {});

    window.claude
      .use('mcp')
      .then(function (m) {
        if (!m) {
          var msg = 'This dashboard loads from Shadow. Open it in claude.ai with the Shadow connector added.';
          setText(msg, '', '');
          push();
          return;
        }
        mcp = m;
        win = historyChunks(new Date());
        setText('Loading data from Shadow…', '', '');
        push();
        eachQuery(function (key, input, recent) {
          unsubs.push(
            mcp.watchTool(
              SERVER,
              TOOL,
              input,
              function (ev) {
                if (ev.type === 'data') onData(key, ev.result);
                else onError(key, ev.error);
              },
              recent ? { cache: CACHE, refetchInterval: REFRESH_MS } : { cache: CACHE },
            ),
          );
        });
      })
      .catch(function () {});
  }

  boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
