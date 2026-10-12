<!-- agentic-os:managed — generado por agentic-os/scripts/install.mjs. Edita la plantilla en el repo, no este archivo. -->
# Reglas globales (Agentic OS)

@{{AOS}}/memory/global.md

## Agentic OS
- Hub de memoria y tareas en `{{AOS}}`. CLI: `node "{{AOS}}/scripts/aos.mjs" <cmd>`.
- Si al inicio recibes un brief "Agentic OS · …", es la memoria del proyecto: úsala y no la repitas.
- Los repos de los proyectos son independientes: nunca escribas memoria/tareas del OS dentro de ellos.
- Cuando descubras algo durable (comando, gotcha, preferencia), guárdalo con `/aos-remember`.
- Al terminar un bloque de trabajo o antes de `/clear`, propone `/aos-handoff`.

## Uso eficiente (plan Pro/Max)
- Delega búsquedas amplias y lecturas masivas al subagente `explorer` (Haiku) y quédate solo con la conclusión.
- Lee rangos de archivos en vez de archivos enteros cuando sepas qué buscas.
- Respuestas concisas: sin repetir código que no cambia ni resúmenes largos al final.
- Una tarea por sesión. Si el contexto pasa del ~60 %, sugiere `/aos-handoff` + `/clear`.
