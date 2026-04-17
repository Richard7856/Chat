import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Apple touch icon. iOS aplica su propio redondeo a las esquinas, así que
 * nosotros renderizamos un cuadrado sólido (sin border-radius).
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #4f7cff 0%, #2d4fb3 100%)",
          color: "white",
          fontSize: 120,
          fontWeight: 800,
          letterSpacing: "-0.05em",
        }}
      >
        E
      </div>
    ),
    size,
  );
}
