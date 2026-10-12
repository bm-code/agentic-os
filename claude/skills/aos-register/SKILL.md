---
name: aos-register
description: Registra el proyecto del directorio actual en el Agentic OS y genera su context.md (memoria persistente del proyecto). Úsalo cuando el usuario quiera que un repo forme parte de su agentic OS.
argument-hint: "[slug] [--name \"Nombre\"] [--tags a,b]"
disable-model-invocation: true
---
Registra el proyecto actual en el Agentic OS. Argumentos: $ARGUMENTS

1. Ejecuta `node "{{AOS}}/scripts/aos.mjs" register --slug <slug>` (más `--name`/`--tags` si se han pasado). Sin slug, usa el nombre de la carpeta. El remote git se detecta solo.
2. Delega en el subagente `explorer` un resumen del repo: qué es, stack, comandos (instalar, dev, test, build, lint), estructura principal, áreas del código con su ruta y patrones concretos de cada una (cómo se crea un componente/endpoint/migración, dónde van los tests), y convenciones o gotchas visibles (README, CLAUDE.md, package.json, etc.). Pídele ≤ 35 líneas: sirve para context.md y para los agentes.
3. Escribe `{{AOS}}/projects/<slug>/context.md` con ese resumen manteniendo las secciones (Qué es / Stack y comandos / Convenciones / Notas). Máximo 60 líneas y sin relleno: se inyecta en cada sesión.
4. Si el repo ya tiene un CLAUDE.md, no lo dupliques en context.md: menciona que existe y anota solo lo que no esté ahí.
5. Genera el roster de agentes del proyecto siguiendo las instrucciones de la skill `/aos-agents` (lee `~/.claude/skills/aos-agents/SKILL.md`), reutilizando el análisis del paso 2 en vez de explorar otra vez.
6. Pregunta si quiere añadir tareas iniciales (`/aos-task add …`).

No modifiques ningún archivo versionado del repo. La única excepción son los agentes `aos-*` que `agents sync` copia a `.claude/agents/`, y que quedan excluidos de git en local.
