"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "euromex.security-banner.acked";

interface Props {
  conversationId: string;
}

/**
 * Banner informativo que aparece la primera vez que se abre una conversación.
 * Se cierra con "Entendido" y persiste en localStorage por-conversación.
 *
 * Convención del proyecto (fija para Fase 8+): visible una sola vez por
 * conversación por-dispositivo; si limpias localStorage vuelve a salir.
 */
export function SecurityBanner({ conversationId }: Props) {
  // Estado: hydrated=false en primer render (SSR/hidration), luego true con
  // el valor real de localStorage. Evita flash del banner en páginas nuevas.
  const [hydrated, setHydrated] = useState(false);
  const [acked, setAcked] = useState(true);

  useEffect(() => {
    setHydrated(true);
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<
        string,
        boolean
      >;
      setAcked(!!stored[conversationId]);
    } catch {
      setAcked(false);
    }
  }, [conversationId]);

  function dismiss() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<
        string,
        boolean
      >;
      stored[conversationId] = true;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {}
    setAcked(true);
  }

  if (!hydrated || acked) return null;

  return (
    <div className="sec-banner" role="note">
      <div className="sec-banner-text">
        🔒 Mensajes cifrados de extremo a extremo. Las capturas de pantalla
        no se pueden detectar — dependemos de la confianza entre miembros.
        Los archivos descargados quedan registrados en el chat.
      </div>
      <button type="button" className="sec-banner-close" onClick={dismiss}>
        Entendido
      </button>
    </div>
  );
}
