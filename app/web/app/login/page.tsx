"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/Shell";
import { api } from "@/lib/api";
import { APPS, appOf } from "@/lib/apps";
import { ROLE_HOME, loadUser } from "@/lib/auth";

type Account = { username: string; name: string; role: string; title: string };

function Login() {
  const router = useRouter();
  const sp = useSearchParams();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get("/api/auth/accounts").then(setAccounts).catch(() => setErr("The server is not reachable. Try again in a moment."));
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const u = await api.post("/api/auth/login", { username, password });
      await loadUser(true);
      const next = sp.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : ROLE_HOME[u.role] || "/");
    } catch (x: any) {
      setErr(x.message);
      setBusy(false);
    }
  };
  const home = (role: string) => APPS.find((a) => a.id === appOf(ROLE_HOME[role] || "/"))!;
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8 lg:py-10">
      {/* the two cards are the same height on a wide screen; on a phone the brand card is short and the accounts are a
          compact two-column list, so the username field is on the first screen */}
      <div className="grid w-full max-w-[1180px] grid-cols-1 items-stretch gap-5 sm:gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-8">
        <section className="relative flex flex-col justify-between gap-6 overflow-hidden rounded-[28px] bg-[#1E3A8A] p-5 pb-7 text-white shadow-float sm:p-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/login-scene.jpg" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-br from-[#1E3A8A]/95 via-[#1D4ED8]/80 to-[#0F172A]/55" aria-hidden />
          <span className="absolute bottom-2 right-4 text-[10px] text-blue-100/70">Photo: Slleong · CC0 · Wikimedia Commons</span>
          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="rounded-2xl bg-white/15 p-1.5 ring-1 ring-white/25"><Logo size={40} /></span>
              <div className="leading-tight">
                <div className="text-[22px] font-extrabold tracking-tight">VehicleSense</div>
                <div className="text-[11.5px] font-medium tracking-[0.2em] text-blue-100">VEHICLE HEALTH INTELLIGENCE</div>
              </div>
            </div>
            <h2 className="mt-5 text-[26px] font-extrabold leading-tight tracking-tight sm:mt-8 sm:text-[36px]">One platform,<br />three apps.</h2>
            <p className="mt-2 max-w-[440px] text-[13.5px] leading-relaxed text-blue-100 sm:mt-3 sm:text-[14.5px]">Lane sensors and AI vision, the examiner&apos;s decisions, the owner&apos;s phone and the national view, on one evidence chain.</p>
          </div>
          <ul className="relative hidden flex-col gap-2.5 sm:flex">
            {APPS.map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/15 backdrop-blur">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15"><Icon name={a.icon} size={19} color="#fff" /></span>
                <span className="min-w-0 flex-1 leading-tight"><b className="block text-[14.5px]">{a.full}</b><span className="block truncate text-[12px] text-blue-100">{a.sub}</span></span>
                <code className="hidden rounded-lg bg-white/15 px-2 py-0.5 text-[12px] sm:block">{a.href}</code>
              </li>
            ))}
          </ul>
        </section>
        <div className="flex flex-col">
          <form onSubmit={submit} className="card flex flex-1 flex-col p-5 sm:p-8">
            <div className="eyebrow mb-1">Welcome</div>
            <h1 className="text-[28px] font-extrabold tracking-tight sm:text-[30px]">Log in</h1>
            <p className="mt-1 text-[13.5px] text-fg-2 sm:text-[14px]">Pick the account you are demonstrating, then enter the demo password you were given. Each account opens its own app.</p>
            <div role="radiogroup" aria-label="Account" className="mt-4 grid grid-cols-2 gap-2">
              {accounts.map((a) => (
                <button type="button" key={a.username} role="radio" aria-checked={username === a.username} onClick={() => setUsername(a.username)} title={a.title}
                  className={`flex min-w-0 flex-col items-start gap-1 rounded-2xl border p-2.5 text-left transition sm:flex-row sm:justify-between sm:gap-2 sm:p-3 ${username === a.username ? "border-blue-300 bg-white shadow-md ring-2 ring-blue-100" : "border-white/80 bg-white/60 hover:bg-white"}`}>
                  <span className="min-w-0 max-w-full"><span className="block text-[13px] font-semibold leading-snug sm:text-[13.5px]">{a.name}</span><span className="hidden text-[11.5px] text-fg-3 sm:block">{a.title}</span></span>
                  <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10.5px] font-semibold text-[#1D4ED8]">{a.role === "presenter" || a.role === "viewer" ? "All apps" : home(a.role).name}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex flex-1 flex-col gap-1 text-[12.5px] text-fg-3">Username
                <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-[12.5px] text-fg-3">Password
                <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <button className="btn btn-primary" disabled={!username || !password || busy}>{busy ? "Logging in…" : "Log in"}</button>
            </div>
            {err && <p role="alert" className="mt-3 text-[13px] font-semibold text-bad">{err}</p>}
            <p className="mt-auto pt-5 text-[11.5px] text-fg-4">Concept demo · fictional vehicles, owners and examiners. A buyer checking a report scans its QR code; that page needs no login.</p>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function Page() {
  return <Suspense><Login /></Suspense>;
}
