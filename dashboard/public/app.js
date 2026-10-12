'use strict';
// Agentic OS dashboard · sin frameworks. Rutas: #/ (inicio) · #/p/<slug>[/<taskId>] (proyecto)

const TOKEN = document.querySelector('meta[name="aos-token"]').content;
const MODELS = ['opus', 'sonnet', 'haiku', 'otro'];
const PRIO = { P0: 0, P1: 1, P2: 2, P3: 3 };
const STATUS = { idle: 'pendiente', estimating: 'estimando…', planning: 'planificando', 'plan-ready': 'plan listo', running: 'ejecutando', review: 'revisión', error: 'error' };
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tot = (b) => (b ? b.in + b.out + b.cr + b.cc : 0);
const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n ?? 0));
const fam = (m) => { const s = String(m || '').toLowerCase(); return MODELS.find((f) => s.includes(f)) || 'otro'; };

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, { method, headers: { 'x-aos-token': TOKEN, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

// ── toast y modal ──────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, { action, onAction, error = false, ms = 6000 } = {}) {
  $('#toastMsg').textContent = msg;
  const b = $('#toastAction');
  b.style.display = action ? '' : 'none';
  b.textContent = action || '';
  b.onclick = () => { $('#toast').classList.remove('show'); onAction?.(); };
  $('#toast').classList.toggle('error', error);
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), ms);
}
const fail = (e) => toast(e.message || String(e), { error: true, ms: 9000 });

function modal(title, html) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
}
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) $('#modal').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal').hidden = true; });

// ── mini markdown (seguro: se escapa todo antes de formatear) ───────────────────────────
function md(src) {
  const blocks = String(src || '').split(/```/);
  return blocks.map((b, i) => {
    if (i % 2) return `<pre><code>${esc(b.replace(/^\w*\n/, ''))}</code></pre>`;
    const lines = esc(b).split('\n');
    let html = '';
    let list = null;
    const inline = (t) => t.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    for (const l of lines) {
      const li = l.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
      if (li) {
        const kind = /^\s*\d+\./.test(l) ? 'ol' : 'ul';
        if (list !== kind) { if (list) html += `</${list}>`; html += `<${kind}>`; list = kind; }
        html += `<li>${inline(li[1])}</li>`;
        continue;
      }
      if (list) { html += `</${list}>`; list = null; }
      const h = l.match(/^#{1,6}\s+(.*)$/);
      if (h) html += `<h4>${inline(h[1])}</h4>`;
      else if (l.trim()) html += `<p>${inline(l)}</p>`;
    }
    if (list) html += `</${list}>`;
    return html;
  }).join('');
}

function diffHtml(text) {
  return `<pre class="diff">${String(text || '(sin cambios)').split('\n').map((l) => {
    const c = l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ') ? 'f' : l.startsWith('@@') ? 'h' : l.startsWith('+') ? 'a' : l.startsWith('-') ? 'd' : '';
    return `<span class="${c}">${esc(l) || ' '}</span>`;
  }).join('')}</pre>`;
}

// ── router ─────────────────────────────────────────────────────────────────────────────
let cleanup = [];
function onLeave(fn) { cleanup.push(fn); }
function route() {
  cleanup.forEach((fn) => fn());
  cleanup = [];
  const m = location.hash.match(/^#\/p\/([\w.-]+)(?:\/([\w]+))?/);
  if (m) projectPage(m[1], m[2] || null);
  else homePage();
}
window.addEventListener('hashchange', route);

// ════════════════════════════════════════════════════════════════════════════════════════
// INICIO
// ════════════════════════════════════════════════════════════════════════════════════════
function homePage() {
  let days = '30';
  try { days = localStorage.getItem('aos-days') || '30'; } catch {}
  app.innerHTML = `
    <header class="topbar">
      <h1>Agentic OS</h1><span class="meta" id="meta"></span><span class="spacer"></span>
      <select id="days" aria-label="Periodo"><option value="7">7 días</option><option value="30">30 días</option><option value="90">90 días</option></select>
      <button id="refresh">Actualizar</button>
    </header>
    <section class="kpis" id="kpis"></section>
    <section class="card" style="margin-bottom:16px"><h2>Tokens por día y modelo</h2><div class="legend" id="legend"></div><div id="daily"></div></section>
    <section class="grid2">
      <div class="card"><h2>Consumo por proyecto</h2><div id="byProject"></div></div>
      <div class="card"><h2>Sesiones recientes</h2><div id="sessions"></div></div>
    </section>
    <div class="row" style="margin:22px 0 10px"><h2 style="margin:0">Proyectos</h2><span class="spacer"></span><button id="registerBtn">+ Registrar proyecto</button></div>
    <section class="projects" id="projects"></section>`;
  $('#days').value = days;

  async function load() {
    try {
      const d = await api(`/api/data?days=${$('#days').value}`);
      $('#meta').textContent = `equipo ${d.machine} · ${new Date(d.generatedAt).toLocaleTimeString('es-ES')}`;
      kpis(d); dailyChart(d); projectBars(d); sessions(d); projectCards(d);
    } catch (e) {
      $('#kpis').innerHTML = `<div class="card err">No se pudo cargar: ${esc(e.message)}</div>`;
    }
  }
  $('#days').addEventListener('change', () => { try { localStorage.setItem('aos-days', $('#days').value); } catch {} load(); });
  $('#refresh').addEventListener('click', load);
  $('#registerBtn').addEventListener('click', registerDialog);

  $('#projects').addEventListener('change', async (e) => {
    if (!e.target.matches('input[type=checkbox]')) return;
    const slug = e.target.closest('[data-slug]').dataset.slug, id = e.target.dataset.id, done = e.target.checked;
    try {
      await api(`/api/projects/${slug}/tasks/${id}/${done ? 'done' : 'reopen'}`, { method: 'POST' });
      await load();
      toast(done ? 'Tarea completada' : 'Tarea reabierta', done ? { action: 'Deshacer', onAction: async () => { await api(`/api/projects/${slug}/tasks/${id}/reopen`, { method: 'POST' }).catch(fail); load(); } } : {});
    } catch (err) { fail(err); e.target.checked = !done; }
  });
  $('#projects').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, slug = f.closest('[data-slug]').dataset.slug;
    try { await api(`/api/projects/${slug}/tasks`, { method: 'POST', body: { title: f.title.value, prio: f.prio.value } }); load(); } catch (err) { fail(err); }
  });

  load();
  const timer = setInterval(load, 60000);
  onLeave(() => clearInterval(timer));
}

function registerDialog() {
  modal('Registrar proyecto', `
    <form id="regForm" class="stack">
      <label class="field">Ruta de la carpeta del proyecto en este equipo<input type="text" name="path" placeholder="/Users/tu/Proyectos/mi-app  ·  C:\\dev\\mi-app" required></label>
      <label class="field">Nombre (opcional)<input type="text" name="name"></label>
      <p class="empty">Esto solo lo añade al registro. Para generar su contexto y sus agentes, abre Claude en el proyecto y ejecuta <code>/aos-register</code>.</p>
      <div class="row"><button class="primary">Registrar</button></div>
    </form>`);
  $('#regForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/projects/register', { method: 'POST', body: { path: e.target.path.value, name: e.target.name.value || undefined } });
      $('#modal').hidden = true;
      location.hash = `#/p/${r.slug}`;
      toast(r.hint, { ms: 9000 });
    } catch (err) { fail(err); }
  });
}

function kpis(d) {
  const u = d.usage;
  const pct = tot(u.total) ? Math.round((tot(u.byModel.opus) / tot(u.total)) * 100) : 0;
  const tiles = [
    ['Ventana 5 h', fmt(tot(u.last5h)), 'tokens (aprox., por horas)'],
    ['Hoy', fmt(tot(u.today)), `${u.today.msgs} respuestas`],
    [`${d.days} días`, fmt(tot(u.total)), `salida ${fmt(u.total.out)}`],
    ['Cuota en Opus', pct + '%', 'del total del periodo'],
    ['Sesiones', String(u.sessions.length), `en ${d.days} días`],
  ];
  $('#kpis').innerHTML = tiles.map(([l, v, s]) => `<div class="card kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join('');
}

function dailyChart(d) {
  const days = [];
  for (let i = d.days - 1; i >= 0; i--) days.push(new Date(Date.now() - i * 864e5).toLocaleDateString('sv-SE'));
  const rows = days.map((day) => {
    const seg = {};
    for (const [k, b] of Object.entries(d.usage.byDay[day] || {})) seg[fam(k)] = (seg[fam(k)] || 0) + tot(b);
    return { day, seg, sum: Object.values(seg).reduce((a, b) => a + b, 0) };
  });
  const present = MODELS.filter((m) => rows.some((r) => r.seg[m]));
  $('#legend').innerHTML = present.map((m) => `<span><i style="background:var(--s-${m})"></i>${m}</span>`).join('');
  const max = Math.max(1, ...rows.map((r) => r.sum));
  const W = 1100, H = 240, L = 46, B = 22, T = 8, bw = (W - L) / rows.length;
  const y = (v) => H - B - (v / max) * (H - B - T);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tokens por día">`;
  for (const f of [0, 0.5, 1]) svg += `<line class="gridline" x1="${L}" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}"/><text x="${L - 6}" y="${y(max * f) + 4}" text-anchor="end">${fmt(max * f)}</text>`;
  const every = Math.ceil(rows.length / 10);
  rows.forEach((r, i) => {
    const x = L + i * bw + bw * 0.18, w = Math.max(2, bw * 0.64);
    let acc = 0;
    const segs = present.filter((m) => r.seg[m]);
    segs.forEach((m, j) => {
      const v = r.seg[m], y0 = y(acc), y1 = y(acc + v), top = j === segs.length - 1;
      const h = Math.max(1, y0 - y1 - (top ? 0 : 2));
      svg += `<rect class="mark" x="${x}" y="${y1 + (top ? 0 : 2)}" width="${w}" height="${h}" rx="${top ? 4 : 0}" fill="var(--s-${m})"><title>${r.day} · ${m}: ${fmt(v)} tokens</title></rect>`;
      if (top) svg += `<rect x="${x}" y="${y1 + 4}" width="${w}" height="${Math.max(0, h - 4)}" fill="var(--s-${m})" pointer-events="none"/>`;
      acc += v;
    });
    if (i % every === 0) svg += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${r.day.slice(5)}</text>`;
  });
  $('#daily').innerHTML = svg + '</svg>';
}

function projectBars(d) {
  const entries = Object.entries(d.usage.byProject).sort((a, b) => tot(b[1]) - tot(a[1])).slice(0, 10);
  if (!entries.length) return ($('#byProject').innerHTML = '<p class="empty">Sin consumo en el periodo.</p>');
  const max = tot(entries[0][1]), rowH = 26, W = 520, L = 150, R = 56;
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${entries.length * rowH}" role="img" aria-label="Consumo por proyecto">`;
  entries.forEach(([slug, b], i) => {
    const w = Math.max(3, ((W - L - R) * tot(b)) / max), yy = i * rowH;
    svg += `<text x="${L - 8}" y="${yy + 17}" text-anchor="end">${esc(slug.length > 22 ? slug.slice(0, 21) + '…' : slug)}</text>`;
    svg += `<rect class="mark" x="${L}" y="${yy + 6}" width="${w}" height="14" rx="4" fill="var(--accent)"><title>${esc(slug)}: ${fmt(tot(b))} tokens · salida ${fmt(b.out)} · cache-read ${fmt(b.cr)}</title></rect>`;
    svg += `<text x="${L + w + 6}" y="${yy + 17}">${fmt(tot(b))}</text>`;
  });
  $('#byProject').innerHTML = svg + '</svg><p class="empty" style="margin:8px 0 0">Entre paréntesis: directorios no registrados.</p>';
}

function sessions(d) {
  const s = d.usage.sessions.slice(0, 12);
  if (!s.length) return ($('#sessions').innerHTML = '<p class="empty">Sin sesiones.</p>');
  const dur = (a, b) => { const m = Math.round((Date.parse(b) - Date.parse(a)) / 6e4); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
  $('#sessions').innerHTML = `<table><thead><tr><th>Inicio</th><th>Proyecto</th><th class="num">Duración</th><th class="num">Tokens</th></tr></thead><tbody>${s.map((x) => `<tr><td>${new Date(x.first).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td>${esc(x.project)}</td><td class="num">${dur(x.first, x.last)}</td><td class="num">${fmt(x.tokens)}</td></tr>`).join('')}</tbody></table>`;
}

function projectCards(d) {
  if (!d.projects.length) {
    $('#projects').innerHTML = '<div class="card empty">No hay proyectos registrados. Abre Claude Code en un proyecto y ejecuta <code>/aos-register</code>, o usa “Registrar proyecto”.</div>';
    return;
  }
  $('#projects').innerHTML = d.projects.map((p) => {
    const open = p.tasks.filter((t) => !t.done).sort((a, b) => PRIO[a.prio] - PRIO[b.prio]);
    const done = p.tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
    return `<article class="card project-card" data-slug="${esc(p.slug)}">
      <div class="row"><h3><a href="#/p/${esc(p.slug)}">${esc(p.name)} →</a></h3><span class="spacer"></span>${p.running ? `<span class="badge live running">${p.running.mode === 'plan' ? 'planificando' : 'ejecutando'}</span>` : ''}</div>
      <div class="path">${p.localPath ? esc(p.localPath) : 'No clonado en este equipo'}</div>
      ${open.length ? open.slice(0, 8).map((t) => `<label class="task"><input type="checkbox" data-id="${esc(t.id)}"><span><span class="prio ${t.prio}">${t.prio}</span> ${esc(t.title)}</span></label>`).join('') + (open.length > 8 ? `<p class="empty">… y ${open.length - 8} más</p>` : '') : '<p class="empty">Sin tareas abiertas.</p>'}
      ${done.length ? `<details class="done-list"><summary>${done.length} hecha${done.length > 1 ? 's' : ''} · desmarca para reabrir</summary>${done.map((t) => `<label class="task"><input type="checkbox" checked data-id="${esc(t.id)}"><span class="t"><span class="prio ${t.prio}">${t.prio}</span> ${esc(t.title)}</span></label>`).join('')}</details>` : ''}
      <form class="addtask"><select name="prio" aria-label="Prioridad"><option>P0</option><option>P1</option><option selected>P2</option><option>P3</option></select><input type="text" name="title" placeholder="Nueva tarea…" required><button>Añadir</button></form>
      ${p.handoff ? `<details><summary>Última sesión · ${esc(p.handoff.date)}${p.handoff.auto ? ' (automático)' : ''}</summary><pre class="mono">${esc(p.handoff.text)}</pre></details>` : ''}
    </article>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════════════════════════════════
// PROYECTO
// ════════════════════════════════════════════════════════════════════════════════════════
function projectPage(slug, taskId) {
  const state = { slug, taskId, project: null, task: null, git: null, es: null, runId: null, newTask: false };
  app.innerHTML = `
    <header class="topbar">
      <a href="#/">← Inicio</a><h1 id="pName">${esc(slug)}</h1><span class="meta" id="pPath"></span><span class="spacer"></span>
      <button id="pRefresh">Actualizar</button>
    </header>
    <details class="card" id="pInfo" style="margin:0 0 12px"><summary>Contexto, agentes y última sesión</summary><div id="pInfoBody"></div></details>
    <div class="project-layout">
      <section class="card"><div class="section-title"><h2>Tareas</h2><span class="spacer"></span><button id="newTaskBtn">+ Nueva</button></div><div id="taskList" class="tasklist"></div><details id="doneWrap" hidden><summary id="doneSum"></summary><div id="doneList" class="tasklist"></div></details></section>
      <section class="card" id="taskPane"></section>
      <section class="card git-col" id="gitPane"><h2>Git</h2><p class="empty">Cargando…</p></section>
    </div>`;

  const openTask = (id) => { location.hash = `#/p/${slug}/${id}`; };
  $('#newTaskBtn').addEventListener('click', () => { state.newTask = true; state.taskId = null; renderTaskPane(); renderTaskList(); });
  $('#pRefresh').addEventListener('click', () => { loadProject(); loadGit(); if (state.taskId) loadTask(); });

  async function loadProject() {
    try {
      const p = await api(`/api/projects/${slug}`);
      state.project = p;
      $('#pName').textContent = p.name;
      $('#pPath').textContent = p.localPath || 'No clonado en este equipo';
      $('#pInfoBody').innerHTML = `
        <div class="grid2" style="margin:10px 0 0">
          <div><h3>Contexto</h3>${p.context ? `<pre class="mono">${esc(p.context)}</pre>` : '<p class="empty">Vacío: ejecuta /aos-register en el proyecto.</p>'}</div>
          <div><h3>Agentes del proyecto</h3>${p.agents.length ? `<table><tbody>${p.agents.map((a) => `<tr><td class="mono">${esc(a.name)}</td><td><span class="cx">${esc(a.model)}</span></td><td>${esc(a.description)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Sin especialistas. Genera el roster con <code>/aos-agents</code> en el proyecto.</p>'}
          <p class="empty">Globales: explorer · aos-quick (haiku) · aos-test-runner (haiku) · aos-builder (sonnet) · aos-reviewer (sonnet) · aos-architect (opus)</p>
          ${p.handoff ? `<h3>Última sesión · ${esc(p.handoff.date)}</h3><pre class="mono">${esc(p.handoff.text)}</pre>` : ''}</div>
        </div>`;
      renderTaskList();
      if (!state.taskId && !state.newTask) {
        const first = p.tasks.find((t) => !t.done);
        if (first) return openTask(first.id);
        renderTaskPane();
      }
    } catch (e) {
      app.innerHTML = `<p class="err" style="padding:24px">${esc(e.message)} · <a href="#/">volver</a></p>`;
    }
  }

  function taskItem(t) {
    const live = state.project?.running?.taskId === t.id;
    return `<button class="item ${t.id === state.taskId ? 'sel' : ''}" data-id="${esc(t.id)}">
      <span class="title">${esc(t.title)}</span>
      <span class="row"><span class="prio ${t.prio}">${t.prio}</span>${t.complexity ? `<span class="cx" title="Complejidad">${t.complexity}</span>` : ''}${t.status && t.status !== 'idle' ? `<span class="badge ${t.status} ${live ? 'live' : ''}">${STATUS[t.status] || t.status}</span>` : ''}</span>
    </button>`;
  }

  function renderTaskList() {
    const tasks = state.project?.tasks || [];
    const open = tasks.filter((t) => !t.done).sort((a, b) => PRIO[a.prio] - PRIO[b.prio]);
    const done = tasks.filter((t) => t.done);
    $('#taskList').innerHTML = open.length ? open.map(taskItem).join('') : '<p class="empty">Sin tareas abiertas.</p>';
    $('#doneWrap').hidden = !done.length;
    $('#doneSum').textContent = `${done.length} hecha${done.length === 1 ? '' : 's'}`;
    $('#doneList').innerHTML = done.map(taskItem).join('');
  }
  const onListClick = (e) => {
    const b = e.target.closest('.tasklist button.item');
    if (b) { state.newTask = false; openTask(b.dataset.id); }
  };
  app.addEventListener('click', onListClick);
  onLeave(() => app.removeEventListener('click', onListClick));

  // ── panel de tarea ──
  function renderTaskPane() {
    const pane = $('#taskPane');
    if (state.newTask || !state.taskId) {
      if (!state.newTask && state.project && !state.project.tasks.some((t) => !t.done)) {
        pane.innerHTML = '<p class="empty">No hay tareas abiertas. Crea una con “+ Nueva”.</p>';
        return;
      }
      if (!state.newTask) { pane.innerHTML = '<p class="empty">Selecciona una tarea.</p>'; return; }
      pane.innerHTML = `
        <h2>Nueva tarea</h2>
        <form id="newTask" class="stack">
          <label class="field">Título<input type="text" name="title" required placeholder="Qué hay que conseguir"></label>
          <div class="row">
            <label class="field">Prioridad<select name="prio"><option>P0</option><option>P1</option><option selected>P2</option><option>P3</option></select></label>
            <label class="field">Complejidad<select name="complexity"><option value="">Auto (la estima Haiku)</option><option value="S">S · Haiku</option><option value="M">M · Sonnet</option><option value="L">L · Opus planifica, Sonnet ejecuta</option></select></label>
          </div>
          <label class="field">Especificación<textarea name="spec" rows="8" placeholder="Contexto, criterios de aceptación, archivos implicados, lo que NO hay que tocar…"></textarea></label>
          <div class="row"><button class="primary">Crear tarea</button><button type="button" id="cancelNew">Cancelar</button></div>
        </form>`;
      $('#cancelNew').onclick = () => { state.newTask = false; renderTaskPane(); };
      $('#newTask').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        try {
          const t = await api(`/api/projects/${slug}/tasks`, { method: 'POST', body: { title: f.title.value, prio: f.prio.value, complexity: f.complexity.value || undefined, spec: f.spec.value } });
          state.newTask = false;
          await loadProject();
          openTask(t.id);
        } catch (err) { fail(err); }
      });
      return;
    }
    const t = state.task;
    if (!t) { pane.innerHTML = '<p class="empty">Cargando tarea…</p>'; return; }
    const st = t.status || 'idle';
    const running = ['planning', 'running'].includes(st) && state.project?.running?.taskId === t.id;
    const models = state.project?.models?.[t.complexity || 'M'];
    pane.innerHTML = `
      <div class="task-head">
        <input class="title-input" id="tTitle" value="${esc(t.title)}" aria-label="Título">
        <div class="row">
          <select id="tPrio" aria-label="Prioridad">${['P0', 'P1', 'P2', 'P3'].map((p) => `<option ${p === t.prio ? 'selected' : ''}>${p}</option>`).join('')}</select>
          <select id="tCx" aria-label="Complejidad">${['S', 'M', 'L'].map((c) => `<option value="${c}" ${c === (t.complexity || 'M') ? 'selected' : ''}>Complejidad ${c}</option>`).join('')}</select>
          <span class="badge ${st} ${running ? 'live' : ''}">${STATUS[st] || st}</span>
          ${t.branch ? `<span class="branch" title="Rama de la tarea">${esc(t.branch)}</span>` : ''}
          <span class="models">${models ? `plan: ${models.plan} · ejecución: ${models.exec}` : ''}</span>
        </div>
        <details ${t.detail.spec ? '' : 'open'}><summary>Especificación</summary>
          <div class="composer"><textarea id="tSpec" rows="7" placeholder="Contexto, criterios de aceptación…">${esc(t.detail.spec)}</textarea><div class="row"><button id="saveTask">Guardar cambios</button></div></div>
        </details>
      </div>
      <div class="actions" id="actions"></div>
      <div id="composer"></div>
      <div class="row" style="margin-top:14px"><h3>Actividad</h3><span class="spacer"></span>${t.runs.length > 1 ? `<select id="runSel" aria-label="Ejecución">${t.runs.map((r, i) => `<option value="${esc(r.id)}">${i === 0 ? 'Última' : new Date(r.startedAt).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${r.mode === 'plan' ? 'plan' : 'ejecución'} · ${esc(r.model)}${r.tokens ? ' · ' + fmt(r.tokens) + ' tok' : ''}</option>`).join('')}</select>` : ''}</div>
      <div class="feed" id="feed">${t.runs.length ? '' : '<p class="empty">Aún no se ha lanzado. Pulsa “Planificar con Claude”: primero propondrá un plan sin tocar nada.</p>'}</div>`;

    const actions = [];
    if (running) actions.push(`<button class="danger" id="stopBtn">■ Detener</button>`);
    else {
      if (['idle', 'error', 'estimating'].includes(st) && !t.done) actions.push(`<button class="primary" id="planBtn">Planificar con Claude</button>`);
      if (st === 'plan-ready') actions.push(`<button class="primary" id="approveBtn">✓ Aprobar y ejecutar</button>`);
      if (st === 'review' || st === 'error') actions.push(`<button id="replanBtn">Volver a planificar</button>`);
      if (!t.done) actions.push(`<button id="doneBtn">Marcar hecha</button>`);
      else actions.push(`<button id="reopenBtn">Reabrir</button>`);
    }
    $('#actions').innerHTML = actions.join('');
    if (!running && t.detail.meta.session && ['plan-ready', 'review', 'error'].includes(st)) {
      $('#composer').innerHTML = `<div class="composer"><textarea id="msg" rows="3" placeholder="${st === 'plan-ready' ? 'Feedback al plan (se re-planifica sin tocar nada)…' : 'Pídele cambios o pregúntale algo…'}"></textarea><div class="row"><button id="sendBtn">${st === 'plan-ready' ? 'Enviar feedback' : 'Enviar a Claude'}</button><span class="empty">Ctrl/⌘+Enter</span></div></div>`;
      $('#msg').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#sendBtn').click(); });
      $('#sendBtn').onclick = () => { const m = $('#msg').value.trim(); if (m) launch('reply', m); };
    }

    const bind = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    bind('#planBtn', () => launch('plan'));
    bind('#replanBtn', () => launch('plan'));
    bind('#approveBtn', () => launch('approve'));
    bind('#stopBtn', async () => { try { await api(`/api/runs/${state.project.running.id}/stop`, { method: 'POST' }); } catch (e) { fail(e); } });
    bind('#doneBtn', async () => {
      try {
        await api(`/api/projects/${slug}/tasks/${t.id}/done`, { method: 'POST' });
        toast('Tarea completada', { action: 'Deshacer', onAction: async () => { await api(`/api/projects/${slug}/tasks/${t.id}/reopen`, { method: 'POST' }).catch(fail); refreshAll(); } });
        refreshAll();
      } catch (e) { fail(e); }
    });
    bind('#reopenBtn', async () => { try { await api(`/api/projects/${slug}/tasks/${t.id}/reopen`, { method: 'POST' }); refreshAll(); } catch (e) { fail(e); } });
    bind('#saveTask', saveTask);
    $('#tPrio').onchange = saveTask;
    $('#tCx').onchange = saveTask;
    $('#tTitle').onchange = saveTask;
    const sel = $('#runSel');
    if (sel) sel.onchange = () => stream(sel.value);
    if (t.runs[0]) stream(t.runs[0].id);
  }

  async function saveTask() {
    try {
      await api(`/api/projects/${slug}/tasks/${state.taskId}`, { method: 'PATCH', body: { title: $('#tTitle').value, prio: $('#tPrio').value, complexity: $('#tCx').value, spec: $('#tSpec')?.value } });
      toast('Guardado', { ms: 2000 });
      refreshAll(false);
    } catch (e) { fail(e); }
  }

  async function launch(kind, message) {
    try {
      const btns = [...$('#taskPane').querySelectorAll('button')];
      btns.forEach((b) => (b.disabled = true));
      await api(`/api/projects/${slug}/tasks/${state.taskId}/run`, { method: 'POST', body: { kind, message } });
      await refreshAll();
    } catch (e) { fail(e); refreshAll(); }
  }

  async function refreshAll(withTask = true) {
    await loadProject();
    if (withTask && state.taskId) await loadTask();
    loadGit();
  }

  async function loadTask() {
    if (!state.taskId) return renderTaskPane();
    try {
      state.task = await api(`/api/projects/${slug}/tasks/${state.taskId}`);
      renderTaskPane();
      if (state.task.status === 'estimating') setTimeout(() => state.taskId && loadTask(), 4000);
    } catch (e) { $('#taskPane').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  // ── feed en directo (SSE) ──
  function stream(runId) {
    state.es?.close();
    state.runId = runId;
    const feed = $('#feed');
    feed.innerHTML = '';
    const tools = new Map();
    let gitTimer;
    const es = new EventSource(`/api/runs/${runId}/events?token=${TOKEN}`);
    state.es = es;
    const stick = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.kind === 'eof') { es.close(); return; }
      const atBottom = stick();
      renderEvent(feed, ev, tools);
      if (atBottom) feed.scrollTop = feed.scrollHeight;
      if (ev.kind === 'tool_result') { clearTimeout(gitTimer); gitTimer = setTimeout(loadGit, 1500); }
      if (ev.kind === 'end') { es.close(); setTimeout(() => refreshAll(), 300); toast(ev.status === 'done' ? (ev.taskStatus === 'plan-ready' ? 'Plan listo para revisar' : 'Turno terminado: revisa los cambios') : ev.status === 'stopped' ? 'Ejecución detenida' : 'La ejecución terminó con error', { error: ev.status === 'error' }); }
    };
    es.onerror = () => es.close();
  }
  onLeave(() => state.es?.close());

  // ── panel git ──
  async function loadGit() {
    const pane = $('#gitPane');
    if (!pane) return;
    try {
      const g = await api(`/api/projects/${slug}/git`);
      state.git = g;
      if (!g.repo) { pane.innerHTML = '<h2>Git</h2><p class="empty">El proyecto no es un repositorio git.</p>'; return; }
      const t = state.task;
      const base = t?.branch && t.branch === g.branch ? t.detail?.meta?.baseBranch : null;
      const draft = $('#commitMsg')?.value || '';
      pane.innerHTML = `
        <div class="section-title"><h2>Git</h2><span class="spacer"></span><button class="ghost" id="gRefresh" title="Actualizar">↻</button></div>
        <div class="row"><span class="branch">${esc(g.branch)}</span>${g.upstream ? `<span class="empty">↑${g.ahead} ↓${g.behind} · ${esc(g.upstream)}</span>` : '<span class="empty">sin publicar</span>'}</div>
        ${g.lastCommit ? `<p class="empty" style="margin:6px 0 0">Último: <span class="mono">${esc(g.lastCommit.hash)}</span> ${esc(g.lastCommit.subject)} · ${esc(g.lastCommit.when)}</p>` : ''}
        <div class="gitfiles">${g.files.length ? g.files.map((f) => `<button data-file="${esc(f.path)}" title="Ver diff"><span class="st ${esc(f.status)}">${esc(f.status)}</span>${esc(f.path)}</button>`).join('') : '<p class="empty">Sin cambios.</p>'}</div>
        ${base ? `<div class="row" style="margin-bottom:8px"><button id="gTaskDiff">Diff de la tarea frente a ${esc(base)}</button></div>` : ''}
        <div class="composer" style="margin-top:0"><textarea id="commitMsg" rows="2" placeholder="Mensaje del commit"></textarea>
          <div class="row"><button class="primary" id="gCommit" ${g.files.length ? '' : 'disabled'}>Commit</button><button id="gSync" ${g.remotes.length ? '' : 'disabled'}>${g.upstream ? `Sync ↑${g.ahead} ↓${g.behind}` : 'Publicar rama'}</button><button id="gFetch" ${g.remotes.length ? '' : 'disabled'}>Fetch</button></div></div>
        <details><summary>Cambiar de rama</summary><div class="row" style="margin-top:8px"><select id="gBranches"><option>Cargando…</option></select><button id="gCheckout">Cambiar</button></div>${base ? `<p class="empty">La tarea trabaja en <span class="mono">${esc(g.branch)}</span>; su base es <span class="mono">${esc(base)}</span>.</p>` : ''}</details>`;
      $('#commitMsg').value = draft;
      $('#gRefresh').onclick = loadGit;
      pane.querySelectorAll('[data-file]').forEach((b) => (b.onclick = async () => {
        try { const r = await api(`/api/projects/${slug}/git/diff?file=${encodeURIComponent(b.dataset.file)}`); modal(b.dataset.file, diffHtml(r.diff)); } catch (e) { fail(e); }
      }));
      if (base) $('#gTaskDiff').onclick = async () => { try { const r = await api(`/api/projects/${slug}/git/diff?base=${encodeURIComponent(base)}`); modal(`${g.branch} frente a ${base}`, diffHtml(r.diff)); } catch (e) { fail(e); } };
      $('#gCommit').onclick = async () => {
        const msg = $('#commitMsg').value.trim();
        if (!msg) return toast('Escribe un mensaje de commit', { error: true });
        try { await api(`/api/projects/${slug}/git/commit`, { method: 'POST', body: { message: msg } }); $('#commitMsg').value = ''; toast('Commit hecho'); loadGit(); } catch (e) { fail(e); }
      };
      $('#gSync').onclick = async (e) => { e.target.disabled = true; try { const r = await api(`/api/projects/${slug}/git/sync`, { method: 'POST' }); toast(r.output); } catch (err) { fail(err); } loadGit(); };
      $('#gFetch').onclick = async (e) => { e.target.disabled = true; try { await api(`/api/projects/${slug}/git/fetch`, { method: 'POST' }); toast('Fetch hecho', { ms: 2000 }); } catch (err) { fail(err); } loadGit(); };
      pane.querySelector('details').addEventListener('toggle', async (e) => {
        if (!e.target.open) return;
        try { const r = await api(`/api/projects/${slug}/git/branches`); $('#gBranches').innerHTML = r.branches.map((b) => `<option ${b === g.branch ? 'selected' : ''}>${esc(b)}</option>`).join(''); } catch (err) { fail(err); }
      });
      $('#gCheckout').onclick = async () => { try { await api(`/api/projects/${slug}/git/checkout`, { method: 'POST', body: { branch: $('#gBranches').value } }); toast('Rama cambiada'); refreshAll(); } catch (e) { fail(e); } };
    } catch (e) {
      pane.innerHTML = `<h2>Git</h2><p class="err">${esc(e.message)}</p>`;
    }
  }

  // arranque
  if (taskId) loadTask(); else renderTaskPane();
  loadProject();
  loadGit();
  const poll = setInterval(() => { if (!document.hidden) loadGit(); }, 15000);
  onLeave(() => clearInterval(poll));
}

// ── render de eventos del feed ─────────────────────────────────────────────────────────
function renderEvent(feed, ev, tools) {
  const div = document.createElement('div');
  const side = ev.sidechain ? ' side' : '';
  switch (ev.kind) {
    case 'user':
      div.className = 'ev user';
      div.innerHTML = `<span class="who">Tú · ${ev.mode === 'plan' ? 'plan' : 'ejecución'} con ${esc(ev.model)}${ev.branch ? ` · rama ${esc(ev.branch)}` : ''}</span>${esc(ev.text)}${ev.note ? `<div class="empty">${esc(ev.note)}</div>` : ''}`;
      break;
    case 'init':
      div.className = 'ev sys';
      div.textContent = `Sesión ${String(ev.session || '').slice(0, 8)} · ${ev.model || ''}${ev.agents?.length ? ` · ${ev.agents.length} agentes disponibles` : ''}`;
      break;
    case 'text':
      div.className = 'ev text' + side;
      div.innerHTML = `<span class="who">${ev.sidechain ? 'Subagente' : 'Claude'}${ev.model ? ' · ' + esc(fam(ev.model)) : ''}</span>${md(ev.text)}`;
      break;
    case 'tool': {
      div.className = 'ev tool' + side;
      let extra = '';
      if (ev.plan) { div.className = 'ev text plan'; div.innerHTML = `<span class="who">📋 Plan propuesto</span>${md(ev.plan)}`; break; }
      if (ev.detail?.old != null) extra += diffHtml(String(ev.detail.old).split('\n').map((l) => '-' + l).join('\n') + '\n' + String(ev.detail.new ?? '').split('\n').map((l) => '+' + l).join('\n'));
      else if (ev.detail?.new != null) extra += diffHtml(String(ev.detail.new).split('\n').map((l) => '+' + l).join('\n'));
      if (ev.todos) extra += `<ul class="todos">${ev.todos.map((t) => `<li class="${esc(t.status)}">${esc(t.text)}</li>`).join('')}</ul>`;
      if (ev.sub && !ev.todos) extra += `<pre class="mono">${esc(ev.sub)}</pre>`;
      div.innerHTML = `<details><summary>${esc(ev.icon || '⚙')} ${esc(ev.label)}</summary>${extra}<div class="out"></div></details>`;
      if (ev.todos) div.querySelector('details').open = true;
      tools.set(ev.id, div);
      break;
    }
    case 'tool_result': {
      const host = tools.get(ev.id);
      if (host) {
        if (ev.error) host.classList.add('fail');
        if (ev.text?.trim()) host.querySelector('.out').innerHTML = `<pre class="mono">${esc(ev.text)}</pre>`;
        return;
      }
      return;
    }
    case 'result': {
      feed.querySelectorAll(':scope > .ev.result').forEach((n) => n.remove()); // un turno con subagentes emite varios; el último es el acumulado real
      div.className = 'ev result';
      const models = Object.entries(ev.byModel || {}).map(([m, u]) => `<span class="m"><i style="background:var(--s-${fam(m)})"></i>${esc(fam(m))} ${fmt(u.tokens)}</span>`).join('');
      div.innerHTML = `<span>${ev.ok ? '✓' : '✗'} ${fmt(ev.tokens)} tokens este turno</span>${models}<span>${ev.turns ?? '?'} pasos · ${Math.round((ev.durationMs || 0) / 1000)} s</span>${ev.cost ? `<span title="Equivalente a precio de API; con suscripción no se cobra aparte">≈ $${ev.cost.toFixed(3)} API</span>` : ''}${ev.denials?.length ? `<span class="err">Denegado: ${esc([...new Set(ev.denials)].join(', '))}</span>` : ''}`;
      break;
    }
    case 'stderr':
      div.className = 'ev stderr';
      div.textContent = ev.text;
      break;
    case 'end':
      div.className = 'ev sys';
      div.textContent = { done: '— turno terminado —', stopped: '— detenido —', error: '— terminó con error —' }[ev.status] || '— fin —';
      break;
    default:
      return;
  }
  feed.appendChild(div);
}

route();
