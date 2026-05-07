import { SecurityWatermark } from "../components/security-watermark";

/**
 * Layout que envuelve TODAS las rutas autenticadas (/app, /app/chat,
 * /app/admin, /app/calendar, etc.).
 *
 * Único propósito hoy: montar el SecurityWatermark global. Cada página sigue
 * encargándose de validar su propia sesión vía loadSession() — el layout
 * solo agrega el overlay visual.
 */
export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <SecurityWatermark />
    </>
  );
}
