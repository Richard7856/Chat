# desicion.md — Bitácora de decisiones y progreso

> **Lee esto primero al retomar el proyecto.** Es la fuente única de verdad
> sobre qué se ha decidido, por qué, y qué sigue. Cada commit significativo
> debe agregar una entrada aquí.

## Onboarding rápido (para retomar en sesión nueva)

### Qué es este proyecto

Chat privado E2EE self-hosted para Grupo Euromex. Reemplazo interno de WhatsApp
para <25 personas. Stack: Next.js 15 + Fastify + Postgres + Redis + Socket.IO
+ NaCl (tweetnacl) para E2EE. PWA instalable en móvil. Deploy en VPS
Hostinger detrás de Traefik propio del usuario.

### Qué leer antes de tocar nada

1. **Este archivo (`desicion.md`)** — el "Estado actual" y el "Historial de
   decisiones" te dan todo el contexto de **qué hay vivo y por qué cada
   decisión** (incluyendo las descartadas).
2. **`HOSTINGER.md`** — runbook operacional: cómo desplegar, cómo actualizar,
   cómo hacer backup/restore, troubleshooting común.
3. **El plan original** en `/root/.claude/plans/te-comento-a-grandes-buzzing-wand.md`
   para ver el scope que se acordó con el usuario.

### Estructura del repo

```
apps/
  api/     Fastify + Socket.IO + scripts CLI (create-admin, reset-password)
  web/     Next.js 15 (App Router) + PWA + client-side crypto
packages/
  shared/  Zod schemas compartidos (auth, chat, attachments)
  crypto/  Wrappers NaCl (tweetnacl) — E2EE primitivas
infra/
  docker-compose.yml       Postgres + Redis locales
  traefik/                 Template YAML file provider (NO usado, ver decisiones)
  traefik-proxies/         SÍ usado: socat proxies con labels Docker
  systemd/                 Units para API, web, backup timer
  scripts/                 backup.sh, restore.sh, install-systemd.sh
HOSTINGER.md               Runbook de deploy
desicion.md                ESTE archivo
```

### Convenciones fijas del proyecto (Fase 8+)

Estas decisiones quedan congeladas para features futuros, a menos que el
usuario pida cambiarlas explícitamente:

- **Avisos de seguridad: visibles SOLO a usuarios con
  `receives_security_alerts=true`** (super admins). Bootstrap admin lo
  trae activo por default. Regular users no ven los system messages ni
  en vivo (socket emite a USER_ROOMs filtrados) ni en historia (query
  filtra por content_type). El flag es per-user, desacoplado del
  `role='admin'` — permite admins operativos sin privilegios forenses
  y vice-versa. **Revisa a la convención de Fase 8.1 ("visible a todos").**
- Se implementan como mensajes de sistema no-E2EE (`contentType =
  application/vnd.euromex.system+json`, `content` en plaintext, `envelope
  null`).
- **Watermark del chat:** formato `@username · YYYY-MM-DD HH:MM` (UTC) —
  el timestamp ayuda al forense post-leak. Actualización cada minuto.
  Opacity 0.05 sobre color del texto del chat, rotación -20°.
- **Banners informativos:** dismissibles por conversación vía localStorage.
  Key: `euromex.security-banner.acked` (objeto con conversationId → true).
  Se re-muestran si el usuario limpia cache.
- **Todo evento sensible se registra en `audit_log`** además de su posible
  broadcast como mensaje de sistema. Forense disponible incluso si se
  borra un mensaje.

### Invariantes que no deben romperse

- **E2EE:** el server NUNCA ve plaintext de mensajes de usuario. Los
  mensajes viajan como `envelope` (ciphertext + nonce) por cada dispositivo
  destinatario. Los adjuntos como blobs AES-256-GCM en disco; la clave AES
  viaja en el plaintext del mensaje. **Excepción documentada:** los
  mensajes de sistema (avisos) SÍ van en plaintext porque son audit events
  que el server necesita generar — son del server, no del usuario.
- **pnpm workspaces:** cada paquete tiene su propio `node_modules/.bin/`. NO
  hay hoist a la raíz. systemd/scripts deben usar rutas absolutas:
  `/opt/euromex/apps/api/node_modules/.bin/tsx`, etc.
- **tsx en producción:** API corre con `tsx src/server.ts` (no `node dist/`)
  porque `@euromex/shared` y `@euromex/crypto` exportan `.ts` directamente.
  Migrar a dist/ requiere agregar build step a esos paquetes.
- **MASTER_ENC_KEY y EUROMEX_BACKUP_PASSPHRASE no pueden perderse.** Primer
  descifra TOTP, segundo descifra backups. Sin ellas, recuperación imposible.
  Viven en `apps/api/.env` y `/etc/euromex/backup.env` respectivamente.
- **Coexistencia con n8n:** este VPS también corre n8n + Traefik + email-admin
  de otro proyecto del usuario. NO tocar `root-*` containers, NO `apt upgrade -y`,
  NO `ufw --force enable` sin permiso. Ver decisión del 2026-04-17.

### Comandos más usados

```bash
# Estado de los servicios
systemctl status euromex-api euromex-web --no-pager

# Logs en vivo
journalctl -u euromex-api -f

# Deploy de código nuevo
# IMPORTANTE: el VPS debe estar en la rama correcta. Verificar con `git branch`.
# Si no está en claude/private-chat-mac-auth-e9QYn:
#   git checkout claude/private-chat-mac-auth-e9QYn
cd /opt/euromex && git pull && pnpm install
cd apps/web && pnpm build
systemctl restart euromex-api euromex-web

# Aplicar migración de DB (solo cuando haya archivo nuevo en migrations/)
source infra/.env && docker exec -i euromex-postgres psql \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  < apps/api/src/db/migrations/<archivo>.sql

# Crear admin nuevo
cd /opt/euromex/apps/api
ADMIN_USERNAME=x ADMIN_PASSWORD='xxx' ADMIN_DISPLAY='X' \
  /opt/euromex/apps/api/node_modules/.bin/tsx src/scripts/create-admin.ts

# Backup manual
sudo systemctl start euromex-backup.service
```

---

## Estado actual

- **Fase:** 13 (última completada) — Re-auth TOTP + soft logout ✅
- **Estado:** producción corriendo. Todas las fases del plan original
  completadas + extensiones post-plan (10, 12, 13, botón admin en chat).
- **Última actualización:** 2026-04-29
- **Branch activa:** `claude/private-chat-mac-auth-e9QYn`
  ⚠️ El VPS debe estar en esta rama: `git checkout claude/private-chat-mac-auth-e9QYn`
- **Plan aprobado:** `/root/.claude/plans/te-comento-a-grandes-buzzing-wand.md`
- **Fase pendiente (no iniciada):**
  - **11:** SSO / integración con herramientas externas (dashboard financiero,
    Bitwarden, etc.) vía JWT firmados. **Requiere definir scope antes de codear**
    (qué herramientas, dirección del JWT, IdP propio vs externo).

### Qué se completó en sesión 2026-04-29

| Fase | Descripción |
|------|-------------|
| 12 | Modal de edición de `displayName` + `email` en admin panel |
| 13 | Re-auth con solo TOTP + soft logout + `DeviceHint` en localStorage |
| 10 | Organigrama: `job_title`, `department`, `manager_user_id` + tab visual |
| — | Botón panel admin en sidebar del chat (solo admins) |

### Producción actual (VPS Hostinger, 148.230.82.52)

| Componente | URL / Ubicación | Estado |
|------------|-----------------|--------|
| Web (Next.js 15) | `https://chat.148-230-82-52.sslip.io` | Live, HTTPS LE ✅ |
| API (Fastify + Socket.IO) | `https://api.chat.148-230-82-52.sslip.io` | v0.5.0, Live ✅ |
| Postgres 16 | `127.0.0.1:5432` (Docker) | Healthy |
| Redis 7 | `127.0.0.1:6379` (Docker) | Healthy |
| Storage adjuntos | `/opt/euromex/storage/` | fs local, 700 |
| Backups | `/opt/euromex/backups/` | GPG AES-256, timer diario 03:00 UTC |
| Proxies Traefik | `euromex-{web,api}-proxy` (Docker, `root_default`) | Healthy |
| systemd | `euromex-api.service`, `euromex-web.service` | Active, auto-restart |

### Dominio temporal (sslip.io)

Actualmente se usa `*.148-230-82-52.sslip.io` (servicio público wildcard DNS
que resuelve el IP embebido). Razón: DNS de `grupoeuromex.com` en Hostinger no
publicaba los A records (SOA serial congelado). Migración a `chat.grupoeuromex.com`
pendiente de aprobación de directivos de Euromex. **Cutover es ~3 comandos de
`sed` + rebuild + restart** (ver "Mejoras futuras" abajo).

## Próximos pasos

**No hay pasos bloqueantes.** El proyecto está vivo y operacional.

1. **Fase 11 — SSO/JWT:** pendiente de definir scope con el usuario antes
   de codear. Preguntas clave: ¿qué herramientas externas? ¿JWT emitido por
   Euromex Chat o consumido desde un IdP externo (Google Workspace, etc.)?

2. **Migrar a dominio final `chat.grupoeuromex.com`** cuando los directivos
   autoricen mover DNS (o cuando Hostinger publique los A records):
   ```bash
   sed -i 's|chat.148-230-82-52.sslip.io|chat.grupoeuromex.com|g; s|api.chat.148-230-82-52.sslip.io|api.chat.grupoeuromex.com|g' \
     /opt/euromex/infra/traefik-proxies/docker-compose.yml \
     /opt/euromex/apps/api/.env \
     /opt/euromex/apps/web/.env.local
   cd /opt/euromex/apps/web && pnpm build
   cd /opt/euromex/infra/traefik-proxies && docker compose up -d --force-recreate
   systemctl restart euromex-api euromex-web
   ```
   Traefik pide certs LE nuevos en ~30 seg. Los usuarios deben re-loguear
   (localStorage es por-origin).

2. **Backup off-site**: editar `/etc/euromex/backup.env` y añadir
   `REMOTE_RSYNC=user@host:/path`. El script ya lo soporta.

3. **Mejoras no-urgentes que puede haber pedido el usuario:**
   - Build real de `@euromex/shared` y `@euromex/crypto` a `dist/` para
     correr con `node` puro en vez de `tsx` (~200ms faster cold-start).
   - Push notifications web (VAPID keys en API + service worker).
   - Panel admin expandido (listar usuarios, revocar devices desde UI,
     browser de audit_log).
   - Monitoring pasivo: uptime-kuma self-hosted.
   - Fix del error chronic de `mail.grupoeuromex.com` en Traefik (no
     relacionado con este proyecto pero el log lo muestra cada día).
     el equipo.
   - Rotación de claves E2EE tras compromiso de dispositivo.

## Historial de decisiones

### [2026-04-29] Fase 10 — Organigrama + perfil extendido

- **Qué se añadió:** 3 columnas nuevas en `users` (`job_title`, `department`,
  `manager_user_id`) + tab "Organigrama" en el panel admin con árbol visual
  jerárquico.
- **Diseño del árbol:** se construye en el cliente a partir de la lista
  `/admin/users` que ya trae `managerUserId`. No se añadió endpoint nuevo.
  Árbol vertical con indentación CSS — sin librerías externas (suficiente
  para <25 personas).
- **Edición:** los 3 campos nuevos se añadieron al modal de edición existente
  de `users-tab`. El dropdown de jefe muestra solo usuarios activos excepto
  el propio usuario. El servidor rechaza auto-asignación (`self_manager`).
- **`manager_user_id ON DELETE SET NULL`:** si se elimina un usuario que es
  jefe, sus reportes quedan como nodos raíz automáticamente.
- **`department` y `job_title` son texto libre:** Euromex define sus propios
  nombres. Se puede añadir autocompletado desde los valores existentes en
  el futuro.
- **Impacto:**
  - `apps/api/src/db/migrations/006-profile-extended.sql` (nuevo).
  - `packages/shared/src/schemas.ts`: `AdminUserListItem` + `AdminUserUpdateRequest`
    con los 3 campos nuevos.
  - `apps/api/src/admin/repo.ts`: queries con LEFT JOIN para `manager_display_name`,
    validación `self_manager` en `updateUserAsAdmin`.
  - `apps/web/app/app/admin/users-tab.tsx`: modal extendido + pills en tabla.
  - `apps/web/app/app/admin/org-chart-tab.tsx` (nuevo): árbol recursivo.
  - `apps/web/app/app/admin/page.tsx`: tab "Organigrama".

### [2026-04-29] Fase 13 — Re-auth con solo TOTP + soft logout

- **Problema que resuelve:** cada login creaba un device nuevo, con keypair
  nuevo → el usuario no podía descifrar mensajes anteriores. Además, el
  formulario exigía usuario + contraseña + TOTP + nombre de dispositivo
  cada vez que expiraba el JWT (8 h).
- **Solución implementada:**
  1. **Endpoint `POST /auth/reauth`** (nuevo): recibe `{ deviceId, totpToken }`.
     Verifica TOTP para el usuario dueño de ese device. Si user + device están
     'active', devuelve nuevo JWT firmado con el **mismo** `deviceId`. No crea
     registro nuevo en `devices`, por lo que el keypair E2EE en localStorage
     sigue siendo válido → todos los mensajes anteriores son descifrables.
  2. **Soft logout:** `/auth/logout` ya NO revoca el device en DB; solo registra
     el evento en `audit_log`. El cliente borra el access token pero conserva
     el keypair y el device hint. Si se necesita revocar (teléfono perdido,
     etc.), el admin usa el panel admin → Revocar dispositivo.
  3. **Device hint en localStorage** (`euromex.device-hint`): guarda `deviceId`,
     `username` y `displayName` como clave separada de `euromex.session`. Sobrevive
     a `clearSession()`. La página de login lo lee para detectar si puede ofrecer
     el formulario rápido.
  4. **Login page en dos modos:**
     - **Modo rápido** (default cuando hay hint + keypair): muestra avatar con
       nombre, solo el campo TOTP. Botón "Usar otra cuenta" para cambiar.
     - **Modo completo** (sin hint, o al elegir otra cuenta): formulario original
       con todos los campos.
  5. **Mensaje `no_envelope` mejorado:** "🔒 Mensaje anterior a este dispositivo"
     en lugar del críptico "no puede descifrar". Deja claro que no es un error
     sino el comportamiento esperado de E2EE.
- **Trade-offs de seguridad:**
  - Antes: logout = device revocado. Ahora: logout = solo token limpiado.
  - Modelo de amenaza asumido: atacante con acceso al localStorage del
    navegador también tiene acceso a la sesión activa y al authenticator
    (o puede poner un keylogger). El device revocado explícitamente no añade
    protección práctica ante ese atacante.
  - Protección ante robo de dispositivo: admin revoca desde el panel.
    La revocación es inmediata (el middleware `requireAuth` verifica estado
    del device en cada request).
- **Impacto:**
  - `packages/shared/src/schemas.ts`: `ReauthRequestSchema`.
  - `apps/api/src/routes/auth.ts`: endpoint `POST /auth/reauth`; logout sin
    `UPDATE devices SET status = 'revoked'`.
  - `apps/web/app/lib/api.ts`: `DeviceHint`, `loadDeviceHint`,
    `clearDeviceHint`; `saveSession` persiste el hint automáticamente.
  - `apps/web/app/login/page.tsx`: dos modos (`quick` / `full`), `useEffect`
    de detección, handler `onQuickSubmit`, fallback a `full` si `session_revoked`.
  - `apps/web/app/app/chat/page.tsx`: `onLogout` sin `clearKeypair` ni
    revocación server-side; mensaje `no_envelope` más descriptivo.

### [2026-04-29] Fase 12 — Edición de perfil desde admin UI

- **Qué se decidió:** agregar modal de edición de `displayName` y `email` en
  la pestaña Usuarios del panel admin. Un botón de lápiz (Pencil) al final de
  cada fila abre el dialog. Al guardar, solo se envían los campos que realmente
  cambiaron (patch mínimo).
- **Por qué:** hasta aquí, cambiar el nombre visible o email de un usuario
  requería acceso SQL directo. Con ~25 usuarios esto ocurre pocas veces, pero
  es operativamente molesto. El backend ya tenía soporte completo
  (`AdminUserUpdateRequestSchema`, `updateUserAsAdmin`, `PATCH /admin/users/:id`)
  — solo faltaba la UI.
- **Decisiones de diseño:**
  - Modal (no edición inline) porque los campos de texto largos quedan incómodos
    en la celda de una tabla; un dialog da espacio y contexto.
  - Validación en cliente espeja las restricciones del schema Zod del server
    (displayName min 1 / max 64; email válido o vacío para borrar).
  - Email vacío → se envía `null` al servidor, lo que limpia el campo en DB.
  - El admin SÍ puede editar su propio displayName/email (no hay lockout risk
    en esos campos, a diferencia de role/status).
  - El modal muestra el error dentro del dialog para que el admin pueda
    corregir sin perder el contexto de qué usuario estaba editando.
- **Impacto:** solo `apps/web/app/app/admin/users-tab.tsx`. Backend sin cambios.
- **Fases sugeridas pendientes:**
  - 10: organigrama + campos de perfil extendido (job_title, department,
    manager_user_id) — prerequisito: este modal de edición.
  - 11: SSO / JWT firmados para herramientas externas — requiere más scope.

### [2026-04-19] Fase 9 — Panel admin web (usuarios, invitaciones, audit)

- **Qué se decidió:** página `/app/admin` con 3 pestañas (Usuarios,
  Invitaciones, Audit log). Cualquier admin puede gestionar a otros
  usuarios, pero con 2 guardas duros:
  - **No puedes modificar tu propio rol/status** (UI disabled + se
    mitiga en el server por el invariante de "último admin").
  - **El sistema nunca permite quedar con 0 admins activos.** La
    mutación es rechazada en DB layer con error `last_active_admin`.
- **Por qué cualquier admin puede (no root-admin único):** en una empresa
  chica es más operativo que varios puedan emitir invitaciones / revocar
  devices. Todo cambio se registra en `audit_log` con el actor, así que
  sigue habiendo trazabilidad forense.
- **UI:** edición inline en la tabla de usuarios (dropdown de rol,
  checkbox de alertas, dropdown de status). Para mutaciones raras
  (email, displayName) quedará un modal futuro; de momento solo via SQL.
- **Impacto:**
  - `packages/shared/src/schemas.ts`: `AdminUserListItem`,
    `AdminUserUpdateRequest`, `AdminDeviceItem`, `AdminInvitationItem`,
    `AdminAuditLogItem`, `UserStatus`.
  - `apps/api/src/admin/repo.ts`: nuevo módulo con todas las queries.
  - `apps/api/src/routes/admin.ts`: 7 endpoints gated con
    `requireAuth + requireAdmin`. Cada mutación registra `admin.*` en
    `audit_log`.
  - `apps/api/src/server.ts`: registra `adminRoutes`.
  - `apps/web/app/app/admin/page.tsx`: página con 3 tabs, edición inline.
  - `apps/web/app/app/page.tsx`: simplificado — link a `/app/admin` en
    vez del panel inline viejo. Menos duplicación.
  - `apps/web/app/globals.css`: estilos de `admin-*`.
- **Convención nueva:** todas las mutaciones admin se loguean con action
  prefijada `admin.*` (ej `admin.user.update`, `admin.device.revoke`,
  `admin.invitation.revoke`). Facilita el filtrado en el audit browser.
- **Side effect útil:** cuando se deshabilita un usuario (status =
  'disabled'), se revocan automáticamente todos sus dispositivos
  activos — cierra sesiones abiertas instantáneamente.
- **Qué NO entró (fases futuras):**
  - Edición de perfil completo (displayName, email) via UI — solo SQL.
  - Organigrama / campos de perfil extendido (job_title, department,
    manager_user_id) — Fase 10.
  - SSO / integración con otras herramientas — Fase 11 (TBD).

### [2026-04-19] Fase 8.2 — Super admin: alertas solo para watchers

- **Qué se decidió:** añadir columna `users.receives_security_alerts` (default
  `false`; admins bootstrap la traen `true`). Los mensajes de sistema solo
  son visibles a quienes tienen ese flag. Regular users ni los ven en vivo
  ni en historia.
- **Por qué:** la convención de Fase 8.1 era "visibles a todos los miembros"
  — el usuario pidió acotar a super admin ("que no le lleguen a todos").
  Esta iteración revisa la convención:
  - Alertas ahora son privilegiadas (privacy > transparency para el colectivo).
  - Flag per-user, no hardcodeado al `role='admin'` — así en el futuro
    puedes tener admins operativos (crean invitaciones) sin privilegios
    forenses, y viceversa.
- **Implementación:**
  - `users.receives_security_alerts BOOLEAN DEFAULT false`.
  - `requireAuth` pobla `req.session.watchesAlerts` con query fresca a DB.
  - `listMessages` filtra `content_type = SYSTEM_CONTENT_TYPE` cuando el
    requester no es watcher.
  - `broadcastSystemMessage` emite a USER_ROOM de cada watcher (antes:
    CONV_ROOM = todos los miembros). Regular users nunca reciben el socket.
  - `getAlertWatchersInConversation` devuelve la lista de watchers para
    una conversación.
  - `MeResponse.user.receivesSecurityAlerts` expuesto al cliente — futuro
    panel admin puede condicionar UI en este flag.
- **Nuevos eventos además de `attachment_downloaded`:** `conversation_created`
  (grupos nuevos, incluye lista de miembros), `member_added` (schema ya
  definido para cuando exista endpoint de add-member a conversación
  existente).
- **Impacto:** `apps/api/src/db/schema.sql` + migración 005 (alter table +
  backfill admins existentes), `auth/jwt.ts` (SessionContext), `chat/repo.ts`
  (helper + filter + loadSystemActor), `chat/socket.ts` (broadcast a
  USER_ROOM), `routes/attachments.ts` (pasa watchers al broadcast),
  `routes/conversations.ts` (emite conversation_created en grupos nuevos),
  `routes/auth.ts` (MeResponse con flag), `packages/shared/src/schemas.ts`
  (SystemActor + union extendido), `apps/web/app/app/chat/page.tsx`
  (render de los 3 kinds).
- **Migración para producción:**
  ```
  docker exec -i euromex-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    < apps/api/src/db/migrations/005-security-alerts.sql
  ```

### [2026-04-19] Fase 8.1 — Avisos de seguridad (download + watermark + banner)

- **Qué se decidió:** implementar 3 capas de "security notices" en el chat:
  (A) mensaje de sistema cuando alguien descarga un adjunto, visible a
  todos los miembros; (B1) watermark dinámico con `@username · timestamp`
  sobre el área de mensajes; (B2) banner informativo al entrar a cada
  conversación, dismissible por conversación.
- **Por qué:** el usuario pidió "aviso cuando alguien tome captura de
  pantalla o descargue un archivo". Las capturas de pantalla NO son
  detectables en web/PWA (no hay API), así que combinamos disuasión
  (watermark + banner) con detección real (download notify).
- **Mensajes de sistema ≠ mensajes de usuario:** nuevo content type
  `application/vnd.euromex.system+json`, `content` en plaintext con el
  evento JSON, `envelope = null`. El server los inserta en `messages` y
  broadcasta por CONV_ROOM. La convención de "visible a todos" quedó
  fijada como default del proyecto.
- **Watermark deliberadamente útil forense:** formato
  `@username · YYYY-MM-DD HH:MM` (UTC) — si alguien filtra screenshot,
  su nombre y minuto salen encima. Opacity 0.05 es apenas visible en
  pantalla pero legible en screenshot comprimido.
- **Impacto:**
  - `packages/shared/src/schemas.ts`: `SYSTEM_CONTENT_TYPE`,
    `SystemEventSchema`, `AttachmentDownloadedNotifySchema`.
  - `apps/api/src/chat/repo.ts`: `insertSystemMessage`.
  - `apps/api/src/chat/socket.ts`: `broadcastSystemMessage` que emite a
    CONV_ROOM (no DEVICE_ROOM como los E2EE).
  - `apps/api/src/routes/attachments.ts`: `POST /attachments/:id/downloaded`
    — el cliente avisa al server, el server genera el mensaje de sistema
    + audit_log.
  - `apps/web/app/lib/attachments.ts`: `notifyDownload` best-effort tras
    decrypt exitoso.
  - `apps/web/app/app/chat/page.tsx`: `SystemNotice` renderer (centrado,
    pill style, no bubble) + nuevo status `"system"` en `RenderedMessage`.
  - `apps/web/app/components/watermark.tsx`: SVG tileable, updater cada
    minuto.
  - `apps/web/app/components/security-banner.tsx`: dismissible con
    localStorage per-conversation.
- **Convenciones documentadas en el onboarding.**

### [2026-04-19] Fase 7 — Deploy real: sslip.io + socat proxies + ruta absoluta en systemd

- **Qué se decidió:** cutover a producción usando **sslip.io** como dominio
  temporal (`chat.148-230-82-52.sslip.io`, `api.chat.148-230-82-52.sslip.io`)
  mientras se espera autorización para mover `chat.grupoeuromex.com`. Hostinger
  DNS no publicaba los A records en la zona autoritativa — incluso después
  de 24+ hrs el SOA serial no incrementaba.
- **Por qué sslip.io:** servicio DNS wildcard público, gratuito, estable. El
  IP viene embebido en el hostname (`148-230-82-52.sslip.io → 148.230.82.52`)
  y resuelve instantáneamente. Let's Encrypt emite certs sin problema
  (miles de proyectos lo usan).
- **Impacto:** env vars (`CORS_ORIGINS`, `NEXT_PUBLIC_API_BASE`), archivos
  cliente rebuild. Migrable a `chat.grupoeuromex.com` con 3 sed + 1 rebuild
  cuando DNS esté sano.

### [2026-04-19] Fase 7 — Traefik vía Docker labels con proxies socat

- **Qué se decidió:** en vez de file provider, usar el Docker provider
  existente con dos micro-contenedores `alpine/socat` que actúan de puente
  entre Traefik (red `root_default`) y nuestros Node en el host (port 3100
  y 4000). Cada proxy pesa <5 MB, solo forwarda TCP.
- **Por qué:** el Traefik existente en este VPS se levantó con
  `--providers.docker=true` solo — sin file provider. Enablarlo requería
  modificar su docker-compose.yml (propiedad del usuario) y reiniciarlo
  (downtime para n8n). El patrón socat-proxy es zero-touch sobre Traefik,
  cero riesgo a n8n.
- **Impacto:** `infra/traefik-proxies/docker-compose.yml` (creado en el VPS,
  no en repo para no exponer dominio en git). Labels:
  `traefik.http.routers.euromex-{web,api}.tls.certresolver=mytlschallenge`.
- **certResolver:** `mytlschallenge` (nombre custom que ya usaba n8n), no
  el standard `letsencrypt`.

### [2026-04-19] Fase 7 — Binario absoluto en systemd (lección pnpm workspaces)

- **Qué se decidió:** `ExecStart` apunta directamente al binario en
  `apps/{api,web}/node_modules/.bin/` con ruta absoluta, NO a
  `/opt/euromex/node_modules/.bin/` (que no existe con pnpm workspaces)
  NI a `pnpm start` (requiere pnpm en PATH de systemd, frágil).
- **Por qué:** pnpm workspaces NO hoistea los binarios a la raíz del monorepo
  como hace npm. Cada workspace tiene su `node_modules/.bin/` propio. Los
  binarios (`next`, `tsx`) traen shebang `#!/usr/bin/env node` — ejecutables
  directos. Esto es más robusto que depender del PATH de systemd.
- **Gotcha relacionado:** `install-systemd.sh` ahora mata los procesos
  `nohup` previos antes de habilitar las units, para evitar EADDRINUSE cuando
  systemd intenta bindar al mismo puerto. Sin este kill, systemd entra en
  loop `activating (auto-restart)` infinito.
- **Impacto:** `infra/systemd/euromex-{api,web}.service`,
  `infra/scripts/install-systemd.sh`.

### [2026-04-17] Fase 7 — Traefik con file provider (no Docker labels)

- **Qué se decidió:** el routing Traefik se configura vía un archivo
  YAML en su directorio dinámico (`infra/traefik/euromex.yml`) con
  servicios apuntando a `http://172.17.0.1:3100` (web) y `:4000`
  (API). No dockerizamos los procesos Node en contenedores.
- **Por qué:**
  - Los procesos Node corren en el host bajo systemd (mejor control,
    reboot-safe, journalctl unificado).
  - Evitamos reescribir la topología — el código que estabas probando
    en staging es el mismo en producción, solo cambia el reverse
    proxy por delante.
  - Traefik soporta múltiples providers simultáneamente; el file
    provider coexiste con el Docker provider que n8n usa.
  - `172.17.0.1` es el bridge default de Docker — desde el contenedor
    Traefik ve al host del VPS allí.
- **Alternativa considerada:** dockerizar API y web con labels. Más
  idiomático con el resto del stack, pero requiere Dockerfiles y
  reconstruir imagenes en cada deploy. Overkill para <25 usuarios.
- **Impacto:** `infra/traefik/euromex.yml`, systemd units.
- **Propuesto por:** Claude.

### [2026-04-17] Fase 7 — tsx en producción (no node dist/)

- **Qué se decidió:** el servicio systemd lanza la API con `tsx
  src/server.ts`, mismo comando que staging. NO migramos a
  `node dist/server.js`.
- **Por qué:** los paquetes workspace (`@euromex/shared`,
  `@euromex/crypto`) exportan `.ts` directamente — correr con plain
  node requeriría añadir build steps a esos paquetes y reescribir
  sus `exports`. Trabajo no trivial, beneficio marginal:
  - tsx tiene ~200ms de arranque extra (invisible con systemd
    restart-on-failure).
  - Runtime idéntico a node (esbuild transpila once, caché en memoria).
  - Seguridad igual — tsx no ejecuta código distinto, solo lo tipea.
  - Simplicidad: un solo comando para dev y prod, menos sorpresas.
- **Deuda técnica reconocida:** migrar a node+dist es una optimización
  de Fase 8+ si alguna vez se hace. Documentado en "mejoras futuras".
- **Impacto:** `infra/systemd/euromex-api.service`.
- **Propuesto por:** Claude.

### [2026-04-17] Fase 7 — Backups con GPG symmetric (no asimétrico)

- **Qué se decidió:** los backups se cifran con `gpg --symmetric
  --cipher-algo AES256` usando una passphrase en
  `/etc/euromex/backup.env` (permisos 600).
- **Por qué:**
  - Symmetric evita gestionar un keyring GPG de cuenta + ring de
    confianza. Una passphrase, un secreto, fácil de rotar.
  - AES256 es el estándar. Passphrase de 48 bytes base64 = 384 bits
    de entropía — muy por encima del ataque de fuerza bruta.
  - Si alguna vez se quiere migrar a keys asimétricas (p.ej. backup
    a storage público con clave solo en laptop offline), el script
    se adapta en 3 líneas.
- **Protocolo de recuperación:** `restore.sh` requiere confirmación
  escrita ("RESTORE") y la passphrase — evita restores accidentales
  que destruirían la DB actual.
- **Impacto:** `infra/scripts/backup.sh`, `restore.sh`.
- **Propuesto por:** Claude.

### [2026-04-17] Fase 7 — Dos subdominios (chat + api.chat) vs path prefix

- **Qué se decidió:** separar por subdominio (`chat.euromex.com.mx`
  para web, `api.chat.euromex.com.mx` para API) en vez de servir
  ambos en el mismo host con prefix `/api`.
- **Por qué:**
  - CORS queda limpio — el web solo permite ese dominio de API, sin
    hacks de same-origin.
  - El Socket.IO se conecta a `wss://api.chat...` directamente, sin
    rewrites de Traefik.
  - Cookies y CSP son predecibles.
  - El CSP `connect-src` lista un host concreto en vez de `*`.
  - Let's Encrypt emite dos certs — gratis y automático.
- **Alternativa considerada:** single domain + Next.js rewrites al API.
  Forzaría todo tráfico a pasar por Next.js incluido socket.io, más
  latencia y complejidad.
- **Impacto:** `infra/traefik/euromex.yml`, vars de entorno.
- **Propuesto por:** Claude.

### [2026-04-17] Fase 6 — PWA en lugar de React Native Expo

- **Qué se decidió:** convertir la web Next.js en PWA instalable en
  iOS/Android vía "Añadir a pantalla de inicio", en vez de construir
  una app React Native separada.
- **Por qué:**
  - Grupo Euromex tiene <25 usuarios internos — distribución via App
    Store / Play Store es burocracia innecesaria (reviews, cuentas
    de developer, cert signing).
  - Mantener 2 clientes (web + RN) duplica esfuerzo de UI, bugs y
    actualizaciones.
  - La crypto E2EE en RN requiere polyfills (WebCrypto no existe
    nativo) — añadiría fricción.
  - PWA se actualiza automáticamente al pushear código: sin "update
    pending in store" que retrasa fixes.
  - UX moderna de PWA en iOS 16.4+ y Android es prácticamente
    indistinguible de nativa (standalone, home icon, splash screen).
- **Trade-offs aceptados:**
  - Push notifications requieren iOS 16.4+ (aceptable).
  - No hay distribución por tiendas — los usuarios instalan con un
    link + "Añadir a pantalla de inicio". Para una empresa chica es
    suficiente y se puede documentar en 2 líneas.
- **Impacto:** `apps/web/app/manifest.ts`, `icon.tsx`, `apple-icon.tsx`,
  `public/sw.js`, `public/offline.html`, `components/pwa-register.tsx`,
  `components/install-prompt.tsx`, layout metadata, CSS responsive.
  No se creó `apps/mobile/`.
- **Propuesto por:** Claude, aprobado por el usuario.

### [2026-04-17] Fase 6 — Service Worker con cache consciente de E2EE

- **Qué se decidió:** el SW solo cachea assets estáticos de Next
  (`/_next/static/`) cache-first y páginas HTML network-first. API
  (puerto 4000, cross-origin) nunca entra al SW. Socket.IO también
  excluido explícitamente.
- **Por qué:** aunque los mensajes viajan como ciphertext, la mezcla
  de cache del SW + sesiones auth mutables es un anti-patrón. Las
  respuestas del API siempre frescas. Los estáticos sí se cachean
  porque son contenido público post-build.
- **Impacto:** `apps/web/public/sw.js`.
- **Propuesto por:** Claude.

### [2026-04-17] Fase 6 — extensionAlias en webpack para imports .js

- **Qué se decidió:** `next.config.mjs` configura
  `resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js', '.jsx'] }`
  para que webpack resuelva los imports estilo NodeNext de los
  paquetes workspace (donde `from "./foo.js"` apunta al fuente .ts).
- **Por qué:** tsc con `moduleResolution: "NodeNext"` requiere
  extensiones `.js` explícitas en imports TS. Webpack por defecto no
  hace esa sustitución. Sin esto, la web no compila (rompió al
  introducir la importación de `AttachmentPayload` desde `@euromex/shared`
  en Fase 5).
- **Alternativa considerada:** cambiar shared a `moduleResolution:
  "Bundler"`. Rechazada porque perderíamos verificación estricta de
  imports en el resto del monorepo.
- **Impacto:** `apps/web/next.config.mjs`.
- **Propuesto por:** Claude.

### [2026-04-17] Fase 5 — Filesystem local en vez de MinIO/S3

- **Qué se decidió:** los blobs cifrados se guardan en disco del VPS
  bajo `/opt/euromex/storage/ab/cd/<uuid>.bin` (2 niveles de prefijo
  para no saturar un inode). No instalamos MinIO ni usamos S3 externo.
- **Por qué:** <25 usuarios con envíos esporádicos de archivos caben
  perfecto en disco del VPS. MinIO añade un container, credenciales
  S3 y complejidad sin beneficio real hasta que escalemos. La API
  abstrae las ops de storage (`writeBlob/streamBlob/...`) así que en
  el futuro se cambia el backend sin tocar callers.
- **Trade-off:** no hay signed URLs para CDN; toda descarga pasa por
  el API. Para 25 usuarios × archivos ocasionales es irrelevante.
- **Impacto:** `apps/api/src/storage/files.ts`, var de entorno
  `STORAGE_DIR`, `HOSTINGER.md`.
- **Propuesto por:** Claude.

### [2026-04-17] Fase 5 — Clave AES-256-GCM dentro del plaintext del mensaje

- **Qué se decidió:** cada archivo se cifra con una clave AES-256-GCM
  recién generada en el cliente. Esa clave + IV + nombre + MIME + tamaño
  forman un JSON que viaja como plaintext del mensaje que lo referencia.
  El mensaje completo se cifra con los envelopes NaCl por dispositivo
  destinatario (mismo pipeline que un mensaje de texto).
- **Por qué:** reusamos 100% de la infraestructura E2EE de Fase 4. No
  necesitamos una nueva tabla `attachment_envelopes` ni otro flujo de
  fan-out. El server recibe bytes cifrados y no sabe ni qué tipo de
  archivo es — solo tamaño y quién lo subió.
- **Impacto:** `packages/shared/src/schemas.ts`
  (`AttachmentPayloadSchema`, `ATTACHMENT_CONTENT_TYPE`),
  `apps/web/app/lib/attachments.ts`, bubble rendering en chat.
- **Propuesto por:** Claude.

### [2026-04-17] Fase 5 — WebCrypto (AES-GCM) en lugar de NaCl para archivos

- **Qué se decidió:** los archivos se cifran con **AES-256-GCM** vía
  WebCrypto nativa del navegador, no con `nacl.box`. El mensaje que
  los referencia sí usa NaCl.
- **Por qué:** AES-GCM es simétrica (una sola clave) — perfecto para
  cifrar bytes una vez y que cualquier recipiente con la clave pueda
  descifrar. NaCl `box` es asimétrica y requiere una operación por
  destinatario, lo que multiplicaría el tamaño de los archivos. Con
  AES simétrica ciframos una sola vez y repartimos la clave vía los
  envelopes NaCl que ya tenemos.
- **Impacto:** `apps/web/app/lib/attachments.ts`.
- **Propuesto por:** Claude.

### [2026-04-17] Fase 5 — Multipart upload sin metadata en el cuerpo

- **Qué se decidió:** el endpoint `POST /conversations/:id/attachments`
  acepta SOLO el blob (sin filename, mime, ni otros campos). El server
  solo ve ciphertext y conversación.
- **Por qué:** si el server conociera el nombre o mime real del
  archivo, sería una filtración de metadata potente. Lo forzamos a ser
  opaco: un Content-Type `application/octet-stream` genérico y un nombre
  fijo "blob.enc". Todo lo descriptivo viaja cifrado en el mensaje.
- **Impacto:** `apps/api/src/routes/attachments.ts` (limits.fields=0).
- **Propuesto por:** Claude.

### [2026-04-17] Fase 4 — NaCl (tweetnacl) en vez de Signal Protocol / libsodium-wrappers

- **Qué se decidió:** implementar E2EE con el patrón `nacl.box` (X25519 +
  XSalsa20-Poly1305) de `tweetnacl`, en vez de `@signalapp/libsignal-client`
  como prometí en el plan original.
- **Por qué:**
  - `@signalapp/libsignal-client` solo funciona en Node.js con bindings
    nativos (Rust). No corre en el navegador → si el cifrado ocurre en el
    servidor el E2EE pierde sentido (el servidor vería el plaintext).
  - Primer intento con `libsodium-wrappers`: falla en el build de Next.js
    por problema de resolución ESM de `./libsodium.mjs`. Añadir webpack
    overrides es frágil.
  - `tweetnacl` es pure JS, tamaño minúsculo, usado por millones de
    proyectos (Signal mismo lo auditó históricamente), funciona en
    Node + navegador + React Native sin configuración de webpack.
  - El algoritmo (`box` = X25519 + XSalsa20-Poly1305) es el MISMO que usa
    `libsodium.crypto_box`. La diferencia es solo el wrapper.
- **Trade-off aceptado:** sin forward secrecy (Double Ratchet). Si un
  atacante roba la private key del dispositivo, puede descifrar mensajes
  pasados. Mitigación realista: revocación inmediata de dispositivo vía
  admin + rotación del keypair. Upgrade a Double Ratchet es Fase 5+.
- **Impacto:** `packages/crypto/*` (ahora con tweetnacl), wiring en
  `apps/web/app/lib/keys.ts`, `apps/web/app/app/chat/page.tsx`.
- **Propuesto por:** Claude tras probar libsodium-wrappers y detectar
  el error de build de webpack.

### [2026-04-17] Fase 4 — Encriptación por dispositivo (fan-out) con cache de claves

- **Qué se decidió:** el cliente cifra una vez por cada dispositivo
  destinatario (incluyendo sus propios otros dispositivos) y envía N
  envelopes al servidor. El servidor los guarda en `message_envelopes`
  y emite `message:new` a cada `device:<id>` con SOLO el sobre de ese
  dispositivo. El cliente cachea las claves públicas de la conversación
  y las refresca cuando aparece un sender desconocido.
- **Por qué:** es la solución mínima que cumple las garantías E2EE. El
  servidor nunca ve plaintext. Cada dispositivo recibe solo lo suyo.
  Para <25 usuarios × pocos dispositivos, el costo de fan-out es
  despreciable.
- **Impacto:** endpoint nuevo `GET /conversations/:id/device-keys`,
  `POST /auth/devices/publish-identity`, rooms `device:<id>` en
  Socket.IO, helpers `insertEncryptedMessage` y `getConversationDeviceKeys`.
- **Propuesto por:** Claude.

### [2026-04-17] Fase 4 — Clave privada en localStorage, en claro

- **Qué se decidió:** la clave privada X25519 del dispositivo se guarda
  en `localStorage` en base64, sin cifrar con contraseña del usuario.
  Se limpia al hacer logout.
- **Por qué:** la frontera de seguridad ya es el acceso al dispositivo
  del usuario. Si un atacante llega a `localStorage` también llega a la
  sesión JWT (mismo storage). Cifrar la key con la contraseña del usuario
  añade seguridad *solo* si el atacante tiene el storage pero no la
  contraseña — escenario raro. Cifrar con password requiere re-pedir la
  password en cada recarga, mata UX.
- **Alternativa a futuro:** cifrar la privada con una clave derivada
  de WebAuthn + PIN del navegador (Passkey-wrapped). Es Fase 6+.
- **Impacto:** `apps/web/app/lib/keys.ts`.
- **Propuesto por:** Claude.

### [2026-04-17] Fase 4 — /enroll requiere Suspense en Next.js 15

- **Qué se decidió:** envolver el contenido de `/enroll/page.tsx` en
  `<Suspense>` porque usa `useSearchParams()`.
- **Por qué:** Next.js 15 requiere Suspense boundary alrededor de
  `useSearchParams()` para que la prerenderización estática no falle.
  Latente desde Fase 2; se disparó cuando el usuario ejecutó
  `pnpm build` en el VPS.
- **Impacto:** `apps/web/app/enroll/page.tsx`.
- **Propuesto por:** Claude tras ver el log de error del usuario en el
  VPS.

### [2026-04-17] Fase 3 — Socket.IO integrado al servidor Fastify

- **Qué se decidió:** Socket.IO adjunto al servidor HTTP subyacente de
  Fastify (`app.server`), path `/socket.io`. Autenticación vía JWT en
  `handshake.auth.token`, verificación contra DB al conectar (user +
  device activos). Auto-join a rooms `conv:<id>` al conectarse para
  recibir mensajes sin handshake explícito, más `user:<id>` para
  notificaciones de tipo "conversación nueva".
- **Por qué:** Fastify no tiene WebSocket nativo tan cómodo. Socket.IO
  trae rooms, reconexión automática, fallback a long-polling y una API
  uniforme client/server. Adjuntarlo directamente al `http.Server`
  evita complejidad de plugins. La auto-join al conectar hace que la
  UI no tenga que orquestar joins por cada conversación — con <25
  usuarios el costo de "N rooms per socket" es trivial.
- **Impacto:** `apps/api/src/chat/socket.ts`,
  `apps/api/src/server.ts`, `packages/shared/src/schemas.ts`
  (`ServerToClientEvents`, `ClientToServerEvents`),
  `apps/web/app/lib/socket.ts`.
- **Propuesto por:** Claude.

### [2026-04-17] Fase 3 — Texto plano en `messages.content` (no envelopes)

- **Qué se decidió:** en Fase 3 los mensajes se almacenan como texto
  plano en una columna nueva `messages.content TEXT` (nullable). La
  tabla `message_envelopes` queda vacía hasta Fase 4. Schema actualizado
  + migración delta `001-add-message-content.sql` para DBs ya
  desplegadas de Fase 2.
- **Por qué:** validamos UX, latencia y fan-out rápido sin mezclar el
  diseño con el Double Ratchet de Signal. En Fase 4 se migra: `content`
  pasa a NULL, se generan envelopes por dispositivo destinatario. La
  migración será aditiva (no se pierden mensajes viejos; el cliente
  muestra los de Fase 3 tal cual y los nuevos cifrados).
- **Riesgo aceptado:** durante Fase 3, un atacante con acceso a la DB
  puede leer mensajes. Disclaimer documentado para staging por IP.
- **Impacto:** `apps/api/src/db/schema.sql`,
  `apps/api/src/db/migrations/001-add-message-content.sql`,
  `apps/api/src/chat/repo.ts`.
- **Propuesto por:** Claude.

### [2026-04-17] Fase 3 — DM único entre pares (re-uso, no duplicados)

- **Qué se decidió:** al crear un DM, si ya existe uno entre los mismos
  dos usuarios, se devuelve el existente en vez de crear otro. Los
  grupos sí permiten duplicados por nombre (cada creación es un grupo
  distinto).
- **Por qué:** comportamiento esperado en chats de productividad
  (Slack/Teams). Evita tener múltiples hilos paralelos con la misma
  persona que fragmenten historial.
- **Impacto:** `apps/api/src/chat/repo.ts` (`findDmBetween`),
  `apps/api/src/routes/conversations.ts` (POST /conversations).
- **Propuesto por:** Claude.

### [2026-04-17] Fase 3 — Single-page chat en `/app/chat` con query-state

- **Qué se decidió:** un único client component en `/app/chat/page.tsx`
  que maneja sidebar + pane de mensajes + modal de nueva conversación
  vía `useState`. No se usan rutas `/app/chat/[id]` separadas.
- **Por qué:** el estado (socket conectado, lista de conversaciones,
  mensajes cacheados) vive mejor en un solo árbol de React. Con rutas
  por conversación habría que orquestar el socket globalmente
  (context/provider). <25 usuarios: no vale la pena. Si crece, se
  migra a rutas + layout compartido.
- **Impacto:** `apps/web/app/app/chat/page.tsx`.
- **Propuesto por:** Claude.

### [2026-04-17] Coexistencia con n8n + Traefik en el mismo VPS

- **Qué se decidió:**
  - Web Next.js cambia del puerto **3000 → 3100** porque el VPS ya tiene
    un Node app nativo en 3000 (`/var/www/e...`, presumiblemente el
    frontend de `email-admin`).
  - NO correr `apt upgrade -y` ni `ufw --force enable` en el VPS: hay
    Traefik en 80/443 y contenedores n8n corriendo. UFW mal puesto los
    dejaría sin conectividad.
  - Fase 7 usará **Traefik existente** como reverse proxy (labels en
    docker-compose) en vez de instalar Nginx aparte. Menos piezas.
- **Por qué:** no romper la infra productiva del usuario. Minimizar el
  área de cambios al VPS.
- **Impacto:**
  - `apps/web/package.json` — scripts `dev` / `start` usan `-p 3100`.
  - `apps/api/.env.example` — `CORS_ORIGINS` ahora apunta a `:3100`.
  - `README.md` — referencia el nuevo puerto.
  - `HOSTINGER.md` — reescrita como guía "coexistencia": sin `apt upgrade`,
    sin `ufw enable`, instrucciones para abrir 3100/4000 en firewall
    externo de Hostinger, sección final apuntando a integración con
    Traefik en Fase 7.
- **Propuesto por:** Claude después de que el usuario reportara
  `ss -tlnp` y `docker ps` del VPS.

### [2026-04-17] Fase 2 — Flujo de enrollment en 2 pasos con JWT efímero

- **Qué se decidió:** el enrollment usa dos endpoints (`/auth/enroll/begin`
  y `/auth/enroll/complete`). El begin valida la invitación, crea el
  secreto TOTP y devuelve al cliente un `enrollmentId` (JWT firmado, 10
  min TTL, contiene todos los datos temporales incl. el secret TOTP).
  El complete verifica el token TOTP contra el secret del JWT y persiste
  user + device + consume la invitación.
- **Por qué:** evita estado server-side (sin tabla de "pending enrollments",
  sin Redis). El JWT es stateless, corto, firmado — no puede ser
  manipulado. El secret TOTP en el JWT es seguro porque el cliente ya lo
  tiene (para el QR) y el JWT viaja por HTTPS; la alternativa sería
  guardarlo en Redis con TTL, más piezas móviles para poco beneficio.
- **Impacto:** `apps/api/src/routes/auth.ts`.
- **Propuesto por:** Claude.

### [2026-04-17] Fase 2 — Secretos TOTP cifrados con AES-256-GCM + master key

- **Qué se decidió:** los secretos TOTP se guardan en DB cifrados con
  AES-256-GCM usando una clave maestra de 32 bytes (env `MASTER_ENC_KEY`).
  Formato: `nonce(12) || ciphertext || tag(16)` en una columna `BYTEA`.
- **Por qué:** si la DB se filtra, los TOTP no quedan expuestos. La clave
  maestra vive solo en memoria del proceso API (variable de entorno) y
  nunca toca disco del contenedor de DB. Estándar auditable.
- **Impacto:** `apps/api/src/auth/crypto.ts`, columna `users.totp_secret_enc`.
- **Advertencia:** perder `MASTER_ENC_KEY` = perder el 2FA de todos los
  usuarios. Anotado en `HOSTINGER.md`.
- **Propuesto por:** Claude.

### [2026-04-17] Fase 2 — Un device por login; re-uso real llega en Fase 4

- **Qué se decidió:** cada login crea un registro nuevo en `devices`. No
  re-usamos dispositivos existentes basándonos en fingerprint todavía.
- **Por qué:** el re-uso de device requiere algún mecanismo de identidad
  persistente del cliente (cookie segura, device key, etc.). Eso encaja
  mejor cuando integremos libsignal en Fase 4 (cada dispositivo tiene un
  identity keypair persistente). Por ahora el trade-off es simplicidad
  vs. una tabla `devices` que crece con cada login — aceptable con <25
  usuarios. El admin puede revocar cualquier device desde la DB.
- **Impacto:** `apps/api/src/routes/auth.ts` (login endpoint).
- **Propuesto por:** Claude.

### [2026-04-17] Fase 2 — Columnas Signal en `devices` pasan a nullable

- **Qué se decidió:** `registration_id`, `identity_public_key`,
  `signed_prekey_*` ahora son `NULL` hasta que el dispositivo complete
  enrollment Signal (Fase 4). Se añadió `user_agent` para ayudar a
  identificar dispositivos en la UI.
- **Por qué:** Fase 2 registra dispositivos funcionales (platform,
  device_name, user_agent) sin aún tener crypto E2EE. Forzar NOT NULL
  nos obligaría a llenar con placeholders y después migrar.
- **Impacto:** `apps/api/src/db/schema.sql`.
- **Propuesto por:** Claude.

### [2026-04-17] Fase 2 — Admin bootstrap vía script CLI (no endpoint)

- **Qué se decidió:** el primer admin se crea con
  `pnpm --filter @euromex/api run create-admin` leyendo credenciales de
  env. No hay endpoint HTTP para esto.
- **Por qué:** un endpoint "solo si no hay admin" suena útil pero abre
  una ventana de exposición en cada redeploy (raza). Un script local
  que requiere acceso SSH ya gated por el mismo nivel de seguridad que
  tener acceso root al VPS. Simple, auditable, idempotente.
- **Impacto:** `apps/api/src/scripts/create-admin.ts`.
- **Propuesto por:** Claude.

### [2026-04-17] Fase 2 — Deploy staging por IP sin dominio todavía

- **Qué se decidió:** la primera puesta en marcha en el VPS de Hostinger
  se hace en HTTP directo por IP, puertos 3000 (web) y 4000 (API),
  sin Nginx ni TLS. HTTPS con Let's Encrypt llega en Fase 7.
- **Por qué:** desbloquea prueba end-to-end del usuario sin esperar a
  comprar/apuntar un dominio. El usuario no pidió dominio aún.
- **Riesgo aceptado:** el tráfico viaja en claro durante staging; los
  secretos TOTP y passwords estarían expuestos a un atacante en la red.
  Mitigación: no meter datos reales hasta Fase 7.
- **Impacto:** `HOSTINGER.md`.
- **Propuesto por:** Claude, con disclaimer al usuario.

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

### v0.4.0 — 2026-04-17 — E2EE (Fase 4)

- **Agregado:**
  - `packages/crypto/*`: wrapper mínimo de tweetnacl (`generateIdentityKeypair`,
    `encryptFor`, `decryptFrom`, helpers base64 y UTF-8, `safetyNumber`).
  - `apps/web/app/lib/keys.ts`: gestión de identity keypair por dispositivo
    (generar, cachear en localStorage, publicar public key al server,
    limpiar al logout).
  - `apps/api/src/chat/repo.ts`:
    `insertEncryptedMessage` transaccional,
    `getConversationDeviceKeys`,
    `publishDeviceIdentity`,
    `listMessages` ahora retorna el envelope del dispositivo requester.
  - Endpoints nuevos:
    `POST /auth/devices/publish-identity`,
    `GET /conversations/:id/device-keys`.
  - Socket.IO: room `device:<id>`, fan-out por dispositivo en `message:send`.
  - Schemas shared: `EnvelopeInput`, `PublishIdentityRequest`, `DeviceKey`;
    `Message.envelope` nullable; `SendMessageRequest` con `envelopes`.
  - Migración `apps/api/src/db/migrations/002-enable-e2ee.sql`.
  - Fix: `/enroll` envuelto en `<Suspense>` para `next build`.
- **Modificado:**
  - `apps/web/app/app/chat/page.tsx`: pipeline completo E2EE (cifra al
    enviar, descifra al recibir, cachea device-keys, renderiza estados
    `ok`/`legacy`/`no_envelope`/`decrypt_error`, icono 🔒 en header).
  - `apps/web/app/login/page.tsx` y `apps/web/app/enroll/page.tsx`:
    llaman a `ensureDeviceKeypair` antes de navegar al chat, y redirigen
    a `/app/chat` en vez de `/app`.
  - `apps/api/src/db/schema.sql`: columna `nonce BYTEA` en
    `message_envelopes`.
- **Removido:**
  - `insertMessage` legacy reemplazado por `insertEncryptedMessage`.
  - Helper `broadcastMessage`: el fan-out vive ahora en el propio
    socket.ts + routes/conversations.ts.
- **Decisiones referenciadas:** tweetnacl en vez de Signal Protocol,
  fan-out por dispositivo, clave privada en localStorage, Suspense en
  `/enroll`.
- **Verificación:** `pnpm -r run typecheck` + `cd apps/web && pnpm build`
  pasan limpios. Smoke test E2EE pendiente en el VPS: abrir 2
  navegadores, loguearse con 2 usuarios, enviar mensajes, confirmar
  que en la DB `messages.content IS NULL` y `message_envelopes.ciphertext`
  son bytes no legibles.

### v0.3.0 — 2026-04-17 — Mensajería en claro (Fase 3)

- **Agregado:**
  - `apps/api/src/chat/repo.ts`: queries de conversaciones, miembros,
    mensajes, búsqueda de DM existente, listado de usuarios, marca de
    lectura.
  - `apps/api/src/chat/socket.ts`: servidor Socket.IO con auth JWT,
    rooms por conversación y por usuario, handlers `message:send`,
    `conversation:join/leave`, `typing:set`; helpers
    `broadcastMessage` y `broadcastConversationUpdated`.
  - `apps/api/src/routes/conversations.ts`: endpoints REST
    `GET /users`, `GET/POST /conversations`, `GET /conversations/:id`,
    `GET/POST /conversations/:id/messages`, `POST /conversations/:id/read`.
  - `apps/api/src/db/migrations/001-add-message-content.sql`: migración
    delta para DBs ya en uso.
  - `packages/shared/src/schemas.ts`: schemas `UserListItem`,
    `Conversation`, `ConversationMember`, `Message`,
    `CreateConversationRequest`, `SendMessageRequest` y los tipos de
    eventos `ServerToClientEvents` / `ClientToServerEvents`.
  - `apps/web/app/lib/socket.ts`: cliente Socket.IO tipado, reconecta
    con el JWT de sesión.
  - `apps/web/app/app/chat/page.tsx`: UI completa de chat (sidebar de
    conversaciones, burbujas con sender/hora, composer con envío por
    WebSocket, modal "Nueva conversación" DM/grupo, badges de unread,
    auto-scroll, marca de lectura al entrar).
- **Modificado:**
  - `apps/api/src/db/schema.sql`: `messages.content TEXT` añadido
    (nullable para futura coexistencia con envelopes en Fase 4).
  - `apps/api/src/server.ts`: registra `conversationRoutes` y
    `registerSocketIO`; bump a v0.3.0.
  - `apps/api/package.json`: nueva dep `socket.io`.
  - `apps/web/package.json`: nueva dep `socket.io-client`.
  - `apps/web/app/app/page.tsx`: CTA "Abrir chat" hacia `/app/chat`.
  - `apps/web/app/globals.css`: layout grid del chat, burbujas,
    composer, modal.
- **Removido:** n/a.
- **Decisiones referenciadas:** Socket.IO sobre Fastify, texto plano
  en Fase 3, DM único, single-page chat.
- **Verificación:** `pnpm -r run typecheck` pasa en los 3 paquetes.
  Smoke test end-to-end pendiente en el VPS: abrir 2 navegadores, login
  con dos usuarios distintos, crear DM, enviar mensajes, verificar
  entrega en tiempo real y badge de unread.

### v0.2.0 — 2026-04-17 — Auth + enrollment (Fase 2)

- **Agregado:**
  - `apps/api/src/auth/crypto.ts`: Argon2id para passwords e invitaciones,
    AES-256-GCM para secretos TOTP, generador de códigos de invitación
    base32 (formato `XXXX-XXXX-XXXX-XXXX`).
  - `apps/api/src/auth/totp.ts`: creación de secretos TOTP, generación
    de QR data URL con `qrcode`, verificación con ventana ±1 periodo.
  - `apps/api/src/auth/jwt.ts`: registro de `@fastify/jwt`, middlewares
    `requireAuth` (valida token + consulta DB para user/device activos)
    y `requireAdmin`.
  - `apps/api/src/routes/auth.ts`: endpoints
    `POST /auth/enroll/begin`, `POST /auth/enroll/complete`,
    `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`.
  - `apps/api/src/routes/invitations.ts`: `POST /auth/invitations`
    (solo admin).
  - `apps/api/src/scripts/create-admin.ts`: script CLI para bootstrap
    del primer admin.
  - `packages/shared/src/schemas.ts`: Zod schemas para auth
    (usuarios, passwords, TOTP, invitaciones, login, me).
  - `apps/web/app/lib/api.ts`: helper fetch con sesión en localStorage.
  - `apps/web/app/login/page.tsx`: formulario usuario + password + TOTP.
  - `apps/web/app/enroll/page.tsx`: flujo de 2 pasos con QR inline.
  - `apps/web/app/app/page.tsx`: landing post-login + panel admin
    mínimo para emitir invitaciones.
  - `HOSTINGER.md`: guía end-to-end de deploy en VPS (SSH + Docker +
    Node + pnpm + primer admin + smoke test + upgrade path).
- **Modificado:**
  - `apps/api/src/db/schema.sql`: columnas Signal de `devices` nullable;
    añadida `user_agent`.
  - `apps/api/src/config.ts`: añade `jwtSecret`, `masterEncKey`,
    `jwtTtlSec`, `corsOrigins`.
  - `apps/api/src/server.ts`: registra `@fastify/cookie`, CORS con
    origins de env, JWT plugin, rutas de auth e invitaciones.
  - `apps/api/.env.example`: nuevas variables de entorno obligatorias.
  - `apps/api/package.json`: nuevas deps (argon2, otpauth, qrcode,
    @fastify/jwt, @fastify/cookie); script `create-admin`.
  - `apps/web/app/page.tsx` + `globals.css`: landing con links a
    /login y /enroll, estilos de formularios.
  - `package.json`: `pnpm.onlyBuiltDependencies = ["argon2"]`.
- **Removido:** n/a.
- **Decisiones referenciadas:** las 6 entradas de Fase 2 (enrollment en
  2 pasos, AES-GCM para TOTP, un device por login, Signal nullable,
  admin por CLI, staging por IP).
- **Verificación:** `pnpm -r run typecheck` pasa en los 3 paquetes. El
  smoke test end-to-end (infra up + create-admin + enroll + login) se
  ejecuta en el VPS siguiendo `HOSTINGER.md`.

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

---

## [2026-05-01] Roadmap propuesto: control granular, llamadas y APK

**Contexto.** Después del refresh visual y las correcciones de bugs, el
usuario pidió tres cosas adicionales que tienen scope variable:

1. **Inmediato (esta sesión)**: gestión de dispositivos por admin —
   poder ver y revocar dispositivos individuales por seguridad (ej.
   teléfono robado, sospecha de filtración).
2. **Próximo sprint**: llamadas de voz internas 1:1 (sin video).
3. **Sprint posterior**: APK de Android como primera app móvil
   nativa, y permisos granulares por usuario (quién puede tomar
   captura, descargar documentos, etc.).

Esta entrada documenta lo implementado hoy + el plan propuesto para los
otros bloques, para que cualquier sesión futura pueda retomar sin
perder contexto.

### Implementado hoy: Gestión de dispositivos por admin

- **Backend**: los endpoints ya existían (`GET /admin/users/:id/devices`
  y `POST /admin/devices/:id/revoke`). No se tocaron.
- **Frontend nuevo**: `apps/web/app/app/admin/user-devices-modal.tsx`
  - Modal que lista todos los dispositivos de un usuario
  - Cada device muestra: nombre, plataforma, browser/OS resumido,
    último acceso, fecha de alta, status (activo/revocado/pendiente)
  - Botón "Revocar" por device activo, con confirmación explícita
  - Al revocar refresca la lista y la tabla externa (vía `onRevoked`)
- **Frontend modificado**: `users-tab.tsx`
  - La columna "Dispos." (que solo mostraba el número) ahora es
    clickeable y abre el modal del usuario correspondiente
  - Estado `devicesTarget` paralelo al `editTarget` existente

**Diferencia con el flujo actual de "deshabilitar usuario"**:
deshabilitar usuario revoca TODOS sus devices y le quita el acceso por
completo. Revocar un device específico solo corta esa sesión (útil
cuando el usuario sigue siendo válido pero perdió el celular o
sospechamos un device específico).

### Propuesto: Fase 22 — Llamadas de voz 1:1 (sin video)

**Stack**:
- WebRTC P2P (peer-to-peer) en el browser
- Socket.IO existente para signaling (offer/answer/ICE candidates)
- STUN servers gratuitos de Google (`stun:stun.l.google.com:19302`)
- TURN server propio (coturn en el VPS) — solo si falla NAT traversal,
  agregable después de medir
- Encriptación: DTLS-SRTP es default en WebRTC, no necesitamos rotar
  claves manualmente

**Limitaciones aceptadas**:
- Solo 1:1 (no llamadas grupales en esta fase — eso requiere SFU)
- Solo audio (sin video)
- Sin grabación (por privacidad explícita)

**Implementación estimada**: 2-3 sesiones
- Sesión 1: signaling + UI de incoming/outgoing call
- Sesión 2: media negotiation + UX completa (mute, hangup, ringing)
- Sesión 3: TURN server + tuning + audit log de calls

**Archivos nuevos esperados**:
- `apps/api/src/chat/voice-signaling.ts` — handlers de socket
- `apps/web/app/lib/webrtc.ts` — wrapper de RTCPeerConnection
- `apps/web/app/components/call-overlay.tsx` — UI fullscreen de call
- DB: tabla `call_log` para audit (caller, callee, started_at, ended_at,
  status: completed/missed/declined)

### Propuesto: Fase 23 — APK Android (Capacitor, no TWA)

**Decisión arquitectónica**: usar **Capacitor**, NO TWA.

**Por qué Capacitor sobre TWA**:
| Capacidad | TWA | Capacitor |
|---|---|---|
| Reusa código web existente | ✅ | ✅ |
| Distribución Play Store | ✅ | ✅ |
| Push notifications nativas | ✅ | ✅ |
| **Bloqueo de screenshots (FLAG_SECURE)** | ❌ | ✅ |
| Detección screen recording iOS | ❌ | ✅ (futuro) |
| File system nativo (descargas) | parcial | ✅ |
| Tamaño app | ~500KB | ~5MB |

El bloqueo de screenshots es el feature crítico que decide a favor de
Capacitor — el usuario quiere "control total" y TWA no puede llegar ahí.

**Setup estimado**: 3-5 días
- Día 1: Capacitor init + build pipeline
- Día 2: Plugin nativo para FLAG_SECURE (Kotlin, ~50 LOC)
- Día 3: Push notifications nativas (Firebase Cloud Messaging) +
  reemplazar service worker actual
- Día 4: File downloads nativos + permisos runtime
- Día 5: Build + signing + .aab para Play Store internal track

**Archivos nuevos**:
- `apps/mobile/` (nuevo workspace)
  - `capacitor.config.ts` — apunta a la URL de producción
  - `android/` — proyecto Android Studio
  - `src/plugins/security-plugin/` — FLAG_SECURE custom plugin
- iOS queda fuera (sin Apple Developer account por ahora)

### Propuesto: Fase 24 — Permisos granulares por usuario

**Schema nuevo** (`apps/api/src/db/migrations/011-user-permissions.sql`):

```sql
ALTER TABLE users
  ADD COLUMN can_download_attachments BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN can_export_chat          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN can_share_externally     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN can_create_groups        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN can_invite_users         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN can_initiate_calls       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN max_attachment_mb        INT     NOT NULL DEFAULT 50;
```

**Enforcement por capa**:
| Permiso | Server enforces | Native (Capacitor) enforces |
|---|---|---|
| can_download_attachments | bloquea `/attachments/:id/download` | bloquea botón descarga |
| can_export_chat | bloquea endpoint export | n/a |
| can_share_externally | n/a | activa FLAG_SECURE Android |
| can_create_groups | bloquea `POST /conversations type=group` | oculta opción UI |
| can_invite_users | bloquea `POST /admin/invitations` | oculta UI |
| can_initiate_calls | bloquea signaling de outgoing | oculta botón |
| max_attachment_mb | rechaza upload | valida antes de subir |

**Watermark mejorado**: cuando `can_share_externally = false`, la
watermark se vuelve más visible (opacity 0.10 en vez de 0.05) — añade
fricción a quien intente leak con celular ajeno.

**UI admin**: tab nueva "Permisos" o expansión del modal de edición
del usuario con los toggles. Defaults conservadores: nadie puede
exportar ni compartir externamente al inicio.

**Implementación estimada**: 2 sesiones
- Sesión 1: schema + endpoint enforcement + admin UI
- Sesión 2: respeto en UI cliente + integración con plugin Capacitor

### Orden recomendado de ejecución

1. ✅ **Hoy**: Gestión de dispositivos por admin (DONE este commit)
2. **Próxima sesión**: Fase 24 — permisos granulares (web only).
   Esto da valor inmediato sin esperar al APK.
3. **Después**: Fase 22 — llamadas de voz 1:1
4. **Al final**: Fase 23 — APK Capacitor con FLAG_SECURE

Este orden permite que el control de permisos arranque a darle valor
al admin desde la web antes de invertir en el wrapper nativo.

### Lo que NO se hará en este roadmap

- Llamadas grupales o video (deferido a Fase 25+ si se justifica)
- App iOS nativa (sin Apple Dev account; PWA en iOS sigue funcionando)
- Detección de screenshot en iOS (limitación de la plataforma)
- Federación con otros servidores (fuera de scope, esto es un chat
  privado de empresa, no Matrix/XMPP)

---

## [2026-05-01] Fase 23a — Wrapper Capacitor para Android (scaffold + FLAG_SECURE)

**Contexto.** Después de Fase 24 (permisos granulares), el web ya
respeta `can_share_externally = false` con watermark intensa pero NO
puede bloquear screenshots a nivel OS. Para "control total" del admin
necesitamos un wrapper nativo. Ver entrada anterior para el reasoning
de Capacitor sobre TWA.

Esta fase implementa **el scaffolding mínimo** que conecta el flag de
permisos (web) con FLAG_SECURE (Android nativo). Build, signing y
distribución a Play Store quedan documentados pero no ejecutados — los
hace el developer una sola vez con su keystore.

### Archivos creados

- `apps/mobile/package.json` — workspace pnpm `@euromex/mobile` con
  deps de Capacitor 6 (core, cli, android, app, status-bar) y scripts
  `cap:add:android`, `cap:sync`, `cap:open:android`,
  `build:android[:debug]`.
- `apps/mobile/capacitor.config.ts` — configuración. **Decisión clave**:
  `server.url = "https://chat.148-230-82-52.sslip.io"` para que el APK
  cargue la web de producción remota (no se bundle el HTML/JS). Razones:
    - Updates de la web fluyen al APK sin rebuild
    - Evitamos fricción de Next.js static export (que no soporta todas
      las features de la app actual sin trabajo)
    - Para offline / modo aerolínea no es bloqueante porque el chat
      requiere socket en vivo igual.
- `apps/mobile/public/index.html` — placeholder mínimo que solo se ve si
  el server remoto no responde y el WebView fallbackea al webDir local.
- `apps/mobile/.gitignore` — gitignore parcial: trackeamos los sources
  de `android/` (manifest, plugins, recursos) pero no los outputs de
  build (`build/`, `*.apk`, `*.aab`, `*.keystore`).
- `apps/mobile/README.md` — instrucciones completas de setup:
  pre-requisitos (JDK 17, Android Studio, SDK 34), `npx cap add android`,
  agregar el plugin Kotlin `SecurityPlugin.kt`, registrar en
  `MainActivity.kt`, generar iconos con `@capacitor/assets`, generar
  keystore, configurar signing y buildear `app-release.apk` + `app-release.aab`.
  Incluye también cómo apuntar al dev local (cleartext + IP de red
  interna).
- `apps/web/app/lib/native.ts` — bridge JS → Capacitor. Detecta en
  runtime `window.Capacitor.isNativePlatform()` y, si está dentro del
  WebView, llama al plugin `Security.setFlagSecure({ value })`. En web
  normal todo es no-op. **Cero deps nuevas en `apps/web`** — usamos la
  global que Capacitor inyecta, no `@capacitor/core` como import.
- `apps/web/app/app/chat/page.tsx` — useEffect adicional que llama
  `applyShareExternallyPolicy(me.user.permissions.canShareExternally)`
  cuando carga el usuario. En web es no-op; en APK setea FLAG_SECURE.

### Lo que el developer necesita hacer manualmente

1. `cd apps/mobile && pnpm cap:add:android` — genera el proyecto Android
   Studio (carpeta `android/` con boilerplate Gradle). Una sola vez.
2. Crear `SecurityPlugin.kt` en `android/app/src/main/java/com/euromex/chat/security/`
   con el código del README.
3. Editar `MainActivity.kt` para registrar el plugin con
   `registerPlugin(SecurityPlugin::class.java)`.
4. `pnpm cap:sync` — Capacitor copia los cambios al proyecto Android.
5. Generar keystore (una sola vez), configurar `signingConfigs` en
   `app/build.gradle`, exportar passwords como env vars y correr
   `pnpm build:android` para `app-release.apk`.
6. Distribuir el APK por sideload (link en intranet) o subir a Play
   Store internal track.

### Limitaciones conocidas (Fase 23b/c)

- **Push notifications**: el APK por ahora hereda el web push del WebView.
  Funciona pero no es óptimo en background; agregar FCM nativo en una
  fase siguiente.
- **Downloads**: hereda el File API del WebView; en algunos Android
  podría no funcionar bien. Migrar a `@capacitor/filesystem` cuando
  haya queja real.
- **iOS**: no implementado (sin Apple Dev account). El bridge JS está
  listo para detectar iOS, solo falta `pnpm cap add ios` + plugin
  Swift equivalente cuando haya licencia.
- **Cambio en runtime de permisos**: si el admin cambia
  `can_share_externally` mientras el usuario está activo, el flag
  no se actualiza hasta el siguiente login (mismo issue que el resto
  de Fase 24). Solución futura: socket event que dispare
  `applyShareExternallyPolicy()` y refetch de `/auth/me`.

### Verificación end-to-end (cuando se haga el primer build)

1. Admin baja `can_share_externally = false` para usuario de prueba.
2. Ese usuario hace logout + login en el APK Android.
3. En el chat, intentar tomar screenshot → Android debería mostrar
   "Captura de pantalla no permitida" o salir negro.
4. Intentar grabar la pantalla → grabación sale negra en el área de la app.
5. Abrir el switcher de Recents → preview del APK sale negro.
6. Compartir pantalla por Cast / Miracast → área negra.
7. Admin sube `can_share_externally = true` → logout/login → screenshots
   funcionan normal.
