// Train tab: routines, live session, rest timer, PRs, history and the Today card.
import * as D from './data.js';

const ICON = {
  dumbbell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.3 2.3M9.5 2.5h5"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7"/></svg>',
};

export function initTrain(ctx) {
  const { store, persist, showToast, celebrate, pop, ensureDay, esc, fmt, $, toDateKey, fromDateKey, shiftDateKey, TODAY_KEY } = ctx;
  const T = () => store.training;
  const exById = (id) => T().exercises.find((e) => e.id === id) || { id, name: 'Unknown exercise', muscle: 'Other', equipment: '' };
  const routineById = (id) => T().routines.find((r) => r.id === id);

  let view = 'today';
  let progressExId = null;
  let routinesReorder = false;
  let showAllHistory = false;
  let clockTimer = null;
  let audio = null;

  /* ---------- Small helpers ---------- */
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : ''; };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  function relDay(ts) {
    const dk = toDateKey(new Date(ts));
    if (dk === TODAY_KEY) return 'today';
    if (dk === shiftDateKey(TODAY_KEY, -1)) return 'yesterday';
    const days = Math.round((fromDateKey(TODAY_KEY) - fromDateKey(dk)) / 864e5);
    if (days > 1 && days < 7) return `${days} days ago`;
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  const dateLabel = (ts) => new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const setsText = (sets) => sets.map((s) => `${D.fmtKg(s.kg || 0)}×${s.reps}`).join(' · ');
  const sheetHead = (title, sub = '') => `
    <div class="sheet-head">
      <div><h3 class="sheet-title">${esc(title)}</h3>${sub ? `<div class="card-meta">${sub}</div>` : ''}</div>
      <button type="button" class="icon-btn" data-act="close" aria-label="Close">✕</button>
    </div>`;

  /* ---------- Sheets ---------- */
  const sheet = $('trainSheet'), sheetBody = $('trainSheetBody');
  const picker = $('pickerSheet'), pickerBody = $('pickerSheetBody');
  let sheetCtx = null; // what the train sheet currently shows
  let pickerCtx = null;
  function openSheet(html, c) { sheetCtx = c; sheetBody.innerHTML = html; sheet.classList.add('open'); sheetBody.scrollTop = 0; }
  function closeSheet() { sheet.classList.remove('open'); sheetCtx = null; }
  function closePicker() { picker.classList.remove('open'); pickerCtx = null; }

  function openActions(title, actions, sub = '') {
    openSheet(`${sheetHead(title, sub)}
      <div class="action-list">${actions.map((a, i) => `<button type="button" class="action-btn ${a.danger ? 'danger' : ''}" data-act="action" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>`,
    { type: 'actions', actions });
  }

  /* ---------- View switching ---------- */
  function setView(v) {
    view = v;
    document.body.classList.toggle('view-train', v === 'train');
    $('trainView').hidden = v !== 'train';
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', v === 'train' ? t.dataset.view === 'train' : t.dataset.scroll === 'sectionToday'));
    $('btnViewToggle').querySelector('span').textContent = v === 'train' ? 'Today' : 'Train';
    if (v === 'train') { renderHome(); window.scrollTo(0, 0); }
  }

  /* ---------- Train home ---------- */
  function renderHome() {
    if (view !== 'train') return;
    const t = T();
    const wk = D.weekStart(Date.now());
    const thisWeek = t.sessions.filter((s) => s.startedAt >= wk).length;
    const next = D.nextRoutine(t);
    const last = t.sessions[t.sessions.length - 1];

    const upNext = next ? `
      <section class="score-card up-next">
        <div class="card-head">
          <h2 class="card-title">Up next</h2>
          <span class="card-meta">${last ? `Last: ${esc(last.name)}, ${relDay(last.startedAt)}` : 'Your first session'}</span>
        </div>
        <div class="up-name">${esc(next.name)}</div>
        <div class="up-list">${next.items.map((i) => `<div class="up-item"><span>${esc(exById(i.exId).name)}</span><span class="num">${i.sets} × ${i.reps}</span></div>`).join('') || '<div class="up-item"><span>No exercises yet</span></div>'}</div>
        <div class="up-actions">
          <button type="button" class="primary-btn violet big" data-act="start" data-id="${next.id}">Start ${esc(next.name)}</button>
          <button type="button" class="dark-btn" data-act="start-empty">Empty workout</button>
        </div>
      </section>` : `
      <section class="score-card up-next"><h2 class="card-title">No routines yet</h2>
        <div class="up-actions"><button type="button" class="primary-btn violet big" data-act="new-routine">Create a routine</button><button type="button" class="dark-btn" data-act="start-empty">Empty workout</button></div></section>`;

    const active = t.active ? `
      <section class="card active-banner">
        <div><div class="ab-title">Workout in progress</div><div class="card-meta">${esc(t.active.name)} · started ${D.minutes(Date.now() - t.active.startedAt)} min ago</div></div>
        <button type="button" class="primary-btn violet" data-act="resume">Resume</button>
      </section>` : '';

    const routines = `
      <section class="card">
        <div class="card-head">
          <h2 class="card-title">Routines</h2>
          <div class="head-actions">
            ${t.routines.length > 1 ? `<button type="button" class="text-btn" data-act="reorder">${routinesReorder ? 'Done' : 'Reorder'}</button>` : ''}
            <button type="button" class="primary-btn" data-act="new-routine">${ICON.plus} New</button>
          </div>
        </div>
        <div class="rows">${t.routines.map((r, i) => `
          <div class="row">
            <div class="row-main"><div class="row-title">${esc(r.name)}</div>
              <div class="row-meta">${plural(r.items.length, 'exercise')} · ${r.items.reduce((a, x) => a + (Number(x.sets) || 0), 0)} sets</div></div>
            ${routinesReorder ? `
              <button type="button" class="mini-btn" data-act="routine-up" data-i="${i}" aria-label="Move ${esc(r.name)} up" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
              <button type="button" class="mini-btn" data-act="routine-down" data-i="${i}" aria-label="Move ${esc(r.name)} down" ${i === t.routines.length - 1 ? 'disabled' : ''}>${ICON.down}</button>` : `
              <button type="button" class="text-btn" data-act="edit-routine" data-id="${r.id}">Edit</button>
              <button type="button" class="soft-btn row-btn" data-act="start" data-id="${r.id}">Start</button>`}
          </div>`).join('') || '<div class="empty">No routines yet. Tap New to make one.</div>'}</div>
      </section>`;

    const left = active + upNext + routines;
    const right = renderProgressCard() + renderVolumeCard() + renderHistoryCard();

    $('trainView').innerHTML = `
      <section class="date-row train-head">
        <div>
          <h1 class="date-title">Train</h1>
          <div class="date-sub"><span>${thisWeek ? `${plural(thisWeek, 'session')} this week` : 'Nothing logged this week yet'}</span></div>
        </div>
        <button type="button" class="icon-btn" data-act="settings" aria-label="Rest timer and habit settings">${ICON.timer}<span>Settings</span></button>
      </section>
      <div class="train-layout"><div class="tstack">${left}</div><div class="tstack">${right}</div></div>`;
  }

  function renderProgressCard() {
    const t = T();
    const withData = [...new Set(t.sessions.flatMap((s) => s.exercises.filter((e) => D.doneSets(e).length).map((e) => e.exId)))]
      .map(exById).sort((a, b) => a.name.localeCompare(b.name));
    if (!withData.length) return `<section class="card"><div class="card-head"><h2 class="card-title">Strength trend</h2></div><div class="empty">Finish a workout to see your estimated 1RM over time.</div></section>`;
    if (!withData.some((e) => e.id === progressExId)) {
      // Default to the exercise with the most sessions.
      const counts = new Map();
      t.sessions.forEach((s) => s.exercises.forEach((e) => counts.set(e.exId, (counts.get(e.exId) || 0) + 1)));
      progressExId = withData.slice().sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0))[0].id;
    }
    const pts = D.e1rmSeries(t, progressExId);
    const best = Math.max(...pts.map((p) => p.est)), heaviest = Math.max(...pts.map((p) => p.weight));
    return `
      <section class="card">
        <div class="card-head">
          <h2 class="card-title">Strength trend</h2>
          <select class="field select-sm" data-act="progress-ex" aria-label="Exercise">${withData.map((e) => `<option value="${e.id}" ${e.id === progressExId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
        </div>
        <div class="stat-row">
          <div><div class="stat-num num">${D.fmtKg(best)}<small>kg</small></div><div class="card-meta">Best estimated 1RM</div></div>
          <div><div class="stat-num num">${D.fmtKg(heaviest)}<small>kg</small></div><div class="card-meta">Heaviest set</div></div>
        </div>
        ${lineChart(pts)}
      </section>`;
  }

  function lineChart(pts) {
    if (pts.length < 2) return '<div class="card-meta chart-note">One more session of this exercise draws the line.</div>';
    const W = 320, H = 150, px = 8, py = 14;
    const ys = pts.map((p) => p.est), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t, tspan = t1 - t0 || 1;
    const x = (p) => px + ((p.t - t0) / tspan) * (W - 2 * px);
    const y = (p) => py + (1 - (p.est - lo) / span) * (H - 2 * py - 18);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
    const area = `${line} L${x(pts[pts.length - 1]).toFixed(1)},${H - 18} L${x(pts[0]).toFixed(1)},${H - 18} Z`;
    const d = (ts) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `
      <svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Estimated 1RM from ${D.fmtKg(pts[0].est)} to ${D.fmtKg(pts[pts.length - 1].est)} kg">
        <path d="${area}" style="fill:var(--prot-soft)"/>
        <path d="${line}" style="fill:none;stroke:var(--prot);stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round"/>
        ${pts.map((p, i) => `<circle cx="${x(p).toFixed(1)}" cy="${y(p).toFixed(1)}" r="${i === pts.length - 1 ? 4.5 : 3}" style="fill:${i === pts.length - 1 ? 'var(--prot)' : 'var(--card)'};stroke:var(--prot);stroke-width:2"/>`).join('')}
        <text x="${px}" y="${H - 3}" class="trend-lbl">${d(t0)}</text>
        <text x="${W - px}" y="${H - 3}" class="trend-lbl" text-anchor="end">${d(t1)}</text>
      </svg>`;
  }

  function renderVolumeCard() {
    const { starts, rows } = D.weeklyMuscleVolume(T(), 6);
    const body = rows.length ? rows.map((r) => {
      const max = Math.max(...r.volume, 1);
      return `<div class="vol-row">
        <span class="vol-name">${esc(r.muscle)}</span>
        <div class="vol-bars" aria-hidden="true">${r.volume.map((v, i) => `<span class="${i === r.volume.length - 1 ? 'now' : ''}" style="height:${Math.max(v ? 12 : 4, Math.round((v / max) * 100))}%"></span>`).join('')}</div>
        <span class="vol-val num">${fmt(r.volume[r.volume.length - 1])} kg<small>${plural(r.sets[r.sets.length - 1], 'set')}</small></span>
      </div>`;
    }).join('') : '<div class="empty">Weekly volume per muscle shows up after your first workout.</div>';
    const from = new Date(starts[0]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `
      <section class="card">
        <div class="card-head"><h2 class="card-title">Weekly volume</h2><span class="card-meta">kg × reps, 6 weeks from ${from}</span></div>
        ${rows.length ? '<div class="vol-legend"><span>Muscle</span><span>Weekly trend</span><span>This week</span></div>' : ''}
        <div class="vol">${body}</div>
      </section>`;
  }

  function renderHistoryCard() {
    const list = T().sessions.slice().reverse();
    const shown = showAllHistory ? list : list.slice(0, 6);
    return `
      <section class="card">
        <div class="card-head"><h2 class="card-title">History</h2><span class="card-meta">${plural(list.length, 'workout')}</span></div>
        <div class="rows">${shown.map((s) => `
          <button type="button" class="row row-link" data-act="session-detail" data-id="${s.id}">
            <div class="row-main"><div class="row-title">${esc(s.name)} ${s.prs?.length ? `<span class="pill prot pr-pill">${ICON.trophy}${s.prs.length} PR${s.prs.length > 1 ? 's' : ''}</span>` : ''}</div>
              <div class="row-meta">${dateLabel(s.startedAt)} · ${D.minutes(s.endedAt - s.startedAt)} min · ${fmt(s.volume)} kg</div></div>
            <span class="row-chev" aria-hidden="true">›</span>
          </button>`).join('') || '<div class="empty">Your finished workouts land here.</div>'}</div>
        ${list.length > 6 ? `<button type="button" class="text-btn more-btn" data-act="history-more">${showAllHistory ? 'Show fewer' : `Show all ${list.length}`}</button>` : ''}
      </section>`;
  }

  /* ---------- Today card ---------- */
  function renderTodayCard(selectedDate) {
    const el = $('sectionTrainToday'); if (!el) return;
    const t = T();
    const daySessions = t.sessions.filter((s) => toDateKey(new Date(s.startedAt)) === selectedDate);
    const next = D.nextRoutine(t);
    const last = t.sessions[t.sessions.length - 1];
    let body;
    if (t.active && selectedDate === TODAY_KEY) {
      body = `<div class="tt-main"><div class="tt-big">${esc(t.active.name)}</div><div class="card-meta">In progress · ${D.minutes(Date.now() - t.active.startedAt)} min</div></div>
        <button type="button" class="primary-btn violet" data-act="resume">Resume</button>`;
    } else if (daySessions.length) {
      const s = daySessions[daySessions.length - 1];
      body = `<div class="tt-main"><div class="tt-big">${esc(s.name)}</div><div class="card-meta">${D.minutes(s.endedAt - s.startedAt)} min · ${fmt(s.volume)} kg${s.prs?.length ? ` · ${plural(s.prs.length, 'PR')}` : ''}</div></div>
        <button type="button" class="soft-btn row-btn" data-act="session-detail" data-id="${s.id}">View</button>`;
    } else if (selectedDate === TODAY_KEY && next) {
      body = `<div class="tt-main"><div class="card-meta">Up next</div><div class="tt-big">${esc(next.name)}</div><div class="card-meta">${last ? `Last: ${esc(last.name)}, ${relDay(last.startedAt)}` : `${plural(next.items.length, 'exercise')}`}</div></div>
        <button type="button" class="primary-btn violet" data-act="start" data-id="${next.id}">Start</button>`;
    } else {
      body = `<div class="tt-main"><div class="tt-big muted">No workout</div><div class="card-meta">${last ? `Last: ${esc(last.name)}, ${relDay(last.startedAt)}` : 'Nothing logged yet'}</div></div>`;
    }
    const pill = daySessions.length ? '<span class="pill good">Done</span>' : t.active && selectedDate === TODAY_KEY ? '<span class="pill prot">Live</span>' : '';
    el.innerHTML = `<div class="card-head"><h2 class="card-title">Training</h2>${pill}</div><div class="tt">${body}</div>`;
  }

  /* ---------- Routine editor ---------- */
  function openRoutineEditor(id) {
    const src = id ? routineById(id) : null;
    const draft = src ? structuredClone(src) : { id: D.uid('rt'), name: '', items: [] };
    renderRoutineEditor(draft, !src);
  }
  function renderRoutineEditor(draft, isNew) {
    const html = `${sheetHead(isNew ? 'New routine' : 'Edit routine', 'Sets × reps are your targets.')}
      <input type="text" class="field" data-f="rt-name" placeholder="Routine name, e.g. Upper A" value="${esc(draft.name)}" maxlength="40" />
      <div class="rt-items">${draft.items.map((it, i) => `
        <div class="rt-item">
          <div class="rt-name">${esc(exById(it.exId).name)}<small>${esc(exById(it.exId).muscle)}</small></div>
          <div class="rt-target">
            <input class="field mini-in num" inputmode="numeric" data-f="rt-sets" data-i="${i}" value="${it.sets}" aria-label="Sets" />
            <span>×</span>
            <input class="field mini-in num" inputmode="numeric" data-f="rt-reps" data-i="${i}" value="${it.reps}" aria-label="Reps" />
          </div>
          <div class="rt-move">
            <button type="button" class="mini-btn" data-act="rt-up" data-i="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
            <button type="button" class="mini-btn" data-act="rt-down" data-i="${i}" aria-label="Move down" ${i === draft.items.length - 1 ? 'disabled' : ''}>${ICON.down}</button>
            <button type="button" class="mini-btn del" data-act="rt-remove" data-i="${i}" aria-label="Remove">✕</button>
          </div>
        </div>`).join('') || '<div class="empty">No exercises yet.</div>'}</div>
      <button type="button" class="soft-btn" data-act="rt-add">+ Add exercise</button>
      <div class="sheet-foot">
        ${isNew ? '' : '<button type="button" class="text-btn danger-text" data-act="rt-delete">Delete routine</button>'}
        <button type="button" class="primary-btn violet" data-act="rt-save">Save routine</button>
      </div>`;
    const keep = sheetBody.scrollTop;
    openSheet(html, { type: 'routine', draft, isNew });
    sheetBody.scrollTop = keep;
  }

  /* ---------- Exercise picker ---------- */
  function openPicker(title, onPick) {
    pickerCtx = { title, onPick, q: '', muscle: 'All', adding: false };
    renderPicker(); picker.classList.add('open');
  }
  function renderPicker(keepFocus) {
    const c = pickerCtx; if (!c) return;
    const q = c.q.trim().toLowerCase();
    const list = T().exercises
      .filter((e) => (c.muscle === 'All' || e.muscle === c.muscle) && (!q || e.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
    pickerBody.innerHTML = `${sheetHead(c.title)}
      <input type="search" class="field" data-f="pk-q" placeholder="Search exercises" value="${esc(c.q)}" autocomplete="off" />
      <div class="chips">${['All', ...D.MUSCLES].map((m) => `<button type="button" class="chip ${m === c.muscle ? 'active' : ''}" data-act="pk-muscle" data-m="${m}">${m}</button>`).join('')}</div>
      <div class="pk-list">${list.map((e) => `
        <button type="button" class="pk-row" data-act="pk-pick" data-id="${e.id}">
          <span class="row-title">${esc(e.name)}</span><span class="row-meta">${esc(e.muscle)} · ${esc(e.equipment)}${e.custom ? ' · yours' : ''}</span>
        </button>`).join('') || '<div class="empty">No match. Add it as your own below.</div>'}</div>
      ${c.adding ? `
        <form class="drawer open pk-add" data-form="pk-add" autocomplete="off">
          <input type="text" class="field" name="name" placeholder="Exercise name" value="${esc(c.q)}" required maxlength="50" />
          <div class="form-grid">
            <select class="field" name="muscle" aria-label="Muscle group">${D.MUSCLES.map((m) => `<option ${m === (c.muscle === 'All' ? 'Chest' : c.muscle) ? 'selected' : ''}>${m}</option>`).join('')}</select>
            <select class="field" name="equipment" aria-label="Equipment">${D.EQUIPMENT.map((m) => `<option>${m}</option>`).join('')}</select>
          </div>
          <button type="submit" class="primary-btn violet">Add and use it</button>
        </form>` : '<button type="button" class="soft-btn" data-act="pk-adding">+ Add your own exercise</button>'}`;
    if (keepFocus) { const i = pickerBody.querySelector('[data-f="pk-q"]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }

  /* ---------- Sessions ---------- */
  function startSession(routineId) {
    const t = T();
    if (t.active) {
      return openActions('A workout is already running', [
        { label: `Resume ${t.active.name}`, fn: () => openSession() },
        { label: 'Discard it and start this one', danger: true, fn: () => { t.active = null; startSession(routineId); } },
      ]);
    }
    const r = routineId ? routineById(routineId) : null;
    t.active = {
      id: D.uid('ss'), routineId: r?.id || null, name: r?.name || 'Workout', startedAt: Date.now(),
      restSec: t.settings.restSec, restEndsAt: null, restTotal: 0,
      exercises: (r?.items || []).map((it) => ({ exId: it.exId, target: { sets: it.sets, reps: it.reps }, sets: D.prefillSets(t, it.exId, it) })),
    };
    persist(); closeSheet(); openSession();
    if (!r) setTimeout(() => addExerciseToSession(), 150);
  }

  function openSession() {
    if (!T().active) return;
    closeSheet();
    document.body.classList.add('in-session');
    $('sessionView').hidden = false;
    renderSession(); window.scrollTo(0, 0);
    startClock();
  }
  function minimizeSession() {
    document.body.classList.remove('in-session');
    $('sessionView').hidden = true;
    stopClock(); ctx.renderAll(); renderHome();
  }

  function lastLine(exId) {
    const l = D.lastPerformance(T(), exId);
    return l ? `Last time, ${relDay(l.session.startedAt)}: <b>${setsText(l.sets)}</b>` : 'First time logging this one';
  }

  function renderSession() {
    const a = T().active; if (!a) return;
    $('sessionView').innerHTML = `
      <header class="session-top">
        <button type="button" class="icon-btn" data-act="minimize" aria-label="Back to the app, keep the workout running">${ICON.back}</button>
        <div class="session-title"><div class="st-name">${esc(a.name)}</div><div class="st-clock num" id="sessClock">${D.formatDuration(Date.now() - a.startedAt)}</div></div>
        <button type="button" class="primary-btn violet" data-act="finish">Finish</button>
      </header>
      <div class="session-body">
        ${a.exercises.map((ex, i) => renderExercise(ex, i)).join('') || '<div class="empty">Add your first exercise.</div>'}
        <button type="button" class="soft-btn wide-btn" data-act="sess-add-ex">+ Add exercise</button>
        <button type="button" class="text-btn danger-text discard" data-act="discard">Discard workout</button>
      </div>
      <div class="rest-bar" id="restBar"></div>`;
    renderRest();
  }

  function renderExercise(ex, i) {
    const e = exById(ex.exId);
    const done = ex.sets.filter((s) => s.done).length;
    return `
      <section class="card ex-card" data-ex="${i}">
        <div class="ex-head">
          <div class="ex-info"><div class="ex-name">${esc(e.name)}</div><div class="ex-last">${lastLine(ex.exId)}</div></div>
          <button type="button" class="mini-btn" data-act="ex-menu" data-ex="${i}" aria-label="Options for ${esc(e.name)}">${ICON.more}</button>
        </div>
        <div class="set-grid set-labels"><span>Set</span><span>kg</span><span>Reps</span><span>${done}/${ex.sets.length}</span></div>
        ${ex.sets.map((s, j) => `
          <div class="set-grid set-row ${s.done ? 'done' : ''}" data-ex="${i}" data-set="${j}">
            <span class="set-no num">${j + 1}</span>
            <input class="set-in num" inputmode="decimal" enterkeyhint="next" data-f="kg" data-ex="${i}" data-set="${j}" value="${s.kg === '' ? '' : D.fmtKg(s.kg)}" placeholder="0" aria-label="Set ${j + 1} kg" />
            <input class="set-in num" inputmode="numeric" enterkeyhint="done" data-f="reps" data-ex="${i}" data-set="${j}" value="${s.reps}" placeholder="0" aria-label="Set ${j + 1} reps" />
            <button type="button" class="set-check" data-act="tick" data-ex="${i}" data-set="${j}" aria-pressed="${s.done}" aria-label="Set ${j + 1} done">${ICON.check}</button>
          </div>`).join('')}
        <div class="ex-foot">
          <button type="button" class="soft-btn" data-act="add-set" data-ex="${i}">+ Add set</button>
          <button type="button" class="soft-btn" data-act="remove-set" data-ex="${i}" ${ex.sets.length ? '' : 'disabled'}>− Remove set</button>
          ${ex.target ? `<span class="card-meta">Target ${ex.target.sets} × ${ex.target.reps}</span>` : ''}
        </div>
      </section>`;
  }

  function rerenderExercise(i) {
    const a = T().active, el = $('sessionView').querySelector(`.ex-card[data-ex="${i}"]`);
    if (el) el.outerHTML = renderExercise(a.exercises[i], i);
  }

  function addExerciseToSession() {
    openPicker('Add exercise', (exId) => {
      const a = T().active;
      a.exercises.push({ exId, target: null, sets: D.prefillSets(T(), exId, null) });
      persist(); renderSession();
      setTimeout(() => $('sessionView').querySelector(`.ex-card[data-ex="${a.exercises.length - 1}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    });
  }

  function tickSet(i, j, btn) {
    const a = T().active, ex = a.exercises[i], s = ex.sets[j];
    if (!s.done) {
      if (!(Number(s.reps) > 0)) { showToast('Add your reps first'); return; }
      s.done = true;
      // Live PR check against history and earlier sets in this session.
      const hist = D.historicalBest(T(), ex.exId);
      const before = D.bestOf(ex.sets.filter((x, k) => k !== j));
      const w = Number(s.kg) || 0, est = D.e1rm(s.kg, s.reps);
      let msg = '';
      if (hist.any && w > Math.max(hist.weight, before.weight)) msg = `New PR: ${D.fmtKg(w)} kg`;
      else if (hist.any && est > Math.max(hist.est, before.est)) msg = `New PR: ${D.fmtKg(est)} kg est. 1RM`;
      if (msg) {
        const r = btn.getBoundingClientRect(); pop(r.left + r.width / 2, r.top, 'PR!');
        showToast(`${msg} on ${exById(ex.exId).name}`);
      }
      startRest();
    } else {
      s.done = false;
    }
    persist(); rerenderExercise(i);
  }

  /* ---------- Rest timer (timestamp based: survives lock and background) ---------- */
  function startRest() {
    const a = T().active;
    a.restTotal = a.restSec * 1000; a.restEndsAt = Date.now() + a.restTotal;
    armAudio(); renderRest();
  }
  function renderRest() {
    const a = T().active, bar = $('restBar'); if (!a || !bar) return;
    const left = a.restEndsAt ? a.restEndsAt - Date.now() : 0;
    if (a.restEndsAt && left > 0) {
      const pct = Math.max(0, Math.min(100, (left / a.restTotal) * 100));
      bar.className = 'rest-bar resting';
      bar.innerHTML = `
        <div class="rest-fill" style="width:${pct}%"></div>
        <button type="button" class="rest-btn" data-act="rest-minus" aria-label="15 seconds less">−15</button>
        <div class="rest-mid"><span class="rest-label">Rest</span><span class="rest-time num" id="restTime">${D.formatDuration(left + 999)}</span></div>
        <button type="button" class="rest-btn" data-act="rest-plus" aria-label="15 seconds more">+15</button>
        <button type="button" class="rest-btn skip" data-act="rest-skip">Skip</button>`;
    } else {
      bar.className = 'rest-bar';
      bar.innerHTML = `
        <button type="button" class="rest-btn" data-act="restdef-minus" aria-label="Shorter rest">−</button>
        <div class="rest-mid"><span class="rest-label">Rest after each set</span><span class="rest-time num">${D.formatDuration(a.restSec * 1000)}</span></div>
        <button type="button" class="rest-btn" data-act="restdef-plus" aria-label="Longer rest">+</button>`;
    }
  }
  function tickClock() {
    const a = T().active; if (!a) return stopClock();
    const c = $('sessClock'); if (c) c.textContent = D.formatDuration(Date.now() - a.startedAt);
    if (a.restEndsAt) {
      const left = a.restEndsAt - Date.now();
      if (left <= 0) {
        a.restEndsAt = null; persist(); renderRest();
        if (document.visibilityState === 'visible') { beep(); navigator.vibrate?.([200, 100, 200]); showToast('Rest done. Next set.'); }
      } else {
        const tEl = $('restTime'); if (tEl) tEl.textContent = D.formatDuration(left + 999);
        const f = $('restBar')?.querySelector('.rest-fill'); if (f) f.style.width = `${(left / a.restTotal) * 100}%`;
      }
    }
  }
  function startClock() { stopClock(); tickClock(); clockTimer = setInterval(tickClock, 250); }
  function stopClock() { clearInterval(clockTimer); clockTimer = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && clockTimer) tickClock(); });

  function armAudio() {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch { audio = null; }
  }
  function beep() {
    if (!audio) return;
    try {
      [0, 0.22].forEach((d) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
        const t0 = audio.currentTime + d;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
        o.start(t0); o.stop(t0 + 0.2);
      });
    } catch {}
  }

  /* ---------- Finish ---------- */
  function finishSession() {
    const t = T(), a = t.active;
    const exercises = a.exercises
      .map((ex) => ({ exId: ex.exId, target: ex.target, sets: ex.sets.filter((s) => s.done && Number(s.reps) > 0).map((s) => ({ kg: Number(s.kg) || 0, reps: Number(s.reps), done: true })) }))
      .filter((ex) => ex.sets.length);
    if (!exercises.length) {
      return openActions('No sets ticked yet', [
        { label: 'Keep going', fn: () => {} },
        { label: 'Discard this workout', danger: true, fn: discardSession },
      ], 'Tick the sets you did, then tap Finish.');
    }
    const endedAt = Date.now();
    const session = { id: a.id, routineId: a.routineId, name: a.name, startedAt: a.startedAt, endedAt, exercises };
    session.volume = Math.round(D.sessionVolume(session));
    session.prs = D.detectPRs(t, session);
    t.sessions.push(session);
    t.sessions.sort((x, y) => x.startedAt - y.startedAt);
    t.active = null;

    // Tie-in: tick the strength habit for that day.
    let habitNote = '';
    const st = t.settings, mins = D.minutes(endedAt - a.startedAt);
    const habit = store.rituals.find((r) => r.id === st.habitId);
    if (st.autoHabit && habit) {
      if (mins >= st.minMinutes) {
        const day = ensureDay(toDateKey(new Date(a.startedAt)));
        day.doneRituals = day.doneRituals || [];
        if (!day.doneRituals.includes(habit.id)) day.doneRituals.push(habit.id);
        habitNote = `Ticked “${esc(habit.label)}” for the day.`;
      } else {
        habitNote = `Under ${st.minMinutes} min, so “${esc(habit.label)}” wasn't ticked.`;
      }
    }
    persist();
    document.body.classList.remove('in-session'); $('sessionView').hidden = true; stopClock();
    ctx.renderAll(); renderHome();

    const sets = exercises.reduce((n, e) => n + e.sets.length, 0);
    openSheet(`${sheetHead('Workout done', esc(session.name) + ' · ' + dateLabel(session.startedAt))}
      <div class="finish-stats">
        <div><div class="stat-num num">${mins}<small>min</small></div><div class="card-meta">Duration</div></div>
        <div><div class="stat-num num">${fmt(session.volume)}<small>kg</small></div><div class="card-meta">Volume</div></div>
        <div><div class="stat-num num">${sets}</div><div class="card-meta">Sets</div></div>
      </div>
      ${session.prs.length ? `<div class="pr-box"><div class="pr-title">${ICON.trophy} ${plural(session.prs.length, 'PR')} today</div>
        ${session.prs.map((p) => `<div class="pr-line"><span>${esc(exById(p.exId).name)}</span><span class="num">${p.type === 'weight' ? 'Heaviest' : 'Est. 1RM'} <b>${D.fmtKg(p.value)} kg</b> <small>was ${D.fmtKg(p.prev)}</small></span></div>`).join('')}</div>`
      : '<div class="card-meta">No PRs this time. Consistency is what builds them.</div>'}
      ${habitNote ? `<div class="install-step">${habitNote}</div>` : ''}
      <button type="button" class="primary-btn violet big" data-act="close">Done</button>`, { type: 'finish' });
    if (session.prs.length) setTimeout(celebrate, 250);
  }

  function discardSession() {
    T().active = null; persist();
    document.body.classList.remove('in-session'); $('sessionView').hidden = true; stopClock();
    ctx.renderAll(); renderHome(); showToast('Workout discarded');
  }

  function openSessionDetail(id) {
    const s = T().sessions.find((x) => x.id === id); if (!s) return;
    openSheet(`${sheetHead(s.name, `${dateLabel(s.startedAt)} · ${D.minutes(s.endedAt - s.startedAt)} min · ${fmt(s.volume)} kg`)}
      <div class="detail">${s.exercises.map((ex) => {
        const prs = (s.prs || []).filter((p) => p.exId === ex.exId);
        return `<div class="detail-ex"><div class="row-title">${esc(exById(ex.exId).name)} ${prs.length ? `<span class="pill prot pr-pill">${ICON.trophy}PR</span>` : ''}</div>
          <div class="detail-sets">${ex.sets.map((st, k) => `<span class="num">${k + 1}. ${D.fmtKg(st.kg)} kg × ${st.reps}</span>`).join('')}</div></div>`;
      }).join('')}</div>
      <div class="sheet-foot">
        <button type="button" class="text-btn danger-text" data-act="session-delete" data-id="${s.id}">Delete workout</button>
        <button type="button" class="primary-btn" data-act="close">Close</button>
      </div>`, { type: 'detail', id });
  }

  function openSettings() {
    const st = T().settings;
    openSheet(`${sheetHead('Training settings')}
      <form data-form="settings" style="display:flex;flex-direction:column;gap:16px">
        <div class="input-group"><label for="tsRest">Default rest between sets (seconds)</label>
          <input type="number" class="field" id="tsRest" name="rest" min="15" max="600" step="15" value="${st.restSec}" required /></div>
        <div class="sheet-section">
          <h4>Habit tie-in</h4>
          <label class="toggle-line"><input type="checkbox" name="auto" ${st.autoHabit ? 'checked' : ''} /> Tick a habit when I finish a workout</label>
          <div class="form-grid">
            <div class="input-group"><label for="tsHabit">Habit</label>
              <select class="field" id="tsHabit" name="habit">${store.rituals.map((r) => `<option value="${r.id}" ${r.id === st.habitId ? 'selected' : ''}>${esc(r.label)}</option>`).join('') || '<option value="">No habits yet</option>'}</select></div>
            <div class="input-group"><label for="tsMin">Minimum minutes</label>
              <input type="number" class="field" id="tsMin" name="min" min="0" max="240" step="5" value="${st.minMinutes}" required /></div>
          </div>
        </div>
        <button type="submit" class="primary-btn violet big">Save</button>
      </form>`, { type: 'settings' });
  }

  /* ---------- Events ---------- */
  function onClick(e) {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const act = b.dataset.act, t = T(), a = t.active;
    const i = Number(b.dataset.i ?? b.dataset.ex), j = Number(b.dataset.set);
    switch (act) {
      case 'close': if (b.closest('#pickerSheet')) closePicker(); else closeSheet(); break;
      case 'action': { const fn = sheetCtx?.actions?.[i]?.fn; closeSheet(); fn?.(); break; }
      case 'settings': openSettings(); break;
      case 'start': startSession(b.dataset.id); break;
      case 'start-empty': startSession(null); break;
      case 'resume': openSession(); break;
      case 'reorder': routinesReorder = !routinesReorder; renderHome(); break;
      case 'routine-up': case 'routine-down': {
        const k = act === 'routine-up' ? i - 1 : i + 1;
        [t.routines[i], t.routines[k]] = [t.routines[k], t.routines[i]]; persist(); renderHome(); break;
      }
      case 'new-routine': openRoutineEditor(null); break;
      case 'edit-routine': openRoutineEditor(b.dataset.id); break;
      case 'history-more': showAllHistory = !showAllHistory; renderHome(); break;
      case 'session-detail': openSessionDetail(b.dataset.id); break;
      case 'session-delete': {
        const id = b.dataset.id;
        openActions('Delete this workout?', [{ label: 'Delete workout', danger: true, fn: () => {
          const idx = t.sessions.findIndex((s) => s.id === id); const [gone] = t.sessions.splice(idx, 1);
          persist(); ctx.renderAll(); renderHome();
          showToast('Workout deleted', () => { t.sessions.splice(idx, 0, gone); persist(); ctx.renderAll(); renderHome(); });
        } }, { label: 'Keep it', fn: () => openSessionDetail(id) }], 'PRs and charts will recalculate without it.');
        break;
      }
      // routine editor
      case 'rt-up': case 'rt-down': case 'rt-remove': case 'rt-add': case 'rt-save': case 'rt-delete': routineAct(act, i); break;
      // picker
      case 'pk-muscle': pickerCtx.muscle = b.dataset.m; renderPicker(); break;
      case 'pk-adding': pickerCtx.adding = true; renderPicker(); pickerBody.querySelector('[name="name"]')?.focus(); break;
      case 'pk-pick': { const fn = pickerCtx.onPick; closePicker(); fn(b.dataset.id); break; }
      // session
      case 'minimize': minimizeSession(); break;
      case 'finish': finishSession(); break;
      case 'discard': openActions('Discard this workout?', [{ label: 'Discard workout', danger: true, fn: discardSession }, { label: 'Keep going', fn: () => {} }], 'Nothing from it will be saved.'); break;
      case 'sess-add-ex': addExerciseToSession(); break;
      case 'tick': tickSet(i, j, b); break;
      case 'add-set': {
        const ex = a.exercises[i], last = ex.sets[ex.sets.length - 1];
        ex.sets.push({ kg: last ? last.kg : '', reps: last ? last.reps : (ex.target?.reps || ''), done: false });
        persist(); rerenderExercise(i); break;
      }
      case 'remove-set': a.exercises[i].sets.pop(); persist(); rerenderExercise(i); break;
      case 'ex-menu': {
        const ex = a.exercises[i], name = exById(ex.exId).name;
        const acts = [{ label: 'Swap exercise', fn: () => openPicker(`Swap ${name}`, (exId) => {
          ex.exId = exId; ex.sets = D.prefillSets(T(), exId, { sets: ex.sets.length || ex.target?.sets || 3, reps: ex.target?.reps });
          persist(); renderSession();
        }) }];
        if (i > 0) acts.push({ label: 'Move up', fn: () => { [a.exercises[i - 1], a.exercises[i]] = [a.exercises[i], a.exercises[i - 1]]; persist(); renderSession(); } });
        if (i < a.exercises.length - 1) acts.push({ label: 'Move down', fn: () => { [a.exercises[i + 1], a.exercises[i]] = [a.exercises[i], a.exercises[i + 1]]; persist(); renderSession(); } });
        acts.push({ label: 'Remove exercise', danger: true, fn: () => { a.exercises.splice(i, 1); persist(); renderSession(); } });
        openActions(name, acts); break;
      }
      case 'rest-plus': a.restEndsAt += 15000; a.restTotal += 15000; persist(); renderRest(); break;
      case 'rest-minus': a.restEndsAt -= 15000; persist(); if (a.restEndsAt <= Date.now()) a.restEndsAt = null; renderRest(); break;
      case 'rest-skip': a.restEndsAt = null; persist(); renderRest(); break;
      case 'restdef-plus': a.restSec = Math.min(600, a.restSec + 15); persist(); renderRest(); break;
      case 'restdef-minus': a.restSec = Math.max(15, a.restSec - 15); persist(); renderRest(); break;
    }
  }

  function routineAct(act, i) {
    const c = sheetCtx; if (c?.type !== 'routine') return;
    const d = c.draft, t = T();
    if (act === 'rt-up' || act === 'rt-down') { const k = act === 'rt-up' ? i - 1 : i + 1; [d.items[i], d.items[k]] = [d.items[k], d.items[i]]; renderRoutineEditor(d, c.isNew); }
    else if (act === 'rt-remove') { d.items.splice(i, 1); renderRoutineEditor(d, c.isNew); }
    else if (act === 'rt-add') openPicker('Add to routine', (exId) => { d.items.push({ exId, sets: 3, reps: 10 }); renderRoutineEditor(d, c.isNew); sheetBody.scrollTop = sheetBody.scrollHeight; });
    else if (act === 'rt-save') {
      d.name = d.name.trim() || 'My routine';
      const idx = t.routines.findIndex((r) => r.id === d.id);
      if (idx >= 0) t.routines[idx] = d; else t.routines.push(d);
      persist(); closeSheet(); renderHome(); ctx.renderAll(); showToast(`${d.name} saved`);
    } else if (act === 'rt-delete') {
      openActions(`Delete ${d.name || 'this routine'}?`, [{ label: 'Delete routine', danger: true, fn: () => {
        const idx = t.routines.findIndex((r) => r.id === d.id); const [gone] = t.routines.splice(idx, 1);
        persist(); renderHome(); ctx.renderAll();
        showToast('Routine deleted', () => { t.routines.splice(idx, 0, gone); persist(); renderHome(); ctx.renderAll(); });
      } }, { label: 'Keep it', fn: () => renderRoutineEditor(d, c.isNew) }], 'Past workouts stay in your history.');
    }
  }

  function onInput(e) {
    const el = e.target, f = el.dataset.f; if (!f) return;
    if (f === 'kg' || f === 'reps') {
      const s = T().active?.exercises[+el.dataset.ex]?.sets[+el.dataset.set]; if (!s) return;
      s[f] = f === 'reps' ? (parseInt(el.value, 10) || '') : num(el.value);
      persist();
    } else if (f === 'rt-name') sheetCtx.draft.name = el.value;
    else if (f === 'rt-sets' || f === 'rt-reps') {
      const v = Math.max(1, Math.min(f === 'rt-sets' ? 20 : 100, parseInt(el.value, 10) || 1));
      sheetCtx.draft.items[+el.dataset.i][f === 'rt-sets' ? 'sets' : 'reps'] = v;
    } else if (f === 'pk-q') { pickerCtx.q = el.value; renderPicker(true); }
  }

  function onSubmit(e) {
    const form = e.target.closest('[data-form]'); if (!form) return;
    e.preventDefault();
    const fd = new FormData(form), t = T();
    if (form.dataset.form === 'pk-add') {
      const name = String(fd.get('name')).trim(); if (!name) return;
      const existing = t.exercises.find((x) => x.name.toLowerCase() === name.toLowerCase());
      const ex = existing || { id: D.uid('ex'), name, muscle: fd.get('muscle'), equipment: fd.get('equipment'), custom: true };
      if (!existing) { t.exercises.push(ex); persist(); showToast(`${name} added to your library`); }
      const fn = pickerCtx.onPick; closePicker(); fn(ex.id);
    } else if (form.dataset.form === 'settings') {
      t.settings.restSec = Math.max(15, Math.min(600, Number(fd.get('rest')) || 90));
      t.settings.autoHabit = fd.get('auto') === 'on';
      t.settings.habitId = String(fd.get('habit') || '');
      t.settings.minMinutes = Math.max(0, Number(fd.get('min')) || 0);
      persist(); closeSheet(); showToast('Training settings saved');
    }
  }

  // Select a set field's contents on focus so a new number replaces it in one go.
  function onFocus(e) { if (e.target.classList?.contains('set-in')) setTimeout(() => e.target.select(), 0); }
  // "Return" on the kg field jumps to reps.
  function onKey(e) {
    if (e.key !== 'Enter' || !e.target.classList?.contains('set-in')) return;
    e.preventDefault();
    if (e.target.dataset.f === 'kg') e.target.nextElementSibling?.focus(); else e.target.blur();
  }

  ['trainView', 'sessionView', 'trainSheet', 'pickerSheet', 'sectionTrainToday'].forEach((id) => {
    const el = $(id);
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('change', (e) => { if (e.target.dataset.act === 'progress-ex') { progressExId = e.target.value; renderHome(); } });
    el.addEventListener('submit', onSubmit);
    el.addEventListener('focusin', onFocus);
    el.addEventListener('keydown', onKey);
  });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
  picker.addEventListener('click', (e) => { if (e.target === picker) closePicker(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (picker.classList.contains('open')) closePicker(); else closeSheet(); } });

  // Reopen straight into a workout that was running when the app was closed.
  if (T().active) openSession();

  return {
    setView,
    render(selectedDate) { renderTodayCard(selectedDate); renderHome(); if (T().active && !$('sessionView').hidden) renderRest(); },
    get view() { return view; },
  };
}
