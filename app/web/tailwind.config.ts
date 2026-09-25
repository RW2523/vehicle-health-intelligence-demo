import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#070D1A", 900: "#0B1220", 850: "#0D1526", 800: "#111A2C", 750: "#132038", 700: "#1A2640", 600: "#1F2B44", 500: "#2A3957" },
        fg: { DEFAULT: "#E8EEF7", 2: "#C9D3E3", 3: "#9AA8BF", 4: "#6F7E98" },
        cyan: { DEFAULT: "#22D3EE", soft: "rgba(34,211,238,0.12)" },
        ok: "#34D399",
        warn: "#FBBF24",
        bad: "#F87171",
        info: "#60A5FA",
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "system-ui", "sans-serif"],
        display: ["Sora", "IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
