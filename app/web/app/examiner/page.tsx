"use client";
/* The examiner workspace moved into the inspection screens: this address opens an inspection's findings. */
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { Shell } from "@/components/Shell";
import { LoadingState } from "@/components/ui";

function Redirect() {
  const sp = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/inspection/${sp.get("id") || sp.get("session") || "S1"}/findings`);
  }, [sp, router]);
  return <Shell><div className="card p-6"><LoadingState label="Opening the findings…" rows={2} /></div></Shell>;
}

export default function Page() {
  return <Suspense><Redirect /></Suspense>;
}
