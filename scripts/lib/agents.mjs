// Agentes específicos de cada proyecto.
// Fuente de verdad: projects/<slug>/agents/aos-*.md (sincronizado entre equipos).
// Se copian a <repo>/.claude/agents/ y se excluyen de git SOLO en local (.git/info/exclude),
// así Claude los carga al abrirse en el repo sin modificar ningún archivo versionado.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { machineId } from './paths.mjs';
import { projectDir } from './registry.mjs';

export const EXCLUDE_PATTERN = '/.claude/agents/aos-*';

export function agentsSourceDir(slug) {
  return path.join(projectDir(slug), 'agents');
}

export function listProjectAgents(slug) {
  const dir = agentsSourceDir(slug);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^aos-.*\.md$/.test(f))
    .map((f) => ({ file: path.join(dir, f), name: f.replace(/\.md$/, ''), ...parseAgent(fs.readFileSync(path.join(dir, f), 'utf8')) }));
}

/** Frontmatter mínimo (name, description, model, tools) + cuerpo. */
export function parseAgent(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, prompt: md.trim() };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, prompt: m[2].trim() };
}

function gitExcludeFile(repo) {
  const r = spawnSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) return null;
  const p = r.stdout.trim();
  return path.isAbsolute(p) ? p : path.join(repo, p);
}

export function ensureExcluded(repo) {
  const file = gitExcludeFile(repo);
  if (!file) return false; // no es un repo git: no hay nada que excluir
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current.split(/\r?\n/).includes(EXCLUDE_PATTERN)) return true;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, current.replace(/\s*$/, '\n') + `# agentic-os: agentes locales del OS\n${EXCLUDE_PATTERN}\n`);
  return true;
}

/**
 * Copia los agentes del proyecto a <repo>/.claude/agents/. Idempotente y barata (solo escribe si cambia).
 * Borra los aos-<slug>-* que ya no existen en la fuente; nunca toca agentes propios del repo.
 */
export function syncProjectAgents(project, machine = machineId()) {
  const repo = project.paths?.[machine];
  if (!repo || !fs.existsSync(repo)) return { synced: 0, removed: 0, skipped: 'sin ruta local' };
  const agents = listProjectAgents(project.slug);
  const dest = path.join(repo, '.claude', 'agents');
  const existing = fs.existsSync(dest) ? fs.readdirSync(dest).filter((f) => f.startsWith(`aos-${project.slug}-`)) : [];
  if (!agents.length && !existing.length) return { synced: 0, removed: 0 };

  ensureExcluded(repo);
  fs.mkdirSync(dest, { recursive: true });
  let synced = 0;
  let removed = 0;
  const wanted = new Set();
  for (const a of agents) {
    const target = path.join(dest, path.basename(a.file));
    wanted.add(path.basename(a.file));
    const content = fs.readFileSync(a.file, 'utf8');
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) {
      fs.writeFileSync(target, content);
      synced++;
    }
  }
  for (const f of existing) {
    if (!wanted.has(f)) {
      fs.rmSync(path.join(dest, f));
      removed++;
    }
  }
  return { synced, removed };
}
