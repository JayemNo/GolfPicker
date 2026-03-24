# Masters Pick'em 2026

Single-file web app for a golf betting pool. One HTML file + one Apps Script backend.

## Project Files

- `index.html` — the entire frontend app (hosted on GitHub Pages)
- `apps-script.js` — Google Apps Script backend (deployed as a Web App, not run locally)

## Hosting

- **Frontend:** GitHub Pages — upload `index.html` as `index.html` to the repo root
- **Backend:** Google Apps Script Web App
- **Admin URL:** append `?admin` to the page URL, then enter password

## Backend Connection

```js
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxQYxMhRSonMipJPuJcUxAPGTGp_TTJxVBw7tbD30uVzrh-aXbqMamO24zJMnN3frqP/exec';
const ADMIN_PASSWORD = 'augusta2026'; // change before sharing
```

After any change to `apps-script.js`, redeploy via Deploy → Manage Deployments → New Version. The URL stays the same.

## Google Sheet Structure

Two tabs auto-created by the script:

**Entries** (columns A–S):
`name, email, winner, score, margin, lowRound, p2–p12 (11 cols), ts, paid`

**Config** (key/value pairs):
`results` (JSON), `locked` (true/false), `players` (JSON array)

## Scoring Rules

| Pick | Points |
|------|--------|
| Exact winner | 5 |
| Picked winner finishes 2nd–12th | 1 |
| Exact winning score (vs par) | 3 |
| Exact lowest round score | 2 |
| Exact finishing position (2nd–12th) | 2 |
| Player in top 12, wrong position | 1 |
| **Max possible** | **27** |

**Tiebreaker:** closest predicted winning margin (strokes ahead of 2nd place). No points awarded.

## Entry Fee & Prizes

- $10 entry — send to jayemn@gmail.com
- 1st: 70% · 2nd: 20% · 3rd: 10%

## Key Architecture Decisions

- **No localStorage** — Google Sheets is the single source of truth
- All picks, results, lock state, and player roster live in the Sheet
- `loadAll()` fetches everything from the Sheet and updates local JS variables
- Entries tab and Leaderboard tab auto-refresh from Sheet on every tab click
- Admin tab only visible when `?admin` is in the URL, then password-gated

## App Sections

1. **Submit Picks** — participant form with name, email, all dropdowns, edit-by-name lookup
2. **All Entries** — live table from Sheet, colour-coded after results entered (green=exact, gold underline=in top 12, red=miss)
3. **Leaderboard** — ranked by score, tiebreaker by margin diff, shows prize money, paid/unpaid badges
4. **Admin** (`?admin`) — pool lock toggle, player roster, official results entry, manage entries with paid checkbox

## Player Dropdowns

- Combo-box style: type to filter, full 2026 Masters field (~88 players) pre-loaded
- Free-type allowed: if a name isn't in the list, "＋ Add [name]" appears
- Duplicate validation on submit — same player cannot appear in multiple positions

## Pool Lock

Admin can lock the pool (e.g. when Masters starts April 9). When locked:
- Submit Picks form is hidden and replaced with a red locked banner
- `submitPicks()` also hard-blocks server-side equivalent via check at top of function
- Lock state saved to Sheet Config tab so all users see it immediately

## Paid Status

- Admin toggles a checkbox per entry in Manage Entries
- Saves `paid: true/false` to column S of the Entries sheet via `setPaid` API action
- Leaderboard shows green **✓ PAID** or red **UNPAID** badge next to every name

## Apps Script API Actions

| Action | Method | Description |
|--------|--------|-------------|
| `get` | GET | Returns all entries, results, locked, players |
| `saveEntry` | POST | Upserts an entry by name |
| `deleteEntry` | POST | Deletes entry by name |
| `clearEntries` | POST | Deletes all entries |
| `setResults` | POST | Saves/clears official results |
| `setLocked` | POST | Sets pool lock state |
| `setPlayers` | POST | Updates player roster |
| `setPaid` | POST | Toggles paid status for one entry |

## Common Tasks

**Add a new field to entries:**
1. Add column header to `ENTRY_HEADERS` in `apps-script.js`
2. Add to `getAllEntries()` row mapping
3. Add to `entryToRow()` function
4. Add input to the pick form HTML
5. Read it in `submitPicks()`, include in `entry` object
6. Handle in `renderEntries()`, `renderLeaderboard()`, `calcScore()` as needed
7. Redeploy Apps Script with new version

**Change the admin password:**
Find `const ADMIN_PASSWORD = '...'` near the top of the `<script>` block in `index.html`.

**Update the player roster:**
Use the Admin tab → Player Roster section, or edit `DEFAULT_PLAYERS` array in the script for permanent changes.

## Known Issues Fixed

- Nav tab `onclick` attributes moved to `addEventListener` in init block to avoid "showPanel is not defined" on GitHub Pages with `?admin` query string
- `removeEntry` function declaration was accidentally dropped — now restored
- `tab-picks` listener was missing from init — all four tabs now wired
- Leaderboard was blank on first load — fixed by calling `renderLeaderboard()` after initial `loadAll()`
- Dropdown capped at 60 items — cap removed, full field scrollable
