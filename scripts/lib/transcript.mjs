// Lectura de transcripts de Claude Code (~/.claude/projects/**/<session>.jsonl).
// Sirve para el handoff automático (sin coste: no llama al modelo) y para la statusline.
import fs from 'node:fs';

function* records(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      yield JSON.parse(line);
    } catch {
      /* línea parcial */
    }
  }
}

function userText(rec) {
  if (rec.type !== 'user' || rec.isMeta || rec.isSidechain) return null;
  const c = rec.message?.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';
  const t = text.trim();
  // Fuera: salidas de comandos locales, recordatorios del sistema y resultados de herramientas.
  if (!t || t.startsWith('<') || t.startsWith('Caveat:') || t.startsWith('[Request interrupted')) return null;
  return t;
}

/** Resumen mecánico de una sesión: título, peticiones del usuario, archivos tocados y último mensaje. */
export function summarizeTranscript(file) {
  const out = { sessionId: null, title: null, cwd: null, start: null, end: null, prompts: [], files: new Set(), lastAssistant: null, turns: 0 };
  for (const r of records(file)) {
    out.sessionId ||= r.sessionId || null;
    if (r.cwd) out.cwd ||= r.cwd;
    if (r.timestamp) {
      out.start ||= r.timestamp;
      out.end = r.timestamp;
    }
    if (r.type === 'ai-title' && r.aiTitle) out.title = r.aiTitle;
    const u = userText(r);
    if (u) {
      out.prompts.push(u);
      out.turns++;
    }
    if (r.type === 'assistant' && !r.isSidechain && Array.isArray(r.message?.content)) {
      for (const b of r.message.content) {
        if (b.type === 'tool_use' && ['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(b.name)) {
          const f = b.input?.file_path || b.input?.notebook_path;
          if (f) out.files.add(f);
        }
        if (b.type === 'text' && b.text?.trim()) out.lastAssistant = b.text.trim();
      }
    }
  }
  out.files = [...out.files];
  return out;
}

/** Tokens de contexto del último turno principal (lee solo el final del archivo). */
export function lastContextTokens(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const { size } = fs.fstatSync(fd);
    const len = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"usage"')) continue;
      try {
        const r = JSON.parse(lines[i]);
        if (r.type !== 'assistant' || r.isSidechain) continue;
        const u = r.message?.usage;
        if (u) return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      } catch {
        /* la primera línea puede venir cortada */
      }
    }
  } catch {
    /* sin transcript */
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return null;
}
