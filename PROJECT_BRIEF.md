# Project Brief — Euromex Chat

> **Para sesiones nuevas:** pega este archivo (o el link) al inicio de la conversación. Te da el contexto necesario sin tener que releer todo `desicion.md` (1900+ líneas).

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

## 3. Decisiones arquitectónicas (ADRs)

### ADR-001 — PWA + Capacitor en lugar de React Native / Expo
- **Contexto:** mobile cross-platform. Equipo conoce React/Next.js, no React Native nativo.
- **Decisión:** PWA con Next.js + wrapper Capacitor para Android. JS/CSS/HTML viven en `apps/web`; el APK es shell delgado que carga `server.url` en WebView.
- **Alternativas:** React Native + Expo (curva nueva), TWA (no permite plugins nativos como `FLAG_SECURE`), Cordova (deprecado).
- **Riesgos:** WebView ≠ browser — algunos APIs pueden comportarse distinto. Mitigación: feature-detect siempre.

### ADR-002 — `tsx` en producción (no compilado a `dist/`)
- **Contexto:** los workspace packages `@euromex/shared` y `@euromex/crypto` exportan `.ts` directamente.
- **Decisión:** API corre con `tsx src/server.ts`. Workspace packages no se construyen.
- **Alternativas:** agregar build step a shared/crypto (más config). Compilar todo a `dist/` (más latencia de cold-start).
- **Riesgos:** ~200ms más de cold-start. Si pasamos a serverless, hay que migrar.

### ADR-003 — E2EE con NaCl `crypto_box` (no Signal protocol completo)
- **Contexto:** chat de empresa <25 personas, no app pública.
- **Decisión:** `crypto_box` + un envelope por device destinatario. Sin Double Ratchet ni X3DH completo.
- **Alternativas:** libsignal (overkill para 25 personas, complica multi-device), Matrix Olm/Megolm.
- **Riesgos:** sin forward secrecy completa — un device comprometido puede leer mensajes pasados que tenía. Aceptable para el threat model. Documentado en `desicion.md` y en el privacy policy.

### ADR-004 — Avisos de seguridad solo a "super admins"
- **Contexto:** los avisos de seguridad (download / watermark / banner) son audit events sensibles que no todos los admins necesitan ver.
- **Decisión:** flag `users.receives_security_alerts` per-user, desacoplado del `role='admin'`. Solo true ven los system messages.
- **Alternativas:** todos los admins (más simple pero mezcla privilegios), por conversación (más granular pero más UX).
- **Riesgos:** si nadie tiene el flag, los avisos se generan pero nadie los lee. El bootstrap admin lo trae activo por default.

### ADR-005 — Adjuntos restringidos = split de envelopes E2EE
- **Contexto:** adjuntos con acceso restringido a un subset de la conversación. La clave AES viaja en el plaintext del mensaje.
- **Decisión:** cliente cifra DOS payloads — `AttachmentPayload` (con fileKey/fileIv) para devices allowed, `AttachmentRestrictedPayload` (sin keys) para no-allowed. Cada device decifra su propio envelope.
- **Alternativas:** server controla acceso (rompe E2EE), envelope único con re-key dinámico (más complejo).
- **Riesgos:** si un device es allowed y luego revocado, ya tiene la clave AES — el adjunto queda accesible offline. Mitigación documentada.

### ADR-006 — Migrations con runner CLI, append-only
- **Contexto:** incidente 2026-05-05 — migrations 010-012 nunca aplicadas en VPS aunque el código las requería desde Fase 24.
- **Decisión:** tabla `schema_migrations(version, checksum, applied_at, applied_by)` + runner `apps/api/src/scripts/migrate.ts` con comandos `status`/`apply`/`bootstrap`/`dry-run`. Migrations son **append-only**: cambiar un `.sql` aplicado emite `CHECKSUM MISMATCH` pero no re-aplica.
- **Alternativas:** `db-migrate` o `node-pg-migrate` (deps grandes), Markdown con metadata embedida (sobreingeniería).
- **Riesgos:** runner depende de `DATABASE_URL` puro — si alguien lo invoca sin source del `.env`, falla con mensaje claro.

### ADR-007 — Biometría = unlock local, NO reemplazo de TOTP
- **Contexto:** UX moderna requiere "iniciar con huella". Pero la biometría es local — el server nunca la ve.
- **Decisión:** server emite un `biometric_unlock_token` (JWT 90d) tras validar TOTP. Cliente lo guarda en Keystore/Keychain cifrado con biometría. El token ES la prueba en futuros logins. JTI rotable para revocación instantánea.
- **Alternativas:** WebAuthn / Passkeys (más estándar pero más complejo, considerado para Fase 29), guardar password en Keystore (pésimo).
- **Riesgos:** si JWT 90d se filtra desde el Keystore (root del device), atacante tiene session por 90 días. Mitigación: admin puede revocar device → unlock falla.

### ADR-008 — Subdomain delegation rechazado, dominio dedicado
- **Contexto:** `chat.grupoeuromex.com` no se publicaba (bug Hostinger DNS estructural). 4 alternativas probadas (A records directos, borrar ALIAS, NS delegation a he.net, Cloudflare full domain).
- **Decisión:** dominio dedicado `euromex.xyz` (regalado por Hostinger, $0/año primer año). Topología: chat en apex, `api` en subdominio.
- **Alternativas:** Cloudflare full domain (riesgo al web/correo corporativo), seguir con sslip.io (rompe si cambia IP del VPS), pagar dominio nuevo $10/año.
- **Riesgos:** dominio gratis primer año — al renovar, evaluar si vale la pena pagar o migrar. Si Hostinger DNS también falla con `euromex.xyz`, plan B es Cloudflare DNS solo para este dominio (sin riesgo al corporativo).

### ADR-009 — Coexistencia con n8n / Traefik / email-admin del cliente
- **Contexto:** VPS también corre infra del cliente.
- **Decisión:** NO tocar `root-*` containers. NO `apt upgrade -y`. NO `ufw --force enable` sin permiso. Traefik del cliente sirve nuestros containers via Docker labels.
- **Alternativas:** VPS dedicado (más caro), Docker network propia (más config).
- **Riesgos:** un cambio de Traefik del cliente puede romper nuestros routings. Mitigación: monitoreo manual + audit log de status checks.

### ADR-010 — Storage filesystem local, NO MinIO/S3
- **Contexto:** adjuntos cifrados E2EE (server no los puede leer).
- **Decisión:** disk local (`/opt/euromex/storage/`, mode 700). Cliente sube blob, server solo guarda referencia.
- **Alternativas:** MinIO self-hosted (more infra), S3 (costo + lock-in cloud).
- **Riesgos:** filesystem se llena → bloquea uploads. Mitigación: monitoreo de espacio + límite `MAX_ATTACHMENT_BYTES`.

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

### DECISIONS / desicion.md
Cada decisión técnica no trivial → entrada en `desicion.md`:
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

1. **Lee `desicion.md`** — fuente de verdad del histórico de decisiones (1900+ líneas, ordenado descendente).
2. **`HOSTINGER.md`** — runbook operacional (deploy, backup, troubleshooting, check pre-flight de migrations).
3. **Estado actual:** ver sección "Estado actual" del `desicion.md` (líneas 124-145 aprox).
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

## 9. Workflow del desarrollo (acordado 2026-05-06)

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

**Última actualización:** 2026-05-06
**Branch activa:** `claude/private-chat-mac-auth-e9QYn`
**Última fase completada:** Fase 28 — Tracker de migrations
**En curso:** migración a `euromex.xyz` (DNS propagating)
