---
name: aos-remember
description: Guarda un hecho durable en la memoria del Agentic OS, del proyecto actual (context.md) o global entre proyectos (--global). Úsalo cuando el usuario diga "recuerda…" o descubras un comando, convención o gotcha que valdrá en futuras sesiones.
argument-hint: "\"texto\" [--global]"
---
Guarda en memoria: $ARGUMENTS

- Proyecto actual: `node "{{AOS}}/scripts/aos.mjs" remember "<texto>"` → sección "Notas" de context.md.
- Transversal (aplica a varios proyectos): añade `--global` → memory/learnings.md.
- Preferencias personales permanentes del usuario (idioma, estilo, stack): edita `{{AOS}}/memory/global.md`, una línea.

Una línea, concreta y accionable ("Los tests e2e necesitan `docker compose up db` antes"), sin duplicar lo que ya está. Si context.md pasa de ~60 líneas, propón consolidarlo.
