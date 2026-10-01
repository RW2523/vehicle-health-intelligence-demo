/* A clean side-view illustration of a vehicle, by body type, in a paint colour picked from its plate (so the same
   vehicle always looks the same). Used wherever the apps show "this vehicle" without a photo of it. */

const PAINTS: [string, string][] = [
  ["#F1F5F9", "#B8C2CF"], // white
  ["#DCE3EA", "#8C99A8"], // silver
  ["#9CA3AF", "#4B5563"], // grey
  ["#475569", "#0F172A"], // black
  ["#60A5FA", "#1D4ED8"], // blue
  ["#F87171", "#B91C1C"], // red
  ["#94A3B8", "#475569"], // gunmetal
  ["#FDE68A", "#D97706"], // yellow (commercial)
];

function paint(seed: string, commercial: boolean) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  if (commercial && h % 3 === 0) return PAINTS[7];
  return PAINTS[h % 7];
}

type Shape = { body: string; windows: string[]; wheels: number[]; lights: [number, number][]; y?: number };

// viewBox 0 0 240 110; the ground is at y = 98, wheel centres at y = 84
const SHAPES: Record<string, Shape> = {
  sedan: {
    body: "M16 84 L14 66 Q14 58 24 56 L62 52 L86 34 Q92 30 102 30 L148 30 Q158 30 166 36 L188 52 L218 56 Q230 58 231 68 L231 80 Q231 84 227 84 L200 84 A18 18 0 0 0 164 84 L78 84 A18 18 0 0 0 42 84 Z",
    windows: ["M90 36 Q94 34 100 34 L118 34 L118 51 L70 52 Z", "M123 34 L146 34 Q154 34 160 39 L178 51 L123 51 Z"],
    wheels: [60, 182], lights: [[224, 62], [18, 62]],
  },
  hatch: {
    body: "M20 84 L18 60 Q18 46 26 40 L44 30 Q50 27 60 27 L142 27 Q152 27 160 33 L184 51 L214 55 Q228 57 229 68 L229 80 Q229 84 225 84 L198 84 A18 18 0 0 0 162 84 L76 84 A18 18 0 0 0 40 84 Z",
    windows: ["M30 46 L46 33 Q52 31 60 31 L96 31 L96 50 L28 51 Z", "M101 31 L140 31 Q149 31 156 36 L174 50 L101 50 Z"],
    wheels: [58, 180], lights: [[222, 62], [20, 52]],
  },
  suv: {
    body: "M14 84 L12 50 Q12 40 20 36 L40 22 Q46 18 56 18 L150 18 Q160 18 168 25 L192 46 L218 50 Q230 52 231 64 L231 80 Q231 84 227 84 L202 84 A19 19 0 0 0 164 84 L78 84 A19 19 0 0 0 40 84 Z",
    windows: ["M24 40 L42 26 Q48 22 56 22 L92 22 L92 44 L22 46 Z", "M97 22 L128 22 L128 44 L97 44 Z", "M133 22 L148 22 Q157 22 163 28 L182 44 L133 44 Z"],
    wheels: [59, 183], lights: [[224, 58], [16, 48]],
  },
  pickup: {
    body: "M10 84 L10 54 L104 54 L104 34 Q104 26 112 24 L150 22 Q160 22 167 28 L190 48 L218 52 Q230 54 231 66 L231 80 Q231 84 227 84 L202 84 A19 19 0 0 0 164 84 L78 84 A19 19 0 0 0 40 84 Z",
    windows: ["M110 28 L136 26 L136 48 L110 48 Z", "M141 26 L150 26 Q158 26 164 32 L180 47 L141 48 Z"],
    wheels: [59, 183], lights: [[224, 60], [12, 58]],
  },
  van: {
    body: "M10 84 L10 26 Q10 16 22 16 L170 16 Q178 16 184 22 L212 48 Q230 52 231 64 L231 80 Q231 84 227 84 L204 84 A19 19 0 0 0 166 84 L78 84 A19 19 0 0 0 40 84 Z",
    windows: ["M150 22 L172 22 Q178 22 182 27 L204 46 L150 46 Z", "M110 22 L144 22 L144 46 L110 46 Z"],
    wheels: [59, 185], lights: [[224, 58], [12, 40]],
  },
  lorry: {
    body: "M6 78 L6 14 L160 14 L160 78 Z M164 84 L164 26 Q164 18 172 18 L204 18 Q214 18 220 30 L230 52 Q233 58 233 66 L233 80 Q233 84 229 84 L216 84 A16 16 0 0 0 184 84 Z",
    windows: ["M176 24 L206 24 Q212 24 216 32 L224 48 L176 48 Z"],
    wheels: [36, 76, 200], lights: [[228, 64], [8, 70]], y: 0,
  },
  bus: {
    body: "M8 84 L8 24 Q8 14 20 14 L214 14 Q228 14 230 28 L232 80 Q232 84 228 84 L206 84 A18 18 0 0 0 170 84 L72 84 A18 18 0 0 0 36 84 Z",
    windows: ["M18 22 L52 22 L52 46 L18 46 Z", "M58 22 L92 22 L92 46 L58 46 Z", "M98 22 L132 22 L132 46 L98 46 Z", "M138 22 L172 22 L172 46 L138 46 Z", "M178 22 L222 22 Q226 22 226 28 L226 52 L178 52 Z"],
    wheels: [54, 188], lights: [[226, 66], [10, 66]],
  },
};

const KIND: Record<string, keyof typeof SHAPES> = {
  Sedan: "sedan", Hatchback: "hatch", SUV: "suv", MPV: "suv", Pickup: "pickup", Van: "van", Lorry: "lorry",
  "Prime mover": "lorry", Bus: "bus", "Passenger Car": "sedan",
};

export function VehicleArt({ vtype, seed = "", className = "", title }: { vtype?: string | null; seed?: string; className?: string; title?: string }) {
  if (vtype === "Motorcycle") return <BikeArt seed={seed} className={className} title={title} />;
  const kind = KIND[vtype || ""] || "sedan";
  const s = SHAPES[kind];
  const [hi, lo] = paint(seed || vtype || "x", kind === "lorry" || kind === "van" || kind === "bus");
  const id = `v${(seed || vtype || "x").replace(/[^a-z0-9]/gi, "")}${kind}`;
  return (
    <svg viewBox="0 0 240 110" className={className} role="img" aria-label={title || `${vtype || "Vehicle"} illustration`}>
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={hi} />
          <stop offset="0.55" stopColor={lo} />
          <stop offset="1" stopColor={lo} stopOpacity="0.92" />
        </linearGradient>
        <linearGradient id={`${id}w`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#334155" />
          <stop offset="0.6" stopColor="#0F172A" />
          <stop offset="1" stopColor="#1E293B" />
        </linearGradient>
        <radialGradient id={`${id}r`}>
          <stop offset="0" stopColor="#F8FAFC" />
          <stop offset="1" stopColor="#94A3B8" />
        </radialGradient>
        <filter id={`${id}s`} x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
      </defs>
      <ellipse cx="122" cy="99" rx="108" ry="5" fill="#0F172A" opacity="0.18" filter={`url(#${id}s)`} />
      <path d={s.body} fill={`url(#${id}b)`} stroke="#0F172A" strokeOpacity="0.12" />
      {s.windows.map((w, i) => <path key={i} d={w} fill={`url(#${id}w)`} opacity="0.9" />)}
      <path d={s.body} fill="none" stroke="#FFFFFF" strokeOpacity="0.45" strokeWidth="1.2" transform="translate(0 -1)" />
      {s.lights.map(([x, y], i) => (
        <rect key={i} x={i === 0 ? x - 6 : x} y={y} width="8" height="4" rx="2" fill={i === 0 ? "#FEF3C7" : "#EF4444"} opacity="0.95" />
      ))}
      {s.wheels.map((x) => (
        <g key={x}>
          <circle cx={x} cy="84" r="15" fill="#111827" />
          <circle cx={x} cy="84" r="9" fill={`url(#${id}r)`} />
          <circle cx={x} cy="84" r="3" fill="#475569" />
        </g>
      ))}
    </svg>
  );
}

function BikeArt({ seed, className, title }: { seed: string; className?: string; title?: string }) {
  const [hi, lo] = paint(seed, false);
  return (
    <svg viewBox="0 0 240 110" className={className} role="img" aria-label={title || "Motorcycle illustration"}>
      <ellipse cx="120" cy="99" rx="80" ry="4" fill="#0F172A" opacity="0.15" />
      <circle cx="70" cy="80" r="17" fill="none" stroke="#111827" strokeWidth="6" />
      <circle cx="172" cy="80" r="17" fill="none" stroke="#111827" strokeWidth="6" />
      <path d="M70 80 L104 52 L140 52 L172 80 M140 52 L156 34 L170 34" fill="none" stroke="#334155" strokeWidth="5" strokeLinecap="round" />
      <path d="M92 50 Q100 36 124 38 L146 46 Q150 54 140 56 L100 58 Z" fill={hi} stroke={lo} strokeWidth="2" />
    </svg>
  );
}
