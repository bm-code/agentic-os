// Ejecuta Claude Code sin terminal (`claude -p … --output-format stream-json`) para una tarea,
// retransmite los eventos por SSE y guarda el histórico en .local/runs/.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL_DIR, machineId, readText, toPosix } from '../../scripts/lib/paths.mjs';
import { loadConfig } from '../../scripts/lib/config.mjs';
import { projectDir } from '../../scripts/lib/registry.mjs';
import { findTask } from '../../scripts/lib/tasks.mjs';
import { readDetail, updateDetail } from '../../scripts/lib/taskdetail.mjs';
import { syncProjectAgents } from '../../scripts/lib/agents.mjs';
import { compactMarkdown } from '../../scripts/lib/memory.mjs';
import { normalize } from './events.mjs';
import * as G from './git.mjs';

export const RUNS_DIR = path.join(LOCAL_DIR, 'runs');

/** Complejidad → modelo para planificar y para ejecutar. */
export const MODELS = {
  S: { plan: 'haiku', exec: 'haiku' },
  M: { plan: 'sonnet', exec: 'sonnet' },
  L: { plan: 'opus', exec: 'sonnet' },
};

export class HttpError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}

// ── localizar el binario de claude (Windows: .exe directo o .cmd vía shell) ──────────────
let claudeCmd = null;
export function resolveClaude() {
  if (claudeCmd) return claudeCmd;
  const configured = loadConfig().dashboard?.claudeBin;
  if (configured) return (claudeCmd = { cmd: configured, shell: process.platform === 'win32' && !/\.exe$/i.test(configured) });
  if (process.platform === 'win32') {
    const r = spawnSync('where', ['claude'], { encoding: 'utf8', windowsHide: true });
    const found = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const exe = found.find((f) => /\.exe$/i.test(f));
    return (claudeCmd = exe ? { cmd: exe, shell: false } : { cmd: 'claude', shell: true });
  }
  return (claudeCmd = { cmd: 'claude', shell: false });
}

const winQuote = (a) => (/^[\w./:=@-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);

function childEnv() {
  const env = { ...process.env, AOS_RUN: '1' };
  // Si el dashboard se arrancó desde una sesión de Claude Code, que el hijo no se crea anidado.
  for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k];
  return env;
}

export function spawnClaude(args, { cwd, input }) {
  const { cmd, shell } = resolveClaude();
  const child = spawn(shell ? cmd : cmd, shell ? args.map(winQuote) : args, {
    cwd,
    shell,
    env: childEnv(),
    windowsHide: true,
    detached: process.platform !== 'win32', // grupo propio → se puede matar el árbol entero
  });
  if (input != null) child.stdin.end(input);
  return child;
}

function killTree(child) {
  if (!child || child.exitCode != null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

// ── estado en memoria ────────────────────────────────────────────────────────────────────
const runs = new Map(); // runId → run
const activeByProject = new Map(); // slug → runId

export function activeRun(slug) {
  const id = activeByProject.get(slug);
  return id ? runs.get(id) : null;
}

export function getRun(runId) {
  return runs.get(runId) || null;
}

export function runInfo(r) {
  return {
    id: r.id, slug: r.slug, taskId: r.taskId, mode: r.mode, model: r.model, status: r.status,
    startedAt: r.startedAt, endedAt: r.endedAt, usageCum: r.usageCum || null,
    tokens: r.result?.tokens ?? null, byModel: r.result?.byModel ?? null,
  };
}

/** Ejecuciones guardadas de una tarea (más reciente primero). */
export function listRuns(slug, taskId) {
  if (!fs.existsSync(RUNS_DIR)) return [];
  const prefix = `${slug}__${taskId}__`;
  return fs
    .readdirSync(RUNS_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map((meta) => (runs.has(meta.id) ? runInfo(runs.get(meta.id)) : meta))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Eventos de feed de una ejecución (en memoria o desde disco). */
export function runEvents(runId) {
  const r = runs.get(runId);
  if (r) return r.events;
  if (!/^[\w-]+$/.test(runId)) return [];
  const file = fs.existsSync(RUNS_DIR) ? fs.readdirSync(RUNS_DIR).find((f) => f.endsWith(`__${runId}.jsonl`)) : null;
  if (!file) return [];
  const events = [];
  for (const line of readText(path.join(RUNS_DIR, file)).split('\n')) {
    if (!line) continue;
    try {
      const raw = JSON.parse(line);
      if (raw.__aos) events.push(raw.__aos);
      else events.push(...normalize(raw));
    } catch {
      /* línea parcial */
    }
  }
  return events;
}

// ── preparación de rama y prompts ───────────────────────────────────────────────────────
async function ensureBranch(repo, slug, taskId, detail) {
  if (!(await G.isRepo(repo))) return { branch: null, note: 'El proyecto no es un repositorio git: se trabaja sin rama.' };
  const st = await G.status(repo);
  const want = detail.meta.branch || `aos/${taskId}`;
  if (st.branch === want) return { branch: want, baseBranch: detail.meta.baseBranch || null };
  if (await G.hasTrackedChanges(repo)) {
    throw new HttpError(409, `Hay cambios sin commitear en "${st.branch}". Haz commit o stash antes de lanzar la tarea (necesita cambiar a la rama ${want}).`);
  }
  const exists = (await G.branches(repo)).includes(want);
  await G.checkout(repo, want, { create: !exists });
  return { branch: want, baseBranch: detail.meta.baseBranch || st.branch };
}

function systemPrompt(project, task, detail, mode) {
  const ctx = compactMarkdown(readText(path.join(projectDir(project.slug), 'context.md')));
  return [
    `Estás trabajando desde el dashboard del Agentic OS (sin terminal: nadie puede responder preguntas a mitad de turno).`,
    `Proyecto: ${project.name}. Tarea [${task.id}] (${task.prio}, complejidad ${detail.meta.complexity || 'M'}): ${task.title}.`,
    detail.meta.branch ? `Trabajas en la rama ${detail.meta.branch} (base: ${detail.meta.baseBranch || '?'}). No cambies de rama ni hagas commit: el usuario revisa y hace commit desde el dashboard.` : '',
    mode === 'plan'
      ? 'Fase de PLAN: investiga lo justo (delega en `explorer`) y presenta un plan concreto: pasos, archivos, qué agente ejecuta cada paso (aos-quick / especialista aos-* / aos-builder) y cómo verificar. No edites nada.'
      : 'Fase de EJECUCIÓN: implementa el plan aprobado. Delega por coste: mecánico → aos-quick, área con especialista → aos-<proyecto>-*, tests/build → aos-test-runner, revisión final → aos-reviewer si el cambio no es trivial.',
    'Al terminar el turno responde en español con: qué hiciste (archivos), cómo verificarlo y qué queda pendiente. Conciso.',
    ctx ? `\n## Contexto del proyecto\n${ctx}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function userPrompt(task, detail, kind, message) {
  if (kind === 'plan') return `# Tarea: ${task.title}\n\n${detail.spec || '(sin especificación adicional)'}\n\nPrepara el plan.`;
  if (kind === 'approve') return `Plan aprobado.${message ? ` Indicaciones: ${message}` : ''} Ejecútalo ahora.`;
  return message;
}

// ── lanzar un turno ─────────────────────────────────────────────────────────────────────
/**
 * kind: 'plan' (primer turno o feedback al plan) | 'approve' (ejecuta el plan) | 'reply' (mensaje libre)
 */
export async function startTurn(project, taskId, kind, message = '') {
  const repo = project.paths?.[machineId()];
  if (!repo || !fs.existsSync(repo)) throw new HttpError(400, 'Este proyecto no está clonado en este equipo (no hay ruta local en el registro).');
  if (activeByProject.has(project.slug)) throw new HttpError(409, 'Ya hay una ejecución en marcha en este proyecto.');
  const task = findTask(project.slug, taskId);
  if (!task) throw new HttpError(404, 'Tarea no encontrada');
  if (kind === 'reply' && !message.trim()) throw new HttpError(400, 'Mensaje vacío');

  activeByProject.set(project.slug, 'pending');
  try {
    let detail = readDetail(project.slug, taskId);
    const branchInfo = await ensureBranch(repo, project.slug, taskId, detail);
    const complexity = detail.meta.complexity || 'M';
    const planning = kind === 'plan' || (kind === 'reply' && ['planning', 'plan-ready'].includes(detail.meta.status));
    const model = MODELS[complexity]?.[planning ? 'plan' : 'exec'] || 'sonnet';
    const sessionId = detail.meta.session || randomUUID();
    const prevRun = detail.meta.lastRun ? listRuns(project.slug, taskId).find((x) => x.id === detail.meta.lastRun) : null;
    const prevCum = (detail.meta.session && prevRun?.usageCum) || {};
    const isFirst = !detail.meta.session;

    detail = updateDetail(project.slug, taskId, {
      meta: { status: planning ? 'planning' : 'running', session: sessionId, branch: branchInfo.branch, baseBranch: branchInfo.baseBranch },
    });
    try {
      syncProjectAgents(project);
    } catch {
      /* los agentes globales siguen disponibles */
    }

    const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    const base = path.join(RUNS_DIR, `${project.slug}__${taskId}__${id}`);
    const sysFile = `${base}.sys.md`;
    fs.writeFileSync(sysFile, systemPrompt(project, task, detail, planning ? 'plan' : 'exec'));

    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', model,
      // Plan: modo normal con edición bloqueada (plan mode fuerza Sonnet como mínimo y no respetaría
      // Haiku en tareas S). Lo que pediría permiso se deniega solo: nadie está en la terminal.
      ...(planning ? ['--permission-mode', 'default', '--disallowedTools', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit'] : ['--permission-mode', 'auto']),
      '--permission-prompts', 'none',
      '--append-system-prompt-file', toPosix(sysFile),
      ...(isFirst ? ['--session-id', sessionId] : ['--resume', sessionId]),
    ];
    const prompt = userPrompt(task, detail, kind, message);

    const run = {
      id,
      slug: project.slug,
      taskId,
      mode: planning ? 'plan' : 'exec',
      kind,
      model,
      status: 'running',
      startedAt: new Date().toISOString(),
      endedAt: null,
      events: [],
      bus: new EventEmitter(),
      log: fs.createWriteStream(`${base}.jsonl`, { flags: 'a' }),
      metaFile: `${base}.json`,
      result: null,
    };
    run.bus.setMaxListeners(50);
    runs.set(id, run);
    activeByProject.set(project.slug, id);

    const push = (ev, persist = true) => {
      run.events.push(ev);
      if (persist) run.log.write(JSON.stringify({ __aos: ev }) + '\n');
      run.bus.emit('event', ev);
    };
    const saveMeta = () => fs.writeFileSync(run.metaFile, JSON.stringify(runInfo(run)));
    saveMeta();
    push({ kind: 'user', text: prompt, mode: run.mode, model, branch: branchInfo.branch, note: branchInfo.note });

    const child = spawnClaude(args, { cwd: repo, input: prompt });
    run.child = child;
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let raw;
        try {
          raw = JSON.parse(line);
        } catch {
          push({ kind: 'stderr', text: line.slice(0, 2000) });
          continue;
        }
        run.log.write(line + '\n');
        for (const ev of normalize(raw)) {
          if (ev.kind === 'result') {
            // modelUsage es acumulado de toda la sesión: se resta lo de turnos anteriores.
            run.usageCum = ev.byModel;
            const turn = {};
            for (const [m, u] of Object.entries(ev.byModel)) {
              const p = prevCum[m] || { tokens: 0, out: 0, cost: 0 };
              const d = { tokens: u.tokens - p.tokens, out: u.out - p.out, cost: u.cost - p.cost };
              if (d.tokens > 0) turn[m] = d;
            }
            ev.byModel = turn;
            ev.tokens = Object.values(turn).reduce((a, b) => a + b.tokens, 0);
            ev.cost = Object.values(turn).reduce((a, b) => a + b.cost, 0);
            run.result = ev;
          }
          run.events.push(ev);
          run.bus.emit('event', ev);
        }
      }
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => push({ kind: 'stderr', text: `No se pudo ejecutar claude: ${e.message}` }));
    child.on('close', (code) => {
      const r = run.result;
      run.status = run.stopped ? 'stopped' : r?.ok ? 'done' : 'error';
      run.endedAt = new Date().toISOString();
      if (!r && stderr.trim()) push({ kind: 'stderr', text: stderr.trim().slice(-3000) });
      const nextStatus = run.stopped ? (planning ? 'idle' : 'review') : !r?.ok ? 'error' : planning ? 'plan-ready' : 'review';
      const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.round(n / 1e3) + 'k');
      const summary = (r?.text || stderr || '').replace(/\s+/g, ' ').slice(0, 140);
      updateDetail(project.slug, taskId, {
        meta: { status: nextStatus, session: r?.session || sessionId, lastRun: id },
        historyLine: `${new Date().toLocaleString('sv-SE').slice(0, 16)} · ${run.mode} · ${model} · ${r ? fmt(r.tokens) + ' tok' : '—'} · ${run.status}${summary ? ' · ' + summary : ''}`,
      });
      push({ kind: 'end', status: run.status, taskStatus: nextStatus, code });
      saveMeta();
      run.log.end();
      activeByProject.delete(project.slug);
      run.child = null;
      // Liberar memoria de ejecuciones antiguas (quedan en disco).
      if (runs.size > 30) for (const [k, v] of runs) if (v.status !== 'running' && runs.size > 30) runs.delete(k);
    });
    return runInfo(run);
  } catch (e) {
    if (activeByProject.get(project.slug) === 'pending') activeByProject.delete(project.slug);
    throw e;
  }
}

export function stopRun(runId) {
  const r = runs.get(runId);
  if (!r || r.status !== 'running') return false;
  r.stopped = true;
  killTree(r.child);
  return true;
}

export function stopAll() {
  for (const r of runs.values()) if (r.status === 'running') stopRun(r.id);
}

// ── estimación de complejidad (Haiku, sin herramientas) ───────────────────────────────
export function estimateComplexity(slug, taskId, title, spec) {
  updateDetail(slug, taskId, { meta: { status: 'estimating' } });
  const prompt = `Clasifica la complejidad de esta tarea de desarrollo de software para elegir modelo.
S = mecánica o muy acotada (1-2 archivos, sin decisiones). M = feature o bug normal. L = diseño, varios módulos, depuración difícil o riesgo alto.
Responde SOLO con una letra: S, M o L.

Tarea: ${title}
${spec ? `Especificación:\n${spec.slice(0, 4000)}` : ''}`;
  return new Promise((resolve) => {
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    const child = spawnClaude(['-p', '--model', 'haiku', '--tools', '', '--output-format', 'json', '--no-session-persistence'], { cwd: LOCAL_DIR, input: prompt });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    const timer = setTimeout(() => killTree(child), 90000);
    const finish = (c) => {
      clearTimeout(timer);
      const complexity = c || 'M';
      const d = readDetail(slug, taskId);
      updateDetail(slug, taskId, { meta: { complexity: d.meta.complexity && d.meta.status !== 'estimating' ? d.meta.complexity : complexity, status: d.meta.status === 'estimating' ? 'idle' : d.meta.status } });
      resolve(complexity);
    };
    child.on('error', () => finish(null));
    child.on('close', () => {
      let c = null;
      try {
        c = String(JSON.parse(out).result || '').trim().toUpperCase().match(/\b([SML])\b/)?.[1] || null;
      } catch {
        /* salida inesperada → M */
      }
      finish(c);
    });
  });
}
