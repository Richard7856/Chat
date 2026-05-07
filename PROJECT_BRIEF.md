# Project Brief — Euromex Chat

> **Para sesiones nuevas:** pega este archivo (o el link) al inicio de la conversación. Te da el contexto operacional necesario sin tener que releer historiales largos.
>
> **Documentación complementaria:**
> - [DECISIONS.md](DECISIONS.md) — el razonamiento detallado de cada ADR (40+ decisiones, formato Contexto/Decisión/Alternativas/Riesgos)
> - [KNOWN_ISSUES.md](KNOWN_ISSUES.md) — parches críticos pendientes, edge cases conocidos, hardening propuesto
> - [HOSTINGER.md](HOSTINGER.md) — runbook operacional (deploy, backup, troubleshooting)
> - [archive/HISTORY.md](archive/HISTORY.md) — bitácora histórica completa por fecha (1900+ líneas)

---

## 1. Objetivo

Chat E2EE self-hosted para **Grupo Euromex** (insurance / distribución, México), <25 personas. Reemplazo interno de WhatsApp con seguridad fuerte. Web (PWA) + Android (APK Capacitor). iOS scaffold listo, sin publicar todavía.

**Producción:** `https://euromex.xyz` + `https://api.euromex.xyz` (en migración 2026-05-05 desde sslip.io). VPS Hostinger compartido con n8n + Traefik del cliente — coexistencia obligatoria.

---

## 2. Stack

| Capa | Tecnología |
|---|---|
| Web | Next.js 15 App Router + Tailwind + shadcn/ui |
| API | Fastify + Socket.IO + `@fastify/jwt` |
| BD | PostgreSQL 16 (Docker) + Redis 7 |
| E2EE | tweetnacl (NaCl `crypto_box`) — wrappers en `packages/crypto` |
| Mobile | Capacitor 6 (Android) — wrapper que carga la PWA remota |
| Storage | filesystem local (`/opt/euromex/storage/`, AES-256-GCM cliente) |
| Deploy | systemd + Docker (PG/Redis) + Traefik del cliente |
| Backups | GPG symmetric (AES-256), timer diario 03:00 UTC |
| Auth | Argon2id + TOTP obligatorio + JWT firmado con master secret |
| Biometría | `capacitor-native-biometric` (mobile only, unlock local) |

---

## 3. Decisiones arquitectónicas (resumen)

40+ decisiones documentadas en formato ADR (Contexto / Decisión / Alternativas / Riesgos). Las más importantes:

| ID | Decisión | Severidad |
|---|---|---|
| ADR-001 | Stack Fastify + Next.js + Postgres + Redis | Foundational |
| ADR-002 | Monorepo pnpm sin hoist | Foundational |
| ADR-006 | E2EE con NaCl crypto_box (no Signal protocol) | Foundational |
| ADR-007 | Encriptación por device con cache de claves | Foundational |
| ADR-009 | Adjuntos restringidos = split de envelopes | Crítica para HR docs |
| ADR-018 | Biometría = unlock local, NO reemplazo de TOTP | Crítica para UX mobile |
| ADR-019 | Coexistencia con infra del cliente | Operacional |
| ADR-020 | Migrations append-only con runner CLI | Operacional |
| ADR-022 | PWA + Capacitor (no React Native) | Mobile foundational |
| ADR-026 | Package mobile renombrado a `com.grupoeuromex.chat` | Mobile foundational |
| ADR-034 | Migración a dominio dedicado `euromex.xyz` | Infraestructura |
| ADR-036 | Edit/borrar mensajes con auditoría preservada | Compliance |

**📖 Lee el contexto completo en [DECISIONS.md](DECISIONS.md)** — ADRs agrupados por categoría (Arquitectura / E2EE / Auth / DB / Mobile / Adjuntos / Infra / DNS / UX / Decisiones rechazadas).

---

## 4. Convenciones de código

### Comentarios — explican WHY, no WHAT
```ts
// BAD:  Loop through users
// GOOD: Filter inactive users before billing — Stripe charges per active seat
```

### Cada función / módulo tiene
1. Comentario de propósito (1 línea: qué problema resuelve)
2. Documentación de parámetros / return para tipos no obvios
3. Warnings de edge cases donde aplique

### Naming
- Funciones: `verb_noun` → `getUser`, `validateToken`, `syncCrmData`
- Booleanos: `is_` / `has_` / `can_` → `isActive`, `hasPermission`, `canDownload`
- Constantes: `UPPER_SNAKE` → `MAX_RETRIES`, `API_BASE_URL`
- Files: `kebab-case` → `user-service.ts`, `crm-handler.py`

### Errores
- NUNCA tragar errores. Log o propagate.
- Mensajes con contexto: qué se intentó, con qué input.
- API integrations: handle explícito de timeout, auth failure, rate limit.

### Git commits
Formato: `type(scope): description`
- `type` ∈ `feat | fix | refactor | docs | test | chore | build`
- Ejemplo: `feat(auth): C3+C4 — usuario puede cambiar password y rotar 2FA`
- Co-Author tag al final si aplica

### Bitácora de decisiones
Cada decisión técnica no trivial → ADR nuevo en `DECISIONS.md`:
```markdown
## [YYYY-MM-DD] Título
**Contexto:** qué problema disparó la decisión
**Decisión:** qué se eligió
**Alternativas:** qué más se consideró (y por qué no)
**Riesgos:** qué puede fallar
**Próximos pasos:** acciones derivadas
```

---

## 5. Variables de entorno

### `apps/api/.env`
```bash
DATABASE_URL=postgres://USER:PASS@127.0.0.1:5432/euromex
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=<32+ chars random>
MASTER_ENC_KEY=<base64 32 bytes>     # cifra TOTP secrets en BD — IRRECUPERABLE
CORS_ORIGIN=https://euromex.xyz
WEB_BASE_URL=https://euromex.xyz
PORT=4000
LOG_LEVEL=info
STORAGE_DIR=/opt/euromex/storage
MAX_ATTACHMENT_BYTES=52428800        # 50 MB
VAPID_PUBLIC_KEY=<base64>            # web push (Fase 19)
VAPID_PRIVATE_KEY=<base64>
VAPID_SUBJECT=mailto:admin@euromex.xyz
```

### `apps/web/.env.local`
```bash
NEXT_PUBLIC_API_BASE=https://api.euromex.xyz
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<misma que la del API>
```

### `/etc/euromex/backup.env` (en VPS)
```bash
EUROMEX_BACKUP_PASSPHRASE=<32+ chars>   # cifra los backups GPG — IRRECUPERABLE
REMOTE_RSYNC=user@host:/path             # opcional para off-site
```

---

## 6. Endpoints / contratos clave

### Auth (`apps/api/src/routes/auth.ts`)

| Método | Path | Notas |
|---|---|---|
| POST | `/auth/enroll/begin` | enrollar device con código de invitación |
| POST | `/auth/enroll/complete` | confirmar TOTP + crear user |
| POST | `/auth/login` | password + TOTP + deviceName → JWT session |
| POST | `/auth/reauth` | deviceId + TOTP (re-login rápido) |
| GET | `/auth/me` | datos del session actual |
| POST | `/auth/password` | cambiar password (current + new + TOTP) |
| POST | `/auth/totp/begin` | iniciar rotación 2FA (devuelve QR + rotationToken) |
| POST | `/auth/totp/confirm` | confirmar rotación con nuevo TOTP |
| POST | `/auth/biometric/enable` | activar unlock con huella (auth + TOTP) |
| POST | `/auth/biometric/unlock` | login con huella (no auth, token ES la prueba) |
| POST | `/auth/biometric/disable` | desactivar biometría |
| POST | `/auth/logout` | audit + 204 |

### Conversaciones / Mensajes (`/conversations.ts`)

| Método | Path | Notas |
|---|---|---|
| GET | `/conversations` | lista del usuario |
| POST | `/conversations` | crear DM o grupo |
| GET | `/conversations/:id/messages?limit=&before=` | paginación scroll-up por `created_at` |
| POST | `/conversations/:id/messages` | enviar (REST fallback, normal = socket) |
| PATCH | `/messages/:id` | editar (24h, solo sender, archiva envelopes) |
| DELETE | `/messages/:id` | borrar (soft, audit preservado) |
| POST | `/conversations/:id/read` | marcar leído |
| POST | `/conversations/:id/messages/:msgId/star` | guardar |
| GET | `/messages/:id/envelopes` | recuperar mi envelope (si existe) |

### Adjuntos (`/attachments.ts`)
- POST `/attachments/begin` → upload URL + storageKey
- POST `/attachments/:id/finalize` → asociar a mensaje
- GET `/attachments/:id` → blob cifrado (si tienes permiso)
- GET `/conversations/:id/attachments` → lista para panel docs

### Activities / Tasks (`/activities.ts`, `/tasks.ts`)
- CRUD + RSVP (`/activities/:id/rsvp` → confirmed | declined | pending)
- CRUD tasks + status (`/tasks/:id/assignees/:userId/status`)

### Admin (`/admin.ts`)
- GET/PATCH `/admin/users` (rol, status, permisos, displayName, email, jobTitle, ...)
- GET `/admin/users/:id/devices` + POST `/admin/devices/:id/revoke`
- GET `/admin/audit-log?action=&from=&to=`
- POST `/admin/invitations` + DELETE
- GET `/admin/security-alerts`

### Socket events (clave para integraciones futuras)

```
client → server:
  authenticate { token }
  message:send { conversationId, envelopes[], contentType, attachmentId? }
  presence:ping

server → client:
  message:new { ...Message }
  message:edited { messageId, conversationId, envelope, editCount, editedAt }
  message:deleted { messageId, conversationId, deletedAt, deletedByUserId }
  message:read { messageId, userId, readAt }
  activity:updated / task:updated
  presence:update { userId, online, lastSeenAt }
  device:revoked / session:terminated
```

### Health / migrate
- `GET /health` → `{ status: "ok" }` (sin auth)
- `pnpm --filter @euromex/api migrate:status` (CLI, no HTTP)

---

## 7. Lo que NO está en scope (decidido NO hacer)

| Cosa | Razón |
|---|---|
| Voice / video calls | Diferido explícitamente por el cliente. Implica WebRTC + signaling + STUN/TURN. |
| Federación tipo Matrix | Esto es chat de empresa, no Matrix. |
| Cifrado homomórfico para búsqueda server-side | Overkill — la búsqueda client-side cubre el caso (Fase 29 propuesta como I1). |
| Double Ratchet / forward secrecy completa | Proyecto en sí. Aceptamos modelo actual (un device comprometido puede leer mensajes pasados que tenía). |
| iOS publishing | Scaffold listo, pero requiere $99/año Apple + cuenta verificada + screenshots. Fase futura. |
| Multi-tenant SaaS | Un solo tenant (Grupo Euromex). Si esto cambiara, todo el modelo de auth se rediseña. |
| Server reads plaintext | E2EE invariante. Exception documentada: system messages (audit events del server, plaintext intencional). |
| Auto-borrado de mensajes | Disappearing messages no implementado. Si se pide, requiere job cron + edge cases con devices offline. |
| Push proactivo desde el server al APK | Hoy push viene del WebView (web push). FCM nativo es M2 del audit, pendiente. |

---

## 8. Cómo retomar el proyecto

1. **Lee este archivo (`PROJECT_BRIEF.md`)** primero — visión + stack + roadmap. Luego [`DECISIONS.md`](DECISIONS.md) (razonamiento de cada decisión) y [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) (lo que está pendiente o roto).
2. **`HOSTINGER.md`** — runbook operacional (deploy, backup, troubleshooting, runner de migrations).
3. **Estado actual:** sección 9 "Roadmap" de este archivo (lista de fases 1-28 + pendientes inmediatos).
4. **Detalle histórico:** `archive/HISTORY.md` (bitácora cronológica original, 1900+ líneas, descendente).
4. **Comandos top:**
   ```bash
   # Estado servicios VPS
   systemctl status euromex-api euromex-web --no-pager

   # Logs en vivo
   journalctl -u euromex-api -f

   # Deploy nueva versión (post-Fase 28)
   cd /opt/euromex && git pull && pnpm install
   cd apps/api && source .env && pnpm migrate
   cd ../web && pnpm build
   systemctl restart euromex-api euromex-web

   # Backup manual
   sudo systemctl start euromex-backup.service

   # Crear admin nuevo
   ADMIN_USERNAME=x ADMIN_PASSWORD='xxx' ADMIN_DISPLAY='X' \
     /opt/euromex/apps/api/node_modules/.bin/tsx \
     /opt/euromex/apps/api/src/scripts/create-admin.ts
   ```

---

## 9. Roadmap

### ✅ Completado (Fases 1-28)

| # | Fase | Qué |
|---|---|---|
| 1-7 | Foundational | Auth básico, DB, Redis, Socket.IO, deploy producción HTTPS, backups |
| 8.1, 8.2 | Avisos seguridad | Watermark, banner, super-admins watchers |
| 9 | Admin web | Panel users, invitaciones, audit log |
| 10 | Organigrama | Cargo, depto, jefe, árbol visual |
| 12 | Edit perfil admin | Modal displayName + email |
| 13 | Re-auth TOTP | Soft logout, multi-dispositivo |
| 14 | Docs library | Adjuntos restringidos + PIN argon2 |
| 15 | Activities + Tasks | RSVP, multi-asignados, cards interactivos |
| 16-17 | Calendar + galería | Vista mensual + galería medios + saved messages |
| 18-19 | Presence + Push | ✓✓ leído, online status, web push notifications, @mentions |
| 20 | Calendar semanal | Toggle vista semanal con polish (botón Hoy + hora) |
| 23a, 23b | Mobile | APK Capacitor + FLAG_SECURE + multi-device backfill |
| 24 | Permisos granulares | 6 flags per-user (download, share, groups, invite, calls, max_mb) |
| 25 | Edit/borrar mensajes | Soft delete + edit history con auditoría preservada |
| 26 | C3+C4 + I4+I5 polish | Cambio password, rotación TOTP, scroll-up paginación |
| 27 | Biometric UX | Login con huella + step-up admin (mobile only) |
| 28 | Migrations runner | Tabla schema_migrations + CLI `pnpm migrate` |

### 🚀 Pendientes inmediatos (operacionales)

1. **DNS de `euromex.xyz` propagando** al TLD `.xyz` (en curso, ~30-60 min después de NS asignado)
2. **Deploy de Fase 28 al VPS** + `pnpm migrate:bootstrap` UNA SOLA VEZ
3. **Migrar config a `euromex.xyz`** en VPS (`.env` files + Traefik labels + rebuild + cert LE)
4. **Rebuild APK con nuevo dominio** (`pnpm cap sync android && pnpm build:android:debug`)
5. **Validar APK en device físico** (12-step smoke test, ver [KNOWN_ISSUES.md #10](KNOWN_ISSUES.md))
6. **Pushear los 6+ commits locales** a origin
7. **Aplicar parches críticos** del [análisis de robustez](KNOWN_ISSUES.md#1-parches-críticos-pendientes) (#1-#3 antes del primer release)

### 🎯 Próximo sprint propuesto

**Opción A — Fase 29: WebAuthn / Passkeys** (~3 sesiones, propuesto 2026-05-06)
- Motivación: app real cross-platform (web + mobile) con biometría unificada
- Reemplaza/complementa ADR-018 con estándar W3C
- Funciona en Mac (Touch ID), Windows (Hello), iOS (Face ID/Touch ID), Android
- Backend: `@simplewebauthn/server` + tabla `webauthn_credentials`
- Frontend: `@simplewebauthn/browser` + flujos register/authenticate

**Opción B — I1 Búsqueda client-side** (~3 sesiones, audit 2026-05-03)
- Caso de uso #1 en chat empresarial ("dónde estaba ese contrato")
- Como E2EE, búsqueda DEBE ser client-side: descifrar al cargar + buscar en memoria + IndexedDB
- Indexar mensajes ya descifrados en `localforage` o IndexedDB con búsqueda fuzzy

**Opción C — Hardening operacional** (~1-2 sesiones)
- Aplicar parches #1-#7 de [KNOWN_ISSUES.md](KNOWN_ISSUES.md)
- Tests Vitest para `packages/shared` y `packages/crypto`
- Monitoring básico (uptime-kuma)

### 🔮 Backlog (audit 2026-05-03 + propuestas)

- I2 Reacciones a mensajes (emoji, ~1 sesión)
- I3 Replies / quote (~2 sesiones)
- M1 Export de chat (ZIP con JSON descifrado, ~2 sesiones)
- M2 FCM nativo en APK (~2 sesiones)
- M3 iOS publishing (~3 sesiones — scaffold listo, falta wire-up Xcode + screenshots + cuenta Apple Dev verificada)
- M4 Tests Vitest + Playwright (~4 sesiones)
- Fase 11 SSO/JWT externo — bloqueado en definir scope con cliente

### ❌ Decidido NO hacer

- Voice/video calls (diferido cliente)
- Federación tipo Matrix
- Cifrado homomórfico para búsqueda server-side
- Forward secrecy completa (Double Ratchet)
- Multi-tenant SaaS
- Auto-borrado de mensajes / disappearing messages

Razones detalladas en [DECISIONS.md sección 10](DECISIONS.md#10-decisiones-rechazadas) y [PROJECT_BRIEF.md sección 7](#7-lo-que-no-está-en-scope-decidido-no-hacer).

---

## 10. Workflow del desarrollo (acordado 2026-05-06)

### Antes de confirmar código nuevo, responder en cada PR/feature:
1. **¿Qué casos edge no estás manejando?** (lista explícita, no "muchos")
2. **¿Qué pasa si [servicio externo / dependencia] falla o tarda mucho?**
3. **¿Hay supuestos que estés haciendo sobre los datos?** (ej. "asumo que `created_at` nunca es NULL")
4. **Si tuvieras que romper este código intencionalmente, ¿cómo lo harías?** (input adversarial, race conditions, escalada de privilegios)

Estas 4 preguntas son obligatorias antes del commit final de cualquier feature ≥medium.

### Complejidad
- **Simple** (<20 líneas, fix obvio): just do it.
- **Medium** (función nueva, endpoint, modificación non-trivial): explicar approach en 2-3 frases antes de codear.
- **Complex** (feature, cambio arquitectónico, multi-archivo): full planning + ADR + las 4 preguntas de arriba.

---

**Última actualización:** 2026-05-07
**Branch activa:** `claude/private-chat-mac-auth-e9QYn` (es la "main" de este repo)
**Última fase completada:** Fase D1 — desktop Electron shell con DLP base (screenshots, DevTools, context menu)
**Producción:** `https://euromex.xyz` ✅ live con cert LE · `https://api.euromex.xyz` ✅
**Roadmap Desktop activo:** D1 ✅ → D2 (download control) → D3 (UA filtering) → D4 (auto-update) → D5 (bundle estático) → D6 (code signing) → D7 (DLP avanzado)
**Documentación complementaria:**
- [DECISIONS.md](DECISIONS.md) — ADRs detallados
- [KNOWN_ISSUES.md](KNOWN_ISSUES.md) — parches + edge cases + hardening
- [HOSTINGER.md](HOSTINGER.md) — runbook operacional
- [archive/HISTORY.md](archive/HISTORY.md) — histórico cronológico (fuente original)
