import path from 'node:path';
import { AOS_HOME, LOCAL_DIR, readJson } from './paths.mjs';

const DEFAULTS = {
  brief: { maxContextLines: 25, maxTasks: 5, maxHandoffLines: 15 },
  handoff: { autoOnCompact: true, autoOnSessionEnd: true },
  sync: { pullOnSessionStart: false, commitOnSessionEnd: false },
  usage: { staleSeconds: 120, contextWindow: 200000 },
  dashboard: { port: 4747 },
};

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(base[k] || {}, v) : v;
  }
  return out;
}

/** os.config.json (sincronizado) + .local/config.json (overrides de este equipo). */
export function loadConfig() {
  const shared = readJson(path.join(AOS_HOME, 'os.config.json'), {});
  const local = readJson(path.join(LOCAL_DIR, 'config.json'), {});
  return merge(merge(DEFAULTS, shared), local);
}
