"use client";

import { useEffect } from "react";

/**
 * Registra el service worker una vez montada la app.
 *
 * Nota: los navegadores solo registran SW en `https://` o `http://localhost`.
 * En staging con HTTP+IP no se registra — el usuario ve la app pero sin
 * cache offline. En Fase 7 con HTTPS (Traefik + Let's Encrypt) se activa
 * automáticamente sin cambios en el código.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const ctrl = new AbortController();
    (async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });
      } catch (err) {
        // Silencioso: no hay red, HTTP, o bloqueado por usuario.
        // eslint-disable-next-line no-console
        console.info("[pwa] service worker no registrado:", err);
      }
    })();
    return () => ctrl.abort();
  }, []);

  return null;
}
