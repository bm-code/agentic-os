---
name: aos-task
description: Gestiona las tareas del proyecto actual en el Agentic OS (añadir, listar, siguiente, completar). Úsalo cuando el usuario hable de tareas, pendientes o to-dos del proyecto, o al terminar algo que estaba en la lista.
argument-hint: "add \"título\" [--p P1] [--tags a,b] [--due YYYY-MM-DD] | list [--all] | next | done <id>"
---
Gestiona tareas con el CLI del OS. Argumentos: $ARGUMENTS

CLI: `node "{{AOS}}/scripts/aos.mjs" task <add|list|next|done> …`

- Prioridades: P0 (urgente/bloqueante), P1 (importante), P2 (normal, por defecto), P3 (algún día).
- Si el usuario describe varias tareas en lenguaje natural, crea una por cada una con títulos cortos y accionables.
- Al completar trabajo que corresponde a una tarea abierta, márcala con `done <id>` (los ids salen en el brief o en `list`).
- Si el directorio no está registrado, el CLI lo dirá: ofrece /aos-register.
- Muestra la salida del CLI tal cual.
