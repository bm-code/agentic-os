# standing-desk-timer (DeskTimer)

## Qué es
App web Angular para jornada con mesa elevable (sentado/de pie, pausas activas, meta diaria + racha). Remote: `git@github.com:bm-code/standing-desk.git`.
El repo ya tiene `CLAUDE.md` completo (stack, arquitectura, reglas, dominio, skills): no se duplica aquí. Leerlo primero.

## Stack y comandos
Los principales están en CLAUDE.md. Extra:
- `npm run watch` → build de desarrollo en watch.
- `npm run format:check` → prettier --check (no está en CI).
- `npm test` arranca en watch; para una pasada usa `npm run test:ci`.
- CI: `.github/workflows/ci.yml` (push a main y PRs; Node 22, `npm ci` → lint → test:ci → build). Sin despliegue configurado.

## Convenciones
- Estado del plan (`docs/PLAN.md`): fases 0–6 completadas (último commit `6af9e45`). Se trabaja directamente en `main` pese a que el plan cita ramas `feat/…`.
- Pendiente según el plan: E2E con Playwright, PWA con notificaciones con la app cerrada, recordatorio de inicio de jornada, exportar/importar perfil.
- Objetivos de cobertura: ≥90 % en `domain/`, ≥70 % global (sin umbral en CI).

## Notas
- Presupuesto de bundle en `angular.json:60`: aviso 420 kB, error 550 kB; "hecho" exige cero avisos.
- README y `profile-section.component.html` prometen "todo local": cambios de persistencia deben respetarlo.
- `coverage/` y `dist/` existen en disco: no commitearlos.
- `AGENTS.md` debería ser una línea que apunte a CLAUDE.md (sin verificar); README puede mencionar aún "plantas del edificio".
