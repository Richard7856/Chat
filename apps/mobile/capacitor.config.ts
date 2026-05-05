import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Configuración del wrapper nativo Capacitor.
 *
 * Estrategia: el APK es un "shell" delgado que carga la PWA de producción
 * dentro de un WebView. Eso significa que el JS/CSS/HTML siguen viviendo en
 * `apps/web` y se actualizan en cada deploy del web sin tener que publicar
 * un APK nuevo. Lo único realmente nativo del APK son:
 *
 * 1. Capacidades del dispositivo que el browser no expone (FLAG_SECURE para
 *    bloquear screenshots a nivel OS — el motivo principal por el que
 *    pasamos a Capacitor sobre TWA).
 * 2. App icon, splash screen y comportamiento de status bar consistentes
 *    con una app instalada.
 *
 * Cambia `server.url` si quieres apuntar a un staging o al dev local
 * (con tu IP real, no 127.0.0.1, porque el WebView corre en el dispositivo).
 */
const config: CapacitorConfig = {
  appId: "com.grupoeuromex.chat",
  appName: "Euromex Chat",
  // webDir requerido por Capacitor aunque carguemos remoto. Es solo
  // un placeholder con un index.html mínimo por si la carga remota falla.
  webDir: "public",
  server: {
    // El WebView carga directamente la web de producción. Cuando el
    // usuario navega dentro de la app, sigue siendo todo el mismo
    // origin → cookies / localStorage / IndexedDB persisten igual que
    // en un browser normal.
    url: "https://chat.148-230-82-52.sslip.io",
    cleartext: false,
    androidScheme: "https",
  },
  android: {
    // Esto solo afecta al diálogo de "permitir conexión" inicial; con
    // url configurado arriba en https no necesitamos cleartext.
    allowMixedContent: false,
  },
};

export default config;
