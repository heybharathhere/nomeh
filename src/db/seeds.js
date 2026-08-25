/* Seed data, installed once on first run.
 *
 * WHY THESE SPECIFIC ITEMS
 *   An empty exercise library means the training screen is useless until you
 *   have typed forty exercise names, and an empty food database means the diary
 *   only works with a network connection. So the app ships with enough to be
 *   immediately usable offline, and no more.
 *
 * THE FOOD LIST IS DELIBERATELY SHORT AND GENERIC
 *   Every entry is a whole food with widely-agreed values, weighted toward South
 *   Asian staples since that is where this was written. It is a starting point,
 *   not a database — the real database is whatever you add, plus Open Food Facts
 *   for packaged goods. Nothing here is branded, because branded values change
 *   and stale numbers are worse than no numbers.
 *
 * All values are per 100 g raw unless the name says otherwise. Cooked and raw
 * differ enormously for grains and pulses, hence the explicit labels.
 *
 * TO CUSTOMISE: edit the arrays below. Seeding only runs when a table is empty,
 * so changes here affect new installs. Settings → Data has a re-seed action for
 * an existing install.
 */

/* --------------------------------------------------------------------------
 * EXERCISES
 *
 *   category: push | pull | squat | hinge | carry | core | cardio | mobility
 *   pattern:  the movement, used to group and to spot imbalance
 *   equipment: matched against what you say you have
 *   unilateral: true if it loads one side at a time (halves the load target)
 * ------------------------------------------------------------------------ */
export const EXERCISES = [
  // ---- horizontal push
  { name: 'Push-up', category: 'push', pattern: 'horizontal push', primaryMuscles: ['chest', 'triceps', 'shoulders'], equipment: ['bodyweight'], tags: ['calisthenics', 'beginner'] },
  { name: 'Bench Press', category: 'push', pattern: 'horizontal push', primaryMuscles: ['chest', 'triceps', 'shoulders'], equipment: ['barbell', 'bench'], tags: ['compound', 'strength'] },
  { name: 'Dumbbell Bench Press', category: 'push', pattern: 'horizontal push', primaryMuscles: ['chest', 'triceps'], equipment: ['dumbbell', 'bench'], tags: ['compound'] },
  { name: 'Incline Bench Press', category: 'push', pattern: 'horizontal push', primaryMuscles: ['chest', 'shoulders'], equipment: ['barbell', 'bench'], tags: ['compound'] },
  { name: 'Dip', category: 'push', pattern: 'vertical push', primaryMuscles: ['chest', 'triceps'], equipment: ['bars'], tags: ['calisthenics', 'compound'] },
  { name: 'Archer Push-up', category: 'push', pattern: 'horizontal push', primaryMuscles: ['chest', 'triceps'], equipment: ['bodyweight'], tags: ['calisthenics', 'advanced'], unilateral: true },
  { name: 'Pseudo Planche Push-up', category: 'push', pattern: 'horizontal push', primaryMuscles: ['chest', 'shoulders'], equipment: ['bodyweight'], tags: ['calisthenics', 'advanced'] },

  // ---- vertical push
  { name: 'Overhead Press', category: 'push', pattern: 'vertical push', primaryMuscles: ['shoulders', 'triceps'], equipment: ['barbell'], tags: ['compound', 'strength'] },
  { name: 'Dumbbell Shoulder Press', category: 'push', pattern: 'vertical push', primaryMuscles: ['shoulders', 'triceps'], equipment: ['dumbbell'] },
  { name: 'Pike Push-up', category: 'push', pattern: 'vertical push', primaryMuscles: ['shoulders', 'triceps'], equipment: ['bodyweight'], tags: ['calisthenics'] },
  { name: 'Handstand Push-up', category: 'push', pattern: 'vertical push', primaryMuscles: ['shoulders', 'triceps'], equipment: ['bodyweight'], tags: ['calisthenics', 'advanced'] },
  { name: 'Lateral Raise', category: 'push', pattern: 'isolation', primaryMuscles: ['shoulders'], equipment: ['dumbbell'], tags: ['isolation'] },
  { name: 'Triceps Extension', category: 'push', pattern: 'isolation', primaryMuscles: ['triceps'], equipment: ['dumbbell', 'cable'], tags: ['isolation'] },

  // ---- vertical pull
  { name: 'Pull-up', category: 'pull', pattern: 'vertical pull', primaryMuscles: ['lats', 'biceps', 'upper back'], equipment: ['bar'], tags: ['calisthenics', 'compound'] },
  { name: 'Chin-up', category: 'pull', pattern: 'vertical pull', primaryMuscles: ['lats', 'biceps'], equipment: ['bar'], tags: ['calisthenics', 'compound'] },
  { name: 'Lat Pulldown', category: 'pull', pattern: 'vertical pull', primaryMuscles: ['lats', 'biceps'], equipment: ['cable'] },
  { name: 'Assisted Pull-up', category: 'pull', pattern: 'vertical pull', primaryMuscles: ['lats', 'biceps'], equipment: ['bar', 'band'], tags: ['beginner'] },
  { name: 'Muscle-up', category: 'pull', pattern: 'vertical pull', primaryMuscles: ['lats', 'chest', 'triceps'], equipment: ['bar'], tags: ['calisthenics', 'advanced'] },

  // ---- horizontal pull
  { name: 'Barbell Row', category: 'pull', pattern: 'horizontal pull', primaryMuscles: ['upper back', 'lats', 'biceps'], equipment: ['barbell'], tags: ['compound'] },
  { name: 'Dumbbell Row', category: 'pull', pattern: 'horizontal pull', primaryMuscles: ['upper back', 'lats'], equipment: ['dumbbell'], unilateral: true },
  { name: 'Inverted Row', category: 'pull', pattern: 'horizontal pull', primaryMuscles: ['upper back', 'biceps'], equipment: ['bar'], tags: ['calisthenics', 'beginner'] },
  { name: 'Face Pull', category: 'pull', pattern: 'isolation', primaryMuscles: ['rear delts', 'upper back'], equipment: ['cable', 'band'], tags: ['isolation', 'prehab'] },
  { name: 'Biceps Curl', category: 'pull', pattern: 'isolation', primaryMuscles: ['biceps'], equipment: ['dumbbell', 'barbell'], tags: ['isolation'] },

  // ---- squat
  { name: 'Back Squat', category: 'squat', pattern: 'squat', primaryMuscles: ['quads', 'glutes'], equipment: ['barbell', 'rack'], tags: ['compound', 'strength'] },
  { name: 'Front Squat', category: 'squat', pattern: 'squat', primaryMuscles: ['quads', 'core'], equipment: ['barbell', 'rack'], tags: ['compound'] },
  { name: 'Goblet Squat', category: 'squat', pattern: 'squat', primaryMuscles: ['quads', 'glutes'], equipment: ['dumbbell', 'kettlebell'], tags: ['beginner'] },
  { name: 'Bodyweight Squat', category: 'squat', pattern: 'squat', primaryMuscles: ['quads', 'glutes'], equipment: ['bodyweight'], tags: ['calisthenics', 'beginner'] },
  { name: 'Bulgarian Split Squat', category: 'squat', pattern: 'lunge', primaryMuscles: ['quads', 'glutes'], equipment: ['dumbbell', 'bench'], unilateral: true },
  { name: 'Lunge', category: 'squat', pattern: 'lunge', primaryMuscles: ['quads', 'glutes'], equipment: ['bodyweight', 'dumbbell'], unilateral: true },
  { name: 'Pistol Squat', category: 'squat', pattern: 'squat', primaryMuscles: ['quads', 'glutes'], equipment: ['bodyweight'], tags: ['calisthenics', 'advanced'], unilateral: true },
  { name: 'Leg Press', category: 'squat', pattern: 'squat', primaryMuscles: ['quads', 'glutes'], equipment: ['machine'] },
  { name: 'Calf Raise', category: 'squat', pattern: 'isolation', primaryMuscles: ['calves'], equipment: ['bodyweight', 'dumbbell'], tags: ['isolation'] },

  // ---- hinge
  { name: 'Deadlift', category: 'hinge', pattern: 'hinge', primaryMuscles: ['hamstrings', 'glutes', 'back'], equipment: ['barbell'], tags: ['compound', 'strength'] },
  { name: 'Romanian Deadlift', category: 'hinge', pattern: 'hinge', primaryMuscles: ['hamstrings', 'glutes'], equipment: ['barbell', 'dumbbell'], tags: ['compound'] },
  { name: 'Hip Thrust', category: 'hinge', pattern: 'hinge', primaryMuscles: ['glutes'], equipment: ['barbell', 'bench'] },
  { name: 'Kettlebell Swing', category: 'hinge', pattern: 'hinge', primaryMuscles: ['hamstrings', 'glutes'], equipment: ['kettlebell'], tags: ['power'] },
  { name: 'Nordic Curl', category: 'hinge', pattern: 'hinge', primaryMuscles: ['hamstrings'], equipment: ['bodyweight'], tags: ['calisthenics', 'advanced'] },
  { name: 'Glute Bridge', category: 'hinge', pattern: 'hinge', primaryMuscles: ['glutes'], equipment: ['bodyweight'], tags: ['beginner'] },

  // ---- core
  { name: 'Plank', category: 'core', pattern: 'anti-extension', primaryMuscles: ['core'], equipment: ['bodyweight'], tags: ['isometric', 'beginner'], metric: 'time' },
  { name: 'Side Plank', category: 'core', pattern: 'anti-lateral-flexion', primaryMuscles: ['core', 'obliques'], equipment: ['bodyweight'], tags: ['isometric'], metric: 'time', unilateral: true },
  { name: 'Hanging Leg Raise', category: 'core', pattern: 'flexion', primaryMuscles: ['core'], equipment: ['bar'], tags: ['calisthenics'] },
  { name: 'Hollow Body Hold', category: 'core', pattern: 'anti-extension', primaryMuscles: ['core'], equipment: ['bodyweight'], tags: ['isometric', 'calisthenics'], metric: 'time' },
  { name: 'L-Sit', category: 'core', pattern: 'flexion', primaryMuscles: ['core'], equipment: ['bars'], tags: ['calisthenics', 'isometric', 'advanced'], metric: 'time' },
  { name: 'Dead Bug', category: 'core', pattern: 'anti-extension', primaryMuscles: ['core'], equipment: ['bodyweight'], tags: ['beginner'] },
  { name: 'Ab Wheel Rollout', category: 'core', pattern: 'anti-extension', primaryMuscles: ['core'], equipment: ['wheel'] },

  // ---- carry & conditioning
  { name: "Farmer's Carry", category: 'carry', pattern: 'carry', primaryMuscles: ['core', 'traps', 'forearms'], equipment: ['dumbbell', 'kettlebell'], metric: 'distance' },
  { name: 'Burpee', category: 'cardio', pattern: 'full body', primaryMuscles: ['full body'], equipment: ['bodyweight'], tags: ['conditioning'] },
  { name: 'Mountain Climber', category: 'cardio', pattern: 'full body', primaryMuscles: ['core'], equipment: ['bodyweight'], tags: ['conditioning'], metric: 'time' },
  { name: 'Jump Rope', category: 'cardio', pattern: 'full body', primaryMuscles: ['calves'], equipment: ['rope'], tags: ['conditioning'], metric: 'time' },
  { name: 'Box Jump', category: 'cardio', pattern: 'jump', primaryMuscles: ['quads', 'glutes'], equipment: ['box'], tags: ['power'] },

  // ---- endurance (referenced by running and cycling programmes; distance- or
  // time-based rather than rep-based, so they log through the activity screen)
  { name: 'Run', category: 'cardio', pattern: 'run', primaryMuscles: ['legs', 'cardiovascular'], equipment: ['none'], tags: ['endurance'], metric: 'distance' },
  { name: 'Walk', category: 'cardio', pattern: 'walk', primaryMuscles: ['legs'], equipment: ['none'], tags: ['endurance', 'beginner'], metric: 'distance' },
  { name: 'Cycle', category: 'cardio', pattern: 'cycle', primaryMuscles: ['quads', 'cardiovascular'], equipment: ['bike'], tags: ['endurance'], metric: 'distance' },
  { name: 'Swim', category: 'cardio', pattern: 'swim', primaryMuscles: ['full body'], equipment: ['pool'], tags: ['endurance'], metric: 'distance' },
  { name: 'Row (machine)', category: 'cardio', pattern: 'row', primaryMuscles: ['full body'], equipment: ['machine'], tags: ['endurance'], metric: 'distance' },
  { name: 'Stair Climb', category: 'cardio', pattern: 'climb', primaryMuscles: ['legs'], equipment: ['none'], tags: ['endurance'], metric: 'time' },

  // ---- mobility
  { name: 'Hip Flexor Stretch', category: 'mobility', pattern: 'stretch', primaryMuscles: ['hip flexors'], equipment: ['bodyweight'], metric: 'time' },
  { name: 'Thoracic Rotation', category: 'mobility', pattern: 'stretch', primaryMuscles: ['thoracic spine'], equipment: ['bodyweight'], metric: 'time' },
  { name: 'Shoulder Dislocate', category: 'mobility', pattern: 'stretch', primaryMuscles: ['shoulders'], equipment: ['band', 'stick'] },
  { name: 'Deep Squat Hold', category: 'mobility', pattern: 'stretch', primaryMuscles: ['hips', 'ankles'], equipment: ['bodyweight'], metric: 'time' },
];

/* --------------------------------------------------------------------------
 * FOODS — per 100 g unless the name says otherwise.
 * ------------------------------------------------------------------------ */
export const FOODS = [
  // grains & staples
  { name: 'Rice, white, cooked', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, fibre: 0.4, servings: [{ label: '1 cup', grams: 158 }] },
  { name: 'Rice, brown, cooked', kcal: 123, protein: 2.7, carbs: 26, fat: 1.0, fibre: 1.6, servings: [{ label: '1 cup', grams: 195 }] },
  { name: 'Idli', kcal: 140, protein: 4.0, carbs: 28, fat: 0.5, fibre: 1.0, servings: [{ label: '1 idli', grams: 50 }] },
  { name: 'Dosa, plain', kcal: 168, protein: 3.9, carbs: 30, fat: 3.7, fibre: 1.2, servings: [{ label: '1 dosa', grams: 85 }] },
  { name: 'Chapati / Roti', kcal: 297, protein: 11, carbs: 46, fat: 7.5, fibre: 4.9, servings: [{ label: '1 roti', grams: 40 }] },
  { name: 'Oats, rolled, dry', kcal: 389, protein: 16.9, carbs: 66, fat: 6.9, fibre: 10.6, servings: [{ label: '1/2 cup', grams: 40 }] },
  { name: 'Bread, whole wheat', kcal: 247, protein: 13, carbs: 41, fat: 3.4, fibre: 7.0, servings: [{ label: '1 slice', grams: 28 }] },
  { name: 'Poha (flattened rice), dry', kcal: 346, protein: 6.6, carbs: 77, fat: 1.2, fibre: 1.5 },
  { name: 'Upma, cooked', kcal: 155, protein: 4.0, carbs: 25, fat: 4.5, fibre: 1.8 },

  // pulses & legumes
  { name: 'Toor dal, cooked', kcal: 121, protein: 7.0, carbs: 20, fat: 0.4, fibre: 4.5, servings: [{ label: '1 cup', grams: 200 }] },
  { name: 'Moong dal, cooked', kcal: 105, protein: 7.0, carbs: 19, fat: 0.4, fibre: 7.6 },
  { name: 'Chana / Chickpeas, cooked', kcal: 164, protein: 8.9, carbs: 27, fat: 2.6, fibre: 7.6, servings: [{ label: '1 cup', grams: 164 }] },
  { name: 'Rajma / Kidney beans, cooked', kcal: 127, protein: 8.7, carbs: 23, fat: 0.5, fibre: 6.4 },
  { name: 'Lentils, cooked', kcal: 116, protein: 9.0, carbs: 20, fat: 0.4, fibre: 7.9 },
  { name: 'Peanuts, raw', kcal: 567, protein: 26, carbs: 16, fat: 49, fibre: 8.5, servings: [{ label: 'handful', grams: 28 }] },

  // dairy & eggs
  { name: 'Milk, whole', kcal: 61, protein: 3.2, carbs: 4.8, fat: 3.3, unit: 'ml', servings: [{ label: '1 glass', grams: 240 }] },
  { name: 'Milk, toned', kcal: 47, protein: 3.1, carbs: 4.7, fat: 1.8, unit: 'ml', servings: [{ label: '1 glass', grams: 240 }] },
  { name: 'Curd / Yoghurt, plain', kcal: 61, protein: 3.5, carbs: 4.7, fat: 3.3, servings: [{ label: '1 cup', grams: 245 }] },
  { name: 'Greek yoghurt, plain', kcal: 59, protein: 10, carbs: 3.6, fat: 0.4, servings: [{ label: '1 cup', grams: 170 }] },
  { name: 'Paneer', kcal: 265, protein: 18, carbs: 1.2, fat: 21, servings: [{ label: '1 cube', grams: 25 }] },
  { name: 'Egg, whole', kcal: 155, protein: 13, carbs: 1.1, fat: 11, servings: [{ label: '1 egg', grams: 50 }] },
  { name: 'Egg white', kcal: 52, protein: 11, carbs: 0.7, fat: 0.2, servings: [{ label: '1 white', grams: 33 }] },
  { name: 'Ghee', kcal: 900, protein: 0, carbs: 0, fat: 100, servings: [{ label: '1 tsp', grams: 5 }] },

  // meat & fish
  { name: 'Chicken breast, cooked', kcal: 165, protein: 31, carbs: 0, fat: 3.6, servings: [{ label: '1 breast', grams: 172 }] },
  { name: 'Chicken thigh, cooked', kcal: 209, protein: 26, carbs: 0, fat: 11 },
  { name: 'Fish, tilapia, cooked', kcal: 129, protein: 26, carbs: 0, fat: 2.7 },
  { name: 'Salmon, cooked', kcal: 208, protein: 20, carbs: 0, fat: 13 },
  { name: 'Prawns, cooked', kcal: 99, protein: 24, carbs: 0.2, fat: 0.3 },
  { name: 'Mutton, cooked', kcal: 294, protein: 25, carbs: 0, fat: 21 },

  // vegetables
  { name: 'Spinach, raw', kcal: 23, protein: 2.9, carbs: 3.6, fat: 0.4, fibre: 2.2 },
  { name: 'Tomato', kcal: 18, protein: 0.9, carbs: 3.9, fat: 0.2, fibre: 1.2 },
  { name: 'Onion', kcal: 40, protein: 1.1, carbs: 9.3, fat: 0.1, fibre: 1.7 },
  { name: 'Potato, boiled', kcal: 87, protein: 1.9, carbs: 20, fat: 0.1, fibre: 1.8 },
  { name: 'Cauliflower', kcal: 25, protein: 1.9, carbs: 5.0, fat: 0.3, fibre: 2.0 },
  { name: 'Okra / Bhindi', kcal: 33, protein: 1.9, carbs: 7.5, fat: 0.2, fibre: 3.2 },
  { name: 'Carrot', kcal: 41, protein: 0.9, carbs: 9.6, fat: 0.2, fibre: 2.8 },
  { name: 'Broccoli', kcal: 34, protein: 2.8, carbs: 6.6, fat: 0.4, fibre: 2.6 },
  { name: 'Cucumber', kcal: 15, protein: 0.7, carbs: 3.6, fat: 0.1, fibre: 0.5 },

  // fruit
  { name: 'Banana', kcal: 89, protein: 1.1, carbs: 23, fat: 0.3, fibre: 2.6, servings: [{ label: '1 medium', grams: 118 }] },
  { name: 'Apple', kcal: 52, protein: 0.3, carbs: 14, fat: 0.2, fibre: 2.4, servings: [{ label: '1 medium', grams: 182 }] },
  { name: 'Mango', kcal: 60, protein: 0.8, carbs: 15, fat: 0.4, fibre: 1.6 },
  { name: 'Orange', kcal: 47, protein: 0.9, carbs: 12, fat: 0.1, fibre: 2.4, servings: [{ label: '1 medium', grams: 131 }] },
  { name: 'Papaya', kcal: 43, protein: 0.5, carbs: 11, fat: 0.3, fibre: 1.7 },
  { name: 'Dates', kcal: 277, protein: 1.8, carbs: 75, fat: 0.2, fibre: 6.7, servings: [{ label: '1 date', grams: 8 }] },

  // fats, nuts & other
  { name: 'Almonds', kcal: 579, protein: 21, carbs: 22, fat: 50, fibre: 12.5, servings: [{ label: '10 almonds', grams: 12 }] },
  { name: 'Walnuts', kcal: 654, protein: 15, carbs: 14, fat: 65, fibre: 6.7 },
  { name: 'Coconut oil', kcal: 892, protein: 0, carbs: 0, fat: 99, servings: [{ label: '1 tsp', grams: 5 }] },
  { name: 'Olive oil', kcal: 884, protein: 0, carbs: 0, fat: 100, servings: [{ label: '1 tbsp', grams: 14 }] },
  { name: 'Whey protein, powder', kcal: 400, protein: 80, carbs: 8, fat: 5, servings: [{ label: '1 scoop', grams: 30 }] },
  { name: 'Sugar', kcal: 387, protein: 0, carbs: 100, fat: 0, servings: [{ label: '1 tsp', grams: 4 }] },
  { name: 'Honey', kcal: 304, protein: 0.3, carbs: 82, fat: 0, servings: [{ label: '1 tbsp', grams: 21 }] },
  { name: 'Coffee, black', kcal: 2, protein: 0.1, carbs: 0, fat: 0, unit: 'ml', servings: [{ label: '1 cup', grams: 240 }] },
  { name: 'Tea with milk & sugar', kcal: 43, protein: 1.2, carbs: 6.5, fat: 1.3, unit: 'ml', servings: [{ label: '1 cup', grams: 150 }] },
];

/* --------------------------------------------------------------------------
 * PROGRAMS — templates, not prescriptions.
 *
 * Each is a well-known structure with a source, so you can go and read about it
 * rather than trusting an app's summary. Weeks are generated from the pattern.
 * ------------------------------------------------------------------------ */
export const PROGRAMS = [
  {
    name: 'Full Body 3× / week',
    goal: 'general',
    daysPerWeek: 3,
    note: 'A standard beginner structure: three full-body sessions with a rest day between. ' +
          'Add a little load when all sets are completed comfortably.',
    days: [
      { day: 1, label: 'A', items: [
        { exercise: 'Back Squat', sets: 3, reps: 8 },
        { exercise: 'Bench Press', sets: 3, reps: 8 },
        { exercise: 'Barbell Row', sets: 3, reps: 8 },
        { exercise: 'Plank', sets: 3, reps: 45, metric: 'time' },
      ] },
      { day: 3, label: 'B', items: [
        { exercise: 'Deadlift', sets: 3, reps: 5 },
        { exercise: 'Overhead Press', sets: 3, reps: 8 },
        { exercise: 'Pull-up', sets: 3, reps: 6 },
        { exercise: 'Hanging Leg Raise', sets: 3, reps: 10 },
      ] },
      { day: 5, label: 'A', items: [
        { exercise: 'Front Squat', sets: 3, reps: 8 },
        { exercise: 'Dumbbell Bench Press', sets: 3, reps: 10 },
        { exercise: 'Dumbbell Row', sets: 3, reps: 10 },
        { exercise: 'Side Plank', sets: 2, reps: 30, metric: 'time' },
      ] },
    ],
  },
  {
    name: 'Push / Pull / Legs',
    goal: 'hypertrophy',
    daysPerWeek: 6,
    note: 'Higher frequency and volume. Sustainable only once recovery is reliable — ' +
          'if sleep is short or load is spiking, three days a week beats six done badly.',
    days: [
      { day: 1, label: 'Push', items: [
        { exercise: 'Bench Press', sets: 4, reps: 8 },
        { exercise: 'Overhead Press', sets: 3, reps: 10 },
        { exercise: 'Incline Bench Press', sets: 3, reps: 10 },
        { exercise: 'Lateral Raise', sets: 3, reps: 15 },
        { exercise: 'Triceps Extension', sets: 3, reps: 12 },
      ] },
      { day: 2, label: 'Pull', items: [
        { exercise: 'Pull-up', sets: 4, reps: 8 },
        { exercise: 'Barbell Row', sets: 4, reps: 8 },
        { exercise: 'Lat Pulldown', sets: 3, reps: 12 },
        { exercise: 'Face Pull', sets: 3, reps: 15 },
        { exercise: 'Biceps Curl', sets: 3, reps: 12 },
      ] },
      { day: 3, label: 'Legs', items: [
        { exercise: 'Back Squat', sets: 4, reps: 8 },
        { exercise: 'Romanian Deadlift', sets: 3, reps: 10 },
        { exercise: 'Bulgarian Split Squat', sets: 3, reps: 10 },
        { exercise: 'Calf Raise', sets: 4, reps: 15 },
        { exercise: 'Hanging Leg Raise', sets: 3, reps: 12 },
      ] },
    ],
  },
  {
    name: 'Calisthenics Progression',
    goal: 'calisthenics',
    daysPerWeek: 3,
    note: 'No equipment beyond a bar. Progress by moving to a harder variation rather ' +
          'than adding load — the app tracks which variation you are on.',
    days: [
      { day: 1, label: 'Push focus', items: [
        { exercise: 'Push-up', sets: 4, reps: 12 },
        { exercise: 'Dip', sets: 3, reps: 8 },
        { exercise: 'Pike Push-up', sets: 3, reps: 8 },
        { exercise: 'Hollow Body Hold', sets: 3, reps: 30, metric: 'time' },
      ] },
      { day: 3, label: 'Pull focus', items: [
        { exercise: 'Pull-up', sets: 4, reps: 6 },
        { exercise: 'Inverted Row', sets: 3, reps: 12 },
        { exercise: 'Chin-up', sets: 3, reps: 6 },
        { exercise: 'Hanging Leg Raise', sets: 3, reps: 10 },
      ] },
      { day: 5, label: 'Legs & core', items: [
        { exercise: 'Bodyweight Squat', sets: 4, reps: 20 },
        { exercise: 'Lunge', sets: 3, reps: 12 },
        { exercise: 'Nordic Curl', sets: 3, reps: 5 },
        { exercise: 'Plank', sets: 3, reps: 60, metric: 'time' },
      ] },
    ],
  },
  {
    name: 'Couch to 10K',
    goal: 'endurance',
    daysPerWeek: 3,
    note: 'Run/walk intervals building to continuous running. The walk breaks are the ' +
          'programme, not a failure to run — removing them early is the most common way this goes wrong.',
    days: [
      { day: 1, label: 'Intervals', items: [{ exercise: 'Run', sets: 6, reps: 60, metric: 'time', note: '60s run / 90s walk' }] },
      { day: 3, label: 'Intervals', items: [{ exercise: 'Run', sets: 6, reps: 90, metric: 'time', note: '90s run / 90s walk' }] },
      { day: 5, label: 'Long', items: [{ exercise: 'Run', sets: 1, reps: 1200, metric: 'time', note: 'Steady, conversational pace' }] },
    ],
  },
];

/* Installs seeds into empty tables. Never overwrites: if a table has rows, it is
   left completely alone, so this is safe to call on every boot. */
export async function installSeeds(db, { force = false } = {}) {
  const report = { exercises: 0, foods: 0, programs: 0, skipped: [] };
  const now = Date.now();

  const exerciseCount = await db.exercises.count();
  if (exerciseCount === 0 || force) {
    await db.exercises.bulkPut(EXERCISES.map((e) => ({
      ...e,
      tags: e.tags ?? [],
      metric: e.metric ?? 'reps',
      unilateral: e.unilateral ?? false,
      source: 'seed',
      createdAt: now,
    })));
    report.exercises = EXERCISES.length;
  } else report.skipped.push('exercises');

  const foodCount = await db.foods.count();
  if (foodCount === 0 || force) {
    /* normaliseFood is not imported here to keep seeds dependency-free; these
       values are already per-100 g, which is the stored basis. */
    await db.foods.bulkPut(FOODS.map((f) => ({
      unit: 'g',
      protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0, saturated: 0, sodiumMg: 0,
      ...f,
      servings: f.servings?.length ? f.servings : [{ label: f.unit === 'ml' ? '100 ml' : '100 g', grams: 100 }],
      source: 'seed',
      verified: true,
      at: now,
      createdAt: now,
    })));
    report.foods = FOODS.length;
  } else report.skipped.push('foods');

  const programCount = await db.programs.count();
  if (programCount === 0 || force) {
    for (const p of PROGRAMS) {
      const id = await db.programs.put({
        name: p.name, goal: p.goal, daysPerWeek: p.daysPerWeek, note: p.note,
        status: 'template', source: 'seed', createdAt: now,
      });
      await db.programDays.bulkPut(p.days.map((d) => ({
        programId: id, week: 1, day: d.day, label: d.label, items: d.items,
      })));
    }
    report.programs = PROGRAMS.length;
  } else report.skipped.push('programs');

  return report;
}
