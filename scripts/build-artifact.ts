/**
 * Builds the Claude artifact: the original dashboard build (reference/app/Index.html) with the
 * Oct 19 export inlined and artifact/live.js added, so viewers with the Shadow connector see
 * live Google Ads, Meta and TikTok days.
 *
 *   npm run artifact:build      # → artifact/dist/hark-paid-media.html
 *
 * The React bundle is minified and has no source, so changes to it are exact string patches.
 * Each must match exactly once; the build fails if the bundle ever changes under them.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
export const OUT = join(ROOT, 'artifact', 'dist', 'hark-paid-media.html');

interface Patch {
  why: string;
  find: string;
  replace: string;
}

const BUNDLE_PATCHES: Patch[] = [
  {
    why: 'Expose the data provider’s setter so the live layer can hand over the merged dataset',
    find: '[i,a]=(0,y.useState)(bs),',
    replace: '[i,a]=(0,y.useState)(bs),HkSet=(window.__harkSet=a),',
  },
  {
    why: 'Header pill: freshness instead of "incl. imports"',
    find: 'i?` · incl. imports`:``',
    replace: '(window.__harkPill??(i?` · incl. imports`:``))',
  },
  {
    why: 'Footer: freshness line replaces the interim note',
    find: '(0,H.jsx)(`span`,{children:ws.footer})',
    replace: '(0,H.jsx)(`span`,{children:window.__harkFooter??ws.footer})',
  },
  {
    why: 'Hook, hold and cost per 3-second play only over rows that have 3-second plays (live Meta days do not)',
    find: 'rt=new Set,ob=new Set,dy=new Set;for(let r of e){let m=r.meta||{};',
    replace:
      'rt=new Set,ob=new Set,dy=new Set,HkV={i:0,s:0,v95:0};for(let r of e){let m=r.meta||{};m.v3!=null&&(HkV.i+=r.impressions||0,HkV.s+=r.spend||0,HkV.v95+=m.v95||0);',
  },
  {
    why: 'Hook / hold / cpv3 use the 3-second-play rows only',
    find: 'hook:d(s.v3,s.impressions),hold:d(s.v95,s.v3),',
    replace: 'hook:d(s.v3,HkV.i),hold:d(HkV.v95,s.v3),',
  },
  {
    why: 'Cost per 3-second play over the same rows',
    find: 'cpv3:d(s.spend,s.v3),',
    replace: 'cpv3:d(HkV.s,s.v3),',
  },
  {
    why: 'Cost per 1K 3-second plays over the same rows',
    find: 'cpkv3:d(s.spend*1e3,s.v3),',
    replace: 'cpkv3:d(HkV.s*1e3,s.v3),',
  },
  {
    why: 'Download CSV: the artifact sandbox blocks <a download>; use the downloads capability',
    find: ',a=new Blob([i.join(`\n`)],{type:`text/csv;charset=utf-8`}),o=URL.createObjectURL(a),',
    replace:
      ',a=new Blob([i.join(`\n`)],{type:`text/csv;charset=utf-8`});if(window.__harkSaveFile)return void window.__harkSaveFile(`${e}.csv`,a);let o=URL.createObjectURL(a),',
  },
  // Copy the data-source change makes untrue (brief §4: Google clicks, Refreshing the data, Source files).
  {
    why: 'Google clicks are real, not implied (App view note)',
    find: "`. Google's standard ad group export has no impressions or clicks; clicks are implied from Conversions ÷ Conv. rate.`",
    replace: '`. Google clicks and impressions are as Google Ads reports them.`',
  },
  {
    why: 'Glossary: Google clicks',
    find: '`Implied as Conversions ÷ Conv. rate — the ad group export has no click or impression columns.`',
    replace:
      '`As Google Ads reports them. The first ad group exports had no click column, so clicks were implied as Conversions ÷ Conv. rate; no current data uses that.`',
  },
  {
    why: 'Google App KPI tile',
    find: 'label:`Clicks (implied)`,value:l.clicks,prev:u?.clicks??null,format:`count`,polarity:`up-good`,showDelta:r,info:`Conversions ÷ Conv. rate — the ad group export carries no click column.`',
    replace:
      'label:`Clicks`,value:l.clicks,prev:u?.clicks??null,format:`count`,polarity:`up-good`,showDelta:r,info:`As Google Ads reports them`',
  },
  {
    why: 'Google App ad group table headers',
    find: '{key:`clicks`,label:`Clicks*`,value:e=>e.clicks,format:`count`,num:!0,title:`Implied from Conversions ÷ Conv. rate`},{key:`cpc`,label:`CPC*`,',
    replace: '{key:`clicks`,label:`Clicks`,value:e=>e.clicks,format:`count`,num:!0},{key:`cpc`,label:`CPC`,',
  },
  {
    why: 'Google App ad group table footnote',
    find: "`* Implied: Google's ad group export has no impressions or clicks, so clicks = Conversions ÷ Conv. rate.`",
    replace: '`Clicks and impressions are as Google Ads reports them.`',
  },
  {
    why: 'Glossary: time zone',
    find: "`As exported: Apple reports in UTC; Google in the ad account's time zone.`",
    replace:
      "`As exported: Apple reports in UTC; Google in the ad account's time zone. Days from Shadow use each ad account's own reporting day.`",
  },
  {
    why: 'Source files → source health',
    find: '{title:`Source files`,subtitle:`Last refreshed ${new Date(e.generatedAt).toLocaleString()}. Each platform export is checked against its own Total row.`,',
    replace:
      '{title:`Source health`,subtitle:`Exports are checked against their own Total row. Shadow pulls are checked against the export on the days both cover.`,',
  },
  {
    why: 'Coverage by day subtitle',
    find: "subtitle:`What each day's numbers are built from. Gaps mean an export hasn't been added yet.`",
    replace:
      "subtitle:`What each day's numbers are built from. Gaps mean no source has data for that day yet.`",
  },
  {
    why: '"Refreshing the data" now describes the live source, so every viewer gets it (it was team-only)',
    find: '(0,H.jsxs)(`div`,{className:t?`grid cols-2`:`grid`,children:[t&&(0,H.jsx)(jG,{}),',
    replace: '(0,H.jsxs)(`div`,{className:`grid cols-2`,children:[(0,H.jsx)(jG,{}),',
  },
  {
    why: 'Empty state copy',
    find: '`Performance data for this dashboard is being refreshed. Please check back shortly.`',
    replace: '`Performance data for this dashboard is loading. Please check back shortly.`',
  },
];

/** "Refreshing the data" glossary card, rewritten for the live source. */
const REFRESHING_CARD =
  'function jG(){return(0,H.jsx)(Nc,{title:`Refreshing the data`,children:(0,H.jsxs)(`div`,{className:`prose`,children:[' +
  '(0,H.jsxs)(`p`,{children:[`Google Ads (App, Search and YouTube Masthead), Meta and TikTok load live from `,(0,H.jsx)(`strong`,{children:`Shadow`}),`, Darkroom’s marketing data warehouse, when the page opens and every 2 hours while it stays open. Shadow re-syncs about 7 days back every hour, so recent days can still move as late conversions land.`]}),' +
  '(0,H.jsx)(`p`,{children:`Days up to the Oct 19 export, and every Apple Search Ads day, come from that export and stay as exported. Shadow adds the closed days after it.`}),' +
  '(0,H.jsx)(`p`,{children:`Live data uses the viewer’s own Shadow connection in claude.ai. Without one, the page shows the export only.`})' +
  ']})})}';

function replaceOnce(src: string, p: Patch): string {
  const n = src.split(p.find).length - 1;
  if (n !== 1) throw new Error(`Patch "${p.why}" matched ${n} times (expected 1)`);
  return src.replace(p.find, () => p.replace);
}

function between(src: string, start: string, end: string, from = 0): { start: number; end: number } {
  const s = src.indexOf(start, from);
  if (s < 0) throw new Error(`Marker not found: ${start.slice(0, 60)}`);
  const e = src.indexOf(end, s + start.length);
  if (e < 0) throw new Error(`End marker not found after: ${start.slice(0, 60)}`);
  return { start: s + start.length, end: e };
}

export function buildArtifact(): string {
  const html = readFileSync(join(ROOT, 'reference', 'app', 'Index.html'), 'utf8');
  const uploads = readFileSync(join(ROOT, 'reference', 'data', 'uploads.json'), 'utf8');
  const live = readFileSync(join(ROOT, 'artifact', 'live.js'), 'utf8');
  if (live.includes('</script')) throw new Error('live.js must not contain </script');

  // Pieces of the original page, in their original order.
  const themeInit = (() => {
    const r = between(html, '<script>\n      try {', '</script>');
    return '<script>\n      try {' + html.slice(r.start, r.end) + '</script>';
  })();
  const datasetScript = (() => {
    const r = between(html, '<script>window.__HARK_DATASET__ = ', '</script>');
    return '<script>window.__HARK_DATASET__ = ' + html.slice(r.start, r.end) + '</script>';
  })();
  const mod = between(html, '<script type="module">', '</script>');
  let bundle = html.slice(mod.start, mod.end);
  if (!/^\s*<style>/.test(html.slice(mod.end + '</script>'.length)))
    throw new Error('Module script end is not where expected');
  const css = (() => {
    const r = between(html, '<style>', '</style>', mod.end);
    return html.slice(r.start, r.end);
  })();

  for (const p of BUNDLE_PATCHES) bundle = replaceOnce(bundle, p);
  const jg = between(bundle, 'function jG(){', 'function MG(');
  bundle = bundle.slice(0, jg.start - 'function jG(){'.length) + REFRESHING_CARD + bundle.slice(jg.end);

  const seed = JSON.parse(uploads) as { generatedAt: string };
  const exported = new Date(seed.generatedAt);
  const exportDay = `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][exported.getUTCMonth()]} ${exported.getUTCDate()}`;

  // Same escaping Code.gs applies before inlining.
  const seedJson = uploads.trim().replace(/</g, '\\u003c');
  const loader = `<script>
(function () {
  // The bundle reads the dataset from localStorage. Serve it from memory (as Apps Script did)
  // and pass every other key, like the theme choice, through to the real store.
  var KEY = 'hark-dashboard-imports-v1';
  var TEAM = 'hark-dashboard-team';
  var initial = ${seedJson};
  var real = null;
  try { real = window.localStorage; } catch (e) {}
  var mem = {};
  mem[KEY] = JSON.stringify(initial);
  window.__harkSeed = initial;
  window.__harkExportLabel = 'the ${exportDay} export';
  window.__harkExportPill = ' · ${exportDay} export';
  window.__harkPill = window.__harkExportPill;
  window.__harkFooter = 'Showing the ${exportDay} export.';
  var store = {
    getItem: function (k) {
      if (k === KEY) return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
      if (k === TEAM) return null;
      try { return real ? real.getItem(k) : null; } catch (e) { return null; }
    },
    setItem: function (k, v) {
      if (k === KEY) { mem[k] = String(v); return; }
      if (k === TEAM) return;
      try { if (real) real.setItem(k, v); } catch (e) {}
    },
    removeItem: function (k) {
      if (k === KEY) { delete mem[k]; return; }
      try { if (real) real.removeItem(k); } catch (e) {}
    },
    clear: function () {},
    key: function () { return null; },
    get length() { return 0; }
  };
  try { Object.defineProperty(window, 'localStorage', { value: store, configurable: true }); } catch (e) {}
})();
</script>`;

  const notice = `<div id="hark-live" class="hark-live" role="status" hidden><span data-text></span><button type="button" class="hark-live-btn" hidden></button></div>`;
  const noticeCss = `.hark-live{position:fixed;z-index:50;right:max(16px,calc(env(safe-area-inset-right,0px) + 16px));bottom:calc(env(safe-area-inset-bottom,0px) + 16px);left:auto;max-width:calc(100% - 32px);display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px 14px;border-radius:var(--radius);background:var(--surface);color:var(--ink);border:1px solid var(--hairline);box-shadow:var(--shadow),0 6px 24px #0b0b0b1f;font-size:13px}.hark-live-btn{font:inherit;font-weight:600;padding:6px 12px;border-radius:8px;border:1px solid var(--hairline);background:var(--ink);color:var(--page);cursor:pointer}.hark-live-btn:focus-visible{outline:2px solid var(--focus);outline-offset:2px}.hark-live[hidden],.hark-live-btn[hidden]{display:none}`;

  return [
    '<title>Hark · Paid Media Performance</title>',
    `<style>${css}</style>`,
    `<style>${noticeCss}</style>`,
    '<div id="root"></div>',
    notice,
    loader,
    themeInit,
    datasetScript,
    `<script>\n${live}\n</script>`,
    `<script type="module">${bundle}</script>`,
    '',
  ].join('\n');
}

if (require.main === module) {
  const out = buildArtifact();
  mkdirSync(join(ROOT, 'artifact', 'dist'), { recursive: true });
  writeFileSync(OUT, out);
  console.log(`Wrote ${OUT} (${(Buffer.byteLength(out) / 1024 / 1024).toFixed(2)} MB)`);
}
