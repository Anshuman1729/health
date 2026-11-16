// Compact, plain-text summaries of the user's data for AI prompts.
import * as D from '../train/data.js';

export function makeContext({ store, toDateKey, shiftDateKey, TODAY_KEY }) {
  const T = () => store.training;
  const exName = (id) => T().exercises.find((e) => e.id === id)?.name || id;
  const r1 = (n) => Math.round(n * 10) / 10;
  const dayKeys = (n) => Array.from({ length: n }, (_, i) => shiftDateKey(TODAY_KEY, -(n - 1 - i)));
  const weekday = (dk) => new Date(dk + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  function foodTotals(dk) {
    const d = store.days[dk];
    if (!d || !d.foods?.length) return null;
    return d.foods.reduce((a, f) => ({ prot: a.prot + (Number(f.prot) || 0), cal: a.cal + (Number(f.cal) || 0) }), { prot: 0, cal: 0 });
  }

  function targetsLine() {
    const t = store.targets;
    return `Targets: protein ${t.protein} g/day, calories ${t.calories} kcal/day, water ${t.waterMl} ml/day, goal weight ${t.goalWeight} kg.`;
  }

  function foodLines(n = 14) {
    return dayKeys(n).map((dk) => {
      const f = foodTotals(dk), d = store.days[dk];
      const water = d?.waterMl ? `, water ${d.waterMl} ml` : '';
      return `${weekday(dk)}: ${f ? `protein ${Math.round(f.prot)} g, ${Math.round(f.cal)} kcal` : 'no food logged'}${water}`;
    }).join('\n');
  }

  function weightLine() {
    const entries = Object.entries(store.weights || {}).sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length) return 'Weight: no entries.';
    const avg = (from, to) => {
      const v = entries.filter(([k]) => k > from && k <= to).map(([, w]) => w);
      return v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null;
    };
    const now = avg(shiftDateKey(TODAY_KEY, -7), TODAY_KEY), prev = avg(shiftDateKey(TODAY_KEY, -14), shiftDateKey(TODAY_KEY, -7));
    const last = entries[entries.length - 1];
    return `Weight: latest ${last[1]} kg on ${weekday(last[0])}; 7-day average ${now ?? 'n/a'} kg${prev != null && now != null ? ` vs ${prev} kg the week before (${now - prev >= 0 ? '+' : ''}${r1(now - prev)} kg)` : ''}.`;
  }

  function habitLines(n = 14) {
    const keys = dayKeys(n);
    return store.rituals.map((r) => {
      const done = keys.filter((k) => (store.days[k]?.doneRituals || []).includes(r.id)).length;
      return `- ${r.label}: done ${done} of ${n} days`;
    }).join('\n') || '- none';
  }

  function sleepLine(n = 14) {
    const sleep = store.rituals.find((r) => /sleep/i.test(r.label));
    if (!sleep) return 'Sleep: not tracked.';
    const keys = dayKeys(n);
    const marks = keys.map((k) => ((store.days[k]?.doneRituals || []).includes(sleep.id) ? 'y' : 'n')).join('');
    return `Sleep habit "${sleep.label}" over the last ${n} days, oldest first (y = done): ${marks}.`;
  }

  function sessionLines(n = 14) {
    const since = new Date(shiftDateKey(TODAY_KEY, -(n - 1)) + 'T00:00').getTime();
    const list = T().sessions.filter((s) => s.startedAt >= since);
    if (!list.length) return `No workouts in the last ${n} days.`;
    return list.map((s) => {
      const exs = s.exercises.map((ex) => {
        const sets = D.doneSets(ex);
        const top = sets.reduce((b, x) => (D.e1rm(x.kg, x.reps) > D.e1rm(b.kg, b.reps) ? x : b), sets[0]);
        return `${exName(ex.exId)} ${sets.length}x${top.reps}@${top.kg}kg`;
      }).join('; ');
      return `${weekday(toDateKey(new Date(s.startedAt)))} ${s.name} (${D.minutes(s.endedAt - s.startedAt)} min): ${exs}`;
    }).join('\n');
  }

  function prLines() {
    const best = new Map();
    for (const s of T().sessions) for (const ex of s.exercises) {
      const b = D.bestOf(ex.sets);
      const cur = best.get(ex.exId) || { est: 0, weight: 0 };
      best.set(ex.exId, { est: Math.max(cur.est, b.est), weight: Math.max(cur.weight, b.weight) });
    }
    return [...best.entries()].map(([id, b]) => `${exName(id)}: heaviest ${b.weight} kg, est. 1RM ${b.est} kg`).join('\n') || 'No PRs yet.';
  }

  function libraryLines() {
    return T().exercises.map((e) => `${e.id} | ${e.name} | ${e.muscle} | ${e.equipment}`).join('\n');
  }

  function routinesLine() {
    return T().routines.map((r) => `${r.name}: ${r.items.map((i) => `${exName(i.exId)} ${i.sets}x${i.reps}`).join(', ')}`).join('\n');
  }

  // Bundle for coach chat and weekly review.
  function coachBundle(days = 14) {
    return [
      `Today is ${weekday(TODAY_KEY)}.`,
      targetsLine(),
      `Food per day, last ${days} days:\n${foodLines(days)}`,
      weightLine(),
      `Habits, last ${days} days:\n${habitLines(days)}`,
      `Workouts, last ${days} days:\n${sessionLines(days)}`,
      `Next routine in rotation: ${D.nextRoutine(T())?.name || 'none'}.`,
    ].join('\n\n');
  }

  // Bundle for planning the next workout.
  function planBundle() {
    const proteinDays = dayKeys(14).map((dk) => Math.round(foodTotals(dk)?.prot || 0));
    return [
      `Today is ${weekday(TODAY_KEY)}.`,
      `Workouts, last 14 days:\n${sessionLines(14)}`,
      `All-time bests:\n${prLines()}`,
      `Saved routines:\n${routinesLine()}`,
      `Next routine in rotation: ${D.nextRoutine(T())?.name || 'none'}.`,
      sleepLine(14),
      `Protein per day, last 14 days, oldest first (target ${store.targets.protein} g): ${proteinDays.join(', ')}.`,
    ].join('\n\n');
  }

  return { coachBundle, planBundle, libraryLines, weekday, dayKeys, foodTotals };
}
