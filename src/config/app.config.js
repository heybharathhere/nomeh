/* ============================================================================
 * APP CONFIG — every tunable number, threshold, flag and endpoint.
 * ============================================================================
 *
 * The rule this file enforces: no magic numbers anywhere else in the codebase.
 * If a value is a judgement call rather than a law of physics, it belongs here
 * with a comment explaining what happens when you change it.
 *
 * Nothing here requires a rebuild — it is plain JavaScript served as-is.
 * Edit, commit, bump CACHE_VERSION in sw.js, and the change is live.
 */

/* --------------------------------------------------------------------------
 * IDENTITY
 * ------------------------------------------------------------------------ */
export const APP = {
  name: 'NoMeh!',
  shortName: 'NoMeh',
  tagline: 'No excuses. Just data.',
  /* Shown in Settings and written into every backup file, so an old export can
     be identified later. */
  version: '2.0.0',
  /* Bump ONLY for a breaking change to the backup file format. */
  backupFormat: 2,
  /* Storage key prefix. Change this and the app sees a fresh database — useful
     for running a test instance beside your real data on the same origin. */
  dbName: 'nomeh',
};

/* --------------------------------------------------------------------------
 * FEATURES — the master switches.
 *
 * Turning one off removes its navigation entry, its screens and its background
 * work. Nothing is left half-visible. Use this to ship a slimmer app: someone
 * who only tracks lifting can disable endurance and nutrition and lose the
 * clutter entirely.
 * ------------------------------------------------------------------------ */
export const FEATURES = {
  nutrition: true,       // food database, diary, macros, recipes
  hydration: true,       // water tracking
  strength: true,        // exercises, sets, programs, PRs
  endurance: true,       // runs, rides, GPS
  gps: true,             // live location tracking (needs HTTPS + permission)
  sleep: true,
  recovery: true,        // readiness, training load
  measurements: true,    // body sites, circumference tracking
  photos: true,          // progress photos, stored locally as blobs
  analytics: true,       // charts, trends, correlations
  achievements: true,    // PRs, milestones
  recommendations: true, // adaptive suggestions
  vault: true,           // passphrase-encrypted backups
  healthImport: true,    // Apple Health / Google Fit / Strava file import
  barcode: true,         // barcode scanning where the browser supports it
  offFoodApi: true,      // Open Food Facts lookups (network, optional)
  weather: true,         // Open-Meteo environmental context (network, optional)
};

/* --------------------------------------------------------------------------
 * PHYSIOLOGY
 *
 * These drive every number the app estimates. They are population averages —
 * changing them changes your targets, so change them deliberately.
 * ------------------------------------------------------------------------ */
export const PHYSIOLOGY = {
  /* Multiplied by BMR to estimate total daily expenditure. */
  activityFactors: {
    sedentary:  { factor: 1.2,   label: 'Sedentary',      hint: 'Desk work, little deliberate movement' },
    light:      { factor: 1.375, label: 'Lightly active', hint: 'Light exercise 1–3 days a week' },
    moderate:   { factor: 1.55,  label: 'Moderate',       hint: 'Moderate exercise 3–5 days a week' },
    high:       { factor: 1.725, label: 'Very active',    hint: 'Hard exercise 6–7 days a week' },
    athlete:    { factor: 1.9,   label: 'Athlete',        hint: 'Twice-daily training or physical job' },
  },

  /* Goals. `calorieDelta` is a fraction of maintenance, `proteinPerKg` is grams
     per kg of bodyweight, `domain` decides which functional colour and which
     dashboard cards the goal emphasises ('nutrition' | 'strength' |
     'endurance' | 'general').

     Add your own goal by copying a line. It appears in onboarding and in
     Settings automatically. */
  goals: {
    fat_loss:     { label: 'Fat loss',            calorieDelta: -0.18, proteinPerKg: 2.0, domain: 'nutrition' },
    hypertrophy:  { label: 'Muscle growth',       calorieDelta: +0.10, proteinPerKg: 1.9, domain: 'strength'  },
    strength:     { label: 'Strength',            calorieDelta: +0.05, proteinPerKg: 1.8, domain: 'strength'  },
    general:      { label: 'General fitness',     calorieDelta:  0.00, proteinPerKg: 1.6, domain: 'general'   },
    endurance:    { label: '10K+ endurance',      calorieDelta:  0.00, proteinPerKg: 1.6, domain: 'endurance' },
    calisthenics: { label: 'Calisthenics',        calorieDelta: -0.05, proteinPerKg: 1.9, domain: 'strength'  },
    cycling:      { label: 'Cycling performance', calorieDelta:  0.00, proteinPerKg: 1.6, domain: 'endurance' },
    recomp:       { label: 'Recomposition',       calorieDelta: -0.05, proteinPerKg: 2.2, domain: 'strength'  },
    consistency:  { label: 'Consistency',         calorieDelta:  0.00, proteinPerKg: 1.6, domain: 'general'   },
  },

  /* Fraction of total calories allocated to fat before carbohydrate takes the
     remainder. Lower it for a higher-carb split. */
  fatFractionOfCalories: 0.25,
  /* Fibre target, grams per 1000 kcal. */
  fibrePer1000Kcal: 14,

  /* BMI reference bands. Framed as reference ranges, never as verdicts. */
  bmiBands: [
    { under: 18.5, band: 'below the reference range' },
    { under: 25,   band: 'within the reference range' },
    { under: 30,   band: 'above the reference range' },
    { under: Infinity, band: 'well above the reference range' },
  ],

  /* SAFETY FLOOR. Applied last, after every other adjustment, so an aggressive
     goal on a small frame cannot multiply down into an unsafe target.
     Lowering these is not recommended. */
  calorieFloor: { female: 1200, male: 1500, unspecified: 1300 },
  /* The target is also never allowed below estimated resting expenditure. */
  neverBelowBmr: true,
  /* A manual override below this is rejected outright. */
  manualOverrideMin: 1000,

  /* Hydration: millilitres per kg of bodyweight per day, plus a fixed activity
     allowance keyed to the activity factor above. */
  waterMlPerKg: 35,
  waterMlByActivity: { sedentary: 0, light: 250, moderate: 500, high: 750, athlete: 1000 },
  waterMlPerTrainingHour: 500,
  waterMlHotClimateBonus: 500,     // added when weather context says it is hot
  hotClimateCelsius: 30,

  /* Energy in one kg of body mass. Used for weight-change projection and the
     adaptive expenditure estimate. ~7700 kcal is the standard figure. */
  kcalPerKg: 7700,

  /* Heart-rate zone boundaries as a fraction of maximum. */
  hrZones: [
    { zone: 1, from: 0.50, to: 0.60, label: 'Recovery',   colour: 'recovery' },
    { zone: 2, from: 0.60, to: 0.70, label: 'Endurance',  colour: 'performance' },
    { zone: 3, from: 0.70, to: 0.80, label: 'Tempo',      colour: 'nutrition' },
    { zone: 4, from: 0.80, to: 0.90, label: 'Threshold',  colour: 'strength' },
    { zone: 5, from: 0.90, to: 1.01, label: 'VO2 max',    colour: 'alert' },
  ],
  /* Estimated maximum heart rate. 'tanaka' (208 − 0.7 × age) is more accurate
     across ages than the familiar 220 − age; 'simple' gives you the latter. */
  hrMaxFormula: 'tanaka',

  /* Sweat-rate estimation bounds, litres per hour. Values outside this range
     usually mean a mis-typed weight rather than genuine physiology. */
  sweatRateSane: { min: 0.2, max: 3.5 },
};

/* --------------------------------------------------------------------------
 * TRAINING
 * ------------------------------------------------------------------------ */
export const TRAINING = {
  /* Which one-rep-max formula to use: 'epley' | 'brzycki' | 'lombardi'.
     They diverge above about 10 reps; Epley is the common default. */
  oneRmFormula: 'epley',
  /* Estimates from more reps than this are too unreliable to record as a PR. */
  oneRmMaxReps: 12,

  /* Rest timer defaults in seconds, by the kind of set logged. */
  restSeconds: { strength: 180, hypertrophy: 90, endurance: 60, power: 240 },

  /* Progressive overload suggestion. When every prescribed rep is completed at
     an RPE at or below `easyRpe` for `sessionsBeforeIncrease` sessions running,
     the app suggests adding load. */
  easyRpe: 7,
  sessionsBeforeIncrease: 2,
  loadIncrement: { upper: 2.5, lower: 5, kg: true },   // kg added per step

  /* Training load model (the standard exponentially-weighted approach).
     Acute is recent fatigue, chronic is accumulated fitness. */
  acuteDays: 7,
  chronicDays: 28,
  /* Acute:chronic ratio above this is flagged as a spike. The app never tells
     you to train harder — it only warns when load has jumped. */
  loadRatioHigh: 1.5,
  loadRatioLow: 0.8,
  /* Below this many days of history the load model stays silent rather than
     reporting a meaningless number. */
  loadMinDays: 14,

  /* Session load = duration (min) × RPE. Simple, robust, needs no HR strap. */
  sessionLoadFromRpe: true,
};

/* --------------------------------------------------------------------------
 * GPS
 *
 * These are the values that decide whether a recorded route is clean or noisy.
 * ------------------------------------------------------------------------ */
export const GPS = {
  /* Discard any fix less accurate than this, in metres. Raise it if you lose
     too many points in a city; lower it for cleaner rural traces. */
  accuracyLimitM: 30,
  /* Points closer together than this are dropped — stops a stationary phone
     from accumulating fake distance. */
  minMoveM: 3,
  /* Implied speed above this (m/s) means a bad fix, not a fast athlete.
     12 m/s ≈ 43 km/h, comfortably above sprinting and below most cycling. */
  maxSpeedMps: 12,
  /* Smoothing weight, 0–1. Higher trusts each new reading more (jumpier but
     more responsive); lower produces a smoother, laggier trace. */
  smoothing: 0.35,
  /* Ignore elevation changes smaller than this, in metres — barometric noise
     otherwise inflates total climb dramatically. */
  elevationThresholdM: 2,
  /* How often to write a track point to the database, in milliseconds. */
  sampleIntervalMs: 1000,
  /* Automatic split marker, in metres. */
  splitDistanceM: 1000,
  /* Pause detection: below this speed for this long counts as stopped. */
  autoPauseBelowMps: 0.5,
  autoPauseAfterS: 12,
  /* Ask for a screen wake lock while tracking. Essential on Chromium and
     helps nothing on iOS — see the capability matrix. */
  requestWakeLock: true,
};

/* --------------------------------------------------------------------------
 * ANALYTICS
 * ------------------------------------------------------------------------ */
export const ANALYTICS = {
  /* Default smoothing window for trend lines, in days. Bodyweight is noisy
     enough that a 7-day average is the honest view of it. */
  trendWindowDays: 7,
  /* Selectable ranges on chart screens. */
  ranges: [7, 30, 90, 365],
  defaultRange: 30,

  /* How many samples before the app trusts a trend. Below `fair` it says so
     instead of drawing a confident line. */
  sufficiency: { good: 14, fair: 7 },

  /* Adaptive expenditure needs at least this many days of paired weight and
     calorie data. Below it, the function returns null and the UI explains why
     rather than inventing a figure. */
  adaptiveTdeeMinDays: 14,

  /* Correlation reporting. Below `minPairs` nothing is reported; below
     `weakThreshold` it is called weak rather than meaningful. */
  correlationMinPairs: 12,
  correlationWeak: 0.3,

  /* A streak survives this many missed days. 0 means one miss breaks it.
     Deliberately not configurable per-user: streaks are motivational garnish,
     and the app does not optimise for them. */
  streakGraceDays: 0,
};

/* --------------------------------------------------------------------------
 * READINESS
 *
 * Weights must be relative, not absolute — they are normalised over whichever
 * inputs actually exist on a given day.
 * ------------------------------------------------------------------------ */
export const READINESS = {
  weights: { sleep: 0.30, restingHr: 0.20, hrv: 0.20, load: 0.15, soreness: 0.10, mood: 0.05 },
  /* Fewer inputs than this and the app refuses to produce a score. A number
     built from one data point is noise wearing a badge. */
  minInputs: 3,
  /* Days of history needed before a personal baseline replaces the population
     default. */
  baselineDays: 14,
  bands: [
    { min: 80, label: 'Primed',     colour: 'performance' },
    { min: 60, label: 'Ready',      colour: 'performance' },
    { min: 40, label: 'Moderate',   colour: 'nutrition' },
    { min: 20, label: 'Low',        colour: 'alert' },
    { min: 0,  label: 'Very low',   colour: 'alert' },
  ],
  /* Target sleep in minutes, used as the reference point for the sleep input. */
  sleepTargetMinutes: 450,
};

/* --------------------------------------------------------------------------
 * NUTRITION
 * ------------------------------------------------------------------------ */
export const NUTRITION = {
  /* Meal slots shown in the diary, in order. Add or rename freely — the times
     are only used to pick a sensible default slot when you log something. */
  meals: [
    { key: 'breakfast', label: 'Breakfast', from: 4,  to: 11 },
    { key: 'lunch',     label: 'Lunch',     from: 11, to: 16 },
    { key: 'dinner',    label: 'Dinner',    from: 16, to: 22 },
    { key: 'snack',     label: 'Snacks',    from: 22, to: 4  },
  ],
  /* Calories per gram. Physical constants — do not change. */
  kcalPerGram: { protein: 4, carbs: 4, fat: 9, alcohol: 7, fibre: 2 },
  /* Default serving when a food has no serving information. */
  defaultServingG: 100,
  /* Search behaviour. */
  searchLimit: 40,
  searchMinChars: 2,
  /* Cache Open Food Facts responses for this long, in days. Their data does not
     change often and this keeps the app usable offline. */
  offCacheDays: 30,
  /* Reject an imported food whose macros imply energy this far from its stated
     calories (as a ratio) — usually a units error in the source data. */
  macroSanityTolerance: 0.25,
};

/* --------------------------------------------------------------------------
 * PHOTOS
 *
 * Storage adds up: at these settings, three photos a week for two years is
 * roughly 100–125 MB. The storage dashboard in Settings shows the real figure.
 * ------------------------------------------------------------------------ */
export const PHOTOS = {
  maxEdgePx: 1440,       // longest side after resizing
  quality: 0.82,         // 0–1
  format: 'image/webp',  // falls back to JPEG where WebP encoding is missing
  /* Poses offered when capturing, so a comparison is like-for-like. */
  poses: ['front', 'side', 'back'],
  /* Opacity of the previous photo overlaid in the viewfinder as an alignment
     guide. */
  ghostOpacity: 0.35,
  /* Milliseconds per frame in timelapse playback. */
  timelapseFrameMs: 400,
  /* Warn once total photo storage passes this many megabytes. */
  warnAtMb: 200,
};

/* --------------------------------------------------------------------------
 * SECURITY
 * ------------------------------------------------------------------------ */
export const SECURITY = {
  /* PBKDF2 iterations for passphrase-encrypted backups. Higher is stronger and
     slower; 310k is the current OWASP guidance for SHA-256. */
  kdfIterations: 310000,
  kdfHash: 'SHA-256',
  saltBytes: 16,
  ivBytes: 12,
  cipher: 'AES-GCM',
  keyBits: 256,
  /* Reject a passphrase shorter than this. */
  minPassphrase: 10,
  /* Offer a passkey as a convenience unlock where available. This gates access;
     it does not itself encrypt anything — see the capability matrix. */
  offerPasskey: true,
};

/* --------------------------------------------------------------------------
 * BACKUP
 * ------------------------------------------------------------------------ */
export const BACKUP = {
  /* Nag when the last export is older than this, in days. The only copy of
     your data lives in a browser database that a phone can evict. */
  nudgeAfterDays: 14,
  /* Escalate the nudge to a warning after this long. */
  warnAfterDays: 45,
  /* Keep this many backup records in the history list. */
  historyLimit: 20,
  filenamePrefix: 'nomeh-backup',
};

/* --------------------------------------------------------------------------
 * PARSER — the quick-log bar.
 *
 * Add your own vocabulary here rather than editing the parser. Every list is
 * matched case-insensitively, longest word first.
 * ------------------------------------------------------------------------ */
export const PARSER = {
  separators: /[;\n]+|\s+and\s+/i,
  /* Words that map to a log type. */
  vocabulary: {
    water:    ['water', 'drank', 'drink', 'hydration', 'h2o'],
    weight:   ['weight', 'weighed', 'weigh', 'bodyweight', 'bw'],
    sleep:    ['slept', 'sleep'],
    run:      ['run', 'ran', 'jog', 'jogged'],
    walk:     ['walk', 'walked', 'hike', 'hiked', 'steps'],
    cycle:    ['cycle', 'cycled', 'bike', 'biked', 'ride', 'rode'],
    swim:     ['swim', 'swam'],
    row:      ['row', 'rowed', 'rowing'],
    heartrate:['hr', 'heart rate', 'heartrate', 'pulse', 'rhr', 'resting hr'],
    mood:     ['mood', 'feeling', 'felt'],
    energy:   ['energy'],
    stress:   ['stress', 'stressed'],
    soreness: ['soreness', 'sore', 'doms'],
  },
  measurementSites: ['waist', 'chest', 'hips', 'hip', 'neck', 'arm', 'arms', 'bicep',
    'biceps', 'thigh', 'thighs', 'calf', 'calves', 'shoulders', 'forearm', 'glutes'],
  /* Below this confidence the candidate is shown but not pre-selected. */
  autoAcceptConfidence: 0.7,
  /* Nothing the parser produces is ever written without confirmation. This is
     not configurable, and deliberately so. */
};

/* --------------------------------------------------------------------------
 * EXTERNAL APIS
 *
 * Every endpoint here is keyless by design, because the app is static and a key
 * in client-side code is a published key.
 * ------------------------------------------------------------------------ */
export const ENDPOINTS = {
  openFoodFacts: {
    search:  'https://world.openfoodfacts.org/cgi/search.pl',
    barcode: 'https://world.openfoodfacts.org/api/v2/product/',
    /* Open Food Facts asks clients to identify themselves via User-Agent, which
       browsers will not let us set. We stay well inside their rate limits and
       cache aggressively instead. */
    timeoutMs: 8000,
  },
  weather: {
    /* Open-Meteo needs no key and sends permissive CORS headers. */
    forecast: 'https://api.open-meteo.com/v1/forecast',
    timeoutMs: 6000,
  },
  /* Dexie. See src/db/dexie.js for how to vendor it and go fully offline. */
  dexie: 'https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/modern/dexie.mjs',
};

/* --------------------------------------------------------------------------
 * UNITS
 * ------------------------------------------------------------------------ */
export const UNITS = {
  defaults: { mass: 'kg', length: 'cm', distance: 'km', volume: 'ml', energy: 'kcal', temperature: 'c' },
  /* First day of the week: 0 Sunday, 1 Monday. */
  weekStart: 1,
  /* 12- or 24-hour clock. 'auto' follows the device locale. */
  clock: 'auto',
};

/* --------------------------------------------------------------------------
 * UI
 * ------------------------------------------------------------------------ */
export const UI = {
  /* Navigation. Reorder or trim freely; entries whose feature flag is off are
     removed automatically. `primary` is the centre action button. */
  nav: [
    { route: 'today',    label: 'Today',    icon: 'pulse' },
    { route: 'diary',    label: 'Diary',    icon: 'plate',  feature: 'nutrition' },
    { route: 'log',      label: 'Log',      icon: 'plus',   primary: true },
    { route: 'train',    label: 'Train',    icon: 'dumbbell' },
    { route: 'body',     label: 'Body',     icon: 'body' },
  ],
  /* Extra destinations reachable from Today and Settings but not the dock. */
  secondaryNav: ['timeline', 'analytics', 'recovery', 'photos', 'settings'],

  toastMs: 3200,
  undoMs: 7000,          // how long an undo offer stays available
  /* Rows before a list paginates. */
  pageSize: 50,
  /* Typed phrase required to confirm an irreversible action. */
  destructivePhrases: { deleteAll: 'DELETE', eraseEverything: 'ERASE' },
  /* Haptic feedback on Android where supported. */
  haptics: true,
  /* Show the estimate disclaimer next to derived physiological figures. */
  showEstimateLabels: true,
};

/* --------------------------------------------------------------------------
 * SAFETY
 *
 * These are guardrails from the product brief, expressed as switches so they
 * are auditable rather than buried in prose. Turning any of them off is a
 * product decision with consequences; they ship on.
 * ------------------------------------------------------------------------ */
export const SAFETY = {
  enforceCalorieFloor: true,
  /* Never phrase a body measurement as good or bad. */
  noAppearanceJudgement: true,
  /* Never present a derived score as a medical finding. */
  noMedicalClaims: true,
  /* Never suggest training harder in response to a fatigue signal. */
  noOvertrainingEncouragement: true,
  /* Warn when logged intake is far below target for several days running. */
  underEatingWarnDays: 3,
  underEatingWarnRatio: 0.7,
  /* Warn on rapid weight loss, as a percentage of bodyweight per week. */
  rapidLossPctPerWeek: 1.5,
};

/* Convenience: a single frozen object, for anywhere that wants to hand the
   whole configuration to something else (the backup file records it, so an old
   export can be read back with the settings that produced it). */
export const CONFIG = Object.freeze({
  APP, FEATURES, PHYSIOLOGY, TRAINING, GPS, ANALYTICS, READINESS,
  NUTRITION, PHOTOS, SECURITY, BACKUP, PARSER, ENDPOINTS, UNITS, UI, SAFETY,
});

/* Is a feature on? Used by the router and the nav builder. Unknown keys return
   true so that adding a screen without a flag does not silently hide it. */
export function enabled(feature) {
  if (!feature) return true;
  return FEATURES[feature] !== false;
}
