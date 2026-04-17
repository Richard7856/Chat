import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon() {
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
          fontSize: 128,
          fontWeight: 800,
          letterSpacing: "-0.05em",
          borderRadius: "22%",
        }}
      >
        E
      </div>
    ),
    size,
  );
}
