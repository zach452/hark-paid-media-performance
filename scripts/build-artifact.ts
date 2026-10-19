/**
 * Builds the Claude artifact: the original dashboard build (reference/app/Index.html) with its
 * data layer replaced. The page carries no exported data; artifact/live.js loads everything
 * from the viewer's Shadow connector.
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
    replace: '`As Google Ads reports them, through Shadow.`',
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
    replace: "`Each ad account's own reporting day, as Shadow stores it.`",
  },
  {
    why: 'Source files → source health',
    find: '{title:`Source files`,subtitle:`Last refreshed ${new Date(e.generatedAt).toLocaleString()}. Each platform export is checked against its own Total row.`,',
    replace:
      '{title:`Source health`,subtitle:`Each Shadow source, the days it covers and when it was last pulled.`,',
  },
  {
    why: 'Coverage by day subtitle',
    find: "subtitle:`What each day's numbers are built from. Gaps mean an export hasn't been added yet.`",
    replace: "subtitle:`What each day's numbers are built from. Gaps mean Shadow has no data for that day.`",
  },
  {
    why: '"Refreshing the data" now describes the live source, so every viewer gets it (it was team-only)',
    find: '(0,H.jsxs)(`div`,{className:t?`grid cols-2`:`grid`,children:[t&&(0,H.jsx)(jG,{}),',
    replace: '(0,H.jsxs)(`div`,{className:`grid cols-2`,children:[(0,H.jsx)(jG,{}),',
  },
  // Custom date range picker (artifact/range-picker.js).
  {
    why: 'Comparison can be a custom range, not only the previous period',
    find: 'd=(0,y.useMemo)(()=>HkU&&n.compare?Ps(HkU):null,[HkU,n.compare])',
    replace:
      'd=(0,y.useMemo)(()=>HkU&&n.compare?(n.cmpFrom&&n.cmpTo?{from:n.cmpFrom,to:n.cmpTo}:Ps(HkU)):null,[HkU,n.compare,n.cmpFrom,n.cmpTo])',
  },
  {
    why: 'Presets reset the comparison; setCustom also takes the comparison from the picker',
    find: 'setPreset:e=>r(t=>({...t,preset:e,from:null,to:null})),setCustom:e=>r(t=>({...t,preset:`custom`,from:e.from,to:e.to})),',
    replace:
      'setPreset:e=>r(t=>({...t,preset:e,from:null,to:null,cmpFrom:null,cmpTo:null})),setCustom:e=>r(t=>({...t,preset:`custom`,from:e.from,to:e.to,cmpFrom:e.cmpFrom??null,cmpTo:e.cmpTo??null,compare:e.compare??t.compare})),',
  },
  {
    why: 'Tell the picker whether the comparison is custom',
    find: 'range:HkU,prevRange:d,',
    replace: 'range:HkU,prevRange:d,cmpCustom:!!(n.cmpFrom&&n.cmpTo),',
  },
  {
    why: 'Expose the dashboard state to the picker on every render',
    find: 'return(0,H.jsx)(nc.Provider,{value:p,children:e})}',
    replace:
      'return window.__harkDash=p,window.__harkOnDash&&window.__harkOnDash(p),(0,H.jsx)(nc.Provider,{value:p,children:e})}',
  },
  {
    why: 'The Custom button opens the picker instead of two bare date inputs',
    find: '(0,H.jsx)(`button`,{"aria-pressed":e===`custom`||d,onClick:()=>f(!0),children:`Custom`})',
    replace:
      '(0,H.jsx)(`button`,{"aria-pressed":e===`custom`||d,"aria-haspopup":`dialog`,onClick:HkE=>window.__harkOpenRange?window.__harkOpenRange(HkE.currentTarget):f(!0),children:`Custom`})',
  },
  {
    why: 'Hide the bare date inputs when the picker is there',
    find: '(d||e===`custom`)&&(0,H.jsxs)(`span`,{className:`date-inputs`,',
    replace: '!window.__harkOpenRange&&(d||e===`custom`)&&(0,H.jsxs)(`span`,{className:`date-inputs`,',
  },
  {
    why: 'Readout and toggle say when the comparison is a custom range',
    find: 'i&&(0,H.jsxs)(`span`,{children:[` · vs `,Rs(i)]})',
    replace: 'i&&(0,H.jsxs)(`span`,{children:[` · vs `,Rs(i),window.__harkDash?.cmpCustom?` (custom)`:``]})',
  },
  {
    why: 'Compare toggle label',
    find: 'onChange:e=>o(e.target.checked)}),`Compare to previous period`]',
    replace:
      'onChange:e=>o(e.target.checked)}),window.__harkDash?.cmpCustom?`Compare to custom range`:`Compare to previous period`]',
  },
  {
    why: 'Empty state says what is happening with Shadow (loading, no connector, no access)',
    find: '`Performance data for this dashboard is being refreshed. Please check back shortly.`',
    replace: '(window.__harkEmpty??`Loading data from Shadow…`)',
  },
  {
    why: 'Source health columns describe Shadow sources',
    find: '{key:`file`,label:`File`,',
    replace: '{key:`file`,label:`Source`,',
  },
  {
    why: 'Source health: table column',
    find: '{key:`sheet`,label:`Sheet`,',
    replace: '{key:`sheet`,label:`Shadow table`,',
  },
  {
    why: 'Source health: feeds column',
    find: '{key:`kind`,label:`Recognised as`,',
    replace: '{key:`kind`,label:`Feeds`,',
  },
  {
    why: 'Source health: days column',
    find: '{key:`dates`,label:`Date`,value:e=>e.dates.join(`, `),render:e=>NG(e)},',
    replace: '{key:`dates`,label:`Days`,value:e=>e.dates.join(`, `),render:e=>NG(e)},',
  },
  {
    why: 'Source health: no export to tie out against',
    find: '{key:`rec`,label:`Ties to export total`,value:e=>e.reconciled===null?``:e.reconciled?`yes`:`no`,render:e=>e.reconciled===null?(0,H.jsx)(`span`,{className:`cell-sub`,children:`n/a`}):e.reconciled?(0,H.jsxs)(`span`,{className:`status on`,children:[(0,H.jsx)(`i`,{"aria-hidden":!0}),`Yes`]}):(0,H.jsx)(`span`,{className:`flag`,children:`✕ No`})},',
    replace: '',
  },
  {
    why: 'Apple keywords subtitle',
    find: '`Keyword exports for the selected range.`',
    replace: '`Keyword detail for the selected range.`',
  },
  {
    why: 'Apple keywords coverage note',
    find: '`Keyword exports cover ${',
    replace: '`Keyword data covers ${',
  },
  {
    why: 'Apple keywords empty state',
    find: '`No keyword-level exports for this range. Add Apple "Keywords" reports to /data/apple.`',
    replace: '`Apple Search Ads is not available from Shadow yet, so there is no keyword detail.`',
  },
  {
    why: 'High Impact empty state',
    find: '`No High Impact data in this date range. Masthead rows come from the Google Ads ad group report; TikTok TopView from a TikTok Ads Manager campaign export.`',
    replace:
      '`No High Impact data in this date range. YouTube Masthead comes from Google Ads and TikTok TopView from TikTok, both through Shadow.`',
  },
  {
    why: 'Meta empty state',
    find: '`No Meta data in this date range. Upload a Meta Ads Manager ad-level export with a daily breakdown.`',
    replace: '`No Meta data in this date range.`',
  },
];

/** "Refreshing the data" glossary card, rewritten for the live source. */
const REFRESHING_CARD =
  'function jG(){return(0,H.jsx)(Nc,{title:`Refreshing the data`,children:(0,H.jsxs)(`div`,{className:`prose`,children:[' +
  '(0,H.jsxs)(`p`,{children:[`Everything on this page comes from `,(0,H.jsx)(`strong`,{children:`Shadow`}),`, Darkroom’s marketing data warehouse: Google Ads (App, Search and YouTube Masthead), Meta and TikTok. The page loads it when it opens and again every 2 hours while it stays open. Shadow re-syncs about 7 days back every hour, so recent days can still move as late conversions land.`]}),' +
  '(0,H.jsx)(`p`,{children:`Apple Search Ads is synced into Shadow but cannot be read from it yet, so the Apple views are empty until Shadow serves it.`}),' +
  '(0,H.jsx)(`p`,{children:`The data loads through the viewer’s own Shadow connection in claude.ai. Without one, the page has nothing to show.`})' +
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
  const live = readFileSync(join(ROOT, 'artifact', 'live.js'), 'utf8');
  const picker = readFileSync(join(ROOT, 'artifact', 'range-picker.js'), 'utf8');
  const pickerCss = readFileSync(join(ROOT, 'artifact', 'range-picker.css'), 'utf8');
  if (picker.includes('</script')) throw new Error('range-picker.js must not contain </script');
  if (live.includes('</script')) throw new Error('live.js must not contain </script');

  // Pieces of the original page, in their original order.
  const themeInit = (() => {
    const r = between(html, '<script>\n      try {', '</script>');
    return '<script>\n      try {' + html.slice(r.start, r.end) + '</script>';
  })();
  // The bundle merges imports onto a built-in snapshot (the Oct 8 export). Empty it: the page
  // shows Shadow data only. A defined value also keeps "Download shareable file" hidden, which
  // the artifact sandbox could not run anyway.
  between(html, '<script>window.__HARK_DATASET__ = ', '</script>');
  const datasetScript =
    '<script>window.__HARK_DATASET__ = {"generatedAt":null,"rows":[],"keywords":[],"sources":[],"warnings":[]};</script>';
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

  const loader = `<script>
(function () {
  // The bundle keeps its dataset in localStorage. Keep that in memory (it starts empty and
  // live.js fills it from Shadow) and pass every other key, like the theme, to the real store.
  var KEY = 'hark-dashboard-imports-v1';
  var TEAM = 'hark-dashboard-team';
  var real = null;
  try { real = window.localStorage; } catch (e) {}
  var mem = {};
  window.__harkEmpty = 'Loading data from Shadow…';
  window.__harkPill = '';
  window.__harkFooter = '';
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
    `<style>${pickerCss}</style>`,
    '<div id="root"></div>',
    notice,
    loader,
    themeInit,
    datasetScript,
    `<script>\n${live}\n</script>`,
    `<script>\n${picker}\n</script>`,
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
