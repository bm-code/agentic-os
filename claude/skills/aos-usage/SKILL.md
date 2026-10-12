---
name: aos-usage
description: Muestra el consumo de tokens de Claude Code por día, modelo y proyecto (datos locales de este equipo).
argument-hint: "[--days 7]"
disable-model-invocation: true
---
Ejecuta `node "{{AOS}}/scripts/aos.mjs" usage $ARGUMENTS` y muestra la salida tal cual. Añade como mucho 3 observaciones accionables (p. ej. mucho Opus en tareas mecánicas, o cache-read muy alto por sesiones largas → /clear más a menudo). Recuerda que existe el dashboard: `npm run dashboard` en `{{AOS}}`.
