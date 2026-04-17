#!/usr/bin/env bash
#
# Euromex Chat — restore desde backup cifrado.
#
# Uso:
#   EUROMEX_BACKUP_PASSPHRASE='xxx' \
#     /opt/euromex/infra/scripts/restore.sh <pg-backup.dump.gpg> [storage-backup.tar.gpg]
#
# PELIGRO: esto BORRA el contenido actual de la DB y del directorio de
# adjuntos. Solo úsalo para recuperación ante desastre, no para "probar".
#

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Uso: $0 <pg-backup.dump.gpg> [storage-backup.tar.gpg]" >&2
  exit 1
fi

PG_BACKUP="$1"
STORAGE_BACKUP="${2:-}"
EUROMEX_DIR="${EUROMEX_DIR:-/opt/euromex}"

if [[ -z "${EUROMEX_BACKUP_PASSPHRASE:-}" ]]; then
  echo "ERROR: falta EUROMEX_BACKUP_PASSPHRASE en el entorno." >&2
  exit 1
fi

if [[ ! -f "$PG_BACKUP" ]]; then
  echo "ERROR: no existe $PG_BACKUP" >&2
  exit 1
fi

# Confirmación explícita
echo
echo "ATENCIÓN: vas a sobreescribir la DB y el storage en $EUROMEX_DIR"
echo "  pg_dump:  $PG_BACKUP"
echo "  storage:  ${STORAGE_BACKUP:-(no)}"
read -r -p "Escribe 'RESTORE' para confirmar: " confirm
[[ "$confirm" == "RESTORE" ]] || { echo "Abortado."; exit 1; }

# shellcheck disable=SC1091
source "$EUROMEX_DIR/infra/.env"

# Postgres
echo "[restore] DROP + CREATE de la DB $POSTGRES_DB"
docker exec euromex-postgres psql -U "$POSTGRES_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS $POSTGRES_DB;" \
  -c "CREATE DATABASE $POSTGRES_DB OWNER $POSTGRES_USER;"

echo "[restore] Cargando dump"
gpg --decrypt --batch --yes --passphrase "$EUROMEX_BACKUP_PASSPHRASE" "$PG_BACKUP" \
  | docker exec -i euromex-postgres pg_restore \
      -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner

# Storage
if [[ -n "$STORAGE_BACKUP" ]]; then
  if [[ ! -f "$STORAGE_BACKUP" ]]; then
    echo "WARN: storage backup no existe, salto."
  else
    echo "[restore] Limpiando storage actual"
    rm -rf "$EUROMEX_DIR/storage"/*
    echo "[restore] Extrayendo storage"
    gpg --decrypt --batch --yes \
      --passphrase "$EUROMEX_BACKUP_PASSPHRASE" "$STORAGE_BACKUP" \
      | tar -xf - -C "$EUROMEX_DIR"
  fi
fi

echo "[restore] OK. Reinicia los servicios:"
echo "  systemctl restart euromex-api euromex-web"
