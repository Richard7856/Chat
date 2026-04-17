# desicion.md — Bitácora de decisiones y progreso

> **Lee esto primero al retomar el proyecto.** Es la fuente única de verdad
> sobre qué se ha decidido, por qué, y qué sigue. Cada commit significativo
> debe agregar una entrada aquí.

## Estado actual

- **Fase:** 5 — Adjuntos cifrados E2EE (completada)
- **Paso dentro de la fase:** backend con endpoint multipart POST +
  download proxy, almacenamiento filesystem en `/opt/euromex/storage/`,
  cliente web cifra con AES-256-GCM antes de subir, UI con paperclip y
  bubble de descarga. El server solo ve ciphertext + tamaño; nombre,
  MIME y clave viajan dentro del plaintext del mensaje cifrado.
- **Última actualización:** 2026-04-17
- **Branch activa:** `claude/private-chat-mac-auth-e9QYn`
- **Plan aprobado:** `/root/.claude/plans/te-comento-a-grandes-buzzing-wand.md`
- **Deploy actual:** API v0.5.0 corriendo en el VPS de Hostinger detrás
  de `tsx` (no `node dist/`) para que los workspace packages se
  resuelvan. Admin creado, login funcional.

## Próximos pasos

1. **Usuario:** en el VPS, `git pull` + `pnpm install` (por
   `@fastify/multipart`) + crear directorio de storage:
   `mkdir -p /opt/euromex/storage && chmod 700 /opt/euromex/storage`
2. **Usuario:** añadir a `apps/api/.env` las dos variables nuevas:
   `STORAGE_DIR=/opt/euromex/storage` y
   `MAX_ATTACHMENT_BYTES=52428800`
3. **Usuario:** aplicar la migración
   `003-add-attachments.sql` (instrucción en `HOSTINGER.md`). Reiniciar
   API con `kill $(cat /var/run/euromex-api.pid)` + relanzar con el
   mismo comando tsx de antes.
4. **Usuario:** smoke test: sube un PDF o imagen en un DM, descarga del
   otro lado, verifica que se abre correctamente.
5. Iniciar **Fase 6 — Mobile React Native (Expo)**: app móvil con
   reuso de `packages/crypto`, secure storage para claves, push
   notifications vía FCM/APNs. O saltar a **Fase 7 — HTTPS con
   Traefik + dominio** si quieres salir a producción antes.
   AES-GCM de archivos, thumbnails locales.

## Historial de decisiones

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
