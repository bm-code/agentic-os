import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTask, insertUnder, parseTaskLine, parseTasks, sortOpen } from '../scripts/lib/tasks.mjs';
import { isUnder, normalizeForCompare } from '../scripts/lib/paths.mjs';
import { resolveProject } from '../scripts/lib/registry.mjs';
import { compactMarkdown } from '../scripts/lib/memory.mjs';
import { aggregate, ingestLines, modelFamily } from '../scripts/lib/usage.mjs';

test('parsea y formatea tareas ida y vuelta', () => {
  const line = '- [ ] (P1) Arreglar login en Safari #bug #auth @2026-10-20 <!--id:k3f9-->';
  const t = parseTaskLine(line);
  assert.deepEqual(t, { id: 'k3f9', done: false, prio: 'P1', title: 'Arreglar login en Safari', tags: ['bug', 'auth'], due: '2026-10-20', doneAt: null });
  assert.equal(formatTask(t), line);
  const done = parseTaskLine('- [x] (P2) Hecha ✓2026-10-12 <!--id:a1b2-->');
  assert.equal(done.done, true);
  assert.equal(done.doneAt, '2026-10-12');
  assert.equal(done.title, 'Hecha');
});

test('ordena abiertas por prioridad y fecha', () => {
  const tasks = parseTasks(['- [ ] (P2) b <!--id:b-->', '- [ ] (P0) a <!--id:a-->', '- [x] (P0) hecha <!--id:c-->', '- [ ] (P2) c @2026-01-01 <!--id:d-->'].join('\n'));
  assert.deepEqual(sortOpen(tasks).map((t) => t.id), ['a', 'd', 'b']);
});

test('insertUnder añade al final de la sección correcta', () => {
  const md = '# T\n\n## Pendientes\n\n- [ ] (P2) uno <!--id:aaaa-->\n\n## Hechas\n';
  const out = insertUnder(md, '## Pendientes', '- [ ] (P2) dos <!--id:bbbb-->');
  assert.equal(out, '# T\n\n## Pendientes\n\n- [ ] (P2) uno <!--id:aaaa-->\n- [ ] (P2) dos <!--id:bbbb-->\n\n## Hechas\n');
  const out2 = insertUnder(out, '## Hechas', '- [x] (P2) tres <!--id:cccc-->');
  assert.match(out2, /## Hechas\n\n- \[x\] \(P2\) tres/);
});

test('rutas de Windows: mayúsculas, barras y Git Bash', () => {
  assert.equal(normalizeForCompare('C:\\Users\\Beni\\Dev\\App\\', 'win32'), 'c:/users/beni/dev/app');
  assert.equal(normalizeForCompare('/c/Users/Beni/Dev/App', 'win32'), 'c:/users/beni/dev/app');
  assert.ok(isUnder('c:/users/beni/dev/app/src', 'C:\\Users\\Beni\\Dev\\App', 'win32'));
  assert.ok(!isUnder('C:\\Users\\Beni\\Dev\\App2', 'C:\\Users\\Beni\\Dev\\App', 'win32'));
});

test('resolveProject elige la ruta más específica de este equipo', () => {
  const registry = {
    projects: [
      { slug: 'mono', paths: { mac: '/x/mono' } },
      { slug: 'sub', paths: { mac: '/x/mono/packages/sub' } },
      { slug: 'otro', paths: { pc: '/x/mono' } },
    ],
  };
  assert.equal(resolveProject('/x/mono/packages/sub/src', { registry, machine: 'mac', platform: 'darwin' }).slug, 'sub');
  assert.equal(resolveProject('/x/mono/README', { registry, machine: 'mac', platform: 'darwin' }).slug, 'mono');
  assert.equal(resolveProject('/y', { registry, machine: 'mac', platform: 'darwin' }), null);
});

test('compactMarkdown quita comentarios y secciones vacías', () => {
  const md = '# P\n\n<!-- nota -->\n\n## Qué es\n\nUna app.\n\n## Stack\n\n## Notas\n';
  assert.equal(compactMarkdown(md), '# P\n\n## Qué es\n\nUna app.');
});

test('uso: deduplica bloques del mismo mensaje y agrega por proyecto/modelo', () => {
  const mk = (id, ts, model = 'claude-opus-5-5') =>
    JSON.stringify({ type: 'assistant', timestamp: ts, cwd: '/x/mono', sessionId: 's1', requestId: 'r' + id, message: { id, model, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } });
  const entry = { offset: 0, buckets: {}, sessions: {}, lastIds: [] };
  const now = new Date('2026-10-12T12:30:00Z');
  ingestLines(entry, [mk('m1', '2026-10-12T12:00:00Z'), mk('m1', '2026-10-12T12:00:01Z'), mk('m2', '2026-10-12T12:10:00Z', 'claude-haiku-5-5')]);
  const agg = aggregate({ files: { f: entry } }, { now, registry: { projects: [] } });
  assert.deepEqual(Object.keys(agg.byProject), ['(mono)']);
  assert.equal(agg.total.msgs, 2);
  assert.equal(agg.last5h.out, 10);
  assert.deepEqual(Object.keys(agg.byModel).sort(), ['haiku', 'opus']);
  assert.equal(agg.sessions[0].tokens, 230);
  assert.equal(modelFamily('claude-sonnet-5-5'), 'sonnet');
});

test('hecha → reabierta conserva prioridad, tags y fecha, sin líneas en blanco extra', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { AOS_HOME } = await import('../scripts/lib/paths.mjs');
  const { addTask, completeTask, reopenTask } = await import('../scripts/lib/tasks.mjs');
  const slug = `__test-${process.pid}`;
  const dir = path.join(AOS_HOME, 'projects', slug);
  try {
    const t = addTask(slug, { title: 'Tarea A', prio: 'P1', tags: ['x'], due: '2026-11-01' });
    completeTask(slug, t.id);
    const back = reopenTask(slug, t.id);
    assert.deepEqual({ ...back, doneAt: undefined }, { ...t, doneAt: undefined });
    const md = fs.readFileSync(path.join(dir, 'tasks.md'), 'utf8');
    assert.ok(!/\n{3,}/.test(md), 'sin líneas en blanco dobles');
    assert.match(md, /## Pendientes\n\n- \[ \] \(P1\) Tarea A #x @2026-11-01/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
