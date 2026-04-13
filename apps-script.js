// ════════════════════════════════════════════════════════════════
// PGA MAJORS PICK'EM 2026 — Google Apps Script Backend
// ════════════════════════════════════════════════════════════════
//
// This single script powers all four majors pick'em pools.
// Each major gets its own Google Sheet + Apps Script deployment.
//
// SETUP INSTRUCTIONS (do this once per tournament):
//
// 1. Go to sheets.google.com and create a new blank spreadsheet.
//    Name it e.g. "PGA Championship Pickem 2026".
//
// 2. In that spreadsheet, go to Extensions → Apps Script.
//    Delete all the default code and paste this entire file in.
//
// 3. Change TOURNAMENT_NAME below to match the tournament.
//
// 4. Click Save (the floppy disk icon), name the project anything.
//
// 5. Click Deploy → New Deployment.
//    - Type: Web App
//    - Execute as: Me
//    - Who has access: Anyone
//    Click Deploy. Google will ask you to authorise — click through.
//
// 6. Copy the Web App URL that appears (it looks like:
//    https://script.google.com/macros/s/ABC123.../exec)
//
// 7. Open the corresponding HTML file (e.g. pga-championship.html)
//    and paste the URL into the SCRIPT_URL constant at the top.
//
// 8. Upload the HTML file to GitHub Pages (or your host of choice).
//
// The Sheet will have these tabs created automatically:
//   Entries   — one row per participant
//   Config    — results, lock state, player roster
//
// ════════════════════════════════════════════════════════════════

// ── EDIT THIS for each tournament deployment ──────────────────
const TOURNAMENT_NAME = "Masters Pick'em 2026";
// Examples:
//   "PGA Championship Pick'em 2026"
//   "US Open Pick'em 2026"
//   "The Open Championship Pick'em 2026"
// ─────────────────────────────────────────────────────────────

const SHEET_NAME_ENTRIES = 'Entries';
const SHEET_NAME_CONFIG  = 'Config';

const ENTRY_HEADERS = [
  'name','email','winner','score','margin','lowRound',
  'p2','p3','p4','p5','p6','p7','p8','p9','p10','p11','p12',
  'ts','paid'
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
    ts:       r[17],
    paid:     r[18] === true || r[18] === 'TRUE' || r[18] === 'true'
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
    e.ts, e.paid || false
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
    else if (action === 'setPaid')     result = handleSetPaid(body.name, body.paid);
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
    locked:  lockedRaw === true || String(lockedRaw).toLowerCase() === 'true',
    players: playersRaw ? JSON.parse(playersRaw) : []
  };
}

const NOTIFY_EMAIL = 'jayemn@gmail.com';

function handleSaveEntry(entry) {
  if (!entry || !entry.name) return { ok: false, error: 'Missing entry name' };
  const lockedRaw = getConfig('locked');
  if (lockedRaw === true || String(lockedRaw).toLowerCase() === 'true') return { ok: false, error: 'Pool is locked — the Masters has started and picks are closed.' };
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

  try {
    const action = updated ? 'updated' : 'submitted';
    const places = (entry.places || []).map((p, i) => `  P${i + 2}: ${p || '—'}`).join('\n');
    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: `${TOURNAMENT_NAME}: ${entry.name} ${action} their picks`,
      body: [
        `${entry.name} (${entry.email || 'no email'}) just ${action} their picks for ${TOURNAMENT_NAME}.`,
        '',
        `Winner: ${entry.winner || '—'}`,
        `Winning score: ${entry.score}`,
        `Winning margin: ${entry.margin} strokes`,
        `Lowest round: ${entry.lowRound}`,
        '',
        'Places 2–12:',
        places,
      ].join('\n')
    });
  } catch(e) {
    // email failure should never break the entry save
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

function handleSetPaid(name, paid) {
  if (!name) return { ok: false, error: 'Missing name' };
  const sheet = entriesSheet();
  const row = rowForName(name);
  if (row < 0) return { ok: false, error: 'Entry not found' };
  // paid is column 19 (index 18, 1-based = 19)
  sheet.getRange(row, 19).setValue(paid ? true : false);
  return { ok: true };
}
