// ════════════════════════════════════════════════════════════════
// MASTERS PICK'EM 2026 — Google Apps Script Backend
// ════════════════════════════════════════════════════════════════
//
// SETUP INSTRUCTIONS (do this once):
//
// 1. Go to sheets.google.com and create a new blank spreadsheet.
//    Name it something like "Masters Pickem 2026".
//
// 2. In that spreadsheet, go to Extensions → Apps Script.
//    Delete all the default code and paste this entire file in.
//
// 3. Click Save (the floppy disk icon), name the project anything.
//
// 4. Click Deploy → New Deployment.
//    - Type: Web App
//    - Execute as: Me
//    - Who has access: Anyone
//    Click Deploy. Google will ask you to authorise — click through.
//
// 5. Copy the Web App URL that appears (it looks like:
//    https://script.google.com/macros/s/ABC123.../exec)
//
// 6. Open masters-pickem.html in a text editor.
//    Find this line near the top of the <script> section:
//      const SCRIPT_URL = 'YOUR_APPS_SCRIPT_URL_HERE';
//    Replace YOUR_APPS_SCRIPT_URL_HERE with your URL. Save the file.
//
// 7. Re-upload masters-pickem.html to Netlify (drag onto netlify.com/drop).
//
// That's it! All picks, results, lock state, and player roster now
// live in your Google Sheet and are shared in real time.
//
// The Sheet will have these tabs created automatically:
//   Entries   — one row per participant
//   Config    — results, lock state, player roster
//
// ════════════════════════════════════════════════════════════════

const SHEET_NAME_ENTRIES = 'Entries';
const SHEET_NAME_CONFIG  = 'Config';

const ENTRY_HEADERS = [
  'name','email','winner','score','margin','lowRound',
  'p2','p3','p4','p5','p6','p7','p8','p9','p10','p11','p12',
  'ts'
];

// ── Sheet helpers ──────────────────────────────────────────────

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers) sheet.appendRow(headers);
  }
  return sheet;
}

function entriesSheet() { return getOrCreateSheet(SHEET_NAME_ENTRIES, ENTRY_HEADERS); }
function configSheet()  { return getOrCreateSheet(SHEET_NAME_CONFIG, ['key','value']); }

function getConfig(key) {
  const sheet = configSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return null;
}

function setConfig(key, value) {
  const sheet = configSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function getAllEntries() {
  const sheet = entriesSheet();
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1).map(r => ({
    name:     r[0],
    email:    r[1],
    winner:   r[2],
    score:    Number(r[3]),
    margin:   Number(r[4]),
    lowRound: Number(r[5]),
    places:   [r[6],r[7],r[8],r[9],r[10],r[11],r[12],r[13],r[14],r[15],r[16]],
    ts:       r[17]
  }));
}

function rowForName(name) {
  const sheet = entriesSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === name.toLowerCase()) return i + 1;
  }
  return -1;
}

function entryToRow(e) {
  return [
    e.name, e.email, e.winner, e.score, e.margin, e.lowRound,
    ...(e.places || []),
    e.ts
  ];
}

// ── Request routing ────────────────────────────────────────────

function doGet(e) {
  const action = e.parameter.action || 'get';
  let result;
  try {
    if (action === 'get') result = handleGet();
    else result = { error: 'Unknown GET action' };
  } catch(err) {
    result = { error: err.message };
  }
  return jsonResponse(result);
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch(_) {}
  const action = body.action || e.parameter.action;
  let result;
  try {
    if      (action === 'saveEntry')   result = handleSaveEntry(body.entry);
    else if (action === 'deleteEntry') result = handleDeleteEntry(body.name);
    else if (action === 'clearEntries')result = handleClearEntries();
    else if (action === 'setResults')  result = handleSetResults(body.results);
    else if (action === 'setLocked')   result = handleSetLocked(body.locked);
    else if (action === 'setPlayers')  result = handleSetPlayers(body.players);
    else result = { error: 'Unknown action: ' + action };
  } catch(err) {
    result = { error: err.message };
  }
  return jsonResponse(result);
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Handlers ──────────────────────────────────────────────────

function handleGet() {
  const entries = getAllEntries();
  const resultsRaw = getConfig('results');
  const lockedRaw  = getConfig('locked');
  const playersRaw = getConfig('players');
  return {
    entries,
    results: resultsRaw ? JSON.parse(resultsRaw) : null,
    locked:  lockedRaw === 'true',
    players: playersRaw ? JSON.parse(playersRaw) : []
  };
}

function handleSaveEntry(entry) {
  if (!entry || !entry.name) return { ok: false, error: 'Missing entry name' };
  const sheet = entriesSheet();
  const existingRow = rowForName(entry.name);
  const row = entryToRow(entry);
  let updated = false;
  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    updated = true;
  } else {
    sheet.appendRow(row);
  }
  return { ok: true, updated };
}

function handleDeleteEntry(name) {
  if (!name) return { ok: false, error: 'Missing name' };
  const sheet = entriesSheet();
  const row = rowForName(name);
  if (row > 0) sheet.deleteRow(row);
  return { ok: true };
}

function handleClearEntries() {
  const sheet = entriesSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
  return { ok: true };
}

function handleSetResults(results) {
  setConfig('results', results ? JSON.stringify(results) : '');
  return { ok: true };
}

function handleSetLocked(locked) {
  setConfig('locked', locked ? 'true' : 'false');
  return { ok: true };
}

function handleSetPlayers(players) {
  setConfig('players', JSON.stringify(players || []));
  return { ok: true };
}
