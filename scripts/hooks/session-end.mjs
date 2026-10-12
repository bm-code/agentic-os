#!/usr/bin/env node
// Hook PreCompact y SessionEnd: guarda un handoff automático (mecánico, sin coste de tokens)
// para no perder el hilo aunque no se haya ejecutado /aos-handoff.
//   node session-end.mjs            → SessionEnd
//   node session-end.mjs compact    → PreCompact
import { spawnSync } from 'node:child_process';
import { AOS_HOME, machineId, readStdinJson } from '../lib/paths.mjs';
import { loadConfig } from '../lib/config.mjs';
import { resolveProject } from '../lib/registry.mjs';
import { writeAutoHandoff } from '../lib/memory.mjs';
import { logSession } from '../lib/sessions.mjs';

const mode = process.argv[2] === 'compact' ? 'compact' : 'end';

try {
  const input = await readStdinJson();
  const cfg = loadConfig();
  const project = resolveProject(input.cwd || process.cwd());

  const enabled = mode === 'compact' ? cfg.handoff.autoOnCompact : cfg.handoff.autoOnSessionEnd;
  let file = null;
  if (project && enabled && input.transcript_path) {
    file = writeAutoHandoff(project.slug, input.transcript_path, input.session_id, mode === 'compact' ? `antes de compactar (${input.trigger || 'auto'})` : `fin de sesión (${input.reason || 'exit'})`, project.paths?.[machineId()]);
  }
  logSession({ event: mode, session: input.session_id, slug: project?.slug || null, reason: input.reason || input.trigger, handoff: !!file });

  if (mode === 'end' && project && cfg.sync.commitOnSessionEnd) {
    spawnSync('git', ['add', '-A'], { cwd: AOS_HOME });
    spawnSync('git', ['commit', '-q', '-m', `aos: sesión ${project.slug} (${machineId()})`], { cwd: AOS_HOME });
  }
} catch (e) {
  process.stderr.write(`agentic-os ${mode}: ${e.message}\n`);
}
