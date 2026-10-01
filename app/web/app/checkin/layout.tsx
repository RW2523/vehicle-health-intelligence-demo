import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "QR check-in · VehicleSense Mobile" };

// a public page of the mobile app, opened on a phone from a QR code: edge to edge (the shell pads with the safe areas)
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#F4F7FC" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
