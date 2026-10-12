#!/usr/bin/env node
// Hook SessionStart: inyecta el brief del proyecto (contexto + tareas + último handoff).
// Lo que se imprime por stdout entra en el contexto de Claude.
import { spawnSync } from 'node:child_process';
import { AOS_HOME, readStdinJson } from '../lib/paths.mjs';
import { loadConfig } from '../lib/config.mjs';
import { resolveProject } from '../lib/registry.mjs';
import { buildBrief } from '../lib/memory.mjs';
import { markActive, logSession } from '../lib/sessions.mjs';

try {
  const input = await readStdinJson();
  const cwd = input.cwd || process.cwd();
  const cfg = loadConfig();

  if (cfg.sync.pullOnSessionStart && input.source === 'startup') {
    spawnSync('git', ['pull', '--rebase', '--autostash', '-q'], { cwd: AOS_HOME, timeout: 8000 });
  }

  const project = resolveProject(cwd);
  markActive({ ...input, cwd, slug: project?.slug });
  if (input.source === 'startup') logSession({ event: 'start', session: input.session_id, slug: project?.slug || null, cwd });

  if (project) {
    process.stdout.write(buildBrief(project, cfg) + '\n');
  } else if (input.source === 'startup') {
    process.stdout.write('Agentic OS: este directorio no está registrado. Si es un proyecto de trabajo habitual, sugiere una vez /aos-register (sin insistir).\n');
  }
} catch (e) {
  // Un hook nunca debe romper la sesión.
  process.stderr.write(`agentic-os session-start: ${e.message}\n`);
}
