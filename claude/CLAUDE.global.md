<!-- agentic-os:managed — generado por agentic-os/scripts/install.mjs. Edita la plantilla en el repo, no este archivo. -->
# Reglas globales (Agentic OS)

@{{AOS}}/memory/global.md

## Agentic OS
- Hub de memoria y tareas en `{{AOS}}`. CLI: `node "{{AOS}}/scripts/aos.mjs" <cmd>`.
- Si al inicio recibes un brief "Agentic OS · …", es la memoria del proyecto: úsala y no la repitas.
- Los repos de los proyectos son independientes: nunca escribas memoria/tareas del OS dentro de ellos.
- Cuando descubras algo durable (comando, gotcha, preferencia), guárdalo con `/aos-remember`.
- Al terminar un bloque de trabajo o antes de `/clear`, propone `/aos-handoff`.

## Delegación por coste (plan Pro/Max)
Coordina y decide en el hilo principal; delega la ejecución en el agente más barato que la haga bien:
- Buscar, leer mucho o resumir → `explorer` (Haiku).
- Cambio mecánico con archivos y cambio claros → `aos-quick` (Haiku).
- Tests, lint, build → `aos-test-runner` (Haiku); nunca leas logs completos en el hilo principal.
- Cambio en un área con especialista `aos-<proyecto>-*` → ese especialista.
- Feature o bug de alcance medio sin especialista → `aos-builder` (Sonnet).
- Diseño, depuración difícil, refactor transversal → `aos-architect` (Opus, solo propone).
- Antes de commit de cambios no triviales → `aos-reviewer` (Sonnet).
- Cambios de 1-2 líneas que ya tienes en contexto: hazlos tú; delegar también cuesta.

## Uso eficiente
- Lee rangos de archivos en vez de archivos enteros cuando sepas qué buscas.
- Respuestas concisas: sin repetir código que no cambia ni resúmenes largos al final.
- Una tarea por sesión. Si el contexto pasa del ~60 %, sugiere `/aos-handoff` + `/clear`.
