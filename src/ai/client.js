// OpenRouter client, called straight from the browser with the key saved on this device.
// Free models only (pricing 0 for prompt and completion).

const API = 'https://openrouter.ai/api/v1';
const MODELS_CACHE_KEY = 'pulsedaily_models_cache_v1'; // device-only, not part of the app store
const MODELS_TTL = 12 * 3600 * 1000;

// Defaults chosen from OpenRouter's live list (Nov 2026). Both free, both read images.
export const DEFAULT_TEXT_MODEL = 'google/gemma-4-31b-it:free';
export const DEFAULT_VISION_MODEL = 'nvidia/nemotron-3.5-super-vl:free';
export const FALLBACK_ROUTER = 'openrouter/free';

export class AIError extends Error {
  constructor(kind, message, detail) { super(message); this.kind = kind; this.detail = detail; }
}

// Plain-language errors for every failure the user can hit.
function errorFor(status, body) {
  const raw = String(body?.error?.message || '');
  const meta = JSON.stringify(body?.error?.metadata || '');
  if (status === 401) return new AIError('key', "That key didn't work. Check it in Goals → AI and paste it again.");
  if (status === 402) return new AIError('credits', 'Your OpenRouter balance is below zero, so even free models are blocked. Check openrouter.ai/credits.');
  if (status === 429) return new AIError('rate', "You've hit the free-model limit (20 a minute, 50 a day without credits). Wait a minute, or try again tomorrow.");
  if (status === 404 && /data policy|privacy|No endpoints/i.test(raw + meta)) return new AIError('privacy', 'No free provider matches your OpenRouter privacy settings. Allow free endpoints at openrouter.ai/settings/privacy, or pick another model.');
  if (status === 404) return new AIError('model', "That model isn't available any more. Pick another free model in Goals → AI.");
  if (status === 403) return new AIError('blocked', 'The request was blocked by a safety filter. Try rewording it.');
  if (status === 400 && /image|vision|modalit/i.test(raw)) return new AIError('model', "This model can't read photos. Pick a vision model in Goals → AI.");
  if (status === 400) return new AIError('bad', `The model rejected the request${raw ? `: ${raw.slice(0, 140)}` : ''}.`);
  if (status === 408 || status === 502 || status === 503 || status >= 500) return new AIError('down', 'The free model is busy or down right now. Try again in a moment, or pick another model.');
  return new AIError('unknown', `Something went wrong (${status}). Try again.`);
}

async function request(path, { key, method = 'GET', body, timeout = 60000, signal } = {}) {
  if (!navigator.onLine) throw new AIError('offline', "You're offline. AI needs internet; everything else keeps working.");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('timeout'), timeout);
  signal?.addEventListener('abort', () => ctrl.abort('cancel'));
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        'HTTP-Referer': location.origin,
        'X-Title': 'PulseDaily',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    if (ctrl.signal.reason === 'cancel') throw new AIError('cancel', 'Cancelled');
    if (ctrl.signal.reason === 'timeout') throw new AIError('down', 'The model took too long to answer. Try again, or pick a faster model.');
    throw new AIError(navigator.onLine ? 'network' : 'offline', navigator.onLine ? "Couldn't reach OpenRouter. Check your connection and try again." : "You're offline. AI needs internet; everything else keeps working.");
  } finally { clearTimeout(timer); }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw errorFor(res.status, data);
  // OpenRouter can return 200 with an error object when the upstream provider fails.
  if (data?.error) throw errorFor(Number(data.error.code) || 502, data);
  return data;
}

/* ---------- Key and models ---------- */
export async function testKey(key) {
  if (!key) throw new AIError('nokey', 'Paste your OpenRouter key first.');
  const d = (await request('/key', { key, timeout: 15000 })).data || {};
  return { label: d.label, free: d.free_model_daily_requests || null, isFreeTier: d.is_free_tier };
}

const isFree = (m) => Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0 && !Number(m.pricing?.request || 0);
const outputsText = (m) => (m.architecture?.output_modalities || ['text']).includes('text') && !(m.architecture?.output_modalities || []).includes('audio');

export function cachedModels() {
  try { const c = JSON.parse(localStorage.getItem(MODELS_CACHE_KEY) || 'null'); return c?.models || null; } catch { return null; }
}

// Live free-model list from OpenRouter (no key needed); cached on the device.
export async function freeModels({ force = false } = {}) {
  try {
    const c = JSON.parse(localStorage.getItem(MODELS_CACHE_KEY) || 'null');
    if (!force && c && Date.now() - c.at < MODELS_TTL) return c.models;
  } catch {}
  const d = await request('/models', { timeout: 20000 });
  const models = (d.data || []).filter((m) => isFree(m) && outputsText(m)).map((m) => ({
    id: m.id,
    name: m.name || m.id,
    vision: (m.architecture?.input_modalities || []).includes('image'),
    schema: (m.supported_parameters || []).includes('structured_outputs'),
    json: (m.supported_parameters || []).includes('response_format'),
    ctx: m.context_length || 0,
  })).sort((a, b) => a.name.localeCompare(b.name));
  if (!models.some((m) => m.id === FALLBACK_ROUTER)) models.push({ id: FALLBACK_ROUTER, name: 'Free models router (auto)', vision: true, schema: true, json: true, ctx: 0 });
  try { localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify({ at: Date.now(), models })); } catch {}
  return models;
}

// Known capabilities of the defaults, used until the live list has been fetched once.
const BUILT_IN = {
  [DEFAULT_TEXT_MODEL]: { id: DEFAULT_TEXT_MODEL, vision: true, schema: false, json: true },
  [DEFAULT_VISION_MODEL]: { id: DEFAULT_VISION_MODEL, vision: true, schema: true, json: true },
  [FALLBACK_ROUTER]: { id: FALLBACK_ROUTER, vision: true, schema: true, json: true },
};
function modelInfo(id) {
  return (cachedModels() || []).find((m) => m.id === id) || BUILT_IN[id] || null;
}

/* ---------- Chat completions ---------- */
function stripToJson(text) {
  let t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/[[{]/), end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

/**
 * Ask a model. With `schema`, requests JSON (strict schema when the model supports it,
 * plain JSON mode otherwise), parses it, and runs `validate` on the result.
 */
export async function chat({ key, model, messages, schema, schemaName = 'result', validate, fallback = true, temperature = 0.3, maxTokens = 1500, timeout, signal }) {
  if (!key) throw new AIError('nokey', 'Add your OpenRouter key in Goals → AI first.');
  const info = modelInfo(model);
  const body = { model, messages, temperature, max_tokens: maxTokens };
  if (fallback && model !== FALLBACK_ROUTER) { body.models = [model, FALLBACK_ROUTER]; delete body.model; }
  if (schema) {
    body.response_format = info && !info.schema
      ? { type: 'json_object' }
      : { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } };
  }
  const d = await request('/chat/completions', { key, method: 'POST', body, timeout, signal });
  const text = d.choices?.[0]?.message?.content;
  const usedModel = d.model || model;
  if (!text) throw new AIError('empty', 'The model sent back an empty answer. Try again.');
  if (!schema) return { text: String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').trim(), model: usedModel };
  let parsed;
  try { parsed = stripToJson(text); } catch { throw new AIError('shape', "The AI's answer came back garbled. Try again, or pick another model."); }
  try { return { data: validate ? validate(parsed) : parsed, model: usedModel }; }
  catch (e) { throw new AIError('shape', e.message || "The AI's answer was missing details. Try again."); }
}

/* ---------- Photos ---------- */
// Downscale to ~1024 px on the longest side, re-encode as JPEG. Nothing is stored.
export async function resizeImage(file, max = 1024, quality = 0.82) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    src = await new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new AIError('photo', "Couldn't read that photo. Try another one.")); };
      img.src = url;
    });
  }
  const w = src.width, h = src.height, s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  src.close?.();
  return c.toDataURL('image/jpeg', quality);
}
