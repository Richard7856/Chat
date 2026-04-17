# Deploy en VPS de Hostinger

Guía paso a paso para poner Euromex Chat en tu VPS de Hostinger **en modo
staging** (HTTP directo por IP, sin dominio). Cuando tengas dominio listo,
la Fase 7 del plan añadirá Nginx + HTTPS con Let's Encrypt.

No necesito acceso a tu VPS. Tú ejecutas los comandos por SSH y me cuentas
si algo falla.

> **Importante:** este documento te sirve tanto para la primera vez como
> para actualizar a nuevas versiones. Busca la sección "Actualizar a nueva
> versión" al final.

---

## 0. Pre-requisitos del VPS

Asegúrate en Hostinger (panel hPanel → VPS):

1. **Sistema operativo:** Ubuntu 22.04 LTS o 24.04 LTS (si es otro, avísame).
2. **Acceso SSH:** que tengas el usuario root o un sudoer, y la clave SSH
   o contraseña configurada.
3. **Firewall:** abre temporalmente los puertos **3000** (web) y **4000**
   (API). Panel hPanel → VPS → Firewall → añadir reglas TCP entrantes.
   (En producción cerraremos estos y dejaremos solo 80/443 detrás de
   Nginx, pero para staging queremos verlos directo.)

---

## 1. Conéctate por SSH

Desde tu equipo local:

```bash
ssh root@TU_IP_DEL_VPS
```

Reemplaza `TU_IP_DEL_VPS` por la IP que Hostinger te dio (aparece en hPanel).

---

## 2. Instala las dependencias del sistema

Copia y pega este bloque completo. Lo probé para Ubuntu 22.04/24.04.

```bash
# Actualiza paquetes
apt update && apt upgrade -y

# Utilidades básicas
apt install -y curl git ufw build-essential ca-certificates gnupg

# Node.js 22 (vía NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node --version   # debe imprimir v22.x.x

# pnpm 10
npm install -g pnpm@10
pnpm --version   # debe imprimir 10.x.x

# Docker + plugin compose
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
  > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker --version
docker compose version

# Firewall básico (opcional pero recomendado)
ufw allow OpenSSH
ufw allow 3000/tcp
ufw allow 4000/tcp
ufw --force enable
```

---

## 3. Clona el repo en el VPS

```bash
mkdir -p /opt/euromex && cd /opt/euromex
git clone https://github.com/richard7856/chat.git .
git checkout claude/private-chat-mac-auth-e9QYn
```

Si el repo es privado, configura una SSH key de deploy o usa un Personal
Access Token en la URL (`https://USER:TOKEN@github.com/...`).

---

## 4. Genera los secretos y crea los `.env`

```bash
cd /opt/euromex

# Secretos aleatorios
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

Ahora crea los archivos `.env`:

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
CORS_ORIGINS=http://TU_IP_DEL_VPS:3000
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
pnpm rebuild argon2      # compila bindings nativos para tu CPU
pnpm build               # compila API + web
```

El `build` tarda 1–2 minutos.

---

## 6. Arranca Postgres + Redis

```bash
cd /opt/euromex
pnpm infra:up
docker compose -f infra/docker-compose.yml ps   # ambos "healthy" en ~10s
```

El schema SQL se carga automáticamente en el primer arranque.

---

## 7. Crea el primer admin

```bash
cd /opt/euromex/apps/api
ADMIN_USERNAME=richard \
  ADMIN_PASSWORD='UnaContraseñaLargaYSegura!' \
  ADMIN_DISPLAY='Richard' \
  pnpm run create-admin
```

El script imprime un **QR data URL** y un **otpauth URI**. Copia el URI
(línea que empieza con `otpauth://totp/...`), pégalo en un navegador con
un generador de QR (o usa una app que acepte URI directamente como Aegis),
y escanéalo con tu app autenticadora (Google Authenticator, Aegis, 1Password).

Guarda también la semilla base32 en tu gestor de contraseñas por si pierdes
el teléfono.

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

## 9. Verifica que todo funciona

Desde tu equipo local (o el navegador):

```bash
curl http://TU_IP_DEL_VPS:4000/health
```

Deberías ver:
```json
{"status":"ok","service":"euromex-api","version":"0.2.0",...,"deps":{"postgres":"up","redis":"up"}}
```

Luego abre en el navegador:
- http://TU_IP_DEL_VPS:3000 — landing
- http://TU_IP_DEL_VPS:3000/login — inicia sesión con tu usuario admin
- http://TU_IP_DEL_VPS:3000/app — panel con "Crear código de invitación"

Emite un código, compártelo con un compañero, y que entre por
`/enroll?code=XXXX-XXXX-XXXX-XXXX`.

---

## Actualizar a nueva versión

Cuando yo pushee cambios a la branch:

```bash
cd /opt/euromex

# Detén servicios
kill $(cat /var/run/euromex-api.pid) 2>/dev/null
kill $(cat /var/run/euromex-web.pid) 2>/dev/null

# Trae cambios
git fetch origin
git checkout claude/private-chat-mac-auth-e9QYn
git pull

# Reinstala deps y recompila
pnpm install
pnpm rebuild argon2
pnpm build

# Si hay cambios de schema SQL: recrea contenedores
#   (¡borra la DB local! Solo hazlo en staging)
# pnpm infra:down && rm -rf infra/volumes/postgres && pnpm infra:up

# Relanza servicios
nohup node apps/api/dist/server.js > /var/log/euromex-api.log 2>&1 &
echo $! > /var/run/euromex-api.pid
cd apps/web
nohup pnpm start > /var/log/euromex-web.log 2>&1 &
echo $! > /var/run/euromex-web.pid
```

---

## Troubleshooting

- **`curl /health` falla:** revisa `tail -f /var/log/euromex-api.log`. Los
  errores de conexión a DB indican que los `.env` tienen mal la contraseña
  o que los contenedores no están arriba (`docker compose ps`).
- **Web no carga:** `tail -f /var/log/euromex-web.log`. Firewall UFW
  puede estar bloqueando (`ufw status`).
- **`argon2` falla al iniciar:** ejecuta `pnpm rebuild argon2` dentro del
  repo.
- **TOTP inválido al loguear:** verifica que la hora del VPS es correcta
  (`timedatectl`). `systemctl enable --now systemd-timesyncd` si desfasa.
- **Olvidé el QR del admin:** corre de nuevo `create-admin` con un usuario
  nuevo, y elimina el anterior con SQL (`psql` adjunto al contenedor).

## Qué falta (Fase 7, cuando tengas dominio)

- Apuntar dominio Euromex al VPS (A record → IP).
- Nginx como reverse proxy en 443 con HSTS y CSP.
- Let's Encrypt (certbot) para HTTPS automático.
- `systemd` units para API y web.
- Backups programados de `infra/volumes/postgres`.
- Monitoreo (uptime-kuma o Grafana Loki).
