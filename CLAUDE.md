# Agentic OS (este repo)

Hub de memoria, tareas y consumo para Claude Code. Node ≥ 20, **sin dependencias npm**: no las añadas (tiene que instalarse en un Windows corporativo sin `npm install`).

- `scripts/lib/`: lógica compartida (registry, tasks, memory, usage, transcript, sessions, paths, config).
- `scripts/aos.mjs`: CLI que usan las skills. `scripts/hooks/`: SessionStart y SessionEnd/PreCompact. `scripts/statusline.mjs`.
- `dashboard/`: servidor + UI. `lib/runner.mjs` lanza `claude -p --output-format stream-json` por tarea; `lib/git.mjs` envuelve git; toda la API exige el token de arranque (`checkRequest`). No relajes esa seguridad: el servidor ejecuta código.
- `scripts/lib/agents.mjs`: agentes por proyecto → `<repo>/.claude/agents` (excluidos de git en local). `claude/agents/` son los globales por niveles de coste.
- `claude/`: plantillas que `scripts/install.mjs` copia a `~/.claude` sustituyendo `{{AOS}}` por la ruta del repo. Tras cambiar algo en `claude/`, vuelve a ejecutar el instalador.
- `projects/`, `registry/`, `memory/`: datos del usuario (se sincronizan con git). `.local/` es local y está ignorado.

## Reglas
- Todo debe funcionar en macOS y Windows: usa `path`, compara rutas con `isUnder`/`normalizeForCompare` y nunca uses bash en los hooks.
- Los hooks nunca deben fallar ni bloquear: try/catch, salida corta y sin red por defecto.
- El brief es contexto que se paga en cada turno: no lo hagas crecer sin motivo.
- Tests: `npm test` (`node --test`). Añade casos al tocar los parsers (tareas, rutas, uso).
