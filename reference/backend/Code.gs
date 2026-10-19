// Hark Paid Media Dashboard — shared web app (Darkroom for Hark)
// Data lives in Drive: an uploads JSON (what the dashboard reads) and a Google Sheet (human-readable copy).
// Access = anyone holding the link with the private key (?k=...). Runs as Zach, so viewers never see a Google consent screen.
var ACCESS_KEY = 'REDACTED_ACCESS_KEY';
var UPLOADS_FILE_ID = '1f8fT9j0AjEEpQme5LJKKMtJ57cQoz08o';
var SHEET_ID = '13If8wD4K-hQmUZFFz5ZaJowc9gDYvd44snSfF7pRvck';
var RC = ['date','channel','campaign','adGroup','status','spend','impressions','clicks','installsReported','installsTap','installsView','newDownloads','redownloads','source'];
var KC = ['date','campaign','adGroup','keyword','matchType','status','bid','spend','impressions','taps','installsReported','installsTap','installsView','newDownloads','redownloads','source'];

function doGet(e) {
  if (!e || !e.parameter || e.parameter.k !== ACCESS_KEY) {
    return HtmlService.createHtmlOutput('<div style="font:16px system-ui;padding:40px;max-width:520px"><h2>Link not valid</h2><p>Ask Zach Wein (zach@darkroomagency.com) for the Hark dashboard link.</p></div>').setTitle('Hark · Paid Media Performance');
  }
  var uploads;
  try {
    uploads = DriveApp.getFileById(UPLOADS_FILE_ID).getBlob().getDataAsString() || 'null';
  } catch (e) {
    return HtmlService.createHtmlOutput('<div style="font:16px system-ui;padding:40px;max-width:520px">' +
      '<h2>No access yet</h2><p>This dashboard is only open to invited Google accounts. Ask Zach Wein (zach@darkroomagency.com) to share the ' +
      '"Hark Paid Media Dashboard" folder with you, then reload.</p></div>').setTitle('Hark · Paid Media Performance');
  }
  var html = DriveApp.getFileById('1bsnOy_mUQfbq-k-hjhXZsBe6R4_NLxkH').getBlob().getDataAsString();
  var safe = uploads.replace(/</g, '\\u003c');
  html = html.replace(/var initial = (\/\*__HARK_UPLOADS__\*\/)?\s*null;/, function () { return 'var initial = ' + safe + ';'; });
  html = html.replace('.saveUploads(v);', function () { return '.saveUploads(v, ' + JSON.stringify(ACCESS_KEY) + ');'; });
  return HtmlService.createHtmlOutput(html)
    .setTitle('Hark · Paid Media Performance')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Called by the page after someone uploads exports (or clears uploads).
function saveUploads(json, key) {
  if (key !== ACCESS_KEY) throw new Error('Not allowed');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var file = DriveApp.getFileById(UPLOADS_FILE_ID);
    var incoming = json ? JSON.parse(json) : null;
    var current = null;
    try { current = JSON.parse(file.getBlob().getDataAsString() || 'null'); } catch (e) {}
    var merged = incoming === null ? null : (current ? mergeDatasets_(current, incoming) : incoming);
    file.setContent(JSON.stringify(merged));
    writeSheet_(merged, incoming);
    return JSON.stringify(merged);
  } finally {
    lock.releaseLock();
  }
}

// Same rule the dashboard uses: newer data replaces the same channel+day (campaign rows) and ad group+day (keywords).
function mergeDatasets_(a, b) {
  var rk = {}; b.rows.forEach(function (r) { rk[r.channel + '|' + r.date] = 1; });
  var kk = {}; b.keywords.forEach(function (k) { kk[(k.adGroupId || k.adGroup) + '|' + k.date] = 1; });
  var byDate = function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; };
  var seen = {}, sources = [];
  (a.sources || []).concat(b.sources || []).forEach(function (s) { var k = JSON.stringify(s); if (!seen[k]) { seen[k] = 1; sources.push(s); } });
  return {
    generatedAt: b.generatedAt || a.generatedAt,
    rows: a.rows.filter(function (r) { return !rk[r.channel + '|' + r.date]; }).concat(b.rows).sort(byDate),
    keywords: a.keywords.filter(function (k) { return !kk[(k.adGroupId || k.adGroup) + '|' + k.date]; }).concat(b.keywords).sort(byDate),
    sources: sources,
    warnings: b.warnings || []
  };
}

function writeSheet_(ds, incoming) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var seedNote = 'Seed (Oct 6-7 exports)';
  function rewrite(name, cols, items) {
    var sh = ss.getSheetByName(name);
    var data = sh.getDataRange().getValues();
    var keep = data.slice(1).filter(function (r) { return r[cols.length - 1] === seedNote; });
    var keyIdx = name === 'Campaign_Daily' ? [1, 0] : [2, 0];
    var drop = {};
    items.forEach(function (it) { drop[name === 'Campaign_Daily' ? it.channel + '|' + it.date : it.adGroup + '|' + it.date] = 1; });
    keep = keep.filter(function (r) {
      var d = r[0] instanceof Date ? Utilities.formatDate(r[0], 'UTC', 'yyyy-MM-dd') : String(r[0]);
      return !drop[String(r[keyIdx[0]]) + '|' + d];
    });
    var add = items.map(function (it) { return cols.slice(0, -1).map(function (c) { return it[c] == null ? '' : it[c]; }).concat(['Upload']); });
    var out = [cols].concat(keep, add);
    sh.clearContents();
    sh.getRange(1, 1, out.length, cols.length).setValues(out);
  }
  rewrite('Campaign_Daily', RC, ds ? ds.rows : []);
  rewrite('Keyword_Daily', KC, ds ? ds.keywords : []);
  var files = incoming && incoming.sources ? incoming.sources.map(function (s) { return s.file; }).join(', ') : 'Cleared uploads';
  ss.getSheetByName('Upload_Log').appendRow([new Date(), Session.getActiveUser().getEmail() || 'unknown', files,
    incoming ? incoming.rows.length : 0, incoming ? incoming.keywords.length : 0]);
}
