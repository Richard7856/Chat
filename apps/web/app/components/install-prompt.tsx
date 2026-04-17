"use client";

import { useEffect, useState } from "react";

/**
 * Banner no intrusivo para sugerir "instalar app".
 *
 * - En Chrome/Edge (Android, desktop): captura el evento `beforeinstallprompt`
 *   y muestra un botón que dispara el diálogo nativo de instalación.
 * - En Safari iOS: no hay API programática; mostramos una nota pidiendo al
 *   usuario usar "Compartir → Añadir a pantalla de inicio".
 * - Se oculta permanentemente al cerrar (persiste en localStorage).
 */

const DISMISS_KEY = "euromex.pwa.dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [visible, setVisible] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Si ya corre como PWA instalada, no mostramos nada.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(standalone);
    if (standalone) return;

    // Si el usuario cerró el banner antes, no lo volvemos a mostrar.
    if (localStorage.getItem(DISMISS_KEY) === "1") return;

    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua);
    setIsIOS(ios);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS no dispara el evento, pero queremos mostrar la guía.
    if (ios) setVisible(true);

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  async function onInstall() {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    setVisible(false);
    if (outcome === "accepted") dismiss();
  }

  if (isStandalone || !visible) return null;

  return (
    <div className="pwa-banner" role="dialog" aria-label="Instalar Euromex Chat">
      <div className="pwa-banner-msg">
        {isIOS ? (
          <>
            <strong>Instala Euromex Chat:</strong> toca{" "}
            <span aria-hidden>⬆️</span> Compartir → <em>Añadir a pantalla de inicio</em>.
          </>
        ) : (
          <>
            <strong>Instala Euromex Chat</strong> para una experiencia más
            rápida y acceso directo desde tu pantalla principal.
          </>
        )}
      </div>
      <div className="pwa-banner-actions">
        {!isIOS && deferred && (
          <button type="button" className="pwa-install-btn" onClick={onInstall}>
            Instalar
          </button>
        )}
        <button type="button" className="pwa-dismiss-btn" onClick={dismiss}>
          ✕
        </button>
      </div>
    </div>
  );
}
