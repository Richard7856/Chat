"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Watermark tileado sobre el área de mensajes.
 *
 * Convención del proyecto (fija para Fase 8+): formato
 *   `@username · YYYY-MM-DD HH:MM`
 * — el timestamp ayuda al forense si un screenshot se filtra.
 *
 * Implementación: SVG con el texto rotado, convertido a data URL, usado como
 * background-image repeatable. pointer-events: none para no bloquear clicks.
 * Opacity ~0.05: apenas visible en pantalla, claramente legible en
 * screenshots (donde se comprime/reduce y los píxeles se mezclan).
 */
export function Watermark({ username }: { username: string }) {
  // Se actualiza el timestamp cada minuto. En screenshots sucesivos de
  // la misma conversación, el minuto cambia — útil para tracking.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const label = useMemo(() => {
    const iso = now.toISOString();
    // YYYY-MM-DD HH:MM en UTC para evitar ambigüedad de zona horaria
    const stamp = `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
    return `@${username} · ${stamp}`;
  }, [now, username]);

  const dataUri = useMemo(() => {
    // Tile de 360x140 con el texto rotado ~-20°. Se repite horizontal y
    // verticalmente. Color blanco con alfa 0.05 sobre fondo oscuro del chat.
    const safeLabel = label.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const svg = `
      <svg xmlns='http://www.w3.org/2000/svg' width='360' height='140'>
        <text x='0' y='70' fill='rgba(230,236,255,0.05)'
              font-family='system-ui, -apple-system, sans-serif'
              font-size='14' font-weight='700'
              transform='rotate(-20 180 70)'>
          ${safeLabel}
        </text>
      </svg>
    `.trim();
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }, [label]);

  return (
    <div
      className="watermark"
      style={{ backgroundImage: `url("${dataUri}")` }}
      aria-hidden="true"
    />
  );
}
