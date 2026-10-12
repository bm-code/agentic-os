// Consumo de tokens a partir de los transcripts locales de Claude Code.
// Lectura incremental (solo los bytes nuevos de cada .jsonl) → .local/usage-cache.json
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_HOME, LOCAL_DIR, readJson, writeJson } from './paths.mjs';
import { loadRegistry, resolveProject } from './registry.mjs';

export const CACHE_FILE = path.join(LOCAL_DIR, 'usage-cache.json');
const CACHE_VERSION = 3;

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.jsonl')) yield p;
  }
}

const hourKey = (ts) => ts.slice(0, 13); // 2026-10-12T10 (UTC)

export function modelFamily(model = '') {
  const m = model.toLowerCase();
  for (const f of ['opus', 'sonnet', 'haiku', 'fable']) if (m.includes(f)) return f;
  return m.startsWith('<') || !m ? 'otro' : m;
}

/** Procesa líneas nuevas de un transcript y acumula en `entry` (buckets por hora|cwd|modelo). */
export function ingestLines(entry, lines) {
  const seen = new Set(entry.lastIds || []);
  for (const line of lines) {
    if (!line.includes('"usage"')) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.type !== 'assistant' || !r.message?.usage || !r.timestamp) continue;
    const id = `${r.message.id || ''}:${r.requestId || ''}`;
    if (seen.has(id)) continue; // un mismo mensaje se guarda en varias líneas (una por bloque)
    seen.add(id);
    const sid = r.sessionId || 'unknown';
    const s = (entry.sessions[sid] ||= { cwd: r.cwd || '', first: r.timestamp, last: r.timestamp, sidechain: !!r.isSidechain });
    s.last = r.timestamp;
    const u = r.message.usage;
    // Se agrupa por el directorio donde arrancó la sesión, no por el cd de cada comando.
    const key = `${hourKey(r.timestamp)}|${s.cwd}|${r.message.model || ''}`;
    const b = (entry.buckets[key] ||= { in: 0, out: 0, cr: 0, cc: 0, msgs: 0 });
    b.in += u.input_tokens || 0;
    b.out += u.output_tokens || 0;
    b.cr += u.cache_read_input_tokens || 0;
    b.cc += u.cache_creation_input_tokens || 0;
    b.msgs++;
  }
  entry.lastIds = [...seen].slice(-64);
}

export function refreshUsage({ projectsDir = path.join(CLAUDE_HOME, 'projects'), cacheFile = CACHE_FILE } = {}) {
  let cache = readJson(cacheFile, null);
  if (!cache || cache.version !== CACHE_VERSION) cache = { version: CACHE_VERSION, files: {} };
  const present = new Set();
  for (const file of walk(projectsDir)) {
    present.add(file);
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    let entry = cache.files[file];
    if (!entry || st.size < entry.offset) entry = cache.files[file] = { offset: 0, buckets: {}, sessions: {}, lastIds: [] };
    if (st.size === entry.offset) continue;
    const fd = fs.openSync(file, 'r');
    try {
      const len = st.size - entry.offset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, entry.offset);
      const lastNl = buf.lastIndexOf(10);
      if (lastNl === -1) continue; // aún no hay una línea completa
      ingestLines(entry, buf.subarray(0, lastNl).toString('utf8').split('\n'));
      entry.offset += lastNl + 1;
    } finally {
      fs.closeSync(fd);
    }
  }
  // Los transcripts borrados por Claude Code (limpieza periódica) conservan su histórico en caché.
  for (const f of Object.keys(cache.files)) if (!present.has(f)) cache.files[f].orphan = true;
  cache.updatedAt = new Date().toISOString();
  writeJson(cacheFile, cache);
  return cache;
}

export function loadUsageCache(cacheFile = CACHE_FILE) {
  return readJson(cacheFile, null);
}

export const totalTokens = (b) => b.in + b.out + b.cr + b.cc;

/** Agregados para CLI, statusline y dashboard. Las horas van en UTC; los días en hora local. */
export function aggregate(cache, { days = 30, now = new Date(), registry = loadRegistry() } = {}) {
  const sinceMs = now.getTime() - days * 86400e3;
  const fiveHMs = now.getTime() - 5 * 3600e3;
  const slugCache = new Map();
  const slugOf = (cwd) => {
    if (!slugCache.has(cwd)) slugCache.set(cwd, resolveProject(cwd, { registry })?.slug || (cwd ? `(${path.basename(cwd)})` : '(desconocido)'));
    return slugCache.get(cwd);
  };
  const zero = () => ({ in: 0, out: 0, cr: 0, cc: 0, msgs: 0 });
  const add = (a, b) => {
    a.in += b.in;
    a.out += b.out;
    a.cr += b.cr;
    a.cc += b.cc;
    a.msgs += b.msgs;
  };
  const res = { total: zero(), last5h: zero(), today: zero(), byDay: {}, byProject: {}, byModel: {}, byHour: {}, sessions: [] };
  const todayLocal = new Date(now).toLocaleDateString('sv-SE');

  for (const entry of Object.values(cache?.files || {})) {
    for (const [key, b] of Object.entries(entry.buckets)) {
      const [hour, cwd, model] = key.split('|');
      const t = Date.parse(`${hour}:00:00Z`);
      if (t < sinceMs) continue;
      const day = new Date(t).toLocaleDateString('sv-SE');
      const fam = modelFamily(model);
      const slug = slugOf(cwd);
      add(res.total, b);
      if (t + 3600e3 > fiveHMs) add(res.last5h, b);
      if (day === todayLocal) add(res.today, b);
      add((res.byDay[day] ||= {})[fam] ||= zero(), b);
      add(res.byProject[slug] ||= zero(), b);
      add(res.byModel[fam] ||= zero(), b);
      if (t + 24 * 3600e3 > now.getTime()) add(res.byHour[hour] ||= zero(), b);
    }
    for (const [id, s] of Object.entries(entry.sessions)) {
      if (Date.parse(s.last) < sinceMs || s.sidechain) continue;
      res.sessions.push({ id, project: slugOf(s.cwd), first: s.first, last: s.last });
    }
  }
  // Tokens por sesión (sumando también sus subagentes): se calcula aparte por fichero.
  const perSession = {};
  for (const entry of Object.values(cache?.files || {})) {
    const ids = Object.keys(entry.sessions);
    if (ids.length !== 1) continue;
    const sum = zero();
    for (const [key, b] of Object.entries(entry.buckets)) if (Date.parse(`${key.split('|')[0]}:00:00Z`) >= sinceMs) add(sum, b);
    add((perSession[ids[0]] ||= zero()), sum);
  }
  for (const s of res.sessions) s.tokens = perSession[s.id] ? totalTokens(perSession[s.id]) : 0;
  res.sessions.sort((a, b) => b.last.localeCompare(a.last));
  return res;
}

export function fmtTokens(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}
