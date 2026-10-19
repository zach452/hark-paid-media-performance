import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { buildArtifact } from '../scripts/build-artifact';

// live.js is a plain browser script; load it the way the page does and take its helpers.
const sandbox: Record<string, unknown> = {};
runInNewContext(readFileSync(join(__dirname, '..', 'artifact', 'live.js'), 'utf8'), sandbox);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const L = (sandbox as any).HarkLive;
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

// Shapes recorded from Shadow query_data for workspace Hark on 2026-10-18 (docs/shadow-fields.md).
const wrap = (body: unknown) => ({ result: JSON.stringify(body) + '\n\n_Workspace: Hark_' });
const googleBody = {
  found: true,
  groups: [
    {
      date: '2026-10-18',
      campaign_id: '24322279133',
      campaign_name: 'Google App',
      ad_group_id: '200335155746',
      ad_group_name: 'AI assistant',
      sum_google_ads_clicks: 15340,
      sum_google_ads_conversions: 551,
      sum_google_ads_impressions: 329322,
      sum_google_ads_spend: 9992.2,
      sum_google_ads_view_through_conversions: 2,
      record_count: 4,
    },
    {
      date: '2026-10-18',
      campaign_id: '24351099596',
      campaign_name: 'Search_NB_Scale',
      ad_group_id: '205000690030',
      ad_group_name: 'A1 ChatGPT',
      sum_google_ads_clicks: 1307,
      sum_google_ads_conversions: 0,
      sum_google_ads_impressions: 12148,
      sum_google_ads_spend: 5757.25,
      sum_google_ads_view_through_conversions: 0,
      record_count: 3,
    },
    {
      date: '2026-10-18',
      campaign_id: '24326099645',
      campaign_name: 'Brand Search Max Clicks Uncapped.',
      ad_group_id: '198637391697',
      ad_group_name: 'Ad group 1',
      sum_google_ads_clicks: 343,
      sum_google_ads_conversions: 23,
      sum_google_ads_impressions: 1322,
      sum_google_ads_spend: 1638,
      sum_google_ads_view_through_conversions: 0,
      record_count: 6,
    },
    {
      date: '2026-10-18',
      campaign_id: '24363979589',
      campaign_name: 'Video - Masthead (reservation) - 2026-10-16',
      ad_group_id: '199912238534',
      ad_group_name: 'Video - Masthead (reservation) - 2026-10-16',
      sum_google_ads_clicks: 562,
      sum_google_ads_conversions: 79,
      sum_google_ads_impressions: 3376859,
      sum_google_ads_spend: 53860.91,
      sum_google_ads_view_through_conversions: 0,
      record_count: 4,
    },
  ],
  page: { total: 4, returned: 4, truncated: false },
};
const searchBody = { found: true, groups: [{ campaign_id: '24351099596' }, { campaign_id: '24326099645' }] };

describe('parsePayload', () => {
  it('unwraps the {result: "<json>\\n\\n_Workspace_"} answer', () => {
    expect(L.parsePayload({ payload: wrap(googleBody) }).groups).toHaveLength(4);
  });
  it('reads a text block when there is no payload', () => {
    const r = { content: [{ type: 'text', text: JSON.stringify(wrap(searchBody)) }] };
    expect(L.parsePayload(r).groups).toHaveLength(2);
  });
  it('turns a Shadow validation error into a thrown error', () => {
    expect(() => L.parsePayload({ payload: { found: false, error: 'Invalid group_by column' } })).toThrow(
      'Invalid group_by column',
    );
  });
});

describe('mapGoogle', () => {
  const rows = L.mapGoogle(L.parsePayload({ payload: wrap(googleBody) }), L.searchIdSet(searchBody));
  it('routes App, Search and Masthead with HkCh', () => {
    expect(rows.map((r: { channel: string }) => r.channel)).toEqual(['google', 'search', 'search', 'hi']);
  });
  it('maps App installs from conversions and keeps real clicks', () => {
    expect(rows[0]).toMatchObject({
      campaign: 'Google App',
      adGroup: 'AI assistant',
      theme: 'AI Assistant',
      spend: 9992.2,
      clicks: 15340,
      clicksImplied: false,
      installsReported: 551,
      installsTap: 551,
      installsView: 2,
      conv: 551,
    });
  });
  it('counts Search conversions as installs, as the original parser did without an Installs column', () => {
    expect(rows[2]).toMatchObject({ theme: 'Brand', installsReported: 23, installsTap: 23, conv: 23 });
    expect(rows[1].theme).toBe('Other'); // same as the export's Search_NB_Scale ad groups
  });
  it('marks Masthead as High Impact with no installs', () => {
    expect(rows[3]).toMatchObject({
      platform: 'YouTube Masthead',
      noInstall: true,
      installsReported: 0,
      conv: 79,
    });
  });
});

describe('mapMeta', () => {
  const body = {
    groups: [
      {
        date: '2026-10-18',
        campaign_id: '1',
        campaign_name: 'HARK_SOC_META_TRAFFIC_EVERGREEN',
        adset_name: 'PROSPECTING_PERSONA-FITNESS',
        ad_id: '120249119019620775',
        ad_name: 'VIGNETTE_VACATION',
        optimization_goal: 'LANDING_PAGE_VIEWS',
        sum_meta_spend: 18888.61,
        sum_meta_impressions: 517000,
        sum_meta_estimated_reach: 479469,
        sum_meta_link_clicks: 100,
        sum_meta_clicks: 120,
        sum_meta_landing_page_views: 90,
        sum_meta_action_post_engagement: 300,
        sum_meta_action_mobile_app_install: null,
        sum_video_play_actions: 93794,
        sum_video_p25_watched_actions: 10,
        sum_video_p50_watched_actions: 5,
        sum_video_p95_watched_actions: 2,
      },
      {
        date: '2026-10-18',
        campaign_name: 'HARK_SOC_META_ENGAGEMENT_BOOSTED',
        adset_name: 'PROSPECTING_PERSONA-MOMS',
        ad_name: 'POLYGRAPH',
        optimization_goal: 'POST_ENGAGEMENT',
        sum_meta_spend: 10,
        sum_meta_impressions: 1000,
        sum_meta_link_clicks: null,
        sum_meta_action_post_engagement: 40,
      },
      {
        date: '2026-10-18',
        campaign_name: 'X',
        ad_name: 'Y',
        optimization_goal: 'APP_INSTALLS',
        sum_meta_spend: 5,
        sum_meta_action_mobile_app_install: 7,
      },
    ],
  };
  const rows = L.mapMeta(body);
  it('derives objective and result type from the optimisation goal', () => {
    expect(rows[0]).toMatchObject({
      objective: 'Traffic',
      adGroup: 'PROSPECTING_PERSONA-FITNESS',
      ad: 'VIGNETTE_VACATION',
      noInstall: true,
    });
    expect(rows[0].meta).toMatchObject({
      resultType: 'actions:omni_landing_page_view',
      results: 90,
      lpv: 90,
      link: 100,
      clicksAll: 120,
      reach: 479469,
      v3: null,
    });
    expect(rows[1]).toMatchObject({ objective: 'Engagement' });
    expect(rows[1].meta).toMatchObject({ resultType: 'actions:post_engagement', results: 40, link: 0 });
  });
  it('counts installs only for install results', () => {
    expect(rows[2]).toMatchObject({ noInstall: false, installsReported: 7, installsTap: 7 });
  });
});

describe('mapTikTok', () => {
  const rows = L.mapTikTok({
    groups: [
      {
        date: '2026-10-18',
        campaign_name: 'HARK_SOC_TIKTOK_TOPVIEW_102026',
        sum_tiktok_ads_spend: 393121.19,
        sum_tiktok_ads_impressions: 39596464,
        sum_tiktok_ads_clicks: 1383312,
        sum_tiktok_ads_reach: 13154418,
        sum_video_watched_6s: 1941944,
        sum_video_views_p100: 393293,
        sum_video_play_actions: 38077162,
        record_count: 1,
      },
      {
        date: '2026-10-18',
        campaign_name: 'HARK_SOC_TIKTOK_TRAFFIC_EVERGREEN',
        sum_tiktok_ads_spend: 7006.22,
        sum_tiktok_ads_impressions: 949665,
        sum_tiktok_ads_clicks: 11312,
        sum_tiktok_ads_reach: 929972,
        sum_video_watched_6s: 62936,
        sum_video_views_p100: 25824,
        sum_video_play_actions: 931364,
        record_count: 6,
      },
    ],
  });
  it('routes TopView to High Impact and reproduces the export’s VCR and frequency', () => {
    expect(rows[0]).toMatchObject({
      channel: 'hi',
      platform: 'TikTok TopView',
      reach: 13154418,
      freqD: 3.01,
      vcr: 0.0103,
      views6s: 1941944,
      noInstall: true,
    });
  });
  it('drops non-additive reach for multi-ad campaigns', () => {
    expect(rows[1]).toMatchObject({ channel: 'tiktok', reach: null, freqD: null, vcr: 0.0277, eng: null });
  });
});

describe('buildDataset', () => {
  const g = (date: string, channel = 'google', extra = {}) => ({ date, channel, spend: 1, ...extra });

  it('builds the dataset from Shadow rows only, sorted by date', () => {
    const ds = L.buildDataset(
      {
        google: { rows: [g('2026-10-07'), g('2026-10-06', 'search')] },
        meta: { rows: [g('2026-10-14', 'meta')] },
        tiktok: { rows: [] },
      },
      Date.parse('2026-10-20T18:00:00Z'),
    );
    expect(ds.rows.map((r: { date: string }) => r.date)).toEqual(['2026-10-06', '2026-10-07', '2026-10-14']);
    expect(ds.keywords).toEqual([]);
    expect(ds.sources.map((x: { file: string }) => x.file)).toEqual(['Google Ads', 'Meta', 'TikTok']);
    expect(ds.sources[0].sheets[0]).toMatchObject({
      dates: ['2026-10-06', '2026-10-07'],
      rows: 2,
      reconciled: null,
    });
  });

  it('always flags Apple and flags each Shadow gap that applies', () => {
    const ds = L.buildDataset(
      { google: { rows: [g('2026-10-06', 'search')] }, meta: { rows: [g('2026-10-14', 'meta')] } },
      null,
    );
    const text = ds.warnings.join('\n');
    expect(text).toContain('Apple Search Ads is not available');
    expect(text).toContain('Google Search installs are all Google Ads conversions');
    expect(text).toContain('Meta shares, saves and comments are not in Shadow');
    expect(text).toContain('Shadow history starts: Google Ads from Oct 6, Meta from Oct 14.');
    expect(ds.sources[2].sheets[0].note).toBe('Loading…');
  });

  it('reports a failed source without inventing rows for it', () => {
    const ds = L.buildDataset(
      { google: { rows: [g('2026-10-06')] }, meta: { error: 'server_unavailable' } },
      null,
    );
    expect(ds.rows).toHaveLength(1);
    expect(ds.warnings).toContain(
      'Meta could not load from Shadow (server_unavailable). Its views are empty until it does.',
    );
  });
});

describe('allocate3s', () => {
  const ad = (date: string, impressions: number, v25: number, plays = 0) => ({
    date,
    channel: 'meta',
    impressions,
    meta: { v25, plays, v3: null as number | null, v3Est: false },
  });
  const daily = [{ groups: [{ date: '2026-10-18', max_meta_date_video_3s_views: 235110 }] }];

  it('splits the daily total by early retention (2 × p25 − p50) and adds back to it exactly', () => {
    const rows = [
      ad('2026-10-18', 517000, 30000),
      ad('2026-10-18', 356822, 10001),
      ad('2026-10-18', 561048, 3),
    ];
    expect(L.allocate3s(rows, daily)).toBe(true);
    expect(rows.reduce((t, r) => t + (r.meta.v3 ?? 0), 0)).toBe(235110);
    expect(rows[0]!.meta.v3).toBeGreaterThan(rows[1]!.meta.v3!);
    expect(rows.every((r) => r.meta.v3Est)).toBe(true);
  });
  it('falls back to plays when a day has no 25% views, and is exact for a single ad', () => {
    const two = [ad('2026-10-18', 100, 0, 30), ad('2026-10-18', 100, 0, 10)];
    L.allocate3s(two, daily);
    expect(two.map((r) => r.meta.v3)).toEqual([176333, 58777]);
    const one = [ad('2026-10-18', 100, 5)];
    expect(L.allocate3s(one, daily)).toBe(false);
    expect(one[0]!.meta).toMatchObject({ v3: 235110, v3Est: false });
  });
  it('leaves days without a daily total empty', () => {
    const rows = [ad('2026-10-19', 100, 5), ad('2026-10-19', 100, 5)];
    L.allocate3s(rows, daily);
    expect(rows.map((r) => r.meta.v3)).toEqual([null, null]);
  });
});

describe('historyChunks', () => {
  it('asks for Oct 1 through yesterday in Los Angeles', () => {
    const w = L.historyChunks(new Date('2026-10-20T06:00:00Z')); // Oct 19, 11pm in LA
    expect(plain(w)).toEqual({
      from: '2026-10-01',
      to: '2026-10-18',
      chunks: [{ from: '2026-10-01', to: '2026-10-18', recent: true }],
    });
  });
  it('splits by calendar month and refreshes only the months holding the last 14 days', () => {
    const w = L.historyChunks(new Date('2026-12-05T18:00:00Z'));
    expect(plain(w.chunks)).toEqual([
      { from: '2026-10-01', to: '2026-10-31', recent: false },
      { from: '2026-11-01', to: '2026-11-30', recent: true },
      { from: '2026-12-01', to: '2026-12-04', recent: true },
    ]);
  });
});

describe('buildArtifact', () => {
  const html = buildArtifact();
  it('applies every bundle patch and stays under the 16 MB page limit', () => {
    expect(Buffer.byteLength(html)).toBeLessThan(16 * 1024 * 1024);
    expect(html).toContain('window.__harkSet=a');
    expect(html).toContain('children:window.__harkFooter??ws.footer');
    expect(html.startsWith('<title>Hark · Paid Media Performance</title>')).toBe(true);
  });
  it('carries no exported data', () => {
    expect(html).toContain('window.__HARK_DATASET__ = {"generatedAt":null,"rows":[]');
    // An Apple campaign id and a source file name that exist only in the exports.
    expect(html).not.toContain('2144818472');
    expect(html).not.toContain('Apple Ads Data (1).xlsx');
  });
});
