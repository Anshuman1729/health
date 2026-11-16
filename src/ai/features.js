// AI features: settings, food logging from text or photo, workout planning, coach chat.
// Every result is an editable preview the user confirms. Nothing is logged automatically.
import * as C from './client.js';
import { makeContext } from './context.js';

const ICON = {
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
};

const CHAT_CAP = 40;          // messages kept on the device
const CHAT_CONTEXT = 12;      // recent messages sent with each question

const FOOD_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items', 'notes'],
  properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'portion', 'protein_g', 'kcal'],
      properties: { name: { type: 'string' }, portion: { type: 'string' }, protein_g: { type: 'number' }, kcal: { type: 'number' } } } },
    notes: { type: 'string' },
  },
};
const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['routine_name', 'reasoning', 'exercises'],
  properties: {
    routine_name: { type: 'string' }, reasoning: { type: 'string' },
    exercises: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['exercise_id', 'sets', 'reps', 'kg'],
      properties: { exercise_id: { type: 'string' }, sets: { type: 'integer' }, reps: { type: 'integer' }, kg: { type: 'number' } } } },
  },
};
const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'went_well', 'watch', 'actions'],
  properties: {
    summary: { type: 'string' },
    went_well: { type: 'array', items: { type: 'string' } },
    watch: { type: 'array', items: { type: 'string' } },
    actions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'detail'], properties: { title: { type: 'string' }, detail: { type: 'string' } } } },
  },
};

const FOOD_RULES = `You estimate nutrition for a personal food log. The user mostly eats Indian home food.
Rules:
- One item per distinct food or dish. Use the quantity the user gives; if none, assume one typical home portion.
- Know Indian dishes and household measures: 1 roti/chapati (about 40 g cooked) ≈ 110 kcal, 3 g protein; 1 phulka ≈ 75 kcal; 1 katori ≈ 150 ml; dal tadka 1 katori ≈ 170 kcal, 8 g protein; rajma or chole 1 katori ≈ 200 kcal, 9 g protein; paneer 100 g ≈ 265 kcal, 18 g protein; paneer bhurji 150 g ≈ 300 kcal, 20 g protein; cooked rice 1 cup ≈ 200 kcal, 4 g protein; 1 egg ≈ 70 kcal, 6 g protein; curd 1 katori ≈ 90 kcal, 5 g protein; 1 tsp ghee or oil ≈ 45 kcal.
- Include the cooking oil or ghee a home cook would normally use in the dish's numbers.
- Round protein_g to the nearest 0.5 and kcal to the nearest 5.
- portion: a short human description like "2 rotis" or "1 katori" or "150 g".
- notes: one short sentence with your main assumptions.
- If there is no food, return an empty items array.
Reply with JSON only: {"items":[{"name":"","portion":"","protein_g":0,"kcal":0}],"notes":""}`;

export function initAI(ctx) {
  const { store, persist, showToast, esc, fmt, $ } = ctx;
  const X = makeContext(ctx);
  const A = () => {
    if (!store.ai) store.ai = { key: '', textModel: C.DEFAULT_TEXT_MODEL, visionModel: C.DEFAULT_VISION_MODEL, fallback: true, chat: [] };
    return store.ai;
  };

  const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const half = (v) => Math.round(v * 2) / 2;
  const shortModel = (id) => (id || '').split('/').pop().replace(/:free$/, '');
  const hasKey = () => !!A().key;

  /* ---------- Sheets ---------- */
  const sheet = $('aiSheet'), body = $('aiSheetBody');
  let sheetCtx = null, inflight = null;
  const head = (title, sub = '') => `
    <div class="sheet-head">
      <div><h3 class="sheet-title">${esc(title)}</h3>${sub ? `<div class="card-meta">${sub}</div>` : ''}</div>
      <button type="button" class="icon-btn" data-act="close" aria-label="Close">✕</button>
    </div>`;
  function openSheet(html, c) { sheetCtx = c; body.innerHTML = html; sheet.classList.add('open'); body.scrollTop = 0; }
  function closeSheet() { sheet.classList.remove('open'); sheetCtx = null; inflight?.abort(); inflight = null; }
  function loading(title, sub) {
    openSheet(`${head(title, sub)}<div class="ai-wait"><span class="spinner" aria-hidden="true"></span><span>Thinking. Free models can take 5 to 30 seconds.</span></div>
      <button type="button" class="soft-btn" data-act="close">Cancel</button>`, { type: 'loading' });
  }
  function showError(e, retry) {
    if (e?.kind === 'cancel') return;
    const needsSettings = ['nokey', 'key', 'model', 'privacy'].includes(e?.kind);
    openSheet(`${head("That didn't work")}
      <div class="ai-error">${esc(e?.message || 'Something went wrong. Try again.')}</div>
      <div class="sheet-foot">
        ${needsSettings ? '<button type="button" class="text-btn" data-act="open-settings">Open AI settings</button>' : '<span></span>'}
        ${retry ? '<button type="button" class="primary-btn violet" data-act="retry">Try again</button>' : '<button type="button" class="primary-btn" data-act="close">OK</button>'}
      </div>`, { type: 'error', retry });
  }
  function needKey() {
    if (hasKey()) return false;
    showError(new C.AIError('nokey', 'Add your free OpenRouter key in Goals → AI first. It stays on this device.'));
    return true;
  }

  /* ---------- Settings → AI ---------- */
  let modelList = C.cachedModels();
  function renderSettings(status = '') {
    const a = A();
    const all = modelList || [];
    const opts = (list, sel, suggested) => {
      const ids = new Set(list.map((m) => m.id));
      const extra = ids.has(sel) ? [] : [{ id: sel, name: shortModel(sel) + ' (saved)' }];
      return [...extra, ...list].map((m) => `<option value="${esc(m.id)}" ${m.id === sel ? 'selected' : ''}>${esc(m.name)}${m.id === suggested ? ' · suggested' : ''}</option>`).join('');
    };
    const textList = all.length ? all : [{ id: C.DEFAULT_TEXT_MODEL, name: 'Gemma 4 31B (free)' }];
    const visionList = all.length ? all.filter((m) => m.vision) : [{ id: C.DEFAULT_VISION_MODEL, name: 'Nemotron 3.5 Super VL (free)' }];
    openSheet(`${head('AI', 'Free OpenRouter models only. Called straight from this phone.')}
      <form data-form="ai-settings" class="ai-form" autocomplete="off">
        <div class="input-group">
          <label for="aiKey">OpenRouter API key</label>
          <div class="key-row">
            <input type="password" class="field" id="aiKey" name="key" value="${esc(a.key)}" placeholder="sk-or-v1-…" autocomplete="off" autocapitalize="off" spellcheck="false" />
            <button type="button" class="soft-btn" data-act="toggle-key">Show</button>
          </div>
          <div class="card-meta">Saved only on this device. Never included in backups. Get a free key at openrouter.ai/keys.</div>
        </div>
        <div class="key-actions">
          <button type="button" class="soft-btn" data-act="test-key">Test connection</button>
          ${a.key ? '<button type="button" class="text-btn danger-text" data-act="remove-key">Remove key</button>' : ''}
        </div>
        <div class="ai-status" id="aiStatus" role="status">${status}</div>
        <div class="sheet-section">
          <h4>Models</h4>
          <div class="input-group"><label for="aiText">Text: food descriptions, plans, coach</label>
            <select class="field" id="aiText" name="textModel">${opts(textList, a.textModel, C.DEFAULT_TEXT_MODEL)}</select></div>
          <div class="input-group"><label for="aiVision">Vision: meal photos</label>
            <select class="field" id="aiVision" name="visionModel">${opts(visionList, a.visionModel, C.DEFAULT_VISION_MODEL)}</select></div>
          <label class="toggle-line"><input type="checkbox" name="fallback" ${a.fallback ? 'checked' : ''} /> If a model is busy, let OpenRouter try another free model</label>
          <div class="card-meta">${all.length ? `${all.length} free models available.` : 'Model list not loaded yet.'} <button type="button" class="text-btn inline" data-act="refresh-models">Refresh list</button></div>
          <div class="card-meta">Free models allow about 50 requests a day. Some free providers may keep prompts to improve their models; you can control this at openrouter.ai/settings/privacy.</div>
        </div>
        <button type="submit" class="primary-btn violet big">Save</button>
      </form>`, { type: 'settings' });
    if (!modelList && navigator.onLine) refreshModels(false);
  }
  async function refreshModels(force) {
    try {
      modelList = await C.freeModels({ force });
      if (sheetCtx?.type === 'settings') {
        const keep = readSettingsForm();
        renderSettings(force ? `Found ${modelList.length} free models.` : '');
        if (keep) { $('aiKey').value = keep.key; }
      }
    } catch (e) { const s = $('aiStatus'); if (s) s.innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
  }
  function readSettingsForm() {
    const f = body.querySelector('[data-form="ai-settings"]'); if (!f) return null;
    const fd = new FormData(f);
    return { key: String(fd.get('key') || '').trim(), textModel: fd.get('textModel'), visionModel: fd.get('visionModel'), fallback: fd.get('fallback') === 'on' };
  }
  async function testConnection() {
    const s = $('aiStatus'), v = readSettingsForm();
    s.innerHTML = '<span class="spinner sm" aria-hidden="true"></span> Checking…';
    try {
      const r = await C.testKey(v.key);
      const free = r.free ? ` ${r.free.remaining} of ${r.free.limit} free requests left today.` : '';
      s.innerHTML = `<span class="good">Connected.${esc(free)}</span>`;
      A().key = v.key; persist(); renderStatusLine();
    } catch (e) { s.innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
  }

  function renderStatusLine() {
    const el = $('aiStatusLine'); if (!el) return;
    el.textContent = hasKey() ? `Key saved on this device · ${shortModel(A().textModel)}` : 'Not set up. Add a free OpenRouter key to use AI.';
  }

  /* ---------- Food: text or photo → editable preview ---------- */
  function validateFood(d) {
    const items = Array.isArray(d?.items) ? d.items : Array.isArray(d) ? d : null;
    if (!items) throw new Error("The AI's answer was missing the food list. Try again.");
    const out = items.slice(0, 20).map((it) => {
      const name = String(it?.name || '').trim().slice(0, 70);
      const portion = String(it?.portion || '').trim().slice(0, 40);
      const label = portion && !name.toLowerCase().includes(portion.toLowerCase()) ? `${name} (${portion})` : name;
      return { name: label, prot: half(clamp(num(it?.protein_g ?? it?.protein), 0, 300)), cal: Math.round(clamp(num(it?.kcal ?? it?.calories), 0, 5000)) };
    }).filter((it) => it.name);
    if (!out.length) throw new Error("The AI couldn't spot any food in that. Try describing it differently.");
    return { items: out, notes: String(d?.notes || '').slice(0, 300) };
  }

  async function estimateFromText(text) {
    if (needKey()) return;
    text = text.trim(); if (!text) { showToast('Describe what you ate first'); return; }
    const a = A();
    loading('Estimating', esc(text));
    inflight = new AbortController();
    const run = async () => {
      try {
        const r = await C.chat({ key: a.key, model: a.textModel, fallback: a.fallback, signal: inflight?.signal, schema: FOOD_SCHEMA, schemaName: 'food_log', validate: validateFood,
          messages: [{ role: 'system', content: FOOD_RULES }, { role: 'user', content: `What I ate: ${text}` }] });
        foodPreview(r.data, r.model, null);
      } catch (e) { showError(e, () => estimateFromText(text)); }
    };
    await run();
  }

  async function estimateFromPhoto(file) {
    if (needKey()) return;
    const a = A(), hint = $('inputAiFood').value.trim();
    loading('Reading your photo', 'Resized on this phone before sending. Not stored.');
    inflight = new AbortController();
    let dataUrl;
    try { dataUrl = await C.resizeImage(file); } catch (e) { return showError(e); }
    try {
      const r = await C.chat({ key: a.key, model: a.visionModel, fallback: a.fallback, signal: inflight?.signal, schema: FOOD_SCHEMA, schemaName: 'food_log', validate: validateFood, timeout: 90000,
        messages: [{ role: 'system', content: FOOD_RULES + '\nYou are given a photo of a meal. Identify each food and estimate its portion from the plate, bowl and cutlery sizes.' },
          { role: 'user', content: [{ type: 'text', text: hint ? `Meal photo. Extra details from me: ${hint}` : 'Meal photo. Estimate each item.' }, { type: 'image_url', image_url: { url: dataUrl } }] }] });
      foodPreview(r.data, r.model, dataUrl);
    } catch (e) { showError(e, () => estimateFromPhoto(file)); }
  }

  const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
  function foodPreview(data, model, photo) {
    const draft = { items: data.items.map((x) => ({ ...x })), notes: data.notes, meal: ctx.getActiveMeal(), model, photo };
    renderFoodPreview(draft);
  }
  function foodTotalsText(d) {
    const p = d.items.reduce((a, x) => a + num(x.prot), 0), k = d.items.reduce((a, x) => a + num(x.cal), 0);
    return `<b>${half(p)} g</b> protein · <b>${fmt(k)}</b> kcal`;
  }
  function renderFoodPreview(d) {
    openSheet(`${head('Check before logging', `Estimates by ${esc(shortModel(d.model))}. Edit anything that looks off.`)}
      ${d.photo ? `<img class="ai-thumb" src="${d.photo}" alt="Your meal photo" />` : ''}
      <div class="seg-ctl" role="group" aria-label="Meal">${MEALS.map((m) => `<button type="button" data-act="meal" data-meal="${m}" class="${m === d.meal ? 'active' : ''}">${m}</button>`).join('')}</div>
      <div class="ai-items">
        ${d.items.map((it, i) => `
          <div class="ai-item">
            <div class="ai-line">
              <input class="field" data-f="name" data-i="${i}" value="${esc(it.name)}" placeholder="Food" aria-label="Food name" />
              <button type="button" class="mini-btn del" data-act="item-remove" data-i="${i}" aria-label="Remove ${esc(it.name)}">✕</button>
            </div>
            <div class="ai-nums">
              <label class="unit-in"><input class="num" inputmode="decimal" data-f="prot" data-i="${i}" value="${it.prot}" /><span>g protein</span></label>
              <label class="unit-in"><input class="num" inputmode="numeric" data-f="cal" data-i="${i}" value="${it.cal}" /><span>kcal</span></label>
            </div>
          </div>`).join('')}
      </div>
      <button type="button" class="soft-btn" data-act="item-add">+ Add item</button>
      <div class="ai-total" id="aiFoodTotal">${foodTotalsText(d)}</div>
      ${d.notes ? `<div class="install-step">${esc(d.notes)}</div>` : ''}
      <div class="sheet-foot">
        <button type="button" class="text-btn" data-act="close">Cancel</button>
        <button type="button" class="primary-btn violet" data-act="food-log" ${d.items.length ? '' : 'disabled'}>Log ${d.items.length} item${d.items.length === 1 ? '' : 's'} to ${d.meal}</button>
      </div>`, { type: 'food', draft: d });
  }

  /* ---------- Plan my next workout ---------- */
  function validatePlan(d) {
    const ex = store.training.exercises;
    const byId = new Map(ex.map((e) => [e.id, e]));
    const byName = new Map(ex.map((e) => [e.name.toLowerCase(), e]));
    const items = (Array.isArray(d?.exercises) ? d.exercises : []).map((x) => {
      const e = byId.get(String(x?.exercise_id)) || byName.get(String(x?.exercise_id || x?.name || '').toLowerCase());
      if (!e) return null;
      return { exId: e.id, sets: clamp(Math.round(num(x.sets)) || 3, 1, 10), reps: clamp(Math.round(num(x.reps)) || 8, 1, 50), kg: half(clamp(num(x.kg), 0, 500)) };
    }).filter(Boolean).slice(0, 10);
    if (!items.length) throw new Error("The plan didn't use exercises from your library. Try again.");
    return { name: String(d?.routine_name || 'AI plan').slice(0, 40), reasoning: String(d?.reasoning || '').slice(0, 500), items };
  }
  async function planWorkout() {
    if (needKey()) return;
    if (store.training.active) { showToast('Finish or discard the current workout first'); return; }
    const a = A();
    loading('Planning your next workout', 'Using your last 14 days of training, sleep and protein.');
    inflight = new AbortController();
    try {
      const r = await C.chat({ key: a.key, model: a.textModel, fallback: a.fallback, signal: inflight?.signal, schema: PLAN_SCHEMA, schemaName: 'workout_plan', validate: validatePlan, maxTokens: 1200,
        messages: [
          { role: 'system', content: `You are a practical strength coach planning the user's gym session for today.
Rules:
- Use only exercise_id values from the library below. 4 to 6 exercises.
- Follow the routine rotation unless recovery says otherwise. Don't load a muscle group hard if it was trained in the last 48 hours.
- Progressive overload: if all target reps were hit last time, add 2.5 kg on upper-body lifts or 5 kg on lower-body lifts; otherwise repeat the weight. kg 0 for bodyweight.
- If sleep or protein has been poor, keep volume moderate and say so.
- reasoning: 2 or 3 short plain sentences addressed to the user.
Reply with JSON only: {"routine_name":"","reasoning":"","exercises":[{"exercise_id":"","sets":3,"reps":8,"kg":0}]}

Library (id | name | muscle | equipment):
${X.libraryLines()}` },
          { role: 'user', content: X.planBundle() },
        ] });
      renderPlan({ ...r.data, model: r.model });
    } catch (e) { showError(e, planWorkout); }
  }
  function renderPlan(p) {
    const ex = (id) => store.training.exercises.find((e) => e.id === id);
    openSheet(`${head('Your next workout', `Planned by ${esc(shortModel(p.model))}. Adjust anything, then start.`)}
      ${p.reasoning ? `<div class="install-step">${esc(p.reasoning)}</div>` : ''}
      <input type="text" class="field" data-f="plan-name" value="${esc(p.name)}" aria-label="Workout name" />
      <div class="ai-items">
        ${p.items.map((it, i) => `
          <div class="ai-item">
            <div class="ai-line">
              <span class="plan-name">${esc(ex(it.exId)?.name || it.exId)}<small>${esc(ex(it.exId)?.muscle || '')}</small></span>
              <button type="button" class="mini-btn del" data-act="plan-remove" data-i="${i}" aria-label="Remove ${esc(ex(it.exId)?.name || '')}">✕</button>
            </div>
            <div class="ai-nums three">
              <label class="unit-in"><input class="num" inputmode="numeric" data-f="sets" data-i="${i}" value="${it.sets}" /><span>sets</span></label>
              <label class="unit-in"><input class="num" inputmode="numeric" data-f="reps" data-i="${i}" value="${it.reps}" /><span>reps</span></label>
              <label class="unit-in"><input class="num" inputmode="decimal" data-f="kg" data-i="${i}" value="${it.kg}" /><span>kg</span></label>
            </div>
          </div>`).join('')}
      </div>
      <div class="sheet-foot">
        <button type="button" class="text-btn" data-act="close">Cancel</button>
        <button type="button" class="primary-btn violet" data-act="plan-start" ${p.items.length ? '' : 'disabled'}>Start this workout</button>
      </div>`, { type: 'plan', plan: p });
  }

  /* ---------- Coach chat + weekly review ---------- */
  const coach = $('coachSheet'), coachBody = $('coachSheetBody');
  let coachBusy = false;
  function md(text) {
    const lines = esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
    let html = '', list = null;
    for (const raw of lines) {
      const l = raw.trim();
      const m = l.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (m) { const tag = /^\d/.test(l) ? 'ol' : 'ul'; if (list !== tag) { if (list) html += `</${list}>`; html += `<${tag}>`; list = tag; } html += `<li>${m[1]}</li>`; continue; }
      if (list) { html += `</${list}>`; list = null; }
      if (/^#{1,4}\s/.test(l)) html += `<p class="md-h">${l.replace(/^#+\s/, '')}</p>`;
      else if (l) html += `<p>${l}</p>`;
    }
    if (list) html += `</${list}>`;
    return html;
  }
  function renderCoach() {
    const chat = A().chat;
    coachBody.innerHTML = `
      <div class="sheet-head">
        <div><h3 class="sheet-title">Coach</h3><div class="card-meta">Sees your last 14 days. Chat stays on this phone.</div></div>
        <div class="head-actions">
          ${chat.length ? '<button type="button" class="text-btn" data-act="chat-clear">Clear</button>' : ''}
          <button type="button" class="icon-btn" data-act="coach-close" aria-label="Close">✕</button>
        </div>
      </div>
      <div class="chat-list" id="chatList">
        ${chat.length ? chat.map((m) => `<div class="msg ${m.role}${m.review ? ' review' : ''}">${m.role === 'user' ? esc(m.content) : md(m.content)}</div>`).join('') : `
          <div class="chat-empty">Ask about your food, weight, habits or training. Try a weekly review to start.</div>`}
        ${coachBusy ? '<div class="msg assistant typing"><span class="spinner sm" aria-hidden="true"></span> Thinking…</div>' : ''}
      </div>
      <div class="chat-chips">
        <button type="button" class="chip" data-act="weekly-review" ${coachBusy ? 'disabled' : ''}>Weekly review</button>
        <button type="button" class="chip" data-act="chat-suggest" ${coachBusy ? 'disabled' : ''}>How's my protein this week?</button>
        <button type="button" class="chip" data-act="chat-suggest" ${coachBusy ? 'disabled' : ''}>What should I eat for dinner?</button>
      </div>
      <form class="chat-input" data-form="chat" autocomplete="off">
        <textarea class="field" name="q" rows="1" placeholder="Ask your coach" aria-label="Message" ${coachBusy ? 'disabled' : ''}></textarea>
        <button type="submit" class="send-btn" aria-label="Send" ${coachBusy ? 'disabled' : ''}>${ICON.send}</button>
      </form>`;
    const list = $('chatList'); list.scrollTop = list.scrollHeight;
  }
  function openCoach() {
    if (!hasKey()) return renderSettings('<span>Add your free OpenRouter key to start using the coach.</span>');
    renderCoach(); coach.classList.add('open');
  }
  function pushChat(msg) {
    const a = A(); a.chat.push({ ...msg, ts: Date.now() });
    if (a.chat.length > CHAT_CAP) a.chat.splice(0, a.chat.length - CHAT_CAP);
    persist();
  }
  const COACH_SYSTEM = () => `You are a friendly, direct health and strength coach inside the user's personal tracker app.
Use their data below. Be specific with numbers and dates. Keep answers short: a few sentences or a short list. Plain language, no fluff. You are not a doctor; for medical issues suggest seeing one.

USER DATA
${X.coachBundle(14)}`;

  async function sendChat(q) {
    if (needKey()) return;
    q = q.trim(); if (!q || coachBusy) return;
    pushChat({ role: 'user', content: q });
    coachBusy = true; renderCoach();
    const a = A();
    try {
      const history = a.chat.filter((m) => !m.error).slice(-CHAT_CONTEXT).map((m) => ({ role: m.role, content: m.content }));
      const r = await C.chat({ key: a.key, model: a.textModel, fallback: a.fallback, temperature: 0.6, maxTokens: 700, messages: [{ role: 'system', content: COACH_SYSTEM() }, ...history] });
      pushChat({ role: 'assistant', content: r.text });
    } catch (e) {
      if (e.kind !== 'cancel') pushChat({ role: 'assistant', content: e.message, error: true });
    } finally { coachBusy = false; if (coach.classList.contains('open')) renderCoach(); }
  }

  function validateReview(d) {
    const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 4) : []);
    const actions = (Array.isArray(d?.actions) ? d.actions : []).map((x) => ({ title: String(x?.title || x || '').trim(), detail: String(x?.detail || '').trim() })).filter((x) => x.title).slice(0, 3);
    if (!d?.summary || actions.length < 1) throw new Error("The review came back incomplete. Try again.");
    return { summary: String(d.summary).trim(), wins: arr(d.went_well), watch: arr(d.watch), actions };
  }
  async function weeklyReview() {
    if (needKey()) return;
    if (coachBusy) return;
    pushChat({ role: 'user', content: 'Weekly review' });
    coachBusy = true; renderCoach();
    const a = A();
    try {
      const r = await C.chat({ key: a.key, model: a.textModel, fallback: a.fallback, schema: REVIEW_SCHEMA, schemaName: 'weekly_review', validate: validateReview, temperature: 0.4, maxTokens: 900,
        messages: [{ role: 'system', content: `${COACH_SYSTEM()}

TASK
Review the last 7 days (compare with the 7 days before when useful). Reply with JSON only:
{"summary":"2 sentences","went_well":["..."],"watch":["..."],"actions":[{"title":"short imperative","detail":"one sentence, specific numbers"}]}
Give exactly 3 actions. Each must be specific and doable this week, e.g. "Add 25 g protein at breakfast" not "eat more protein".` }, { role: 'user', content: 'Give me my weekly review.' }] });
      const v = r.data;
      const text = [`**Your week.** ${v.summary}`,
        v.wins.length ? `**Went well**\n${v.wins.map((w) => `- ${w}`).join('\n')}` : '',
        v.watch.length ? `**Watch**\n${v.watch.map((w) => `- ${w}`).join('\n')}` : '',
        `**3 actions for this week**\n${v.actions.map((x, i) => `${i + 1}. **${x.title}**${x.detail ? `: ${x.detail}` : ''}`).join('\n')}`].filter(Boolean).join('\n\n');
      pushChat({ role: 'assistant', content: text, review: true });
    } catch (e) {
      if (e.kind !== 'cancel') pushChat({ role: 'assistant', content: e.message, error: true });
    } finally { coachBusy = false; if (coach.classList.contains('open')) renderCoach(); }
  }

  /* ---------- Events ---------- */
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) return closeSheet();
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const c = sheetCtx, i = Number(b.dataset.i);
    switch (b.dataset.act) {
      case 'close': closeSheet(); break;
      case 'retry': { const fn = c?.retry; fn?.(); break; }
      case 'open-settings': renderSettings(); break;
      case 'toggle-key': { const k = $('aiKey'); k.type = k.type === 'password' ? 'text' : 'password'; b.textContent = k.type === 'password' ? 'Show' : 'Hide'; break; }
      case 'test-key': testConnection(); break;
      case 'remove-key': A().key = ''; persist(); renderStatusLine(); renderSettings('<span>Key removed from this device.</span>'); break;
      case 'refresh-models': { const s = $('aiStatus'); s.innerHTML = '<span class="spinner sm" aria-hidden="true"></span> Loading free models…'; refreshModels(true); break; }
      case 'meal': c.draft.meal = b.dataset.meal; renderFoodPreview(c.draft); break;
      case 'item-remove': c.draft.items.splice(i, 1); renderFoodPreview(c.draft); break;
      case 'item-add': c.draft.items.push({ name: '', prot: 0, cal: 0 }); renderFoodPreview(c.draft); body.querySelector(`[data-f="name"][data-i="${c.draft.items.length - 1}"]`)?.focus(); break;
      case 'food-log': {
        const items = c.draft.items.filter((x) => x.name.trim()).map((x) => ({ name: x.name.trim(), prot: half(clamp(num(x.prot), 0, 300)), cal: Math.round(clamp(num(x.cal), 0, 5000)) }));
        if (!items.length) return showToast('Add at least one item');
        closeSheet(); ctx.addFoods(items, c.draft.meal); $('inputAiFood').value = '';
        break;
      }
      case 'plan-remove': c.plan.items.splice(i, 1); renderPlan(c.plan); break;
      case 'plan-start': { const p = c.plan; closeSheet(); ctx.startPlanned({ name: p.name.trim() || 'AI plan', items: p.items }); break; }
    }
  });
  sheet.addEventListener('input', (e) => {
    const el = e.target, f = el.dataset.f, c = sheetCtx; if (!f || !c) return;
    const i = Number(el.dataset.i);
    if (c.type === 'food') {
      c.draft.items[i][f] = f === 'name' ? el.value : el.value;
      $('aiFoodTotal').innerHTML = foodTotalsText(c.draft);
    } else if (c.type === 'plan') {
      if (f === 'plan-name') c.plan.name = el.value;
      else c.plan.items[i][f] = f === 'kg' ? half(clamp(num(el.value), 0, 500)) : clamp(Math.round(num(el.value)) || 1, 1, f === 'sets' ? 10 : 50);
    }
  });
  sheet.addEventListener('submit', (e) => {
    if (e.target.dataset.form !== 'ai-settings') return;
    e.preventDefault();
    const v = readSettingsForm(), a = A();
    Object.assign(a, v); persist(); renderStatusLine(); closeSheet(); showToast('AI settings saved');
  });

  coach.addEventListener('click', (e) => {
    if (e.target === coach) { coach.classList.remove('open'); return; }
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    switch (b.dataset.act) {
      case 'coach-close': coach.classList.remove('open'); break;
      case 'chat-clear': A().chat = []; persist(); renderCoach(); break;
      case 'weekly-review': weeklyReview(); break;
      case 'chat-suggest': sendChat(b.textContent); break;
    }
  });
  coach.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = e.target.querySelector('textarea'); const q = t.value; t.value = ''; sendChat(q);
  });
  coach.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && e.target.name === 'q') { e.preventDefault(); e.target.form.requestSubmit(); }
  });
  coach.addEventListener('input', (e) => { if (e.target.name === 'q') { e.target.style.height = 'auto'; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px'; } });

  $('aiFoodForm').addEventListener('submit', (e) => { e.preventDefault(); estimateFromText($('inputAiFood').value); });
  $('btnAiPhoto').addEventListener('click', () => { if (!needKey()) $('fileAiPhoto').click(); });
  $('fileAiPhoto').addEventListener('change', (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; // keep nothing around
    if (f) estimateFromPhoto(f);
  });
  $('btnOpenAI').addEventListener('click', () => { ctx.closeGoals(); renderSettings(); });
  $('btnOpenCoach').addEventListener('click', openCoach);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (sheet.classList.contains('open')) closeSheet(); else coach.classList.remove('open');
  });

  renderStatusLine();
  // Refresh the free-model list quietly in the background when online.
  if (navigator.onLine && !modelList) C.freeModels().then((m) => { modelList = m; }).catch(() => {});

  return { planWorkout, openCoach, openSettings: renderSettings, renderStatusLine };
}
