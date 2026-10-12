// Registro de proyectos: cada proyecto vive en su propio repo; aquí solo guardamos
// su identidad y la ruta donde está clonado en cada equipo.
import fs from 'node:fs';
import path from 'node:path';
import { AOS_HOME, expandHome, isUnder, machineId, normalizeForCompare, readJson, today, writeJson } from './paths.mjs';

export const REGISTRY_FILE = path.join(AOS_HOME, 'registry', 'projects.json');

export function loadRegistry(file = REGISTRY_FILE) {
  const data = readJson(file, { projects: [] });
  if (!Array.isArray(data.projects)) data.projects = [];
  return data;
}

export function saveRegistry(data, file = REGISTRY_FILE) {
  data.projects.sort((a, b) => a.slug.localeCompare(b.slug));
  writeJson(file, data);
}

export function projectDir(slug) {
  return path.join(AOS_HOME, 'projects', slug);
}

/** Proyecto que contiene `cwd` en este equipo (gana la ruta más larga, por si hay anidados). */
export function resolveProject(cwd, { registry = loadRegistry(), machine = machineId(), platform = process.platform } = {}) {
  if (!cwd) return null;
  let best = null;
  let bestLen = -1;
  for (const p of registry.projects) {
    const local = p.paths?.[machine];
    if (!local) continue;
    if (isUnder(cwd, local, platform)) {
      const len = normalizeForCompare(local, platform).length;
      if (len > bestLen) {
        best = p;
        bestLen = len;
      }
    }
  }
  return best;
}

export function findProject(slug, registry = loadRegistry()) {
  return registry.projects.find((p) => p.slug === slug) || null;
}

/** Crea o actualiza un proyecto y su carpeta de memoria. Nunca toca el repo del proyecto. */
export function upsertProject({ slug, name, repo, localPath, tags }, machine = machineId()) {
  const registry = loadRegistry();
  let p = findProject(slug, registry);
  if (!p) {
    p = { slug, name: name || slug, repo: repo || '', tags: [], paths: {}, created: today() };
    registry.projects.push(p);
  }
  if (name) p.name = name;
  if (repo) p.repo = repo;
  if (tags?.length) p.tags = [...new Set([...(p.tags || []), ...tags])];
  if (localPath) p.paths = { ...(p.paths || {}), [machine]: path.resolve(expandHome(localPath)) };
  saveRegistry(registry);
  scaffoldProject(p);
  return p;
}

export function scaffoldProject(p) {
  const dir = projectDir(p.slug);
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  const files = {
    'context.md': `# ${p.name}\n\n<!-- Contexto persistente del proyecto (≤ 60 líneas). Se inyecta al inicio de cada sesión. -->\n\n## Qué es\n\n## Stack y comandos\n\n## Convenciones / gotchas\n\n## Notas\n`,
    'tasks.md': `# Tareas · ${p.name}\n\n## Pendientes\n\n## Hechas\n`,
    'decisions.md': `# Decisiones · ${p.name}\n\n<!-- ADRs breves: fecha, decisión, motivo. -->\n`,
  };
  for (const [f, content] of Object.entries(files)) {
    const target = path.join(dir, f);
    if (!fs.existsSync(target)) fs.writeFileSync(target, content);
  }
  const keep = path.join(dir, 'sessions', '.gitkeep');
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');
}
