// Normaliza los eventos `--output-format stream-json` de Claude Code a un formato compacto
// para el feed del dashboard. Lo que no reconoce lo ignora (el formato puede crecer).

const clip = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + '…' : s);

function toolSummary(name, input = {}) {
  const f = input.file_path || input.notebook_path || input.path;
  switch (name) {
    case 'Read':
      return { icon: '👁', label: `Lee ${f}${input.offset ? `:${input.offset}` : ''}` };
    case 'Edit':
    case 'MultiEdit':
      return { icon: '✎', label: `Edita ${f}`, file: f, detail: input.old_string != null ? { old: clip(input.old_string, 4000), new: clip(input.new_string, 4000) } : null };
    case 'Write':
      return { icon: '✚', label: `Escribe ${f}`, file: f, detail: { new: clip(input.content, 4000) } };
    case 'NotebookEdit':
      return { icon: '✎', label: `Edita notebook ${f}`, file: f };
    case 'Bash':
    case 'PowerShell':
      return { icon: '▶', label: clip(input.command, 300), sub: input.description };
    case 'Grep':
      return { icon: '🔎', label: `Busca "${clip(input.pattern, 80)}"${input.path ? ` en ${input.path}` : ''}` };
    case 'Glob':
      return { icon: '🔎', label: `Archivos ${input.pattern}` };
    case 'Agent':
    case 'Task':
      return { icon: '🤖', label: `Agente ${input.subagent_type || 'general'}: ${clip(input.description || '', 120)}`, agent: input.subagent_type || 'general', sub: clip(input.prompt, 600) };
    case 'TodoWrite':
      return { icon: '☑', label: 'Actualiza su lista de pasos', todos: (input.todos || []).map((t) => ({ text: t.content, status: t.status })) };
    case 'ExitPlanMode':
      return { icon: '📋', label: 'Plan listo', plan: input.plan };
    case 'WebFetch':
    case 'WebSearch':
      return { icon: '🌐', label: `${name} ${clip(input.url || input.query || '', 120)}` };
    default:
      return { icon: '⚙', label: name };
  }
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
  return '';
}

/** Un evento crudo → lista de eventos de feed. */
export function normalize(ev) {
  const out = [];
  if (!ev || typeof ev !== 'object') return out;
  if (ev.type === 'system' && ev.subtype === 'init') {
    out.push({ kind: 'init', session: ev.session_id, model: ev.model, agents: ev.agents, permissionMode: ev.permissionMode });
  } else if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
    const sidechain = !!ev.parent_tool_use_id;
    for (const b of ev.message.content) {
      if (b.type === 'text' && b.text?.trim()) out.push({ kind: 'text', text: b.text, sidechain, model: ev.message.model });
      else if (b.type === 'tool_use') out.push({ kind: 'tool', id: b.id, name: b.name, sidechain, ...toolSummary(b.name, b.input) });
    }
  } else if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
    for (const b of ev.message.content) {
      if (b.type === 'tool_result') out.push({ kind: 'tool_result', id: b.tool_use_id, error: !!b.is_error, text: clip(resultText(b.content), 3000), sidechain: !!ev.parent_tool_use_id });
    }
  } else if (ev.type === 'result') {
    const byModel = {};
    for (const [m, u] of Object.entries(ev.modelUsage || {})) {
      byModel[m] = { tokens: (u.inputTokens || 0) + (u.outputTokens || 0) + (u.cacheReadInputTokens || 0) + (u.cacheCreationInputTokens || 0), out: u.outputTokens || 0, cost: u.costUSD || 0 };
    }
    const u = ev.usage || {};
    out.push({
      kind: 'result',
      ok: ev.subtype === 'success' && !ev.is_error,
      subtype: ev.subtype,
      text: ev.result || '',
      session: ev.session_id,
      turns: ev.num_turns,
      durationMs: ev.duration_ms,
      cost: ev.total_cost_usd || 0,
      tokens: Object.values(byModel).reduce((a, b) => a + b.tokens, 0) || (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
      byModel,
      denials: (ev.permission_denials || []).map((d) => d.tool_name),
    });
  }
  return out;
}
