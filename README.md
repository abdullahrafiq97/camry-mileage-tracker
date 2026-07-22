# Camry SE Mileage Tracker

A mobile-first PWA that tracks actual mileage against a lease allowance for a
2026 Toyota Camry Hybrid SE. All data stays on the device (localStorage); the
screenshot OCR runs entirely in the browser (Tesseract.js, bundled locally in
`vendor/`) — **zero cost, no accounts, no APIs, works offline once loaded.**

## Run it

```bash
cd "Car Mileage Tracker"
python3 -m http.server 8123
```

Open http://localhost:8123. (It must be served over http — opening `index.html`
directly with `file://` breaks the OCR worker.)

### On your phone

- **Same Wi-Fi (quick):** find your Mac's IP (System Settings → Wi-Fi → Details),
  then open `http://<mac-ip>:8123` on your phone. Data is stored on the phone.
- **Installable PWA (best):** host this folder anywhere with HTTPS — GitHub Pages
  is free (push the folder to a repo, enable Pages). Then on the phone open the
  URL → Share → **Add to Home Screen**. The service worker (`sw.js`) caches
  everything, so it works fully offline afterwards.

## How the math works (matches `Car Mileage tracker.xlsx`)

- Daily allotment = annual allowance ÷ 365
- The lease start date counts as **day 1** (a full day accrues immediately):
  days elapsed = (today − start) + 1, clamped to [0, total lease days]
- Miles allotted = daily rate × days elapsed
- Miles driven = latest odometer − starting odometer
- **Net surplus/deficit = allotted − driven** (green = banked, red = over pace)
- Pace needed = (total allowance − driven) ÷ days remaining

Validated against the known example: 12,000 mi/yr starting 2026-07-17 with
101 mi logged on day 5 → **+63.4 banked**. Run the tests:

```bash
node tests/logic.test.js
```

## Stats tab

- **This year** — the current lease year's performance: banked/over-pace balance,
  driven vs. allotted, actual pace vs. needed pace, days left, and a projected
  year-end total at your current pace.
- **Lease total** — the same for the whole lease, including projected lease-end
  mileage and margin.
- **All years** — one card per lease year (anniversary to anniversary) with
  driven vs. allowance and a usage bar; miles at year boundaries are split by
  linear interpolation between the surrounding readings. A 366-day lease year
  (spanning a leap day) accrues slightly more than 12,000 because allotment
  accrues daily at annual ÷ 365 — same model as the spreadsheet.

## Screenshot scanning

On the **Log** tab, tap *Scan a screenshot* (or paste an image) of the Toyota
app screen showing “Odometer … mi”. The app crops the top of the image,
upscales/grayscales it, runs OCR locally, and looks for the number between
“Odometer” and “mi”. The detected value is shown with a confidence badge and
only **pre-fills** the form — nothing is saved until you confirm. Readings that
go backwards vs. your last entry get a warning.

## Automatic daily odometer sync (unofficial)

`sync/pull_odometer.py` uses the reverse-engineered **toyota-na** library (the
same one the Home Assistant community uses) to read the odometer from Toyota's
North America backend — the same data the Toyota app shows. **This is not an
official API**: it can break whenever Toyota changes their servers, and it's
gray-area under Toyota's terms of service.

One-time setup (your credentials go straight to Toyota; only OAuth tokens are
stored, in `sync/tokens.json`, chmod 600 and gitignored):

```bash
cd "Car Mileage Tracker"
sync/.venv/bin/python sync/pull_odometer.py setup
```

After that, a launchd agent (`~/Library/LaunchAgents/com.camry.mileage-sync.plist`)
runs `sync/run_daily.sh` every day at 9 PM while the Mac is awake: it pulls the
odometer, appends `{date, odometer}` to `sync/readings.json`, and pushes — GitHub
Pages redeploys, and the app merges the new readings the next time it loads.
Manual entries always win over synced ones on the same date. Logs:
`/tmp/camry-mileage-sync.log`. To stop it:
`launchctl unload ~/Library/LaunchAgents/com.camry.mileage-sync.plist`.

Note: the repo is public (free GitHub Pages requires it), so `readings.json` —
dates and odometer values only — is publicly visible. The spreadsheet and
tokens are gitignored.

## Files

- `index.html` / `styles.css` / `app.js` — UI (gunmetal “Heavy Metal” cockpit theme)
- `logic.js` — pure calculation module (shared with tests)
- `tests/logic.test.js` — 30 assertions, run with Node
- `sw.js`, `manifest.webmanifest`, `icons/` — PWA install + offline
- `vendor/` — Tesseract.js + WASM cores + English OCR data (~18 MB, all local)

Backups: **Setup → Export backup** downloads a JSON file; import it on any
device to restore. Note: `sw.js` caches aggressively — bump `VERSION` in it
whenever you edit app files.
