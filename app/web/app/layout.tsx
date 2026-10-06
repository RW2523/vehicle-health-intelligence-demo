import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import { Toaster } from "@/components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "VehicleSense Inspection",
  description: "AI-assisted vehicle inspection concept demo: lane, examiner, reports, fleet, HQ, regulator and owner apps.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Inter and IBM Plex Mono are bundled with the app, so the UI looks the same offline (e.g. on the DGX). */}
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
