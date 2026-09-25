"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
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
  return <p className="p-8 text-fg-3">Opening the most urgent vehicle…</p>;
}
