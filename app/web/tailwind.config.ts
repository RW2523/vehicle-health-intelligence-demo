import type { Config } from "tailwindcss";

// Light "glass" theme. The token names are the original ones (ink = surfaces, fg = text, cyan = the accent), so every
// screen follows the palette from here.
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#E9EEF6", 900: "#F4F7FB", 850: "#F7F9FC", 800: "#FFFFFF", 750: "#EEF4FF", 700: "#E8EDF5", 600: "#E4E9F1", 500: "#CDD6E3" },
        fg: { DEFAULT: "#0F172A", 2: "#334155", 3: "#64748B", 4: "#94A3B8" },
        cyan: { DEFAULT: "#2563EB", soft: "rgba(37,99,235,0.10)" },
        ok: "#059669",
        warn: "#D97706",
        bad: "#DC2626",
        info: "#2563EB",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Inter", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glass: "0 1px 0 rgba(255,255,255,0.8) inset, 0 10px 30px -12px rgba(15,23,42,0.12)",
        float: "0 30px 80px -30px rgba(15,23,42,0.35)",
      },
    },
  },
  plugins: [],
} satisfies Config;
