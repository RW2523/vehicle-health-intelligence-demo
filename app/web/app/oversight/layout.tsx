import type { Metadata } from "next";

/* The Oversight app has its own name in the browser tab. */
export const metadata: Metadata = {
  title: "VehicleSense Oversight",
  description: "National oversight: HQ operations, the regulator's registrations, used-vehicle sales and flood watch.",
};

export default function OversightLayout({ children }: { children: React.ReactNode }) {
  return children;
}
