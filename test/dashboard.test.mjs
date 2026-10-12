import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../dashboard/lib/events.mjs';
import { parseStatus } from '../dashboard/lib/git.mjs';
import { checkRequest } from '../dashboard/server.mjs';
import { parseAgent } from '../scripts/lib/agents.mjs';

test('stream-json → eventos del feed', () => {
  const init = normalize({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-haiku-5-5', agents: ['explorer'] });
  assert.deepEqual(init[0], { kind: 'init', session: 's1', model: 'claude-haiku-5-5', agents: ['explorer'], permissionMode: undefined });

  const a = normalize({ type: 'assistant', message: { model: 'm', content: [
    { type: 'text', text: 'Voy' },
    { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/a.ts', old_string: 'x', new_string: 'y' } },
    { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test', description: 'tests' } },
    { type: 'tool_use', id: 't3', name: 'Agent', input: { subagent_type: 'aos-quick', description: 'renombrar' } },
  ] } });
  assert.equal(a[0].kind, 'text');
  assert.equal(a[1].label, 'Edita src/a.ts');
  assert.deepEqual(a[1].detail, { old: 'x', new: 'y' });
  assert.equal(a[2].label, 'npm test');
  assert.equal(a[3].agent, 'aos-quick');

  const side = normalize({ type: 'assistant', parent_tool_use_id: 't3', message: { content: [{ type: 'text', text: 'hecho' }] } });
  assert.equal(side[0].sidechain, true);

  const r = normalize({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: [{ type: 'text', text: 'FAIL' }] }] } });
  assert.deepEqual(r[0], { kind: 'tool_result', id: 't2', error: true, text: 'FAIL', sidechain: false });

  const res = normalize({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's1', num_turns: 3, total_cost_usd: 0.01,
    modelUsage: { 'claude-haiku-5-5': { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 100, cacheCreationInputTokens: 0, costUSD: 0.01 } }, permission_denials: [{ tool_name: 'Bash' }] });
  assert.equal(res[0].ok, true);
  assert.equal(res[0].tokens, 115);
  assert.deepEqual(res[0].denials, ['Bash']);
  assert.deepEqual(normalize({ type: 'desconocido' }), []);
});

test('git status --porcelain=v2 -z', () => {
  const out = [
    '# branch.oid abc',
    '# branch.head aos/k3f9',
    '# branch.upstream origin/aos/k3f9',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 h1 h2 src/app file.ts',
    '1 A. N... 000000 100644 100644 h1 h2 nuevo.ts',
    '2 R. N... 100644 100644 100644 h1 h2 R100 renombrado.ts',
    'viejo.ts',
    '? sin-versionar.md',
    '',
  ].join('\0');
  const s = parseStatus(out);
  assert.equal(s.branch, 'aos/k3f9');
  assert.equal(s.upstream, 'origin/aos/k3f9');
  assert.deepEqual([s.ahead, s.behind], [2, 1]);
  assert.deepEqual(s.files, [
    { path: 'src/app file.ts', staged: false, status: 'M' },
    { path: 'nuevo.ts', staged: true, status: 'A' },
    { path: 'renombrado.ts', staged: true, status: 'R', from: 'viejo.ts' },
    { path: 'sin-versionar.md', staged: false, status: '?' },
  ]);
});

test('seguridad: host, origen y token', () => {
  const ok = { method: 'GET', url: '/api/data', headers: { host: 'localhost:4747', 'x-aos-token': 'T' } };
  assert.equal(checkRequest(ok, 'T'), null);
  assert.match(checkRequest({ ...ok, headers: { ...ok.headers, host: 'evil.com:4747' } }, 'T'), /host/);
  assert.match(checkRequest({ ...ok, headers: { ...ok.headers, origin: 'https://evil.com' } }, 'T'), /origen/);
  assert.match(checkRequest({ ...ok, headers: { host: 'localhost:4747' } }, 'T'), /token/);
  assert.match(checkRequest({ ...ok, headers: { host: 'localhost:4747', 'x-aos-token': 'X' } }, 'T'), /token/);
  assert.equal(checkRequest({ method: 'GET', url: '/api/runs/x/events?token=T', headers: { host: '127.0.0.1:4747' } }, 'T'), null);
  assert.equal(checkRequest({ method: 'GET', url: '/', headers: { host: 'localhost:4747' } }, 'T'), null); // la página sí (el token va dentro)
});

test('frontmatter de agentes', () => {
  const a = parseAgent('---\nname: aos-x-ui\ndescription: "UI de x"\nmodel: haiku\n---\nCuerpo\n');
  assert.deepEqual(a.meta, { name: 'aos-x-ui', description: 'UI de x', model: 'haiku' });
  assert.equal(a.prompt, 'Cuerpo');
});
