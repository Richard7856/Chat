#!/usr/bin/env bash
#
# Euromex Chat — backup diario cifrado.
#
# Genera dos archivos:
#   - pg-<ISO>.dump.gpg      (pg_dump custom format + GPG AES-256)
#   - storage-<ISO>.tar.gpg  (tarball de adjuntos cifrados + GPG AES-256)
#
# Variables requeridas:
#   EUROMEX_BACKUP_PASSPHRASE   Passphrase fuerte para GPG symmetric.
#                                ¡GUÁRDALA EN TU PASSWORD MANAGER!
#
# Opcionales:
#   BACKUP_DIR       Directorio destino (default: /opt/euromex/backups)
#   KEEP_DAYS        Días a retener (default: 14)
#   REMOTE_RSYNC     "user@host:/ruta" — si se define, sube via rsync
#   EUROMEX_DIR      Path al repo (default: /opt/euromex)
#
# Uso manual:
#   EUROMEX_BACKUP_PASSPHRASE='xxx' /opt/euromex/infra/scripts/backup.sh
#
# Uso automático: via euromex-backup.timer (diariamente) leyendo
# /etc/euromex/backup.env
#

set -euo pipefail

EUROMEX_DIR="${EUROMEX_DIR:-/opt/euromex}"
BACKUP_DIR="${BACKUP_DIR:-$EUROMEX_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

if [[ -z "${EUROMEX_BACKUP_PASSPHRASE:-}" ]]; then
  echo "ERROR: falta EUROMEX_BACKUP_PASSPHRASE en el entorno." >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$EUROMEX_DIR/infra/.env"

mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +"%Y-%m-%dT%H-%M-%SZ")
PG_FILE="$BACKUP_DIR/pg-$STAMP.dump.gpg"
STORAGE_FILE="$BACKUP_DIR/storage-$STAMP.tar.gpg"

echo "[backup] Iniciando $STAMP"

# Postgres: custom format es más pequeño y permite pg_restore selectivo.
echo "[backup] Dumping Postgres → $PG_FILE"
docker exec euromex-postgres pg_dump \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom \
  | gpg --symmetric --cipher-algo AES256 --batch --yes \
        --passphrase "$EUROMEX_BACKUP_PASSPHRASE" \
        --output "$PG_FILE" -

# Storage (adjuntos cifrados). Tar + GPG.
if [[ -d "$EUROMEX_DIR/storage" ]]; then
  echo "[backup] Packing storage → $STORAGE_FILE"
  tar -cf - -C "$EUROMEX_DIR" storage \
    | gpg --symmetric --cipher-algo AES256 --batch --yes \
          --passphrase "$EUROMEX_BACKUP_PASSPHRASE" \
          --output "$STORAGE_FILE" -
else
  echo "[backup] Storage dir no existe aún — skip."
fi

# Rotación local
echo "[backup] Limpiando backups > $KEEP_DAYS días"
find "$BACKUP_DIR" -maxdepth 1 -name "*.gpg" -type f -mtime +"$KEEP_DAYS" -delete

# Sync remoto opcional
if [[ -n "${REMOTE_RSYNC:-}" ]]; then
  echo "[backup] Sync a remoto: $REMOTE_RSYNC"
  rsync -av --delete --include="*.gpg" --exclude="*" \
    "$BACKUP_DIR/" "$REMOTE_RSYNC/"
fi

echo "[backup] OK"
