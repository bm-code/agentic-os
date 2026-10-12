#!/usr/bin/env node
// Statusline: proyecto · modelo · % de contexto · consumo de la ventana de 5 h.
// Tiene que ser rápida: lee la caché de uso y, si está vieja, la refresca en segundo plano.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AOS_HOME, readStdinJson } from './lib/paths.mjs';
import { loadConfig } from './lib/config.mjs';
import { resolveProject } from './lib/registry.mjs';
import { lastContextTokens } from './lib/transcript.mjs';
import { CACHE_FILE, aggregate, fmtTokens, loadUsageCache, totalTokens } from './lib/usage.mjs';

const C = { dim: '\x1b[2m', red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', cyan: '\x1b[36m', reset: '\x1b[0m' };
const color = (pct) => (pct >= 80 ? C.red : pct >= 60 ? C.yellow : C.green);

try {
  const input = await readStdinJson();
  const cfg = loadConfig();
  const cwd = input.workspace?.current_dir || input.cwd || process.cwd();
  const parts = [];

  const project = resolveProject(cwd);
  parts.push(project ? `${C.cyan}${project.slug}${C.reset}` : `${C.dim}${path.basename(cwd)}${C.reset}`);
  parts.push(input.model?.display_name || input.model?.id || '?');

  // Contexto: el dato de Claude Code si viene; si no, lo calculamos del transcript.
  let ctxPct = input.context_window?.used_percentage;
  if (ctxPct == null && input.transcript_path) {
    const used = lastContextTokens(input.transcript_path);
    let size = input.context_window?.context_window_size || (/\[1m\]/i.test(input.model?.id || '') ? 1_000_000 : cfg.usage.contextWindow);
    if (used > size) size = 1_000_000; // modelos con ventana de 1M
    if (used != null) ctxPct = (used / size) * 100;
  }
  if (ctxPct != null) {
    const pct = Math.round(ctxPct);
    parts.push(`${color(pct)}ctx ${pct}%${C.reset}${pct >= 60 ? ' → /aos-handoff + /clear' : ''}`);
  }

  // Límites del plan: el % real si Claude Code lo expone; si no, tokens consumidos en 5 h.
  const five = input.rate_limits?.five_hour;
  if (five?.used_percentage != null) {
    const pct = Math.round(five.used_percentage);
    parts.push(`${color(pct)}5h ${pct}%${C.reset}`);
  } else {
    const cache = loadUsageCache();
    if (cache) parts.push(`${C.dim}5h ${fmtTokens(totalTokens(aggregate(cache, { days: 1 }).last5h))} tok${C.reset}`);
    const age = cache ? (Date.now() - Date.parse(cache.updatedAt)) / 1000 : Infinity;
    if (age > cfg.usage.staleSeconds) {
      const lock = CACHE_FILE + '.lock';
      const lockAge = fs.existsSync(lock) ? (Date.now() - fs.statSync(lock).mtimeMs) / 1000 : Infinity;
      if (lockAge > 60) {
        fs.mkdirSync(path.dirname(lock), { recursive: true });
        fs.writeFileSync(lock, '');
        const child = spawn(process.execPath, [path.join(AOS_HOME, 'scripts', 'aos.mjs'), 'usage', '--refresh'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
      }
    }
  }
  const week = input.rate_limits?.seven_day;
  if (week?.used_percentage != null) parts.push(`${color(week.used_percentage)}7d ${Math.round(week.used_percentage)}%${C.reset}`);

  process.stdout.write(parts.join(` ${C.dim}·${C.reset} `));
} catch (e) {
  process.stdout.write(`aos: ${e.message}`);
}
