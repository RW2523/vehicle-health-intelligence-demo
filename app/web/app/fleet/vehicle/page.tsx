"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";

/** "Vehicle History" in the sidebar opens the most urgent flagged vehicle. */
export default function VehicleIndex() {
  const router = useRouter();
  useEffect(() => {
    api.get("/api/fleet/overview").then((o) => {
      const first = o.attention?.[0]?.plate;
      router.replace(first ? `/fleet/vehicle/${encodeURIComponent(first)}` : "/fleet");
    });
  }, [router]);
  return (
    <Shell>
      <p className="py-10 text-center text-[13.5px] text-fg-3">Opening the most urgent vehicle…</p>
    </Shell>
  );
}
