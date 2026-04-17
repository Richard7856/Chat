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

Cuando yo pushee cambios a la branch:

```bash
cd /opt/euromex

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

## Fase 7 (pendiente): Traefik + HTTPS con dominio

Cuando tengas un (sub)dominio Euromex listo (ej. `chat.euromex.com.mx`):

1. Apuntar DNS al VPS.
2. Añadir nuestras apps a la red Docker de Traefik.
3. Poner `labels` Traefik en `infra/docker-compose.yml` para que Traefik
   las enrute con Let's Encrypt automático.
4. Convertir `nohup` a `systemd` units.
5. Backups cifrados a S3/B2 y monitoreo con uptime-kuma.

Como ya tienes Traefik + TLS funcionando con n8n, en Fase 7 lo
enchufamos ahí en vez de instalar Nginx. Más simple, menos piezas.
