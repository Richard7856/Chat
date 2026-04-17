# desicion.md — Bitácora de decisiones y progreso

> **Lee esto primero al retomar el proyecto.** Es la fuente única de verdad
> sobre qué se ha decidido, por qué, y qué sigue. Cada commit significativo
> debe agregar una entrada aquí.

## Estado actual

- **Fase:** 1 — Fundación (scaffolding del monorepo e infra local)
- **Paso dentro de la fase:** completado el esqueleto; pendiente instalar
  dependencias y correr smoke test con `pnpm dev`
- **Última actualización:** 2026-04-17
- **Branch activa:** `claude/private-chat-mac-auth-e9QYn`
- **Plan aprobado:** `/root/.claude/plans/te-comento-a-grandes-buzzing-wand.md`

## Próximos pasos

1. `pnpm install` en la raíz, luego `pnpm typecheck` para verificar que todo
   compila contra las versiones reales de las dependencias.
2. Levantar `pnpm infra:up` y verificar que `/health` devuelve
   `deps: { postgres: "up", redis: "up" }`.
3. Iniciar **Fase 2 — Auth + enrollment**: invitaciones, Argon2id, TOTP, JWT
   de sesión, flujo de primer dispositivo, admin mínimo para emitir
   invitaciones. Añadir Drizzle ORM y migraciones en este paso.

## Historial de decisiones

### [2026-04-17] Chat privado custom en lugar de Telegram / WhatsApp Business

- **Qué se decidió:** construir un chat self-hosted propio para Grupo Euromex
  en vez de adoptar una app externa.
- **Por qué:** se busca privacidad máxima, branding propio y control total
  del dato. Telegram es más seguro que WhatsApp pero no es self-hosted ni
  personalizable. Matrix/Rocket.Chat/Mattermost se descartaron porque el
  usuario pidió explícitamente **custom desde cero** (ver pregunta "Enfoque").
- **Impacto:** todo el repo.
- **Propuesto por:** usuario.

### [2026-04-17] Autenticación por MAC address — **descartada**

- **Qué se decidió:** NO usar MAC address como mecanismo de autenticación.
- **Por qué:** el usuario pidió originalmente "solo MACs reconocidas pueden
  hablar", pero esto no funciona cuando hay acceso desde internet: los
  navegadores no exponen la MAC, los servidores remotos nunca la ven
  (solo los routers locales), y es trivialmente falsificable. Se registra
  aquí para no re-discutirlo.
- **Sustituto:** modelo "device enrollment + 2FA + E2EE" — misma propiedad
  ("solo dispositivos autorizados pueden hablar") pero realizable en internet.
- **Impacto:** define el modelo de seguridad completo (Fase 2–4).
- **Propuesto por:** Claude (corrección técnica).

### [2026-04-17] Modelo de seguridad definitivo

- **Qué se decidió:** invitación del admin (código de un solo uso, 24h) +
  Argon2id + TOTP obligatorio + enrollment explícito de dispositivos +
  E2EE con Signal Protocol. Nuevos dispositivos se aprueban desde uno ya
  activo. Revocación inmediata vía Redis pub/sub.
- **Por qué:** cubre el requisito de "solo dispositivos autorizados" sin
  depender de la red. Signal Protocol es el estándar auditado (Double
  Ratchet + X3DH) y existe una lib oficial (`@signalapp/libsignal-client`),
  no reinventamos crypto.
- **Impacto:** tablas `users`, `devices`, `invitations`, `one_time_prekeys`,
  `messages`, `message_envelopes` en `apps/api/src/db/schema.sql`.
- **Propuesto por:** Claude, aceptado por el usuario.

### [2026-04-17] Stack: Node.js + Fastify + Next.js + Postgres + Redis

- **Qué se decidió:** backend en Fastify (TS, ESM), frontend en Next.js 15
  (App Router), datos en Postgres 16, cache/pubsub en Redis 7.
- **Por qué:**
  - **Fastify** vs Express/NestJS: más liviano, schemas/validación
    integrados, tipado excelente, suficiente para <25 usuarios.
  - **Next.js** vs Vite SPA: permite SSR si se quiere marketing page + PWA
    installer out of the box + mismo stack para panel admin.
  - **Postgres** vs MySQL: JSONB para `audit_log`, tipos más ricos,
    `pgcrypto` listo.
  - **Redis** ya era necesario para rate limiting y socket fan-out.
- **Impacto:** todo el código generado en Fase 1.
- **Propuesto por:** Claude, aceptado por el usuario.

### [2026-04-17] Monorepo con pnpm workspaces + Turbo

- **Qué se decidió:** monorepo en vez de repos separados.
- **Por qué:** `/packages/crypto` (Fase 4) se compartirá entre `apps/web` y
  `apps/mobile`. Los schemas Zod de `/packages/shared` se importan desde
  `api`, `web`, y `mobile`. pnpm es más eficiente en disco que npm; Turbo
  cachea builds por paquete.
- **Impacto:** `pnpm-workspace.yaml`, `turbo.json`.
- **Propuesto por:** Claude.

### [2026-04-17] Deploy en VPS propio del cliente

- **Qué se decidió:** hosting en el VPS que Grupo Euromex ya tiene, con
  Docker Compose + Nginx + Let's Encrypt.
- **Por qué:** el usuario ya cuenta con un VPS (confirmado en la conversación
  al aprobar el plan). No se contrata cloud nuevo. <25 usuarios no requiere
  Kubernetes ni autoescalado.
- **Impacto:** `infra/docker-compose.yml`, runbook de deploy (Fase 7).
- **Propuesto por:** usuario.

### [2026-04-17] Bitácora `desicion.md` como contexto persistente

- **Qué se decidió:** mantener este archivo como fuente única de verdad del
  proyecto; cada commit significativo actualiza el estado, las decisiones y
  los cambios por versión.
- **Por qué:** Claude pierde contexto entre sesiones. Un archivo leído al
  inicio elimina re-preguntas y evita re-tomar decisiones ya cerradas.
- **Impacto:** flujo de trabajo de todas las fases.
- **Propuesto por:** usuario.

## Cambios por versión

### v0.1.0 — 2026-04-17 — Fundación (Fase 1)

- **Agregado:**
  - Monorepo pnpm + Turbo (`package.json`, `pnpm-workspace.yaml`,
    `turbo.json`, `tsconfig.base.json`).
  - `infra/docker-compose.yml` con Postgres 16 + Redis 7 (volúmenes locales
    en `infra/volumes/`, bindings solo a `127.0.0.1`).
  - Esquema inicial de DB (`apps/api/src/db/schema.sql`): `users`,
    `invitations`, `devices`, `one_time_prekeys`, `conversations`,
    `conversation_members`, `messages`, `message_envelopes`, `audit_log`.
    El schema se carga vía `docker-entrypoint-initdb.d/` al primer arranque.
  - `apps/api` — Fastify + Helmet + CORS + rate-limit + endpoint `/health`
    que pinguea Postgres y Redis.
  - `apps/web` — Next.js 15 App Router con una página placeholder que
    explica el estado del proyecto.
  - `packages/shared` — Zod schemas iniciales (`HealthResponse`,
    `UserRole`, `DevicePlatform`, `DeviceStatus`, `ConversationType`).
  - `.gitignore`, `README.md`, este `desicion.md`.
- **Modificado:** n/a (primer commit).
- **Removido:** n/a.
- **Decisiones referenciadas:** todas las del 2026-04-17.
- **Verificación pendiente:** `pnpm install` + `pnpm typecheck` + `pnpm dev`
  + `curl http://localhost:4000/health`.
