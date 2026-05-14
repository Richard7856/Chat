/**
 * Proceso principal de Electron — Euromex Chat Desktop (Fase D1).
 *
 * Estrategia: WebView que carga la PWA remota (https://euromex.xyz) igual
 * que el APK Android. La diferencia con un browser normal es lo que sigue:
 *
 * DLP que SÍ implementa esta fase:
 *   - setContentProtection(true) — screenshots y screen recording bloqueados
 *     a nivel OS (Quartz en macOS, DWM en Windows). Cubre Cmd+Shift+4,
 *     PrintScreen, y la mayoría de herramientas de captura estándar.
 *   - DevTools cerrados forzosamente en producción (incluso si alguien
 *     intenta F12 o abre vía menú). Solo abiertos en dev (app.isPackaged=false).
 *   - Menú contextual deshabilitado — sin "Save image as", sin "View source",
 *     sin "Inspect element".
 *   - Single instance lock — doble click del .exe enfoca la ventana
 *     existente en lugar de abrir una nueva.
 *   - External links (cualquier dominio fuera de euromex.xyz/api.euromex.xyz)
 *     abren en el browser del SO. No se pueden navegar a sitios externos
 *     dentro de la app por seguridad.
 *
 * DLP que NO está en D1 (fases siguientes del roadmap):
 *   - D2: control de descargas (session.on('will-download'))
 *   - D3: User-Agent custom + filtering server-side
 *   - D4: auto-update con electron-updater
 *   - D5: bundle estático del web (cierre del acceso por browser)
 *   - D6: code signing macOS + Windows
 *   - D7: detección de OBS/screen sharing, watermark, clipboard control
 *
 * Limitaciones aceptadas en D1:
 *   - Sin firma de código → macOS Gatekeeper y Windows SmartScreen mostrarán
 *     warnings al instalar. Aceptable para validación interna.
 *   - --remote-debugging-port pasado como flag al binario sigue funcionando.
 *     Mitigación parcial: requiere acceso local + admin. Resuelve en D6 con
 *     code signing + notarización (impide modificar el binario).
 *   - Cámara apuntando a pantalla — fuera del scope de software DLP.
 */
import { app, BrowserWindow, Menu, shell } from "electron";
import path from "node:path";

const REMOTE_URL = "https://euromex.xyz";
const ALLOWED_HOSTS = new Set(["euromex.xyz", "api.euromex.xyz"]);
// Whitelist de protocolos seguros para shell.openExternal. SIN ESTO un link
// malicioso (mensaje del chat con file:///etc/passwd o javascript:...) podría
// disparar shell.openExternal con URI peligrosa al click del usuario.
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const isDev = !app.isPackaged;

// En dev el icono se carga desde build/icon.png. En producción electron-builder
// embebe .icns (macOS) y .ico (Windows) en el bundle final, no se necesita aquí.
const ICON_PATH = path.join(__dirname, "..", "build", "icon.png");

// Single instance lock — DEBE ir antes de app.whenReady().
// Si una instancia ya está corriendo, salimos inmediatamente; el listener
// 'second-instance' enfoca la ventana existente.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Euromex Chat",
    icon: ICON_PATH,
    backgroundColor: "#0a0a0a",
    webPreferences: {
      // Aislamiento estricto. El renderer carga euromex.xyz como página web
      // normal — cero exposición de APIs de Node desde el preload.
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox=true en D2 cuando agreguemos preload para download policies.
      sandbox: false,
      devTools: isDev,
      // Bloquea webview tags embebidos por la página remota — vector de
      // escape sandbox conocido.
      webviewTag: false,
    },
    show: false,
  });

  // ── DLP: screenshots y screen recording bloqueados ──────────────────────
  mainWindow.setContentProtection(true);

  // ── DLP: DevTools cerrados forzosamente en producción ───────────────────
  // El listener se dispara aunque alguien fuerce DevTools por shortcut o
  // mediante webContents.openDevTools() inyectado.
  if (!isDev) {
    mainWindow.webContents.on("devtools-opened", () => {
      mainWindow?.webContents.closeDevTools();
    });
  }

  // ── DLP: deshabilitar menú contextual (right-click) ─────────────────────
  mainWindow.webContents.on("context-menu", (event) => {
    event.preventDefault();
  });

  // ── External links → browser del SO ─────────────────────────────────────
  // window.open() / target="_blank": validamos host. Si no es euromex.xyz,
  // abrir en el browser del usuario SOLO si el protocolo está en la whitelist
  // (http/https/mailto/tel). Cualquier otro (file:, javascript:, custom
  // schemes) se descarta — un mensaje del chat con un link malicioso no
  // debería poder abrir un archivo local del usuario.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (ALLOWED_HOSTS.has(target.hostname)) {
        return { action: "allow" };
      }
      if (ALLOWED_EXTERNAL_PROTOCOLS.has(target.protocol)) {
        void shell.openExternal(url);
      }
    } catch {
      // URL malformada — denegar silenciosamente
    }
    return { action: "deny" };
  });

  // Top-level navigation: si la página intenta navegar a otro dominio,
  // cancelar y delegar al browser del SO (con la misma whitelist de
  // protocolos). Evita que un link malicioso saque al usuario de la app
  // sin que se dé cuenta o cargue contenido local.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const target = new URL(url);
      if (ALLOWED_HOSTS.has(target.hostname)) return;
      event.preventDefault();
      if (ALLOWED_EXTERNAL_PROTOCOLS.has(target.protocol)) {
        void shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  void mainWindow.loadURL(REMOTE_URL);

  // Mostrar solo cuando haya cargado el contenido (evita flash blanco).
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Si euromex.xyz no responde (offline, DNS roto, etc.), Electron muestra
  // su error page nativa. En D5 podemos personalizarla cuando empaquetemos
  // el bundle estático del web.
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error(`[main] Failed to load ${REMOTE_URL}: ${errorCode} ${errorDescription}`);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

void app.whenReady().then(() => {
  // Quitar el menú default en producción — incluye File→DevTools, View→Reload,
  // que dan al usuario formas no obvias de bypassear DLP.
  if (!isDev) {
    Menu.setApplicationMenu(null);
  }

  createWindow();

  // En macOS, click en el dock con la app cerrada recrea la ventana.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // En macOS la convención es mantener el proceso vivo hasta Cmd+Q.
  // Windows/Linux: cerrar última ventana = quit.
  if (process.platform !== "darwin") app.quit();
});
