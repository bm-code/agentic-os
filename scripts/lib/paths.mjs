// Rutas y utilidades de sistema de archivos, multiplataforma (macOS / Windows / Linux).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AOS_HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LOCAL_DIR = path.join(AOS_HOME, '.local');
export const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

/** Ruta con barras normales: válida en Node, Git Bash y PowerShell. */
export function toPosix(p) {
  return p.replace(/\\/g, '/');
}

export function expandHome(p) {
  if (!p) return p;
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(1));
  return p;
}

/** Normaliza para comparar rutas: absoluta, barras normales, sin barra final; minúsculas en Windows. */
export function normalizeForCompare(p, platform = process.platform) {
  let s;
  if (platform === 'win32') {
    s = toPosix(expandHome(p));
    // Git Bash (/c/Users/...) → c:/Users/...
    const m = s.match(/^\/([a-zA-Z])(\/.*)?$/);
    if (m) s = `${m[1]}:${m[2] || '/'}`;
    if (process.platform === 'win32') s = toPosix(path.resolve(s));
    s = s.toLowerCase();
  } else {
    s = toPosix(path.resolve(expandHome(p)));
  }
  return s.length > 1 ? s.replace(/\/+$/, '') : s;
}

/** ¿`child` está dentro de `parent` (o es la misma ruta)? */
export function isUnder(child, parent, platform = process.platform) {
  const c = normalizeForCompare(child, platform);
  const p = normalizeForCompare(parent, platform);
  return c === p || c.startsWith(p + '/');
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function readText(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

export function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

export async function readStdinJson() {
  const raw = await readStdin();
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Identificador estable de este equipo (se elige en la instalación, se guarda en .local/). */
export function machineId() {
  const saved = readJson(path.join(LOCAL_DIR, 'machine.json'), null);
  if (saved?.id) return saved.id;
  return defaultMachineId();
}

export function defaultMachineId() {
  return os.hostname().replace(/\.local$/i, '').replace(/[^A-Za-z0-9_-]+/g, '-');
}

export function setMachineId(id) {
  writeJson(path.join(LOCAL_DIR, 'machine.json'), { id, platform: process.platform, hostname: os.hostname() });
}

export function today(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function slugify(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
