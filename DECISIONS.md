# Decisions Log — Euromex Chat

> Razonamiento detrás de cada decisión técnica. Formato ADR: **Contexto / Decisión / Alternativas / Riesgos**. Ordenado por **categoría**, no por fecha — para navegar.
>
> Para el histórico completo con todas las micro-decisiones (50+, ~1900 líneas), ver [archive/HISTORY.md](archive/HISTORY.md). Aquí están las que importan.

---

## Tabla de contenidos

1. [Arquitectura general](#1-arquitectura-general)
2. [E2EE y seguridad](#2-e2ee-y-seguridad)
3. [Autenticación](#3-autenticación)
4. [Base de datos y migrations](#4-base-de-datos-y-migrations)
5. [Mobile y Capacitor](#5-mobile-y-capacitor)
6. [Adjuntos y storage](#6-adjuntos-y-storage)
7. [Operación e infra](#7-operación-e-infra)
8. [DNS y dominios](#8-dns-y-dominios)
9. [Mensajería y UX](#9-mensajería-y-ux)
10. [Decisiones rechazadas (importante saberlas)](#10-decisiones-rechazadas)

---

## 1. Arquitectura general

### ADR-001 · Stack: Fastify + Next.js + Postgres + Redis (2026-04-17)

- **Contexto:** chat E2EE self-hosted para <25 personas. Necesitamos algo simple, no SaaS.
- **Decisión:** Node 22 + Fastify (API) + Next.js 15 App Router (web) + Postgres 16 + Redis 7 + Socket.IO. tweetnacl para E2EE.
- **Alternativas:** Go/Rust API (más performante pero curva de aprendizaje), MongoDB (no-relacional pero peor para joins), tRPC en lugar de REST (acopla cliente-servidor).
- **Riesgos:** Node single-thread bajo carga alta. Mitigación: cluster si pasa de 50 users (no ahora).

### ADR-002 · Monorepo con pnpm workspaces + Turbo (2026-04-17)

- **Contexto:** packages compartidos entre web/api (schemas Zod, crypto helpers).
- **Decisión:** monorepo con `apps/{api,web,mobile}` + `packages/{shared,crypto}`. pnpm hoists nada — cada paquete tiene su `node_modules/.bin/` propio.
- **Alternativas:** repos separados (más fricción), npm/yarn workspaces (peor performance).
- **Riesgos:** systemd y scripts deben usar **rutas absolutas** a binarios (`/opt/euromex/apps/api/node_modules/.bin/tsx`). Documentado como invariante.

### ADR-003 · Deploy en VPS propio del cliente (2026-04-17)

- **Contexto:** cliente requiere control total. No hay opción cloud.
- **Decisión:** VPS Hostinger + Docker (PG/Redis) + systemd (api/web) + Traefik del cliente.
- **Alternativas:** AWS/GCP (lock-in + costo), self-host k8s (overkill <100 users).
- **Riesgos:** coexistencia con infra del cliente (n8n, email-admin) — ver ADR-019.

### ADR-004 · `tsx` en producción (no compilar a `dist/`) (2026-04-17)

- **Contexto:** packages workspace `@euromex/shared` y `@euromex/crypto` exportan `.ts` directo.
- **Decisión:** API corre con `tsx src/server.ts`. Cero build step para shared.
- **Alternativas:** agregar build a cada workspace (más config), bundler (esbuild/rollup).
- **Riesgos:** ~200ms más de cold-start. Aceptable. Si se va a serverless, hay que migrar.

### ADR-005 · Single-page chat en `/app/chat` con query-state (2026-04-17)

- **Contexto:** WhatsApp/Telegram tienen layouts split-pane, no rutas separadas por conversación.
- **Decisión:** una sola ruta `/app/chat` con `?conv=<id>` para conversación activa. URL shareable.
- **Alternativas:** `/app/chat/[id]` (más Next.js-idiomático pero rompe layout).
- **Riesgos:** state management se acumula en un componente. Con <25 users no es problema.

---

## 2. E2EE y seguridad

### ADR-006 · NaCl `crypto_box` en lugar de Signal Protocol (2026-04-17)

- **Contexto:** chat de empresa <25 personas. No app pública.
- **Decisión:** tweetnacl `crypto_box_easy` + un envelope cifrado por device destinatario.
- **Alternativas:** libsignal (overkill, complica multi-device E2E sin gana real para 25 personas), Matrix Olm/Megolm (otra dimensión de complejidad).
- **Riesgos:** sin forward secrecy completa — un device comprometido lee mensajes pasados que tenía. Aceptable, documentado en privacy policy.

### ADR-007 · Encriptación por dispositivo (fan-out) con cache de claves (2026-04-17)

- **Contexto:** un mensaje va a N devices del receptor. Cada device tiene su keypair.
- **Decisión:** cliente cifra el plaintext **una vez por device destinatario** y manda N envelopes al server. Server fan-out a cada device por su `recipient_device`.
- **Alternativas:** key wrapping (cifrar plaintext una vez con session key, cifrar session key por device — overkill para 25 users).
- **Riesgos:** cómputo O(N) en cliente. Para N<10 (devices del receptor) es <50ms.

### ADR-008 · Clave privada del device en localStorage, en claro (2026-04-17)

- **Contexto:** WebCrypto no permite extraer claves privadas. NaCl-JS no usa WebCrypto.
- **Decisión:** keypair guardado en `localStorage` como base64. Browser sandbox protege contra otros sitios.
- **Alternativas:** IndexedDB con WebCrypto (no permite NaCl), pedir password en cada login (UX pésima).
- **Riesgos:** XSS roba la clave. Mitigación: CSP estricto, origin único, no inline scripts inseguros.

### ADR-009 · Adjuntos restringidos = split de envelopes (2026-04-17, refinado Fase 14)

- **Contexto:** algunos adjuntos solo para subset de la conversación (HR docs, etc.).
- **Decisión:** cliente cifra **dos payloads** — `AttachmentPayload` (con fileKey/fileIv) para devices allowed, `AttachmentRestrictedPayload` (sin keys) para no-allowed. Cada device recibe el suyo.
- **Alternativas:** server controla acceso (rompe E2EE), envelope único con re-key dinámico (más complejo).
- **Riesgos:** si un user es allowed → revocado, ya tiene la clave AES en su device. El blob queda accesible offline. Documentado.

### ADR-010 · WebCrypto AES-256-GCM para archivos (no NaCl) (2026-04-17)

- **Contexto:** archivos pueden ser MB/GB. NaCl `secretbox` no soporta streaming.
- **Decisión:** AES-256-GCM via WebCrypto API para el blob. NaCl solo para los envelopes del mensaje (que llevan la fileKey).
- **Alternativas:** NaCl secretbox (carga todo en memoria), AES-CBC (más antiguo, sin authentication tag).
- **Riesgos:** WebCrypto en Safari iOS antiguo tiene bugs. Test en Safari 16+.

### ADR-011 · Avisos de seguridad solo a "super admins" (2026-04-19, Fase 8.2)

- **Contexto:** los avisos de seguridad (download / watermark / banner) son audit events sensibles.
- **Decisión:** flag `users.receives_security_alerts` per-user, **desacoplado** del `role='admin'`. Solo `true` ve los system messages.
- **Alternativas:** todos los admins (mezcla privilegios), por conversación (más granular pero más UX).
- **Riesgos:** si nadie tiene el flag, los avisos se generan pero nadie los lee. Bootstrap admin lo trae activo por default.

### ADR-012 · Modelo de seguridad: TOTP obligatorio + JWT firmado + master encryption key (2026-04-17)

- **Contexto:** auth fuerte sin SMS (México = costoso/no confiable).
- **Decisión:** Argon2id para passwords + TOTP obligatorio (RFC 6238) + JWT firmado con `JWT_SECRET` (32+ chars) + secrets TOTP cifrados en BD con `MASTER_ENC_KEY` (AES-256-GCM).
- **Alternativas:** SMS 2FA (caro+inseguro), magic links (susceptible a phishing), passkeys/WebAuthn (planeado para Fase 29).
- **Riesgos:** `MASTER_ENC_KEY` y `JWT_SECRET` IRRECUPERABLES si se pierden. Vivien en `.env`.

### ADR-013 · Watermark + banners + audit log para descarga de adjuntos (2026-04-19, Fase 8.1)

- **Contexto:** prevenir filtración de info confidencial.
- **Decisión:** watermark `@username · YYYY-MM-DD HH:MM` (UTC) sobre el chat (opacity 0.05). Banner dismissible. Toda descarga genera audit event + system message visible solo a super-admins.
- **Alternativas:** DRM (no factible en web sin EME), bloquear descargas (rompe casos legítimos).
- **Riesgos:** watermark se puede quitar con edición. No es protección absoluta — disuasión + forense.

---

## 3. Autenticación

### ADR-014 · Enrollment en 2 pasos con JWT efímero (2026-04-17, Fase 2)

- **Contexto:** un usuario nuevo necesita: validar invite → crear cuenta + enrollar TOTP → confirmar.
- **Decisión:** flujo en 2 endpoints: `/auth/enroll/begin` (valida invite, devuelve JWT corto con TOTP secret en claims) → `/auth/enroll/complete` (verifica TOTP del nuevo secret + crea user). El secret nunca se persiste hasta que el usuario demuestra que lo configuró.
- **Alternativas:** un solo endpoint (necesita sesión a medio crear), session-state server-side (más infra).
- **Riesgos:** JWT en claims tiene el secret cifrable — usamos JWT firmado con `JWT_SECRET`, válido 10 min.

### ADR-015 · Re-auth solo TOTP (Fase 13, 2026-04-29)

- **Contexto:** UX — re-loguear pide password + TOTP siempre era ruidoso.
- **Decisión:** si hay `device hint` + keypair en localStorage, mostrar modo "quick login" (solo TOTP). El JWT trae `did` (device id) y el server valida que el device sigue activo.
- **Alternativas:** session cookies de larga duración (más riesgo si se roba la cookie), refresh tokens.
- **Riesgos:** un atacante con acceso al localStorage del browser puede hacer re-auth con su propio TOTP — pero necesita la app authenticator del usuario, no solo el browser.

### ADR-016 · Cambio de password requiere TOTP + revoca otros devices (Fase 26, C3, 2026-05-04)

- **Contexto:** cambio de password con sesión robada = takeover.
- **Decisión:** `POST /auth/password` exige `currentPassword + newPassword + totpToken`. Por default, revoca **todos los demás devices** del usuario (zero-trust si la pwd se filtró). El device actual sobrevive.
- **Alternativas:** no requerir TOTP (vulnerable), revocar siempre todos incluido el actual (UX horrible).
- **Riesgos:** si el usuario se equivoca y revoca su único device administrativo, queda fuera. Mitigación: el bootstrap admin original siempre puede crear otro admin via script CLI.

### ADR-017 · Rotación de TOTP en 2 pasos para que el secret nuevo nunca toque BD si falla (Fase 26, C4)

- **Contexto:** rotar TOTP es sensible — un secret nuevo persistido sin que el usuario lo configure rompe acceso.
- **Decisión:** `POST /auth/totp/begin` (valida TOTP actual, genera secret nuevo, lo cifra con `MASTER_ENC_KEY`, lo embebe en JWT corto `rotation_token` TTL 5 min). `POST /auth/totp/confirm` valida TOTP del **nuevo** authenticator → recién ahí persiste.
- **Alternativas:** persistir el secret nuevo de inmediato (rompe si el usuario no escanea el QR a tiempo).
- **Riesgos:** rotación interrumpida (5 min) deja al usuario en estado válido (TOTP viejo intacto).

### ADR-018 · Biometría = unlock LOCAL, NO reemplazo de TOTP (Fase 27, 2026-05-05)

- **Contexto:** UX moderna pide "iniciar con huella". Biometría es local — server no la ve.
- **Decisión:** server emite un `biometric_unlock_token` (JWT 90d, type `biometric_unlock`, JTI rotable) tras validar TOTP en `/auth/biometric/enable`. Cliente lo guarda en Keystore/Keychain cifrado con biometría. En logins futuros, el token ES la prueba en `/auth/biometric/unlock`. JTI rotable → revocación instantánea.
- **Alternativas:** WebAuthn / Passkeys (más estándar, planeado Fase 29), guardar password en Keystore (pésimo).
- **Riesgos:** si Keystore se compromete (root del device), atacante tiene session 90 días. Mitigación: admin puede revocar device → unlock falla. Considerar bajar TTL a 14d con refresh-on-use (ver KNOWN_ISSUES.md #5).

### ADR-019 · Coexistencia con infra del cliente (2026-04-17)

- **Contexto:** VPS también corre n8n, Traefik, email-admin del cliente.
- **Decisión:** NO tocar `root-*` containers. NO `apt upgrade -y`. NO `ufw --force enable`. Traefik del cliente sirve nuestros containers via Docker labels. Nuestros servicios corren en puertos altos (3100, 4000) sin conflicto.
- **Alternativas:** VPS dedicado (más caro), Docker network propia (más config).
- **Riesgos:** un cambio de Traefik del cliente puede romper nuestro routing. Mitigación: monitoreo + audit log de status checks.

---

## 4. Base de datos y migrations

### ADR-020 · Migrations append-only con runner CLI (Fase 28, 2026-05-05)

- **Contexto:** incidente 2026-05-05 — migrations 010-012 nunca aplicadas en VPS aunque el código las requería desde Fase 24. Detected solo cuando `/auth/login` empezó a tirar 500.
- **Decisión:** tabla `schema_migrations(version, checksum, applied_at, applied_by)` + runner `apps/api/src/scripts/migrate.ts` con 4 comandos (`status` / `apply` / `dry-run` / `bootstrap`). Migrations son **append-only**: cambiar un `.sql` aplicado emite `CHECKSUM MISMATCH` pero no re-aplica. Las 13 existentes son idempotentes (`IF NOT EXISTS`).
- **Alternativas:** `db-migrate` o `node-pg-migrate` (deps grandes), aplicar migrations en bootstrap del API (mezcla concerns).
- **Riesgos:** runner depende de `DATABASE_URL` puro — si alguien lo invoca sin `source .env`, falla con mensaje claro. Edge cases conocidos en KNOWN_ISSUES.md #1-3.

### ADR-021 · Texto plano en `messages.content` (Fase 3, descartado en Fase 4)

- **Contexto:** primer prototipo del chat funcionaba sin E2EE.
- **Decisión:** `messages.content TEXT` directo en BD para iterar rápido en UX.
- **Alternativas:** E2EE desde el día 1 (más lento de iterar).
- **Riesgos:** mensajes pre-Fase 4 quedan visibles para el server. Aceptado en dev. **En producción, todos los messages legacy se borraron antes del primer go-live**. La columna `content` aún existe pero solo se usa para system messages (audit events del server, plaintext intencional).

---

## 5. Mobile y Capacitor

### ADR-022 · PWA + Capacitor en lugar de React Native / Expo (2026-04-17, Fase 6)

- **Contexto:** mobile cross-platform. Equipo conoce React/Next.js, no RN nativo.
- **Decisión:** PWA con Next.js + wrapper Capacitor para Android. JS/CSS/HTML viven en `apps/web`; el APK es shell delgado que carga `server.url` en WebView. iOS scaffold listo (Capacitor + plugin Swift), no publicado.
- **Alternativas:** React Native + Expo (curva nueva), TWA (no permite plugins nativos como `FLAG_SECURE`), Cordova (deprecado).
- **Riesgos:** WebView ≠ browser — algunos APIs pueden comportarse distinto. Mitigación: feature-detect siempre. App store review puede rechazar apps "WebView wrapper" — Capacitor con plugins nativos pasa el filtro de Apple.

### ADR-023 · Plugin nativo SecurityPlugin para FLAG_SECURE (Fase 23a, 2026-05-01)

- **Contexto:** chat empresarial requiere bloquear screenshots a nivel OS.
- **Decisión:** plugin Java en Android (`MainActivity.java` + `security/SecurityPlugin.java`) que invoca `FLAG_SECURE` desde JS. iOS análogo en Swift detecta screenshots (no puede bloquearlos) y emite eventos al backend.
- **Alternativas:** TWA (no permite plugins), service worker tricks (no aplican a OS-level capture).
- **Riesgos:** root del device puede burlar FLAG_SECURE. Aceptable — el threat model excluye rooted devices.

### ADR-024 · Logout SÍ borra biometric Keystore (Fase 27, 2026-05-05)

- **Contexto:** ¿debería logout preservar el biometric token para "logout pero no perder huella"?
- **Decisión:** logout BORRA el Keystore. Si un atacante físico roba el device tras logout, no puede explotar la conveniencia.
- **Alternativas:** preservar biometric (UX mejor pero riesgo).
- **Riesgos:** UX peor — re-loguear requiere TOTP de nuevo. Aceptable para empresa con threat model elevado.

### ADR-025 · Multi-device backfill E2EE (Fase 23b, 2026-05-01)

- **Contexto:** un usuario con device viejo agrega device nuevo. El device nuevo no puede leer mensajes anteriores (no recibió envelopes).
- **Decisión:** los devices viejos detectan automáticamente devices nuevos del mismo user → re-cifran los últimos 100 mensajes para el device nuevo y los suben.
- **Alternativas:** importar export/import desde device viejo (UX horrible), key wrapping (refactor masivo).
- **Riesgos:** el device viejo debe estar online para hacer backfill. Si el usuario solo usa el nuevo, no hay backfill — los mensajes viejos quedan ilegibles. Documentado.

### ADR-026 · Package mobile renombrado: `com.euromex.chat` → `com.grupoeuromex.chat` (2026-05-05)

- **Contexto:** el package `com.euromex.chat` aparecía en uso por otra cuenta de Play Console (no del cliente).
- **Decisión:** rename a `com.grupoeuromex.chat` (reverse-domain del FQDN real).
- **Alternativas:** `mx.com.grupoeuromex.chat` (raro), `com.grupoeuromex.privatechat` (menos descriptivo), comprar el viejo a su dueño (caro).
- **Riesgos:** APKs viejos instalados (`com.euromex.chat`) son apps DISTINTAS para Android — no se actualizan encima. Hay que desinstalar el viejo. Keystore release sigue válido (la firma no depende del package).

---

## 6. Adjuntos y storage

### ADR-027 · Filesystem local en lugar de MinIO/S3 (Fase 5, 2026-04-17)

- **Contexto:** adjuntos cifrados E2EE — server no puede leer contenido.
- **Decisión:** disk local (`/opt/euromex/storage/`, mode 700). Cliente sube blob, server solo guarda referencia.
- **Alternativas:** MinIO self-hosted (more infra), S3 (costo + lock-in cloud).
- **Riesgos:** filesystem se llena → bloquea uploads. Mitigación: `MAX_ATTACHMENT_BYTES=50MB` + monitoreo manual (no automático todavía).

### ADR-028 · Clave AES-256-GCM dentro del plaintext del mensaje (Fase 5, 2026-04-17)

- **Contexto:** ¿dónde guarda la clave del archivo cifrado?
- **Decisión:** la clave AES (32 bytes) y el IV viajan en el plaintext del mensaje E2EE (`AttachmentPayload`). Cada device del recipient cifra ese mensaje con su propio envelope NaCl. Server nunca ve la clave.
- **Alternativas:** key derivation desde el messageId (server podría reproducirla), key escrow.
- **Riesgos:** mensaje borrado = clave perdida = adjunto inutilizable. Mitigación: edit/delete (Fase 25) preserva los envelopes en `message_envelopes_history` para auditoría — admins pueden recuperar la clave si fueron parte de la conversación.

### ADR-029 · PIN argon2id por adjunto + acceso restringido per-user (Fase 14, 2026-04-30)

- **Contexto:** algunos archivos sensibles requieren un segundo factor para descargar incluso si la conversación es accesible.
- **Decisión:** opcional `download_pin_hash TEXT` (argon2id) en `attachments`. Lista blanca `attachment_allowed_users` para acceso restringido. Cliente pide PIN al usuario antes de mostrar el blob.
- **Alternativas:** TOTP de nuevo por descarga (UX pesado), DRM (no factible).
- **Riesgos:** PIN se puede compartir verbalmente entre users. Aceptable — es deterrent + audit trail.

---

## 7. Operación e infra

### ADR-030 · Backups con GPG symmetric (no asimétrico) (Fase 7, 2026-04-17)

- **Contexto:** backup diario de Postgres + storage.
- **Decisión:** `gpg --symmetric --cipher-algo AES256` con `EUROMEX_BACKUP_PASSPHRASE`. Timer systemd diario 03:00 UTC.
- **Alternativas:** `gpg --encrypt` con keypair (otro key par a no perder), restic (otra deps).
- **Riesgos:** `EUROMEX_BACKUP_PASSPHRASE` IRRECUPERABLE. Vive en `/etc/euromex/backup.env`.

### ADR-031 · Privacy policy estática (Fase 26, 2026-05-04)

- **Contexto:** Play Store / App Store exigen URL pública de privacy policy.
- **Decisión:** servirla estática desde `apps/web/public/privacy.html`. Next.js sirve `public/` en runtime sin rebuild.
- **Alternativas:** servicio externo (otro punto de fallo), generarla dinámica desde DB (overkill).
- **Riesgos:** si el archivo cambia y se olvida deployar, Play Store sigue viendo la vieja. Mitigación: link en el footer del web.

### ADR-032 · Release signing Android sin secrets en el repo (Fase 26, 2026-05-04)

- **Contexto:** AAB firmado para Play Store, pero el keystore NO debe ir al repo.
- **Decisión:** `signingConfigs.release` lee desde env vars `EUROMEX_KEYSTORE_*`. Sin las vars o el archivo `.keystore`, fallback al debug keystore con WARNING visible (evita generar AAB no firmable que pase silently). `.gitignore` endurecido bloquea `*.keystore`/`*.jks`/`key.properties`.
- **Alternativas:** keystore en el repo encriptado (rotación complicada), CI con secrets injected (no tenemos CI).
- **Riesgos:** keystore IRRECUPERABLE. Si se pierde, Play Store NO permite actualizar la app — solo publicar una nueva. Backup obligatorio en 2 sitios mínimo.

---

## 8. DNS y dominios

### ADR-033 · Subdominios chat + api.chat (no path prefix /api) (Fase 7, 2026-04-17)

- **Contexto:** ¿servir API en `/api/*` o en subdomain?
- **Decisión:** dos subdominios separados. Web: `euromex.xyz`. API: `api.euromex.xyz`. Permite CORS estricto y certs separados.
- **Alternativas:** path prefix (`euromex.xyz/api`) — mezcla CORS, complica caching.
- **Riesgos:** dos certs LE en lugar de uno. Traefik los maneja automáticamente.

### ADR-034 · Migración a dominio dedicado `euromex.xyz` (2026-05-05)

- **Contexto:** sslip.io tenía el IP del VPS hardcoded — cambio futuro de IP rompe APKs instalados. `chat.grupoeuromex.com` no era viable: bug estructural de Hostinger DNS no publica A records de subdomains (verificado preguntando directo al NS autoritativo).
- **Decisión:** dominio dedicado `euromex.xyz` (regalado por Hostinger 1 año). Topología: chat en apex (`euromex.xyz`), API en `api.euromex.xyz`.
- **Alternativas probadas y descartadas:** A records directos en Hostinger (no propagan), borrar ALIAS automático al CDN (no resolvió), subdomain delegation a he.net (Hostinger no permite tipo NS en subdominios), Cloudflare full domain (riesgo al web/correo corporativo).
- **Riesgos:** dominio gratis 1er año. Al renovar, evaluar pagar o migrar. Si Hostinger DNS también falla con `euromex.xyz`, plan B es Cloudflare DNS solo para este dominio (sin riesgo al corporativo).

---

## 9. Mensajería y UX

### ADR-035 · DM único entre pares (re-uso, no duplicados) (Fase 3, 2026-04-17)

- **Contexto:** si A-B inician chat dos veces, ¿dos conversaciones distintas?
- **Decisión:** server detecta si ya hay un DM entre los dos usuarios y devuelve esa conversación. Solo grupos permiten múltiples instancias.
- **Alternativas:** DMs múltiples (UX confuso, mensajes se dispersan).
- **Riesgos:** ningún caso edge donde sí queremos dos DMs entre los mismos. Aceptable.

### ADR-036 · Edit/borrar mensajes con auditoría preservada (Fase 25, 2026-05-03)

- **Contexto:** items C1+C2 del audit. Sin edit/delete, typos requieren mensajes nuevos = ruidoso.
- **Decisión:** soft delete + edit history. Los regulares ven estado actual ("(editado)" o tombstone). El server archiva los envelopes anteriores en `message_envelopes_history` para auditoría. Edit limitado a 24h post-envío. Solo `text/plain` por ahora (media futuro).
- **Alternativas:** hard delete (sin trazabilidad), edit unlimited en tiempo (rewriting history).
- **Riesgos:** **limitación E2EE honesta** — solo descifran el histórico los devices que estuvieron en la conversación al momento del edit. Un admin que entra después NO puede leer las versiones archivadas.

### ADR-037 · Activities/Tasks como mensajes de sistema con cards interactivos (Fase 15, 2026-04-30)

- **Contexto:** integrar calendario/tareas sin app aparte.
- **Decisión:** `activities` y `tasks` son tablas separadas, pero CADA acción genera un mensaje en la conversación con `content_type = application/vnd.euromex.{activity,task}+json`. El cliente renderiza cards interactivos (RSVP, status). Real-time via socket events `activity:updated` / `task:updated`.
- **Alternativas:** vista separada (no integrado al flujo de chat), inline pero sin BD persistente (no audit trail).
- **Riesgos:** content_type custom no es estándar — si en el futuro queremos federar con Matrix, hay que mapear.

### ADR-038 · Calendar mensual + semanal con toggle (Fase 16-17, 2026-04-30)

- **Contexto:** vista de actividades y tareas planificadas.
- **Decisión:** vista mensual default + toggle a semanal. Filtros por tipo (act/task) y "mine".
- **Alternativas:** solo mensual (limitado), día agenda (poco useful para 25 personas).
- **Riesgos:** pre-Fase 28 polish, la vista semanal carecía de hora en actividades. Fixed.

### ADR-039 · Paginación scroll-up con preservación de posición (Fase 26, I4, 2026-05-05)

- **Contexto:** lista de mensajes solo cargaba los últimos 50. Conversaciones viejas inaccesibles.
- **Decisión:** scroll cerca del top → fetch `?before=<oldestCreatedAt>&limit=50` → prepend al array. `prependScrollHeightRef` snapshotea `scrollHeight` antes del prepend; useEffect restaura `scrollTop = newH − oldH` para mantener visible el mensaje que el usuario estaba leyendo.
- **Alternativas:** `IntersectionObserver` con sentinel (más limpio pero más deps), virtualización con `react-virtuoso` (cuando >miles de mensajes).
- **Riesgos:** cada batch viejo se descifra entero en cliente. Para histórico de miles de mensajes, lento. Mitigación futura: caché en IndexedDB de plaintexts ya descifrados.

---

## 10. Decisiones rechazadas

> Importante saberlas para no caer en estas tentaciones de nuevo.

### Auth por MAC address (descartada 2026-04-17)

- **Pensamos:** "como es app interna, asociar acceso a la MAC del device".
- **Por qué NO:** MAC se puede spoofear trivialmente. WebView nativo no expone MAC al JS. Falsa sensación de seguridad.

### Telegram / WhatsApp Business como solución (descartada 2026-04-17)

- **Pensamos:** evitar construir el chat desde cero.
- **Por qué NO:** Telegram BOT API no es E2EE. WhatsApp Business cobra por mensaje, server-side, no E2EE de docs internos. Cliente quería control total.

### Voice/video calls (deferido)

- **Por qué NO ahora:** WebRTC + signaling + STUN/TURN es proyecto en sí. Cliente lo difirió. M5 del audit (no priorizado).

### Federación tipo Matrix (decidido NO hacer)

- Esto es chat de empresa, no app de comunicación pública. No aplica.

### Cifrado homomórfico para búsqueda server-side (decidido NO hacer)

- Overkill. La búsqueda client-side (Fase 29 propuesta) cubre el caso.

### Double Ratchet / forward secrecy completa (decidido NO hacer)

- Proyecto en sí. Aceptamos: un device comprometido puede leer mensajes pasados que tenía. Documentado en privacy policy.

### Multi-tenant SaaS (decidido NO hacer)

- Un solo tenant (Grupo Euromex). Si esto cambiara, el modelo de auth se rediseña entero.

### Auto-borrado de mensajes / disappearing messages (no implementado)

- Si se pide, requiere job cron + edge cases con devices offline (¿qué pasa si un device estaba offline cuando expiró?). No priorizado.

---

## ADR-037 · Parches de robustez y seguridad — migrate.ts + biometric/unlock (2026-05-06)

### ADR-037a · `connectionTimeoutMillis` en migrate.ts

- **Contexto:** `pg.Pool` sin timeout cuelga indefinidamente si DNS no resuelve o el host es inalcanzable. El operador queda esperando sin feedback ni posibilidad de interrumpir limpiamente.
- **Decisión:** agregar `connectionTimeoutMillis: 5_000` al pool del migration runner. Falla rápido con error claro en lugar de colgar.
- **Alternativas:** timeout vía `setTimeout` externo (más frágil, no cancela la promesa pg). Signal de proceso (overkill para 1 línea).
- **Riesgos:** en conexiones lentas legítimas (VPN, disco lento en VPS) podría fallar prematuramente. 5 segundos es conservador para LAN/localhost; aumentar si el VPS tiene latencia alta.

### ADR-037b · Production guard interactivo en migrate.ts

- **Contexto:** `pnpm migrate` con `DATABASE_URL` apuntando a producción aplica migrations sin confirmación. Riesgo de aplicar prematuramente desde laptop de desarrollo.
- **Decisión:** detectar si el hostname en `DATABASE_URL` es no-local (no `localhost`/`127.0.0.1`/`::1`) o si `NODE_ENV=production`. Si aplica, pedir confirmación interactiva antes de `apply`/`bootstrap`. Flag `--yes` para CI/scripts.
- **Alternativas:** env var `ALLOW_PROD_MIGRATE=1` (menos visible). Solo warning sin bloqueo (no da protección real). Bloquear siempre en prod (rompe el CI que sí debe poder migrar).
- **Riesgos:** rompe flujos automatizados que no pasen `--yes`. Workaround: pasar `--yes` explícitamente en el comando de deploy del VPS.
- **Próximos pasos:** actualizar el runbook en HOSTINGER.md para incluir `--yes` en el comando de deploy (`pnpm migrate -- --yes`).

### ADR-037c · Fingerprint de device en biometric/unlock

- **Contexto:** `biometric_token_jti` protege contra revocación pero no contra extracción del JWT del Keystore (requiere root del device). Un atacante con root puede usar el token desde cualquier device durante los 90 días de TTL.
- **Decisión:** guardar el `User-Agent` del request al activar biometría en `devices.biometric_fingerprint`. En cada `/auth/biometric/unlock`, comparar con el UA del request entrante. Mismatch → audit log `biometric.fingerprint_mismatch` + rechazo `401`.
- **Alternativas:** IP binding (cambia con WiFi/cellular, demasiados falsos positivos). TOTP step-up en mismatch (mejor UX pero más complejo). Solo loguear sin rechazar (no protege nada).
- **Riesgos:** browser update puede cambiar el UA levemente y causar falso positivo. Workaround explícito: desactivar/reactivar biometría para resetear el fingerprint (actualiza `biometric_fingerprint` con el UA nuevo). Devices con biometría activada ANTES de este parche tienen `biometric_fingerprint = NULL` y no aplican el check hasta que el usuario haga re-enable.
- **Limitación aceptada:** User-Agent es una heurística débil comparado con un fingerprint de hardware real (FIDO2/WebAuthn). Es una mejora pragmática con 0 dependencias nuevas. Para protección fuerte, ver Opción A del sprint (Fase 29 WebAuthn).

---

**Fuentes:**
- Razonamientos detallados originales: [archive/HISTORY.md](archive/HISTORY.md) (~1900 líneas, ordenado por fecha descendente)
- Estado operacional: [PROJECT_BRIEF.md](PROJECT_BRIEF.md)
- Issues abiertos: [KNOWN_ISSUES.md](KNOWN_ISSUES.md)
