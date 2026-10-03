"use client";
/* Settings → Images: every image slot of the ten main vehicles and the scenes. A slot shows your upload, else a stock
   photo from Wikimedia Commons (credited), else a placeholder; each has a text-to-image prompt to copy, and HQ or the
   presenter can upload an image for it or go back to the stock photo (vhi/api/images.py). */
import { CSSProperties, ChangeEvent, useMemo, useRef, useState } from "react";
import { IconTile, StatusPill } from "./glass";
import { Icon } from "./icons";
import { Photo, PhotoCredit, VehiclePhoto } from "./Photo";
import { ErrorState, LoadingState, Modal, Tabs, toast } from "./ui";
import { useUser } from "@/lib/auth";
import { useFetch } from "@/lib/live";

type Slot = {
  id: string; group: string; plate: string | null; view: string; label: string; where: string; aspect: string;
  prompt: string; path?: string | null; current: Photo | null; stock: Photo | null; uploaded: boolean;
};
type Group = {
  group: string; plate: string | null; make: string | null; model: string | null; year: number | null; vtype: string | null;
  paint: string | null; paint_hex: string | null; title: string;
};
type Status = "all" | "missing" | "uploaded" | "generated" | "stock";

const EDIT_ROLES = ["presenter", "hq"];
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_MB = 12;

/** The dashed placeholder keeps the slot's own aspect ratio inside the cards' common 4:3 frame. */
const frameFor = (a: string): CSSProperties => {
  const [w, h] = a.split(":").map(Number);
  const wide = w / h >= 4 / 3;
  return { aspectRatio: `${w} / ${h}`, width: wide ? "88%" : "auto", height: wide ? "auto" : "84%" };
};
const state = (s: Slot): Exclude<Status, "all"> =>
  s.uploaded ? "uploaded" : s.current?.kind === "generated" ? "generated" : s.current ? "stock" : "missing";
/** What reverting an upload goes back to: the slot's generated image or its stock photo. */
const builtin = (s: Slot) => (s.stock?.kind === "generated" ? "generated image" : "stock photo");

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // http on a LAN address has no clipboard API: fall back to a hidden text area
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function sendFile(slotId: string, file: File, onProgress: (pct: number) => void): Promise<Slot> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/images/slots/${encodeURIComponent(slotId)}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((100 * e.loaded) / e.total));
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body);
      else reject(new Error(typeof body?.detail === "string" ? body.detail : `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("The upload did not reach the server."));
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

async function removeUpload(slotId: string): Promise<Slot> {
  const r = await fetch(`/api/images/slots/${encodeURIComponent(slotId)}`, { method: "DELETE" });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(typeof body?.detail === "string" ? body.detail : `Could not remove the upload (${r.status})`);
  return body;
}

function Badge({ s }: { s: Slot }) {
  const st = state(s);
  if (st === "uploaded") return <StatusPill tone="green" dot className="shadow-sm">Your upload</StatusPill>;
  if (st === "generated") return <StatusPill tone="purple" className="shadow-sm">Generated for the demo</StatusPill>;
  if (st === "stock") return <StatusPill tone="blue" className="shadow-sm">Stock · Wikimedia Commons</StatusPill>;
  return <StatusPill tone="amber" dot className="shadow-sm">Missing</StatusPill>;
}

function CreditLine({ s }: { s: Slot }) {
  const p = s.current;
  if (!p) return <span className="text-fg-4">No photo yet: generate one from the prompt.</span>;
  if (p.kind === "uploaded")
    return <span>Your upload{s.stock ? ` · replaces the ${builtin(s)}` : ""}</span>;
  if (p.kind === "generated") return <span>Generated image for the demo: a picture of this demo vehicle itself</span>;
  return (
    <span>
      {p.author ? `Photo: ${p.author}` : "Photo"} ·{" "}
      {p.license_url ? <a href={p.license_url} target="_blank" rel="noreferrer" className="whitespace-nowrap font-semibold text-fg-2 hover:text-cyan">{p.license}</a> : p.license}
      {" "}·{" "}
      {p.page_url ? <a href={p.page_url} target="_blank" rel="noreferrer" className="whitespace-nowrap font-semibold text-fg-2 hover:text-cyan">Wikimedia Commons ↗</a> : "Wikimedia Commons"}
    </span>
  );
}

function SlotCard({ s, canEdit, onView, onCopy, onChanged }: {
  s: Slot; canEdit: boolean; onView: () => void; onCopy: () => void; onChanged: (s: Slot) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | "upload" | "revert">(null);
  const [pct, setPct] = useState(0);
  const p = s.current;

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type && !TYPES.includes(file.type)) return toast("Choose a JPEG, PNG or WebP image.", "err");
    if (file.size > MAX_MB * 1024 * 1024) return toast(`The image is larger than ${MAX_MB} MB.`, "err");
    setBusy("upload");
    setPct(0);
    try {
      onChanged(await sendFile(s.id, file, setPct));
      toast(`${s.label} updated${s.plate ? ` for ${s.plate}` : ""}.`, "ok");
    } catch (err: any) {
      toast(err.message || "Upload failed.", "err");
    } finally {
      setBusy(null);
    }
  };
  const revert = async () => {
    const msg = s.stock ? `Remove your upload and show the ${builtin(s)} again?` : "Remove your upload? This slot will be empty again.";
    if (!window.confirm(msg)) return;
    setBusy("revert");
    try {
      onChanged(await removeUpload(s.id));
      toast(s.stock ? `Back to the ${builtin(s)}.` : "Upload removed.", "ok");
    } catch (err: any) {
      toast(err.message || "Could not remove the upload.", "err");
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-white/80 bg-white/70 shadow-glass">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#E8EEF7]">
        {p ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url_480} srcSet={`${p.url_480} 1x, ${p.url_960} 2x`} alt={`${s.plate ?? "Scene"} · ${s.label}`} loading="lazy"
              decoding="async" className="absolute inset-0 h-full w-full object-cover" />
            <PhotoCredit photo={p} />
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center pt-5">
            <div style={frameFor(s.aspect)}
              className="flex max-h-[84%] max-w-[88%] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[#B8C6DB] bg-white/60 px-2 text-center">
              <Icon name="image" size={26} color="#94A3B8" width={1.5} />
              <span className="text-[13px] font-semibold text-fg-3">No photo yet</span>
              <span className="text-[11.5px] text-fg-4">{s.aspect} image · use the prompt</span>
            </div>
          </div>
        )}
        <span className="absolute left-2 top-2"><Badge s={s} /></span>
        {busy === "upload" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/75 backdrop-blur-sm" aria-live="polite">
            <span className="text-[13px] font-semibold text-fg-2">{pct < 100 ? `Uploading… ${pct}%` : "Processing…"}</span>
            <div className="h-1.5 w-2/3 overflow-hidden rounded-full bg-[#E2E8F0]">
              <div className="h-full rounded-full bg-gradient-to-r from-[#3B82F6] to-[#2563EB] transition-all" style={{ width: `${Math.max(4, pct)}%` }} />
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <b className="block text-[14px] leading-tight">{s.label}</b>
            <code className="block truncate text-[11.5px] text-fg-4">{s.id}</code>
          </div>
          <span className="chip shrink-0 border-ink-500 bg-white text-fg-3">{s.aspect}</span>
        </div>
        <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-fg-3">
          <Icon name="pin" size={14} className="mt-[1px] shrink-0" /><span className="min-w-0">{s.where}</span>
        </p>
        <p className="break-words text-[12px] leading-snug text-fg-3"><CreditLine s={s} /></p>
        {/* the three actions on one row; going back to the stock photo (after an upload) under it */}
        <div className="mt-auto flex items-center gap-1.5 pt-1.5">
          <button type="button" className="btn btn-sm min-w-0 flex-1 gap-1.5 px-2" onClick={onCopy}><Icon name="copy" size={14} className="shrink-0" /><span className="truncate">Copy prompt</span></button>
          <button type="button" className="btn btn-sm shrink-0 px-2" onClick={onView} aria-label="View prompt" title="View prompt"><Icon name="eye" size={14} /></button>
          {canEdit && (
            <>
              <button type="button" className="btn btn-sm btn-primary shrink-0 gap-1.5 px-2.5" disabled={!!busy} onClick={() => input.current?.click()}
                title={s.uploaded ? "Replace your upload" : "Upload an image for this slot"}>
                <Icon name="upload" size={14} />{busy === "upload" ? "Uploading…" : s.uploaded ? "Replace" : "Upload"}
              </button>
              <input ref={input} type="file" accept={TYPES.join(",")} className="sr-only" tabIndex={-1} aria-hidden onChange={pick} />
            </>
          )}
        </div>
        {canEdit && s.uploaded && (
          <button type="button" className="inline-flex w-fit items-center gap-1.5 rounded-lg px-1 py-0.5 text-[12px] font-semibold text-bad hover:bg-red-50 disabled:opacity-60" disabled={!!busy} onClick={revert}>
            <Icon name="refresh" size={13} />{busy === "revert" ? "Removing…" : s.stock ? (s.stock.kind === "generated" ? "Revert to generated" : "Revert to stock") : "Remove upload"}
          </button>
        )}
      </div>
    </article>
  );
}

/** A vehicle's (or the scenes') row: its photo, name and paint, how many slots have a photo; opens its slots. */
function GroupHead({ g, items, open, onToggle, id }: { g: Group; items: Slot[]; open: boolean; onToggle: () => void; id: string }) {
  const hero = items.find((s) => s.view === "hero")?.current ?? null;
  const filled = items.filter((s) => s.current).length;
  const ups = items.filter((s) => s.uploaded).length;
  const missing = items.length - filled;
  return (
    <h3>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id}
        className="flex w-full items-center gap-3 rounded-xl text-left transition hover:bg-white/50">
        {g.plate ? (
          <VehiclePhoto plate={g.plate} vtype={g.vtype} photo={hero} size="480" className="h-12 w-[68px] shrink-0 rounded-xl ring-1 ring-white sm:h-14 sm:w-20" />
        ) : <IconTile icon="image" tone="purple" size={52} />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[16px] font-bold tracking-tight sm:text-[17px]">{g.plate || "Scenes"}</span>
            <span className="min-w-0 truncate text-[13px] text-fg-2 sm:text-[14px]">{g.plate ? `${g.year ?? ""} ${g.make ?? ""} ${g.model ?? ""}`.trim() : "Hub, lane, pit, flood, tyre and the login background"}</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-fg-3">
            {g.paint && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full ring-1 ring-[#94A3B8]/60" style={{ background: g.paint_hex || "#CBD5E1" }} aria-hidden />{g.paint} ·
              </span>
            )}
            <span>
              {filled} photo{filled === 1 ? "" : "s"}{ups ? ` · ${ups} upload${ups === 1 ? "" : "s"}` : ""}
              {/* on a wider screen the pill beside says how many are missing */}
              {missing > 0 && <span className="sm:hidden"> · {missing} missing</span>}
            </span>
          </span>
        </span>
        <span className="hidden shrink-0 sm:block">{missing ? <StatusPill tone="amber">{missing} missing</StatusPill> : <StatusPill tone="green" dot>Complete</StatusPill>}</span>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/80 ring-1 ring-ink-600 transition ${open ? "rotate-180" : ""}`} aria-hidden>
          <Icon name="down" size={16} color="#475569" />
        </span>
      </button>
    </h3>
  );
}

/** Settings → Images. */
export function ImageLibrary() {
  const user = useUser();
  const canEdit = !!user && EDIT_ROLES.includes(user.role);
  const slots = useFetch<Slot[]>("/api/images/slots");
  const groups = useFetch<Group[]>("/api/images/groups");
  const [group, setGroup] = useState("all");
  const [status, setStatus] = useState<Status>("all");
  const [viewing, setViewing] = useState<Slot | null>(null);
  // one vehicle open at a time by default (the first); a filtered view opens every group it shows
  const [opened, setOpened] = useState<Record<string, boolean>>({});

  const all = slots.data || [];
  const counts = useMemo(() => {
    const c = { all: all.length, missing: 0, uploaded: 0, generated: 0, stock: 0 };
    all.forEach((s) => c[state(s)]++);
    return c;
  }, [all]);
  const shown = useMemo(
    () => (groups.data || [])
      .filter((g) => group === "all" || g.group === group)
      .map((g) => ({ g, items: all.filter((s) => s.group === g.group && (status === "all" || state(s) === status)), every: all.filter((s) => s.group === g.group) }))
      .filter((x) => x.items.length),
    [groups.data, all, group, status],
  );

  const changed = (next: Slot) => {
    slots.setData((xs) => (xs || []).map((x) => (x.id === next.id ? next : x)));
    setViewing((v) => (v && v.id === next.id ? next : v));
  };
  const copy = async (s: Slot) =>
    (await copyText(s.prompt)) ? toast(`Prompt for ${s.id} copied.`, "ok") : toast("Could not copy: select the text in View prompt.", "err");
  const v = viewing;

  return (
    <section className="flex min-w-0 flex-col gap-5" aria-labelledby="image-library-title">
      <div className="card p-4 lg:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 max-w-[720px]">
            <h2 id="image-library-title" className="text-[20px] font-bold tracking-tight">Images</h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-fg-3">
              Photos of the ten main vehicles and the scenes around the apps. Stock photos from Wikimedia Commons show the
              model, not the actual vehicle; generated images show the demo vehicle itself. Generate your own from a
              slot&apos;s prompt and upload it: it replaces the slot&apos;s photo everywhere, and reverting brings it back.
            </p>
          </div>
          <a className="btn btn-sm" href="/api/images/prompts.md" download="vehiclesense-image-prompts.md">
            <Icon name="download" size={14} />Download all prompts
          </a>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusPill tone="blue">{counts.stock} stock</StatusPill>
          <StatusPill tone="purple">{counts.generated} generated</StatusPill>
          <StatusPill tone="green" dot>{counts.uploaded} your uploads</StatusPill>
          <StatusPill tone="amber" dot>{counts.missing} missing</StatusPill>
          <span className="text-[12.5px] text-fg-4">{counts.all} slots</span>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-fg-2">
            <span className="shrink-0">Show</span>
            <select className="input min-w-0 flex-1 py-1.5 sm:w-[300px] sm:flex-none" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Vehicle or scenes">
              <option value="all">All vehicles and scenes</option>
              {(groups.data || []).map((g) => (
                <option key={g.group} value={g.group}>{g.plate ? `${g.plate} · ${g.make} ${g.model}` : "Scenes"}</option>
              ))}
            </select>
          </label>
          <Tabs size="sm" value={status} onChange={setStatus} items={[
            { id: "all", label: "All" }, { id: "missing", label: `Missing (${counts.missing})` },
            { id: "uploaded", label: `Uploads (${counts.uploaded})` }, { id: "generated", label: `Generated (${counts.generated})` }, { id: "stock", label: "Stock" },
          ]} />
        </div>
        {user && !canEdit && (
          <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-fg-3"><Icon name="lock" size={14} />Read only: you can copy the prompts; HQ and the presenter can upload images.</p>
        )}
      </div>

      {(slots.error || groups.error) && !(slots.data && groups.data) ? (
        <ErrorState title="The image library could not load" onRetry={() => (slots.reload(), groups.reload())}>{slots.error || groups.error}</ErrorState>
      ) : !(slots.data && groups.data) ? (
        <div className="card p-5"><LoadingState label="Loading the image slots…" rows={4} /></div>
      ) : !shown.length ? (
        <div className="card flex flex-col items-center gap-2 p-8 text-center">
          <Icon name="checkc" size={30} color="#10B981" />
          <b className="text-[15px]">Nothing to show here</b>
          <span className="text-[13px] text-fg-3">{status === "missing" ? "Every slot in this view has a photo." : "No slots match this filter."}</span>
          <button type="button" className="btn btn-sm mt-1" onClick={() => (setStatus("all"), setGroup("all"))}>Show all slots</button>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          {shown.map(({ g, items, every }, k) => {
            const open = opened[g.group] ?? (k === 0 || shown.length === 1 || status !== "all");
            const id = `slots-${g.group}`;
            return (
              <section key={g.group} className="card min-w-0 p-3 sm:p-4 lg:p-5" aria-label={g.plate || "Scenes"}>
                <GroupHead g={g} items={every} open={open} id={id} onToggle={() => setOpened((o) => ({ ...o, [g.group]: !open }))} />
                {open && (
                  <div id={id} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {items.map((s) => (
                      <SlotCard key={s.id} s={s} canEdit={canEdit} onView={() => setViewing(s)} onCopy={() => copy(s)} onChanged={changed} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <Modal open={!!v} onClose={() => setViewing(null)} title={v ? `${v.plate || "Scene"} · ${v.label}` : ""}>
        {v && (
          <div className="flex w-[min(760px,calc(100vw-5rem))] flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-3">
              <code className="rounded-md bg-white px-1.5 py-0.5 text-fg-2 ring-1 ring-ink-600">{v.id}</code>
              <span className="chip border-ink-500 bg-white text-fg-3">{v.aspect}</span>
              <Badge s={v} />
            </div>
            <p className="text-[13px] text-fg-2"><b>Shows in:</b> {v.where}</p>
            <pre className="max-h-[42vh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-ink-600 bg-white/80 p-3 font-sans text-[13.5px] leading-relaxed text-fg">{v.prompt}</pre>
            <p className="break-words text-[12.5px] text-fg-3">
              Upload it here in Settings → Images, or save it on the API server as <code className="break-all text-fg-2">{v.path}</code> (JPEG, PNG or WebP, any size).
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => copy(v)}><Icon name="copy" size={14} />Copy prompt</button>
              {v.current?.page_url && (
                <a className="btn btn-sm" href={v.current.page_url} target="_blank" rel="noreferrer"><Icon name="link" size={14} />Stock photo source</a>
              )}
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
