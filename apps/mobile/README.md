# @euromex/mobile — Wrapper Capacitor (Android, eventualmente iOS)

Esta carpeta contiene el wrapper nativo que empaqueta la PWA de Euromex
Chat como APK instalable. **No reescribe la app** — solo agrega un
WebView que carga la web de producción y ofrece capacidades que el
browser no expone, principalmente `FLAG_SECURE` para bloquear
screenshots a nivel OS.

> **Por qué Capacitor en lugar de TWA**: ver entrada 2026-05-01 de
> `desicion.md`. Resumen: TWA no permite `FLAG_SECURE` y el usuario
> requiere "control total" sobre quién puede tomar capturas.

---

## Pre-requisitos en la máquina del developer

1. **JDK 17** (Capacitor 6 + Android Gradle Plugin 8.x lo requiere).
   ```bash
   # Mac (con Homebrew)
   brew install --cask temurin@17
   /usr/libexec/java_home -V    # confirma que está instalado
   export JAVA_HOME=$(/usr/libexec/java_home -v 17)
   ```

2. **Android Studio** con Android SDK Platform 34 + Build Tools 34.0.0.
   ```
   # Open Android Studio → SDK Manager → instalar:
   # - Android SDK Platform 34
   # - Android SDK Build-Tools 34.0.0
   # - Android SDK Platform-Tools
   # - Android SDK Command-line Tools
   ```

3. **Variable de entorno** apuntando al SDK:
   ```bash
   export ANDROID_HOME=$HOME/Library/Android/sdk
   export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin
   ```

4. Desde la raíz del repo: `pnpm install` (instala las deps de
   `@euromex/mobile` igual que cualquier otro workspace).

---

## Setup inicial — UNA sola vez

Ya está `package.json` + `capacitor.config.ts` listos. Falta generar el
proyecto Android Studio (`android/`):

```bash
cd apps/mobile
pnpm cap:add:android
```

Esto crea `apps/mobile/android/` con un proyecto Gradle estándar de
Capacitor. **Comitear esa carpeta una vez** — son las customizaciones
nativas que vamos a editar (manifest, plugin de seguridad, recursos).

---

## Plugin nativo de seguridad (FLAG_SECURE)

Después de `cap add android`, agrega el plugin Kotlin que el bridge JS
(`apps/web/app/lib/native.ts`) consume.

### 1. Crear el archivo `SecurityPlugin.kt`

Path:
`apps/mobile/android/app/src/main/java/com/euromex/chat/security/SecurityPlugin.kt`

Contenido completo:

```kotlin
package com.euromex.chat.security

import android.view.WindowManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Plugin Capacitor que controla FLAG_SECURE en el Activity principal.
 *
 * Llamado desde el JS via window.Capacitor.Plugins.Security.setFlagSecure({ value: bool })
 *
 * Cuando value=true, Android bloquea:
 *  - Screenshots (sale negro o "captura no permitida por la app")
 *  - Screen recordings
 *  - Thumbnail del task switcher (Recents)
 *  - Mirroring inalámbrico
 *
 * Las operaciones de WindowManager DEBEN correr en el UI thread.
 */
@CapacitorPlugin(name = "Security")
class SecurityPlugin : Plugin() {

    @PluginMethod
    fun setFlagSecure(call: PluginCall) {
        val value = call.getBoolean("value", false) ?: false
        val activity = activity ?: run {
            call.reject("activity_unavailable")
            return
        }

        activity.runOnUiThread {
            val window = activity.window
            if (value) {
                window.setFlags(
                    WindowManager.LayoutParams.FLAG_SECURE,
                    WindowManager.LayoutParams.FLAG_SECURE,
                )
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            }
            val ret = JSObject()
            ret.put("value", value)
            call.resolve(ret)
        }
    }
}
```

### 2. Registrar el plugin en `MainActivity.kt`

Path:
`apps/mobile/android/app/src/main/java/com/euromex/chat/MainActivity.kt`

Reemplaza el contenido por:

```kotlin
package com.euromex.chat

import android.os.Bundle
import com.euromex.chat.security.SecurityPlugin
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Registra plugins ANTES de super.onCreate
        registerPlugin(SecurityPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
```

### 3. Sync para que Capacitor copie cambios al proyecto Android

```bash
pnpm cap:sync
```

---

## App icon y splash screen

El proyecto generado trae un placeholder feo de Capacitor. Para usar el
logo oficial:

1. Coloca un PNG cuadrado de 1024×1024 en `apps/mobile/icon.png`
   (idealmente con padding ~10%, fondo blanco o transparente).

2. Instala el plugin de assets de Capacitor:
   ```bash
   cd apps/mobile
   pnpm add -D @capacitor/assets
   pnpm exec capacitor-assets generate --android
   ```

3. Esto regenera `mipmap-*/ic_launcher.png` y splash screens en el
   proyecto Android. Comitea los cambios.

> El asset de splash y los iconos adaptativos se generan
> automáticamente. Si quieres tunearlos finamente, abre Android Studio.

---

## Desarrollo

Para correr el APK en un emulador o dispositivo conectado por USB:

```bash
cd apps/mobile
pnpm cap:open:android
# se abre Android Studio → click Run (Shift+F10)
```

El WebView va a cargar `https://chat.148-230-82-52.sslip.io` directo
(configurado en `capacitor.config.ts`). Cualquier cambio en `apps/web`
que ya esté deployado en el VPS se ve sin reconstruir el APK.

### Apuntar a un servidor local de desarrollo

Edita `capacitor.config.ts`:

```ts
server: {
  url: "http://192.168.1.X:3000",   // tu IP de la red local
  cleartext: true,                   // necesario para http://
  androidScheme: "http",
}
```

Luego `pnpm cap:sync` y vuelve a correr.

> **No olvides**: regresa la config a producción antes de buildear el
> APK final.

---

## Build de producción (APK / AAB)

### Generar keystore (una sola vez)

```bash
cd apps/mobile/android/app
keytool -genkey -v -keystore euromex-release.keystore \
  -alias euromex -keyalg RSA -keysize 2048 -validity 10000
```

Guarda la contraseña del keystore en un password manager — si la
pierdes NO puedes publicar updates en Play Store con el mismo bundle ID.
Tampoco subas `*.keystore` al repo (ya está en `.gitignore`).

### Configurar signing

Edita `apps/mobile/android/app/build.gradle` agregando:

```gradle
android {
    // ... existente

    signingConfigs {
        release {
            storeFile file("euromex-release.keystore")
            storePassword System.getenv("EUROMEX_KEYSTORE_PASSWORD")
            keyAlias "euromex"
            keyPassword System.getenv("EUROMEX_KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"
        }
    }
}
```

### Build

```bash
export EUROMEX_KEYSTORE_PASSWORD="..."
export EUROMEX_KEY_PASSWORD="..."

cd apps/mobile

# APK firmado para sideload (instala con `adb install`)
pnpm build:android
# → android/app/build/outputs/apk/release/app-release.apk

# AAB para Play Store
cd android && ./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```

---

## Cómo se conecta esto con permisos granulares (Fase 24)

El chat (`apps/web/app/app/chat/page.tsx`) llama:

```ts
import { applyShareExternallyPolicy } from "../../lib/native";
// ...
useEffect(() => {
  if (!me) return;
  void applyShareExternallyPolicy(
    me.user.permissions?.canShareExternally ?? false,
  );
}, [me]);
```

- Si el usuario corre la app web normal: el bridge detecta que NO está
  en native y la llamada es no-op. La fricción contra screenshots se
  reduce a la marca de agua intensa que ya existe.
- Si el usuario corre la app dentro del APK: el bridge encuentra el
  plugin "Security" inyectado por Capacitor y llama
  `setFlagSecure({ value: true })` cuando el admin tiene apagado
  `can_share_externally`. Android rechaza screenshots a nivel OS.

---

## Roadmap futuro de mobile

- **Fase 23b** (próximo sprint): Push notifications nativas via FCM
  (Firebase Cloud Messaging) — reemplaza el web push actual cuando
  corre dentro del APK. Mejora batería y entrega cuando la app está
  cerrada.
- **Fase 23c**: Native file pickers + downloads (usar `@capacitor/filesystem`).
- **Fase 23d**: iOS — requiere Apple Developer ($99/año). Detección
  de screen recording vía `UIScreen.captured` (no se puede bloquear,
  pero sí notificar al servidor para audit log).
- **Fase 23e**: Auto-update via Capacitor Live Updates / Capgo si
  queremos despachar fixes de JS sin pasar por Play Store.
