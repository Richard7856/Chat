# Deploy en VPS de Hostinger — coexistiendo con n8n + Traefik

Guía paso a paso para poner Euromex Chat en tu VPS de Hostinger **sin
romper tu instalación actual de n8n + Traefik**. Modo staging: HTTP por
IP y puerto (3100). Cuando quieras HTTPS con dominio, la Fase 7 lo
enchufa a tu Traefik existente (sin instalar Nginx).

No necesito acceso a tu VPS. Tú ejecutas los comandos por SSH y me cuentas
si algo falla.

> **Importante:** este documento te sirve tanto para la primera vez como
> para actualizar a nuevas versiones. Busca la sección "Actualizar a nueva
> versión" al final.

---

## 0. Estado actual del VPS (lo que ya tienes)

Detectado en tu VPS:

- **Traefik** en 80/443 — reverse proxy con TLS (reusaremos en Fase 7).
- **n8n** Docker en `127.0.0.1:5678` — intacto.
- **email-admin** Docker (interno, puerto 3000 dentro de Docker).
- **Node app** en `/var/www/e...` escuchando en `0.0.0.0:3000` — por eso
  **no podemos usar el puerto 3000** para nuestra web.

Puertos que **nosotros** vamos a usar:

| Puerto | Servicio | Expuesto a |
|--------|----------|------------|
| 3100 | Web Next.js | internet (staging) o solo Traefik (prod) |
| 4000 | API Fastify | internet (staging) o solo Traefik (prod) |
| 5432 | Postgres | **solo 127.0.0.1** (nunca a internet) |
| 6379 | Redis | **solo 127.0.0.1** (nunca a internet) |

Todos libres según tu `ss` y `docker ps`.

---

## 1. Conéctate por SSH

```bash
ssh root@TU_IP_DEL_VPS
```

---

## 2. Instala dependencias del sistema (modo cuidadoso)

**No correremos `apt upgrade -y`** — podría reiniciar Traefik/n8n. Solo
instalamos lo nuevo que falta.

```bash
# Solo refresca índice, no actualiza paquetes existentes
apt update

# Node.js 22 (vía NodeSource) — coexiste con cualquier Node previo
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node --version   # v22.x.x

# pnpm 10
npm install -g pnpm@10
pnpm --version

# Docker y Docker Compose — YA LOS TIENES (n8n/Traefik corren en Docker).
# Solo verifica versiones:
docker --version
docker compose version
```

> Si `node --version` muestra una versión distinta a v22, probablemente
> el proceso en `/var/www/e...` usa otra versión vía `nvm`. Mi instalación
> pone Node 22 como el global; tu otra app sigue usando el suyo si está
> pinned por nvm. Si dudas, avísame antes de seguir.

**NO corras `ufw --force enable`.** Tu Traefik ya está aceptando 80/443 y
UFW podría bloquearlo. Si quieres reglas de firewall, déjalas para Fase 7
cuando armemos el set completo con Traefik.

---

## 3. Clona el repo

```bash
mkdir -p /opt/euromex && cd /opt/euromex
git clone https://github.com/richard7856/chat.git .
git checkout claude/private-chat-mac-auth-e9QYn
```

Si el repo es privado: usa una SSH deploy key o Personal Access Token
(`https://USER:TOKEN@github.com/...`).

---

## 4. Genera secretos y crea los `.env`

```bash
cd /opt/euromex

JWT_SECRET=$(openssl rand -base64 48)
MASTER_ENC_KEY=$(openssl rand -base64 32)
PG_PASS=$(openssl rand -base64 24 | tr -d '=+/' | cut -c1-24)
REDIS_PASS=$(openssl rand -base64 24 | tr -d '=+/' | cut -c1-24)

echo "JWT_SECRET=$JWT_SECRET"
echo "MASTER_ENC_KEY=$MASTER_ENC_KEY"
echo "PG_PASS=$PG_PASS"
echo "REDIS_PASS=$REDIS_PASS"
```

**⚠️ Copia estos valores a un gestor de contraseñas AHORA.** Si pierdes
`MASTER_ENC_KEY` pierdes el acceso TOTP de todos los usuarios.

```bash
cat > infra/.env <<EOF
POSTGRES_USER=euromex
POSTGRES_PASSWORD=$PG_PASS
POSTGRES_DB=euromex_chat
REDIS_PASSWORD=$REDIS_PASS
EOF

cat > apps/api/.env <<EOF
NODE_ENV=production
API_HOST=0.0.0.0
API_PORT=4000
API_LOG_LEVEL=info
DATABASE_URL=postgres://euromex:$PG_PASS@127.0.0.1:5432/euromex_chat
REDIS_URL=redis://default:$REDIS_PASS@127.0.0.1:6379
JWT_SECRET=$JWT_SECRET
JWT_TTL_SEC=28800
MASTER_ENC_KEY=$MASTER_ENC_KEY
CORS_ORIGINS=http://TU_IP_DEL_VPS:3100
EOF

cat > apps/web/.env.local <<EOF
NEXT_PUBLIC_API_BASE=http://TU_IP_DEL_VPS:4000
EOF
```

**Reemplaza `TU_IP_DEL_VPS`** en los dos últimos archivos por tu IP real.

---

## 5. Instala dependencias y compila

```bash
cd /opt/euromex
pnpm install
pnpm rebuild argon2      # compila bindings nativos
pnpm build               # API + web
```

El `build` tarda 1–2 min.

---

## 6. Arranca Postgres + Redis

Los contenedores se llaman `euromex-postgres` y `euromex-redis` — no
chocan con los nombres de tus contenedores de n8n/Traefik.

```bash
cd /opt/euromex
pnpm infra:up
docker compose -f infra/docker-compose.yml ps
```

Ambos deben aparecer `(healthy)` en ~10s. El schema SQL se carga
automáticamente en el primer arranque.

```bash
# Verifica que siguen corriendo tus otros servicios
docker ps --format '{{.Names}}: {{.Status}}'
# Deberías ver: root-traefik-1, root-n8n-1, email-admin,
# euromex-postgres, euromex-redis
```

---

## 7. Crea el primer admin

```bash
cd /opt/euromex/apps/api
ADMIN_USERNAME=richard \
  ADMIN_PASSWORD='UnaContraseñaLargaYSegura!' \
  ADMIN_DISPLAY='Richard' \
  pnpm run create-admin
```

El script imprime un **QR data URL** y un **otpauth URI**. Pega el data
URL (empieza con `data:image/png;base64,...`) en un navegador para ver
el QR, o escanea la `otpauth://...` directamente desde Aegis / 1Password.

Guarda la semilla base32 en tu gestor de contraseñas por si pierdes el
teléfono.

---

## 8. Arranca API y web en background

Opción rápida con `nohup` (luego migramos a `systemd` en Fase 7):

```bash
cd /opt/euromex

# API
nohup node apps/api/dist/server.js > /var/log/euromex-api.log 2>&1 &
echo $! > /var/run/euromex-api.pid

# Web
cd apps/web
nohup pnpm start > /var/log/euromex-web.log 2>&1 &
echo $! > /var/run/euromex-web.pid
```

Para parar:

```bash
kill $(cat /var/run/euromex-api.pid)
kill $(cat /var/run/euromex-web.pid)
```

---

## 9. Abre los puertos 3100 y 4000 en Hostinger

En el firewall **externo** de Hostinger (hPanel → VPS → Firewall), abre
temporalmente TCP **3100** y **4000** entrantes. No uses UFW local
porque tienes Traefik funcionando.

---

## 10. Verifica que todo funciona

Desde tu equipo local:

```bash
curl http://TU_IP_DEL_VPS:4000/health
```

Deberías ver:
```json
{"status":"ok","service":"euromex-api","version":"0.2.0",...,"deps":{"postgres":"up","redis":"up"}}
```

En el navegador:
- `http://TU_IP_DEL_VPS:3100` — landing
- `http://TU_IP_DEL_VPS:3100/login` — inicia sesión con tu admin
- `http://TU_IP_DEL_VPS:3100/app` — panel con "Crear código de invitación"

Emite un código y pruébalo desde otro navegador en
`http://TU_IP_DEL_VPS:3100/enroll?code=XXXX-XXXX-XXXX-XXXX`.

---

## Actualizar a nueva versión

> 💡 **Desde Fase 28 (2026-05-05) hay runner de migrations.** Las migrations
> son idempotentes y se trackean en `schema_migrations`. El flujo nuevo
> es trivial: `pnpm migrate:status` muestra qué falta, `pnpm migrate`
> aplica las pendientes con un BEGIN/COMMIT por archivo.

### Flujo de deploy (post 2026-05-05)

```bash
cd /opt/euromex

# 1) Trae cambios
git fetch origin
git checkout claude/private-chat-mac-auth-e9QYn
git pull

# 2) Reinstala dependencias (necesario si cambió algún package.json)
pnpm install
pnpm rebuild argon2

# 3) Migrations: ver qué hay pendiente y aplicar.
#    El runner usa el .env del API (DATABASE_URL).
cd apps/api
source .env  # pone DATABASE_URL en el shell
pnpm migrate:status        # info — debería listar las nuevas como PENDING
pnpm migrate               # aplica las pendientes; cada una en su transacción
cd /opt/euromex

# 4) Build web (Next.js production)
cd apps/web && pnpm build && cd /opt/euromex

# 5) Restart con systemd (NO mata n8n/Traefik)
systemctl restart euromex-api euromex-web

# 6) Verifica que arrancaron OK
systemctl is-active euromex-api euromex-web
journalctl -u euromex-api -n 20 --no-pager  # busca "Server listening"
```

### Bootstrap único — DB legacy → tabla schema_migrations

Solo necesario UNA VEZ después del deploy de Fase 28 (2026-05-05). En el
VPS las migrations 001-013 ya están aplicadas pero no registradas; el
bootstrap crea `schema_migrations` y las marca como aplicadas sin
re-ejecutar SQL.

```bash
cd /opt/euromex/apps/api
source .env
pnpm migrate:bootstrap
# → "✔ Bootstrap completo: 14 migrations registradas."

# Validar:
pnpm migrate:status
# → todo debería estar 'applied' incluyendo 014-schema-migrations-tracking
```

**Si bootstrap falla con "La tabla schema_migrations YA existe"** = ya
se corrió antes; usar `pnpm migrate:status` para ver el estado.

### Comandos del runner

| Comando | Qué hace |
|---|---|
| `pnpm migrate:status` | Lista cada `.sql` y marca `applied` / `PENDING` / `CHECKSUM MISMATCH`. Read-only. |
| `pnpm migrate` | Aplica las pendientes en orden, BEGIN/COMMIT por archivo. Si una falla, ROLLBACK de esa + exit 1; las anteriores quedan aplicadas. |
| `pnpm migrate:dry-run` | Como `migrate` pero NO ejecuta nada — solo lista qué se aplicaría. |
| `pnpm migrate:bootstrap` | One-shot para DBs legacy (ver arriba). |

Las migrations son **append-only**: una vez registrada, NO se re-aplica
aunque el `.sql` cambie. Para corregir algo aplicado, crear migration
nueva. Si el archivo cambia, el runner avisa con
"CHECKSUM MISMATCH" pero no la re-corre (es un warning, no un error).

### Pre-flight legacy (manual, para diagnóstico de DBs sin runner)

Si por alguna razón no tienes el runner disponible y necesitas saber qué
columnas faltan, usa este SQL ad-hoc. Solo para diagnosticar — el runner
es la fuente de verdad oficial.

```bash
source /opt/euromex/infra/.env && docker exec -i euromex-postgres psql \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='messages'  AND column_name='content_type')              AS has_001_content_type,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='message_envelopes' AND column_name='nonce')             AS has_002_e2ee,
  EXISTS(SELECT 1 FROM information_schema.tables  WHERE table_name='attachments')                                           AS has_003_attachments,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='users'     AND column_name='receives_security_alerts')  AS has_005_alerts,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='users'     AND column_name='job_title')                 AS has_006_profile,
  EXISTS(SELECT 1 FROM information_schema.tables  WHERE table_name='conversation_documents')                                AS has_007_docs,
  EXISTS(SELECT 1 FROM information_schema.tables  WHERE table_name='activities')                                            AS has_008_activities,
  EXISTS(SELECT 1 FROM information_schema.tables  WHERE table_name='starred_messages')                                      AS has_009_starred,
  EXISTS(SELECT 1 FROM information_schema.tables  WHERE table_name='push_subscriptions')                                    AS has_010_push,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='users'     AND column_name='can_download_attachments')  AS has_011_permissions,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='messages'  AND column_name='deleted_at')                AS has_012_edit_delete,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='devices'   AND column_name='biometric_enabled')         AS has_013_biometric,
  EXISTS(SELECT 1 FROM information_schema.tables  WHERE table_name='schema_migrations')                                     AS has_014_tracking;
"
```

---

### Bloque legacy (pre-systemd, pre-2026-05-05)

```bash
# Detén servicios nuestros (n8n/Traefik intactos)
kill $(cat /var/run/euromex-api.pid) 2>/dev/null
kill $(cat /var/run/euromex-web.pid) 2>/dev/null

# Trae cambios
git fetch origin
git checkout claude/private-chat-mac-auth-e9QYn
git pull

# Reinstala y recompila
pnpm install
pnpm rebuild argon2
pnpm build

# Si te aviso en el commit que hay migración SQL, aplícala.
# Ejemplo Fase 3 (solo si tu DB ya existía desde Fase 2):
# source infra/.env && \
#   docker exec -i euromex-postgres psql \
#     -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
#     < apps/api/src/db/migrations/001-add-message-content.sql
#
# Fase 4 (E2EE): añade la columna `nonce` a message_envelopes.
# source infra/.env && \
#   docker exec -i euromex-postgres psql \
#     -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
#     < apps/api/src/db/migrations/002-enable-e2ee.sql
#
# Fase 5 (adjuntos): crea tabla attachments.
# source infra/.env && \
#   docker exec -i euromex-postgres psql \
#     -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
#     < apps/api/src/db/migrations/003-add-attachments.sql
#
# Fase 8.2 (super admin / alertas privilegiadas): añade columna
# receives_security_alerts a users; backfill admins existentes a true.
# source infra/.env && \
#   docker exec -i euromex-postgres psql \
#     -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
#     < apps/api/src/db/migrations/005-security-alerts.sql
#
# Fase 6 (PWA): sin migración. Solo rebuild de la web:
# cd apps/web && pnpm build
# El resultado incluye /manifest.webmanifest, /icon, /apple-icon.
# El service worker se registrará automáticamente — pero ojo, los
# browsers solo activan SW en HTTPS. En HTTP por IP la app es
# instalable pero sin offline ni push (eso llega con Fase 7).

# Para DB nueva no hace falta migración (schema.sql ya trae todo).
# Si prefieres resetear completamente (¡BORRA DATOS!):
# pnpm infra:down && rm -rf infra/volumes/postgres && pnpm infra:up

# Fase 5: crea el directorio de storage + añade 2 vars al .env del API.
# mkdir -p /opt/euromex/storage && chmod 700 /opt/euromex/storage
# echo 'STORAGE_DIR=/opt/euromex/storage' >> apps/api/.env
# echo 'MAX_ATTACHMENT_BYTES=52428800' >> apps/api/.env

# Relanza el API con tsx (no node dist/ — los workspace packages exportan
# .ts directos y Node puro no los resuelve). Esto lo limpiamos en Fase 7.
cd /opt/euromex/apps/api
nohup npx tsx src/server.ts > /var/log/euromex-api.log 2>&1 &
echo $! > /var/run/euromex-api.pid

# Relanza la web
cd /opt/euromex/apps/web
nohup pnpm start > /var/log/euromex-web.log 2>&1 &
echo $! > /var/run/euromex-web.pid
```

---

## Troubleshooting

- **Puerto 3100 ocupado:** `ss -tlnp | grep :3100`. Si aparece otro
  proceso, avísame y te doy otro puerto.
- **`curl /health` falla:** `tail -f /var/log/euromex-api.log`. Errores
  de DB = `.env` con password mala o contenedores abajo
  (`docker compose -f infra/docker-compose.yml ps`).
- **Web no carga:** `tail -f /var/log/euromex-web.log`. Revisa firewall
  de Hostinger, no UFW.
- **`argon2` falla al iniciar:** `pnpm rebuild argon2` dentro del repo.
- **TOTP inválido al loguear:** verifica hora del VPS (`timedatectl`).
  `systemctl enable --now systemd-timesyncd` si desfasa.
- **n8n dejó de responder:** no debería — nuestros contenedores son
  independientes. Si pasa, `docker restart root-n8n-1` y avísame; lo
  investigamos.

---

## Fase 7 — Producción: HTTPS + systemd + backups

Cuando ya tengas validado el staging (login, chat, adjuntos funcionan
por IP+puerto), este es el paso a producción.

### Pre-requisitos

1. **Un (sub)dominio apuntando al VPS.** Sugerencia:
   `chat.euromex.com.mx` (para la web) y `api.chat.euromex.com.mx`
   (para la API). Cambios DNS:
   ```
   chat.euromex.com.mx      A   148.230.82.52
   api.chat.euromex.com.mx  A   148.230.82.52
   ```
   Verifica propagación desde tu laptop:
   ```bash
   dig +short chat.euromex.com.mx
   dig +short api.chat.euromex.com.mx
   ```
   Ambas deben devolver la IP del VPS.

2. **Traefik existente con Let's Encrypt configurado.** Tu Traefik ya
   corre y presume tener un certResolver. Para confirmar:
   ```bash
   docker exec root-traefik-1 cat /etc/traefik/traefik.yml 2>/dev/null | grep -A3 certResolver
   # o
   docker inspect root-traefik-1 --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
   ```
   Anota:
   - El path del **directorio dinámico** de Traefik (suele ser
     `/dynamic` montado desde `/root/traefik/dynamic/`).
   - El nombre de tu **certResolver** (suele ser `letsencrypt`).

### 1. Configurar Traefik para Euromex

```bash
cd /opt/euromex

# Copia el template al directorio dinámico de Traefik.
# AJUSTA LA RUTA según tu setup (ver pre-requisito 2).
TRAEFIK_DYN=/root/traefik/dynamic   # ← cambia esto si es otro
cp infra/traefik/euromex.yml "$TRAEFIK_DYN/euromex.yml"

# Edita para poner tus dominios reales
sed -i \
  -e 's/chat\.example\.com/chat.euromex.com.mx/g' \
  -e 's/api\.chat\.example\.com/api.chat.euromex.com.mx/g' \
  "$TRAEFIK_DYN/euromex.yml"

# Si tu certResolver tiene otro nombre, reemplaza:
# sed -i 's/letsencrypt/miresolver/g' "$TRAEFIK_DYN/euromex.yml"

# Traefik recarga solo. Verifica que no haya errores:
docker logs root-traefik-1 --tail 30
```

Deberías ver líneas como `Configuration loaded from file: ...euromex.yml`.

### 2. Actualizar los `.env` para apuntar a los dominios

```bash
# API: ajusta CORS para aceptar solo HTTPS del nuevo dominio
sed -i \
  -e 's|CORS_ORIGINS=.*|CORS_ORIGINS=https://chat.euromex.com.mx|' \
  /opt/euromex/apps/api/.env

# Web: apunta a la nueva URL del API
sed -i \
  -e 's|NEXT_PUBLIC_API_BASE=.*|NEXT_PUBLIC_API_BASE=https://api.chat.euromex.com.mx|' \
  /opt/euromex/apps/web/.env.local

# Re-build de la web porque NEXT_PUBLIC_* se injectan en build-time
cd /opt/euromex/apps/web
pnpm build
```

### 3. Cambiar de `nohup` a `systemd`

```bash
# Detén los procesos actuales lanzados con nohup
kill $(cat /var/run/euromex-api.pid) 2>/dev/null || true
kill $(cat /var/run/euromex-web.pid) 2>/dev/null || true

# Instala los units de systemd (copia a /etc/systemd/system + enable + start)
sudo bash /opt/euromex/infra/scripts/install-systemd.sh

# Verifica
systemctl status euromex-api euromex-web --no-pager
journalctl -u euromex-api -n 20 --no-pager
```

Ventajas del cambio: auto-restart al reboot, restart automático si el
proceso crashea, logs por `journalctl` (no más archivos /var/log/...).

### 4. Cerrar los puertos 3100 y 4000 en Hostinger

Ahora que todo pasa por Traefik (443), los puertos raw no deben estar
expuestos a internet.

**hPanel → VPS → Firewall:** elimina las reglas TCP entrantes 3100 y
4000 que habías agregado antes. Los servicios seguirán respondiendo
*desde localhost* (127.0.0.1:3100 y :4000), que es lo que Traefik
necesita.

### 5. Prueba el HTTPS

Desde tu laptop:
```bash
curl -I https://chat.euromex.com.mx
curl -s https://api.chat.euromex.com.mx/health
```

Debes ver cert válido (`HTTP/2 200`) y el JSON del health. Evalúa el
grado del TLS en https://www.ssllabs.com/ssltest/ — apunta a A o A+.

En el navegador: `https://chat.euromex.com.mx/login`. Login con el
admin. Desde la pantalla principal ya puedes instalar la PWA con cert
válido — el service worker se registrará esta vez.

### 6. Configurar backups cifrados

Genera una passphrase fuerte y guárdala en tu password manager (al
nivel de MASTER_ENC_KEY):

```bash
# Passphrase — cópiala AHORA a tu password manager
BACKUP_PASS=$(openssl rand -base64 48)
echo "EUROMEX_BACKUP_PASSPHRASE=$BACKUP_PASS"

# Crea el env file de systemd
sudo mkdir -p /etc/euromex
sudo tee /etc/euromex/backup.env <<EOF
EUROMEX_BACKUP_PASSPHRASE=$BACKUP_PASS
KEEP_DAYS=14
# Opcional — sincroniza a un servidor remoto (rsync via SSH)
# REMOTE_RSYNC=backup-user@otra-ip:/srv/backups/euromex
EOF
sudo chmod 600 /etc/euromex/backup.env

# Habilita el timer diario
sudo systemctl enable --now euromex-backup.timer

# Verifica
systemctl list-timers euromex-backup
```

**Prueba un backup manual** (no esperes a las 3 AM la primera vez):
```bash
sudo systemctl start euromex-backup.service
sudo journalctl -u euromex-backup -n 30
ls -lh /opt/euromex/backups/
```

Para restaurar en caso de desastre:
```bash
EUROMEX_BACKUP_PASSPHRASE='xxx' \
  /opt/euromex/infra/scripts/restore.sh \
  /opt/euromex/backups/pg-YYYY-MM-DDTHH-MM-SSZ.dump.gpg \
  /opt/euromex/backups/storage-YYYY-MM-DDTHH-MM-SSZ.tar.gpg
```

### 7. Checklist de producción

- [ ] DNS resuelve correctamente para ambos dominios
- [ ] `curl https://.../health` devuelve ok con cert válido
- [ ] SSL Labs reporta A o A+
- [ ] `systemctl is-enabled euromex-api euromex-web` ambos `enabled`
- [ ] Reboot del VPS → los servicios vuelven solos (`sudo reboot` y
      luego `systemctl status`)
- [ ] Puertos 3100 y 4000 cerrados en el firewall externo
- [ ] Backup manual ejecutado y archivos `.gpg` en `/opt/euromex/backups/`
- [ ] Passphrase de backup guardada en 2 password managers distintos
- [ ] `MASTER_ENC_KEY` también en 2 password managers (crítico)
- [ ] PWA instalada desde `https://chat.euromex.com.mx` en tu móvil
      (verifica que aparezca el candado 🔒 de HTTPS)
- [ ] Login con admin + TOTP, envío de mensaje, envío de adjunto
      funcionan end-to-end

### Operación diaria

```bash
# Estado
systemctl status euromex-api euromex-web --no-pager

# Logs en vivo
journalctl -u euromex-api -f       # API
journalctl -u euromex-web -f       # Web
journalctl -u euromex-backup -n 50 # Últimos backups

# Reiniciar tras un deploy
git -C /opt/euromex pull
cd /opt/euromex && pnpm install
cd /opt/euromex/apps/web && pnpm build
sudo systemctl restart euromex-api euromex-web

# Emitir invitación para un usuario (recuerda la UI admin en /app)

# Reset de password (si alguien lo pierde)
RESET_USERNAME=juan RESET_PASSWORD='NuevaLarga!' \
  pnpm --filter @euromex/api run reset-password
```
