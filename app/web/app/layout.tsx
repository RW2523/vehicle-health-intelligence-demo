import type { Metadata } from "next";
import { Toaster } from "@/components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "VehicleSense AI · Vehicle Health Intelligence",
  description: "AI-assisted vehicle inspection concept demo: lane, examiner, reports, fleet, HQ, regulator and owner apps.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Fonts load from Google Fonts when online; the system fallback is used offline. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap"
        />
      </head>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
