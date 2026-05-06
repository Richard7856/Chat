# Known Issues — Euromex Chat

> Issues abiertos, parches pendientes, edge cases conocidos y limitaciones aceptadas. Ordenado por **severidad** dentro de cada sección.
>
> Para incidentes resueltos ver el histórico en [archive/HISTORY.md](archive/HISTORY.md). Para decisiones de arquitectura ver [DECISIONS.md](DECISIONS.md).

---

## 1. Parches críticos pendientes

### ✅ #1 — `migrate.ts` sin `connectionTimeoutMillis` — **RESUELTO 2026-05-06**

- `connectionTimeoutMillis: 5_000` agregado al pool. Ver ADR-037a.

### ✅ #2 — `migrate.ts` no advierte en producción — **RESUELTO 2026-05-06**

- Production guard interactivo: detecta hostname remoto o `NODE_ENV=production`, pide confirmación antes de `apply`/`bootstrap`. Flag `--yes` para CI. Ver ADR-037b.
- **Acción pendiente:** agregar `--yes` al comando de deploy en HOSTINGER.md.

### ✅ #3 — Replay attack en `/auth/biometric/unlock` — **RESUELTO 2026-05-06**

- User-agent guardado en `devices.biometric_fingerprint` al `enable`. Comparado en cada `unlock`; mismatch → audit `biometric.fingerprint_mismatch` + 401. Migration 015 agrega la columna. Ver ADR-037c.
- **Limitación conocida:** UA es heurística débil; actualización de browser puede causar falso positivo. Usuario puede re-enable para resetear fingerprint. Devices con biometría activada pre-parche tienen `NULL` y no aplican el check hasta re-enable.

### 🟡 #4 — `migrate.ts` falla con `CREATE INDEX CONCURRENTLY`

- **Archivo:** `apps/api/src/scripts/migrate.ts:applyOne`
- **Problema:** envuelve cada `.sql` en `BEGIN/COMMIT`. `CREATE INDEX CONCURRENTLY` no se permite dentro de transacción.
- **Fix:** detectar la palabra `CONCURRENTLY` en el SQL y, si la encuentra, correr fuera de transacción. Marcar como aplicada en una transacción separada.
- **Esfuerzo:** ~15 líneas.
- **Cuándo importa:** la primera vez que alguien escriba una migration con índice concurrente. Hoy ninguna lo usa.

### 🟡 #5 — Biometric token TTL muy largo (90 días)

- **Archivo:** `apps/api/src/routes/auth.ts`, constante `BIOMETRIC_TOKEN_TTL_SEC`
- **Problema:** un Keystore comprometido vive 90 días sin ser detectado.
- **Fix:** bajar a 14 días + implementar refresh-on-use (cada unlock exitoso emite token nuevo con TTL renovado).
- **Esfuerzo:** ~30 líneas.
- **Severidad:** media (requiere root del device para explotar).

### 🟡 #6 — Concurrencia en `migrate.ts`

- **Archivo:** `apps/api/src/scripts/migrate.ts`
- **Problema:** dos operadores corriendo `pnpm migrate` al mismo tiempo pueden aplicar la misma migration dos veces. Como las migrations son idempotentes (`IF NOT EXISTS`), no rompe la BD. Pero el `ON CONFLICT DO NOTHING` del INSERT al `schema_migrations` esconde la condition.
- **Fix:** advisory lock de Postgres antes del primer apply: `SELECT pg_advisory_lock(<hash>)`.
- **Esfuerzo:** ~15 líneas.

### 🟢 #7 — `username` no sanitizado al pasar a Keychain (iOS)

- **Archivo:** `apps/web/app/lib/biometric.ts:enableBiometricUnlock`
- **Problema:** iOS Keychain rechaza strings con NULL bytes. Si el username tiene caracteres raros, falla silently.
- **Fix:** validar que el username solo tenga `[a-zA-Z0-9_.-]` antes de pasar a `setCredentials`.
- **Esfuerzo:** 3 líneas.
- **Severidad:** baja — `username` ya es validado en enrollment con regex `^[a-z][a-z0-9_-]*$`.

---

## 2. Pendientes operacionales (no son bugs, son tareas)

### #8 — Deploy de Fase 28 al VPS + bootstrap

- **Estado:** código listo + commiteado (`16e792e`). Sin pushear.
- **Acción requerida:** una vez DNS de `euromex.xyz` propague, hacer `git pull && pnpm install && cd apps/api && source .env && pnpm migrate:bootstrap` UNA SOLA VEZ. Después del bootstrap, `migrate:status` debe mostrar 14 applied.

### #9 — Migración a `euromex.xyz` en VPS

- **Estado:** código del repo apunta a nuevo dominio (commit `4d35f4b`). DNS asignado (`cosmos/nova.dns-parking.com`), propagación al TLD `.xyz` en curso.
- **Acción requerida (cuando DNS resuelva):**
  1. Editar `apps/api/.env` → `CORS_ORIGIN`, `WEB_BASE_URL`
  2. Editar `apps/web/.env.local` → `NEXT_PUBLIC_API_BASE`
  3. Editar `infra/traefik-proxies/docker-compose.yml` → labels Host()
  4. Recrear containers Traefik
  5. Build web + restart services
  6. Verificar cert LE: `curl -I https://euromex.xyz`
- **Detalle completo:** ver [PROJECT_BRIEF.md sección Roadmap](PROJECT_BRIEF.md).

### #10 — Validación funcional del APK debug en device físico

- **Estado:** APK `com.grupoeuromex.chat` v1.0 en `~/Downloads/euromex-chat-v1.0-debug.apk`. **Nunca probado en device físico real**.
- **Acción requerida:** instalar (después de desinstalar APKs viejos `com.euromex.chat`), correr 12-step smoke test:
  1. Login normal con user+pwd+TOTP
  2. Sidebar → Settings → 3 tabs visibles (Pwd / 2FA / Huella)
  3. Activar biometría → ingresa TOTP → confirma huella
  4. Logout
  5. Reabrir → botón "Entrar con huella" visible
  6. Tap huella → entra sin TOTP
  7. (admin) Revocar device de otro user → pide huella
  8. (admin) Cambiar status user → pide huella
  9. Settings → Huella → Desactivar
  10. Logout → reabre → solo modo TOTP
  11. Editar mensaje + ver "(editado)"
  12. Borrar mensaje + ver tombstone

### #11 — Limpieza de residuos en he.net y Hostinger DNS

- **he.net:** zona `chat.grupoeuromex.com` huérfana (creada durante intento fallido de subdomain delegation). Borrar.
- **Hostinger DNS de grupoeuromex.com:** residuos a borrar:
  - TXT `dnshenet-key`
  - A `chat` (si aún existe)
  - A `api.chat` (si aún existe)
  - ALIAS `chat → cdn.hstgr.net` si lo regeneró Hostinger automáticamente

### #12 — Push de commits locales a origin

- **Estado:** 6 commits locales sin pushear:
  - `e2f6595` docs: PROJECT_BRIEF.md
  - `4d35f4b` chore(domain): migrar a euromex.xyz
  - `16e792e` feat(infra): Fase 28 — runner de migrations
  - `64a4698` docs: incidente migrations
  - `d087133` build(mobile): wire-up plugin biometric
  - (esta sesión va a agregar más con la reorganización de docs)
- **Acción:** `git push origin claude/private-chat-mac-auth-e9QYn` (con confirmación).

### #13 — Reservar `com.grupoeuromex.chat` en Play Console

- **Estado:** package nuevo, listo. Aún no se subió a Play Console.
- **Acción:** crear cuenta Play Console ($25 una vez), reservar el package, llenar listing (descripción, screenshots, feature graphic 1024×500, age rating, privacy policy URL en `https://euromex.xyz/privacy.html`), generar AAB firmado con `./scripts/build-aab.sh`, subir a Internal Testing primero, después promover a Production.

---

## 3. Edge cases conocidos (limitaciones aceptadas, no se planea fix)

### #14 — Multi-device backfill requiere device viejo online

- **Componente:** Fase 23b backfill E2EE
- **Comportamiento:** un user con solo device nuevo + sin device viejo online no puede leer mensajes anteriores a Fase 23b (no hay quien re-cifre).
- **Workaround:** abrir el device viejo brevemente para que haga backfill. Si el viejo está perdido/dañado, los mensajes históricos quedan ilegibles para ese user en el device nuevo.
- **Documentado en:** ADR-025

### #15 — Mensaje borrado pierde clave AES de su adjunto

- **Componente:** ADR-028 (clave en plaintext del mensaje)
- **Comportamiento:** soft delete de un mensaje preserva los envelopes en `message_envelopes_history`. Pero solo los devices que estuvieron presentes pueden descifrar el histórico.
- **Workaround:** auditoría con admin que era miembro de la conversación al momento del envío.

### #16 — Edit timeout de 24h es arbitrario

- **Componente:** Fase 25 edit messages
- **Comportamiento:** después de 24h, no se puede editar. Hard-coded en `apps/api/src/chat/repo.ts:editMessage`.
- **Workaround:** borrar + reenviar.
- **Posible mejora:** configurable por conversación o por user.

### #17 — Edit/delete solo para `text/plain`

- **Componente:** Fase 25
- **Comportamiento:** mensajes con adjunto, activity, task, no se pueden editar.
- **Razón:** semántica unclear de "editar una imagen" o "editar una RSVP".
- **Posible mejora:** permitir delete de attachments (no edit) en versión futura.

### #18 — Watermark se puede remover con edición de imagen

- **Componente:** ADR-013
- **Comportamiento:** el watermark es CSS overlay con opacity 0.05. Cualquiera con habilidad básica de edición puede removerlo de un screenshot manual.
- **Aceptado:** es deterrent + audit trail, no protección absoluta. La protección real es FLAG_SECURE en mobile (ADR-023).

### #19 — Service Worker no cachea API ni socket.io

- **Componente:** Fase 6 PWA
- **Comportamiento:** offline-first solo para assets estáticos + páginas HTML. Cualquier mensaje requiere conectividad.
- **Razón:** no podemos cachear endpoints E2EE sin riesgo de inconsistencia.

### #20 — Edit/delete por admin requiere ser miembro de la conversación al momento del mensaje

- **Componente:** Fase 25 (limitación E2EE honesta)
- **Comportamiento:** admin que entra a una conversación POST-edit no puede leer las versiones archivadas.
- **Razón:** E2EE — no tiene los envelopes originales.
- **Documentado en:** ADR-036

---

## 4. Hardening propuesto (no urgente)

### #21 — Tests automatizados (ninguno hoy)

- **Componente:** todo
- **Estado:** sin Vitest unit, sin Playwright E2E.
- **Recomendación:** agregar al menos:
  - Vitest para `packages/shared` (Zod schemas) y `packages/crypto` (envelope round-trips)
  - Playwright para flujos de auth (login, enroll, change password, biometric enable/disable)
- **Esfuerzo:** ~4 sesiones (M4 del audit 2026-05-03).

### #22 — Build real de `@euromex/shared` y `@euromex/crypto` a `dist/`

- **Componente:** packages workspace
- **Beneficio:** ~200ms más rápido en cold-start del API. Permite usar `node` puro en producción (no `tsx`).
- **Esfuerzo:** medio — agregar tsconfig específicos + cambiar `package.json:main`.
- **Tradeoff:** otra capa de build a mantener.

### #23 — Monitoring pasivo (uptime-kuma self-hosted)

- **Componente:** infra
- **Estado:** no hay monitoreo. Si el API se cae, nos enteramos por user reports.
- **Recomendación:** uptime-kuma container (mismo VPS) con checks a `/health` + Discord/Telegram webhook.
- **Esfuerzo:** 1-2 horas.

### #24 — Backup off-site

- **Componente:** ADR-030
- **Estado:** backups locales en VPS. Si el VPS muere, backups también.
- **Recomendación:** rsync incremental a otro host (Hetzner Storage Box ~€3/mes).
- **Cómo:** editar `/etc/euromex/backup.env` y agregar `REMOTE_RSYNC=user@host:/path`. El script ya lo soporta.

### #25 — Rate limiting más fino en endpoints sensibles

- **Componente:** auth.ts
- **Estado:** rate limit global (300 req/min/IP).
- **Recomendación:** rate limit específico en `/auth/login` (5 intentos/15min/IP), `/auth/biometric/unlock` (10 intentos/min/device).
- **Esfuerzo:** 30 min con `@fastify/rate-limit`.

### #26 — Rotación de claves E2EE tras compromiso de dispositivo

- **Componente:** modelo E2EE
- **Estado:** revocar device en admin solo marca `status='revoked'`. El keypair sigue existiendo en el localStorage de ese device.
- **Recomendación:** al revocar, emitir un session message a todos los devices del user pidiendo "regenera tu keypair y re-publica" como nueva identity.
- **Esfuerzo:** medio. Coordinar con backfill (Fase 23b).

### #27 — Ningún sistema de notificaciones para administradores

- **Componente:** admin / monitoring
- **Estado:** los `audit_log` events sensibles (logins fallidos, password changes, biometric enables) solo se ven si entras al panel admin.
- **Recomendación:** webhook Discord/Slack/email para events `>=warning`.
- **Esfuerzo:** 1 sesión.

---

## 5. Limitaciones por diseño (no son issues, son scope)

> Ver lista completa en [PROJECT_BRIEF.md sección 7](PROJECT_BRIEF.md). Aquí solo las que son frecuente confusión.

- **No hay E2EE entre web y server** — es entre device y device. El server SÍ termina TLS y ve los envelopes (cifrados, no plaintext).
- **No hay forward secrecy completa** — un device comprometido lee mensajes pasados que tenía. Aceptado.
- **No hay rotación automática de keypairs** — solo manual via admin.
- **System messages NO son E2EE** — son del server, plaintext intencional. Solo super-admins los ven.
- **Plaintext del mensaje contiene la clave AES del adjunto** — recuperar mensaje borrado requiere admin que era miembro de la conversación al momento del envío.

---

**Última actualización:** 2026-05-06
**Severity legend:** 🔴 crítico (bloquea production-ready) · 🟡 importante (mejora robustez) · 🟢 cosmético/raro

**Cómo contribuir:** cuando descubras un nuevo issue, agregalo aquí con número incremental + severidad. Cuando se resuelva, mover a [archive/HISTORY.md](archive/HISTORY.md) con commit referencia.
