"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Watermark tileado sobre el área de mensajes.
 *
 * Convención fija del proyecto: `@username · YYYY-MM-DD HH:MM` (UTC).
 * El timestamp ayuda al forense si un screenshot se filtra — se puede
 * identificar al responsable y el minuto exacto.
 *
 * Implementación: SVG con texto rotado, convertido a data URL, usado
 * como background-image tileable. pointer-events: none para no
 * interferir con clicks.
 *
 * Intensidad (Fase 24): cuando el admin marca `can_share_externally =
 * false`, subimos la opacidad a 0.10 para que el watermark sea más
 * visible en pantalla — añade fricción visible a quien intente leak con
 * cámara externa. Default 0.05 sigue siendo "casi invisible en pantalla,
 * detectable en screenshots JPEG por compresión".
 */
export function Watermark({
  username,
  intense = false,
}: {
  username: string;
  intense?: boolean;
}) {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const label = useMemo(() => {
    const iso = now.toISOString();
    const stamp = `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
    return `@${username} · ${stamp}`;
  }, [now, username]);

  const dataUri = useMemo(() => {
    const safeLabel = label.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const opacity = intense ? "0.10" : "0.05";
    const svg = `
      <svg xmlns='http://www.w3.org/2000/svg' width='380' height='150'>
        <text x='0' y='75' fill='rgba(15,23,42,${opacity})'
              font-family='Inter, system-ui, sans-serif'
              font-size='13' font-weight='600' letter-spacing='0.02em'
              transform='rotate(-20 190 75)'>
          ${safeLabel}
        </text>
      </svg>
    `.trim();
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }, [label, intense]);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 bg-repeat"
      style={{ backgroundImage: `url("${dataUri}")` }}
      aria-hidden="true"
    />
  );
}
