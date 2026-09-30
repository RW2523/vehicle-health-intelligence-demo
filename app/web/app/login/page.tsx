"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { Logo } from "@/components/Shell";
import { api } from "@/lib/api";
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
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[860px]">
        <div className="mb-6 flex items-center gap-3">
          <Logo size={36} />
          <div className="leading-tight">
            <div className="font-display text-[20px] font-bold">VehicleSense <span className="text-cyan">AI</span></div>
            <div className="text-[11px] font-semibold tracking-[0.14em] text-fg-4">VEHICLE HEALTH INTELLIGENCE</div>
          </div>
        </div>
        <form onSubmit={submit} className="card card-pad">
          <h1 className="font-display text-[22px] font-semibold">Log in</h1>
          <p className="mt-1 text-[13px] text-fg-3">Pick the account you are demonstrating, then enter the demo password you were given.</p>
          <div role="radiogroup" aria-label="Account" className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {accounts.map((a) => (
              <button type="button" key={a.username} role="radio" aria-checked={username === a.username} onClick={() => setUsername(a.username)}
                className={`rounded-xl border p-3 text-left transition ${username === a.username ? "border-cyan bg-cyan/10" : "border-ink-600 bg-ink-850 hover:border-ink-500"}`}>
                <div className="text-[13.5px] font-semibold">{a.name}</div>
                <div className="text-[11.5px] text-fg-3">{a.title}</div>
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
        </form>
        <p className="mt-4 text-[11.5px] text-fg-4">Concept demo · fictional vehicles, owners and examiners. A buyer checking a report scans its QR code; that page needs no login.</p>
      </div>
    </main>
  );
}

export default function Page() {
  return <Suspense><Login /></Suspense>;
}
