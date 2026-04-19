#!/usr/bin/env bash
#
# Euromex Chat — instala los units de systemd.
#
# Qué hace:
#   1. Copia los .service y .timer a /etc/systemd/system/
#   2. `systemctl daemon-reload`
#   3. Habilita y arranca euromex-api y euromex-web
#   4. Habilita el timer de backup (solo si /etc/euromex/backup.env existe)
#
# No es destructivo: si los servicios ya están corriendo, los reinicia.
#
# Uso:
#   sudo bash /opt/euromex/infra/scripts/install-systemd.sh
#

set -euo pipefail

EUROMEX_DIR="${EUROMEX_DIR:-/opt/euromex}"
SRC="$EUROMEX_DIR/infra/systemd"
DST=/etc/systemd/system

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: ejecuta con sudo/root." >&2
  exit 1
fi

echo "[install] Copiando units a $DST"
install -m 644 "$SRC/euromex-api.service"    "$DST/euromex-api.service"
install -m 644 "$SRC/euromex-web.service"    "$DST/euromex-web.service"
install -m 644 "$SRC/euromex-backup.service" "$DST/euromex-backup.service"
install -m 644 "$SRC/euromex-backup.timer"   "$DST/euromex-backup.timer"

echo "[install] daemon-reload"
systemctl daemon-reload

# Si ya había procesos corriendo con nohup, mátalos para evitar EADDRINUSE
# cuando systemd intente bindar los mismos puertos.
echo "[install] Matando procesos nohup previos (si existen) para liberar puertos"
pkill -9 -f '/opt/euromex/apps/api/src/server.ts' 2>/dev/null || true
pkill -9 -f '/opt/euromex/apps/web/node_modules/.bin/next' 2>/dev/null || true
pkill -9 -f 'next-server' 2>/dev/null || true
sleep 2

echo "[install] Habilitando + arrancando euromex-api, euromex-web"
systemctl enable --now euromex-api.service
systemctl enable --now euromex-web.service

if [[ -f /etc/euromex/backup.env ]]; then
  echo "[install] /etc/euromex/backup.env encontrado — habilitando timer de backup"
  systemctl enable --now euromex-backup.timer
else
  echo "[install] /etc/euromex/backup.env NO existe — backup timer no se habilita."
  echo "          Crea ese archivo con EUROMEX_BACKUP_PASSPHRASE=xxx y re-ejecuta."
fi

echo
echo "[install] Listo. Estado:"
systemctl --no-pager status euromex-api.service | head -12 || true
echo
systemctl --no-pager status euromex-web.service | head -12 || true
echo
echo "Logs en vivo:  journalctl -u euromex-api -f"
echo "              journalctl -u euromex-web -f"
