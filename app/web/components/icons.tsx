/** Line icons (24px grid, stroked) for the navigation, empty states and the fleet tables. */
export const ICONS: Record<string, string> = {
  // navigation
  play: "M6 4l14 8-14 8z",
  lane: "M3 5h18v12H3zM8 21h8M12 17v4M8 11l2.5 2.5L16 8",
  examiner: "M9 3h6v3H9zM7 4.5H5V21h14V4.5h-2M9 13.5l2 2 4-4",
  report: "M6 2h9l5 5v15H6zM14 2v6h6M9 13h7M9 17h7",
  vision: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  fleet: "M4 20V10M10 20V4M16 20v-8M22 20H2",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
  owner: "M7 2h10v20H7zM11 18h2",
  hq: "M3 21h18M5 21V8l7-5 7 5v13M9 21v-5h6v5M9 11h.01M15 11h.01",
  regulator: "M3 21h18M4 10h16M12 3l9 5H3zM6 10v8M10 10v8M14 10v8M18 10v8",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6L6 18",
  arrow: "M5 12h14M13 6l6 6-6 6",
  check: "M5 12l5 5 9-10",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  // fleet issues
  brake: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5 8a8 8 0 0 1 4-4",
  tyre: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 3v5M12 16v5M3 12h5M16 12h5",
  smoke: "M3 17h9a3 3 0 0 0 0-6h-1M3 13h5M14 7a3 3 0 0 1 6 1 3 3 0 0 1-1 5.8M17 17h4",
  spring: "M12 2v3M12 19v3M7 5h10l-10 3.5h10L7 12h10L7 15.5h10L7 19h10",
  lamp: "M9 7a5 5 0 1 1 0 10zM3 8h3M3 12h3M3 16h3M9 7v10",
  rust: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11zM10 14h4",
  cam: "M3 8h13v9H3zM16 11l5-3v9l-5-3M8 12.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0",
  oil: "M8 3s5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 5-9 5-9zM15 16h6M18 13v6",
  pad: "M4 6h16v4H4zM6 10v8h12v-8M10 14h4",
  crack: "M4 4l6 5-3 3 6 4-2 4M14 4l2 4 4 1",
  batt: "M3 7h18v12H3zM7 4v3M17 4v3M7 13h4M15 11v4M13 13h4",
  vib: "M2 12h3l2-5 3 10 3-10 3 10 2-5h4",
  // vehicle placeholder
  car: "M3 13l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 8l2 5v5h-3M6 18H3v-5h18M7 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM13 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0",
};

export function Icon({ name, size = 20, color = "currentColor", width = 1.7, className }: { name: string; size?: number; color?: string; width?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d={ICONS[name] || ""} />
    </svg>
  );
}
