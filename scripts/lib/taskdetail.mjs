// Detalle de una tarea: projects/<slug>/tasks/<id>.md (sincronizado entre equipos).
//   ---
//   complexity: M
//   status: idle | estimating | planning | plan-ready | running | review | error
//   branch: aos/k3f9
//   baseBranch: main
//   session: <uuid de la sesión de Claude>
//   ---
//   ## Especificación
//   …
//   ## Historial
//   - 2026-10-12 14:03 · plan · sonnet · 12k tok · ok · resumen
import fs from 'node:fs';
import path from 'node:path';
import { projectDir } from './registry.mjs';

const META_KEYS = ['complexity', 'status', 'branch', 'baseBranch', 'session', 'lastRun', 'updated'];

export function detailFile(slug, id) {
  return path.join(projectDir(slug), 'tasks', `${id}.md`);
}

export function parseDetail(md) {
  const out = { meta: {}, spec: '', history: [] };
  let body = md;
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    for (const line of fm[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z]+):\s*(.*)$/);
      if (kv && kv[2] !== '') out.meta[kv[1]] = kv[2].trim();
    }
    body = md.slice(fm[0].length);
  }
  const spec = body.match(/## Especificación\r?\n([\s\S]*?)(?=\r?\n## Historial|$)/);
  out.spec = spec ? spec[1].trim() : '';
  const hist = body.match(/## Historial\r?\n([\s\S]*)$/);
  if (hist) out.history = hist[1].split(/\r?\n/).filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
  return out;
}

export function formatDetail({ meta, spec, history }) {
  const fm = META_KEYS.filter((k) => meta[k]).map((k) => `${k}: ${meta[k]}`);
  return [
    '---',
    ...fm,
    '---',
    '',
    '## Especificación',
    '',
    spec?.trim() || '_(sin especificación)_',
    '',
    '## Historial',
    '',
    ...history.map((h) => `- ${h}`),
    '',
  ].join('\n');
}

export function readDetail(slug, id) {
  const file = detailFile(slug, id);
  const d = fs.existsSync(file) ? parseDetail(fs.readFileSync(file, 'utf8')) : { meta: {}, spec: '', history: [] };
  if (d.spec === '_(sin especificación)_') d.spec = '';
  d.meta.status ||= 'idle';
  return d;
}

function save(slug, id, d) {
  const file = detailFile(slug, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  d.meta.updated = new Date().toISOString();
  fs.writeFileSync(file, formatDetail(d));
  return d;
}

export function updateDetail(slug, id, { meta, spec, historyLine } = {}) {
  const d = readDetail(slug, id);
  if (meta) for (const [k, v] of Object.entries(meta)) if (META_KEYS.includes(k)) d.meta[k] = v == null ? undefined : String(v);
  if (typeof spec === 'string') d.spec = spec;
  if (historyLine) d.history.push(historyLine.replace(/\s+/g, ' ').trim());
  return save(slug, id, d);
}
