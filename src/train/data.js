// Training data: seed library, templates and pure calculations (no DOM).

export const MUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'];
export const EQUIPMENT = ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight'];

const L = (id, name, muscle, equipment) => ({ id: 'ex_' + id, name, muscle, equipment });

export const SEED_EXERCISES = [
  // Chest
  L('bench', 'Bench press', 'Chest', 'Barbell'),
  L('incline_bench', 'Incline bench press', 'Chest', 'Barbell'),
  L('db_bench', 'Dumbbell bench press', 'Chest', 'Dumbbell'),
  L('incline_db', 'Incline dumbbell press', 'Chest', 'Dumbbell'),
  L('db_fly', 'Dumbbell fly', 'Chest', 'Dumbbell'),
  L('chest_press', 'Chest press machine', 'Chest', 'Machine'),
  L('pec_deck', 'Pec deck', 'Chest', 'Machine'),
  L('cable_fly', 'Cable crossover', 'Chest', 'Cable'),
  L('pushup', 'Push-up', 'Chest', 'Bodyweight'),
  L('dip', 'Dip', 'Chest', 'Bodyweight'),
  // Back
  L('deadlift', 'Deadlift', 'Back', 'Barbell'),
  L('bb_row', 'Barbell row', 'Back', 'Barbell'),
  L('db_row', 'One-arm dumbbell row', 'Back', 'Dumbbell'),
  L('pulldown', 'Lat pulldown', 'Back', 'Cable'),
  L('cable_row', 'Seated cable row', 'Back', 'Cable'),
  L('machine_row', 'Machine row', 'Back', 'Machine'),
  L('pullup', 'Pull-up', 'Back', 'Bodyweight'),
  L('chinup', 'Chin-up', 'Back', 'Bodyweight'),
  // Shoulders
  L('ohp', 'Overhead press', 'Shoulders', 'Barbell'),
  L('db_ohp', 'Seated dumbbell press', 'Shoulders', 'Dumbbell'),
  L('lat_raise', 'Lateral raise', 'Shoulders', 'Dumbbell'),
  L('cable_lat_raise', 'Cable lateral raise', 'Shoulders', 'Cable'),
  L('rear_delt', 'Reverse pec deck', 'Shoulders', 'Machine'),
  L('face_pull', 'Face pull', 'Shoulders', 'Cable'),
  L('shoulder_press_m', 'Shoulder press machine', 'Shoulders', 'Machine'),
  // Arms
  L('bb_curl', 'Barbell curl', 'Biceps', 'Barbell'),
  L('db_curl', 'Dumbbell curl', 'Biceps', 'Dumbbell'),
  L('hammer_curl', 'Hammer curl', 'Biceps', 'Dumbbell'),
  L('cable_curl', 'Cable curl', 'Biceps', 'Cable'),
  L('preacher', 'Preacher curl machine', 'Biceps', 'Machine'),
  L('pushdown', 'Triceps pushdown', 'Triceps', 'Cable'),
  L('oh_ext', 'Overhead cable extension', 'Triceps', 'Cable'),
  L('skull', 'Skull crusher', 'Triceps', 'Barbell'),
  L('cgbp', 'Close-grip bench press', 'Triceps', 'Barbell'),
  L('db_kickback', 'Dumbbell kickback', 'Triceps', 'Dumbbell'),
  // Legs
  L('squat', 'Back squat', 'Quads', 'Barbell'),
  L('front_squat', 'Front squat', 'Quads', 'Barbell'),
  L('leg_press', 'Leg press', 'Quads', 'Machine'),
  L('hack_squat', 'Hack squat', 'Quads', 'Machine'),
  L('leg_ext', 'Leg extension', 'Quads', 'Machine'),
  L('goblet', 'Goblet squat', 'Quads', 'Dumbbell'),
  L('split_squat', 'Bulgarian split squat', 'Quads', 'Dumbbell'),
  L('lunge', 'Walking lunge', 'Quads', 'Bodyweight'),
  L('rdl', 'Romanian deadlift', 'Hamstrings', 'Barbell'),
  L('db_rdl', 'Dumbbell Romanian deadlift', 'Hamstrings', 'Dumbbell'),
  L('leg_curl', 'Lying leg curl', 'Hamstrings', 'Machine'),
  L('seated_curl', 'Seated leg curl', 'Hamstrings', 'Machine'),
  L('hip_thrust', 'Hip thrust', 'Glutes', 'Barbell'),
  L('glute_kick', 'Cable glute kickback', 'Glutes', 'Cable'),
  L('abductor', 'Hip abduction machine', 'Glutes', 'Machine'),
  L('calf_raise', 'Standing calf raise', 'Calves', 'Machine'),
  L('seated_calf', 'Seated calf raise', 'Calves', 'Machine'),
  // Core
  L('plank', 'Plank (seconds as reps)', 'Core', 'Bodyweight'),
  L('hanging_leg', 'Hanging leg raise', 'Core', 'Bodyweight'),
  L('cable_crunch', 'Cable crunch', 'Core', 'Cable'),
  L('ab_wheel', 'Ab wheel rollout', 'Core', 'Bodyweight'),
];

const R = (id, name, items) => ({ id, name, items: items.map(([ex, sets, reps]) => ({ exId: 'ex_' + ex, sets, reps })) });

export const SEED_ROUTINES = [
  R('rt_push', 'Push', [['bench', 3, 8], ['ohp', 3, 8], ['incline_db', 3, 10], ['lat_raise', 3, 12], ['pushdown', 3, 12]]),
  R('rt_pull', 'Pull', [['bb_row', 3, 8], ['pulldown', 3, 10], ['cable_row', 3, 10], ['face_pull', 3, 15], ['bb_curl', 3, 10]]),
  R('rt_legs', 'Legs', [['squat', 3, 8], ['rdl', 3, 8], ['leg_press', 3, 10], ['leg_curl', 3, 12], ['calf_raise', 3, 15]]),
];

export function seedTraining(rituals = []) {
  const strength = rituals.find((r) => r.id === 'r_train') || rituals.find((r) => /strength|train|gym|lift|workout/i.test(r.label));
  return {
    exercises: SEED_EXERCISES.map((e) => ({ ...e })),
    routines: SEED_ROUTINES.map((r) => ({ ...r, items: r.items.map((i) => ({ ...i })) })),
    sessions: [],
    active: null,
    settings: { restSec: 90, autoHabit: true, habitId: strength?.id || '', minMinutes: 30 },
  };
}

/* ---------- Maths ---------- */
export const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Epley estimated one-rep max. A single is its own 1RM.
export function e1rm(kg, reps) {
  kg = Number(kg) || 0; reps = Number(reps) || 0;
  if (kg <= 0 || reps <= 0) return 0;
  if (reps === 1) return kg;
  return Math.round(kg * (1 + reps / 30) * 10) / 10;
}

export const doneSets = (ex) => (ex.sets || []).filter((s) => s.done && Number(s.reps) > 0);
export const setVolume = (s) => (Number(s.kg) || 0) * (Number(s.reps) || 0);
export const sessionVolume = (session) =>
  session.exercises.reduce((t, ex) => t + doneSets(ex).reduce((a, s) => a + setVolume(s), 0), 0);

export function bestOf(sets) {
  let weight = 0, est = 0;
  for (const s of sets) {
    if (!s.done || !(Number(s.reps) > 0)) continue;
    weight = Math.max(weight, Number(s.kg) || 0);
    est = Math.max(est, e1rm(s.kg, s.reps));
  }
  return { weight, est };
}

// All-time bests for one exercise from finished sessions (optionally only those before `beforeTs`).
export function historicalBest(training, exId, beforeTs = Infinity) {
  let weight = 0, est = 0, any = false;
  for (const s of training.sessions) {
    if (s.startedAt >= beforeTs) continue;
    for (const ex of s.exercises) {
      if (ex.exId !== exId) continue;
      const b = bestOf(ex.sets);
      if (b.weight > 0 || b.est > 0) any = true;
      weight = Math.max(weight, b.weight); est = Math.max(est, b.est);
    }
  }
  return { weight, est, any };
}

// PRs in a session compared with everything before it. A first-ever attempt isn't a PR.
export function detectPRs(training, session) {
  const prs = [];
  for (const ex of session.exercises) {
    const b = bestOf(ex.sets);
    const h = historicalBest(training, ex.exId, session.startedAt);
    if (!h.any) continue;
    if (b.weight > h.weight) prs.push({ exId: ex.exId, type: 'weight', value: b.weight, prev: h.weight });
    if (b.est > h.est) prs.push({ exId: ex.exId, type: 'e1rm', value: b.est, prev: h.est });
  }
  return prs;
}

// The most recent finished session containing this exercise with completed sets.
export function lastPerformance(training, exId) {
  for (let i = training.sessions.length - 1; i >= 0; i--) {
    const s = training.sessions[i];
    const ex = s.exercises.find((e) => e.exId === exId && doneSets(e).length);
    if (ex) return { session: s, sets: doneSets(ex) };
  }
  return null;
}

// Pre-filled set rows for an exercise: last time's numbers, else the routine target.
export function prefillSets(training, exId, target) {
  const last = lastPerformance(training, exId);
  const count = target?.sets || last?.sets.length || 3;
  return Array.from({ length: count }, (_, i) => {
    const ref = last ? (last.sets[i] || last.sets[last.sets.length - 1]) : null;
    return { kg: ref ? Number(ref.kg) || 0 : '', reps: ref ? Number(ref.reps) : (target?.reps || ''), done: false };
  });
}

// Next routine in rotation after the last one done.
export function nextRoutine(training) {
  const rs = training.routines;
  if (!rs.length) return null;
  for (let i = training.sessions.length - 1; i >= 0; i--) {
    const idx = rs.findIndex((r) => r.id === training.sessions[i].routineId);
    if (idx >= 0) return rs[(idx + 1) % rs.length];
  }
  return rs[0];
}

// Monday-start week key (YYYY-MM-DD of the Monday) for a timestamp.
export function weekStart(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

// Volume (kg × reps) and set counts per muscle for the last `weeks` weeks, oldest first.
export function weeklyMuscleVolume(training, weeks = 6, now = Date.now()) {
  const exById = new Map(training.exercises.map((e) => [e.id, e]));
  const thisWeek = weekStart(now);
  const starts = Array.from({ length: weeks }, (_, i) => {
    const d = new Date(thisWeek); d.setDate(d.getDate() - 7 * (weeks - 1 - i)); return d.getTime();
  });
  const rows = new Map();
  for (const s of training.sessions) {
    const w = starts.indexOf(weekStart(s.startedAt));
    if (w < 0) continue;
    for (const ex of s.exercises) {
      const m = exById.get(ex.exId)?.muscle || 'Other';
      if (!rows.has(m)) rows.set(m, { muscle: m, volume: Array(weeks).fill(0), sets: Array(weeks).fill(0) });
      const r = rows.get(m);
      for (const st of doneSets(ex)) { r.volume[w] += setVolume(st); r.sets[w] += 1; }
    }
  }
  const order = [...MUSCLES, 'Other'];
  return { starts, rows: [...rows.values()].sort((a, b) => order.indexOf(a.muscle) - order.indexOf(b.muscle)) };
}

// Best estimated 1RM per session for one exercise, oldest first.
export function e1rmSeries(training, exId) {
  const pts = [];
  for (const s of training.sessions) {
    let best = 0, top = 0;
    for (const ex of s.exercises) if (ex.exId === exId) { const b = bestOf(ex.sets); best = Math.max(best, b.est); top = Math.max(top, b.weight); }
    if (best > 0) pts.push({ t: s.startedAt, est: best, weight: top });
  }
  return pts;
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export const minutes = (ms) => Math.round(ms / 60000);
export const fmtKg = (n) => (Math.round(Number(n) * 100) / 100).toString();
