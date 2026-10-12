// Tareas en Markdown legible y parseable:
//   - [ ] (P1) Título de la tarea #tag @2026-10-20 <!--id:k3f9-->
//   - [x] (P2) Tarea hecha ✓2026-10-12 <!--id:a1b2-->
import fs from 'node:fs';
import path from 'node:path';
import { projectDir } from './registry.mjs';
import { today } from './paths.mjs';

const LINE = /^(\s*)- \[( |x|X)\] (.*)$/;
const ID = /\s*<!--id:([a-z0-9]+)-->\s*$/;
const PRIO = /^\((P[0-3])\)\s*/;
const DONE_AT = /\s*✓(\d{4}-\d{2}-\d{2})/;
const DUE = /(?:^|\s)@(\d{4}-\d{2}-\d{2})/;
const TAG = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu;

export function parseTaskLine(line) {
  const m = line.match(LINE);
  if (!m) return null;
  let rest = m[3];
  const id = rest.match(ID)?.[1] || null;
  rest = rest.replace(ID, '');
  const prio = rest.match(PRIO)?.[1] || 'P2';
  rest = rest.replace(PRIO, '');
  const doneAt = rest.match(DONE_AT)?.[1] || null;
  rest = rest.replace(DONE_AT, '');
  const due = rest.match(DUE)?.[1] || null;
  const tags = [...rest.matchAll(TAG)].map((t) => t[1]);
  const title = rest.replace(DUE, ' ').replace(TAG, ' ').replace(/\s+/g, ' ').trim();
  return { id, done: m[2].toLowerCase() === 'x', prio, title, tags, due, doneAt };
}

export function formatTask(t) {
  const parts = [`- [${t.done ? 'x' : ' '}]`, `(${t.prio || 'P2'})`, t.title];
  for (const tag of t.tags || []) parts.push(`#${tag}`);
  if (t.due) parts.push(`@${t.due}`);
  if (t.done && t.doneAt) parts.push(`✓${t.doneAt}`);
  return `${parts.join(' ')} <!--id:${t.id}-->`;
}

export function parseTasks(md) {
  return md
    .split(/\r?\n/)
    .map(parseTaskLine)
    .filter(Boolean);
}

const PRIO_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };
export function sortOpen(tasks) {
  return tasks
    .filter((t) => !t.done)
    .sort((a, b) => PRIO_ORDER[a.prio] - PRIO_ORDER[b.prio] || (a.due || '9999').localeCompare(b.due || '9999'));
}

export function newId(existing) {
  const used = new Set(existing.map((t) => t.id));
  let id;
  do id = Math.random().toString(36).slice(2, 6);
  while (used.has(id) || id.length < 4);
  return id;
}

function tasksFile(slug) {
  return path.join(projectDir(slug), 'tasks.md');
}

function load(slug) {
  const file = tasksFile(slug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const md = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : `# Tareas\n\n## Pendientes\n\n## Hechas\n`;
  return { file, md };
}

export function listTasks(slug) {
  return parseTasks(load(slug).md);
}

/** Inserta una línea al final de la sección `heading` (o al final del archivo si no existe). */
export function insertUnder(md, heading, line) {
  const lines = md.replace(/\s+$/, '').split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toLowerCase() === heading.toLowerCase());
  if (start === -1) return `${lines.join('\n')}\n\n${heading}\n\n${line}\n`;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  let at = end;
  while (at > start + 1 && lines[at - 1].trim() === '') at--;
  const before = lines.slice(0, at);
  if (at === start + 1) before.push('');
  const after = lines.slice(at);
  if (after.length && after[0].trim() !== '') after.unshift('');
  return [...before, line, ...after].join('\n') + '\n';
}

export function addTask(slug, { title, prio = 'P2', tags = [], due = null }) {
  const { file, md } = load(slug);
  const task = { id: newId(parseTasks(md)), done: false, prio, title: title.trim(), tags, due };
  fs.writeFileSync(file, insertUnder(md, '## Pendientes', formatTask(task)));
  return task;
}

function moveTask(slug, id, done) {
  const { file, md } = load(slug);
  const lines = md.split(/\r?\n/);
  const idx = lines.findIndex((l) => parseTaskLine(l)?.id === id);
  if (idx === -1) return null;
  const task = { ...parseTaskLine(lines[idx]), done, doneAt: done ? today() : null };
  lines.splice(idx, 1);
  const out = insertUnder(lines.join('\n'), done ? '## Hechas' : '## Pendientes', formatTask(task));
  fs.writeFileSync(file, out.replace(/\n{3,}/g, '\n\n'));
  return task;
}

/** Marca como hecha y la mueve a "## Hechas". */
export function completeTask(slug, id) {
  return moveTask(slug, id, true);
}

/** Deshace un "hecha": vuelve a "## Pendientes" con su prioridad, tags y fecha. */
export function reopenTask(slug, id) {
  return moveTask(slug, id, false);
}
