#!/usr/bin/env node
// Instala / actualiza el Agentic OS en ~/.claude. Idempotente: vuelve a ejecutarlo tras cada `git pull`.
//   node scripts/install.mjs [--machine NOMBRE] [--force-model] [--uninstall]
import fs from 'node:fs';
import path from 'node:path';
import { AOS_HOME, CLAUDE_HOME, LOCAL_DIR, defaultMachineId, machineId, readJson, setMachineId, toPosix, writeJson } from './lib/paths.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const valueOf = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);

const AOS = toPosix(AOS_HOME);
const SRC = path.join(AOS_HOME, 'claude');
const MARK_BEGIN = '<!-- agentic-os:begin -->';
const MARK_END = '<!-- agentic-os:end -->';
const MANAGED = 'agentic-os:managed';
const isOurs = (cmd) => typeof cmd === 'string' && cmd.includes('/scripts/') && (cmd.includes(AOS) || cmd.includes('agentic-os'));
const render = (s) => s.replaceAll('{{AOS}}', AOS);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const log = (m) => console.log(m);

function backup(file) {
  if (!fs.existsSync(file)) return;
  const dest = path.join(LOCAL_DIR, 'backups', `${path.basename(file)}.${stamp}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  log(`  backup: ${toPosix(dest)}`);
}

function stripOurHooks(hooks = {}) {
  const out = {};
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = (groups || [])
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h.command)) }))
      .filter((g) => g.hooks.length);
    if (kept.length) out[event] = kept;
  }
  return out;
}

function mergeSettings(current, base) {
  const s = structuredClone(current);
  if (base.model && (!s.model || flag('--force-model'))) s.model = base.model;
  s.env = { ...(s.env || {}), ...base.env };

  if (!s.statusLine || isOurs(s.statusLine.command)) s.statusLine = base.statusLine;
  else log('  ! Ya tienes una statusLine propia: la mantengo (la del OS está en claude/settings.base.json).');

  s.hooks = stripOurHooks(s.hooks);
  for (const [event, groups] of Object.entries(base.hooks)) s.hooks[event] = [...(s.hooks[event] || []), ...groups];

  s.permissions ||= {};
  const prevAllow = (s.permissions.allow || []).filter((r) => !r.includes(AOS));
  s.permissions.allow = [...new Set([...prevAllow, ...base.permissions.allow])];
  s.permissions.additionalDirectories = [...new Set([...(s.permissions.additionalDirectories || []), ...base.permissions.additionalDirectories])];
  return s;
}

function uninstallSettings(current) {
  const s = structuredClone(current);
  s.hooks = stripOurHooks(s.hooks);
  if (!Object.keys(s.hooks).length) delete s.hooks;
  if (s.statusLine && isOurs(s.statusLine.command)) delete s.statusLine;
  if (s.env) delete s.env.AGENTIC_OS_HOME;
  if (s.permissions?.allow) s.permissions.allow = s.permissions.allow.filter((r) => !r.includes(AOS));
  if (s.permissions?.additionalDirectories) s.permissions.additionalDirectories = s.permissions.additionalDirectories.filter((d) => d !== AOS);
  return s;
}

function writeClaudeMd(remove = false) {
  const file = path.join(CLAUDE_HOME, 'CLAUDE.md');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const re = new RegExp(`${MARK_BEGIN}[\\s\\S]*?${MARK_END}\\n?`);
  const userPart = current.replace(re, '').trim();
  if (current && !current.includes(MARK_BEGIN)) backup(file);
  const block = remove ? '' : `${MARK_BEGIN}\n${render(fs.readFileSync(path.join(SRC, 'CLAUDE.global.md'), 'utf8')).trim()}\n${MARK_END}\n`;
  const content = [block.trim(), userPart].filter(Boolean).join('\n\n') + '\n';
  fs.writeFileSync(file, content);
}

function copyManaged(kind) {
  const srcDir = path.join(SRC, kind);
  const destDir = path.join(CLAUDE_HOME, kind);
  fs.mkdirSync(destDir, { recursive: true });
  const installed = [];
  for (const name of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, name);
    if (fs.statSync(src).isDirectory()) {
      // Skills: carpeta con SKILL.md (+ ficheros auxiliares)
      const dest = path.join(destDir, name);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(dest, { recursive: true });
      for (const f of fs.readdirSync(src)) fs.writeFileSync(path.join(dest, f), render(fs.readFileSync(path.join(src, f), 'utf8')));
    } else {
      const dest = path.join(destDir, name);
      if (fs.existsSync(dest) && !fs.readFileSync(dest, 'utf8').includes(MANAGED)) backup(dest);
      fs.writeFileSync(dest, render(fs.readFileSync(src, 'utf8')).trimEnd() + `\n\n<!-- ${MANAGED} -->\n`);
    }
    installed.push(name);
  }
  return installed;
}

function removeManaged(kind) {
  const destDir = path.join(CLAUDE_HOME, kind);
  for (const name of fs.existsSync(path.join(SRC, kind)) ? fs.readdirSync(path.join(SRC, kind)) : []) {
    fs.rmSync(path.join(destDir, name), { recursive: true, force: true });
  }
}

// ── main ────────────────────────────────────────────────────────────────────
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`✗ Necesitas Node >= 20 (tienes ${process.versions.node}).`);
  process.exit(1);
}

const settingsFile = path.join(CLAUDE_HOME, 'settings.json');
const current = readJson(settingsFile, {});

if (flag('--uninstall')) {
  log('Desinstalando Agentic OS de ' + toPosix(CLAUDE_HOME));
  backup(settingsFile);
  writeJson(settingsFile, uninstallSettings(current));
  removeManaged('skills');
  removeManaged('agents');
  writeClaudeMd(true);
  log('✓ Desinstalado. Tus datos (proyectos, tareas, memoria) siguen en el repo.');
  process.exit(0);
}

log(`Agentic OS → ${toPosix(CLAUDE_HOME)}\n`);

// 1. Identidad del equipo (clave de las rutas en registry/projects.json)
const machine = valueOf('--machine') || (fs.existsSync(path.join(LOCAL_DIR, 'machine.json')) ? machineId() : defaultMachineId());
setMachineId(machine);
log(`• Equipo: ${machine}${valueOf('--machine') ? '' : '  (cámbialo con --machine NOMBRE)'}`);

// 2. settings.json (fusión, nunca sobrescritura)
backup(settingsFile);
const base = JSON.parse(render(fs.readFileSync(path.join(SRC, 'settings.base.json'), 'utf8')));
writeJson(settingsFile, mergeSettings(current, base));
log('• settings.json: hooks, statusline, permisos y env fusionados');
if (current.model && current.model !== base.model && !flag('--force-model'))
  log(`  (mantengo tu modelo "${current.model}"; usa --force-model para poner "${base.model}")`);

// 3. Skills, subagentes y CLAUDE.md global
log(`• Skills: ${copyManaged('skills').map((s) => '/' + s).join(' ')}`);
log(`• Subagentes: ${copyManaged('agents').map((a) => a.replace(/\.md$/, '')).join(', ')}`);
writeClaudeMd();
log('• ~/.claude/CLAUDE.md: bloque del OS actualizado (importa memory/global.md)');

log(`
✓ Listo. Siguientes pasos:
  1. Reinicia Claude Code (los hooks se cargan al arrancar).
  2. En cada proyecto que quieras gestionar: abre claude y ejecuta /aos-register
  3. Dashboard: npm run dashboard  ·  Diagnóstico: npm run doctor`);
