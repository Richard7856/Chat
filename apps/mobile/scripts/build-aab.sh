#!/usr/bin/env bash
# Build de release para Play Store: genera el .aab firmado.
#
# Pre-requisitos:
#   1. apps/mobile/scripts/generate-keystore.sh ejecutado una vez
#   2. Variables de entorno set:
#      - EUROMEX_KEYSTORE_PASSWORD
#      - EUROMEX_KEY_PASSWORD
#   3. JDK 17+ (Android Studio bundle funciona)
#   4. Android SDK 34
#
# Output: apps/mobile/dist/euromex-chat-release.aab

set -euo pipefail

cd "$(dirname "$0")/.."

# Validar env vars
if [[ -z "${EUROMEX_KEYSTORE_PASSWORD:-}" || -z "${EUROMEX_KEY_PASSWORD:-}" ]]; then
  cat <<EOF
✗ Faltan variables de entorno para firmar el AAB.

Exporta antes de correr este script:

  export EUROMEX_KEYSTORE_PASSWORD='<password del keystore>'
  export EUROMEX_KEY_PASSWORD='<password del alias>'

Si todavía no tienes el keystore, corre primero:

  apps/mobile/scripts/generate-keystore.sh
EOF
  exit 1
fi

# Configurar JAVA_HOME y ANDROID_HOME desde defaults Mac.
if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]]; then
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  fi
fi
if [[ -z "${ANDROID_HOME:-}" ]]; then
  if [[ -d "$HOME/Library/Android/sdk" ]]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
  fi
fi

KEYSTORE_PATH="android/app/euromex-release.keystore"
if [[ ! -f "$KEYSTORE_PATH" ]]; then
  echo "✗ No existe el keystore en $KEYSTORE_PATH"
  echo "  Corre apps/mobile/scripts/generate-keystore.sh primero."
  exit 1
fi

echo "→ Sincronizando Capacitor..."
pnpm cap:sync

echo "→ Build AAB de release..."
cd android
./gradlew bundleRelease

OUT_AAB="app/build/outputs/bundle/release/app-release.aab"
if [[ ! -f "$OUT_AAB" ]]; then
  echo "✗ Build falló: no se encontró $OUT_AAB"
  exit 1
fi

cd ..
mkdir -p dist
DEST="dist/euromex-chat-release.aab"
cp "android/$OUT_AAB" "$DEST"

cat <<EOF

✔ AAB firmado y listo: $(pwd)/$DEST

Tamaño: $(du -h "$DEST" | cut -f1)
SHA-256: $(shasum -a 256 "$DEST" | cut -d' ' -f1)

Próximo paso: súbelo a Google Play Console.
Ver guía completa en apps/mobile/PUBLISHING.md.
EOF
