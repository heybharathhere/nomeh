# NoMeh!

A private, offline-first personal performance app. Everything is stored in your browser, on your device. No account, no server, no subscription, no telemetry.

**This repository is the deployed app.** There is no build step. Drop these files into a GitHub repository, turn on Pages, and it runs.

---

## Read this first: what is and is not built

The specification describes 44 subsystems — nutrition databases, GPS tracking, cycling power estimation, anatomical SVG selectors, WebAuthn vaults, timelapse photo pipelines. Its own implementation strategy divides that into eight phases and says, in bold terms: *do not attempt to build every feature simultaneously, build in vertical slices, build the data model first.*

**This is Phase 1, built properly, end to end.** Nothing is stubbed, mocked, or faked. Every button in the app does what it says.

| Built and working | Declared but empty | Not built |
|---|---|---|
| Versioned Dexie schema (all 30+ domain tables) | Nutrition, workout, GPS, sleep, photo tables | Food database & Open Food Facts |
| Repository layer with soft delete, restore, audit trail | | Barcode scanning |
| Bio-math engine (BMI, BMR, TDEE, macros, hydration, sweat rate) | | GPS tracking & live HUD |
| Universal LOG — 17 record types, all editable/undoable | | Anatomical SVG selector |
| Natural-language quick-log parser with confirm-before-save | | Training programs & progression |
| Today dashboard, Universal Timeline, Body progression, Goals | | Recovery scoring model |
| Backup: JSON export/import with validation & duplicate detection | | Progress photos & Ghost Viewfinder |
| CSV log export, GPX exporter | | Web Bluetooth sensors |
| Storage dashboard, privacy dashboard, capability matrix | | Encrypted vault / WebAuthn |
| Trash with restore, tiered destructive confirmations | | Charts beyond the weight sparkline |
| Service worker, offline shell, update flow, PWA install | | |
| 64 automated tests, runnable in-browser and headless | | |

Where a feature is absent, the app **says so on the screen where you would look for it** — see the Progress photos card in Body. It does not show an empty chart and hope you don't notice.

The one place this is most visible is **Readiness on the Today screen**. The spec asks for a readiness engine over sleep, HRV, resting HR, training load, RPE and soreness. With two data points, any score would be noise dressed as insight — and you would reasonably train hard on the strength of a green badge. So it shows you which inputs exist, which are missing, and refuses to produce a number until it has a baseline.

---

## Cautious reading of the spec: 11 things worth knowing before you build further

The two documents are consistent with each other — `polromt.docx` is the build prompt for `NoMeh!_Complete_Product_&_UX.docx`, and I found no contradictions between them. What I did find are places where the spec asks for something the web platform cannot actually deliver as described. Since the spec itself says *do not fabricate unsupported browser capabilities* and *do not pretend iOS Safari supports APIs it does not reliably support*, these are flagged rather than quietly implemented as illusions.

**1. iOS storage eviction is the single biggest risk to this product.** A local-first app with no cloud has exactly one copy of the user's data. Safari can clear IndexedDB after roughly seven days of no use for sites that are not installed to the Home Screen. `navigator.storage.persist()` — the API that asks for protection — is largely Chromium-only. Mitigation in this build: the capability matrix says so explicitly, Settings offers the persist request where available, and there is a backup nudge that escalates when an export is overdue. There is no technical fix; only honesty and backup discipline.

**2. Background GPS in a browser is not reliable, and no amount of engineering changes that.** iOS suspends JavaScript when the screen locks. Wake Lock helps on Chromium but is patchy on iOS. A user who starts a run, pockets the phone and locks the screen will get a truncated route. The realistic architecture is: foreground tracking with the screen awake, plus a first-class GPX import path for watch data. Building a "background tracking" toggle would be the fake implementation the spec forbids.

**3. Web Bluetooth does not exist on iOS.** Not in Safari, and not in Chrome for iOS either, since all iOS browsers use WebKit. Heart-rate straps, cadence sensors and power meters are Chromium/Android-only. The spec's cycling power and FTP features are therefore Android-first by necessity.

**4. There is no web API for Apple Health or Google Fit.** "Health integrations" can only mean file import — an Apple Health export XML, a Google Takeout archive, a Garmin/Strava export. Not live sync. This changes the feature's shape substantially and is worth deciding early.

**5. Battery Status API is unavailable in Safari and Firefox.** §26's battery-aware GPS sampling works on Chromium only. Everywhere else, low-battery warnings during long sessions are impossible.

**6. WebAuthn authenticates; it does not encrypt.** A passkey can gate access to the app, but deriving an encryption key from it requires the PRF extension, which has limited support. The practical design for §31's "encrypted NoMeh backup" is a passphrase run through WebCrypto PBKDF2, with the passkey as a convenience unlock on top. The spec is already right that client-side protection is not equivalent to a hardened server — worth keeping that framing in the UI.

**7. Notifications on iOS require Home Screen installation** (iOS 16.4+). A reminder system that silently does nothing for uninstalled iOS users is worse than one that explains the prerequisite.

**8. Barcode scanning splits by engine.** `BarcodeDetector` is Chromium-only. Everywhere else needs a WASM decoder (ZXing or similar), which is a real bundle-size decision — lazy-load it, don't ship it in the shell.

**9. Weather data and the no-API-keys rule collide.** §34's environmental context needs a weather provider, and most require a key, which cannot go in client-side code. Open-Meteo is keyless and CORS-friendly — that is the answer to this constraint.

**10. Open Food Facts is usable but has caveats.** Keyless and CORS-enabled, but it asks clients to identify themselves via User-Agent, which browsers will not let you set. Rate limits apply. Cache aggressively and always keep the local food database as the primary path, exactly as §8 requires.

**11. Routing had to be hash-based.** GitHub Pages serves static files with no rewrite rules, so History-API routing 404s on refresh at `/REPO/today`. Hash routes (`#/today`) survive a hard refresh, a shared link and a cold start from the Home Screen with zero server configuration. A `404.html` fallback catches hand-typed path-style URLs.

---

## Deploy it (browser only — no terminal, no Node, no build)

1. Create a new GitHub repository, e.g. `nomeh`.
2. On the repository page choose **Add file → Upload files**, then drag the entire contents of this folder in. GitHub's web uploader accepts nested folders, so `src/`, `styles/` and `assets/` come across intact.
3. Commit.
4. **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save.**
5. Wait about a minute. The app is live at `https://YOUR-NAME.github.io/nomeh/`.
6. Open it on your phone and install it (Share → Add to Home Screen on iOS; the install icon in the address bar on Android/desktop).

Nothing needs editing for a different repository name — every path in the app is relative.

**After each deploy, bump `CACHE_VERSION` in `sw.js`.** Otherwise returning visitors keep the previously cached shell. It is the only manual step in the release process.

### Optional: run the tests

- **In a browser:** open `tests.html` on the deployed site. It runs on the actual device, so a browser-specific difference in number or date handling shows up there rather than in your data.
- **Headless:** `npm test` (Node 18+, no dependencies to install). `package.json` exists only for this; the app itself does not use it.

---

## Architecture

```
index.html              app shell, dock navigation, landmarks
404.html                redirects path-style URLs into the hash router
manifest.webmanifest    PWA metadata, relative scope for subpath hosting
sw.js                   versioned precache, offline shell, update flow
tests.html              in-browser test runner

styles/
  tokens.css            palette, type, motion & contrast overrides
  app.css               components

src/
  main.js               boot sequence, route table, SW registration, error boundaries
  core/
    router.js           hash router with focus management
    ui.js               el() hyperscript, formatters, toasts, accessible modal
    capabilities.js     honest feature detection with platform caveats
    prefs.js            motion / contrast / text-size preferences
  db/
    dexie.js            the one place Dexie is imported (see below)
    database.js         versioned schema + migration pattern
    repos.js            repositories: CRUD, soft delete, restore, audit
  engines/              PURE. No DOM, no database. This is what the tests cover.
    biomath.js          BMI, BMR, TDEE, calorie floors, macros, hydration, conversion
    logparser.js        natural-language parsing → candidates, never writes
    analytics.js        daily totals, rolling averages, streaks, adaptive TDEE
  features/             one module per screen; all data access via repositories
    onboarding.js  today.js  log.js  timeline.js  body.js  settings.js  backup.js
  tests/
    harness.js  engines.test.js  node.mjs
```

Four rules the code enforces, so later phases inherit them rather than relitigating them:

- **Engines are pure.** No DOM, no database, no clock reads except where passed in. That is what makes 64 tests possible with no framework and no browser driver.
- **No feature module touches a Dexie table.** Everything goes through a repository, so soft delete, audit logging, timezone stamping and `dateKey` derivation happen in one place and cannot be forgotten at a call site.
- **`dateKey` is stored, not derived.** A local calendar day computed from a UTC timestamp at read time is wrong the moment the user travels, and IndexedDB cannot index a computed value.
- **`tz` travels with every timestamp.** A 06:00 run in Chennai and a 06:00 run in Berlin are different events.

### The one third-party dependency

Dexie is loaded from a pinned CDN URL and precached by the service worker, so after the first successful load the app is fully offline. **The first load does need a network connection.** That is the single honest deviation from "offline from the very first byte".

To remove it entirely, `src/db/dexie.js` documents the four-step vendoring process — download one file, commit it, change one line, add one path to the service worker. Recommended for a long-lived personal install.

---

## Known gaps in the test coverage

The build prompt asks for tests covering database CRUD, migrations, backup restoration, import/export, duplicate detection and GPS filtering. What is tested here is everything pure: bio-math, unit conversion, the parser, the analytics reducers — 64 assertions.

**The database, migration and backup-restore paths are not covered by automated tests.** They need a real IndexedDB and therefore a driven browser session (Playwright or similar), which needs a Node toolchain this repository deliberately does not have. That code is written defensively — restore validates fully before touching the database, runs in a single transaction, and detects duplicates by content signature rather than by id — but written defensively is not the same as verified. Manual checklist until that suite exists:

1. Log a few entries, export a full backup, erase all data, restore from the file, confirm the counts match.
2. Import the same backup twice. The second import should skip everything as duplicates.
3. Open the app in two tabs, log in one, and confirm the other prompts to reload rather than erroring.
4. Load once online, switch the device to airplane mode, close and reopen. Everything should still work.
5. Bump `CACHE_VERSION`, redeploy, and confirm the update toast appears rather than the old shell persisting.

---

## Roadmap (the spec's own phasing)

| Phase | Scope | Status |
|---|---|---|
| 1 | Shell, routing, theme, IndexedDB, profile, Universal LOG, service worker, PWA | **Done** |
| 2 | Nutrition, foods, meals, recipes, hydration | Next |
| 3 | Workout, exercise library, anatomical selector, programs, timers | |
| 4 | GPS, outdoor tracking, running, cycling, GPX import | |
| 5 | Recovery, sleep, training load, health file import | |
| 6 | Body photos, timelapse, analytics, PRs, achievements | |
| 7 | Recommendations, advanced analytics, encrypted vault | |
| 8 | Browser-driver test suite, optimisation, accessibility audit | |

Phase 2 is the natural next slice: the schema tables, repositories and log types already exist, so it is a nutrition search UI and an Open Food Facts cache rather than new foundations.

---

## A note on the health numbers

Every physiological figure in this app is an estimate from a population equation, labelled as one wherever it appears. Calorie targets have hard floors — 1200 kcal for female profiles, 1500 for male, and never below estimated resting expenditure — applied after every other adjustment, so an aggressive goal on a small frame cannot multiply down into a number that would be unsafe to follow. Readiness and training load are performance signals, not medical assessments, and the app never presents them as diagnoses.

If you are managing a medical condition, recovering from injury, or considering a significant change to how you eat or train, this app is a logbook, not a clinician.
