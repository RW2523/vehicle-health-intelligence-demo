import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "VehicleSense Mobile",
  description: "The vehicle owner's app: health passport, guided self-check, booking and the assistant.",
};

// edge to edge on phones with a notch or a home indicator (the shell pads with the safe areas)
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#F4F7FC" };

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
