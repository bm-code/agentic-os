#!/usr/bin/env node
// CLI del Agentic OS. Lo usan las skills (/aos-*) y también tú directamente:
//   node scripts/aos.mjs <comando> [args]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AOS_HOME, CLAUDE_HOME, machineId, readJson, readStdin, slugify, toPosix } from './lib/paths.mjs';
import { loadConfig } from './lib/config.mjs';
import { findProject, loadRegistry, projectDir, resolveProject, upsertProject } from './lib/registry.mjs';
import { addTask, completeTask, listTasks, reopenTask, sortOpen } from './lib/tasks.mjs';
import { addDecision, buildBrief, latestHandoff, remember, writeHandoff } from './lib/memory.mjs';
import { activeFor } from './lib/sessions.mjs';
import { agentsSourceDir, listProjectAgents, syncProjectAgents } from './lib/agents.mjs';
import { aggregate, fmtTokens, refreshUsage, totalTokens } from './lib/usage.mjs';

const HELP = `Agentic OS — comandos:
  where                              Proyecto del directorio actual
  brief [--slug s]                   Brief que se inyecta al iniciar sesión
  register --slug s [--name n] [--repo url] [--path p] [--tags a,b]
  task add "título" [--p P0-P3] [--tags a,b] [--due YYYY-MM-DD] [--slug s]
  task list [--all] [--slug s] | task next [--slug s] | task done|reopen <id> [--slug s]
  agents list|sync|path [--slug s]       Agentes del proyecto (sync → <repo>/.claude/agents)
  remember "texto" [--global] [--slug s]
  decision "título" [--slug s]       (cuerpo por stdin)
  handoff [--slug s] [--session id]  (cuerpo por stdin)
  status                             Resumen de todos los proyectos
  usage [--days 7] [--json] [--refresh]
  sync [-m "mensaje"]                git pull --rebase + commit + push del OS
  doctor                             Comprueba la instalación`;

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opt[k] = true;
      else opt[k] = argv[++i];
    } else if (a === '-m') opt.m = argv[++i];
    else pos.push(a);
  }
  return { pos, opt };
}

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

function currentProject(opt) {
  if (opt.slug) return findProject(opt.slug) || fail(`No existe el proyecto "${opt.slug}". Usa: aos register`);
  return (
    resolveProject(process.cwd()) ||
    fail(`Este directorio no está registrado en el Agentic OS (${toPosix(process.cwd())}). Usa /aos-register o pasa --slug.`)
  );
}

const list = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

function git(args, opts = {}) {
  return spawnSync('git', args, { cwd: AOS_HOME, encoding: 'utf8', ...opts });
}

const commands = {
  where() {
    const p = resolveProject(process.cwd());
    console.log(p ? `${p.slug}\t${p.name}\t${toPosix(projectDir(p.slug))}` : '(sin registrar)');
  },

  brief({ opt }) {
    console.log(buildBrief(currentProject(opt), loadConfig()));
  },

  register({ opt }) {
    const localPath = opt.path || process.cwd();
    const slug = slugify(opt.slug || path.basename(localPath));
    if (!slug) fail('Slug vacío');
    let repo = opt.repo;
    if (!repo) {
      const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: localPath, encoding: 'utf8' });
      if (r.status === 0) repo = r.stdout.trim();
    }
    const p = upsertProject({ slug, name: opt.name, repo, localPath, tags: list(opt.tags) });
    console.log(`✓ Registrado ${p.slug} (${p.name}) en el equipo "${machineId()}"`);
    console.log(`  ruta local: ${toPosix(p.paths[machineId()])}`);
    console.log(`  memoria:    ${toPosix(projectDir(p.slug))}`);
  },

  task({ pos, opt }) {
    const sub = pos[1] || 'list';
    const p = currentProject(opt);
    if (sub === 'add') {
      const title = pos.slice(2).join(' ');
      if (!title) fail('Falta el título');
      const prio = String(opt.p || 'P2').toUpperCase();
      if (!/^P[0-3]$/.test(prio)) fail('Prioridad válida: P0-P3');
      const t = addTask(p.slug, { title, prio, tags: list(opt.tags), due: typeof opt.due === 'string' ? opt.due : null });
      console.log(`✓ [${t.id}] (${t.prio}) ${t.title}`);
    } else if (sub === 'done') {
      const t = completeTask(p.slug, pos[2]) || fail(`No encuentro la tarea ${pos[2]}`);
      console.log(`✓ Hecha: [${t.id}] ${t.title}`);
    } else if (sub === 'reopen') {
      const t = reopenTask(p.slug, pos[2]) || fail(`No encuentro la tarea ${pos[2]}`);
      console.log(`✓ Reabierta: [${t.id}] (${t.prio}) ${t.title}`);
    } else if (sub === 'next') {
      const t = sortOpen(listTasks(p.slug))[0];
      console.log(t ? `[${t.id}] (${t.prio}) ${t.title}` : 'No hay tareas abiertas.');
    } else if (sub === 'list') {
      const all = listTasks(p.slug);
      const shown = opt.all ? all : sortOpen(all);
      if (!shown.length) return console.log('No hay tareas abiertas.');
      for (const t of shown)
        console.log(`${t.done ? '✓' : '·'} [${t.id}] (${t.prio}) ${t.title}${t.tags.length ? ' #' + t.tags.join(' #') : ''}${t.due ? ' @' + t.due : ''}`);
    } else fail(`Subcomando desconocido: task ${sub}`);
  },

  agents({ pos, opt }) {
    const sub = pos[1] || 'list';
    const p = currentProject(opt);
    if (sub === 'path') return console.log(toPosix(agentsSourceDir(p.slug)));
    if (sub === 'sync') {
      const r = syncProjectAgents(p);
      return console.log(r.skipped ? `✗ ${r.skipped}` : `✓ Agentes sincronizados en ${toPosix(path.join(p.paths[machineId()], '.claude', 'agents'))} (${r.synced} actualizados, ${r.removed} eliminados; excluidos de git en local)`);
    }
    if (sub === 'list') {
      const list = listProjectAgents(p.slug);
      if (!list.length) return console.log('Sin agentes de proyecto. Genera el roster con /aos-agents.');
      for (const a of list) console.log(`${a.name.padEnd(28)} ${(a.meta.model || 'inherit').padEnd(7)} ${a.meta.description || ''}`);
      return;
    }
    fail(`Subcomando desconocido: agents ${sub}`);
  },

  remember({ pos, opt }) {
    const text = pos.slice(1).join(' ');
    if (!text) fail('Falta el texto');
    const slug = opt.global ? null : currentProject(opt).slug;
    console.log(`✓ Guardado en ${toPosix(remember(slug, text, { global: !!opt.global }))}`);
  },

  async decision({ pos, opt }) {
    const title = pos.slice(1).join(' ');
    if (!title) fail('Falta el título');
    console.log(`✓ Decisión añadida a ${toPosix(addDecision(currentProject(opt).slug, title, await readStdin()))}`);
  },

  async handoff({ opt }) {
    const p = currentProject(opt);
    const body = await readStdin();
    if (!body.trim()) fail('El handoff va por stdin');
    const session = typeof opt.session === 'string' ? opt.session : activeFor(process.cwd())?.sessionId;
    console.log(`✓ Handoff guardado en ${toPosix(writeHandoff(p.slug, session, body))}`);
  },

  status() {
    const reg = loadRegistry();
    const me = machineId();
    if (!reg.projects.length) return console.log('No hay proyectos registrados. Abre Claude en un proyecto y usa /aos-register.');
    for (const p of reg.projects) {
      const open = sortOpen(listTasks(p.slug));
      const h = latestHandoff(p.slug);
      const here = p.paths?.[me] ? '' : '  (no clonado en este equipo)';
      console.log(`■ ${p.name} [${p.slug}]${here}`);
      console.log(`  tareas abiertas: ${open.length}${open[0] ? ` · siguiente: (${open[0].prio}) ${open[0].title}` : ''}`);
      console.log(`  última sesión:  ${h ? h.name.slice(0, 10) + (h.auto ? ' (auto)' : '') : '—'}`);
    }
  },

  usage({ opt }) {
    const cache = refreshUsage();
    if (opt.refresh && !opt.json) return console.log(`✓ Caché de uso actualizada (${Object.keys(cache.files).length} transcripts)`);
    const days = Number(opt.days || 7);
    const agg = aggregate(cache, { days });
    if (opt.json) return console.log(JSON.stringify(agg, null, 2));
    const row = (label, b) => `${label.padEnd(26)} ${fmtTokens(totalTokens(b)).padStart(7)}  (out ${fmtTokens(b.out)}, cache-read ${fmtTokens(b.cr)}, ${b.msgs} msgs)`;
    console.log(`Consumo (tokens) · últimos ${days} días\n`);
    console.log(row('Ventana 5 h (aprox.)', agg.last5h));
    console.log(row('Hoy', agg.today));
    console.log(row(`Total ${days} d`, agg.total));
    console.log('\nPor modelo');
    for (const [m, b] of Object.entries(agg.byModel).sort((a, b) => totalTokens(b[1]) - totalTokens(a[1]))) console.log(row('  ' + m, b));
    console.log('\nPor proyecto');
    for (const [s, b] of Object.entries(agg.byProject).sort((a, b) => totalTokens(b[1]) - totalTokens(a[1]))) console.log(row('  ' + s, b));
  },

  sync({ opt }) {
    const run = (args) => {
      const r = git(args, { stdio: 'inherit' });
      if (r.status !== 0) fail(`git ${args.join(' ')} falló`);
    };
    const dirty = git(['status', '--porcelain']).stdout.trim();
    if (dirty) {
      run(['add', '-A']);
      run(['commit', '-q', '-m', opt.m || `aos: sync ${machineId()} ${new Date().toISOString().slice(0, 16)}`]);
    }
    run(['pull', '--rebase', '--autostash', '-q']);
    run(['push', '-q']);
    console.log('✓ Agentic OS sincronizado');
  },

  doctor() {
    const settings = readJson(path.join(CLAUDE_HOME, 'settings.json'), {});
    const checks = [
      ['Node >= 20', Number(process.versions.node.split('.')[0]) >= 20],
      ['git disponible', git(['--version']).status === 0],
      ['Equipo identificado (.local/machine.json)', fs.existsSync(path.join(AOS_HOME, '.local', 'machine.json'))],
      ['Hook SessionStart instalado', JSON.stringify(settings.hooks?.SessionStart || []).includes('session-start.mjs')],
      ['Statusline instalada', String(settings.statusLine?.command || '').includes('statusline.mjs')],
      ['Skills /aos-* instaladas', fs.existsSync(path.join(CLAUDE_HOME, 'skills', 'aos-task', 'SKILL.md'))],
      ['CLAUDE.md global importa el OS', fs.existsSync(path.join(CLAUDE_HOME, 'CLAUDE.md')) && fs.readFileSync(path.join(CLAUDE_HOME, 'CLAUDE.md'), 'utf8').includes('agentic-os:managed')],
    ];
    for (const [label, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${label}`);
    console.log(`\nEquipo: ${machineId()} · AOS: ${toPosix(AOS_HOME)} · Claude: ${toPosix(CLAUDE_HOME)}`);
    if (checks.some(([, ok]) => !ok)) console.log('→ Ejecuta: node scripts/install.mjs');
  },
};

const { pos, opt } = parseArgs(process.argv.slice(2));
const cmd = pos[0];
if (!cmd || cmd === 'help' || opt.help) console.log(HELP);
else if (!commands[cmd]) fail(`Comando desconocido: ${cmd}\n\n${HELP}`);
else await commands[cmd]({ pos, opt });
