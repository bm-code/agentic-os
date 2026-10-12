---
name: aos-register
description: Registra el proyecto del directorio actual en el Agentic OS y genera su context.md (memoria persistente del proyecto). Úsalo cuando el usuario quiera que un repo forme parte de su agentic OS.
argument-hint: "[slug] [--name \"Nombre\"] [--tags a,b]"
disable-model-invocation: true
---
Registra el proyecto actual en el Agentic OS. Argumentos: $ARGUMENTS

1. Ejecuta `node "{{AOS}}/scripts/aos.mjs" register --slug <slug>` (más `--name`/`--tags` si se han pasado). Sin slug, usa el nombre de la carpeta. El remote git se detecta solo.
2. Delega en el subagente `explorer` un resumen del repo: qué es, stack, comandos (instalar, dev, test, build, lint), estructura principal y convenciones o gotchas visibles (README, CLAUDE.md, package.json, etc.). Pídele ≤ 25 líneas.
3. Escribe `{{AOS}}/projects/<slug>/context.md` con ese resumen manteniendo las secciones (Qué es / Stack y comandos / Convenciones / Notas). Máximo 60 líneas y sin relleno: se inyecta en cada sesión.
4. Si el repo ya tiene un CLAUDE.md, no lo dupliques en context.md: menciona que existe y anota solo lo que no esté ahí.
5. Pregunta si quiere añadir tareas iniciales (`/aos-task add …`).

No modifiques nada dentro del repo del proyecto.
