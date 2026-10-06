import Link from "next/link";
import { Logo } from "@/components/Shell";

/* Any unknown address: the glass card over the hall, with a way back. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-[460px] p-8 text-center">
        <span className="mx-auto mb-4 flex w-fit"><Logo size={48} /></span>
        <div className="eyebrow">Page not found</div>
        <h1 className="mt-2 text-[28px] font-extrabold tracking-[-0.02em] text-fg">This page does not exist</h1>
        <p className="mt-2 text-[14px] text-fg-3">The address may be mistyped, or the link may have expired. A verification link needs its full code.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/" className="btn btn-primary">Back to VehicleSense</Link>
          <Link href="/mobile" className="btn">Open the owner app</Link>
        </div>
      </div>
    </main>
  );
}
