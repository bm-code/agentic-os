// Memoria del OS: brief de inicio de sesión, handoffs, notas y decisiones.
import fs from 'node:fs';
import path from 'node:path';
import { AOS_HOME, isUnder, today, toPosix } from './paths.mjs';
import { projectDir } from './registry.mjs';
import { listTasks, sortOpen, insertUnder } from './tasks.mjs';
import { summarizeTranscript } from './transcript.mjs';

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** Contenido útil de un .md: sin comentarios HTML, sin secciones vacías ni líneas en blanco repetidas. */
export function compactMarkdown(md) {
  const lines = md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{2,6}\s/.test(l)) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j >= lines.length || /^#{1,6}\s/.test(lines[j])) continue; // sección vacía
    }
    if (!l.trim() && (!out.length || !out[out.length - 1].trim())) continue;
    out.push(l);
  }
  return out.join('\n').trim();
}

export function sessionsDir(slug) {
  return path.join(projectDir(slug), 'sessions');
}

/** Handoffs ordenados del más reciente al más antiguo (nombre: YYYY-MM-DD-HHMM-<id>[.auto].md). */
export function listHandoffs(slug) {
  const dir = sessionsDir(slug);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse()
    .map((f) => ({ file: path.join(dir, f), name: f, auto: f.endsWith('.auto.md') }));
}

/** Último handoff; si la sesión más reciente tiene uno manual, gana sobre el automático. */
export function latestHandoff(slug) {
  const all = listHandoffs(slug);
  if (!all.length) return null;
  const key = (h) => h.name.replace(/(\.auto)?\.md$/, '');
  const newest = key(all[0]);
  return all.find((h) => key(h) === newest && !h.auto) || all[0];
}

function stamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${today(d)}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function handoffBase(slug, sessionId) {
  const short = (sessionId || 'manual').slice(0, 8);
  const existing = listHandoffs(slug).find((h) => h.name.includes(`-${short}`));
  if (existing) return existing.name.replace(/(\.auto)?\.md$/, '');
  return `${stamp()}-${short}`;
}

/** Handoff escrito por Claude (/aos-handoff). Sustituye al automático de la misma sesión. */
export function writeHandoff(slug, sessionId, body) {
  const base = handoffBase(slug, sessionId);
  const file = path.join(sessionsDir(slug), `${base}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const header = `# Handoff · ${today()}${sessionId ? ` · sesión ${sessionId.slice(0, 8)}` : ''}\n\n`;
  fs.writeFileSync(file, header + body.trim() + '\n');
  const auto = path.join(sessionsDir(slug), `${base}.auto.md`);
  if (fs.existsSync(auto)) fs.rmSync(auto);
  return file;
}

/** Handoff mecánico desde el transcript (PreCompact / SessionEnd). Coste cero en tokens. */
export function writeAutoHandoff(slug, transcriptPath, sessionId, reason, projectRoot = null) {
  const s = summarizeTranscript(transcriptPath);
  if (!s.turns) return null;
  const base = handoffBase(slug, sessionId || s.sessionId);
  if (fs.existsSync(path.join(sessionsDir(slug), `${base}.md`))) return null; // ya hay uno manual
  const lines = [`# Handoff automático · ${today()} · ${reason}`, ''];
  if (s.title) lines.push(`**Sesión:** ${s.title}`, '');
  lines.push('## Peticiones');
  // El primer mensaje suele ser el objetivo; del resto, los últimos con contenido (no "sí"/"adelante").
  const [first, ...rest] = s.prompts;
  const recent = [...new Set(rest.filter((p) => p.length >= 15))].slice(-5);
  for (const p of [first, ...recent]) lines.push(`- ${clip(p.replace(/\s+/g, ' '), 200)}`);
  if (s.files.length) {
    lines.push('', '## Archivos modificados');
    const rel = (f) => (projectRoot && isUnder(f, projectRoot) ? toPosix(path.relative(projectRoot, f)) : toPosix(f));
    for (const f of s.files.slice(-15)) lines.push(`- ${rel(f)}`);
  }
  if (s.lastAssistant) lines.push('', '## Último estado', clip(s.lastAssistant.replace(/\n{2,}/g, '\n'), 700));
  const file = path.join(sessionsDir(slug), `${base}.auto.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

export function remember(slug, text, { global = false } = {}) {
  const file = global ? path.join(AOS_HOME, 'memory', 'learnings.md') : path.join(projectDir(slug), 'context.md');
  const md = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# Notas\n';
  const line = `- ${text.trim()} _(${today()})_`;
  fs.writeFileSync(file, global ? md.replace(/\s*$/, '\n') + line + '\n' : insertUnder(md, '## Notas', line));
  return file;
}

export function addDecision(slug, title, body) {
  const file = path.join(projectDir(slug), 'decisions.md');
  const md = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# Decisiones\n';
  fs.writeFileSync(file, md.replace(/\s*$/, '\n') + `\n## ${today()} · ${title.trim()}\n\n${(body || '').trim()}\n`);
  return file;
}

/** Brief que se inyecta al inicio de la sesión. Corto a propósito: se paga en cada turno. */
export function buildBrief(project, cfg) {
  const { maxContextLines, maxTasks, maxHandoffLines } = cfg.brief;
  const dir = projectDir(project.slug);
  const out = [`# Agentic OS · ${project.name} (\`${project.slug}\`)`];

  const ctx = compactMarkdown(fs.existsSync(path.join(dir, 'context.md')) ? fs.readFileSync(path.join(dir, 'context.md'), 'utf8') : '')
    .split('\n')
    .filter((l) => !/^# /.test(l))
    .map((l) => l.replace(/^## /, '### '));
  if (ctx.join('').trim()) {
    out.push('', '## Contexto', ...ctx.slice(0, maxContextLines));
    if (ctx.length > maxContextLines) out.push(`… (${ctx.length - maxContextLines} líneas más en context.md)`);
  } else {
    out.push('', '_context.md vacío: si aporta, rellénalo con /aos-register._');
  }

  const open = sortOpen(listTasks(project.slug));
  if (open.length) {
    out.push('', `## Tareas abiertas (${Math.min(open.length, maxTasks)} de ${open.length})`);
    for (const t of open.slice(0, maxTasks)) out.push(`- [${t.id}] (${t.prio}) ${t.title}${t.due ? ` @${t.due}` : ''}`);
  }

  const h = latestHandoff(project.slug);
  if (h) {
    const body = compactMarkdown(fs.readFileSync(h.file, 'utf8'))
      .split('\n')
      .filter((l) => !/^# /.test(l))
      .map((l) => l.replace(/^## /, '### '));
    out.push('', `## Última sesión (${h.name.slice(0, 10)}${h.auto ? ', automático' : ''})`, ...body.slice(0, maxHandoffLines));
  }

  out.push('', `_Memoria del proyecto en \`${toPosix(dir)}\`. Usa /aos-task, /aos-remember y /aos-handoff (antes de /clear)._`);
  return out.join('\n');
}
