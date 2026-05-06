# Publicación: Play Store + App Store

Guía paso a paso para subir Euromex Chat a las dos tiendas. Este documento
asume que ya buildaste el APK debug exitosamente (ver `README.md`) y que
quieres pasar a producción.

---

## ⚙️ Pre-requisitos administrativos (haz esto antes de empezar)

| Tienda | Costo | Tiempo de aprobación cuenta | Necesitas |
|---|---|---|---|
| **Google Play** | $25 USD una sola vez | Pago inmediato, verificación 1-2 días | Email + tarjeta |
| **Apple App Store** | $99 USD/año | 1-2 días hábiles | Apple ID + tarjeta + (organización: D-U-N-S number) |

> Para Apple, si vas a publicar como **organización** (Grupo Euromex S.A.) en
> vez de individual, necesitas **D-U-N-S Number** — gratis, ~5-15 días hábiles
> para que Dun & Bradstreet lo emita. Sin D-U-N-S puedes publicar como
> individual (tu nombre legal aparece en la ficha App Store).

---

# 📱 PARTE A — Google Play Store (Android)

## A.1 Crear cuenta de Google Play Console

1. Ve a https://play.google.com/console
2. Inicia sesión con la Google account que quieres usar como **dueña** de la
   app. **Importante**: este email es del developer, no del usuario final.
   Si te lo registras con `richard@gmail.com`, todos los emails de Play Store
   te llegan ahí.
3. Acepta el contrato de developer + paga los $25 USD (tarjeta).
4. Llena el "Identity verification" (Google revisa documento de identidad).
   Esperar 1-2 días para aprobación.

## A.2 Crear la app en Play Console

1. Play Console → "Create app"
2. Datos:
   - **App name**: Euromex Chat
   - **Default language**: Spanish (Mexico) — es-MX
   - **App or game**: App
   - **Free or paid**: Free
   - **Declaration**: marca las casillas (políticas de Google + COPPA + ads)
3. **Set up your app** (sección):
   - Privacy policy URL: tendrás que publicar una. **Sugerencia**: hostea un
     `privacy.html` en tu propio dominio (`https://euromex.xyz/privacy`)
     con el texto mínimo: qué datos recolectas (mínimos por E2EE), cómo los
     usas (solo para ofrecer el servicio), retención (mientras la cuenta
     esté activa), contacto (email del admin).
   - Ads: No
   - App access: "All functionality is available without restrictions"
     ⚠ Si tu app requiere login (la nuestra sí), debes proveer **credenciales
     de prueba** a Google. Crea un usuario `googlereview@euromex.com.mx`
     con password fijo y dáselo a Google en este campo.
   - Content rating: completa el cuestionario (todo "no" para tu uso interno)
   - Target audience: 18+
   - News app: No
   - COVID-19 contact tracing: No
   - Data safety: declara qué datos colectas (mensajes E2EE, email,
     dispositivo, IP). Marca "Data is encrypted in transit" + "Data is
     encrypted at rest" + "Data cannot be deleted by users" si aplica.
   - Government apps: No (esto es app interna privada)

## A.3 Generar el keystore de release (UNA SOLA VEZ)

```bash
cd apps/mobile
./scripts/generate-keystore.sh
```

El script te guía interactivamente. Te pedirá:
- Password del keystore (mínimo 6 chars)
- Password del alias (recomendado: igual al anterior)
- Datos del propietario (nombre real, organización, ciudad, país)

Al terminar tendrás `apps/mobile/android/app/euromex-release.keystore`
**que NO se commitea** (está en `.gitignore`). Hazle backup MANUAL:

```bash
# Backup recomendado: copia a disco externo + password manager
cp apps/mobile/android/app/euromex-release.keystore ~/Documents/SECURE/
```

> 🔥 **Crítico**: si pierdes este archivo o los passwords, **no puedes
> publicar updates** de la app en Play Store con el mismo bundle ID. Google
> tiene un proceso de "key reset" pero es lento (1-2 semanas) y solo si
> habilitaste Play App Signing.

## A.4 Build AAB de release

```bash
export EUROMEX_KEYSTORE_PASSWORD='<el password que escogiste>'
export EUROMEX_KEY_PASSWORD='<igual al anterior si así lo configuraste>'
./scripts/build-aab.sh
```

Output: `apps/mobile/dist/euromex-chat-release.aab` (~5 MB)

## A.5 Subir el AAB a Play Console

1. Play Console → tu app → "Release" → "Production" (o "Internal testing"
   primero, recomendado para validar)
2. Click "Create new release"
3. **Play App Signing**: aceptarlo. Google maneja un keystore separado y
   firma builds finales. Tu keystore actual se vuelve "upload key" (sigue
   siendo crítico no perderlo, pero Google es backup).
4. Drag & drop `euromex-chat-release.aab`
5. **Release name**: `1.0 (1)` (autogenerado)
6. **Release notes**: "Versión inicial Euromex Chat"
7. Click "Save" → "Review release" → "Start rollout to Production"

## A.6 Esperar revisión

- **Internal testing**: 0-2 horas, listo para descargar via link privado
- **Production**: 2-7 días primera vez (Google revisa contenido). Updates
  futuros: 2-24h.

Mientras esperas, prepara el resto de la **store listing**:
- Short description (80 chars): "Chat interno cifrado de Grupo Euromex"
- Full description (4000 chars): explica funciones (E2EE, multi-device,
  tareas, calendario, etc.) — sin mencionar nombres de competidores ni
  hacer afirmaciones técnicas exageradas (Google rechaza claims tipo
  "100% seguro").
- App icon: 512x512 PNG (puedes regenerar desde `assets/icon.png` con
  `pnpm exec capacitor-assets generate --android`)
- Feature graphic: 1024x500 PNG (banner de la ficha)
- Phone screenshots: mínimo 2, máximo 8. Toma con `adb screenshot` o desde
  el emulador.

---

# 🍎 PARTE B — Apple App Store (iOS)

## B.1 Pre-requisito: configurar Xcode

```bash
# 1. Abre Xcode.app al menos una vez. Va a descargar componentes adicionales
#    (~3 GB primera vez). Acepta la licencia cuando aparezca.

# 2. Apunta xcode-select a Xcode.app (en vez de Command Line Tools):
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer

# 3. Acepta la licencia desde CLI:
sudo xcodebuild -license accept

# 4. Verifica:
xcrun --find xcodebuild   # debería imprimir un path dentro de Xcode.app
```

## B.2 Pre-requisito: CocoaPods

Ya está instalado (vía `brew install cocoapods`). Verifica:

```bash
pod --version    # debería imprimir 1.16.x o mayor
```

## B.3 Generar / regenerar el proyecto Xcode

```bash
cd apps/mobile

# Si no existe ios/ todavía:
pnpm cap add ios

# Si ya existe, sincronizar cambios web → iOS:
pnpm cap sync ios
```

## B.4 Configurar el plugin de seguridad iOS

Los archivos ya están commiteados en:
- `ios/App/App/Security/SecurityPlugin.swift`
- `ios/App/App/Security/SecurityPlugin.m`

Pero Xcode no los ve hasta que los agregues al target:

1. Abre el proyecto: `pnpm cap open ios` (lanza Xcode)
2. En el Navigator izquierdo: click derecho sobre la carpeta `App` → "Add
   Files to 'App'…"
3. Selecciona `ios/App/App/Security/` (la carpeta entera)
4. Asegúrate que esté marcado:
   - ☑ Copy items if needed: **NO** (ya están en el lugar correcto)
   - ☑ Create groups
   - ☑ Add to target: App
5. Click "Add"

> 🚨 **Diferencia con Android**: en iOS NO existe `FLAG_SECURE`. El plugin
> Swift solo puede:
> - **Detectar** screenshots (post-factum) y notificar al backend para audit log
> - **Bloquear screen recording** mostrando overlay negro mientras se graba
> Es una limitación de Apple, no de nuestra implementación. El bridge JS
> (`apps/web/app/lib/native.ts`) reporta esto via `platformLimitations` en
> la respuesta de `setFlagSecure`.

## B.5 Apple Developer Account

1. Ve a https://developer.apple.com/programs/enroll/
2. Inicia sesión con Apple ID (o crea uno).
3. Selecciona **Individual** o **Organization**:
   - Individual: $99/año, aparece tu nombre legal en la ficha App Store.
   - Organization: $99/año, aparece "Grupo Euromex S.A." pero requiere
     **D-U-N-S Number** (gratis, ~5-15 días hábiles, https://developer.apple.com/support/D-U-N-S/).
4. Paga, espera aprobación (1-2 días).

## B.6 Crear App ID + provisioning

1. Ve a https://developer.apple.com/account/resources/identifiers/list
2. "+" → App IDs → "App"
3. **Bundle ID**: `com.grupoeuromex.chat` (debe coincidir EXACTO con
   `capacitor.config.ts:appId`)
4. **Capabilities**: marca solo lo que uses. Por ahora ninguno especial.
5. "Continue" → "Register"

## B.7 Configurar signing en Xcode

1. `pnpm cap open ios` → Xcode abre el workspace
2. Click sobre el proyecto "App" en el Navigator
3. Tab "Signing & Capabilities":
   - **Team**: tu cuenta Apple Developer (debería aparecer en el dropdown)
   - **Bundle Identifier**: `com.grupoeuromex.chat`
   - ☑ "Automatically manage signing"
   - Xcode genera el provisioning profile y certificados solo
4. Tab "General":
   - **Display Name**: Euromex Chat
   - **Version**: 1.0
   - **Build**: 1

## B.8 Probar en device físico

1. Conecta tu iPhone con cable USB
2. En Xcode, arriba seleccona tu iPhone como destination (no Simulator)
3. Cmd+R para compilar e instalar

**Primera vez**: el iPhone va a decir "Untrusted Developer". Ve a
**Settings → General → VPN & Device Management → Developer App** → confía
tu cuenta. Reabre la app.

## B.9 Archive + subir a App Store Connect

1. En Xcode, top bar: cambia destination a "Any iOS Device (arm64)"
2. Menú **Product → Archive** (compila release; tarda 3-5 min)
3. Cuando termina, abre la **Organizer** automáticamente
4. Selecciona el archive recién creado → "Distribute App"
5. Método: **App Store Connect**
6. Destination: **Upload**
7. Opciones: deja todo default (incluyendo "Manage Version and Build Number")
8. Sign con tu Apple ID
9. Click "Upload" → espera 5-10 min (Apple procesa el binary)

## B.10 Configurar la ficha en App Store Connect

1. Ve a https://appstoreconnect.apple.com
2. **My Apps** → "+" → New App
3. Datos:
   - Platform: iOS
   - Name: Euromex Chat
   - Primary language: Spanish (Mexico)
   - Bundle ID: com.grupoeuromex.chat (debe aparecer en el dropdown)
   - SKU: `euromex-chat-mx-1` (cualquier identificador único interno)
4. Una vez creada, llena:
   - **App Information**: categoría (Business), copyright (© 2026 Grupo Euromex)
   - **Pricing and Availability**: Free, available worldwide (o restringe a México)
   - **App Privacy**: similar a Play Store, declara qué datos colectas
   - **Version 1.0**:
     - Screenshots: **mínimo 3** para iPhone 6.7" + 6.5" + 5.5". Genera con
       Xcode Simulator (`Window → Capture Screenshot`) en cada tamaño.
     - Description, keywords, support URL, marketing URL
     - **App Review Information**: credenciales de prueba (igual que Play
       Store, crea un user de demo con password fijo)
     - Build: selecciona el archive que subiste en B.9

## B.11 Submit for Review

1. En la ficha de la app → "Submit for Review"
2. Apple responde en **24-48 horas** la primera vez (a veces 2-7 días).
3. Si rechaza: te dan razones específicas. Las más comunes con apps
   tipo chat:
   - "No support URL" → agrega un email/web de soporte
   - "Demo account doesn't work" → re-verifica las credenciales de prueba
   - "Privacy policy missing or unclear" → publica una privacy policy
     más detallada (puedes reusar la de Android)

---

# 🔄 Updates futuros

Una vez que ambas tiendas tengan tu v1.0 aprobada:

## Para subir una nueva versión (ej. 1.1)

1. **Edita versión** en `apps/mobile/android/app/build.gradle`:
   ```
   versionCode 2     // incrementa siempre +1
   versionName "1.1"
   ```
2. Y en Xcode: General → Version "1.1" + Build "2"
3. **Android**: `./scripts/build-aab.sh` → sube a Play Console (Production
   o Internal testing)
4. **iOS**: Product → Archive → Distribute App → App Store Connect Upload
5. En cada tienda, llena release notes + submit for review

## Comportamiento esperado

- **Play Store**: rollout puede ser **gradual** (5% → 20% → 50% → 100% por
  días). Si detectas crash spike, puedes pausar el rollout.
- **App Store**: rollout es **all-or-nothing** (todos los users con
  auto-update activado lo bajan al pasar review).

---

# ⚠ Checklist antes de cada release

- [ ] `pnpm typecheck` en raíz pasa
- [ ] `apps/mobile/android/app/build.gradle`: `versionCode` incrementado
- [ ] `apps/mobile/ios/App/App/Info.plist`: `CFBundleShortVersionString` actualizado
- [ ] `pnpm exec capacitor-assets generate` si cambió el logo
- [ ] APK debug instala correctamente en tu cel: `adb install -r app-debug.apk`
- [ ] Smoke test: login → mandar mensaje → recibir mensaje → editar → borrar
- [ ] FLAG_SECURE bloqueando screenshots cuando admin baja `can_share_externally`
- [ ] Backfill multi-device funcionando (los mensajes viejos aparecen tras login)
