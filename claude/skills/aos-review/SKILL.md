---
name: aos-review
description: Revisión semanal del Agentic OS. Cruza consumo, tareas y memoria para proponer mejoras de eficiencia y organización.
disable-model-invocation: true
---
Haz una revisión breve (≤ 40 líneas) del sistema:

1. `node "{{AOS}}/scripts/aos.mjs" usage --days 7` y `node "{{AOS}}/scripts/aos.mjs" status`.
2. Lee `{{AOS}}/memory/learnings.md` y los context.md de los proyectos con actividad esta semana (delega en `explorer` si son muchos).
3. Revisa `~/.claude/settings.json` (permisos, MCP) y `~/.claude/CLAUDE.md`.

Propón, priorizado y sin aplicar nada sin confirmación:
- **Consumo:** proyectos o sesiones caros, Opus donde bastaba Sonnet/Haiku, sesiones demasiado largas (cache-read alto), MCPs sin uso.
- **Memoria:** context.md desactualizados o de más de 60 líneas, aprendizajes que deberían subir a global.md o a una skill.
- **Tareas:** P0/P1 estancadas, tareas ya hechas, proyectos sin actividad.
- **Automatización:** comandos de solo lectura repetidos que convenga añadir a permisos; flujos repetidos que merezcan una skill.
