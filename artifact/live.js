/*
 * Live layer for the Hark dashboard artifact.
 *
 * The page ships the Oct 19 export (reference/data/uploads.json) and the original React
 * build unchanged in behaviour. When the viewer has the Shadow connector, this script pulls
 * Google Ads, Meta and TikTok from Shadow's query_data tool, maps the rows into the
 * dashboard's own Dataset shape, keeps every exported day as it is, adds the closed days
 * after the export, and hands the result to the app through window.__harkSet.
 *
 * Field names below are the ones observed in Shadow responses (docs/shadow-fields.md).
 * The pure helpers are exposed as HarkLive for the tests; boot() runs only in a viewer.
 */
(function (root) {
  'use strict';

  var SERVER = 'Shadow';
  var TOOL = 'query_data';
  var WORKSPACE = 'Hark';
  var WINDOW_DAYS = 14; // Shadow re-syncs about 7 days back; late conversions land
  var CHUNK_DAYS = 14;
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
      if (channel === 'search') {
        // The dashboard counts the export's install-specific "Installs" column for Search.
        // Shadow only has all conversions, so live Search days carry no installs (gaps.md #1).
        row.installsReported = null;
        row.installsTap = null;
        row.installsView = 0;
      }
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

  // ---- Merge (Code.gs mergeDatasets_) and the live dataset ------------------------------------

  function byDate(x, y) {
    return x.date < y.date ? -1 : x.date > y.date ? 1 : 0;
  }

  function mergeDatasets(a, b) {
    var rk = {};
    b.rows.forEach(function (r) {
      rk[r.channel + '|' + r.date] = 1;
    });
    var kk = {};
    b.keywords.forEach(function (k) {
      kk[(k.adGroupId || k.adGroup) + '|' + k.date] = 1;
    });
    var seen = {};
    var sources = [];
    (a.sources || []).concat(b.sources || []).forEach(function (s) {
      var k = JSON.stringify(s);
      if (!seen[k]) {
        seen[k] = 1;
        sources.push(s);
      }
    });
    return {
      generatedAt: b.generatedAt || a.generatedAt,
      rows: a.rows
        .filter(function (r) {
          return !rk[r.channel + '|' + r.date];
        })
        .concat(b.rows)
        .sort(byDate),
      keywords: a.keywords
        .filter(function (k) {
          return !kk[(k.adGroupId || k.adGroup) + '|' + k.date];
        })
        .concat(b.keywords)
        .sort(byDate),
      sources: sources,
      warnings: b.warnings || [],
    };
  }

  function lastDateByChannel(ds) {
    var last = {};
    ds.rows.forEach(function (r) {
      if (!last[r.channel] || r.date > last[r.channel]) last[r.channel] = r.date;
    });
    return last;
  }

  /** The days to ask Shadow for: the rolling window, reaching back to the day after the export. */
  function liveWindow(seed, now) {
    var to = addDays(todayIn(CLOSE_TZ, now), -1);
    var last = lastDateByChannel(seed);
    var exportEnd = ['google', 'search', 'meta', 'tiktok', 'hi'].reduce(function (m, ch) {
      return last[ch] && (!m || last[ch] < m) ? last[ch] : m;
    }, null);
    var from = addDays(to, -(WINDOW_DAYS - 1));
    if (exportEnd && addDays(exportEnd, 1) < from) from = addDays(exportEnd, 1);
    var chunks = [];
    for (var s = from; s <= to; s = addDays(s, CHUNK_DAYS)) {
      var e = addDays(s, CHUNK_DAYS - 1);
      chunks.push({ from: s, to: e < to ? e : to });
    }
    return { from: from, to: to, chunks: chunks };
  }

  var SOURCE_INFO = {
    google: {
      file: 'Shadow · Google Ads',
      sheet: 'google_ads · campaigns (live)',
      kind: 'google-adgroups',
      owns: function (r) {
        return r.channel === 'google' || r.channel === 'search' || r.platform === 'YouTube Masthead';
      },
    },
    meta: {
      file: 'Shadow · Meta',
      sheet: 'meta_ads · ads (live)',
      kind: 'meta-ads',
      owns: function (r) {
        return r.channel === 'meta';
      },
    },
    tiktok: {
      file: 'Shadow · TikTok',
      sheet: 'tiktok_ads · campaigns (live)',
      kind: 'tiktok',
      owns: function (r) {
        return r.channel === 'tiktok' || r.platform === 'TikTok TopView';
      },
    },
  };

  /**
   * seed: the exported Dataset. live: {google, meta, tiktok} each {rows} when loaded, or
   * {error} / undefined. Exported days stay as exported; Shadow adds the days after them.
   */
  function buildLiveDataset(seed, live, now) {
    var last = lastDateByChannel(seed);
    var ok = function (id) {
      return live[id] && Array.isArray(live[id].rows);
    };
    var newRows = [];
    var sources = [];
    var added = {};

    Object.keys(SOURCE_INFO).forEach(function (id) {
      var info = SOURCE_INFO[id];
      if (!ok(id)) {
        if (live[id] && live[id].error)
          sources.push({
            file: info.file,
            origin: 'shadow',
            sheets: [
              {
                sheet: info.sheet,
                kind: info.kind,
                dates: [],
                rows: 0,
                reconciled: null,
                note: 'Could not load: ' + live[id].error,
              },
            ],
          });
        return;
      }
      var rows = live[id].rows;
      var fresh = rows.filter(function (r) {
        // High Impact mixes Google (Masthead) and TikTok (TopView): add a day only when both load.
        if (r.channel === 'hi' && !(ok('google') && ok('tiktok'))) return false;
        return !last[r.channel] || r.date > last[r.channel];
      });
      newRows = newRows.concat(fresh);
      var dates = Array.from(
        new Set(
          fresh.map(function (r) {
            return r.date;
          }),
        ),
      ).sort();
      added[id] = dates;

      // Check Shadow against the export on the days both cover.
      var shared = new Set(
        rows
          .filter(function (r) {
            return last[r.channel] && r.date <= last[r.channel];
          })
          .map(function (r) {
            return r.date;
          }),
      );
      var sum = function (list) {
        return list.reduce(function (t, r) {
          return t + (r.spend || 0);
        }, 0);
      };
      var shadowSpend = sum(
        rows.filter(function (r) {
          return shared.has(r.date);
        }),
      );
      var exportSpend = sum(
        seed.rows.filter(function (r) {
          return info.owns(r) && shared.has(r.date);
        }),
      );
      var reconciled =
        shared.size && exportSpend > 0 ? Math.abs(shadowSpend - exportSpend) / exportSpend <= 0.01 : null;
      var sharedDays = Array.from(shared).sort();
      sources.push({
        file: info.file,
        origin: 'shadow',
        sheets: [
          {
            sheet: info.sheet,
            kind: info.kind,
            dates: dates,
            rows: fresh.length,
            reconciled: reconciled,
            note: sharedDays.length
              ? 'Spend on ' +
                fmtDay(sharedDays[0]) +
                '–' +
                fmtDay(sharedDays[sharedDays.length - 1]) +
                ' is ' +
                (exportSpend > 0 ? ((100 * (shadowSpend - exportSpend)) / exportSpend).toFixed(1) : '—') +
                '% vs the export'
              : null,
          },
        ],
      });
    });

    var warnings = [];
    var anyNew = newRows.length > 0;
    if (anyNew) {
      var newest = newRows.reduce(function (m, r) {
        return r.date > m ? r.date : m;
      }, '');
      if (last.apple && newest > last.apple)
        warnings.push(
          'Apple Search Ads has no live source yet (Shadow syncs it but cannot serve it to this page), so Apple stops at ' +
            fmtDay(last.apple) +
            ', the last export.',
        );
      if (
        newRows.some(function (r) {
          return r.channel === 'search';
        })
      )
        warnings.push(
          'Google Search installs are not in Shadow (only all conversions), so Search days after the export show no installs.',
        );
      if (
        newRows.some(function (r) {
          return r.channel === 'meta';
        })
      )
        warnings.push(
          'Meta 3-second plays, shares, saves and comments are not in Shadow per ad, so hook and hold rate use only exported days.',
        );
      if (
        newRows.some(function (r) {
          return (r.channel === 'tiktok' || r.platform === 'TikTok TopView') && r.reach == null;
        })
      )
        warnings.push(
          'TikTok reach and frequency for multi-ad campaigns, and custom engagements, are not in Shadow; they are blank after the export.',
        );
    }
    Object.keys(SOURCE_INFO).forEach(function (id) {
      if (live[id] && live[id].error)
        warnings.push(
          SOURCE_INFO[id].file + ' could not load (' + live[id].error + '); its exported days still show.',
        );
      if (live[id] && live[id].truncated)
        warnings.push(SOURCE_INFO[id].file + ' sent a partial answer; some recent rows may be missing.');
    });

    var ds = mergeDatasets(seed, {
      generatedAt: (now || new Date()).toISOString(),
      rows: newRows,
      keywords: [],
      sources: sources,
      warnings: warnings,
    });
    return { dataset: ds, added: added };
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
    mergeDatasets: mergeDatasets,
    liveWindow: liveWindow,
    buildLiveDataset: buildLiveDataset,
    addDays: addDays,
  };
  root.HarkLive = api;

  // ---- Viewer boot ------------------------------------------------------------------------------

  if (typeof window === 'undefined' || !window.claude || typeof window.claude.use !== 'function') return;

  var seed = window.__harkSeed;
  var exportLabel = window.__harkExportLabel || 'the export';
  var exportPill = window.__harkExportPill || '';
  var state = { status: 'starting', error: null, pulledAt: null, bodies: {}, sourceErrors: {} };

  function setText(pill, footer) {
    window.__harkPill = pill;
    window.__harkFooter = footer;
  }

  function timeLabel(ms) {
    try {
      return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  var pushTimer = null;
  function push() {
    if (pushTimer) return;
    pushTimer = setTimeout(function () {
      pushTimer = null;
      if (typeof window.__harkSet !== 'function') {
        push();
        return;
      }
      window.__harkSet(currentDataset());
    }, 30);
  }

  function liveFromBodies() {
    var out = {};
    var b = state.bodies;
    var searchIds = new Set();
    var allIn = function (key) {
      return win.chunks.every(function (c) {
        return b[key + '|' + c.from];
      });
    };
    win.chunks.forEach(function (c) {
      var s = b['searchCampaigns|' + c.from];
      if (s)
        searchIdSet(s).forEach(function (id) {
          searchIds.add(id);
        });
    });
    ['google', 'meta', 'tiktok'].forEach(function (id) {
      if (state.sourceErrors[id]) {
        out[id] = { error: state.sourceErrors[id] };
        return;
      }
      if (!allIn(id) || (id === 'google' && !allIn('searchCampaigns'))) return;
      var rows = [];
      var truncated = false;
      win.chunks.forEach(function (c) {
        var body = b[id + '|' + c.from];
        if (body.page && body.page.truncated) truncated = true;
        rows = rows.concat(
          id === 'google' ? mapGoogle(body, searchIds) : id === 'meta' ? mapMeta(body) : mapTikTok(body),
        );
      });
      out[id] = { rows: rows, truncated: truncated };
    });
    return out;
  }

  function currentDataset() {
    if (!seed) return null;
    if (state.status !== 'live')
      return mergeDatasets(seed, { rows: [], keywords: [], sources: [], warnings: [] });
    var built = buildLiveDataset(seed, liveFromBodies(), new Date());
    var addedDays = Object.keys(built.added).reduce(function (n, k) {
      return n + built.added[k].length;
    }, 0);
    var t = timeLabel(state.pulledAt);
    var failed = Object.keys(state.sourceErrors);
    setText(
      ' · refreshed ' + t,
      'Live from Shadow: Google Ads, Meta and TikTok, refreshed ' +
        t +
        (addedDays ? '' : ' (no closed days after ' + exportLabel + ' yet)') +
        (failed.length ? '. ' + failed.join(', ') + ' could not load' : '') +
        '. Apple Search Ads and earlier days come from ' +
        exportLabel +
        '.',
    );
    return built.dataset;
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
    needs_reauth: 'Reconnect Shadow in claude.ai Settings → Connectors to load live data.',
    server_not_connected: 'Add the Shadow connector in claude.ai Settings → Connectors to load live data.',
    selection_required: 'Choose which Shadow connection this page should use to load live data.',
    blocked_by_policy: "Your organization's policy blocks Shadow for this page.",
    not_in_manifest:
      'Shadow is turned off for this page. Turn it on in the page’s Permissions to load live data.',
    consent_required: 'Allow Shadow for this page to load live data.',
  };

  var win = null;
  var mcp = null;
  var unsubs = [];

  function onError(key, err) {
    var code = (err && err.code) || 'upstream_error';
    var source = key.split('|')[0];
    if (code === 'approval_required') {
      state.status = 'approval';
      setText(exportPill, 'Showing ' + exportLabel + '. Live data from Shadow needs your OK.');
      showNotice('Live data from Shadow needs your OK.', { label: 'Load live data', onClick: loadOnce });
    } else if (DENIALS[code]) {
      // Authorization problems retract live data.
      state.status = 'denied';
      state.bodies = {};
      setText(exportPill, 'Showing ' + exportLabel + '. ' + DENIALS[code]);
    } else if (code === 'bad_request' && !state.fellBack) {
      // An older viewer without watch support: fall back to one-off calls.
      state.fellBack = true;
      unsubs.forEach(function (u) {
        u();
      });
      unsubs = [];
      loadOnce();
      setInterval(loadOnce, REFRESH_MS);
      return;
    } else if (!state.bodies[key]) {
      // Transient failure with nothing to show yet for this part: report it, keep the rest.
      state.sourceErrors[source === 'searchCampaigns' ? 'google' : source] = (err && err.message) || code;
      if (state.status !== 'live') state.status = 'live';
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
    delete state.sourceErrors[key.split('|')[0] === 'searchCampaigns' ? 'google' : key.split('|')[0]];
    state.status = 'live';
    var stamp = result && result.cache && result.cache.storedAt ? result.cache.storedAt : Date.now();
    state.pulledAt = state.pulledAt ? Math.max(state.pulledAt, stamp) : stamp;
    hideNotice();
    push();
  }

  function eachQuery(fn) {
    Object.keys(QUERIES).forEach(function (name) {
      win.chunks.forEach(function (c) {
        fn(name + '|' + c.from, QUERIES[name](c.from, c.to));
      });
    });
  }

  function loadOnce() {
    eachQuery(function (key, input) {
      mcp
        .callTool(SERVER, TOOL, input, { cache: { staleTime: 5 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000 } })
        .then(
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
    if (!seed) return;
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
          setText(
            exportPill,
            'Showing ' +
              exportLabel +
              '. Live data loads for viewers who have the Shadow connector in claude.ai.',
          );
          push();
          return;
        }
        mcp = m;
        win = liveWindow(seed, new Date());
        setText(exportPill, 'Loading live data from Shadow…');
        push();
        eachQuery(function (key, input) {
          unsubs.push(
            mcp.watchTool(
              SERVER,
              TOOL,
              input,
              function (ev) {
                if (ev.type === 'data') onData(key, ev.result);
                else onError(key, ev.error);
              },
              {
                cache: { staleTime: 5 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000 },
                refetchInterval: REFRESH_MS,
              },
            ),
          );
        });
      })
      .catch(function () {});
  }

  boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
