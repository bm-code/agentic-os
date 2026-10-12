# Agentic OS

Hub personal para trabajar con **Claude Code** en varios equipos (macOS y Windows) con:

- **Memoria persistente entre sesiones**: cada sesión arranca con el contexto del proyecto, las tareas abiertas y el handoff de la última sesión.
- **Proyectos y tareas** organizados en Markdown. Cada proyecto sigue en su propio repo; el OS solo los referencia.
- **Dashboard local** desde el que lanzas Claude sobre una tarea (plan → aprobar → ejecutar), ves lo que hace en directo y gestionas git (commit y sync) sin abrir la terminal.
- **Agentes por niveles de coste**: lo mecánico con Haiku, lo que requiere criterio con Sonnet y el razonamiento difícil con Opus.
- **Consumo** de tokens por día, modelo, proyecto y sesión, más statusline.
- **Ahorro de cuota** (Pro/Max): briefs cortos, subagente barato en Haiku, `opusplan` y hábitos de `/clear`.

No necesita `npm install`: solo **Node ≥ 20** y **git**.

## Instalación

```bash
git clone git@github.com:bm-code/agentic-os.git
cd agentic-os
node scripts/install.mjs --machine mac-personal   # en Windows, p. ej.: --machine pc-trabajo
```

Después, reinicia Claude Code. `npm run doctor` comprueba la instalación.

> Antes de usarlo: rellena `memory/global.md` con tus preferencias (idioma, stack…). Se carga en todas tus sesiones y equipos.

El instalador **fusiona** con tu `~/.claude/settings.json` (guarda una copia en `.local/backups/`) y:

- añade los hooks `SessionStart`, `PreCompact` y `SessionEnd`, la statusline, los permisos y `AGENTIC_OS_HOME`;
- copia las skills `/aos-*` y el subagente `explorer` a `~/.claude/`;
- añade un bloque gestionado a `~/.claude/CLAUDE.md` que importa `memory/global.md` (tu contenido se conserva).

Vuelve a ejecutarlo tras cada `git pull` que cambie `claude/`. Para quitarlo: `node scripts/install.mjs --uninstall`.

## Empezar con un proyecto (guía rápida, desde el dashboard)

El dashboard es la forma principal de usar el OS. Tras la instalación, para **cualquier proyecto**:

### 1. Prepara el proyecto (una vez)
El proyecto debe ser un repositorio git con al menos un commit. Si es nuevo y aún no lo es:

```bash
cd ~/Proyectos/mi-app
git init -b main && git add -A && git commit -m "init"
git remote add origin git@github.com:tu-usuario/mi-app.git   # opcional, pero necesario para Sync
```

### 2. Abre el dashboard
```bash
cd agentic-os && npm run dashboard      # http://localhost:4747
```
Déjalo abierto en una terminal o en segundo plano; es lo único que necesitas lanzar.

### 3. Registra el proyecto
En **Inicio → “+ Registrar proyecto”** pulsa **Examinar…**: se abre el selector de carpetas de tu sistema (Finder, Explorador de Windows, o zenity/kdialog en Linux), eliges la carpeta y se rellena la ruta. Si no se abre, puedes escribirla a mano (`/Users/tu/Proyectos/mi-app` o `C:\dev\mi-app`). Si la carpeta no es un repo git, te avisa. Añade un nombre si quieres. Se abre la vista del proyecto. Ya puedes crear tareas y lanzarlas, usando los agentes globales (Haiku/Sonnet/Opus).

### 4. Genera su contexto y sus especialistas (una vez por proyecto)
Esto lo hace Claude analizando tu repo, y de momento se lanza desde Claude Code. Es el **único paso con terminal**:

```bash
cd ~/Proyectos/mi-app
claude
> /aos-register
```

Crea `context.md` (qué es, stack, comandos, convenciones) y **2-4 especialistas** del proyecto (`aos-mi-app-ui`, `-api`…). Sin este paso todo funciona, pero Claude trabaja con menos conocimiento del repo y sin especialistas baratos. Cuando cambie mucho el repo, regenera con `/aos-agents`. Refresca el dashboard para ver el contexto y los agentes en el desplegable “Contexto, agentes y última sesión”.

### 5. Trabaja una tarea
1. **+ Nueva** → título, prioridad y especificación (cuanto más concreta, mejor y más barato). Deja la complejidad en *Auto*: Haiku la estima en segundos.
2. **Planificar con Claude** → crea la rama `aos/<id>` y devuelve un plan sin tocar nada. Si no te convence, escribe feedback y se re-planifica.
3. **Aprobar y ejecutar** → sigue el feed en directo. ¿Se desvía? **Detener**, o pídele cambios en el cuadro de mensaje.
4. Revisa en el panel **Git**: pulsa un archivo para ver su diff, o *Diff de la tarea* para verlo entero frente a la rama base.
5. Escribe el mensaje y pulsa **Commit**, después **Sync** para subir la rama.
6. **Marcar hecha** cuando termines. Guarda el handoff y deja la tarea cerrada.

Para el siguiente trabajo, repite el paso 5. Para añadir otro proyecto, repite desde el paso 1.

### En un segundo equipo (p. ej. el Windows del trabajo)
`git clone` del OS → `node scripts/install.mjs --machine pc-trabajo` → `npm run dashboard` → en **Registrar proyecto** indica la ruta de ese mismo proyecto **en ese equipo**. Las tareas, el contexto, los handoffs y los especialistas llegan con `git pull` del OS (`npm run sync`, o `/aos-sync`). Los agentes se copian solos al repo la primera vez que abres Claude allí.

### Si algo falla
| Síntoma | Causa y solución |
|---|---|
| “Hay cambios sin commitear…” al lanzar | La tarea necesita cambiar de rama: haz commit (panel Git) o `git stash` |
| “Ya hay una ejecución en marcha” | Un proyecto ejecuta una cosa a la vez: espera o pulsa **Detener** |
| “No clonado en este equipo” | Registra la ruta de ese proyecto en este equipo (paso 3) |
| “token no válido” | Recarga la página: el token cambia en cada arranque del dashboard |
| No arranca Claude (Windows) | Indica su ruta en `.local/config.json` (ver Seguridad más abajo) |
| Sync pide credenciales | Configura SSH o el gestor de credenciales de git; el dashboard no puede responder a prompts |

## Uso desde la terminal (opcional)

Todo lo anterior también se puede hacer con Claude Code, sin dashboard:

| Momento | Qué hacer |
|---|---|
| Primera vez en un proyecto | `/aos-register` genera `context.md` y los especialistas explorando el repo con Haiku |
| Al abrir Claude | Nada: el brief del proyecto se inyecta solo |
| Tareas | `/aos-task add "…" --p P1`, `/aos-task list`, `/aos-task done <id>` |
| Descubres algo útil | `/aos-remember "…"` (o `--global` si vale para varios proyectos) |
| Terminas un bloque / el contexto pasa del 60 % | `/aos-handoff` y luego `/clear` |
| Cambias de equipo | `/aos-sync` (o `npm run sync`) en ambos |
| Qué tengo pendiente | `/aos-status` |
| Regenerar agentes del proyecto | `/aos-agents` |
| Consumo | `/aos-usage` o `npm run dashboard` |
| Una vez por semana | `/aos-review` |

Las sesiones abiertas en la terminal y las del dashboard comparten la misma memoria. Si te olvidas del handoff, los hooks guardan uno **automático** al compactar y al cerrar la sesión. Se extrae del transcript, así que no gasta tokens.

## Dashboard: qué puedes hacer

`npm run dashboard` → http://localhost:4747. Cada proyecto tiene su vista (`#/p/<proyecto>`). Guía paso a paso arriba; resumen de capacidades:

1. **Nueva tarea** con título, prioridad y especificación. Haiku estima la complejidad (S/M/L) y puedes cambiarla.
2. **Planificar con Claude**: crea la rama `aos/<id>`, investiga y propone un plan **sin editar nada**.
3. Lees el plan en el feed: **Aprobar y ejecutar**, o escribes feedback y re-planifica.
4. Ves en directo mensajes, herramientas, diffs y qué subagente trabaja, con tokens por modelo al final de cada turno. **Detener** mata el proceso.
5. Panel **Git** tipo VS Code: archivos cambiados, diff, mensaje, **Commit**, **Sync** (pull --rebase + push; publica la rama si es nueva) y **Fetch**.
6. **Marcar hecha** guarda un handoff, así la siguiente sesión en la terminal sabe qué se hizo.

La complejidad decide el modelo principal: **S** → Haiku, **M** → Sonnet, **L** → Opus planifica y Sonnet ejecuta. Una sesión del dashboard se puede continuar en la terminal con `claude --resume`.

Seguridad: solo escucha en 127.0.0.1, valida Host y Origin y exige un token que cambia en cada arranque (el servidor puede ejecutar Claude y git en tus proyectos). Un proyecto solo ejecuta una cosa a la vez, y no se lanza una tarea si hay cambios sin commitear. Si `claude` no está en el PATH, indícalo en `.local/config.json`: `{"dashboard": {"claudeBin": "C:\\ruta\\claude.exe"}}`.

## Agentes por niveles de coste

Instalados en `~/.claude/agents/` para todos los proyectos:

| Agente | Modelo | Para qué |
|---|---|---|
| `explorer` | Haiku | buscar y leer código, devolviendo solo la conclusión |
| `aos-quick` | Haiku | cambios mecánicos (renombrar, textos, boilerplate, lint) |
| `aos-test-runner` | Haiku | ejecutar tests/build y devolver solo los fallos |
| `aos-builder` | Sonnet | features y bugs de alcance medio |
| `aos-reviewer` | Sonnet | revisar el diff antes de commit |
| `aos-architect` | Opus | diseño y depuración difícil; solo propone |

`/aos-register` (o `/aos-agents` cuando cambie el repo) añade **2-4 especialistas por proyecto** (`aos-<proyecto>-ui`, `-api`, `-db`…) con las convenciones reales del repo. Se guardan en `projects/<slug>/agents/` (se sincronizan entre equipos) y se copian a `<repo>/.claude/agents/`, **excluidos de git solo en local** (`.git/info/exclude`), así que no ensucian el repo. El hook de inicio los mantiene al día. La política de delegación está en `claude/CLAUDE.global.md`: el hilo principal coordina y delega en el agente más barato que haga bien el trabajo.

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
dashboard/               servidor local (lib/: git, runner de Claude, eventos) + UI sin dependencias
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
