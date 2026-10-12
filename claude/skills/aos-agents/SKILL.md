---
name: aos-agents
description: Genera o regenera el roster de agentes especialistas del proyecto actual, organizado por coste (Haiku para lo mecánico, Sonnet para lo que requiere criterio). Lo invoca /aos-register; úsalo también cuando cambie el stack o la estructura del repo.
argument-hint: "[áreas o indicaciones opcionales]"
disable-model-invocation: true
---
Genera los agentes especialistas del proyecto actual. Indicaciones del usuario: $ARGUMENTS

## 1. Analiza (barato)
Obtén el slug con `node "{{AOS}}/scripts/aos.mjs" where`. Delega en `explorer` (≤ 30 líneas): stack y versiones, áreas del código con su ruta (frontend, API, BD/migraciones, móvil, infra…), patrones concretos de cada área (cómo se crea un componente, un endpoint, una migración, dónde van los tests), comandos de test/lint/build y gotchas visibles.

## 2. Diseña el roster (2-4 especialistas, nunca más)
Ya existen agentes globales; NO los dupliques: `explorer` (buscar), `aos-quick` (mecánico, Haiku), `aos-test-runner` (tests, Haiku), `aos-builder` (genérico, Sonnet), `aos-reviewer` (revisión, Sonnet), `aos-architect` (diseño, Opus).

Crea un especialista solo para un área con convenciones propias que un agente genérico haría mal sin conocerlas. Ejemplos: `aos-<slug>-ui` (Angular/Vue/Astro), `aos-<slug>-api` (Nest), `aos-<slug>-db` (MySQL/Postgres, migraciones), `aos-<slug>-mobile` (Flutter).

Regla de modelo (ahorro sin perder calidad):
- `haiku`: trabajo repetitivo y guiado por plantilla en esa área (p. ej. generar un CRUD más siguiendo uno existente, añadir traducciones, crear un componente presentacional calcado de otro).
- `sonnet`: cambios que requieren entender lógica de negocio, estado, consultas o seguridad.
- Nunca `opus` en un especialista: el razonamiento difícil va a `aos-architect`.
- Si un área necesita ambos, crea solo el de `sonnet`; lo mecánico lo cubre `aos-quick`.

## 3. Escribe cada agente
En `<ruta de "aos agents path">/aos-<slug>-<área>.md`. Los nombres DEBEN empezar por `aos-<slug>-`. Formato:

```markdown
---
name: aos-<slug>-<área>
description: <una línea: qué tipo de cambios y en qué carpeta. Se carga en cada turno: ≤ 160 caracteres>
tools: <omitir = todas; o lista mínima, p. ej. Read, Grep, Glob, Edit, Write, Bash>
model: haiku|sonnet
---
Especialista en <área> de <proyecto>.

## Convenciones (las reales del repo, con rutas)
- …
## Cómo verificar
- <comando de test/lint del área>; para ejecutarlo usa `aos-test-runner`.
## Límites
- Solo toca <rutas>. Si el cambio cruza áreas o exige decidir diseño, devuélvelo con una propuesta en ≤ 5 líneas.
- Respuesta final: archivos tocados + cómo verificar (≤ 10 líneas).
```

Cada archivo ≤ 30 líneas de cuerpo, sin relleno ni generalidades ("escribe código limpio"): solo lo específico del repo.

## 4. Instala y resume
- Borra de esa carpeta los `aos-<slug>-*` que ya no tengan sentido.
- Ejecuta `node "{{AOS}}/scripts/aos.mjs" agents sync` (los copia a `<repo>/.claude/agents/` y los excluye de git solo en local).
- Muestra `node "{{AOS}}/scripts/aos.mjs" agents list` y una tabla breve: agente · modelo · cuándo usarlo. Indica que estarán disponibles en la próxima sesión.
