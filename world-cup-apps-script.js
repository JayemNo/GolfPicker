// ════════════════════════════════════════════════════════════════
// FIFA WORLD CUP 2026 PICK'EM — Google Apps Script Backend
// ════════════════════════════════════════════════════════════════
//
// SETUP (do once):
// 1. Create a new Google Sheet, e.g. "World Cup 2026 Pickem"
// 2. Extensions → Apps Script → paste this entire file
// 3. Click Save, then Deploy → New Deployment
//    - Type: Web App · Execute as: Me · Who has access: Anyone
// 4. Copy the Web App URL and paste it into world-cup.html
//    as the SCRIPT_URL constant.
//
// The Sheet will have two tabs created automatically:
//   Entries  — one row per participant
//   Config   — bracket config, results, lock state
//
// ════════════════════════════════════════════════════════════════

const TOURNAMENT_NAME    = "World Cup 2026 Pick'em";
const SHEET_NAME_ENTRIES = 'Entries';
const SHEET_NAME_CONFIG  = 'Config';
const NOTIFY_EMAIL       = 'jayemn@gmail.com';

// Entries columns: name | email | picks (JSON) | ts | paid
const ENTRY_HEADERS = ['name', 'email', 'picks', 'ts', 'paid'];

// Official kickoff date for each match (local match N = FIFA match 72+N),
// mirrors MATCH_DATES in world-cup.html. Each match's pick locks at noon
// Eastern (UTC-4) on its game day — keep this in sync with the frontend.
const MATCH_DATES = {
  1:'2026-06-28',  2:'2026-06-29',  3:'2026-06-29',  4:'2026-06-29',
  5:'2026-06-30',  6:'2026-06-30',  7:'2026-07-01',  8:'2026-07-01',
  9:'2026-07-01',  10:'2026-07-01', 11:'2026-07-02', 12:'2026-07-03',
  13:'2026-07-03', 14:'2026-07-03', 15:'2026-07-03', 16:'2026-07-04',
  17:'2026-07-04', 18:'2026-07-04', 19:'2026-07-05', 20:'2026-07-05',
  21:'2026-07-06', 22:'2026-07-06', 23:'2026-07-07', 24:'2026-07-07',
  25:'2026-07-09', 26:'2026-07-10', 27:'2026-07-11', 28:'2026-07-11',
  29:'2026-07-14', 30:'2026-07-15',
  31:'2026-07-19'
};
function isMatchLocked(matchId) {
  const d = MATCH_DATES[matchId];
  if (!d) return false;
  return new Date() >= new Date(d + 'T12:00:00-04:00');
}

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
function configSheet()  { return getOrCreateSheet(SHEET_NAME_CONFIG,  ['key', 'value']); }

function getConfig(key) {
  const data = configSheet().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return null;
}

function setConfig(key, value) {
  const sheet = configSheet();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) { sheet.getRange(i + 1, 2).setValue(value); return; }
  }
  sheet.appendRow([key, value]);
}

function rowForName(name) {
  const data = entriesSheet().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === name.toLowerCase()) return i + 1;
  }
  return -1;
}

function getAllEntries() {
  const rows = entriesSheet().getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1).map(r => ({
    name:  r[0],
    email: r[1],
    picks: r[2] ? JSON.parse(r[2]) : {},
    ts:    r[3],
    paid:  r[4] === true || r[4] === 'TRUE' || r[4] === 'true'
  }));
}

function entryToRow(e) {
  return [e.name, e.email, JSON.stringify(e.picks || {}), e.ts, e.paid || false];
}

// ── Routing ────────────────────────────────────────────────────

function doGet(e) {
  let result;
  try { result = handleGet(); }
  catch(err) { result = { error: err.message }; }
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
    else if (action === 'setBracket')  result = handleSetBracket(body.bracket);
    else if (action === 'setLocked')   result = handleSetLocked(body.locked);
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
  const resultsRaw = getConfig('results');
  const lockedRaw  = getConfig('locked');
  const bracketRaw = getConfig('bracket');
  return {
    entries: getAllEntries(),
    results: resultsRaw ? JSON.parse(resultsRaw) : {},
    locked:  lockedRaw === true || String(lockedRaw).toLowerCase() === 'true',
    bracket: bracketRaw ? JSON.parse(bracketRaw) : {}
  };
}

function handleSaveEntry(entry) {
  if (!entry || !entry.name) return { ok: false, error: 'Missing entry name' };
  const lockedRaw = getConfig('locked');
  if (lockedRaw === true || String(lockedRaw).toLowerCase() === 'true') {
    return { ok: false, error: 'Pool is locked — the bracket has started and picks are closed.' };
  }

  const sheet = entriesSheet();
  const existingRow = rowForName(entry.name);
  let updated = false;
  let existingPicks = {};

  if (existingRow > 0) {
    const existingRowVals = sheet.getRange(existingRow, 1, 1, ENTRY_HEADERS.length).getValues()[0];
    existingPicks = existingRowVals[2] ? JSON.parse(existingRowVals[2]) : {};
    // Preserve the existing paid status so a resubmit never clears it
    const existingPaid = existingRowVals[4];
    entry.paid = existingPaid === true || String(existingPaid).toLowerCase() === 'true';
  }

  // Enforce per-match lock: once a match's kickoff cutoff has passed, its
  // pick can no longer change — keep whatever was already saved for it
  // (or leave it unset if it was never picked before the lock).
  const incomingPicks = entry.picks || {};
  const finalPicks = {};
  for (const mid of Object.keys(MATCH_DATES)) {
    if (isMatchLocked(mid)) {
      if (existingPicks[mid] !== undefined) finalPicks[mid] = existingPicks[mid];
    } else if (incomingPicks[mid] !== undefined) {
      finalPicks[mid] = incomingPicks[mid];
    }
  }
  entry.picks = finalPicks;

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, ENTRY_HEADERS.length).setValues([entryToRow(entry)]);
    updated = true;
  } else {
    sheet.appendRow(entryToRow(entry));
  }

  try {
    const picks = entry.picks || {};
    const champion = picks[31] || '—';
    const sf1 = picks[29] || '—';
    const sf2 = picks[30] || '—';
    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: `${TOURNAMENT_NAME}: ${entry.name} ${updated?'updated':'submitted'} their bracket`,
      body: [
        `${entry.name} (${entry.email||'no email'}) just ${updated?'updated':'submitted'} their bracket.`,
        '',
        `Champion pick:  ${champion}`,
        `Semifinal picks: ${sf1} / ${sf2}`,
        `Total matches picked: ${Object.keys(picks).length} / 31`,
      ].join('\n')
    });
  } catch(_) {}

  return { ok: true, updated };
}

function handleDeleteEntry(name) {
  if (!name) return { ok: false, error: 'Missing name' };
  const row = rowForName(name);
  if (row > 0) entriesSheet().deleteRow(row);
  return { ok: true };
}

function handleClearEntries() {
  const sheet = entriesSheet();
  const last  = sheet.getLastRow();
  if (last > 1) sheet.deleteRows(2, last - 1);
  return { ok: true };
}

function handleSetResults(results) {
  setConfig('results', results ? JSON.stringify(results) : '{}');
  return { ok: true };
}

function handleSetBracket(bracket) {
  setConfig('bracket', JSON.stringify(bracket || {}));
  return { ok: true };
}

function handleSetLocked(locked) {
  setConfig('locked', locked ? 'true' : 'false');
  return { ok: true };
}

function handleSetPaid(name, paid) {
  if (!name) return { ok: false, error: 'Missing name' };
  const row = rowForName(name);
  if (row < 0) return { ok: false, error: 'Entry not found' };
  entriesSheet().getRange(row, 5).setValue(paid ? true : false);
  return { ok: true };
}
