// Sesiones activas por directorio: permite que el CLI (llamado desde una skill) sepa
// qué sesión y transcript corresponden al proyecto actual sin que Claude tenga que saberlo.
import path from 'node:path';
import fs from 'node:fs';
import { LOCAL_DIR, normalizeForCompare, readJson, writeJson } from './paths.mjs';

const FILE = path.join(LOCAL_DIR, 'active-sessions.json');
const LOG = path.join(LOCAL_DIR, 'sessions.jsonl');

export function markActive({ session_id, transcript_path, cwd, slug }) {
  if (!session_id || !cwd) return;
  const all = readJson(FILE, {});
  const weekAgo = Date.now() - 7 * 86400e3;
  for (const [k, v] of Object.entries(all)) if (Date.parse(v.at) < weekAgo) delete all[k];
  all[normalizeForCompare(cwd)] = { sessionId: session_id, transcript: transcript_path, slug, at: new Date().toISOString() };
  writeJson(FILE, all);
}

export function activeFor(cwd) {
  const all = readJson(FILE, {});
  const key = normalizeForCompare(cwd);
  if (all[key]) return all[key];
  // El Bash de Claude puede estar en un subdirectorio del proyecto.
  let best = null;
  for (const [k, v] of Object.entries(all)) if (key.startsWith(k + '/') && (!best || k.length > best.k.length)) best = { k, v };
  return best?.v || null;
}

export function logSession(event) {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');
}
