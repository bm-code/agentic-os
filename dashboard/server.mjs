#!/usr/bin/env node
// Dashboard local del Agentic OS. Sin dependencias. Solo escucha en 127.0.0.1.
//   npm run dashboard   →  http://localhost:4747
// Puede ejecutar Claude y git en tus proyectos, así que toda la API exige un token por arranque
// (inyectado en la página) y valida Host/Origin para que ninguna web externa pueda usarla.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { machineId, readText, toPosix } from '../scripts/lib/paths.mjs';
import { loadConfig } from '../scripts/lib/config.mjs';
import { findProject, loadRegistry, projectDir, upsertProject } from '../scripts/lib/registry.mjs';
import { addTask, completeTask, findTask, listTasks, reopenTask, updateTask } from '../scripts/lib/tasks.mjs';
import { readDetail, updateDetail } from '../scripts/lib/taskdetail.mjs';
import { compactMarkdown, latestHandoff, writeHandoff } from '../scripts/lib/memory.mjs';
import { listProjectAgents } from '../scripts/lib/agents.mjs';
import { aggregate, refreshUsage } from '../scripts/lib/usage.mjs';
import * as G from './lib/git.mjs';
import { pickFolder } from './lib/picker.mjs';
import { HttpError, MODELS, activeRun, estimateComplexity, getRun, listRuns, runEvents, runInfo, startTurn, stopAll, stopRun } from './lib/runner.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const cfg = loadConfig();
const port = Number(process.env.PORT || cfg.dashboard.port);
const TOKEN = randomBytes(24).toString('hex');
const STATIC = { '/app.js': 'text/javascript; charset=utf-8', '/app.css': 'text/css; charset=utf-8' };

// ── seguridad ────────────────────────────────────────────────────────────────────────────
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function checkRequest({ method, headers, url }, token = TOKEN) {
  if (!LOCAL_HOST.test(headers.host || '')) return 'host no permitido'; // DNS rebinding
  if (headers.origin && !LOCAL_ORIGIN.test(headers.origin)) return 'origen no permitido';
  if (url.startsWith('/api/')) {
    const given = headers['x-aos-token'] || new URL(url, 'http://x').searchParams.get('token') || '';
    const a = Buffer.from(String(given));
    const b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return 'token no válido (recarga la página)';
  }
  return null;
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) reject(new HttpError(413, 'Petición demasiado grande'));
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function projectOr404(slug) {
  const p = findProject(slug);
  if (!p) throw new HttpError(404, 'Proyecto no encontrado');
  return p;
}

function repoOf(p) {
  const repo = p.paths?.[machineId()];
  if (!repo || !fs.existsSync(repo)) throw new HttpError(400, 'Este proyecto no está clonado en este equipo');
  return repo;
}

function taskView(slug, t) {
  const d = readDetail(slug, t.id);
  return { ...t, complexity: d.meta.complexity || null, status: d.meta.status, branch: d.meta.branch || null };
}

// ── datos ────────────────────────────────────────────────────────────────────────────────
function overview(days) {
  const registry = loadRegistry();
  const me = machineId();
  const usage = aggregate(refreshUsage(), { days, registry });
  const projects = registry.projects.map((p) => {
    const h = latestHandoff(p.slug);
    const run = activeRun(p.slug);
    return {
      slug: p.slug,
      name: p.name,
      tags: p.tags || [],
      localPath: p.paths?.[me] ? toPosix(p.paths[me]) : null,
      tasks: listTasks(p.slug),
      running: run && run.id ? { taskId: run.taskId, mode: run.mode } : null,
      handoff: h ? { date: h.name.slice(0, 10), auto: h.auto, text: compactMarkdown(readText(h.file)) } : null,
    };
  });
  return { machine: me, days, generatedAt: new Date().toISOString(), usage, projects };
}

function projectView(p) {
  const h = latestHandoff(p.slug);
  const run = activeRun(p.slug);
  return {
    slug: p.slug,
    name: p.name,
    repo: p.repo,
    tags: p.tags || [],
    localPath: p.paths?.[machineId()] ? toPosix(p.paths[machineId()]) : null,
    memoryDir: toPosix(projectDir(p.slug)),
    context: compactMarkdown(readText(path.join(projectDir(p.slug), 'context.md'))),
    handoff: h ? { date: h.name.slice(0, 10), auto: h.auto, text: compactMarkdown(readText(h.file)) } : null,
    agents: listProjectAgents(p.slug).map((a) => ({ name: a.name, model: a.meta.model || 'inherit', description: a.meta.description || '' })),
    tasks: listTasks(p.slug).map((t) => taskView(p.slug, t)),
    running: run && run.id ? runInfo(run) : null,
    models: MODELS,
  };
}

// ── rutas ────────────────────────────────────────────────────────────────────────────────
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[\\w.-]+)')}$`), handler });

route('GET', '/api/data', ({ url }) => overview(Math.min(Number(url.searchParams.get('days') || 30), 365)));

route('POST', '/api/pick-folder', async () => {
  const picked = await pickFolder();
  if (!picked) return { cancelled: true };
  const isRepo = await G.isRepo(picked).catch(() => false);
  return { path: picked, name: path.basename(picked), isRepo };
});

route('POST', '/api/projects/register', async ({ body }) => {
  const localPath = String(body.path || '').trim();
  if (!localPath || !fs.existsSync(localPath) || !fs.statSync(localPath).isDirectory()) throw new HttpError(400, 'La ruta no existe o no es una carpeta');
  const slug = String(body.slug || path.basename(localPath)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const r = await G.git(localPath, ['remote', 'get-url', 'origin']);
  const p = upsertProject({ slug, name: body.name, localPath, repo: r.code === 0 ? r.stdout.trim() : '' });
  return { slug: p.slug, hint: 'Abre Claude en el proyecto y ejecuta /aos-register para generar contexto y agentes.' };
});

route('GET', '/api/projects/:slug', ({ params }) => projectView(projectOr404(params.slug)));

route('POST', '/api/projects/:slug/tasks', ({ params, body }) => {
  const p = projectOr404(params.slug);
  const title = String(body.title || '').trim();
  const prio = /^P[0-3]$/.test(body.prio) ? body.prio : 'P2';
  if (!title) throw new HttpError(400, 'El título es obligatorio');
  const t = addTask(p.slug, { title, prio });
  const spec = String(body.spec || '');
  const manual = /^[SML]$/.test(body.complexity) ? body.complexity : null;
  updateDetail(p.slug, t.id, { spec, meta: manual ? { complexity: manual, status: 'idle' } : {} });
  if (!manual && body.estimate !== false) estimateComplexity(p.slug, t.id, title, spec); // asíncrono, Haiku
  return taskView(p.slug, t);
});

route('GET', '/api/projects/:slug/tasks/:id', ({ params }) => {
  const p = projectOr404(params.slug);
  const t = findTask(p.slug, params.id);
  if (!t) throw new HttpError(404, 'Tarea no encontrada');
  return { ...taskView(p.slug, t), detail: readDetail(p.slug, t.id), runs: listRuns(p.slug, t.id) };
});

route('PATCH', '/api/projects/:slug/tasks/:id', ({ params, body }) => {
  const p = projectOr404(params.slug);
  const t = updateTask(p.slug, params.id, { title: body.title, prio: body.prio });
  if (!t) throw new HttpError(404, 'Tarea no encontrada');
  const meta = {};
  if (/^[SML]$/.test(body.complexity)) {
    meta.complexity = body.complexity;
    if (readDetail(p.slug, t.id).meta.status === 'estimating') meta.status = 'idle';
  }
  updateDetail(p.slug, t.id, { meta, spec: typeof body.spec === 'string' ? body.spec : undefined });
  return taskView(p.slug, t);
});

route('POST', '/api/projects/:slug/tasks/:id/done', ({ params }) => {
  const p = projectOr404(params.slug);
  if (activeRun(p.slug)?.taskId === params.id) throw new HttpError(409, 'Detén la ejecución antes de cerrar la tarea');
  const t = completeTask(p.slug, params.id);
  if (!t) throw new HttpError(404, 'Tarea no encontrada');
  const d = readDetail(p.slug, t.id);
  if (d.meta.session) {
    // Handoff para que la próxima sesión (terminal o dashboard) sepa qué se hizo.
    const last = d.history.slice(-3).map((h) => `- ${h}`).join('\n');
    writeHandoff(p.slug, d.meta.session, `## Hecho\n- Tarea [${t.id}] ${t.title}${d.meta.branch ? ` (rama \`${d.meta.branch}\`, base \`${d.meta.baseBranch || '?'}\`)` : ''}\n\n## Historial de ejecuciones\n${last}\n\n## Siguiente paso\n- Revisar/mergear la rama si procede.`);
  }
  updateDetail(p.slug, t.id, { meta: { status: 'idle' } });
  return t;
});

route('POST', '/api/projects/:slug/tasks/:id/reopen', ({ params }) => {
  const p = projectOr404(params.slug);
  const t = reopenTask(p.slug, params.id);
  if (!t) throw new HttpError(404, 'Tarea no encontrada');
  return t;
});

route('POST', '/api/projects/:slug/tasks/:id/run', async ({ params, body }) => {
  const p = projectOr404(params.slug);
  const kind = ['plan', 'approve', 'reply'].includes(body.kind) ? body.kind : 'plan';
  return startTurn(p, params.id, kind, String(body.message || ''));
});

route('POST', '/api/runs/:runId/stop', ({ params }) => ({ stopped: stopRun(params.runId) }));

route('GET', '/api/runs/:runId/events', ({ params, req, res }) => {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
  const write = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  for (const ev of runEvents(params.runId)) write(ev);
  const run = getRun(params.runId);
  if (!run || run.status !== 'running') {
    write({ kind: 'eof' });
    return res.end();
  }
  const onEvent = (ev) => write(ev);
  run.bus.on('event', onEvent);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(ping);
    run.bus.off('event', onEvent);
  });
  return undefined; // respuesta en streaming
});

// git
route('GET', '/api/projects/:slug/git', async ({ params }) => G.status(repoOf(projectOr404(params.slug))));
route('GET', '/api/projects/:slug/git/diff', async ({ params, url }) => {
  const repo = repoOf(projectOr404(params.slug));
  const file = url.searchParams.get('file') || '';
  const base = url.searchParams.get('base') || '';
  if (base && !/^[\w./-]+$/.test(base)) throw new HttpError(400, 'Rama base no válida');
  return { diff: await G.diff(repo, file, { base: base || undefined }) };
});
route('POST', '/api/projects/:slug/git/commit', async ({ params, body }) => {
  const p = projectOr404(params.slug);
  if (activeRun(p.slug)) throw new HttpError(409, 'Hay una ejecución de Claude en marcha: espera a que termine');
  const out = await G.commit(repoOf(p), String(body.message || ''), Array.isArray(body.files) ? body.files : null);
  return { ok: true, output: out.trim() };
});
route('POST', '/api/projects/:slug/git/sync', async ({ params }) => ({ ok: true, output: await G.sync(repoOf(projectOr404(params.slug))) }));
route('POST', '/api/projects/:slug/git/fetch', async ({ params }) => {
  await G.fetch(repoOf(projectOr404(params.slug)));
  return { ok: true };
});
route('GET', '/api/projects/:slug/git/branches', async ({ params }) => ({ branches: await G.branches(repoOf(projectOr404(params.slug))) }));
route('POST', '/api/projects/:slug/git/checkout', async ({ params, body }) => {
  const p = projectOr404(params.slug);
  if (activeRun(p.slug)) throw new HttpError(409, 'Hay una ejecución de Claude en marcha');
  const repo = repoOf(p);
  if (await G.hasTrackedChanges(repo)) throw new HttpError(409, 'Hay cambios sin commitear: haz commit antes de cambiar de rama');
  await G.checkout(repo, String(body.branch || ''));
  return { ok: true };
});

// ── servidor ─────────────────────────────────────────────────────────────────────────────
export const server = http.createServer(async (req, res) => {
  try {
    const denied = checkRequest(req);
    if (denied) return send(res, 403, { error: denied });
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace('__AOS_TOKEN__', TOKEN);
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && STATIC[url.pathname]) return send(res, 200, fs.readFileSync(path.join(PUBLIC, url.pathname.slice(1)), 'utf8'), STATIC[url.pathname]);

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const body = ['POST', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const result = await r.handler({ req, res, url, params: m.groups || {}, body });
      if (result !== undefined) send(res, 200, result);
      return;
    }
    send(res, 404, { error: 'no encontrado' });
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.message });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log(`Agentic OS dashboard → ${url}  (Ctrl+C para salir)`);
    if (!process.argv.includes('--no-open')) {
      const opener = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(opener, () => {});
    }
  });
  const shutdown = () => {
    stopAll();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
