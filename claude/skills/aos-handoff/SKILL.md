---
name: aos-handoff
description: Guarda un handoff de la sesión actual (qué se hizo, qué queda, gotchas) en la memoria del proyecto para retomarlo en la próxima sesión o en otro equipo. Úsalo al terminar un bloque de trabajo, antes de /clear o cuando el contexto esté alto.
argument-hint: "[nota opcional]"
---
Escribe el handoff de esta sesión. Nota del usuario (opcional): $ARGUMENTS

Redáctalo en español, conciso (≤ 20 líneas), para quien retome sin ver esta conversación:

```
## Hecho
- …
## Siguiente paso
- … (lo primero que hay que hacer al volver)
## Gotchas y decisiones
- … (solo lo no obvio: errores encontrados, por qué se eligió X)
## Archivos clave
- ruta:línea — por qué
```

Guárdalo con un heredoc (el CLI asocia solo la sesión actual):

```bash
node "{{AOS}}/scripts/aos.mjs" handoff <<'HANDOFF'
…contenido…
HANDOFF
```

Después:
- Marca las tareas del proyecto que se hayan completado (`task done <id>`) y crea las nuevas que hayan surgido (`task add`).
- Lo que sea conocimiento durable del proyecto (no de esta sesión) va con `remember`, no en el handoff.
- Termina con una línea: "Handoff guardado. Puedes hacer /clear."
