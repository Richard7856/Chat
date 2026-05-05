#!/usr/bin/env bash
# Genera el keystore de release para firmar APK/AAB de Play Store.
#
# Solo correr UNA vez. Si pierdes el keystore, NO PUEDES publicar updates de
# la app en Play Store con el mismo bundle ID — Google te obligaría a empezar
# desde cero. Guarda copia en password manager + backup offline.
#
# Uso:
#   apps/mobile/scripts/generate-keystore.sh

set -euo pipefail

cd "$(dirname "$0")/.."

KEYSTORE_PATH="android/app/euromex-release.keystore"

if [[ -f "$KEYSTORE_PATH" ]]; then
  echo "✗ Ya existe un keystore en $KEYSTORE_PATH"
  echo "  Si REALMENTE quieres regenerarlo, bórralo manualmente primero."
  echo "  Esto invalidará todos los APK/AAB ya publicados."
  exit 1
fi

# Resolver JAVA_HOME desde Android Studio si no está set.
if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]]; then
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  fi
fi
KEYTOOL="${JAVA_HOME}/bin/keytool"
[[ -x "$KEYTOOL" ]] || KEYTOOL="keytool"

cat <<EOF

╔══════════════════════════════════════════════════════════════════════╗
║  Generación de keystore para Euromex Chat (release / Play Store)    ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  IMPORTANTE: lee con calma.                                          ║
║                                                                      ║
║  1. Te va a pedir DOS passwords (mínimo 6 chars cada uno):           ║
║     - Keystore password                                              ║
║     - Key password                                                   ║
║     RECOMENDADO: usa el MISMO password para ambos                    ║
║     (más simple y Play Store no nota la diferencia).                 ║
║                                                                      ║
║  2. Te va a pedir datos del propietario (nombre, organización,       ║
║     ciudad, etc.). Pon datos reales — Google los usa para verificar  ║
║     identidad si hay disputa.                                        ║
║                                                                      ║
║  3. AL FINAL: anota los passwords en tu password manager Y haz       ║
║     backup del archivo $KEYSTORE_PATH en un disco externo.           ║
║     Si pierdes cualquiera de los dos, no puedes publicar updates.    ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝

EOF

read -r -p "¿Listo para empezar? [y/N] " confirm
[[ "$confirm" =~ ^[yY]$ ]] || { echo "Cancelado."; exit 1; }

"$KEYTOOL" -genkey -v \
  -keystore "$KEYSTORE_PATH" \
  -alias euromex \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

cat <<EOF

✔ Keystore generado en: $KEYSTORE_PATH

Ahora exporta los passwords como env vars antes de buildear:

  export EUROMEX_KEYSTORE_PASSWORD='<tu password del keystore>'
  export EUROMEX_KEY_PASSWORD='<tu password del alias>'

Y luego:

  apps/mobile/scripts/build-aab.sh

⚠ Recuerda: el archivo $KEYSTORE_PATH ESTÁ EN .gitignore — no se commitea.
  Haz copia de seguridad MANUAL en disco externo / password manager.
EOF
