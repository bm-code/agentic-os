#!/usr/bin/env node
// Dashboard local del Agentic OS (solo escucha en 127.0.0.1). Sin dependencias.
//   npm run dashboard   →  http://localhost:4747
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { machineId, readText, toPosix } from '../scripts/lib/paths.mjs';
import { loadConfig } from '../scripts/lib/config.mjs';
import { findProject, loadRegistry, projectDir } from '../scripts/lib/registry.mjs';
import { addTask, completeTask, listTasks } from '../scripts/lib/tasks.mjs';
import { compactMarkdown, latestHandoff } from '../scripts/lib/memory.mjs';
import { aggregate, refreshUsage } from '../scripts/lib/usage.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const cfg = loadConfig();
const port = Number(process.env.PORT || cfg.dashboard.port);

function data(days) {
  const registry = loadRegistry();
  const me = machineId();
  const usage = aggregate(refreshUsage(), { days, registry });
  const projects = registry.projects.map((p) => {
    const h = latestHandoff(p.slug);
    return {
      slug: p.slug,
      name: p.name,
      repo: p.repo,
      tags: p.tags || [],
      localPath: p.paths?.[me] ? toPosix(p.paths[me]) : null,
      memoryDir: toPosix(projectDir(p.slug)),
      tasks: listTasks(p.slug),
      handoff: h ? { date: h.name.slice(0, 10), auto: h.auto, text: compactMarkdown(readText(h.file)) } : null,
    };
  });
  return { machine: me, days, generatedAt: new Date().toISOString(), usage, projects };
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // Defensa básica: solo peticiones del propio dashboard (evita que otra web local escriba tareas).
    if (req.method !== 'GET' && req.headers.origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.origin)) {
      return send(res, 403, { error: 'origen no permitido' });
    }
    if (req.method === 'GET' && url.pathname === '/api/data') {
      return send(res, 200, data(Math.min(Number(url.searchParams.get('days') || 30), 365)));
    }
    let m;
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/tasks$/))) {
      if (!findProject(m[1])) return send(res, 404, { error: 'proyecto no encontrado' });
      const { title, prio = 'P2' } = await readBody(req);
      if (!title?.trim() || !/^P[0-3]$/.test(prio)) return send(res, 400, { error: 'título o prioridad no válidos' });
      return send(res, 200, addTask(m[1], { title, prio }));
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/tasks\/([a-z0-9]+)\/done$/))) {
      if (!findProject(m[1])) return send(res, 404, { error: 'proyecto no encontrado' });
      const t = completeTask(m[1], m[2]);
      return t ? send(res, 200, t) : send(res, 404, { error: 'tarea no encontrada' });
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    send(res, 404, { error: 'no encontrado' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${port}`;
  console.log(`Agentic OS dashboard → ${url}  (Ctrl+C para salir)`);
  if (!process.argv.includes('--no-open')) {
    const opener = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(opener, () => {});
  }
});
