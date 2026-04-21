import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { InstallPrompt } from "./components/install-prompt";
import { PwaRegister } from "./components/pwa-register";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Euromex Chat",
    template: "%s — Euromex Chat",
  },
  description: "Chat interno privado de Grupo Euromex — cifrado de extremo a extremo.",
  applicationName: "Euromex Chat",
  appleWebApp: {
    capable: true,
    title: "Euromex",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0e1a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="font-sans min-h-screen bg-background text-foreground">
        {children}
        <InstallPrompt />
        <PwaRegister />
      </body>
    </html>
  );
}
