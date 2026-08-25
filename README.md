# NoMeh!

A privacy-first, offline-first personal performance tracker. Nutrition, training,
running and cycling, recovery, body composition, and analytics — all stored in
your browser, on your device, with no account and no server.

There is no backend. There is nothing to sign up for. Nothing you log leaves the
device unless you export it yourself.

---

## Deploying to GitHub Pages

No build step. No `npm install`. The files in this repository *are* the app.

1. Create a repository and upload every file, keeping the folder structure.
2. **Settings → Pages → Source: Deploy from a branch**, pick `main` and `/ (root)`.
3. Wait a minute, then open `https://<you>.github.io/<repo>/`.

It works from a subpath — every asset reference is relative, the manifest uses
`"./"` for `start_url` and `scope`, and routing is hash-based (`#/today`), which
is the only form that survives a hard refresh on Pages without server rewrite
rules. `404.html` catches path-style URLs and redirects them into the router.

**On every subsequent deploy, bump `CACHE_VERSION` in `sw.js`.** The service
worker serves the shell from cache; without a bump, returning visitors keep the
old JavaScript against your new HTML. It is currently `v2.0.0`.

### Installing it on a phone

- **Android/Chrome** — the browser offers "Install app", or use ⋮ → Add to Home screen.
- **iOS/Safari** — Share → Add to Home Screen. **Do this.** iOS deletes IndexedDB
  for sites unvisited for seven days, and installing to the Home Screen is what
  exempts you. Uninstalled, on iOS, your data has a one-week fuse.

Either way: export a backup regularly. Settings → Backup.

---

## Changing colours and constants

There are two configuration files, and between them they hold every value in the
app that is a judgement call rather than a law of physics.

### `src/config/theme.js` — everything visual

Three ways to recolour, in increasing order of effort:

**1. Pick a different preset.** Change one line:

```js
export const ACTIVE_PRESET = 'ember';   // void | ember | deep | moss | paper | contrast
```

`paper` is a light theme. `contrast` is maximum-legibility: pure black, no blur.

**2. Edit the palette directly.** In `DEFAULT_THEME.palette`:

```js
performance: '#00e08a',  // activity, streaks, anything "on track"
nutrition:   '#ffb020',  // food, calories, macros
strength:    '#7c5cff',  // resistance training, PRs
recovery:    '#38d6ff',  // hydration, sleep, readiness
alert:       '#ff3b5c',  // warnings, peak heart-rate zones
```

Those five carry *meaning*. Swap the hues freely, but keep each meaning attached
to its key or the app's colour language stops parsing. Everything else —
surfaces, borders, text, glass — is in the same object.

**3. From inside the app.** Settings → Appearance lists every preset, and "Edit
colours" gives you a colour picker per hue that saves to the database. Good for
trying things on one device without touching code.

Also parameterised in the same file: fonts (including `fonts.remote: false` to
drop the Google Fonts request entirely and use system fonts), the spacing scale,
corner radii, blur strength, tint opacity, dock height, and animation timings.

Nothing in `styles/*.css` needs editing to recolour. The stylesheets read CSS
custom properties, and `theme.js` writes them at boot. `styles/tokens.css` holds
the same defaults so the first paint is correct before JavaScript runs — if you
change a default in one place, change it in both, or just use a preset.

### `src/config/app.config.js` — everything behavioural

The rule this file enforces: **no magic numbers anywhere else in the codebase.**
Every entry has a comment explaining what changes when you change it.

| Section | Controls |
|---|---|
| `FEATURES` | 17 master switches. Turning one off removes its screens, its dock tab, and its background work. |
| `PHYSIOLOGY` | Activity factors, goal definitions, calorie floors, macro splits, hydration rates, heart-rate zones, BMI bands. |
| `TRAINING` | 1RM formula, rest periods, progression rules, load-model windows, spike threshold. |
| `GPS` | Accuracy gate, movement threshold, speed sanity limit, smoothing, elevation noise floor, split distance. |
| `ANALYTICS` | Trend windows, chart ranges, sufficiency thresholds, correlation minimums. |
| `READINESS` | Input weights, minimum inputs before a score is shown, score bands. |
| `NUTRITION` | Meal slots, kcal per gram, search behaviour, cache lifetime, sanity tolerance. |
| `PHOTOS` | Resize dimensions, quality, format, poses, ghost opacity, storage warning. |
| `SECURITY` | PBKDF2 iterations, cipher, minimum passphrase length. |
| `PARSER` | Quick-log vocabulary — add your own words here rather than editing the parser. |
| `UI` | Navigation order, page sizes, toast timings, confirmation phrases. |
| `SAFETY` | The guardrails, as auditable switches rather than buried prose. |

This is not a decorative config file. `biomath.js` was rewired to read from it —
there is no longer a single hard-coded physiological constant in the engines, and
the test suite passes against the config-derived values.

**Example — make it a lifting-only app:**

```js
export const FEATURES = {
  nutrition: false, hydration: false, endurance: false, gps: false,
  strength: true, recovery: true, /* ... */
};
```

The Diary and Runs tabs disappear entirely. Nothing is left half-visible.

---

## What is actually built

Honest accounting. Not everything is equally finished.

### Production quality — built, tested, and I would rely on it

| Area | Notes |
|---|---|
| **Shell, routing, PWA, offline** | Hash router, service worker, install prompts, capability detection. |
| **Data layer** | Dexie/IndexedDB, schema v3, real migrations, repository layer, soft delete, audit trail, timezone-aware date keys. |
| **Parameterisation** | Both config files, the runtime theme picker, per-colour overrides. |
| **Bio-math engine** | Mifflin-St Jeor, TDEE, macro targets with a hard calorie floor, hydration, unit conversion. |
| **Universal quick-log** | 17 log types, 9 matchers, confidence scoring, nothing written without confirmation. |
| **Nutrition** | Food database, per-100g normalisation, portions, meal slots, macro reconciliation, recipes, Open Food Facts with 30-day caching, barcode scanning where supported. |
| **Training** | 1RM across three formulas, PR detection, progression suggestions, rest timer that survives screen lock, live session writes, 60 seeded exercises, 4 programmes. |
| **GPS / endurance** | Full filter pipeline, live HUD, wake lock, splits, moving time, elevation, route rendering, GPX import **and** export. |
| **Recovery** | Sleep analysis, readiness with a genuine refusal state, ATL/CTL training load, correlations. |
| **Charts** | Hand-rolled SVG: line, bar, stacked, sparkline. Gaps render as gaps, never as zeros. |
| **Encrypted backup** | PBKDF2 + AES-GCM, self-describing header, distinguishes a wrong passphrase from a damaged file. |
| **Test suite** | 208 tests over every pure engine. `npm test`, or open `tests.html`. |

### Thinner — works, but less polished than the above

- **Progress photos.** Capture, ghost-overlay alignment, resizing, timelapse, and
  storage accounting all work. The gallery is functional rather than beautiful,
  and there is no side-by-side comparison view yet.
- **Analytics screen.** The charts are solid; the screen is a stack of cards
  rather than a designed dashboard. No custom date ranges beyond the four presets.
- **Health import.** Apple Health XML, Strava CSV and Google Takeout CSV all
  parse and import correctly, including chunked reading so a 500 MB export does
  not exhaust memory. But large Apple exports are slow and may only complete on
  a desktop browser, and only a subset of Apple's record types is recognised.
- **Programmes.** You can start a session from a template, but the app does not
  yet walk you through the prescribed sets — it opens a free session and leaves
  you to follow the plan.

### Not built

- Recipes have an engine and storage but no dedicated management screen; they are
  reachable only through the diary.
- Grocery list, leftovers tracking, and bike maintenance logging have tables in
  the schema but no UI.
- Achievements beyond PR detection.
- No automated tests for the database, migration, or backup-restore paths. Those
  need a real IndexedDB, which means a browser driver. **This is the largest gap
  in the test coverage and I would rather say so than ship tests that only look
  like coverage.**

---

## Platform limits you should know about

These are constraints of the web platform, not shortcuts. The app states each one
in context rather than failing mysteriously.

- **iOS deletes IndexedDB after 7 days of not visiting**, unless the app is
  installed to the Home Screen. This is the single biggest risk to your data.
- **No background GPS on iOS.** When the screen locks, WebKit suspends
  JavaScript and `watchPosition` stops. Wake Lock — which prevents this — does
  not exist on iOS. There is no workaround. For long runs, record on a watch and
  import the GPX; the app treats that as a first-class path.
- **No Apple Health or Google Fit API.** HealthKit is native-only, full stop.
  Google Fit's REST API was retired and would need a secret key that a static
  site cannot keep secret. File import is the only honest option.
- **Web Bluetooth is absent from every iOS browser**, so no heart-rate straps
  there. Session load falls back to duration × RPE, which needs no hardware.
- **`BarcodeDetector` is Chromium-only.** Elsewhere the app offers manual entry
  instead of shipping a large WASM decoder most sessions never use.
- **Battery Status API** is absent in Safari and Firefox.
- **Notifications on iOS** require Home Screen installation.
- **A passkey is not encryption.** WebAuthn can gate entry to the app; deriving a
  key from it needs the PRF extension, which is not widely supported. The
  passphrase is the real mechanism.
- **The live database is not encrypted.** It cannot be — the app has to read it.
  Encryption protects the exported *file*. Anyone with your unlocked phone has
  your data.
- **Dexie loads from a pinned CDN** on first run. `src/db/dexie.js` documents the
  four steps to vendor it locally and remove that one network dependency.
- **Open Food Facts** asks clients to send an identifying `User-Agent`, which
  browsers do not permit. The app caches aggressively and stays well inside their
  rate limits instead.

---

## Safety, implemented rather than promised

These are in code and asserted by tests, not just described here:

- Calorie targets have an absolute floor (1200 / 1500 / 1300 kcal by sex) applied
  *after* every other adjustment, and are never set below estimated resting
  expenditure. A manual override under 1000 kcal is rejected.
- **Readiness refuses to produce a score from fewer than three inputs.** A number
  built from one data point is noise wearing a badge, and someone would
  reasonably train hard on the strength of it.
- **Nothing ever tells you to train harder in response to a fatigue signal.**
  There is a test that asserts this at peak readiness.
- Training load stays silent below 14 days of history.
- BMI is framed as a reference range, never as a verdict, and always with the
  caveat that it cannot distinguish muscle from fat.
- Body measurements are never described in judgemental language.
- Correlations always carry "not causation", and are not reported below 12
  overlapping days.
- Every destructive action is confirmed; the irreversible ones require typing a
  word.
- Charts draw missing days as gaps. A day you did not weigh yourself is not a day
  you weighed nothing.

---

## Project layout

```
index.html  404.html  manifest.webmanifest  sw.js  tests.html
styles/     tokens.css (CSS defaults)  app.css
src/
  config/   theme.js          <- all colours, fonts, metrics
            app.config.js     <- all behavioural constants
  core/     main entry, router, ui, charts, cryptobox, appearance,
            capabilities, prefs
  db/       dexie, database (schema + migrations), repos, seeds
  engines/  biomath, logparser, analytics, training, geo, nutrition, recovery
            (all pure - no DOM, no database, no clock. This is what makes
             the test suite meaningful.)
  features/ one module per screen
  tests/    harness + 208 tests
```

Architecture rules worth preserving if you extend it:

1. **Engines stay pure.** No DOM, no database, no `Date.now()` inside a
   calculation. Testability is downstream of this.
2. **Features never touch Dexie directly** — always via `repos.js`, so soft
   delete, audit trails and timezone stamping happen in exactly one place.
3. **`dateKey` is stored, not derived**, and a timezone travels with every
   timestamp. Otherwise a trip abroad silently rewrites your history.
4. **Live records, not form submits.** Workout sets and GPS fixes are written as
   they happen, because a phone sleeping mid-session is not an edge case.

---

## Running the tests

```
npm test          # headless, no dependencies
```

Or open `tests.html` in a browser for the same suite with a UI.

Some of those tests exist because the bug they check for was real during this
build, and each one produced a *plausible, confident, wrong number* rather than a
crash — which is the dangerous kind. They are marked `REGRESSION`:

- `Number(null)` is `0` and `0` is finite, so a missing soreness reading arrived
  as a present reading of zero, scored as perfect, and readiness returned a
  confident score from a single real input.
- Fibre counted at 4 kcal/g made every high-fibre vegetable fail a sanity check
  on data that was perfectly correct.
- A tower-handoff GPS jump, accepted, adds distance that was never travelled.
- Barometric jitter of a metre, accumulated over hundreds of samples, turns a
  flat park loop into 300 m of climb.
- Apple's date format parses in Chrome and returns `NaN` in Safari — which would
  have silently discarded every record on the very device the export came from.

---

*Estimates are labelled as estimates. This is not a medical device, and nothing
here diagnoses anything.*
