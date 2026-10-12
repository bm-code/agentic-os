// Operaciones git del panel tipo VS Code. Sin shell (spawn con argumentos) y con timeout.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function git(cwd, args, { timeout = 60000, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function must(cwd, args, opts) {
  const r = await git(cwd, args, opts);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || `git ${args[0]} falló`).trim().split('\n').slice(-3).join('\n'));
  return r.stdout;
}

const XY = { M: 'M', A: 'A', D: 'D', R: 'R', C: 'C', T: 'M', U: 'U' };

/** Parser de `git status --porcelain=v2 --branch -z`. */
export function parseStatus(out) {
  const res = { branch: null, upstream: null, ahead: 0, behind: 0, detached: false, files: [] };
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (!line) continue;
    if (line.startsWith('# branch.head ')) {
      res.branch = line.slice(14);
      res.detached = res.branch === '(detached)';
    } else if (line.startsWith('# branch.upstream ')) res.upstream = line.slice(18);
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) [res.ahead, res.behind] = [Number(m[1]), Number(m[2])];
    } else if (line[0] === '1' || line[0] === '2') {
      const f = line.split(' ');
      const xy = f[1];
      const file = line[0] === '1' ? f.slice(8).join(' ') : f.slice(9).join(' ');
      const entry = { path: file, staged: xy[0] !== '.', status: XY[xy[0] !== '.' ? xy[0] : xy[1]] || 'M' };
      if (line[0] === '2') entry.from = parts[++i]; // renombrado: el origen viene en el siguiente campo
      res.files.push(entry);
    } else if (line[0] === 'u') {
      res.files.push({ path: line.split(' ').slice(10).join(' '), staged: false, status: 'U' });
    } else if (line[0] === '?') {
      res.files.push({ path: line.slice(2), staged: false, status: '?' });
    }
  }
  return res;
}

export async function isRepo(cwd) {
  return (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).stdout.trim() === 'true';
}

export async function status(cwd) {
  if (!(await isRepo(cwd))) return { repo: false };
  const out = await must(cwd, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
  const s = parseStatus(out);
  const last = await git(cwd, ['log', '-1', '--format=%h%x09%s%x09%cr']);
  const [hash, subject, when] = last.stdout.trim().split('\t');
  const remotes = (await git(cwd, ['remote'])).stdout.trim().split('\n').filter(Boolean);
  return { repo: true, ...s, remotes, lastCommit: hash ? { hash, subject, when } : null };
}

/** Cambios en archivos versionados (los no versionados no impiden cambiar de rama). */
export async function hasTrackedChanges(cwd) {
  const s = parseStatus(await must(cwd, ['status', '--porcelain=v2', '-z', '--untracked-files=no']));
  return s.files.length > 0;
}

const MAX_DIFF = 200_000;

export async function diff(cwd, file, { base } = {}) {
  if (file && (path.isAbsolute(file) || path.relative(cwd, path.join(cwd, file)).startsWith('..'))) throw new Error('Ruta fuera del repositorio');
  if (base) {
    const out = await must(cwd, ['diff', '--no-color', `${base}...HEAD`, ...(file ? ['--', file] : [])]);
    const wt = await git(cwd, ['diff', '--no-color', 'HEAD', ...(file ? ['--', file] : [])]);
    return clip(out + wt.stdout);
  }
  const st = parseStatus(await must(cwd, ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--', file]));
  if (st.files[0]?.status === '?') {
    // Archivo nuevo sin versionar: se muestra entero como añadido.
    const abs = path.join(cwd, file);
    const content = fs.statSync(abs).size > MAX_DIFF ? '(archivo grande)\n' : fs.readFileSync(abs, 'utf8');
    return clip(`--- /dev/null\n+++ b/${file}\n` + content.split('\n').map((l) => '+' + l).join('\n'));
  }
  const out = await must(cwd, ['diff', '--no-color', 'HEAD', '--', file]);
  return clip(out);
}

function clip(s) {
  return s.length > MAX_DIFF ? s.slice(0, MAX_DIFF) + '\n… (diff recortado)' : s;
}

export async function commit(cwd, message, files) {
  if (!message?.trim()) throw new Error('El mensaje de commit está vacío');
  if (files?.length) await must(cwd, ['add', '--', ...files]);
  else await must(cwd, ['add', '-A']);
  return must(cwd, ['commit', '-F', '-'], { input: message.trim() + '\n' });
}

export async function fetch(cwd) {
  return must(cwd, ['fetch', '--prune'], { timeout: 120000 });
}

/** Como el "Sync" de VS Code: trae (rebase) y sube. Publica la rama si no tiene upstream. */
export async function sync(cwd) {
  const s = await status(cwd);
  if (!s.repo) throw new Error('No es un repositorio git');
  if (!s.remotes.length) throw new Error('El repositorio no tiene remotos');
  if (s.detached) throw new Error('HEAD está desacoplado (detached): cambia a una rama');
  if (!s.upstream) {
    await must(cwd, ['push', '-u', s.remotes.includes('origin') ? 'origin' : s.remotes[0], s.branch], { timeout: 120000 });
    return 'Rama publicada';
  }
  await must(cwd, ['pull', '--rebase', '--autostash'], { timeout: 120000 });
  await must(cwd, ['push'], { timeout: 120000 });
  return 'Sincronizado';
}

export async function branches(cwd) {
  const out = await must(cwd, ['branch', '--format=%(refname:short)']);
  return out.split('\n').filter(Boolean);
}

export async function checkout(cwd, branch, { create = false } = {}) {
  if (!/^[\w./-]+$/.test(branch) || branch.startsWith('-')) throw new Error('Nombre de rama no válido');
  return must(cwd, create ? ['checkout', '-b', branch] : ['checkout', branch]);
}
