const Dexie = window.Dexie;
export const db = new Dexie('NoMehFitnessDB');

db.version(2).stores({
  userProfile: 'id',
  dailyLogs: 'date, timestamp',
  nutritionLog: '++id, date, name',
  workoutLog: '++id, date, exerciseKey',
  gpsTracks: '++id, startTime',
  progressPhotos: '++id, timestamp, date, isBaseline'
});

export async function initializeDatabase() {
  if (navigator.storage && navigator.storage.persist) {
    await navigator.storage.persist().catch(() => {});
  }
  const profile = await db.userProfile.get('main').catch(() => null);
  if (!profile) {
    await db.userProfile.put({
      id: 'main',
      name: 'Athlete',
      gender: 'male',
      age: 24,
      weight: 68,
      height: 174,
      targetCalories: 2100,
      targetProtein: 140,
      targetWaterLiters: 3.2,
      onboardingCompleted: true
    }).catch(console.error);
  }
}