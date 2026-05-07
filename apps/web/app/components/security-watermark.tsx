"use client";

import { useEffect, useMemo, useState } from "react";
import { loadSession } from "../lib/api";

/**
 * Watermark de seguridad GLOBAL — full-screen fixed overlay con username +
 * timestamp para identificar al responsable si un screenshot se filtra.
 *
 * Diferencia con `Watermark` (apps/web/app/components/watermark.tsx):
 *   - Aquel está positioned `absolute z-0` y vive solo dentro del área de
 *     mensajes. Cumple su propósito en el chat, pero no protege screenshots
 *     de admin, calendar, modales, settings, etc.
 *   - Este es `fixed inset-0 z-[9999]` y cubre TODA la app autenticada,
 *     incluyendo modales y dialogs (encima de todo, sin bloquear clicks
 *     gracias a pointer-events: none).
 *
 * Estrategia técnica idéntica al original: SVG con texto rotado convertido
 * a data URL, usado como `background-repeat` tileable. El timestamp se
 * actualiza cada minuto.
 *
 * Color gris medio (rgba(120,120,120,0.07)) para que funcione tanto en
 * fondo claro como oscuro — el del original usa dark slate que solo se ve
 * en fondo claro.
 */
export function SecurityWatermark() {
  const [username, setUsername] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const session = loadSession();
    if (!session) return;
    setUsername(session.user.username);

    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const dataUri = useMemo(() => {
    if (!username) return null;
    const iso = now.toISOString();
    const stamp = `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
    const label = `@${username} · ${stamp} UTC`;
    // Escape mínimo para SVG inline — username ya está validado contra el
    // regex de enrollment (solo a-z 0-9 _ -), pero mejor defensivo.
    const safeLabel = label.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const svg = `
      <svg xmlns='http://www.w3.org/2000/svg' width='420' height='180'>
        <text x='0' y='90' fill='rgba(120,120,120,0.07)'
              font-family='Inter, system-ui, sans-serif'
              font-size='13' font-weight='600' letter-spacing='0.02em'
              transform='rotate(-20 210 90)'>
          ${safeLabel}
        </text>
      </svg>
    `.trim();
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }, [now, username]);

  if (!dataUri) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[9999] bg-repeat"
      style={{ backgroundImage: `url("${dataUri}")` }}
    />
  );
}
