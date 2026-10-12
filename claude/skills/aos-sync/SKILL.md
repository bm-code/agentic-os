---
name: aos-sync
description: Sincroniza el repo del Agentic OS con GitHub (commit + pull --rebase + push) para compartir memoria y tareas entre equipos.
disable-model-invocation: true
---
Ejecuta `node "{{AOS}}/scripts/aos.mjs" sync`. Si hay conflictos de git, resuélvelos en `{{AOS}}` conservando ambas versiones en los archivos de tareas y memoria (son listas: normalmente basta con unir líneas), y vuelve a ejecutar sync.
