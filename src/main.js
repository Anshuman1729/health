import { STORAGE_KEY, migrate, save, toBackup, fromBackup, requestPersistence } from './lib/storage.js';
import { initPwa, APP_VERSION, BUILD_TIME } from './lib/pwa.js';
import { initTrain } from './train/ui.js';
import './train/train.css';
import { initAI } from './ai/features.js';
import './ai/ai.css';

(function () {
  'use strict';

  /* ---------- Store (same key + schema as before, so existing data carries over) ---------- */
  const STORE_KEY = STORAGE_KEY;

  const DEFAULT_PANTRY = [
    { id: 'p_whey', name: 'Whey protein scoop', cal: 120, prot: 25, cat: 'protein', ico: '🥤' },
    { id: 'p_paneer', name: 'Paneer bhurji (150g)', cal: 265, prot: 27, cat: 'protein', ico: '🧀' },
    { id: 'p_eggs', name: '3 whole eggs', cal: 210, prot: 18, cat: 'protein', ico: '🥚' },
    { id: 'p_chicken', name: 'Chicken breast (150g)', cal: 245, prot: 46, cat: 'protein', ico: '🍗' },
    { id: 'p_dal', name: 'Dal tadka + 2 rotis', cal: 340, prot: 16, cat: 'meals', ico: '🍛' },
    { id: 'p_skyr', name: 'Greek yogurt', cal: 110, prot: 15, cat: 'protein', ico: '🥣' },
    { id: 'p_coffee', name: 'Black coffee', cal: 5, prot: 0, cat: 'drinks', ico: '☕' }
  ];
  const DEFAULT_RITUALS = [
    { id: 'r_prot', label: 'Hit 110 g protein' },
    { id: 'r_train', label: '45 min strength or zone 2' },
    { id: 'r_focus', label: '90 min deep work' },
    { id: 'r_sleep', label: '7.5 h sleep' },
    { id: 'r_clean', label: 'No late-night sugar' }
  ];

  const toDateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fromDateKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const shiftDateKey = (k, n) => { const d = fromDateKey(k); d.setDate(d.getDate() + n); return toDateKey(d); };
  const TODAY_KEY = toDateKey(new Date());

  function createSeedState() {
    const weights = {}, days = {};
    const curve = [73.2,73.1,73.3,72.9,72.8,72.6,72.7,72.4,72.3,72.5,72.1,72.0,71.9,72.1,71.8,71.7,71.8,71.6,71.5,71.7,71.5,71.4,71.5,71.4];
    for (let i = curve.length - 1; i >= 0; i--) {
      const dk = shiftDateKey(TODAY_KEY, -i);
      const idx = curve.length - 1 - i;
      weights[dk] = curve[idx];
      if (i > 0) {
        const done = idx % 5 === 0 ? ['r_prot','r_train','r_sleep'] : idx % 3 === 0 ? ['r_prot','r_focus','r_sleep','r_clean'] : ['r_prot','r_train','r_focus','r_sleep','r_clean'];
        days[dk] = {
          foods: [
            { id: 'seed_f1_' + idx, name: 'Whey protein scoop', cal: 120, prot: 25, meal: 'Breakfast', cat: 'protein' },
            { id: 'seed_f2_' + idx, name: 'Chicken breast (150g)', cal: 245, prot: 46, meal: 'Lunch', cat: 'protein' },
            { id: 'seed_f3_' + idx, name: 'Dal tadka + 2 rotis', cal: 340, prot: 16, meal: 'Dinner', cat: 'meals' }
          ],
          waterMl: 2750, doneRituals: done, note: ''
        };
      }
    }
    days[TODAY_KEY] = {
      foods: [
        { id: 'f_today_1', name: 'Black coffee', cal: 5, prot: 0, meal: 'Breakfast', cat: 'drinks' },
        { id: 'f_today_2', name: '3 whole eggs', cal: 210, prot: 18, meal: 'Breakfast', cat: 'protein' },
        { id: 'f_today_3', name: 'Whey protein scoop', cal: 120, prot: 25, meal: 'Breakfast', cat: 'protein' }
      ],
      waterMl: 1250, doneRituals: ['r_sleep'], note: ''
    };
    return {
      theme: 'light',
      targets: { protein: 110, calories: 1800, waterMl: 3000, goalWeight: 66.0 },
      pantry: [...DEFAULT_PANTRY], rituals: [...DEFAULT_RITUALS],
      weights, days, hasSampleWeight: true
    };
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const p = migrate(JSON.parse(raw));
        return {
          ...p, // keep any fields added by newer schema versions
          theme: p.theme || 'light',
          targets: {
            protein: p.targets?.protein ?? 110,
            calories: p.targets?.calories ?? 1800,
            waterMl: p.targets?.waterMl ?? 3000,
            goalWeight: p.targets?.goalWeight ?? 66.0
          },
          pantry: Array.isArray(p.pantry) ? p.pantry : [...DEFAULT_PANTRY],
          rituals: Array.isArray(p.rituals) ? p.rituals : [...DEFAULT_RITUALS],
          weights: p.weights || {}, days: p.days || {},
          hasSampleWeight: p.hasSampleWeight ?? false
        };
      }
    } catch (e) { /* storage unavailable: fall through to seed */ }
    return migrate(createSeedState());
  }

  const store = loadStore();
  persist(); // write back any schema migration straight away
  let selectedDate = TODAY_KEY;
  let activeCategory = 'all';
  let activeMeal = 'Breakfast';
  let weightWindowDays = 30;
  let lastProtHit = false, lastPulseHit = false;
  let undoCallback = null;
  let train = null; // Train tab controller, set up at the end

  function persist() {
    try { save(store); }
    catch (e) { showToast('Storage is full. Export a backup from Goals.'); }
  }
  function ensureDay(dk) {
    if (!store.days[dk]) store.days[dk] = { foods: [], waterMl: 0, doneRituals: [], note: '' };
    return store.days[dk];
  }

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (n) => Math.round(n).toLocaleString('en-IN');
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function shortDate(dk) {
    const d = fromDateKey(dk);
    if (dk === TODAY_KEY) return 'today';
    if (dk === shiftDateKey(TODAY_KEY, -1)) return 'yesterday';
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  /* ---------- Toast, pops, confetti ---------- */
  let toastTimer = null;
  function showToast(msg, onUndo = null) {
    $('toastText').textContent = msg;
    undoCallback = onUndo;
    $('btnToastUndo').style.display = onUndo ? 'inline-block' : 'none';
    $('toastBar').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toastBar').classList.remove('show'); undoCallback = null; }, onUndo ? 4200 : 2400);
  }
  $('btnToastUndo').addEventListener('click', () => {
    if (typeof undoCallback === 'function') undoCallback();
    undoCallback = null;
    $('toastBar').classList.remove('show');
  });

  function pop(x, y, text, kind = '') {
    const el = document.createElement('div');
    el.className = 'float-pop ' + kind;
    el.textContent = text;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  function celebrate() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = $('celebrationCanvas'), ctx = c.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = ['#4F3BFF', '#7B6CFF', '#FF7A2F', '#16AEDB', '#12A36B'];
    const ps = Array.from({ length: 56 }, (_, i) => {
      const a = (Math.PI * 2 * i) / 56 + (Math.random() - .5) * .3, s = 3 + Math.random() * 6;
      return { x: innerWidth / 2, y: innerHeight * .3, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 3, sz: 5 + Math.random() * 4, col: colors[i % 5], al: 1, r: Math.random() * 3 };
    });
    let f = 0;
    (function step() {
      f++; ctx.clearRect(0, 0, innerWidth, innerHeight);
      let alive = false;
      ps.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.vy += .18; p.al -= .017; p.r += .1;
        if (p.al > 0) { alive = true; ctx.save(); ctx.globalAlpha = p.al; ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.col; ctx.fillRect(-p.sz / 2, -p.sz / 2, p.sz, p.sz * .6); ctx.restore(); }
      });
      if (alive && f < 80) requestAnimationFrame(step); else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })();
  }

  /* ---------- Scoring ---------- */
  function telemetry(dk) {
    const rec = ensureDay(dk);
    const { protein: pG, calories: cG, waterMl: wG } = store.targets;
    let cal = 0, prot = 0;
    rec.foods.forEach((f) => { cal += Number(f.cal) || 0; prot += Number(f.prot) || 0; });
    const protRatio = Math.min(1, prot / Math.max(1, pG));
    const calRaw = cal / Math.max(1, cG);
    const calScore = calRaw <= 1.05 ? Math.min(1, calRaw) : Math.max(0, 1 - (calRaw - 1.05) * 1.5);
    const water = rec.waterMl || 0;
    const hydRatio = Math.min(1, water / Math.max(250, wG));
    const doneCount = store.rituals.filter((r) => (rec.doneRituals || []).includes(r.id)).length;
    const ritualRatio = doneCount / Math.max(1, store.rituals.length);
    const score = Math.round(protRatio * 35 + calScore * 25 + hydRatio * 20 + ritualRatio * 20);
    return { cal, prot, water, protRatio, calRaw, hydRatio, doneCount, ritualRatio, score };
  }

  /* ---------- Header + week ---------- */
  function renderHeader() {
    const d = fromDateKey(selectedDate);
    const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
    const dm = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
    $('headerDateText').textContent = selectedDate === TODAY_KEY ? 'Today' : weekday;
    $('headerDateSub').textContent = selectedDate === TODAY_KEY ? `${weekday}, ${dm}` : dm;
    $('btnJumpToday').style.display = selectedDate === TODAY_KEY ? 'none' : 'inline-block';

    const end = selectedDate > TODAY_KEY ? selectedDate : TODAY_KEY;
    const r = 15, circ = 2 * Math.PI * r;
    let html = `<button type="button" class="week-arrow" id="btnScrubPrev" aria-label="Previous day">‹</button>`;
    for (let i = 6; i >= 0; i--) {
      const dk = shiftDateKey(end, -i);
      const dt = fromDateKey(dk);
      const t = telemetry(dk);
      const active = dk === selectedDate;
      const stroke = active ? 'transparent' : t.score >= 85 ? '#12A36B' : t.score >= 50 ? '#7B6CFF' : '#FF7A2F';
      const off = circ - (circ * t.score) / 100;
      html += `<button type="button" class="day ${active ? 'is-active' : ''} ${dk === TODAY_KEY ? 'is-today' : ''}" data-week-date="${dk}" aria-label="${dt.toDateString()}, score ${t.score}" ${active ? 'aria-current="date"' : ''}>
        <span class="day-dow">${dt.toLocaleDateString('en-GB', { weekday: 'narrow' })}</span>
        <span class="day-ring">
          <svg viewBox="0 0 34 34"><circle cx="17" cy="17" r="${r}" fill="none" stroke="${active ? 'transparent' : 'var(--line-2)'}" stroke-width="2.5"/>
          <circle cx="17" cy="17" r="${r}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg>
          <span class="day-num">${dt.getDate()}</span>
        </span>
      </button>`;
    }
    html += `<button type="button" class="week-arrow" id="btnScrubNext" aria-label="Next day">›</button>`;
    $('weekScrubber').innerHTML = html;
  }

  /* ---------- Hero, calories, water, score ---------- */
  let shownScore = 0, scoreRaf = null, shownProt = 0, protRaf = null;
  function countTo(el, from, to, setter) {
    const start = performance.now(), dur = 450;
    let raf;
    (function tick(now) {
      const t = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - t, 3);
      const v = Math.round(from + (to - from) * e);
      el.textContent = v; setter(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    })(start);
    return raf;
  }

  function renderToday() {
    const t = telemetry(selectedDate);
    const { protein: pG, calories: cG, waterMl: wG } = store.targets;
    const day = ensureDay(selectedDate);

    // Protein hero
    cancelAnimationFrame(protRaf);
    protRaf = countTo($('tileProtVal'), shownProt, Math.round(t.prot), (v) => (shownProt = v));
    $('heroProtGoal').textContent = `/ ${pG} g`;
    const protRem = Math.max(0, pG - t.prot);
    $('tagProtDelta').textContent = protRem > 0 ? `${Math.round(protRem)} g to go` : 'Goal hit';
    const filled = (t.prot / Math.max(1, pG)) * 10;
    $('protSegbar').innerHTML = Array.from({ length: 10 }, (_, i) => {
      const w = Math.max(0, Math.min(1, filled - i)) * 100;
      return `<div class="seg"><span style="width:${w}%"></span></div>`;
    }).join('');

    // Coach line
    const calRem = cG - t.cal;
    const protShare = t.cal > 0 ? Math.round((t.prot * 4 / t.cal) * 100) : 0;
    let coach;
    if (protRem <= 0 && calRem >= 0) {
      coach = `<strong>Protein goal done.</strong> You still have ${fmt(calRem)} kcal to play with today.`;
    } else if (calRem < 0) {
      coach = `<strong>${fmt(-calRem)} kcal over budget.</strong> ` + (protRem > 0 ? `Still ${Math.round(protRem)} g protein short, so pick something lean like whey or egg whites.` : 'Protein is already covered.');
    } else {
      const used = new Set(day.foods.map((f) => f.meal));
      const left = Math.max(1, ['Breakfast', 'Lunch', 'Dinner'].filter((m) => !used.has(m)).length);
      const per = Math.ceil(protRem / left);
      const pick = protRem <= 27 ? 'one whey scoop or paneer bhurji' : protRem <= 48 ? 'chicken breast (46 g)' : 'chicken breast plus a whey shake';
      coach = `About <strong>${per} g per meal</strong> across ${left} meal${left > 1 ? 's' : ''} gets you there. <strong>Try ${pick}</strong>, which fits in your ${fmt(calRem)} kcal left.`;
    }
    $('pacingMessage').innerHTML = coach;

    // Calories
    $('tileCalVal').innerHTML = `${fmt(t.cal)}<small>kcal</small>`;
    $('tileCalPct').textContent = `of ${fmt(cG)} budget · ${protShare}% from protein`;
    $('barCal').style.width = Math.min(100, t.calRaw * 100) + '%';
    if (calRem >= 0) {
      $('tagCalDelta').textContent = `${fmt(calRem)} left`;
      $('tagCalDelta').className = 'pill warn';
      $('barCal').style.background = 'var(--cal)';
    } else {
      $('tagCalDelta').textContent = `${fmt(-calRem)} over`;
      $('tagCalDelta').className = 'pill bad';
      $('barCal').style.background = 'var(--over)';
    }

    const mealsCal = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'].map((m) => [m, day.foods.filter((f) => f.meal === m).reduce((s, f) => s + Number(f.cal), 0)]);
    $('calMeals').innerHTML = mealsCal.map(([m, c]) => `<div class="cal-meal"><span>${m}</span><b>${c ? fmt(c) : '—'}</b></div>`).join('');

    // Water
    const glassesTotal = Math.min(16, Math.max(1, Math.round(wG / 250)));
    const glassesNow = Math.floor(t.water / 250);
    $('vesselMainText').innerHTML = `${fmt(t.water)}<small>ml</small>`;
    $('vesselSubText').textContent = `${glassesNow} of ${glassesTotal} glasses`;
    const hydRem = Math.max(0, wG - t.water);
    $('tagHydDelta').textContent = hydRem > 0 ? `${fmt(hydRem)} ml left` : 'Goal hit';
    $('tagHydDelta').className = hydRem > 0 ? 'pill water' : 'pill good';
    $('glassGrid').style.gridTemplateColumns = `repeat(${glassesTotal > 12 ? 8 : 6}, 1fr)`;
    $('glassGrid').innerHTML = Array.from({ length: glassesTotal }, (_, i) =>
      `<button type="button" class="glass ${i < glassesNow ? 'full' : ''}" data-glass="${i + 1}" aria-label="Set water to ${(i + 1) * 250} ml"></button>`
    ).join('');

    // Score rings
    const C = (r) => 2 * Math.PI * r;
    [['heroRingProt', 86, t.protRatio], ['heroRingCal', 68, Math.min(1, t.calRaw)], ['heroRingHyd', 50, t.hydRatio]].forEach(([id, r, v]) => {
      const el = $(id); el.style.strokeDasharray = C(r); el.style.strokeDashoffset = C(r) * (1 - v);
    });
    cancelAnimationFrame(scoreRaf);
    scoreRaf = countTo($('heroPulseNum'), shownScore, t.score, (v) => (shownScore = v));
    $('legProt').textContent = Math.round(t.protRatio * 100) + '%';
    $('legCal').textContent = Math.round(t.calRaw * 100) + '%';
    $('legHyd').textContent = Math.round(t.hydRatio * 100) + '%';
    $('legHab').textContent = `${t.doneCount}/${store.rituals.length}`;

    if (selectedDate === TODAY_KEY) {
      const hitP = t.prot >= pG, hitS = t.score >= 100;
      if ((hitP && !lastProtHit) || (hitS && !lastPulseHit)) celebrate();
      lastProtHit = hitP; lastPulseHit = hitS;
    }
  }

  /* ---------- Food ---------- */
  const MEAL_COLORS = { Breakfast: '#FF7A2F', Lunch: '#16AEDB', Dinner: '#4F3BFF', Snacks: '#12A36B' };

  function renderFood() {
    const day = ensureDay(selectedDate);
    $('drawerMealLabel').textContent = activeMeal;

    const items = store.pantry.filter((p) => activeCategory === 'all' || p.cat === activeCategory);
    $('pantryChipsGrid').innerHTML = items.length ? items.map((p) => {
      const lean = p.prot > 0 && p.cal / p.prot <= 10.5;
      return `<div class="food-tile" data-pantry-id="${p.id}" role="button" tabindex="0" aria-label="Log ${esc(p.name)} to ${activeMeal}">
        <span class="food-emoji">${p.ico || '🍽️'}</span>
        <span class="food-info">
          <span class="food-name" style="display:block">${esc(p.name)}</span>
          <span class="food-macro"><b>${p.prot} g</b> protein, ${p.cal} kcal</span>
        </span>
        ${lean ? `<span class="lean-tag" title="${(p.cal / p.prot).toFixed(1)} kcal per gram of protein">Lean</span>` : ''}
        ${p.custom ? `<button type="button" class="food-remove" data-remove-pantry="${p.id}" aria-label="Remove tile">✕</button>` : ''}
      </div>`;
    }).join('') : `<div class="empty" style="grid-column:1/-1">No tiles in this group. Add a food and keep “Save as a quick-add tile” ticked.</div>`;

    const totCal = day.foods.reduce((s, f) => s + Number(f.cal), 0);
    const totProt = day.foods.reduce((s, f) => s + Number(f.prot), 0);
    $('foodTotals').textContent = day.foods.length ? `${fmt(totProt)} g protein and ${fmt(totCal)} kcal so far` : 'Nothing logged yet';
    $('timelineItemCount').textContent = `${day.foods.length} item${day.foods.length === 1 ? '' : 's'}`;

    if (!day.foods.length) {
      $('mealTimeline').innerHTML = `<div class="empty">Nothing logged for ${shortDate(selectedDate)}. Tap a tile above and it goes straight into <b>${activeMeal}</b>.</div>`;
      return;
    }
    $('mealTimeline').innerHTML = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'].map((meal) => {
      const list = day.foods.filter((f) => f.meal === meal);
      if (!list.length) return '';
      const mP = list.reduce((s, f) => s + Number(f.prot), 0), mC = list.reduce((s, f) => s + Number(f.cal), 0);
      return `<div>
        <div class="meal-head">
          <span class="meal-name"><span class="meal-dot" style="background:${MEAL_COLORS[meal]}"></span>${meal}</span>
          <span class="meal-tot"><b>${fmt(mP)} g</b> protein, ${fmt(mC)} kcal</span>
        </div>
        ${list.map((f) => `<div class="log-row" id="log_row_${f.id}">
          <span class="log-name">${esc(f.name)}</span>
          <span class="log-right">
            <span class="log-p">${Number(f.prot)} g</span>
            <span class="log-k">${fmt(f.cal)} kcal</span>
            <button type="button" class="mini-btn" data-dup-id="${f.id}" aria-label="Log another serving">+1</button>
            <button type="button" class="mini-btn del" data-del-id="${f.id}" aria-label="Remove">✕</button>
          </span>
        </div>`).join('')}
      </div>`;
    }).join('');
  }

  /* ---------- Weight chart ---------- */
  let nodes = [];
  function weightSeries() {
    const keys = Object.keys(store.weights).sort();
    return keys.map((dk, i) => {
      let sum = 0, n = 0;
      for (let j = Math.max(0, i - 6); j <= i; j++) { sum += store.weights[keys[j]]; n++; }
      return { dateKey: dk, raw: store.weights[dk], avg7: sum / n };
    });
  }

  function renderWeight() {
    const all = weightSeries();
    const goal = store.targets.goalWeight;
    $('weighinDateTag').textContent = selectedDate === TODAY_KEY ? "Today's weigh-in" : `Weigh-in, ${shortDate(selectedDate)}`;
    $('btnClearSampleWeight').style.display = store.hasSampleWeight ? 'inline-block' : 'none';

    const logged = store.weights[selectedDate];
    if (logged !== undefined) $('inputWeighinKg').value = logged.toFixed(1);
    else if (all.length) $('inputWeighinKg').value = all[all.length - 1].raw.toFixed(1);

    if (!all.length) {
      $('heroWeightVal').innerHTML = `— <small>kg</small>`;
      $('weightDeltaTag').textContent = 'No entries yet';
      $('weightDeltaTag').className = 'pill';
      $('weightGoalReadout').textContent = `Goal ${goal.toFixed(1)} kg`;
      drawChart([]);
      return;
    }
    const latest = all[all.length - 1];
    const shown = all.find((x) => x.dateKey === selectedDate) || latest;
    $('heroWeightVal').innerHTML = `${shown.raw.toFixed(1)} <small>kg</small>`;
    const d7 = latest.avg7 - all[Math.max(0, all.length - 7)].avg7;
    $('weightDeltaTag').textContent = `${d7 > 0 ? '+' : d7 < 0 ? '−' : ''}${Math.abs(d7).toFixed(1)} kg this week`;
    $('weightDeltaTag').className = `pill ${d7 <= 0 ? 'good' : 'warn'}`;
    const toGo = shown.raw - goal;
    $('weightGoalReadout').textContent = toGo > 0 ? `${toGo.toFixed(1)} kg to goal of ${goal.toFixed(1)}` : `At or under goal of ${goal.toFixed(1)} kg`;
    drawChart(all.slice(-weightWindowDays));
  }

  function drawChart(series) {
    const canvas = $('weightSplineCanvas'), box = $('weightCanvasBox');
    const rect = box.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(220, Math.floor(rect.width)), h = Math.max(150, Math.floor(rect.height));
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    nodes = [];

    const ink = cssVar('--ink'), ink3 = cssVar('--ink-3'), line = cssVar('--line'), prot = cssVar('--prot');
    const font = '500 11px Geist, -apple-system, sans-serif';

    if (!series.length) {
      ctx.fillStyle = ink3; ctx.font = '500 13px Geist, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Save a weigh-in below to start your trend line', w / 2, h / 2);
      return;
    }

    const padL = 10, padR = 40, padT = 14, padB = 24;
    const pw = w - padL - padR, ph = h - padT - padB;
    const goal = store.targets.goalWeight;
    let lo = Infinity, hi = -Infinity;
    series.forEach((p) => { lo = Math.min(lo, p.raw, p.avg7); hi = Math.max(hi, p.raw, p.avg7); });
    const showGoal = goal >= lo - 3; // only include goal if it's near the range
    if (showGoal) { lo = Math.min(lo, goal); hi = Math.max(hi, goal); }
    const pad = Math.max(0.6, (hi - lo) * 0.18);
    lo = Math.floor((lo - pad) * 2) / 2; hi = Math.ceil((hi + pad) * 2) / 2;
    const span = Math.max(1, hi - lo);
    const Y = (v) => padT + ph - ((v - lo) / span) * ph;
    const X = (i) => series.length === 1 ? padL + pw / 2 : padL + (i / (series.length - 1)) * pw;

    ctx.font = font; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (let g = 0; g <= 3; g++) {
      const v = lo + (g / 3) * span, y = Y(v);
      ctx.strokeStyle = line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + pw, y); ctx.stroke();
      ctx.fillStyle = ink3; ctx.fillText(v.toFixed(1), padL + pw + 8, y);
    }

    if (showGoal) {
      const yg = Y(goal);
      ctx.save(); ctx.setLineDash([3, 5]); ctx.strokeStyle = prot; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(padL, yg); ctx.lineTo(padL + pw, yg); ctx.stroke(); ctx.restore();
      ctx.fillStyle = prot; ctx.font = '700 11px Geist, sans-serif'; ctx.fillText('Goal', padL + pw + 8, yg);
      ctx.font = font;
    }

    const pts = series.map((p, i) => ({ x: X(i), y: Y(p.avg7) }));
    const path = () => {
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const xc = (pts[i].x + pts[i + 1].x) / 2, yc = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    };
    if (pts.length > 1) {
      const grad = ctx.createLinearGradient(0, padT, 0, padT + ph);
      grad.addColorStop(0, prot + '33'); grad.addColorStop(1, prot + '00');
      path(); ctx.lineTo(pts[pts.length - 1].x, padT + ph); ctx.lineTo(pts[0].x, padT + ph); ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();
      path(); ctx.strokeStyle = prot; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    }

    const step = Math.max(1, Math.ceil(series.length / Math.max(2, Math.floor(pw / 64))));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    series.forEach((p, i) => {
      const x = X(i), yr = Y(p.raw);
      nodes.push({ x, ...p });
      const sel = p.dateKey === selectedDate;
      if (sel) {
        ctx.beginPath(); ctx.arc(x, yr, 7, 0, Math.PI * 2); ctx.fillStyle = prot + '33'; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(x, yr, sel ? 4 : 2.4, 0, Math.PI * 2);
      ctx.fillStyle = sel ? prot : ink3; ctx.fill();
      const isLast = i === series.length - 1;
      const lastX = X(series.length - 1);
      if ((i % step === 0 && lastX - x > 52) || isLast) {
        const d = fromDateKey(p.dateKey);
        ctx.textAlign = isLast && series.length > 1 ? 'right' : i === 0 && series.length > 1 ? 'left' : 'center';
        ctx.fillStyle = ink3; ctx.font = font;
        ctx.fillText(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), x, padT + ph + 8);
      }
    });
  }

  /* ---------- Habits, month grid, notes ---------- */
  function streak(id) {
    let s = 0;
    let cur = (ensureDay(TODAY_KEY).doneRituals || []).includes(id) ? TODAY_KEY : shiftDateKey(TODAY_KEY, -1);
    while ((store.days[cur]?.doneRituals || []).includes(id) && s < 366) { s++; cur = shiftDateKey(cur, -1); }
    return s;
  }

  function renderHabits() {
    const day = ensureDay(selectedDate);
    const done = new Set(day.doneRituals || []);
    const count = store.rituals.filter((r) => done.has(r.id)).length;
    $('ritualRatioBadge').textContent = `${count} of ${store.rituals.length}`;
    $('ritualRatioBadge').className = count === store.rituals.length && count > 0 ? 'pill good' : 'pill';

    $('ritualList').innerHTML = store.rituals.length ? store.rituals.map((r) => {
      const isDone = done.has(r.id), s = streak(r.id);
      return `<div class="habit ${isDone ? 'done' : ''}" data-ritual-id="${r.id}" role="checkbox" aria-checked="${isDone}" tabindex="0">
        <span class="check"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>
        <span class="habit-label">${esc(r.label)}</span>
        ${s > 1 ? `<span class="streak" title="${s} days in a row">🔥 ${s}</span>` : ''}
        <button type="button" class="mini-btn del" data-del-ritual="${r.id}" aria-label="Delete habit">✕</button>
      </div>`;
    }).join('') : `<div class="empty">No habits yet. Add one below.</div>`;

    const total = Math.max(1, store.rituals.length);
    const start = shiftDateKey(TODAY_KEY, -27);
    let strong = 0;
    let html = '';
    for (let i = 0; i < 7; i++) html += `<div class="month-dow">${fromDateKey(shiftDateKey(start, i)).toLocaleDateString('en-GB', { weekday: 'narrow' })}</div>`;
    for (let i = 0; i < 28; i++) {
      const dk = shiftDateKey(start, i);
      const rec = store.days[dk];
      const c = rec ? store.rituals.filter((r) => (rec.doneRituals || []).includes(r.id)).length : 0;
      const ratio = c / total;
      if (ratio >= .75) strong++;
      const q = ratio === 0 ? '' : ratio < .4 ? 'q1' : ratio < .75 ? 'q2' : ratio < 1 ? 'q3' : 'q4';
      html += `<button type="button" class="cell ${q} ${dk === selectedDate ? 'sel' : ''}" data-matrix-date="${dk}" title="${fromDateKey(dk).toDateString()}: ${c} of ${store.rituals.length}" aria-label="${fromDateKey(dk).toDateString()}, ${c} of ${store.rituals.length} habits"></button>`;
    }
    $('consistencyMatrix').innerHTML = html;
    $('matrixStrongCount').textContent = `${strong} strong day${strong === 1 ? '' : 's'}`;

    if (document.activeElement !== $('scratchpadTextarea')) $('scratchpadTextarea').value = day.note || '';
  }

  /* ---------- Theme + master render ---------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    $('iconSun').style.display = theme === 'dark' ? 'block' : 'none';
    $('iconMoon').style.display = theme === 'dark' ? 'none' : 'block';
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#0D0E12' : '#E9ECF1';
  }
  function renderAll() { renderHeader(); renderToday(); renderFood(); renderWeight(); renderHabits(); train?.render(selectedDate); }
  const goTo = (dk) => { selectedDate = dk; renderAll(); };

  /* ---------- Events ---------- */
  $('weekScrubber').addEventListener('click', (e) => {
    if (e.target.closest('#btnScrubPrev')) return goTo(shiftDateKey(selectedDate, -1));
    if (e.target.closest('#btnScrubNext')) return goTo(shiftDateKey(selectedDate, 1));
    const b = e.target.closest('[data-week-date]'); if (b) goTo(b.dataset.weekDate);
  });
  $('btnJumpToday').addEventListener('click', () => goTo(TODAY_KEY));
  $('btnToggleTheme').addEventListener('click', () => {
    store.theme = store.theme === 'dark' ? 'light' : 'dark';
    applyTheme(store.theme); persist(); renderAll();
  });

  $('pantryCategoryFilter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    activeCategory = b.dataset.cat;
    $('pantryCategoryFilter').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === b));
    renderFood();
  });
  $('activeMealTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-meal]'); if (!b) return;
    activeMeal = b.dataset.meal;
    $('activeMealTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    renderFood();
  });
  $('btnToggleCustomDrawer').addEventListener('click', () => {
    if ($('customFoodDrawer').classList.toggle('open')) $('inputCustomName').focus();
  });

  function logPantry(card) {
    const item = store.pantry.find((x) => x.id === card.dataset.pantryId); if (!item) return;
    const day = ensureDay(selectedDate);
    const id = 'food_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    day.foods.push({ id, name: item.name, cal: item.cal, prot: item.prot, meal: activeMeal, cat: item.cat });
    persist(); renderAll();
    const r = card.getBoundingClientRect();
    pop(r.left + r.width / 2, r.top, item.prot > 0 ? `+${item.prot} g` : `+${item.cal} kcal`);
    showToast(`Logged ${item.name} to ${activeMeal}`, () => {
      day.foods = day.foods.filter((f) => f.id !== id); persist(); renderAll();
    });
  }
  $('pantryChipsGrid').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove-pantry]');
    if (rm) {
      e.stopPropagation();
      store.pantry = store.pantry.filter((x) => x.id !== rm.dataset.removePantry);
      persist(); renderFood(); return;
    }
    const card = e.target.closest('[data-pantry-id]'); if (card) logPantry(card);
  });
  $('pantryChipsGrid').addEventListener('keydown', (e) => {
    const card = e.target.closest('[data-pantry-id]');
    if (card && (e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); logPantry(card); }
  });

  $('customFoodDrawer').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('inputCustomName').value.trim();
    const cal = parseFloat($('inputCustomCal').value), prot = parseFloat($('inputCustomProt').value);
    const cat = $('inputCustomCat').value;
    if (!name || isNaN(cal) || isNaN(prot)) return;
    ensureDay(selectedDate).foods.push({ id: 'food_' + Date.now(), name, cal: Math.max(0, cal), prot: Math.max(0, prot), meal: activeMeal, cat });
    if ($('chkPinPantry').checked) {
      store.pantry.unshift({ id: 'p_custom_' + Date.now(), name, cal: Math.round(cal), prot: Number(prot.toFixed(1)), cat, ico: cat === 'drinks' ? '🥤' : cat === 'meals' ? '🍽️' : '🥩', custom: true });
    }
    ['inputCustomName', 'inputCustomCal', 'inputCustomProt'].forEach((id) => ($(id).value = ''));
    $('customFoodDrawer').classList.remove('open');
    persist(); renderAll();
    showToast(`Logged ${name} to ${activeMeal}`);
  });

  $('mealTimeline').addEventListener('click', (e) => {
    const day = ensureDay(selectedDate);
    const dup = e.target.closest('[data-dup-id]'), del = e.target.closest('[data-del-id]');
    if (dup) {
      const o = day.foods.find((f) => f.id === dup.dataset.dupId); if (!o) return;
      day.foods.push({ ...o, id: 'food_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) });
      persist(); renderAll();
      const r = dup.getBoundingClientRect();
      pop(r.left + r.width / 2, r.top, o.prot > 0 ? `+${o.prot} g` : `+${o.cal} kcal`);
    } else if (del) {
      const fid = del.dataset.delId, idx = day.foods.findIndex((f) => f.id === fid);
      if (idx === -1) return;
      const removed = day.foods[idx];
      const row = $('log_row_' + fid); if (row) row.classList.add('removing');
      setTimeout(() => {
        day.foods.splice(idx, 1); persist(); renderAll();
        showToast(`Removed ${removed.name}`, () => { day.foods.splice(idx, 0, removed); persist(); renderAll(); });
      }, 180);
    }
  });
  $('btnRestorePantry').addEventListener('click', () => {
    store.pantry = [...DEFAULT_PANTRY]; persist(); renderFood();
    showToast('Quick-add tiles reset');
  });

  $('weightRangeTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-days]'); if (!b) return;
    weightWindowDays = Number(b.dataset.days);
    $('weightRangeTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    renderWeight();
  });
  $('btnWeightMinus').addEventListener('click', () => { const v = parseFloat($('inputWeighinKg').value) || 70; $('inputWeighinKg').value = Math.max(30, v - .1).toFixed(1); });
  $('btnWeightPlus').addEventListener('click', () => { const v = parseFloat($('inputWeighinKg').value) || 70; $('inputWeighinKg').value = Math.min(250, v + .1).toFixed(1); });
  $('weighinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseFloat($('inputWeighinKg').value);
    if (isNaN(v) || v < 30 || v > 250) return;
    store.weights[selectedDate] = Number(v.toFixed(1));
    persist(); renderWeight();
    showToast(`Saved ${v.toFixed(1)} kg for ${shortDate(selectedDate)}`);
  });
  $('btnClearSampleWeight').addEventListener('click', () => {
    store.weights = {}; store.hasSampleWeight = false; persist(); renderWeight();
    showToast('Sample weights cleared');
  });

  const hud = $('weightHud');
  $('weightCanvasBox').addEventListener('pointermove', (e) => {
    if (!nodes.length) return;
    const mx = e.clientX - $('weightCanvasBox').getBoundingClientRect().left;
    const n = nodes.reduce((a, b) => Math.abs(b.x - mx) < Math.abs(a.x - mx) ? b : a);
    hud.innerHTML = `<div style="font-weight:700">${fromDateKey(n.dateKey).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
      <div>Scale ${n.raw.toFixed(1)} kg</div><div style="opacity:.7">Week avg ${n.avg7.toFixed(1)} kg</div>`;
    hud.style.left = Math.min(innerWidth - 160, e.clientX + 14) + 'px';
    hud.style.top = Math.max(12, e.clientY - 70) + 'px';
    hud.classList.add('visible');
  });
  $('weightCanvasBox').addEventListener('pointerleave', () => hud.classList.remove('visible'));

  function setWater(ml, btn) {
    const day = ensureDay(selectedDate);
    const before = day.waterMl || 0;
    day.waterMl = Math.max(0, ml);
    persist(); renderAll();
    const diff = day.waterMl - before;
    if (diff > 0 && btn) { const r = btn.getBoundingClientRect(); pop(r.left + r.width / 2, r.top, `+${diff} ml`, 'water'); }
  }
  $('btnWater250').addEventListener('click', (e) => setWater((ensureDay(selectedDate).waterMl || 0) + 250, e.currentTarget));
  $('btnWater500').addEventListener('click', (e) => setWater((ensureDay(selectedDate).waterMl || 0) + 500, e.currentTarget));
  $('btnWaterUndo').addEventListener('click', () => setWater((ensureDay(selectedDate).waterMl || 0) - 250));
  $('glassGrid').addEventListener('click', (e) => {
    const g = e.target.closest('[data-glass]'); if (!g) return;
    const n = Number(g.dataset.glass);
    const cur = Math.floor((ensureDay(selectedDate).waterMl || 0) / 250);
    setWater(n === cur ? (n - 1) * 250 : n * 250, g); // tap the last full glass to empty it
  });

  function toggleHabit(el) {
    const day = ensureDay(selectedDate), id = el.dataset.ritualId, list = day.doneRituals || [];
    day.doneRituals = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    persist(); renderAll();
  }
  $('ritualList').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del-ritual]');
    if (del) {
      e.stopPropagation();
      const rid = del.dataset.delRitual, idx = store.rituals.findIndex((r) => r.id === rid);
      const removed = store.rituals[idx];
      store.rituals.splice(idx, 1); persist(); renderAll();
      showToast(`Deleted “${removed.label}”`, () => { store.rituals.splice(idx, 0, removed); persist(); renderAll(); });
      return;
    }
    const item = e.target.closest('[data-ritual-id]'); if (item) toggleHabit(item);
  });
  $('ritualList').addEventListener('keydown', (e) => {
    const item = e.target.closest('[data-ritual-id]');
    if (item && e.target === item && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleHabit(item); }
  });
  $('addRitualForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const label = $('inputNewRitual').value.trim(); if (!label) return;
    store.rituals.push({ id: 'r_' + Date.now(), label });
    $('inputNewRitual').value = ''; persist(); renderAll();
  });
  $('consistencyMatrix').addEventListener('click', (e) => {
    const c = e.target.closest('[data-matrix-date]'); if (c) goTo(c.dataset.matrixDate);
  });

  let noteTimer = null;
  $('scratchpadTextarea').addEventListener('input', () => {
    $('scratchpadSavedBadge').textContent = 'Saving…';
    clearTimeout(noteTimer);
    const dk = selectedDate;
    noteTimer = setTimeout(() => {
      ensureDay(dk).note = $('scratchpadTextarea').value; persist();
      $('scratchpadSavedBadge').textContent = 'Saved';
    }, 300);
  });

  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.view === 'train') return train.setView('train');
    if (train.view === 'train') train.setView('today');
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    $(b.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  $('btnViewToggle').addEventListener('click', () => train.setView(train.view === 'train' ? 'today' : 'train'));
  $('btnMobileQuickAdd').addEventListener('click', () => {
    if (train.view === 'train') train.setView('today');
    $('sectionFuel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('customFoodDrawer').classList.add('open');
    setTimeout(() => $('inputCustomName').focus(), 350);
  });

  const openSheet = (id) => $(id).classList.add('open');
  const closeSheet = (id) => $(id).classList.remove('open');
  $('btnOpenSettings').addEventListener('click', () => {
    $('setProtein').value = store.targets.protein; $('setCalories').value = store.targets.calories;
    $('setWater').value = store.targets.waterMl; $('setGoalWeight').value = store.targets.goalWeight;
    openSheet('settingsModal');
  });
  $('btnCloseSettings').addEventListener('click', () => closeSheet('settingsModal'));
  $('btnOpenInstall').addEventListener('click', () => openSheet('installModal'));
  $('btnCloseInstall').addEventListener('click', () => closeSheet('installModal'));
  ['settingsModal', 'installModal'].forEach((id) => $(id).addEventListener('click', (e) => { if (e.target.id === id) closeSheet(id); }));

  $('settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    store.targets.protein = Math.max(30, Number($('setProtein').value) || 110);
    store.targets.calories = Math.max(800, Number($('setCalories').value) || 1800);
    store.targets.waterMl = Math.max(500, Number($('setWater').value) || 3000);
    store.targets.goalWeight = Math.max(35, Number($('setGoalWeight').value) || 66);
    persist(); closeSheet('settingsModal'); renderAll();
    showToast('Goals saved');
  });
  $('btnExportJson').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(toBackup(store), null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `pulsedaily_backup_${TODAY_KEY}.json` });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    showToast('Backup exported');
  });
  $('btnImportJson').addEventListener('click', () => $('fileImportJson').click());
  $('fileImportJson').addEventListener('change', (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.targets || !data.days) throw new Error('bad');
        Object.assign(store, fromBackup(data, store)); persist(); applyTheme(store.theme || 'light');
        renderAll(); closeSheet('settingsModal'); showToast('Backup restored');
      } catch (err) { showToast("That file isn't a PulseDaily backup"); }
      $('fileImportJson').value = '';
    };
    reader.readAsText(file);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSheet('settingsModal'); closeSheet('installModal'); }
    else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goTo(shiftDateKey(selectedDate, -1)); }
    else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goTo(shiftDateKey(selectedDate, 1)); }
  });
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(renderWeight, 80); });
  if (document.fonts?.ready) document.fonts.ready.then(renderWeight);

  applyTheme(store.theme);
  let ai = null;
  train = initTrain({
    store, persist, showToast, celebrate, pop, ensureDay, esc, fmt, $,
    toDateKey, fromDateKey, shiftDateKey, TODAY_KEY, renderAll,
    aiPlan: () => ai.planWorkout(),
  });

  // Log confirmed AI food items into the chosen meal, with undo.
  function addFoods(items, meal) {
    const day = ensureDay(selectedDate), stamp = Date.now();
    const added = items.map((it, i) => ({ id: `food_${stamp}_${i}_${Math.random().toString(36).slice(2, 5)}`, name: it.name, cal: it.cal, prot: it.prot, meal, cat: it.prot * 4 >= it.cal * 0.3 ? 'protein' : 'meals' }));
    day.foods.push(...added);
    persist(); renderAll();
    const p = added.reduce((a, f) => a + f.prot, 0);
    showToast(`Logged to ${meal} · +${Math.round(p)} g protein`, () => {
      const ids = new Set(added.map((f) => f.id));
      day.foods = day.foods.filter((f) => !ids.has(f.id)); persist(); renderAll();
    });
  }
  ai = initAI({
    store, persist, showToast, esc, fmt, $, toDateKey, shiftDateKey, TODAY_KEY,
    getActiveMeal: () => activeMeal,
    addFoods,
    startPlanned: (plan) => { train.setView('train'); train.startPlanned(plan); },
    closeGoals: () => closeSheet('settingsModal'),
  });
  renderAll();

  // Hide the install button once running as an installed app.
  initPwa({ onStandalone: () => { $('btnOpenInstall').style.display = 'none'; } });
  requestPersistence();
  $('appVersion').textContent = `Version ${APP_VERSION}${BUILD_TIME ? ` · built ${new Date(BUILD_TIME).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}`;
})();
