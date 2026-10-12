# Agentic OS

Hub personal para trabajar con **Claude Code** en varios equipos (macOS y Windows) con:

- **Memoria persistente entre sesiones**: cada sesión arranca con el contexto del proyecto, las tareas abiertas y el handoff de la última sesión.
- **Proyectos y tareas** organizados en Markdown. Cada proyecto sigue en su propio repo; el OS solo los referencia.
- **Consumo** de tokens por día, modelo, proyecto y sesión, más statusline y dashboard local.
- **Ahorro de cuota** (Pro/Max): briefs cortos, subagente barato en Haiku, `opusplan` y hábitos de `/clear`.

No necesita `npm install`: solo **Node ≥ 20** y **git**.

## Instalación

```bash
git clone git@github.com:bm-code/agentic-os.git
cd agentic-os
node scripts/install.mjs --machine mac-personal   # en Windows, p. ej.: --machine pc-trabajo
```

Después, reinicia Claude Code. `npm run doctor` comprueba la instalación.

El instalador **fusiona** con tu `~/.claude/settings.json` (guarda una copia en `.local/backups/`) y:

- añade los hooks `SessionStart`, `PreCompact` y `SessionEnd`, la statusline, los permisos y `AGENTIC_OS_HOME`;
- copia las skills `/aos-*` y el subagente `explorer` a `~/.claude/`;
- añade un bloque gestionado a `~/.claude/CLAUDE.md` que importa `memory/global.md` (tu contenido se conserva).

Vuelve a ejecutarlo tras cada `git pull` que cambie `claude/`. Para quitarlo: `node scripts/install.mjs --uninstall`.

## Uso diario

| Momento | Qué hacer |
|---|---|
| Primera vez en un proyecto | `/aos-register` genera `context.md` explorando el repo con Haiku |
| Al abrir Claude | Nada: el brief del proyecto se inyecta solo |
| Tareas | `/aos-task add "…" --p P1`, `/aos-task list`, `/aos-task done <id>` |
| Descubres algo útil | `/aos-remember "…"` (o `--global` si vale para varios proyectos) |
| Terminas un bloque / el contexto pasa del 60 % | `/aos-handoff` y luego `/clear` |
| Cambias de equipo | `/aos-sync` (o `npm run sync`) en ambos |
| Qué tengo pendiente | `/aos-status` |
| Consumo | `/aos-usage` o `npm run dashboard` |
| Una vez por semana | `/aos-review` |

Si te olvidas del handoff, los hooks guardan uno **automático** al compactar y al cerrar la sesión. Se extrae del transcript, así que no gasta tokens.

## Cómo funciona la memoria

| Capa | Dónde | Alcance |
|---|---|---|
| Auto-memory de Claude Code | `~/.claude/projects/…/memory/` | proyecto + equipo (nativa) |
| Contexto, decisiones y aprendizajes | `projects/<slug>/`, `memory/` | proyecto, **sincronizada entre equipos** |
| Handoffs de sesión | `projects/<slug>/sessions/` | continuidad sesión a sesión |

Al iniciar, el hook `SessionStart` busca el directorio actual en `registry/projects.json` (por equipo) e imprime un brief de unas 40 líneas como máximo. Los límites se ajustan en `os.config.json → brief`.

## Estructura

```
registry/projects.json   proyectos y su ruta en cada equipo
projects/<slug>/         context.md · tasks.md · decisions.md · sessions/
memory/                  global.md (tus preferencias) · learnings.md
claude/                  plantillas que se instalan en ~/.claude
scripts/                 CLI (aos.mjs), hooks, statusline, instalador
dashboard/               servidor local + UI (sin dependencias)
.local/                  (gitignored) caché de uso, id de equipo, backups
```

## CLI

```bash
node scripts/aos.mjs help
npm run status | usage | sync | doctor | dashboard | test
```

## Configuración

- `os.config.json` (sincronizado): límites del brief, handoffs automáticos, sync automático (`pullOnSessionStart`, `commitOnSessionEnd`) y puerto del dashboard.
- `.local/config.json` (solo este equipo): mismas claves, sobrescribe lo anterior.
- El modelo por defecto que propone el OS es `opusplan` (Opus para planificar, Sonnet para ejecutar). El instalador no cambia el modelo si ya tienes uno configurado, salvo que uses `--force-model`.

## Windows

- Instala [Node LTS](https://nodejs.org) y [Git for Windows](https://git-scm.com). Claude Code usa Git Bash para sus comandos.
- Clona en una ruta sin espacios si puedes (p. ej. `C:\dev\agentic-os`) y ejecuta `node scripts\install.mjs --machine pc-trabajo`.
- Las rutas se comparan sin distinguir mayúsculas y aceptan `C:\…`, `C:/…` y `/c/…`.
